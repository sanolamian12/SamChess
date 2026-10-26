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
 * 우선순위 (위에서부터) — **대전제: 적 King · 적 군량고를 노리고, 내 King · 내 군량고를 지킨다**
 * (2026-10-19 기획자, GDD §3.9)
 *   1. 고유기술 — 쓸 수 있으면 쓴다 (턴을 소비하지 않으므로 손해가 없다)
 *   2. **지금 이길 수 있으면 이긴다** — 적 군량고에 닿으면 들어가고, 적 King을 이번 공격으로
 *      쓰러뜨릴 수 있으면(제자리 · 이동 후) 친다
 *   3. **지킨다** — 적이 내 King · 내 군량고 가까이(`GUARD_RADIUS`) 왔거나 다음 차례에 닿을 때만
 *      - 그 침입자를 이번 공격으로 죽일 수 있으면 죽인다
 *      - 군량고에 다음 걸음으로 들어올 적이 있으면 군량고 칸에 올라선다(서 있으면 떠나지 않는다)
 *      - King은 노려지는 칸에서 **덜 노려지는 칸으로 물러난다**
 *      - 침입자를 지금 칠 수 있는 아군과, 침입자에게 가장 가까운 아군 둘(`RESPONDERS`)이 맞받아친다
 *   4. 지금 자리에서 적을 칠 수 있으면 친다 (죽일 수 있는 King > 죽일 수 있는 적 > King > HP 낮은 적)
 *   5. 이동해서 칠 수 있으면 이동 후 친다 — King은 **노려지지 않는 칸**으로만 나간다
 *   6. 못 치면 **적 King과 적 군량고 중 가까운 쪽**으로 다가간다 — King은 제자리를 지킨다.
 *      한 걸음으로 가까워질 칸이 없으면 **기물 걸음으로 길을 찾는다**(`unstick`, 2026-10-19) —
 *      맞받아치는 장수도 같다
 *   7. **책략** — 칠 수 없는 턴에만 (2026-08-12 추가). 아래 참조
 *   8. MP가 비었으면 명상
 *
 * 조종당하는 장수(「유인」 · 「초선」)는 2 · 3 · 6의 목표를 보지 않는다 — 조종당한 이동은 탈취가
 * 아니고, 남의 장수로 지켜 주는 것도 이 AI의 몫이 아니다. 가까운 적을 치거나 다가갈 뿐이다.
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
 *
 * ## 시장 아이템은 **안 쓴다** (2026-09-23, GDD §6.5)
 *
 * AI 상대는 **계정이 없어 아이템을 못 산다** — 들고 나올 것이 애초에 없다(기획자
 * 확정). 도적떼도 마찬가지고, 온라인은 양쪽이 사람이라 AI가 낄 자리가 아니다.
 * 남는 갈래는 「사람의 유닛이 조종당해 AI가 지시를 내리는」 한 경우뿐인데,
 * 그때는 엔진이 `useItem`을 막는다(「조종당하는 중에는 아이템을 쓸 수 없다」) —
 * **여기 한 줄도 더하지 않는 것이 규칙의 결과이지 빠뜨린 것이 아니다.**
 */

import { combatantById, skillById, tacticById } from '@samchess/data';
import { advanceTime, apply, validate } from './battle.ts';
import { aimingSpec } from './effects.ts';
import { attackCells, getPiece, legalMoves } from './pieces.ts';
import {
  aliveUnits, boardQuery, chebyshev, controllingSide, effectiveAt, hasStatus, isOver,
  legalMovesFor, legalTargetsFor, officerStats, other, samePos, supplyDepotOf, threatRangeFor,
  uniqueSkillCost, unitAt,
} from './state.ts';
import type {
  BattleEvent, BattleState, Effect, Intent, Side, StatusId, TacticId, UnitId, UnitState, Vec2,
} from './types.ts';

