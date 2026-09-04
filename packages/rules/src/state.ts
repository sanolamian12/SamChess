/**
 * 전투 상태 원시 연산 — 조회 · 체력 · 사망 · 공격 판정
 *
 * `battle.ts`(스케줄러·의도 처리)와 `effects.ts`(Effect DSL)가 함께 쓰는 바닥층이다.
 * 이 파일은 위 두 모듈을 import하지 않는다 — 순환 참조를 막기 위한 경계다.
 */

import { CITY_RULES, officerById } from '@samchess/data';
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
export const UNITS_PER_SIDE: Record<BattleConfig['mode'], number> = { '3v3': 3, '5v5': 5 };

export const other = (side: Side): Side => (side === 'P1' ? 'P2' : 'P1');

/**
 * 전투가 끝났는가. **`winner`만 보면 안 된다** — 무승부는 `winner`가 null이면서 끝난 상태다.
 * 판정 이후의 처리를 멈출 때는 전부 이걸 쓴다.
 */
export const isOver = (state: BattleState): boolean => state.phase === 'finished';
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
 * **기물 마스크만으로** 갈 수 있는 칸 — 「자유이동」을 무시한다.
 *
 * 여포 「인중여포 마중적토」의 자유이동은 **1회 소모형**(`charges: 1`)이라, 실제로
 * 그 칸이 마스크 밖일 때만 횟수를 깎아야 한다. 원래도 갈 수 있던 한 칸을 움직였다고
 * 「어디든 한 번」을 날려 버리면 함정이 된다. 그 판단에 쓰는 것이 이 함수다.
 */
export function maskMovesFor(state: BattleState, unitId: UnitId): Vec2[] {
  const unit = state.units[unitId];
  if (!unit?.alive) return [];
  return legalMoves(unit.piece, unit.pos, boardQuery(state, unitId));
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
  // 「유인」으로 조종당하는 중에는 이동만 된다 — 후보를 내주면 UI가 못 할 공격을 켠다
  if (unit.control?.mode === 'moveOnly') return [];
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

/**
 * 기본 배치 — 각 유닛에게 `5×5` 필드를 하나씩 주고 그 **중앙**에 세운다 (GDD §3.1).
 *
 * `createBattle`이 유닛을 세울 때 쓰고, **부대의 배치 프리셋 편집기가
 * 「기본 배치로」를 그릴 때도 같은 함수를 부른다**(E · 42쪽) — 화면이 이 식을 다시
 * 적으면 배치 구역 규칙이 바뀌었을 때 **미리보기만** 조용히 어긋난다.
 */
export function defaultDeployPos(mode: BattleConfig['mode'], side: Side, index: number): Vec2 {
  const z = deployZone(mode, side);
  const w = FORMULA.board.deployWidthPerUnit;
  return {
    x: z.x0 + index * w + Math.floor(w / 2),
    y: side === 'P1'
      ? z.y1 - Math.floor(FORMULA.board.campDepth / 2)
      : z.y0 + Math.floor(FORMULA.board.campDepth / 2),
  };
}

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

  // 쓰러진 자리는 자리를 옮기기 **전에** 붙들어 둔다 — 화면이 피격 점멸을 여기서
  // 마치고 나서 부활 자리로 옮긴다 (`client/src/battle/poses.ts`)
  const from = { ...unit.pos };
  unit.statuses = [];
  unit.alive = true;
  unit.hp = Math.max(1, Math.floor(unit.maxHp / 2));
  unit.wt = unit.wtBase;
  unit.pos = pick(state, spots);
  delete unit.control;
  events.push({ e: 'unitRevived', unit: unit.id, at: { ...unit.pos }, from });
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
  if (state.phase === 'finished') return;
  for (const side of SIDES) {
    const mine = unitsOf(state, side);
    const kingDown = mine.some((u) => u.piece === 'King' && !u.alive);
    const wipedOut = mine.every((u) => !u.alive);
    if (kingDown || wipedOut) {
      endBattle(state, other(side), kingDown ? 'kingDown' : 'wipeOut', events);
      return;
    }
  }
}

/**
 * 무승부 상한 판정 (GDD §3.9, 2026-07-31 확정).
 *
 * 절대시간이 `FORMULA.drawTimeLimit`에 닿으면 **살아있는 아군 HP 합계**가 큰 쪽이 이긴다.
 * 합계까지 같으면 진짜 무승부다(`winner: null`) — 실측 0.02%.
 *
 * 상한을 절대시간으로 잡은 이유: 제어 중에는 시계가 멈추므로 **생각을 오래 하는 쪽이
 * 불리해지지 않는다.** 실시간 상한이면 장고하는 플레이어가 일방적으로 손해를 본다.
 */
