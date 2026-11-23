/**
 * 병기 제작 카운트다운 · 완성 부름 확인 (2026-11-23 기획자).
 *
 *   node --experimental-strip-types --env-file=.env tools/forge_timer_ux.ts
 *
 * 흐름 — 제작 중인 계정(약 15초 남음)으로 메인에 들어가 [병기구 제작 m:ss] 초록 단추를 보고, **다른 화면(궁궐)**으로 가서
 * 끝나는 순간 대장장이가 아래에서 부르는지, 메인으로 돌아와 [제작 완료]를 누르면 대장간으로 가 7초 축하가 뜨는지 본다.
 *
 * 기획자 실기의 고장도 재현한다 — 이 브라우저가 **다른 계정에서 같은 병기 #1의 축하를 이미 봤다**(`samchess.forge.celebrated`에
 * 옛 꼴 `{id}#1`). 「봤다」 열쇠가 자루 번호뿐이던 때는 새 계정의 첫 자루도 건너뛰었다(`forgeSeen.ts`).
 * 화면 사진은 OS 임시 폴더(`shotDir`).
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { equipmentById } from '@samchess/data';
import { forgeOrderRemainingMs } from '@samchess/meta';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { shotDir } from './shotDir.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = shotDir('forge_timer_ux');
const ITEM = process.env['ITEM'] ?? 'su-geuk';   // 만들 병기 — 기본은 대장간 Lv1의 수극(`ITEM=sa-ja-tu-gu`처럼 바꿔 다른 레벨의 줄 색을 본다)
const LEFT_MS = 15_000;

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);
const admin = { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };

const email = `forge-timer-${randomUUID()}@samchess.test`;
const password = randomUUID();
const uid = (await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
})).json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 1200 } });
let failed = false;

/** 다른 안내(화면 첫 안내 등)가 서 있으면 ✔로 넘긴다 — 부름은 다른 사람이 말하는 동안 기다린다 */
const passOtherGuides = async (): Promise<void> => {
  const other = await page.$('.stw:not([data-say="forgeReady"])[data-phase="in"] [data-action="guideNext"]');
  if (other) await other.click().catch(() => {});
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // 다른 계정에서 같은 병기 #1의 축하를 이미 본 브라우저
  await page.evaluate((item) => { localStorage.clear(); localStorage.setItem('samchess.forge.celebrated', JSON.stringify([`${item}#1`])); }, ITEM);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', `제작시계-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 10_000 });
  }

  step(`제작 중(약 ${LEFT_MS / 1000}초 남음)인 계정을 심는다`);
  const stored = (await getProfile(uid))!;
  const now = Date.now();
  const full = forgeOrderRemainingMs({ ...stored, forgeOrder: { equipmentId: ITEM, startedAt: now } }, now);
  await saveProfileTrusted(uid, {
    ...stored,
    buildings: { ...stored.buildings, forge: equipmentById.get(ITEM)!.unlockLevel },
    forgeOrder: { equipmentId: ITEM, startedAt: now - (full - LEFT_MS) },
  });
  ok(`제작 기간 ${Math.round(full / 1000)}초 중 ${LEFT_MS / 1000}초 남김`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });

  step('메인 — 오른쪽 위 초록 두루마리 [병기구 제작 m:ss]');
  const timer = await page.waitForSelector('[data-field="forgeTimer"][data-forge="crafting"]', { timeout: 10_000 });
  const t1 = await timer.$eval('[data-field="forgeLeft"]', (el) => el.textContent);
  await page.waitForTimeout(2_100);
  const t2 = await page.$eval('[data-field="forgeLeft"]', (el) => el.textContent);
  if (t1 === t2) throw new Error(`남은 시간이 안 흐른다: ${t1} → ${t2}`);
  const img = await timer.evaluate((el) => getComputedStyle(el).borderImageSource);
  if (!img.includes('btn-primary')) throw new Error(`초록 두루마리가 아니다: ${img}`);
  await page.screenshot({ path: `${SHOTS}/1-main-crafting.png` });
  ok(`남은 시간이 흐른다 (${t1} → ${t2}), 옥색 두루마리`);

  step('다른 화면(궁궐)으로 — 끝나는 순간 대장장이가 아래에서 부르는가');
  for (let i = 0; i < 10 && !(await page.$('.scr-place, [data-screen="place"]')); i += 1) {
    await passOtherGuides();
    await page.click('[data-place="palace"]', { force: true }).catch(() => {});
    await page.waitForTimeout(800);
  }
  const deadline = Date.now() + LEFT_MS + 20_000;
  while (Date.now() < deadline && !(await page.$('.stw[data-say="forgeReady"][data-phase="in"]'))) {
    await passOtherGuides();
    await page.waitForTimeout(400);
  }
  const call = await page.$('.stw[data-say="forgeReady"][data-phase="in"]');
  if (!call) throw new Error('끝났는데 다른 화면에서 대장장이가 안 불렀다');
  if (await page.$('.scr-main')) throw new Error('궁궐로 못 가고 메인에 남아 있다 — 「다른 화면」 검사가 안 됐다');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/2-palace-call.png` });
  ok('궁궐에서 대장장이가 불렀다');
  await call.$('[data-action="guideNext"]').then((b) => b?.click()).catch(() => {});

  step('메인으로 — [제작 완료]를 누르면 대장간으로 가 7초 축하');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  const done = await page.waitForSelector('[data-field="forgeTimer"][data-forge="done"]', { timeout: 10_000 });
  // 한 번 불렀으면 메인에서 또 부르지 않는다 — 제작일이 화면 정산과 서버 정산에서 갈리면(거둔 시각을 찍던 때) 같은 자루가 새 열쇠가 되어 또 불렀다
  await page.waitForTimeout(3_000);
  if (await page.$('.stw[data-say="forgeReady"]')) throw new Error('궁궐에서 부른 자루를 메인에서 또 불렀다');
  await page.screenshot({ path: `${SHOTS}/3-main-done.png` });
  ok('메인에서는 또 부르지 않는다');
  await done.click({ force: true });
  await page.waitForSelector('.cel-back[data-phase="charge"][data-intro="forge"]', { timeout: 10_000 });
  ok('대장간 도입부(망치질)가 시작됐다');
  await page.waitForSelector('.cel-back[data-phase="show"] [data-action="ackDone"]', { timeout: 10_000 });
  await page.waitForTimeout(1_500);   // 무대가 열리는 섬광이 걷힌 뒤에 찍는다
  await page.screenshot({ path: `${SHOTS}/4-forge-done.png` });
  await page.click('[data-action="ackDone"]');
  await page.waitForSelector('.cel-back', { state: 'detached', timeout: 5_000 });
  ok('제작 완료 축하를 봤다');

  step('다시 메인 — 단추가 사라졌는가');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.waitForTimeout(1_500);
  if (await page.$('[data-field="forgeTimer"]')) throw new Error('축하를 본 뒤에도 메인에 제작 단추가 남았다');
  ok('단추가 사라졌다');
  console.log(`\n사진: ${SHOTS}`);
} catch (e) {
  failed = true;
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  await page.screenshot({ path: `${SHOTS}/fail.png` }).catch(() => {});
  console.error(`  사진: ${SHOTS}/fail.png`);
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: admin });
  console.log('✓ 시험 계정 정리');
  process.exit(failed ? 1 : 0);
}
