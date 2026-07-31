/**
 * 전투 상태 원시 연산 — 조회 · 체력 · 사망 · 공격 판정
 *
 * `battle.ts`(스케줄러·의도 처리)와 `effects.ts`(Effect DSL)가 함께 쓰는 바닥층이다.
 * 이 파일은 위 두 모듈을 import하지 않는다 — 순환 참조를 막기 위한 경계다.
 */

import { officerById } from '@samchess/data';
import {
  FORMULA,
  type ActiveStatus,
  type BattleConfig,
  type BattleEvent,
  type BattleState,
  type Side,
  type StatusId,
  type UnitId,
  type UnitState,
  type Vec2,
} from './types.ts';
import { attackCells, legalMoves, threatRange } from './pieces.ts';
import { roll } from './rng.ts';

export const SIDES: readonly Side[] = ['P1', 'P2'];
export const UNITS_PER_SIDE: Record<BattleConfig['mode'], number> = { '1v1': 1, '3v3': 3, '5v5': 5 };

export const other = (side: Side): Side => (side === 'P1' ? 'P2' : 'P1');
export const samePos = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
/** 체스판 거리(체비쇼프) — "8방향 내 1칸"이 곧 거리 1이다 */
export const chebyshev = (a: Vec2, b: Vec2): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// ═══════════════════════════════════════════════════════════════
// 조회
// ═══════════════════════════════════════════════════════════════

export function unitsOf(state: BattleState, side: Side): UnitState[] {
  return Object.values(state.units).filter((u) => u.side === side);
}

export function aliveUnits(state: BattleState): UnitState[] {
  return Object.values(state.units).filter((u) => u.alive);
}

export function unitAt(state: BattleState, pos: Vec2): UnitState | undefined {
  return aliveUnits(state).find((u) => samePos(u.pos, pos));
}

export function findStatus(unit: UnitState, status: StatusId): ActiveStatus | undefined {
  return unit.statuses.find((s) => s.status === status);
}

export const hasStatus = (unit: UnitState, status: StatusId): boolean => findStatus(unit, status) !== undefined;

export function removeStatus(unit: UnitState, st: ActiveStatus, events: BattleEvent[]): void {
  const i = unit.statuses.indexOf(st);
  if (i < 0) return;
  unit.statuses.splice(i, 1);
  events.push({ e: 'statusExpired', unit: unit.id, status: st.status });
}

/** 「증폭」·「반감」처럼 1회 소모형 상태를 1회 깎는다. 0이 되면 제거. */
export function consumeCharge(unit: UnitState, st: ActiveStatus, events: BattleEvent[]): void {
  if (st.charges !== undefined) {
    st.charges -= 1;
    if (st.charges > 0) return;
  }
  removeStatus(unit, st, events);
}

/**
 * 해당 유닛의 지시를 내리는 진영. 보통은 자기 편이지만
 * 「유인」·「초선」으로 조종당하는 동안에는 조종자의 편이다.
 */
export function controllingSide(state: BattleState, unit: UnitState): Side {
  if (!unit.control) return unit.side;
  return state.units[unit.control.by]?.side ?? unit.side;
}

// ═══════════════════════════════════════════════════════════════
// 보드
// ═══════════════════════════════════════════════════════════════

/**
 * 진입 불가 판정 — 살아있는 유닛 또는 수계 지형.
 *
 * 기물 마스크는 전부 점대칭이므로(pieces.json에서 검증) 진영에 따른 반전이 필요 없다.
 */
export function boardQuery(state: BattleState, ignore?: UnitId) {
  return {
    blocked(p: Vec2): boolean {
      if (state.terrain.some((t) => t.terrain === 'water' && samePos(t.pos, p))) return true;
      return aliveUnits(state).some((u) => u.id !== ignore && samePos(u.pos, p));
    },
  };
}

/** 이동 가능 칸. 「자유이동」(감녕·여포) 상태면 맵 전체가 후보다. */
export function legalMovesFor(state: BattleState, unitId: UnitId): Vec2[] {
  const unit = state.units[unitId];
  if (!unit?.alive) return [];
  const board = boardQuery(state, unitId);

  if (hasStatus(unit, 'freeMove')) {
    const out: Vec2[] = [];
    for (let y = 0; y < FORMULA.board.rows; y++) {
      for (let x = 0; x < FORMULA.board.cols; x++) {
        const p = { x, y };
        if (!samePos(p, unit.pos) && !board.blocked(p)) out.push(p);
      }
    }
    return out;
  }
  return legalMoves(unit.piece, unit.pos, board);
}

/**
 * 현재 위치에서 공격이 닿는 살아있는 적 목록.
 *
 * "적"은 **지시를 내리는 쪽 기준**이다. 「초선」으로 조종당하는 유닛은 제 편을 친다 —
 * 그게 아니면 적을 조종하는 의미가 없다 (GDD §3.7 "적군 1명을 컨트롤: 이동+공격").
 */
