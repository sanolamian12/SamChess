/**
 * 도시 관리 눈 확인 — 건물 줄 · 건물 한 장(보기) · 바닥 명령 판이 궁궐 바닥 판과 같은 크기인가 (2026-11-28 기획자)
 *
 *   npm run look:city                         (휴대폰 최소사양 · 한국어)
 *   UI_LANG=mn SHOTS=<dir> npm run look:city
 *
 * 필요한 것: `npm run dev`(5173) · `npm run server-api`(8787). 도시 Lv5 · 건물 일곱을 심는다.
 * 궁궐의 바닥 판(`.plc-cmds`)과 도시 관리의 바닥 판(`.cty-acts`)의 위 · 아래 · 높이가 1px 넘게 다르면 실패한다.
 * 건물 한 장의 본문 줄이 두 줄로 접히는지 언어마다 적는다(몽골어는 접히면 글자를 키우지 않는다 — 기획자).
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { shotDir } from './shotDir.ts';
import { MIN_SPEC, MIN_SPEC_PORTRAIT } from './minSpec.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? shotDir('city_screen_look');
const LANG = process.env['UI_LANG'] ?? '';

const email = `city-look-${randomUUID()}@samchess.test`;
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
const tag = LANG || 'ko';
/** 판과 그 안 단추의 높이 · 판의 안쪽 여백 · 간격 — 바닥 판이 어긋나면 무엇이 다른지 보인다 */
const anatomy = (sel: string) => page.$eval(sel, (e) => {
  const s = getComputedStyle(e);
  return { pad: [s.paddingTop, s.paddingBottom, s.borderTopWidth, s.borderBottomWidth].join('/'), gap: s.rowGap,
    btns: [...e.querySelectorAll(':scope > .btn, :scope > * > .btn')].map((b) => { const c = getComputedStyle(b); return `${Math.round(b.getBoundingClientRect().height * 10) / 10}(${c.paddingTop} ${c.paddingBottom} ${c.borderTopWidth} ${c.borderBottomWidth} lh ${c.lineHeight} ${b.className})`; }) };
});
const rect = (sel: string) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, h: Math.round(r.height * 10) / 10 }; });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  if (LANG) await page.evaluate((l) => localStorage.setItem('samchess.lang', l), LANG);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', `도시실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
  }
  const stored = (await getProfile(uid))!;
  await saveProfileTrusted(uid, {
    ...stored, cityLevel: 5,
    buildings: { ...stored.buildings, palace: 5, barracks: 5, market: 5, farm: 5, hospital: 5, forge: 5, academy: 5 },
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });
  // 농지를 지어 두면 도적떼 알림이 뜬다 — 닫고 지나간다
  await page.waitForTimeout(1_500);
  const raid = await page.$('[data-action="raidClose"]');
  if (raid) { await raid.click(); await page.waitForTimeout(500); }
  await page.click('.city-hot[data-place="palace"]', { force: true });
  await page.waitForSelector('.plc-cmds [data-action="city"]');
  await page.waitForTimeout(500);
  const palace = await rect('.plc-cmds');
  const palaceA = await anatomy('.plc-cmds');
  await page.screenshot({ path: `${SHOTS}/${tag}-palace.png` });
  await page.click('.plc-cmds [data-action="city"]');
  await page.waitForSelector('.cty-acts [data-action="upgrade"]');
  await page.waitForTimeout(800);
  const city = await rect('.cty-acts');
  await page.screenshot({ path: `${SHOTS}/${tag}-city.png` });
  console.log(`  궁궐 바닥 판 ${JSON.stringify(palace)} · 도시 관리 바닥 판 ${JSON.stringify(city)}`);
  console.log(`  궁궐 ${JSON.stringify(palaceA)} · 도시 관리 ${JSON.stringify(await anatomy('.cty-acts'))}`);
  if (Math.abs(palace.top - city.top) > 1 || Math.abs(palace.h - city.h) > 1) errors.push(`바닥 판이 다르다 — 궁궐 ${JSON.stringify(palace)} / 도시 관리 ${JSON.stringify(city)}`);

  const ids = await page.$$eval('.cty-blds .cty-bld', (els) => els.map((e) => (e as HTMLElement).dataset.building!));
  const names = await page.$$eval('.cty-blds .cty-bld .nm', (els) => els.map((e) => getComputedStyle(e.querySelector('.gic-t') ?? e).fontSize));
  console.log(`  건물 이름 글자 ${names.join(' · ')}`);
  for (const id of ids) {
    await page.click(`.cty-bld[data-building="${id}"] [data-action="viewBuilding"]`);
    await page.waitForSelector('[data-modal="building"] .cty-peek-line');
    await page.waitForTimeout(300);
    const lines = await page.$$eval('[data-modal="building"] .cty-peek-line', (els) => els.map((e) => {
      const s = getComputedStyle(e);
      return { field: (e as HTMLElement).dataset.field, size: s.fontSize, rows: Math.round(e.getBoundingClientRect().height / (parseFloat(s.fontSize) * 1.6)) };
    }));
    console.log(`  ${id} — ${lines.map((l) => `${l.field} ${l.size} ${l.rows > 1 ? '(여러 줄)' : ''}`).join(' · ')}`);
    await page.screenshot({ path: `${SHOTS}/${tag}-peek-${id}.png` });
    await page.click('[data-action="closeBuilding"]');
    await page.waitForSelector('[data-modal="building"]', { state: 'detached' });
  }
  if (errors.length) throw new Error(errors.join(' | '));
  console.log(`✓ 도시 관리 — 사진 ${SHOTS}`);
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  await page.screenshot({ path: `${SHOTS}/zz-fail.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
