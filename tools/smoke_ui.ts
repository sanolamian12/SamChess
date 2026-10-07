/**
 * 화면 연동 스모크 테스트 — 클릭이 실제 판정으로 이어지는지 확인한다.
 *
 *   node --experimental-strip-types tools/smoke_ui.ts
 *
 * `npm test`(순수 로직)로는 잡히지 않는 층을 본다: 화면 좌표 → 격자 좌표 → `Intent` →
 * 룰 엔진. 좌표 변환이 한 칸 어긋나거나 카메라 줌 계산이 틀리면 여기서 걸린다.
 *
 * **턴은 두 구간이다** (2026-08-12, pptx 29쪽) — 포커스를 받으면 판에 **이동 범위만**
 * 뜨고 커맨드 패널은 없다. 이동(또는 제자리)을 마쳐야 패널이 뜨고, 거기에 `이동`은 없다.
 * 그래서 여기서도 「먼저 판을 눌러 움직이고, 그다음 패널을 본다」 순서로 확인한다.
 *
 * **턴을 끝낼 수 있는지도 확인한다.** 이동만 하고 공격 대상이 없으면 유효한 의도가
 * 「대기」 하나뿐인데, 그 버튼이 없거나 잠겨 있으면 화면이 그대로 멈춘다.
 * 실제로 1차 구현에서 이 교착이 났다.
 *
 * 개발 서버(`npm run dev -w @samchess/client`)가 떠 있어야 한다.
 */

import { UNIQUE_SKILLS, combatantById } from '@samchess/data';
import { commandsFor, forecastAttack, meditateGain, skillStatus, tacticsRevealed, turnForecast } from '@samchess/rules';
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
    endTurnEnabled: !(document.querySelector('#cmd button[data-action="endTurn"]') as HTMLButtonElement)?.disabled,
    // 명령 흐름 (전투 UI 개편 4단계) — `menu` · `move` · `attack` · `list` · `aim` · `confirm`
    flow: scene.debugFlowStep as string,
    boardMode: scene.debugActionMode as string,
    // 명령 판(왼쪽 `#cmd`) — 여섯 칸 / 장수 카드 / 빈칸 (`data-view`)
    cmd: {
      view: (document.getElementById('cmd') as HTMLElement)?.dataset.view ?? '',
      title: !!document.querySelector('#cmd .cmd-title'),
      shown: [...document.querySelectorAll('#cmd .cmd-grid button')]
        .map((b) => `${(b as HTMLElement).dataset.action}${(b as HTMLButtonElement).disabled ? '-' : '+'}`),
      card: (document.querySelector('#cmd .oc') as HTMLElement)?.dataset.unit ?? '',
    },
    // 맥락 판(오른쪽 `#ctx-flow`) — 물음 · 「…을 선택해주세요」 · 목록 · 확인창 · 대상 카드
    ctx: {
      view: (document.getElementById('ctx-flow') as HTMLElement)?.dataset.view ?? '',
      kind: (document.getElementById('ctx-flow') as HTMLElement)?.dataset.kind ?? '',
      card: (document.querySelector('#ctx-flow .oc') as HTMLElement)?.dataset.unit ?? '',
    },
    // 화면에 실제로 그려진 글자를 읽는다. 상태를 다시 계산하면 게임 정보가 죽어도 통과한다.
    // 게임 정보(pptx 93쪽)는 전투 UI 개편 3단계(2026-10-06)에서 옛 상단 HUD를 갈음했다.
    hud: {
      clock: document.querySelector('#gameinfo .gi-day')?.textContent ?? '',
      // SP는 **정수**다 (설계 확정 9)
      north: document.querySelector('#gameinfo .gi-side.p2 .gi-sp .num')?.textContent ?? '',
      south: document.querySelector('#gameinfo .gi-side.p1 .gi-sp .num')?.textContent ?? '',
      skips: [...document.querySelectorAll('#gameinfo .gi-skip .num')]
        .map((e) => (e as HTMLElement).dataset.skips ?? ''),
      armies: [...document.querySelectorAll('#gameinfo .gi-army')].map((e) => e.textContent ?? ''),
      // 옛 ⋯(기록)은 6단계에서 판 왼쪽 위의 [...]로 갔다 — 게임 정보에 남아 있으면 안 된다
      oldMore: !!document.querySelector('#gameinfo button[data-action="history"]'),
      left: (document.querySelector('#gameinfo .gi-left .num') as HTMLElement)?.dataset.left ?? '',
      act: (() => {
        const b = document.querySelector('#gameinfo .gi-act') as HTMLButtonElement | null;
        return b ? `${b.dataset.action}${b.disabled ? '-' : '+'}` : '';
      })(),
    },
    // 자동 포커싱 토글 — 글자는 「누르면 되는 것」이다
    focus: document.querySelector('#focus .focus-toggle')?.textContent ?? '',
    focusState: (document.querySelector('#focus .focus-toggle') as HTMLElement)?.dataset.state ?? '',
    busy: scene.debugPlayback.busy as boolean,
    camera: scene.debugCameraCue() as { scale: number; cell: { x: number; y: number } | null },
    settled: scene.debugCameraSettled as boolean,
    // 시스템 대화창은 **엔진 이벤트를 문장으로 푼 것**이다. 판이 굴러가는데 여기가
    // 비어 있으면 이벤트가 화면까지 오지 않는다는 뜻이다.
    log: {
      lines: scene.debugLogLines() as string[],
      shown: document.querySelectorAll('#log .log-line').length,
      // [...] (6단계) — 기록이 있고 대기 줄이 다 찍혔을 때만 드러난다
      more: (() => {
        const b = document.querySelector('#log .log-more') as HTMLElement | null;
        return b ? (b.classList.contains('hidden') ? 'hidden' : 'shown') : 'none';
      })(),
      pending: scene.debugLogPending as number,
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

// ── 명령 판 (pptx 94쪽 · 전투 UI 개편 4단계) ─────────────────────
// 차례가 오면 **명령 선택**이다 — 첫 줄 「명령을 선택하세요」 + 여섯 칸. 이동 범위는 아직 없다
// (2026-09-27 기획자 확정 3 — 예전에는 차례가 오자마자 이동 범위가 깔렸다).
// 맥락 판(오른쪽)은 명령 전에는 비어 있다 (설계 §3).
const SIX = ['move', 'attack', 'meditate', 'castTactic', 'useItem', 'endTurn'];
if (snap.flow !== 'menu' || snap.boardMode !== 'idle') fail(`차례가 왔는데 명령 선택이 아니다 (${snap.flow}/${snap.boardMode})`);
if (snap.cmd.view !== 'commands' || !snap.cmd.title) fail(`명령 판이 여섯 칸을 안 띄웠다 (view=${snap.cmd.view})`);
if (snap.cmd.shown.map((b) => b.slice(0, -1)).join() !== SIX.join()) {
  fail(`명령 칸의 순서가 94쪽과 다르다: [${snap.cmd.shown.join(' ')}]`);
}
if (snap.ctx.view !== 'empty') fail(`명령 전인데 맥락 판이 비어 있지 않다 (${snap.ctx.view})`);
if ((await page.evaluate(() => (window as any).__battle.scene.debugChoosableCells().length)) !== 0) {
  fail('명령 전인데 판에 고를 칸이 칠해져 있다 — 이동 범위는 [이동]을 눌러야 깔린다');
}
console.log(`✓ 명령 판 — [${snap.cmd.shown.join(' ')}] · 맥락 판 비어 있음 · 이동 범위 없음`);

/**
 * 카메라가 멈출 때까지 기다린다.
 *
 * **28쪽에서 카메라가 움직이기 시작했다.** 100%↔200% 전환이 부드럽게 진행되는 동안
 * `worldView`가 매 프레임 달라져서, 그때 좌표를 재면 클릭이 옆 칸으로 간다.
 * 화면 좌표를 만들기 전에 반드시 거친다.
 */
const settle = async (ms = 3000): Promise<void> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate(() => (window as any).__battle?.scene?.debugCameraSettled === true)) return;
    await page.waitForTimeout(60);
  }
};

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

/**
 * 판 위의 칸을 누른다 — 카메라가 멎기를 기다린 뒤 지금 보이는 자리로 환산한다.
 *
 * 카드 줄을 걷은 뒤(전투 UI 개편 2단계, 2026-10-06) 대상·장수를 고르는 통로는 판뿐이다.
 */
const clickCell = async (c: { x: number; y: number }): Promise<void> => {
  await settle();
  const at = await toScreen(c.x, c.y);
  await page.mouse.click(at.x, at.y);
};

/** 명령 판의 칸 하나를 누른다 (`data-action`) */
const pressCmd = async (action: string): Promise<void> => {
  await page.click(`#cmd button[data-action="${action}"]`);
  await page.waitForTimeout(150);
};

/** 맥락 판의 단추 하나를 누른다 — [취소] `cancel` · [확인] `commit` · [사용] `useUnique` · [미사용] `skipUnique` */
const pressCtx = async (action: string): Promise<void> => {
  await page.click(`#ctx-flow button[data-action="${action}"]`);
  await page.waitForTimeout(150);
};

/**
 * 「대기」로 턴을 끝낸다 — [대기] → 확인창 [확인] (4단계부터 대기도 확인창을 지난다, 96쪽).
 * 고유기술 물음이 떠 있으면 먼저 [미사용]으로 넘긴다.
 */
const endTurnNow = async (): Promise<void> => {
  let s = await probe();
  if (s?.phase !== 'awaitingInput' || s.busy) return;
  if (s.ctx.view === 'ask') { await pressCtx('skipUnique'); s = (await probe())!; }
  if (!s.endTurnEnabled) return;
  await pressCmd('endTurn');
  await pressCtx('commit');
};

/**
 * 공격 확인창 (95쪽) — 대상을 고르면 바로 쏘지 않고 「XXX을 공격합니다 · 데미지 · 치명타」를 띄운다.
 * 숫자는 엔진의 `forecastAttack()`과 같아야 하고, [취소]는 대상 선택 → 명령 선택으로 한 단계씩 돌아간다.
 * [공격]을 눌러 대상 칸이 칠해진 상태에서 부른다.
 */
const checkAttackConfirm = async (cells: { x: number; y: number }[]): Promise<void> => {
  const units = () => page.evaluate(() => {
    const st = (window as any).__battle.scene.debugPlayback.state;
    return Object.fromEntries(Object.values(st.units as Record<string, any>).map((u: any) => [u.id, u.hp]));
  });
  const hpBefore = await units();
  await clickCell(cells[0]!);
  await page.waitForTimeout(250);
  const ask = (await probe())!;
  if (ask.ctx.view !== 'confirm' || ask.ctx.kind !== 'attack') fail(`공격 대상을 골랐는데 확인창이 아니다 (${ask.ctx.view}/${ask.ctx.kind})`);
  // 확인창의 숫자 = 엔진이 미리 잰 값
  const want = await page.evaluate(() => {
    const sc = (window as any).__battle.scene;
    return { state: sc.debugPlayback.state, target: sc.debugCameraCue().cell };
  });
  const tgt = Object.values(want.state.units as Record<string, any>)
    .find((u: any) => u.alive && u.pos.x === cells[0]!.x && u.pos.y === cells[0]!.y) as any;
  const f = forecastAttack(want.state, want.state.activeUnit, tgt.id)!;
  const rows = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#ctx-flow .cx-rate')]
    .map((r) => [(r as HTMLElement).dataset.kind, r.querySelector('.v')?.textContent ?? ''])));
  if (f.execute ? rows['execute'] === undefined : rows['damage'] !== `${f.normal}-${f.critical}`) {
    fail(`확인창 데미지가 엔진과 다르다: ${JSON.stringify(rows)} vs ${f.normal}-${f.critical}`);
  }
  if (!f.execute && rows['critical'] !== `${f.criticalRate}%`) fail(`확인창 치명타가 엔진과 다르다: ${rows['critical']} vs ${f.criticalRate}%`);
  if (ask.camera.cell?.x !== tgt.pos.x || ask.camera.cell?.y !== tgt.pos.y) fail('공격 확인창인데 카메라가 대상을 비추지 않는다');
  if (JSON.stringify(await units()) !== JSON.stringify(hpBefore)) fail('확인창만 떴는데 HP가 변했다');
  console.log(`✓ 공격 확인창 — 데미지 ${rows['damage'] ?? '즉사'} · 치명타 ${rows['critical'] ?? '-'} (= forecastAttack) · 카메라가 대상`);

  // [취소]는 한 단계 뒤로 — 대상 선택으로
  await pressCtx('cancel');
  if ((await probe())!.flow !== 'attack') fail('확인창 [취소]가 대상 선택으로 돌아가지 않는다');
  await pressCtx('cancel');
  if ((await probe())!.flow !== 'menu') fail('대상 선택 [취소]가 명령 선택으로 돌아가지 않는다');
  console.log('✓ 공격 확인창 [취소] → 대상 선택 → [취소] → 명령 선택, 아무도 맞지 않음');
};

// [이동]을 누르면 이동 범위가 깔리고, 맥락 판이 「이동할 위치를 선택해주세요」 + [취소]다 (95쪽)
await pressCmd('move');
{
  const armed = (await probe())!;
  if (armed.flow !== 'move' || armed.boardMode !== 'move') fail(`[이동]을 눌러도 이동 모드가 아니다 (${armed.flow})`);
  if (armed.ctx.view !== 'move') fail(`[이동] 뒤 맥락 판이 ${armed.ctx.view}다`);
  if (!armed.cmd.shown.includes('move+')) fail('[이동]이 눌린 칸으로 남아 있지 않다');
  const cells = await page.evaluate(() => (window as any).__battle.scene.debugChoosableCells().length as number);
  if (cells !== armed.moves.length) fail(`칠한 이동 칸(${cells})이 엔진 후보(${armed.moves.length})와 다르다`);
  if (armed.camera.scale !== 1) fail(`이동 칸을 고르는데 판 전체가 아니다 (${armed.camera.scale}배)`);
  // [취소]는 명령 선택으로 — 이동 범위가 걷힌다
  await pressCtx('cancel');
  const back = (await probe())!;
  if (back.flow !== 'menu' || back.ctx.view !== 'empty') fail(`[취소] 뒤가 명령 선택이 아니다 (${back.flow}/${back.ctx.view})`);
  console.log(`✓ [이동] → 이동 범위 ${cells}칸 · 판 전체 · 「이동할 위치를…」 [취소] → 명령 선택`);
}
await pressCmd('move');

const dest = snap.moves[0]!;
await settle();
const screen = await toScreen(dest.x, dest.y);

const before = snap.pos!;
await page.mouse.click(screen.x, screen.y);
// 고정 시간으로 기다리지 않는다 — 연출 시간표가 바뀌면(2026-08-13에 +0.3초) 조용히
// 어긋난다. `settle()`은 자세·대화·카메라가 모두 멎기를 기다린다.
await settle();

const after = await probe();
if (after?.pos?.x !== dest.x || after.pos.y !== dest.y) {
  fail(`클릭이 이동으로 이어지지 않았다: (${before.x},${before.y}) → 기대 (${dest.x},${dest.y}), 실제 (${after?.pos?.x},${after?.pos?.y})`);
}
console.log(`✓ 클릭 → 이동 — (${before.x},${before.y}) → (${dest.x},${dest.y}) (이동은 확인창이 없다)`);
if (!after.moved) fail('activeTurn.moved가 서지 않았다');

// 이동한 뒤에는 명령 선택으로 돌아오고 **[이동]이 꺼진다** — 엔진이 거부하는 수라서다
if (after.flow !== 'menu') fail(`이동한 뒤 명령 선택으로 돌아오지 않았다 (${after.flow})`);
if (!after.cmd.shown.includes('move-')) fail(`실제로 움직인 뒤인데 [이동]이 켜져 있다: [${after.cmd.shown.join(' ')}]`);
console.log(`✓ 이동 후 → 명령 선택 [${after.cmd.shown.join(' ')}] (이동 꺼짐)`);

// 이동만 한 상태에서 턴을 끝낼 수 있어야 한다.
// 공격 대상이 없고 MP도 가득이면 유효한 의도가 「대기」 하나뿐이라, 이게 잠기면 교착이다.
if (!after.endTurnEnabled) fail('「대기」가 잠겨 있다 — 이동만 하면 화면이 멈춘다');
const t0 = after.time;
// 대기 → 확인창 「차례를 마칩니다」 (96쪽). [확인] 전에는 시간이 안 흐른다
await pressCmd('endTurn');
{
  const ask = (await probe())!;
  if (ask.ctx.view !== 'confirm' || ask.ctx.kind !== 'endTurn') fail(`[대기] 뒤 확인창이 아니다 (${ask.ctx.view}/${ask.ctx.kind})`);
  if (ask.time !== t0 || ask.activeUnit !== after.activeUnit) fail('[대기] 확인창만 떴는데 차례가 넘어갔다');
}
await pressCtx('commit');
await page.waitForTimeout(2500);
const ended = await probe();
if (!ended || ended.time <= t0) fail(`턴 종료 후에도 시간이 흐르지 않았다 (${t0} → ${ended?.time})`);
console.log(`✓ [대기] → 확인 「차례를 마칩니다」 → 시간 진행 (${t0} → ${ended.time}), 다음 제어권 ${ended.activeUnit}`);