export function checkTimeLimit(state: BattleState, events: BattleEvent[]): void {
  if (state.phase === 'finished' || state.time < FORMULA.drawTimeLimit) return;

  const total = (side: Side): number =>
    unitsOf(state, side).filter((u) => u.alive).reduce((sum, u) => sum + u.hp, 0);
  const diff = total('P1') - total('P2');
  if (diff === 0) endBattle(state, null, 'draw', events);
  else endBattle(state, diff > 0 ? 'P1' : 'P2', 'timeLimit', events);
}

export function endBattle(
  state: BattleState,
  winner: Side | null,
  outcome: NonNullable<BattleState['outcome']>,
  events: BattleEvent[],
): void {
  state.winner = winner;
  state.outcome = outcome;
  state.phase = 'finished';
  state.activeUnit = null;
  state.activeTurn = null;
  events.push({ e: 'battleEnded', winner, outcome }, { e: 'phaseChanged', phase: 'finished' });
}

// ═══════════════════════════════════════════════════════════════
// 공격 판정 (GDD §3.5)
// ═══════════════════════════════════════════════════════════════

/**
 * 유비 「삼고초려」 — 유비에게 N회 맞은 적은 **게임이 끝날 때까지 조종당한다** (GDD §12 B7).
 *
 * 환술 「초선」이 1턴짜리 조종이라면, 이쪽은 그 영구판이다.
 * **진영이 바뀌는 게 아니라 지휘권만 넘어간다** — 소속은 그대로라 승패 판정에서는
 * 여전히 원래 편의 유닛으로 센다. 다만 `controllingSide`가 유비 쪽을 가리키므로
 * 실제로는 옛 아군을 공격하게 된다.
 *
 * 진행도는 **맞은 쪽**에 표식으로 쌓는다. 표식에도 지속시간(490)이 있어
 * 그 안에 3회를 채우지 못하면 만료된다.
 * **King은 대상이 아니다** (§12 A5) — 아니면 SP 6으로 즉시 승리가 된다.
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
  target.control = { by: attacker.id, mode: 'moveAndAttack', uses: null };
  events.push({ e: 'controlChanged', unit: target.id, by: attacker.id, mode: 'moveAndAttack', permanent: true });
}

/** 유효 공격력 — 강유 「구벌중원」의 누적분을 더한다. */
export function effectiveAt(unit: UnitState): number {
  return unit.at + (findStatus(unit, 'attackStacking')?.magnitude ?? 0);
}

/**
 * 화면에 보여줄 **공격치 범위** — `평타 ~ 크리티컬` (기획 pptx 28쪽의 `AT 2-4`).
 *
 * 단일 숫자로는 실제 피해를 읽을 수 없다. 데미지가 `floor(AT × 배수)`이고 **매 타격마다
 * 따로 내림**하기 때문이다 — AT 성장이 0.5씩이라(GDD §4.2) 홀수 번 찍으면 `AT 2.5`가
 * 되는데, 평타는 `floor(2.5) = 2`로 그대로이고 크리티컬만 `floor(5) = 5`로 오른다.
 * 그냥 `AT 2.5`라고 적으면 「찍었는데 왜 그대로지」가 된다.
 *
 * ```
 * AT 2      → 2-4      (Lv1)
 * AT 2.5    → 2-5      (AT를 한 번 찍음)
 * AT 3      → 3-6
 * ```
 *
 * **공격하는 쪽의 값만 본다.** 「공포」와 여포 오라는 공격자에게 걸리는 감쇠라 포함하고,
 * 대상 쪽 감쇠(「반감」·단기도강)는 대상마다 달라지므로 넣지 않는다.
 *
 * 계산은 반드시 `FORMULA.damage`를 지나간다 — 화면이 내림 규칙을 다시 적으면
 * 공식이 바뀌었을 때 표시만 조용히 어긋난다.
 */
export function attackRange(state: BattleState, unitId: UnitId): { min: number; max: number } {
  const unit = state.units[unitId];
  if (!unit) return { min: 0, max: 0 };
  const fear = hasStatus(unit, 'outgoingDamageHalf')
    || aurasOn(state, unitId).some((a) => a.status === 'auraOutgoingHalf');
  const at = effectiveAt(unit);
  return {
    min: FORMULA.damage(at, false, false, fear),
    max: FORMULA.damage(at, true, false, fear),
  };
}

