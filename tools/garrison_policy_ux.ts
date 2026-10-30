/**
 * 수비군 방침 눈 확인 · 흐름 검사 (2026-10-30, GDD §8.8 단계 6) — **시험 계정 둘 · 진짜 DB**로 민다.
 *
 *   npm run smoke:policy-ux -- [--url http://localhost:5173] [--out 폴더]   (UI_LANG=mn 이면 그 언어 화면으로 — 글자가 줄에서 잘리는가는 언어마다 다르다)
 *
 * dev 화면과 그 화면이 부르는 server-api가 **새 코드로** 떠 있어야 한다(스모크처럼 제 안에서 띄우지 않는다).
 *
 * 계정 — 수비(D, 도시 Lv2, 3v3 수비군의 둘째 · 셋째 장수가 Lv2로 증폭 · 공포를 안다) · 공격(A, Lv2)
 *  1. 방침 화면 — D가 병영 → 부대 → 수비군 부대 → [수비군 설정]. 탭 셋을 찍는다(700px)
 *     · 행동: 둘째 기물을 호위로 · 책략: [방침 추가](누구든지 → 공포 → HP 절반 이하 적군 → 30%) · 첫 줄을 아래로
 *     · 고유기술: 첫 줄의 조건을 「본인이 적군과 조우」로 → [저장]
 *  2. 서버 — 계정의 부대 방침과 `defenses` 표의 스냅샷 방침이 화면에서 고른 그대로다
 *  3. 저장하지 않고 나가면 묻는다 · 새 책략 알림 — D가 책략을 하나 더 배우면 들어올 때 한 번 뜨고, 닫으면 다시 안 뜬다
 *  4. 공성전 — A가 D를 친다. 상세에 수성전 규칙 · 판은 수성전(성채 9칸 · 북군 군량고 없음) · 판에 실린 방침 = 스냅샷 방침
 *     · 항복 → 방어 기록에 판 종류(siege)와 방침이 실렸다 · 서버 재생(정산)이 같은 판을 냈다(이력이 남았다)
 * 끝나면(실패해도) 계정을 지운다.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { BASIC_TUTORIALS, createProfile, effectivePolicy, garrisonOf } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { OfficerId, TacticId } from '@samchess/rules';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { withGarrisons } from '../packages/meta/test/fixtures.ts';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const BASE = flag('url', 'http://localhost:5173');
const OUT = flag('out', join(tmpdir(), 'samchess-policy-ux'));
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

/** 장수 하나를 Lv(배운 책략 수 + 1)로 — 성장 스택을 직접 쌓는다(길이 = 레벨 − 1) */
function teach(p: PlayerProfile, officer: OfficerId, tactics: TacticId[]): PlayerProfile {
  const inst = p.roster[officer]!;
  const growth = tactics.map((t) => ({ stat: 'hp' as const, tactics: [t] }));
  return { ...p, roster: { ...p.roster, [officer]: { ...inst, level: growth.length + 1, growth } } };
}

async function account(tag: string, shape: (p: PlayerProfile) => PlayerProfile = (p) => p):
  Promise<{ uid: string; email: string; password: string; profile: PlayerProfile }> {
  const email = `policy-${tag}-${randomUUID()}@samchess.test`;
  const password = randomUUID();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SECRET_KEY!, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) fail(`「${tag}」 계정 생성 실패 — ${res.status} ${await res.text()}`);
  const { id } = await res.json() as { id: string };
  uids.push(id);
  const base = createProfile(`방침-${tag}-${randomUUID().slice(0, 4)}`, 9);
  const profile = shape(withGarrisons({
    ...base, cityLevel: 2, grain: 20, grainAt: Date.now(), tutorial: { done: [...BASIC_TUTORIALS] },
  }));
  await saveProfileTrusted(id, profile);
  return { uid: id, email, password, profile };
}

async function shot(page: Page, name: string): Promise<void> {
  const frame = await page.$('#frame');
  await (frame ?? page).screenshot({ path: join(OUT, `${name}.png`) });
}

const UI_LANG = process.env['UI_LANG'];

