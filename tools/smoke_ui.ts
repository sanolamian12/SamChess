/**
 * 화면 연동 스모크 테스트 — 클릭이 실제 판정으로 이어지는지 확인한다.
 *
 *   node --experimental-strip-types tools/smoke_ui.ts
 *
 * `npm test`(순수 로직)로는 잡히지 않는 층을 본다: 화면 좌표 → 격자 좌표 → `Intent` →
 * 룰 엔진. 좌표 변환이 한 칸 어긋나거나 카메라 줌 계산이 틀리면 여기서 걸린다.
 *
 * **턴을 끝낼 수 있는지도 확인한다.** 이동만 하고 공격 대상이 없으면 유효한 의도가
 * 「턴 종료」 하나뿐인데, 그 버튼이 없거나 잠겨 있으면 화면이 그대로 멈춘다.
 * 실제로 1차 구현에서 이 교착이 났다.
 *
 * 개발 서버(`npm run dev -w @samchess/client`)가 떠 있어야 한다.
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

await page.goto(`${BASE}/?seed=3&mode=3v3&side=P1`, { waitUntil: 'networkidle' });

/** 씬에서 지금 상황을 뽑아 온다. 씬이 쓰는 것과 **같은 경로**로 물어야 의미가 있다. */
const probe = () => page.evaluate(() => {
  const scene = (window as any).__battle?.scene;
  const pb = scene?.debugPlayback;
  if (!pb) return null;
  const s = pb.state;
  const u = s.activeUnit ? s.units[s.activeUnit] : null;
  return {
    phase: pb.phase as string,
    time: s.time as number,
    activeUnit: s.activeUnit as string | null,
    moved: (s.activeTurn?.moved ?? false) as boolean,
    pos: u ? { x: u.pos.x as number, y: u.pos.y as number } : null,
    moves: scene.debugLegalMoves() as { x: number; y: number }[],
    // 버튼은 data-action으로 찾는다. 순서로 찾으면 버튼이 하나 늘 때 조용히 엉뚱한 걸 누른다.
    endTurnEnabled: !(document.querySelector('#control button[data-action="endTurn"]') as HTMLButtonElement)?.disabled,
    modal: {
      hidden: document.getElementById('control')?.classList.contains('hidden') ?? true,
      name: document.querySelector('#control .ctl-name')?.textContent ?? '',
      stats: document.querySelectorAll('#control .ctl-stats .stat').length,
      shown: [...document.querySelectorAll('#control button')]
        .filter((b) => !b.classList.contains('hidden'))
        .map((b) => `${(b as HTMLElement).dataset.action}${(b as HTMLButtonElement).disabled ? '-' : '+'}`),
    },
    // 화면에 실제로 그려진 글자를 읽는다. 상태를 다시 계산하면 HUD가 죽어도 통과한다.
    hud: {
      clock: document.querySelector('#hud .clock')?.textContent ?? '',
      pips: document.querySelectorAll('#hud .sp.p1 .pip').length,
      pipsOn: document.querySelectorAll('#hud .sp.p1 .pip.on').length,
      spText: document.querySelector('#hud .sp.p1 .num')?.textContent ?? '',
      skills: document.querySelectorAll('#hud .skill').length,
    },
    wait: scene.debugWaitTimes() as Record<string, number>,
  };
});

// 씬이 뜨고 사람 차례가 올 때까지 대기 (networkidle 시점엔 create()가 안 끝났을 수 있다)
const deadline = Date.now() + 25_000;
let snap = await probe();
while (snap?.phase !== 'awaitingInput' && Date.now() < deadline) {
  await page.waitForTimeout(200);
  snap = await probe();
}
if (!snap || snap.phase !== 'awaitingInput') fail(`사람 차례가 오지 않았다 (phase=${snap?.phase})`);
console.log(`✓ 사람 차례 — ${snap.activeUnit} at (${snap.pos!.x},${snap.pos!.y}), time ${snap.time}`);
if (snap.moves.length === 0) fail('이동 가능 칸이 없다');

// 격자 좌표 → 화면 픽셀.
// Phaser의 줌은 원점이 아니라 **카메라 중심** 기준이라 `(world - scroll) * zoom`은 틀린다.
// 지금 보이는 월드 사각형(`worldView`)에 대한 비율로 환산하는 쪽이 정확하다.
const dest = snap.moves[0]!;
const screen = await page.evaluate(([x, y]) => {
  const cam = (window as any).__battle.scene.cameras.main;
  const CELL_W = 96, CELL_H = 120;
  const wx = x * CELL_W + CELL_W / 2;
  const wy = y * CELL_H + CELL_H / 2;
  const v = cam.worldView;
  return {
    x: ((wx - v.x) / v.width) * cam.width,
    y: ((wy - v.y) / v.height) * cam.height,
  };
}, [dest.x, dest.y]);

const before = snap.pos!;
await page.mouse.click(screen.x, screen.y);
await page.waitForTimeout(300);

