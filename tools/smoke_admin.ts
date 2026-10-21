/**
 * 관리자 API 스모크 — **진짜 Supabase Auth · 진짜 Postgres**로 권한 · 검색 · 조회 · 조정 · 감사 로그 한 바퀴.
 *
 *   npm run smoke:admin
 *
 * `smoke_account.ts`와 같은 이유로 진짜 계정을 쓴다 — `verifyAdmin()`이 보는 `app_metadata`는
 * Admin API로 정한 진짜 값이라야 시험이 된다. 계정은 넷이다: 관리자 · 대상(도시 있음) · 평범한 사용자 · CS(2026-10-21c).
 * **끝나면 계정과 그 계정에 남은 감사 로그를 지운다.**
 */
import { strict as assert } from 'node:assert';
import { createHmac, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { MAIL_TTL_MS, academyTopics, applyAdjustment, createProfile, injuryHealsAt } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { pool } from '../packages/server-api/src/db.ts';
import { saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { registerAdminRoutes } from '../packages/server-api/src/admin/routes.ts';
import { mutateWithAudit, sendMail as storeSendMail } from '../packages/server-api/src/admin/store.ts';
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

/** RFC 6238 TOTP(SHA-1 · 6자리 · 30초) — 인증 앱이 하는 계산. 시크릿은 base32 */
function totp(secret: string, at = Date.now()): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/=+$/, '').toUpperCase()].map((c) => A.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** 관리자 화면이 하는 그대로 — TOTP 등록 → challenge → verify. aal2 토큰과 factor id를 돌려준다 */
async function enrollTotp(aal1Token: string): Promise<{ token: string; factorId: string }> {
  const h = { apikey: ANON, Authorization: `Bearer ${aal1Token}`, 'Content-Type': 'application/json' };
  const en = await fetch(`${SUPABASE_URL}/auth/v1/factors`, { method: 'POST', headers: h, body: JSON.stringify({ factor_type: 'totp', friendly_name: 'smoke' }) });
  if (!en.ok) throw new Error(`TOTP 등록 실패 — ${en.status} ${await en.text()}`);
  const { id, totp: { secret } } = (await en.json()) as { id: string; totp: { secret: string } };
  const ch = await fetch(`${SUPABASE_URL}/auth/v1/factors/${id}/challenge`, { method: 'POST', headers: h, body: '{}' });
  const challengeId = ((await ch.json()) as { id: string }).id;
  const v = await fetch(`${SUPABASE_URL}/auth/v1/factors/${id}/verify`, { method: 'POST', headers: h, body: JSON.stringify({ challenge_id: challengeId, code: totp(secret) }) });
  if (!v.ok) throw new Error(`TOTP 인증 실패 — ${v.status} ${await v.text()}`);
  return { token: ((await v.json()) as { access_token: string }).access_token, factorId: id };
}

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
const gamePost = async (url: string, token: string) => {
  const r = await game.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: {} });
  return { status: r.statusCode, body: r.json() as Record<string, unknown> };
};

