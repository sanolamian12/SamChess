/**
 * `@samchess/server`가 밖으로 내놓는 것 — **부팅은 여기 없다.**
 *
 * 부팅은 `main.ts`이고 `npm run server`가 그것을 부른다. 둘을 가르지 않으면
 * 이 패키지를 **import하는 순간 서버가 뜬다** — 스모크가 제 안에서 방만 빌려
 * 쓰려 할 때 포트를 잡아 버린다.
 */
export { BattleRoom } from './BattleRoom.ts';
export type { BattleRoomOptions } from './BattleRoom.ts';
export { openRoom, step, deadlineFor } from './room-logic.ts';
export type { Outbound, RoomEvent, RoomState, Seat, StepResult } from './room-logic.ts';
export { BATTLE_ROOM, SERVER_PORT, SERVER_URL } from './protocol.ts';
export type { ClientMessage, Enlist, Opened } from './protocol.ts';
export { now } from './clock.ts';
