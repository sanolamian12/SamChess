/**
 * 계정 API 부팅.
 *
 * `packages/server`(Colyseus)와 **완전히 분리된 프로세스**다 — 계정 CRUD를 대전
 * 방에 얹으면 "Colyseus는 방·전송·재접속만 쓴다"(§5-54)가 깨진다. 이 파일이
 * 배럴이 아니라 부팅 그 자체인 것도 `server/src/main.ts`와 같은 이유다.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes.ts';

const PORT = Number(process.env['SAMCHESS_API_PORT'] ?? 8787);

const app = Fastify({ logger: true });
/*
 * 클라이언트(Vite, 다른 origin)에서 곧바로 호출한다 — 쿠키를 안 쓰므로(Bearer 토큰뿐)
 * `credentials`는 필요 없다. 배포 origin은 `SAMCHESS_WEB_ORIGIN`으로 좁힌다.
 *
 * **`methods`를 반드시 명시한다** — `@fastify/cors`의 기본값이 이 서버에서는
 * `GET,HEAD,POST`로만 잡혀 `PUT`이 빠졌다(라우트를 훑어 추론하는 방식이 등록
 * 순서에 따라 갈리는 듯하다). 빠지면 브라우저가 프리플라이트는 204로 통과시키고
 * **진짜 PUT은 보내지도 않고 조용히 막는다** — 서버 로그에는 아무 흔적도 안 남아
 * "왜 저장이 안 되지"로 한참 헤매게 된다.
 */
await app.register(cors, {
  origin: process.env['SAMCHESS_WEB_ORIGIN'] ?? true,
  methods: ['GET', 'PUT'],
});
registerRoutes(app);

app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`✓ 계정 API — http://localhost:${PORT}`);
});
