/**
 * 전투 아이템 화면 눈 확인 (2026-11-27 — 용병 시장 꼴로 다시 짠 초안)
 *
 *   node --env-file=.env tools/items_shop_ux.ts            (UI_LANG=mn 처럼 언어 · VW/VH로 크기)
 *
 * 필요한 것: `npm run dev`(5173) · `npm run server-api`(8787). 시험 계정을 만들어 장터 Lv5 · 금화 · 보관함 한 칸 남김을 심고
 * 전투 아이템 → 쪽마다 판 높이 → 카드 누름(확인 판) → 구매 → 보관함 가득(붉은 수 · 막힘) 순서로 찍는다. 계정은 끝에 지운다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { MIN_SPEC } from './minSpec.ts';
import { MARKET_ITEMS } from '@samchess/data';
import { GUIDE_IDS } from '@samchess/meta';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { shotDir } from './shotDir.ts';

const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? shotDir('items_shop_ux');
const LANG = process.env['UI_LANG'] ?? '';

const fail = (m: string): never => { throw new Error(m); };
const ok = (m: string): void => console.log(`  ✓ ${m}`);

const email = `items-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? MIN_SPEC.width), height: Number(process.env['VH'] ?? MIN_SPEC.height) },
  deviceScaleFactor: 2,
});
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (name: string): Promise<void> => { await page.screenshot({ path: `${SHOTS}/items-${LANG || 'ko'}-${name}.png` }); };

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
    await page.fill('.scr-new .newgame-form input', `템성${Math.floor(Math.random() * 9000 + 1000)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });
  }
  const base = (await getProfile(uid))!;
  // 안내는 다 본 것으로 — 장터 안내가 화면을 덮지 않게. 보관함은 한 칸 남기고 채운다(사고 나면 가득 → 붉은 글자 · 막힘)
  const cap = 80;
  await saveProfileTrusted(uid, {
    ...base, gold: 50, cityLevel: 5, buildings: { ...base.buildings, market: 5 },
    marketOwned: { 'tang-yak': cap - 1 },
    guide: { seen: [...GUIDE_IDS] },
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  for (let i = 0; i < 6; i += 1) {
    await page.click('[data-place="market"]', { force: true });
    if (await page.waitForSelector('[data-action="openItems"]', { timeout: 2_000 }).catch(() => null)) break;
  }
  await page.click('[data-action="openItems"]');
  await page.waitForSelector('[data-field="itemShop"] .mkt-item-cards .mkt-item-card', { timeout: 5_000 });
  await page.waitForTimeout(800);
  await shot('1-list');

  // 쪽마다 판 높이 · 카드 높이 — 언어 · 쪽과 무관하게 하나여야 한다
  const heights: string[] = [];
  for (let p = 0; ; p += 1) {
    const m = await page.evaluate(() => {
      const panel = document.querySelector('[data-field="itemShop"]') as HTMLElement;
      const cards = [...document.querySelectorAll('.mkt-item-cards > .mkt-item-card')] as HTMLElement[];
      const scr = document.querySelector('.scr') as HTMLElement;
      return {
        panel: Math.round(panel.getBoundingClientRect().height),
        cards: cards.map((c) => Math.round(c.getBoundingClientRect().height)),
        rowH: panel.style.getPropertyValue('--row-h'),
        overflow: cards.filter((c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1).map((c) => c.getAttribute('data-item')),
        scroll: scr.scrollHeight - scr.clientHeight,
        next: !(document.querySelector('.page-arrow[data-dir="next"]') as HTMLButtonElement | null)?.disabled,
        store: Math.round((document.querySelector('.mkt-to-storage') as HTMLElement).getBoundingClientRect().width),
        rowW: (document.querySelector('.mkt-to-storage-row') as HTMLElement).style.getPropertyValue('--row-w'),
      };
    });
    heights.push(`p${p + 1} 판 ${m.panel} · 카드 ${m.cards.join('/')} (row-h ${m.rowH}) · [보관함으로] ${m.store} (row-w ${m.rowW})`);
    if (m.overflow.length) fail(`카드가 넘쳤다 — ${m.overflow.join(', ')}`);
    if (!m.next) break;
    await page.click('.page-arrow[data-dir="next"]');
    await page.waitForTimeout(150);
    if (p === 0) {
      await shot('2-page2');
      // 위 화살 — 가장 높이 오른 순간에도 머리 판 · 몸통에 안 가린다(오르내림을 맨 위에 세우고 그 윗점을 짚는다)
      const top = await page.evaluate(() => {
        const img = document.querySelector('.page-arrow[data-dir="prev"] img') as HTMLElement;
        img.style.animation = 'none'; img.style.translate = '0 -.25rem';
        const r = img.getBoundingClientRect();
        const hits = [0.2, 0.35].map((f) => document.elementFromPoint(r.left + r.width / 2, r.top + r.height * f));
        return hits.every((h) => h === img || img.contains(h)) ? null : hits.map((h) => h?.className).join(' / ');
      });
      if (top) fail(`위 화살 윗부분이 가려진다 — ${top}`);
      ok('위 화살 — 가장 높이 올라도 안 가린다');
      await page.evaluate(() => { const img = document.querySelector('.page-arrow[data-dir="prev"] img') as HTMLElement; img.style.animation = ''; img.style.translate = ''; });
    }
  }
  console.log(heights.join('\n'));
  await shot('3-lastpage');
  while (!(await page.$eval('.page-arrow[data-dir="prev"]', (b) => (b as HTMLButtonElement).disabled))) {
    await page.click('.page-arrow[data-dir="prev"]');
  }

  // 한 칸 남음 — 2냥짜리를 누르면 확인 판 → 구매 → 가득(붉은 글자)
  const cheap = MARKET_ITEMS.find((i) => i.gold <= 3 && i.unlockLevel <= 5)!;
  await page.click(`.mkt-item-card[data-item="${cheap.id}"]`);
  await page.waitForSelector('[data-modal="itemAsk"]', { timeout: 5_000 });
  await page.waitForTimeout(400);
  await shot('4-ask');
  await page.click('[data-modal="itemAsk"] [data-action="confirmOk"]');
  // 금화 분수(1.8초) — 몇 장 찍어 둔다
  await page.waitForSelector('.cel-back[data-intro="coins"]', { timeout: 10_000 });
  for (const at of [250, 650, 1050, 1500]) {
    await page.waitForTimeout(at === 250 ? 250 : 400);
    await shot(`4b-coins-${at}`);
  }
  await page.waitForSelector('[data-modal="bought"]', { timeout: 10_000 });
  await page.waitForTimeout(1600);
  await shot('4c-bought');
  const stage = await page.evaluate(() => {
    const img = (sel: string): number => (document.querySelector(sel) as HTMLImageElement | null)?.naturalWidth ?? -1;
    const row = document.querySelector('[data-modal="bought"] [data-field="doneItem"]');
    return { stock: img('[data-modal="bought"] .cel-art-img'), medal: img('[data-modal="bought"] .itm-cel-medal'),
      small: img('[data-modal="bought"] .frg-done-medal'), item: row?.getAttribute('data-item'), text: row?.textContent?.trim() };
  });
  if (stage.stock <= 0 || stage.medal <= 0 || stage.small <= 0) fail(`무대 그림이 안 떴다 — ${JSON.stringify(stage)}`);
  if (stage.item !== cheap.id) fail(`무대의 아이템이 다르다 — ${stage.item} (산 것 ${cheap.id})`);
  ok(`무대 — 물자 상자 · 금테 메달 · 붓 획 「${stage.text}」`);
  await page.click('[data-action="boughtClose"]');
  await page.waitForSelector('.cel-back', { state: 'detached', timeout: 5_000 });
  ok('카드 → 확인 → 금화 분수 → 구매 완료 → 누르면 닫힌다');
  await page.waitForTimeout(300);
  if (await page.getAttribute('[data-field="items"]', 'data-full') !== '1') fail('보관함이 가득인데 붉은 표시가 아니다');
  await page.click(`.mkt-item-card[data-item="${cheap.id}"]`);
  await page.waitForSelector('.stw[data-say="itemsWhy"][data-say-code="market.full"]', { timeout: 5_000 });
  if (await page.$('[data-modal="itemAsk"]')) fail('못 사는데 확인 판이 떴다');
  await page.waitForTimeout(500);
  await shot('5-full');
  ok('가득 — 붉은 수 · 카드 잿빛 · 내관이 말한다');

  await page.click('[data-action="openStorage"]');
  await page.waitForSelector('[data-field="storage"]', { timeout: 5_000 });
  ok('[보관함으로] → 보관함');

  // 보관함이 비면 [보관함으로]가 막힌다
  const now = (await getProfile(uid))!;
  await saveProfileTrusted(uid, { ...now, marketOwned: {}, marketBoughtAt: {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  for (let i = 0; i < 6; i += 1) {
    await page.click('[data-place="market"]', { force: true });
    if (await page.waitForSelector('[data-action="openItems"]', { timeout: 2_000 }).catch(() => null)) break;
  }
  await page.click('[data-action="openItems"]');
  await page.waitForSelector('.mkt-to-storage', { timeout: 5_000 });
  if (await page.getAttribute('.mkt-to-storage', 'disabled') === null) fail('보관함이 비었는데 [보관함으로]가 열려 있다');
  await page.waitForTimeout(500);
  await shot('6-empty');
  ok('보관함 0개 — [보관함으로] 막힘');
  if (errors.length) console.log('콘솔 오류:', errors);
  console.log(`사진: ${SHOTS}`);
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
}
