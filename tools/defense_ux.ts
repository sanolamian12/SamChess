/**
 * 방어 기록 눈 확인 · 흐름 검사 (2026-10-28, GDD §8.8 단계 5) — **시험 계정 둘 · 진짜 DB**로 공격받은 도시가 기록을 보고 다시 본다.
 *
 *   npm run smoke:defense-ux -- [--url http://localhost:5173] [--out 폴더]
 *
 * dev 화면과 그 화면이 부르는 server-api가 **새 코드로** 떠 있어야 한다(제 안에서 띄우지 않는다).
 *
 * 계정 — 공격(A) · 방어(D), 둘 다 도시 Lv2. 공성전은 서버 함수로 친다(화면은 `siege_ux`가 본다).
 *  1. 판 둘 — ① A가 몇 차례 [대기]를 두고 항복(수비 승) ② 몇 수 두고 방치 → 시작 시각을 61분 당겨 읽으면 서버가 이탈로 정산한다.
 *     둘 다 `defense_log`에 지금의 규칙 버전(`REPLAY_VERSION`)으로 남는다
 *  2. D가 들어오면 — 팝업(공격 2 · 막음 2) · 메인 대자보 자리의 표지 2 · 대자보 [방어 기록 보기]의 표지 2
 *  3. 목록 — 합계 · 두 줄(막음 · 이탈, 「새로」) · 연 순간 서버의 안 본 판이 0
 *  4. [다시 보기] ① — 판이 끝까지 가고 **끝 상태가 서버 재생(`replayLocalMatch`)과 같다** · 띠가 「판이 끝났습니다」
 *     [다시 보기] ② — 기록의 끝에서 멈추고 **`replayPrefix`와 같은 자리** · 띠가 「공격자가 자리를 떴습니다」
 *  5. 한 줄의 규칙 버전을 바꾸면 [다시 보기]가 없고 「이전 규칙의 판」 · 서버도 409 · 메인 · 대자보의 표지는 사라졌다
 * 끝나면(실패해도) 계정을 지운다 — 방어 기록은 `on delete cascade`로 함께 사라진다.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { BASIC_TUTORIALS, AI_ABANDON_MS, createProfile, garrisonOf } from '@samchess/meta';
import type { AiBattleState, PlayerProfile } from '@samchess/meta';
import { REPLAY_VERSION, advanceTime, apply, controllingSide, openReplay, replayLocalMatch, replayPrefix, takeTurn } from '@samchess/rules';
import type { BattleState, Intent, ReplayInput } from '@samchess/rules';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { appendAiIntentsAction, settleAiAction, startAiAction } from '../packages/server-api/src/aiBattle.ts';
import { matchSiegeAction } from '../packages/server-api/src/siege.ts';
import { defenseReplay } from '../packages/server-api/src/defense.ts';
import { withGarrisons } from '../packages/meta/test/fixtures.ts';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const BASE = flag('url', 'http://localhost:5173');
const OUT = flag('out', join(tmpdir(), 'samchess-defense-ux'));
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

async function account(tag: string, seed: number): Promise<Acct> {
  const email = `defense-${tag}-${randomUUID()}@samchess.test`;
  const password = randomUUID();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SECRET_KEY!, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) fail(`「${tag}」 계정 생성 실패 — ${res.status} ${await res.text()}`);
  const { id } = await res.json() as { id: string };
  uids.push(id);
  const base = createProfile(`방어-${tag}-${randomUUID().slice(0, 4)}`, seed);
  const profile = withGarrisons({ ...base, cityLevel: 2, grain: 30, grainAt: Date.now(), tutorial: { done: [...BASIC_TUTORIALS] } });
  await saveProfileTrusted(id, profile);
  return { uid: id, email, password, profile };
}

async function shot(page: Page, name: string): Promise<void> {
  const frame = await page.$('#frame');
  await (frame ?? page).screenshot({ path: join(OUT, `${name}.png`) });
}

/** 서버에 굳은 공성전으로 재생 입력을 낸다 — `logDefense`가 남기는 것과 같은 재료 */
const inputOf = (ai: AiBattleState): Omit<ReplayInput, 'humanIntents'> => ({
  matchId: `siege-${ai.seed}`, mode: ai.mode, seed: ai.seed, humanSide: 'P1',
  rosters: { P1: ai.entries ?? [], P2: ai.foe.entries }, deploy: ai.deploy ?? null, aiDeploy: ai.defender?.deploy ?? null,
});

