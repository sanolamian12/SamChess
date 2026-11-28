/**
 * 대장간 연구 눈 확인 — 현황판 · 고르기(몫만큼) · 취소 · 축하(1 · 2 · 3 · 4 · 5개) · 장터 진열 (2026-11-28 대장간 연구 개편 ②)
 *
 *   npm run look:forge                      (휴대폰 최소사양 393×852 · 한국어)
 *   UI_LANG=mn SHOTS=<dir> npm run look:forge
 *
 * 필요한 것: `npm run dev`(5173) · `npm run server-api`(8787). 1시간을 기다릴 수 없어 **서버 쪽에서 시작 시각을 당겨** 끝낸다
 * (`saveProfileTrusted` — 개발용 지급이 꺼져 있어도 돈다). 대장간 Lv5 · 장터 Lv1 계정을 심고 Lv1부터 Lv5까지 차례로 연구한다.
 *
 * 보는 것.
 *  - 고르기 판: 몫(Lv)만큼만 체크되고, 차면 나머지 줄이 잠긴다 · 몫을 채워야 [연구 시작] · 판이 화면 안에 든다(스크롤 없음)
 *  - 연구 중 · 취소(무료 — 같은 레벨을 다시 고른다)
 *  - 축하: 병기 수(`data-n`)와 붓선 줄 수가 같다 · 1 가운데 · 2 좌우 · 3+ 두 줄(삼각형)
 *  - [확인] 뒤 서버의 `notice`가 비고 장터 [전투 아이템]에 그 병기가 진열된다
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { FORGE_RESEARCH_MS, forgeCandidates, forgeQuota } from '@samchess/meta';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { shotDir } from './shotDir.ts';
import { MIN_SPEC, MIN_SPEC_PORTRAIT } from './minSpec.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? shotDir('forge_research_ux');
const LANG = process.env['UI_LANG'] ?? '';

const fail = (m: string): never => { throw new Error(m); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);

const email = `forge-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: MIN_SPEC_PORTRAIT, deviceScaleFactor: MIN_SPEC.dpr });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
page.on('response', (r) => { if (r.status() === 404 && new URL(r.url()).pathname !== '/profile') errors.push(`404 ${new URL(r.url()).pathname}`); });
const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

async function toForge(): Promise<void> {
  await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });
  await page.click('.city-gate rect', { force: true });   // 배경이 떠다녀 「안정」을 안 기다린다
  await page.waitForSelector('[data-place="forge"]');
  await page.click('[data-place="forge"]', { force: true });
  await page.waitForSelector('.scr-building-forge [data-field="status"]');
}
const current = () => page.getAttribute('[data-field="current"]', 'data-state');

/** 판이 화면 안에 들고 안에서 넘치지 않는가 — 「어느 화면에도 스크롤이 없다」(2026-11-25) */
async function fits(sel: string, what: string): Promise<void> {
  const m = await page.$eval(sel, (e) => {
    const r = e.getBoundingClientRect();
    // 글자 칸만 본다 — 그림 칸(병기 그림 · 섬광)은 뒤의 섬광을 일부러 잘라 둔다
    const over = [...e.querySelectorAll('*')].filter((x) => (x as HTMLElement).scrollHeight - (x as HTMLElement).clientHeight > 1
      && getComputedStyle(x).overflow === 'hidden' && (x as HTMLElement).clientHeight > 0
      && !x.querySelector('img') && (x.textContent ?? '').trim() !== '').length;
    return { top: r.top, bottom: r.bottom, vh: window.innerHeight, over };
  });
  if (m.top < -1 || m.bottom > m.vh + 1) fail(`${what} — 판이 화면 밖으로 나간다 ${JSON.stringify(m)}`);
  if (m.over > 0) fail(`${what} — 판 안에서 잘린 칸 ${m.over}개`);
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  if (LANG) await page.evaluate((l) => localStorage.setItem('samchess.lang', l), LANG);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', `대장간실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
  }

  step('대장간 Lv5 · 장터 Lv1을 심는다');
  const stored = (await getProfile(uid))!;
  await saveProfileTrusted(uid, { ...stored, cityLevel: 5, buildings: { ...stored.buildings, forge: 5, market: 1 } });
  await page.reload({ waitUntil: 'networkidle' });
  await toForge();
  await shot('frg-01-home');
  if (await current() !== 'idle') fail('연구 중이 아닌데 「없음」이 아니다');
  if (await page.$('[data-field="researched"] .frg-rs-chip')) fail('연구한 적이 없는데 병기 그림이 있다');
  if (!await page.$('[data-action="openResearch"].primary:not([disabled])')) fail('[연구하기]가 옥색 목판이 아니다');
  ok('Lv5 · 연구 0/15 · 연구 중 없음 · 바닥에는 [연구하기]');

  for (let level = 1; level <= 5; level++) {
    const quota = forgeQuota(level);
    step(`Lv${level} — 병기 ${quota}개 고르기`);
    await page.click('[data-action="openResearch"]');
    await page.waitForSelector('[data-modal="forgePick"] .frg-rs-row');
    if (await page.getAttribute('[data-modal="forgePick"]', 'data-level') !== String(level)) fail(`Lv${level}이 아닌 레벨이 열렸다`);
    const rows = await page.$$eval('[data-modal="forgePick"] .frg-rs-row', (els) => els.map((e) => (e as HTMLElement).dataset.item!));
    const expect = forgeCandidates((await getProfile(uid))!, level).map((e) => e.id);
    if (rows.join() !== expect.join()) fail(`후보가 규칙과 다르다 — ${rows} / ${expect}`);
    if (!await page.$('[data-action="startResearch"][disabled]')) fail('아무것도 안 골랐는데 [연구 시작]이 켜져 있다');
    for (const id of rows.slice(0, quota)) await page.click(`[data-modal="forgePick"] .frg-rs-row[data-item="${id}"]`);
    const locked = await page.$$eval('[data-modal="forgePick"] .frg-rs-row[disabled]', (els) => els.length);
    if (locked !== rows.length - quota) fail(`몫을 채웠는데 잠긴 줄이 ${locked}개다 — ${rows.length - quota}개여야`);
    if (!await page.$('[data-action="startResearch"]:not([disabled])')) fail('몫을 채웠는데 [연구 시작]이 꺼져 있다');
    await fits('[data-modal="forgePick"] .ofcpick-modal', `Lv${level} 고르기 판`);
    await shot(`frg-${level}-pick`);
    ok(`후보 ${rows.length}개 · ${quota}개 골라 나머지 ${locked}개 잠김 · 화면 안`);

    await page.click('[data-action="startResearch"]');
    await page.waitForSelector('[data-modal="forgePick"]', { state: 'detached' });
    if (await current() !== 'researching') fail('연구를 시작했는데 「연구 중」이 아니다');
    if (level === 1) {
      await shot('frg-1-researching');
      step('취소 — 무료, 같은 레벨을 다시 고른다');
      await page.click('[data-action="cancelResearch"]');
      await page.click('[data-action="confirmCancel"]');
      await page.waitForSelector('[data-modal="forgeCancel"]', { state: 'detached' });
      if (await current() !== 'idle') fail('취소했는데 연구 중이다');
      await page.click('[data-action="openResearch"]');
      await page.waitForSelector('[data-modal="forgePick"] .frg-rs-row');
      await page.click(`[data-modal="forgePick"] .frg-rs-row[data-item="${rows[0]}"]`);
      await page.click('[data-action="startResearch"]');
      await page.waitForSelector('[data-modal="forgePick"]', { state: 'detached' });
      ok('취소 뒤 같은 레벨을 다시 연구');
    }

    // 1시간을 당긴다 — 서버의 시작 시각을 연구 시간만큼 앞으로
    const p = (await getProfile(uid))!;
    const r = p.forge!.research!;
    await saveProfileTrusted(uid, { ...p, forge: { ...p.forge!, research: { ...r, startedAt: Date.now() - FORGE_RESEARCH_MS - 1000 } } });
    await page.reload({ waitUntil: 'networkidle' });
    // 메인 — [연구 완료] 단추 · 대장장이의 부름(첫 번만 부른다). 단추를 누르면 대장간으로 가서 축하가 뜬다
    await page.waitForSelector('#frame:not([data-arrive]) [data-action="forgeGo"]', { timeout: 20_000 });
    if (level === 1) {
      await page.waitForSelector('.stw[data-say="forgeReady"]', { timeout: 10_000 });
      await page.waitForTimeout(800);
      await shot('frg-1-main-call');
    }
    await page.click('[data-action="forgeGo"]', { force: true });
    await page.waitForSelector('.cel-back[data-phase="charge"][data-intro="forge"]', { timeout: 30_000 });
    await page.waitForSelector('[data-modal="forgeNotice"]', { timeout: 15_000 });
    await page.waitForTimeout(1_800);   // 내려찍기 · 섬광이 끝난 뒤
    const n = Number(await page.getAttribute('[data-modal="forgeNotice"] .frg-cel-set', 'data-n'));
    const lines = await page.$$eval('[data-modal="forgeNotice"] [data-field="doneItem"]', (els) => els.length);
    const setRows = await page.$$eval('[data-modal="forgeNotice"] .frg-cel-setrow', (els) => els.map((e) => e.children.length).join('/'));
    if (n !== quota || lines !== quota) fail(`축하의 병기 ${n} · 붓선 줄 ${lines} — ${quota}개여야`);
    const want = quota <= 2 ? String(quota) : quota === 5 ? '2/3' : `1/${quota - 1}`;
    if (setRows !== want) fail(`배치가 ${setRows}다 — ${want}여야`);
    await fits('[data-modal="forgeNotice"] .cel-stage, [data-modal="forgeNotice"]', `Lv${level} 축하`);
    await shot(`frg-${level}-celebrate`);
    ok(`축하 — 병기 ${n} · 줄 ${lines} · 배치 ${setRows}`);
    await page.click('[data-action="ackDone"]');
    await page.waitForSelector('[data-modal="forgeNotice"]', { state: 'detached', timeout: 10_000 });
    let after = (await getProfile(uid))!;
    for (let i = 0; i < 20 && after.forge?.notice?.length; i++) { await page.waitForTimeout(250); after = (await getProfile(uid))!; }
    if (after.forge?.notice?.length) fail('[확인]했는데 서버의 notice가 남았다');
    ok('[확인] — 서버의 notice가 비었다');
  }

  step('현황판 — 연구 15/15 · 병기 그림을 누르면 한 장');
  await shot('frg-6-alldone');
  const chips = await page.$$eval('[data-field="researched"] .frg-rs-chip', (els) => els.length);
  if (chips !== 15) fail(`연구한 병기 그림이 ${chips}개다`);
  if (!await page.$('[data-action="openResearch"][disabled]')) fail('다 끝냈는데 [연구하기]가 켜져 있다');
  await page.click('[data-field="researched"] .frg-rs-chip[data-item="bang-cheon-hwa-geuk"]');
  await page.waitForSelector('[data-modal="forgeDone"]');
  await shot('frg-7-peek');
  await page.click('[data-action="closeDone"]');
  ok('그림 15개 · [연구하기] 꺼짐 · 한 장이 뜬다');

  step('장터 [전투 아이템] — 연구한 병기가 진열된다(장터 Lv1)');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('[data-place="market"]', { force: true }).catch(async () => {
    await page.click('.city-gate rect', { force: true });
    await page.click('[data-place="market"]', { force: true });
  });
  await page.waitForSelector('[data-action="openItems"]', { timeout: 10_000 });
  await page.click('[data-action="openItems"]');
  await page.waitForSelector('[data-field="itemShop"]');
  await shot('frg-8-market');
  const shelf = (await getProfile(uid))!;
  if (shelf.forge?.done.flatMap((d) => d.items).length !== 15) fail('서버의 연구가 15가 아니다');
  ok('장터 진열을 찍었다(목록 화면은 다음 단계에서 3×4로 다시 짠다)');

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' | ')}`);
  console.log(`\n✓ 대장간 연구 한 바퀴 완주 — 사진 ${SHOTS}`);
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  await shot('zz-fail').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
