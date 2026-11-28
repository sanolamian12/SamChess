/**
 * 레벨업 고르기 · 축하 화면 — **열 언어 사진첩** (2026-11-20 기획자 — 「언어별로 캡처해서 탭으로 넘겨 가며 확인」).
 *
 *   node --experimental-strip-types --env-file=.env tools/celebrate_gallery.ts [--out 폴더] [--langs ko,mn]
 *
 * 언어마다 같은 계정을 다시 심고 아홉 장을 찍는다(최소사양 휴대폰 iPhone 15 — `minSpec.ts`, 2배 해상도):
 * 레벨업 고르기(지원) · 고르기(환술 + MP) · 강화 완료 · 도시 증축 완료 · 건설 완료(대장간) · 증축 완료(장터) · 제작 완료 · 연구 완료 · 금화 구매 완료.
 * 끝에 `index.html`(언어 탭 · ←/→로 넘김 · 눌러 크게)을 만든다.
 * 금화 구매는 결제 전이라 개발용 지급이 꺼진 서버에서는 안 눌린다 — 브라우저에서 `/dev/status` · `/dev/grant`만 흉내 낸다(금화 +10).
 * 필요: Vite(5173) · 게임 API(8787). 계정은 끝에 지운다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MIN_SPEC, MIN_SPEC_PORTRAIT } from './minSpec.ts';
import type { Page } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { ACADEMY_RESEARCH_MS, SORTIE_TUTORIALS, createProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { TacticId } from '@samchess/rules';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { withGarrisons } from '../packages/meta/test/fixtures.ts';
import { cleanupUsers, makeUser } from './adminLook.ts';
import { shotDir } from './shotDir.ts';

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const OUT = arg('--out') ?? shotDir('celebrate_gallery');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';
const ALL = ['ko', 'en', 'es_419', 'it', 'ja', 'mn', 'pt_BR', 'pt_PT', 'zh_Hans', 'zh_Hant'];
const LANGS = arg('--langs')?.split(',') ?? ALL;
const LANG_NAMES: Record<string, string> = {
  ko: '한국어', en: 'English', es_419: 'Español', it: 'Italiano', ja: '日本語', mn: 'Монгол', pt_BR: 'Português (BR)', pt_PT: 'Português (PT)',
  zh_Hans: '简体中文', zh_Hant: '繁體中文',
};
const SHOTS: [string, string][] = [
  ['pick-support', '레벨업 고르기 — 지원'], ['pick-illusion', '레벨업 고르기 — 환술 · MP'], ['levelup', '강화 완료'],
  ['city', '도시 증축 완료 (대장간 · 장터 · 농지 함께)'],
  ['forge', '연구 완료'], ['academy', '연구 완료'], ['gold', '금화 구매 완료'],
];

/** 증축 조건이 찬 Lv1 도시 + 장수 넉넉히(카드 300) + 축하를 기다리는 대장간 연구 하나(2026-11-28 — 연구로) */
const seed = (): PlayerProfile => {
  const p = { ...createProfile(`사진첩-${randomUUID().slice(0, 4)}`, 5), tutorial: { done: [...SORTIE_TUTORIALS] } } as PlayerProfile;
  const first = Object.values(p.roster)[0]!;
  const extra = OFFICERS.filter((o) => !p.roster[o.id as keyof typeof p.roster]).slice(0, 20);
  const roster = { ...p.roster, ...Object.fromEntries(extra.map((o) => [o.id, { ...first, officer: o.id }])) } as PlayerProfile['roster'];
  return withGarrisons({
    ...p, roster, materials: 99, battleWins: 99, grainAt: Date.now(), gold: 1000,
    cards: Object.fromEntries(Object.keys(roster).map((id) => [id, 300])) as PlayerProfile['cards'],
    forge: { done: [{ level: 1, items: ['dae-gam-do'], doneAt: Date.now() - 1000 }], notice: ['dae-gam-do'] },
  } as PlayerProfile) as PlayerProfile;
};

const u = await makeUser('gallery', 'u');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: MIN_SPEC_PORTRAIT, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));

// 금화 구매 — 개발용 지급을 켠 서버처럼 답한다(CORS 머리 함께)
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' };
await page.route('**/dev/status', (r) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ grants: true }) }));
await page.route('**/dev/grant', async (r) => {
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
  const p = (await getProfile(u.uid))!;
  return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ...p, gold: p.gold + 10 }) });
});

