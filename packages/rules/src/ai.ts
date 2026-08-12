/**
 * 기준 AI — 밸런스 검증용 (HANDOFF §7 5번)
 *
 * 사람을 흉내내려는 게 아니라 **밸런스 통계를 뽑을 수 있을 만큼만** 합리적인 상대다.
 * 사람이 절대 하지 않을 무의미한 행동(아무 데나 이동)을 하지 않는 것이 목표이며,
 * 그 이상의 수읽기는 하지 않는다.
 *
 * 룰 엔진과 같은 제약을 지킨다 — `Date.now()` · `Math.random()` 금지.
 * 난수는 `BattleState`의 시드 PRNG를 지나므로 **AI가 낀 대전도 시드로 재현된다.**
 *
 * 우선순위 (위에서부터)
 *   1. 고유기술 — 쓸 수 있으면 쓴다 (턴을 소비하지 않으므로 손해가 없다)
 *   2. 지금 자리에서 적을 칠 수 있으면 친다 (죽일 수 있는 적 우선)
 *   3. 이동해서 칠 수 있으면 이동 후 친다
 *   4. 못 치면 가장 가까운 적 쪽으로 한 칸 다가간다
 *   5. **책략** — 칠 수 없는 턴에만 (2026-08-12 추가). 아래 참조
 *   6. MP가 비었으면 명상
 *
 * ## 책략을 「칠 수 없는 턴에만」 쓰는 이유 ★
 *
 * 책략은 턴을 끝내므로 **공격과 경쟁한다.** 어느 쪽이 이득인지는 판을 읽어야 아는데
 * 기준 AI는 그런 수읽기를 하지 않는다. 그래서 **손해가 확실히 없는 자리**에만 넣었다 —
 * 어차피 접근만 하고 끝났을 턴이다. 예전에는 그 자리가 「명상」이었고, 지금은 책략이
 * 먼저 가져간다.
 *
 * 이 정책은 **책략의 가치를 낮게 잡는 쪽**이다. 사람은 붙기 전에 걸어 두거나 결정적인
 * 순간에 쓰지만 여기서는 그러지 않는다. 통계를 읽을 때 그 방향을 감안할 것.
 *
 * > **왜 붙였나** — 이전에는 `castTactic`이 아예 없어서 **지력이 승률에 전혀 반영되지
 * > 않았다.** 지력이 쓰이는 곳은 환술 판정뿐이라, B급(지력형)이 C급과 붙어 보이는 것이
 * > 진짜인지 측정 탓인지 가릴 수 없었다 (HANDOFF §7).
 */

import { officerById, skillById, tacticById } from '@samchess/data';
import { advanceTime, apply, validate } from './battle.ts';
import { aimingSpec } from './effects.ts';
import {
  aliveUnits, chebyshev, controllingSide, effectiveAt, hasStatus, isOver,
  legalMovesFor, legalTargetsFor, unitAt,
} from './state.ts';
import type { BattleEvent, BattleState, Effect, StatusId, TacticId, UnitId, Vec2 } from './types.ts';

/** 한 턴을 끝까지 진행시킨다. 제어 단계에서 호출한다. */
export function takeTurn(state: BattleState): { state: BattleState; events: BattleEvent[] } {
  if (state.phase !== 'control' || !state.activeUnit) {
    throw new Error(`AI는 제어 단계에서만 움직인다 (현재 ${state.phase})`);
  }
  const unitId = state.activeUnit;
  const side = controllingSide(state, state.units[unitId]!);

  let s = state;
  const events: BattleEvent[] = [];
  const push = (r: { state: BattleState; events: BattleEvent[] }) => {
    s = r.state;
    events.push(...r.events);
  };

  // 1. 고유기술 — 턴을 소비하지 않으니 쓸 수 있으면 쓴다
  const skillTarget = chooseSkillTarget(s, unitId);
  if (skillTarget !== 'skip') {
    const intent = { t: 'castUniqueSkill' as const, ...(skillTarget !== undefined ? { target: skillTarget } : {}) };
    if (validate(s, side, intent).ok) push(apply(s, side, intent));
  }
  if (isOver(s)) return { state: s, events };

  // 2. 제자리에서 칠 수 있으면 친다
  let targets = pickTargets(s, unitId);
  if (targets.length > 0) {
    push(apply(s, side, { t: 'attack', targets }));
    return { state: s, events };
  }

  // 3. 이동 후 칠 수 있는 자리를 찾는다
  const spot = findAttackingSpot(s, unitId);
  if (spot) {
    push(apply(s, side, { t: 'move', to: spot }));
    targets = pickTargets(s, unitId);
    if (targets.length > 0) {
      push(apply(s, side, { t: 'attack', targets }));
      return { state: s, events };
    }
  } else {
    // 4. 못 치면 가장 가까운 적 쪽으로 다가간다
    const step = stepTowardNearestEnemy(s, unitId);
    if (step) push(apply(s, side, { t: 'move', to: step }));
  }

  // 5. 칠 수 없는 턴이다 — 책략을 쓸 수 있으면 쓴다 (턴을 끝내므로 여기서 반환)
  const cast = chooseTactic(s, unitId);
  if (cast) {
    push(apply(s, side, cast));
    return { state: s, events };
  }

  // 6. MP가 아쉬우면 명상, 아니면 턴 종료
  const meditate = { t: 'meditate' as const };
  if (validate(s, side, meditate).ok) push(apply(s, side, meditate));
  else push(apply(s, side, { t: 'endTurn' }));

  return { state: s, events };
}

