/**
 * 첫 증축의 길 눈 확인 (2026-11-13) — 증축 조건이 찬 계정으로 **안내를 켜고**(`?guide=1`) 메인 → 궁궐 → 도시 관리 → 증축 → 건물 관리 → 짓기를
 * 지나며 내관의 말(`city.ready` · `city.build` · `buildings.intro`)과 **그 일을 할 때까지 남는 표지**(meta `growthCue` — 메인 궁궐 자리의 가리킴,
 * 명령 단추의 금빛 `data-guide-cue`)가 제자리에 서고 제때 꺼지는지 본다. 증축 확인 팝업이 「도시 Lv1 → Lv2」 한 줄인지도.
 *
 *   npm run look:growth      (= node --env-file=.env tools/growth_ux.ts [--out 폴더])
 *
 * 필요한 것: 게임 화면 5173 · 게임 API 8787. 끝나면 계정을 지운다.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { BASIC_TUTORIALS, canUpgradeCity, createProfile, markGuideSeen } from '@samchess/meta';
import type { GuideId, PlayerProfile } from '@samchess/meta';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { cleanupUsers, makeUser } from './adminLook.ts';

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1]! : join(tmpdir(), 'samchess-growth-look');
mkdirSync(OUT, { recursive: true });
const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const ok = (m: string) => console.log(`✓ ${m}`);
const fail = (m: string): never => { throw new Error(m); };

try {
  const u = await makeUser('growth', 'u');
  // 둘러보기는 끝냈고(가리킴이 둘러보기 쪽으로 가지 않게) 증축 조건이 다 찬 Lv1 계정
  let p: PlayerProfile = { ...createProfile(`증축길-${randomUUID().slice(0, 4)}`, 5), tutorial: { done: [...BASIC_TUTORIALS] } };
  const extra = OFFICERS.filter((o) => !p.roster[o.id as keyof typeof p.roster]).slice(0, 20);
  p = {
    ...p, materials: 99, grainAt: Date.now(),
    roster: { ...p.roster, ...Object.fromEntries(extra.map((o) => [o.id, { ...Object.values(p.roster)[0]!, officer: o.id }])) },
  } as PlayerProfile;
  const toured: GuideId[] = ['main.intro', 'palace.intro', 'market.intro', 'board.intro', 'barracks.sortieOpen', 'tour.market', 'tour.board', 'tour.barracks'];
  p = toured.reduce(markGuideSeen, p);
  if (!canUpgradeCity(p).ok) fail(`심은 계정이 증축 조건을 못 채웠다 — ${JSON.stringify(canUpgradeCity(p))}`);
  await saveProfileTrusted(u.uid, p);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 623, height: 1150 } });
  const shot = (name: string) => page.screenshot({ path: join(OUT, `growth-${name}.png`) });
  /** 내관이 서 있으면 그 안내 id — 마디를 끝까지 넘긴다 */
  const hear = async (want: string, name: string, spotCheck?: string): Promise<void> => {
    await page.waitForSelector(`.stw[data-guide="${want}"][data-phase="in"]`, { timeout: 15_000 })
      .catch(async () => fail(`안내 ${want}가 안 선다 — 서 있는 것: ${await page.getAttribute('.stw', 'data-guide').catch(() => '없음')}`));
    const n = Number(await page.getAttribute('.stw', 'data-guide-lines'));
    for (let i = 0; i < n; i++) {
      await page.waitForTimeout(500);
      if (i === n - 1) {
        await shot(name);
        if (spotCheck && !await page.$(`${spotCheck}[data-guide-glow]`)) fail(`${want}의 마지막 마디가 ${spotCheck}를 안 가리킨다`);
      }
      await page.click('[data-action="guideNext"]', { force: true });
    }
    await page.waitForSelector('.stw', { state: 'detached', timeout: 5_000 });
  };

  await page.goto(`${BASE}/?guide=1`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', u.email);
  await page.fill('[data-field="password"]', u.password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 });

  // ── 메인: 「증축할 채비가 끝났다」 + 궁궐 자리의 가리킴(말이 끝나도 남는다) ──
  await hear('city.ready', '1-main-ready', '.city-hot[data-place="palace"]');
  if (!await page.$('.guide-target[data-guide-target="growth-upgrade"]')) fail('말이 끝났는데 메인 궁궐 자리의 가리킴이 없다');
  await shot('2-main-pointer');
  ok('메인 — city.ready(궁궐 자리를 가리킨다) · 말이 끝나도 궁궐 위 가리킴이 남는다');

  // ── 궁궐: 내관이 [도시 관리]를 누르라 하고, [도시 관리]가 빛난다 ──
  await page.click('.city-hot[data-place="palace"]', { force: true });
  await page.waitForSelector('[data-action="city"]');
  await hear('palace.upgrade', '3a-palace-say', '[data-action="city"]');
  if (!await page.$('[data-action="city"][data-guide-cue]')) fail('궁궐의 [도시 관리]가 안 빛난다');
  if (await page.$('[data-action="officers"][data-guide-cue]')) fail('[장수 일람]까지 빛난다');
  await shot('3-palace');
  // 네온만 — 노란 테(box-shadow)는 없다
  const ring = await page.$eval('[data-action="city"]', (e) => getComputedStyle(e).boxShadow);
  if (ring !== 'none') fail(`[도시 관리]에 테가 있다 — ${ring}`);
  ok('궁궐 — palace.upgrade(「[도시 관리] 버튼을 눌러주세요.」) · [도시 관리]만 빛난다(테 없음)');

  // ── 도시 관리: 내관이 [건물 관리]를 누르라 하고 [건물 관리]가 빛난다 — [도시 증축]은 여기 없다(2026-11-13 건물 관리로 옮김) ──
  await page.click('[data-action="city"]');
  await page.waitForSelector('[data-screen="city"]');
  await hear('city.build', '4a-city-say', '[data-action="buildings"]');
  if (await page.$('.scr-city [data-action="upgrade"]')) fail('도시 관리에 아직 [도시 증축]이 있다');
  if (!await page.$('[data-action="buildings"][data-guide-cue]')) fail('증축 전 도시 관리의 [건물 관리]가 안 빛난다');
  await shot('4-city');
  ok('도시 관리 — city.build(「[건물 관리] 버튼을 눌러주세요.」) · [건물 관리]가 빛난다 · [도시 증축]은 없다');

  // ── 건물 관리: 내관이 [도시 증축]을 누르라 하고 그 단추가 빛난다([뒤로 가기] 위) → 확인 팝업 「도시 Lv1 → Lv2」 ──
  await page.click('[data-action="buildings"]');
  await page.waitForSelector('[data-screen="buildings"]');
  await hear('city.upgrade', '4b-buildings-say', '[data-action="upgrade"]');
  if (!await page.$('[data-action="upgrade"][data-guide-cue]')) fail('[도시 증축]이 안 빛난다');
  const order = await page.evaluate(() => {
    const up = document.querySelector('.cty-acts [data-action="upgrade"]'), back = document.querySelector('.cty-acts [data-action="backBottom"]');
    return !!(up && back && (up.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  if (!order) fail('[도시 증축]이 [뒤로 가기] 위에 없다');
  if (await page.$('[data-field="why"][data-code="city.credits"]')) fail('「건설 기회가 남았다」 이유가 뜬다');
  await shot('4c-buildings');
  await page.click('[data-action="upgrade"]');
  await page.waitForSelector('[data-modal="upgrade"]');
  const ask = await page.evaluate(() => ({
    what: document.querySelector('[data-modal="upgrade"] [data-field="what"]')?.textContent ?? '',
    rows: document.querySelectorAll('[data-modal="upgrade"] p').length,
  }));
  if (ask.what !== '도시 Lv1 → Lv2' || ask.rows !== 2) fail(`증축 확인이 한 줄이 아니다 — ${JSON.stringify(ask)}`);
  if (!await page.$('[data-action="upgradeConfirm"][data-guide-cue]')) fail('확인 팝업의 [증축한다]가 안 빛난다');
  await shot('5-upgrade-ask');
  ok(`건물 관리 — city.upgrade · [도시 증축]이 [뒤로 가기] 위에서 빛나고, 확인 팝업은 「${ask.what}」 · [증축한다]가 빛난다`);

  await page.click('[data-action="upgradeConfirm"]');
  await page.waitForSelector('[data-modal="upgradeDone"]', { timeout: 10_000 });
  await page.waitForTimeout(1200);
  if (await page.$('.stw')) fail('증축 완료 팝업 위로 내관이 섰다');
  // 완료 팝업 — 「도시 Lv2」 한 줄(넘치지 않는다) · 「도시가 Lv2가 되었다」 줄은 없다 (2026-11-13)
  const doneBox = await page.evaluate(() => {
    const lv = document.querySelector<HTMLElement>('[data-modal="upgradeDone"] [data-field="doneLevel"]')!;
    const box = lv.closest('.modal')!.getBoundingClientRect(), r = lv.getBoundingClientRect();
    return { text: lv.textContent, what: !!document.querySelector('[data-field="doneWhat"]'), inside: r.left >= box.left && r.right <= box.right, h: Math.round(r.height) };
  });
  if (doneBox.text !== '도시 Lv2' || doneBox.what || !doneBox.inside) fail(`완료 팝업이 다르다 — ${JSON.stringify(doneBox)}`);
  const cityTtl = await page.$eval('[data-modal="upgradeDone"] .modal-ttl', (e) => getComputedStyle(e).fontSize);
  await shot('5b-upgrade-done');
  await page.click('[data-action="doneOk"]');

  // ── 증축 직후 (같은 화면): 내관이 기회 · [짓기] · 「기회를 다 써야 도시를 올린다」, 지을 수 있는 줄이 빛난다 → 하나 지으면 꺼진다 ──
  await hear('buildings.intro', '7-buildings', '[data-action="upgrade"]');
  const left = await page.getAttribute('[data-field="credits"]', 'data-left');
  if (left !== '1') fail('건설 기회가 남았는데 「남은 건설 기회」가 붉은 글이 아니다');
  const cued = await page.$$eval('.cty-bld [data-action="build"][data-guide-cue]', (els) => els.length);
  const open = await page.$$eval('.cty-bld [data-action="build"]:not(:disabled)', (els) => els.length);
  if (cued === 0 || cued !== open) fail(`빛나는 [짓기] ${cued}개 · 지을 수 있는 줄 ${open}개`);
  if (await page.$('[data-action="upgrade"][data-guide-cue]')) fail('증축했는데 [도시 증축]이 아직 빛난다');
  await shot('8-buildings-cue');
  await page.click('.cty-bld[data-building="market"] [data-action="build"]');
  await page.click('[data-action="buildConfirm"]');
  await page.waitForSelector('[data-modal="buildDone"]', { timeout: 10_000 });
  // 건물 완료 팝업도 도시 증축 완료와 같은 꼴 — 큰 글씨 「장터 Lv2」 · 이름 줄 없음 · 제목 크기 같음 · 아래 줄은 할 수 있는 일 (2026-11-13)
  const bld = await page.evaluate(() => ({
    lv: document.querySelector('[data-modal="buildDone"] [data-field="doneLevel"]')?.textContent,
    name: !!document.querySelector('[data-modal="buildDone"] [data-field="doneName"]'),
    can: document.querySelector('[data-modal="buildDone"] [data-field="doneCan"]')?.textContent,
    ttl: getComputedStyle(document.querySelector('[data-modal="buildDone"] .modal-ttl')!).fontSize,
  }));
  if (bld.ttl !== cityTtl) fail(`완료 팝업 제목 크기가 갈린다 — 도시 ${cityTtl} · 건물 ${bld.ttl}`);
  if (bld.lv !== '장터 Lv2' || bld.name) fail(`건물 완료 팝업이 다르다 — ${JSON.stringify(bld)}`);
  if (bld.can !== 'Lv2 전투 아이템 구매 가능') fail(`건물 완료 팝업의 기능 줄이 다르다 — 「${bld.can}」`);
  await shot('8b-build-done');
  await page.click('[data-modal="buildDone"] [data-action="doneOk"]');
  await page.waitForTimeout(300);
  if (await page.$('[data-guide-cue]')) fail('하나 지었는데 표지가 남았다');
  ok(`건물 관리 — 증축 뒤 buildings.intro(셋째 마디 [도시 증축]) · 남은 기회 붉은 글 · 빛나는 [짓기] ${cued}개 · 완료 「${bld.can}」 · 하나 지으니 꺼졌다`);

  // ── 메인으로: 가리킴도 사라졌다 ──
  await page.click('[data-action="backBottom"]');
  await page.click('[data-action="back"]');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main');
  await page.waitForTimeout(800);
  if (await page.$('.guide-target[data-guide-target^="growth-"]')) fail('다 지었는데 메인 궁궐 위 가리킴이 남았다');
  const saved = (await getProfile(u.uid))!;
  if (saved.cityLevel !== 2 || !['city.ready', 'palace.upgrade', 'city.upgrade', 'city.build', 'buildings.intro'].every((g) => saved.guide?.seen.includes(g as GuideId))) {
    fail(`저장된 계정이 다르다 — Lv${saved.cityLevel}, 들은 것 ${JSON.stringify(saved.guide?.seen)}`);
  }
  await browser.close();
  ok(`메인 — 가리킴 사라짐 · 계정에 Lv2와 들은 안내 다섯이 남았다 (${OUT})`);
} finally {
  await cleanupUsers();
  await pool.end().catch(() => {});
}
