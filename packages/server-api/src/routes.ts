/**
 * 계정 API 라우트. `/profile`(사용자 인증) + `/internal/grain`(서버 간 공유 비밀, H3b).
 */
import type { FastifyInstance } from 'fastify';
import type { BattleMode, Intent, OfficerId } from '@samchess/rules';
import type { BattleOutcome, DrawReward, OpponentKind, RosterPick } from '@samchess/meta';
import { verifyToken } from './auth.ts';
import { verifyInternalSecret } from './internalAuth.ts';
import { applyGrainAction, deleteProfile, getProfile, saveProfile } from './profileStore.ts';
import type { GrainAction } from './profileStore.ts';
import { settleAiBattle } from './aiBattle.ts';
import type { AiBattleRequest } from './aiBattle.ts';
import { settleOutcome } from './battleResult.ts';

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
   *
   * **`grain`·`grainAt`은 여기서 안 믿는다** (H3d, `profileStore.saveProfile()` 참조) —
   * 시간 충전·전투 보상 둘 다 정본이 따로 있다.
   */
  app.put('/profile', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const profile = await saveProfile(user.uid, req.body);
    if (!profile) return reply.code(400).send({ error: 'invalid profile' });
    return profile;
  });

  /**
   * 계정 초기화(테스트용) — 지금 프로필을 지우고 새 도시 생성 흐름으로 되돌린다.
   * `deleteProfile()`은 원래 스모크·테스트 정리용이었는데, 화면에서 도시를 다시
   * 만들어 테스트하려 해도 되돌아갈 방법이 없어 여기 그대로 얹었다.
   */
  app.delete('/profile', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    await deleteProfile(user.uid);
    return { ok: true };
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
   * 안 온다(사람이 택1을 고른 뒤 `/battle/draw-result`로 간다, H3d).
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

  /**
   * 온라인 대전 승/패 반영 — **내부 전용** (서버 간 공유 비밀, H3d).
   * `packages/server`(Colyseus)의 `BattleRoom`이 `room.battle.phase === 'finished'`가
   * 되는 그 순간, **자신이 이미 판정을 끝낸 상태**에서 각 진영의 결과를 직접 통보한다 —
   * `/battle/ai-result`처럼 재생해서 검증할 필요가 없다(Colyseus 자신이 판정
   * 주체였다). 무승부(`winner === null`, 실측 0.02%)는 여기 안 온다 — 사람이 택1을
   * 고른 뒤에만 반영되므로 `/battle/draw-result`로 간다.
   */
  app.post('/internal/battle-result', async (req, reply) => {
    if (!verifyInternalSecret(req.headers['x-internal-secret'] as string | undefined)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const b = req.body as Partial<{
      uid: string; mode: BattleMode; result: 'win' | 'lose'; seed: number;
      picks: RosterPick[]; kills: Record<string, number>;
      power: { mine: number; theirs: number };
      opponentId: string | null; mySquad: string | null; theirSquad: string | null;
    }>;
    if (
      !b.uid || !b.mode || (b.result !== 'win' && b.result !== 'lose')
      || typeof b.seed !== 'number' || !Array.isArray(b.picks) || !b.power
    ) {
      return reply.code(400).send({ error: 'invalid body' });
    }
    const outcome: BattleOutcome = {
      result: b.result, mode: b.mode, opponent: 'online', picks: b.picks,
      ...(b.kills ? { kills: b.kills } : {}),
      power: b.power, at: Date.now(),
      opponentId: b.opponentId ?? null, mySquad: b.mySquad ?? null, theirSquad: b.theirSquad ?? null,
    };
    const settled = await settleOutcome(b.uid, outcome, b.seed);
    if (!settled.ok) return reply.code(settled.status).send({ error: settled.reason });
    return { rewards: settled.rewards };
  });

  /**
   * 무승부 택1 반영 — **AI·온라인이 갈리지 않는다** (GDD §6.4). 사용자 토큰이다.
   *
   * `picks`·`kills`·`power`는 여전히 클라이언트가 대는 값이다 — 승/패와 달리
   * 무승부는 「사람이 셋 중 하나를 고른 뒤에만 반영한다」는 UI 상태를 서버가
   * 미리 알 수 없어(고르기 전까지는 계정에 아무것도 반영하지 않는다), 판정
   * 주체(로컬 AI 재생 또는 Colyseus)가 이미 사라진 뒤에 온다. **위조 여지가 여기에만
   * 좁게 남는다** — H3c가 AI 무승부에 남겨 둔 것과 같은, 알고 남긴 낮은 심각도의
   * 공백이다(§5-96). `PUT /profile`이 `grain`을 더는 안 믿게 되며(H3d) 이 경로가
   * 없으면 무승부의 군량 보상이 조용히 사라지므로, 승/패와 달리 새로 만들었다.
   */
  app.post('/battle/draw-result', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const b = req.body as Partial<{
      mode: BattleMode; opponent: OpponentKind; seed: number; drawPick: DrawReward;
      picks: RosterPick[]; kills: Record<string, number>;
      power: { mine: number; theirs: number };
      opponentId: string | null; mySquad: string | null; theirSquad: string | null;
    }>;
    if (
      !b.mode || (b.opponent !== 'ai' && b.opponent !== 'online')
      || typeof b.seed !== 'number' || !Array.isArray(b.picks) || !b.power
      || (b.drawPick !== 'card' && b.drawPick !== 'material' && b.drawPick !== 'grain')
    ) {
      return reply.code(400).send({ error: 'invalid body' });
    }
    const outcome: BattleOutcome = {
      result: 'draw', mode: b.mode, opponent: b.opponent, picks: b.picks,
      ...(b.kills ? { kills: b.kills } : {}),
      power: b.power, at: Date.now(), drawPick: b.drawPick,
      opponentId: b.opponentId ?? null, mySquad: b.mySquad ?? null, theirSquad: b.theirSquad ?? null,
    };
    const settled = await settleOutcome(user.uid, outcome, b.seed);
    if (!settled.ok) return reply.code(settled.status).send({ error: settled.reason });
    return { profile: settled.profile, rewards: settled.rewards };
  });
}
