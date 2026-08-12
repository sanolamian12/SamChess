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
    // 이동 단계인가 — 판에 이동 범위만 뜨고 커맨드 패널은 아직 없는 구간
    moving: scene.debugMovePhase as boolean,
    // 커맨드 패널 — 판 안에 뜨는 플로팅 패널 (pptx 29쪽)
    modal: {
      hidden: document.getElementById('control')?.classList.contains('hidden') ?? true,
      name: document.querySelector('#control .cmd-who')?.textContent ?? '',
      note: document.querySelector('#control .cmd-note')?.textContent ?? '',
      slot: `${(document.getElementById('control') as HTMLElement)?.dataset.x}${(document.getElementById('control') as HTMLElement)?.dataset.y}`,
      min: document.getElementById('control')?.classList.contains('min') ?? false,
      shown: [...document.querySelectorAll('#control .cmd-buttons button')]
        .filter((b) => !b.classList.contains('hidden'))
        .map((b) => `${(b as HTMLElement).dataset.action}${(b as HTMLButtonElement).disabled ? '-' : '+'}`),
    },
    // 화면에 실제로 그려진 글자를 읽는다. 상태를 다시 계산하면 HUD가 죽어도 통과한다.
    hud: {
      clock: document.querySelector('#hud .clock')?.textContent ?? '',
      // SP는 「각각 숫자로」다 (pptx 27쪽) — 예전의 칸(pip)이 아니다
      north: document.querySelector('#hud .sp.p2 .num')?.textContent ?? '',
      south: document.querySelector('#hud .sp.p1 .num')?.textContent ?? '',
      armies: [...document.querySelectorAll('#hud .sp .tag')].map((e) => e.textContent ?? ''),
      more: !!document.querySelector('#hud button[data-action="history"]'),
    },
    // 카드 스트립 (pptx 27쪽). 화면이 실제로 그린 것을 읽는다.
    cards: scene.debugCards() as { unit: string; side: string; turn: boolean; down: boolean; skill: string }[],
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
      band: (document.getElementById('log') as HTMLElement)?.dataset.y ?? '',
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

// ── 이동 단계 (pptx 29쪽) ────────────────────────────────────
// 포커스를 받자마자 판에 **이동 범위만** 뜬다. 커맨드 패널은 아직 없어야 한다.
if (!snap.moving) fail('포커스를 받았는데 이동 단계가 아니다');
if (!snap.modal.hidden) fail('이동 단계인데 커맨드 패널이 떠 있다 — 이동을 먼저 고르게 해야 한다');
console.log('✓ 이동 단계 — 이동 범위만, 커맨드 패널 없음');

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
 * 이동 단계를 **제자리 대기**로 넘긴다 — 자기 칸을 누른다.
 *
 * 「이동 후(제자리에 있는 것 포함) 커맨드 패널이 표시된다」가 사양이므로(2026-08-12),
 * 이 경로도 실제로 도는지 여기서 확인한다. 엔진에 보내는 의도는 없다 —
 * 움직이지 않았는데 좌표가 바뀌면 화면이 몰래 수를 둔 것이다.
 */
const stayPut = async (s: NonNullable<Awaited<ReturnType<typeof probe>>>) => {
  if (!s.moving) return s;
  await settle();
  const self = await toScreen(s.pos!.x, s.pos!.y);
  await page.mouse.click(self.x, self.y);
  await page.waitForTimeout(200);
  const out = (await probe())!;
  if (out.phase !== 'awaitingInput') fail('제자리를 눌렀더니 턴이 끝났다');
  if (out.pos!.x !== s.pos!.x || out.pos!.y !== s.pos!.y) fail('제자리를 눌렀는데 움직였다');
  if (out.moving) fail('제자리를 눌러도 이동 단계가 끝나지 않는다');
  if (out.modal.hidden) fail('제자리 대기인데 커맨드 패널이 뜨지 않는다');
  // **제자리는 무를 수 있어야 한다** (2026-08-12 확정) — 아직 실제로 움직이지 않았고
  // 엔진도 이동을 허용하는데 화면에 통로가 없으면 그 턴이 통째로 갇힌다.
  if (!out.modal.shown.includes('move+')) {
    fail(`제자리 대기인데 「이동」으로 무를 수 없다: [${out.modal.shown.join(' ')}]`);
  }
  return out;
};

/** 제자리 대기를 「이동」으로 무른다 — 다시 이동 단계로 돌아와야 한다 */
const undoStay = async (): Promise<void> => {
  await page.click('#control button[data-action="move"]');
  await page.waitForTimeout(200);
  const back = (await probe())!;
  if (!back.moving) fail('「이동」을 눌러도 이동 단계로 돌아오지 않는다');
  if (!back.modal.hidden) fail('이동 단계로 돌아왔는데 커맨드 패널이 남아 있다');
};