const after = await probe();
if (after?.pos?.x !== dest.x || after.pos.y !== dest.y) {
  fail(`클릭이 이동으로 이어지지 않았다: (${before.x},${before.y}) → 기대 (${dest.x},${dest.y}), 실제 (${after?.pos?.x},${after?.pos?.y})`);
}
console.log(`✓ 클릭 → 이동 — (${before.x},${before.y}) → (${dest.x},${dest.y})`);
if (!after.moved) fail('activeTurn.moved가 서지 않았다');
console.log('✓ 턴 상태 갱신됨');

// 이동만 한 상태에서 턴을 끝낼 수 있어야 한다.
// 공격 대상이 없고 MP도 가득이면 유효한 의도가 「턴 종료」 하나뿐이라, 이게 잠기면 교착이다.
if (!after.endTurnEnabled) fail('「턴 종료」가 잠겨 있다 — 이동만 하면 화면이 멈춘다');
const t0 = after.time;
await page.click('#control button[data-action="endTurn"]');
await page.waitForTimeout(2500);
const ended = await probe();
if (!ended || ended.time <= t0) fail(`턴 종료 후에도 시간이 흐르지 않았다 (${t0} → ${ended?.time})`);
console.log(`✓ 턴 종료 → 시간 진행 (${t0} → ${ended.time}), 다음 제어권 ${ended.activeUnit}`);

// ── HUD (GDD §3.10) ──────────────────────────────────────────
// 시계·SP·고유기술은 CTB를 읽는 지표다. 없으면 "왜 저 유닛 차례인가"를 판단할 수 없다.

const hud = ended.hud;
if (!/^\d+\.\d일$/.test(hud.clock)) fail(`HUD 시계가 이상하다: "${hud.clock}"`);
if (hud.pips === 0) fail('HUD에 SP 칸이 없다');
if (!/^\d+\/\d+$/.test(hud.spText)) fail(`HUD SP 표기가 이상하다: "${hud.spText}"`);
if (hud.pips !== Number(hud.spText.split('/')[1])) {
  fail(`SP 칸 수(${hud.pips})가 cap(${hud.spText})과 다르다`);
}
if (hud.pipsOn !== Number(hud.spText.split('/')[0])) {
  fail(`채워진 SP 칸(${hud.pipsOn})이 실제 SP(${hud.spText})와 다르다`);
}
console.log(`✓ HUD — ${hud.clock}, SP ${hud.spText} (칸 ${hud.pipsOn}/${hud.pips}), 고유기술 ${hud.skills}줄`);

// WT 게이지는 **상태가 아니라 시간**으로 움직인다.
// `advanceTime()`이 다음 제어권까지 한 번에 점프하므로 `unit.wt`를 그대로 그리면 게이지가
// 순간이동한다. 화면이 따라잡지 못한 만큼을 되돌려 더해야 실시간으로 차오른다 —
// 그 보정이 빠지면 여기서 "줄지 않는다"로 잡힌다.
// 시간이 흐르는 구간은 0.3초 남짓이라 밖에서 폴링하면 놓친다. 페이지 안에서
// 프레임마다 표본을 모은 뒤 한 번에 받아온다. `target`(그 구간의 목표 시각)이 같은
// 표본끼리가 한 구간이다 — 구간이 바뀌면 잔여 WT는 당연히 다시 커진다.
const watchWait = (ms: number) => page.evaluate((limit) => new Promise<{ target: number; max: number }[]>((resolve) => {
  const scene = (window as any).__battle.scene;
  const out: { target: number; max: number }[] = [];
  const t0 = performance.now();
  const tick = (): void => {
    const pb = scene.debugPlayback;
    if (pb.phase === 'advancing') {
      const remain = Object.values(scene.debugWaitTimes()) as number[];
      if (remain.length) out.push({ target: pb.state.time, max: Math.max(...remain) });
    }
    if (performance.now() - t0 < limit) requestAnimationFrame(tick);
    else resolve(out);
  };
  requestAnimationFrame(tick);
}), ms);

let window_: { target: number; max: number }[] = [];
for (let attempt = 0; attempt < 5 && window_.length < 2; attempt++) {
  // 사람 차례면 턴을 넘겨 시간이 흐르게 만든다 (그냥 기다리면 입력 대기로 멈춰 있다)
  const now = await probe();
  if (now?.phase === 'awaitingInput' && now.endTurnEnabled) {
    await page.click('#control button[data-action="endTurn"]');
  }
  const samples = await watchWait(1200);
  const groups = new Map<number, number[]>();
  for (const s of samples) groups.set(s.target, [...(groups.get(s.target) ?? []), s.max]);
  const longest = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (longest && longest[1].length >= 2) window_ = longest[1].map((max) => ({ target: longest[0], max }));
}
if (window_.length < 2) fail('시간이 흐르는 구간을 잡지 못했다');
const first = window_[0]!.max;
const last = window_[window_.length - 1]!.max;
if (!(last < first)) {
  fail(`WT 게이지가 시간이 흘러도 줄지 않는다 (${first.toFixed(1)} → ${last.toFixed(1)}) — displayTime 보정이 빠졌다`);
}
console.log(`✓ WT 게이지 실시간 감소 — 잔여 최대 ${first.toFixed(1)} → ${last.toFixed(1)} (표본 ${window_.length})`);

