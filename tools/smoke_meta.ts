/**
 * 메타 연동 스모크 — 오프라인 한 바퀴가 실제로 도는지 확인한다.
 *
 *   node --experimental-strip-types tools/smoke_meta.ts
 *
 * ```
 * 새 계정 → 편성(기물+장수) → 출전 → 배치 → 정찰 → 전투 → 장수 관리 → 레벨업 → 새로고침
 * ```
 *
 * `npm test`(순수 규칙)와 `smoke:ui`(전투 화면) 사이가 여기다. 규칙도 맞고 전투도 도는데
 * **화면이 그 둘을 잇지 못하는** 종류를 잡는다 — 편성이 엔진에 안 넘어가거나,
 * 저장이 안 되거나, 결과가 계정에 반영되지 않는 것.
 *
 * 개발 서버(`npm run dev`)가 떠 있어야 한다.
 */

import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const i = argv.indexOf('--url');
const BASE = i >= 0 && argv[i + 1] ? argv[i + 1]! : 'http://localhost:5173';

const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });

// ── 새 계정 (GDD §8) ───────────────────────────────────────────

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);

if (!await page.$('.scr-new')) fail('저장된 계정을 지웠는데도 새 계정 화면이 뜨지 않는다');
await page.fill('.field', '스모크성');
await page.click('.scr-new .btn.primary');
await page.waitForTimeout(300);

const main = await page.evaluate(() => ({
  city: document.querySelector('.scr-main .title')?.textContent ?? '',
  stats: [...document.querySelectorAll('.scr-main .stat')].map((el) => el.textContent ?? ''),
  modes: [...document.querySelectorAll('.scr-main .btn[data-mode]')].map((el) => (el as HTMLElement).dataset.mode),
}));
if (main.city !== '스모크성') fail(`도시 이름이 반영되지 않았다: "${main.city}"`);
// 초기 지급은 S·A·B·C·D 각 1명 (GDD §8)
if (!main.stats.some((s) => s.includes('5/10'))) fail(`초기 지급이 5명이 아니다: ${main.stats.join(' ')}`);
// 1:1은 없앴다 (2026-08-04 확정)
if (main.modes.includes('1v1')) fail('1:1이 아직 남아 있다 — 영구 삭제로 확정했다');
if (!main.modes.includes('3v3') || !main.modes.includes('5v5')) fail(`대전 규모가 3v3·5v5가 아니다: ${main.modes.join(',')}`);
console.log(`✓ 새 계정 — ${main.city}, ${main.stats.join(' · ')}, 모드 [${main.modes.join(' ')}]`);

// 장수 5명뿐이라 5v5는 잠겨 있어야 한다 (기물 수만큼 장수가 필요하다)
if (await page.isEnabled('.btn[data-mode="5v5"]') === false) {
  console.log('✓ 5v5는 장수가 모자라 잠겨 있다');
}

// ── 편성 (GDD §3.9) ────────────────────────────────────────────

await page.click('.btn[data-mode="3v3"]');
await page.waitForTimeout(300);

// King은 처음부터 들어가 있고 뺄 수 없다
const kingLocked = await page.evaluate(() => {
  const king = document.querySelector('.piece[data-piece="King"]');
  return king?.classList.contains('on') ?? false;
});
if (!kingLocked) fail('King이 기본으로 들어가 있지 않다');

// 아직 자리가 비어 있으니 출전은 잠겨 있어야 한다
if (await page.isEnabled('[data-action="start"]')) fail('편성이 비었는데 출전이 열려 있다');

await page.click('.piece[data-piece="Rock"]');
await page.click('.piece[data-piece="Pawn"]');
await page.waitForTimeout(150);

for (let n = 0; n < 3; n++) {
  const card = await page.$('.pool .card:not(.used)');
  if (!card) fail(`보유 장수가 모자라 편성을 채울 수 없다 (${n}명까지)`);
  await card.click();
  await page.waitForTimeout(120);
}

