/**
 * 첫 편성의 배치 미션 — King과 Rock 바꾸기 (`src/screens/deployMission.ts`, 2026-11-13 · 몸짓은 2026-11-18 장수 카드로).
 * 기본 배치(King 왼쪽 · Rock 가운데 · Queen 오른쪽)에서 표지대로 누르면 King의 카드 한 번 + 칸 한 번에 끝나고, 손이 벗어나도 끝에 닿는다.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { SquadCell } from '@samchess/meta';
import type { PieceType, Vec2 } from '@samchess/rules';
import { defaultDeployPos } from '@samchess/rules';
import { missionTarget, swapDone } from '../src/screens/deployMission.ts';
import type { SwapGoal } from '../src/screens/deployMission.ts';

const L = defaultDeployPos('3v3', 'P1', 0);
const C = defaultDeployPos('3v3', 'P1', 1);
const R = defaultDeployPos('3v3', 'P1', 2);
const goal: SwapGoal = { center: C, left: L, other: 'Rock' };
const start = (): SquadCell[] => [
  { piece: 'King', ...L }, { piece: 'Rock', ...C }, { piece: 'Queen', ...R },
];
/** 화면의 `place()`와 같은 셈 — 우리 장수가 선 칸이면 둘이 자리를 바꾼다 */
const place = (cells: SquadCell[], piece: PieceType, to: Vec2): SquadCell[] => {
  const me = cells.find((c) => c.piece === piece)!;
  const other = cells.find((c) => c.x === to.x && c.y === to.y && c.piece !== piece);
  return cells.map((c) => (c.piece === piece ? { ...c, ...to } : other && c.piece === other.piece ? { ...c, x: me.x, y: me.y } : c));
};

/** 표지대로 누른다 — 단추면 그 장수의 차례를 켜고, 칸이면 그 장수를 세우고 차례를 끈다(한 명씩). 누른 수를 센다 */
function follow(cells: SquadCell[], limit = 12): { cells: SquadCell[]; taps: number } {
  let turn: PieceType | null = null;
  let taps = 0;
  for (; taps < limit; taps++) {
    const m = missionTarget(cells, goal, turn);
    if (!m) break;
    if (m.kind === 'button') { turn = m.piece; continue; }
    assert.notEqual(turn, null, '차례가 꺼져 있는데 칸을 가리킨다');
    cells = place(cells, turn!, m.at);
    turn = null;
  }
  return { cells, taps };
}

test('기본 배치에서 표지대로 누르면 King의 카드 → 가운데 칸, 두 번에 King이 가운데 · Rock이 왼쪽', () => {
  const s = start();
  assert.deepEqual(missionTarget(s, goal, null), { kind: 'button', piece: 'King' });
  assert.deepEqual(missionTarget(s, goal, 'King'), { kind: 'cell', at: C });
  const { cells, taps } = follow(s);
  assert.equal(taps, 2);
  assert.ok(swapDone(cells, goal));
  assert.equal(missionTarget(cells, goal, null), null);
  assert.deepEqual(cells.find((c) => c.piece === 'Queen'), { piece: 'Queen', ...R }, 'Queen은 안 움직였다');
});

test('손이 벗어나도(King을 엉뚱한 데 놓음) 지금 자리 · 차례에서 다시 내어 끝에 닿는다', () => {
  // King 차례에 빈 칸을 눌렀다 — 표지는 다시 King의 카드, Rock 차례면 왼쪽(빈 칸), 상관없는 Queen 차례면 제 칸
  let cells = place(start(), 'King', { x: 5, y: 19 });
  assert.deepEqual(missionTarget(cells, goal, null), { kind: 'button', piece: 'King' });
  assert.deepEqual(missionTarget(cells, goal, 'Rock'), { kind: 'cell', at: L });
  assert.deepEqual(missionTarget(cells, goal, 'Queen'), { kind: 'cell', at: R }, '상관없는 장수는 제 칸(그대로 두기)');
  cells = follow(cells).cells;
  assert.ok(swapDone(cells, goal));
});

test('Queen이 가운데에 섰어도 바꾸기 두 번으로 끝낸다', () => {
  const s: SquadCell[] = [{ piece: 'King', ...L }, { piece: 'Rock', x: 10, y: 15 }, { piece: 'Queen', ...C }];
  const { cells, taps } = follow(s);
  assert.ok(swapDone(cells, goal));
  assert.equal(taps, 4, 'King 카드 · King ↔ Queen · Rock 카드 · Rock ↔ Queen');
});
