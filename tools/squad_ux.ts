/**
 * 병영 UX 확인 — 부대 현황 · 부대 편집 · 배치 편집 (pptx 65~72쪽, 2026-09-17)
 *
 *   VW=760 VH=1200 SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/squad_ux.ts
 *
 * 새 계정의 장수 다섯 명으로는 **안 그려지는 갈래**가 많다 — 부상 표시, 병기 칸,
 * 최근 부대 셋, 쪽 넘김(부대 여섯 이상), 배치 물려주기(저장된 배치가 있어야 한다).
 * 그래서 계정을 서버 쪽에서 미리 채워 두고 한 바퀴를 돈다. 판정은 짧게만 하고
 * 요점은 **스크린샷**이다 — 스모크(`smoke_meta.ts`)가 흐름을 고정한다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { defaultSquadCells, newInstance } from '@samchess/meta';
import type { RosterPick, Squad } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
/** 화면 언어 — 가장 긴 번역(몽골어 `mn`)으로 넘침을 본다. 없으면 한국어 */
const LANG = process.env['LANG_UI'] ?? '';

const fail = (m: string): never => { console.error(`✗ ${m}`); process.exit(1); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);

const email = `squad-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? 760), height: Number(process.env['VH'] ?? 1200) },
});
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
// 404는 **어느 파일인지** 적는다 — 콘솔 문구만으로는 경로가 안 나온다
// 새 계정의 첫 `GET /profile`은 도시가 아직 없어 404가 정상이다(새 게임 화면으로 간다)
page.on('response', (r) => { if (r.status() === 404 && new URL(r.url()).pathname !== '/profile') errors.push(`404 ${new URL(r.url()).pathname}`); });
const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', '병영실험');
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  step('장수 20명 · 부대 여섯(최근 셋이 갈리게) · 부상 하나 · 병기 하나를 심는다');
  const stored = await getProfile(uid);
  const roster = { ...stored!.roster } as Record<string, ReturnType<typeof newInstance>>;
  const ids = OFFICERS.map((o) => o.id as OfficerId);
  for (const id of ids.slice(0, 20)) if (!roster[id]) roster[id] = newInstance(id);
  const own = Object.keys(roster) as OfficerId[];
  const now = Date.now();
  roster[own[1]!] = { ...roster[own[1]!]!, injuredAt: now };
  const picks3 = (o: number): RosterPick[] => [
    { piece: 'King', officer: own[o]! }, { piece: 'Rock', officer: own[o + 1]! }, { piece: 'Queen', officer: own[o + 2]! },
  ];
  const squads: Squad[] = Array.from({ length: 6 }, (_, i) => {
    const picks = picks3(i);
    return {
      id: `sq${i + 1}`, name: `시험부대${i + 1}`, mode: '3v3', picks,
      deploy: { P1: defaultSquadCells('3v3', 'P1', picks).map((c) => ({ ...c, y: c.y - 1 })), P2: null },
      record: i === 0 ? { 'ai/3v3': { plays: 9, wins: 3, draws: 2, losses: 4, kills: 12 } } : {},
      createdAt: now - (6 - i) * 60_000,
    };
  });
  await saveProfileTrusted(uid, {
    ...stored!, cityLevel: 11, buildings: { ...stored!.buildings, palace: 11 },
    roster, squads, squadSeq: 7,
    forgeOwned: { 'dae-gam-do#1': own[0]! },
    // 「시험부대1」이 가장 최근에 싸웠다 — 가장 먼저 만든 부대가 맨 위로 올라와야 한다
    matches: [{ seq: 1, at: now, mode: '3v3', opponent: 'ai', opponentId: null, mySquad: '시험부대1', theirSquad: null, myPower: 0, theirPower: 0, chance: 0.5, result: 'win', picks: [] }],
    matchSeq: 2,
  } as Parameters<typeof saveProfileTrusted>[1]);
  ok(`장수 ${own.length}명 · 부대 6 · 부상 ${own[1]} · 대감도 ${own[0]}`);

  if (LANG) await page.evaluate((l) => localStorage.setItem('samchess.lang', l), LANG);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });

  step('병영 — 최근 부대 셋 (65쪽)');
  await page.click('.scr-main [data-place="barracks"]', { force: true });
  await page.waitForSelector('.scr-place-barracks');
  await shot('01-barracks');
  const recent = await page.$$eval('.bar-recent-row .nm', (els) => els.map((e) => e.textContent));
  if (recent.join(',') !== '시험부대1,시험부대6,시험부대5') fail(`최근 부대 차례가 다르다 — ${recent.join(',')}`);
  const tally = await page.textContent('.bar-recent-row [data-field="tally"]');
  if (tally?.trim() !== '3 / 2 / 4 - 12 Kills') fail(`전적 표기가 다르다 — "${tally}"`);
  ok(`최근 셋 [${recent.join(' ')}] · ${tally}`);

  step('부대 목록 — 다섯 줄 · 쪽 넘김 (66쪽)');
  await page.click('[data-action="squads"]');
  await page.waitForSelector('[data-screen="squads"]');
  await shot('02-list');
  const rows = await page.$$eval('.sqd-row', (els) => els.length);
  if (rows !== 5) fail(`한 쪽이 다섯 줄이 아니다 — ${rows}`);
  if (!await page.$('.pg-btn, [data-action="nextPage"]')) fail('부대가 여섯인데 쪽 넘김이 없다');
  ok('다섯 줄 · 쪽 넘김 있음');

  step('부대 현황 (67쪽)');
  await page.click('.sqd-row[data-squad="sq1"] [data-action="open"]');
  await page.waitForSelector('[data-screen="squadView"]');
  await shot('03-view');
  const view = await page.evaluate(() => ({
    rows: document.querySelectorAll('.scr-squad-view .sqv-rows > .sqv-row').length,
    hurt: document.querySelectorAll('.sqv-row [data-injured="1"]').length,
    acts: [...document.querySelectorAll('.place-body > .sqd-acts > .btn')].map((b) => (b as HTMLElement).dataset.action),
  }));
  if (view.rows !== 5) fail(`현황 판이 다섯 줄이 아니다 — ${view.rows}`);
  if (view.hurt !== 1) fail(`부상 표시가 ${view.hurt}개다 — 하나라야 한다`);
  if (view.acts.join(',') !== 'manage,delete') fail(`현황 단추가 [${view.acts.join(' ')}]다`);
  ok('다섯 줄 · 부상 하나 · [부대 관리][부대 삭제]');

  step('부대 편집 (68쪽) — 바꾸기 전에는 배치 단추가 잠겨 있다');
  await page.click('[data-action="manage"]');
  await page.waitForSelector('[data-screen="squadEdit"]');
  if (await page.isEnabled('[data-action="toDeploy"]')) fail('아무것도 안 바꿨는데 [부대 배치 설정]이 열려 있다');
  await shot('04-edit');
  // Rock 줄의 포지션 목록 — King · Rock · Queen이 빠진 셋이라야 한다
  await page.click('[data-field="piece-1"]');
  await page.waitForTimeout(150);
  const opts = await page.$$eval('.rk-pop [data-value]', (els) => els.map((e) => (e as HTMLElement).dataset.value));
  if (opts.sort().join(',') !== 'Bishop,Knight,Pawn') fail(`포지션 목록이 [${opts.join(' ')}]다`);
  await shot('05-edit-dropdown');
  await page.click('.rk-pop [data-value="Knight"]');
  await page.waitForTimeout(150);
  if (!await page.isEnabled('[data-action="toDeploy"]')) fail('포지션을 바꿨는데 [부대 배치 설정]이 잠겨 있다');
  ok(`Rock 줄 목록 [${opts.join(' ')}] → Knight로 바꾸니 배치 단추가 열린다`);

  step('장수 고르기 팝업');
  await page.click('[data-action="pickOfficer"][data-row="2"]');
  await page.waitForSelector('[data-modal="officerPick"]');
  await shot('06-pick');
  await page.click('[data-action="closeOfficerPick"]');
  await page.waitForTimeout(150);
  await shot('07-edit-changed');

  step('배치 편집 (69쪽) — 옛 Rock 자리에 Knight가 서 있는가');
  const before = await page.evaluate(() => (window as any).__profile.current.squads.find((s: any) => s.id === 'sq1').deploy.P1);
  await page.click('[data-action="toDeploy"]');
  await page.waitForSelector('[data-screen="squadDeploy"]');
  await shot('08-deploy');
  const rockAt = before.find((c: any) => c.piece === 'Rock');
  const knight = await page.$(`.sqb-cell[data-x="${rockAt.x}"][data-y="${rockAt.y}"][data-piece="Knight"][data-team="ours"]`);
  if (!knight) fail(`옛 Rock 자리(${rockAt.x},${rockAt.y})에 Knight가 없다`);
  ok(`Knight가 옛 Rock 자리 ${rockAt.x},${rockAt.y}에 섰다`);

  await knight!.click();
  await page.waitForTimeout(120);
  const can = await page.$$eval('.sqb-cell.can', (els) => els.length);
  if (can === 0) fail('기물을 눌렀는데 놓을 칸이 안 보인다');
  await shot('09-deploy-held');
  const target = await page.$('.sqb-cell.can');
  const tx = await target!.getAttribute('data-x'); const ty = await target!.getAttribute('data-y');
  await target!.click();
  await page.waitForTimeout(120);
  if (!await page.$(`.sqb-cell[data-x="${tx}"][data-y="${ty}"][data-piece="Knight"]`)) fail('칸을 눌렀는데 옮겨지지 않았다');
  await page.dblclick(`.sqb-cell[data-x="${tx}"][data-y="${ty}"]`);
  await page.waitForTimeout(150);
  const range = await page.$$eval('.sqb-cell.range', (els) => els.length);
  if (range === 0) fail('두 번 눌렀는데 범위가 안 보인다');
  await shot('10-deploy-range');
  ok(`놓을 칸 ${can} · (${tx},${ty})로 옮김 · 범위 ${range}칸`);

  // 북군으로 넘어갔다 돌아와도 남군에서 옮긴 것이 남아 있는가
  await page.click('[data-action="deploySide"][data-side="P2"]');
  await page.waitForTimeout(120);
  await shot('11-deploy-north');
  await page.click('[data-action="deploySide"][data-side="P1"]');
  await page.waitForTimeout(120);
  if (!await page.$(`.sqb-cell[data-x="${tx}"][data-y="${ty}"][data-piece="Knight"]`)) fail('진영을 오갔더니 옮긴 자리가 사라졌다');
  ok('남군 → 북군 → 남군을 오가도 옮긴 자리가 남는다');

  await page.click('[data-action="deploySave"]');
  await page.waitForSelector('[data-screen="squadView"]');
  const saved = await page.evaluate(() => (window as any).__profile.current.squads.find((s: any) => s.id === 'sq1'));
  if (saved.picks[1].piece !== 'Knight') fail('저장된 포지션이 Knight가 아니다');
  if (!saved.deploy.P1.some((c: any) => c.piece === 'Knight' && c.x === Number(tx) && c.y === Number(ty))) fail('저장된 배치에 옮긴 자리가 없다');
  await shot('12-view-after');
  ok('수정 완료 → 부대 현황, 포지션·배치 모두 저장됐다');

  step('새 부대 편성 (70·71·72쪽)');
  await page.click('[data-action="back"]');
  await page.waitForSelector('[data-screen="squads"]');
  await page.click('[data-action="new"]');
  await page.waitForSelector('[data-screen="squadNew"]');
  await page.fill('[data-field="name"]', '새로만든');
  await page.click('[data-mode="5v5"]');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await shot('13-new-name');
  const note = await page.textContent('[data-field="nameNote"]');
  if (!LANG && !note?.includes('현재 4자')) fail(`글자 수 안내가 지금 글자 수를 말하지 않는다 — "${note}"`);
  await page.click('[data-action="next"]');
  await page.waitForSelector('[data-screen="squadEdit"][data-new="1"]');
  const start = await page.$$eval('.sqm-row[data-piece]', (els) => els.map((e) => (e as HTMLElement).dataset.piece));
  if (start.join(',') !== 'King,Rock,Queen,Bishop,Knight') fail(`5v5 처음 포지션이 [${start.join(' ')}]다`);
  await shot('14-new-members-empty');
  for (let row = 0; row < 5; row += 1) {
    await page.click(`[data-action="pickOfficer"][data-row="${row}"]`);
    await page.waitForSelector('[data-modal="officerPick"]');
    const free = await page.$$('[data-modal="officerPick"] [data-action="equipPick"]');
    await free[row]!.click();
    await page.click('[data-action="equipConfirm"]');
    await page.waitForTimeout(150);
  }
  await shot('15-new-members-full');
  if (!await page.$('[data-field="summary"]')) fail('다 채웠는데 부대 요약이 없다');
  await page.click('[data-action="toDeploy"]');
  await page.waitForSelector('[data-screen="squadDeploy"]');
  await shot('16-new-deploy');
  await page.click('[data-action="deploySave"]');
  await page.waitForSelector('[data-modal="deployDefault"]');
  await shot('17-new-default-popup');
  await page.click('[data-action="deployDefaultOk"]');
  await page.waitForSelector('[data-screen="squadView"]');
  await shot('18-new-view');
  ok('5v5 새 부대 — 처음 포지션 · 요약 · 기본 배치 팝업 · 저장 후 현황');

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' | ')}`);
  console.log('\n✓ 병영 UX 한 바퀴 완주');
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