// ── 판단 ───────────────────────────────────────────────────────

/**
 * 고유기술을 쓸지, 쓴다면 무엇을 겨눌지.
 * `'skip'`이면 쓰지 않는다. `undefined`는 "대상 없이 시전".
 */
function chooseSkillTarget(state: BattleState, unitId: UnitId): UnitId | Vec2 | undefined | 'skip' {
  const unit = state.units[unitId]!;
  if (unit.uniqueSkillUses <= 0) return 'skip';
  const skillId = officerById.get(unit.officer)?.uniqueSkill;
  const skill = skillId ? skillById.get(skillId) : undefined;
  if (!skill || state.sp[unit.side] < skill.spCost) return 'skip';

  // 조준이 필요 없으면 그대로 시전
  if (validate(state, unit.side, { t: 'castUniqueSkill' }).ok) return undefined;

  // 적을 겨누는 것 — 가장 약한(= 죽이기 쉬운) 적
  const enemies = aliveUnits(state)
    .filter((u) => u.side !== unit.side)
    .sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id));
  for (const e of enemies) {
    if (validate(state, unit.side, { t: 'castUniqueSkill', target: e.id }).ok) return e.id;
  }
  // 아군을 겨누는 것 — 가장 많이 다친 아군
  const allies = aliveUnits(state)
    .filter((u) => u.side === unit.side)
    .sort((a, b) => (a.hp - a.maxHp) - (b.hp - b.maxHp) || a.id.localeCompare(b.id));
  for (const a of allies) {
    if (validate(state, unit.side, { t: 'castUniqueSkill', target: a.id }).ok) return a.id;
  }
  // 칸을 겨누는 것 — 자기 발밑
  if (validate(state, unit.side, { t: 'castUniqueSkill', target: unit.pos }).ok) return unit.pos;
  return 'skip';
}

/**
 * 이 책략이 거는 상태들. 이미 걸린 대상에게 또 걸어 턴을 버리는 것을 막는 데 쓴다.
 *
 * 엔진이 「같은 상태를 다시 걸면 갱신한다(중첩하지 않는다)」이므로(`effects.ts`),
 * 덧걸기는 지속시간만 늘릴 뿐 그 턴의 값어치가 거의 없다.
 */
function statusesOf(tactic: TacticId): StatusId[] {
  // `@samchess/data`는 룰 패키지에 의존할 수 없어 `effects`를 `unknown[]`으로 둔다.
  // 엔진 안에서는 `battle.ts`와 같은 방식으로 캐스팅해 쓴다.
  const effects = (tacticById.get(tactic)?.effects ?? []) as readonly Effect[];
  return effects.flatMap((e) => (e.t === 'applyStatus' ? [e.status] : []));
}

/**
 * 회복만 하는 책략인가. 만HP 대상에게 걸면 **아무 일도 일어나지 않고 턴만 없어진다.**
 *
 * 상태이상은 `statusesOf`로 덧걸기를 걸러 내지만 회복은 상태가 아니라 걸러지지 않았다 —
 * 실측에서 「대회복」이 300판에 2595번 나갔고 그 상당수가 멀쩡한 아군에게였다.
 * 베이스라인이 턴을 이렇게 버리면 **책략 전체의 값어치가 낮게 측정된다.**
 */
function healOnly(tactic: TacticId): boolean {
  const effects = (tacticById.get(tactic)?.effects ?? []) as readonly Effect[];
  return effects.length > 0 && effects.every((e) => e.t === 'heal');
}

