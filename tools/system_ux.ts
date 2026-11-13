/**
 * 관리자 「시스템」 눈 확인 (2026-11-13) — 진짜 트래픽을 조금 만들고 `GET /admin/system/*` 셋과 화면 탭 셋을 본다.
 *
 *   npm run look:system      (= node --env-file=.env tools/system_ux.ts [--out 폴더])
 *
 * 떠 있어야 하는 것 — 관리자 화면(5174) · 관리자 API(8788) · 게임 API(8787) · 대전 서버(2567). **새 코드로 다시 띄운 것**이어야 한다
 * (옛 프로세스는 `/internal/health`를 몰라 404 — 화면이 「새 코드로 다시 띄웠는가」를 띄운다).
 *
 * 확인하는 것.
 *  · 트래픽이 실제로 세어지는가 — 게임 API에 200 · 401 · 없는 경로를 보내고, 대기열에 붙었다 떠나 사건(`queue.join` · `queue.leave`)을 낸 뒤
 *    트래픽 창의 경로 · 칸 · 사건에 그만큼 늘었는가(앞뒤 차이로 본다 — 다른 사람이 쓰는 서버여도 된다)
 *  · 상태의 다섯 줄이 다 살아 있는가, 점검이 「고칠 것」 없이 끝나는가(있으면 무엇인지 찍고 실패)
 *  · **CS는 못 본다** — 세 경로 모두 403 `role_forbidden`, 메뉴에 「시스템」이 없다
 *  · 화면 — 탭 셋 · 대시보드 카드를 찍는다
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { Client } from 'colyseus.js';
import { chromium } from 'playwright';
import type { AdminSystemChecks, AdminSystemStatus, AdminSystemTraffic } from '../packages/server-api/src/admin/types.ts';
import { adminSession, cleanupUsers, makeAdmin, makeUser } from './adminLook.ts';

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1]! : join(tmpdir(), 'samchess-system-look');
mkdirSync(OUT, { recursive: true });
const WS = process.env['SAMCHESS_SERVER'] ?? 'ws://localhost:2567';
const GAME_API = process.env['GAME_API'] ?? 'http://localhost:8787';
const ADMIN_API = process.env['ADMIN_API'] ?? 'http://localhost:8788';
const ADMIN_WEB = process.env['ADMIN_WEB'] ?? 'http://localhost:5174';
const ok = (m: string) => console.log(`✓ ${m}`);

async function get<T>(token: string, path: string): Promise<{ status: number; body: T }> {
  const r = await fetch(`${ADMIN_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: (await r.json()) as T };
}

const routeCount = (t: AdminSystemTraffic, route: string) =>
  t.services.find((s) => s.id === 'game-api')!.window!.routes.find((r) => r.route === route);
const eventCount = (t: AdminSystemTraffic, name: string) =>
  t.services.find((s) => s.id === 'battle')!.window!.minutes.reduce((a, m) => a + (m.events[name] ?? 0), 0);

try {
  const admin = await makeAdmin('system');
  const cs = await makeAdmin('system-cs');
  const user = await makeUser('system', 'u');

  // ── 앞 ──
  const before = await get<AdminSystemTraffic>(admin.token, '/admin/system/traffic');
  assert.equal(before.status, 200, `트래픽 ${before.status} ${JSON.stringify(before.body)}`);
  for (const s of before.body.services) assert.ok(s.ok, `${s.id} — ${s.error}`);
  const p0 = routeCount(before.body, 'GET /profile');
  const n0 = routeCount(before.body, '(없는 경로)');
  const j0 = eventCount(before.body, 'queue.join');
  const l0 = eventCount(before.body, 'queue.leave');

  // ── 트래픽 만들기: 게임 API 200(계정 없음도 응답은 한다) · 401 · 없는 경로, 대기열 붙었다 떠나기 ──
  const codes: number[] = [];
  for (let i = 0; i < 3; i += 1) codes.push((await fetch(`${GAME_API}/profile`, { headers: { Authorization: `Bearer ${user.token}` } })).status);
  codes.push((await fetch(`${GAME_API}/profile`, { headers: { Authorization: 'Bearer nope' } })).status);
  codes.push((await fetch(`${GAME_API}/no-such-path-${Date.now()}`)).status);
  const client = new Client(WS);
  client.auth.token = user.token;
  const q = await client.joinOrCreate('queue', {});
  await q.leave();
  // 떠남은 서버가 소켓 닫힘을 받은 뒤에 센다 — 한 번 숨을 쉰다
  await new Promise((r) => setTimeout(r, 500));

  // ── 뒤 ──
  const after = await get<AdminSystemTraffic>(admin.token, '/admin/system/traffic');
  const p1 = routeCount(after.body, 'GET /profile')!;
  const prof = codes.slice(0, 4);
  assert.equal(p1.requests - (p0?.requests ?? 0), prof.length, `GET /profile이 ${prof.length}건 늘어야 한다 (응답 ${prof.join(',')})`);
  assert.equal(p1.client - (p0?.client ?? 0), prof.filter((c) => c >= 400 && c < 500).length, '4xx 수');
  assert.equal(routeCount(after.body, '(없는 경로)')!.requests - (n0?.requests ?? 0), 1, '없는 경로는 한 줄로 모인다');
  assert.ok(!after.body.services.find((s) => s.id === 'game-api')!.window!.routes.some((r) => r.route.includes('no-such-path')), '실제 URL로 줄을 만들지 않는다');
  assert.equal(eventCount(after.body, 'queue.join') - j0, 1, 'queue.join');
  assert.equal(eventCount(after.body, 'queue.leave') - l0, 1, 'queue.leave');
  ok(`트래픽 — GET /profile +${prof.length}(응답 ${prof.join(',')}) · 없는 경로 +1 · 대기열 입장 +1 · 나감 +1`);

  // ── 상태 · 점검 ──
  const st = await get<AdminSystemStatus>(admin.token, '/admin/system/status');
  assert.equal(st.status, 200);
  assert.deepEqual(st.body.services.map((s) => s.id), ['game-api', 'battle', 'admin-api', 'db', 'auth']);
  for (const s of st.body.services) assert.ok(s.ok, `${s.id} — ${s.error}`);
  const g = st.body.services[0]!.process!;
  assert.ok(g.db && g.eventLoop.utilization >= 0 && g.recent.minutes === 5);
  assert.ok(st.body.services[1]!.process!.battle, '대전 서버는 방 · 대기열을 싣는다');
  ok(`상태 — 다섯 줄 정상 · 게임 API 이벤트 루프 p99 ${g.eventLoop.p99}ms · 사용률 ${Math.round(g.eventLoop.utilization * 1000) / 10}% · DB ${st.body.services[3]!.latencyMs}ms`);

  const ch = await get<AdminSystemChecks>(admin.token, '/admin/system/checks');
  assert.equal(ch.status, 200);
  const fails = ch.body.checks.filter((c) => c.status === 'fail');
  assert.equal(fails.length, 0, `점검에 고칠 것 — ${fails.map((c) => `${c.title} (${c.detail})`).join(' / ')}`);
  ok(`점검 — ${ch.body.checks.length}줄 · 고칠 것 0 · 볼 것 ${ch.body.checks.filter((c) => c.status === 'warn').length} · ${ch.body.durationMs}ms`);

  // ── CS는 못 본다 ──
  await fetch(`${process.env['SUPABASE_URL']}/auth/v1/admin/users/${cs.uid}`, {
    method: 'PUT', headers: { apikey: process.env['SUPABASE_SECRET_KEY']!, Authorization: `Bearer ${process.env['SUPABASE_SECRET_KEY']}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_metadata: { role: 'cs' } }),
  });
  for (const path of ['/admin/system/status', '/admin/system/traffic', '/admin/system/checks']) {
    const r = await get<{ error: string; need: string }>(cs.token, path);
    assert.equal(r.status, 403, `CS ${path} ${r.status}`);
    assert.deepEqual([r.body.error, r.body.need], ['role_forbidden', 'system']);
  }
  ok('CS — 세 경로 모두 403 role_forbidden(system)');

  // ── 화면 ──
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await adminSession(page, admin);
    await page.goto(`${ADMIN_WEB}/#/`);
    await page.waitForSelector('[data-system-card] b:not(:text("…"))');
    await page.screenshot({ path: join(OUT, 'dashboard.png') });
    assert.equal(await page.locator('nav a', { hasText: '시스템' }).count(), 1, '관리자 메뉴에 「시스템」');
    await page.click('nav a:has-text("시스템")');
    await page.waitForSelector('table[data-system="status"] tr[data-target="auth"]');
    assert.equal(await page.locator('tr[data-ok="0"]').count(), 0, '상태 탭에 응답 없는 줄');
    await page.screenshot({ path: join(OUT, 'system-status.png'), fullPage: true });
    await page.click('[data-tab="traffic"]');
    await page.waitForSelector('table[data-system="routes"] tr[data-route="GET /profile"]');
    assert.ok(page.url().endsWith('#/system?tab=traffic'), '탭이 주소에');
    await page.screenshot({ path: join(OUT, 'system-traffic.png'), fullPage: true });
    await page.click('[data-service="battle"]');
    await page.waitForSelector('table[data-system="events"]');
    await page.screenshot({ path: join(OUT, 'system-traffic-battle.png'), fullPage: true });
    await page.click('[data-tab="checks"]');
    await page.waitForSelector('table[data-system="checks"][data-group="jobs"]', { timeout: 30_000 });
    await page.screenshot({ path: join(OUT, 'system-checks.png'), fullPage: true });
    // 새로고침해도 같은 탭
    await page.reload();
    await page.waitForSelector('table[data-system="checks"]', { timeout: 30_000 });
    ok('화면 — 대시보드 카드 · 탭 셋 · 대전 서버 사건 · 새로고침해도 같은 탭');

    // 좁은 화면
    await page.setViewportSize({ width: 400, height: 900 });
    await page.click('[data-tab="status"]');
    await page.waitForSelector('table[data-system="status"] tr[data-target="auth"]');
    await page.screenshot({ path: join(OUT, 'system-status-400.png'), fullPage: true });

    // CS 화면 — 메뉴에 없다
    const csPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await adminSession(csPage, cs);
    await csPage.goto(`${ADMIN_WEB}/#/system`);
    await csPage.waitForSelector('nav a');
    assert.equal(await csPage.locator('nav a', { hasText: '시스템' }).count(), 0, 'CS 메뉴에 「시스템」이 없다');
    assert.equal(await csPage.locator('[data-system-card]').count(), 0, 'CS 대시보드에 시스템 카드가 없다');
    ok('CS 화면 — 메뉴 · 대시보드 카드 없음(#/system으로 와도 대시보드)');
    assert.deepEqual(errors, [], `콘솔 오류 ${errors.join(' / ')}`);
    console.log(`  사진 → ${OUT}`);
  } finally {
    await browser.close();
  }
} finally {
  await cleanupUsers();
}
