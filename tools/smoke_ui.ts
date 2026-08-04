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

await page.goto(`${BASE}/?demo=1&seed=3&mode=3v3&side=P1`, { waitUntil: 'networkidle' });

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
      note: document.querySelector('#control .ctl-note')?.textContent ?? '',
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
      surrender: !!document.querySelector('#hud button[data-action="surrender"]'),
    },
    // 시스템 대화창은 **엔진 이벤트를 문장으로 푼 것**이다. 판이 굴러가는데 여기가
    // 비어 있으면 이벤트가 화면까지 오지 않는다는 뜻이다.
    log: {
      lines: scene.debugLogLines() as string[],
      shown: document.querySelectorAll('#log .log-line').length,
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

/**
 * 격자 좌표 → 페이지 픽셀.
 *
 * Phaser의 줌은 원점이 아니라 **카메라 중심** 기준이라 `(world - scroll) * zoom`은 틀린다.
 * 지금 보이는 월드 사각형(`worldView`)에 대한 비율로 환산하는 쪽이 정확하다.
 *
 * **캔버스는 더 이상 화면 전체가 아니다** — 1:2 게임 프레임 가운데의 정사각 칸이라
 * 캔버스가 페이지 어디에 놓였는지(`getBoundingClientRect`)를 더해야 클릭 좌표가 맞는다.
 * 이걸 빼먹으면 클릭이 엉뚱한 칸으로 가고 "이동이 안 된다"로 잡힌다.
 */
const toScreen = (x: number, y: number) => page.evaluate(([px, py]) => {
  const scene = (window as any).__battle.scene;
  const cam = scene.cameras.main;
  const rect = (scene.game.canvas as HTMLCanvasElement).getBoundingClientRect();
  const v = cam.worldView;
  return {
    x: rect.left + ((px * 96 + 48 - v.x) / v.width) * rect.width,
    y: rect.top + ((py * 120 + 60 - v.y) / v.height) * rect.height,
  };
}, [x, y]);

const dest = snap.moves[0]!;
const screen = await toScreen(dest.x, dest.y);

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
if (!hud.surrender) fail('HUD에 「항복」이 없다 (pptx 21쪽)');
console.log(`✓ HUD — ${hud.clock}, SP ${hud.spText} (칸 ${hud.pipsOn}/${hud.pips}), 고유기술 ${hud.skills}줄, 항복 있음`);

// ── 시스템 대화창 (pptx 21쪽) ────────────────────────────────
// 이벤트 → 문장 변환이 죽으면 여기서 걸린다. 판은 굴러가는데 대화창만 비는 상태다.
{
  const until = Date.now() + 8000;
  let seen = ended.log;
  while (seen.lines.length === 0 && Date.now() < until) {
    await page.waitForTimeout(300);
    seen = (await probe())!.log;
  }
  if (seen.lines.length === 0) fail('행동이 있었는데 시스템 대화창이 비어 있다');
  if (seen.shown === 0) fail('대화가 기록에만 있고 화면에 그려지지 않았다');
  console.log(`✓ 시스템 대화 ${seen.lines.length}줄 (화면 ${seen.shown}줄) — 최근: "${seen.lines[seen.lines.length - 1]}"`);

  // 대화 영역을 누르면 전체 기록이 펼쳐진다
  await page.click('#log');
  await page.waitForTimeout(200);
  const histLines = await page.evaluate(() =>
    document.getElementById('history')?.classList.contains('hidden') === false
      ? document.querySelectorAll('#history .hist-line').length : -1);
  if (histLines < 0) fail('대화창을 눌러도 전체 기록이 열리지 않는다');
  await page.click('#history .hist-close');
  await page.waitForTimeout(150);
  if (await page.evaluate(() => !document.getElementById('history')?.classList.contains('hidden'))) {
    fail('전체 기록이 닫히지 않는다');
  }
  console.log(`✓ 대화 전체 기록 — ${histLines}줄 열고 닫기`);
}

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
// 첫째 줄은 「등급 이름 [기물] Lv」 (기획 지정 순서). 등급은 ::before로 붙어 textContent엔 없다.
if (!/\[(King|Rock|Bishop|Knight|Queen|Pawn)\] Lv\d$/.test(modal.name)) {
  fail(`모달 첫째 줄이 「이름 [기물] Lv」가 아니다: "${modal.name}"`);
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

// ── 턴 3단계 (GDD §3.4) ──────────────────────────────────────
// 고유기술을 먼저 묻고 → 이동(제자리 포함) → 공격/책략/명상.
// SP가 모이길 기다리지 않도록 ?sp=로 채워 두고 새 판을 연다.

await page.goto(`${BASE}/?demo=1&seed=3&mode=3v3&side=P1&sp=25`, { waitUntil: 'networkidle' });
let s = await wait('awaitingInput');
if (s?.phase !== 'awaitingInput') fail('새 판에서 내 차례가 오지 않았다');

// 물음은 판 한가운데(#dialog)에 뜬다 — 하단 패널이 아니라 별도 자리다 (pptx 23쪽)
const ask = () => page.evaluate(() => {
  const p = document.querySelector('#dialog .ctl-prompt');
  return {
    shown: !!p && !p.classList.contains('hidden'),
    text: p?.querySelector('.ask')?.textContent ?? '',
    buttons: [...(p?.querySelectorAll('button') ?? [])].map((b) => b.dataset.action ?? ''),
  };
});

// 고유기술이 있는 장수가 제어권을 잡을 때까지 턴을 넘긴다
let prompt = await ask();
for (let i = 0; i < 8 && !prompt.shown; i++) {
  await page.click('#control button[data-action="endTurn"]');
  await wait('awaitingInput');
  prompt = await ask();
}
if (!prompt.shown) fail('SP를 채웠는데도 고유기술 물음이 뜨지 않았다');
if (!prompt.buttons.includes('castUniqueSkill') || !prompt.buttons.includes('holdUniqueSkill')) {
  fail(`[고유기술 발동][보류]가 아니다: [${prompt.buttons.join(' ')}]`);
}
console.log(`✓ [1] 고유기술 물음 — ${prompt.text}`);

// 「보류」를 누르면 물음이 걷히고 행동 단계로 넘어간다
await page.click('#dialog button[data-action="holdUniqueSkill"]');
await page.waitForTimeout(120);
if ((await ask()).shown) fail('「보류」를 눌러도 물음이 남아 있다');
console.log('✓ [1] 「보류」 → 행동 단계로');

// [2] 제자리 대기 — 자기 칸을 눌러도 턴이 끝나지 않아야 한다
s = (await probe())!;
const self = await toScreen(s.pos!.x, s.pos!.y);
await page.mouse.click(self.x, self.y);
await page.waitForTimeout(150);
const stayed = (await probe())!;
if (stayed.phase !== 'awaitingInput') fail('제자리를 눌렀더니 턴이 끝났다');
if (stayed.pos!.x !== s.pos!.x || stayed.pos!.y !== s.pos!.y) fail('제자리를 눌렀는데 움직였다');
if (!stayed.modal.note.includes('제자리')) fail(`제자리 안내가 없다: "${stayed.modal.note}"`);
console.log(`✓ [2] 제자리 대기 — (${stayed.pos!.x},${stayed.pos!.y}) 유지, 행동은 그대로 가능`);

// [3] 책략 — 목록 → 조준 → 시전. 상태이상이 실제로 붙는지까지 본다.
await page.click('#control button[data-action="castTactic"]');
await page.waitForTimeout(150);
const list = await page.evaluate(() => [...document.querySelectorAll('#control .ctl-list .tactic')]
  .map((b) => ({ id: (b as HTMLElement).dataset.tactic ?? '', on: !(b as HTMLButtonElement).disabled })));
if (list.length !== 8) fail(`환술 8종이 떠야 한다 — 실제 ${list.length}종`);
const usable = list.find((t) => t.on);
if (!usable) fail(`쓸 수 있는 책략이 하나도 없다: ${JSON.stringify(list)}`);
console.log(`✓ [3] 책략 목록 ${list.length}종 (사용 가능 ${list.filter((t) => t.on).length}종)`);

const mpBefore = await page.evaluate(() => {
  const st = (window as any).__battle.scene.debugPlayback.state;
  return st.units[st.activeUnit].mp as number;
});
const caster = (await probe())!.activeUnit!;

await page.click(`#control .ctl-list .tactic[data-tactic="${usable.id}"]`);
await page.waitForTimeout(150);
const aim = await page.evaluate(() => ({
  cells: (window as any).__battle.scene.debugAimCells() as { x: number; y: number }[],
  marks: (window as any).__battle.scene.debugMarkCommands() as number,
  note: document.querySelector('#control .ctl-note')?.textContent ?? '',
}));
if (aim.cells.length === 0) fail(`「${usable.id}」 조준 후보가 하나도 칠해지지 않았다`);
// 조준 후보는 **유닛이 서 있는 칸**이다. 칸을 채우기만 하면 초상화(depth 10)가 그대로 덮어
// 화면에서는 아무것도 안 보인다. 유닛 위층(depth 15)에 테두리를 그렸는지 확인한다.
if (aim.marks === 0) fail('조준 후보가 유닛 위에 표시되지 않는다 — 초상화에 가려 보이지 않는다');
console.log(`✓ [3] 조준 모드 — 후보 ${aim.cells.length}칸(유닛 위 표시 확인), "${aim.note}"`);

const target = aim.cells[0]!;
const px = await toScreen(target.x, target.y);
await page.mouse.click(px.x, px.y);
await page.waitForTimeout(400);

// 환술은 **저항당할 수 있다**. 저항당하면 상태이상이 안 붙지만 MP는 소모된다
// (GDD §3.7 확정). 그래서 "상태가 붙었는가"가 아니라 **MP가 줄었는가**로 시전 성사를 본다.
const shot = await page.evaluate((id) => {
  const st = (window as any).__battle.scene.debugPlayback.state;
  return {
    mp: st.units[id].mp as number,
    statuses: Object.values(st.units as Record<string, any>)
      .flatMap((u: any) => u.statuses.map((x: any) => `${u.id}:${x.status}`)) as string[],
  };
}, caster);
if (shot.mp >= mpBefore) {
  fail(`책략을 시전했는데 MP가 그대로다 (${mpBefore} → ${shot.mp}) — 클릭이 의도로 이어지지 않았다`);
}
console.log(`✓ [3] 시전 → MP ${mpBefore}→${shot.mp}, 판 위의 상태이상 [${shot.statuses.join(' ') || '없음 — 저항'}]`);

// ── 배지 4종 · 클릭 검사 (GDD §3.10 · §3.9) ──────────────────
// 타일 배지는 버프·디버프 **개수**만 점으로 보여준다. 그 개수가 엔진 상태와 어긋나면
// 화면이 거짓말을 하는 것이므로, 여기서 둘을 직접 대조한다.

const badges = await page.evaluate(() => {
  const sc = (window as any).__battle.scene;
  const st = sc.debugPlayback.state;
  const drawn = sc.debugTileBadges() as Record<string, { grade: string; buffs: number; debuffs: number }>;
  const meta = (window as any).__battle.statusMeta as Record<string, { kind: string }>;
  return Object.values(st.units as Record<string, any>).map((u: any) => {
    const b = u.statuses.filter((s: any) => meta[s.status]?.kind === 'buff').length;
    const d = u.statuses.length - b + (u.control ? 1 : 0);
    return { id: u.id, alive: u.alive, want: { b, d }, got: drawn[u.id] };
  });
});
for (const u of badges) {
  if (!u.alive || !u.got) continue;
  if (u.got.buffs !== u.want.b || u.got.debuffs !== u.want.d) {
    fail(`${u.id} 배지가 상태와 다르다 — 화면 ${u.got.buffs}/${u.got.debuffs}, 실제 ${u.want.b}/${u.want.d}`);
  }
  if (!/^[SABCDE]\d$/.test(u.got.grade)) fail(`${u.id} 급+레벨 배지가 이상하다: "${u.got.grade}"`);
}
const totals = badges.filter((u) => u.got).reduce(
  (n, u) => ({ b: n.b + u.got!.buffs, d: n.d + u.got!.debuffs }), { b: 0, d: 0 });
console.log(`✓ 타일 배지 — 급+레벨 표기 확인, 버프 ${totals.b} · 디버프 ${totals.d}개가 상태와 일치`);

// 제어권자가 아닌 유닛은 클릭해야 상세를 볼 수 있다 (배지는 개수만 알려 주므로)
const other = await page.evaluate(() => {
  const st = (window as any).__battle.scene.debugPlayback.state;
  const u = Object.values(st.units as Record<string, any>)
    .find((x: any) => x.alive && x.id !== st.activeUnit) as any;
  return u ? { id: u.id, x: u.pos.x, y: u.pos.y } : null;
});
if (!other) fail('들여다볼 다른 유닛이 없다');
const op = await toScreen(other.x, other.y);
await page.mouse.click(op.x, op.y);
await page.waitForTimeout(200);
const inspect = await page.evaluate(() => {
  const p = document.getElementById('inspect');
  return {
    open: !!p && !p.classList.contains('hidden'),
    name: p?.querySelector('.ins-title .nm')?.textContent ?? '',
    grade: p?.querySelector('.ins-title .grade')?.textContent ?? '',
    stats: p?.querySelectorAll('.ins-stats .stat').length ?? 0,
    tactics: p?.querySelectorAll('.ins-tactics .chip').length ?? 0,
    statuses: p?.querySelectorAll('.ins-status .st').length ?? 0,
  };
});
if (!inspect.open) fail('기물을 눌러도 장수 정보 팝업이 뜨지 않는다');
if (!/\[(King|Rock|Bishop|Knight|Queen|Pawn)\]/.test(inspect.name)) {
  fail(`팝업에 장수[기물]이 없다: "${inspect.name}"`);
}
if (!/^[SABCDE]\d$/.test(inspect.grade)) fail(`팝업 급+레벨이 이상하다: "${inspect.grade}"`);
if (inspect.stats < 7) fail(`팝업 능력치가 모자란다 (${inspect.stats}개)`);
console.log(`✓ 장수 정보 팝업 — ${inspect.name} ${inspect.grade}, 능력치 ${inspect.stats} · 책략 ${inspect.tactics} · 상태 ${inspect.statuses}`);

// 닫기 단추로 닫힌다
await page.click('#inspect .ins-close');
await page.waitForTimeout(150);
if (await page.evaluate(() => !document.getElementById('inspect')?.classList.contains('hidden'))) {
  fail('닫기를 눌러도 팝업이 남아 있다');
}
console.log('✓ 장수 정보 팝업 닫기');

// ── 고유기술 발동 연출 (pptx 23·24쪽) ────────────────────────
// 물음에 「예」 → 연출 배너가 뜨고 그동안 판이 멈춘다. 연출이 안 뜨면 무엇이 터졌는지
// 알 수 없고, 멈추지 않으면 볼 겨를도 없이 다음 상태로 넘어간다.

await page.goto(`${BASE}/?demo=1&seed=3&mode=3v3&side=P1&sp=25`, { waitUntil: 'networkidle' });
s = await wait('awaitingInput');
if (s?.phase !== 'awaitingInput') fail('연출 확인용 판에서 내 차례가 오지 않았다');

prompt = await ask();
for (let i = 0; i < 8 && !prompt.shown; i++) {
  await page.click('#control button[data-action="endTurn"]');
  await wait('awaitingInput');
  prompt = await ask();
}
if (!prompt.shown) fail('연출 확인용 판에서 고유기술 물음이 뜨지 않았다');

await page.click('#dialog button[data-action="castUniqueSkill"]');
await page.waitForTimeout(200);
// 조준이 필요한 기술이면 후보 한 칸을 골라 준다 (필요 없는 기술은 이미 시전됐다)
const aimCells = await page.evaluate(() =>
  (window as any).__battle.scene.debugAimCells() as { x: number; y: number }[]);
if (aimCells.length > 0) {
  const at = await toScreen(aimCells[0]!.x, aimCells[0]!.y);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(200);
}

const fx = await page.evaluate(() => ({
  shown: document.getElementById('fx')?.classList.contains('hidden') === false,
  banner: !!document.querySelector('#fx .fx-banner'),
  caption: document.querySelector('#fx .fx-caption')?.textContent ?? '',
  frozen: (window as any).__battle.scene.debugPlayback.state.time as number,
}));
if (!fx.shown) fail('고유기술을 발동했는데 연출이 뜨지 않는다');
// 연출 중에는 시간이 흐르지 않아야 한다 (고유기술은 턴을 소비하지 않는다 — GDD §3.4)
await page.waitForTimeout(700);
const during = await page.evaluate(() =>
  (window as any).__battle.scene.debugPlayback.state.time as number);
if (during !== fx.frozen) fail(`연출 중에 시간이 흘렀다 (${fx.frozen} → ${during})`);
console.log(`✓ 고유기술 연출 — ${fx.caption}${fx.banner ? ' (배너 있음)' : ' (배너 없음 — 글자만)'}, 판 정지 확인`);

// 연출이 끝나면 걷힌다
await page.waitForTimeout(2000);
if (await page.evaluate(() => document.getElementById('fx')?.classList.contains('hidden') === false)) {
  fail('연출이 2초가 지나도 걷히지 않는다');
}
console.log('✓ 연출 종료 → 판 재개');

// ── 버프/디버프 배지 설명 (기획 3번) ──────────────────────────
// 배지를 누르면 그 뜻이 팝업으로 뜬다. 이름·설명의 출처는 엔진의 STATUS_META다.

const chip = await page.evaluate(() => {
  const el = document.querySelector('#control .ctl-status .st') as HTMLElement | null;
  return el ? { status: el.dataset.status ?? '', text: el.textContent ?? '' } : null;
});
if (chip) {
  await page.click('#control .ctl-status .st');
  await page.waitForTimeout(150);
  const tip = await page.evaluate(() => ({
    open: document.getElementById('tip')?.classList.contains('hidden') === false,
    name: document.querySelector('#tip .tip-name')?.textContent ?? '',
    body: document.querySelector('#tip .tip-body')?.textContent ?? '',
  }));
  if (!tip.open) fail('상태 배지를 눌러도 설명이 뜨지 않는다');
  if (tip.body.length < 5) fail(`상태 설명이 비어 있다: "${tip.body}"`);
  await page.click('#tip .tip-close');
  console.log(`✓ 상태 배지 설명 — 「${tip.name}」 ${tip.body.slice(0, 24)}…`);
} else {
  console.log('· 상태 배지 설명 — 걸린 상태가 없어 건너뜀');
}

if (errors.length) fail(`콘솔 오류 ${errors.length}건: ${errors[0]}`);
console.log('\n화면 연동 스모크 통과');
await browser.close();