export function legalTargetsFor(state: BattleState, unitId: UnitId): UnitId[] {
  const unit = state.units[unitId];
  if (!unit?.alive) return [];
  const cells = attackCells(unit.piece, unit.pos);
  const forced = findStatus(unit, 'mustTarget');
  const commander = controllingSide(state, unit);

  return aliveUnits(state)
    .filter((t) => t.side !== commander && t.id !== unit.id)
    .filter((t) => !hasStatus(t, 'untargetable'))
    .filter((t) => cells.some((c) => samePos(c, t.pos)))
    .filter((t) => forced?.sourceUnit === undefined || forced.sourceUnit === t.id)
    .map((t) => t.id);
}

/** 한 턴 위협 범위 — 이동 후 공격까지의 합집합. 보드 상태(장애물·경계)를 반영한다. */
export function threatRangeFor(state: BattleState, unitId: UnitId): Vec2[] {
  const unit = state.units[unitId];
  if (!unit?.alive) return [];
  return threatRange(unit.piece, unit.pos, boardQuery(state, unitId));
}

// ═══════════════════════════════════════════════════════════════
// 체력 · 사망 · 승패
// ═══════════════════════════════════════════════════════════════

export function damageUnit(state: BattleState, unit: UnitState, amount: number, reason: string, events: BattleEvent[]): void {
  if (!unit.alive || amount <= 0) return;
  unit.hp -= amount;
  events.push({ e: 'hpChanged', unit: unit.id, delta: -amount, reason });
  if (unit.hp <= 0) {
    unit.hp = 0;
    unit.alive = false;
    events.push({ e: 'unitDied', unit: unit.id });
    checkEnd(state, events);
  }
}

export function healUnit(state: BattleState, unit: UnitState, amount: number, reason: string, events: BattleEvent[]): void {
  if (!unit.alive || amount <= 0) return;
  const healed = Math.min(amount, unit.maxHp - unit.hp);
  if (healed <= 0) return;
  unit.hp += healed;
  events.push({ e: 'hpChanged', unit: unit.id, delta: healed, reason });
}

/**
 * 승패 판정 (GDD §3.9).
 *
 * **사망이 발생할 때마다 즉시 호출한다.** 양측 King이 같은 정산에서 쓰러져도
 * 먼저 처리된 쪽이 지므로 "먼저 행동한 쪽이 승리"가 자동으로 성립한다.
 * 한 번 정해진 승자는 덮어쓰지 않는다.
 */
export function checkEnd(state: BattleState, events: BattleEvent[]): void {
  if (state.winner) return;
  for (const side of SIDES) {
    const mine = unitsOf(state, side);
    const kingDown = mine.some((u) => u.piece === 'King' && !u.alive);
    const wipedOut = mine.every((u) => !u.alive);
    if (kingDown || wipedOut) {
      endBattle(state, other(side), events);
      return;
    }
  }
}

export function endBattle(state: BattleState, winner: Side, events: BattleEvent[]): void {
  state.winner = winner;
  state.phase = 'finished';
  state.activeUnit = null;
  state.activeTurn = null;
  events.push({ e: 'battleEnded', winner }, { e: 'phaseChanged', phase: 'finished' });
}

// ═══════════════════════════════════════════════════════════════
// 공격 판정 (GDD §3.5)
// ═══════════════════════════════════════════════════════════════

/**
 * 공격 1회를 판정한다.
 *
 * 난수 소비: 「증폭」이 걸려 있지 않을 때만 크리티컬 판정 1회.
 * (증폭은 확률을 100%로 만드는 게 아니라 판정 자체를 건너뛴다 — 커서를 아끼려는 게 아니라
 *  "판정 없음"이라는 의미가 더 분명해서 이쪽을 택했다.)
 */
export function resolveAttack(state: BattleState, attacker: UnitState, target: UnitState, events: BattleEvent[]): void {
  const atkOfficer = officerById.get(attacker.officer)!;
  const defOfficer = officerById.get(target.officer)!;

  const amplify = findStatus(attacker, 'critical100');
  const critical = amplify ? true : roll(state, FORMULA.criticalRate(atkOfficer.might, defOfficer.might));
  if (amplify) consumeCharge(attacker, amplify, events);

  const halve = findStatus(target, 'incomingDamageHalf');
  const fear = hasStatus(attacker, 'outgoingDamageHalf');
  const damage = FORMULA.damage(attacker.at, critical, halve !== undefined, fear);
  if (halve) consumeCharge(target, halve, events);

  events.push({ e: 'attacked', unit: attacker.id, target: target.id, damage, critical });
  damageUnit(state, target, damage, 'attack', events);
}