/**
 * 쓸 책략과 그 대상을 고른다. 쓸 것이 없으면 `undefined`.
 *
 * **무엇을 고르는가** — 쓸 수 있는 것 중 **레벨이 가장 높은 것**. 레벨이 높을수록 세다는
 * 것이 성장 설계이므로(GDD §3.7), 베이스라인이 판을 읽지 않고도 「그럭저럭 센 것」을 고른다.
 *
 * **누구를 겨누는가** — 여기가 지력이 실제로 의미를 갖는 자리다.
 *  - 적 지정: **지력이 가장 낮은 적**. 환술 성공률이 `20 + 지력차`라 가장 잘 걸린다
 *  - 아군 지정: 가장 많이 다친 아군 (고유기술 정책과 같다)
 *  - 칸 지정: 가장 가까운 적의 인접 빈 칸 — 「함정」을 놓을 만한 자리
 *
 * 조준 규약도 통과 여부도 전부 엔진에 묻는다. AI가 규칙을 다시 구현하지 않는다.
 */
function chooseTactic(
  state: BattleState, unitId: UnitId,
): { t: 'castTactic'; tactic: TacticId; target?: UnitId | Vec2 } | undefined {
  const unit = state.units[unitId]!;
  if (unit.tactics.length === 0) return undefined;
  const side = controllingSide(state, unit);

  // 센 것부터 본다. 같은 레벨이면 id로 결정적으로.
  const ordered = [...unit.tactics].sort((a, b) => {
    const la = tacticById.get(a)?.level ?? 0;
    const lb = tacticById.get(b)?.level ?? 0;
    return lb - la || a.localeCompare(b);
  });

  for (const tactic of ordered) {
    const def = tacticById.get(tactic);
    if (!def) continue;
    const spec = aimingSpec(def.effects as readonly Effect[]);
    const applied = statusesOf(tactic);
    const ok = (target?: UnitId | Vec2): boolean =>
      validate(state, side, { t: 'castTactic', tactic, ...(target !== undefined ? { target } : {}) }).ok;

    // 회복만 하는 책략은 다친 아군이 있을 때만 (만HP에 걸면 턴만 버린다)
    const hurt = aliveUnits(state).some((u) => u.side === unit.side && u.hp < u.maxHp);
    if (healOnly(tactic) && !hurt) continue;

    // 조준이 필요 없는 것 — 자기 자신·전체 대상
    if (!spec) {
      if (ok()) return { t: 'castTactic', tactic };
      continue;
    }

    if (spec.kind === 'enemyOne') {
      const enemies = aliveUnits(state)
        .filter((u) => u.side !== unit.side)
        // 지력이 낮을수록 잘 걸린다 (FORMULA.illusionRate). 동률이면 약한 쪽부터.
        .sort((a, b) => (officerById.get(a.officer)!.intellect - officerById.get(b.officer)!.intellect)
          || a.hp - b.hp || a.id.localeCompare(b.id));
      for (const e of enemies) {
        if (applied.some((s) => hasStatus(e, s))) continue;   // 이미 걸려 있다 — 턴이 아깝다
        if (ok(e.id)) return { t: 'castTactic', tactic, target: e.id };
      }
      continue;
    }

    if (spec.kind === 'allyOne') {
      const allies = aliveUnits(state)
        .filter((u) => u.side === unit.side)
        .sort((a, b) => (a.hp - a.maxHp) - (b.hp - b.maxHp) || a.id.localeCompare(b.id));
      for (const a of allies) {
        if (applied.some((s) => hasStatus(a, s))) continue;
        if (healOnly(tactic) && a.hp >= a.maxHp) continue;    // 멀쩡한 아군을 치료하지 않는다
        if (ok(a.id)) return { t: 'castTactic', tactic, target: a.id };
      }
      continue;
    }

    // 칸 지정 — 가장 가까운 적의 발밑 8방향 중 빈 칸
    const goal = aliveUnits(state)
      .filter((u) => u.side !== unit.side)
      .sort((a, b) => chebyshev(unit.pos, a.pos) - chebyshev(unit.pos, b.pos) || a.id.localeCompare(b.id))[0];
    if (!goal) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const pos = { x: goal.pos.x + dx, y: goal.pos.y + dy };
        if (unitAt(state, pos)) continue;
        if (ok(pos)) return { t: 'castTactic', tactic, target: pos };
      }
    }
  }
  return undefined;
}

/**
 * 지금 자리에서 칠 대상. Pawn은 최대 2명까지 고른다.
 * **이번 공격으로 죽는 적**을 최우선으로, 그다음 HP가 낮은 순.
 */