/** 한 턴을 끝까지 진행시킨다. 제어 단계에서 호출한다. */
/**
 * **아무것도 안 하는 차례** — 튜토리얼의 허수아비(기본 1 · 2). 제어권을 받자마자 턴을 넘긴다.
 * 판정은 평범한 `endTurn`이라 시간 · WT는 대전과 똑같이 흐른다.
 */
export function idleTurn(state: BattleState): { state: BattleState; events: BattleEvent[] } {
  if (state.phase !== 'control' || !state.activeUnit) {
    throw new Error(`허수아비도 제어 단계에서만 턴을 넘긴다 (현재 ${state.phase})`);
  }
  return apply(state, controllingSide(state, state.units[state.activeUnit]!), { t: 'endTurn' });
}

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
  /*
   * **시전 지연이 걸린 기술은 그 자리에서 턴을 끝낸다** (2026-09-07).
   *
   * 그러면 `activeUnit`이 null이라 아래의 공격·이동이 `validate`에서 걸려
   * `apply()`가 던진다 — 가드가 없으면 AI 대전이 통째로 죽는다.
   * 「시전만 하고 물러난다」가 이 턴의 전부다.
   */
  if (!s.activeUnit) return { state: s, events };

  const me = s.units[unitId]!;
  const act = (intent: Intent) => push(apply(s, side, intent));
  const done = () => ({ state: s, events });
  const finish = () => {
    // 7 · 8. 칠 수 없는 턴이다 — 책략, 아니면 명상, 아니면 턴 종료
    const cast = chooseTactic(s, unitId);
    if (cast) act(cast);
    else if (validate(s, side, { t: 'meditate' }).ok) act({ t: 'meditate' });
    else act({ t: 'endTurn' });
    return done();
  };
  /** 칠 수 있으면 치고 `true`(턴이 닫힌다). `only`가 있으면 그 적들만 */
  const strike = (only?: ReadonlySet<UnitId>): boolean => {
    const targets = pickTargets(s, unitId, only);
    if (targets.length === 0) return false;
    act({ t: 'attack', targets });
    return true;
  };

  if (me.control) {
    // 조종당하는 장수 — 목표 없이 가까운 적을 치거나 다가간다
    if (strike()) return done();
    const spot = findAttackingSpot(s, unitId);
    if (spot) {
      act({ t: 'move', to: spot });
      if (strike()) return done();
    } else {
      const step = stepToward(s, unitId, nearestEnemy(s, unitId)?.pos);
      if (step) act({ t: 'move', to: step });
    }
    return finish();
  }

  const isKing = me.piece === 'King';
  /** 홀로 남은 King — 지켜 줄 아군이 없으니 물러나지 않고 나선다(아래 3 · 6) */
  const alone = isKing && !aliveUnits(s).some((u) => u.side === me.side && u.id !== me.id);
  const theirDepot = supplyDepotOf(s, other(me.side));
  const theirKing = aliveUnits(s).find((u) => u.side !== me.side && u.piece === 'King');

  // 2. 지금 이길 수 있으면 이긴다
  if (theirDepot && legalMovesFor(s, unitId).some((p) => samePos(p, theirDepot))) {
    act({ t: 'move', to: theirDepot });
    return done();
  }
  if (theirKing && theirKing.hp <= effectiveAt(me)) {
    const only = new Set([theirKing.id]);
    if (strike(only)) return done();
    const spot = findAttackingSpot(s, unitId, only);
    if (spot) {
      act({ t: 'move', to: spot });
      if (strike(only)) return done();
    }
  }

  // 3. 지킨다 — 적이 가까이 왔을 때만
  const watch = watchOf(s, me.side, unitId);
  let holdGround = false;
  if (watch.intruders.size > 0) {
    const damage = effectiveAt(me);
    const lethal = new Set([...watch.intruders].filter((id) => s.units[id]!.hp <= damage));
    if (lethal.size > 0 && strike(lethal)) return done();

    // 군량고 — 다음 걸음에 들어올 적이 있으면 올라선다. 서 있으면 떠나지 않는다
    const depot = watch.depot;
    if (depot && watch.raiders.length > 0) {
      if (samePos(me.pos, depot)) holdGround = true;
      else if ((!isKing || alone) && !s.activeTurn!.moved && !unitAt(s, depot)
        && legalMovesFor(s, unitId).some((p) => samePos(p, depot))) {
        act({ t: 'move', to: depot });
        holdGround = true;
      }
    }

    // King — 노려지는 중이면 덜 노려지는 칸으로 물러난 뒤 칠 수 있으면 친다
    // 홀로 남은 King은 물러나지 않는다 — King 둘만 남으면 서로 다가갔다 물러났다를 상한까지 되풀이했다
    if (isKing && !alone && !holdGround && watch.kingThreats.length > 0 && !s.activeTurn!.moved) {
      const safer = saferCell(s, unitId);
      if (safer) act({ t: 'move', to: safer });
      if (strike()) return done();
      return finish();
    }

    // 맞받아친다 — 침입자를 칠 수 있는 장수, 아니면 가장 가까운 아군 둘이 다가간다
    if (!isKing && !holdGround && !s.activeTurn!.moved) {
      if (strike(watch.intruders)) return done();
      const spot = findAttackingSpot(s, unitId, watch.intruders);
      if (spot) {
        act({ t: 'move', to: spot });
        if (strike(watch.intruders) || strike()) return done();
        return finish();
      }
      if (watch.responders.includes(unitId)) {
        const step = stepToward(s, unitId, watch.focus) ?? pathStep(s, unitId, hitsAny(s, unitId, watch.intruders));
        if (step) act({ t: 'move', to: step });
        if (strike()) return done();
        return finish();
      }
    }
  }

  // 4. 제자리에서 칠 수 있으면 친다
  if (strike()) return done();
  if (holdGround || s.activeTurn!.moved) return finish();

  // 5. 이동해서 친다 — King은 노려지지 않는 칸으로만
  const spot = findAttackingSpot(s, unitId, undefined, isKing ? safeFrom(s, me.side, unitId) : undefined);
  if (spot) {
    act({ t: 'move', to: spot });
    if (strike()) return done();
    return finish();
  }

  /*
   * 6. 다가간다 — 적 King과 적 군량고 중 가까운 쪽. King은 제자리를 지킨다.
   * **다만 홀로 남은 King은 나선다** — 지키라고 남겨 두면 King 둘만 남은 판이 양쪽 다
   * 제자리에서 상한(time 6000)까지 서 있었다(3v3 자동 대전 7.6%가 무승부). 그때도
   * 노려지지 않는 칸을 먼저 고른다.
   */
  if (!isKing || alone) {
    const goals = [theirKing?.pos, theirDepot ?? undefined]
      .filter((g): g is Vec2 => g !== undefined)
      .sort((a, b) => chebyshev(me.pos, a) - chebyshev(me.pos, b));
    const allow = alone ? safeFrom(s, me.side, unitId) : undefined;
    const step = stepToward(s, unitId, goals[0], allow)
      ?? stepToward(s, unitId, nearestEnemy(s, unitId)?.pos, allow)
      ?? unstick(s, unitId, allow);
    if (step) act({ t: 'move', to: step });
  }
  return finish();
}

