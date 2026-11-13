/**
 * 대전 서버의 내부 HTTP — **관리자 API가 묻는 자리 둘** (2026-11-13).
 *
 * `GET /internal/battles` → `{ rooms: LiveRoomSummary[] }`(관리자 「전투」),
 * `GET /internal/health` → `ProcessHealth`(관리자 「시스템」 — 메모리 · 이벤트 루프 · 사건의 1분 칸 · 방 · 대기열, `health.ts`). 게임 API와 같은 서버 간 비밀(`x-internal-secret`)로만 연다 —
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
import { processHealth } from './health.ts';

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
  // 비밀을 본 **뒤에** 읽는다 — 그래서 값이 아니라 읽는 함수를 고른다
  const read: (() => Promise<object>) | undefined = req.method !== 'GET' ? undefined
    : path === '/internal/battles' ? () => liveRooms().then((rooms) => ({ rooms }))
    : path === '/internal/health' ? processHealth
    : undefined;
  if (!read) {
    res.writeHead(404).end();
    return;
  }
  // 비밀이 비어 있으면(개발에서 .env를 안 읽음) 아무에게도 안 연다
  if (!SECRET || req.headers['x-internal-secret'] !== SECRET) {
    res.writeHead(401).end();
    return;
  }
  read().then(
    (body) => { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body)); },
    (e: unknown) => { res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); },
  );
}
