/**
 * 장터 [전투 아이템] 눈 확인 — 진열(장터 품목 + 연구한 병기) · 쪽마다 찍는다 (2026-11-28 둥근 금테)
 *
 *   npm run look:items                         (휴대폰 최소사양 · 한국어)
 *   UI_LANG=mn SHOTS=<dir> npm run look:items
 *
 * 필요한 것: `npm run dev`(5173) · `npm run server-api`(8787). 장터 Lv5 · 금화 넉넉 · 병기 열다섯 연구 끝 계정을 심는다.
 * 카드 설명이 판 밖으로 넘치거나 잘리면 실패한다(글자 칸만 잰다).
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { EQUIPMENT } from '@samchess/data';
import { forgeQuota } from '@samchess/meta';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { shotDir } from './shotDir.ts';
import { MIN_SPEC, MIN_SPEC_PORTRAIT } from './minSpec.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? shotDir('item_shop_look');
const LANG = process.env['UI_LANG'] ?? '';

const email = `items-look-${randomUUID()}@samchess.test`;
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
    await page.fill('.scr-new .newgame-form input', `장터실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
  }
  // 병기 열다섯 — 레벨마다 몫만큼(진열 순서대로) 끝냈고 축하도 봤다
  const ids = [...EQUIPMENT].sort((a, b) => a.unlockLevel - b.unlockLevel || a.order - b.order).map((e) => e.id);
  const done = [1, 2, 3, 4, 5].map((level, i) => {
    const from = [1, 2, 3, 4, 5].slice(0, i).reduce((n, l) => n + forgeQuota(l), 0);
    return { level, items: ids.slice(from, from + forgeQuota(level)), doneAt: Date.now() - 1000 };
  });
  const stored = (await getProfile(uid))!;
  await saveProfileTrusted(uid, { ...stored, cityLevel: 5, gold: 999, buildings: { ...stored.buildings, market: 5, forge: 5 }, forge: { done } });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });
  await page.click('[data-place="market"]', { force: true });
  await page.click('[data-action="openItems"]');
  await page.waitForSelector('[data-field="itemShop"] .mkt-item-card[data-item]');
  await page.waitForTimeout(600);
  for (let n = 1; n <= 12; n++) {
    await page.screenshot({ path: `${SHOTS}/items-${LANG || 'ko'}-${String(n).padStart(2, '0')}.png` });
    const clipped = await page.$$eval('[data-field="itemShop"] .mkt-item-card[data-item] :is(.mkt-item-nm, .mkt-item-fx)', (els) =>
      els.filter((e) => (e as HTMLElement).scrollHeight - (e as HTMLElement).clientHeight > 1 || (e as HTMLElement).scrollWidth - (e as HTMLElement).clientWidth > 1)
        .map((e) => e.closest('[data-item]')!.getAttribute('data-item')));
    if (clipped.length) errors.push(`쪽 ${n} — 잘린 글: ${clipped.join(', ')}`);
    const next = await page.$('[data-field="itemShop"] [data-action="nextPage"]:not([disabled])');
    if (!next) break;
    await next.click();
    await page.waitForTimeout(400);
  }
  if (errors.length) throw new Error(errors.join(' | '));
  console.log(`✓ 전투 아이템 진열 — 사진 ${SHOTS}`);
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
