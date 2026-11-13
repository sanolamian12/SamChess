/**
 * 이 프로세스의 상태 · 트래픽 (2026-11-13, 관리자 「시스템」) — 게임 API와 관리자 API가 함께 쓴다.
 *
 *  - `attachTraffic(app)` — 응답마다 경로 틀 · 상태 · 걸린 시간을 1분 칸에 쌓는다(meta `recordRequest`, 메모리에만).
 *  - `processHealth(service)` — 메모리 · 이벤트 루프 지연 · DB 풀 · 트래픽 창을 `ProcessHealth` 모양으로.
 *  - `registerHealth(app)` — 게임 API의 `GET /internal/health`(서버 간 비밀). 관리자 API는 제 것을 직접 부른다(`admin/system.ts`).
 *
 * 대전 서버도 같은 일을 `server/src/health.ts`에서 한다 — 두 프로세스가 서로 import하지 않아서다. 모양은 meta의 `ProcessHealth`
 * 하나에 묶여 있어 한쪽만 바뀌면 타입 검사가 깨진다. 이벤트 루프를 재는 몇 줄만 두 벌이다.
 */
import { hostname } from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { NO_ROUTE, createTraffic, recordRequest, trafficWindow } from '@samchess/meta';
import type { ProcessHealth, ServiceId } from '@samchess/meta';
import { pool } from './db.ts';
import { verifyInternalSecret } from './internalAuth.ts';

const startedAt = Date.now();
const traffic = createTraffic();

/**
 * 셈에서 빼는 요청 — 관리자 화면이 10초마다 묻는 상태 확인 자신과 브라우저의 프리플라이트(`OPTIONS`).
 * 넣으면 아무도 안 쓰는 서버에도 「분당 6건」이 늘 찍혀 조용한 때가 안 보인다.
 */
const SKIP = new Set(['GET /internal/health', 'GET /admin/system/status', 'GET /admin/system/traffic']);

export function attachTraffic(app: FastifyInstance): void {
  app.addHook('onResponse', (req, reply, done) => {
    if (req.method !== 'OPTIONS') {
      // 경로 틀이 없는 요청(없는 경로)은 한 이름으로 — 실제 URL을 넣으면 마구 두드리는 것만으로 줄이 끝없이 는다
      const route = req.routeOptions.url ? `${req.method} ${req.routeOptions.url}` : NO_ROUTE;
      if (!SKIP.has(route)) recordRequest(traffic, Date.now(), route, reply.statusCode, reply.elapsedTime);
    }
    done();
  });
}

// ── 이벤트 루프 지연 — 1분마다 접어 둔다(첫 1분은 켜진 뒤부터의 값) ──
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

export function processHealth(service: ServiceId): ProcessHealth {
  const now = Date.now();
  const m = process.memoryUsage();
  return {
    service, instance: `${hostname()}:${process.pid}`, startedAt, at: now,
    env: process.env['SAMCHESS_ENV'] || 'development', node: process.version,
    memory: { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal },
    eventLoop: lastMinute ?? fold(),
    traffic: trafficWindow(traffic, now),
    // `max`는 pg 풀의 기본값(10) — 따로 안 정했다. 기다리는 요청(`waiting`)이 늘면 풀이 모자란 것이다
    db: { max: (pool.options as { max?: number }).max ?? 10, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
  };
}

/** 게임 API의 `GET /internal/health` — 관리자 API만 부른다(서버 간 비밀) */
export function registerHealth(app: FastifyInstance): void {
  app.get('/internal/health', async (req, reply) => {
    if (!verifyInternalSecret(req.headers['x-internal-secret'] as string | undefined)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return processHealth('game-api');
  });
}
