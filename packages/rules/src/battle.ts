/**
 * 전투 엔진 — CTB 스케줄러와 행동 판정 (GDD §3.3, §3.4, §3.5, §3.9)
 *
 * 순수 함수다. I/O · `Date.now()` · `Math.random()`을 쓰지 않는다.
 * 모든 난수는 `./rng.ts`를 지나며 `BattleState.rngCursor`에 소비 순서가 기록된다.
 *
 * 서버가 유일한 권위다. 클라이언트는 `Intent`만 보내고, 서버가
 * `validate()` → `apply()` → `BattleEvent[]` 브로드캐스트 순서로 처리한다.
 *
 *   const { state, events } = apply(prev, 'P1', { t: 'attack', targets: [...] });
 *
 * `apply`/`advanceTime`은 입력 상태를 변경하지 않고 새 상태를 돌려준다(structuredClone).
 */

import { officerById, skillById, tacticById, GROWTH } from '@samchess/data';
import {
  FORMULA,
  type ActiveStatus,
  type BattleConfig,
  type BattleEvent,
  type BattleState,
  type Effect,
  type GrowthConfig,
  type Intent,
  type PendingEffect,
  type PieceType,
  type RosterEntry,
  type RulesEngine,
  type Side,
  type SkillId,
  type TerrainTile,
  type Time,
  type UnitId,
  type UnitState,
  type ValidationResult,
  type Vec2,
} from './types.ts';
import { getPiece, inBounds } from './pieces.ts';
import { pick, roll } from './rng.ts';
import {
  SIDES, UNITS_PER_SIDE,
  aliveUnits, checkEnd, consumeCharge, controllingSide, damageUnit, endBattle, findStatus, hasStatus, healUnit,
  checkTimeLimit, deployZone, inZone, isOver, legalMovesFor, legalTargetsFor, maskMovesFor, other,
  removeStatus, resolveAttack, samePos, threatRangeFor, unitAt, unitsOf,
} from './state.ts';
import { applyEffects, illusionSucceeds, resolveTacticTarget, tacticMpCost } from './effects.ts';
import { hasSkillScript, runSkillScript } from './scripts.ts';

export * from './state.ts';

/** growth.json은 스키마가 GrowthConfig와 1:1이다 (tools/extract_data.py가 보증). */
const GROWTH_TABLE = GROWTH as unknown as GrowthConfig;

const ok: ValidationResult = { ok: true };
const no = (reason: string): ValidationResult => ({ ok: false, reason });

// ═══════════════════════════════════════════════════════════════
// 1. 전투 생성
// ═══════════════════════════════════════════════════════════════

/** 각 유닛에게 5×5 필드를 하나씩 주고 그 중앙에 세운 기본 배치. */
function defaultPlacement(mode: BattleConfig['mode'], side: Side, index: number): Vec2 {
  const z = deployZone(mode, side);
  const w = FORMULA.board.deployWidthPerUnit;
  return {
    x: z.x0 + index * w + Math.floor(w / 2),
    y: side === 'P1' ? z.y1 - Math.floor(FORMULA.board.campDepth / 2) : z.y0 + Math.floor(FORMULA.board.campDepth / 2),
  };
}

function buildUnit(mode: BattleConfig['mode'], side: Side, entry: RosterEntry, index: number): UnitState {
  const officer = officerById.get(entry.officer);
  if (!officer) throw new Error(`알 수 없는 장수: ${entry.officer}`);
  if (entry.level < 1 || entry.level > GROWTH_TABLE.maxLevel) throw new Error(`레벨 범위 밖: ${entry.level}`);
  if (entry.statPicks.length !== entry.level - 1) {
    throw new Error(`${officer.name}: 능력 선택 ${entry.statPicks.length}건, 레벨 ${entry.level}에는 ${entry.level - 1}건이 필요하다`);
  }

  let { hp, mp, at } = GROWTH_TABLE.base;
  for (const p of entry.statPicks) {
    if (p === 'hp') hp += GROWTH_TABLE.statChoices[0].hp;
    else if (p === 'mp') mp += GROWTH_TABLE.statChoices[1].mp;
    else at += GROWTH_TABLE.statChoices[2].at;
  }

  const wtBase = FORMULA.wtBase(officer.leadership);
  return {
    id: `${side}-${entry.piece}` as UnitId,
    side,
    officer: entry.officer,
    piece: entry.piece,
    level: entry.level,
    hp, maxHp: hp,
    mp, maxMp: mp,
    at,
    // 초기 WT = 기준값. 이것만으로 첫 행동 순서가 통솔력 내림차순과 일치한다 (GDD §3.3)
    wt: wtBase,
    wtBase,
    pos: defaultPlacement(mode, side, index),
    tactics: [...entry.tactics],
    statuses: [],
    uniqueSkillUses: officer.uniqueSkill ? 1 : 0,
    alive: true,
  };
}

