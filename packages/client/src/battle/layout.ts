/**
 * 보드 레이아웃 상수.
 *
 * 셀을 96×120으로 잡으면 `25열 × 96 = 2400`, `20행 × 120 = 2400`이 되어
 * **보드 전체가 정확히 정사각형**이 된다. 초상화 원본(440×540)의 세로비도 그대로 유지된다.
 */

import { FORMULA } from '@samchess/rules';

export const CELL_W = 96;
export const CELL_H = 120;

export const COLS = FORMULA.board.cols;   // 25
export const ROWS = FORMULA.board.rows;   // 20

export const BOARD_W = COLS * CELL_W;     // 2400
export const BOARD_H = ROWS * CELL_H;     // 2400

/** 격자 좌표 → 셀 중심의 픽셀 좌표 */
export const cellCenter = (x: number, y: number): { x: number; y: number } => ({
  x: x * CELL_W + CELL_W / 2,
  y: y * CELL_H + CELL_H / 2,
});

/** 픽셀 좌표 → 격자 좌표. 보드 밖이면 null */
export function cellAt(px: number, py: number): { x: number; y: number } | null {
  const x = Math.floor(px / CELL_W);
  const y = Math.floor(py / CELL_H);
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return null;
  return { x, y };
}

export const COLOR = {
  boardLight: 0x2a2d34,
  boardDark: 0x23262c,
  grid: 0x3a3f47,
  campP1: 0x1e3a2f,
  campP2: 0x3a1e24,
  p1: 0x4ea36b,
  p2: 0xc0524f,
  selected: 0xf0c674,
  moveHint: 0x4ea36b,
  attackHint: 0xc0524f,
  hpFull: 0x5cb85c,
  hpLow: 0xd9534f,
  mp: 0x5b9bd5,
  wt: 0xdddddd,
} as const;
