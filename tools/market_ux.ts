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
import { GACHA_GRADES, academyTopics, applyLevelUp, cardsSpentOn, cardsToLevelUp, gachaPullCost, newInstance, poolCap, poolUsed, surplusCost } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { shotDir } from './shotDir.ts';
import { walkerArtOf } from '../packages/client/src/screens/market/walkerArt.ts';

const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? shotDir('market_ux');   // 안 주면 OS 임시 폴더(저장소 맨 위에 쌓이지 않게)
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
/** 용병 시장 — 풀의 빈자리를 이만큼 남긴다(1 · 3명은 열리고 5명은 자물쇠, 3명을 모집하면 3명도 닫히게) */
const FREE_SEATS = 4;
/** 심어 둘 잉여 카드 — A급 확정 한 번 뒤 S급 확정에 모자라게(값 A 5 · S 10이면 12 → 7) */
const SURPLUS_SEED = surplusCost('A') + surplusCost('S') - 3;
let X: OfficerId | undefined;      // Lv3 · 병기를 든 장수
const WEAPON = EQUIPMENT[0]!;
const [ITEM_A, ITEM_B] = [MARKET_ITEMS[0]!, MARKET_ITEMS[5]!];   // 1쪽 · 2쪽 품목

/**
 * 메인에서 장터로 — 새로고침 직후에는 계정이 늦게 와 메인이 한 번 더 그려지는데, 그 사이에 누르면 눌림이 사라진다(초점 테두리만 남는다).
 * 장터 화면이 뜰 때까지 다시 누른다(2026-11-22)
 */