/** 시드와 편성으로 초기 상태를 만든다. 기본 배치까지 마친 `deploy` 단계로 시작한다. */
export function createBattle(config: BattleConfig): BattleState {
  const expected = UNITS_PER_SIDE[config.mode];
  const units: Record<UnitId, UnitState> = {};

  for (const side of SIDES) {
    const roster = config.rosters[side];
    if (roster.length !== expected) {
      throw new Error(`${side} 편성 ${roster.length}명 — ${config.mode}은 ${expected}명이어야 한다`);
    }
    const pieces = new Set<PieceType>(roster.map((r) => r.piece));
    if (pieces.size !== roster.length) throw new Error(`${side}: 기물은 종류당 1개만 선택할 수 있다`);
    if (!pieces.has('King')) throw new Error(`${side}: King은 필수다`);

    // 한 진영에 같은 장수가 둘 이상 나오지 않는다 (2026-07-31 확정).
    // 「차동풍」처럼 "모든 아군"을 훑는 스킬이 같은 인물을 두 번 세지 않게 하는 전제이기도 하다.
    const officers = new Set(roster.map((r) => r.officer));
    if (officers.size !== roster.length) throw new Error(`${side}: 같은 장수를 두 번 편성할 수 없다`);

    roster.forEach((entry, i) => {
      const unit = buildUnit(config.mode, side, entry, i);
      units[unit.id] = unit;
    });
  }

  const spCap = expected * FORMULA.spCapPerUnit;
  return {
    matchId: config.matchId,
    seed: config.seed,
    rngCursor: 0,
    boardSize: { x: FORMULA.board.cols, y: FORMULA.board.rows },
    mode: config.mode,
    phase: 'deploy',
    time: 0,
    units,
    terrain: [],
    sp: { P1: 0, P2: 0 },
    spCap: { P1: spCap, P2: spCap },
    activeUnit: null,
    activeTurn: null,
    controlStartedAtMs: null,
    ready: { P1: false, P2: false },
    pending: [],
    winner: null,
    log: [],
  };
}

// ═══════════════════════════════════════════════════════════════
// 3. 시간 진행 — CTB 스케줄러 (GDD §3.3)
// ═══════════════════════════════════════════════════════════════

type Tick =
  | { at: Time; prio: 0; wt: number; unit: UnitState; status: ActiveStatus }        // 지속시간 만료
  | { at: Time; prio: 1; wt: number; unit: UnitState; status: ActiveStatus }        // DoT
  | { at: Time; prio: 2; wt: number; tile: TerrainTile }                            // 지형
  | { at: Time; prio: 3; wt: number }                                               // SP 충전
  | { at: Time; prio: 4; wt: number; pending: PendingEffect };                      // 예약 효과

/**
 * `(state.time, target]` 구간에 일어나는 주기 정산을 모두 모은다.
 *
 * 정렬 규칙: 시각 → 종류(만료 → DoT → 지형 → SP) → **WT 오름차순** → id.
 * WT 오름차순은 GDD §3.9의 "DoT 동시 정산은 WT가 작은 유닛부터"를 그대로 구현한 것이다.
 * 이 순서가 곧 동시 사망의 승패를 가르므로 결정적이어야 한다.
 */
