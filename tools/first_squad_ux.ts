/**
 * 첫 편성 눈 확인 (2026-11-13 · 2026-11-14 칸 넷) — 부대가 없는 계정으로 **안내를 켜고**(`?guide=1`) 병영 → 부대 관리 → 3v3 공격대 칸 → 부대원 → 배치 미션 →
 * 부대 현황, 그다음 3v3 수비대 칸을 채워 수비군 설정 미션까지 지나며 무관의 말(`squads.intro` 끝 마디 · `squadEdit.*` · `squadDeploy.*` ·
 * `squadView.garrison` · `garrison.*`)과 걸음마다 빛나는 자리(`data-guide-cue`), 배치 미션의 단검(King — 기본 배치가 이미 가운데)이 제자리에 서고 제때 넘어가는지 본다.
 * 저장된 3v3 공격대의 King이 가운데인지도. 첫 편성은 **공격대 먼저**(기획자) — 이름 걸음(`squadNew.*`)은 없어졌다.
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
import { SORTIE_TUTORIALS, createProfile, markGuideSeen, squadDeployment } from '@samchess/meta';
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

  // ── 부대 관리: 무관이 3v3 공격대 칸으로 · 그 칸이 빛난다 ──
  await page.click('.city-hot[data-place="barracks"]', { force: true });
  await page.click('[data-action="squads"]');
  await page.waitForSelector('.stw[data-guide="squads.intro"]', { timeout: 15_000 });
  const who = await speaker();
  if (!who?.includes('guide-army')) fail(`부대 관리 안내가 무관이 아니다 — ${who}`);
  await hear('squads.intro', '1-list', '[data-slot="atk-3v3"]');
  if (!await cued('[data-slot="atk-3v3"]')) fail('3v3 공격대 칸이 안 빛난다');
  if (await page.$('.sql-row:not([data-slot="atk-3v3"])[data-guide-cue]')) fail('3v3 공격대 말고 다른 칸도 빛난다');
  ok(`부대 관리 — 무관(${who}) · 끝 마디가 3v3 공격대 칸을 가리키고 빛난다`);

  // ── 부대원: King → Rock → Queen(기물 바꾸기 단추) → [부대 배치] — 빈 칸을 누르면 곧장 여기다 ──
  await page.click('[data-slot="atk-3v3"]');
  /** 줄의 「대원 지정 가능」 → 장수 일람에서 줄 → 카드의 [선택하기] (2026-11-17 — 농지와 같다). 줄마다 다른 장수 — 이미 선 장수를 고르면 두 줄이 맞바꾼다 */
  const choose = async (row: number): Promise<void> => {
    await page.click(`[data-action="pickOfficer"][data-row="${row}"]`);
    await page.waitForSelector('[data-modal="officerPick"] .ofc-row[data-officer]');
    await page.locator('[data-modal="officerPick"] .ofc-row[data-officer]').nth(row).click();
    await page.click('.ofcard [data-action="cardSelect"]');
    await page.waitForSelector('[data-modal="officerPick"]', { state: 'detached' });
  };
  const pick = async (row: number): Promise<void> => {
    if (!await cued(`[data-action="pickOfficer"][data-row="${row}"]`)) fail(`${row}번째 줄 [선택]이 안 빛난다`);
    await choose(row);
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

  // ── 배치: 기본 배치에서 King이 이미 가운데라(2026-11-18 기획자 — King M · 나머지 H · R) 바꾸기 마디 없이 곧장 「King을 눌러 보기」 ──
  await page.click('[data-action="toDeploy"]');
  const zoomed = () => page.getAttribute('.sqb-view', 'data-zoom');
  await hear('squadDeploy.range', '9-range', '.sqb-cell[data-mission]');
  if (await zoomed() !== '1') fail('King 누르기 동안 남군 쪽 창이 아니다');
  if (await page.$('[data-action="deployPlace"][data-guide-cue]')) fail('King이 이미 가운데인데 카드가 빛난다(바꾸기 마디가 남았다)');
  const kingAt = await page.$eval('.sqb-cell[data-team="ours"][data-piece="King"]', (c) => `${(c as HTMLElement).dataset.x},${(c as HTMLElement).dataset.y}`);
  if (kingAt !== '12,17') fail(`기본 배치의 King이 가운데(M18)가 아니라 ${kingAt}다`);
  if (await page.getAttribute('.sqb-cell[data-mission]', 'data-piece') !== 'King') fail('바꾼 뒤 단검이 King에 없다');
  if (await cued('[data-action="deploySave"]')) fail('King을 눌러 보기 전에 [배치 완료]가 빛난다');
  await page.click('.sqb-cell[data-mission]');
  await page.waitForTimeout(200);
  const rangeN = await page.$$eval('.sqb-cell.range', (els) => els.length);
  if (rangeN === 0) fail('King을 눌렀는데 움직일 칸이 안 보인다');
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
  ok(`배치 — 남군 쪽 창 · 기본 배치 King M18 · King 누르기 ${rangeN}칸(squadDeploy.range) · 판 전체로 돌아와 상대 · 군량고 · [배치 완료]`);

  // ── [배치 완료] → 부대 편집으로 돌아와 [저장]이 빛난다 → 저장하면 목록 (2026-11-17) ──
  await page.click('[data-action="deploySave"]');
  // 미션 중에는 「기본 배치로 설정됩니다」를 묻지 않는다 — 무관이 이미 말했다
  await page.waitForSelector('[data-screen="squadEdit"][data-squad="atk-3v3"]', { timeout: 5_000 });
  if (!await cued('[data-action="saveSquad"]')) fail('배치를 마쳤는데 [저장]이 안 빛난다');
  await shot('10-save-cue');
  await page.click('[data-action="saveSquad"]');
  await page.waitForSelector('[data-screen="squads"]');
  await page.waitForTimeout(1_200);
  if (await page.$('.sql-row[data-guide-cue]')) fail('3인 공격대를 저장했는데 칸 표지가 남았다');

  // ── 3v3 수비대를 채운다(안내 없이 — 수비대는 따로, 기획자) → 다시 열면 squadView.garrison · [행동 방침]이 빛난다 ──
  await page.click('[data-slot="def-3v3"]');
  await page.waitForSelector('[data-screen="squadEdit"][data-new="1"]');
  for (let row = 0; row < 3; row++) await choose(row);
  if (await page.$('.stw')) fail(`수비대 편집에서 첫 편성 안내가 또 섰다 — ${await page.getAttribute('.stw', 'data-guide')}`);
  await page.click('[data-action="toDeploy"]');
  await page.click('[data-action="deploySave"]');
  await page.click('[data-action="deployDefaultOk"]');
  await page.waitForSelector('[data-screen="squadEdit"]');
  await page.click('[data-action="saveSquad"]');
  await page.waitForSelector('[data-screen="squads"]');
  await page.click('[data-slot="def-3v3"]');
  await hear('squadView.garrison', '11-garrison-door', '[data-action="garrisonPolicy"]');
  const saved = (await getProfile(u.uid))!;
  const sq = saved.squads.find((s) => s.id === 'atk-3v3');
  // 손대지 않은 배치는 `null`로 저장된다 — 판에 서는 자리는 `squadDeployment`가 낸다(부대의 기본 배치, King 가운데)
  const king = sq ? squadDeployment(saved, sq, 'P1')?.find((d) => d.unit === 'P1-King')?.pos : undefined;
  const center = defaultDeployPos('3v3', 'P1', 1);
  if (!king || king.x !== center.x || king.y !== center.y) fail(`저장된 3인팀의 King이 가운데가 아니다 — ${JSON.stringify(sq?.deploy)}`);
  if (!await cued('[data-action="garrisonPolicy"]')) fail('[행동 방침]이 안 빛난다');
  ok(`[배치 완료] → [저장] 표지 · 저장된 공격대 King (${king.x},${king.y}) = 가운데 · 수비대를 다시 여니 squadView.garrison · [행동 방침]이 빛난다`);

  // ── 수비군 설정 미션: 첫 기물의 행동 바꾸기 → [저장] → 준비 끝 · 5인팀은 직접 ──
  await page.click('[data-action="garrisonPolicy"]');
  await hear('garrison.intro', '12-garrison-intro', '.gpl-body [data-action="stance"]');
  if (!await cued('.gpl-body [data-action="stance"]')) fail('첫 기물의 행동 단추가 안 빛난다');
  if (await cued('[data-action="savePolicy"]')) fail('바꾸기 전인데 [저장]이 빛난다');
  await page.locator('.gpl-body [data-action="stance"]').first().click();
  await page.click('.gpl-choice[data-on="0"]');
  await hear('garrison.save', '13-garrison-save', '[data-action="savePolicy"]');
  if (!await cued('[data-action="savePolicy"]')) fail('행동을 바꿨는데 [저장]이 안 빛난다');
  await page.click('[data-action="savePolicy"]');
  await hear('garrison.done', '14-garrison-done');
  // 방침은 초안이다 — [저장]에서 계정에 얹힌다 (2026-11-17)
  if ((await getProfile(u.uid))!.squads.find((s) => s.id === 'def-3v3')?.policy) fail('[저장] 전에 방침이 계정에 들어갔다');
  await page.click('.place-bar [data-action="back"]');
  await page.waitForSelector('[data-screen="squadEdit"][data-squad="def-3v3"]');
  await page.click('[data-action="saveSquad"]');
  await page.waitForSelector('[data-screen="squads"]');
  await page.waitForTimeout(1_500);   // 저장 큐가 PUT을 보내는 동안
  const after = (await getProfile(u.uid))!;
  if (!after.squads.find((s) => s.id === 'def-3v3')?.policy) fail('저장했는데 방침이 3v3 수비대에 없다');
  if (await page.$('[data-guide-cue]')) fail('미션이 끝났는데 표지가 남았다');
  if (!['squadView.garrison', 'garrison.intro', 'garrison.save', 'garrison.done'].every((g) => after.guide?.seen.includes(g as GuideId))) {
    fail(`들은 안내가 계정에 없다 — ${JSON.stringify(after.guide?.seen)}`);
  }
  if (errors.length) fail(`화면 오류 — ${errors.join(' | ')}`);
  await browser.close();
  ok(`수비군 설정 — garrison.intro(첫 기물 행동) → garrison.save([저장]) → garrison.done · [저장]으로 방침 저장됨 · 표지 없음 (${OUT})`);
} finally {
  await cleanupUsers();
  await pool.end().catch(() => {});
}
