/**
 * 첫 편성 눈 확인 (2026-11-13) — 3인팀이 없는 계정으로 **안내를 켜고**(`?guide=1`) 병영 → 부대 관리 → 새 편성 → 부대원 → 배치 미션 → 부대 현황을 지나며
 * 무관의 말(`squads.intro` 끝 마디 · `squadNew.*` · `squadEdit.*` · `squadDeploy.*` · `squadView.garrison` · 수비군 설정 미션 `garrison.*`)과 걸음마다 빛나는 자리(`data-guide-cue`),
 * 배치 미션의 단검(King ↔ Rock)이 제자리에 서고 제때 넘어가는지 본다. 저장된 3인팀의 King이 가운데인지도.
 *
 *   npm run look:firstSquad      (= node --env-file=.env tools/first_squad_ux.ts [--out 폴더])
 *
 * 필요한 것: 게임 화면 5173 · 게임 API 8787. 끝나면 계정을 지운다.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { SORTIE_TUTORIALS, createProfile, markGuideSeen } from '@samchess/meta';
import type { GuideId, PlayerProfile } from '@samchess/meta';
import { defaultDeployPos } from '@samchess/rules';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { cleanupUsers, makeUser } from './adminLook.ts';

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1]! : join(tmpdir(), 'samchess-squad-look');
mkdirSync(OUT, { recursive: true });
const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const ok = (m: string) => console.log(`✓ ${m}`);
const fail = (m: string): never => { throw new Error(m); };

try {
  const u = await makeUser('squadux', 'u');
  // 튜토리얼 · 둘러보기는 끝냈고 부대는 하나도 없는 계정 — 병영 안내도 들은 것으로
  let p: PlayerProfile = { ...createProfile(`편성길-${randomUUID().slice(0, 4)}`, 6), tutorial: { done: [...SORTIE_TUTORIALS] }, grainAt: Date.now() };
  const heard: GuideId[] = ['main.intro', 'palace.intro', 'market.intro', 'board.intro', 'barracks.intro', 'barracks.sortieOpen', 'tour.market', 'tour.board', 'tour.barracks'];
  p = heard.reduce(markGuideSeen, p);
  await saveProfileTrusted(u.uid, p);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 623, height: 1150 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (name: string) => page.screenshot({ path: join(OUT, `squad-${name}.png`) });
  const hear = async (want: string, name: string, spot?: string): Promise<void> => {
    await page.waitForSelector(`.stw[data-guide="${want}"][data-phase="in"]`, { timeout: 15_000 })
      .catch(async () => fail(`안내 ${want}가 안 선다 — 서 있는 것: ${await page.getAttribute('.stw', 'data-guide').catch(() => '없음')}`));
    const n = Number(await page.getAttribute('.stw', 'data-guide-lines'));
    for (let i = 0; i < n; i++) {
      await page.waitForTimeout(450);
      if (i === n - 1) {
        await shot(name);
        if (spot && !await page.$(`${spot}[data-guide-glow]`)) fail(`${want}의 마지막 마디가 ${spot}를 안 가리킨다`);
      }
      await page.click('[data-action="guideNext"]', { force: true });
    }
    await page.waitForSelector('.stw', { state: 'detached', timeout: 5_000 });
  };
  const cued = (sel: string) => page.$(`${sel}[data-guide-cue]`);
  const speaker = () => page.getAttribute('.stw-man', 'src');

  await page.goto(`${BASE}/?guide=1`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', u.email);
  await page.fill('[data-field="password"]', u.password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 });
  await page.waitForTimeout(800);

  // ── 부대 관리: 무관이 [새 편성]으로 · [새 편성]이 빛난다 ──
  await page.click('.city-hot[data-place="barracks"]', { force: true });
  await page.click('[data-action="squads"]');
  await page.waitForSelector('.stw[data-guide="squads.intro"]', { timeout: 15_000 });
  const who = await speaker();
  if (!who?.includes('guide-army')) fail(`부대 관리 안내가 무관이 아니다 — ${who}`);
  await hear('squads.intro', '1-list', '[data-action="new"]');
  if (!await cued('[data-action="new"]')) fail('[새 편성]이 안 빛난다');
  ok(`부대 관리 — 무관(${who}) · 끝 마디가 [새 편성]을 가리키고 빛난다`);

  // ── 새 편성: 3인 · 5인팀 · 이름 칸 → 이름을 적으면 [3 vs 3] → [다음] ──
  await page.click('[data-action="new"]');
  await hear('squadNew.intro', '2-name', '#squad-name');
  if (!await cued('#squad-name')) fail('이름 칸이 안 빛난다');
  await page.fill('#squad-name', '청룡대');
  await hear('squadNew.mode', '3-mode', '[data-action="next"]');
  if (!await cued('.sqd-modes [data-mode="3v3"]')) fail('이름을 적었는데 [3 vs 3]이 안 빛난다');
  if (await cued('#squad-name')) fail('이름을 적었는데 이름 칸이 아직 빛난다');
  await page.click('.sqd-modes [data-mode="3v3"]');
  if (!await cued('.sqd-form [data-action="next"]')) fail('[3 vs 3]을 골랐는데 [다음]이 안 빛난다');
  ok('새 편성 — squadNew.intro(이름 칸) → 이름을 적으니 squadNew.mode · [3 vs 3] → [다음] 차례로 빛난다');

  // ── 부대원: King → Rock → Queen(기물 바꾸기 단추) → [부대 배치] ──
  await page.click('.sqd-form [data-action="next"]');
  const pick = async (row: number): Promise<void> => {
    if (!await cued(`[data-action="pickOfficer"][data-row="${row}"]`)) fail(`${row}번째 줄 [선택]이 안 빛난다`);
    await page.click(`[data-action="pickOfficer"][data-row="${row}"]`);
    await page.waitForSelector('[data-modal="officerPick"] [data-action="directPick"]');
    // 줄마다 다른 장수 — 이미 선 장수를 고르면 두 줄이 맞바꿔 앞줄이 빈다(편성 규칙)
    await page.locator('[data-modal="officerPick"] [data-action="directPick"]').nth(row).click();
    await page.waitForSelector('[data-modal="officerPick"]', { state: 'detached' });
  };
  await hear('squadEdit.king', '4-king', '[data-action="pickOfficer"][data-row="0"]');
  await pick(0);
  await hear('squadEdit.rock', '5-rock', '[data-action="pickOfficer"][data-row="1"]');
  await pick(1);
  await hear('squadEdit.queen', '6-queen', '[data-action="pickOfficer"][data-row="2"]');
  await pick(2);
  await hear('squadEdit.deploy', '7-toDeploy', '[data-action="toDeploy"]');
  if (!await cued('[data-action="toDeploy"]')) fail('[부대 배치]가 안 빛난다');
  ok('부대원 — King · Rock · Queen 차례로 [선택]이 빛나고 무관이 이끈다 · [부대 배치]');

  // ── 배치: King ↔ Rock 미션 — 단검이 꽂힌 칸을 차례로 누른다 ──
  await page.click('[data-action="toDeploy"]');
  await hear('squadDeploy.swap', '8-swap', '.sqb-cell[data-mission]');
  const zoomed = () => page.getAttribute('.sqb-view', 'data-zoom');
  if (await zoomed() !== '1') fail('바꾸기 동안 남군 쪽을 크게 안 본다');
  // 단검이 King · 갈 칸을 차례로 가리킨다. 처음 집으면 무관이 한 번 말한다(squadDeploy.pick) — 바꾸기가 끝나면 단검이 King으로 옮겨 두 번 누르기(squadDeploy.range)
  let taps = 0;
  let picked = false;
  for (; taps < 10 && !await page.$('.stw[data-guide="squadDeploy.range"]'); taps++) {
    if (!await page.$('.sqb-cell[data-mission] .sqb-dagger')) fail('미션 칸에 단검이 없다');
    if (taps === 0) await shot('8b-dagger');
    await page.click('.sqb-cell[data-mission]');
    await page.waitForTimeout(150);
    if (taps === 0) {
      if (!await page.$('.sqb-cell.can')) fail('King을 집었는데 옮길 칸이 안 보인다');
      await hear('squadDeploy.pick', '8c-pick', '.sqb-cell[data-mission]');
      picked = true;
    }
    await page.waitForTimeout(900);   // 다음 안내(range)가 서는 지연(700ms)을 넘긴다
  }
  if (!picked) fail('처음 집었는데 squadDeploy.pick이 안 섰다');
  if (taps !== 6) fail(`미션이 여섯 번 누름(옮김 셋)이 아니다 — ${taps}번`);
  await hear('squadDeploy.range', '9-range', '.sqb-cell[data-mission]');
  if (await page.getAttribute('.sqb-cell[data-mission]', 'data-piece') !== 'King') fail('바꾼 뒤 단검이 King에 없다');
  if (await cued('[data-action="deploySave"]')) fail('두 번 눌러 보기 전에 [편성 완료]가 빛난다');
  await page.dblclick('.sqb-cell[data-mission]');
  await page.waitForTimeout(200);
  const rangeN = await page.$$eval('.sqb-cell.range', (els) => els.length);
  if (rangeN === 0) fail('King을 두 번 눌렀는데 움직일 칸이 안 보인다');
  await page.waitForSelector('.stw[data-guide="squadDeploy.done"][data-phase="in"]', { timeout: 15_000 });
  if (await zoomed() !== '0') fail('끝 마디인데 판 전체로 안 돌아왔다');
  await page.waitForTimeout(700);   // 판이 줄어드는 동안
  // 끝 마디 넷 — 움직일 칸 · 가상의 상대(위쪽 알파벳) · 우리 군량고 · [편성 완료]. 마디를 넘기며 가리키는 자리를 본다
  const doneSpots = [null, '.sqb-cell[data-team="enemy"]', '.sqb-cell[data-depot="ours"]', '[data-action="deploySave"]'];
  for (let k = 0; k < doneSpots.length; k++) {
    if (k > 0) await page.click('[data-action="guideNext"]', { force: true });
    await page.waitForTimeout(450);
    const sel = doneSpots[k];
    if (sel && !await page.$(`${sel}[data-guide-glow]`)) fail(`squadDeploy.done의 ${k + 1}번째 마디가 ${sel}를 안 가리킨다`);
    await shot(`9b-done-${k + 1}`);
  }
  await page.click('[data-action="guideNext"]', { force: true });
  await page.waitForSelector('.stw', { state: 'detached', timeout: 5_000 });
  if (!await cued('[data-action="deploySave"]')) fail('[편성 완료]가 안 빛난다');
  ok(`배치 — 남군 쪽 확대 · 단검을 따라 ${taps}번(처음 집을 때 squadDeploy.pick) · King 두 번 누르기 ${rangeN}칸(squadDeploy.range) · 판 전체로 돌아와 상대 · 군량고 · [편성 완료]`);

  // ── 저장 → 부대 현황: 첫 부대가 수비군 · [수비군 설정]이 빛난다 ──
  await page.click('[data-action="deploySave"]');
  await hear('squadView.garrison', '10-garrison-door', '[data-action="garrisonPolicy"]');
  const saved = (await getProfile(u.uid))!;
  const sq = saved.squads.find((s) => s.mode === '3v3');
  const king = sq?.deploy.P1?.find((c) => c.piece === 'King');
  const center = defaultDeployPos('3v3', 'P1', 1);
  if (!king || king.x !== center.x || king.y !== center.y) fail(`저장된 3인팀의 King이 가운데가 아니다 — ${JSON.stringify(sq?.deploy)}`);
  if (!await cued('[data-action="garrisonPolicy"]')) fail('[수비군 설정]이 안 빛난다');
  ok(`부대 현황 — squadView.garrison · 저장된 King (${king.x},${king.y}) = 가운데 · [수비군 설정]이 빛난다`);

  // ── 수비군 설정 미션: 첫 기물의 행동 바꾸기 → [저장] → 준비 끝 · 5인팀은 직접 ──
  await page.click('[data-action="garrisonPolicy"]');
  await hear('garrison.intro', '11-garrison-intro', '.gpl-body [data-action="stance"]');
  if (!await cued('.gpl-body [data-action="stance"]')) fail('첫 기물의 행동 단추가 안 빛난다');
  if (await cued('[data-action="savePolicy"]')) fail('바꾸기 전인데 [저장]이 빛난다');
  await page.locator('.gpl-body [data-action="stance"]').first().click();
  await page.click('.gpl-choice[data-on="0"]');
  await hear('garrison.save', '12-garrison-save', '[data-action="savePolicy"]');
  if (!await cued('[data-action="savePolicy"]')) fail('행동을 바꿨는데 [저장]이 안 빛난다');
  await page.click('[data-action="savePolicy"]');
  await hear('garrison.done', '13-garrison-done');
  const after = (await getProfile(u.uid))!;
  if (!after.squads.find((s) => s.mode === '3v3')?.policy) fail('저장했는데 방침이 계정에 없다');
  if (await page.$('[data-guide-cue]')) fail('미션이 끝났는데 표지가 남았다');
  if (!['squadView.garrison', 'garrison.intro', 'garrison.save', 'garrison.done'].every((g) => after.guide?.seen.includes(g as GuideId))) {
    fail(`들은 안내가 계정에 없다 — ${JSON.stringify(after.guide?.seen)}`);
  }
  if (errors.length) fail(`화면 오류 — ${errors.join(' | ')}`);
  await browser.close();
  ok(`수비군 설정 — garrison.intro(첫 기물 행동) → garrison.save([저장]) → garrison.done · 방침 저장됨 · 표지 없음 (${OUT})`);
} finally {
  await cleanupUsers();
  await pool.end().catch(() => {});
}