/** 이동 단계를 넘긴 뒤 「대기」로 턴을 끝낸다. 패널은 이동 단계에 뜨지 않으므로 순서가 있다. */
const endTurnNow = async (): Promise<void> => {
  let s = await probe();
  if (s?.phase !== 'awaitingInput') return;
  s = await stayPut(s);
  if (!s.endTurnEnabled) return;
  await page.click('#control button[data-action="endTurn"]');
};

const dest = snap.moves[0]!;
await settle();
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

// 이동을 마치면 **비로소** 커맨드 패널이 뜬다. **실제로 움직였으므로 「이동」은 없다**
// — 엔진이 거부하는 수라서다 (제자리 대기였다면 남는다, 아래 `stayPut` 참조).
if (after.moving) fail('이동했는데 아직 이동 단계다');
if (after.modal.hidden) fail('이동을 마쳤는데 커맨드 패널이 뜨지 않는다');
if (after.modal.shown.some((s) => s.startsWith('move'))) {
  fail(`실제로 움직인 뒤인데 패널에 「이동」이 남아 있다: [${after.modal.shown.join(' ')}]`);
}
console.log(`✓ 이동 후 → 커맨드 패널 [${after.modal.shown.join(' ')}] (이동 없음)`);

// 이동만 한 상태에서 턴을 끝낼 수 있어야 한다.
// 공격 대상이 없고 MP도 가득이면 유효한 의도가 「대기」 하나뿐이라, 이게 잠기면 교착이다.
if (!after.endTurnEnabled) fail('「대기」가 잠겨 있다 — 이동만 하면 화면이 멈춘다');
const t0 = after.time;
await page.click('#control button[data-action="endTurn"]');
await page.waitForTimeout(2500);
const ended = await probe();
if (!ended || ended.time <= t0) fail(`턴 종료 후에도 시간이 흐르지 않았다 (${t0} → ${ended?.time})`);
console.log(`✓ 턴 종료 → 시간 진행 (${t0} → ${ended.time}), 다음 제어권 ${ended.activeUnit}`);

// ── HUD 한 줄 (pptx 27쪽) ────────────────────────────────────
// 「가장 상단에 절대시간(일수), 현재 차례 요약」 · 「북군 SP와 남군 SP는 각각 숫자로」
// · 「히스토리 확인 버튼: 오른쪽 상단으로」.

const hud = ended.hud;
if (!/^\d+\.\d일$/.test(hud.clock)) fail(`HUD 시계가 이상하다: "${hud.clock}"`);
for (const [label, text] of [['북군', hud.north], ['남군', hud.south]] as const) {
  if (!/^\d+$/.test(text)) fail(`${label} SP가 숫자가 아니다: "${text}"`);
}
// 진영 이름은 판의 위아래와 같아야 한다 — P2가 위쪽 5행이므로 북군이다
if (!hud.armies.some((t) => t.startsWith('북군')) || !hud.armies.some((t) => t.startsWith('남군'))) {
  fail(`HUD 진영 이름이 「북군/남군」이 아니다: [${hud.armies.join(' ')}]`);
}
const spState = await page.evaluate(() => {
  const st = (window as any).__battle.scene.debugPlayback.state;
  return { p1: st.sp.P1 as number, p2: st.sp.P2 as number };
});
if (Number(hud.north) !== spState.p2 || Number(hud.south) !== spState.p1) {
  fail(`HUD SP가 상태와 다르다 — 화면 북${hud.north}/남${hud.south}, 실제 P2 ${spState.p2}/P1 ${spState.p1}`);
}
if (!hud.more) fail('HUD 오른쪽 위에 「⋯」(대화 기록)이 없다 (pptx 27쪽)');
console.log(`✓ HUD — ${hud.clock}, 북군 SP ${hud.north} · 남군 SP ${hud.south}, ⋯ 있음`);