/** 공격자가 [대기]를 `waits`번 두고(그 사이 판이 끝나면 거기까지) `surrender`면 항복한다 — 낸 수가 기록이다 */
function playAttacker(ai: AiBattleState, waits: number, surrender: boolean): Intent[] {
  let s: BattleState = openReplay(inputOf(ai));
  const intents: Intent[] = [{ t: 'ready' }];
  s = apply(s, 'P2', { t: 'ready' }).state;
  s = apply(s, 'P1', { t: 'ready' }).state;
  let left = waits;
  for (let i = 0; i < 5_000 && s.phase !== 'finished'; i++) {
    if (s.phase === 'scout' || s.phase === 'running') { s = advanceTime(s).state; continue; }
    const unit = s.units[s.activeUnit!]!;
    if (controllingSide(s, unit) !== 'P1') { s = takeTurn(s).state; continue; }
    if (left === 0) {
      if (surrender) intents.push({ t: 'surrender' });
      break;
    }
    s = apply(s, 'P1', { t: 'endTurn' }).state;
    intents.push({ t: 'endTurn' });
    left -= 1;
  }
  return intents;
}

/** A가 D의 3v3 수비군을 친다 — 판을 서버에 굳히고 시작까지 */
async function siege(A: Acct, D: Acct): Promise<AiBattleState> {
  const picks = garrisonOf(A.profile, '3v3')!.picks;
  const m = await matchSiegeAction(A.uid, D.uid, '3v3', picks, garrisonOf(A.profile, '3v3')!.id);
  if (!m.ok) fail(`공성전 상대 정하기 실패 — ${JSON.stringify(m)}`);
  const s = await startAiAction(A.uid);
  if (!s.ok) fail(`공성전 시작 실패 — ${JSON.stringify(s)}`);
  return s.ok ? s.ai : (null as never);
}

const summary = (s: { phase: string; winner: string | null; time: number; rngCursor: number; units: Record<string, { id: string; hp: number }> }): string =>
  `${s.phase}/${s.winner}/${s.time}/${s.rngCursor}/${Object.values(s.units).map((u) => `${u.id}:${u.hp}`).sort().join(',')}`;