/** 공격을 넣기 전에 미리 재 본 결과 (`forecastAttack`) */
export interface AttackForecast {
  /** 실제로 맞는 쪽. 「고육지책」 대신받기로 **고른 대상과 다를 수 있다** */
  victim: UnitId;
  /** 평타 데미지 */
  normal: number;
  /** 크리티컬 데미지 */
  critical: number;
  /** 크리티컬 확률(%). `100`이면 확정(「증폭」·「일당백」 등) */
  criticalRate: number;
  /** 관우 「온주참화웅」 — 확률과 무관하게 반드시 쓰러진다 */
  execute: boolean;
  /** 대상 쪽 감쇠가 걸려 있다 (「반감」·단기도강) */
  halved: boolean;
  /** 공격자 쪽 감쇠가 걸려 있다 (「공포」·인중여포) */
  feared: boolean;
  /** 맞고 난 뒤 남을 HP — `[크리티컬일 때, 평타일 때]` */
  hpAfter: { min: number; max: number };
  /** 이 공격으로 쓰러질 수 있는가 (평타로도 쓰러지면 `'always'`) */
  lethal: 'never' | 'critical' | 'always';
}

// ═══════════════════════════════════════════════════════════════
// 능력치 — **부상을 여기 하나에서 반영한다 ★** (GDD §5.7, 2026-09-04)
// ═══════════════════════════════════════════════════════════════

/**
 * 부상이 깎은 값. **하한 1** — 0이나 음수가 되면 확률식이 뒤집힌다.
 *
 * 값은 엑셀 「도시 건물」의 `injuryPenalty`에서 온다(`@samchess/data`). 계정 규칙이
 * 아니라 **데이터**라서 룰 엔진이 읽어도 계층이 안 뒤집힌다 — `meta`는 `rules`를
 * 부르지 그 반대가 아니다.
 */
export const injuredValue = (base: number): number =>
  Math.max(1, base - CITY_RULES.injuryPenalty);

/**
 * 이 유닛이 **지금 쓰는** 무력·지력·통솔력.
 *
 * ★ **능력치를 읽는 자리는 여기 하나다.** 예전에는 여덟 군데가 각각
 * `officerById.get(unit.officer)!.might`를 폈는데, 부상이 붙으면서 그중 하나만
 * 빠뜨려도 **화면에는 아무 표시도 없이** 크리티컬 확률이나 환술 저항만 조용히
 * 어긋난다. `statPicksOf()`가 성장 스택에 세운 것과 같은 규약이다.
 *
 * 통솔력은 `wtBase`(`190 − 통솔력`)에도 들어가는데 그것은 **유닛을 만들 때 한 번**
 * 계산해 두고 판 안에서 안 바뀐다 — 부상도 판 안에서 안 바뀌므로 둘이 맞물린다.
 */
export function officerStats(unit: UnitState): { might: number; intellect: number; leadership: number } {
  const o = officerById.get(unit.officer)!;
  return unit.injured
    ? { might: injuredValue(o.might), intellect: injuredValue(o.intellect), leadership: injuredValue(o.leadership) }
    : { might: o.might, intellect: o.intellect, leadership: o.leadership };
}

/**
 * 공격을 **넣지 않고** 결과를 미리 잰다 — 확인창이 쓴다 (2026-08-13 기획자 지정).
 *
 * 책략의 확인창이 `illusionChance()`에 확률을 묻는 것과 같은 이유로 여기 둔다.
 * 화면이 `floor(AT × 2)`나 「반감이면 절반」을 다시 적으면, 공식이 바뀌었을 때
 * **표시만 조용히 어긋난다** — 눌러 보기 전에는 아무도 모른다.
 *
 * `resolveAttack`과 **같은 순서로** 판정한다: 즉사 → 대신받기 → 감쇠 → 데미지.
 * 순서가 중요한 이유는 대신받기다 — 감쇠는 **실제로 맞는 쪽**의 것을 봐야 한다.
 *
 * **난수를 쓰지 않는다.** 크리티컬은 확률만 돌려주고 굴리지 않는다 —
 * 여기서 굴리면 `rngCursor`가 밀려 재현성이 깨진다(GDD §10).
 */
