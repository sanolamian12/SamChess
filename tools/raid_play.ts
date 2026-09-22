/**
 * 도적떼 실제 플레이 확인 — 진짜 계정으로 로그인해서 출몰 → 파수꾼 → 출정 막힘 → 방어전 →
 * 항복 정산 → 마지막 알림 → 자동 항복까지 끝까지 눌러 본다 (GDD §5.11, 2026-09-21).
 *
 *   npm run server-api   (새 경로 /raid/* 가 있어야 한다 — 낡은 서버면 404로 멈춘다)
 *   npm run dev
 *   node --experimental-strip-types --env-file=.env tools/raid_play.ts
 *
 * 농지 레벨·군량은 **서버에** `saveProfileTrusted()`로 심는다(화면 오버라이드가 아니다).
 * 10분을 기다릴 수는 없으므로 마감 쪽 두 갈래(마지막 알림 · 자동 항복)만 도적떼의 출몰
 * 시각을 서버에 과거로 심어 만든다 — 판정은 여전히 서버의 `syncRaid()`가 한다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { raidDay } from '../packages/meta/src/index.ts';
import type { PlayerProfile } from '../packages/meta/src/index.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { pool } from '../packages/server-api/src/db.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
const MIN = 60_000;

const step = (m: string) => console.log(`\n▶ ${m}`);
const ok = (m: string) => console.log(`  ✓ ${m}`);
let cleanup: () => Promise<void> = async () => {};
/** 실패 순간의 화면과 콘솔 — 「안 온다」만으로는 왜인지 모른다 */
let onFail: () => Promise<void> = async () => {};
const fail = async (m: string): Promise<never> => {
  console.error(`  ✗ ${m}`);
  await onFail().catch(() => {});
  await cleanup();
  process.exit(1);
};

// ── 진짜 계정 하나 ────────────────────────────────────────────
const email = `raid-play-${randomUUID()}@samchess.test`;
const password = randomUUID();
const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
if (!createRes.ok) await fail(`계정 생성 실패 — ${createRes.status} ${await createRes.text()}`);
const uid = (await createRes.json() as { id: string }).id;
step(`테스트 계정 — ${email}`);

const browser = await chromium.launch();
cleanup = async () => {
  await browser.close().catch(() => {});
  await pool.query('delete from profiles where uid = $1', [uid]).catch(() => {});
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  await pool.end().catch(() => {});
  console.log('\n✓ 테스트 계정 정리');
};