// ── 판단 ───────────────────────────────────────────────────────

/** 적이 이 거리(체비쇼프) 안에 들어오면 「가까이 왔다」 — 지키기 시작한다 */
export const GUARD_RADIUS = 4;
/** 침입자에게 다가가는 아군 수(King 제외). 전원이 돌아서면 공격이 멈춘다 */
export const RESPONDERS = 2;

interface Watch {
  depot: Vec2 | null;
  /** 지금 자리에서 다음 차례에 내 King을 칠 수 있는 적 */
  kingThreats: UnitId[];
  /** 다음 걸음에 내 군량고로 들어올 수 있는 적 */
  raiders: UnitId[];
  /** 지켜야 할 침입자 — 가까이 온 적 + 위의 둘 */
  intruders: ReadonlySet<UnitId>;
  /** 맞받아치러 다가가는 아군 */
  responders: UnitId[];
  /** 그들이 향할 곳 — 지킬 것에 가장 가까운 침입자 */
  focus?: Vec2;
}

/** `side`가 지금 지켜야 할 것. `keeper`는 이번 차례의 장수다(군량고 위에 서 있으면 비켜 섰다고 보고 잰다). */
function watchOf(state: BattleState, side: Side, keeper: UnitId): Watch {
  const depot = supplyDepotOf(state, side);
  const king = aliveUnits(state).find((u) => u.side === side && u.piece === 'King');
  const enemies = aliveUnits(state).filter((u) => u.side !== side);

  const kingThreats = king
    ? enemies.filter((e) => threatRangeFor(state, e.id).some((p) => samePos(p, king.pos))).map((e) => e.id)
    : [];
  const raiders = depot ? depotRaiders(state, side, depot, keeper) : [];
  const assets = [king?.pos, depot ?? undefined].filter((a): a is Vec2 => a !== undefined);
  const near = (e: UnitState): boolean => assets.some((a) => chebyshev(e.pos, a) <= GUARD_RADIUS);
  const intruders = new Set<UnitId>([...enemies.filter(near).map((e) => e.id), ...kingThreats, ...raiders]);
  if (intruders.size === 0) return { depot, kingThreats, raiders, intruders, responders: [] };

  const gap = (e: UnitState): number => Math.min(...assets.map((a) => chebyshev(e.pos, a)));
  const focus = [...intruders].map((id) => state.units[id]!)
    .sort((a, b) => gap(a) - gap(b) || a.id.localeCompare(b.id))[0]!.pos;
  const responders = aliveUnits(state)
    .filter((u) => u.side === side && u.piece !== 'King' && !u.control)
    .sort((a, b) => chebyshev(a.pos, focus) - chebyshev(b.pos, focus) || a.id.localeCompare(b.id))
    .slice(0, RESPONDERS)
    .map((u) => u.id);
  return { depot, kingThreats, raiders, intruders, responders, focus };
}