// ── 캐릭터 카드 스트립 (pptx 27쪽) ───────────────────────────
// 카드가 엔진 상태와 어긋나면 화면이 거짓말을 하는 것이다. 개수·진영·포커스를 대조한다.
{
  const want = await page.evaluate(() => {
    const st = (window as any).__battle.scene.debugPlayback.state;
    const units = Object.values(st.units as Record<string, any>);
    return {
      total: units.length,
      north: units.filter((u: any) => u.side === 'P2').length,
      active: st.activeUnit as string | null,
      dead: units.filter((u: any) => !u.alive).map((u: any) => u.id as string),
    };
  });
  const cards = ended.cards;
  if (cards.length !== want.total) fail(`카드 수가 다르다 — 화면 ${cards.length}장, 유닛 ${want.total}명`);
  if (cards.filter((c) => c.side === 'P2').length !== want.north) {
    fail('북군 카드 수가 P2 유닛 수와 다르다');
  }
  // 「캐릭터 대기 시간 0 되면 해당 캐릭터 카드에 포커스」
  const focused = cards.filter((c) => c.turn).map((c) => c.unit);
  if (want.active && (focused.length !== 1 || focused[0] !== want.active)) {
    fail(`차례 포커스가 제어권 유닛(${want.active})과 다르다: [${focused.join(' ')}]`);
  }
  // 「전투 불능 상태가 되었을 때 [퇴각] 아이콘 표출, 고유기술 버튼 disabled」
  for (const id of want.dead) {
    const card = cards.find((c) => c.unit === id);
    if (card && !card.down) fail(`${id}가 쓰러졌는데 카드에 [퇴각]이 없다`);
  }
  // 고유기술 색 3종은 27쪽이 못 박은 사양이다 (주황 = SP 부족 / 초록 = 준비 / 회색 = 사용함)
  const bad = cards.filter((c) => !['ready', 'poor', 'used', 'none'].includes(c.skill));
  if (bad.length > 0) fail(`고유기술 버튼 상태가 이상하다: ${JSON.stringify(bad)}`);
  const counts = cards.reduce<Record<string, number>>(
    (n, c) => ({ ...n, [c.skill]: (n[c.skill] ?? 0) + 1 }), {});
  console.log(`✓ 카드 스트립 — ${cards.length}장 (북군 ${want.north}), 포커스 ${focused[0] ?? '없음'}, 고유기술 ${JSON.stringify(counts)}`);
}

// ── 시스템 대화 말풍선 (pptx 27쪽) ───────────────────────────
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
  // **최근 한 줄만** 띄운다 (2026-08-12 확정) — 판 위에 겹쳐 뜨므로 쌓으면 판이 가려진다
  if (seen.shown > 1) fail(`말풍선이 ${seen.shown}줄이다 — 판 한가운데에는 최근 한 줄만 띄운다`);
  console.log(`✓ 대화 말풍선 ${seen.lines.length}줄 기록 (화면 ${seen.shown}줄) — "${seen.lines[seen.lines.length - 1]}"`);

  /*
   * 말풍선이 판 위에 뜨므로 **패널과 겹치면 안 된다.**
   *
   * 가로는 3/8 + 1/4 + 3/8이고 패널 높이는 판의 0.6배라, 말풍선을 패널의 반대쪽 띠에
   * 놓는 것으로 겹침을 막는다. 그 규칙이 실제로 도는지 사각형을 재서 확인한다.
   */
  const overlap = await page.evaluate(() => {
    const log = document.querySelector('#log .log-line')?.getBoundingClientRect();
    if (!log) return -1;
    const hit = (el: Element | null): boolean => {
      if (!el || el.classList.contains('hidden')) return false;
      const r = el.getBoundingClientRect();
      return !(r.right <= log.left || r.left >= log.right || r.bottom <= log.top || r.top >= log.bottom);
    };
    return [document.getElementById('control'), document.getElementById('inspect')]
      .filter(hit).length;
  });
  if (overlap > 0) fail(`말풍선이 패널과 겹친다 (${overlap}개) — #log의 data-y가 패널 반대쪽이 아니다`);
  console.log(`✓ 말풍선은 패널과 겹치지 않는다 (띠 ${(await probe())!.log.band})`);

  // 「⋯」를 누르면 전체 기록이 펼쳐지고 「그 아래 [항복]」이 있다 (27쪽)
  await page.click('#hud button[data-action="history"]');
  await page.waitForTimeout(200);
  const hist = await page.evaluate(() => ({
    open: document.getElementById('history')?.classList.contains('hidden') === false,
    lines: document.querySelectorAll('#history .hist-line').length,
    surrender: !!document.querySelector('#history .hist-surrender'),
  }));
  if (!hist.open) fail('「⋯」를 눌러도 전체 기록이 열리지 않는다');
  if (!hist.surrender) fail('전체 기록 아래에 「항복」이 없다 (pptx 27쪽)');
  await page.click('#history .hist-close');
  await page.waitForTimeout(150);
  if (await page.evaluate(() => !document.getElementById('history')?.classList.contains('hidden'))) {
    fail('전체 기록이 닫히지 않는다');
  }
  console.log(`✓ 대화 전체 기록 — ${hist.lines}줄 + 항복, 열고 닫기`);
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
mineSnap = await stayPut(mineSnap);
console.log(`✓ 제자리 대기 → 커맨드 패널 (${mineSnap.pos!.x},${mineSnap.pos!.y}) 유지, 「이동」으로 무를 수 있음`);

// 무르고 다시 들어와도 같은 자리여야 한다 — 화면만의 상태가 엔진을 건드리면 안 된다
await undoStay();
mineSnap = await stayPut((await probe())!);
if (mineSnap.moved) fail('제자리를 물렀다 다시 대기했는데 엔진이 이동으로 셌다');
console.log('✓ 제자리 대기 무르기 → 이동 단계 복귀 → 다시 대기 (엔진 상태 그대로)');

