/**
 * 관리자 API 부팅 — 계정 API(`../main.ts`, 8787)와 **따로 도는 프로세스**다 (2026-10-20).
 *
 * ```
 * npm run admin-api        →  http://localhost:8788
 * ```
 *
 * 따로 두는 이유:
 * - 운영에서 이 포트만 사내망 · VPN 뒤로 숨길 수 있다 — 게임 API는 세상에 열려 있어야 한다.
 * - CORS 허용 주소가 다르다 — 이쪽은 관리자 화면(SamChessAdmin) 하나뿐이다.
 * - 같은 `profiles` 행을 같은 잠금(`for update`)으로 고치므로 두 프로세스가 서로를 덮어쓰지 않는다.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerAdminRoutes } from './routes.ts';

const PORT = Number(process.env['SAMCHESS_ADMIN_PORT'] ?? 8788);
/** 관리자 화면의 주소. 쉼표로 여럿 */
const ORIGINS = (process.env['SAMCHESS_ADMIN_ORIGIN'] ?? 'http://localhost:5174').split(',').map((s) => s.trim());

const app = Fastify({ logger: true });
// `methods`를 반드시 적는다 — 빠지면 브라우저가 프리플라이트만 통과시키고 진짜 요청을 조용히 막는다(`../main.ts` 머리말)
await app.register(cors, { origin: ORIGINS, methods: ['GET', 'POST'] });
registerAdminRoutes(app);

// 기본은 이 기계 안에서만 받는다 — 밖에 열 때는 `SAMCHESS_ADMIN_HOST=0.0.0.0`을 일부러 적는다
const HOST = process.env['SAMCHESS_ADMIN_HOST'] ?? '127.0.0.1';
app.listen({ port: PORT, host: HOST }).then(() => {
  console.log(`✓ 관리자 API — http://localhost:${PORT} (허용 화면: ${ORIGINS.join(', ')})`);
});