/** 이 칸에 서면 다음 차례에 칠 수 있는 적의 수 — King이 설 자리를 고를 때 쓴다 */
function exposure(state: BattleState, side: Side, mover: UnitId, at: Vec2): number {
  const probe = { ...state, units: { ...state.units, [mover]: { ...state.units[mover]!, pos: at } } };
  return aliveUnits(probe)
    .filter((u) => u.side !== side)
    .filter((e) => threatRangeFor(probe, e.id).some((p) => samePos(p, at)))
    .length;
}

/** 노려지지 않는 칸만 통과시키는 거름 */
function safeFrom(state: BattleState, side: Side, mover: UnitId): (p: Vec2) => boolean {
  return (p) => exposure(state, side, mover, p) === 0;
}

/**
 * 동점인 칸 둘 중 어느 쪽인가 — **진영에 대해 대칭으로** 가른다 (2026-10-19).
 *
 * 남군과 북군은 판을 위아래로 뒤집은 자리에 선다. 동점을 「먼저 찾은 칸」(마스크 순서 · y 오름차순)으로
 * 가르면 한쪽 진영만 앞으로, 다른 쪽은 옆으로 움직이는 식의 치우침이 생긴다 — 목표를 따라 걷게 된 뒤
 * 3v3 자동 대전 2000판에서 북군이 54.8%였다. 그래서 「제 진영 쪽(뒤)」을 먼저, 그다음 x 순으로 가른다
 * (x는 위아래 뒤집기에 그대로라 대칭이다). 음수면 `a`가 낫다.
 */
function tieBreak(side: Side, a: Vec2, b: Vec2): number {
  const back = (p: Vec2): number => (side === 'P1' ? -p.y : p.y);
  return back(a) - back(b) || a.x - b.x;
}