function collectTicks(state: BattleState, target: Time): Tick[] {
  const ticks: Tick[] = [];

  for (const u of aliveUnits(state)) {
    for (const st of u.statuses) {
      if (st.expiresAt !== undefined && st.expiresAt <= target) {
        ticks.push({ at: Math.max(st.expiresAt, state.time), prio: 0, wt: u.wt, unit: u, status: st });
      }
      if (st.status === 'dot' && st.period) {
        for (let t = (st.lastTickedAt ?? state.time) + st.period; t <= target; t += st.period) {
          ticks.push({ at: t, prio: 1, wt: u.wt, unit: u, status: st });
        }
      }
    }
  }

  for (const tile of state.terrain) {
    if (tile.terrain === 'water') continue;
    for (let t = tile.lastTickedAt + FORMULA.terrainPeriod; t <= target; t += FORMULA.terrainPeriod) {
      ticks.push({ at: t, prio: 2, wt: 0, tile });
    }
  }

  const period = FORMULA.spPerTime;
  for (let t = Math.floor(state.time / period) * period + period; t <= target; t += period) {
    ticks.push({ at: t, prio: 3, wt: 0 });
  }

  for (const p of state.pending) {
    if (p.at <= target) ticks.push({ at: Math.max(p.at, state.time), prio: 4, wt: 0, pending: p });
  }

  return ticks.sort((a, b) =>
    a.at - b.at ||
    a.prio - b.prio ||
    a.wt - b.wt ||
    ('unit' in a && 'unit' in b ? a.unit.id.localeCompare(b.unit.id) : 0));
}

/** DoT 1회분 피해량. 비율형(화소연영)은 최대 HP 기준 내림, 그 외는 고정값(기본 1). */
function dotAmount(unit: UnitState, st: ActiveStatus): number {
  if (st.magnitudePct !== undefined) return Math.floor(unit.maxHp * st.magnitudePct);
  return st.magnitude ?? 1;
}

function applyTick(state: BattleState, tick: Tick, events: BattleEvent[]): void {
  switch (tick.prio) {
    case 0:
      if (tick.unit.alive) removeStatus(tick.unit, tick.status, events);
      return;
    case 1:
      // 같은 구간에서 만료된 상태의 잔여 tick은 버린다 (「결계」로 탈진이 풀린 경우 등)
      if (!tick.unit.statuses.includes(tick.status)) return;
      tick.status.lastTickedAt = tick.at;
      damageUnit(state, tick.unit, dotAmount(tick.unit, tick.status), 'dot', events);
      return;
    case 2: {
      tick.tile.lastTickedAt = tick.at;
      const victim = unitAt(state, tick.tile.pos);
      if (!victim) return;
      if (tick.tile.terrain === 'fire') damageUnit(state, victim, 1, 'terrain:fire', events);
      else healUnit(state, victim, 1, 'terrain:holy', events);
      return;
    }
    case 3:
      for (const side of SIDES) {
        const next = Math.min(state.sp[side] + 1, state.spCap[side]);
        if (next === state.sp[side]) continue;
        state.sp[side] = next;
        events.push({ e: 'spChanged', side, to: next });
      }
      return;
    case 4: {
      const i = state.pending.indexOf(tick.pending);
      if (i < 0) return;
      state.pending.splice(i, 1);
      // 곽가 「유언계책」 — 적 군주를 제외한 적 1명이 죽는다 (GDD §12 A5).
      // 후보 정렬을 id로 고정한 뒤 뽑아야 같은 시드에서 같은 결과가 나온다.
      const victims = aliveUnits(state)
        .filter((u) => u.side !== tick.pending.side && u.piece !== 'King')
        .sort((a, b) => a.id.localeCompare(b.id));
      if (victims.length === 0) return;
      const victim = victims.length === 1 ? victims[0]! : pick(state, victims);
      damageUnit(state, victim, victim.hp, `skill:${tick.pending.source}`, events);
    }
  }
}

/**
 * 절대시간을 `dt`만큼 진행시킨다. 그 사이의 SP 충전 · DoT · 지형 피해 · 지속시간 만료를
 * **시각 순서대로** 정산하고, 마지막에 모든 유닛의 WT를 dt만큼 깎는다.
 */
function advanceBy(state: BattleState, dt: Time, events: BattleEvent[]): void {
  const target = state.time + dt;

  for (const tick of collectTicks(state, target)) {
    if (isOver(state)) break;
    applyTick(state, tick, events);
  }

  // 사망·종료로 건너뛴 정산이 나중에 몰아서 터지지 않도록 기준점을 맞춰 둔다
  for (const u of Object.values(state.units)) {
    for (const st of u.statuses) {
      if (st.status === 'dot' && st.period) {
        const last = st.lastTickedAt ?? state.time;
        st.lastTickedAt = last + Math.floor((target - last) / st.period) * st.period;
      }
    }
  }
  for (const tile of state.terrain) {
    const p = FORMULA.terrainPeriod;
    tile.lastTickedAt += Math.floor((target - tile.lastTickedAt) / p) * p;
  }

  for (const u of aliveUnits(state)) u.wt = Math.max(0, u.wt - dt);
  state.time = target;
  events.push({ e: 'timeAdvanced', to: target });
  checkTimeLimit(state, events);
}

