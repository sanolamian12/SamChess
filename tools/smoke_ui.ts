/**
 * 화면 연동 스모크 테스트 — 클릭이 실제 판정으로 이어지는지 확인한다.
 *
 *   node --experimental-strip-types tools/smoke_ui.ts
 *
 * `npm test`(순수 로직)로는 잡히지 않는 층을 본다: 화면 좌표 → 격자 좌표 → `Intent` →
 * 룰 엔진. 좌표 변환이 한 칸 어긋나거나 카메라 줌 계산이 틀리면 여기서 걸린다.
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
  const scene = (window as any).__battle.scene;
  if (!scene) return null;
  const pb = scene.debugPlayback;
  const s = pb.state;
  const u = s.activeUnit ? s.units[s.activeUnit] : null;
  return {
    phase: pb.phase as string,
    time: s.time as number,
    activeUnit: s.activeUnit as string | null,
    moved: (s.activeTurn?.moved ?? false) as boolean,
    pos: u ? { x: u.pos.x as number, y: u.pos.y as number } : null,
    moves: scene.debugLegalMoves() as { x: number; y: number }[],
  };
});

// 사람 차례가 올 때까지 대기
const deadline = Date.now() + 20_000;
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

if (errors.length) fail(`콘솔 오류 ${errors.length}건: ${errors[0]}`);
console.log('\n화면 연동 스모크 통과');
await browser.close();
