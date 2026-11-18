/**
 * 북군 화면은 판을 돌려 그린다 (2026-11-18 기획자 — `battle/layout.ts`의 `boardFlipFor`)
 *
 * 칸 → 화면(`cellCenter` · `cellCorner`)과 화면 → 칸(`cellAt`)이 **같은 뒤집기**를 지나야 누른 칸이 그 칸이다.
 * 한쪽만 뒤집으면 판 위 그림은 맞는데 누르면 반대편 칸이 골라진다 — 화면으로는 「클릭이 이상하다」로만 보인다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boardDims, boardFlipFor, cellAt, cellCenter, cellCorner, screenDir, viewCell, CELL_H, CELL_W } from '../src/battle/layout.ts';

test('돌려 그린 판 — 남군 King 자리(M18)가 화면 위쪽, 누르면 그 칸으로 돌아온다', () => {
  const flip = boardDims({ x: 25, y: 20 }, true);
  const plain = boardDims({ x: 25, y: 20 });
  const m18 = { x: 12, y: 17 };
  // 가운데 열은 그대로, 18행은 화면 3행(위)으로
  assert.deepEqual(cellCenter(m18.x, m18.y, flip), { x: 12 * CELL_W + CELL_W / 2, y: 2 * CELL_H + CELL_H / 2 });
  assert.deepEqual(cellCorner(0, 0, flip), { x: 24 * CELL_W, y: 19 * CELL_H });
  for (const dims of [flip, plain]) {
    for (const p of [m18, { x: 0, y: 0 }, { x: 24, y: 19 }, { x: 3, y: 15 }]) {
      const px = cellCenter(p.x, p.y, dims);
      assert.deepEqual(cellAt(px.x, px.y, dims), p, `${dims.flip ? '돌린' : '그대로'} 판 ${p.x},${p.y}`);
    }
  }
  // 눈금 — 화면 맨 왼쪽 위 칸의 이름은 Y20
  assert.deepEqual(viewCell(0, 0, flip), { x: 24, y: 19 });
});

test('화면 방향 — 돌린 판은 좌우가 반대', () => {
  assert.equal(screenDir(1, boardDims(undefined, true)), -1);
  assert.equal(screenDir(-1, boardDims(undefined, false)), -1);
});

test('누구에게 돌리나 — 북군, 수성전은 아니다', () => {
  assert.equal(boardFlipFor('P2', null), true);
  assert.equal(boardFlipFor('P1', null), false);
  assert.equal(boardFlipFor('P2', 'siege'), false, '수성전 리플레이는 수비대 편집처럼 성채가 위다');
  assert.equal(boardFlipFor('P2', 'raid'), true);
});
