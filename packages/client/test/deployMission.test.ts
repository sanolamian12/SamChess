/**
 * 첫 편성의 배치 미션 — King과 Rock 바꾸기 (`src/screens/deployMission.ts`, 2026-11-13).
 * 기본 배치(King 왼쪽 · Rock 가운데 · Queen 오른쪽)에서 미션이 시키는 대로 옮기면 세 번에 끝나고, 손이 벗어나도 끝에 닿는다.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { SquadCell } from '@samchess/meta';
import { defaultDeployPos, deployZone } from '@samchess/rules';
import { nextSwapMove, swapDone } from '../src/screens/deployMission.ts';
import type { SwapGoal } from '../src/screens/deployMission.ts';

const L = defaultDeployPos('3v3', 'P1', 0);
const C = defaultDeployPos('3v3', 'P1', 1);
const R = defaultDeployPos('3v3', 'P1', 2);
const goal: SwapGoal = { center: C, left: L, other: 'Rock', zone: deployZone('3v3', 'P1') };
const start = (): SquadCell[] => [
  { piece: 'King', ...L }, { piece: 'Rock', ...C }, { piece: 'Queen', ...R },
];
const apply = (cells: SquadCell[], m: { piece: string; to: { x: number; y: number } }): SquadCell[] =>
  cells.map((c) => (c.piece === m.piece ? { ...c, ...m.to } : c));

test('기본 배치에서 시키는 대로 옮기면 세 번에 King이 가운데 · Rock이 왼쪽', () => {
  let cells = start();
  assert.equal(swapDone(cells, goal), false);
  const moves = [];
  for (let i = 0; i < 5; i++) {
    const m = nextSwapMove(cells, goal);
    if (!m) break;
    moves.push(m.piece);
    // 비켜 두는 칸은 구역 안의 빈 칸이고 가운데 · 왼쪽 자리가 아니다
    assert.ok(!cells.some((c) => c.x === m.to.x && c.y === m.to.y), `빈 칸이 아니다 ${JSON.stringify(m)}`);
    cells = apply(cells, m);
  }
  assert.deepEqual(moves, ['Rock', 'King', 'Rock']);
  assert.ok(swapDone(cells, goal));
  assert.equal(nextSwapMove(cells, goal), null);
  // Queen은 안 움직였다
  assert.deepEqual(cells.find((c) => c.piece === 'Queen'), { piece: 'Queen', ...R });
});

test('손이 벗어나도(King을 엉뚱한 데 놓음) 지금 자리에서 다시 계산해 끝에 닿는다', () => {
  let cells = apply(start(), { piece: 'King', to: { x: 5, y: 19 } });
  for (let i = 0; i < 5 && !swapDone(cells, goal); i++) cells = apply(cells, nextSwapMove(cells, goal)!);
  assert.ok(swapDone(cells, goal));
});

test('Queen이 가운데를 막아도 비켜 두고 끝낸다', () => {
  let cells: SquadCell[] = [{ piece: 'King', ...L }, { piece: 'Rock', x: 10, y: 15 }, { piece: 'Queen', ...C }];
  for (let i = 0; i < 6 && !swapDone(cells, goal); i++) cells = apply(cells, nextSwapMove(cells, goal)!);
  assert.ok(swapDone(cells, goal));
});
