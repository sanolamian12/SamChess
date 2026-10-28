/**
 * 선전포고 눈 확인 · 흐름 검사 (2026-10-28, GDD §8.8 단계 4) — **시험 계정 넷 · 진짜 DB · 브라우저 둘**로 걸고 · 받고 · 싸운다.
 *
 *   npm run smoke:war-ux -- [--url http://localhost:5173] [--out 폴더]
 *
 * dev 화면 · 그 화면이 부르는 server-api · 대전 서버(`npm run server`)가 **새 코드로** 떠 있어야 한다(제 안에서 띄우지 않는다).
 *
 * 계정 — 건 쪽(A, 화면) · 받는 쪽(D, 화면) · 서버 함수로만 거는 E · 거절하는 F. 넷 다 도시 Lv2.
 *  1. 서버 — 미접속 `war.offline` · 전투 중 `war.busy` · 걸면 `sent` · 또 걸면 `war.pending` · 남이 걸면 `war.engaged` ·
 *     전투 중 핑에는 안 뜬다 · 핑에 뜨면 `delivered`(응답 30초는 거기서부터) · 30초가 지나면 `expired` · 거절하면 `declined` ·
 *     거절 · 만료 뒤 같은 상대에게는 `war.cooldown`(남은 초)
 *  2. 화면(A만) — 전투 중인 D는 주황 점 · [선전포고] 꺼짐 · 누르려는 순간 D가 끊었으면 「방금 접속을 끊었다」로 상세가 공성전 모양([전투준비])
 *  3. 화면(A · D) — A가 [선전포고] → D의 화면에 팝업(수비군이 골라져 있다) → [응전] → A의 상세에 D의 부대 → [수락] →
 *     두 화면 모두 판 · 건 쪽이 남군(P1) · 서버의 선전포고는 `started` · 둘 다 참가비 −3
 *  4. 둘 다 준비 → 차례인 쪽이 항복 → 결과 · 두 계정의 이력이 대인전(상대 = 서로)
 * 끝나면(실패해도) 계정을 지운다 — 선전포고 줄은 `on delete cascade`로 함께 사라진다.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { BASIC_TUTORIALS, PRESENCE_ONLINE_MS, WAR_COOLDOWN_MS, WAR_REPLY_MS, createProfile, garrisonOf } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { declareWarAction, getWarAction, pingAction, replyWarAction } from '../packages/server-api/src/war.ts';
import { withGarrisons } from '../packages/meta/test/fixtures.ts';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const BASE = flag('url', 'http://localhost:5173');
const OUT = flag('out', join(tmpdir(), 'samchess-war-ux'));
mkdirSync(OUT, { recursive: true });

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY'];
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('✗ .env에 SUPABASE_URL · SUPABASE_SECRET_KEY가 있어야 한다');
  process.exit(1);
}

const uids: string[] = [];
let browser: Browser | null = null;
let failed = false;
const ok = (msg: string): void => console.log(`✓ ${msg}`);
class Stop extends Error {}
const fail = (msg: string): never => { failed = true; console.error(`✗ ${msg}`); throw new Stop(msg); };

async function cleanup(): Promise<void> {
  await browser?.close().catch(() => {});
  await Promise.all(uids.map((uid) => fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY!, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  })));
  await pool.end().catch(() => {});
  if (uids.length) console.log(`✓ 시험 계정 ${uids.length}개 정리`);
}

interface Acct { uid: string; email: string; password: string; profile: PlayerProfile }

/** 계정 하나 — 기본 튜토리얼을 끝냈고 3v3 · 5v5 수비군이 선 Lv2 도시 */
async function account(tag: string, seed: number): Promise<Acct> {
  const email = `war-${tag}-${randomUUID()}@samchess.test`;
  const password = randomUUID();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SECRET_KEY!, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) fail(`「${tag}」 계정 생성 실패 — ${res.status} ${await res.text()}`);
  const { id } = await res.json() as { id: string };
  uids.push(id);
  const base = createProfile(`야전-${tag}-${randomUUID().slice(0, 4)}`, seed);
  const profile = withGarrisons({ ...base, cityLevel: 2, grain: 20, grainAt: Date.now(), tutorial: { done: [...BASIC_TUTORIALS] } });
  await saveProfileTrusted(id, profile);
  return { uid: id, email, password, profile };
}