// ── 제어 모달 3상태 (GDD §3.10) ──────────────────────────────
// 「내가 제어권」에서 장수 정보와 행동 버튼이 실제로 서 있는지 본다.
// 버튼 활성 여부는 클라이언트가 아니라 엔진(validate)이 정하므로, 여기서 확인하는 것은
// **엔진이 켜 준 것이 화면에도 켜져 있는가**다.

const wait = async (want: string, ms = 20_000) => {
  const until = Date.now() + ms;
  let s = await probe();
  while (s?.phase !== want && Date.now() < until) {
    await page.waitForTimeout(150);
    s = await probe();
  }
  return s;
};

const mineSnap = await wait('awaitingInput');
if (mineSnap?.phase !== 'awaitingInput') fail('내 차례가 다시 오지 않았다');
const modal = mineSnap.modal;
if (modal.hidden) fail('내 차례인데 제어 모달이 숨겨져 있다');
if (!/\[(King|Rock|Bishop|Knight|Queen|Pawn)\]$/.test(modal.name)) {
  fail(`모달에 장수[기물]이 없다: "${modal.name}"`);
}
if (modal.stats < 6) fail(`능력치 표시가 모자란다 (${modal.stats}개) — HP·MP·AT·무력·지력·통솔`);
for (const action of ['move', 'attack', 'castTactic', 'meditate', 'endTurn']) {
  if (!modal.shown.some((s) => s.startsWith(action))) fail(`「${action}」 버튼이 없다`);
}
if (modal.shown.some((s) => s.startsWith('forceSkipTurn'))) fail('내 차례에 「턴 넘기기」가 보인다');
// 엔진이 이동 후보를 준 이상 「이동」이 켜져 있어야 한다 — 어긋나면 계약이 깨진 것이다
if (mineSnap.moves.length > 0 && !modal.shown.includes('move+')) {
  fail(`이동 후보가 ${mineSnap.moves.length}칸인데 「이동」이 잠겨 있다`);
}
console.log(`✓ 제어 모달(내 차례) — ${modal.name}, 능력치 ${modal.stats}개, 버튼 [${modal.shown.join(' ')}]`);

// 「이동」 모드를 켜면 공격 하이라이트가 빠지고 이동 후보만 남는다
await page.click('#control button[data-action="move"]');
await page.waitForTimeout(150);
const armed = await probe();
if (!armed?.modal.shown.includes('move+')) fail('「이동」을 눌러도 모드가 켜지지 않는다');
await page.click('#control button[data-action="move"]');   // 다시 눌러 해제
console.log('✓ 「이동」 모드 토글');

// 상대 차례는 AI가 350ms만에 두고 지나가서 밖에서 폴링하면 놓친다.
// 프레임마다 들여다보다 걸리는 순간의 모달을 그대로 떠 온다.
const catchOpponent = (ms: number) => page.evaluate((limit) => new Promise<{
  hidden: boolean; name: string; shown: string[];
} | null>((resolve) => {
  const scene = (window as any).__battle.scene;
  const t0 = performance.now();
  const tick = (): void => {
    if (scene.debugPlayback.phase === 'aiThinking') {
      const root = document.getElementById('control')!;
      resolve({
        hidden: root.classList.contains('hidden'),
        name: root.querySelector('.ctl-name')?.textContent ?? '',
        shown: [...root.querySelectorAll('button')]
          .filter((b) => !b.classList.contains('hidden'))
          .map((b) => `${b.dataset.action}${b.disabled ? '-' : '+'}`),
      });
      return;
    }
    if (performance.now() - t0 < limit) requestAnimationFrame(tick);
    else resolve(null);
  };
  requestAnimationFrame(tick);
}), ms);

// 내 차례면 넘겨서 상대 차례가 오게 만든다
for (let attempt = 0; attempt < 4; attempt++) {
  const now = await probe();
  if (now?.phase === 'awaitingInput' && now.endTurnEnabled) {
    await page.click('#control button[data-action="endTurn"]');
  }
  const away = await catchOpponent(4000);
  if (!away) continue;

  if (away.hidden) fail('상대 차례인데 모달이 숨겨져 있다');
  if (!away.name.includes('제어 중')) fail(`상대 제어 안내가 없다: "${away.name}"`);
  // 상대 차례에는 행동 버튼이 아니라 「턴 넘기기」만 나와야 한다
  if (away.shown.some((s) => s.startsWith('move') || s.startsWith('endTurn'))) {
    fail(`상대 차례에 내 행동 버튼이 보인다: [${away.shown.join(' ')}]`);
  }
  // 20초 전에는 잠겨 있어야 한다 (GDD §3.3)
  if (away.shown.includes('forceSkipTurn+')) fail('20초 전인데 「턴 넘기기」가 열려 있다');
  console.log(`✓ 제어 모달(상대 차례) — "${away.name}", 버튼 [${away.shown.join(' ')}]`);
  break;
}

if (errors.length) fail(`콘솔 오류 ${errors.length}건: ${errors[0]}`);
console.log('\n화면 연동 스모크 통과');
await browser.close();
