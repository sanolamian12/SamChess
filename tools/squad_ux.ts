/**
 * 병영 UX 확인 — 부대 현황 · 부대 편집 · 배치 편집 (pptx 65~72쪽, 2026-09-17)
 *
 *   VW=760 VH=1200 SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/squad_ux.ts
 *
 * 새 계정의 장수 다섯 명으로는 **안 그려지는 갈래**가 많다 — 부상 표시, 병기 칸,
 * 최근 부대 셋, 칸 넷(2026-11-14 부대 개편 — 셋을 채우고 5v5 공격대를 비워 둔다), 배치 물려주기(저장된 배치가 있어야 한다).
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

const BASE = process.env['BASE'] ?? 'http://localhost:5173';
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
    await page.fill('.scr-new .newgame-form input', `병영실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    // 가입 오프닝(대사 · 장수 W 대형, 약 14초)을 지나야 메인이다 — 끝의 [성 안으로 들어가기]
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 }); // 메인이 자리 잡는 1초 연출이 끝난 뒤
  }
  // 메인이 서며 내는 저장(`PUT /profile`, 군량 정산 등)이 아래에서 심는 값보다 늦게 닿으면
  // 부대를 덮는다 — 그 저장이 다 끝난 뒤에 심는다. 경주라서 빼고 돌려도 대개 통과한다(2026-10-19)
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);

  step('장수 20명 · 부대 셋(3v3 공격 · 수비, 5v5 수비 — 5v5 공격은 비운다) · 부상 하나 · 병기 하나를 심는다');
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
  const squads: Squad[] = (['attack', 'defense'] as const).map((role, i) => {
    const picks = picks3(i);
    return {
      id: role === 'attack' ? 'atk-3v3' : 'def-3v3', role, mode: '3v3', picks,
      deploy: { P1: defaultSquadCells('3v3', 'P1', picks).map((c) => ({ ...c, y: c.y - 1 })), P2: null },
      record: i === 0 ? { 'field/3v3': { plays: 9, wins: 3, draws: 2, losses: 4, kills: 12, points: 0 } } : {},
      createdAt: now - (6 - i) * 60_000,
    };
  });
  squads.push({
    id: 'def-5v5', role: 'defense', mode: '5v5',
    picks: (['King', 'Rock', 'Bishop', 'Knight', 'Queen'] as const).map((piece, i) => ({ piece, officer: own[10 + i]! })),
    deploy: { P1: null, P2: null }, record: {}, createdAt: now - 2 * 60_000,
  });
  await saveProfileTrusted(uid, {
    ...stored!, cityLevel: 11, buildings: { ...stored!.buildings, palace: 11 },
    roster, squads,
    forgeOwned: { 'dae-gam-do#1': own[0]! },
    // 3v3 공격대가 가장 최근에 싸웠다 — 가장 먼저 만든 부대가 맨 위로 올라와야 한다
    matches: [{ seq: 1, at: now, mode: '3v3', opponent: 'siege', opponentId: null, mySquad: 'atk-3v3', theirSquad: null, myPower: 0, theirPower: 0, chance: 0.5, result: 'win', picks: [] }],
    matchSeq: 2,
  } as Parameters<typeof saveProfileTrusted>[1]);
  ok(`장수 ${own.length}명 · 부대 3 · 부상 ${own[1]} · 대감도 ${own[0]}`);

  if (LANG) await page.evaluate((l) => localStorage.setItem('samchess.lang', l), LANG);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });

  step('병영 — 최근 부대 셋 (65쪽)');
  await page.click('.scr-main [data-place="barracks"]', { force: true });
  await page.waitForSelector('.scr-place-barracks');
  await shot('01-barracks');
  const recent = await page.$$eval('.bar-recent-row .nm', (els) => els.map((e) => e.textContent));
  // 이름 대신 칸 이름표 — 싸운 3v3 공격대, 그다음 늦게 만든 차례(5v5 수비대 · 3v3 수비대). 한국어일 때만 글자로 본다
  if (!LANG && recent.join(',') !== '3vs3 공격대,5vs5 수비대,3vs3 수비대') fail(`최근 부대 차례가 다르다 — ${recent.join(',')}`);
  // 전적은 승 · 무 · 패 · 격파 아이콘 + 숫자다(2026-10-26) — 글자가 아니라 칸의 값으로 본다
  const tally = await page.$eval('.bar-recent-row [data-field="tally"] .gic-tally',
    (el) => ['w', 'd', 'l', 'k'].map((k) => (el as HTMLElement).dataset[k]).join(' / '));
  if (tally !== '3 / 2 / 4 / 12') fail(`전적이 다르다 — "${tally}"`);
  ok(`최근 셋 [${recent.join(' ')}] · ${tally}`);

  step('부대 목록 — 칸 넷 (2026-11-14)');
  await page.click('[data-action="squads"]');
  await page.waitForSelector('[data-screen="squads"]');
  await shot('02-list');
  const cells = await page.$$eval('.sqg-cell', (els) => els.map((e) => `${(e as HTMLElement).dataset.slot}:${(e as HTMLElement).dataset.filled}:${(e as HTMLElement).dataset.garrison}`));
  if (cells.join(',') !== 'atk-3v3:1:0,def-3v3:1:1,atk-5v5:0:0,def-5v5:1:1') fail(`칸이 [${cells.join(' ')}]다`);
  // 칸 안이 넘치지 않는가 — 꼬마 명단 띠가 칸 안에 들고, 이름표(공격대 · 수비대)가 안 잘린다(긴 언어로도 본다).
  // 칸의 `scrollWidth`로 재면 꼬마 뒤 후광(장식, 절대 위치)까지 세어 넘친다고 한다 — 띠와 글자만 잰다
  const spill = await page.$$eval('.sqg-cell', (els) => els.flatMap((e) => {
    const c = e.getBoundingClientRect();
    const who = e.querySelector('.sqg-who')?.getBoundingClientRect();
    const role = e.querySelector('.sqg-role') as HTMLElement | null;
    const out: string[] = [];
    if (who && (who.left < c.left - 0.5 || who.right > c.right + 0.5)) out.push(`${(e as HTMLElement).dataset.slot} 명단 ${Math.round(who.width)}/${Math.round(c.width)}`);
    if (role && role.scrollWidth > role.clientWidth + 1) out.push(`${(e as HTMLElement).dataset.slot} 이름표 잘림`);
    return out;
  }));
  if (spill.length) fail(`칸 안이 넘친다 — ${spill.join(', ')}`);
  ok(`칸 넷 [${cells.join(' ')}] · 넘침 없음`);

  step('부대 현황 (67쪽)');
  await page.click('.sqg-cell[data-slot="atk-3v3"]');
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
  ok('다섯 줄 · 부상 하나 · [부대 관리][부대 비우기]');

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
  const before = await page.evaluate(() => (window as any).__profile.current.squads.find((s: any) => s.id === 'atk-3v3').deploy.P1);
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
  const saved = await page.evaluate(() => (window as any).__profile.current.squads.find((s: any) => s.id === 'atk-3v3'));
  if (saved.picks[1].piece !== 'Knight') fail('저장된 포지션이 Knight가 아니다');
  if (!saved.deploy.P1.some((c: any) => c.piece === 'Knight' && c.x === Number(tx) && c.y === Number(ty))) fail('저장된 배치에 옮긴 자리가 없다');
  await shot('12-view-after');
  ok('수정 완료 → 부대 현황, 포지션·배치 모두 저장됐다');

  step('빈 칸 채우기 — 5v5 공격대 (71·72쪽, 이름 걸음은 없어졌다)');
  await page.click('[data-action="back"]');
  await page.waitForSelector('[data-screen="squads"]');
  await page.click('.sqg-cell[data-slot="atk-5v5"]');
  await page.waitForSelector('[data-screen="squadEdit"][data-new="1"]');
  const start = await page.$$eval('.sqm-row[data-piece]', (els) => els.map((e) => (e as HTMLElement).dataset.piece));
  if (start.join(',') !== 'King,Rock,Queen,Bishop,Knight') fail(`5v5 처음 포지션이 [${start.join(' ')}]다`);
  await shot('14-new-members-empty');
  for (let row = 0; row < 5; row += 1) {
    await page.click(`[data-action="pickOfficer"][data-row="${row}"]`);
    await page.waitForSelector('[data-modal="officerPick"]');
    const free = await page.$$('[data-modal="officerPick"] [data-action="directPick"]');
    await free[row]!.click();
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
  if (!await page.$('[data-screen="squadView"][data-squad="atk-5v5"]')) fail('채운 5v5 공격대의 현황이 아니다');
  await page.click('[data-action="back"]');
  await page.waitForSelector('[data-screen="squads"]');
  await shot('19-list-full');
  ok('5v5 공격대 — 처음 포지션 · 요약 · 기본 배치 팝업 · 저장 후 현황 · 칸 넷이 다 찼다');

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' | ')}`);
  console.log('\n✓ 병영 UX 한 바퀴 완주');
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