const modal = mineSnap.modal;
if (modal.hidden) fail('내 차례인데 커맨드 패널이 숨겨져 있다');
if (!/ · (King|Rock|Bishop|Knight|Queen|Pawn)$/.test(modal.name)) {
  fail(`패널 머리가 「이름 · 기물」이 아니다: "${modal.name}"`);
}
// 29쪽의 세로 5줄에서 「이동」이 빠진 넷. 「종료」는 「대기」로 이름만 바뀌었고 의도는 endTurn.
for (const action of ['attack', 'castTactic', 'meditate', 'endTurn']) {
  if (!modal.shown.some((s) => s.startsWith(action))) fail(`「${action}」 버튼이 없다`);
}
if (modal.shown.some((s) => s.startsWith('forceSkipTurn'))) fail('내 차례에 「턴 넘기기」가 보인다');
console.log(`✓ 커맨드 패널(내 차례) — ${modal.name}, 자리 ${modal.slot}, 버튼 [${modal.shown.join(' ')}]`);

// ── 패널 자리와 크기 (pptx 29쪽) ─────────────────────────────
// 「너비는 체스판 길이의 ×0.375, 높이는 ×0.6」 · 「상태 팝업과 대칭」 ·
// 「제어권 기물을 덮지 않는다」 — 이 셋은 재 보면 바로 드러난다.
{
  const geom = await page.evaluate(() => {
    const board = document.getElementById('board')!.getBoundingClientRect();
    const ctl = document.getElementById('control')!;
    const ins = document.getElementById('inspect')!;
    const r = ctl.getBoundingClientRect();
    return {
      board: board.width,
      w: r.width, h: r.height,
      ctl: { x: ctl.dataset.x, y: ctl.dataset.y },
      ins: { x: ins.dataset.x, y: ins.dataset.y },
    };
  });
  const near = (got: number, want: number): boolean => Math.abs(got - want) <= 1.5;
  if (!near(geom.w, geom.board * 0.375)) fail(`커맨드 패널 너비가 판의 3/8이 아니다 (${geom.w.toFixed(1)} vs ${(geom.board * 0.375).toFixed(1)})`);
  if (!near(geom.h, geom.board * 0.6)) fail(`커맨드 패널 높이가 판의 3/5가 아니다 (${geom.h.toFixed(1)} vs ${(geom.board * 0.6).toFixed(1)})`);
  if (geom.ins.x === geom.ctl.x) fail(`상태 팝업이 커맨드와 대칭이 아니다 (둘 다 ${geom.ctl.x})`);
  if (geom.ins.y !== geom.ctl.y) fail('두 패널이 서로 다른 세로 띠에 있다 — 하나는 기물을 덮게 된다');
  console.log(`✓ 패널 — ${geom.w.toFixed(0)}×${geom.h.toFixed(0)} (판 ${geom.board.toFixed(0)}), 커맨드 ${geom.ctl.x}${geom.ctl.y} ↔ 상태 ${geom.ins.x}${geom.ins.y}`);

  // 「패널 우상단에는 최소화 버튼」 — 접으면 높이가 판의 1/10
  await page.click('#control button[data-action="minimize"]');
  await page.waitForTimeout(280);            // transition .16s
  const min = await page.evaluate(() => document.getElementById('control')!.getBoundingClientRect().height);
  if (!near(min, geom.board * 0.1)) fail(`최소화 높이가 판의 1/10이 아니다 (${min.toFixed(1)} vs ${(geom.board * 0.1).toFixed(1)})`);
  await page.click('#control button[data-action="minimize"]');
  await page.waitForTimeout(280);
  console.log(`✓ 최소화 — ${min.toFixed(0)}px (판의 1/10), 되돌리기까지`);
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
 * 「공격」을 눌러야 공격 범위가 뜬다 (2026-08-12 확정).
 *
 * 예전에는 아무 모드도 아닐 때 이동 범위와 공격 범위가 **함께** 떠서 무엇을 고르는
 * 중인지가 흐려졌다. 지금은 한 번에 한 가지만 칠한다 —
 * 누르기 전에는 칠할 것이 없고, 누르면 공격 대상만 남는다.
 */
{
  const before = await page.evaluate(() =>
    (window as any).__battle.scene.debugChoosableCells() as { x: number; y: number }[]);
  if (before.length > 0) {
    fail(`행동 단계인데 아무것도 안 눌렀는데 고를 칸이 ${before.length}개 있다`);
  }
  await page.click('#control button[data-action="attack"]');
  await page.waitForTimeout(200);
  const armed = await page.evaluate(() => ({
    mode: (window as any).__battle.scene.debugActionMode as string,
    cells: (window as any).__battle.scene.debugChoosableCells() as { x: number; y: number }[],
    marks: (window as any).__battle.scene.debugMarkCommands() as number,
  }));
  if (armed.mode !== 'attack') fail('「공격」을 눌러도 모드가 켜지지 않는다');
  // 대상이 없어도 **사거리는 보여야 한다** — 그게 「공격」을 항상 눌리게 둔 이유다
  if (armed.marks === 0) fail('「공격」을 눌렀는데 판에 아무것도 칠해지지 않았다');
  console.log(`✓ 「공격」 → 공격 범위 표시 (대상 후보 ${armed.cells.length}칸)`);

  // 공격 중에도 **포커스가 그 기물에 머문다** (2026-08-12 기획자 지정) —
  // 공격 대상은 언제나 인접 칸이라 확대한 채로도 다 보인다
  const camIn = (await probe())!;
  if (camIn.camera.scale <= 1) fail('「공격」을 눌렀더니 화면이 판 전체로 물러났다');
  console.log(`✓ 「공격」 중에도 포커스 유지 (${camIn.camera.scale * 100}%)`);

  /*
   * 「공격 범위 안에 적이 없을 때는 「뒤로」 하나만」 (2026-08-12 기획자 지정).
   * 안내문만 띄우고 다른 버튼을 그대로 두면 「될 것 같은데 안 된다」로 읽힌다.
   */
  if (armed.cells.length === 0) {
    const dead = (await probe())!.modal;
    if (dead.shown.length !== 1 || !dead.shown[0]!.startsWith('back')) {
      fail(`적이 없는데 버튼이 [${dead.shown.join(' ')}]다 — 「뒤로」 하나만 남아야 한다`);
    }
    await page.click('#control button[data-action="back"]');
    await page.waitForTimeout(200);
    if (await page.evaluate(() => (window as any).__battle.scene.debugActionMode) !== 'idle') {
      fail('「뒤로」를 눌러도 이전 커맨드로 돌아오지 않는다');
    }
    console.log('✓ 공격 범위에 적이 없음 → 「뒤로」 하나만, 눌러서 복귀');
  } else {
    await page.click('#control button[data-action="attack"]');   // 다시 눌러 해제
    await page.waitForTimeout(150);
    if (await page.evaluate(() => (window as any).__battle.scene.debugActionMode) !== 'idle') {
      fail('「공격」을 다시 눌러도 꺼지지 않는다');
    }
    console.log('✓ 「공격」 모드 토글');
  }
}

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
        name: root.querySelector('.cmd-who')?.textContent ?? '',
        shown: [...root.querySelectorAll('.cmd-buttons button')]
          .filter((b) => !b.classList.contains('hidden'))
          .map((b) => `${(b as HTMLButtonElement).dataset.action}${(b as HTMLButtonElement).disabled ? '-' : '+'}`),
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
  await endTurnNow();
  const away = await catchOpponent(4000);
  if (!away) continue;

  if (away.hidden) fail('상대 차례인데 커맨드 패널이 숨겨져 있다');
  if (!away.name.includes('제어 중')) fail(`상대 제어 안내가 없다: "${away.name}"`);
  // 상대 차례에는 행동 버튼이 아니라 「턴 넘기기」만 나와야 한다
  if (away.shown.some((s) => s.startsWith('move') || s.startsWith('endTurn'))) {
    fail(`상대 차례에 내 행동 버튼이 보인다: [${away.shown.join(' ')}]`);
  }
  // 20초 전에는 잠겨 있어야 한다 (GDD §3.3)
  if (away.shown.includes('forceSkipTurn+')) fail('20초 전인데 「턴 넘기기」가 열려 있다');
  console.log(`✓ 커맨드 패널(상대 차례) — "${away.name}", 버튼 [${away.shown.join(' ')}]`);
  break;
}