/** 목표까지의 거리 — 체비쇼프가 같으면 유클리드 제곱으로 한 번 더 가른다(대각선 쪽을 덜 고른다) */
const near2 = (p: Vec2, goal: Vec2): number => chebyshev(p, goal) * 10_000 + (p.x - goal.x) ** 2 + (p.y - goal.y) ** 2;

/** 지금보다 덜 노려지는 칸. 같으면 내 군량고에 가까운 쪽. 나아지지 않으면 `undefined` */
function saferCell(state: BattleState, unitId: UnitId): Vec2 | undefined {
  const unit = state.units[unitId]!;
  const home = supplyDepotOf(state, unit.side) ?? unit.pos;
  const now = exposure(state, unit.side, unitId, unit.pos);
  let best: { pos: Vec2; risk: number; d: number } | undefined;
  for (const pos of legalMovesFor(state, unitId)) {
    const risk = exposure(state, unit.side, unitId, pos);
    const d = chebyshev(pos, home);
    if (!best || risk < best.risk || (risk === best.risk && (d < best.d
      || (d === best.d && tieBreak(unit.side, pos, best.pos) < 0)))) best = { pos, risk, d };
  }
  return best && best.risk < now ? best.pos : undefined;
}

/**
 * 다음 걸음에 `side`의 군량고로 들어올 수 있는 적. **`keeper`가 비켜 섰다고 가정하고** 잰다 —
 * 지키고 서 있는 장수가 「노리는 적이 없다」로 읽혀 자리를 뜨면 바로 뚫린다.
 * 조종당하는 적은 넣지 않는다(그 이동은 탈취가 아니다).
 */
function depotRaiders(state: BattleState, side: Side, depot: Vec2, keeper: UnitId): UnitId[] {
  const k = state.units[keeper]!;
  const probe = samePos(k.pos, depot)
    ? { ...state, units: { ...state.units, [keeper]: { ...k, alive: false } } }
    : state;
  return aliveUnits(probe)
    .filter((u) => u.side !== side && !u.control)
    .filter((u) => legalMovesFor(probe, u.id).some((p) => samePos(p, depot)))
    .map((u) => u.id);
}

/**
 * 고유기술을 쓸지, 쓴다면 무엇을 겨눌지.
 * `'skip'`이면 쓰지 않는다. `undefined`는 "대상 없이 시전".
 */
