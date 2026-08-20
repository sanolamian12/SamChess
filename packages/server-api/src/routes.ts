/**
 * 계정 API 라우트. 지금은 `/profile` 하나뿐이다 — 로컬 저장을 그대로 서버로 옮긴
 * 첫 조각(H3a)이라 CRUD 이상은 아직 없다. 참가비·거절 군량 재검증은 H3b.
 */
import type { FastifyInstance } from 'fastify';
import { verifyToken } from './auth.ts';
import { getProfile, saveProfile } from './profileStore.ts';

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
}