const made: string[] = [];
const sentMail: number[] = [];
try {
  const adminAal1 = await makeUser({ role: 'admin' });
  const target = await makeUser();
  const plain = await makeUser();
  made.push(adminAal1.uid, target.uid, plain.uid);
  // 관리자 API는 MFA를 지난 세션만 — 아래 시험은 전부 aal2 토큰으로 한다
  const adminMfa = await enrollTotp(adminAal1.token);
  const admin = { ...adminAal1, token: adminMfa.token };
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

  // ── MFA ── 역할을 먼저 본다(평범한 사용자는 forbidden), 관리자라도 비밀번호만이면 mfa_required
  assert.equal((await call('GET', '/admin/me', plain.token)).body['error'], 'forbidden');
  const aal1 = await call('GET', '/admin/me', adminAal1.token);
  assert.deepEqual([aal1.status, aal1.body['error']], [403, 'mfa_required'], 'factor는 있어도 이 토큰은 비밀번호만(aal1)');
  ok('MFA — 비밀번호만 지난 관리자 세션(aal1)은 403 mfa_required, 평범한 사용자는 그대로 forbidden');

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

  const trend = await call('GET', '/admin/stats/trend', admin.token);
  assert.equal(trend.status, 200, JSON.stringify(trend.body));
  const tdays = trend.body['days'] as { day: string; battles: number; ai: number; online: number }[];
  assert.equal(tdays.length, 30, '기본 30일, 빈 날도 0으로');
  const kstToday = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  assert.equal(tdays.at(-1)!.day, kstToday, '마지막 날은 오늘(KST)');
  assert.ok(tdays.every((d) => d.ai + d.online <= d.battles));
  assert.deepEqual(Object.keys(trend.body['lastSignIn'] as object).sort(), ['month', 'never', 'older', 'today', 'week']);
  assert.equal(((await call('GET', '/admin/stats/trend?days=7', admin.token)).body['days'] as unknown[]).length, 7);
  for (const bad of ['3', '91', 'x']) assert.equal((await call('GET', `/admin/stats/trend?days=${bad}`, admin.token)).status, 400, bad);
  assert.equal((await call('GET', '/admin/stats/trend', plain.token)).status, 403);
  ok(`추이 — 30일(오늘 ${kstToday} KST까지) · 7일, 기간 밖 400, 평범한 사용자 403`);

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

  // ── 우편 ── 보내기 → 게임 API에 보인다 → 받기 → 받은 수 → 회수(이미 받은 것은 그대로) · 감사 로그
  const draft = { targetUid: target.uid, title: { ko: '스모크 보상', en: 'Smoke reward' }, body: { ko: '스모크 본문' }, rewards: [{ kind: 'gold', delta: 30 }] };
  const sendMail = (token: string, payload: object) => call('POST', '/admin/mail', token, payload);
  assert.equal((await sendMail(admin.token, draft)).status, 400, '사유 없으면 400');
  const noKo = await sendMail(admin.token, { ...draft, title: { en: 'x' }, reason: 'x' });
  assert.equal(noKo.status, 400);
  assert.match(noKo.body['error'] as string, /한국어/, 'parseMailDraft의 말을 그대로');
  const dup = await sendMail(admin.token, { ...draft, rewards: [{ kind: 'gold', delta: 1 }, { kind: 'gold', delta: 1 }], reason: 'x' });
  assert.equal(dup.status, 400, '같은 보상 두 줄');
  assert.equal((await sendMail(admin.token, { ...draft, rewards: [{ kind: 'gold', delta: -5 }], reason: 'x' })).status, 400, '음수');
  assert.equal((await sendMail(plain.token, { ...draft, reason: 'x' })).status, 403);
  assert.equal((await sendMail(admin.token, { ...draft, targetUid: randomUUID(), reason: 'x' })).status, 404, '없는 계정');

  const sent = await sendMail(admin.token, { ...draft, reason: '스모크 우편' });
  assert.equal(sent.status, 200);
  const m1 = sent.body['mail'] as { id: number; sentAt: number; expiresAt: number; sentBy: string; targetEmail: string; readCount: number; claimedCount: number };
  sentMail.push(m1.id);
  assert.equal(m1.expiresAt - m1.sentAt, MAIL_TTL_MS, '기한 = 보낸 시각 + 30일');
  assert.deepEqual([m1.sentBy, m1.targetEmail, m1.readCount, m1.claimedCount], [admin.email, target.email, 0, 0]);
  const mailIds = async (token: string) => ((await gameGet('/mail', token)).body['mails'] as { id: number }[]).map((m) => m.id);
  assert.ok((await mailIds(target.token)).includes(m1.id), '받는 사람의 게임 우편함에 보인다');
  assert.ok(!(await mailIds(plain.token)).includes(m1.id), '남에게는 안 보인다');

  const goldBefore = ((await call('GET', `/admin/users/${target.uid}`, admin.token)).body['profile'] as { gold: number }).gold;
  assert.equal((await gamePost(`/mail/${m1.id}/claim`, target.token)).status, 200, '게임 API로 받는다');
  const listed = async (qs: string) => ((await call('GET', `/admin/mail?${qs}`, admin.token)).body['rows'] as
    { id: number; readCount: number | null; claimedCount: number | null; revokedAt: number | null }[]);
  const row1 = (await listed(`target=${target.uid}`)).find((r) => r.id === m1.id)!;
  assert.deepEqual([row1.readCount, row1.claimedCount], [1, 1], '받은 수 · 읽은 수');
  ok('우편 보내기 — 사유 · 한국어 · 같은 보상 두 줄 · 음수 400, 평범한 사용자 403, 없는 계정 404, 기한 30일(DB 시각), 게임에서 받으면 관리자 목록에 받은 수');

  // 전체 공지(보상 없음) — 실계정에게도 잠시 보이므로 곧바로 회수하고 끝에 지운다
  const audience = (await call('GET', '/admin/mail/audience', admin.token)).body as { accounts: number; testAccounts: number };
  assert.ok(audience.testAccounts >= 3 && audience.accounts >= 0);
  const all = await sendMail(admin.token, { targetUid: null, title: { ko: '스모크 공지' }, body: { ko: '곧 회수한다' }, rewards: [], reason: '스모크 공지' });
  assert.equal(all.status, 200);
  const m2 = (all.body['mail'] as { id: number; targetUid: string | null }); sentMail.push(m2.id);
  assert.equal(m2.targetUid, null);
  assert.ok((await mailIds(plain.token)).includes(m2.id), '전체 우편은 보낸 시각 전에 가입한 계정에게 보인다');
  assert.equal((await call('POST', `/admin/mail/${m2.id}/revoke`, admin.token, {})).status, 400, '회수도 사유 필수');
  assert.equal((await call('POST', `/admin/mail/${m2.id}/revoke`, plain.token, { reason: 'x' })).status, 403);
  const revoked = await call('POST', `/admin/mail/${m2.id}/revoke`, admin.token, { reason: '스모크 회수' });
  assert.equal(revoked.status, 200);
  assert.ok((revoked.body['mail'] as { revokedAt: number | null }).revokedAt);
  assert.ok(!(await mailIds(plain.token)).includes(m2.id), '회수하면 게임 우편함에서 빠진다');
  assert.equal((await call('POST', `/admin/mail/${m2.id}/revoke`, admin.token, { reason: 'x' })).status, 400, '두 번 회수');
  assert.equal((await call('POST', '/admin/mail/999999999/revoke', admin.token, { reason: 'x' })).status, 404);
  assert.equal((await call('GET', '/admin/mail/audience', plain.token)).status, 403);

  // 받은 우편을 회수해도 받은 보상은 그대로
  assert.equal((await call('POST', `/admin/mail/${m1.id}/revoke`, admin.token, { reason: '스모크 회수 — 받은 뒤' })).status, 200);
  const goldAfter = ((await call('GET', `/admin/users/${target.uid}`, admin.token)).body['profile'] as { gold: number }).gold;
  assert.equal(goldAfter, goldBefore + 30, '회수는 받은 보상을 거두지 않는다');
  assert.equal((await gamePost(`/mail/${m1.id}/claim`, target.token)).status, 404, '회수된 우편은 못 받는다');
  const revokedRows = (await listed('status=revoked&limit=200')).map((r) => r.id);
  assert.ok(revokedRows.includes(m1.id) && revokedRows.includes(m2.id));
  assert.ok(!(await listed('status=live&limit=200')).some((r) => r.id === m1.id || r.id === m2.id));
  assert.equal((await call('GET', '/admin/mail?status=gone', admin.token)).status, 400);
  const mailAudit = (await call('GET', `/admin/audit?action=mail&admin=${encodeURIComponent(admin.email)}`, admin.token)).body['rows'] as
    { action: string; targetUid: string | null; params: { mailId: number } }[];
  assert.deepEqual(mailAudit.map((l) => [l.action, l.params.mailId]),
    [['mail.revoke', m1.id], ['mail.revoke', m2.id], ['mail.send', m2.id], ['mail.send', m1.id]], '성공한 보내기 · 회수만, 최신부터');
  assert.equal(mailAudit.find((l) => l.params.mailId === m2.id)!.targetUid, null, '전체 우편의 감사 로그는 대상 없음');
  ok('전체 공지 · 받을 수 있는 계정 수 · 회수(사유 필수, 두 번 400, 게임 우편함에서 빠짐, 받은 보상은 그대로) · 상태 거르기 · 감사 로그 mail.*');

  // ── 역할 나누기 — CS (2026-10-21c) ── 막히는 경로를 CS 토큰으로 실제로 부른다 · 상한 · 하루 합계(지급 + 우편, 동시에) · 역할 바꾸기
  const csAal1 = await makeUser({ role: 'cs' });
  made.push(csAal1.uid);
  const csAal1Me = await call('GET', '/admin/me', csAal1.token);
  assert.deepEqual([csAal1Me.status, csAal1Me.body['error']], [403, 'mfa_required'], 'CS도 MFA');
  const cs = { ...csAal1, token: (await enrollTotp(csAal1.token)).token };
  const csMe = await call('GET', '/admin/me', cs.token);
  assert.equal(csMe.status, 200, JSON.stringify(csMe.body));
  assert.equal(csMe.body['role'], 'cs');
  assert.deepEqual((csMe.body['permissions'] as string[]).sort(), ['ban', 'grant', 'mail.one', 'resolve', 'view']);
  const quota = csMe.body['cs'] as { once: { gold: number }; daily: { gold: number }; used: { gold: number }; banDaysMax: number };
  assert.deepEqual([quota.once.gold, quota.daily.gold, quota.used.gold, quota.banDaysMax], [10_000, 50_000, 0, 7]);
  const adminMe = await call('GET', '/admin/me', admin.token);
  assert.deepEqual([adminMe.body['role'], adminMe.body['cs']], ['admin', null]);
  for (const url of ['/admin/stats', '/admin/stats/trend', '/admin/users?test=1', `/admin/users/${target.uid}`, '/admin/audit',
    '/admin/audit/admins', '/admin/mail', '/admin/mail/audience', '/admin/gamedata']) {
    assert.equal((await call('GET', url, cs.token)).status, 200, url);
  }
  ok('CS — aal1은 mfa_required, /admin/me에 역할 · 권한 · 상한(금화 한 번 10,000 · 하루 50,000), 보기 경로 전부 200');

  const csPost = (url: string, payload: object) => call('POST', url, cs.token, payload);
  const goldNow = async () => (await pool.query<{ gold: number }>(`select (data->>'gold')::int as gold from profiles where uid = $1`, [target.uid])).rows[0]!.gold;
  const gold0 = await goldNow();
  const roleForbidden = async (url: string, payload: object, need: string) => {
    const r = await csPost(url, payload);
    assert.deepEqual([r.status, r.body['error'], r.body['need']], [403, 'role_forbidden', need], `${url} ${JSON.stringify(payload)}`);
    assert.equal(typeof r.body['message'], 'string');
  };
  const csMail = (rewards: object[]) => ({ targetUid: target.uid, title: { ko: 'CS 스모크' }, body: { ko: 'CS 보상' }, rewards, reason: 'CS 스모크 우편' });
  await roleForbidden(`/admin/users/${target.uid}/adjust`, { kind: 'gold', delta: -1, reason: 'CS 회수' }, 'revoke');
  await roleForbidden(`/admin/users/${target.uid}/adjust`, { kind: 'equipmentRevoke', key: 'x#1', reason: 'CS 회수' }, 'revoke');
  await roleForbidden('/admin/mail', { ...csMail([]), targetUid: null }, 'mail.all');
  await roleForbidden(`/admin/mail/${m1.id}/revoke`, { reason: 'CS 우편 회수' }, 'mail.revoke');
  await roleForbidden(`/admin/users/${target.uid}/unban`, { reason: 'CS 해제' }, 'unban');
  await roleForbidden(`/admin/users/${target.uid}/ban`, { days: 36_500, reason: 'CS 영구 정지' }, 'ban.long');
  await roleForbidden(`/admin/users/${target.uid}/ban`, { days: 8, reason: 'CS 8일 정지' }, 'ban.long');
  assert.equal(await goldNow(), gold0, '막힌 요청은 아무것도 안 바꾼다');
  assert.equal((await gameGet('/profile', target.token)).status, 200, '막힌 정지는 걸리지 않았다');
  assert.equal((await csPost(`/admin/users/${admin.uid}/ban`, { days: 3, reason: 'x' })).status, 400, '관리자 계정은 CS도 못 건다');
  const csBan = await csPost(`/admin/users/${target.uid}/ban`, { days: 7, reason: 'CS 7일 정지' });
  assert.equal(csBan.status, 200, JSON.stringify(csBan.body));
  assert.equal((await gameGet('/profile', target.token)).status, 403);
  assert.equal((await csPost(`/admin/users/${target.uid}/ban`, { days: 7, reason: 'CS 같은 길이로 다시' })).status, 200, '늘리는(같은 길이) 정지는 된다');
  assert.equal((await call('POST', `/admin/users/${target.uid}/unban`, admin.token, { reason: 'CS 정지 해제(관리자)' })).status, 200);
  // 관리자가 30일을 건 뒤 CS가 1일로 덮어쓰면 사실상 해제다 — unban 권한을 요구한다(본체 검토)
  const banned30 = await call('POST', `/admin/users/${target.uid}/ban`, admin.token, { days: 30, reason: '관리자 30일 정지' });
  assert.equal(banned30.status, 200);
  await roleForbidden(`/admin/users/${target.uid}/ban`, { days: 1, reason: 'CS 1일로 줄이기' }, 'unban');
  assert.equal((await call('GET', `/admin/users/${target.uid}`, admin.token)).body['bannedUntil'], banned30.body['bannedUntil'], '끝나는 시각은 그대로');
  assert.equal((await call('POST', `/admin/users/${target.uid}/ban`, admin.token, { days: 1, reason: '관리자는 줄일 수 있다' })).status, 200);
  assert.equal((await call('POST', `/admin/users/${target.uid}/unban`, admin.token, { reason: '정리' })).status, 200);
  ok('CS — 회수 · 병기 회수 · 전체 우편 · 우편 회수 · 해제 · 영구 · 8일 정지는 403 role_forbidden(아무것도 안 바뀜), 7일 정지는 걸린다, 관리자의 30일을 1일로 줄이면 403(need: unban), 관리자는 줄인다');

  const csLimit = (r: { status: number; body: Record<string, unknown> }, scope: string, kind: string) => {
    assert.deepEqual([r.status, r.body['error'], r.body['scope'], r.body['kind']], [403, 'cs_limit', scope, kind], JSON.stringify(r.body));
    assert.equal(typeof r.body['message'], 'string');
  };
  csLimit(await csPost(`/admin/users/${target.uid}/adjust`, { kind: 'gold', delta: 10_001, reason: 'CS 상한 + 1' }), 'once', 'gold');
  csLimit(await csPost('/admin/mail', csMail([{ kind: 'gold', delta: 10_001 }])), 'once', 'gold');
  csLimit(await csPost('/admin/mail', csMail([{ kind: 'cards', officer: 'gwan-u', delta: 6 }, { kind: 'cards', officer: 'jang-bi', delta: 5 }])), 'once', 'cards');
  assert.equal(await goldNow(), gold0);
  ok('CS 한 번 상한 + 1 — 지급 · 우편 둘 다 403 cs_limit(once), 장수를 나눈 카드 줄도 합쳐서');

  for (let i = 0; i < 3; i += 1) {
    const g = await csPost(`/admin/users/${target.uid}/adjust`, { kind: 'gold', delta: 10_000, reason: `CS 지급 ${i + 1}` });
    assert.equal(g.status, 200, JSON.stringify(g.body));
  }
  const csSent = await csPost('/admin/mail', csMail([{ kind: 'gold', delta: 10_000 }]));
  assert.equal(csSent.status, 200, JSON.stringify(csSent.body));
  sentMail.push((csSent.body['mail'] as { id: number }).id);
  assert.equal(((await call('GET', '/admin/me', cs.token)).body['cs'] as { used: { gold: number } }).used.gold, 40_000, '지급 30,000 + 우편 10,000');
  // 남은 10,000을 지급 셋 · 우편 셋이 **동시에** 노린다 — 하나만 통과해야 한다(잠근 채 센다). 지급은 계정 행을 잡지만 우편은 안 잡으므로
  // 행 잠금으로는 줄 서지 않는다. **라우트를 거치지 않고 store를 바로 부른다** — 라우트는 요청마다 Supabase 인증 왕복이 먼저라
  // DB에 닿는 시각이 흩어져, 잠금을 빼도 경합이 안 나 통과했다(2026-10-21c 실측). 여기서는 잠금을 빼면 여럿이 통과한다
  const csUser = { uid: cs.uid, email: cs.email, role: 'cs' as const };
  const g10k = { kind: 'gold' as const, delta: 10_000 };
  // 연결을 미리 열어 둔다 — 쉬는 연결이 하나뿐이면 나머지가 새 연결을 여는 동안 첫 트랜잭션이 끝나 버려 역시 경합이 안 난다
  await Promise.all(Array.from({ length: 8 }, () => pool.connect())).then((cs) => cs.forEach((c) => c.release()));
  const race = await Promise.all([0, 1, 2].flatMap((i) => [
    mutateWithAudit(target.uid, csUser, { action: 'adjust.gold', params: g10k, reason: `CS 동시 지급 ${i}`, grants: [g10k] },
      (p, now) => applyAdjustment(p, g10k, now)).then((r) => ({ r, via: 'adjust' })),
    storeSendMail(csUser, { targetUid: target.uid, title: { ko: 'CS 동시' }, body: { ko: 'CS 동시' }, rewards: [g10k] }, `CS 동시 우편 ${i}`)
      .then((r) => ({ r, via: 'mail' })),
  ]));
  for (const x of race) if (x.r.ok && 'mail' in x.r) sentMail.push(x.r.mail.id); // 단언보다 먼저 — 실패해도 끝에 지운다
  const winners = race.filter((x) => x.r.ok);
  assert.equal(winners.length, 1, `동시 여섯 중 하나만 — ${JSON.stringify(race.map((x) => [x.via, x.r.ok]))}`);
  for (const x of race.filter((y) => !y.r.ok)) {
    const r = x.r as { ok: false; status: number; reason: string; detail?: Record<string, unknown> };
    assert.deepEqual([r.status, r.reason, r.detail?.['scope'], r.detail?.['used'], r.detail?.['limit']], [403, 'cs_limit', 'daily', 50_000, 50_000],
      '진 쪽은 이긴 쪽까지 센 오늘 양을 본다');
  }
  const raceAdjWon = winners[0]!.via === 'adjust';
  csLimit(await csPost(`/admin/users/${target.uid}/adjust`, { kind: 'gold', delta: 1, reason: 'CS 하루 + 1' }), 'daily', 'gold');
  csLimit(await csPost('/admin/mail', csMail([{ kind: 'gold', delta: 1 }])), 'daily', 'gold');
  assert.equal((await csPost(`/admin/users/${target.uid}/adjust`, { kind: 'materials', delta: 1_000, reason: 'CS 자재' })).status, 200, '다른 종류는 따로');
  assert.equal(await goldNow(), gold0 + 30_000 + (raceAdjWon ? 10_000 : 0), '지급으로 들어간 금화만 계정에');
  ok('CS 하루 합계 — 지급 30,000 + 우편 10,000 뒤 동시 여섯(지급 셋 · 우편 셋)은 하나만 통과, 그 뒤 지급 · 우편 +1 둘 다 cs_limit(daily), 자재는 따로');

  const csAudit = (await call('GET', `/admin/audit?role=cs&admin=${encodeURIComponent(cs.email)}&limit=200`, admin.token)).body['rows'] as
    { action: string; adminRole: string }[];
  const tally: Record<string, number> = {};
  for (const l of csAudit) tally[l.action] = (tally[l.action] ?? 0) + 1;
  assert.deepEqual(tally, {
    'adjust.gold': 3 + (raceAdjWon ? 1 : 0), 'mail.send': 1 + (raceAdjWon ? 0 : 1), 'adjust.materials': 1, ban: 2,
  }, '성공한 것만 — 막힌 요청은 로그가 없다');
  assert.ok(csAudit.every((l) => l.adminRole === 'cs'));
  assert.equal(((await call('GET', `/admin/audit?role=admin&admin=${encodeURIComponent(cs.email)}`, admin.token)).body['rows'] as unknown[]).length, 0);
  assert.equal(((await call('GET', `/admin/audit?target=${target.uid}&role=admin&limit=1`, admin.token)).body['rows'] as { adminRole: string }[])[0]!.adminRole, 'admin');
  assert.equal((await call('GET', '/admin/audit?role=root', admin.token)).status, 400);
  const dbRole = await pool.query<{ n: string }>(`select count(*) as n from admin_audit_log where admin_uid = $1 and admin_role <> 'cs'`, [cs.uid]);
  assert.equal(Number(dbRole.rows[0]!.n), 0, 'DB의 admin_role도 cs');
  ok(`감사 로그 — CS가 한 ${csAudit.length}줄 전부 admin_role = cs, ?role= 거르기, 틀린 역할 400`);

  // 역할을 cs → admin으로 — 다음 요청부터 바로 관리자로 판정한다(서버가 매 요청 app_metadata를 다시 읽는다)
  const promote = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${cs.uid}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ app_metadata: { role: 'admin' } }) });
  assert.ok(promote.ok);
  const promoted = await call('GET', '/admin/me', cs.token);
  assert.deepEqual([promoted.body['role'], promoted.body['cs']], ['admin', null]);
  assert.equal((await csPost(`/admin/users/${target.uid}/adjust`, { kind: 'gold', delta: -1, reason: '역할 바꾼 뒤 회수' })).status, 200);
  assert.equal((await csPost(`/admin/users/${target.uid}/adjust`, { kind: 'gold', delta: 20_000, reason: '역할 바꾼 뒤 큰 지급' })).status, 200, '상한도 풀린다');
  ok('역할을 cs → admin으로 바꾸면 같은 토큰의 다음 요청부터 회수 · 큰 지급이 된다');

  // ── MFA를 지우면(admin:role --reset-mfa와 같은 Admin API) 이미 받은 aal2 토큰도 바로 막힌다 ── (맨 끝 — 이 뒤로 admin 토큰을 안 쓴다)
  const reset = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${admin.uid}/factors/${adminMfa.factorId}`, { method: 'DELETE', headers: adminHeaders });
  assert.ok(reset.ok);
  const afterReset = await call('GET', '/admin/me', admin.token);
  assert.deepEqual([afterReset.status, afterReset.body['error']], [403, 'mfa_required'], '토큰의 aal2는 만료까지 남지만 factor가 없다');
  ok('MFA를 지우면 그 관리자가 들고 있던 aal2 토큰도 403 mfa_required');
} finally {
  // 우편과 그 감사 로그 — 전체 우편의 로그는 대상(target_uid)이 없어 아래 계정 지우기로는 안 걷힌다
  if (sentMail.length > 0) {
    await pool.query(`delete from admin_audit_log where action like 'mail.%' and (params->>'mailId')::bigint = any($1::bigint[])`, [sentMail]);
    await pool.query('delete from mail where id = any($1::bigint[])', [sentMail]);
  }
  for (const uid of made) {
    await pool.query('delete from admin_audit_log where target_uid = $1', [uid]);
    await deleteUser(uid);
  }
  await pool.end();
  await app.close();
  await game.close();
}
console.log('✓ 관리자 스모크 끝 — 시험 계정 · 시험 우편과 그 감사 로그를 지웠다');