// ── 턴 흐름 (GDD §3.4 · pptx 29쪽) ───────────────────────────
// 고유기술을 먼저 묻고 → 이동 → 공격/책략/명상/대기.
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
  await endTurnNow();
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

// [2] 제자리 대기로 이동 단계를 넘긴다 — 그래야 커맨드 패널이 뜬다
s = await stayPut((await probe())!);
if (!s.modal.shown.includes('castTactic+')) fail('제자리 대기인데 「책략」이 잠겨 있다');
const kept = s.pos!;

// [3] 책략 — 목록 → 조준 → 시전. 상태이상이 실제로 붙는지까지 본다.
await page.click('#control button[data-action="castTactic"]');
await page.waitForTimeout(150);
const list = await page.evaluate(() => [...document.querySelectorAll('#control .cmd-list .tactic')]
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

await page.click(`#control .cmd-list .tactic[data-tactic="${usable.id}"]`);
await page.waitForTimeout(150);
const aim = await page.evaluate(() => ({
  cells: (window as any).__battle.scene.debugAimCells() as { x: number; y: number }[],
  marks: (window as any).__battle.scene.debugMarkCommands() as number,
  note: document.querySelector('#control .cmd-note')?.textContent ?? '',
}));
if (aim.cells.length === 0) fail(`「${usable.id}」 조준 후보가 하나도 칠해지지 않았다`);
// 조준 후보는 **유닛이 서 있는 칸**이다. 칸을 채우기만 하면 초상화(depth 10)가 그대로 덮어
// 화면에서는 아무것도 안 보인다. 유닛 위층(depth 15)에 테두리를 그렸는지 확인한다.
if (aim.marks === 0) fail('조준 후보가 유닛 위에 표시되지 않는다 — 초상화에 가려 보이지 않는다');
console.log(`✓ [3] 조준 모드 — 후보 ${aim.cells.length}칸(유닛 위 표시 확인), "${aim.note}"`);

/*
 * 대상은 **카드로** 고른다 (2026-08-12 기획자 지정).
 *
 * 시전 중에는 카메라가 시전자에 붙어 있어서 판 반대편의 대상은 화면 밖이다 —
 * 안 보이는 것은 누를 수도 없다. 카드는 판 바깥이라 언제나 눌린다.
 */
const target = aim.cells[0]!;
const targetId = await page.evaluate((c) => {
  const st = (window as any).__battle.scene.debugPlayback.state;
  const u = Object.values(st.units as Record<string, any>)
    .find((x: any) => x.alive && x.pos.x === c.x && x.pos.y === c.y) as any;
  return (u?.id ?? null) as string | null;
}, target);
if (!targetId) fail(`조준 후보 (${target.x},${target.y})에 기물이 없다`);
await page.click(`.uc[data-unit="${targetId}"]`);
await page.waitForTimeout(300);

/*
 * 시전 확인창 — 「이름 · 효과 · 발동 확률」 + [확정][취소].
 * 확률은 엔진의 `illusionChance()`가 낸 값이라 화면이 따로 계산하지 않는다.
 */
{
  const box = await page.evaluate(() => {
    const p = document.querySelector('#dialog .cast-confirm');
    return {
      shown: !!p,
      name: p?.querySelector('.ask')?.textContent ?? '',
      text: p?.querySelector('.ask-text')?.textContent ?? '',
      rate: p?.querySelector('.ask-rate .v')?.textContent ?? '',
      buttons: [...(p?.querySelectorAll('button') ?? [])].map((b) => b.dataset.action ?? ''),
      band: (document.getElementById('dialog') as HTMLElement)?.dataset.y ?? '',
    };
  });
  if (!box.shown) fail('대상을 골랐는데 시전 확인창이 뜨지 않는다');
  if (box.text.length < 5) fail(`확인창에 효과 설명이 없다: "${box.text}"`);
  if (!/^\d+%$/.test(box.rate)) fail(`환술인데 발동 확률이 없다: "${box.rate}"`);
  if (!box.buttons.includes('commitCast') || !box.buttons.includes('cancelCast')) {
    fail(`[확정][취소]가 아니다: [${box.buttons.join(' ')}]`);
  }
  // 확인창이 뜬 동안 카메라는 **대상**을 비춘다
  const cam = (await probe())!.camera;
  if (cam.cell?.x !== target.x || cam.cell?.y !== target.y) {
    fail(`확인창 중 카메라가 대상을 안 비춘다 — ${JSON.stringify(cam.cell)} vs (${target.x},${target.y})`);
  }
  console.log(`✓ [3] 확인창 — ${box.name} 발동 확률 ${box.rate}, 대상 포커스, 띠 ${box.band}`);

  // [취소]는 아무것도 쏘지 않고 조준으로 돌아간다
  await page.click('#dialog button[data-action="cancelCast"]');
  await page.waitForTimeout(250);
  const back = await page.evaluate(() => ({
    box: !!document.querySelector('#dialog .cast-confirm'),
    mode: (window as any).__battle.scene.debugActionMode as string,
    mp: (() => {
      const st = (window as any).__battle.scene.debugPlayback.state;
      return st.units[st.activeUnit].mp as number;
    })(),
  }));
  if (back.box) fail('[취소]를 눌러도 확인창이 남아 있다');
  if (back.mode !== 'aim') fail(`[취소] 뒤에도 조준 상태여야 한다 (지금 ${back.mode})`);
  if (back.mp !== mpBefore) fail(`[취소]했는데 MP가 줄었다 (${mpBefore} → ${back.mp})`);
  console.log('✓ [3] [취소] → 아무것도 쏘지 않고 조준으로 복귀');

  // 다시 고르고 이번엔 [확정]
  await page.click(`.uc[data-unit="${targetId}"]`);
  await page.waitForTimeout(250);
  await page.click('#dialog button[data-action="commitCast"]');
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
 * 연출 중에는 커맨드 패널이 물러난다 (2026-08-12 기획자 지적).
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
        if (!document.getElementById('control')!.classList.contains('hidden')) shown++;
      }
      if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
      else resolve({ frames, shown });
    };
    requestAnimationFrame(tick);
  }));
  if (flash.frames === 0) {
    console.log('· 연출 중 패널 — 연출 구간을 잡지 못해 건너뜀');
  } else if (flash.shown > 0) {
    fail(`연출이 도는 동안 커맨드 패널이 ${flash.shown}/${flash.frames} 프레임 떠 있었다 — 두 번 깜빡인다`);
  } else {
    console.log(`✓ 연출 중에는 커맨드 패널이 물러난다 (${flash.frames}프레임 확인)`);
  }
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
 * 상대 기물은 **카드로** 열어 본다 (pptx 28쪽).
 *
 * 「사용자가 체스판 바깥에 적군 카드나 아군 카드를 클릭했을 때, 해당 캐릭터가 있는
 * 체스판 위치로 이동하면서 상태 팝업 표시」 — 이게 화면 밖 기물을 살펴보는 정식 경로다.
 * 내 차례에는 카메라가 제어권 기물에 200%로 붙어 있어서 판 반대편 적은 아예 안 보이고,
 * 안 보이는 것은 누를 수도 없다. 카드가 그 통로다.
 */