const shot = (lang: string, name: string) => page.screenshot({ path: join(OUT, `${lang}-${name}.jpg`), type: 'jpeg', quality: 84 });
/** 축하 화면이 다 터진 뒤 찍고 눌러 닫는다 */
async function celebrate(lang: string, modal: string, name: string, action = 'doneOk'): Promise<void> {
  await page.waitForSelector(`[data-modal="${modal}"]`, { timeout: 15_000 });
  await page.waitForTimeout(2_000);
  await shot(lang, name);
  await page.click(`[data-modal="${modal}"] [data-action="${action}"]`);
  await page.waitForSelector(`[data-modal="${modal}"]`, { state: 'detached', timeout: 5_000 });
}
async function home(p: Page): Promise<void> {
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 });
  await p.waitForTimeout(700);
}

let failed = false;
try {
  await saveProfileTrusted(u.uid, seed());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', u.email);
  await page.fill('[data-field="password"]', u.password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 });

  for (const lang of LANGS) {
    console.log(`▶ ${lang}`);
    await saveProfileTrusted(u.uid, seed());
    await page.evaluate((l) => { localStorage.setItem('samchess.lang', l); localStorage.removeItem('samchess.forge.called'); }, lang);

    // 도시 증축 — 대장간 짓기 · 장터 증축 · 농지 짓기를 함께 고른다(2026-11-23 — 증축이 건물 셋을 함께 올린다. 건물 완료 팝업은 없어졌다)
    await home(page);
    await page.click('.city-hot[data-place="palace"]', { force: true });
    await page.click('[data-action="city"]');
    await page.click('[data-action="upgrade"]');
    for (const b of ['forge', 'market', 'farm']) await page.click(`[data-modal="upgrade"] [data-action="pickBuilding"][data-building="${b}"]`);
    await page.click('[data-action="upgradeConfirm"]');
    await celebrate(lang, 'upgradeDone', 'city');

    // 레벨업 — 첫 장수(Lv1). 도시가 Lv1이면 장수도 Lv1까지라 증축 뒤에 한다
    await home(page);
    const officer = Object.keys((await getProfile(u.uid))!.roster)[0]!;
    await page.click('.scr-main [data-place="palace"]', { force: true });
    await page.click('[data-action="officers"]');
    await page.fill('input[data-field="search"]', OFFICERS.find((o) => o.id === officer)!.name);
    await page.waitForTimeout(300);
    await page.click(`.ofc-rows [data-officer="${officer}"]`);
    await page.click('.ofcard-modal [data-action="levels"]');
    await page.waitForSelector('[data-screen="levelup-panel"]');
    await page.waitForTimeout(700);
    await shot(lang, 'pick-support');
    await page.click('.lvu-tab[data-school="illusion"]');
    await page.click('.lv-stat-row[data-stat="mp"]');
    await page.waitForTimeout(700);
    await shot(lang, 'pick-illusion');
    await page.click('.lvu-tab[data-school="support"]');
    await page.click('.lv-stat-row[data-stat="hp"]');
    await page.click('[data-action="confirm"]');
    await celebrate(lang, 'levelUpDone', 'levelup');

    // 7. 제작 완료 — 미지급 한 자루가 대장간에 들어서자마자 뜬다
    await home(page);
    await page.click('.city-gate rect', { force: true });   // 배경이 떠다녀 「안정」을 안 기다린다
    await page.click('[data-place="forge"]', { force: true });
    await celebrate(lang, 'forgeNotice', 'forge', 'ackDone');

    // 8. 금화 구매 완료
    await home(page);
    await page.click('[data-place="market"]', { force: true });
    await page.click('[data-action="openGold"]');
    await page.waitForSelector('.mkt-pack[data-pack="0"]:not([disabled])', { timeout: 8_000 });
    await page.click('.mkt-pack[data-pack="0"]');
    await celebrate(lang, 'goldDone', 'gold');

    // 9. 연구 완료 — 끝난 연구를 심고 새로 고치면 메인에서 뜬다
    const p = (await getProfile(u.uid))!;
    await saveProfileTrusted(u.uid, {
      ...p, buildings: { ...p.buildings, academy: Math.max(1, p.buildings.academy ?? 0) },
      academy: { done: [], research: { level: 1, tactic: 'jeung-pok-plus' as TacticId, startedAt: Date.now() - ACADEMY_RESEARCH_MS - 1_000 } },
    } as PlayerProfile);
    await page.reload({ waitUntil: 'networkidle' });
    await celebrate(lang, 'academyNotice', 'academy', 'academyNoticeOk');
  }
} catch (e) {
  failed = true;
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  await page.screenshot({ path: join(OUT, 'zz-fail.jpg'), type: 'jpeg' }).catch(() => undefined);
} finally {
  await browser.close();
  await cleanupUsers();
  await pool.end().catch(() => {});
}
if (errors.length) console.log(`  · 페이지 오류: ${[...new Set(errors)].join(' | ')}`);