const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
const errors: string[] = [];
page.on('dialog', (d) => void d.accept());
page.on('response', (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (name: string) => { await page.screenshot({ path: `${SHOTS}/${name}.png` }); ok(`📷 ${name}.png`); };
onFail = async () => {
  await page.screenshot({ path: `${SHOTS}/raid-fail.png` });
  const where = await page.evaluate(() => ({
    screen: (document.querySelector('[data-screen]') as HTMLElement | null)?.dataset['screen'] ?? null,
    frame: document.getElementById('frame')?.className,
    alert: (document.querySelector('[data-modal="raidAlert"]') as HTMLElement | null)?.dataset['kind'] ?? null,
    alertError: document.querySelector('[data-modal="raidAlert"] [data-field="error"]')?.textContent ?? null,
  }));
  console.error(`    화면 ${JSON.stringify(where)}`);
  for (const e of errors) console.error(`    콘솔: ${e}`);
};

/** 서버 행을 **날것으로** 읽는다 — `getProfile()`은 읽으면서 되쓰므로 폴링에 쓰면 경주를 만든다 */
const row = async (): Promise<PlayerProfile> =>
  (await pool.query<{ data: PlayerProfile }>('select data from profiles where uid = $1', [uid])).rows[0]!.data;

async function until<T>(read: () => Promise<T>, good: (v: T) => boolean, label: string, ms = 15_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await read();
    if (good(v)) return v;
    if (Date.now() - t0 > ms) return fail(`${label} — ${ms / 1000}초가 지나도 안 된다 (${JSON.stringify(v)})`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** 서버 계정을 고쳐 심고 새로고침한다 — 새로고침의 `GET /profile`이 곧 출몰의 문이다 */
async function seed(patch: (p: PlayerProfile) => PlayerProfile): Promise<void> {
  const stored = await getProfile(uid);
  if (!stored) await fail('서버에 프로필이 없다');
  await saveProfileTrusted(uid, patch(stored!));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
}

const alertKind = () => page.evaluate(() =>
  (document.querySelector('[data-modal="raidAlert"]') as HTMLElement | null)?.dataset['kind'] ?? null);

try {
  // ── 로그인 → 새 도시 ────────────────────────────────────────
  step('간판에서 로그인 → 새 도시');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    const nameInput = await page.$('.scr-new .newgame-form input');
    if (nameInput) await nameInput.fill(`농지실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }
  ok('도시가 섰다');
  if (await alertKind()) await fail('농지가 없는데 도적떼 알림이 떴다');
  ok('농지가 없으면 도적떼도 없다');

  // ── 농지 Lv2를 심는다 → 새로고침이 출몰시킨다 ──────────────────
  step('서버에 농지 Lv2 · 군량 40을 심고 새로고침 (그 GET이 출몰의 문이다)');
  await seed((p) => ({ ...p, cityLevel: 2, grain: 40, buildings: { ...p.buildings, barracks: 2, farm: 2 } }));
  const spawned = await until(row, (p) => p.raid?.status === 'pending', '서버에 도적떼가 출몰');
  if (spawned.raid!.bandits !== 2) await fail(`도적 수가 농지 레벨이 아니다 — ${spawned.raid!.bandits}`);
  if (spawned.raid!.day !== raidDay(Date.now())) await fail(`출몰 날짜가 오늘(KST)이 아니다 — ${spawned.raid!.day}`);
  ok(`서버 — 도적 ${spawned.raid!.bandits}명, 기준 군량 ${spawned.raid!.grainAtSpawn}`);

  await page.waitForSelector('[data-modal="raidAlert"][data-kind="first"]', { timeout: 5_000 })
    .catch(() => fail('메인에 들어왔는데 첫 알림이 안 떴다'));
  const guardsShown = await page.getAttribute('[data-modal="raidAlert"] [data-field="guards"]', 'data-guards');
  if (guardsShown !== '0') await fail(`파수꾼 수 표시가 이상하다 — ${guardsShown}`);
  if (!(await page.$('[data-action="raidToFarm"]'))) await fail('파수꾼이 없는데 [파수꾼 배치]가 없다');
  await shot('raid-01-alert-first');
  ok('첫 알림 — 파수꾼이 없어 [파수꾼 배치]로 보낸다');

  // ── 농지 — 파수꾼 둘 ─────────────────────────────────────────
  step('[파수꾼 배치] → 농지 [파수꾼 관리]에서 King · Rock을 세운다');
  await page.click('[data-action="raidToFarm"]');
  await page.waitForSelector('.scr-building-farm [data-field="raid"] dd[data-tone="alert"]', { timeout: 10_000 })
    .catch(() => fail('농지 현황판에 「출현」(붉음)이 없다'));
  if (!(await page.$('.scr-building-farm .frm-alert [data-action="raidFight"]'))) await fail('도적떼가 와 있는데 [도적단 퇴치] 판이 없다');
  // 바닥 명령 판은 두 걸음에서 같은 높이여야 한다 — [파수꾼 관리] ↔ [뒤로 가기]로 바뀔 때 들썩이지 않게
  const cmdBox = () => page.$eval('.scr-building-farm .frm-cmd', (el) => {
    const r = el.getBoundingClientRect(); const b = el.querySelector('.btn')!.getBoundingClientRect();
    return `${Math.round(r.top)}/${Math.round(r.height)}/${Math.round(b.height)}`;
  });
  const cmdHome = await cmdBox();
  await page.click('[data-action="manageGuards"]');
  await page.waitForSelector('.scr-building-farm [data-field="guardList"]', { timeout: 10_000 });
  const cmdGuards = await cmdBox();
  if (cmdHome !== cmdGuards) await fail(`명령 판이 걸음마다 다르다 — 홈 ${cmdHome} · 관리 ${cmdGuards} (위/판/단추)`);
  const empties = await page.$$eval('.frm-grow[data-empty="1"]', (els) => els.map((e) => (e as HTMLElement).dataset['piece']));
  if (empties.join() !== 'King,Rock') await fail(`빈 줄이 농지 Lv2의 두 자리가 아니다 — [${empties.join()}]`);
  if (await page.$('.frm-grow[data-empty="1"] [data-action="releaseGuard"]')) await fail('빈 줄에 [해제]가 있다');
  /** 한 줄의 [선택] → 장수 일람 팝업에서 첫 장수를 체크 → [선택하기] */
  const pickFor = async (piece: string, nth = 0): Promise<void> => {
    await page.click(`.frm-grow[data-piece="${piece}"] [data-action="pickGuard"]`);
    await page.waitForSelector('[data-modal="officerPick"]');
    await page.click(`[data-modal="officerPick"] [data-action="equipPick"]:not([disabled]) >> nth=${nth}`);
    await page.click('[data-modal="officerPick"] [data-action="equipConfirm"]');
    await page.waitForSelector('[data-modal="officerPick"]', { state: 'detached' });
  };
  // King보다 먼저 Rock을 세우면 규칙이 거부하고 이유가 줄 밑에 뜬다
  await pickFor('Rock');
  if (!(await page.$('.frm-guards [data-field="error"]'))) await fail('King 없이 Rock을 세웠는데 이유가 안 뜬다');
  await pickFor('King');
  // 첫 장수는 이미 King이다 — 그를 Rock으로 옮기면 King이 비어 규칙이 거부한다. 다른 장수를 세운다
  await pickFor('Rock', 1);
  const rows = await page.$$eval('.frm-grow[data-officer]', (els) => els.map((e) => (e as HTMLElement).dataset['piece']));
  if (rows.join() !== 'King,Rock') await fail(`파수꾼 줄이 이상하다 — [${rows.join()}]`);
  // 단추는 토글이다 — 찬 줄은 [해제]만, 빈 줄은 [선택]만
  if (await page.$('.frm-grow[data-officer] [data-action="pickGuard"]')) await fail('찬 줄에 [선택]이 같이 떠 있다');
  const kingLocked = await page.$eval('.frm-grow[data-piece="King"] [data-action="releaseGuard"]', (b) => (b as HTMLButtonElement).disabled);
  if (!kingLocked) await fail('다른 파수꾼이 있는데 King을 뺄 수 있다');
  await shot('raid-02-farm-guards');
  await until(row, (p) => (p.farmGuards ?? []).length === 2, '파수꾼 둘이 서버에 저장');
  ok('파수꾼 King · Rock — 서버에 남았다, King은 혼자일 때만 뺀다');

  // ── 출정이 막힌다 ────────────────────────────────────────────
  step('병영 [출정하기]가 막혀 있다');
  await page.click('[data-action="backHome"]');
  const guardCount = await page.getAttribute('.scr-building-farm [data-field="guards"]', 'data-count');
  if (guardCount !== '2') await fail(`현황판의 파수꾼 수가 이상하다 — ${guardCount}`);
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main');
  // 산 너머에서 돌아왔다 — 성 안으로 들어간다
  if (!(await page.$('[data-place="barracks"]'))) await page.click('.city-gate rect');
  await page.click('[data-place="barracks"]');
  await page.waitForSelector('[data-action="sortie"]');
  const sortieDisabled = await page.$eval('[data-action="sortie"]', (b) => (b as HTMLButtonElement).disabled);
  if (!sortieDisabled) await fail('도적떼가 살아 있는데 [출정하기]가 눌린다');
  if (!(await page.$('[data-field="sortieBlocked"]'))) await fail('막힌 이유가 제 단추 밑에 없다');
  await shot('raid-03-sortie-blocked');
  ok('출정이 막혔고 이유가 적혀 있다');

  // ── 메인의 [전투하기] → 방어전 ──────────────────────────────
  step('메인의 [전투하기] → 25×15 방어전');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main [data-action="raidFight"]', { timeout: 10_000 })
    .catch(() => fail('메인의 도시 이름 옆에 [전투하기]가 없다'));
  await shot('raid-04-main-fight');
  await page.click('.scr-main [data-action="raidFight"]');
  await page.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'deploying', undefined, { timeout: 20_000 })
    .catch(() => fail('[전투하기]를 눌렀는데 배치 단계가 안 온다'));
  const board = await page.evaluate(() => {
    const s = (window as any).__battle.scene.debugPlayback.state;
    const units = Object.values(s.units as Record<string, any>);
    return {
      size: s.boardSize, scenario: s.scenario, terrain: s.terrain.length,
      king: units.find((u: any) => u.id === 'P1-King')?.pos,
      bandits: units.filter((u: any) => u.side === 'P2').map((u: any) => u.piece),
    };
  });
  if (board.scenario !== 'raid' || board.size.x !== 25 || board.size.y !== 15) await fail(`판이 도적떼 판이 아니다 — ${JSON.stringify(board)}`);
  if (board.terrain !== 9) await fail(`성채가 3×3이 아니다 — 지형 ${board.terrain}칸`);
  if (board.king?.x !== 12 || board.king?.y !== 12) await fail(`파수꾼 King이 성채 한가운데가 아니다 — ${JSON.stringify(board.king)}`);
  if (board.bandits.join() !== 'King,Queen') await fail(`도적이 이상하다 — ${board.bandits.join()}`);
  const fightingRow = await until(row, (p) => p.raid?.status === 'fighting', '서버가 전투 시작을 굳혔다');
  ok(`판 25×15 · 성채 9칸 · King (12,12) · 도적 [${board.bandits.join()}] · 서버 시드 ${fightingRow.raid!.battle!.seed}`);
  await page.waitForTimeout(800);
  await shot('raid-05-deploy');

  // ── 준비 → 내 차례 → 항복 ────────────────────────────────────
  step('준비 → 내 차례에 항복 (판 안의 항복은 패배다 — 살아 있는 도적 수만큼)');
  await page.click('.prep-go');
  await page.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'awaitingInput', undefined, { timeout: 60_000 })
    .catch(() => fail('60초를 기다려도 내 차례가 오지 않는다'));
  await page.waitForTimeout(600);
  await shot('raid-06-battle');
  await page.click('.hud-more');
  await page.waitForTimeout(250);
  await page.click('[data-action="surrender"]');
  await page.waitForSelector('[data-screen="raidResult"]', { timeout: 30_000 })
    .catch(() => fail('항복했는데 결과 화면이 안 뜬다'));
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => {
    const scr = document.querySelector('[data-screen="raidResult"]') as HTMLElement;
    return {
      raid: scr.dataset['raid'],
      loot: Number((scr.querySelector('[data-field="loot"]') as HTMLElement | null)?.dataset['loot'] ?? -1),
      error: scr.querySelector('[data-field="error"]')?.textContent ?? null,
    };
  });
  if (result.error) await fail(`결과가 서버에 안 남았다 — ${result.error}`);
  if (result.raid !== 'lost') await fail(`판 안의 항복이 패배로 정산되지 않았다 — ${result.raid}`);
  const lostRow = await until(row, (p) => p.raid?.status === 'lost', '서버 정산');
  const wantLoot = Math.floor((fightingRow.raid!.grainAtSpawn * 2 * 10) / 100);
  if (lostRow.raid!.loot !== wantLoot || result.loot !== wantLoot) {
    await fail(`약탈량이 이상하다 — 화면 ${result.loot} · 서버 ${lostRow.raid!.loot} · 기대 ${wantLoot}`);
  }
  await shot('raid-07-result');
  ok(`패배 — 도적 2명 × 10% = 군량 ${wantLoot} 약탈 (재생 검증을 지나 서버가 정산)`);

  step('끝나면 출정이 다시 열린다');
  await page.click('[data-action="home"]');
  await page.waitForSelector('.scr-main');
  if (await page.$('.scr-main [data-action="raidFight"]')) await fail('끝났는데 [전투하기]가 남아 있다');
  if (!(await page.$('[data-place="barracks"]'))) await page.click('.city-gate rect');
  await page.click('[data-place="barracks"]');
  await page.waitForSelector('[data-action="sortie"]');
  if (await page.$eval('[data-action="sortie"]', (b) => (b as HTMLButtonElement).disabled)) await fail('끝났는데 [출정하기]가 막혀 있다');
  ok('출정이 열렸다 · 메인의 [전투하기]가 사라졌다');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main');

  // ── 마지막 알림 (남은 1분) ────────────────────────────────────
  step('남은 1분 — 마지막 알림이 [지금 전투]/[항복]을 묻는다 (출몰 시각을 9분 30초 전으로 심는다)');
  const today = raidDay(Date.now());
  await seed((p) => ({
    ...p, grain: 40,
    raid: { day: today, bandits: 2, spawnedAt: Date.now() - 9.5 * MIN, grainAtSpawn: 40, status: 'pending' },
  }));
  await page.waitForSelector('[data-modal="raidAlert"][data-kind="lastCall"]', { timeout: 5_000 })
    .catch(async () => fail(`마지막 알림이 안 떴다 (떠 있는 것: ${await alertKind()})`));
  await shot('raid-08-last-call');
  await page.click('[data-action="raidSurrender"]');
  await page.waitForSelector('[data-modal="raidAlert"][data-kind="settled"]', { timeout: 10_000 })
    .catch(() => fail('[항복]을 눌렀는데 약탈 알림이 안 뜬다'));
  const surrendered = await until(row, (p) => p.raid?.status === 'surrendered', '서버 항복 정산');
  if (surrendered.raid!.loot !== 8) await fail(`항복 약탈이 이상하다 — ${surrendered.raid!.loot} (40 × 20% = 8)`);
  await page.click('[data-action="raidOk"]');
  ok('마지막 알림 → [항복] → 출몰한 2명 × 10% = 8 약탈');

  // ── 자동 항복 (10분이 지났다) ─────────────────────────────────
  step('10분이 지났다 — 들어오면 서버가 이미 항복으로 정산해 두었고 화면은 알리기만 한다');
  await seed((p) => ({
    ...p, grain: 40,
    raid: { day: today, bandits: 2, spawnedAt: Date.now() - 11 * MIN, grainAtSpawn: 40, status: 'pending' },
  }));
  await page.waitForSelector('[data-modal="raidAlert"][data-kind="settled"]', { timeout: 5_000 })
    .catch(async () => fail(`자동 항복 알림이 안 떴다 (떠 있는 것: ${await alertKind()})`));
  const auto = await row();
  if (auto.raid?.status !== 'surrendered' || auto.raid.loot !== 8) await fail(`서버 자동 항복이 이상하다 — ${JSON.stringify(auto.raid)}`);
  await shot('raid-09-auto-surrender');
  await page.click('[data-action="raidOk"]');
  // 같은 사건의 알림은 새로고침해도 다시 안 뜬다(브라우저 편의)
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main');
  await page.waitForTimeout(1500);
  if (await alertKind()) await fail(`이미 본 자동 항복 알림이 새로고침에 다시 떴다 (${await alertKind()})`);
  ok('자동 항복 — 서버가 정산하고 화면은 한 번만 알린다');

  /*
   * 알고 있는 둘은 빼고 본다 — **도적떼와 무관하고 이 검사로 고칠 것도 아니다.**
   * · 새 계정의 첫 `GET /profile` 404 — 도시를 만들기 전에는 서버에 행이 없다(정상 경로)
   * · `vfx:cast-*` — 시전 링은 `npm run vfx`가 `assets/`에서 굽는데, 이 기계의 `public/vfx/`가
   *   그 그림이 생기기 전에 구운 것이라 모든 전투에서 뜬다. 다시 구우면 사라진다
   */
  const real = errors.filter((e) => !/^404 .*\/profile$/.test(e) && !/vfx:cast-/.test(e));
  if (real.length) await fail(`콘솔 오류 ${real.length}건:\n    ${real.join('\n    ')}`);
  ok(`콘솔 오류 없음 (알려진 것 ${errors.length - real.length}건 제외)`);
  console.log('\n★ 도적떼 확인 완주');
} catch (e) {
  await fail(`예외 — ${e instanceof Error ? e.stack : String(e)}`);
}
await cleanup();
