/**
 * 컬렉션 도시 효과 화면 확인 (2026-10-15) — 바뀐 값과 붉은 인장이 제자리에 서는가.
 * 최대 군량은 도시 관리 말고도 병영 현황판 · 장터 홈 · 장터 물자에 숫자로 나와 그 셋에도 인장을 본다.
 *
 *   SHOTS=<dir> [UI_LANG=en] node --experimental-strip-types --env-file=.env tools/city_bonus_ux.ts
 *
 * 필요한 것: `npm run dev`(5173) · 새 코드의 `server-api`(8787).
 *
 * 새 계정에는 완성한 컬렉션이 없어 표지가 **하나도 안 선다** — 그래서 도시 효과를 단 12개를 전부 한 시간 전에 완성한
 * 것으로 서버 쪽에서 심고, 병원 · 대장간 · 태학 · 농지를 짓고, 부상 하나와 도적떼 하나를 둔다. 숫자는 meta가 낸 값과
 * 화면의 `data-city-from` · `data-city-to`를 맞춘다(글자가 아니라 속성으로 — CLAUDE.md).
 * 끝에 표지가 **없어야 하는** 계정(완성 0)도 한 번 본다 — 「있는가」만 보면 늘 그리는 버그를 못 잡는다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { COLLECTIONS, OFFICERS } from '@samchess/data';
import {
  ACADEMY_RESEARCH_MS, HEAL_MS, RAID_LOOT_PCT, applyInjuries, craftDurationMs, forgeDurationMs, healMsFor, newInstance, raidDay,
  researchMs,
} from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
const LANG = process.env['UI_LANG'] ?? '';

const fail = (m: string): never => { console.error(`✗ ${m}`); process.exit(1); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);

const admin = { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };
const email = `citybonus-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 1200 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
page.on('response', (r) => { if (r.status() === 404 && new URL(r.url()).pathname !== '/profile') errors.push(`404 ${new URL(r.url()).pathname}`); });
const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

const CITY = COLLECTIONS.filter((c) => c.effect.kind === 'city');
type Stored = NonNullable<Awaited<ReturnType<typeof getProfile>>>;

async function seed(patch: (p: Stored) => Partial<Stored>): Promise<Stored> {
  const stored = (await getProfile(uid))!;
  const next = { ...stored, ...patch(stored) } as Stored;
  await saveProfileTrusted(uid, next as Parameters<typeof saveProfileTrusted>[1]);
  return next;
}
async function toMain(): Promise<void> {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
}
async function toExt(place: string, ready: string): Promise<void> {
  await toMain();
  await page.click('.city-gate rect', { force: true });
  await page.waitForSelector(`[data-place="${place}"]`);
  await page.click(`[data-place="${place}"]`, { force: true });
  await page.waitForSelector(ready, { timeout: 10_000 });
}
/** 인장을 눌러 팝업이 화면을 덮고 컬렉션 줄이 기대한 수만큼인지 본다 */
async function popup(sel: string, n: number, name: string): Promise<void> {
  // 인장 그림이 제 칸(글자 높이)보다 크면 그 화면의 `img` 규칙이 덮은 것이다 — 장터 홈에서 재화 아이콘 크기로 커졌다
  const size = await page.$eval(sel, (b) => {
    const img = b.querySelector('img');
    return img ? img.getBoundingClientRect().width - b.getBoundingClientRect().width : 0;
  });
  if (size > 1) fail(`${name} 인장 그림이 제 칸보다 ${size.toFixed(1)}px 크다 — 그 화면의 img 규칙이 덮었다`);
  await page.click(sel);
  await page.waitForSelector('[data-modal="cityBonus"] li');
  const rows = await page.$$eval('[data-modal="cityBonus"] li', (els) => els.map((e) => (e as HTMLElement).dataset.collection));
  if (rows.length !== n) fail(`${name} 팝업 줄이 ${rows.length}개 — ${n}개여야 한다`);
  const cover = await page.evaluate(() => {
    const back = document.querySelector('[data-modal="cityBonus"]')!.getBoundingClientRect();
    const scr = document.querySelector('.scr')!.getBoundingClientRect();
    return Math.abs(back.top - scr.top) < 2 && Math.abs(back.height - scr.height) < 2;
  });
  if (!cover) fail(`${name} 팝업의 가리개가 화면을 덮지 않는다 — 판 안에 갇혔다`);
  await shot(`cbx-${name}-popup`);
  await page.click('[data-modal="cityBonus"] [data-action="close"]');
  await page.waitForSelector('[data-modal="cityBonus"]', { state: 'detached' });
  ok(`${name} 팝업 — ${n}줄 · 화면을 덮는다`);
}
async function changed(sel: string, from: number, to: number, name: string): Promise<void> {
  const el = await page.$(sel);
  if (!el) fail(`${name} — 그은 값(${sel})이 없다`);
  const got = { from: Number(await el!.getAttribute('data-city-from')), to: Number(await el!.getAttribute('data-city-to')) };
  if (got.from !== from || got.to !== to) fail(`${name} — 화면 ${got.from}→${got.to}, meta ${from}→${to}`);
  ok(`${name} ${from} → ${to} (meta와 같다)`);
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
    await page.fill('.scr-new .newgame-form input', `효과실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  step('표지가 없어야 하는 계정 — 완성 0, 건물만 짓는다');
  const now0 = Date.now();
  await seed((p) => {
    const roster = { ...p.roster } as Record<string, ReturnType<typeof newInstance>>;
    for (const o of OFFICERS.filter((o) => o.grade !== 'E').slice(0, 10)) roster[o.id] ??= newInstance(o.id as OfficerId);
    return {
      cityLevel: 5, gold: 500, roster,
      buildings: { ...p.buildings, barracks: 3, farm: 3, hospital: 2, forge: 2, academy: 2 },
      // 농지를 지으면 서버가 그날의 도적떼를 곧장 출몰시켜 알림이 화면을 막는다 — 오늘 것은 끝난 것으로 두고
      // 마지막 단계에서 따로 출몰시킨다. 정산 시각을 마감과 다르게 두어 「자동 항복」 알림도 안 뜬다
      raid: { day: raidDay(now0), bandits: 3, spawnedAt: now0, grainAtSpawn: 0, status: 'surrendered', loot: 0, settledAt: now0 },
    };
  });
  await toMain();
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.waitForSelector('[data-action="city"]');
  await page.click('[data-action="city"]');
  await page.waitForSelector('.cty-bld');
  if (await page.$('[data-city-bonus]')) fail('완성한 컬렉션이 없는데 인장이 섰다');
  ok('도시 관리 — 인장 없음');

  step('도시 효과 12개를 한 시간 전에 완성 · 부상 하나');
  const done = now0 - 3_600_000;
  const stored = await seed((p) => {
    const completedAt: Record<string, number> = {};
    const slots: Record<string, number[]> = {};
    for (const c of CITY) { completedAt[c.id] = done; slots[c.id] = c.slots.map((_, i) => i); }
    const hurt = applyInjuries(p, [Object.keys(p.roster)[0] as OfficerId], Date.now());
    return { collection: { slots, completedAt }, roster: hurt.roster };
  });

  step('도시 관리 — 병영 · 농지 · 병원 · 대장간 · 태학 줄 끝에 인장');
  await toMain();
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.waitForSelector('[data-action="city"]');
  await page.click('[data-action="city"]');
  await page.waitForSelector('.cty-bld [data-city-bonus]');
  await shot('cbx-01-city');
  const marks = await page.$$eval('.cty-bld', (rows) => rows
    .filter((r) => r.querySelector('[data-city-bonus]'))
    .map((r) => (r as HTMLElement).dataset.building).sort());
  if (marks.join(',') !== 'academy,barracks,farm,forge,hospital') fail(`인장이 선 줄 — ${marks.join(',')}`);
  ok(`인장 다섯 줄 — ${marks.join(' · ')}`);
  await popup('.cty-bld[data-building="barracks"] [data-city-bonus]', 3, '병영');

  step('최대 군량 — 병영 현황판 · 장터 홈 · 장터 물자의 군량 줄에도 인장 (값은 같은 grainCap())');
  await toMain();
  await page.click('.scr-main [data-place="barracks"]', { force: true });
  await page.waitForSelector('.bar-status [data-field="grain"]', { timeout: 10_000 });
  await shot('cbx-01b-barracks');
  await popup('.bar-status [data-field="grain"] [data-city-bonus="grainCap"]', 3, '병영현황');
  await toMain();
  await page.click('[data-place="market"]', { force: true });
  await page.waitForSelector('[data-screen="market"]', { timeout: 10_000 });
  await shot('cbx-01c-market');
  await popup('[data-currency="grain"] [data-city-bonus="grainCap"]', 3, '장터홈');
  await page.click('[data-action="openShop"]');
  await page.click('[data-action="openGoods"]');
  await page.waitForSelector('[data-good="grain"]', { timeout: 5_000 });
  await shot('cbx-01d-goods');
  // 인장은 줄 안에 있다 — 눌러도 줄이 골라지면 안 된다(단추 안 단추를 피해 줄은 div다)
  await popup('[data-good="grain"] [data-field="grainNow"] [data-city-bonus="grainCap"]', 3, '장터물자');
  if (await page.getAttribute('[data-good="grain"]', 'data-picked') === '1') fail('인장을 눌렀는데 군량 줄이 골라졌다');
  // 팝업은 포털이지만 React 이벤트는 포털을 지나 줄까지 올라간다 — **가리개를 눌러 닫아도** 줄이 안 골라져야 한다
  await page.click('[data-good="grain"] [data-city-bonus="grainCap"]');
  const back = (await page.$('[data-modal="cityBonus"]'))!;
  const box = (await back.boundingBox())!;
  await page.mouse.click(box.x + 6, box.y + box.height - 6);   // 판 밖 · 가리개 안의 아래 귀퉁이
  await page.waitForSelector('[data-modal="cityBonus"]', { state: 'detached' });
  if (await page.getAttribute('[data-good="grain"]', 'data-picked') === '1') fail('인장 팝업의 가리개를 눌렀는데 군량 줄이 골라졌다');
  ok('장터 물자 — 인장을 눌러도 줄은 안 골라진다');

  step('병원 — 입원 팝업의 「치료 ~~1분~~ 30초」');
  await toExt('hospital', '.scr-building-hospital [data-action="admit"]');
  await page.click('[data-action="admit"]');
  await page.waitForSelector('[data-modal="hospitalPick"] [data-field="free"]');
  await shot('cbx-02-hospital');
  await changed('[data-modal="hospitalPick"] [data-city-from]', HEAL_MS, healMsFor(stored, Date.now()), '치료 시간');

  step('대장간 — 상세 단추와 주문 확인창의 제조 시간');
  await toExt('forge', '[data-action="craft"]');
  await page.click('[data-action="craft"]');
  await page.waitForSelector('.frg-tile');
  await page.click('.frg-tile');
  await page.waitForSelector('[data-action="startOrder"]');
  const lv = Number(await page.evaluate(() =>
    document.querySelector('[data-action="startOrder"] [data-city-from]') ? 1 : 0));
  if (!lv) fail('상세 단추에 그은 값이 없다');
  const fromMs = Number(await page.getAttribute('[data-action="startOrder"] [data-city-from]', 'data-city-from'));
  const unlock = fromMs / craftDurationMs(1);
  await changed('[data-action="startOrder"] [data-city-from]', craftDurationMs(unlock), forgeDurationMs(stored, unlock, Date.now()), `Lv${unlock} 제조 시간`);
  await shot('cbx-03-forge-detail');
  await page.click('[data-action="startOrder"]');
  await page.waitForSelector('[data-modal="orderConfirm"], .frg-confirm');
  await shot('cbx-04-forge-confirm');
  await changed('.frg-confirm [data-city-from]', craftDurationMs(unlock), forgeDurationMs(stored, unlock, Date.now()), '확인창 제조 시간');
  await popup('.frg-confirm [data-city-bonus]', 1, '대장간');

  step('태학 — [연구 시작]의 연구 시간');
  await toExt('academy', '.scr-building-academy [data-field="status"]');
  await page.click('[data-action="openResearch"]');
  await page.waitForSelector('[data-modal="academyPick"] .acd-topic');
  await page.click('[data-modal="academyPick"] .acd-topic');
  await shot('cbx-05-academy');
  await changed('[data-action="startResearch"] [data-city-from]', ACADEMY_RESEARCH_MS, researchMs(stored, Date.now()), '연구 시간');
  if (!await page.$('[data-modal="academyPick"] [data-city-bonus="research"]')) fail('태학 인장이 없다');
  // 바뀐 시간이 든 단추는 길어진다 — 단추는 접지 않으므로(`white-space: nowrap`) 넘치는지만 본다
  const over = await page.$eval('[data-action="startResearch"]', (b) => (b as HTMLElement).scrollWidth - (b as HTMLElement).clientWidth);
  if (over > 1) fail(`[연구 시작] 글이 ${over}px 넘친다`);
  ok(`[연구 시작] 넘침 ${over}px`);
  ok('태학 인장');

  step('농지 · 도적떼 — 출몰 알림 · 현황판');
  await seed((p) => ({ raid: { day: raidDay(Date.now()), bandits: 3, spawnedAt: Date.now(), grainAtSpawn: p.grain, status: 'pending' } }));
  await toMain();
  await page.waitForSelector('[data-modal="raidAlert"]', { timeout: 10_000 });
  await shot('cbx-06-raid-alert');
  if (!await page.$('[data-modal="raidAlert"] [data-field="rate"] [data-city-bonus="raidLoot"]')) fail('약탈률 줄에 인장이 없다');
  await changed('[data-modal="raidAlert"] [data-field="rate"] [data-city-from]', RAID_LOOT_PCT, RAID_LOOT_PCT - 20, '약탈률');
  if (!await page.$('[data-modal="raidAlert"] [data-field="left"] [data-city-bonus="raidResp"]')) fail('남은 시간 줄에 인장이 없다');
  const left = await page.textContent('[data-modal="raidAlert"] [data-field="left"]');
  if (!/1[01]:\d\d/.test(left ?? '')) fail(`응전 시간이 11분이 아니다 — ${left}`);
  ok(`알림 — 인장 둘 · ${left?.trim()}`);
  await page.click('[data-action="raidPrepare"]');
  await page.waitForSelector('.frm-status [data-field="raid"]', { timeout: 10_000 });
  await shot('cbx-07-farm');
  if (!await page.$('[data-field="grainPerHour"] [data-city-bonus="grainRate"]')) fail('시간당 군량에 인장이 없다');
  await popup('[data-field="raid"] [data-city-bonus]', 3, '도적떼');

  if (errors.length) fail(`콘솔 오류 ${errors.length}건 — ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n완주');
} catch (e) {
  await shot('cbx-fail').catch(() => {});
  throw e;
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: admin });
}