const roster = await page.evaluate(() => ({
  note: document.querySelector('.scr-roster .note')?.textContent ?? '',
  slots: [...document.querySelectorAll('.slot')].map((el) => ({
    piece: (el as HTMLElement).dataset.piece,
    filled: el.classList.contains('filled'),
  })),
  canStart: !(document.querySelector('[data-action="start"]') as HTMLButtonElement)?.disabled,
}));
if (roster.slots.length !== 3) fail(`자리가 3개가 아니다: ${roster.slots.length}`);
if (roster.slots.some((s) => !s.filled)) fail('빈 자리가 남았는데 채워졌다고 나온다');
if (!roster.canStart) fail(`편성을 다 채웠는데 출전이 잠겨 있다 — "${roster.note}"`);
console.log(`✓ 편성 — [${roster.slots.map((s) => s.piece).join(' ')}] "${roster.note}"`);

// ── 출전 → 배치 → 정찰 → 전투 (GDD §3.9) ──────────────────────

await page.click('[data-action="start"]');
await page.waitForTimeout(2500);

/** 씬에서 지금 단계를 뽑아 온다 */
const stage = () => page.evaluate(() => {
  const pb = (window as any).__battle?.scene?.debugPlayback;
  return pb ? {
    phase: pb.phase as string,
    engine: pb.state.phase as string,
    ready: pb.state.ready as Record<string, boolean>,
    remain: pb.remainingSec as number | null,
    button: document.querySelector('.prep-go')?.textContent ?? '',
    hidden: document.getElementById('prep')?.classList.contains('hidden') ?? true,
    mine: Object.values(pb.state.units as Record<string, any>)
      .filter((u: any) => u.side === 'P1').map((u: any) => `${u.pos.x},${u.pos.y}`) as string[],
  } : null;
});

let stg = await stage();
if (stg?.phase !== 'deploying') fail(`출전 뒤 배치 단계가 아니다 (${stg?.phase} / ${stg?.engine})`);
if (stg.hidden) fail('배치 단계인데 배치 패널이 숨겨져 있다');
// 상대(AI)는 기다릴 것이 없으므로 곧바로 준비를 마친다 — 「매칭 대기」가 눈에 안 보인다
if (!stg.ready['P2']) fail('AI가 준비를 마치지 않았다 — 배치에서 멈춘다');
if (stg.ready['P1']) fail('내가 준비를 누르지도 않았는데 준비 상태다');
if (!stg.remain || stg.remain > 60) fail(`배치 제한시간이 이상하다: ${stg.remain}`);
console.log(`✓ 배치 단계 — 남은 ${stg.remain}초, 버튼 "${stg.button}", 내 기물 [${stg.mine.join(' ')}]`);

// 내 기물을 골라 진영 안 다른 칸으로 옮긴다
const placedBefore = stg.mine.join(' ');
const spot = await page.evaluate(() => {
  const pb = (window as any).__battle.scene.debugPlayback;
  const u = Object.values(pb.state.units as Record<string, any>).find((x: any) => x.side === 'P1') as any;
  return { from: { x: u.pos.x, y: u.pos.y }, to: { x: u.pos.x + 1, y: u.pos.y - 2 } };
});
const cell = (x: number, y: number) => page.evaluate(([px, py]) => {
  const sc = (window as any).__battle.scene;
  const r = (sc.game.canvas as HTMLCanvasElement).getBoundingClientRect();
  const v = sc.cameras.main.worldView;
  return {
    x: r.left + ((px * 96 + 48 - v.x) / v.width) * r.width,
    y: r.top + ((py * 120 + 60 - v.y) / v.height) * r.height,
  };
}, [x, y]);

let at = await cell(spot.from.x, spot.from.y);
await page.mouse.click(at.x, at.y);
await page.waitForTimeout(200);
// 고르면 진영 안 빈 칸이 칠해진다 (엔진의 배치 구역과 같은 자리)
if (await page.evaluate(() => (window as any).__battle.scene.debugMarkCommands()) === 0) {
  fail('기물을 골라도 배치 가능한 칸이 표시되지 않는다');
}
at = await cell(spot.to.x, spot.to.y);
await page.mouse.click(at.x, at.y);
await page.waitForTimeout(300);

stg = await stage();
if (stg!.mine.join(' ') === placedBefore) fail(`배치에서 기물이 옮겨지지 않았다: ${placedBefore}`);
console.log(`✓ 배치 이동 — [${placedBefore}] → [${stg!.mine.join(' ')}]`);

