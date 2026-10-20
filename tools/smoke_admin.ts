/**
 * 관리자 API 스모크 — **진짜 Supabase Auth · 진짜 Postgres**로 권한 · 검색 · 조회 · 조정 · 감사 로그 한 바퀴.
 *
 *   npm run smoke:admin
 *
 * `smoke_account.ts`와 같은 이유로 진짜 계정을 쓴다 — `verifyAdmin()`이 보는 `app_metadata`는
 * Admin API로 정한 진짜 값이라야 시험이 된다. 계정은 셋이다: 관리자 · 대상(도시 있음) · 평범한 사용자.
 * **끝나면 계정과 그 계정에 남은 감사 로그를 지운다.**
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { academyTopics, createProfile, injuryHealsAt } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { pool } from '../packages/server-api/src/db.ts';
import { saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { registerAdminRoutes } from '../packages/server-api/src/admin/routes.ts';
import { registerRoutes } from '../packages/server-api/src/routes.ts';
import { settleOutcome } from '../packages/server-api/src/battleResult.ts';
import { verifyAccessToken } from '../packages/server/src/auth.ts';
import type { BattleOutcome } from '@samchess/meta';

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const ANON = process.env['SUPABASE_ANON_KEY']!;
const SECRET = process.env['SUPABASE_SECRET_KEY']!;
if (!SUPABASE_URL || !ANON || !SECRET) throw new Error('SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SECRET_KEY가 없다');

const ok = (msg: string): void => console.log(`✓ ${msg}`);
const adminHeaders = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' };

async function makeUser(appMeta?: object): Promise<{ uid: string; token: string; email: string }> {
  const email = `smoke-admin-${randomUUID()}@samchess.test`;
  const password = randomUUID();
  const c = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true, ...(appMeta ? { app_metadata: appMeta } : {}) }),
  });
  if (!c.ok) throw new Error(`계정 생성 실패 — ${c.status} ${await c.text()}`);
  const uid = ((await c.json()) as { id: string }).id;
  const l = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  if (!l.ok) throw new Error(`로그인 실패 — ${l.status}`);
  return { uid, email, token: ((await l.json()) as { access_token: string }).access_token };
}
const deleteUser = (uid: string): Promise<Response> =>
  fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: adminHeaders });

const app = Fastify();
registerAdminRoutes(app);
const call = async (method: 'GET' | 'POST', url: string, token?: string, payload?: object) => {
  const r = await app.inject({ method, url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), ...(payload ? { payload } : {}) });
  return { status: r.statusCode, body: r.json() as Record<string, unknown> };
};

// 정지가 게임 쪽에서 실제로 막히는지 보려고 게임 API도 띄운다
const game = Fastify();
registerRoutes(game);
const gameGet = async (url: string, token: string) => {
  const r = await game.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.json() as Record<string, unknown> };
};

const made: string[] = [];
try {
  const admin = await makeUser({ role: 'admin' });
  const target = await makeUser();
  const plain = await makeUser();
  made.push(admin.uid, target.uid, plain.uid);
  // `%` · `_`가 든 도시 이름 — 검색어의 글자 처리(likeEscape)를 진짜 값으로 잰다
  const city = `관리%_${randomUUID().slice(0, 4)}`;
  await saveProfileTrusted(target.uid, createProfile(city, 11));
  ok('시험 계정 셋 — 관리자 · 대상(도시 있음) · 평범한 사용자');

  // ── 권한 ──
  assert.equal((await call('GET', '/admin/me')).status, 401);
  assert.equal((await call('GET', '/admin/me', 'not-a-token')).status, 401);
  assert.equal((await call('GET', '/admin/me', plain.token)).status, 403);
  assert.equal((await call('GET', '/admin/users', plain.token)).status, 403);
  const me = await call('GET', '/admin/me', admin.token);
  assert.equal(me.status, 200);
  assert.equal(me.body['uid'], admin.uid);
  ok('토큰 없음 · 틀린 토큰 401, 평범한 사용자 403, 관리자 200');

  // ── 검색 ──
  const byCity = await call('GET', `/admin/users?q=${encodeURIComponent(city)}&test=1`, admin.token);
  const rows = byCity.body['rows'] as { uid: string; cityName: string; isTest: boolean }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.uid, target.uid);
  assert.equal(rows[0]!.isTest, true);
  const hidden = await call('GET', `/admin/users?q=${encodeURIComponent(city)}`, admin.token);
  assert.equal((hidden.body['rows'] as unknown[]).length, 0, '시험 계정은 기본 검색에서 빠진다');
  const byEmail = await call('GET', `/admin/users?q=${encodeURIComponent(plain.email)}&test=1`, admin.token);
  const plainRow = (byEmail.body['rows'] as { uid: string; cityName: string | null }[])[0]!;
  assert.equal(plainRow.uid, plain.uid);
  assert.equal(plainRow.cityName, null, '도시를 안 만든 계정도 보인다');
  ok('도시 이름 · 이메일로 찾는다 — 시험 계정은 ?test=1일 때만, 도시 없는 계정도 보인다');

  // ── 목록: 거르기 · 정렬 · 쪽 ──
  const list = async (qs: string) => {
    const r = await call('GET', `/admin/users?test=1&${qs}`, admin.token);
    return { status: r.status, total: r.body['total'] as number, uids: ((r.body['rows'] ?? []) as { uid: string }[]).map((x) => x.uid) };
  };
  const mine = [admin.uid, target.uid, plain.uid];
  const smokeQ = `q=${encodeURIComponent('smoke-admin-')}`;
  const all3 = await list(`${smokeQ}&limit=200`);
  assert.ok(mine.every((u) => all3.uids.includes(u)) && all3.total >= 3);
  assert.deepEqual((await list(`q=${encodeURIComponent(plain.email)}&filter=noCity`)).uids, [plain.uid], '도시 없음');
  assert.deepEqual((await list(`q=${encodeURIComponent(target.email)}&filter=noCity`)).uids, [], '도시 있으면 빠진다');
  assert.deepEqual((await list(`q=${encodeURIComponent(target.email)}&filter=dormant`)).uids, [], '방금 로그인 — 휴면 아님');
  assert.deepEqual((await list('q=%25&limit=200')).uids, [target.uid], '% 는 글자다 — 전부가 아니라 %가 든 도시 하나만');
  assert.deepEqual((await list(`q=${encodeURIComponent(city)}`)).uids, [target.uid], '% · _가 든 도시 이름을 그 글자 그대로 찾는다');
  assert.equal((await list(`q=${encodeURIComponent(city.replace('%_', '_%'))}`)).uids.length, 0, '_가 아무 글자에나 맞지 않는다');
  const page1 = await list(`${smokeQ}&sort=created&dir=asc&limit=1`);
  const page2 = await list(`${smokeQ}&sort=created&dir=asc&limit=1&offset=1`);
  assert.equal(page1.uids.length, 1);
  assert.notEqual(page1.uids[0], page2.uids[0], '다음 쪽은 다른 줄');
  assert.equal(page1.total, page2.total, '전체 수는 쪽과 상관없다');
  const beyond = await list(`${smokeQ}&limit=1&offset=100000`);
  assert.deepEqual([beyond.uids.length, beyond.total], [0, page1.total], '끝을 넘긴 쪽 — 줄은 없어도 전체 수는 그대로');
  const byGold = await list(`${smokeQ}&sort=gold&dir=desc&limit=200`);
  assert.equal(byGold.uids.at(-1) === target.uid, false, '금화 있는 계정이 도시 없는 계정보다 앞 — 값 없는 줄은 뒤로');
  for (const bad of ['sort=email', 'dir=up', 'filter=rich', 'offset=-1']) assert.equal((await list(bad)).status, 400, bad);
  ok('목록 — 거르기(도시 없음 · 휴면) · % 글자 취급 · 정렬(값 없는 줄은 뒤로) · 쪽 · 전체 수, 틀린 값 400');

  // ── 조회 ──
  const detail = await call('GET', `/admin/users/${target.uid}`, admin.token);
  assert.equal(detail.status, 200);
  const before = detail.body['profile'] as PlayerProfile;
  assert.equal(before.cityName, city);
  assert.equal((await call('GET', `/admin/users/${randomUUID()}`, admin.token)).status, 404);
  assert.equal((await call('GET', '/admin/users/abc', admin.token)).status, 400);
  ok('계정 상세 — 없는 uid 404, 모양이 틀린 uid 400');

  // ── 조정 ──
  const noReason = await call('POST', `/admin/users/${target.uid}/adjust`, admin.token, { kind: 'gold', delta: 25 });
  assert.equal(noReason.status, 400);
  const forbidden = await call('POST', `/admin/users/${target.uid}/adjust`, plain.token, { kind: 'gold', delta: 25, reason: 'x' });
  assert.equal(forbidden.status, 403);
  const granted = await call('POST', `/admin/users/${target.uid}/adjust`, admin.token, { kind: 'gold', delta: 25, reason: '스모크 지급' });
  assert.equal(granted.status, 200, JSON.stringify(granted.body));
  const stored = await pool.query<{ gold: number }>(`select (data->>'gold')::int as gold from profiles where uid = $1`, [target.uid]);
  assert.equal(stored.rows[0]!.gold, before.gold + 25);
  ok(`금화 지급 — 사유 없으면 400, 평범한 사용자 403, 관리자는 DB까지 ${before.gold} → ${before.gold + 25}`);

  const tooMuch = await call('POST', `/admin/users/${target.uid}/adjust`, admin.token, { kind: 'gold', delta: -100_000, reason: '스모크 과회수' });
  assert.equal(tooMuch.status, 400);
  assert.match(String(tooMuch.body['error']), /모자라다/);
  const item = await call('POST', `/admin/users/${target.uid}/adjust`, admin.token, { kind: 'item', item: 'tang-yak', delta: 2, reason: '스모크 아이템' });
  assert.equal(item.status, 200);
  assert.equal((item.body['profile'] as PlayerProfile).marketOwned?.['tang-yak'], 2);
  ok('가진 것보다 많이 거두면 400(이유를 말한다) · 아이템 지급');

  // ── 감사 로그 ──
  const audit = await call('GET', `/admin/audit?target=${target.uid}`, admin.token);
  const logs = audit.body['rows'] as { action: string; reason: string; adminEmail: string; before: { gold?: number }; after: { gold?: number } }[];
  assert.equal(logs.length, 2, '성공한 조정 둘만 남는다 — 거절된 것은 안 남는다');
  assert.equal(logs[1]!.action, 'adjust.gold');
  assert.equal(logs[1]!.reason, '스모크 지급');
  assert.equal(logs[1]!.adminEmail, admin.email);
  assert.equal(logs[1]!.after.gold! - logs[1]!.before.gold!, 25);
  ok('감사 로그 — 성공한 조정만, 누가 · 왜 · 전후 값');

  // ── 집계 · 게임 데이터 ──
  const stats = await call('GET', '/admin/stats', admin.token);
  assert.ok((stats.body['accounts'] as number) >= 3);
  const data = await call('GET', '/admin/gamedata', admin.token);
  assert.equal((data.body['officers'] as unknown[]).length, 260);
  ok(`집계(계정 ${stats.body['accounts']} · 시험 ${stats.body['testAccounts']}) · 게임 데이터(장수 260)`);

  // ── 정지 · 해제 ──
  assert.equal((await gameGet('/profile', target.token)).status, 200);
  assert.equal((await call('POST', `/admin/users/${target.uid}/ban`, admin.token, { days: 3 })).status, 400, '사유 없으면 400');
  assert.equal((await call('POST', `/admin/users/${target.uid}/ban`, admin.token, { days: 0, reason: 'x' })).status, 400);
  assert.equal((await call('POST', `/admin/users/${target.uid}/ban`, plain.token, { days: 3, reason: 'x' })).status, 403);
  assert.equal((await call('POST', `/admin/users/${admin.uid}/ban`, admin.token, { days: 3, reason: 'x' })).status, 400, '자기 계정은 못 건다');
  assert.equal((await call('POST', `/admin/users/${target.uid}/unban`, admin.token, { reason: 'x' })).status, 400, '정지 안 된 계정은 해제 못 한다');
  const banned = await call('POST', `/admin/users/${target.uid}/ban`, admin.token, { days: 3, reason: '스모크 정지' });
  assert.equal(banned.status, 200, JSON.stringify(banned.body));
  const until = String(banned.body['bannedUntil']);
  assert.ok(Date.parse(until) - Date.now() > 2.9 * 86_400_000, '3일 뒤까지');
  ok('정지 — 사유 · 기간 검사, 평범한 사용자 403, 자기 계정 · 정지 안 된 계정 해제는 400');

  // 정지 **전에** 받은 토큰 그대로 — Supabase가 403 user_banned로 거절하고, 게임 API는 403 account_banned로 바꿔 준다
  const blocked = await gameGet('/profile', target.token);
  assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
  assert.deepEqual(blocked.body, { error: 'account_banned', until, reason: '스모크 정지' });
  await assert.rejects(verifyAccessToken(target.token), (e: { code?: number; message?: string }) => e.code === 403 && e.message === 'account_banned');
  const settled = await settleOutcome(target.uid, {} as BattleOutcome, 1);
  assert.deepEqual(settled, { ok: false, status: 403, reason: 'account_banned' });
  assert.deepEqual((await list(`q=${encodeURIComponent(target.email)}&filter=banned`)).uids, [target.uid], '정지 거르기');
  const shown = await call('GET', `/admin/users/${target.uid}`, admin.token);
  assert.equal(shown.body['bannedUntil'], until);
  assert.equal(shown.body['banReason'], '스모크 정지');
  ok('정지 전 토큰도 바로 — 게임 API 403 account_banned(기간 · 사유) · 대전 서버 onAuth 403 · 정산 거절 · 상세에 사유');

  const unbanned = await call('POST', `/admin/users/${target.uid}/unban`, admin.token, { reason: '스모크 해제' });
  assert.equal(unbanned.status, 200, JSON.stringify(unbanned.body));
  assert.equal(unbanned.body['bannedUntil'], null);
  assert.equal((await gameGet('/profile', target.token)).status, 200, '해제하면 같은 토큰이 다시 들어온다');
  assert.deepEqual(await verifyAccessToken(target.token), { uid: target.uid });
  const after = await call('GET', `/admin/users/${target.uid}`, admin.token);
  assert.equal(after.body['bannedUntil'], null);
  assert.equal(after.body['banReason'], null);
  const banLogs = ((await call('GET', `/admin/audit?target=${target.uid}`, admin.token)).body['rows'] as
    { action: string; reason: string; params: { days?: number }; after: { bannedUntil: string | null } }[]).slice(0, 2);
  assert.deepEqual(banLogs.map((l) => [l.action, l.reason]), [['unban', '스모크 해제'], ['ban', '스모크 정지']]);
  assert.equal(banLogs[1]!.params.days, 3);
  assert.equal(banLogs[1]!.after.bannedUntil, until);
  ok('해제 — 같은 토큰이 다시 들어온다 · 감사 로그에 정지/해제 둘 다(사유 · 기간)');

  // ── 멈춘 상태 정리 ──
  const cur = (await call('GET', `/admin/users/${target.uid}`, admin.token)).body['profile'] as PlayerProfile;
  const officer = Object.keys(cur.roster)[0] as keyof PlayerProfile['roster'];
  const tactic = academyTopics(1)[0]!.id as NonNullable<PlayerProfile['academy']>['done'][number]['tactic'];
  const t0 = Date.now();
  await saveProfileTrusted(target.uid, {
    ...cur,
    roster: { ...cur.roster, [officer]: { ...cur.roster[officer]!, injuredAt: t0 - 60_000 } },
    academy: { done: [], research: { level: 1, tactic, startedAt: t0 - 60_000 } },
  });
  const injuredList = async () => ((await call('GET', `/admin/users/${target.uid}`, admin.token)).body['injuries'] as { officer: string }[]).map((x) => x.officer);
  assert.deepEqual(await injuredList(), [officer], '지금 부상인 장수 — 서버가 가른다');
  const noReasonResolve = await call('POST', `/admin/users/${target.uid}/resolve`, admin.token, { kind: 'academy' });
  assert.equal(noReasonResolve.status, 400);
  assert.equal((await call('POST', `/admin/users/${target.uid}/resolve`, admin.token, { kind: 'forge', reason: 'x' })).status, 400);
  const noRaid = await call('POST', `/admin/users/${target.uid}/resolve`, admin.token, { kind: 'raid', reason: 'x' });
  assert.equal(noRaid.status, 400);
  assert.match(String(noRaid.body['error']), /도적떼가 없다/);
  const healed = await call('POST', `/admin/users/${target.uid}/resolve`, admin.token, { kind: 'injury', officer, reason: '스모크 부상 정리' });
  assert.equal(healed.status, 200, JSON.stringify(healed.body));
  const healedInst = (healed.body['profile'] as PlayerProfile).roster[officer]!;
  assert.ok(healedInst.injuredAt !== undefined, '필드는 안 지운다');
  assert.ok(injuryHealsAt(healedInst)! <= Date.now() && injuryHealsAt(healedInst)! >= t0);
  assert.deepEqual(await injuredList(), [], '나은 뒤에는 필드가 남아도 목록에서 빠진다');
  const studied = await call('POST', `/admin/users/${target.uid}/resolve`, admin.token, { kind: 'academy', reason: '스모크 연구 정리' });
  assert.equal(studied.status, 200, JSON.stringify(studied.body));
  const stored2 = await pool.query<{ research: unknown; done: { doneAt: number }[] }>(
    `select data->'academy'->'research' as research, data->'academy'->'done' as done from profiles where uid = $1`, [target.uid]);
  assert.equal(stored2.rows[0]!.research, null);
  assert.ok(stored2.rows[0]!.done[0]!.doneAt >= t0, 'doneAt은 지금 — 시작 + 연구 시간이 아니다');
  const resolveLogs = ((await call('GET', `/admin/audit?target=${target.uid}`, admin.token)).body['rows'] as { action: string }[]).slice(0, 2);
  assert.deepEqual(resolveLogs.map((l) => l.action), ['resolve.academy', 'resolve.injury']);
  ok('멈춘 상태 정리 — 사유 · kind 검사, 없는 도적떼는 이유와 함께 400, 부상(필드 유지) · 연구(doneAt=지금) DB까지 · 감사 로그');

  // ── 감사 로그 거르기 ──
  const auditQ = async (qs: string) => {
    const r = await call('GET', `/admin/audit?target=${target.uid}&${qs}`, admin.token);
    return { status: r.status, actions: ((r.body['rows'] ?? []) as { action: string }[]).map((l) => l.action) };
  };
  assert.deepEqual((await auditQ('action=adjust')).actions, ['adjust.item', 'adjust.gold'], '묶음 — 그 아래 전부');
  assert.deepEqual((await auditQ('action=resolve.injury')).actions, ['resolve.injury'], '하나');
  assert.deepEqual((await auditQ('action=ban')).actions, ['ban'], 'ban은 unban을 끌어오지 않는다');
  assert.equal((await auditQ(`admin=${encodeURIComponent(admin.email)}`)).actions.length, 6);
  assert.equal((await auditQ(`admin=${encodeURIComponent(admin.email.slice(0, 20))}`)).actions.length, 0, '이메일 일부로는 안 잡힌다 — 정확히 같은 것만');
  assert.equal((await auditQ('admin=nobody-else')).actions.length, 0);
  assert.equal((await auditQ(`from=${new Date(Date.now() + 60_000).toISOString()}`)).actions.length, 0);
  assert.equal((await auditQ(`to=${new Date(Date.now() + 60_000).toISOString()}`)).actions.length, 6);
  assert.equal((await auditQ('action=adjust%25')).status, 400);
  assert.equal((await auditQ('from=yesterday')).status, 400);
  assert.equal((await auditQ('from=Oct%2020%202026')).status, 400, 'Date.parse는 받지만 ISO가 아닌 꼴');
  assert.equal((await auditQ('to=2026-10-21')).status, 400, '날짜만 — 시각 없는 꼴');
  const admins = await call('GET', '/admin/audit/admins', admin.token);
  assert.ok((admins.body['admins'] as string[]).includes(admin.email));
  assert.equal((await call('GET', '/admin/audit/admins', plain.token)).status, 403);
  ok('감사 로그 거르기 — 묶음 · 하나 · 관리자 · 기간, 틀린 값 400, 관리자 목록(평범한 사용자 403)');
} finally {
  for (const uid of made) {
    await pool.query('delete from admin_audit_log where target_uid = $1', [uid]);
    await deleteUser(uid);
  }
  await pool.end();
  await app.close();
  await game.close();
}
console.log('✓ 관리자 스모크 끝 — 시험 계정과 그 감사 로그를 지웠다');
