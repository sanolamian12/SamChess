/**
 * 장터 UX 확인 — pptx 75~88쪽 재구성 (2026-09-24)
 *
 *   VW=760 VH=1200 SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/market_ux.ts
 *
 * 필요한 것: `npm run dev`(5173) · `npm run server-api`(8787). 다른 자리에 띄웠으면
 * `BASE=http://localhost:5174`처럼 준다(서버 주소는 그 Vite가 `VITE_SAMCHESS_API`로 안다).
 *
 * 새 계정에는 시장도 금화도 장수도 없어 거의 다 잠겨 있다. 그래서 서버 쪽에서 **시장 Lv5 ·
 * 금화 넉넉 · 카드 정리할 C급 둘 · Lv3 장수 하나(병기를 든) · 끝낸 태학 연구 하나**를 심고,
 * 목업 한 쪽씩 누르며 간다.
 *
 * ★ **여기서 보는 것은 「있는가」가 아니라 「제자리에 있는가」다** — 잘린 글자,
 * 넘친 칸, 안 뜨는 그림은 회귀가 못 잡는다. 그리고 **판정이 서버에 실제로 남았는가**를
 * 화면 글자가 아니라 `getProfile()`로 본다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { EQUIPMENT, MARKET_ITEMS, OFFICERS } from '@samchess/data';
import { academyTopics, applyLevelUp, cardsSpentOn, cardsToLevelUp, gachaPullCost, newInstance } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = process.env['BASE'] ?? 'http://localhost:5173';
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
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
});
page.on('response', (r) => {
  const path = new URL(r.url()).pathname;
  // 전투 아이템·도시 물자 배너는 아직 그리는 중이라 **없으면 용병 시장 배너로 물러난다**(의도)
  if (r.status() === 404 && path !== '/profile' && !/^\/market\/banner-/.test(path)) errors.push(`404 ${path}`);
});

const shot = async (name: string): Promise<void> => {
  await page.screenshot({ path: `${SHOTS}/market-${name}.png` });
};
const goldOf = async (): Promise<number> => (await getProfile(uid))!.gold;
/** 팝업의 장수 목록에 뜬 장수들 */
const pickRows = async (): Promise<string[]> =>
  page.$$eval('[data-modal="officerPick"] .ofc-rows .ofc-row[data-officer]', (els) => els.map((e) => e.getAttribute('data-officer')!));
const pickOfficer = async (id: string): Promise<void> => {
  // 목록이 여러 쪽이라 **이름으로 찾아** 첫 쪽에 올린다(검색은 이름을 본다)
  if (!await page.$(`[data-modal="officerPick"] .ofc-row[data-officer="${id}"]`)) {
    await page.fill('[data-modal="officerPick"] [data-field="search"]', OFFICERS.find((o) => o.id === id)!.name);
  }
  await page.click(`[data-modal="officerPick"] .ofc-row[data-officer="${id}"] [data-action="equipPick"]`);
  await page.click('[data-modal="officerPick"] [data-action="equipConfirm"]');
};
/** 그림이 실제로 떴는가 — 404면 폭 0으로 그린다 */
const brokenImages = async (sel: string): Promise<string[]> => page.$$eval(sel, (els) => els
  .filter((e) => !(e as HTMLImageElement).complete || !(e as HTMLImageElement).naturalWidth)
  .map((e) => (e as HTMLImageElement).getAttribute('src') ?? '?'));

// ── 심을 것 ── (장수는 계정을 만든 뒤 **처음 받은 장수와 겹치지 않게** 고른다)
const gradeOf = (id: string): string | undefined => OFFICERS.find((o) => o.id === id)?.grade;
let SRC = '' as OfficerId;         // 카드 6장 — 정리할 장수(가챠에 C급이 없어 뽑기가 안 건드린다)
let DST = '' as OfficerId;         // 카드 0장 — 받을 장수(같은 C급)
let X: OfficerId | undefined;      // Lv3 · 병기를 든 장수
const WEAPON = EQUIPMENT[0]!;
const [ITEM_A, ITEM_B] = [MARKET_ITEMS[0]!, MARKET_ITEMS[5]!];   // 1쪽 · 2쪽 품목