/**
 * 다음 제어권까지 절대시간을 진행시킨다 (GDD §3.3 루프의 1~3단계).
 *
 * `scout` 단계에서 호출하면 전투를 시작한다 — 정찰 15초는 서버가 재는 실시간이고,
 * 엔진은 시계를 갖지 않으므로 방(room)이 타이머 만료 시 이 함수를 부른다.
 */
export function advanceTime(state: BattleState): { state: BattleState; events: BattleEvent[] } {
  const s = cloneState(state);
  const events: BattleEvent[] = [];

  if (s.phase === 'scout') {
    s.phase = 'running';
    events.push({ e: 'phaseChanged', phase: 'running' });
  }
  if (s.phase !== 'running') throw new Error(`advanceTime은 running 단계에서만 쓴다 (현재 ${s.phase})`);

  /*
   * **누군가 제어권을 얻을 때까지 반복한다.**
   *
   * 한 번만 진행시키면 안 되는 이유: WT가 0에 닿으려던 유닛이 그 진행 구간에서 죽을 수 있다
   * (도트·지형·곽가 「유언계책」의 지연 사망). 그러면 WT 0인 유닛이 아무도 없어
   * 제어권을 못 주고, 호출자는 "활성 유닛 없음"을 받아 전투가 그대로 멈춘다.
   * 실제로 자동 대전 5000판 중 3판이 이 상태로 정지했다.
   */
  while (!isOver(s)) {
    const alive = aliveUnits(s);
    if (alive.length === 0) {
      checkEnd(s, events);
      break;
    }
    const dt = Math.min(...alive.map((u) => u.wt));
    if (dt > 0) advanceBy(s, dt, events);
    if (isOver(s)) break;

    grantControl(s, events);
    if (s.activeUnit) break;
    // 여기 왔다면 차례를 받을 유닛이 진행 중에 죽은 것이다. 다음 유닛까지 계속 진행한다.
  }
  return commit(s, events);
}

/** WT 0인 유닛에게 제어권을 준다. 여럿이면 시드 난수로 고른다 (GDD §3.3). */
function grantControl(state: BattleState, events: BattleEvent[]): void {
  const ready = aliveUnits(state)
    .filter((u) => u.wt === 0)
    .sort((a, b) => a.id.localeCompare(b.id)); // 난수 소비 전 후보 순서를 결정적으로 고정
  if (ready.length === 0) return;

  const chosen = ready.length === 1 ? ready[0]! : pick(state, ready);
  state.activeUnit = chosen.id;
  state.activeTurn = { moved: false, acted: false, usedUniqueSkill: false };
  state.controlStartedAtMs = null;
  state.phase = 'control';
  events.push({ e: 'phaseChanged', phase: 'control' }, { e: 'controlGranted', unit: chosen.id });
}

/**
 * 턴을 마친다 (GDD §3.3 루프의 4단계).
 * 절대시간을 1 진행시켜 같은 시각에 무한히 머무는 것을 막고, WT를 기준값으로 되돌린다.
 */
