/**
 * 대장간 지급 관리 UX 확인 — **장수가 많은 계정**에서 표가 견디는지, 그리고
 * 「이미 낀 장수를 고르면 교체된다」가 실제로 눈에 띄는지 본다 (2026-09-10).
 *
 *   VW=760 VH=1200 SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/forge_ux.ts
 *
 * `forge_play.ts`가 「한 바퀴가 도는가」라면 이쪽은 「많을 때도 읽히는가」다 —
 * 장수 다섯 명짜리 새 계정으로는 스크롤도 페이지도 교체 안내도 한 번도 안 그려진다
 * (「안 도는 갈래」의 사촌 — 상태에 도달을 못 해 검사가 헛돈다).
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { newInstance } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
const HOW_MANY = Number(process.env['OFFICERS'] ?? 120);

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);

const email = `forge-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? 760), height: Number(process.env['VH'] ?? 1200) },
});
// 확인창은 **받되 문구를 적어 둔다** — 「교체를 알려 주는가」가 이 검사의 요점이라
// 조용히 accept만 하면 뜬 적이 없어도 통과한다
const dialogs: string[] = [];
page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', '지급실험');
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  /*
   * 장수를 많이 심고, **병기 둘을 이미 보유**시킨다 — 하나는 어느 장수에게
   * 이미 지급된 상태로. 그래야 지급 화면의 「병기」 칸에 빈칸 아닌 값이 뜨고,
   * 다른 병기를 그 장수에게 주려 할 때 **교체**가 실제로 그려진다.
   */
  step(`장수 ${HOW_MANY}명 · 병기 2개(하나는 이미 지급)를 심는다`);
  const stored = await getProfile(uid);
  const roster = { ...stored!.roster } as Record<string, unknown>;
  const ids = OFFICERS.map((o) => o.id as OfficerId);
  for (const id of ids.slice(0, HOW_MANY)) if (!roster[id]) roster[id] = newInstance(id);
  const worn = Object.keys(roster)[3]!;
  await saveProfileTrusted(uid, {
    ...stored!,
    gold: 500,
    cityLevel: 11,
    buildings: { ...stored!.buildings, forge: 5, palace: 11 },
    roster,
    forgeOwned: { 'dae-gam-do': worn, 'su-geuk': null },
  } as Parameters<typeof saveProfileTrusted>[1]);
  ok(`장수 ${Object.keys(roster).length}명, 대감도는 ${worn}가 이미 낀 상태`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.city-gate rect');
  await page.waitForSelector('[data-place="forge"]');
  await page.click('[data-place="forge"]');
  await page.waitForSelector('[data-action="assign"]');
  if (await page.$('[data-action="ackDone"]')) await page.click('[data-action="ackDone"]');

  step('지급 관리 목록 — 보유 2개, 하나는 지급됨');
  await page.click('[data-action="assign"]');
  await page.waitForSelector('.frg-row');
  await page.screenshot({ path: `${SHOTS}/ux-01-assign-list.png` });
  ok(`📷 ux-01-assign-list.png — ${(await page.$$('.frg-row')).length}줄`);

  step('미지급 병기(수극)를 줄 장수를 고른다 — 장수가 많은 표');
  await page.click('.frg-row[data-item="su-geuk"] [data-action="give"]');
  await page.waitForSelector('[data-action="equipPick"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/ux-02-pick-many.png` });

  const table = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ofc-row-equip:not(.ofc-thead)')] as HTMLElement[];
    const box = document.querySelector('.ofc-rows') as HTMLElement;
    const withEquip = rows.filter((r) => {
      const eq = r.querySelector('.c-eq') as HTMLElement | null;
      return eq && !!eq.textContent && eq.textContent.trim() !== '없음';
    }).map((r) => (r.querySelector('.c-nm-text')?.textContent ?? '') + ' / ' + (r.querySelector('.c-eq')?.textContent ?? ''));
    return {
      rowsOnPage: rows.length,
      scrollable: box ? box.scrollHeight > box.clientHeight + 1 : null,
      scrollH: box?.scrollHeight, clientH: box?.clientHeight,
      pager: document.querySelector('.ofc-pager, [data-field="pager"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      alreadyEquipped: withEquip,
    };
  });
  console.log(`  표 — ${JSON.stringify(table, null, 2).replace(/\n/g, '\n  ')}`);

  step('이미 대감도를 낀 장수의 줄을 찾는다 — 한 쪽에 10명이라 넘겨 가며 본다');
  for (let i = 0; i < 20; i += 1) {
    if (await page.$(`.ofc-row-equip[data-officer="${worn}"]`)) break;
    const next = await page.$('.ofc-pager [data-action="next"], [data-action="nextPage"]');
    if (!next) break;
    await next.click();
    await page.waitForTimeout(250);
  }
  const wornRow = await page.evaluate((id) => {
    const row = document.querySelector(`.ofc-row-equip[data-officer="${id}"]`) as HTMLElement | null;
    if (!row) return null;
    return {
      name: row.querySelector('.c-nm-text')?.textContent ?? '',
      equip: row.querySelector('.c-eq')?.textContent ?? '',
      pick: row.querySelector('[data-action="equipPick"]')?.textContent ?? '',
    };
  }, worn);
  console.log(`  이미 낀 장수 줄 — ${JSON.stringify(wornRow)}`);
  await page.screenshot({ path: `${SHOTS}/ux-03-worn-row.png` });

  if (wornRow) {
    step('그 장수를 골라 본다 — 교체가 조용히 일어나는가, 알려 주는가');
    await page.click(`.ofc-row-equip[data-officer="${worn}"] [data-action="equipPick"]`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/ux-04-after-swap.png` });
    const after = await page.evaluate(() => [...document.querySelectorAll('.frg-row')].map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim()));
    console.log(`  교체 뒤 지급 목록 — ${JSON.stringify(after)}`);
    console.log(dialogs.length ? `  ✓ 교체 확인창 — ${JSON.stringify(dialogs)}` : '  ✗ 교체 확인창이 안 떴다 — 병기가 조용히 벗겨진다');
  }

  /*
   * 장수 카드에 낀 병기가 뜨는가 (2026-09-10에 새로 넣은 줄). 대장간이 아니라
   * **궁궐 → 장수 관리**로 들어가 그 장수를 직접 연다 — 지급 화면에서 보이는
   * 것과 **다른 자리**라는 게 이 검사의 요점이다.
   */
  step('궁궐 → 장수 관리에서 그 장수를 직접 열어 본다');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('[data-place="palace"]');
  await page.waitForSelector('[data-action="officers"], .ofc-row', { timeout: 10_000 });
  if (await page.$('[data-action="officers"]')) await page.click('[data-action="officers"]');
  await page.waitForSelector('.ofc-row', { timeout: 10_000 });
  await page.fill('.scr-officers input', '');
  for (let i = 0; i < 20; i += 1) {
    if (await page.$(`.ofc-row[data-officer="${worn}"]`)) break;
    const next = await page.$('[data-action="nextPage"]');
    if (!next) break;
    await next.click();
    await page.waitForTimeout(200);
  }
  await page.click(`.ofc-row[data-officer="${worn}"]`);
  // **장수 카드는 팝업이다**(`OfficerCardModal`, `.ofcard`) — 전면 화면
  // (`OfficerDetailScreen`)이 아니다. 처음에 그쪽을 기다렸다가 10초를 헛보냈다.
  await page.waitForSelector('.ofcard', { timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/ux-05-officer-card.png` });
  const card = await page.evaluate(() => {
    const el = document.querySelector('[data-field="equip"]') as HTMLElement | null;
    if (!el) return null;
    const img = el.querySelector('img') as HTMLImageElement | null;
    return {
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      item: (el.querySelector('.ofc-equip-item') as HTMLElement | null)?.dataset['item'] ?? null,
      imgOk: img ? img.naturalWidth > 0 : null,
      h: +el.getBoundingClientRect().height.toFixed(1),
    };
  });
  console.log(card ? `  ✓ 장수 카드 병기 줄 — ${JSON.stringify(card)}` : '  ✗ 장수 카드에 병기 줄이 없다');

  /*
   * 해설이 UI 언어를 따라가는가 (2026-09-10에 아홉 언어를 붙였다). 화면은
   * `item.loreI18n?.[lang] ?? item.lore` 한 줄이라 **번역이 실제로 실렸는지**만
   * 보면 된다 — 언어를 바꾸고 상세 패널을 열어 한국어 원문과 다른지 본다.
   * 「있는가」가 아니라 「한국어가 아닌가」를 봐야 물러남과 구별된다.
   */
  step('언어를 바꿔 병기 해설이 따라오는지 본다');
  const loreOf = async (): Promise<string> => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    await page.click('.city-gate rect');
    await page.waitForSelector('[data-place="forge"]');
    await page.click('[data-place="forge"]');
    await page.waitForSelector('[data-action="craft"]');
    if (await page.$('[data-action="ackDone"]')) await page.click('[data-action="ackDone"]');
    await page.click('[data-action="craft"]');
    await page.waitForSelector('.frg-tile');
    await page.click('.frg-tile');
    await page.waitForSelector('[data-action="startOrder"]');
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const lore = (document.querySelector('.frg-item-lore')?.textContent ?? '').trim();
      const eff = (document.querySelector('.frg-item-effect')?.textContent ?? '').trim();
      return `${lore}
      효과: ${eff}`;
    });
  };
  const ko = await loreOf();
  for (const lang of ['ja', 'en', 'mn']) {
    // 상세 패널을 닫고 나서 기어를 누른다 — 열린 채로는 `.modal-back`이 클릭을 가로챈다
    if (await page.$('[data-action="closeDetail"]')) await page.click('[data-action="closeDetail"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="settings"]');
    await page.waitForSelector(`[data-modal="settings"] [data-lang="${lang}"]`, { timeout: 5_000 });
    await page.click(`[data-modal="settings"] [data-lang="${lang}"]`);
    await page.waitForTimeout(250);
    const got = await loreOf();
    const same = got === ko;
    console.log(`  ${same ? '✗' : '✓'} ${lang} — ${same ? '한국어 그대로다(번역이 안 실렸다)' : got.slice(0, 120)}`);
    if (lang === 'ja') await page.screenshot({ path: `${SHOTS}/ux-06-lore-ja.png` });
  }
} catch (e) {
  console.error('✗', e);
  await page.screenshot({ path: `${SHOTS}/ux-fail.png` });
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  process.exit(0);
}