try {
  step('계정 만들기 — 서버 쪽에서 심는다');
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

  const base = (await getProfile(uid))!;
  const fresh = (grade: string): OfficerId[] =>
    OFFICERS.filter((o) => o.grade === grade && !base.roster[o.id as OfficerId] && !base.cards[o.id as OfficerId]).map((o) => o.id as OfficerId);
  [SRC, DST] = fresh('C') as [OfficerId, OfficerId];
  [X] = fresh('D');
  let seeded = {
    ...base,
    gold: 1000,
    cityLevel: 5,
    buildings: { ...base.buildings, market: 5, academy: 1, forge: 1 },
    roster: { ...base.roster, [SRC]: newInstance(SRC), [DST]: newInstance(DST), [X!]: newInstance(X!) },
    cards: { ...base.cards, [SRC]: 6, [X!]: (cardsToLevelUp(1) ?? 0) + (cardsToLevelUp(2) ?? 0) },
  };
  // Lv3은 **정상 레벨업 두 번**으로 만든다 — 성장 스택을 손으로 적으면 `growth.length === level − 1`이 깨진다
  seeded = applyLevelUp(applyLevelUp(seeded, X!, 'hp', 'support'), X!, 'at', 'support');
  const topic = academyTopics(1)[0]!;
  await saveProfileTrusted(uid, {
    ...seeded,
    forgeOwned: { [`${WEAPON.id}#1`]: X! },
    academy: { done: [{ level: 1, tactic: topic.id as never, doneAt: Date.now() - 3_600_000 }] },
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  ok(`심었다 — 정리 ${SRC}(6장) → ${DST} · Lv3 ${X} + ${WEAPON.id}`);

  step('장터 홈 (76쪽 왼쪽) — 도시의 장터 자리가 곧장 연다');
  await page.click('[data-place="market"]', { force: true });
  await page.waitForSelector('[data-screen="market"]', { timeout: 10_000 });
  await shot('home');
  for (const f of ['status', 'marketLevel', 'items', 'cards', 'grainRate']) {
    if (!await page.$(`[data-field="${f}"]`)) fail(`현황판에 ${f}가 없다`);
  }
  for (const a of ['openGold', 'openShop']) {
    if (!await page.$(`[data-action="${a}"]`)) fail(`명령 판에 ${a}가 없다`);
  }
  const cardsLine = await page.textContent('[data-field="cards"]');
  if (!cardsLine?.includes('6')) fail(`정리 가능 카드가 안 뜬다 — 「${cardsLine}」`);
  ok(`현황판 · 명령 둘 · 「${cardsLine?.trim()}」`);

  step('상품 구매 (76쪽 오른쪽) — 배너 셋');
  await page.click('[data-action="openShop"]');
  await page.waitForSelector('[data-banner="goods"]', { timeout: 5_000 });
  await page.waitForTimeout(400);   // 배너가 없으면 물러나는 데 한 번 더 받는다
  await shot('shop');
  const broken = await brokenImages('.mkt-banner img');
  if (broken.length > 0) fail(`배너가 안 뜬다 — ${broken.join(', ')}`);
  ok('배너 셋이 뜬다');

  step('보유 카드 정리 (80·81쪽) — 섬광 없이 곧바로');
  await page.click('[data-action="openMerc"]');
  await page.waitForSelector('[data-action="openRecycle"]', { timeout: 5_000 });
  await shot('merc');
  await page.click('[data-action="openRecycle"]');
  await page.waitForSelector('[data-modal="officerPick"]', { timeout: 5_000 });
  const sources = await pickRows();
  if (sources.length !== 1 || sources[0] !== SRC) fail(`정리할 장수 목록이 ${JSON.stringify(sources)}다 — ${SRC} 하나라야 한다(3장 이상만)`);
  ok('정리할 장수 — 카드 3장 이상만 뜬다');
  await shot('recycle-source');
  await pickOfficer(SRC);
  await page.waitForFunction((src) => !document.querySelector(`[data-modal="officerPick"] .ofc-row[data-officer="${src}"]`), SRC, { timeout: 5_000 });
  const targets = await pickRows();
  // 처음 받은 C급 장수도 받을 수 있다 — **전부 C급이고 DST가 있고 SRC는 없어야** 한다
  if (!targets.includes(DST) || targets.includes(SRC) || targets.some((id) => gradeOf(id) !== 'C')) {
    fail(`받을 장수 목록이 ${JSON.stringify(targets)}다 — 같은 C급만(${DST} 포함, ${SRC} 제외)`);
  }
  ok('받을 장수 — 같은 등급만 뜬다');
  await pickOfficer(DST);
  await page.waitForSelector('[data-modal="recycleQty"]', { timeout: 5_000 });
  await page.click('[data-modal="recycleQty"] [data-action="more"]');
  const n = await page.getAttribute('[data-field="qty"]', 'data-n');
  if (n !== '6') fail(`[+] 한 번에 ${n}장이다 — 3 → 6이라야 한다`);
  if (await page.getAttribute('[data-modal="recycleQty"] [data-action="more"]', 'disabled') === null) fail('6장이 끝인데 [+]가 열려 있다');
  const from = await page.textContent('[data-field="fromCards"]');
  if (!from?.includes('0')) fail(`풀 장수가 0장까지 못 쓴다 — 「${from}」`);
  ok(`3장 단위 · 끝은 6장 · 「${from?.trim()}」`);
  await shot('recycle-qty');
  await page.click('[data-action="recycleConfirm"]');
  await page.waitForSelector('[data-modal="recycleDone"]', { timeout: 10_000 });
  if (await page.$('[data-modal="burst"]')) fail('카드 정리에 섬광이 떴다');
  await shot('recycle-done');
  const afterClean = (await getProfile(uid))!;
  if ((afterClean.cards[SRC] ?? 0) !== 0 || afterClean.cards[DST] !== 2) {
    fail(`서버의 카드가 ${SRC}=${afterClean.cards[SRC]} · ${DST}=${afterClean.cards[DST]}다 — 0 · 2라야 한다`);
  }
  if (!afterClean.roster[SRC]) fail('카드를 다 쓴 풀 장수가 풀에서 빠졌다');
  ok('서버 — 6장 → 2장, 정리한 장수는 풀에 그대로');
  await page.click('[data-action="recycleClose"]');

  step('새 카드 뽑기 (77·78쪽) — 단발');
  let gold = await goldOf();
  await page.click('[data-action="openPull"]');
  await page.waitForSelector('[data-modal="pullChoose"]', { timeout: 5_000 });
  await shot('pull-choose');
  await page.click('[data-action="pull-single"]');
  await page.waitForSelector('[data-modal="burst"]', { timeout: 10_000 });
  // **세고 나서 찍는다** — 섬광은 1.1초라, 넓은 화면을 2배로 찍는 동안 끝나 버린다(760px에서 0개로 셌다)
  const singles = (await page.$$('.mkt-burst')).length;
  if (singles !== 1) fail(`단발에 섬광이 ${singles}개다 — 하나라야 한다`);
  // 단발은 효과음이 먼저고 섬광은 그 뒤다(`MercView`의 `PULL_SOUND`) — 틈을 여기 다시 적지 않고
  // **첫 칸이 실제로 그려질 때**를 기다린다(연출 길이를 스모크에 다시 적으면 한쪽만 낡는다)
  await page.waitForSelector('.mkt-burst[data-frame]', { timeout: 10_000 });
  await page.waitForTimeout(200);
  await shot('burst-single');
  await page.waitForSelector('[data-modal="reveal"]', { timeout: 10_000 });
  await page.waitForTimeout(700);
  await shot('reveal-single');
  if (await goldOf() !== gold - gachaPullCost('single').gold) fail('단발 값이 안 나갔다');
  ok(`단발 — 섬광 하나 · 결과 한 장 · 금화 −${gachaPullCost('single').gold}`);

  step('다시 뽑기 → 닫기 → 8연 (79쪽)');
  await page.click('[data-action="revealClose"]');
  gold = await goldOf();
  await page.click('[data-action="openPull"]');
  await page.click('[data-action="pull-multi"]');
  await page.waitForSelector('[data-modal="burst"]', { timeout: 10_000 });
  const bursts = await page.$$('.mkt-burst');
  await page.waitForTimeout(500);
  await shot('burst-multi');
  if (bursts.length !== gachaPullCost('multi').count) fail(`섬광이 ${bursts.length}개다 — ${gachaPullCost('multi').count}개라야 한다`);
  await page.waitForSelector('[data-modal="reveal"]', { timeout: 10_000 });
  await page.waitForTimeout(900);
  await shot('reveal-multi');
  const cells = await page.$$('.mkt-reveal-cell');
  if (cells.length !== 8) fail(`결과가 ${cells.length}칸이다 — 8칸이라야 한다`);
  if (await goldOf() !== gold - 72) fail('8연이 72냥이 아니다');
  ok('8연 — 섬광 여덟 · 결과 4×2 · 금화 −72');
  // 등급색이 섬광마다 제 것인가 — 결과 칸의 등급과 섬광의 등급이 같은 순서다
  await page.click('[data-action="revealClose"]');
  await page.click('[data-action="backHome"]');

  step('전투 아이템 (82·83쪽) — 쪽을 넘겨도 장바구니가 남는다');
  await page.click('[data-action="openItems"]');
  await page.waitForSelector('[data-field="itemShop"] .mkt-irow[data-item]', { timeout: 5_000 });
  const firstPage = await page.$$('[data-field="itemShop"] .mkt-irow[data-item]');
  if (firstPage.length !== 4) fail(`한 쪽에 ${firstPage.length}줄이다 — 4줄이라야 한다`);
  if (await page.getAttribute('[data-action="checkout"]', 'disabled') === null) fail('고른 것이 없는데 [결제하기]가 열려 있다');
  await page.click(`[data-item="${ITEM_A.id}"] [data-action="more"]`);
  await page.click(`[data-item="${ITEM_A.id}"] [data-action="more"]`);
  await shot('items');
  await page.click('[data-field="itemPager"] [data-action="nextPage"]');
  await page.waitForSelector(`[data-item="${ITEM_B.id}"]`, { timeout: 5_000 });
  await page.click(`[data-item="${ITEM_B.id}"] [data-action="more"]`);
  await page.click('[data-field="itemPager"] [data-action="prevPage"]');
  const kept = await page.getAttribute(`[data-item="${ITEM_A.id}"]`, 'data-n');
  if (kept !== '2') fail(`쪽을 넘겼다 오니 수량이 ${kept}다 — 2라야 한다`);
  ok('4줄씩 · 쪽을 넘겨도 수량이 남는다');
  const overflow = await page.$$eval('.mkt-irow', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.getAttribute('data-item')));
  if (overflow.length > 0) fail(`줄이 넘쳤다 — ${overflow.join(', ')}`);
  gold = await goldOf();
  await page.click('[data-action="checkout"]');
  await page.waitForSelector('[data-modal="order"]', { timeout: 5_000 });
  await shot('order');
  const lines = await page.$$('.mkt-order-lines li');
  if (lines.length !== 2) fail(`주문서가 ${lines.length}줄이다 — 2줄이라야 한다`);
  // ★ 판이 주문 크기와 상관없이 **열여섯 줄 높이**로 서 있는가
  const box = await page.evaluate(() => {
    const ul = document.querySelector('.mkt-order-lines') as HTMLElement;
    const lh = parseFloat(getComputedStyle(ul).lineHeight);
    return { h: ul.clientHeight, lh };
  });
  if (box.h < box.lh * 16) fail(`주문서 높이 ${box.h}px — 열여섯 줄(${box.lh * 16}px)이 안 들어간다`);
  ok(`주문서 두 줄 · 판은 열여섯 줄 높이(${box.h}px)`);
  await page.click('[data-modal="order"] [data-action="confirmOk"]');
  await page.waitForSelector('[data-modal="bought"]', { timeout: 10_000 });
  await page.waitForTimeout(300);
  await shot('bought');
  const cols = await page.getAttribute('.mkt-bought', 'data-cols');
  if (cols !== '2') fail(`두 종류인데 ${cols}열이다 — 2×1이라야 한다`);
  const afterBuy = (await getProfile(uid))!;
  const spent = ITEM_A.gold * 2 + ITEM_B.gold;
  if (afterBuy.gold !== gold - spent) fail(`금화가 ${gold} → ${afterBuy.gold}다 — ${spent}냥이 나가야 한다`);
  if (afterBuy.marketOwned?.[ITEM_A.id] !== 2 || afterBuy.marketOwned?.[ITEM_B.id] !== 1) fail('서버의 보유가 주문서와 다르다');
  ok(`한 번에 샀다 — 금화 −${spent} · 격자 2×1`);

  step('보관함 (84·85쪽) — 체크하면 [아이템 지급]이 켜진다');
  await page.click('[data-action="boughtStorage"]');
  await page.waitForSelector('[data-field="storage"] .mkt-irow[data-item]', { timeout: 5_000 });
  if (await page.getAttribute('[data-action="giveItem"]', 'disabled') === null) fail('안 골랐는데 [아이템 지급]이 열려 있다');
  await page.click(`[data-field="storage"] [data-item="${ITEM_A.id}"] [data-action="pickItem"]`);
  if (await page.getAttribute('[data-action="giveItem"]', 'disabled') !== null) fail('골랐는데 [아이템 지급]이 잠겨 있다');
  await shot('storage');
  await page.click('[data-action="giveItem"]');
  await page.waitForSelector('[data-modal="officerPick"]', { timeout: 5_000 });
  await pickOfficer(X!);
  await page.waitForSelector('[data-modal="giveSwap"]', { timeout: 5_000 });
  await shot('give-swap');
  ok('병기를 든 장수에게 주면 되묻는다');
  await page.click('[data-modal="giveSwap"] [data-action="confirmOk"]');
  await page.waitForSelector('[data-field="storageNote"]', { timeout: 5_000 });
  const given = await page.textContent(`[data-field="storage"] [data-item="${ITEM_A.id}"] [data-field="given"]`);
  if (given?.trim() !== '1') fail(`지급 칸이 「${given}」다 — 1이라야 한다`);
  await page.waitForTimeout(1500);   // 지급은 클라이언트 소유 — `PUT`이 나가기를 기다린다
  const afterGive = (await getProfile(uid))!;
  if (afterGive.marketCarry?.[X!] !== ITEM_A.id) fail('서버에 지급이 안 남았다');
  if (afterGive.forgeOwned[`${WEAPON.id}#1`] !== null) fail('병기가 대장간으로 안 돌아갔다');
  ok('지급 — 아이템을 들고, 병기는 대장간으로');
  await page.click('[data-action="backHome"]');   // → 전투 아이템
  await page.click('[data-action="backHome"]');   // → 상품 구매

  step('도시 물자 (86쪽)');
  await page.click('[data-action="openGoods"]');
  await page.waitForSelector('[data-good="materials"]', { timeout: 5_000 });
  await shot('goods');
  if (await page.getAttribute('[data-good="grain"]', 'data-can') !== '0') fail('군량이 가득인데 군량 줄이 열려 있다');
  if (!(await page.textContent('[data-good="grain"] [data-field="why"]'))?.trim()) fail('군량이 막힌 이유가 안 적힌다');
  const mats = afterGive.materials;
  await page.click('[data-good="materials"] [data-action="pickGood"]');
  if (await page.getAttribute('[data-good="materials"]', 'data-picked') !== '1') fail('건축 자재를 골라도 표시가 안 된다');
  if (await page.getAttribute('[data-action="buyGood"]', 'disabled') !== null) {
    await shot('goods-stuck');
    fail(`골랐는데 [구매하기]가 잠겨 있다 — 막힌 이유 「${await page.textContent('[data-field="refused"]').catch(() => '')}」`);
  }
  await page.click('[data-action="buyGood"]');
  await page.waitForSelector('[data-modal="goodsDone"]', { timeout: 10_000 });
  await shot('goods-done');
  if ((await getProfile(uid))!.materials <= mats) fail('건축 자재가 안 늘었다');
  ok('건축 자재 — 샀고 완료 판이 뜬다 · 군량은 막힌 이유를 적는다');
  await page.click('[data-action="goodsClose"]');

  step('태학 연구 초기화 (87쪽) — 사서 바로 쓰고 [태학으로 이동]');
  await page.click('[data-good="academyReset"] [data-action="pickGood"]');
  await page.click('[data-action="buyGood"]');
  await page.waitForSelector('[data-modal="academyAsk"]', { timeout: 5_000 });
  await shot('academy-ask');
  await page.click('[data-modal="academyAsk"] [data-action="confirmOk"]');
  await page.waitForSelector('[data-modal="academyDone"]', { timeout: 10_000 });
  await shot('academy-done');
  const afterReset = (await getProfile(uid))!;
  if ((afterReset.academy?.done.length ?? 0) !== 0 || afterReset.academy?.instantUntil !== 1) fail('서버의 태학 연구가 안 비었다');
  ok('서버 — 연구가 비고 Lv1까지는 기다림 없이');
  await page.click('[data-action="toAcademy"]');
  await page.waitForSelector('.scr-building-academy', { timeout: 10_000 });
  ok('[태학으로 이동] → 태학');

  step('장수 재설계 (88쪽) — Lv2 이상만, [궁궐로 이동]');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('[data-place="market"]', { force: true });
  await page.click('[data-action="openShop"]');
  await page.click('[data-action="openGoods"]');
  await page.click('[data-good="respec"] [data-action="pickGood"]');
  await page.click('[data-action="buyGood"]');
  await page.waitForSelector('[data-modal="officerPick"]', { timeout: 5_000 });
  const lv2 = await pickRows();
  if (lv2.length !== 1 || lv2[0] !== X) fail(`재설계 목록이 ${JSON.stringify(lv2)}다 — Lv3 ${X} 하나라야 한다`);
  await pickOfficer(X!);
  await page.waitForSelector('[data-modal="respecAsk"]', { timeout: 5_000 });
  await shot('respec-ask');
  await page.click('[data-modal="respecAsk"] [data-action="confirmOk"]');
  await page.waitForSelector('[data-modal="respecDone"]', { timeout: 10_000 });
  await shot('respec-done');
  const refund = await page.textContent('[data-field="refund"]');
  if (!refund?.includes(String(cardsSpentOn(3)))) fail(`돌려받은 카드가 「${refund}」다 — ×${cardsSpentOn(3)}이라야 한다`);
  if ((await getProfile(uid))!.roster[X!]!.level !== 1) fail('서버에서 Lv1이 안 됐다');
  await page.click('[data-action="toPalace"]');
  await page.waitForSelector('[data-screen="levelup"]', { timeout: 10_000 });
  if (await page.$('[data-action="respec"]')) fail('레벨/스킬 관리에 [재설계]가 남아 있다 — 장터로 옮겼다');
  ok(`재설계 — Lv2 이상만 · ×${cardsSpentOn(3)} · [궁궐로 이동] → 레벨/스킬 관리 · 궁궐의 [재설계]는 없다`);

  if (errors.length > 0) fail(`콘솔 오류 ${errors.length}건 — ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n장터 UX 통과 — 홈 · 상품 구매 · 카드 정리 · 단발/8연 · 아이템 장바구니 · 보관함 지급 · 도시 물자 · 초기화 둘');
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
