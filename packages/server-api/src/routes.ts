/**
 * 계정 API 라우트. `/profile`(사용자 인증) + `/internal/grain`(서버 간 공유 비밀, H3b).
 */
import type { FastifyInstance } from 'fastify';
import type { BattleMode, Intent, OfficerId } from '@samchess/rules';
import type { RosterPick } from '@samchess/meta';
import { verifyToken } from './auth.ts';
import { verifyInternalSecret } from './internalAuth.ts';
import { applyGrainAction, getProfile, saveProfile } from './profileStore.ts';
import type { GrainAction } from './profileStore.ts';
import { settleAiBattle } from './aiBattle.ts';
import type { AiBattleRequest } from './aiBattle.ts';

export function registerRoutes(app: FastifyInstance): void {
  app.get('/profile', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const profile = await getProfile(user.uid);
    if (!profile) return reply.code(404).send({ error: 'not found' });
    return profile;
  });

  /**
   * 있으면 덮어쓰고 없으면 만든다(upsert) — 로그인 뒤 "서버에 없으면 로컬 걸
   * 한 번 올린다"(가져오기)와 평소 저장이 **같은 엔드포인트**다. 둘을 가르면
   * 클라이언트가 "이번이 처음인가"를 스스로 판단해야 하는데, 서버가 upsert면
   * 그 판단이 필요 없다.
   */
  app.put('/profile', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const profile = await saveProfile(user.uid, req.body);
    if (!profile) return reply.code(400).send({ error: 'invalid profile' });
    return profile;
  });

  /**
   * 참가비·거절 군량·환불 재계산 — **내부 전용**(서버 간 공유 비밀, 사용자 토큰이
   * 아니다). `packages/server`(Colyseus)의 `QueueRoom`·`BattleRoom`이 각각 방이
   * 열리는·거절되는·접히는 그 순간에 직접 부른다(H3b). 요청 본문의 `mode`·`action`만
   * 쓰고 **`grain` 값은 아예 받지 않는다** — 서버가 가진 프로필에서 다시 계산한다.
   */
  app.post('/internal/grain', async (req, reply) => {
    if (!verifyInternalSecret(req.headers['x-internal-secret'] as string | undefined)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const body = req.body as { uid?: string; mode?: BattleMode; action?: GrainAction };
    if (!body.uid || !body.mode || !body.action) return reply.code(400).send({ error: 'invalid body' });

    try {
      const profile = await applyGrainAction(body.uid, body.mode, body.action);
      if (!profile) return reply.code(404).send({ error: 'not found' });
      return { ok: true };
    } catch (e) {
      return reply.code(409).send({ error: e instanceof Error ? e.message : 'conflict' });
    }
  });

  /**
   * AI 대전 결과 — 사람이 낸 의도만 받아 **같은 시드로 재생**해 검증한 뒤 보상을
   * 반영한다(§5-96). 사용자 토큰이다 — `PUT /profile`과 같은 인증. 무승부는 여기
   * 안 온다(클라이언트가 택1을 고른 뒤 지금처럼 `PUT /profile`한다).
   */
  app.post('/battle/ai-result', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const b = req.body as Partial<{
      mode: BattleMode; seed: number; targetPower: number; exclude: OfficerId[];
      picks: RosterPick[]; squadId: string | null; humanIntents: Intent[];
    }>;
    if (
      !b.mode || typeof b.seed !== 'number' || typeof b.targetPower !== 'number'
      || !Array.isArray(b.exclude) || !Array.isArray(b.picks) || !Array.isArray(b.humanIntents)
    ) {
      return reply.code(400).send({ error: 'invalid body' });
    }
    const body: AiBattleRequest = {
      mode: b.mode, seed: b.seed, targetPower: b.targetPower, exclude: b.exclude,
      picks: b.picks, squadId: b.squadId ?? null, humanIntents: b.humanIntents,
    };

    const result = await settleAiBattle(user.uid, body);
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return { profile: result.profile, rewards: result.rewards };
  });
}
