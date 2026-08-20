/**
 * 대전 서버 부팅 — **로컬 개발만** (§5-59).
 *
 * ```
 * npm run server        →  ws://localhost:2567
 * ```
 *
 * 배포(도메인 · TLS(wss) · 프로세스 관리 · CORS)는 별개의 일이고, 그때 바뀌는 것이
 * **코드가 아니라 설정**이도록 주소를 `protocol.ts`의 상수 하나 + 환경변수로 뒀다.
 *
 * **서버가 꺼져 있어도 게임은 돈다** — AI 대전의 판정 주체는 같은 프로세스의 룰
 * 엔진이다(`LocalTransport`). 여기 붙는 것은 사람 대 사람뿐이다(§5-61).
 */

import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BattleRoom } from './BattleRoom.ts';
import { QueueRoom } from './QueueRoom.ts';
import { BATTLE_ROOM, QUEUE_ROOM, SERVER_PORT } from './protocol.ts';

/*
 * **`colyseus` 메타 패키지를 안 쓴다.** 그 패키지의 ESM 진입점이 redis 드라이버·
 * 인증까지 **모두 import**해서, 안 쓰는 것까지 설치하지 않으면 부팅이 안 된다.
 * 필요한 둘(`@colyseus/core` · `@colyseus/ws-transport`)만 직접 쓴다 —
 * **방·전송·재접속만 쓴다**(§5-54)는 결정이 의존성에서도 그대로 선다.
 */
const server = new Server({ transport: new WebSocketTransport() });
server.define(BATTLE_ROOM, BattleRoom);
// **대기열은 하나뿐이다** — `autoDispose = false`라 비어도 안 접힌다(거절 기억이 거기 산다)
server.define(QUEUE_ROOM, QueueRoom);

void server.listen(SERVER_PORT).then(() => {
  console.log(`[samchess] 대전 서버 — ws://localhost:${SERVER_PORT}`);
});