// ── 사진첩 HTML — 언어 탭 · ←/→ · 눌러 크게 ──
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>축하 화면 언어별</title>
<style>
  :root { --bg: #17120d; --panel: #241b13; --ink: #f1e6cf; --dim: #b9a582; --gold: #e2b85a; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: system-ui, "Malgun Gothic", sans-serif; }
  header { position: sticky; top: 0; z-index: 2; background: #0f0b08ee; backdrop-filter: blur(6px); padding: 12px 16px 0; border-bottom: 1px solid #3a2c1d; }
  h1 { margin: 0 0 8px; font-size: 1.05rem; font-weight: 700; }
  h1 small { color: var(--dim); font-weight: 400; margin-left: .5rem; }
  nav { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: thin; }
  nav button { flex: none; border: 0; border-radius: 8px 8px 0 0; padding: 8px 14px; background: var(--panel); color: var(--dim); font: inherit; font-size: .9rem; cursor: pointer; }
  nav button[aria-selected="true"] { background: var(--gold); color: #1d140a; font-weight: 700; }
  main { padding: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
  figure { margin: 0; background: var(--panel); border-radius: 10px; padding: 8px; }
  figure img { display: block; width: 100%; height: auto; border-radius: 6px; cursor: zoom-in; background: #000; }
  figcaption { font-size: .85rem; color: var(--dim); padding: 6px 2px 0; }
  .zoom { position: fixed; inset: 0; z-index: 5; background: #000d; display: none; align-items: center; justify-content: center; cursor: zoom-out; }
  .zoom.on { display: flex; }
  .zoom img { max-height: 96vh; max-width: 96vw; }
  .missing { aspect-ratio: ${MIN_SPEC.width} / ${MIN_SPEC.height}; display: flex; align-items: center; justify-content: center; color: var(--dim); font-size: .85rem; border: 1px dashed #4a3a28; border-radius: 6px; }
</style></head>
<body>
<header><h1>레벨업 고르기 · 축하 화면 <small>열 언어 · ←/→ 키로 언어 넘김 · 사진을 누르면 크게</small></h1><nav id="tabs"></nav></header>
<main><div class="grid" id="grid"></div></main>
<div class="zoom" id="zoom"><img alt=""></div>
<script>
const LANGS = ${JSON.stringify(ALL.map((l) => [l, LANG_NAMES[l] ?? l]))};
const SHOTS = ${JSON.stringify(SHOTS)};
const tabs = document.getElementById('tabs'), grid = document.getElementById('grid'), zoom = document.getElementById('zoom');
let cur = 0;
function show(i) {
  cur = (i + LANGS.length) % LANGS.length;
  [...tabs.children].forEach((b, j) => b.setAttribute('aria-selected', String(j === cur)));
  tabs.children[cur].scrollIntoView({ inline: 'nearest', block: 'nearest' });
  const lang = LANGS[cur][0];
  grid.innerHTML = '';
  for (const [name, cap] of SHOTS) {
    const f = document.createElement('figure');
    const img = new Image(); img.loading = 'lazy'; img.alt = cap; img.src = lang + '-' + name + '.jpg';
    img.onerror = () => { const m = document.createElement('div'); m.className = 'missing'; m.textContent = '사진 없음'; img.replaceWith(m); };
    img.onclick = () => { zoom.querySelector('img').src = img.src; zoom.classList.add('on'); };
    const c = document.createElement('figcaption'); c.textContent = cap;
    f.append(img, c); grid.append(f);
  }
  try { localStorage.setItem('gallery.lang', lang); } catch {}
}
LANGS.forEach(([l, n], i) => { const b = document.createElement('button'); b.textContent = n; b.onclick = () => show(i); tabs.append(b); });
zoom.onclick = () => zoom.classList.remove('on');
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') zoom.classList.remove('on');
  if (e.key === 'ArrowRight') show(cur + 1);
  if (e.key === 'ArrowLeft') show(cur - 1);
});
let start = 0; try { start = Math.max(0, LANGS.findIndex(([l]) => l === localStorage.getItem('gallery.lang'))); } catch {}
show(start);
</script>
</body></html>
`;
writeFileSync(join(OUT, 'index.html'), html);
console.log(`${failed ? '✗ 도중에 멈췄다' : '✓ 다 찍었다'} — ${join(OUT, 'index.html')}`);
process.exit(failed ? 1 : 0);