// ── 게임 정보 (pptx 93쪽 · 전투 UI 개편 3단계) ────────────────
// 「전투 N일차 · 북군 SP · 턴오버 · 남군 SP · 턴오버 · 남은 시간」 + [항복]/[턴 가져오기].
// AI 대전에는 제어 마감이 없다 — 남은 시간 「-」, [턴 가져오기]는 언제나 꺼져 있다 (확정 8).

const hud = ended.hud;
if (!/^전투 \d+\.\d일차$/.test(hud.clock)) fail(`게임 정보 날짜가 이상하다: "${hud.clock}"`);
for (const [label, text] of [['북군', hud.north], ['남군', hud.south]] as const) {
  if (!/^\d+$/.test(text)) fail(`${label} SP가 정수가 아니다: "${text}"`);
}
// 진영 이름은 판의 위아래와 같아야 한다 — P2가 위쪽 5행이므로 북군이다
if (!hud.armies.some((t) => t.startsWith('북군')) || !hud.armies.some((t) => t.startsWith('남군'))) {
  fail(`게임 정보 진영 이름이 「북군/남군」이 아니다: [${hud.armies.join(' ')}]`);
}
const spState = await page.evaluate(() => {
  const st = (window as any).__battle.scene.debugPlayback.state;
  return { p1: st.sp.P1 as number, p2: st.sp.P2 as number, skips: `${st.skips.P2},${st.skips.P1}` };
});
if (Number(hud.north) !== Math.floor(spState.p2) || Number(hud.south) !== Math.floor(spState.p1)) {
  fail(`게임 정보 SP가 상태와 다르다 — 화면 북${hud.north}/남${hud.south}, 실제 P2 ${spState.p2}/P1 ${spState.p1}`);
}
if (hud.skips.join(',') !== spState.skips) fail(`턴오버가 상태와 다르다 — 화면 ${hud.skips} · 실제 ${spState.skips}`);
if (hud.left !== '-') fail(`AI 대전인데 남은 시간이 「-」가 아니다: "${hud.left}"`);
if (ended.phase === 'awaitingInput' ? hud.act !== 'surrender+' : hud.act !== 'takeTurn-') {
  fail(`게임 정보 단추가 이상하다 — ${ended.phase}에 [${hud.act}]`);
}
if (hud.oldMore) fail('게임 정보에 옛 「⋯」(대화 기록)가 남아 있다 — 6단계에서 판 왼쪽 위 [...]로 갔다');
if (await page.locator('#hud').count() > 0) fail('옛 상단 HUD(#hud)가 남아 있다');
console.log(`✓ 게임 정보 — ${hud.clock}, 북군 SP ${hud.north} · 남군 SP ${hud.south}, 턴오버 ${hud.skips.join('/')}, 남은 시간 ${hud.left}, [${hud.act}]`);

// ── 순서 판 (pptx 92쪽 · 전투 UI 개편 3단계) ─────────────────
// 전투 중엔 지금부터 5번째까지. 순서는 엔진의 예보(`turnForecast`)와 **같아야** 한다 —
// 화면이 순서를 다시 셈하면 동점·보정에서 조용히 갈린다. 표시등은 `skillStatus` 그대로.
type OrderRow = { unit: string; side: string; active: boolean; wt: string; skill: string };
{
  const ord = await page.evaluate(() => {
    const scene = (window as any).__battle.scene;
    return { rows: scene.debugOrder(), state: scene.debugPlayback.state };
  }) as { rows: OrderRow[]; state: any };
  const want = turnForecast(ord.state, 5);
  if (ord.rows.length !== 5) fail(`전투 중 순서 판이 ${ord.rows.length}줄이다 — 5줄이어야 한다`);
  const got = ord.rows.map((r) => r.unit).join(',');
  if (got !== want.map((w) => w.unit).join(',')) {
    fail(`순서 판이 엔진 예보와 다르다 — 화면 ${got} · 예보 ${want.map((w) => w.unit).join(',')}`);
  }
  for (const [i, r] of ord.rows.entries()) {
    if (r.active !== want[i]!.active) fail(`${i + 1}번 줄의 「지금 차례」가 예보와 다르다`);
    if (r.active ? r.wt !== '차례' : !/^\d+\.\d\d일$/.test(r.wt)) fail(`${i + 1}번 줄 WT 표기가 이상하다: "${r.wt}"`);
    if (r.skill !== skillStatus(ord.state, r.unit as never)) fail(`${r.unit} 표시등이 엔진과 다르다: ${r.skill}`);
    if (r.side !== (ord.state.units[r.unit].side === 'P1' ? 'mine' : 'foe')) fail(`${r.unit} 진영 색이 틀렸다: ${r.side}`);
  }
  const layout = await page.evaluate(() => {
    const w = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().width;
    return { mode: (document.getElementById('top') as HTMLElement).dataset.mode, order: w('#order'), info: w('#gameinfo') };
  });
  if (layout.mode !== 'battle') fail(`전투 중인데 위 칸이 「${layout.mode}」 모양이다`);
  if (Math.abs(layout.order - layout.info) > 2) fail(`순서 판 : 게임 정보가 1:1이 아니다 (${layout.order} : ${layout.info})`);
  console.log(`✓ 순서 판 — 5줄 = 엔진 예보 [${ord.rows.map((r) => r.wt).join(' ')}], 표시등 = skillStatus, 게임 정보와 1:1`);

  // 줄을 누르면 카메라가 그 장수에게 가고 살펴보기가 뜬다 (2026-10-06 기획자 확정)
  const pick = ord.rows.find((r, i) => i > 0 && r.unit !== ord.rows[0]!.unit)!;
  await page.click(`#order .ord-row[data-unit="${pick.unit}"] .ord-name`);
  await page.waitForTimeout(300);
  const focused = await page.evaluate((id) => {
    const scene = (window as any).__battle.scene;
    return {
      focus: scene.debugOrderFocus as string | null,
      cue: scene.debugCameraCue() as { scale: number; cell: { x: number; y: number } | null },
      pos: scene.debugPlayback.state.units[id].pos as { x: number; y: number },
      popup: (() => {
        const p = document.getElementById('unitpop') as HTMLElement;
        return p.classList.contains('hidden') ? '' : p.dataset.unit ?? '';
      })(),
      ring: !!document.querySelector(`#order .ord-row.focused[data-unit="${id}"]`),
    };
  }, pick.unit);
  if (focused.focus !== pick.unit) fail(`순서 판 줄을 눌렀는데 카메라 대상이 ${focused.focus}이다`);
  if (!focused.cue.cell || focused.cue.cell.x !== focused.pos.x || focused.cue.cell.y !== focused.pos.y) {
    fail(`카메라가 그 장수(${focused.pos.x},${focused.pos.y})를 겨누지 않는다: ${JSON.stringify(focused.cue)}`);
  }
  if (focused.cue.scale <= 1) fail(`줄을 눌렀는데 확대되지 않았다 (scale ${focused.cue.scale})`);
  if (focused.popup !== pick.unit) fail(`줄을 눌렀는데 그 장수의 팝업이 안 떴다 (${focused.popup})`);
  if (!focused.ring) fail('고른 줄에 테가 없다');
  await page.click(`#order .ord-row[data-unit="${pick.unit}"] .ord-name`);
  await page.waitForTimeout(200);
  if (await page.evaluate(() => (window as any).__battle.scene.debugOrderFocus) !== null) {
    fail('같은 줄을 다시 눌러도 카메라 고정이 안 풀린다');
  }
  if (await page.evaluate(() => !document.getElementById('unitpop')!.classList.contains('hidden'))) {
    fail('같은 줄을 다시 눌렀는데 장수 팝업이 남아 있다');
  }
  console.log(`✓ 순서 판 줄 → 카메라 ${pick.unit} (${focused.pos.x},${focused.pos.y}) ×${focused.cue.scale} + 장수 팝업, 다시 누르면 둘 다 풀림`);

  // 표시등을 누르면 고유기술 설명 — 재생 없이 닫기만 (92쪽)
  const lamp = page.locator('#order .ord-skill:not([data-state="none"])').first();
  if (await lamp.count() === 0) fail('표시등이 하나도 없다 — 이 판(seed 3)의 앞 5줄에는 고유기술이 있는 장수가 있다');
  await lamp.click();
  await page.waitForTimeout(150);
  const tip = await page.evaluate(() => ({
    open: !document.getElementById('tip')!.classList.contains('hidden'),
    skill: document.querySelector('#tip .tip-name')?.classList.contains('skill') ?? false,
    focus: (window as any).__battle.scene.debugOrderFocus,
  }));
  if (!tip.open || !tip.skill) fail('표시등을 눌러도 고유기술 설명이 안 뜬다');
  if (tip.focus !== null) fail('표시등을 눌렀는데 카메라까지 움직였다 — 줄 클릭과 겹친다');
  await page.click('#tip .tip-close');
  console.log('✓ 표시등 → 고유기술 설명(닫기만), 카메라는 그대로');
}

// ── 세 칸 무대 (전투 UI 개편 2단계, pptx 89~98쪽) ─────────────
// 위(순서 판 · 게임 정보) / 판 / 아래(명령 판 · 맥락 판). 카드 줄은 걷혔고, 판 위에 떠서
// 판을 가리던 명령 판·배치 판은 아래 칸으로 내려왔다 — **판을 가리는 것이 없는가**를 자리로 잰다.
{
  const stage = await page.evaluate(() => {
    const r = (id: string) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height };
    };
    const inside = (id: string, host: string) => !!document.getElementById(id)?.closest(`#${host}`);
    return {
      top: r('top'), order: r('order'), gameinfo: r('gameinfo'),
      board: r('board'), bottom: r('bottom'), cmd: r('cmd'), ctx: r('ctx'),
      // 맥락 칸의 두 판 — 전투(`#ctx-flow`, 4단계) · 배치(`#ctx-prep`, 5단계). 임시 자리는 이제 없다
      homes: { prep: inside('ctx-prep', 'ctx'), flow: inside('ctx-flow', 'ctx') },
      // 걷은 옛 판 — `#control` · `#dialog`(4단계) · `#prep`(5단계) · `#inspect`(6단계 — 장수 팝업 `#unitpop`)
      gone: ['control', 'dialog', 'prep', 'inspect'].filter((id) => document.getElementById(id)),
      strips: document.querySelectorAll('.strip, .uc, #cards-north, #cards-south').length,
    };
  });
  for (const k of ['top', 'order', 'gameinfo', 'board', 'bottom', 'cmd', 'ctx'] as const) {
    const b = stage[k];
    if (!b || b.w < 10 || b.h < 10) fail(`무대의 #${k} 칸이 서 있지 않다: ${JSON.stringify(b)}`);
  }
  const { top, board, bottom, cmd } = stage as Required<{ [K in keyof typeof stage]: NonNullable<(typeof stage)[K]> }>;
  if (Math.abs(board.w - board.h) > 1) fail(`판이 정사각이 아니다 — ${board.w.toFixed(1)}×${board.h.toFixed(1)}`);
  if (top.bottom > board.top + 1 || board.bottom > bottom.top + 1) {
    fail(`위 · 판 · 아래가 겹친다 — 위 ${top.bottom} / 판 ${board.top}~${board.bottom} / 아래 ${bottom.top}`);
  }
  if (stage.strips > 0) fail(`카드 줄이 남아 있다 (${stage.strips}개)`);
  if (!stage.homes.prep || !stage.homes.flow) fail(`#ctx-prep · #ctx-flow가 #ctx 안에 없다: ${JSON.stringify(stage.homes)}`);
  if (stage.gone.length > 0) fail(`걷은 옛 판이 남아 있다: #${stage.gone.join(', #')}`);
  // 명령 판은 판 밖이어야 한다 — 판과 겹치는 높이가 0
  const overlap = Math.min(cmd.bottom, board.bottom) - Math.max(cmd.top, board.top);
  if (overlap > 1) fail(`명령 판이 판을 가린다 — 겹친 높이 ${overlap.toFixed(1)}px`);
  console.log(`✓ 세 칸 무대 — 위 ${top.h.toFixed(0)} · 판 ${board.w.toFixed(0)}² · 아래 ${bottom.h.toFixed(0)}px, 명령 판은 판 밖`);
}

