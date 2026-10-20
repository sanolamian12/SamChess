/**
 * 정지 안내 회귀 (`src/meta/ban.ts`, 2026-10-20).
 *
 * 여기서 고정하는 것.
 *  - **403 `account_banned`만 정지다** — 다른 403(관리자 아님 등) · 401은 지나간다(부르는 쪽의 원래 처리로)
 *  - 기간 줄은 풀리는 시각 · 영구(관리자 화면의 「영구」 = 100년) · 모름 셋
 *  - 먼저 온 「정지」(기간 없음)를 나중에 온 기간 · 사유가 채운다 — 대기열이 먼저 막고 계정 API가 뒤따르는 순서
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { banFromResponse, banTerm, clearBan, onBan, reportBan } from '../src/meta/ban.ts';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('403 account_banned는 정지 — 기간 · 사유를 싣는다', async () => {
  const n = await banFromResponse(json(403, { error: 'account_banned', until: '2026-10-27T03:00:00.000Z', reason: '욕설' }));
  assert.deepEqual(n, { until: '2026-10-27T03:00:00.000Z', reason: '욕설' });
  assert.deepEqual(await banFromResponse(json(403, { error: 'account_banned', until: null, reason: null })), { until: null, reason: null });
});

test('다른 거절은 정지가 아니다', async () => {
  assert.equal(await banFromResponse(json(403, { error: 'not_admin' })), null);
  assert.equal(await banFromResponse(json(401, { error: 'account_banned' })), null);
  assert.equal(await banFromResponse(new Response('<html>', { status: 403 })), null);
  assert.equal(await banFromResponse(json(200, { error: 'account_banned' })), null);
});

test('기간 줄 — 풀리는 시각 · 영구 · 모름', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const until = banTerm({ until: '2026-10-27T03:00:00Z', reason: null }, now);
  assert.equal(until.kind, 'until');
  if (until.kind === 'until') assert.match(until.at, /^2026\.10\.2[67] \d\d:\d\d$/); // 시각대에 따라 날짜가 하루 갈린다
  const hundred = new Date(now + 100 * 365 * 24 * 3600_000).toISOString();
  assert.deepEqual(banTerm({ until: hundred, reason: null }, now), { kind: 'forever' });
  assert.deepEqual(banTerm({ until: null, reason: null }, now), { kind: 'unknown' });
  assert.deepEqual(banTerm({ until: 'garbage', reason: null }, now), { kind: 'unknown' });
});

test('먼저 온 「정지」를 나중에 온 기간 · 사유가 채우고, 빈 값이 있던 값을 지우지 않는다', () => {
  clearBan();
  const seen: unknown[] = [];
  const off = onBan((n) => seen.push(n));
  reportBan({ until: null, reason: null });
  reportBan({ until: '2026-10-27T03:00:00Z', reason: '욕설' });
  reportBan({ until: null, reason: null });
  off();
  assert.deepEqual(seen.at(-1), { until: '2026-10-27T03:00:00Z', reason: '욕설' });
  // 구독보다 먼저 온 정지도 듣는다
  let late: unknown = null;
  onBan((n) => { late = n; })();
  assert.deepEqual(late, { until: '2026-10-27T03:00:00Z', reason: '욕설' });
  clearBan();
});
