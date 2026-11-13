/**
 * 대전 서버의 내부 HTTP — **관리자 「전투」 화면이 지금 열린 방을 묻는 자리 하나** (2026-11-13).
 *
 * `GET /internal/battles` → `{ rooms: LiveRoomSummary[] }`. 게임 API와 같은 서버 간 비밀(`x-internal-secret`)로만 연다 —
 * 사람 쪽(클라이언트)은 이 길을 모른다. Colyseus의 매치메이킹 경로(`/matchmake/…`)는 Colyseus가 먼저 가로채고,
 * 나머지 요청만 여기로 온다(`Server.attachMatchMakingRoutes`가 앞서 걸린 리스너를 그대로 부른다).
 *
 * **읽기만 한다** — 방의 상태는 `BattleRoom.summary()` → `roomSummary()`(순수)가 낸다. 방을 고치는 길은 없다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { matchMaker } from '@colyseus/core';
import type { LiveRoomSummary } from '@samchess/meta';
import { BattleRoom } from './BattleRoom.ts';
import { BATTLE_ROOM } from './protocol.ts';

const SECRET = process.env['INTERNAL_API_SECRET'] ?? '';

/** 지금 이 프로세스에 열린 대전 방 — 아직 둘이 안 모인 방은 뺀다 */
export async function liveRooms(): Promise<LiveRoomSummary[]> {
  const cached = await matchMaker.query({ name: BATTLE_ROOM });
  const rooms: LiveRoomSummary[] = [];
  for (const c of cached) {
    const room = matchMaker.getLocalRoomById(c.roomId);
    const s = room instanceof BattleRoom ? room.summary() : null;
    if (s) rooms.push(s);
  }
  return rooms;
}

export function handleInternal(req: IncomingMessage, res: ServerResponse): void {
  const path = (req.url ?? '').split('?')[0];
  if (req.method !== 'GET' || path !== '/internal/battles') {
    res.writeHead(404).end();
    return;
  }
  // 비밀이 비어 있으면(개발에서 .env를 안 읽음) 아무에게도 안 연다
  if (!SECRET || req.headers['x-internal-secret'] !== SECRET) {
    res.writeHead(401).end();
    return;
  }
  liveRooms().then(
    (rooms) => { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ rooms })); },
    (e: unknown) => { res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); },
  );
}