// ── 시스템 메시지 (pptx 98쪽 · 전투 UI 개편 6단계) ─────────────
// 이벤트 → 문장 변환이 죽으면 여기서 걸린다. 판은 굴러가는데 메시지만 비는 상태다.
// 판 왼쪽 위에 **최대 3줄**, 첫 줄은 [...](전투 기록) — 찍히는 동안 숨는다.
{
  /*
   * **새 줄이 뜰 때까지 기다린다** — 줄은 4초 뒤 사라진다. 턴을 넘긴 뒤 다음 차례가
   * 또 사람이면(2026-09-27 동점 순번으로 seed 3의 순서가 바뀌어 그렇게 됐다) 아무도
   * 행동하지 않아 이동 때 뜬 줄만 사라진 채로 남는다 — 「기록에만 있다」가
   * 거짓으로 걸린다. 사람 차례면 넘겨서 AI가 움직이게 한다.
   *
   * 기다리는 동안 [...]의 두 갈래(대기 줄이 있을 때 숨음 · 다 찍히면 드러남)를 **둘 다 본** 것을 센다 —
   * 한쪽만 보고 통과하면 「늘 숨김」이나 「늘 보임」으로 깨져도 안 잡힌다.
   */
  const until = Date.now() + 20000;
  let seen = ended.log;
  // 동시에 뜬 줄 수는 **페이지 안에서 프레임마다** 잰다 — 밖에서 60ms마다 들여다보면 쌓인 순간을 놓쳐
  // 「최대 1줄」로 나오고, 그러면 「3줄을 넘지 않는다」가 아무것도 확인하지 않는다(실측: 실제로는 대개 3줄이 떠 있다)
  await page.evaluate(() => {
    const w = window as any;
    w.__logMax = 0; w.__logStop = false;
    const tick = () => {
      w.__logMax = Math.max(w.__logMax, document.querySelectorAll('#log .log-line').length);
      if (!w.__logStop) requestAnimationFrame(tick);
    };
    tick();
  });
  let maxShown = 0;
  const moreSeen = { hiddenWhilePending: false, shownWhenDrained: false, shownWhilePending: false };
  const note = (l: typeof seen): void => {
    if (l.pending > 0 && l.more === 'hidden') moreSeen.hiddenWhilePending = true;
    if (l.pending > 0 && l.more === 'shown') moreSeen.shownWhilePending = true;
    if (l.pending === 0 && l.lines.length > 0 && l.more === 'shown') moreSeen.shownWhenDrained = true;
  };
  note(seen);
  while ((seen.lines.length === 0 || maxShown < 2 || !moreSeen.hiddenWhilePending || !moreSeen.shownWhenDrained)
    && Date.now() < until) {
    await endTurnNow();
    // 대기 줄이 생기는 순간을 놓치지 않게 촘촘히 본다 — 한 행동의 말은 1초 남짓에 다 찍힌다
    for (let k = 0; k < 10; k++) {
      await page.waitForTimeout(60);
      seen = (await probe())!.log;
      note(seen);
    }
    maxShown = await page.evaluate(() => (window as any).__logMax as number);
  }
  await page.evaluate(() => { (window as any).__logStop = true; });
  if (seen.lines.length === 0) fail('행동이 있었는데 시스템 메시지가 비어 있다');
  if (maxShown === 0) fail('메시지가 기록에만 있고 화면에 그려지지 않았다');
  // **동시에 최대 3줄** (98쪽) — 넷째 줄이 오면 맨 위가 빠진다
  if (maxShown > 3) fail(`메시지가 ${maxShown}줄 떠 있다 — 동시에 최대 3줄이다`);
  if (maxShown < 2) fail('메시지가 한 줄씩만 떴다 — 쌓이는(밀어 올리는) 모습을 못 봤다');
  if (seen.more === 'none') fail('메시지 자리에 [...]가 없다');
  if (moreSeen.shownWhilePending) fail('[...]가 메시지가 찍히는 동안에도 보인다 — 다 찍힌 뒤에만 드러나야 한다');
  if (!moreSeen.hiddenWhilePending) fail('대기 줄이 있는 순간을 못 봤다 — [...]가 숨는지 확인하지 못했다');
  if (!moreSeen.shownWhenDrained) fail('메시지를 다 찍었는데 [...]가 드러나지 않는다');
  console.log(`✓ 시스템 메시지 ${seen.lines.length}줄 기록 (화면 최대 ${maxShown}줄) · [...]는 찍히는 동안 숨고 다 찍히면 드러남 — "${seen.lines[seen.lines.length - 1]}"`);

  /*
   * **새 줄은 아래에 붙고 위를 밀어 올린다** (98쪽) — 화면의 마지막 줄 = 기록의 마지막 줄.
   * 그리고 자리 — 판 **왼쪽 위**, 자동 포커싱 토글은 판 **왼쪽 아래**(6단계 확정 4)로 갈렸다.
   */
  const box = await page.evaluate(() => {
    const log = document.getElementById('log')!;
    const board = document.getElementById('board')!.getBoundingClientRect();
    const r = log.getBoundingClientRect();
    const lines = [...log.querySelectorAll('.log-line')].map((e) => e.textContent ?? '');
    const focus = document.querySelector('#focus .focus-toggle')!.getBoundingClientRect();
    const more = log.querySelector('.log-more')!;
    return {
      lines,
      left: (r.left - board.left) / board.width,
      top: (r.top - board.top) / board.height,
      // 첫 줄이 [...]다 — 메시지 줄들보다 위
      moreFirst: log.firstElementChild === more,
      focusLeft: (focus.left - board.left) / board.width,
      focusBottom: (board.bottom - focus.bottom) / board.height,
      overlap: !(r.bottom <= focus.top || r.top >= focus.bottom || r.right <= focus.left || r.left >= focus.right),
      passes: getComputedStyle(log).pointerEvents === 'none',
      moreClicks: getComputedStyle(more).pointerEvents !== 'none',
    };
  });
  const last = (await probe())!.log.lines;
  if (box.lines.length > 0 && box.lines[box.lines.length - 1] !== last[last.length - 1]) {
    fail(`화면의 마지막 줄이 기록의 마지막 줄이 아니다 — 새 줄은 아래에 붙는다 ("${box.lines.at(-1)}" vs "${last.at(-1)}")`);
  }
  if (box.left > 0.06 || box.top > 0.08) fail(`메시지가 판 왼쪽 위에 있지 않다 (left ${box.left.toFixed(3)}, top ${box.top.toFixed(3)})`);
  if (!box.moreFirst) fail('[...]가 메시지 자리의 첫 줄이 아니다');
  if (box.focusLeft > 0.06 || box.focusBottom > 0.08) {
    fail(`자동 포커싱 토글이 판 왼쪽 아래에 있지 않다 (left ${box.focusLeft.toFixed(3)}, bottom ${box.focusBottom.toFixed(3)})`);
  }
  if (box.overlap) fail('메시지가 자동 포커싱 토글과 겹친다');
  if (!box.passes) fail('메시지가 판 클릭을 삼킨다 — pointer-events가 none이어야 한다');
  if (!box.moreClicks) fail('[...]가 눌리지 않는다');
  console.log('✓ 메시지는 판 왼쪽 위(첫 줄 [...]) · 새 줄은 아래 · 토글은 왼쪽 아래 · 클릭은 통과');

  // [...]를 누르면 전투 기록이 펼쳐진다. [항복]은 게임 정보로 나갔다 (설계 확정 7)
  await page.waitForFunction(() => {
    const b = document.querySelector('#log .log-more');
    return !!b && !b.classList.contains('hidden');
  }, null, { timeout: 15000 }).catch(() => fail('[...]가 드러나지 않아 누를 수 없다'));
  await page.click('#log .log-more');
  await page.waitForTimeout(200);
  const hist = await page.evaluate(() => ({
    open: document.getElementById('history')?.classList.contains('hidden') === false,
    lines: document.querySelectorAll('#history .hist-line').length,
    surrender: !!document.querySelector('#history .hist-surrender'),
  }));
  if (!hist.open) fail('[...]를 눌러도 전투 기록이 열리지 않는다');
  if (hist.surrender) fail('전투 기록에 「항복」이 남아 있다 — 게임 정보로 옮겼다');
  await page.click('#history .hist-close');
  await page.waitForTimeout(150);
  if (await page.evaluate(() => !document.getElementById('history')?.classList.contains('hidden'))) {
    fail('전투 기록이 닫히지 않는다');
  }
  console.log(`✓ [...] → 전투 기록 — ${hist.lines}줄 (항복은 게임 정보로), 열고 닫기`);
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
  await endTurnNow();
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

let mineSnap = await wait('awaitingInput');
if (mineSnap?.phase !== 'awaitingInput') fail('내 차례가 다시 오지 않았다');
// 고유기술을 쓸 수 있으면 물음이 먼저다 — 여기서는 넘긴다(물음 자체는 아래 「고유기술 물음」이 본다)
if (mineSnap.ctx.view === 'ask') { await pressCtx('skipUnique'); mineSnap = (await probe())!; }

if (mineSnap.cmd.view !== 'commands') fail(`내 차례인데 명령 판이 여섯 칸이 아니다 (${mineSnap.cmd.view})`);
for (const action of SIX) {
  if (!mineSnap.cmd.shown.some((s) => s.startsWith(action))) fail(`「${action}」 칸이 없다`);
}
// 켜짐은 엔진이 정한다 — [공격]만 「열 수 있는가」(대상이 없어도 열린다, 확정 1)
if (!mineSnap.cmd.shown.includes('attack+')) fail('[공격]이 꺼져 있다 — 대상이 없어도 열려야 한다(사거리 보기)');
if ((await probe())!.hud.act !== 'surrender+') fail('내 차례인데 게임 정보 단추가 [항복]이 아니다');
console.log(`✓ 명령 판(내 차례) — [${mineSnap.cmd.shown.join(' ')}]`);

// ── 아래 칸 자리와 크기 (전투 UI 개편 4단계) ─────────────────
// 명령 판 · 맥락 판은 판 밖(아래 칸)이다 — 여섯 칸이 #cmd 안에 다 들어가는가, 맥락 판이 #ctx를 넘지 않는가.
{
  await pressCmd('move');           // 맥락 판에 무언가 떠 있게 한다
  const geom = await page.evaluate(() => {
    const cmd = document.getElementById('cmd')!.getBoundingClientRect();
    const ctx = document.getElementById('ctx')!.getBoundingClientRect();
    const flow = document.getElementById('ctx-flow')!.getBoundingClientRect();
    const btns = [...document.querySelectorAll('#cmd .cmd-grid button')].map((b) => b.getBoundingClientRect());
    const board = document.getElementById('board')!.getBoundingClientRect();
    return {
      cmd: { top: cmd.top, bottom: cmd.bottom, left: cmd.left, right: cmd.right },
      ctx: { bottom: ctx.bottom, right: ctx.right },
      flow: { w: flow.width, h: flow.height, bottom: flow.bottom, right: flow.right },
      btns: btns.map((r) => ({ top: r.top, bottom: r.bottom, h: r.height, left: r.left, right: r.right })),
      boardBottom: board.bottom,
    };
  });
  for (const b of geom.btns) {
    if (b.top < geom.cmd.top || b.bottom > geom.cmd.bottom + 1 || b.right > geom.cmd.right + 1) {
      fail('명령 칸이 #cmd 밖으로 넘친다');
    }
    if (b.h < 28) fail(`명령 칸이 너무 낮다 (${b.h.toFixed(0)}px) — 손가락이 닿을 크기가 아니다`);
  }
  if (geom.cmd.top < geom.boardBottom - 1) fail('명령 판이 판 위로 올라와 판을 가린다');
  if (geom.flow.h < 20 || geom.flow.bottom > geom.ctx.bottom + 1 || geom.flow.right > geom.ctx.right + 1) {
    fail(`맥락 판이 #ctx를 채우지 않거나 넘친다 (${geom.flow.w.toFixed(0)}×${geom.flow.h.toFixed(0)})`);
  }
  await pressCtx('cancel');
  console.log(`✓ 아래 칸 — 여섯 칸 ${geom.btns[0]!.h.toFixed(0)}px 높이로 #cmd 안 · 맥락 판 #ctx 안 · 판을 가리지 않음`);
}

// ── 카메라 (pptx 28쪽) ───────────────────────────────────────
// 「내 캐릭터의 차례가 되어 포커스를 받았을 때」 200%로 제어권 기물을 비춘다.
{
  const now = (await probe())!;
  if (now.camera.scale <= 1) fail(`내 차례인데 확대되지 않았다 (${now.camera.scale}배)`);
  if (now.camera.cell?.x !== now.pos!.x || now.camera.cell?.y !== now.pos!.y) {
    fail(`카메라가 제어권 기물을 겨누지 않는다 — 카메라 ${JSON.stringify(now.camera.cell)}, 기물 ${JSON.stringify(now.pos)}`);
  }
  await settle();
  const zoom = await page.evaluate(() => {
    const sc = (window as any).__battle.scene;
    return { now: sc.cameras.main.zoom as number, w: sc.scale.width as number };
  });
  // 100% = 판 전체가 들어가는 배율(2026-08-12 확정). 포커스 배율은 기획자가 눈으로
  // 조정하는 값이라 숫자를 박지 않고 `debugCameraCue().scale`을 곱해 검증한다.
  const want = (zoom.w / 2400) * now.camera.scale;
  if (Math.abs(zoom.now - want) > 1e-3) {
    fail(`실제 줌이 큐(${now.camera.scale}배)와 다르다 (${zoom.now.toFixed(4)} vs ${want.toFixed(4)})`);
  }
  console.log(`✓ 카메라 — 내 차례 ${now.camera.scale * 100}% 포커스 (${now.camera.cell!.x},${now.camera.cell!.y}), 줌 ${zoom.now.toFixed(3)}`);
}

/*
 * 자동 포커싱 토글 (2026-08-12 기획자 지정).
 *
 * 화면을 한 번 건드리면 수동 모드로 넘어가 자동 포커싱이 멎는데, **되돌릴 길이 눈에
 * 보이지 않았다** — 「그 뒤로 줌인이 안 된다」로만 나타났다. 글자는 「상태」가 아니라
 * **「누르면 되는 것」**이다: 수동이면 `자동 포커싱 ON`, 자동이면 `자동 포커싱 OFF`.
 */
{
  const read = () => page.evaluate(() => ({
    label: document.querySelector('#focus .focus-toggle')?.textContent ?? '',
    state: (document.querySelector('#focus .focus-toggle') as HTMLElement)?.dataset.state ?? '',
    manual: (window as any).__battle.scene.debugManualCamera as boolean,
  }));
  const tap = async () => {
    await page.click('#focus button[data-action="toggleFocus"]');
    await page.waitForTimeout(200);
    return read();
  };

  const auto = await read();
  if (auto.manual || auto.state !== 'auto' || auto.label !== '자동 포커싱 OFF') {
    fail(`자동 상태의 토글이 이상하다: "${auto.label}" (${auto.state}, manual=${auto.manual})`);
  }
  // 끄면 수동으로 넘어가고 글자가 「ON」(= 되돌리는 길)으로 바뀐다
  const manual = await tap();
  if (!manual.manual || manual.state !== 'manual' || manual.label !== '자동 포커싱 ON') {
    fail(`수동 상태의 토글이 이상하다: "${manual.label}" (${manual.state}, manual=${manual.manual})`);
  }
  // 다시 켜면 자동으로 돌아온다
  const back = await tap();
  if (back.manual || back.state !== 'auto') {
    fail(`「자동 포커싱 ON」을 눌러도 자동으로 돌아오지 않는다 (manual=${back.manual})`);
  }
  console.log('✓ 자동 포커싱 토글 — OFF → 수동 → ON → 자동');
}

/*
 * [공격]을 눌러야 공격 범위가 뜬다 (2026-08-12 확정) — **대상이 없어도 열린다** (2026-10-06 확정 1).
 *
 * 누르기 전에는 칠할 것이 없고, 누르면 사거리와 대상만 남는다. 대상이 없으면 맥락 판이 「없다」를 말하고
 * [취소] 하나다. 대상을 고르면 **확인창**(95쪽 — 데미지 · 치명타)이 뜬다. 숫자는 엔진의 `forecastAttack()`이다.
 */
{
  const before = await page.evaluate(() =>
    (window as any).__battle.scene.debugChoosableCells() as { x: number; y: number }[]);
  if (before.length > 0) {
    fail(`명령 선택인데 아무것도 안 눌렀는데 고를 칸이 ${before.length}개 있다`);
  }
  await pressCmd('attack');
  const armed = await page.evaluate(() => ({
    mode: (window as any).__battle.scene.debugActionMode as string,
    cells: (window as any).__battle.scene.debugChoosableCells() as { x: number; y: number }[],
    marks: (window as any).__battle.scene.debugMarkCommands() as number,
  }));
  if (armed.mode !== 'attack') fail('「공격」을 눌러도 모드가 켜지지 않는다');
  // 대상이 없어도 **사거리는 보여야 한다** — 그게 「공격」을 항상 열어 둔 이유다
  if (armed.marks === 0) fail('「공격」을 눌렀는데 판에 아무것도 칠해지지 않았다');
  console.log(`✓ 「공격」 → 공격 범위 표시 (대상 후보 ${armed.cells.length}칸)`);

  // 공격 중에도 **포커스가 그 기물에 머문다** (2026-08-12 기획자 지정) —
  // 공격 대상은 언제나 가까운 칸이라 확대한 채로도 다 보인다
  const camIn = (await probe())!;
  if (camIn.camera.scale <= 1) fail('「공격」을 눌렀더니 화면이 판 전체로 물러났다');
  if (camIn.ctx.view !== 'attack') fail(`[공격] 뒤 맥락 판이 ${camIn.ctx.view}다`);
  console.log(`✓ 「공격」 중에도 포커스 유지 (${camIn.camera.scale * 100}%)`);

  if (armed.cells.length === 0) {
    if (camIn.ctx.kind !== 'none') fail('적이 없는데 맥락 판이 「공격할 대상이 없다」를 말하지 않는다');
    await pressCtx('cancel');
    if ((await probe())!.flow !== 'menu') fail('[취소]를 눌러도 명령 선택으로 돌아오지 않는다');
    console.log('✓ 공격 범위에 적이 없음 → 맥락 판 「없습니다」 + [취소] → 명령 선택');
  } else {
    await checkAttackConfirm(armed.cells);
  }
}

// 상대 차례는 AI가 350ms만에 두고 지나가서 밖에서 폴링하면 놓친다.
// 프레임마다 들여다보며 상대 차례의 첫 프레임과, 상대가 대상을 겨눈 순간을 떠 온다.
const catchOpponent = (ms: number) => page.evaluate((limit) => new Promise<{
  first: { cmd: string; card: string; ctx: string; actor: string; shown: number; take: string };
  aimed: { card: string; aimedAt: string; cmd: string } | null;
} | null>((resolve) => {
  const scene = (window as any).__battle.scene;
  const t0 = performance.now();
  let first: any = null;
  let aimed: any = null;
  const read = () => ({
    cmd: (document.getElementById('cmd') as HTMLElement).dataset.view ?? '',
    card: (document.querySelector('#cmd .oc') as HTMLElement)?.dataset.unit ?? '',
    ctx: (document.getElementById('ctx-flow') as HTMLElement).dataset.view ?? '',
    ctxCard: (document.querySelector('#ctx-flow .oc') as HTMLElement)?.dataset.unit ?? '',
  });
  const tick = (): void => {
    const thinking = scene.debugPlayback.phase === 'aiThinking';
    if (thinking && !first) {
      const r = read();
      first = {
        ...r, actor: scene.debugPlayback.state.activeUnit ?? '',
        shown: document.querySelectorAll('#cmd .cmd-grid button').length,
        // 「턴 넘기기」는 게임 정보의 [턴 가져오기]로 갔다 (3단계) — **같은 프레임에** 읽는다
        take: (() => {
          const b = document.querySelector('#gameinfo .gi-act') as HTMLButtonElement | null;
          return b ? `${b.dataset.action}${b.disabled ? '-' : '+'}` : '';
        })(),
      };
    }
    if (thinking && first && !aimed && scene.debugAimedAt) {
      const r = read();
      if (r.ctx === 'target') aimed = { card: r.ctxCard, aimedAt: scene.debugAimedAt, cmd: r.card };
    }
    if (first && (!thinking || aimed)) { resolve({ first, aimed }); return; }
    if (performance.now() - t0 < limit) requestAnimationFrame(tick);
    else resolve(first ? { first, aimed } : null);
  };
  requestAnimationFrame(tick);
}), ms);

// 내 차례면 넘겨서 상대 차례가 오게 만든다. 상대가 장수를 겨누는 차례가 올 때까지 몇 번 돈다
{
  let seenFirst = false;
  let seenAimed = false;
  for (let attempt = 0; attempt < 10 && !(seenFirst && seenAimed); attempt++) {
    await endTurnNow();
    const away = await catchOpponent(5000);
    if (!away) continue;
    const f = away.first;
    if (!seenFirst) {
      // 왼쪽 = 지금 차례인 적 장수 카드 (97쪽) · 오른쪽 = 대상을 고르기 전 **비어 있음** (2026-09-27 확정)
      if (f.cmd !== 'card' || f.card !== f.actor) fail(`상대 차례 명령 판이 그 적의 카드가 아니다 (${f.cmd}, ${f.card} vs ${f.actor})`);
      if (f.shown > 0) fail('상대 차례에 명령 칸이 보인다');
      if (f.ctx !== 'empty') fail(`상대가 대상을 고르기 전인데 맥락 판이 ${f.ctx}다`);
      // AI 대전에는 제어 마감이 없다 — [턴 가져오기]는 꺼져 있어야 한다 (확정 8)
      if (f.take !== 'takeTurn-') fail(`AI 대전 상대 차례인데 게임 정보 단추가 [${f.take}]이다`);
      console.log(`✓ 상대 차례 — 명령 판 = ${f.actor}의 카드 · 맥락 판 비어 있음 · 게임 정보 [${f.take}]`);
      seenFirst = true;
    }
    if (away.aimed) {
      // 오른쪽 = 적이 겨눈 장수의 카드 (97쪽) — 엔진 이벤트의 대상에서 왔다. 왼쪽 카드는 연출 내내 남는다
      if (away.aimed.card !== away.aimed.aimedAt) fail(`맥락 판 카드(${away.aimed.card})가 겨눈 장수(${away.aimed.aimedAt})가 아니다`);
      if (!away.aimed.cmd) fail('적이 행동하는 동안 왼쪽 카드가 사라졌다 — 엔진이 차례를 끝내도 연출 동안은 남아야 한다');
      console.log(`✓ 상대가 겨눔 — 맥락 판 = ${away.aimed.card}의 카드 · 왼쪽 ${away.aimed.cmd} 그대로`);
      seenAimed = true;
    }
  }
  if (!seenFirst) fail('상대 차례를 잡지 못했다');
  if (!seenAimed) fail('상대가 장수를 겨누는 차례를 10번 안에 못 봤다 — 대상 카드 검사가 안 돈다');
}

// ── 게임 정보의 [항복] (전투 UI 개편 3단계 — 기록 안에서 옮겨 왔다) ──
// **내 차례를 기다린 뒤에** 누른다 — 그 밖의 때는 꺼져 있다(예전엔 눌려도 조용히 버려졌다).
{
  const mine = await wait('awaitingInput');
  if (mine?.phase !== 'awaitingInput') fail('[항복]을 누를 내 차례가 오지 않았다');
  if (mine!.hud.act !== 'surrender+') fail(`내 차례인데 [항복]이 켜져 있지 않다: [${mine!.hud.act}]`);
  page.once('dialog', (d) => { void d.accept(); });     // 되돌릴 수 없어 한 번 더 묻는다
  await page.click('#gameinfo .gi-act[data-action="surrender"]');
  await page.waitForTimeout(500);
  const gave = await page.evaluate(() => {
    const st = (window as any).__battle.scene.debugPlayback.state;
    return { phase: st.phase as string, winner: st.winner as string | null, outcome: st.outcome as string };
  });
  if (gave.phase !== 'finished' || gave.winner !== 'P2') fail(`[항복]이 판을 끝내지 않았다: ${JSON.stringify(gave)}`);
  console.log(`✓ 게임 정보 [항복] → 판 끝 (${gave.outcome}, 승자 ${gave.winner})`);
}

// ── 배치 중의 위 칸 (pptx 90쪽 · 전투 UI 개편 3단계) ───────────
// 배치 · 정찰 중엔 순서 판이 위 칸 전체를 쓰고(두 열 1~5 · 6~10) 게임 정보가 숨는다.
// 주사위가 도는 동안 동점 줄이 반짝인다 (2026-10-06 기획자 확정). seed 1 · 3v3에 동점이 있다.
// 데모는 기본 배치로 곧장 전투에 들어가므로 `?deploy=1`로 배치 단계부터 연다.
{
  // 주사위(약 5.4초)가 `networkidle`보다 먼저 끝날 수 있다 — 문서가 서자마자 지켜본다
  await page.goto(`${BASE}/?demo=1&seed=1&mode=3v3&side=P1&deploy=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__battle?.scene?.debugDice?.active === true, null, { timeout: 15_000 });
  const dep = await page.evaluate(() => {
    const scene = (window as any).__battle.scene;
    const st = scene.debugPlayback.state;
    const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const wt = new Map<number, number>();
    for (const u of Object.values(st.units) as { wt: number }[]) wt.set(u.wt, (wt.get(u.wt) ?? 0) + 1);
    return {
      phase: scene.debugPlayback.phase as string,
      rows: scene.debugOrder() as { unit: string }[],
      alive: (Object.values(st.units) as { alive: boolean }[]).filter((u) => u.alive).length,
      mode: (document.getElementById('top') as HTMLElement).dataset.mode,
      infoShown: getComputedStyle(document.getElementById('gameinfo')!).display !== 'none',
      orderW: r('#order').width, topW: r('#top').width,
      // 두 열 — 6번째 줄이 1번째 줄의 오른쪽에 선다
      twoCols: (() => {
        const rows = document.querySelectorAll('#order .ord-row');
        return rows.length > 5 && rows[5]!.getBoundingClientRect().left > rows[0]!.getBoundingClientRect().right;
      })(),
      flash: [...document.querySelectorAll('#order .ord-row.flash')].map((e) => (e as HTMLElement).dataset.unit),
      tied: [...wt.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0),
      state: st,
    };
  });
  if (dep.phase !== 'deploying') fail(`?deploy=1인데 배치 단계가 아니다: ${dep.phase}`);
  if (dep.rows.length !== dep.alive) fail(`배치 중 순서 판이 ${dep.rows.length}줄 — 전원(${dep.alive})이어야 한다`);
  if (dep.rows.map((r) => r.unit).join(',') !== turnForecast(dep.state, dep.alive).map((w) => w.unit).join(',')) {
    fail('배치 중 순서 판이 엔진 예보와 다르다');
  }
  if (dep.mode !== 'deploy' || dep.infoShown) fail(`배치 중인데 게임 정보가 보인다 (mode ${dep.mode})`);
  if (dep.orderW < dep.topW * 0.9) fail(`배치 중 순서 판이 위 칸 전체를 안 쓴다 (${dep.orderW} / ${dep.topW})`);
  if (!dep.twoCols) fail('배치 중 순서 판이 두 열(1~5 · 6~10)이 아니다');
  if (dep.tied === 0) fail('seed 1에 동점이 없다 — 반짝임 검사가 돌지 않는다');
  if (dep.flash.length !== dep.tied) fail(`주사위가 도는데 반짝이는 줄이 ${dep.flash.length}개 — 동점은 ${dep.tied}명`);
  await page.waitForFunction(() => (window as any).__battle.scene.debugDice.active === false, null, { timeout: 15_000 });
  await page.waitForTimeout(100);
  if (await page.locator('#order .ord-row.flash').count() > 0) fail('주사위가 끝났는데 줄이 계속 반짝인다');
  console.log(`✓ 배치 중 위 칸 — 순서 판 ${dep.rows.length}줄(두 열, 위 칸 전체) · 게임 정보 숨김 · 주사위 중 동점 ${dep.tied}줄 반짝임`);
}

// ── 배치 중의 아래 칸 (pptx 90·91쪽 · 전투 UI 개편 5단계) ───────
// 왼쪽 = 고유기술 목록(두 열 = 진영, 2026-10-06 기획자 확정), 오른쪽 = 배치 N초 · [준비완료] · [책략 확인].
// [책략 확인]의 켜짐은 엔진의 `tacticsRevealed` — **내 편에 척후기가 있는가**(기획자 확정). 꺼진 갈래와 켜진 갈래를
// **둘 다** 지난다 — 켜진 갈래는 `?items=cheok-hu-gi`(남군 전원이 척후기)로 닿는다(「닿을 수 없는 갈래」를 안 만든다).
/** 엔진의 답 — 화면의 [책략 확인] 켜짐과 맞춘다(받은 유닛에 지참물 `held`가 실려 있다) */
const revealedTo = (units: { id: string }[]): boolean =>
  tacticsRevealed({ units: Object.fromEntries(units.map((u) => [u.id, u])) } as never, 'P1');
/** 배치 중 아래 칸을 읽는다 — 줄 · 단추 · 팝업을 `data-*`로 */
const prepProbe = () => page.evaluate(() => {
  const scene = (window as any).__battle.scene;
  const st = scene.debugPlayback.state;
  const cmd = document.getElementById('cmd')!.getBoundingClientRect();
  const btn = (a: string) => document.querySelector(`#ctx-prep button[data-action="${a}"]`) as HTMLButtonElement | null;
  return {
    phase: scene.debugPlayback.phase as string,
    units: Object.values(st.units) as { id: string; side: string; officer: string; tactics: string[] }[],
    cmdView: (document.getElementById('cmd') as HTMLElement).dataset.view ?? '',
    cols: [...document.querySelectorAll('#cmd .sk-col')].map((c) => ({
      side: (c as HTMLElement).dataset.side ?? '',
      rows: [...c.querySelectorAll('.sk-row')].map((r) => {
        const b = r.getBoundingClientRect();
        return {
          unit: (r as HTMLElement).dataset.unit ?? '', skill: (r as HTMLElement).dataset.skill ?? '',
          off: (r as HTMLButtonElement).disabled,
          // 줄이 명령 칸 안에 다 들어오는가 — 700px에서 5번째 줄이 잘렸던 자리
          inside: b.top >= cmd.top - 1 && b.bottom <= cmd.bottom + 1 && b.height > 12,
        };
      }),
    })),
    prepPhase: (document.getElementById('ctx-prep') as HTMLElement).dataset.phase ?? '',
    prepShown: getComputedStyle(document.getElementById('ctx-prep')!).display !== 'none',
    flowShown: getComputedStyle(document.getElementById('ctx-flow')!).display !== 'none',
    go: btn('ready') ? { a: 'ready', off: btn('ready')!.disabled } : btn('begin') ? { a: 'begin', off: btn('begin')!.disabled } : null,
    intel: btn('intel') ? { off: btn('intel')!.disabled, why: btn('intel')!.title } : null,
    intelOpen: !document.getElementById('intel')!.classList.contains('hidden'),
    intelRows: [...document.querySelectorAll('#intel .intel-tactics')].map((e) => ({
      unit: (e as HTMLElement).dataset.unit ?? '',
      tactics: [...e.querySelectorAll('.chip')].map((c) => (c as HTMLElement).dataset.tactic ?? ''),
      none: !!e.querySelector('.intel-none'),
    })),
  };
});
{
  // 위 칸 검사가 연 판(seed 1 · 3v3 · 척후기 없음) 그대로 — 주사위는 이미 걷혔다
  const p = await prepProbe();
  if (p.cmdView !== 'skills') fail(`배치 중 명령 판이 고유기술 목록이 아니다 (data-view=${p.cmdView})`);
  if (p.cols.map((c) => c.side).join(',') !== 'mine,foe') fail(`고유기술 목록의 두 열이 아군 · 적군이 아니다: ${p.cols.map((c) => c.side)}`);
  for (const [i, side] of (['P1', 'P2'] as const).entries()) {
    const want = p.units.filter((u) => u.side === side);
    const rows = p.cols[i]!.rows;
    if (rows.map((r) => r.unit).sort().join(',') !== want.map((u) => u.id).sort().join(',')) {
      fail(`${side} 열의 줄이 그 진영 전원이 아니다: ${rows.map((r) => r.unit)}`);
    }
    for (const r of rows) {
      const skill = combatantById.get(want.find((u) => u.id === r.unit)!.officer)?.uniqueSkill ?? '';
      if (r.skill !== skill) fail(`${r.unit}의 고유기술 줄이 데이터와 다르다: ${r.skill} ≠ ${skill}`);
      if (r.off !== !skill) fail(`${r.unit} — 고유기술이 ${skill ? '있는데 꺼져' : '없는데 켜져'} 있다`);
      if (!r.inside) fail(`${r.unit}의 줄이 명령 칸 밖으로 넘친다`);
    }
  }
  // 줄 → 고유기술 설명 (재생 없이 닫기만)
  const withSkill = p.cols.flatMap((c) => c.rows).find((r) => !r.off);
  if (!withSkill) fail('seed 1 · 3v3에 고유기술 있는 장수가 없다 — 설명 검사가 돌지 않는다');
  await page.click(`#cmd .sk-row[data-unit="${withSkill!.unit}"]`);
  const tipOk = await page.evaluate(() => !document.getElementById('tip')!.classList.contains('hidden')
    && !!document.querySelector('#tip .tip-name.skill'));
  if (!tipOk) fail('고유기술 목록의 줄을 눌렀는데 고유기술 설명이 안 뜬다');
  await page.click('#tip .tip-close');

  // 오른쪽 — 배치 판. 전투 판(#ctx-flow)은 숨는다
  if (p.prepPhase !== 'deploying' || !p.prepShown || p.flowShown) {
    fail(`배치 중 맥락 칸이 배치 판이 아니다 (phase ${p.prepPhase} · prep ${p.prepShown} · flow ${p.flowShown})`);
  }
  if (p.go?.a !== 'ready' || p.go.off) fail(`[준비완료]가 없거나 꺼져 있다: ${JSON.stringify(p.go)}`);
  // 척후기가 없다 → 꺼짐 + 꺼진 이유. 엔진의 답과 같아야 한다
  const blind = revealedTo(p.units);
  if (blind || !p.intel || !p.intel.off) fail(`척후기가 없는데 [책략 확인]이 켜져 있다 (엔진 ${blind} · ${JSON.stringify(p.intel)})`);
  if (!p.intel.why) fail('[책략 확인]이 꺼진 이유(title)를 안 적는다');
  console.log(`✓ 배치 아래 칸 — 고유기술 ${p.cols.map((c) => `${c.side} ${c.rows.length}줄`).join(' · ')} (데이터와 일치 · 칸 안) → 설명 · [준비완료] · [책략 확인] 꺼짐(척후기 없음)`);
}

// ── 배치 중 장수를 누르면 (pptx 90쪽 · 전투 UI 개편 6단계) ─────
// 아군 = **금테(옮기기 선택)와 장수 팝업이 함께**. 같은 아군 다시 → 둘 다 꺼짐 · 진영 안 빈 칸 → 옮기고 둘 다 꺼짐.
// 적 = 팝업만(금테는 그대로). 카메라는 배치 내내 판 전체다(6단계 확정 3 — 옮길 자리가 진영 끝까지 퍼진다).
{
  const dsc = () => page.evaluate(() => {
    const sc = (window as any).__battle.scene;
    const p = document.getElementById('unitpop') as HTMLElement;
    return { deploying: sc.debugDeploying as string | null, popup: p.classList.contains('hidden') ? '' : p.dataset.unit ?? '',
      cue: sc.debugCameraCue() as { scale: number } };
  });
  const units = await page.evaluate(() => Object.values((window as any).__battle.scene.debugPlayback.state.units as Record<string, any>)
    .map((u: any) => ({ id: u.id as string, side: u.side as string, x: u.pos.x as number, y: u.pos.y as number })));
  const mine = units.find((u) => u.side === 'P1')!;
  const foe = units.find((u) => u.side === 'P2')!;
  await clickCell(mine);
  await page.waitForTimeout(150);
  let d = await dsc();
  if (d.deploying !== mine.id || d.popup !== mine.id) fail(`배치 중 아군을 눌렀는데 금테 · 팝업이 함께 안 선다: ${JSON.stringify(d)}`);
  if (d.cue.scale !== 1) fail(`배치 중 팝업을 열었는데 카메라가 확대됐다 (×${d.cue.scale}) — 배치 내내 판 전체다`);
  // 적을 누르면 적 팝업 — 금테는 남는다
  await clickCell(foe);
  await page.waitForTimeout(150);
  d = await dsc();
  if (d.popup !== foe.id || d.deploying !== mine.id) fail(`배치 중 적을 눌렀는데 적 팝업 + 금테 유지가 아니다: ${JSON.stringify(d)}`);
  // 같은 아군을 두 번 → 고르고, 다시 누르면 둘 다 꺼진다
  await clickCell(mine);
  await page.waitForTimeout(150);
  d = await dsc();
  if (d.deploying !== null || d.popup !== '') fail(`고른 아군을 다시 눌렀는데 금테 · 팝업이 안 꺼진다: ${JSON.stringify(d)}`);
  await clickCell(mine);
  await page.waitForTimeout(150);
  // 진영 안 빈 칸으로 옮기면 둘 다 꺼진다 — 내 진영(아래 5행)에서 빈 칸을 고른다
  const dest = await page.evaluate((id) => {
    const st = (window as any).__battle.scene.debugPlayback.state;
    const u = st.units[id];
    const taken = new Set(Object.values(st.units as Record<string, any>).map((x: any) => `${x.pos.x},${x.pos.y}`));
    for (const [dx, dy] of [[1, 0], [-1, 0], [2, 0], [-2, 0], [0, 1], [0, -1]]) {
      const x = u.pos.x + dx!, y = u.pos.y + dy!;
      if (x >= 0 && x < st.boardSize.x && y >= st.boardSize.y - 5 && y < st.boardSize.y && !taken.has(`${x},${y}`)) return { x, y };
    }
    return null;
  }, mine.id);
  if (!dest) fail('옮겨 볼 빈 칸이 진영 안에 없다');
  await clickCell(dest!);
  await page.waitForTimeout(250);
  d = await dsc();
  const moved = await page.evaluate((id) => (window as any).__battle.scene.debugPlayback.state.units[id].pos, mine.id);
  if (moved.x !== dest!.x || moved.y !== dest!.y) fail(`빈 칸을 눌렀는데 옮겨지지 않았다 (${moved.x},${moved.y})`);
  if (d.deploying !== null || d.popup !== '') fail(`옮긴 뒤에도 금테 · 팝업이 남아 있다: ${JSON.stringify(d)}`);
  console.log(`✓ 배치 중 아군 → 금테 + 장수 팝업(카메라는 판 전체) · 적 → 적 팝업(금테 유지) · 다시 → 둘 다 꺼짐 · 빈 칸 → 옮기고 둘 다 꺼짐`);
}
{
  // 켜진 갈래 — 남군 전원이 척후기. 5v5라야 「다섯 줄이 칸 안에 드는가」도 본다.
  // `late=3000` — 상대가 내 [준비완료] 3초 뒤에 준비한다. 대기(`waiting`)는 온라인 두 탭으로만 닿던 갈래다(8단계)
  await page.goto(`${BASE}/?demo=1&seed=1&mode=5v5&side=P1&deploy=1&late=3000&items=cheok-hu-gi`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'deploying', null, { timeout: 15_000 });
  let p = await prepProbe();
  if (p.cols.some((c) => c.rows.length !== 5 || c.rows.some((r) => !r.inside))) {
    fail(`5v5 고유기술 목록이 진영마다 다섯 줄로 칸 안에 안 든다: ${JSON.stringify(p.cols.map((c) => c.rows.map((r) => r.inside)))}`);
  }
  if (!revealedTo(p.units) || !p.intel || p.intel.off) fail(`척후기를 들었는데 [책략 확인]이 꺼져 있다: ${JSON.stringify(p.intel)}`);
  await page.click('#ctx-prep button[data-action="intel"]');
  p = await prepProbe();
  const foes = p.units.filter((u) => u.side === 'P2');
  if (!p.intelOpen) fail('[책략 확인]을 눌렀는데 적 책략 팝업이 안 뜬다');
  if (p.intelRows.map((r) => r.unit).sort().join(',') !== foes.map((u) => u.id).sort().join(',')) {
    fail(`적 책략 팝업의 줄이 적 전원이 아니다: ${p.intelRows.map((r) => r.unit)}`);
  }
  for (const r of p.intelRows) {
    const want = foes.find((u) => u.id === r.unit)!.tactics;
    if (r.tactics.join(',') !== want.join(',')) fail(`${r.unit}의 책략 칩이 상태와 다르다: ${r.tactics} ≠ ${want}`);
    if (r.none !== (want.length === 0)) fail(`${r.unit} — 「없음」 표시가 어긋난다`);
  }
  if (p.intelRows.every((r) => r.tactics.length === 0)) fail('적이 책략을 하나도 안 들었다 — 칩 → 설명 검사가 돌지 않는다');
  // 책략을 누르면 설명 팝업이 그 위에 하나 더 (91쪽)
  await page.click('#intel .intel-tactics .chip');
  const tacticTip = await page.evaluate(() => ({
    tip: !document.getElementById('tip')!.classList.contains('hidden') && !!document.querySelector('#tip .tip-name.tactic'),
    intel: !document.getElementById('intel')!.classList.contains('hidden'),
  }));
  if (!tacticTip.tip || !tacticTip.intel) fail(`책략 칩 → 설명 팝업이 팝업 위에 안 뜬다: ${JSON.stringify(tacticTip)}`);
  await page.click('#tip .tip-close');
  await page.click('#intel .intel-close');
  if ((await prepProbe()).intelOpen) fail('적 책략 팝업이 × 로 안 닫힌다');
  // **판 아무 데나 누르면 닫힌다** (6단계 확정 5) — 팝업이 판 대부분을 덮으므로 그 밖으로 드러난 판 칸을 누른다
  await page.click('#ctx-prep button[data-action="intel"]');
  if (!(await prepProbe()).intelOpen) fail('[책략 확인]을 다시 눌렀는데 팝업이 안 뜬다');
  const bare = await page.evaluate(() => {
    const sc = (window as any).__battle.scene;
    const st = sc.debugPlayback.state;
    const rect = (sc.game.canvas as HTMLCanvasElement).getBoundingClientRect();
    const v = sc.cameras.main.worldView;
    const taken = new Set(Object.values(st.units as Record<string, any>).map((x: any) => `${x.pos.x},${x.pos.y}`));
    for (let y = st.boardSize.y - 1; y >= 0; y--) {
      for (let x = 0; x < st.boardSize.x; x++) {
        if (taken.has(`${x},${y}`)) continue;
        const px = rect.left + ((x * 96 + 48 - v.x) / v.width) * rect.width;
        const py = rect.top + ((y * 120 + 60 - v.y) / v.height) * rect.height;
        if (document.elementFromPoint(px, py)?.tagName === 'CANVAS') return { x: px, y: py };
      }
    }
    return null;
  });
  if (!bare) fail('적 책략 팝업 밖으로 드러난 판 칸이 없다');
  await page.mouse.click(bare!.x, bare!.y);
  await page.waitForTimeout(150);
  if ((await prepProbe()).intelOpen) fail('판을 눌렀는데 적 책략 팝업이 안 닫힌다 (6단계 확정 5)');
  console.log('✓ 판 아무 데나 → 적 책략 팝업 닫힘');

  // 정찰 — 같은 자리에서 [전투 시작]으로. 팝업을 열어 둔 채 시작하면 함께 걷힌다
  await page.click('#ctx-prep button[data-action="ready"]');
  // 대기 — 내가 먼저 준비를 마쳤다. 상대가 아직이라 배치 단계 안에 머문다(전선 `waiting` → 재생기 `deploying`)
  await page.waitForFunction(() => (document.getElementById('ctx-prep') as HTMLElement).dataset.phase === 'waiting', null, { timeout: 5_000 })
    .catch(() => fail('[준비완료]를 눌렀는데 대기 화면이 안 선다 (?late=3000)'));
  p = await prepProbe();
  const waitNote = await page.evaluate(() => document.querySelector('#ctx-prep .prep-note')?.textContent ?? '');
  const waitPhase = await page.evaluate(() => (window as any).__battle.scene.debugPlayback.phase);
  if (waitPhase !== 'deploying') fail(`대기 중인데 재생기 단계가 ${waitPhase}다 — 상대를 안 기다리고 넘어갔다`);
  if (p.go?.a !== 'ready' || !p.go.off) fail(`대기 중인데 [준비완료]가 다시 눌린다: ${JSON.stringify(p.go)}`);
  if (!p.intel || p.intel.off) fail('대기 중에 [책략 확인]이 꺼졌다 — 척후기를 들었으면 기다리는 동안에도 본다');
  if (!waitNote.trim()) fail('대기 중 안내 문구가 비어 있다');
  if (p.cmdView !== 'skills') fail(`대기 중 명령 판이 고유기술 목록이 아니다: ${p.cmdView}`);
  console.log(`✓ 배치 대기(waiting) — [준비완료] 꺼짐 · [책략 확인] 켜짐 · 안내 「${waitNote.trim().slice(0, 24)}…」 → 상대 준비 뒤 정찰`);
  // 판은 다음 프레임에 다시 그린다 — 재생기의 단계가 아니라 **그려진 판**을 기다린다
  await page.waitForFunction(() => (document.getElementById('ctx-prep') as HTMLElement).dataset.phase === 'scouting', null, { timeout: 10_000 });
  p = await prepProbe();
  if (p.prepPhase !== 'scouting' || p.go?.a !== 'begin' || p.go.off || p.cmdView !== 'skills' || p.intel?.off !== false) {
    fail(`정찰 중 아래 칸이 어긋난다: ${JSON.stringify({ phase: p.prepPhase, go: p.go, cmd: p.cmdView, intel: p.intel })}`);
  }
  await page.click('#ctx-prep button[data-action="intel"]');
  await page.click('#ctx-prep button[data-action="begin"]');
  await page.waitForFunction(() => !['deploying', 'scouting'].includes((window as any).__battle.scene.debugPlayback.phase), null, { timeout: 10_000 });
  await page.waitForTimeout(100);
  p = await prepProbe();
  if (p.intelOpen) fail('전투가 시작됐는데 적 책략 팝업이 남아 있다');
  if (p.prepShown || p.prepPhase !== '') fail(`전투가 시작됐는데 배치 판이 남아 있다 (phase ${p.prepPhase})`);
  if (p.cmdView === 'skills') fail('전투가 시작됐는데 명령 판이 고유기술 목록 그대로다');
  console.log(`✓ [책략 확인] 켜짐(척후기) → 적 ${p.intelRows.length || foes.length}명 [장수][지력][책략] = 상태 · 칩 → 설명 · × 닫기 → 정찰 [전투 시작] → 배치 판 · 팝업 걷힘`);
}

// ── 턴 흐름 (GDD §3.4 · pptx 29쪽) ───────────────────────────
// 고유기술을 먼저 묻고 → 이동 → 공격/책략/명상/대기.
// SP가 모이길 기다리지 않도록 ?sp=로 채워 두고 새 판을 연다.

await page.goto(`${BASE}/?demo=1&seed=3&mode=3v3&side=P1&sp=25`, { waitUntil: 'networkidle' });
// SP가 가득이라 AI가 먼저 서면 고유기술 연출(`SKILL_FX_MS` 11.7초)이 먼저 돈다 — 넉넉히 기다린다
let s = await wait('awaitingInput', 60_000);
if (s?.phase !== 'awaitingInput') fail(`새 판에서 내 차례가 오지 않았다 (${s?.phase} · ${s?.activeUnit})`);

// 고유기술 물음은 **맥락 판**(오른쪽)에 뜬다 — 맵을 보며 판단하도록 (확정 5). 이때 왼쪽은 내 장수 카드다
const ask = () => page.evaluate(() => {
  const ctx = document.getElementById('ctx-flow') as HTMLElement;
  return {
    shown: ctx.dataset.view === 'ask',
    text: ctx.querySelector('.cx-banner .nm')?.textContent ?? '',
    banner: !!ctx.querySelector('.cx-banner[data-action="skillInfo"]'),
    buttons: [...ctx.querySelectorAll('.cx-buttons button')].map((b) => (b as HTMLElement).dataset.action ?? ''),
    cmd: (document.getElementById('cmd') as HTMLElement).dataset.view ?? '',
    card: (document.querySelector('#cmd .oc') as HTMLElement)?.dataset.unit ?? '',
    active: (window as any).__battle.scene.debugPlayback.state.activeUnit as string,
  };
});

// 고유기술이 있는 장수가 제어권을 잡을 때까지 턴을 넘긴다
let prompt = await ask();
for (let i = 0; i < 8 && !prompt.shown; i++) {
  await endTurnNow();
  await wait('awaitingInput');
  prompt = await ask();
}
if (!prompt.shown) fail('SP를 채웠는데도 고유기술 물음이 뜨지 않았다');
if (!prompt.buttons.includes('useUnique') || !prompt.buttons.includes('skipUnique')) {
  fail(`[사용][미사용]이 아니다: [${prompt.buttons.join(' ')}]`);
}
if (!prompt.banner) fail('고유기술 물음에 배너가 없다');
if (prompt.cmd !== 'card' || prompt.card !== prompt.active) fail(`물음 중 왼쪽이 내 장수 카드가 아니다 (${prompt.cmd}, ${prompt.card})`);
// 배너를 누르면 설명 팝업 — 애니메이션 없이 닫기만
await page.click('#ctx-flow .cx-banner');
await page.waitForTimeout(150);
if (!(await page.evaluate(() => { const t = document.getElementById('tip'); return !!t && !t.classList.contains('hidden') && (t.textContent ?? '').length > 5; }))) {
  fail('고유기술 배너를 눌러도 설명이 안 뜬다');
}
// 설명 팝업은 × 로만 닫힌다 — 열어 둔 채 지나가면 판 위를 덮어 뒤의 판 클릭을 삼킨다(실제로 그랬다)
await page.click('#tip button[data-action="closeTip"]');
if (await page.evaluate(() => !document.getElementById('tip')!.classList.contains('hidden'))) fail('설명 팝업이 × 로 안 닫힌다');
console.log(`✓ [1] 고유기술 물음(맥락 판) — ${prompt.text} · 왼쪽 내 장수 카드 · 배너 → 설명`);

// [미사용]을 누르면 물음이 걷히고 명령 여섯 칸이 뜬다
await pressCtx('skipUnique');
if ((await ask()).shown) fail('[미사용]을 눌러도 물음이 남아 있다');
s = (await probe())!;
if (s.cmd.view !== 'commands') fail('[미사용] 뒤 명령 판이 여섯 칸이 아니다');
if (!s.cmd.shown.includes('castTactic+')) fail('「책략」이 잠겨 있다');
console.log('✓ [1] [미사용] → 명령 여섯 칸');
const kept = s.pos!;

// [3] 책략 — 목록(맥락 판) → 조준 → 확인창 → 시전. 상태이상이 실제로 붙는지까지 본다.
await pressCmd('castTactic');
const list = await page.evaluate(() => [...document.querySelectorAll('#ctx-flow .cx-row[data-tactic]')]
  .map((b) => ({ id: (b as HTMLElement).dataset.tactic ?? '', on: !(b as HTMLButtonElement).disabled })));
if (list.length !== 8) fail(`환술 8종이 떠야 한다 — 실제 ${list.length}종`);
const usable = list.find((t) => t.on);
if (!usable) fail(`쓸 수 있는 책략이 하나도 없다: ${JSON.stringify(list)}`);
console.log(`✓ [3] 책략 목록(맥락 판) ${list.length}종 (사용 가능 ${list.filter((t) => t.on).length}종)`);

const mpBefore = await page.evaluate(() => {
  const st = (window as any).__battle.scene.debugPlayback.state;
  return st.units[st.activeUnit].mp as number;
});
const caster = (await probe())!.activeUnit!;

await page.click(`#ctx-flow .cx-row[data-tactic="${usable.id}"]`);
await page.waitForTimeout(150);
const aim = await page.evaluate(() => ({
  cells: (window as any).__battle.scene.debugAimCells() as { x: number; y: number }[],
  marks: (window as any).__battle.scene.debugMarkCommands() as number,
  view: (document.getElementById('ctx-flow') as HTMLElement).dataset.view ?? '',
}));
if (aim.cells.length === 0) fail(`「${usable.id}」 조준 후보가 하나도 칠해지지 않았다`);
if (aim.view !== 'aim') fail(`조준 중인데 맥락 판이 「대상을 선택해주세요」가 아니다 (${aim.view})`);
// 조준 후보는 **유닛이 서 있는 칸**이다. 칸을 채우기만 하면 초상화(depth 10)가 그대로 덮어
// 화면에서는 아무것도 안 보인다. 유닛 위층(depth 15)에 테두리를 그렸는지 확인한다.
if (aim.marks === 0) fail('조준 후보가 유닛 위에 표시되지 않는다 — 초상화에 가려 보이지 않는다');
console.log(`✓ [3] 조준 — 후보 ${aim.cells.length}칸(유닛 위 표시 확인), 맥락 판 「대상을 선택해주세요」`);

/*
 * 대상은 판에서 고르거나 **순서 판의 줄**로 고른다(2026-10-06 기획자 확정 — 옛 카드 줄이 하던 일).
 * 유닛을 조준하는 동안 카메라는 판 전체를 비춘다.
 */
// 순서 판에 줄이 있는 후보를 고른다 — 아래에서 그 줄로도 대상을 지정해 보기 위해서다
const picked = await page.evaluate((cells) => {
  const st = (window as any).__battle.scene.debugPlayback.state;
  const rows = new Set([...document.querySelectorAll('#order .ord-row')].map((r) => (r as HTMLElement).dataset.unit));
  const at = cells.map((c) => ({ c, u: Object.values(st.units as Record<string, any>)
    .find((x: any) => x.alive && x.pos.x === c.x && x.pos.y === c.y) as any }));
  const hit = at.find((a) => a.u && rows.has(a.u.id)) ?? at[0];
  return hit?.u ? { cell: hit.c, id: hit.u.id as string, inOrder: rows.has(hit.u.id) } : null;
}, aim.cells);
if (!picked) fail(`조준 후보 (${aim.cells[0]!.x},${aim.cells[0]!.y})에 기물이 없다`);
const target = picked!.cell;
const targetId = picked!.id;
await clickCell(target);
await page.waitForTimeout(300);

/*
 * 시전 확인창 — 「XXX에게 XX을 시전합니다 · 성공확률」 + [취소][확인] (94쪽).
 * 확률은 엔진의 `illusionChance()`가 낸 값이라 화면이 따로 계산하지 않는다.
 */
{
  const box = await page.evaluate(() => {
    const p = document.getElementById('ctx-flow') as HTMLElement;
    return {
      view: p.dataset.view ?? '', kind: p.dataset.kind ?? '',
      title: p.querySelector('.cx-q')?.textContent ?? '',
      text: p.querySelector('.cx-text')?.textContent ?? '',
      rate: p.querySelector('.cx-rate[data-kind="rate"] .v')?.textContent ?? '',
      buttons: [...p.querySelectorAll('.cx-buttons button')].map((b) => (b as HTMLElement).dataset.action ?? ''),
    };
  });
  if (box.view !== 'confirm' || box.kind !== 'tactic') fail(`대상을 골랐는데 시전 확인창이 아니다 (${box.view}/${box.kind})`);
  if (box.text.length < 5) fail(`확인창에 효과 설명이 없다: "${box.text}"`);
  if (!/^\d+%$/.test(box.rate)) fail(`환술인데 성공 확률이 없다: "${box.rate}"`);
  if (!box.buttons.includes('commit') || !box.buttons.includes('cancel')) {
    fail(`[취소][확인]이 아니다: [${box.buttons.join(' ')}]`);
  }
  // 확인창이 뜬 동안 카메라는 **대상**을 비춘다
  const cam = (await probe())!.camera;
  if (cam.cell?.x !== target.x || cam.cell?.y !== target.y) {
    fail(`확인창 중 카메라가 대상을 안 비춘다 — ${JSON.stringify(cam.cell)} vs (${target.x},${target.y})`);
  }
  console.log(`✓ [3] 확인창 — 「${box.title}」 성공 확률 ${box.rate}, 대상 포커스`);

  // [취소]는 아무것도 쏘지 않고 조준으로 돌아간다
  await pressCtx('cancel');
  const back = await page.evaluate(() => ({
    view: (document.getElementById('ctx-flow') as HTMLElement).dataset.view ?? '',
    mode: (window as any).__battle.scene.debugActionMode as string,
    mp: (() => {
      const st = (window as any).__battle.scene.debugPlayback.state;
      return st.units[st.activeUnit].mp as number;
    })(),
  }));
  if (back.view === 'confirm') fail('[취소]를 눌러도 확인창이 남아 있다');
  if (back.mode !== 'aim') fail(`[취소] 뒤에도 조준 상태여야 한다 (지금 ${back.mode})`);
  if (back.mp !== mpBefore) fail(`[취소]했는데 MP가 줄었다 (${mpBefore} → ${back.mp})`);
  console.log('✓ [3] [취소] → 아무것도 쏘지 않고 조준으로 복귀');

  // 이번엔 **순서 판의 줄**로 대상을 고른다 — 그 장수가 순서 판에 있으면(5번째까지) 줄을 누른다
  // 후보가 하나도 순서 판에 없으면 이 갈래가 안 돈다 — 조용히 넘기지 않고 말한다
  if (!picked!.inOrder) fail('조준 후보가 순서 판(5줄)에 하나도 없다 — 줄로 대상 지정 검사가 안 돈다');
  await page.locator(`#order .ord-row[data-unit="${targetId}"]`).first().click();
  await page.waitForTimeout(200);
  const viaRow = (await probe())!;
  if (viaRow.ctx.view !== 'confirm') fail('조준 중 후보의 순서 판 줄을 눌렀는데 확인창이 안 뜬다 (확정 4)');
  if (viaRow.camera.cell?.x !== target.x || viaRow.camera.cell?.y !== target.y) fail('줄로 고른 대상을 카메라가 안 비춘다');
  console.log('✓ [3] 조준 중 순서 판의 줄 → 대상 지정 (옛 카드 줄의 길)');
  await pressCtx('commit');
  await page.waitForTimeout(400);
}
{
  const after = (await probe())!;
  if (after.pos && (after.pos.x !== kept.x || after.pos.y !== kept.y)) {
    fail('이동을 고르지 않았는데 기물이 움직였다');
  }
}

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

/*
 * 연출 중에는 명령을 낼 수 없다 (2026-08-12 기획자 지적 · 4단계에서 「물러난다」 → 「꺼진다」).
 *
 * 턴은 연출이 끝나야 넘어가므로 그동안 `phase`는 여전히 `awaitingInput`이다.
 * 그대로 두면 대상을 고른 **직후에 패널이 한 번 더 떴다가** 사라져 두 번 깜빡인다.
 * 밖에서 폴링하면 놓치므로 프레임마다 들여다보다 연출 구간의 패널을 그대로 떠 온다.
 */
{
  const flash = await page.evaluate(() => new Promise<{ frames: number; shown: number }>((resolve) => {
    const sc = (window as any).__battle.scene;
    let frames = 0;
    let shown = 0;
    const t0 = performance.now();
    const tick = (): void => {
      if (sc.debugPlayback.busy) {
        frames++;
        // 아래 칸은 판 밖이라 숨지 않는다 — 대신 **누를 수 있는 명령 칸이 없어야** 한다
        if (document.querySelector('#cmd .cmd-grid button:not(:disabled), #ctx-flow .cx-buttons button')) shown++;
      }
      if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
      else resolve({ frames, shown });
    };
    requestAnimationFrame(tick);
  }));
  if (flash.frames === 0) {
    console.log('· 연출 중 패널 — 연출 구간을 잡지 못해 건너뜀');
  } else if (flash.shown > 0) {
    fail(`연출이 도는 동안 누를 수 있는 명령이 ${flash.shown}/${flash.frames} 프레임 있었다`);
  } else {
    console.log(`✓ 연출 중에는 명령 칸이 꺼진다 (${flash.frames}프레임 확인)`);
  }
}

// ── 확인창 둘 — 공격 대상 · 명상 (95 · 96쪽, 전투 UI 개편 4단계) ─────────
// 앞의 검사들은 공격 대상이 없거나 MP가 가득인 차례에 걸려 **이 두 갈래가 안 돌 수 있다**.
// 칠 적이 생기고 MP가 빈 차례가 올 때까지 차례를 넘겨 가며 둘 다 실제로 본다.
{
  let atk = false;
  let med = false;
  for (let i = 0; i < 40 && !(atk && med); i++) {
    if ((await wait('awaitingInput', 30_000))?.phase !== 'awaitingInput') break;
    let cur = (await probe())!;
    if (cur.busy) { await page.waitForTimeout(300); continue; }
    if (cur.ctx.view === 'ask') { await pressCtx('skipUnique'); cur = (await probe())!; }
    const st = await page.evaluate(() => (window as any).__battle.scene.debugPlayback.state);
    const c = commandsFor(st, 'P1');
    if (!atk && c?.attack) {
      await pressCmd('attack');
      const cells = await page.evaluate(() => (window as any).__battle.scene.debugChoosableCells() as { x: number; y: number }[]);
      await checkAttackConfirm(cells);
      atk = true;
    }
    if (!med && c?.meditate) {
      await pressCmd('meditate');
      const box = await page.evaluate(() => ({
        kind: (document.getElementById('ctx-flow') as HTMLElement).dataset.kind ?? '',
        text: document.querySelector('#ctx-flow .cx-q')?.textContent ?? '',
      }));
      const gain = meditateGain(st, st.activeUnit);
      if (box.kind !== 'meditate' || !box.text.includes(String(gain))) {
        fail(`명상 확인창이 「MP를 ${gain} 회복합니다」가 아니다: ${JSON.stringify(box)}`);
      }
      await pressCtx('cancel');
      if ((await probe())!.flow !== 'menu') fail('명상 확인창 [취소]가 명령 선택으로 돌아가지 않는다');
      console.log(`✓ 명상 확인창 — 「${box.text}」 (= meditateGain ${gain}) · [취소] → 명령 선택`);
      med = true;
    }
    if (!(atk && med)) await endTurnNow();
  }
  if (!atk) fail('칠 적이 있는 내 차례가 40번 안에 안 왔다 — 공격 확인창 검사가 안 돈다');
  if (!med) fail('명상할 수 있는 내 차례가 40번 안에 안 왔다 — 명상 확인창 검사가 안 돈다');
}

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

/*
 * 상대 기물은 **판에서** 눌러 열어 본다 (pptx 98쪽 「장수를 누르면 정보 팝업」).
 *
 * 예전에는 카드가 그 통로였다(28쪽 — 카드를 누르면 카메라가 그 기물로 갔다). 카드 줄을
 * 걷은 2단계부터는 판뿐이라, 내 차례의 확대(200%) 밖에 선 적은 화면을 판 전체로
 * 되돌린 뒤 누른다 — 사람은 자동 포커싱 토글로 같은 일을 한다.
 */
/*
 * **고유기술이 있는 적을 먼저 고른다** (2026-09-07). 아래의 기술 설명·발동 시간
 * 검사가 팝업에 고유기술이 있을 때만 도는데, 아무나 고르면 C·D급 134명이 걸려
 * **검사가 통째로 건너뛰어진다** — 실제로 허유(D급)가 뽑혀 한 번도 안 돌았다.
 * 「아직 안 붙은 갈래에 걸린 검사는 도는 적이 없다」와 같은 자리다.
 */
// 판의 장수는 **내 차례에** 눌러 본다 — 상대 차례의 판 클릭은 받지 않는다. 시간에 기대지 않고 기다린다
// (4단계에서 책략 확인 단계가 하나 늘자 여기 도착하는 시각이 상대 차례로 밀려 조용히 떨어졌다)
if ((await wait('awaitingInput'))?.phase !== 'awaitingInput') fail('살펴보기를 해 볼 내 차례가 오지 않았다');
const other = await page.evaluate((withSkill: string[]) => {
  const st = (window as any).__battle.scene.debugPlayback.state;
  const units = Object.values(st.units as Record<string, any>);
  const alive = (x: any) => x.alive && x.id !== st.activeUnit;
  const u = (units.find((x: any) => x.alive && x.side === 'P2' && withSkill.includes(x.officer))
    ?? units.find((x: any) => alive(x) && withSkill.includes(x.officer))
    ?? units.find((x: any) => x.alive && x.side === 'P2')
    ?? units.find(alive)) as any;
  return u ? { id: u.id as string, x: u.pos.x as number, y: u.pos.y as number } : null;
}, UNIQUE_SKILLS.flatMap((k) => k.holders));
if (!other) fail('들여다볼 다른 유닛이 없다');
await settle(6000);      // 앞선 책략 연출이 아직 돌고 있으면 카메라는 그 계획을 따라간다
await page.evaluate(() => {
  const sc = (window as any).__battle.scene;
  sc.resetView();
  sc.debugFreeCamera();
});
// **옮긴 카메라가 실제로 판 전체를 비출 때까지** 기다린다 — `worldView`는 다음 프레임에 다시 잰다.
// 4단계부터 내 차례는 확대(명령 선택)로 시작해 여기서 카메라가 실제로 움직인다(예전엔 이동 단계라
// 이미 판 전체였다). 옛 화면으로 좌표를 잡으면 엉뚱한 칸을 눌러 「팝업이 안 뜬다」로 떨어진다.
await page.waitForFunction(() => {
  const v = (window as any).__battle.scene.cameras.main.worldView;
  return v.width >= 2390 && v.height >= 2390;
}, null, { timeout: 5000 }).catch(() => fail('판 전체로 되돌린 카메라가 판 전체를 비추지 않는다'));
const clickAt = await toScreen(other.x, other.y);
await page.mouse.click(clickAt.x, clickAt.y);
await page.waitForTimeout(250);

/** 장수 팝업(`#unitpop`, 98쪽 · 6단계)이 지금 그린 것 */
const readPopup = () => page.evaluate(() => {
  const p = document.getElementById('unitpop') as HTMLElement;
  const card = p.querySelector('.oc') as HTMLElement | null;
  const skill = p.querySelector('.up-skill') as HTMLElement | null;
  return {
    open: !p.classList.contains('hidden'),
    unit: p.dataset.unit ?? '',
    pos: p.dataset.pos ?? '',
    cardUnit: card?.dataset.unit ?? '',
    side: card?.dataset.side ?? '',
    piece: p.querySelector('.oc-piece')?.textContent ?? '',
    name: p.querySelector('.oc-name')?.textContent ?? '',
    level: p.querySelector('.oc-lv')?.textContent ?? '',
    // 등급은 그림이다(2026-09-22) — 글자가 아니라 속성으로 본다
    grade: (p.querySelector('.oc-head .gr') as HTMLElement | null)?.dataset.grade ?? '',
    at: p.querySelector('.oc-stat.at b')?.textContent ?? '',
    skill: skill ? { state: skill.dataset.state ?? '', id: skill.dataset.skill ?? '', name: skill.querySelector('.nm')?.textContent ?? '' } : null,
    tactics: p.querySelectorAll('.up-tactics .chip').length,
    hidden: !!p.querySelector('.up-hidden'),
    // × 가 없다 — 판 아무 데나 누르면 닫힌다 (98쪽)
    closeButton: p.querySelectorAll('button[data-action^="close"], .ins-close').length,
  };
});
let popup = await readPopup();
if (!popup.open) {
  const why = await page.evaluate((at) => {
    const sc = (window as any).__battle.scene;
    const hit = document.elementFromPoint(at.x, at.y) as HTMLElement | null;
    return { phase: sc.debugPlayback.phase, busy: sc.debugPlayback.busy, flow: sc.debugFlowStep,
      active: sc.debugPlayback.state.activeUnit, popup: sc.debugPopup,
      hit: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : null, view: { ...sc.cameras.main.worldView } };
  }, clickAt);
  fail(`기물을 눌러도 장수 팝업이 뜨지 않는다 — ${JSON.stringify({ ...why, other })}`);
}
if (popup.unit !== other!.id || popup.cardUnit !== other!.id) fail(`누른 장수(${other!.id})가 아닌 팝업이 떴다: ${popup.unit}/${popup.cardUnit}`);
if (!/^(King|Rock|Bishop|Knight|Queen|Pawn)$/.test(popup.piece)) fail(`팝업에 기물명이 없다: "${popup.piece}"`);
if (popup.name.length === 0) fail('팝업에 장수명이 없다');
if (!/^Lv\d+$/.test(popup.level)) fail(`팝업 레벨이 이상하다: "${popup.level}"`);
if (!/^[SABCDE]$/.test(popup.grade)) fail(`팝업 등급이 이상하다: "${popup.grade}"`);
if (!/^\d+-\d+$/.test(popup.at)) fail(`AT가 「평타-크리티컬」 범위가 아니다: "${popup.at}"`);
if (popup.closeButton > 0) fail('장수 팝업에 닫기 단추가 있다 — 판 아무 데나 누르면 닫힌다(98쪽)');
// 고유기술 상태 = 엔진의 `skillStatus` (1단계가 남긴 「살펴보기만 제 계산」을 6단계에서 걷었다)
const engineState = await page.evaluate(() => (window as any).__battle.scene.debugPlayback.state);
const wantSkill = skillStatus(engineState, other!.id as never);
if (wantSkill === 'none' ? popup.skill !== null : popup.skill?.state !== wantSkill) {
  fail(`팝업의 고유기술 상태가 엔진과 다르다 — 화면 ${popup.skill?.state ?? '없음'} · 엔진 ${wantSkill}`);
}
// **「상대가 가지고 있는 책략 목록은 보여주지 않음 (전략적 목적)」** (28쪽) — 진영은 글자가 아니라 data-side로 본다
const enemy = popup.side === 'P2';        // 사람은 P1로 붙는다 (?side=P1)
if (enemy && popup.tactics > 0) fail(`적군인데 보유 책략 ${popup.tactics}종이 노출됐다 (pptx 28쪽 위반)`);
if (enemy && !popup.hidden) fail('적군 책략을 가렸으면 그 이유를 적어야 한다');

/*
 * **카메라가 그 장수를 왼쪽 가운데로 비추고(6단계 확정 2), 팝업은 그 장수를 가리지 않는다.**
 * 판 끝의 장수는 카메라가 못 밀어 팝업이 왼쪽으로 비켜 선다 — 어느 쪽이든 「안 가린다」가 먼저다.
 */
await settle(6000);
const placed = await page.evaluate((id) => {
  const sc = (window as any).__battle.scene;
  const u = sc.debugPlayback.state.units[id];
  const rect = (sc.game.canvas as HTMLCanvasElement).getBoundingClientRect();
  const v = sc.cameras.main.worldView;
  const ux = rect.left + ((u.pos.x * 96 + 48 - v.x) / v.width) * rect.width;
  const uy = rect.top + ((u.pos.y * 120 + 60 - v.y) / v.height) * rect.height;
  const p = document.getElementById('unitpop')!.getBoundingClientRect();
  const board = document.getElementById('board')!.getBoundingClientRect();
  return {
    cue: sc.debugCameraCue(), pos: u.pos,
    covered: ux >= p.left && ux <= p.right && uy >= p.top && uy <= p.bottom,
    side: (document.getElementById('unitpop') as HTMLElement).dataset.pos,
    popupMid: ((p.top + p.bottom) / 2 - board.top) / board.height,
    unitX: (ux - board.left) / board.width,
  };
}, other!.id);
if (placed.cue.cell?.x !== placed.pos.x || placed.cue.cell?.y !== placed.pos.y || placed.cue.scale <= 1) {
  fail(`팝업을 열었는데 카메라가 그 장수를 확대해 비추지 않는다: ${JSON.stringify(placed.cue)}`);
}
if (placed.cue.lean <= 0) fail('팝업을 열었는데 카메라가 장수를 왼쪽으로 비켜 세우지 않는다');
if (placed.covered) fail(`장수 팝업이 그 장수를 가린다 (팝업 ${placed.side}, 장수 화면 x ${placed.unitX.toFixed(2)})`);
if (Math.abs(placed.popupMid - 0.5) > 0.06) fail(`장수 팝업이 판 세로 가운데에 있지 않다 (${placed.popupMid.toFixed(2)})`);
if ((placed.unitX > 0.5) !== (placed.side === 'left')) fail(`팝업이 장수의 반대편에 서지 않았다 (장수 x ${placed.unitX.toFixed(2)}, 팝업 ${placed.side})`);
console.log(`✓ 장수 팝업 — [${popup.grade}] ${popup.piece} ${popup.name} ${popup.level}, AT ${popup.at}, 고유기술 ${popup.skill?.state ?? '없음'} = 엔진, 책략 ${enemy ? '가림' : `${popup.tactics}종`}, ×없음`);
console.log(`✓ 장수 팝업 자리 — ${placed.side} 가운데, 카메라 ×${placed.cue.scale} lean ${placed.cue.lean}, 장수(화면 x ${placed.unitX.toFixed(2)})를 안 가림`);

// 고유기술은 이름만 뜨고 **눌러야** 설명이 나온다 (28쪽 「클릭을 하면 설명 보여줌」)
if (popup.skill) {
  await page.click('#unitpop .up-skill');
  await page.waitForTimeout(150);
  const tip = await page.evaluate(() => ({
    open: document.getElementById('tip')?.classList.contains('hidden') === false,
    body: document.querySelector('#tip .tip-body')?.textContent ?? '',
    tail: document.querySelector('#tip .tip-tail')?.textContent ?? '',
  }));
  if (!tip.open) fail('고유기술을 눌러도 설명이 뜨지 않는다');
  if (tip.body.length < 5) fail(`고유기술 설명이 비어 있다: "${tip.body}"`);

  /*
   * **발동 시간이 꼬리줄에 있는가 — 그리고 이 기술의 값과 맞는가** (2026-09-07).
   *
   * 「줄이 있는가」만 보면 「즉시」를 늘 찍어도 통과한다. 팝업의 `data-skill`로 데이터의
   * `castDelay`에서 기댓값을 만든다 — 지연 13종이 걸리면 「0.3일」이, 나머지 27종이면 그 언어의 「즉시」가 떠야 한다.
   */
  const def = UNIQUE_SKILLS.find((k) => k.id === popup.skill!.id);
  if (!def) fail(`팝업의 기술을 데이터에서 못 찾는다: "${popup.skill.id}"`);
  const showsDays = /[\d.]+\s*일/.test(tip.tail);
  if ((def!.castDelay > 0) !== showsDays) {
    fail(`발동 시간이 데이터와 어긋난다 — ${def!.name} castDelay=${def!.castDelay}인데 꼬리줄이 "${tip.tail}"`);
  }
  if (def!.castDelay > 0 && !tip.tail.includes((def!.castDelay / 100).toFixed(1))) {
    fail(`발동 시간의 숫자가 castDelay(${def!.castDelay})와 다르다 — "${tip.tail}"`);
  }
  console.log(`✓ 고유기술 설명 — ${popup.skill.name}: ${tip.body.slice(0, 24)}… / ${tip.tail}`);
}

/*
 * **판 아무 데나 누르면 닫힌다** (98쪽 · 6단계 확정 5) — 장수 팝업도, 그 위에 띄운 설명 팝업도.
 * 그 장수 곁의 **빈 칸**을 누른다(지금 화면 안 · 팝업 밖). 명령을 고르기 전이라 흐름은 이 칸을 안 받는다.
 */
const emptyAt = await page.evaluate((id) => {
  const sc = (window as any).__battle.scene;
  const st = sc.debugPlayback.state;
  const u = st.units[id];
  const rect = (sc.game.canvas as HTMLCanvasElement).getBoundingClientRect();
  const v = sc.cameras.main.worldView;
  const taken = new Set(Object.values(st.units as Record<string, any>).filter((x: any) => x.alive).map((x: any) => `${x.pos.x},${x.pos.y}`));
  const offsets = [[-1, 0], [0, 1], [0, -1], [-1, 1], [-1, -1], [1, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [1, -1]];
  for (const [dx, dy] of offsets) {
    const x = u.pos.x + dx!, y = u.pos.y + dy!;
    if (x < 0 || y < 0 || x >= st.boardSize.x || y >= st.boardSize.y || taken.has(`${x},${y}`)) continue;
    const px = rect.left + ((x * 96 + 48 - v.x) / v.width) * rect.width;
    const py = rect.top + ((y * 120 + 60 - v.y) / v.height) * rect.height;
    // 판 위의 창(팝업 · 설명)이 아니라 **캔버스**가 받는 자리여야 한다
    if (document.elementFromPoint(px, py)?.tagName !== 'CANVAS') continue;
    return { x: px, y: py };
  }
  return null;
}, other!.id);
if (!emptyAt) fail('장수 곁에 누를 빈 칸이 화면에 없다');
await page.mouse.click(emptyAt!.x, emptyAt!.y);
await page.waitForTimeout(200);
const afterEmpty = await page.evaluate(() => ({
  popup: !document.getElementById('unitpop')!.classList.contains('hidden'),
  tip: !document.getElementById('tip')!.classList.contains('hidden'),
}));
if (afterEmpty.popup) fail('빈 칸을 눌렀는데 장수 팝업이 남아 있다 (98쪽 「판 아무 데나 클릭하면 닫기」)');
if (afterEmpty.tip) fail('판을 눌렀는데 설명 팝업이 남아 있다 (6단계 확정 5)');
console.log(`✓ 빈 칸 → 장수 팝업${popup.skill ? ' · 설명 팝업' : ''} 함께 닫힘`);

// **같은 장수를 다시 누르면 닫힌다** — 판 전체로 되돌려 연 뒤, 카메라가 옮겨 준 자리에서 한 번 더 누른다
await page.evaluate(() => { const sc = (window as any).__battle.scene; sc.resetView(); sc.debugFreeCamera(); });
await page.waitForFunction(() => (window as any).__battle.scene.cameras.main.worldView.width >= 2390, null, { timeout: 5000 });
await clickCell(other!);
await page.waitForTimeout(200);
popup = await readPopup();
if (!popup.open || popup.unit !== other!.id) fail('다시 눌렀는데 장수 팝업이 안 뜬다');
await settle(6000);
await clickCell(other!);
await page.waitForTimeout(200);
popup = await readPopup();
if (popup.open) fail('같은 장수를 다시 눌렀는데 팝업이 안 닫힌다');
console.log('✓ 같은 장수 다시 → 장수 팝업 닫힘');
// 살펴보려고 멈춰 둔 카메라를 자동으로 돌려 놓는다 — 뒤의 연출 검사는 카메라가 따라가야 한다
await page.evaluate(() => (window as any).__battle.scene.resetView());

// ── 고유기술 발동 연출 (pptx 23·24쪽) ────────────────────────
// 물음에 「예」 → 연출 배너가 뜨고 그동안 판이 멈춘다. 연출이 안 뜨면 무엇이 터졌는지
// 알 수 없고, 멈추지 않으면 볼 겨를도 없이 다음 상태로 넘어간다.

await page.goto(`${BASE}/?demo=1&seed=3&mode=3v3&side=P1&sp=25`, { waitUntil: 'networkidle' });
// 첫 차례가 AI면 고유기술 연출(11.7초)이 먼저 돈다 — 위 「새 판」과 같은 사정
s = await wait('awaitingInput', 60_000);
if (s?.phase !== 'awaitingInput') fail(`연출 확인용 판에서 내 차례가 오지 않았다 (${s?.phase} · ${s?.activeUnit})`);

prompt = await ask();
for (let i = 0; i < 8 && !prompt.shown; i++) {
  await endTurnNow();
  await wait('awaitingInput', 60_000);
  prompt = await ask();
}
if (!prompt.shown) fail('연출 확인용 판에서 고유기술 물음이 뜨지 않았다');

await pressCtx('useUnique');
await page.waitForTimeout(50);
// 조준이 필요한 기술이면 후보 한 칸을 골라 준다 (필요 없는 기술은 이미 시전됐다)
const aimCells = await page.evaluate(() =>
  (window as any).__battle.scene.debugAimCells() as { x: number; y: number }[]);
if (aimCells.length > 0) {
  const at = await toScreen(aimCells[0]!.x, aimCells[0]!.y);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(200);
}

// 연출은 **4단**이다 (2026-09-15 두루마리): 펴기 → 기술 장면 → 라벨+효과 → 말기.
// **단 길이를 여기 다시 적지 않는다** — 실제 단계(`#fx[data-stage]`)가 바뀌기를 기다린다.
// 2026-08-26~09-07에 고정 대기가 연출 길이를 못 따라와 뒤따르는 검사 20여 건이 안 돌았다.
// 길이·칸 순서는 `packages/client/test/skillFx.test.ts`가 고정한다.
const waitStage = (want: string, timeout = 6000): Promise<boolean> => page.waitForFunction(
  (w) => document.getElementById('fx')?.dataset.stage === w, want, { timeout },
).then(() => true, () => false);

const face = await page.evaluate(() => ({
  shown: document.getElementById('fx')?.classList.contains('hidden') === false,
  stage: document.getElementById('fx')?.dataset.stage ?? '',
  scroll: document.querySelector<HTMLElement>('#fx .fx-scroll')?.dataset.frame ?? '',
  frozen: (window as any).__battle.scene.debugPlayback.state.time as number,
  logged: (window as any).__battle.scene.debugLogPending as number,
}));
if (!face.shown) fail('고유기술을 발동했는데 연출이 뜨지 않는다');
if (face.stage !== 'unroll') fail(`1단은 두루마리 펴기여야 한다 (지금 "${face.stage}")`);
// 몇 번째 칸인지는 묻지 않는다 — 클릭 뒤 기다리는 사이에 이미 몇 칸 펴졌다(칸 순서는 skillFx.test.ts)
if (!(Number(face.scroll) >= 1 && Number(face.scroll) <= 16)) fail(`두루마리 띠에서 보이는 칸이 없다 ("${face.scroll}")`);
console.log('✓ 고유기술 연출 1단 — 두루마리 펴기');

// 연출 중에는 시간이 흐르지 않아야 한다 (고유기술은 턴을 소비하지 않는다 — GDD §3.4)
await page.waitForTimeout(700);
const during = await page.evaluate(() => ({
  time: (window as any).__battle.scene.debugPlayback.state.time as number,
  pending: (window as any).__battle.scene.debugLogPending as number,
}));
if (during.time !== face.frozen) fail(`연출 중에 시간이 흘렀다 (${face.frozen} → ${during.time})`);
// **대화도 멈춰 있어야 한다** — 어두워진 배경에서 말풍선이 지나가면 글자가 묻힌다
if (face.logged > 0 && during.pending < face.logged) {
  fail(`연출 중에 대화가 흘렀다 (밀린 줄 ${face.logged} → ${during.pending})`);
}
console.log('✓ 연출 중 판·대화 모두 정지 확인');

if (!await waitStage('action')) fail('2단(기술 장면)으로 넘어가지 않는다');
const scene = await page.evaluate(() => {
  const shown = [...document.querySelectorAll<HTMLImageElement>('#fx .fx-action')].filter((e) => !e.hidden);
  const scroll = document.querySelector<HTMLElement>('#fx .fx-scroll');
  return {
    shown: shown.length,
    unrolled: !!scroll && !scroll.hidden && scroll.dataset.frame === '16',
    art: shown[0] ? shown[0].naturalWidth > 0 : false,
  };
});
if (scene.shown !== 1) fail(`기술 장면은 한 장만 보여야 한다 (지금 ${scene.shown}장)`);
if (!scene.unrolled) fail('2단에서 두루마리가 다 펴진(16번) 칸이 아니다');
console.log(`✓ 고유기술 연출 2단 — 기술 장면${scene.art ? '' : ' (그림 없음 — 빈 종이)'}`);

if (!await waitStage('caption')) fail('3단(라벨 + 효과)으로 넘어가지 않는다');
// 3단 앞머리 1초는 4번 장면이 사라지며 설명이 떠오르는 겹침이다(2026-09-18) — 다 떠오른 뒤에 본다.
// 길이를 적지 않고 설명 칸의 불투명도가 1에 닿기를 기다린다
await page.waitForFunction(
  () => document.querySelector<HTMLElement>('#fx .fx-card')?.style.opacity === '1', undefined, { timeout: 4000 },
).catch(() => { /* 아래 검사가 사연과 함께 실패시킨다 */ });
const caption = await page.evaluate(() => {
  const card = document.querySelector<HTMLElement>('#fx .fx-card');
  return {
    visible: !!card && getComputedStyle(card).display !== 'none',
    actions: [...document.querySelectorAll<HTMLElement>('#fx .fx-action')].filter((e) => !e.hidden).length,
    label: !document.querySelector<HTMLElement>('#fx .fx-head')?.dataset.noart,
    // 라벨은 두루마리 **위**, 종이 바깥이다 (2026-09-18) — 라벨 아래 끝이 종이 윗단보다 위에 있어야 한다
    labelAbove: (() => {
      const head = document.querySelector('#fx .fx-head')?.getBoundingClientRect();
      const paper = document.querySelector('#fx .fx-paper')?.getBoundingClientRect();
      return !!head && !!paper && head.height > 0 && head.bottom <= paper.top + 1;
    })(),
    seal: (() => {
      const seal = document.querySelector<HTMLImageElement>('#fx .fx-seal');
      return !!seal && getComputedStyle(seal).display !== 'none';
    })(),
    desc: document.querySelector('#fx .fx-desc')?.textContent ?? '',
  };
});
if (!caption.visible) fail('3단인데 라벨·설명 칸이 안 보인다');
if (caption.actions !== 0) fail('3단에서 기술 장면이 걷히지 않았다');
if (caption.desc.length < 5) fail(`효과 설명이 비어 있다: "${caption.desc}"`);
if (!caption.labelAbove) fail('3단의 라벨이 두루마리 위(종이 바깥)에 있지 않다');
if (!caption.seal) fail('3단에 도장이 안 보인다');
console.log(`✓ 고유기술 연출 3단 — ${caption.desc.slice(0, 24)}…`
  + `${caption.label ? '' : ' (라벨 없음 — 이름 글자)'}`);

if (!await waitStage('roll')) fail('4단(두루마리 말기)으로 넘어가지 않는다');
await page.waitForTimeout(500);
const fading = await page.evaluate(() => Number(document.getElementById('fx')?.style.opacity ?? '1'));
// 라벨은 말기 동안에도 남아 두루마리와 함께 사라진다 (2026-09-18) — 3단에서 걷히면 안 된다
const headInRoll = await page.evaluate(() => {
  const head = document.querySelector<HTMLElement>('#fx .fx-head');
  return !!head && getComputedStyle(head).display !== 'none';
});
if (!headInRoll) fail('4단(말기)에서 라벨이 먼저 사라졌다 — 두루마리와 함께 사라져야 한다');
if (!(fading < 1)) fail(`말리는 동안 투명해지지 않는다 (opacity ${fading})`);
console.log(`✓ 고유기술 연출 4단 — 말리며 사라짐 (opacity ${fading.toFixed(2)})`);

await page.waitForFunction(
  () => document.getElementById('fx')?.classList.contains('hidden') !== false,
  undefined, { timeout: 6000 },
).catch(() => { /* 아래에서 사연과 함께 실패시킨다 */ });
if (await page.evaluate(() => document.getElementById('fx')?.classList.contains('hidden') === false)) {
  fail('연출 4단이 다 끝났는데 걷히지 않는다');
}
console.log('✓ 연출 종료 → 판 재개');

// ── 버프/디버프 배지 설명 ─────────────────────────────────────
// 배지를 누르면 그 뜻이 팝업으로 뜬다. 이름·설명의 출처는 엔진의 STATUS_META다.
// 배지는 장수 카드(`.oc-status`)에 있고, 판에서 장수를 누르면 뜨는 장수 팝업(98쪽)이 그 카드를 띄운다.
//
// **개편 전부터 대개 건너뛰던 검사였다** — 「그 순간 누군가 상태를 들고 있어야」 돌았고 데모 판에서는 운이었다
// (곽가 「유언계책」이 마침 걸려 있을 때만). 6단계에서 `?status=1`(남군 군주가 버프·디버프 하나씩을 든 채 시작)로
// **언제나** 돌게 했다 — 「안 도는 갈래」를 흉내 통로로 닫는 같은 처방이다.
await page.goto(`${BASE}/?demo=1&seed=3&mode=3v3&side=P1&status=1`, { waitUntil: 'networkidle' });
if ((await wait('awaitingInput'))?.phase !== 'awaitingInput') fail('?status=1 판에서 내 차례가 오지 않았다');
await page.evaluate(() => { const sc = (window as any).__battle.scene; sc.resetView(); sc.debugFreeCamera(); });
await page.waitForFunction(() => (window as any).__battle.scene.cameras.main.worldView.width >= 2390, null, { timeout: 5000 });
const king = await page.evaluate(() => {
  const u = (window as any).__battle.scene.debugPlayback.state.units['P1-King'];
  return { x: u.pos.x as number, y: u.pos.y as number, statuses: (u.statuses as any[]).map((s) => s.status as string) };
});
if (king.statuses.length < 2) fail(`?status=1 인데 남군 군주의 상태가 ${king.statuses.length}개다`);
await clickCell(king);
await page.waitForTimeout(250);
const chips = await page.evaluate(() => [...document.querySelectorAll('#unitpop .oc-status .st')]
  .map((e) => ({ status: (e as HTMLElement).dataset.status ?? '', kind: e.classList.contains('buff') ? 'buff' : e.classList.contains('debuff') ? 'debuff' : '' })));
if (chips.length < 2) fail(`군주 팝업에 상태 배지가 ${chips.length}개다 — 버프·디버프 하나씩 있어야 한다`);
if (!chips.some((c) => c.kind === 'buff') || !chips.some((c) => c.kind === 'debuff')) {
  fail(`배지의 버프/디버프 구분이 틀렸다: ${JSON.stringify(chips)}`);
}
for (const s of king.statuses) {
  if (!chips.some((c) => c.status === s)) fail(`상태 「${s}」의 배지가 팝업에 없다`);
}
await page.click('#unitpop .oc-status .st');
await page.waitForTimeout(150);
const tip = await page.evaluate(() => ({
  open: document.getElementById('tip')?.classList.contains('hidden') === false,
  name: document.querySelector('#tip .tip-name')?.textContent ?? '',
  body: document.querySelector('#tip .tip-body')?.textContent ?? '',
}));
if (!tip.open) fail('상태 배지를 눌러도 설명이 뜨지 않는다');
if (tip.body.length < 5) fail(`상태 설명이 비어 있다: "${tip.body}"`);
await page.click('#tip .tip-close');
console.log(`✓ 상태 배지 설명 — 배지 ${chips.length}개(버프·디버프) · 「${tip.name}」 ${tip.body.slice(0, 24)}…`);

// ── 지형 그림 (2026-08-14) ───────────────────────────────────
// 「화면이 그린 지형 = 엔진의 지형」. 타일 배지를 엔진 상태와 맞대어 보는 것과 같은 결이다.
//
// 데모 편성에는 「화계」·「수계」·「수성지주」가 없어 판을 돌려도 지형이 생기지 않는다.
// `?terrain=1`이 판 한가운데에 세 칸과 **성채 3×3**을 놓아 주는 확인용 통로다.
//
// 성채 조각 열넷은 여기 이름으로 세지 않는다 — 「엔진의 칸이 전부 그려졌는가」가
// 그것을 대신 잡는다(조각 하나가 안 구워졌으면 그 칸이 화면에서 빠진다). 이름을
// 세 번째로 적어 두면 지형이 하나 늘 때 여기만 낡는다.
//
// **그림이 없으면 건너뛴다.** 에셋은 리포에 없어서(`npm run terrain`을 돌리기 전에는)
// 텍스처가 통째로 404다 — 그때 여기서 막으면 그림 없는 환경에서 스모크가 못 돈다.

await page.goto(`${BASE}/?demo=1&seed=3&mode=3v3&side=P1&terrain=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const ground = await page.evaluate(() => {
  const scene = (window as any).__battle.scene;
  const state = scene.debugPlayback.state;
  return {
    // 화면이 실제로 그린 것 — 씬이 들고 있는 이미지에서 뽑는다
    drawn: scene.debugTerrainTiles() as { x: number; y: number; terrain: string }[],
    // 엔진의 권위 상태
    engine: (state.terrain as any[]).map((t) => ({ x: t.pos.x, y: t.pos.y, terrain: t.terrain })),
    loaded: ['fire', 'water', 'holy'].filter((t) => scene.textures.exists(`terrain:${t}`)),
  };
});
if (ground.loaded.length === 0) {
  console.log('· 지형 그림 — 텍스처가 없어 건너뜀 (npm run terrain 이 아직 안 돌았다)');
} else {
  if (ground.loaded.length !== 3) fail(`지형 그림 3종 중 ${ground.loaded.length}종만 받았다`);
  if (ground.engine.length === 0) fail('?terrain=1 인데 엔진에 지형이 하나도 없다');
  const key = (t: { x: number; y: number; terrain: string }): string => `${t.x},${t.y}:${t.terrain}`;
  const drawn = new Set(ground.drawn.map(key));
  for (const tile of ground.engine) {
    if (!drawn.has(key(tile))) {
      fail(`엔진의 지형이 화면에 없다 — ${key(tile)} (성채 조각이면 npm run terrain 을 다시 돌린다)`);
    }
  }
  if (drawn.size !== ground.engine.length) {
    fail(`화면에 없는 지형이 남아 있다 (화면 ${drawn.size} · 엔진 ${ground.engine.length})`);
  }
  console.log(`✓ 지형 그림 — ${ground.engine.map(key).join(' · ')}`);
}

// 판에 깔린 지도 — 셀에 맞춰 자를 것이 없는 한 장이라 크기만 본다
const boardMap = await page.evaluate(() =>
  (window as any).__battle.scene.debugBoardMap() as { width: number; height: number } | null);
if (!boardMap) console.log('· 판 지도 — 그림이 없어 건너뜀');
else if (boardMap.width !== 2400 || boardMap.height !== 2400) {
  fail(`판 지도가 판 크기와 다르다 — ${boardMap.width}×${boardMap.height}`);
} else console.log('✓ 판 지도 — 2400×2400 판 전체를 덮는다');

/*
 * ── 시장 아이템 — 커맨드 패널의 [아이템] (2026-09-23, GDD §6.5) ──
 *
 * 액티브 아이템은 **장터에서 사서 출전 준비에서 들려 보내야** 판에 오른다. 계정을
 * 건너뛰는 데모에는 그 길이 없어 이 단추가 **한 번도 안 뜨는** 갈래였다 —
 * 「도달할 수 없는 상태에 걸린 검사는 도는 적이 없다」(§5-52)라, 흉내 통로
 * (`?items=`)를 검사와 **함께** 만들었다.
 *
 * 영기(진영 SP +3)를 쓰는 것은 **조준이 없어서**가 아니라 **결과가 화면 숫자로
 * 보여서**다 — HUD의 SP가 실제로 오르는 것까지 본다. 조준이 필요한 쪽(탕약·폭약)의
 * 후보 고르기는 책략과 **같은 코드**를 지나므로 위의 책략 조준 검사가 이미 지난다.
 */

await page.goto(`${BASE}/?demo=1&seed=3&mode=3v3&side=P1&items=yeong-gi`, { waitUntil: 'networkidle' });
await page.waitForFunction(
  () => (window as any).__battle?.scene?.debugPlayback?.phase === 'awaitingInput',
  null, { timeout: 25_000 },
).catch(() => fail('아이템 판 — 사람 차례가 오지 않았다'));

let itemTurn = (await probe())!;
if (itemTurn.ctx.view === 'ask') { await pressCtx('skipUnique'); itemTurn = (await probe())!; }

if (!itemTurn.cmd.shown.includes('useItem+')) {
  fail(`아이템을 들고 나왔는데 [아이템]이 잠겼다: [${itemTurn.cmd.shown.join(' ')}]`);
}

const spNow = (): Promise<number> => page.evaluate(() =>
  (window as any).__battle.scene.debugPlayback.state.sp.P1 as number);
const spBefore = await spNow();

// ① [아이템] → 목록 한 줄(94쪽 목업 · 확정 3) — 무엇을 들었는지 **누르기 전에** 보인다
await pressCmd('useItem');
const itemRow = await page.evaluate(() => {
  const r = document.querySelector('#ctx-flow .cx-row[data-item]') as HTMLButtonElement | null;
  return r ? { id: r.dataset.item ?? '', text: r.textContent ?? '', on: !r.disabled,
    rows: document.querySelectorAll('#ctx-flow .cx-row').length } : null;
});
if (!itemRow) fail('[아이템]을 눌렀는데 맥락 판에 아이템 줄이 없다');
if (itemRow!.rows !== 1 || itemRow!.id !== 'yeong-gi' || !itemRow!.text.includes('영기') || !itemRow!.on) {
  fail(`아이템 목록이 한 줄짜리 영기가 아니다: ${JSON.stringify(itemRow)}`);
}
// ② 줄을 누르면 확인창 — 쓰면 사라지는 것이라 되돌릴 자리가 있어야 한다
await page.click('#ctx-flow .cx-row[data-item]');
await page.waitForTimeout(150);
const confirmText = (await page.textContent('#ctx-flow')) ?? '';
if ((await probe())!.ctx.kind !== 'item') fail('아이템 줄을 눌렀는데 확인창이 안 뜬다');
for (const want of ['영기', '진영 SP +3', '사라진다']) {
  if (!confirmText.includes(want)) fail(`아이템 확인창에 「${want}」이(가) 없다 — "${confirmText}"`);
}

// ③ [취소] — 아직 안 썼다. 한 단계 뒤(목록)로 돌아온다
await pressCtx('cancel');
if ((await probe())!.flow !== 'list') fail('아이템 확인창 [취소]가 목록으로 돌아가지 않는다');
if (await spNow() !== spBefore) fail('취소했는데 아이템이 쓰였다');

// ④ 다시 눌러 [확인] — 이번에는 실제로 돈다
await page.click('#ctx-flow .cx-row[data-item]');
await page.waitForTimeout(150);
await pressCtx('commit');
await page.waitForFunction(
  (before) => (window as any).__battle.scene.debugPlayback.state.sp.P1 > before,
  spBefore, { timeout: 5000 },
).catch(() => fail('아이템을 확정했는데 SP가 안 올랐다'));

const spAfter = await spNow();
if (spAfter !== Math.min(spBefore + 3, 15)) fail(`영기가 SP를 +3 안 올렸다 — ${spBefore} → ${spAfter}`);

// ④ 한 판에 한 번 — 엔진에 표식이 남고, 대화창이 무슨 일인지 말한다
const usedMark = await page.evaluate(() => {
  const s = (window as any).__battle.scene.debugPlayback.state;
  return Object.values(s.units).filter((u: any) => u.itemUsed).map((u: any) => u.id as string);
});
if (usedMark.length !== 1) fail(`「썼다」 표식이 ${usedMark.length}개다 — 하나여야 한다`);
/*
 * **대화창은 줄을 천천히 흘린다**(`systemLog`의 pacing) — 판정이 끝난 그 순간에
 * 읽으면 아직 큐에 있다. 「몇 ms면 되겠지」로 재지 말고 **실제로 나타날 때까지**
 * 기다린다(연출 길이를 스모크에 다시 적지 않는다, §5-53).
 */
await page.waitForFunction(
  () => ((window as any).__battle.scene.debugLogLines() as string[])
    .some((l) => l.includes('영기') && l.includes('썼다')),
  null, { timeout: 10_000 },
).catch(async () => {
  const lines = await page.evaluate(() =>
    (window as any).__battle.scene.debugLogLines() as string[]);
  fail(`대화창에 아이템을 쓴 줄이 없다: ${lines.slice(-3).join(' | ')}`);
});
console.log(`✓ 시장 아이템 — [아이템] → 확인창 → 취소 → 확정, SP ${spBefore} → ${spAfter}`);

/*
 * ── 다국어 — 전투 화면을 **일본어로 다시 띄워** 한글이 남았는지 본다 (2026-09-11) ──
 *
 * 단위 검사(`eventText.test.ts`)는 로그 문장만 지난다. HUD·배지·카드·살펴보기는
 * DOM을 그려야 나오므로, 실제로 그리는 유일한 검사인 여기서 본다.
 *
 * **위의 검사들을 이 언어로 다시 돌리지는 않는다** — 그것들은 「북군」·「공포」 같은
 * 한국어 글자를 일부러 못 박고 있고(그게 그 검사들의 요점이다), 언어마다 다시 적으면
 * 문구를 고칠 때마다 열 벌을 고쳐야 한다. 여기서 묻는 것은 한 가지다:
 * **번역되지 않고 한국어로 조용히 물러난 자리가 있는가.**
 *
 * 한글이 아닌 한자(고유기술의 `hanja` — 釜底抽薪)는 번역 대상이 아니라 그대로 둔다.
 */
const jaPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const jaErrors: string[] = [];
jaPage.on('pageerror', (e) => jaErrors.push(e.message));
// 언어는 `localStorage`가 정본이다(`i18n/index.ts`의 `loadLang`) — 화면을 띄우기
// **전에** 심어야 첫 렌더부터 그 언어다.
await jaPage.addInitScript(() => localStorage.setItem('samchess.lang', 'ja'));
await jaPage.goto(`${BASE}/?demo=1&seed=3&mode=3v3&side=P1`, { waitUntil: 'networkidle' });
await jaPage.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback, null, { timeout: 20000 });

// 판의 기물을 눌러 장수 팝업까지 띄운다 — 안 열면 그 안의 문구는 검사에 안 걸린다
// 내 차례를 기다린 뒤 **적**을 누른다 — 판의 클릭은 내 차례·정찰에만 받고, 차례인 내 장수를
// 누르면 「제자리 대기」가 된다(CLAUDE.md 「조용히 무시하는 경로는 없는 것처럼 보인다」).
await jaPage.waitForFunction(() => (window as any).__battle.scene.debugPlayback.phase === 'awaitingInput',
  null, { timeout: 60000 });
{
  // **판 전체로 되돌린 뒤 한 프레임 기다린다** — `worldView`는 카메라가 다음 프레임에
  // 다시 계산한다. 같은 `evaluate` 안에서 읽으면 확대돼 있던 옛 화면으로 좌표를 잡아
  // 판 밖(y < 0)을 누른다 — 내 차례 확대가 언제 끝나는지에 따라 붙었다 떨어지는 검사였다(2026-10-06).
  await jaPage.evaluate(() => {
    const scene = (window as any).__battle.scene;
    scene.resetView();
    scene.debugFreeCamera();
  });
  await jaPage.waitForTimeout(150);
  const at = await jaPage.evaluate(() => {
    const scene = (window as any).__battle.scene;
    const u =Object.values(scene.debugPlayback.state.units as Record<string, any>)
      .find((x: any) => x.alive && x.side === 'P2') as any;
    const rect = (scene.game.canvas as HTMLCanvasElement).getBoundingClientRect();
    const v = scene.cameras.main.worldView;
    return {
      x: rect.left + ((u.pos.x * 96 + 48 - v.x) / v.width) * rect.width,
      y: rect.top + ((u.pos.y * 120 + 60 - v.y) / v.height) * rect.height,
    };
  });
  await jaPage.mouse.click(at.x, at.y);
}
await jaPage.waitForSelector('#unitpop:not(.hidden)', { timeout: 5000 });

const leak = await jaPage.evaluate(() => {
  const hangul = /[가-힣]/;
  const out: string[] = [];
  // **뿌리의 직계 텍스트만 훑으면 아무것도 안 본다** — 옛 `#hud`의 글자는 손자
  // (`.hud-top > .phase`)에 있어서, 직계만 보면 이 검사가 늘 통과한다(실제로 그랬다).
  // 그래서 뿌리 **안의 모든 원소**를 돌며 각자의 제 텍스트를 본다.
  // `title`(툴팁)까지 보는 이유도 같다 — 화면 글자만 훑으면 배지·카드의 설명문이 빠진다.
  /*
   * **전투 화면 전부를 훑는다.** 1차(로그 + 상시 표시 화면)에서는 `#control`·`#focus`가
   * 아직 한국어라 일부러 뺐고, **그 둘을 이 목록에 보태는 것이 2차의 완료 조건**이었다.
   * 2026-09-11 같은 날 2차를 끝내며 보탰다 — 이제 빠진 뿌리는 없다.
   *
   * ⚠ **이 훑기가 보는 것은 「지금 실제로 그려진 것」뿐이다.** 확인창·조준 안내처럼
   * 특정 상태에서만 나오는 문구는 여기까지 안 온다 — 그쪽은 `battleStrings.test.ts`가
   * 「아홉 언어에 키가 다 있는가」로 막는다. 둘의 역할이 갈리는 지점이다.
   */
  for (const root of document.querySelectorAll('#log, #unitpop, #focus, #intel, #order, #gameinfo, #cmd, #ctx')) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('');
      const tip = (el as HTMLElement).title ?? '';
      for (const s of [own, tip]) if (hangul.test(s)) out.push(s.trim().slice(0, 60));
    }
  }
  return [...new Set(out)];
});
if (leak.length) fail(`일본어 화면에 한글이 남았다 (${leak.length}건): ${leak.join(' | ')}`);
if (jaErrors.length) fail(`일본어 화면 콘솔 오류 ${jaErrors.length}건: ${jaErrors[0]}`);
const jaHud = await jaPage.evaluate(() =>
  [...document.querySelectorAll('#gameinfo .gi-army')].map((e) => e.textContent ?? ''));
// 「없는가」만 보면 화면이 통째로 비어도 통과한다 — 실제로 번역이 들어갔는지 함께 본다
if (!jaHud.some((s) => s.includes('北軍')) || !jaHud.some((s) => s.includes('南軍'))) {
  fail(`일본어 HUD 진영 이름이 안 나온다: [${jaHud.join(' ')}]`);
}
console.log(`✓ 다국어 — 일본어로 전투 화면 재확인, 한글 잔여 0건 (HUD ${jaHud.join(' · ')})`);
await jaPage.close();

if (errors.length) fail(`콘솔 오류 ${errors.length}건: ${errors[0]}`);
console.log('\n화면 연동 스모크 통과');
await browser.close();