export function forecastAttack(state: BattleState, attackerId: UnitId, targetId: UnitId): AttackForecast | null {
  const attacker = state.units[attackerId];
  const target = state.units[targetId];
  if (!attacker?.alive || !target?.alive) return null;

  const atkOfficer = officerStats(attacker);
  const defOfficer = officerStats(target);

  // 관우 「온주참화웅」 — 대신받기보다 먼저다. King에게는 통하지 않는다
  if (findStatus(attacker, 'instantKillNext') && target.piece !== 'King') {
    return {
      victim: target.id, normal: target.hp, critical: target.hp, criticalRate: 100,
      execute: true, halved: false, feared: false,
      hpAfter: { min: 0, max: 0 }, lethal: 'always',
    };
  }

  const victim = redirectTarget(state, target);
  const halved = findStatus(victim, 'incomingDamageHalf') !== undefined
    || auraApplies(state, victim, 'auraIncomingHalf', 'ally');
  const feared = hasStatus(attacker, 'outgoingDamageHalf')
    || auraApplies(state, attacker, 'auraOutgoingHalf', 'enemy');

  const at = effectiveAt(attacker);
  const normal = FORMULA.damage(at, false, halved, feared);
  const critical = FORMULA.damage(at, true, halved, feared);
  const criticalRate = findStatus(attacker, 'critical100')
    ? 100
    : FORMULA.criticalRate(atkOfficer.might, defOfficer.might);

  return {
    victim: victim.id, normal, critical, criticalRate, execute: false, halved, feared,
    hpAfter: { min: Math.max(0, victim.hp - critical), max: Math.max(0, victim.hp - normal) },
    lethal: victim.hp <= normal ? 'always' : victim.hp <= critical ? 'critical' : 'never',
  };
}

/**
 * 오라 판정 — **매 순간 거리를 다시 잰다** (GDD §12 A1).
 * 시전 시점에 상태를 뿌리는 게 아니라 시전자에게만 표식을 두고, 피해 계산 때 반경을 확인한다.
 * 그래야 시전 후 흩어지면 효과가 풀리는, 오라다운 동작이 된다.
 *
 * @param from 오라를 켠 쪽이 대상의 아군인지(단기도강) 적인지(인중여포)
 */
function auraApplies(state: BattleState, unit: UnitState, status: StatusId, from: 'ally' | 'enemy'): boolean {
  return aurasOn(state, unit.id).some((a) => a.status === status);
}

/** 오라 하나가 이 유닛에게 걸린 상태 */
export interface ActiveAura {
  status: StatusId;
  /** 오라를 켠 유닛 */
  source: UnitId;
  /** 이 유닛에게 이로운가 — 아군이 켠 것이면 이롭고, 적이 켠 것이면 해롭다 */
  kind: 'buff' | 'debuff';
  radius: number;
}

/** 오라를 켜는 상태와, 그것이 **누구에게** 걸리는가 (GDD §12 A1) */
const AURA_TARGETS: ReadonlyArray<{ status: StatusId; from: 'ally' | 'enemy' }> = [
  // 허저 「단기도강」 — 반경 안의 아군이 받는 피해 절반
  { status: 'auraIncomingHalf', from: 'ally' },
  // 여포 「인중여포 마중적토」 — 반경 안의 적이 주는 피해 절반
  { status: 'auraOutgoingHalf', from: 'enemy' },
];

/**
 * 지금 이 유닛에게 걸려 있는 오라들.
 *
 * **오라는 `statuses` 배열에 없다.** 시전자에게만 표식을 두고 피해 계산 때 거리를 다시
 * 재는 구조라(GDD §12 A1), 영향받는 쪽에는 아무 흔적이 없다 — 그래서 화면이 "왜 내
 * 공격력이 절반이지?"를 보여 줄 방법이 없었다. 그 물음에 답하는 것이 이 함수다.
 *
 * 판정(`auraApplies`)도 같은 목록을 쓴다. 화면과 엔진이 다른 계산을 하면
 * 「표시에는 없는데 실제로는 걸리는」 어긋남이 생긴다.
 */
export function aurasOn(state: BattleState, unitId: UnitId): ActiveAura[] {
  const unit = state.units[unitId];
  if (!unit?.alive) return [];

  const out: ActiveAura[] = [];
  for (const source of aliveUnits(state)) {
    if (source.id === unit.id) continue;
    const isAlly = source.side === unit.side;
    for (const { status, from } of AURA_TARGETS) {
      const st = findStatus(source, status);
      if (!st) continue;
      if (from === 'ally' ? !isAlly : isAlly) continue;
      const radius = st.magnitude ?? 1;
      if (chebyshev(source.pos, unit.pos) > radius) continue;
      out.push({ status, source: source.id, kind: isAlly ? 'buff' : 'debuff', radius });
    }
  }
  return out;
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
  const atkOfficer = officerStats(attacker);
  const defOfficer = officerStats(target);

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
  if (!isCounter && target.alive && hasStatus(target, 'counterattack') && attacker.alive && !isOver(state)) {
    resolveAttack(state, target, attacker, events, true);
  }
}