const other = await page.evaluate(() => {
  const st = (window as any).__battle.scene.debugPlayback.state;
  const units = Object.values(st.units as Record<string, any>);
  const u = (units.find((x: any) => x.alive && x.side === 'P2')
    ?? units.find((x: any) => x.alive && x.id !== st.activeUnit)) as any;
  return u ? { id: u.id as string, x: u.pos.x as number, y: u.pos.y as number } : null;
});
if (!other) fail('들여다볼 다른 유닛이 없다');
await page.click(`#cards-north .uc[data-unit="${other.id}"]`);
await settle(6000);      // 앞선 책략 연출이 아직 돌고 있으면 카메라는 그 계획을 따라간다
await page.waitForTimeout(250);
// 「해당 캐릭터가 있는 체스판 위치로 이동하면서」 — 카메라가 그 기물을 겨눠야 한다
{
  const cam = (await probe())!.camera;
  if (cam.scale <= 1 || cam.cell?.x !== other.x || cam.cell?.y !== other.y) {
    fail(`카드를 눌렀는데 카메라가 그 기물로 가지 않았다 — ${JSON.stringify(cam)}, 기물 (${other.x},${other.y})`);
  }
  console.log(`✓ 카드 클릭 → 카메라 이동 — ${other.id} (${other.x},${other.y}) ${cam.scale * 100}%`);
}
const inspect = await page.evaluate(() => {
  const p = document.getElementById('inspect');
  return {
    open: !!p && !p.classList.contains('hidden'),
    piece: p?.querySelector('.ins-title .pc')?.textContent ?? '',
    side: p?.querySelector('.ins-title .side')?.textContent ?? '',
    name: p?.querySelector('.ins-title .nm')?.textContent ?? '',
    level: p?.querySelector('.ins-title .lv')?.textContent ?? '',
    grade: p?.querySelector('.ins-title .grade')?.textContent ?? '',
    base: p?.querySelector('.ins-base')?.textContent ?? '',
    // 등급은 **맨 위 왼쪽**이어야 한다 (2026-08-12 기획자 지정)
    gradeFirst: p?.querySelector('.ins-title .row:first-child .grade') !== null,
    closeWithGrade: p?.querySelector('.ins-title .row:first-child .ins-close') !== null,
    // 사진은 패널 너비의 **절반인 정사각**
    art: (() => {
      const img = p?.querySelector('.ins-portrait') as HTMLElement | null;
      if (!img || !p) return null;
      const a = img.getBoundingClientRect();
      return { w: a.width, h: a.height, panel: p.getBoundingClientRect().width };
    })(),
    stats: p?.querySelectorAll('.ins-stats .stat').length ?? 0,
    skill: p?.querySelector('.ins-skill .nm')?.textContent ?? '',
    tactics: p?.querySelectorAll('.ins-tactics .chip').length ?? 0,
    hidden: !!p?.querySelector('.ins-hidden'),
    statuses: p?.querySelectorAll('.ins-status .st').length ?? 0,
  };
});
if (!inspect.open) fail('기물을 눌러도 상태 팝업이 뜨지 않는다');
if (!/^(King|Rock|Bishop|Knight|Queen|Pawn)$/.test(inspect.piece)) {
  fail(`팝업에 기물명이 없다: "${inspect.piece}"`);
}
if (inspect.name.length === 0) fail('팝업에 장수명이 없다');
if (!/^Lv\d+$/.test(inspect.level)) fail(`팝업 레벨이 이상하다: "${inspect.level}"`);
if (!/^[SABCDE]$/.test(inspect.grade)) fail(`팝업 등급이 이상하다: "${inspect.grade}"`);
if (!inspect.gradeFirst) fail('등급이 맨 윗줄에 없다');
if (!inspect.closeWithGrade) fail('닫기 버튼이 등급과 같은 줄에 없다');
if (!/무력 \d+ · 지력 \d+ · 통솔 \d+/.test(inspect.base)) fail(`팝업 능력치 줄이 없다: "${inspect.base}"`);
// 「사진은 전체 패널 너비의 절반이 되는 정사각형」
if (!inspect.art) fail('팝업에 사진 자리가 없다');
else {
  const half = inspect.art.panel / 2;
  if (Math.abs(inspect.art.w - inspect.art.h) > 1) fail(`사진이 정사각이 아니다 (${inspect.art.w.toFixed(1)}×${inspect.art.h.toFixed(1)})`);
  if (Math.abs(inspect.art.w - half) > 4) fail(`사진 너비가 패널의 절반이 아니다 (${inspect.art.w.toFixed(1)} vs ${half.toFixed(1)})`);
}
// 28쪽의 2×2 — HP·AT / MP·WT
if (inspect.stats !== 4) fail(`팝업 상태 칸이 4개가 아니다 (${inspect.stats}개)`);
// **「상대가 가지고 있는 책략 목록은 보여주지 않음 (전략적 목적)」** (28쪽)
const enemy = inspect.side === '적군';
if (enemy && inspect.tactics > 0) fail(`적군인데 보유 책략 ${inspect.tactics}종이 노출됐다 (pptx 28쪽 위반)`);
if (enemy && !inspect.hidden) fail('적군 책략을 가렸으면 그 이유를 적어야 한다');
console.log(`✓ 상태 팝업 — [${inspect.grade}] ${inspect.piece} ${inspect.side} / ${inspect.name} ${inspect.level}, 사진 ${inspect.art!.w.toFixed(0)}² (패널 ${inspect.art!.panel.toFixed(0)}), 책략 ${enemy ? '가림' : `${inspect.tactics}종`}`);

