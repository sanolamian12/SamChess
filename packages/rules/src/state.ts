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
import { pick, roll } from './rng.ts';

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

/**
 * 1회 소모형 상태(「증폭」·「반감」)를 1회 깎고, 0이 되면 제거한다.
 *
 * **`charges`가 없는 상태는 건드리지 않는다.** 같은 `critical100`이라도
 * 책략 「증폭」은 1회 소모형이고 A급 「일당백」은 time 190짜리 지속형이다 —
 * 후자를 공격 한 번에 지워버리면 안 된다. 만료는 지속시간이 알아서 처리한다.
 */
export function consumeCharge(unit: UnitState, st: ActiveStatus, events: BattleEvent[]): void {
  if (st.charges === undefined) return;
  st.charges -= 1;
  if (st.charges > 0) return;
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
  const forced = findStatus(unit, 'mustTarget');
  const commander = controllingSide(state, unit);
  // 황충 「백보천양」 — 사거리를 무시하고 맵 위 아무 적이나 겨눈다
  const anywhere = hasStatus(unit, 'attackAnywhere');
  const cells = anywhere ? [] : attackCells(unit.piece, unit.pos);

  return aliveUnits(state)
    .filter((t) => t.side !== commander && t.id !== unit.id)
    .filter((t) => !hasStatus(t, 'untargetable'))
    .filter((t) => anywhere || cells.some((c) => samePos(c, t.pos)))
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
// 배치 구역 (GDD §3.1)
// ═══════════════════════════════════════════════════════════════

export interface DeployZone {
  x0: number; x1: number; y0: number; y1: number;
}

/**
 * 맵은 언제나 20행 × 25열이고, 진영 폭만 `참여 수 × 5`로 잡아 **중앙 정렬**한다.
 * P1은 아래쪽 5행, P2는 위쪽 5행.
 */
export function deployZone(mode: BattleConfig['mode'], side: Side): DeployZone {
  const n = UNITS_PER_SIDE[mode];
  const width = n * FORMULA.board.deployWidthPerUnit;
  const x0 = Math.floor((FORMULA.board.cols - width) / 2);
  const depth = FORMULA.board.campDepth;
  return side === 'P1'
    ? { x0, x1: x0 + width - 1, y0: FORMULA.board.rows - depth, y1: FORMULA.board.rows - 1 }
    : { x0, x1: x0 + width - 1, y0: 0, y1: depth - 1 };
}

export const inZone = (z: DeployZone, p: Vec2): boolean =>
  p.x >= z.x0 && p.x <= z.x1 && p.y >= z.y0 && p.y <= z.y1;

// ═══════════════════════════════════════════════════════════════
// 체력 · 사망 · 승패
// ═══════════════════════════════════════════════════════════════

export function damageUnit(state: BattleState, unit: UnitState, amount: number, reason: string, events: BattleEvent[]): void {
  if (!unit.alive || amount <= 0) return;
  unit.hp -= amount;
  events.push({ e: 'hpChanged', unit: unit.id, delta: -amount, reason });
  if (unit.hp > 0) return;

  unit.hp = 0;
  unit.alive = false;
  events.push({ e: 'unitDied', unit: unit.id });

  // 곽가 「유언계책」 — 사망하고 time 290 뒤에 적 1명(군주 제외)이 죽는다
  const curse = findStatus(unit, 'deathCurse');
  if (curse) {
    state.pending.push({
      at: state.time + (curse.magnitude ?? 290),
      kind: 'randomEnemyDies',
      side: unit.side,
      source: unit.id,
    });
  }

  // 조조 「화용도」 — 사망을 1회 무른다. 승패 판정보다 먼저 처리해야 한다
  if (revive(state, unit, events)) return;

  checkEnd(state, events);
}

/**
 * 조조 「화용도 의석조조」 — 사망 시 **HP 절반으로 자기 진영 빈 칸에 부활**한다 (GDD §12 B7).
 *
 * 상태이상은 전부 해제하고, WT는 기준값을 다 채워 즉시 행동하지 못하게 한다.
 * 고유기술 사용 횟수는 회복시키지 않는다 — 부활은 1회뿐이다.
 * 진영에 빈 칸이 하나도 없으면 부활하지 못하고 그대로 사망한다.
 */
function revive(state: BattleState, unit: UnitState, events: BattleEvent[]): boolean {
  const marker = findStatus(unit, 'revivePending');
  if (!marker) return false;

  const zone = deployZone(state.mode, unit.side);
  const spots: Vec2[] = [];
  for (let y = zone.y0; y <= zone.y1; y++) {
    for (let x = zone.x0; x <= zone.x1; x++) {
      const p = { x, y };
      if (aliveUnits(state).some((u) => samePos(u.pos, p))) continue;
      if (state.terrain.some((t) => t.terrain === 'water' && samePos(t.pos, p))) continue;
      spots.push(p);
    }
  }
  if (spots.length === 0) return false;

  unit.statuses = [];
  unit.alive = true;
  unit.hp = Math.max(1, Math.floor(unit.maxHp / 2));
  unit.wt = unit.wtBase;
  unit.pos = pick(state, spots);
  delete unit.control;
  events.push({ e: 'unitRevived', unit: unit.id, at: { ...unit.pos } });
  return true;
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
 * 유비 「삼고초려」 — 유비에게 N회 맞은 적은 아군이 된다 (GDD §12 B7).
 *
 * 진행도는 **맞은 쪽**에 표식으로 쌓는다. 유비가 죽어도 이미 쌓인 진행도는 남지만,
 * 표식에도 지속시간(490)이 있어 시간이 지나면 만료된다.
 * **King은 전향하지 않는다** (§12 A5) — 아니면 SP 6으로 즉시 승리가 된다.
 */
function markConversion(state: BattleState, attacker: UnitState, target: UnitState, events: BattleEvent[]): void {
  const source = findStatus(attacker, 'convertOnHit');
  if (!source || !target.alive || target.side === attacker.side) return;
  if (target.piece === 'King') return;

  const need = source.charges ?? 3;
  let mark = target.statuses.find((s) => s.status === 'convertProgress' && s.sourceUnit === attacker.id);
  if (!mark) {
    mark = { status: 'convertProgress', magnitude: 0, charges: need, sourceUnit: attacker.id, ...(source.expiresAt !== undefined ? { expiresAt: source.expiresAt } : {}) };
    target.statuses.push(mark);
  }
  mark.magnitude = (mark.magnitude ?? 0) + 1;
  if ((mark.magnitude ?? 0) < need) return;

  removeStatus(target, mark, events);
  target.side = attacker.side;
  delete target.control;
  events.push({ e: 'unitDefected', unit: target.id, to: attacker.side });
  // 전향으로 한쪽이 전멸할 수 있다
  checkEnd(state, events);
}

/** 유효 공격력 — 강유 「구벌중원」의 누적분을 더한다. */
export function effectiveAt(unit: UnitState): number {
  return unit.at + (findStatus(unit, 'attackStacking')?.magnitude ?? 0);
}

/**
 * 오라 판정 — **매 순간 거리를 다시 잰다** (GDD §12 A1).
 * 시전 시점에 상태를 뿌리는 게 아니라 시전자에게만 표식을 두고, 피해 계산 때 반경을 확인한다.
 * 그래야 시전 후 흩어지면 효과가 풀리는, 오라다운 동작이 된다.
 *
 * @param from 오라를 켠 쪽이 대상의 아군인지(단치도강) 적인지(인중여포)
 */
function auraApplies(state: BattleState, unit: UnitState, status: StatusId, from: 'ally' | 'enemy'): boolean {
  return aliveUnits(state).some((u) => {
    const st = findStatus(u, status);
    if (!st) return false;
    const isAlly = u.side === unit.side;
    if (from === 'ally' ? !isAlly : isAlly) return false;
    return chebyshev(u.pos, unit.pos) <= (st.magnitude ?? 1);
  });
}

/**
 * 피해를 실제로 받을 유닛 — 주유 「고육지책」이 걸려 있으면 지정자가 대신 받는다.
 * **공격 피해만** 넘어간다 (도트·지형은 그대로). GDD §12 B4.
 */
function redirectTarget(state: BattleState, target: UnitState): UnitState {
  const guard = aliveUnits(state).find(
    (u) => u.side === target.side && u.id !== target.id && hasStatus(u, 'damageRedirect'));
  return guard ?? target;
}

/**
 * 공격 1회를 판정한다.
 *
 * 난수 소비: 크리티컬이 확정(「증폭」·「일당백」 등)이 아닐 때만 판정 1회.
 * 확정일 때는 확률을 100으로 만드는 게 아니라 **판정 자체를 건너뛴다**.
 *
 * @param isCounter 반격으로 불린 경우. 반격은 다시 반격을 부르지 않는다 (GDD §12 A4)
 */
export function resolveAttack(
  state: BattleState,
  attacker: UnitState,
  target: UnitState,
  events: BattleEvent[],
  isCounter = false,
): void {
  const atkOfficer = officerById.get(attacker.officer)!;
  const defOfficer = officerById.get(target.officer)!;

  const amplify = findStatus(attacker, 'critical100');
  const critical = amplify ? true : roll(state, FORMULA.criticalRate(atkOfficer.might, defOfficer.might));
  if (amplify) consumeCharge(attacker, amplify, events);

  // 관우 「온주참화웅」 — 첫 대상은 반드시 사망. King은 제외한다 (GDD §12 A5)
  const execute = findStatus(attacker, 'instantKillNext');
  if (execute && target.piece !== 'King') {
    removeStatus(attacker, execute, events);
    events.push({ e: 'attacked', unit: attacker.id, target: target.id, damage: target.hp, critical: true });
    damageUnit(state, target, target.hp, 'execute', events);
    return;
  }

  const victim = redirectTarget(state, target);
  const halve = findStatus(victim, 'incomingDamageHalf');
  const halveIncoming = halve !== undefined || auraApplies(state, victim, 'auraIncomingHalf', 'ally');
  const fear = hasStatus(attacker, 'outgoingDamageHalf')
    || auraApplies(state, attacker, 'auraOutgoingHalf', 'enemy');

  const damage = FORMULA.damage(effectiveAt(attacker), critical, halveIncoming, fear);
  if (halve) consumeCharge(victim, halve, events);

  events.push({ e: 'attacked', unit: attacker.id, target: victim.id, damage, critical });
  damageUnit(state, victim, damage, 'attack', events);

  // 강유 「구벌중원」 — 공격할 때마다 AT +1 누적 (상한은 magnitude로 관리)
  const stacking = findStatus(attacker, 'attackStacking');
  if (stacking && (stacking.magnitude ?? 0) < (stacking.charges ?? 9)) {
    stacking.magnitude = (stacking.magnitude ?? 0) + 1;
  }

  markConversion(state, attacker, victim, events);

  // 장합 「변화무쌍」 — 피격 시 반격. 사거리를 무시하고, 반격은 반격을 부르지 않는다
  if (!isCounter && target.alive && hasStatus(target, 'counterattack') && attacker.alive && !state.winner) {
    resolveAttack(state, target, attacker, events, true);
  }
}