/** 마지막 핑을 적는다 — `agoMs`만큼 지난 시각으로, 전투 중이면 `busy` */
async function seen(uid: string, agoMs: number, busy = false): Promise<void> {
  await pool.query(
    `insert into presence (uid, last_seen_at, busy) values ($1, now() - make_interval(secs => $2), $3)
       on conflict (uid) do update set last_seen_at = excluded.last_seen_at, busy = excluded.busy`,
    [uid, agoMs / 1000, busy],
  );
}

async function shot(page: Page, name: string): Promise<void> {
  const frame = await page.$('#frame');
  await (frame ?? page).screenshot({ path: join(OUT, `${name}.png`) });
}

/** 실패했을 때 두 페이지의 콘솔 경고를 보여 준다 — 붙지 못한 까닭은 거기에만 남는다 */
let consolesOut: (() => void) | null = null;

const codeOf = (r: { ok: boolean; code?: string }): string | undefined => (r.ok ? 'ok' : r.code);

async function login(page: Page, a: Acct): Promise<void> {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('.scr-title [data-action="loginOpen"]');
  await page.fill('[data-modal="login"] [data-field="email"]', a.email);
  await page.fill('[data-modal="login"] [data-field="password"]', a.password);
  await page.click('[data-modal="login"] [data-action="enter"]');
  await page.waitForSelector('.scr-main', { timeout: 20_000 }).catch(() => fail('로그인했는데 메인이 안 뜬다'));
  await page.waitForFunction(() => !document.getElementById('frame')?.hasAttribute('data-sky'), undefined, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

try {
  const A = await account('A', 9);
  const D = await account('D', 11);
  const E = await account('E', 13);
  const F = await account('F', 15);
  const squad3 = (a: Acct): string => garrisonOf(a.profile, '3v3')!.id;

  // ── 1. 서버 ──
  await seen(D.uid, PRESENCE_ONLINE_MS + 60_000);
  if (codeOf(await declareWarAction(E.uid, D.uid, '3v3', squad3(E))) !== 'war.offline') fail('미접속 D에게 걸렸다');
  await seen(D.uid, 0, true);
  if (codeOf(await declareWarAction(E.uid, D.uid, '3v3', squad3(E))) !== 'war.busy') fail('전투 중인 D에게 걸렸다');
  await seen(D.uid, 0, false);
  await seen(F.uid, 0);
  const sent = await declareWarAction(E.uid, D.uid, '3v3', squad3(E));
  if (!sent.ok || sent.war.status !== 'sent') fail(`D에게 못 걸었다 — ${JSON.stringify(sent)}`);
  const warE = sent.ok ? sent.war.id : '';
  if (codeOf(await declareWarAction(E.uid, F.uid, '3v3', squad3(E))) !== 'war.pending') fail('걸어 둔 것이 있는데 또 걸렸다');
  if (codeOf(await declareWarAction(A.uid, D.uid, '3v3', squad3(A))) !== 'war.engaged') fail('받고 있는 D에게 남이 또 걸었다');
  if (await pingAction(D.uid, true) !== null) fail('전투 중인 핑에 선전포고가 떴다');
  const shown = await pingAction(D.uid, false);
  if (shown?.status !== 'delivered' || shown.role !== 'defender' || (shown.remainingMs ?? 0) < WAR_REPLY_MS - 3_000) {
    fail(`핑에 떴는데 delivered · 남은 30초가 아니다 — ${JSON.stringify(shown && { status: shown.status, left: shown.remainingMs })}`);
  }
  await pool.query(`update wars set delivered_at = delivered_at - make_interval(secs => $2) where id = $1`, [warE, WAR_REPLY_MS / 1000 + 1]);
  const late = await getWarAction(E.uid, warE);
  if (!late.ok || late.war.status !== 'expired') fail(`응답 30초가 지났는데 만료가 아니다 — ${JSON.stringify(late)}`);
  const again = await declareWarAction(E.uid, D.uid, '3v3', squad3(E));
  if (again.ok || again.code !== 'war.cooldown' || !(again.params?.['sec']! > WAR_COOLDOWN_MS / 1000 - 60)) fail(`만료 뒤 쿨다운이 아니다 — ${JSON.stringify(again)}`);
  const toF = await declareWarAction(E.uid, F.uid, '3v3', squad3(E));
  if (!toF.ok) fail(`F에게 못 걸었다 — ${JSON.stringify(toF)}`);
  await pingAction(F.uid, false);
  const declined = await replyWarAction(F.uid, toF.ok ? toF.war.id : '', null);
  if (!declined.ok || declined.war.status !== 'declined') fail(`거절이 안 됐다 — ${JSON.stringify(declined)}`);
  if (codeOf(await declareWarAction(E.uid, F.uid, '3v3', squad3(E))) !== 'war.cooldown') fail('거절 뒤 같은 상대에게 바로 걸렸다');
  ok('서버 — 미접속 · 전투 중 · 걸어 둔 것 · 받는 중은 거절 · 전투 중 핑에는 안 뜬다 · 뜬 순간부터 30초 · 만료 · 거절 · 쿨다운');

  // ── 2. 화면(A만) — 전투 중 · 방금 끊음 ──
  browser = await chromium.launch();
  const pa = await (await browser.newContext({ viewport: { width: 700, height: 1000 } })).newPage();
  const pd = await (await browser.newContext({ viewport: { width: 700, height: 1000 } })).newPage();
  const errors: string[] = [];
  pa.on('pageerror', (e) => errors.push(`A: ${e.message}`));
  pd.on('pageerror', (e) => errors.push(`D: ${e.message}`));
  const consoles: string[] = [];
  for (const [p, who] of [[pa, 'A'], [pd, 'D']] as const) {
    p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') consoles.push(`${who}: ${m.text()}`); });
  }
  consolesOut = () => { for (const c of consoles.slice(-12)) console.error(`  · ${c}`); };
  await seen(D.uid, 0, true);
  await login(pa, A);
  await pa.click('.scr-main [data-place="barracks"]', { force: true });
  await pa.click('[data-action="sortie"]');
  await pa.click('[data-mode="3v3"]');
  await pa.click('.srt-row [data-action="pickSquad"]');
  await pa.click('[data-action="seek"]');
  await pa.waitForSelector('[data-screen="siege"][data-load="ok"]', { timeout: 15_000 }).catch(() => fail('도시 목록이 안 선다'));
  /** 목록을 다시 받고 D의 줄이 보일 때까지 쪽을 넘긴다 */
  const reloadToD = async (): Promise<void> => {
    await pa.click('[data-tab="upper"]');
    await pa.waitForSelector('[data-screen="siege"][data-tab="upper"][data-load="ok"]', { timeout: 15_000 });
    await pa.click('[data-tab="recommended"]');
    await pa.waitForSelector('[data-screen="siege"][data-tab="recommended"][data-load="ok"]', { timeout: 15_000 });
    for (let i = 0; i < 10 && !await pa.$(`.srt-row[data-city="${D.uid}"]`); i++) {
      const next = await pa.$('.scr-siege .srt-list [data-action="nextPage"]:not([disabled])');
      if (!next) break;
      await next.click();
    }
    if (!await pa.$(`.srt-row[data-city="${D.uid}"]`)) fail('화면 목록에 D가 없다');
  };
  await reloadToD();
  if (await pa.getAttribute(`.srt-row[data-city="${D.uid}"] [data-field="presence"]`, 'data-busy') !== '1') fail('전투 중인 D의 점이 주황이 아니다');
  await shot(pa, 'w1-list-busy');
  await pa.click(`.srt-row[data-city="${D.uid}"] [data-action="openCity"]`);
  if (!await pa.waitForSelector('[data-modal="siegeTarget"] [data-action="declare"][disabled]', { timeout: 5_000 }).catch(() => null)) fail('전투 중인 D에게 [선전포고]가 켜져 있다');
  await pa.click('[data-action="siegeClose"]');

  await seen(D.uid, 0, false);
  await reloadToD();
  await pa.click(`.srt-row[data-city="${D.uid}"] [data-action="openCity"]`);
  await pa.waitForSelector('[data-modal="siegeTarget"][data-online="1"] [data-action="declare"]:not([disabled])', { timeout: 5_000 })
    .catch(() => fail('접속 중인 D에게 [선전포고]가 안 켜진다'));
  await seen(D.uid, PRESENCE_ONLINE_MS + 60_000);
  await pa.click('[data-action="declare"]');
  await pa.waitForSelector('[data-modal="siegeTarget"][data-online="0"] [data-action="siegeReady"]', { timeout: 10_000 })
    .catch(() => fail('방금 끊은 D에게 걸었는데 상세가 공성전 모양이 안 된다'));
  if (!await pa.$('[data-modal="siegeTarget"] [data-field="error"]')) fail('「방금 접속을 끊었다」가 안 뜬다');
  await shot(pa, 'w2-target-offline');
  await pa.click('[data-action="siegeClose"]');
  ok('화면 — 전투 중은 주황 점 · [선전포고] 꺼짐 · 누르는 순간 끊겼으면 상세가 공성전 모양');

  // ── 3. 화면(A · D) — 걸고 · 받고 · 수락 ──
  await login(pd, D);
  await pd.waitForFunction(() => true);
  const fresh = await pool.query(`select 1 from presence where uid = $1 and last_seen_at > now() - interval '20 seconds' and not busy`, [D.uid]);
  if (!fresh.rowCount) fail('로그인한 D의 핑이 presence에 없다');
  await reloadToD();
  await pa.click(`.srt-row[data-city="${D.uid}"] [data-action="openCity"]`);
  await pa.click('[data-modal="siegeTarget"] [data-action="declare"]:not([disabled])', { timeout: 5_000 });
  await pa.waitForSelector('[data-war-role="attacker"][data-war-status="sent"]', { timeout: 10_000 }).catch(() => fail('[선전포고]를 눌렀는데 「전하는 중」이 안 선다'));
  await shot(pa, 'w3-sent');
  // D의 다음 핑을 기다리지 않고 바로 보낸다 — 화면이 다시 보인 것과 같은 길(`visibilitychange`)
  await pd.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await pd.waitForSelector('[data-modal="warInbox"][data-war-status="delivered"]', { timeout: 40_000 }).catch(() => fail('D의 화면에 선전포고 팝업이 안 뜬다'));
  const pre = await pd.getAttribute('[data-modal="warInbox"] .war-squads [data-on="1"]', 'data-squad');
  if (pre !== squad3(D)) fail(`팝업에 수비군이 골라져 있지 않다 — ${pre}`);
  await shot(pd, 'w4-inbox');
  const grain0 = { a: (await getProfile(A.uid))!.grain, d: (await getProfile(D.uid))!.grain };
  await pd.click('[data-modal="warInbox"] [data-action="warFight"]');
  await pd.waitForSelector('[data-modal="warInbox"][data-war-status="replied"]', { timeout: 10_000 }).catch(() => fail('[응전]했는데 「수락을 기다린다」가 안 선다'));
  await pa.waitForSelector('[data-war-role="attacker"][data-war-status="replied"]', { timeout: 15_000 }).catch(() => fail('D가 응전했는데 A의 상세에 안 뜬다'));
  if (await pa.getAttribute('[data-war-role="attacker"] [data-field="foeSquad"]', 'data-squad') !== squad3(D)) fail('A의 상세에 D가 고른 부대가 아니다');
  await shot(pa, 'w5-replied');
  await pa.click('[data-action="warAccept"]');
  for (const [p, who] of [[pa, 'A'], [pd, 'D']] as const) {
    await p.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'deploying', null, { timeout: 30_000 })
      .catch(() => fail(`[수락]했는데 ${who}의 화면이 판으로 안 간다`));
  }
  const sides = await Promise.all([pa, pd].map((p) => p.evaluate(() => (window as any).__battle.scene.debugPlayback.humanSide as string)));
  if (sides[0] !== 'P1' || sides[1] !== 'P2') fail(`건 쪽이 남군이 아니다 — A ${sides[0]} · D ${sides[1]}`);
  const status = (await pool.query<{ status: string }>(`select status from wars where attacker = $1 and defender = $2 order by created_at desc limit 1`, [A.uid, D.uid])).rows[0]?.status;
  if (status !== 'started') fail(`방이 열렸는데 선전포고가 started가 아니다 — ${status}`);
  await pa.waitForTimeout(1_500);
  const grain1 = { a: (await getProfile(A.uid))!.grain, d: (await getProfile(D.uid))!.grain };
  if (grain1.a !== grain0.a - 3 || grain1.d !== grain0.d - 3) fail(`참가비가 양쪽에서 안 나갔다 — ${JSON.stringify({ grain0, grain1 })}`);
  await shot(pa, 'w6-battle-A');
  await shot(pd, 'w6-battle-D');
  ok('화면 — [선전포고] → D의 팝업(수비군 골라짐) → [응전] → A에 D의 부대 → [수락] → 두 화면 판 · A 남군 · started · 참가비 양쪽 −3');

  // ── 4. 끝까지 ──
  const phaseOf = (p: Page): Promise<string> => p.evaluate(() => (window as any).__battle?.scene?.debugPlayback?.phase ?? '');
  await pa.click('#ctx-prep button[data-action="ready"]');
  await pd.click('#ctx-prep button[data-action="ready"]');
  for (const p of [pa, pd]) {
    await p.waitForFunction(() => (document.getElementById('ctx-prep') as HTMLElement)?.dataset.phase === 'scouting', null, { timeout: 20_000 })
      .catch(() => fail('둘 다 준비했는데 정찰로 안 간다'));
  }
  await Promise.all([pa, pd].map((p) => p.click('#ctx-prep button[data-action="begin"]')));
  for (let i = 0; i < 160; i++) {
    const [fa, fd] = await Promise.all([phaseOf(pa), phaseOf(pd)]);
    if (fa === 'finished' || fd === 'finished') break;
    for (const [p, f] of [[pa, fa], [pd, fd]] as const) {
      if (f === 'awaitingInput') await p.evaluate(() => (window as any).__battle.scene.debugPlayback.submit({ t: 'surrender' }));
    }
    await pa.waitForTimeout(250);
  }
  for (const p of [pa, pd]) {
    await p.waitForSelector('[data-screen="result"]', { timeout: 30_000 }).catch(() => fail('항복했는데 결과 화면이 안 뜬다'));
  }
  await pa.waitForTimeout(800);
  await shot(pa, 'w7-result-A');
  await shot(pd, 'w7-result-D');
  const rowA = (await getProfile(A.uid))!.matches.at(-1);
  const rowD = (await getProfile(D.uid))!.matches.at(-1);
  if (rowA?.opponent !== 'online' || rowA.opponentId !== D.uid || rowD?.opponent !== 'online' || rowD.opponentId !== A.uid) {
    fail(`두 계정의 이력이 서로를 상대로 한 대인전이 아니다 — ${JSON.stringify({ rowA, rowD })}`);
  }
  if (rowA.result === rowD.result) fail(`두 계정의 결말이 같다 — ${rowA.result}`);
  ok(`끝 — 준비 → 정찰 → 항복 → 두 결과 화면 · 이력은 서로를 상대로 대인전(A ${rowA.result} · D ${rowD.result})`);
  if (errors.length) fail(`페이지 오류 — ${errors.join(' | ')}`);
  console.log(`\n사진: ${OUT}`);
} catch (e) {
  if (!(e instanceof Stop)) { failed = true; console.error(e); }
  if (typeof consolesOut === 'function') consolesOut();
  for (const [i, ctx] of (browser?.contexts() ?? []).entries()) {
    const page = ctx.pages()[0];
    if (page) await shot(page, `zz-failed-${i}`).catch(() => {});
  }
} finally {
  await cleanup();
  process.exit(failed ? 1 : 0);
}