// 준비완료 → 정찰
await page.click('.prep-go');
await page.waitForTimeout(400);
stg = await stage();
if (stg?.phase !== 'scouting') fail(`준비완료 뒤 정찰이 아니다 (${stg?.phase} / ${stg?.engine})`);
if (!stg.ready['P1']) fail('준비완료를 눌렀는데 ready가 서지 않았다');
// 정찰은 20초를 세되 마지막 5초만 숫자를 보여준다 (GDD §3.9)
const clockShown = await page.evaluate(() => document.querySelector('.prep-clock')?.textContent ?? '');
if (clockShown !== '') fail(`정찰 초반에는 카운트다운을 숨겨야 한다: "${clockShown}"`);
console.log(`✓ 정찰 단계 — 남은 ${stg.remain}초, 버튼 "${stg.button}" (카운트다운은 마지막 5초부터)`);

// 전투 시작
await page.click('.prep-go');
await page.waitForTimeout(1500);
stg = await stage();
if (stg?.engine === 'scout' || stg?.engine === 'deploy') fail(`전투가 시작되지 않았다 (${stg?.engine})`);
if (!stg!.hidden) fail('전투가 시작됐는데 배치 패널이 남아 있다');
console.log(`✓ 전투 시작 — ${stg!.phase} / ${stg!.engine}`);

const battle = await page.evaluate(() => {
  const scene = (window as any).__battle?.scene;
  const state = scene?.debugPlayback?.state;
  return state ? {
    mode: state.mode as string,
    units: Object.keys(state.units).length,
    mine: Object.values(state.units as Record<string, any>).filter((u: any) => u.side === 'P1').map((u: any) => u.officer),
    board: !!document.getElementById('board'),
  } : null;
});
if (!battle) fail('출전했는데 전투가 뜨지 않는다');
if (battle.units !== 6) fail(`3v3인데 유닛이 ${battle.units}개다`);
if (!battle.board) fail('전투 화면의 판 자리가 없다');
console.log(`✓ 전투 진입 — ${battle.mode}, 유닛 ${battle.units} (내 편성 ${battle.mine.join(', ')})`);

const grain = await page.evaluate(() => JSON.parse(localStorage.getItem('samchess.profile.v1') ?? '{}').grain);
if (grain !== 17) fail(`군량이 기물 수만큼 나가지 않았다 — 20 → ${grain} (기대 17)`);
console.log(`✓ 군량 소모 — 20 → ${grain} (기물 1개당 1)`);

// ── 장수 관리 · 레벨업 (GDD §4.2·§4.3) ─────────────────────────

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.click('.scr-main .menu .btn:not([data-mode])');
await page.waitForTimeout(300);

const before = (await page.textContent('.detail .info .nm'))?.trim() ?? '';
// 개발용 카드 지급 — AI 대전이 카드를 주지 않아 성장을 시험할 길이 없어서 둔 문
await page.click('.devtools .btn');
await page.waitForTimeout(200);
if (!await page.isEnabled('[data-action="levelUp"]')) {
  fail('카드를 채웠는데 레벨업이 잠겨 있다 — 레벨업에 실패는 없다(2026-08-04 확정)');
}
await page.click('[data-action="levelUp"]');
await page.waitForTimeout(300);

const after = (await page.textContent('.detail .info .nm'))?.trim() ?? '';
if (before === after) fail(`레벨업했는데 표시가 그대로다: "${before}"`);
const tactics = await page.evaluate(() => document.querySelectorAll('.detail .tactics .chip').length);
if (tactics === 0) fail('레벨업했는데 책략을 배우지 않았다 (능력 택1 + 책략 택1)');
console.log(`✓ 레벨업 — ${before} → ${after}, 책략 ${tactics}종`);

// ── 저장 (온라인이 붙으면 이 자리가 서버 API가 된다) ───────────

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
if (await page.$('.scr-new')) fail('새로고침했더니 계정이 사라졌다');
await page.click('.scr-main .menu .btn:not([data-mode])');
await page.waitForTimeout(300);
const kept = (await page.textContent('.detail .info .nm'))?.trim() ?? '';
if (kept !== after) fail(`새로고침 뒤 상태가 다르다: "${after}" → "${kept}"`);
console.log(`✓ 저장 유지 — ${kept}`);

if (errors.length) fail(`콘솔 오류 ${errors.length}건: ${errors[0]}`);
console.log('\n메타 연동 스모크 통과');
await browser.close();