function chooseSkillTarget(state: BattleState, unitId: UnitId): UnitId | Vec2 | undefined | 'skip' {
  const unit = state.units[unitId]!;
  if (unit.uniqueSkillUses <= 0) return 'skip';
  const skillId = combatantById.get(unit.officer)?.uniqueSkill;
  const skill = skillId ? skillById.get(skillId) : undefined;
  if (!skill || state.sp[unit.side] < uniqueSkillCost(unit)!) return 'skip';

  // 조준이 필요 없으면 그대로 시전
  if (validate(state, unit.side, { t: 'castUniqueSkill' }).ok) return undefined;

  // 적을 겨누는 것 — 가장 약한(= 죽이기 쉬운) 적. 곽가 「유언계책」만 **가장 센** 적이다
  // (2026-10-26 기획자 확정) — 표식은 때리는 것이 아니라 「곽가가 쓰러지면 함께 데려갈 자」라서다.
  // 셈은 최대 HP × 공격력이다. 표식을 보고 곽가를 피해 다니는 판단은 넣지 않았다(상대 AI는 표식을 안 본다).
  const spec = aimingSpec(skill.effects as readonly Effect[]);
  const strongest = spec?.kind === 'enemyOne' && spec.requires === 'deathMarkable';
  const enemies = aliveUnits(state)
    .filter((u) => u.side !== unit.side)
    .sort(strongest
      ? (a, b) => b.maxHp * effectiveAt(b) - a.maxHp * effectiveAt(a) || a.id.localeCompare(b.id)
      : (a, b) => a.hp - b.hp || a.id.localeCompare(b.id));
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
        .sort((a, b) => (officerStats(a).intellect - officerStats(b).intellect)
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
 * 지금 자리에서 칠 대상. 몇 명까지인지는 기물 데이터(`maxTargets`)가 정한다 — 지금은 전 기물 1명.
 * **이번 공격으로 죽는 King** → 죽는 적 → King(잡으면 그대로 승리다) → HP 낮은 순.
 * `only`가 있으면 그 적들 안에서만 고른다.
 */
function pickTargets(state: BattleState, unitId: UnitId, only?: ReadonlySet<UnitId>): UnitId[] {
  const unit = state.units[unitId]!;
  const legal = legalTargetsFor(state, unitId).filter((id) => !only || only.has(id));
  if (legal.length === 0) return [];

  const damage = effectiveAt(unit);
  const rank = (u: UnitState): number => {
    const lethal = u.hp <= damage;
    const king = u.piece === 'King';
    return (lethal && king ? 4 : 0) + (lethal ? 2 : 0) + (king ? 1 : 0);
  };
  const ranked = legal
    .map((id) => state.units[id]!)
    .sort((a, b) => rank(b) - rank(a) || a.hp - b.hp || a.id.localeCompare(b.id));

  return ranked.slice(0, getPiece(unit.piece).maxTargets).map((u) => u.id);
}

/**
 * 이동해서 공격이 닿는 자리. 여러 곳이면 **King이 닿는 곳**, 그다음 가장 많이 때릴 수 있는 곳.
 * `only`가 있으면 그 적들만 센다. `allow`는 설 수 있는 칸을 거른다(King의 안전한 칸).
 */
function findAttackingSpot(
  state: BattleState, unitId: UnitId, only?: ReadonlySet<UnitId>, allow?: (p: Vec2) => boolean,
): Vec2 | undefined {
  const side = state.units[unitId]!.side;
  let best: { pos: Vec2; score: number } | undefined;
  for (const pos of legalMovesFor(state, unitId)) {
    // 이동을 가정하고 사거리를 재본다 (실제 상태는 건드리지 않는다)
    const probe = { ...state, units: { ...state.units, [unitId]: { ...state.units[unitId]!, pos } } };
    const hits = legalTargetsFor(probe, unitId).filter((id) => !only || only.has(id));
    if (hits.length === 0) continue;
    const score = hits.length + (hits.some((id) => state.units[id]!.piece === 'King') ? 100 : 0);
    if (best && (score < best.score || (score === best.score && tieBreak(side, pos, best.pos) >= 0))) continue;
    if (allow && !allow(pos)) continue;
    best = { pos, score };
  }
  return best?.pos;
}

function nearestEnemy(state: BattleState, unitId: UnitId): UnitState | undefined {
  const unit = state.units[unitId]!;
  return aliveUnits(state)
    .filter((u) => u.side !== unit.side)
    .sort((a, b) => chebyshev(unit.pos, a.pos) - chebyshev(unit.pos, b.pos) || a.id.localeCompare(b.id))[0];
}

/**
 * 목표 쪽으로 한 걸음. 거리가 같으면 `tieBreak`. 지금보다 가까워지지 않으면 움직이지 않는다.
 * `allow`가 있으면 **그 칸 중에서 먼저** 고르고, 하나도 없으면 아무 칸이나 고른다.
 */
function stepToward(
  state: BattleState, unitId: UnitId, goal: Vec2 | undefined, allow?: (p: Vec2) => boolean,
): Vec2 | undefined {
  if (!goal) return undefined;
  const unit = state.units[unitId]!;
  const closer = legalMovesFor(state, unitId).filter((p) => chebyshev(p, goal) < chebyshev(unit.pos, goal));
  const safe = allow ? closer.filter(allow) : closer;
  let best: { pos: Vec2; dist: number } | undefined;
  for (const pos of safe.length > 0 ? safe : closer) {
    const dist = near2(pos, goal);
    if (!best || dist < best.dist || (dist === best.dist && tieBreak(unit.side, pos, best.pos) < 0)) best = { pos, dist };
  }
  // 지금보다 가까워지지 않으면 움직이지 않는다 (제자리 왕복 방지)
  return best?.pos;
}

/**
 * 막혔을 때 — 적 King을 칠 자리 · 적 군량고, 아니면 아무 적이나 칠 자리로 기물 걸음의 길을 찾는다 (2026-10-19).
 *
 * `stepToward`는 체비쇼프 거리가 **줄어드는 한 걸음**만 본다. 기물 걸음과 거리가 어긋나면 그 자리에서 영원히 선다 —
 * 남군 군량고 바로 위에 선 북군 Bishop은 칸 색이 달라 **군량고에 영원히 못 들어가고**, 비켜 갈 걸음도 거리를 안 줄여
 * 안 움직였다. 지키는 쪽도 다가갈 칸이 없어 같이 서서, 5v5 자동 대전에서 여섯이 상한(time 6000)까지 턴만 넘겼다
 * (상한을 30000으로 늘려도 안 끝났다). 그 자리에서만 길을 찾는다 — 평소의 걸음은 그대로다.
 */
function unstick(state: BattleState, unitId: UnitId, allow?: (p: Vec2) => boolean): Vec2 | undefined {
  const me = state.units[unitId]!;
  const depot = supplyDepotOf(state, other(me.side));
  const enemies = aliveUnits(state).filter((u) => u.side !== me.side);
  const king = enemies.filter((u) => u.piece === 'King').map((u) => u.id);
  const goal = (p: Vec2): boolean => (depot !== null && samePos(p, depot)) || hitsAny(state, unitId, new Set(king))(p);
  return pathStep(state, unitId, goal, allow) ?? pathStep(state, unitId, hitsAny(state, unitId, new Set(enemies.map((u) => u.id))), allow);
}

/** 이 칸에 서면 `targets` 중 하나를 칠 수 있는가 (사거리만 — 상태이상은 안 본다) */
function hitsAny(state: BattleState, unitId: UnitId, targets: ReadonlySet<UnitId>): (p: Vec2) => boolean {
  const piece = state.units[unitId]!.piece;
  const at = [...targets].map((id) => state.units[id]!).filter((u) => u.alive).map((u) => u.pos);
  return (p) => attackCells(piece, p, state.boardSize).some((c) => at.some((t) => samePos(c, t)));
}

/** 기물 걸음으로 `goal`에 가장 빨리 닿는 길의 첫 걸음(BFS, 깊이 6). 다른 장수는 지금 자리에 있다고 본다 */
function pathStep(state: BattleState, unitId: UnitId, goal: (p: Vec2) => boolean, allow?: (p: Vec2) => boolean): Vec2 | undefined {
  const unit = state.units[unitId]!;
  const board = boardQuery(state, unitId);
  const key = (p: Vec2): number => p.y * 64 + p.x;
  const seen = new Set<number>([key(unit.pos)]);
  const firsts = legalMovesFor(state, unitId).filter((p) => !allow || allow(p)).sort((a, b) => tieBreak(unit.side, a, b));
  let frontier = firsts.map((p) => { seen.add(key(p)); return { p, first: p }; });
  for (let depth = 0; depth < 6 && frontier.length > 0; depth++) {
    const hit = frontier.find((n) => goal(n.p));
    if (hit) return hit.first;
    const next: { p: Vec2; first: Vec2 }[] = [];
    for (const n of frontier) {
      for (const q of legalMoves(unit.piece, n.p, board)) {
        if (seen.has(key(q))) continue;
        seen.add(key(q));
        next.push({ p: q, first: n.first });
      }
    }
    frontier = next;
  }
  return undefined;
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
