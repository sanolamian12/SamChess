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

/**
 * 타일 상단 바 3종 — HP · MP · WT (GDD §3.10 「기물 아이콘 구성」).
 * 셀 하나에 세 줄이 겹치지 않게 pitch(= 높이 + 간격)로 자리를 잡는다.
 */
export const BAR_W = CELL_W - 12;          // 84
export const BAR_H = 5;
export const BAR_PITCH = BAR_H + 2;
/** 첫 번째 바(HP)의 중심 y — 타일 위쪽 가장자리에서 조금 안쪽 */
export const BAR_TOP = -CELL_H / 2 + 7;
/** 바의 왼쪽 끝 x. origin을 (0, 0.5)로 두고 width만 줄여 게이지를 만든다 */
export const BAR_LEFT = -BAR_W / 2;

/**
 * 배지 4종의 자리 (GDD §3.10 「기물 아이콘 구성」).
 * 상단 바 3줄(−53 ~ −39)과 하단 이름표(+46) 사이를 쓴다.
 */
export const BADGE = {
  top: -30,
  bottom: 33,
  left: -CELL_W / 2 + 6,
  right: CELL_W / 2 - 6,
  /** 상태 점 하나의 반지름과 간격 */
  dotR: 3.5,
  dotGap: 9,
  /** 점으로 표시할 최대 개수. 넘치면 마지막을 「+」로 바꾼다 */
  dotMax: 4,
} as const;

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
  /** 제자리 대기 — 이동하지 않고 행동으로 넘어간다 */
  stayHint: 0x8a8f98,
  /** 공격이 닿는 칸 전체 (대상이 없어도 칠한다) */
  attackRange: 0x8a4a48,
  /** 실제로 칠 수 있는 적이 서 있는 칸 */
  attackHint: 0xc0524f,
  /** 책략 조준 — 대상 후보 */
  aimHint: 0x9b6bd0,
  /** 배지 — 버프(파랑) · 디버프(빨강) · 고유기술(금) */
  buff: 0x5b9bd5,
  debuff: 0xd9534f,
  skillReady: 0xf0c674,
  skillUsed: 0x6a7078,
  hpFull: 0x5cb85c,
  hpLow: 0xd9534f,
  mp: 0x5b9bd5,
  /** WT 게이지 — 행동이 멀면 회색, 차오를수록 흰색 (GDD §3.10 「WT(흰색→회색)」) */
  wt: 0xdddddd,
  wtIdle: 0x666c75,
  /** 게이지가 다 찼을 때(= 제어권 획득) */
  wtReady: 0xf0c674,
  barBack: 0x11131a,
} as const;
