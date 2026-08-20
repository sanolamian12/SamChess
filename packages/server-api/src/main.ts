/**
 * 계정 API 부팅.
 *
 * `packages/server`(Colyseus)와 **완전히 분리된 프로세스**다 — 계정 CRUD를 대전
 * 방에 얹으면 "Colyseus는 방·전송·재접속만 쓴다"(§5-54)가 깨진다. 이 파일이
 * 배럴이 아니라 부팅 그 자체인 것도 `server/src/main.ts`와 같은 이유다.
 */
import Fastify from 'fastify';
import { registerRoutes } from './routes.ts';

const PORT = Number(process.env['SAMCHESS_API_PORT'] ?? 8787);

const app = Fastify({ logger: true });
registerRoutes(app);

app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`✓ 계정 API — http://localhost:${PORT}`);
});