async function login(ctx: BrowserContext, who: { email: string; password: string }, errors: string[]): Promise<Page> {
  if (UI_LANG) await ctx.addInitScript((l) => { try { localStorage.setItem('samchess.lang', l); } catch { /* 없다 */ } }, UI_LANG);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('.scr-title [data-action="loginOpen"]');
  await page.fill('[data-modal="login"] [data-field="email"]', who.email);
  await page.fill('[data-modal="login"] [data-field="password"]', who.password);
  await page.click('[data-modal="login"] [data-action="enter"]');
  await page.waitForSelector('.scr-main', { timeout: 20_000 }).catch(() => fail('로그인했는데 메인이 안 뜬다'));
  await page.waitForFunction(() => !document.getElementById('frame')?.hasAttribute('data-sky'), undefined, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  return page;
}

/** 저장이 서버에 닿을 때까지 — 저장은 계정 큐가 비동기로 보낸다 */
async function until<T>(read: () => Promise<T>, good: (v: T) => boolean, what: string, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (good(v)) return v;
    if (Date.now() > end) return fail(`${what} — 기다려도 안 바뀐다: ${JSON.stringify(v)?.slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

try {
  const D = await account('D', (p) => {
    const sq = garrisonOf(p, '3v3')!;
    return teach(teach(p, sq.picks[1]!.officer, ['jeung-pok' as TacticId]), sq.picks[2]!.officer, ['gong-po' as TacticId]);
  });
  const A = await account('A');
  const dSquad = garrisonOf(D.profile, '3v3')!;
  const before = effectivePolicy(D.profile, dSquad);
  if (before.tactics.length !== 2) fail(`D의 기본 책략 방침이 둘(증폭 · 공포)이 아니다 — ${JSON.stringify(before.tactics)}`);
  const second = dSquad.picks[1]!;

  browser = await chromium.launch();
  const errors: string[] = [];

  // ── 1. 방침 화면 ──
  const dCtx = await browser.newContext({ viewport: { width: 700, height: 1400 } });
  let page = await login(dCtx, D, errors);
  await page.click('.scr-main [data-place="barracks"]', { force: true });
  await page.click('[data-action="squads"]');
  await page.click(`.sqd-row[data-squad="${dSquad.id}"] [data-action="open"]`);
  await page.waitForSelector('[data-screen="squadView"][data-garrison="1"]', { timeout: 10_000 }).then(() => page.waitForSelector('[data-action="garrisonPolicy"]', { timeout: 3_000 }))
    .catch(() => fail('수비군 부대 현황에 [수비군 설정]이 없다'));
  await shot(page, 'p0-squad-view');
  await page.click('[data-action="garrisonPolicy"]');
  await page.waitForSelector('[data-screen="garrisonPolicy"][data-tab="stance"]', { timeout: 10_000 }).catch(() => fail('수비군 설정이 안 뜬다'));
  const stances = await page.$$eval('.gpl-srow', (rows) => rows.map((r) => [r.getAttribute('data-piece'), r.getAttribute('data-stance')]));
  if (stances.length !== 3 || stances.find(([p]) => p === 'King')?.[1] !== 'hold') fail(`행동 탭의 기본이 이상하다 — ${JSON.stringify(stances)}`);
  await shot(page, 'p1-stance');

  await page.click(`.gpl-srow[data-piece="${second.piece}"] [data-action="stance"]`);
  await page.waitForSelector('[data-modal="policyPicker"][data-kind="stance"]');
  const offered = await page.$$eval('[data-modal="policyPicker"] [data-choice]', (b) => b.map((x) => x.getAttribute('data-choice')));
  if (offered.includes('hold') || !offered.includes('escort')) fail(`King 아닌 기물에 수성이 있거나 호위가 없다 — ${offered.join(',')}`);
  await shot(page, 'p2-stance-picker');
  await page.click('[data-modal="policyPicker"] [data-choice="escort"]');
  if (await page.getAttribute(`.gpl-srow[data-piece="${second.piece}"]`, 'data-stance') !== 'escort') fail('호위를 골랐는데 줄이 안 바뀌었다');

  await page.click('.gpl-tabs [data-tab="tactic"]');
  await page.waitForSelector('.gpl-body[data-tab="tactic"] [data-field="rules"][data-count="2"]', { timeout: 5_000 })
    .catch(() => fail('책략 탭에 기본 두 줄(증폭 · 공포)이 없다'));
  if (await page.getAttribute('[data-field="policyMode"]', 'data-custom') !== '0') fail('손대지 않은 책략 방침이 「기본」으로 안 보인다');
  await shot(page, 'p3-tactic');
  await page.click('[data-action="ruleAdd"]');
  await page.click('[data-modal="policyPicker"] [data-choice="anyone"]');
  await page.click('[data-modal="policyPicker"] [data-choice="gong-po"]');
  await page.click('[data-modal="policyPicker"] [data-choice="enemyHalfHp"]');
  await shot(page, 'p4-chance-picker');
  await page.click('[data-modal="policyPicker"] [data-choice="30"]');
  await page.waitForSelector('[data-field="rules"][data-count="3"]', { timeout: 3_000 }).catch(() => fail('[방침 추가]가 줄을 안 늘렸다'));
  await page.click('.gpl-row[data-rule="0"]');
  await page.click('[data-action="ruleDown"]');
  const order = await page.$$eval('.gpl-row.gpl-tactic:not(.gpl-thead)', (r) => r.map((x) => x.getAttribute('data-tactic')));
  if (order[1] !== before.tactics[0]!.tactic) fail(`[아래로]가 첫 줄을 안 내렸다 — ${order.join(',')}`);
  await shot(page, 'p5-tactic-edited');

  const skillOpen = !(await page.$('.gpl-tabs [data-tab="skill"][disabled]'));
  let firstSkill: string | null = null;
  if (skillOpen) {
    await page.click('.gpl-tabs [data-tab="skill"]');
    await page.waitForSelector('[data-screen="garrisonPolicy"][data-tab="skill"]');
    firstSkill = await page.getAttribute('.gpl-row.gpl-skill[data-rule="0"]', 'data-officer');
    if (firstSkill) {
      await page.click('.gpl-row.gpl-skill[data-rule="0"] [data-action="ruleWhen"]');
      await page.click('[data-modal="policyPicker"] [data-choice="selfEngaged"]');
    }
    await shot(page, 'p6-skill');
  }
  await page.click('[data-action="savePolicy"]');
  await page.waitForSelector('[data-field="saved"]', { timeout: 3_000 }).catch(() => fail('[저장]을 눌렀는데 「저장했다」가 없다'));
  ok(`방침 화면 — 행동(${second.piece} → 호위) · 책략 3줄(공포 30% 추가 · 첫 줄 아래로) · 고유기술(${firstSkill ?? '없음'}) · [저장]`);

  // ── 2. 서버 ──
  const saved = await until(async () => (await getProfile(D.uid))!.squads.find((s) => s.id === dSquad.id)?.policy,
    (p) => !!p?.tactics && p.tactics.length === 3, '계정의 부대 방침');
  if (saved!.stances?.[second.piece] !== 'escort') fail('계정에 호위가 안 남았다');
  const added = saved!.tactics!.find((r) => r.tactic === 'gong-po' && r.when === 'enemyHalfHp');
  if (added?.minChance !== 30 || added.caster !== null) fail(`추가한 줄이 다르다 — ${JSON.stringify(added)}`);
  if (firstSkill && saved!.skills?.find((r) => r.officer === firstSkill)?.when !== 'selfEngaged') fail('고유기술 조건이 안 남았다');
  const snap = await until(async () => (await pool.query<{ snapshot: any }>('select snapshot from defenses where uid = $1 and mode = $2', [D.uid, '3v3'])).rows[0]?.snapshot,
    (s) => s?.policy?.stances?.[second.piece] === 'escort', '수비군 스냅샷의 방침');
  if (snap.policy.tactics.length !== 3) fail(`스냅샷의 책략 방침이 3줄이 아니다 — ${snap.policy.tactics.length}`);
  ok(`서버 — 부대 방침(호위 · 공포 30% · 본 책략 ${saved!.seenTactics?.length ?? 0}개) · defenses 스냅샷이 같은 값`);

  // ── 3. 나가기 확인 · 새 책략 알림 ──
  await page.click('.gpl-tabs [data-tab="stance"]');
  await page.click(`.gpl-srow[data-piece="${second.piece}"] [data-action="stance"]`);
  await page.click('[data-modal="policyPicker"] [data-choice="advance"]');
  await page.click('[data-screen="garrisonPolicy"] [data-action="back"]');
  await page.waitForSelector('[data-modal="policyPicker"][data-kind="leave"]', { timeout: 3_000 }).catch(() => fail('저장하지 않고 나가는데 묻지 않는다'));
  await page.click('[data-action="leaveConfirm"]');
  await page.waitForSelector('[data-screen="squadView"]', { timeout: 5_000 });
  const stillEscort = (await getProfile(D.uid))!.squads.find((s) => s.id === dSquad.id)!.policy!.stances![second.piece];
  if (stillEscort !== 'escort') fail('저장하지 않고 나갔는데 바뀐 것이 저장됐다');

  // D가 책략을 하나 더 배운다(셋째 장수 Lv3: 공포 → 반감) — 들어올 때 한 번 뜬다
  const cur = (await getProfile(D.uid))!;
  await saveProfileTrusted(D.uid, teach(cur, dSquad.picks[2]!.officer, ['gong-po' as TacticId, 'ban-gam' as TacticId]));
  await page.close();
  // 같은 브라우저 저장소 — 저장된 세션으로 곧장 들어온다(로그인 화면이 없다)
  page = await dCtx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 }).catch(() => fail('다시 열었는데 메인이 안 뜬다'));
  await page.waitForSelector('[data-modal="policyNotice"]', { timeout: 10_000 }).catch(() => fail('새 책략을 배웠는데 알림이 안 뜬다'));
  const noticeText = await page.textContent('[data-modal="policyNotice"] [data-field="tactics"]');
  await shot(page, 'p7-notice');
  await page.click('[data-action="policyClose"]');
  await until(async () => (await getProfile(D.uid))!.squads.find((s) => s.id === dSquad.id)!.policy!.seenTactics ?? [],
    (seen) => seen.includes('ban-gam' as TacticId), '닫은 뒤 본 책략');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2_500);
  if (await page.$('[data-modal="policyNotice"]')) fail('닫았는데 다시 뜬다');
  ok(`나가기 확인 · 새 책략 알림(「${noticeText}」) → 닫으면 다시 안 뜬다`);
  await dCtx.close();

  // ── 4. 공성전 ──
  // D는 방금까지 접속해 있었다 — 마지막 핑을 3분 전으로(접속 중이면 공성전이 아니라 선전포고다)
  await pool.query(`update presence set last_seen_at = now() - interval '3 minutes' where uid = $1`, [D.uid]);
  // 전투 화면은 공성전 도구와 같은 창 — 1400 높이에서는 헤드리스의 WebGL이 「Incomplete Attachment」를 낸다
  const aCtx = await browser.newContext({ viewport: { width: 700, height: 1000 } });
  const ap = await login(aCtx, A, errors);
  await ap.click('.scr-main [data-place="barracks"]', { force: true });
  await ap.click('[data-action="sortie"]');
  await ap.click('[data-mode="3v3"]');
  await ap.click('.srt-row [data-action="pickSquad"]');
  await ap.click('[data-action="seek"]');
  await ap.waitForSelector('[data-screen="siege"][data-load="ok"]', { timeout: 15_000 }).catch(() => fail('도시 목록이 안 선다'));
  for (let i = 0; i < 10 && !await ap.$(`.srt-row[data-city="${D.uid}"]`); i++) {
    const next = await ap.$('.scr-siege .srt-list [data-action="nextPage"]:not([disabled])');
    if (!next) break;
    await next.click();
  }
  if (!await ap.$(`.srt-row[data-city="${D.uid}"]`)) fail('A의 목록에 D가 없다');
  await ap.click(`.srt-row[data-city="${D.uid}"] [data-action="openCity"]`);
  await ap.waitForSelector('[data-modal="siegeTarget"][data-online="0"] [data-field="siegeRule"]', { timeout: 5_000 }).catch(() => fail('상세에 수성전 규칙이 없다'));
  if (await ap.$('[data-modal="siegeTarget"] .gpl-row, [data-modal="siegeTarget"] [data-stance]')) fail('공격자 화면에 수비군 방침이 보인다');
  await shot(ap, 'p8-target');
  await ap.click('[data-action="siegeReady"]');
  await ap.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.state, undefined, { timeout: 20_000 })
    .catch(() => fail('[전투준비]를 눌렀는데 판이 안 선다'));
  const board = await ap.evaluate(() => {
    const s = (window as any).__battle.scene.debugPlayback.state;
    const depots = [...((window as any).__battle.scene.depotViews as Map<string, unknown>).keys()];
    return { scenario: s.scenario, forts: s.terrain.filter((t: any) => t.fort?.side === 'P2').length, policy: s.policy?.P2, depots };
  });
  if (JSON.stringify(board.depots) !== '["P1"]') fail(`군량고 그림이 남군 것 하나가 아니다 — ${JSON.stringify(board.depots)}`);
  if (board.scenario !== 'siege' || board.forts !== 9) fail(`판이 수성전이 아니다 — ${JSON.stringify({ ...board, policy: undefined })}`);
  const snapNow = (await pool.query<{ snapshot: any }>('select snapshot from defenses where uid = $1 and mode = $2', [D.uid, '3v3'])).rows[0]!.snapshot;
  if (JSON.stringify(board.policy) !== JSON.stringify(snapNow.policy)) fail('판에 실린 방침이 스냅샷과 다르다');
  const fighting = (await getProfile(A.uid))!.aiBattle;
  if (JSON.stringify(fighting?.defender?.policy) !== JSON.stringify(snapNow.policy)) fail('서버에 굳힌 판의 방침이 스냅샷과 다르다');
  await ap.waitForTimeout(1_500);
  await shot(ap, 'p9-battle');
  // 판 전체 — 성채가 북군 진영 가운데에 섰는가(눈 확인)
  await ap.evaluate(() => (window as any).__battle.scene.resetView?.());
  await ap.waitForTimeout(900);
  await shot(ap, 'p9b-board');
  ok('공성전 — 상세에 수성전 규칙(방침은 안 보인다) · 판은 수성전(성채 9칸) · 판 · 서버에 굳힌 방침 = 스냅샷');

  await ap.click('#ctx-prep button.go');
  await ap.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'awaitingInput'
    && (window as any).__battle.scene.debugPlayback.state.phase === 'control', undefined, { timeout: 90_000 })
    .catch(() => fail('준비를 마쳤는데 내 차례가 안 온다'));
  await shot(ap, 'p10-my-turn');
  await ap.click('#gameinfo .gi-act[data-action="surrender"]:not([disabled])');
  await ap.click('[data-modal="surrender"] button[data-action="surrender"]', { timeout: 5_000 }).catch(() => fail('[항복] 물음 팝업이 안 뜬다'));
  await ap.waitForSelector('[data-screen="result"]', { timeout: 30_000 }).catch(() => fail('항복했는데 결과 화면이 안 뜬다'));
  const after = (await getProfile(A.uid))!;
  if (after.aiBattle) fail('정산했는데 판이 남았다 — 서버 재생이 어긋났을 수 있다');
  if (after.matches.at(-1)?.opponent !== 'siege') fail('이력이 공성전이 아니다');
  const log = (await pool.query<{ replay: any; winner: string }>('select replay, winner from defense_log where defender_id = $1', [D.uid])).rows;
  if (log.length !== 1 || log[0]!.replay?.scenario !== 'siege' || JSON.stringify(log[0]!.replay.policy) !== JSON.stringify(snapNow.policy)) {
    fail(`방어 기록에 판 종류 · 방침이 안 실렸다 — ${JSON.stringify(log.map((l) => ({ scenario: l.replay?.scenario, hasPolicy: !!l.replay?.policy })))}`);
  }
  ok(`항복 → 서버 재생 정산(이력 공성전) · 방어 기록에 판 종류 siege · 방침 · 수비 승 ${log[0]!.winner}`);
  if (errors.length) fail(`페이지 오류 — ${errors.join(' | ')}`);
  console.log(`\n사진: ${OUT}`);
} catch (e) {
  if (!(e instanceof Stop)) { failed = true; console.error(e); }
  for (const ctx of browser?.contexts() ?? []) {
    const p = ctx.pages()[0];
    if (p) await shot(p, `zz-failed-${browser!.contexts().indexOf(ctx)}`).catch(() => {});
  }
} finally {
  await cleanup();
  process.exit(failed ? 1 : 0);
}