// 고유기술은 이름만 뜨고 **눌러야** 설명이 나온다 (28쪽 「클릭을 하면 설명 보여줌」)
if (inspect.skill) {
  await page.click('#inspect .ins-skill');
  await page.waitForTimeout(150);
  const tip = await page.evaluate(() => ({
    open: document.getElementById('tip')?.classList.contains('hidden') === false,
    body: document.querySelector('#tip .tip-body')?.textContent ?? '',
  }));
  if (!tip.open) fail('고유기술을 눌러도 설명이 뜨지 않는다');
  if (tip.body.length < 5) fail(`고유기술 설명이 비어 있다: "${tip.body}"`);
  await page.click('#tip .tip-close');
  console.log(`✓ 고유기술 설명 — ${inspect.skill}: ${tip.body.slice(0, 24)}…`);
}

// 닫기 단추로 닫힌다
await page.click('#inspect .ins-close');
await page.waitForTimeout(150);
if (await page.evaluate(() => !document.getElementById('inspect')?.classList.contains('hidden'))) {
  fail('닫기를 눌러도 팝업이 남아 있다');
}
console.log('✓ 상태 팝업 닫기');

// ── 고유기술 발동 연출 (pptx 23·24쪽) ────────────────────────
// 물음에 「예」 → 연출 배너가 뜨고 그동안 판이 멈춘다. 연출이 안 뜨면 무엇이 터졌는지
// 알 수 없고, 멈추지 않으면 볼 겨를도 없이 다음 상태로 넘어간다.

