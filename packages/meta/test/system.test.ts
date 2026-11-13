/**
 * 시스템 트래픽 집계 (2026-11-13, 관리자 「시스템」 — `meta/src/system.ts`).
 *
 * 여기서 고정하는 것.
 *  - **창은 언제나 60칸이고 빈 분도 0으로 채운다** — 그래프의 가로축이 시각과 맞아야 「조용했다」와 「안 셌다」가 갈린다
 *  - **60분이 지난 칸은 버린다** — 메모리가 끝없이 늘지 않는다
 *  - **시계가 뒤로 가도 칸 순서가 안 뒤집힌다** — 마지막 칸에 더한다
 *  - 4xx · 5xx를 가른다, 경로별 합은 창 전체, p95는 칸의 위 끝(조금 크게 틀린다)
 *  - 최근 n분 합의 p95는 분마다의 가장 나쁜 값
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LATENCY_BOUNDS, TRAFFIC_MINUTES, createTraffic, p95Of, recordEvent, recordRequest, trafficRecent, trafficWindow,
} from '../src/system.ts';

const T0 = Date.UTC(2026, 10, 13, 3, 0, 0);
const MIN = 60_000;

test('창은 60칸 — 빈 분도 0으로, 오래된 것부터', () => {
  const s = createTraffic();
  recordRequest(s, T0 + 5_000, 'GET /profile', 200, 12);
  const w = trafficWindow(s, T0 + 3 * MIN + 1);
  assert.equal(w.minutes.length, TRAFFIC_MINUTES);
  assert.equal(w.minutes.at(-1)!.at, T0 + 3 * MIN);
  assert.equal(w.minutes.at(-4)!.at, T0);
  assert.equal(w.minutes.at(-4)!.requests, 1);
  assert.deepEqual(w.minutes.slice(-3).map((m) => m.requests), [0, 0, 0]);
  assert.ok(w.minutes.every((m, i, all) => i === 0 || m.at - all[i - 1]!.at === MIN), '칸이 1분 간격으로 빠짐없이');
});

test('60분이 지난 칸은 버린다 — 창에서도 통에서도', () => {
  const s = createTraffic();
  recordRequest(s, T0, 'GET /profile', 200, 1);
  recordRequest(s, T0 + 30 * MIN, 'GET /profile', 200, 1);
  // 59분 뒤까지는 첫 칸이 창의 맨 앞에 남는다
  assert.equal(trafficWindow(s, T0 + 59 * MIN).minutes[0]!.requests, 1);
  // 60분이 지나면 빠진다
  const w = trafficWindow(s, T0 + 60 * MIN);
  assert.equal(w.minutes.reduce((a, m) => a + m.requests, 0), 1);
  assert.equal(s.buckets.length, 1, '통에서도 지웠다');
  assert.equal(w.routes[0]!.requests, 1, '경로별 합도 창 안의 것만');
});

test('시계가 뒤로 가면 마지막 칸에 더한다 — 칸 순서가 안 뒤집힌다', () => {
  const s = createTraffic();
  recordRequest(s, T0 + 2 * MIN, 'GET /profile', 200, 1);
  recordRequest(s, T0, 'GET /profile', 200, 1);
  assert.equal(s.buckets.length, 1);
  assert.equal(s.buckets[0]!.requests, 2);
});

test('4xx · 5xx를 가르고 경로별로 모은다 — 많은 순', () => {
  const s = createTraffic();
  for (let i = 0; i < 3; i += 1) recordRequest(s, T0, 'GET /profile', 200, 10);
  recordRequest(s, T0, 'GET /profile', 401, 2);
  recordRequest(s, T0, 'POST /battle/ai-result', 500, 900);
  const w = trafficWindow(s, T0);
  const m = w.minutes.at(-1)!;
  assert.deepEqual([m.requests, m.client, m.server], [5, 1, 1]);
  assert.deepEqual(w.routes.map((r) => r.route), ['GET /profile', 'POST /battle/ai-result']);
  const p = w.routes[0]!;
  assert.deepEqual([p.requests, p.client, p.server, p.avgMs, p.maxMs], [4, 1, 0, 8, 10]);
  assert.equal(w.routes[1]!.p95, 1000, '900ms는 1000ms 칸');
});

test('p95는 칸의 위 끝 — 가장 긴 경계를 넘으면 그 경계와 넘침 표지', () => {
  // 95개가 10ms 이하, 5개가 250ms → p95는 10ms 칸
  const lat = new Array<number>(LATENCY_BOUNDS.length + 1).fill(0);
  lat[1] = 95; lat[5] = 5;
  assert.equal(p95Of(lat), 10);
  lat[1] = 94; lat[5] = 6;
  assert.equal(p95Of(lat), 250);
  assert.equal(p95Of(new Array<number>(LATENCY_BOUNDS.length + 1).fill(0)), null);
  const s = createTraffic();
  for (let i = 0; i < 10; i += 1) recordRequest(s, T0, 'GET /slow', 200, 9_000);
  const r = trafficWindow(s, T0).routes[0]!;
  assert.equal(r.p95, 5000);
  assert.equal(r.p95Over, true);
});

test('사건은 분마다 이름별로 센다', () => {
  const s = createTraffic();
  recordEvent(s, T0, 'seat.drop');
  recordEvent(s, T0 + 1, 'seat.drop');
  recordEvent(s, T0 + MIN, 'seat.back');
  const w = trafficWindow(s, T0 + MIN);
  assert.deepEqual(w.minutes.at(-2)!.events, { 'seat.drop': 2 });
  assert.deepEqual(w.minutes.at(-1)!.events, { 'seat.back': 1 });
  assert.equal(w.minutes.at(-1)!.requests, 0, '사건은 요청이 아니다');
});

test('최근 n분 합 — p95는 분마다의 가장 나쁜 값', () => {
  const s = createTraffic();
  recordRequest(s, T0, 'GET /a', 200, 5);
  recordRequest(s, T0 + MIN, 'GET /a', 503, 400);
  recordRequest(s, T0 + 9 * MIN, 'GET /a', 200, 5);
  const w = trafficWindow(s, T0 + 9 * MIN);
  assert.deepEqual(trafficRecent(w, 5), { minutes: 5, requests: 1, client: 0, server: 0, p95: 5 });
  assert.deepEqual(trafficRecent(w, 10), { minutes: 10, requests: 3, client: 0, server: 1, p95: 500 });
  assert.equal(trafficRecent(trafficWindow(createTraffic(), T0), 5).p95, null);
});