async function openMarket(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await page.click('[data-place="market"]', { force: true });
    if (await page.waitForSelector('[data-action="openMerc"]', { timeout: 2_000 }).catch(() => null)) return;
  }
  throw new Error('메인에서 장터가 안 열린다');
}
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
    // 가입 오프닝(대사 · 장수 W 대형, 약 14초)을 지나야 메인이다 — 끝의 [성 안으로 들어가기]
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 10_000 }); // 메인이 자리 잡는 1초 연출이 끝난 뒤
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  const base = (await getProfile(uid))!;
  const fresh = (grade: string): OfficerId[] =>
    OFFICERS.filter((o) => o.grade === grade && !base.roster[o.id as OfficerId] && !base.cards[o.id as OfficerId]).map((o) => o.id as OfficerId);
  [X] = fresh('D');
  let seeded = {
    ...base,
    gold: 1000,
    cityLevel: 5,
    surplusCards: SURPLUS_SEED,
    buildings: { ...base.buildings, market: 5, academy: 1, forge: 1 },
    roster: { ...base.roster, [X!]: newInstance(X!) },
    cards: { ...base.cards, [X!]: (cardsToLevelUp(1) ?? 0) + (cardsToLevelUp(2) ?? 0) },
  };
  // 풀을 빈자리 FREE_SEATS만 남기고 C급으로 채운다(가챠에 C급이 없어 모집이 안 건드린다)
  for (const id of fresh('C')) {
    if (poolCap(seeded) - poolUsed(seeded) <= FREE_SEATS) break;
    seeded = { ...seeded, roster: { ...seeded.roster, [id]: newInstance(id) } };
  }
  if (poolCap(seeded) - poolUsed(seeded) !== FREE_SEATS) throw new Error(`빈자리를 ${FREE_SEATS}로 못 맞췄다 — ${poolCap(seeded) - poolUsed(seeded)}`);
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
  ok(`심었다 — 빈자리 ${FREE_SEATS} · 잉여 카드 ${SURPLUS_SEED} · Lv3 ${X} + ${WEAPON.id}`);

  step('장터 홈 (76쪽 왼쪽) — 도시의 장터 자리가 곧장 연다');
  await openMarket();
  await page.waitForSelector('[data-screen="market"]', { timeout: 10_000 });
  await shot('home');
  // 홈 = 현황판 두 줄 + 배너 셋 + 바닥의 [금화 충전] 하나 (2026-11-24 기획자 — [상품 구매]는 걷었다)
  for (const a of ['openMerc', 'openGoods', 'openItems', 'openGold']) {
    if (!await page.$(`[data-action="${a}"]`)) fail(`장터 홈에 ${a}가 없다`);
  }
  for (const f of ['status', 'marketLevel', 'gold', 'items']) {
    if (!await page.$(`[data-field="${f}"]`)) fail(`현황판에 ${f}가 없다`);
  }
  if (await page.$('[data-action="openShop"], [data-field="status"] [data-field="cards"]')) fail('걷은 [상품 구매] · 장수 카드 줄이 남아 있다');
  // 한 줄 — 장터 배지 · 금화 · 보관함이 같은 줄에
  const stat = await page.evaluate(() => {
    const g = document.querySelector('[data-field="status"] [data-field="gold"]')!.getBoundingClientRect();
    const i = document.querySelector('[data-field="status"] [data-field="items"]')!.getBoundingClientRect();
    const l = document.querySelector('[data-field="status"] [data-field="marketLevel"]')!.getBoundingClientRect();
    const mid = (x: DOMRect): number => (x.top + x.bottom) / 2;
    return { oneRow: Math.max(Math.abs(mid(g) - mid(i)), Math.abs(mid(g) - mid(l))) };
  });
  if (stat.oneRow > 2) fail(`현황판이 한 줄이 아니다 — 세로 중심 차 ${stat.oneRow.toFixed(1)}px`);
  // 배너 셋의 간격 — 현황판 ↔ 용병 시장 = 전투 아이템 ↔ 명령 판, 배너 사이 둘도 같다(2026-11-24 기획자)
  const gaps = await page.evaluate(() => {
    const r = (sel: string): DOMRect => document.querySelector(sel)!.getBoundingClientRect();
    const st = r('[data-field="status"]'), m = r('[data-banner="merc"] .mkt-banner-art'), g = r('[data-banner="goods"] .mkt-banner-art');
    const it = r('[data-banner="items"] .mkt-banner-art'), cmd = r('.mkt-cmds');
    return [m.top - st.bottom, g.top - m.bottom, it.top - g.bottom, cmd.top - it.bottom];
  });
  if (Math.abs(gaps[0]! - gaps[3]!) > 1.5 || Math.abs(gaps[1]! - gaps[2]!) > 1.5) fail(`배너 간격 — ${gaps.map((v) => v.toFixed(1)).join(' / ')}`);
  // 배너 — 평소엔 어둡고 이름이 보이며, 올리면 밝아지고 이름이 숨는다
  const lookOf = (): Promise<{ filter: string; lbl: string }> => page.evaluate(() => {
    const b = document.querySelector('[data-banner="merc"]')!;
    return { filter: getComputedStyle(b.querySelector('img')!).filter, lbl: getComputedStyle(b.querySelector('.mkt-banner-lbl')!).opacity };
  });
  const idle = await lookOf();
  await page.hover('[data-banner="merc"]');
  await page.waitForTimeout(400);
  await shot('banner-hover');
  const hot = await lookOf();
  await page.mouse.move(0, 0);
  if (!idle.filter.includes('brightness') || idle.lbl !== '1' || hot.filter !== 'none' || hot.lbl !== '0') {
    fail(`배너 — 평소 ${JSON.stringify(idle)} · 올림 ${JSON.stringify(hot)}`);
  }
  ok(`현황판 한 줄 · 배너 간격 ${gaps.map((v) => v.toFixed(0)).join(' / ')}px · 배너는 어둡게 + 이름, 올리면 밝게 + 이름 숨김`);
  const goldBtn = await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('[data-action="openGold"]')!;
    const r = b.getBoundingClientRect();
    const tx = b.querySelector<HTMLElement>('.gic-t')!.getBoundingClientRect();
    const ic = b.querySelector<HTMLElement>('.gic img')!.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const inset = parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);   // 옛 자리(흐름의 첫 칸)와 같은 곳에 붙는가
    return { off: Math.abs((tx.left + tx.right) / 2 - (r.left + r.right) / 2), icLeft: ic.left - r.left, inset, sub: Boolean(b.querySelector('.sub')) };
  });
  if (goldBtn.off > 2 || Math.abs(goldBtn.icLeft - goldBtn.inset) > 2 || goldBtn.sub) fail(`[금화 충전] — 글자 가운데에서 ${goldBtn.off.toFixed(1)}px · 아이콘 왼쪽 ${goldBtn.icLeft.toFixed(1)}px · 설명 ${goldBtn.sub}`);
  ok(`배너 셋 + [금화 충전] — 글자 가운데(±${goldBtn.off.toFixed(1)}px) · 아이콘 왼쪽(${goldBtn.icLeft.toFixed(0)}px)`);

  step('금화 구매 — 상품 카드를 누르면 「구매 완료」 축하 화면(2026-11-20, 결제 전에는 개발용 지급이 켜졌을 때만)');
  await page.click('[data-action="openGold"]');
  await page.waitForSelector('.mkt-pack[data-pack="0"]', { timeout: 5_000 });
  if (await page.isEnabled('.mkt-pack[data-pack="0"]')) {
    const before = Number(await page.getAttribute('[data-field="goldHave"]', 'data-gold'));
    const packGold = Number(await page.getAttribute('.mkt-pack[data-pack="0"]', 'data-gold'));
    await page.click('.mkt-pack[data-pack="0"]');
    await page.waitForSelector('[data-modal="goldDone"]', { timeout: 8_000 });
    await page.waitForTimeout(1_500);   // 섬광 · 주머니 쾅이 끝난 뒤
    await shot('gold-done');
    const got = Number(await page.getAttribute('[data-modal="goldDone"] [data-gold]', 'data-gold'));
    const have = Number(await page.getAttribute('[data-modal="goldDone"] [data-field="goldHave"]', 'data-gold'));
    if (got !== packGold || have !== before + packGold) fail(`구매 완료 — 받은 ${got}(상품 ${packGold}) · 보유 ${before} → ${have}`);
    await page.click('[data-modal="goldDone"] [data-action="doneOk"]');
    await page.waitForSelector('.cel-back[data-leaving]', { state: 'detached', timeout: 5_000 });
    ok(`금화 ${packGold} → 「구매 완료」 · 보유 ${before} → ${have} · 화면을 눌러 닫힘`);
  } else ok('개발용 지급이 꺼진 서버 — 금화 상품은 눌리지 않는다(결제 전)');
  await page.click('[data-action="backHome"]');
  await page.waitForSelector('[data-banner="goods"]', { timeout: 5_000 });

  step('장터 홈 — 배너 셋');
  await page.waitForTimeout(400);   // 배너가 없으면 물러나는 데 한 번 더 받는다
  await shot('shop');
  const broken = await brokenImages('.mkt-banner img');
  if (broken.length > 0) fail(`배너가 안 뜬다 — ${broken.join(', ')}`);
  ok('배너 셋이 뜬다');

  step('용병 시장 — 현황판(금화 · 거느린 장수 · 잉여 카드)이 홈과 같은 자리 · 같은 높이, 모집 셋 + 잉여 카드 셋, 바닥은 [뒤로 가기]만 (2026-11-24 기획자)');
  const panelBox = (sel: string) => page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { top: r.top, h: r.height, left: r.left, w: r.width };
  }, sel);
  const homeBox = await panelBox('[data-field="status"]');
  await page.click('[data-action="openMerc"]');
  await page.waitForSelector('[data-field="mercShop"]', { timeout: 5_000 });
  const mercBox = await panelBox('[data-field="mercStatus"]');
  // 현황판 아이콘 셋 — 누르면 이름 말풍선(`TapTip`, 2026-11-25 기획자: 장수만 뜨던 것을 금화 · 잉여 카드도)
  const tipTexts: string[] = [];
  for (const f of ['gold', 'pool', 'surplus']) {
    await page.click(`[data-field="mercStatus"] [data-field="${f}"] img`);
    const tip = await page.waitForSelector('.tap-tip', { timeout: 2_000 }).catch(() => null);
    if (!tip) fail(`현황판 ${f} 아이콘을 눌러도 말풍선이 안 뜬다`);
    tipTexts.push((await tip!.textContent())?.trim() ?? '');
    await page.mouse.click(5, 5);
    await page.waitForSelector('.tap-tip', { state: 'detached', timeout: 3_000 }).catch(() => {});
  }
  ok(`현황판 아이콘 말풍선 — ${tipTexts.join(' · ')}`);
  if (['top', 'h', 'left', 'w'].some((k) => Math.abs(homeBox[k as 'top'] - mercBox[k as 'top']) > 0.5)) {
    fail(`용병 시장 현황판이 홈과 다르다 — 홈 ${JSON.stringify(homeBox)} · 용병 ${JSON.stringify(mercBox)}`);
  }
  const head = await page.evaluate(() => {
    const q = (f: string) => document.querySelector<HTMLElement>(`[data-field="mercStatus"] [data-field="${f}"]`);
    return { gold: q('gold')?.dataset.gold, used: q('pool')?.dataset.used, cap: q('pool')?.dataset.cap, surplus: q('surplus')?.dataset.surplus };
  });
  if (Number(head.surplus) !== SURPLUS_SEED || Number(head.cap) - Number(head.used) !== FREE_SEATS || head.gold === undefined) {
    fail(`용병 시장 현황판 — ${JSON.stringify(head)}`);
  }
  const shop = await page.evaluate(() => ({
    acts: [...document.querySelectorAll<HTMLElement>('[data-field="mercShop"] [data-action]')].map((b) => b.dataset.action),
    cmds: [...document.querySelectorAll<HTMLElement>('.mkt-cmds [data-action]')].map((b) => b.dataset.action),
    art: Object.fromEntries(['one', 'three', 'five'].map((k) => {
      const b = document.querySelector<HTMLButtonElement>(`[data-action="pull-${k}"]`)!;
      return [k, [b.querySelectorAll('.mkt-recruit-stand').length, b.dataset.locked !== undefined && !b.disabled && Boolean(b.querySelector('[data-field="noSeat"]'))]];
    })),
    eLocked: (() => {
      const e = document.querySelector<HTMLButtonElement>('[data-action="surplus-E"]')!;
      return !e.disabled && e.dataset.locked !== undefined && getComputedStyle(e).filter.includes('grayscale');
    })(),
    oldDoors: Boolean(document.querySelector('[data-action="openPull"], [data-action="openRecycle"]')),
  }));
  if (shop.acts.join() !== 'pull-one,pull-three,pull-five,surplus-A,surplus-S,surplus-E') fail(`용병 시장 칸 — ${shop.acts.join()}`);
  if (shop.cmds.join() !== 'backHome') fail(`바닥 명령 판 — ${shop.cmds.join()} (뒤로 가기만이라야 한다)`);
  if (shop.oldDoors) fail('옛 [카드 뽑기] · [카드 정리]가 남았다');
  // 빈자리 4 — 꼬마 1 · 3 · 5, 5명만 자물쇠(「궁궐 증축 필요」)
  if (JSON.stringify(shop.art) !== JSON.stringify({ one: [1, false], three: [3, false], five: [5, true] })) fail(`모집 칸 — ${JSON.stringify(shop.art)}`);
  if (!shop.eLocked) fail('헌제가 없는데 E급 칸이 잿빛으로 안 막혔다');
  ok(`현황판 홈과 같음(위 ${mercBox.top.toFixed(0)}px · 높이 ${mercBox.h.toFixed(0)}px) · 칸 여섯 · 꼬마/자물쇠 ${JSON.stringify(shop.art)} · E급 잿빛`);
  // 잿빛 칸도 누를 수 있다 — 누르면 **내관이** 까닭을 말하고, 판에는 글이 안 뜬다(판 높이 그대로) (2026-11-25 기획자)
  const shopH = async (): Promise<number> => page.$eval('[data-field="mercShop"]', (e) => e.getBoundingClientRect().height);
  const h0 = await shopH();
  await page.click('[data-action="surplus-E"]');
  await page.waitForSelector('.stw[data-say="mercWhy"][data-say-code="market.surplus.noEmperor"]', { timeout: 5_000 });
  await page.click('[data-action="pull-five"]');
  await page.waitForSelector('.stw[data-say="mercWhy"][data-say-code="market.recruit.noSeat"]', { timeout: 5_000 });
  const h1 = await shopH();
  if (Math.abs(h1 - h0) > 0.5) fail(`잿빛 칸을 누르자 판 높이가 바뀌었다 — ${h0.toFixed(1)} → ${h1.toFixed(1)}px`);
  if (await page.$('[data-intro="recruit"], [data-modal="reveal"], [data-modal="surplusDone"], [data-modal="recruitAsk"], [data-modal="surplusAsk"]')) fail('막힌 칸을 눌렀는데 묻는 판 · 모집이 떴다');
  ok('잿빛 칸 — E급(헌제 없음) · 5명(빈자리 모자람)을 누르면 내관이 까닭을 말하고, 판 높이는 그대로');
  // 모집 칸마다 나올 수 있는 등급 표(E · S · A · B) — 데이터(`GACHA_GRADES`)와 같은 수
  const gradeRows = await page.$$eval('[data-field="recruitGrades"]', (els) => els.map((e) => e.querySelectorAll('.gr').length));
  if (gradeRows.length !== 3 || gradeRows.some((n) => n !== GACHA_GRADES.length)) fail(`모집 칸 등급 표 — ${gradeRows.join(',')} (${GACHA_GRADES.join('')}여야 한다)`);
  // 후광 자리 — 1명 하나 · 3명 양 끝 둘 · 5명 양 끝 + 가운데 조금 위 셋(다 달면 정신없다, 2026-11-25 기획자)
  const glowSpots = await page.$$eval('[data-action^="pull-"]', (els) => els.map((b) => b.querySelectorAll('.mkt-recruit-glow').length));
  if (glowSpots.join() !== '1,2,3') fail(`모집 칸 후광 수 — ${glowSpots.join()} (1,2,3이라야 한다)`);
  // 자리 — 종이 가로 한가운데, 가격 붓 획 바로 위(0~6px) · 실루엣보다 앞 층 (2026-11-25 기획자). 등급 표는 누름을 안 받아(`pointer-events: none`)
  // `elementFromPoint`로는 못 잰다 — 같은 쌓임 맥락(단추) 안의 z를 견준다(실루엣 자리 · 후광은 `.mkt-recruit-art`가 z를 안 만들어 단추 맥락에 든다)
  const gradeSpots = await page.$$eval('[data-action^="pull-"]', (els) => els.map((b) => {
    const r = b.getBoundingClientRect(), gEl = b.querySelector<HTMLElement>('[data-field="recruitGrades"]')!, g = gEl.getBoundingClientRect();
    const p = b.querySelector('.mkt-pack-price')!.getBoundingClientRect();
    const z = (e: Element): number => Number(getComputedStyle(e).zIndex) || 0;
    const spotMax = Math.max(...[...b.querySelectorAll('.mkt-recruit-spot')].map(z));
    return {
      off: Math.round(((g.left + g.right) / 2 - (r.left + r.right) / 2) * 10) / 10,
      gap: Math.round((p.top - g.bottom) * 10) / 10,
      front: z(gEl) > spotMax,
    };
  }));
  if (gradeSpots.some((x) => Math.abs(x.off) > 2 || x.gap < 0 || x.gap > 6 || !x.front)) fail(`등급 표 자리 — ${JSON.stringify(gradeSpots)}`);
  ok(`등급 표 ${GACHA_GRADES.join('')} — 종이 가운데(±${Math.max(...gradeSpots.map((x) => Math.abs(x.off)))}px) · 붓 획 위 ${gradeSpots.map((x) => x.gap).join('/')}px · 실루엣보다 앞`);
  await shot('merc');
  // 후광 (2026-11-25 기획자) — 꼬마마다 뒤에 흰 · 자주 · 금 셋이 겹쳐 하나씩 떠오르고, 잉여 카드는 등급 표 뒤에 하나. 글자 이름 칸은 없다.
  // 섬광은 0.5초에 걸쳐 떠오르므로 기다린 뒤 잰다. 그리고 판은 스크롤 없이 [뒤로 가기]가 화면 바닥에 닿는다
  await page.waitForTimeout(1_200);
  const glow = await page.evaluate(() => {
    const seen = (el: Element): number => {
      let o = 1;
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? o : 0;
    };
    const one = document.querySelector('[data-action="pull-one"]')!;
    const tones = [...one.querySelectorAll('.mkt-recruit-halo')].map((b) => [b.getAttribute('data-blink'), seen(b.querySelector('.blink-halo')!)] as const);
    const marks = ['A', 'S', 'E'].map((g) => {
      const b = document.querySelector(`[data-action="surplus-${g}"]`)!;
      const h = b.querySelector('.mkt-surplus-mark .blink-halo');
      const art = b.querySelector('.mkt-surplus-art')!.getBoundingClientRect(), gr = b.querySelector('.mkt-surplus-mark .gr')!.getBoundingClientRect();
      return { g, halo: h ? seen(h) : 0, off: Math.hypot((art.left + art.right - gr.left - gr.right) / 2, (art.top + art.bottom - gr.top - gr.bottom) / 2), gr: gr.width };
    });
    const body = document.querySelector<HTMLElement>('.mkt-body')!;
    const cmd = document.querySelector('.mkt-cmds')!.getBoundingClientRect();
    return {
      tones, marks, names: document.querySelectorAll('[data-field="mercShop"] .mkt-pack-name').length,
      cardHalo: document.querySelectorAll('.mkt-surplus-art > .mkt-halo').length,
      // 스크롤은 어디에도 없다(2026-11-25 기획자) — 세로 · 가로, 판과 화면 둘 다. 돌아가는 섬광이 가로로 넘쳤었다
      scroll: Math.max(...[body, document.querySelector<HTMLElement>('.scr')!, document.documentElement].map((e) =>
        Math.max(e.scrollHeight - e.clientHeight, e.scrollWidth - e.clientWidth) * (getComputedStyle(e).overflowX === 'hidden' && getComputedStyle(e).overflowY === 'hidden' ? 0 : 1))),
      bars: [...document.querySelectorAll<HTMLElement>('[data-field="mercShop"] *, .mkt-body, .scr')].filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowX + getComputedStyle(e).overflowY)).length,
      labels: [...document.querySelectorAll('[data-field="recruitCount"]')].map((e) => e.textContent).join() + '|' +
        [...document.querySelectorAll('[data-field="surplusQty"]')].map((e) => e.textContent).join(),
      // 숫자 글자의 글꼴 = 가격 띠의 글꼴(색만 검정)
      fontSame: (() => {
        const f = (s: string): string => { const c = getComputedStyle(document.querySelector(s)!); return `${c.fontFamily}/${c.fontSize}/${c.fontWeight}/${c.letterSpacing}`; };
        return [f('[data-field="recruitCount"]'), f('[data-field="surplusQty"]'), f('[data-field="pullCost"]')];
      })(),
      cmdGap: body.getBoundingClientRect().bottom - cmd.bottom,
    };
  });
  await shot('merc-halo');
  const lit = glow.tones.filter(([, o]) => o > 0.3).length;
  if (glow.tones.map(([t]) => t).join() !== 'gold,purple,red,blue' || lit < 1 || lit > 2) fail(`꼬마 후광 — ${JSON.stringify(glow.tones)}`);
  if (glow.marks.some((m) => m.halo < 0.3 || m.off > 1.5)) fail(`등급 표 · 후광 — ${JSON.stringify(glow.marks)}`);
  if (glow.names > 0 || glow.cardHalo > 0) fail(`걷은 것이 남았다 — 이름 칸 ${glow.names} · 카드 후광 ${glow.cardHalo}`);
  if (glow.scroll > 1 || glow.bars > 0) fail(`용병 시장에 스크롤 — 넘침 ${glow.scroll}px · 스크롤 판 ${glow.bars}`);
  if (glow.labels !== '1,3,5|×1,×1,×1') fail(`숫자 글자 — ${glow.labels}`);
  if (new Set(glow.fontSame).size !== 1) fail(`숫자 글자 글꼴이 가격 띠와 다르다 — ${glow.fontSame.join(' | ')}`);
  ok(`후광 — 꼬마 ${glow.tones.map(([t, o]) => `${t} ${o.toFixed(2)}`).join(' · ')} · 등급 표 ${glow.marks.map((m) => `${m.g} ${m.halo.toFixed(2)}`).join(' · ')}(가운데 ±${Math.max(...glow.marks.map((m) => m.off)).toFixed(1)}px, ${glow.marks[0]!.gr.toFixed(0)}px) · 스크롤 없음 · 명령 판 바닥까지 ${glow.cmdGap.toFixed(0)}px`);

  // 장수 모집 연출 (2026-11-25 기획자, `Design/장수모집연출/시나리오.html`) — 걷는 장면(뽑은 수만큼 · 높은 등급이 가운데 · 등 뒤 등급 섬광) →
  // 번쩍 → 무대(걸어온 자리 그대로). 단추 없이 아무 데나 누르면 닫힘, 걷는 중에 누르면 곧장 번쩍, 무대가 열린 직후 0.6초는 누름을 넘긴다
  /** 걷는 창의 실루엣(자리 · 섬광)과 무대의 장수(자리 · 등급)가 맞는가 — 높은 등급이 가운데부터, 섬광은 A 흰 · S 자주 · E 금 */
  const RANK: Record<string, number> = { E: 6, S: 5, A: 4, B: 3, C: 2, D: 1 };
  const CENTER_OUT: Record<number, number[]> = { 1: [0], 3: [1, 0, 2], 5: [2, 1, 3, 0, 4] };
  // 걷는 동안은 등 뒤 섬광이 없다(2026-11-25 기획자 — 다가오며 불어난 빛이 보기 싫었다) — `glow`는 실루엣 안의 섬광 상자가 있는가
  const walkersNow = (): Promise<{ seat: number; glow: string | null }[]> => page.$$eval('.cin-recruit .cir-walker[data-stage="0"]',
    (els) => els.map((e) => ({ seat: Number((e as HTMLElement).dataset.seat), glow: e.querySelector('.blink-box') ? 'yes' : null })));
  const castNow = (): Promise<{ seat: number; grade: string; fate: string; officer: string }[]> => page.$$eval('[data-modal="reveal"] .rcr-member',
    (els) => els.map((e) => { const d = (e as HTMLElement).dataset; return { seat: Number(d.seat), grade: d.grade!, fate: d.fate!, officer: d.officer! }; }));
  const checkSeats = (n: number, walkers: { seat: number; glow: string | null }[], cast: { seat: number; grade: string }[]): void => {
    if (walkers.length !== n) fail(`걷는 실루엣이 ${walkers.length}이다 — ${n}이라야 한다`);
    if (cast.length !== n) fail(`무대의 장수가 ${cast.length}이다 — ${n}이라야 한다`);
    const byRank = [...cast].sort((x, y) => RANK[y.grade]! - RANK[x.grade]!);
    byRank.forEach((m, k) => {
      if (RANK[m.grade] !== RANK[cast.find((c) => c.seat === CENTER_OUT[n]![k])!.grade]) fail(`자리 ${CENTER_OUT[n]![k]}의 등급이 순서와 다르다 — ${JSON.stringify(cast)}`);
    });
    for (const m of cast) {
      const w = walkers.find((x) => x.seat === m.seat);
      if (!w || w.glow !== null) fail(`자리 ${m.seat}의 걷는 실루엣 — ${w ? '섬광이 남았다' : '없다'}`);
    }
  };

  step('1명 모집 — 실루엣 하나가 걸어오고 해가 번쩍 → 무대(계정 문장 앞에 한 명)');
  let gold = await goldOf();
  // 사기 전에 묻는다 — [뒤로 가기]면 한 푼도 안 나간다, [확정]이면 산다 (2026-11-25 기획자)
  await page.click('[data-action="pull-one"]');
  await page.waitForSelector('[data-modal="recruitAsk"]', { timeout: 5_000 });
  await shot('recruit-ask');
  // 묻는 판의 한 줄은 판 안에서 가운데 — 일본어 · 중국어는 띄어쓰기가 없어 `keep-all`이면 판 밖으로 넘쳤다 (2026-11-25)
  const askFits = (field: string) => page.evaluate((f) => {
    const p = document.querySelector<HTMLElement>(`[data-field="${f}"]`)!;
    const body = p.closest('.mkt-confirm-body')!.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(p);
    const txt = range.getBoundingClientRect();
    return { inside: txt.left >= body.left - 1 && txt.right <= body.right + 1, off: Math.abs((txt.left + txt.right) / 2 - (body.left + body.right) / 2) };
  }, field);
  const recruitFit = await askFits('recruitAskWhat');
  if (!recruitFit.inside || recruitFit.off > 3) fail(`모집 묻는 판의 글이 판 밖이거나 가운데가 아니다 — ${JSON.stringify(recruitFit)}`);
  await page.click('[data-modal="recruitAsk"] [data-action="confirmCancel"]');
  await page.waitForSelector('[data-modal="recruitAsk"]', { state: 'detached', timeout: 3_000 });
  if (await goldOf() !== gold || await page.$('[data-intro="recruit"]')) fail('묻는 판에서 물렀는데 모집이 됐다');
  await page.click('[data-action="pull-one"]');
  await page.waitForSelector('[data-modal="recruitAsk"]', { timeout: 5_000 });
  await page.click('[data-modal="recruitAsk"] [data-action="confirmOk"]');
  await page.waitForSelector('[data-intro="recruit"]', { timeout: 10_000 });
  // 배경 음악은 연출 동안 멎는다(`holdBgm`) — 닫으면 다시
  await page.waitForTimeout(400);
  // 「장터의 노래」(`shop`)는 연출이 시작되는 순간부터 용병 시장으로 돌아올 때까지 멎어 있다 — 붙듦 표지만이 아니라 곡이 실제로 멈췄는가
  type Bgm = { track: string | null; held: boolean; paused: boolean | null };
  const bgmNow = (): Promise<Bgm> => page.evaluate(() => { const b = (window as any).__bgm; return { track: b?.track ?? null, held: b?.held, paused: b?.paused ?? null }; });
  const bgmWalk = await bgmNow();
  if (bgmWalk.track !== 'shop' || !bgmWalk.held || bgmWalk.paused !== true) fail(`걷는 장면에서 배경 음악 — ${JSON.stringify(bgmWalk)}`);
  // 다가옴은 정지 장면 넷이 디졸브로 넘어간다 — 약 2초엔 둘째 장면만 또렷하다
  await page.waitForTimeout(1_400);
  const stageOp = await page.$$eval('.cin-recruit .cir-walker[data-seat="0"]', (els) => els.map((e) => Number(getComputedStyle(e).opacity)));
  // 약 2초 — 둘째 장면이 또렷하고, 첫 장면은 잔상(불투명도 .5)으로 남는다(2026-11-25 기획자). 셋째 · 넷째는 아직
  if (stageOp.length !== 4 || stageOp[1]! < 0.9 || Math.abs(stageOp[0]! - 0.5) > 0.08 || stageOp[2]! > 0.1 || stageOp[3]! > 0.1) fail(`2초의 정지 장면 · 잔상 — ${stageOp.map((o) => o.toFixed(2)).join(' ')}`);
  await shot('recruit-walk-one-early');
  const walkOne = await walkersNow();
  await page.waitForTimeout(1_300);
  await shot('recruit-walk-one-late');
  await page.waitForSelector('[data-modal="reveal"]', { timeout: 6_000 });
  await page.waitForTimeout(1_400);
  await shot('reveal-one');
  const bgmStage = await bgmNow();
  if (!bgmStage.held || bgmStage.paused !== true) fail(`무대에서 배경 음악 — ${JSON.stringify(bgmStage)}`);
  const cast1 = await castNow();
  checkSeats(1, walkOne, cast1);
  const stage1 = await page.evaluate(() => ({
    rays: [...document.querySelectorAll('[data-modal="reveal"] .cel-rays')].filter((e) => getComputedStyle(e).display !== 'none').length,
    halos: document.querySelectorAll('[data-modal="reveal"] .rcr-fig .mkt-halo').length,
    bubbles: [...document.querySelectorAll('[data-modal="reveal"] .rcr-member')].map((m) => Boolean(m.querySelector('.rcr-new'))),
  }));
  if (stage1.rays !== 0 || stage1.halos !== 1) fail(`무대 섬광은 장수 뒤 하나만 — 큰 빛줄기 ${stage1.rays} · 장수 후광 ${stage1.halos}`);
  if (stage1.bubbles.join() !== cast1.map((c) => c.fate === 'new').join()) fail(`「NEW」 말풍선은 새 장수에만 — ${stage1.bubbles.join()} / ${cast1.map((c) => c.fate).join()}`);
  if (await page.$('[data-action="pullAgain"]')) fail('걷어 낸 [다시 뽑기]가 남았다');
  if (await goldOf() !== gold - gachaPullCost('one').gold) fail('1명 모집 값이 안 나갔다');
  ok(`1명 모집 — 실루엣 하나(섬광 ${walkOne[0]!.glow ?? '없음'}) → 무대 한 명 · 금화 −${gachaPullCost('one').gold} · [다시 뽑기] 없음 · 정지 장면 넷(2초 ${stageOp.map((o) => o.toFixed(1)).join('/')}) · 섬광 하나 · NEW ${stage1.bubbles.filter(Boolean).length} · 「장터의 노래」 걷기 · 무대 동안 멈춤 → 돌아와 다시`);
  await page.click('[data-action="revealClose"]');
  await page.waitForSelector('[data-modal="reveal"]', { state: 'detached', timeout: 3_000 });
  await page.waitForTimeout(500);
  const bgmBack = await bgmNow();
  if (bgmBack.track !== 'shop' || bgmBack.held || bgmBack.paused !== false) fail(`용병 시장으로 돌아왔는데 배경 음악 — ${JSON.stringify(bgmBack)}`);

  step('3명 모집 — 걷는 중에 누르면 곧장 번쩍, 무대가 열린 직후의 누름은 넘긴다, 새 장수는 전부 풀에 든다');
  const before = (await getProfile(uid))!;
  gold = before.gold;
  await page.click('[data-action="pull-three"]');
  await page.click('[data-modal="recruitAsk"] [data-action="confirmOk"]');
  await page.waitForSelector('[data-intro="recruit"]', { timeout: 15_000 });
  await page.waitForTimeout(1_200);
  await shot('recruit-walk-three');
  const walkThree = await walkersNow();
  const tSkip = Date.now();
  await page.click('[data-action="recruitSkip"]');
  await page.waitForSelector('[data-intro="recruit"][data-skipped]', { timeout: 2_000 });
  await page.waitForSelector('[data-modal="reveal"]', { timeout: 3_000 });
  const skipMs = Date.now() - tSkip;
  if (skipMs > 1_200) fail(`건너뛰었는데 무대까지 ${skipMs}ms — 0.4초 남짓이라야 한다`);
  // 열린 직후의 누름은 넘긴다 — 무대가 그대로 있어야 한다
  await page.click('[data-action="revealClose"]');
  await page.waitForTimeout(250);
  if (!await page.$('[data-modal="reveal"]:not([data-leaving])')) fail('무대가 열리자마자 누름에 닫혔다 — 0.6초는 넘겨야 한다');
  await page.waitForTimeout(1_200);
  await shot('reveal-three');
  const cast3 = await castNow();
  checkSeats(3, walkThree, cast3);
  const after = (await getProfile(uid))!;
  if (poolUsed(after) - poolUsed(before) !== cast3.filter((c) => c.fate === 'new').length) fail('「새 장수」 표와 풀에 든 수가 다르다');
  if (after.gold !== gold - gachaPullCost('three').gold) fail(`3명 모집이 ${gachaPullCost('three').gold}냥이 아니다`);
  await page.click('[data-action="revealClose"]');
  await page.waitForSelector('[data-modal="reveal"]', { state: 'detached', timeout: 3_000 });
  const seatsNow = poolCap(after) - poolUsed(after);
  const threeLocked = await page.$eval('[data-action="pull-three"]', (b) => (b as HTMLElement).dataset.locked !== undefined);
  if (threeLocked !== seatsNow < 3) fail(`빈자리 ${seatsNow} — 3명 칸 잠김 ${threeLocked}`);
  await shot('merc-after');
  ok(`3명 모집 — 실루엣 셋(섬광 ${walkThree.map((w) => w.glow ?? '-').join(' ')}) · 건너뛰기 ${skipMs}ms · 열린 직후 누름 넘김 · 무대 ${cast3.map((c) => `${c.seat}:${c.grade}`).join(' ')} · 금화 −${gachaPullCost('three').gold} · 빈자리 ${seatsNow} → 3명 ${threeLocked ? '자물쇠' : '열림'}`);

  step('잉여 카드로 A급 확정 — 장수 모집 1명과 같은 연출, 실루엣은 받는 장수의 무기(창 1 · 부채 2 · 그 밖 3 · 칼 4 · 활 5)');
  const s0 = (await getProfile(uid))!;
  await page.click('[data-action="surplus-A"]');
  await page.waitForSelector('[data-modal="surplusAsk"]', { timeout: 5_000 });
  await shot('surplus-ask');
  const surplusFit = await askFits('surplusAskWhat');
  if (!surplusFit.inside || surplusFit.off > 3) fail(`레벨업 카드 묻는 판의 글이 판 밖이거나 가운데가 아니다 — ${JSON.stringify(surplusFit)}`);
  await page.click('[data-modal="surplusAsk"] [data-action="confirmOk"]');
  await page.waitForSelector('[data-intro="recruit"]', { timeout: 10_000 });
  await page.waitForTimeout(1_500);
  const surplusWalk = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.cin-recruit .cir-walker[data-stage="0"]')].map((e) => ({ art: Number(e.dataset.art), glow: e.querySelector('.blink-box') ? 'yes' : null })));
  await shot('surplus-walk');
  await page.waitForSelector('[data-modal="surplusDone"]', { timeout: 10_000 });
  await page.waitForTimeout(900);   // 무대가 열린 직후 0.6초는 누름을 넘긴다
  if (await page.$('[data-modal="burst"]')) fail('잉여 카드 모집에 섬광이 떴다');
  await shot('surplus-done');
  const got = await page.getAttribute('[data-modal="surplusDone"] [data-officer]', 'data-officer') as OfficerId;
  const s1 = (await getProfile(uid))!;
  if ((s1.surplusCards ?? 0) !== (s0.surplusCards ?? 0) - surplusCost('A')) fail(`잉여 카드가 ${s0.surplusCards} → ${s1.surplusCards}다 — ${surplusCost('A')}장 줄어야 한다`);
  if (gradeOf(got) !== 'A') fail(`받은 장수 ${got}가 A급이 아니다`);
  if (surplusWalk.length !== 1 || surplusWalk[0]!.art !== walkerArtOf(got) || surplusWalk[0]!.glow !== null) fail(`실루엣이 ${got}(무기 ${walkerArtOf(got)} · 섬광 없음)과 다르다 — ${JSON.stringify(surplusWalk)}`);
  // 풀 장수는 카드 +1, 보관함 장수가 빈자리로 들면 풀에 든다
  const gained = (s1.cards[got] ?? 0) === (s0.cards[got] ?? 0) + 1 || (!s0.roster[got] && Boolean(s1.roster[got]));
  if (!gained) fail(`${got}의 카드가 ${s0.cards[got]} → ${s1.cards[got]}다`);
  ok(`A급 확정 — ${got} · 실루엣 ${surplusWalk[0]!.art}(무기) · 걷는 동안 섬광 없음 · 잉여 카드 ${s0.surplusCards} → ${s1.surplusCards}`);
  await page.click('[data-action="surplusClose"]');
  await page.waitForSelector('[data-modal="surplusDone"]', { state: 'detached', timeout: 3_000 });

  step(`잉여 카드가 모자라면 내관이 말한다 — S급 확정(${surplusCost('S')}장)`);
  if ((s1.surplusCards ?? 0) >= surplusCost('S')) fail(`잉여 카드가 ${s1.surplusCards}장이라 「모자람」을 시험할 수 없다`);
  await page.click('[data-action="surplus-S"]');
  await page.waitForSelector('.stw[data-say="mercWhy"][data-say-code="market.surplus.notEnough"]', { timeout: 5_000 });
  if (await page.$('[data-modal="surplusDone"]')) fail('모자란데 모집됐다');
  ok('S급 확정 — 모자라면 막고 까닭을 말한다');
  await page.click('[data-action="backHome"]');

  step('전투 아이템 (82·83쪽) — 쪽을 넘겨도 장바구니가 남는다');
  await page.click('[data-action="openItems"]');
  await page.waitForSelector('[data-field="itemShop"] .mkt-irow[data-item]', { timeout: 5_000 });
  const firstPage = await page.$$('[data-field="itemShop"] .mkt-irow[data-item]');
  if (firstPage.length !== 4) fail(`한 쪽에 ${firstPage.length}줄이다 — 4줄이라야 한다`);
  if (await page.getAttribute('[data-action="checkout"]', 'disabled') === null) fail('고른 것이 없는데 [결제하기]가 열려 있다');
  await page.click(`[data-item="${ITEM_A.id}"] [data-action="pickItem"]`);
  if (await page.getAttribute('[data-action="checkout"]', 'disabled') !== null) fail('체크했는데 [결제하기]가 잠겨 있다');
  await shot('items');
  await page.click('[data-field="itemPager"] [data-action="nextPage"]');
  await page.waitForSelector(`[data-item="${ITEM_B.id}"]`, { timeout: 5_000 });
  await page.click(`[data-item="${ITEM_B.id}"] [data-action="pickItem"]`);
  await page.click('[data-field="itemPager"] [data-action="prevPage"]');
  const kept = await page.getAttribute(`[data-item="${ITEM_A.id}"]`, 'data-picked');
  if (kept !== '1') fail('쪽을 넘겼다 오니 체크가 풀렸다');
  ok('4줄씩 · 체크하면 [결제하기]가 켜지고 쪽을 넘겨도 체크가 남는다');
  const overflow = await page.$$eval('.mkt-irow', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.getAttribute('data-item')));
  if (overflow.length > 0) fail(`줄이 넘쳤다 — ${overflow.join(', ')}`);
  gold = await goldOf();
  await page.click('[data-action="checkout"]');
  await page.waitForSelector('[data-modal="order"]', { timeout: 5_000 });
  await shot('order');
  const lines = await page.$$('.mkt-order-lines li');
  if (lines.length !== 2) fail(`주문서가 ${lines.length}줄이다 — 2줄이라야 한다`);
  // ★ 판이 주문 크기와 상관없이 **두 단 × 여덟 줄 높이**로 서 있는가 · 줄에는 이름만
  const box = await page.evaluate(() => {
    const ul = document.querySelector('.mkt-order-lines') as HTMLElement;
    const cs = getComputedStyle(ul);
    return { h: ul.clientHeight, lh: parseFloat(cs.lineHeight), cols: cs.gridTemplateColumns.split(' ').length, text: ul.textContent ?? '' };
  });
  if (box.h < box.lh * 8) fail(`주문서 높이 ${box.h}px — 여덟 줄(${box.lh * 8}px)이 안 들어간다`);
  if (box.cols !== 2) fail(`주문서가 ${box.cols}단이다 — 2단이라야 한다`);
  if (/×|냥/.test(box.text)) fail(`주문서 줄에 이름 말고 다른 것이 있다 — ${box.text}`);
  ok(`주문서 두 줄 · 이름만 · 판은 2단 × 여덟 줄(${box.h}px)`);
  // 판 폭 — 두 단이 안 잘리게 22.8rem(19rem × 1.2). 기본 `.modal`의 19rem 상한에 눌리면 여기서 잡힌다
  const orderW = await page.$eval('[data-modal="order"] .modal', (m) => m.getBoundingClientRect().width / parseFloat(getComputedStyle(document.documentElement).fontSize));
  // 좁은 화면에선 94%가 먼저 막으므로 「옛 상한 19rem을 확실히 넘었는가」만 본다
  if (orderW < 21) fail(`주문 확인 판이 ${orderW.toFixed(1)}rem이다 — 19rem 상한에 눌렸다(22.8rem이라야 한다)`);
  // 이름이 「…」로 잘리지 않는가
  const clipped = await page.$$eval('.mkt-order-lines li', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  if (clipped.length > 0) fail(`주문서 이름이 잘렸다 — ${clipped.join(', ')}`);
  // [구매 (🪙 × n)] — 값은 글자 「냥」이 아니라 닢 그림이 단위다
  const buyLbl = await page.$eval('[data-modal="order"] [data-action="confirmOk"]', (b) => ({
    coin: !!b.querySelector('.mkt-gold img'), text: b.textContent ?? '',
  }));
  if (!buyLbl.coin || !buyLbl.text.includes(`× ${ITEM_A.gold + ITEM_B.gold}`)) fail(`[구매] 단추가 「${buyLbl.text}」다 — 금화 그림 × 값이라야 한다`);
  ok(`[구매] 단추 — 「${buyLbl.text.trim()}」 + 금화 그림`);
  await page.click('[data-modal="order"] [data-action="confirmOk"]');
  await page.waitForSelector('[data-modal="bought"]', { timeout: 10_000 });
  await page.waitForTimeout(300);
  await shot('bought');
  const cols = await page.getAttribute('.mkt-bought', 'data-cols');
  if (cols !== '2') fail(`두 종류인데 ${cols}열이다 — 2×1이라야 한다`);
  const afterBuy = (await getProfile(uid))!;
  const spent = ITEM_A.gold + ITEM_B.gold;
  if (afterBuy.gold !== gold - spent) fail(`금화가 ${gold} → ${afterBuy.gold}다 — ${spent}냥이 나가야 한다`);
  if (afterBuy.marketOwned?.[ITEM_A.id] !== 1 || afterBuy.marketOwned?.[ITEM_B.id] !== 1) fail('서버의 보유가 주문서와 다르다');
  ok(`한 번에 샀다 — 금화 −${spent} · 격자 2×1`);

  step('보관함 (84·85쪽) — 한 개에 한 줄 · 구매일 · 지급 · [장수 선택]/[아이템 회수]');
  await page.click('[data-action="boughtStorage"]');
  await page.waitForSelector('[data-field="storage"] .mkt-irow[data-item]', { timeout: 5_000 });
  await shot('storage');
  const store = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-field="storage"] .mkt-irows .mkt-irow[data-item]')];
    const body = document.querySelector('[data-view="storage"].place-body, .mkt-body') as HTMLElement | null;
    return {
      rows: rows.map((r) => ({
        item: r.getAttribute('data-item'),
        bought: r.querySelector('[data-field="bought"]')?.textContent?.trim() ?? '',
        assigned: r.getAttribute('data-assigned'),
        give: !!r.querySelector('[data-action="giveItem"]'),
        revoke: !!r.querySelector('[data-action="revokeItem"]'),
      })),
      nameClipped: rows.map((r) => r.querySelector('.c-nm') as HTMLElement).filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent),
      oldCols: document.querySelectorAll('[data-field="storage"] [data-field="held"], [data-field="storage"] [data-field="given"]').length,
      bottomGive: !!document.querySelector('.mkt-cmds [data-action="giveItem"]'),
      scrolls: body ? body.scrollHeight > body.clientHeight + 1 : false,
      pageOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  });
  // 산 것은 탕약 1 · 태평요술 1 — 낱개 둘이 **두 줄**이다
  if (store.rows.length !== 2) fail(`보관함이 ${store.rows.length}줄이다 — 낱개 둘이면 두 줄이라야 한다`);
  if (store.nameClipped.length > 0) fail(`보관함 이름이 잘렸다 — ${store.nameClipped.join(', ')}`);
  if (store.oldCols !== 0) fail('보관함에 옛 「보유·지급」 수 칸이 남았다');
  if (store.bottomGive) fail('아래 명령 판에 [아이템 지급]이 남았다');
  if (!store.rows.every((r) => /^\d{2}\.\d{2}\.\d{2}$/.test(r.bought))) fail(`구매일이 안 찍혔다 — ${store.rows.map((r) => r.bought).join(', ')}`);
  if (!store.rows.every((r) => r.assigned === '0' && r.give && !r.revoke)) fail('미지급 줄의 명령이 [장수 선택]이 아니다');
  if (store.scrolls || store.pageOverflow) fail('보관함 화면에 스크롤이 생겼다');
  ok(`보관함 — 낱개마다 한 줄 · 구매일 ${store.rows[0]!.bought} · 미지급 줄은 [장수 선택]`);
  await page.click(`[data-field="storage"] [data-item="${ITEM_A.id}"] [data-action="giveItem"]`);
  await page.waitForSelector('[data-modal="officerPick"]', { timeout: 5_000 });
  await page.waitForTimeout(200);
  await shot('give-pick');
  // ★ 장수 고르기 판 — 제목 바 바로 아래 · 한 쪽 여섯 명 · 스크롤 없음 (2026-09-24 지정)
  const pick = await page.evaluate(() => {
    const bar = document.querySelector('[data-screen="market"] .place-nm')!.getBoundingClientRect();
    const modal = document.querySelector('[data-modal="officerPick"] .ofcpick-modal')!.getBoundingClientRect();
    const body = document.querySelector('[data-modal="officerPick"] .place-body') as HTMLElement;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return {
      gap: (modal.top - bar.bottom) / rem,
      rows: document.querySelectorAll('[data-modal="officerPick"] .ofc-rows .ofc-row[data-officer]').length,
      scrolls: body.scrollHeight > body.clientHeight + 1,
      fits: modal.bottom <= window.innerHeight + 1,
      stats: document.querySelectorAll('[data-modal="officerPick"] .c-st').length,
      status: document.querySelectorAll('[data-modal="officerPick"] .ofc-rows [data-field="status"]').length,
      eqClipped: [...document.querySelectorAll('[data-modal="officerPick"] .ofc-rows .c-eq, [data-modal="officerPick"] .ofc-rows .c-hs')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent),
    };
  });
  if (pick.gap < 0 || pick.gap > 0.6) fail(`장수 고르기 판이 제목 바에서 ${pick.gap.toFixed(2)}rem 떨어졌다 — 바로 아래라야 한다`);
  if (pick.rows !== 6) fail(`장수 고르기 한 쪽이 ${pick.rows}명이다 — 여섯이라야 한다`);
  if (pick.scrolls) fail('장수 고르기 목록에 스크롤이 생겼다 — 여섯 명이 그냥 들어야 한다');
  if (!pick.fits) fail('장수 고르기 판이 화면 아래로 넘친다');
  // 삼능력 대신 상태 · 병기 (2026-09-24 지정)
  if (pick.stats !== 0) fail(`장수 고르기에 무·지·통 칸이 ${pick.stats}개 남았다 — 상태·병기만이라야 한다`);
  if (pick.status !== pick.rows) fail(`상태 칸이 ${pick.status}개다 — 줄마다 하나라야 한다`);
  if (pick.eqClipped.length > 0) fail(`상태·병기 글자가 잘렸다 — ${pick.eqClipped.join(', ')}`);
  ok(`장수 고르기 — 제목 바 아래 ${pick.gap.toFixed(2)}rem · 여섯 명 · 스크롤 없음`);
  await pickOfficer(X!);
  await page.waitForSelector('[data-modal="giveSwap"]', { timeout: 5_000 });
  await shot('give-swap');
  ok('병기를 든 장수에게 주면 되묻는다');
  await page.click('[data-modal="giveSwap"] [data-action="confirmOk"]');
  await page.waitForSelector('.stw[data-say="storageNote"] [data-field="guideText"]', { timeout: 5_000 });
  const heldRow = `[data-field="storage"] .mkt-irow[data-holder="${X}"]`;
  if (!await page.$(heldRow)) fail('지급한 줄에 장수 이름이 안 붙었다');
  if (!await page.$(`${heldRow} [data-action="revokeItem"]`)) fail('지급한 줄의 명령이 [아이템 회수]가 아니다');
  await shot('storage-given');
  // 지급은 클라이언트 소유 — `PUT`이 서버에 닿을 때까지 **기다리며 본다**(정해 둔 시간만 자면 가끔 모자랐다)
  const serverSees = async (ok: (p: Awaited<ReturnType<typeof getProfile>>) => boolean): Promise<boolean> => {
    for (let i = 0; i < 30; i++) {
      if (ok(await getProfile(uid))) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  if (!await serverSees((p) => p?.marketCarry?.[X!] === ITEM_A.id)) fail('서버에 지급이 안 남았다');
  const afterGive = (await getProfile(uid))!;
  if (afterGive.forgeOwned[`${WEAPON.id}#1`] !== null) fail('병기가 대장간으로 안 돌아갔다');
  ok('지급 — 그 줄에 장수 이름 · [아이템 회수]로 바뀌고, 병기는 대장간으로');

  // [아이템 회수] — 되묻고, 그 줄이 다시 미지급이 된다
  await page.click(`${heldRow} [data-action="revokeItem"]`);
  await page.waitForSelector('[data-modal="revokeItem"]', { timeout: 5_000 });
  await shot('storage-revoke');
  await page.click('[data-modal="revokeItem"] [data-action="confirmOk"]');
  await page.waitForFunction((sel) => !document.querySelector(sel), heldRow, { timeout: 5_000 });
  if (!await serverSees((p) => !p?.marketCarry?.[X!])) fail('서버에서 회수가 안 됐다');
  const afterRevoke = (await getProfile(uid))!;
  if (afterRevoke.marketOwned?.[ITEM_A.id] !== 1) fail('회수했더니 보유가 바뀌었다 — 그대로라야 한다');
  ok('회수 — 되묻고, 줄이 미지급으로 · 보유는 그대로');

  // ★ 한 쪽 여섯 줄이 **스크롤 없이** 드는가 — 산 것 둘로는 판이 꽉 차지 않아, 낱개 여덟을 심고 다시 연다
  {
    const cur = (await getProfile(uid))!;
    const at = Date.now();
    await saveProfileTrusted(uid, {
      ...cur,
      marketOwned: { [ITEM_A.id]: 4, [ITEM_B.id]: 4 },
      marketBoughtAt: { [ITEM_A.id]: [at - 4000, at - 3000, at - 2000, at - 1000], [ITEM_B.id]: [at - 500, at - 400, at - 300, at - 200] },
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    await openMarket();
      await page.click('[data-action="openItems"]');
    await page.click('[data-action="openStorage"]');
    await page.waitForSelector('[data-field="storage"] .mkt-irows .mkt-irow[data-item]', { timeout: 5_000 });
    await page.waitForTimeout(200);
    await shot('storage-six');
    const six = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-field="storage"] .mkt-irows .mkt-irow[data-item]')];
      const body = document.querySelector('.mkt-body') as HTMLElement | null;
      const cmds = document.querySelector('.mkt-cmds')!.getBoundingClientRect();
      return {
        rows: rows.length,
        pager: document.querySelector('[data-field="storagePager"]')?.textContent ?? '',
        scrolls: body ? body.scrollHeight > body.clientHeight + 1 : false,
        pageOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
        cmdsVisible: cmds.bottom <= window.innerHeight + 1,
        clipped: rows.flatMap((r) => [...r.querySelectorAll('.c-nm, .c-hold, .c-made')] as HTMLElement[])
          .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent),
      };
    });
    if (six.rows !== 6) fail(`보관함 한 쪽이 ${six.rows}줄이다 — 여섯이라야 한다`);
    if (!/1\s*\/\s*2/.test(six.pager)) fail(`낱개 여덟이면 두 쪽이라야 한다 — 「${six.pager}」`);
    if (six.scrolls || six.pageOverflow) fail('보관함 여섯 줄에 스크롤이 생겼다');
    if (!six.cmdsVisible) fail('보관함 아래 명령 판이 화면 밖으로 밀렸다');
    if (six.clipped.length > 0) fail(`보관함 글자가 잘렸다 — ${six.clipped.join(', ')}`);
    ok('보관함 — 한 쪽 여섯 줄 · 두 쪽 · 스크롤 없음');
  }
  await page.click('[data-action="backHome"]');   // → 전투 아이템
  await page.click('[data-action="backHome"]');   // → 상품 구매

  step('도시 물자 (86쪽)');
  await page.click('[data-action="openGoods"]');
  await page.waitForSelector('[data-good="materials"]', { timeout: 5_000 });
  await shot('goods');
  if (await page.getAttribute('[data-good="grain"]', 'data-can') !== '0') fail('군량이 가득인데 군량 줄이 열려 있다');
  // 보유량은 머리 판이 말한다(2026-11-25) — 창고가 차면 군량 칸이 회색
  if (await page.getAttribute('[data-field="goodsStatus"] [data-field="grainNow"]', 'data-full') !== '1') fail('군량이 막혔는데 머리 판의 군량이 회색이 아니다');
  // 막힌 칸도 눌린다 — 판은 안 뜨고 내관이 까닭을 말한다(2026-11-25 기획자)
  await page.click('[data-good="grain"]');
  await page.waitForSelector('.stw[data-say="goodsWhy"][data-say-code="market.grainFull"]', { timeout: 5_000 });
  if (await page.$('[data-modal="goodAsk"], [data-modal="goodsDone"]')) fail('막힌 군량 칸을 눌렀는데 판이 떴다');
  const mats = afterGive.materials;
  if (await page.getAttribute('[data-good="materials"]', 'data-can') !== '1') {
    await shot('goods-stuck');
    fail(`건축 자재 칸이 막혀 있다 — 내관 「${await page.textContent('.stw[data-say="goodsWhy"]').catch(() => '')}」`);
  }
  // 줄을 누르면 「구매할까요?」(2026-11-13) — 물리면 안 사고, [확정]이라야 산다
  await page.click('[data-good="materials"]');
  await page.waitForSelector('[data-modal="goodAsk"]', { timeout: 5_000 });
  await shot('goods-ask');
  await page.click('[data-modal="goodAsk"] [data-action="confirmCancel"]');
  await page.waitForSelector('[data-modal="goodAsk"]', { state: 'detached' });
  if ((await getProfile(uid))!.materials !== mats) fail('확인 판에서 물렸는데 건축 자재가 바뀌었다');
  await page.click('[data-good="materials"]');
  await page.click('[data-modal="goodAsk"] [data-action="confirmOk"]');
  await page.waitForSelector('[data-modal="goodsDone"]', { timeout: 10_000 });
  await shot('goods-done');
  if ((await getProfile(uid))!.materials <= mats) fail('건축 자재가 안 늘었다');
  ok('건축 자재 — 칸을 누르면 확인 판 · 물리면 그대로 · [확정]하면 샀고 완료 판 · 막힌 군량은 내관이 까닭을 말한다');
  await page.click('[data-action="goodsClose"]');

  step('태학 연구 초기화 (87쪽) — 사서 바로 쓰고 [태학으로 이동]');
  await page.click('[data-good="academyReset"]');
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
  await openMarket();
  await page.click('[data-action="openGoods"]');
  await page.click('[data-good="respec"]');
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
  // [궁궐로 이동] → 장수 일람 + 그 장수의 카드 (2026-09-25 지정 — 예전엔 전면 레벨/스킬 관리 화면이었고,
  // 그 화면은 2026-10-06에 지웠다). 카드에 [재설계]가 없어야 한다
  await page.click('[data-action="toPalace"]');
  await page.waitForSelector(`.ofcard-modal[data-officer="${X}"]`, { timeout: 10_000 })
    .catch(() => fail('[궁궐로 이동]을 눌렀는데 그 장수의 카드가 안 열린다'));
  // 카드의 [강화](옛 [레벨/스킬 관리], 2026-11-20)는 곧장 레벨업 고르기라 [재설계]가 설 자리가 없다 — 카드에 없는 것만 본다
  if (await page.$('.ofcard-modal [data-action="respec"]')) fail('장수 카드에 [재설계]가 남아 있다 — 장터로 옮겼다');
  ok(`재설계 — Lv2 이상만 · ×${cardsSpentOn(3)} · [궁궐로 이동] → 장수 카드 · 궁궐의 [재설계]는 없다`);

  if (errors.length > 0) fail(`콘솔 오류 ${errors.length}건 — ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n장터 UX 통과 — 홈 · 용병 시장(1 · 3명 모집 · 빈자리 자물쇠 · 잉여 카드 모집) · 아이템 장바구니 · 보관함 지급 · 도시 물자 · 초기화 둘');
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