await page.goto(`${BASE}/?demo=1&seed=3&mode=3v3&side=P1&sp=25`, { waitUntil: 'networkidle' });
s = await wait('awaitingInput');
if (s?.phase !== 'awaitingInput') fail('연출 확인용 판에서 내 차례가 오지 않았다');

prompt = await ask();
for (let i = 0; i < 8 && !prompt.shown; i++) {
  await endTurnNow();
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

// ── 버프/디버프 배지 설명 ─────────────────────────────────────
// 배지를 누르면 그 뜻이 팝업으로 뜬다. 이름·설명의 출처는 엔진의 STATUS_META다.
// 배지는 이제 상태 팝업에만 있다 — 커맨드 패널에는 능력치·상태를 두지 않는다 (29쪽).

const chipTarget = await page.evaluate(() => {
  const st = (window as any).__battle.scene.debugPlayback.state;
  const u = Object.values(st.units as Record<string, any>)
    .find((x: any) => x.alive && (x.statuses.length > 0 || x.control)) as any;
  return u ? { id: u.id as string, x: u.pos.x as number, y: u.pos.y as number } : null;
});
if (chipTarget) {
  await settle();
  const at = await toScreen(chipTarget.x, chipTarget.y);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(200);
}
const chip = await page.evaluate(() => {
  const el = document.querySelector('#inspect .ins-status .st') as HTMLElement | null;
  return el ? { status: el.dataset.status ?? '', text: el.textContent ?? '' } : null;
});
if (chip) {
  await page.click('#inspect .ins-status .st');
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