try {
  const A = await account('A', 9);
  const D = await account('D', 11);

  // ── 1. 판 둘 ──
  const ai1 = await siege(A, D);
  const moves1 = playAttacker(ai1, 4, true);
  const settled = await settleAiAction(A.uid, moves1);
  if (!settled.ok) fail(`항복한 판의 정산 실패 — ${JSON.stringify(settled)}`);
  const ai2 = await siege(A, D);
  const moves2 = playAttacker(ai2, 3, false);
  const appended = await appendAiIntentsAction(A.uid, 0, moves2);
  if (!appended.ok) fail(`방치할 판에 수를 덧붙이지 못했다 — ${JSON.stringify(appended)}`);
  // 시작 시각을 61분 당긴다 — 다음에 읽는 순간 서버가 이탈로 정산하고 방어 기록을 남긴다
  const stale = (await getProfile(A.uid))!;
  await saveProfileTrusted(A.uid, { ...stale, aiBattle: { ...stale.aiBattle!, startedAt: Date.now() - AI_ABANDON_MS - 60_000 } });
  await getProfile(A.uid);
  const logs = (await pool.query<{ id: string; reason: string; winner: string | null; rules_version: string | null; seen_at: Date | null }>(
    'select id, reason, winner, rules_version, seen_at from defense_log where defender_id = $1 order by at asc', [D.uid])).rows;
  if (logs.length !== 2) fail(`방어 기록이 두 줄이 아니다 — ${logs.length}줄`);
  if (logs[0]!.reason !== 'settled' || logs[0]!.winner !== 'P2' || logs[1]!.reason !== 'abandoned') fail(`결말이 다르다 — ${JSON.stringify(logs)}`);
  if (logs.some((l) => l.rules_version !== REPLAY_VERSION || l.seen_at !== null)) fail(`규칙 버전 · 안 본 표시가 아니다 — ${JSON.stringify(logs)}`);
  ok(`판 둘 — 항복(수 ${moves1.length}) · 방치(수 ${moves2.length}) → 방어 기록 두 줄 · 버전 ${REPLAY_VERSION} · 안 봄`);

  // ── 2. D가 들어온다 ──
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 700, height: 1000 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('.scr-title [data-action="loginOpen"]');
  await page.fill('[data-modal="login"] [data-field="email"]', D.email);
  await page.fill('[data-modal="login"] [data-field="password"]', D.password);
  await page.click('[data-modal="login"] [data-action="enter"]');
  await page.waitForSelector('.scr-main', { timeout: 20_000 }).catch(() => fail('로그인했는데 메인이 안 뜬다'));
  await page.waitForFunction(() => !document.getElementById('frame')?.hasAttribute('data-sky'), undefined, { timeout: 15_000 }).catch(() => {});
  const pop = await page.waitForSelector('[data-modal="defenseUnseen"] [data-field="defenseUnseen"]', { timeout: 15_000 }).catch(() => null);
  if (!pop) fail('공격받았는데 들어올 때 팝업이 안 뜬다');
  const popAt = { attacks: await pop!.getAttribute('data-attacks'), held: await pop!.getAttribute('data-held') };
  if (popAt.attacks !== '2' || popAt.held !== '2') fail(`팝업의 숫자가 다르다 — ${JSON.stringify(popAt)}`);
  await shot(page, 'd1-popup');
  await page.click('[data-action="defenseClose"]');
  const mainBadge = await page.getAttribute('[data-place-badge="ranking"]', 'data-count').catch(() => null);
  if (mainBadge !== '2') fail(`메인 대자보 자리의 표지가 2가 아니다 — ${mainBadge}`);
  await shot(page, 'd2-main-badge');
  await page.click('.scr-main [data-place="ranking"]', { force: true });
  await page.waitForSelector('[data-screen="board"]', { timeout: 10_000 });
  if (await page.getAttribute('[data-action="defense"]', 'data-unseen') !== '2') fail('대자보 [방어 기록 보기]의 표지가 2가 아니다');
  ok('들어오면 — 팝업(공격 2 · 막음 2) · 메인 대자보 표지 2 · 대자보 단추 표지 2');

  // ── 3. 목록 ──
  await page.click('[data-action="defense"]');
  await page.waitForSelector('[data-screen="defense"][data-load="ok"]', { timeout: 15_000 }).catch(() => fail('방어 기록 목록이 안 선다'));
  const sum = { total: await page.getAttribute('[data-field="summary"]', 'data-total'), held: await page.getAttribute('[data-field="summary"]', 'data-held') };
  if (sum.total !== '2' || sum.held !== '2') fail(`합계가 다르다 — ${JSON.stringify(sum)}`);
  const rows = await page.$$eval('.dfs-row', (els) => els.map((e) => ({ id: e.getAttribute('data-defense'), result: e.getAttribute('data-result'), seen: e.getAttribute('data-seen'), replayable: e.getAttribute('data-replayable') })));
  if (rows.length !== 2 || rows[0]!.result !== 'abandoned' || rows[1]!.result !== 'held') fail(`줄이 다르다(최신부터 이탈 · 막음) — ${JSON.stringify(rows)}`);
  if (rows.some((r) => r.seen !== '0' || r.replayable !== '1')) fail(`「새로」 · 다시 보기가 아니다 — ${JSON.stringify(rows)}`);
  await shot(page, 'd3-list');
  await page.waitForTimeout(800);
  const unseenNow = (await pool.query('select count(*)::int as n from defense_log where defender_id = $1 and seen_at is null', [D.uid])).rows[0].n;
  if (unseenNow !== 0) fail(`목록을 열었는데 서버의 안 본 판이 ${unseenNow}개다`);
  ok(`목록 — 합계 2 · 막음 2 · 줄 둘(이탈 · 막음, 「새로」) · 연 순간 서버의 안 본 판 0`);

  // ── 4. 다시 보기 ──
  const replayOf = async (rowId: string, expect: 'finished' | 'cut', wantSummary: string): Promise<void> => {
    await page.click(`.dfs-row[data-defense="${rowId}"] [data-action="replay"]`);
    await page.waitForSelector(`[data-screen="defenseReplay"][data-end="${expect}"]`, { timeout: 180_000 })
      .catch(() => fail(`[다시 보기]가 ${expect === 'finished' ? '판의 끝' : '기록의 끝'}에 닿지 않는다`));
    const got = await page.evaluate(() => {
      const r = (window as any).__replay;
      const s = r.current;
      return { exhausted: r.exhausted as boolean, phase: s.phase, winner: s.winner, time: s.time, rngCursor: s.rngCursor, units: s.units };
    });
    if (summary(got) !== wantSummary) fail(`리플레이의 끝 상태가 서버 재생과 다르다\n  화면 ${summary(got)}\n  서버 ${wantSummary}`);
    if (got.exhausted !== (expect === 'cut')) fail(`기록을 다 썼는가가 다르다 — ${got.exhausted}`);
    const side = await page.evaluate(() => (window as any).__battle?.scene?.debugPlayback?.viewSide);
    if (side !== 'P2') fail(`리플레이가 방어자 쪽에서 보지 않는다 — ${side}`);
    await shot(page, `d4-replay-${expect}`);
    await page.click('[data-action="replayBack"]');
    await page.waitForSelector('[data-screen="defense"][data-load="ok"]', { timeout: 15_000 });
  };
  const full = replayLocalMatch({ ...inputOf(ai1), humanIntents: moves1 });
  const cut = replayPrefix({ ...inputOf(ai2), humanIntents: moves2 });
  if (!full.ok || !cut.ok) fail('서버 재생이 실패했다');
  await replayOf(rows[1]!.id!, 'finished', summary(full.ok ? full.state : (null as never)));
  ok('다시 보기 ① — 판이 끝까지 가고 끝 상태가 서버 재생과 같다 · 방어자(북군) 쪽에서 본다 · 「판이 끝났습니다」');
  await replayOf(rows[0]!.id!, 'cut', summary(cut.ok ? cut.state : (null as never)));
  ok('다시 보기 ② — 기록의 끝에서 멈추고 둔 데까지의 서버 재생과 같다 · 「공격자가 자리를 떴습니다」');

  // ── 5. 규칙이 바뀐 판 · 표지 ──
  await pool.query(`update defense_log set rules_version = '0.00000000' where id = $1`, [rows[1]!.id]);
  if (await defenseReplay(D.uid, Number(rows[1]!.id)) !== 'stale') fail('규칙이 바뀐 판을 서버가 내준다');
  await page.click('[data-action="back"]');
  await page.waitForSelector('[data-screen="board"]', { timeout: 10_000 });
  if (Number(await page.getAttribute('[data-action="defense"]', 'data-unseen')) !== 0) fail('목록을 본 뒤에도 대자보 표지가 남았다');
  await page.click('[data-action="defense"]');
  await page.waitForSelector('[data-screen="defense"][data-load="ok"]', { timeout: 15_000 });
  const old = `.dfs-row[data-defense="${rows[1]!.id}"]`;
  if (await page.getAttribute(old, 'data-replayable') !== '0' || await page.$(`${old} [data-action="replay"]`) || !await page.$(`${old} [data-field="stale"]`)) {
    fail('규칙이 바뀐 판에 [다시 보기]가 있다');
  }
  if (await page.$('.dfs-row [data-field="new"]')) fail('다시 연 목록에 「새로」가 남았다');
  await shot(page, 'd5-stale');
  await page.click('[data-action="back"]');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main', { timeout: 10_000 });
  await page.waitForTimeout(800);
  if (await page.$('[data-place-badge="ranking"]')) fail('목록을 본 뒤에도 메인 대자보 표지가 남았다');
  ok('규칙이 바뀐 판 — [다시 보기] 없이 「이전 규칙의 판」 · 서버도 409 · 메인 · 대자보 표지와 「새로」가 사라졌다');
  if (errors.length) fail(`페이지 오류 — ${errors.join(' | ')}`);
  console.log(`\n사진: ${OUT}`);
} catch (e) {
  if (!(e instanceof Stop)) { failed = true; console.error(e); }
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await shot(page, 'zz-failed').catch(() => {});
} finally {
  await cleanup();
  process.exit(failed ? 1 : 0);
}
