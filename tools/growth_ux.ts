/**
 * 첫 증축의 길 눈 확인 (2026-11-13 · 2026-11-23 개편) — 증축 조건이 찬 계정으로 **안내를 켜고**(`?guide=1`) 메인 → 궁궐 → 도시 관리 → 증축(건물 셋 고르기)을
 * 지나며 내관의 말(`city.ready` · `palace.upgrade` · `city.upgrade`)과 **그 일을 할 때까지 남는 표지**(meta `growthCue` — 메인 궁궐 자리의 가리킴,
 * 명령 단추의 금빛 `data-guide-cue`)가 제자리에 서고 제때 꺼지는지 본다. 증축 팝업이 「도시 Lv1 → Lv2」 + 올릴 건물 일곱 줄인지, 셋을 고르면 함께 오르는지도.
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
import { SORTIE_TUTORIALS, canUpgradeCity, createProfile, markGuideSeen } from '@samchess/meta';
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
  let p: PlayerProfile = { ...createProfile(`증축길-${randomUUID().slice(0, 4)}`, 5), tutorial: { done: [...SORTIE_TUTORIALS] } };
  const extra = OFFICERS.filter((o) => !p.roster[o.id as keyof typeof p.roster]).slice(0, 20);
  p = {
    // 자재는 한 번 증축할 만큼만(10) — 넉넉하면 Lv2에 닿자마자 다음 증축 조건도 차서 표지가 다시 선다(2026-11-23 — 건설 기회가 막던 자리)
    ...p, materials: 10, battleWins: 99, grainAt: Date.now(),   // 누적 승리도 증축 조건이다(2026-11-14)
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

  // ── 도시 관리: 내관이 [도시 증축]을 누르라 하고 그 단추가 빛난다(2026-11-23 — 건물 관리가 없어지며 돌아왔다) ──
  await page.click('[data-action="city"]');
  await page.waitForSelector('[data-screen="city"]');
  await hear('city.upgrade', '4-city-say', '[data-action="upgrade"]');
  if (!await page.$('.scr-city [data-action="upgrade"][data-guide-cue]')) fail('도시 관리의 [도시 증축]이 안 빛난다');
  if (await page.$('[data-action="buildings"]')) fail('도시 관리에 옛 [건물 관리]가 남았다');
  await shot('4b-city');
  await page.click('[data-action="upgrade"]');
  await page.waitForSelector('[data-modal="upgrade"]');
  const ask = await page.evaluate(() => ({
    // 제목은 「▶ [Lv2 배지] 증축」 — 오를 도시 레벨은 배지의 data-to (2026-11-23 기획자)
    what: (document.querySelector('[data-modal="upgrade"] [data-field="what"]') as HTMLElement | null)?.dataset['to'] ?? '',
    rows: document.querySelectorAll('[data-modal="upgrade"] [data-action="pickBuilding"]').length,
  }));
  if (ask.what !== '2' || ask.rows !== 7) fail(`증축 팝업이 다르다 — ${JSON.stringify(ask)}`);
  if (await page.$('[data-action="upgradeConfirm"][data-guide-cue]')) fail('아직 안 골랐는데 [증축한다]가 빛난다');
  for (const id of ['market', 'farm', 'forge']) await page.click(`[data-modal="upgrade"] [data-action="pickBuilding"][data-building="${id}"]`);
  if (!await page.$('[data-action="upgradeConfirm"][data-guide-cue]:not(:disabled)')) fail('셋을 골랐는데 [증축한다]가 안 빛난다');
  await shot('5-upgrade-ask');
  ok(`도시 관리 — city.upgrade · [도시 증축]이 빛나고, 팝업은 「${ask.what}」 + 일곱 줄 · 셋을 고르니 [증축한다]가 빛난다`);

  await page.click('[data-action="upgradeConfirm"]');
  await page.waitForSelector('[data-modal="upgradeDone"]', { timeout: 10_000 });
  await page.waitForTimeout(1200);
  if (await page.$('.stw')) fail('증축 완료 팝업 위로 내관이 섰다');
  const doneBox = await page.evaluate(() => {
    const lv = document.querySelector<HTMLElement>('[data-modal="upgradeDone"] [data-field="doneLevel"]')!;
    const box = lv.closest('.modal')!.getBoundingClientRect(), r = lv.getBoundingClientRect();
    return {
      text: lv.textContent, inside: r.left >= box.left && r.right <= box.right,
      built: [...document.querySelectorAll<HTMLElement>('[data-modal="upgradeDone"] .cty-done-bldrow')].map((e) => `${e.dataset['building']}:${e.dataset['level']}`),
    };
  });
  if (doneBox.text !== '도시 Lv2' || !doneBox.inside) fail(`완료 팝업이 다르다 — ${JSON.stringify(doneBox)}`);
  if (doneBox.built.join(',') !== 'market:2,farm:1,forge:1') fail(`완료 팝업의 함께 오른 건물이 다르다 — ${doneBox.built.join(' ')}`);
  await shot('5b-upgrade-done');
  await page.click('[data-action="doneOk"]');
  await page.waitForSelector('.cel-back[data-leaving]', { state: 'detached', timeout: 5_000 });   // 축하 화면의 닫힘 연출(.36초)이 끝날 때까지
  await page.waitForTimeout(300);
  if (await page.$('[data-guide-cue]')) fail('증축했는데 표지가 남았다');
  ok(`완료 — 「도시 Lv2」 + 함께 오른 셋(${doneBox.built.join(' · ')}) · 표지가 꺼졌다`);

  // ── 메인으로: 가리킴도 사라졌다 ──
  await page.click('[data-action="back"]');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main');
  await page.waitForTimeout(800);
  if (await page.$('.guide-target[data-guide-target^="growth-"]')) fail('증축했는데 메인 궁궐 위 가리킴이 남았다');
  const saved = (await getProfile(u.uid))!;
  // city.ready는 증축마다 다시 말하므로 증축하면 들은 목록에서 빠진다(2026-11-14 meta applyCityUpgrade)
  if (saved.cityLevel !== 2 || saved.buildings.farm !== 1 || saved.guide?.seen.includes('city.ready')
    || !['palace.upgrade', 'city.upgrade'].every((g) => saved.guide?.seen.includes(g as GuideId))) {
    fail(`저장된 계정이 다르다 — Lv${saved.cityLevel}, 농지 Lv${saved.buildings.farm}, 들은 것 ${JSON.stringify(saved.guide?.seen)}`);
  }
  await browser.close();
  ok(`메인 — 가리킴 사라짐 · 계정에 Lv2 · 고른 건물 · 들은 안내가 남았다 (${OUT})`);
} finally {
  await cleanupUsers();
  await pool.end().catch(() => {});
}