function endTurn(state: BattleState, events: BattleEvent[]): void {
  const unit = state.activeUnit ? state.units[state.activeUnit] : undefined;
  if (!unit) return;

  // 「삼고초려」로 걸린 영구 조종(uses === null)은 턴을 써도 풀리지 않는다
  if (unit.control && unit.control.uses !== null) {
    unit.control.uses -= 1;
    if (unit.control.uses <= 0) {
      delete unit.control;
      events.push({ e: 'controlChanged', unit: unit.id, by: null });
    }
  }

  advanceBy(state, FORMULA.turnEndTimeStep, events);
  if (unit.alive) {
    // 지속형 보정(「병귀신속」·「신속」)은 기준값에 더해지고, 한 턴을 소진한다
    const bonus = (unit.wtModifiers ?? []).reduce((n, m) => n + m.delta, 0);
    unit.wt = Math.max(0, unit.wtBase + bonus);
    if (unit.wtModifiers) {
      for (const m of unit.wtModifiers) m.turnsLeft -= 1;
      unit.wtModifiers = unit.wtModifiers.filter((m) => m.turnsLeft > 0);
      if (unit.wtModifiers.length === 0) delete unit.wtModifiers;
    }
    events.push({ e: 'wtChanged', unit: unit.id, to: unit.wt, reason: 'turnEnd' });
  }
  events.push({ e: 'turnEnded', unit: unit.id });

  state.activeUnit = null;
  state.activeTurn = null;
  state.controlStartedAtMs = null;
  if (!isOver(state)) {
    state.phase = 'running';
    events.push({ e: 'phaseChanged', phase: 'running' });
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. 검증 (GDD §3.4)
// ═══════════════════════════════════════════════════════════════

/** 부작용 없는 검사. UI 버튼 활성화 판정에도 그대로 쓴다. */
export function validate(state: BattleState, side: Side, intent: Intent): ValidationResult {
  if (state.phase === 'finished') return no('이미 끝난 전투다');
  if (intent.t === 'surrender') return ok;

  if (intent.t === 'deploy' || intent.t === 'ready') {
    if (state.phase !== 'deploy') return no('배치 단계가 아니다');
    if (state.ready[side]) return no('이미 준비를 마쳤다');
    if (intent.t === 'ready') return ok;

    const mine = unitsOf(state, side);
    if (intent.placements.length !== mine.length) return no('모든 유닛을 배치해야 한다');
    const zone = deployZone(state.mode, side);
    const seen = new Set<string>();
    for (const p of intent.placements) {
      const unit = state.units[p.unit];
      if (!unit || unit.side !== side) return no(`내 유닛이 아니다: ${p.unit}`);
      if (!inBounds(p.pos) || !inZone(zone, p.pos)) return no(`진영 밖이다: ${p.unit}`);
      const k = `${p.pos.x},${p.pos.y}`;
      if (seen.has(k)) return no('같은 칸에 둘 이상 배치할 수 없다');
      seen.add(k);
    }
    return ok;
  }

  if (state.phase !== 'control' || !state.activeUnit) return no('제어 단계가 아니다');
  const unit = state.units[state.activeUnit]!;
  const turn = state.activeTurn!;

  if (intent.t === 'forceSkipTurn') {
    // 상대가 20초를 넘겼을 때 노출되는 버튼이므로 제어권자 본인은 누를 수 없다.
    // 20초 경과 여부는 실시간이라 엔진이 알 수 없다 — 서버가 controlStartedAtMs로 막는다.
    return controllingSide(state, unit) === side ? no('자기 차례는 넘길 수 없다') : ok;
  }
  if (controllingSide(state, unit) !== side) return no('내 차례가 아니다');

  switch (intent.t) {
    case 'move': {
      if (turn.moved) return no('이미 이동했다');
      if (turn.acted) return no('행동을 마친 뒤에는 이동할 수 없다');
      return legalMovesFor(state, unit.id).some((p) => samePos(p, intent.to)) ? ok : no('갈 수 없는 칸이다');
    }
    case 'attack': {
      if (turn.acted) return no('이미 행동했다');
      if (unit.control?.mode === 'moveOnly') return no('조종당하는 중 — 이동만 가능하다');
      const legal = new Set(legalTargetsFor(state, unit.id));
      const maxTargets = getPiece(unit.piece).maxTargets;
      if (intent.targets.length === 0) return no('대상이 없다');
      if (intent.targets.length > maxTargets) return no(`${unit.piece}는 최대 ${maxTargets}명까지 공격한다`);
      if (new Set(intent.targets).size !== intent.targets.length) return no('같은 대상을 중복 지정했다');
      for (const t of intent.targets) if (!legal.has(t)) return no(`공격 범위 밖이다: ${t}`);
      return ok;
    }
    case 'meditate':
      if (turn.acted) return no('이미 행동했다');
      if (unit.control) return no('조종당하는 중에는 명상할 수 없다');
      return unit.mp >= unit.maxMp ? no('MP가 이미 최대다') : ok;
    case 'endTurn':
      return ok;
    case 'castTactic': {
      if (turn.acted) return no('이미 행동했다');
      if (unit.control) return no('조종당하는 중에는 책략을 쓸 수 없다');
      if (hasStatus(unit, 'silence')) return no('침묵 상태다');
      if (!unit.tactics.includes(intent.tactic)) return no('습득하지 않은 책략이다');
      const def = tacticById.get(intent.tactic);
      if (!def) return no(`알 수 없는 책략: ${intent.tactic}`);
      if (unit.mp < tacticMpCost(unit, intent.tactic)) return no('MP가 모자란다');
      const aim = resolveTacticTarget(state, unit, def.effects as readonly Effect[], intent.target);
      return aim.ok ? ok : no(aim.reason);
    }
    case 'castUniqueSkill': {
      // 고유기술은 턴 맨 앞의 별도 단계다 — 행동 선택지가 아니라서 acted를 소비하지 않지만,
      // 이동한 뒤에는 쓸 수 없다 (GDD §3.4).
      if (turn.usedUniqueSkill) return no('이번 턴에 이미 고유기술을 썼다');
      if (turn.moved || turn.acted) return no('고유기술은 이동 전에만 쓸 수 있다');
      if (unit.control) return no('조종당하는 중에는 고유기술을 쓸 수 없다');
      if (unit.uniqueSkillUses <= 0) return no('남은 사용 횟수가 없다');

      const officer = officerById.get(unit.officer)!;
      if (!officer.uniqueSkill) return no('고유기술이 없는 장수다');
      const skill = skillById.get(officer.uniqueSkill);
      if (!skill) return no(`알 수 없는 고유기술: ${officer.uniqueSkill}`);
      if (state.sp[unit.side] < skill.spCost) return no(`SP가 모자란다 (${skill.spCost} 필요)`);
      if (skill.scriptId && !hasSkillScript(skill.scriptId)) return no(`아직 구현되지 않은 고유기술: ${skill.name}`);
      if (!skill.effects.length && !skill.scriptId) return no(`아직 구현되지 않은 고유기술: ${skill.name}`);

      const aim = resolveTacticTarget(state, unit, skill.effects as readonly Effect[], intent.target);
      return aim.ok ? ok : no(aim.reason);
    }
    default:
      return no(`알 수 없는 의도: ${(intent as Intent).t}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 8. 적용
// ═══════════════════════════════════════════════════════════════

/**
 * 작업용 사본을 뜬다. 입력 상태는 절대 건드리지 않는다.
 *
 * `log`만 얕게 복사한다 — 이벤트는 만들고 나면 바뀌지 않는 값이라 참조를 나눠 가져도 안전하다.
 * 로그까지 `structuredClone`에 태우면 호출 비용이 로그 길이에 비례해서
 * 긴 전투가 O(턴²)이 된다. 자동 대전을 수천 판 돌려야 하므로(HANDOFF §7 5번) 여기서 갈린다.
 */
function cloneState(state: BattleState): BattleState {
  const { log, ...rest } = state;
  const copy = structuredClone(rest) as BattleState;
  copy.log = log.slice();
  return copy;
}

function commit(state: BattleState, events: BattleEvent[]): { state: BattleState; events: BattleEvent[] } {
  state.log.push(...events);
  return { state, events };
}

/**
 * 의도를 검증하고 적용해 새 상태와 이벤트를 돌려준다.
 * 검증에 실패하면 던진다 — 서버는 `validate()`로 먼저 거른다.
 */
export function apply(state: BattleState, side: Side, intent: Intent): { state: BattleState; events: BattleEvent[] } {
  const check = validate(state, side, intent);
  if (!check.ok) throw new Error(`잘못된 의도(${side}, ${intent.t}): ${check.reason}`);

  const s = cloneState(state);
  const events: BattleEvent[] = [];

  switch (intent.t) {
    case 'surrender':
      endBattle(s, other(side), 'surrender', events);
      break;

    case 'deploy': {
      for (const p of intent.placements) s.units[p.unit]!.pos = { ...p.pos };
      events.push({ e: 'deployed', side, placements: intent.placements.map((p) => ({ ...p, pos: { ...p.pos } })) });
      break;
    }

    case 'ready': {
      s.ready[side] = true;
      events.push({ e: 'ready', side });
      if (s.ready.P1 && s.ready.P2) {
        s.phase = 'scout';
        events.push({ e: 'phaseChanged', phase: 'scout' });
      }
      break;
    }

    case 'move': {
      const unit = s.units[s.activeUnit!]!;
      const from = unit.pos;

      /*
       * 「자유이동」이 1회 소모형이면(여포 「인중여포 마중적토」) 여기서 깎는다.
       *
       * **마스크 밖으로 갔을 때만** 깎는다 — 원래도 갈 수 있던 한 칸을 움직였다고
       * 「맵 어디든 한 번」이 날아가면 함정이 된다. 감녕 「백기겁위영」은 지속형이라
       * `charges`가 없고, `consumeCharge`가 그런 상태는 건드리지 않는다.
       */
      const free = findStatus(unit, 'freeMove');
      if (free?.charges !== undefined
        && !maskMovesFor(s, unit.id).some((p) => samePos(p, intent.to))) {
        consumeCharge(unit, free, events);
      }

      unit.pos = { ...intent.to };
      s.activeTurn!.moved = true;
      events.push({ e: 'moved', unit: unit.id, from, to: unit.pos });
      break;
    }

    case 'attack': {
      const unit = s.units[s.activeUnit!]!;
      s.activeTurn!.acted = true;
      for (const id of intent.targets) {
        if (isOver(s)) break;
        const target = s.units[id]!;
        if (!target.alive) continue; // Pawn이 2명을 칠 때 첫 대상이 죽어도 두 번째는 유효하다
        resolveAttack(s, unit, target, events);
      }
      if (!s.winner) endTurn(s, events);
      break;
    }

    case 'castTactic': {
      const unit = s.units[s.activeUnit!]!;
      const def = tacticById.get(intent.tactic)!;
      const effects = def.effects as readonly Effect[];
      const aim = resolveTacticTarget(s, unit, effects, intent.target);
      if (!aim.ok) throw new Error(`책략 대상이 잘못됐다: ${aim.reason}`);

      // 환술은 저항당해도 MP를 소모한다 (GDD §3.7 확정)
      const cost = tacticMpCost(unit, intent.tactic);
      unit.mp -= cost;
      s.activeTurn!.acted = true;
      if (cost > 0) events.push({ e: 'mpChanged', unit: unit.id, delta: -cost, reason: `tactic:${def.id}` });

      let resisted = false;
      if (def.requiresResistCheck) {
        const target = aim.ctx.targetUnit;
        resisted = !illusionSucceeds(
          (rate) => roll(s, rate),
          officerById.get(unit.officer)!.intellect,
          target,
          target ? officerById.get(target.officer)!.intellect : 0,
          hasStatus(unit, 'illusionAlways'),
        );
      }
      events.push({ e: 'tacticCast', unit: unit.id, tactic: intent.tactic, resisted });
      if (!resisted) applyEffects(s, aim.ctx, effects, `tactic:${def.id}`, events);
      if (!isOver(s)) endTurn(s, events);
      break;
    }

    case 'castUniqueSkill': {
      const unit = s.units[s.activeUnit!]!;
      const skill = skillById.get(officerById.get(unit.officer)!.uniqueSkill!)!;
      const effects = skill.effects as readonly Effect[];
      const aim = resolveTacticTarget(s, unit, effects, intent.target);
      if (!aim.ok) throw new Error(`고유기술 대상이 잘못됐다: ${aim.reason}`);

      s.sp[unit.side] -= skill.spCost;
      unit.uniqueSkillUses -= 1;
      s.activeTurn!.usedUniqueSkill = true;
      events.push(
        { e: 'spChanged', side: unit.side, to: s.sp[unit.side] },
        { e: 'uniqueSkillCast', unit: unit.id, skill: skill.id as SkillId },
      );

      applyEffects(s, aim.ctx, effects, `skill:${skill.id}`, events);
      if (skill.scriptId) runSkillScript(s, skill.scriptId, aim.ctx, events);
      // 턴을 소비하지 않는다 — 이어서 이동·행동을 할 수 있다 (GDD §3.4)
      break;
    }

    case 'meditate': {
      const unit = s.units[s.activeUnit!]!;
      const gained = Math.min(FORMULA.meditateMp, unit.maxMp - unit.mp);
      unit.mp += gained;
      s.activeTurn!.acted = true;
      events.push({ e: 'mpChanged', unit: unit.id, delta: gained, reason: 'meditate' });
      endTurn(s, events);
      break;
    }

    case 'endTurn':
    case 'forceSkipTurn':
      endTurn(s, events);
      break;

    default:
      throw new Error(`구현되지 않은 의도: ${(intent as Intent).t}`);
  }

  return commit(s, events);
}

/**
 * `types.ts`의 `RulesEngine` 계약 구현체. 서버·클라이언트는 이 객체 하나만 알면 된다.
 * 계약과 구현이 어긋나면 타입 검사에서 걸린다.
 */
export const engine: RulesEngine = {
  createBattle,
  validate,
  apply,
  advanceTime,
  legalMoves: legalMovesFor,
  legalTargets: legalTargetsFor,
  threatRange: threatRangeFor,
};
