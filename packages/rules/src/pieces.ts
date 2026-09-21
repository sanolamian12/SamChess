/**
 * 기물 이동/공격 기하 — 순수 함수 (GDD §3.2)
 *
 * 마스크 데이터는 @samchess/data(generated/pieces.json)가 단일 출처다.
 * 이 파일은 그 마스크를 보드 위에서 해석하는 규칙만 담는다.
 */

import { pieceByType, type PieceData, type PieceType } from '@samchess/data';
import { FORMULA, type Vec2 } from './types.ts';

const key = (p: Vec2): string => `${p.x},${p.y}`;

export function getPiece(type: PieceType): PieceData {
  const p = pieceByType.get(type);
  if (!p) throw new Error(`알 수 없는 기물: ${type}`);
  return p;
}

/** 대전 판 — 25열 × 20행 (GDD §3.1). 도적떼 방어전만 다른 판을 쓴다 (`raid.ts`) */
export const DEFAULT_BOARD: Readonly<Vec2> = { x: FORMULA.board.cols, y: FORMULA.board.rows };

/**
 * 판 안인가. **판 크기는 판마다 다르다** — 대전은 25×20, 도적떼 방어전은 25×15(GDD §5.11).
 * 전투 안에서는 반드시 `state.boardSize`를 넘긴다. 생략하면 대전 판이다 —
 * 부대 배치 편집기처럼 대전 판만 다루는 자리를 위한 기본값이다.
 */
export function inBounds(p: Vec2, size: Readonly<Vec2> = DEFAULT_BOARD): boolean {
  return p.x >= 0 && p.x < size.x && p.y >= 0 && p.y < size.y;
}

/**
 * 경로형(moveBlocked) 기물은 원점에서 목적지까지 직선상에 장애물이 없어야 한다.
 * 도약형(Knight/King/Pawn)은 경로를 무시한다.
 */
function pathClear(from: Vec2, offset: Vec2, occupied: (p: Vec2) => boolean): boolean {
  const steps = Math.max(Math.abs(offset.x), Math.abs(offset.y));
  const sx = Math.sign(offset.x);
  const sy = Math.sign(offset.y);
  for (let i = 1; i < steps; i++) {
    if (occupied({ x: from.x + sx * i, y: from.y + sy * i })) return false;
  }
  return true;
}

export interface BoardQuery {
  /** 유닛 또는 진입 불가 지형(수계)이 있으면 true */
  blocked(p: Vec2): boolean;
  /** 판 크기. 없으면 대전 판(`DEFAULT_BOARD`) — 전투 안의 조회(`boardQuery()`)는 언제나 싣는다 */
  size?: Readonly<Vec2>;
}

/** 이동 가능한 칸 목록. 목적지가 점유되어 있으면 갈 수 없다(이동으로 잡지 않는다). */
export function legalMoves(type: PieceType, from: Vec2, board: BoardQuery): Vec2[] {
  const piece = getPiece(type);
  const out: Vec2[] = [];
  for (const offset of piece.moveMask) {
    const to = { x: from.x + offset.x, y: from.y + offset.y };
    if (!inBounds(to, board.size) || board.blocked(to)) continue;
    if (piece.moveBlocked && !pathClear(from, offset, (p) => board.blocked(p))) continue;
    out.push(to);
  }
  return out;
}

/** 주어진 위치에서 공격이 닿는 칸 목록 (대상 유무는 보지 않는다). */
export function attackCells(type: PieceType, at: Vec2, size: Readonly<Vec2> = DEFAULT_BOARD): Vec2[] {
  return getPiece(type)
    .attackMask.map((o) => ({ x: at.x + o.x, y: at.y + o.y }))
    .filter((p) => inBounds(p, size));
}

/**
 * 한 턴 위협 범위 — 제자리 포함 모든 이동 목적지에서의 공격 범위 합집합.
 * GDD §3.2의 확정 수치(Rock 41 / Queen 39 / Bishop 37 / Pawn 33 / King 25 / Knight 25)를 만든다.
 *
 * 보드 경계와 장애물을 무시한 이론값을 원하면 `board`를 생략한다.
 */
export function threatRange(type: PieceType, from: Vec2 = { x: 0, y: 0 }, board?: BoardQuery): Vec2[] {
  const piece = getPiece(type);
  const origins: Vec2[] = [from];

  for (const offset of piece.moveMask) {
    const to = { x: from.x + offset.x, y: from.y + offset.y };
    if (board) {
      if (!inBounds(to, board.size) || board.blocked(to)) continue;
      if (piece.moveBlocked && !pathClear(from, offset, (p) => board.blocked(p))) continue;
    }
    origins.push(to);
  }

  const seen = new Map<string, Vec2>();
  seen.set(key(from), from); // 원점 포함 (GDD §3.2 계수 규약)
  for (const o of origins) {
    for (const a of piece.attackMask) {
      const cell = { x: o.x + a.x, y: o.y + a.y };
      if (board && !inBounds(cell, board.size)) continue;
      seen.set(key(cell), cell);
    }
  }
  return [...seen.values()];
}