function pickTargets(state: BattleState, unitId: UnitId): UnitId[] {
  const unit = state.units[unitId]!;
  const legal = legalTargetsFor(state, unitId);
  if (legal.length === 0) return [];

  const damage = effectiveAt(unit);
  const ranked = legal
    .map((id) => state.units[id]!)
    .sort((a, b) => {
      const lethal = Number(b.hp <= damage) - Number(a.hp <= damage);
      if (lethal !== 0) return lethal;
      // King을 노릴 수 있으면 노린다 — 잡으면 그대로 승리다
      const king = Number(b.piece === 'King') - Number(a.piece === 'King');
      if (king !== 0) return king;
      return a.hp - b.hp || a.id.localeCompare(b.id);
    });

  const max = unit.piece === 'Pawn' ? 2 : 1;
  return ranked.slice(0, max).map((u) => u.id);
}

/** 이동해서 공격이 닿는 자리. 여러 곳이면 가장 많이 때릴 수 있는 곳. */
function findAttackingSpot(state: BattleState, unitId: UnitId): Vec2 | undefined {
  const moves = legalMovesFor(state, unitId);
  if (moves.length === 0) return undefined;

  let best: { pos: Vec2; score: number } | undefined;
  for (const pos of moves) {
    // 이동을 가정하고 사거리를 재본다 (실제 상태는 건드리지 않는다)
    const probe = { ...state, units: { ...state.units, [unitId]: { ...state.units[unitId]!, pos } } };
    const score = legalTargetsFor(probe, unitId).length;
    if (score === 0) continue;
    if (!best || score > best.score) best = { pos, score };
  }
  return best?.pos;
}

/** 가장 가까운 적에게 한 걸음. 거리가 같으면 id로 결정적으로 고른다. */
function stepTowardNearestEnemy(state: BattleState, unitId: UnitId): Vec2 | undefined {
  const unit = state.units[unitId]!;
  const enemies = aliveUnits(state).filter((u) => u.side !== unit.side);
  if (enemies.length === 0) return undefined;

  const goal = enemies
    .slice()
    .sort((a, b) => chebyshev(unit.pos, a.pos) - chebyshev(unit.pos, b.pos) || a.id.localeCompare(b.id))[0]!;

  const moves = legalMovesFor(state, unitId);
  if (moves.length === 0) return undefined;

  let best: { pos: Vec2; dist: number } | undefined;
  for (const pos of moves) {
    const dist = chebyshev(pos, goal.pos);
    if (!best || dist < best.dist) best = { pos, dist };
  }
  // 지금보다 가까워지지 않으면 움직이지 않는다 (제자리 왕복 방지)
  return best && best.dist < chebyshev(unit.pos, goal.pos) ? best.pos : undefined;
}

// ── 자동 대전 ──────────────────────────────────────────────────

export interface AutoBattleResult {
  winner: BattleState['winner'];
  /** 어떻게 끝났는가 */
  outcome: NonNullable<BattleState['outcome']>;
  /** 제어권이 넘어간 횟수 */
  turns: number;
  /** 종료 시점의 절대시간 */
  time: number;
  /** 상한 판정으로 끝났는가 (판정승 또는 무승부) */
  timedOut: boolean;
  state: BattleState;
}

/**
 * 양측 모두 AI로 끝까지 돌린다.
 *
 * 무승부 상한(`FORMULA.drawTimeLimit`)은 **엔진이 직접 판정**하므로 여기서 재지 않는다.
 * `maxTurns`는 엔진에 버그가 생겨 끝나지 않을 때를 대비한 안전장치일 뿐이다.
 */
export function autoBattle(initial: BattleState, opts: { maxTurns?: number } = {}): AutoBattleResult {
  const maxTurns = opts.maxTurns ?? 20_000;

  let s = initial;
  if (s.phase === 'deploy') {
    s = apply(s, 'P1', { t: 'ready' }).state;
    s = apply(s, 'P2', { t: 'ready' }).state;
  }

  let turns = 0;
  while (!isOver(s) && turns < maxTurns) {
    s = advanceTime(s).state;
    if (isOver(s)) break;
    if (!s.activeUnit) {
      // 엔진이 제어권을 주지 못했다. 정상 경로에는 없는 상태이므로 무승부로 뭉개지 않고 드러낸다 —
      // 예전에 스케줄러 정지 버그가 여기서 '무승부'로 위장돼 통계에 묻혔다.
      throw new Error(`스케줄러가 제어권을 주지 못했다 (time ${s.time}, ${turns}턴)`);
    }
    turns++;
    s = takeTurn(s).state;
  }
  if (!isOver(s)) throw new Error(`${maxTurns}턴 안에 끝나지 않았다 — 무승부 상한이 동작하지 않는다`);

  return {
    winner: s.winner,
    outcome: s.outcome!,
    turns,
    time: s.time,
    timedOut: s.outcome === 'timeLimit' || s.outcome === 'draw',
    state: s,
  };
}
