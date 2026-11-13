/**
 * 대전 서버의 상태 (2026-11-13, 관리자 「시스템」) — `GET /internal/health`(`internalHttp.ts`)가 낸다.
 *
 * 메모리 · 이벤트 루프 지연 · 사건의 1분 칸(`traffic.ts`) · 방 · 대기열. 게임 API의 `server-api/src/health.ts`와 같은 모양(meta
 * `ProcessHealth`)이고, 두 프로세스가 서로 import하지 않아 이벤트 루프를 재는 몇 줄만 두 벌이다.
 *
 * **부팅(`main.ts`) 쪽에서만 들인다** — 이벤트 루프 측정 타이머가 import 순간 돈다. 배럴(`index.ts`)에 넣으면 방만 빌리는 스모크에도 돈다.
 */
import { hostname } from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { matchMaker } from '@colyseus/core';
import { trafficWindow } from '@samchess/meta';
import type { ProcessHealth } from '@samchess/meta';
import { BattleRoom } from './BattleRoom.ts';
import { QueueRoom } from './QueueRoom.ts';
import { BATTLE_ROOM, QUEUE_ROOM } from './protocol.ts';
import { now } from './clock.ts';
import { traffic } from './traffic.ts';

const startedAt = now();

// 지연은 측정 바닥(`min`)을 뺀다 — Windows의 타이머 눈금(약 15.6ms)이 쉬는 프로세스에도 지연으로 찍힌다(meta `ProcessHealth.eventLoop`)
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
let elu = performance.eventLoopUtilization();
const ms = (ns: number) => Math.max(0, Math.round((ns / 1e6) * 10) / 10);
const fold = (): ProcessHealth['eventLoop'] => ({
  utilization: Math.round(performance.eventLoopUtilization(elu).utilization * 1000) / 1000,
  p99: ms(loop.percentile(99) - loop.min), max: ms(loop.max - loop.min),
});
let lastMinute: ProcessHealth['eventLoop'] | null = null;
setInterval(() => { lastMinute = fold(); loop.reset(); elu = performance.eventLoopUtilization(); }, 60_000).unref();

export async function processHealth(): Promise<ProcessHealth> {
  const at = now();
  const m = process.memoryUsage();
  const battles = await matchMaker.query({ name: BATTLE_ROOM });
  const queues = await matchMaker.query({ name: QUEUE_ROOM });
  const q = queues[0] ? matchMaker.getLocalRoomById(queues[0].roomId) : undefined;
  const size = q instanceof QueueRoom ? q.size() : { queue: 0, matching: 0 };
  // 자리는 방의 요약에서 센다 — 끊겨 재접속 유예 중인 자리는 소켓이 없어도 「자리」다(`connected`가 갈라 준다).
  // 아직 둘이 안 모인 방(요약이 `null`)은 방 수에는 들고 자리에는 안 든다
  let players = 0;
  let connected = 0;
  for (const c of battles) {
    const room = matchMaker.getLocalRoomById(c.roomId);
    const sum = room instanceof BattleRoom ? room.summary() : null;
    if (!sum) continue;
    for (const seat of Object.values(sum.seats)) { players += 1; if (seat.connected) connected += 1; }
  }
  return {
    service: 'battle', instance: `${hostname()}:${process.pid}`, startedAt, at,
    env: process.env['SAMCHESS_ENV'] || 'development', node: process.version,
    memory: { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal },
    eventLoop: lastMinute ?? fold(),
    traffic: trafficWindow(traffic, at),
    battle: { rooms: battles.length, players, connected, ...size },
  };
}
