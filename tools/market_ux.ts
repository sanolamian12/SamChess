/**
 * 장터 UX 확인 — 현황판 · 명령 셋 · 장수 아이템 구매 · 출전 준비의 지참 판
 * (GDD §6.5, 2026-09-23)
 *
 *   VW=760 VH=1200 SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/market_ux.ts
 *
 * 필요한 것: `npm run dev`(5173) · `npm run server-api`(8787).
 *
 * 새 계정에는 시장도 금화도 부대도 없어 아이템 칸이 전부 잠겨 있다. 그래서
 * **시장 Lv5 · 금화 넉넉 · 장수 셋과 부대 하나**를 서버 쪽에서 심고 돈다.
 *
 * ★ **여기서 보는 것은 「있는가」가 아니라 「제자리에 있는가」다** — 잘린 글자,
 * 넘친 칸, 작게 떠서 안 갈리는 아이콘은 회귀가 못 잡는다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { MARKET_ITEMS, OFFICERS } from '@samchess/data';
import { newInstance } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
const LANG = process.env['LANG_UI'] ?? '';

const fail = (m: string): never => { console.error(`✗ ${m}`); process.exit(1); };
const ok = (m: string): void => console.log(`  ✓ ${m}`);
const step = (m: string): void => console.log(`\n▶ ${m}`);

const email = `market-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? 760), height: Number(process.env['VH'] ?? 1200) },
  deviceScaleFactor: 2,
});
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  // 「Failed to load resource」는 무엇이 없는지를 안 적는다 — 아래 `response`가 경로를 잡는다
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
});
page.on('response', (r) => {
  const path = new URL(r.url()).pathname;
  if (r.status() === 404 && path !== '/profile') errors.push(`404 ${path}`);
});

const shot = async (name: string): Promise<void> => {
  await page.screenshot({ path: `${SHOTS}/market-${name}.png`, fullPage: true });
};

try {
  step('계정 만들기 — 시장 Lv5 · 금화 넉넉 · 부대 하나');
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
    await page.fill('.scr-new .newgame-form input', `장터성${Math.floor(Math.random() * 9000 + 1000)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  // 서버 쪽에서 심는다 — 화면으로 시장을 Lv5까지 올리려면 증축을 다섯 번 해야 한다
  const base = await getProfile(uid);
  if (!base) fail('프로필이 없다');
  const three = OFFICERS.slice(0, 3).map((o) => o.id as OfficerId);
  const roster = { ...base!.roster };
  for (const id of three) roster[id] = newInstance(id);
  await saveProfileTrusted(uid, {
    ...base!,
    gold: 500,
    buildings: { ...base!.buildings, market: 5 },
    roster,
    squads: [{
      id: 's1', name: '시험부대', mode: '3v3', createdAt: Date.now(),
      picks: [
        { piece: 'King', officer: three[0]! },
        { piece: 'Rock', officer: three[1]! },
        { piece: 'Queen', officer: three[2]! },
      ],
    }],
    squadSeq: 2,
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  ok('계정을 심었다');

  step('장터 홈 — 현황판과 명령 셋');
  // 도시 그림 층이 흘러가듯 움직여 Playwright가 「안정되지 않았다」로 기다린다 — 강제로 누른다
  await page.click('[data-place="market"]', { force: true });
  await page.waitForSelector('[data-action="gacha"]', { timeout: 10_000 });
  await page.click('[data-action="gacha"]', { force: true });
  await page.waitForSelector('[data-screen="market"]', { timeout: 10_000 });
  await shot('home');
  for (const f of ['status', 'cards', 'items', 'grainRate']) {
    if (!await page.$(`[data-field="${f}"]`)) fail(`현황판에 ${f}가 없다`);
  }
  for (const a of ['openGold', 'openMerc', 'openGoods']) {
    if (!await page.$(`[data-action="${a}"]`)) fail(`명령 판에 ${a}가 없다`);
  }
  ok('현황판 세 줄 · 명령 셋');

  step('용병 장터 — 장수 아이템 열여섯');
  await page.click('[data-action="openMerc"]');
  await page.waitForSelector('[data-field="itemShop"]', { timeout: 5_000 });
  await shot('merc');
  const rows = await page.$$('.mkt-item');
  if (rows.length !== MARKET_ITEMS.length) {
    fail(`아이템이 ${rows.length}줄이다 — ${MARKET_ITEMS.length}줄이라야 한다`);
  }
  ok(`아이템 ${rows.length}줄`);

  // ★ **그림이 실제로 뜨는가** — 404면 브라우저가 폭 0으로 그린다
  const broken = await page.$$eval('.mkt-item-art', (els) => els
    .filter((e) => !(e as HTMLImageElement).naturalWidth)
    .map((e) => (e as HTMLImageElement).getAttribute('src')));
  if (broken.length > 0) fail(`아이콘이 안 뜬다 — ${broken.join(', ')}`);
  ok('아이콘 열여섯 장이 다 뜬다');

  // ★ **줄이 칸을 넘치지 않는가** — 긴 번역에서 먼저 터지는 자리다
  const overflow = await page.$$eval('.mkt-item', (els) => els
    .filter((e) => e.scrollWidth > e.clientWidth + 1)
    .map((e) => e.getAttribute('data-item')));
  if (overflow.length > 0) fail(`줄이 넘쳤다 — ${overflow.join(', ')}`);
  ok('줄이 안 넘친다');

  step('사기 — 금화가 줄고 보유가 는다');
  const first = MARKET_ITEMS[0]!;
  const goldOf = async (): Promise<number> => Number(
    (await page.textContent(String.raw`[data-currency="gold"] .v`))?.replace(/\D/g, '') ?? '0');
  const before = await goldOf();
  await page.click(`[data-action="buyItem"][data-item="${first.id}"]`);
  await page.waitForFunction(
    (id) => document.querySelector(`[data-item="${id}"] [data-field="held"]`)?.textContent?.includes('1'),
    first.id, { timeout: 10_000 });
  const after = await goldOf();
  if (after !== before - first.gold) fail(`금화가 ${before} → ${after}다 — ${first.gold}냥이 나가야 한다`);
  ok(`${first.name} 한 개 — 금화 ${before} → ${after}`);
  await shot('bought');

  // 하루 매물이 줄었는가 — Lv2 품목은 시장 Lv5에서 하루 4개다
  const stock = await page.textContent(`[data-item="${first.id}"] [data-field="stock"]`);
  if (!stock?.includes('3')) fail(`매물이 안 줄었다 — 「${stock}」`);
  ok(`오늘 매물 4 → 3`);

  step('물자 장터 — 군량 구매');
  await page.click('[data-action="backHome"]');
  await page.click('[data-action="openGoods"]');
  await page.waitForSelector('[data-action="buyGrain"]', { timeout: 5_000 });
  await shot('goods');
  // 새 계정은 군량이 가득이라 **막혀 있어야** 한다 — 이유가 제 단추 밑에 뜬다
  const full = await page.getAttribute('[data-action="buyGrain"]', 'disabled');
  if (full === null) fail('군량이 가득인데 [군량 구매]가 열려 있다');
  // ★ **이유가 글자로 보이는가** — `title`(마우스 올림)뿐이면 모바일에선 영원히 안 뜬다
  const why = await page.textContent('[data-action="buyGrain"] [data-field="why"]');
  if (!why?.trim()) fail('막힌 이유가 화면에 안 적힌다');
  ok(`가득 차 있으면 막고 이유를 적는다 — 「${why.trim()}」`);

  step('출전 준비 — 지참 판');
  await page.goto(BASE, { waitUntil: 'networkidle' });   // 메인 → 병영 → 출정하기
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('[data-place="barracks"]', { force: true });
  await page.waitForSelector('[data-action="sortie"]', { timeout: 10_000 });
  await page.click('[data-action="sortie"]', { force: true });
  await page.waitForSelector('.scr-sortie', { timeout: 10_000 });
  await page.click('.srt-modes .btn');                   // 3v3
  await page.waitForSelector('.srt-row[data-squad]', { timeout: 10_000 });
  // 줄을 누르면 **부대 현황 팝업**이 뜬다 — 고르는 것은 체크 나무판이다(다른 몸짓)
  await page.click('.srt-row[data-squad] [data-action="pickSquad"]');
  await page.waitForSelector('[data-field="carry"]', { timeout: 10_000 });
  await shot('carry');
  // ★ **고른 부대 줄이 아직 제 판 안에 있는가** — 지참 판이 끼어들며 `.srt-list`가
  // 눌려 줄이 판 밖으로 밀리고 **아래 판 뒤로 숨은** 적이 있다. DOM에는 그대로
  // 있어 「있는가」로는 안 잡힌다(CLAUDE.md의 「있는가와 제자리에 있는가」).
  const fit = await page.evaluate(() => {
    const row = document.querySelector('.srt-row[data-squad]')?.getBoundingClientRect();
    const list = document.querySelector('.srt-list')?.getBoundingClientRect();
    return row && list ? { over: Math.round(row.bottom - list.bottom) } : null;
  });
  if (!fit) fail('부대 줄이나 판을 못 찾았다');
  if (fit.over > 0) fail(`부대 줄이 판을 ${fit.over}px 넘쳐 아래 판에 가린다`);
  ok('고른 부대 줄이 판 안에 있다');

  const picks = await page.$$('select[data-field="carry"]');
  if (picks.length !== 3) fail(`지참 줄이 ${picks.length}개다 — 3명이라야 한다`);
  ok('지참 줄 셋');

  // 실제로 들려 보내진다 — 고른 값이 남아 있는가
  await picks[0]!.selectOption(first.id);
  await page.waitForTimeout(300);
  const chosen = await picks[0]!.inputValue();
  if (chosen !== first.id) fail(`고른 것이 안 남는다 — 「${chosen}」`);
  ok(`${first.name}을 들려 보냈다`);
  await shot('carried');

  if (errors.length > 0) fail(`콘솔 오류 ${errors.length}건 — ${errors.slice(0, 3).join(' | ')}`);
  console.log(`\n장터 UX 통과 — 현황판 · 명령 셋 · 아이템 ${MARKET_ITEMS.length}종 · 구매 · 지참`);
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
