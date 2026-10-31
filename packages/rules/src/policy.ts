/**
 * 수비군 방침 AI — 공성전의 수비군(북군)이 사람이 세운 방침대로 둔다 (GDD §8.8 「단계 6에서 정한 것」, 2026-10-30)
 *
 * 판에 방침이 실린 진영(`BattleState.policy`)의 차례만 여기로 온다(`takeTurn`이 넘긴다). **기본 AI는 그대로다** —
 * 방침이 없는 판(야전 · AI 대전 · 도적떼 · 옛 방어 기록)은 한 수도 달라지지 않는다.
 *
 * 한 차례의 걸음 (기획자 확정 — 「칠 수 있으면 공격 먼저」, 2026-10-31):
 *   1. 고유기술 방침 — 내 줄이 있고 조건이 서 있으면 쓴다. **윗순위에 SP를 양보한다**(아래)
 *   2. 지금 이길 수 있으면 이긴다 — 적 군량고에 닿거나 적 King을 이번 공격으로 쓰러뜨린다
 *   3. 행동 방침 — 이동 · 공격
 *   4. 치지 않았으면 책략 방침 — 위 줄부터, 이 장수가 쓸 수 있고 조건이 선 첫 줄. 없으면 명상 · 턴 종료
 *
 * 10-30에는 「책략 방침이 서 있으면 공격보다 책략이 먼저」였다. `npm run balance:siege`로 재 보니 5v5 Lv5 · Lv9에서
 * 기본 방침이 **방침 없음보다 약했고**(공격자 승 51.8 · 62.2% 대 약 40%) 책략 줄만 빼면 26~29%p 나아졌다 — 조우가 늘 서는
 * 5v5에서 칠 차례를 책략으로 써 버렸다. 그래서 순서를 바꿨다(`history/2026-10-31b_수성전_밸런스관찰.md`).
 *
 * 조건 · 대상 · 확률은 전부 엔진에 묻는다(`threatRangeFor` · `validate` · `illusionChance`) — 규칙을 다시 적지 않는다.
 * `Date.now()` · `Math.random()`을 안 쓴다 — 서버 재생 · 방어 기록 리플레이가 같은 판을 낸다.
 */

import { combatantById, skillById, tacticById, TACTICS } from '@samchess/data';
import {
  chooseSkillTarget, findAttackingSpot, healOnly, hitsAny, pathStep, pickTargets, statusesOf, stepToward,
} from './ai.ts';
import { apply, validate } from './battle.ts';
import { aimingSpec, illusionChance } from './effects.ts';
import {
  aliveUnits, chebyshev, controllingSide, effectiveAt, hasStatus, isOver, legalMovesFor, officerStats,
  other, samePos, supplyDepotOf, threatRangeFor, uniqueSkillCost, unitAt,
} from './state.ts';
import type {
  BattleEvent, BattleState, DefensePolicy, DefenseStance, Effect, Intent, OfficerId, PieceType, Side,
  SkillCondition, SkillRule, StatusId, TacticCondition, TacticId, TacticRule, UnitId, UnitState, Vec2,
} from './types.ts';

// ═══════════════════════════════════════════════════════════════
// 규칙 표 — 화면 · meta가 읽는다
// ═══════════════════════════════════════════════════════════════

/** 기물이 고를 수 있는 행동 방침 — King은 호위만 빼고, 나머지는 수성만 뺀다(2026-10-30 기획자 확정) */
export function stancesFor(piece: PieceType): readonly DefenseStance[] {
  return piece === 'King' ? ['hold', 'occupy', 'advance', 'assassinate'] : ['occupy', 'advance', 'assassinate', 'escort'];
}

/** 호위의 범위 — 아군 King 중심 5×5(체비쇼프 2) */
export const ESCORT_RADIUS = 2;

export const TACTIC_CONDITIONS: readonly TacticCondition[] = ['allyEngaged', 'allyIllusioned', 'allyHalfHp', 'enemyHalfHp'];
export const SKILL_CONDITIONS: readonly SkillCondition[] = [
  'allyEngaged', 'selfEngaged', 'allyHalfHp', 'enemyHalfHp', 'allAlliesHalfHp', 'allEnemiesHalfHp', 'spReady',
];

/** 책략 방침은 최대 20줄 */
export const MAX_TACTIC_RULES = 20;
/** 환술 확률 조건 — 10 ~ 90%, 10 단위 */
export const CHANCE_STEPS: readonly number[] = [10, 20, 30, 40, 50, 60, 70, 80, 90];

/**
 * 기본 행동 방침 — King 수성, 나머지는 **편성 순서대로** 점령 · 진군 · 호위 · 암살 (pptx 119쪽).
 * `pieces`는 부대 편성 순서다.
 */
export function defaultStances(pieces: readonly PieceType[]): Partial<Record<PieceType, DefenseStance>> {
  const order: readonly DefenseStance[] = ['occupy', 'advance', 'escort', 'assassinate'];
  const out: Partial<Record<PieceType, DefenseStance>> = {};
  let i = 0;
  for (const p of pieces) out[p] = p === 'King' ? 'hold' : order[i++ % order.length]!;
  return out;
}

/**
 * 기본 책략 방침 — pptx 121쪽 11줄 + 대회복 · 화계 · 유인 · 초선(2026-10-30 기획자 확정, 진화는 조건이 안 맞아 뺀다).
 * **차례가 곧 순위다.** 수비군 누구도 못 쓰는 책략의 줄은 `defaultTacticRules`가 뺀다.
 */
const row = (tactic: string, when: TacticCondition): TacticRule => ({ caster: null, tactic: tactic as TacticId, when });

export const DEFAULT_TACTIC_TABLE: readonly TacticRule[] = [
  row('hoe-bok', 'allyHalfHp'),
  row('dae-hoe-bok', 'allyHalfHp'),
  row('gyeol-gye', 'allyIllusioned'),
  row('ban-gam', 'allyEngaged'),
  row('jeung-pok', 'allyEngaged'),
  row('seon-gong', 'allyEngaged'),
  row('gong-po', 'allyEngaged'),
  row('ham-jeong', 'allyEngaged'),
  row('gyeong-jik', 'allyEngaged'),
  row('tal-jin', 'enemyHalfHp'),
  row('jil-byeong', 'enemyHalfHp'),
  row('chim-muk', 'enemyHalfHp'),
  row('hwa-gye', 'allyEngaged'),
  row('yu-in', 'allyEngaged'),
  row('cho-seon', 'allyEngaged'),
];

/** 방침에 넣을 수 없는 책략 — 「진화」는 화계를 지우는 것이라 네 조건 어디에도 안 맞는다 */
export const EXCLUDED_TACTICS: ReadonlySet<string> = new Set(['jin-hwa']);

/** 책략 id의 원본 — 태학 개량형(`…-plus`)이면 원본, 아니면 그대로. 방침의 줄은 원본으로 적는다 */
export const baseTactic = (id: TacticId): TacticId => (tacticById.get(id)?.base as TacticId | undefined) ?? id;

/** 기본 책략 방침 — 표에서 `available`(수비군이 쓸 수 있는 원본 책략)에 든 줄만 */
export const defaultTacticRules = (available: ReadonlySet<TacticId>): TacticRule[] =>
  DEFAULT_TACTIC_TABLE.filter((r) => available.has(r.tactic)).map((r) => ({ ...r }));

const TIER_ORDER: Record<string, number> = { B: 0, A: 1, S: 2, E: 3 };

/**
 * 기본 고유기술 방침 — 고유기술을 가진 장수 전원, **B → A → S → E**, 같은 등급은 편성 순, 조건은 「SP 충전 시 즉시」
 * (pptx 122쪽). `officers`는 부대 편성 순서다.
 */
export function defaultSkillRules(officers: readonly OfficerId[]): SkillRule[] {
  const tier = (id: OfficerId): number => {
    const skill = skillById.get(combatantById.get(id)?.uniqueSkill ?? '');
    return skill ? TIER_ORDER[skill.tier] ?? 9 : -1;
  };
  return officers
    .map((officer, i) => ({ officer, i, t: tier(officer) }))
    .filter((o) => o.t >= 0)
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((o) => ({ officer: o.officer, when: 'spReady' as const }));
}

// ═══════════════════════════════════════════════════════════════
// 판정 — 조우 · 조건
// ═══════════════════════════════════════════════════════════════

/** 환술이 거는 상태 — 「환술에 걸린 아군」을 가른다. 조종(「유인」 · 「초선」)은 `UnitState.control`로 따로 본다 */
const ILLUSION_STATUSES: ReadonlySet<StatusId> = new Set(TACTICS
  .filter((t) => t.school === 'illusion')
  .flatMap((t) => (t.effects as readonly Effect[]).flatMap((e) => (e.t === 'applyStatus' ? [e.status] : []))));

const illusioned = (u: UnitState): boolean => !!u.control || u.statuses.some((st) => ILLUSION_STATUSES.has(st.status));
const halfHp = (u: UnitState): boolean => u.hp * 2 <= u.maxHp;
const key = (p: Vec2): string => `${p.x},${p.y}`;

/**
 * 조우 — **서로의 위협 범위 안**(2026-10-30 기획자 확정): 내가 그 적을, 또는 그 적이 나를 다음 차례에 칠 수 있다.
 * `side`의 아군마다 조우 중인 적을 낸다.
 */
function engagement(state: BattleState, side: Side): Map<UnitId, Set<UnitId>> {
  const alive = aliveUnits(state);
  const reach = new Map(alive.map((u) => [u.id, new Set(threatRangeFor(state, u.id).map(key))]));
  const out = new Map<UnitId, Set<UnitId>>();
  for (const a of alive.filter((u) => u.side === side)) {
    const met = new Set<UnitId>();
    for (const e of alive.filter((u) => u.side !== side)) {
      if (reach.get(e.id)!.has(key(a.pos)) || reach.get(a.id)!.has(key(e.pos))) met.add(e.id);
    }
    if (met.size > 0) out.set(a.id, met);
  }
  return out;
}

/** 책략 조건이 서면 그 조건의 「해당 아군 · 해당 적군」, 안 서면 `null` */
function tacticCandidates(
  state: BattleState, side: Side, when: TacticCondition,
): { allies: UnitState[]; enemies: UnitState[] } | null {
  const allies = aliveUnits(state).filter((u) => u.side === side);
  const enemies = aliveUnits(state).filter((u) => u.side !== side);
  switch (when) {
    case 'allyEngaged': {
      const met = engagement(state, side);
      if (met.size === 0) return null;
      const foes = new Set([...met.values()].flatMap((s) => [...s]));
      return { allies: allies.filter((u) => met.has(u.id)), enemies: enemies.filter((u) => foes.has(u.id)) };
    }
    case 'allyIllusioned': {
      const hit = allies.filter(illusioned);
      return hit.length > 0 ? { allies: hit, enemies } : null;
    }
    case 'allyHalfHp': {
      const hurt = allies.filter(halfHp);
      return hurt.length > 0 ? { allies: hurt, enemies } : null;
    }
    case 'enemyHalfHp': {
      const hurt = enemies.filter(halfHp);
      return hurt.length > 0 ? { allies, enemies: hurt } : null;
    }
  }
}

function skillConditionHolds(state: BattleState, unit: UnitState, when: SkillCondition): boolean {
  const allies = aliveUnits(state).filter((u) => u.side === unit.side);
  const enemies = aliveUnits(state).filter((u) => u.side !== unit.side);
  switch (when) {
    case 'spReady': return true;
    case 'allyEngaged': return engagement(state, unit.side).size > 0;
    case 'selfEngaged': return engagement(state, unit.side).has(unit.id);
    case 'allyHalfHp': return allies.some(halfHp);
    case 'enemyHalfHp': return enemies.some(halfHp);
    case 'allAlliesHalfHp': return allies.length > 0 && allies.every(halfHp);
    case 'allEnemiesHalfHp': return enemies.length > 0 && enemies.every(halfHp);
  }
}

// ═══════════════════════════════════════════════════════════════
// 고르기 — 고유기술 · 책략
// ═══════════════════════════════════════════════════════════════

/** 이 장수가 지금 고유기술을 쓸 수 있는가(남은 횟수 · 봉인 · SP) — 조건은 안 본다 */
function skillReady(state: BattleState, unit: UnitState): boolean {
  if (!unit.alive || unit.uniqueSkillUses <= 0 || hasStatus(unit, 'skillSealed')) return false;
  const cost = uniqueSkillCost(unit);
  return cost !== undefined && cost !== null && state.sp[unit.side] >= cost;
}

/**
 * **측정 전용** — 「SP 양보가 없었다면」을 재는 스위치(`npm run balance:siege`의 「SP 양보 없음」 줄).
 * `FORMULA.drawTimeLimit`을 `--cap`이 덮는 것과 같은 방식으로, 그 프로세스 안에서만 바꾼다.
 * 게임 · 서버 · 리플레이는 이 값을 건드리지 않는다 — 기본값이 바뀌면 같은 수에서 다른 판이 나오므로
 * `policy.test.ts`가 고정한다.
 */
export const POLICY_TUNING: { skillYield: boolean } = { skillYield: true };

/**
 * 고유기술 방침 — 쓸 것이면 그 의도, 아니면 `undefined`.
 *
 * **순위 = SP 양보** (2026-10-30 기획자 확정): 윗순위 장수가 아직 쓸 수 있고(살아 있고 · 남은 횟수 · 봉인 안 됨)
 * 그 조건이 지금 서 있으면, 아래 순위는 **쓰고 나서도 그 비용만큼 SP가 남을 때만** 쓴다.
 */
export function chooseRuleSkill(state: BattleState, unitId: UnitId, rules: readonly SkillRule[]): Intent | undefined {
  const unit = state.units[unitId]!;
  const rank = rules.findIndex((r) => r.officer === unit.officer);
  if (rank < 0 || !skillReady(state, unit) || !skillConditionHolds(state, unit, rules[rank]!.when)) return undefined;

  const cost = uniqueSkillCost(unit)!;
  for (const higher of POLICY_TUNING.skillYield ? rules.slice(0, rank) : []) {
    const h = aliveUnits(state).find((u) => u.side === unit.side && u.officer === higher.officer);
    if (!h || h.uniqueSkillUses <= 0 || hasStatus(h, 'skillSealed')) continue;
    if (!skillConditionHolds(state, h, higher.when)) continue;
    if (state.sp[unit.side] - cost < uniqueSkillCost(h)!) return undefined;
  }

  const side = controllingSide(state, unit);
  const ok = (target?: UnitId | Vec2): boolean =>
    validate(state, side, { t: 'castUniqueSkill', ...(target !== undefined ? { target } : {}) }).ok;
  if (ok()) return { t: 'castUniqueSkill' };
  const target = ruleSkillTarget(state, unitId);
  if (target === 'skip') return undefined;
  return target === undefined ? undefined : { t: 'castUniqueSkill', target };
}

/** pptx 123쪽의 대상 규칙. 표에 없는 기술은 기본 AI의 고르기(`chooseSkillTarget`) 그대로 */
function ruleSkillTarget(state: BattleState, unitId: UnitId): UnitId | Vec2 | undefined | 'skip' {
  const unit = state.units[unitId]!;
  const skill = combatantById.get(unit.officer)?.uniqueSkill;
  const side = controllingSide(state, unit);
  const allies = aliveUnits(state).filter((u) => u.side === unit.side);
  const enemies = aliveUnits(state).filter((u) => u.side !== unit.side);
  const first = (list: UnitState[]): UnitId | 'skip' =>
    list.find((u) => validate(state, side, { t: 'castUniqueSkill', target: u.id }).ok)?.id ?? 'skip';
  const byId = (a: UnitState, b: UnitState): number => a.id.localeCompare(b.id);
  const at = (u: UnitState): number => effectiveAt(u);

  switch (skill) {
    case 'go-yuk-ji-chaek': {     // 고육지책 — 적과 조우하지 않은 아군 중 HP가 가장 많은 아군(모두 조우 중이면 HP가 가장 많은 아군)
      const met = engagement(state, unit.side);
      const byHp = (a: UnitState, b: UnitState): number => b.hp - a.hp || byId(a, b);
      const free = allies.filter((u) => !met.has(u.id)).sort(byHp);
      return first(free.length > 0 ? free : [...allies].sort(byHp));
    }
    case 'se-han-ji-song-baek':   // 세한지송백 — 본인
      return first([unit]);
    case 'so-pae-wang-jeon':      // 소패왕전 — AT가 가장 낮은 적, 동률이면 지력이 높은 쪽
      return first([...enemies].sort((a, b) => at(a) - at(b)
        || officerStats(b).intellect - officerStats(a).intellect || byId(a, b)));
    case 'yeong-ung-ron':         // 영웅론 — 남은 고유기술의 비용이 가장 비싼 적
      return first([...enemies].sort((a, b) => (uniqueSkillCost(b) ?? 0) - (uniqueSkillCost(a) ?? 0) || byId(a, b)));
    case 'yu-eon-gye-chaek':      // 유언계책 — AT가 가장 높은 적, 동률이면 무력이 높은 쪽
      return first([...enemies].sort((a, b) => at(b) - at(a)
        || officerStats(b).might - officerStats(a).might || byId(a, b)));
    case 'sip-myeon-mae-bok': {   // 십면매복 — 아군과 조우 중인 적 중 AT가 가장 높은 적, 동률이면 무력이 높은 쪽
      const met = new Set([...engagement(state, unit.side).values()].flatMap((s) => [...s]));
      return first(enemies.filter((u) => met.has(u.id)).sort((a, b) => at(b) - at(a)
        || officerStats(b).might - officerStats(a).might || byId(a, b)));
    }
    case 'sik-so-sa-beon':        // 식소사번 — 남은 HP가 가장 많은 적(세션 기본값 — 초안에 없었다)
      return first([...enemies].sort((a, b) => b.hp - a.hp || b.maxHp - a.maxHp || byId(a, b)));
    default:
      return chooseSkillTarget(state, unitId);
  }
}

/**
 * 책략 방침 — 위 줄부터 이 장수가 쓸 수 있고 조건이 선 첫 줄의 의도. 없으면 `undefined`.
 *
 * 대상은 책략이 정한다 — 보조는 「해당 아군」(HP 비율이 낮은 쪽부터), 환술은 「해당 적군」(성공률이 높은 쪽부터,
 * 동률이면 HP가 낮은 쪽). 이미 같은 상태가 걸린 대상 · 만HP에게 거는 회복 · 사거리 밖은 건너뛴다.
 */
export function chooseRuleTactic(
  state: BattleState, unitId: UnitId, rules: readonly TacticRule[],
): { t: 'castTactic'; tactic: TacticId; target?: UnitId | Vec2 } | undefined {
  const unit = state.units[unitId]!;
  const side = controllingSide(state, unit);
  for (const rule of rules) {
    if (rule.caster && rule.caster !== unit.officer) continue;
    const tactic = unit.tactics.find((t) => baseTactic(t) === rule.tactic);
    if (!tactic) continue;
    const def = tacticById.get(tactic)!;
    const cand = tacticCandidates(state, unit.side, rule.when);
    if (!cand) continue;

    const applied = statusesOf(tactic);
    const heal = healOnly(tactic);
    const ok = (target?: UnitId | Vec2): boolean =>
      validate(state, side, { t: 'castTactic', tactic, ...(target !== undefined ? { target } : {}) }).ok;
    const sure = (target?: UnitId): boolean => rule.minChance === undefined || def.school !== 'illusion'
      || (illusionChance(state, unitId, tactic, target) ?? 0) >= rule.minChance;
    const intent = (target?: UnitId | Vec2) => ({ t: 'castTactic' as const, tactic, ...(target !== undefined ? { target } : {}) });

    const spec = aimingSpec(def.effects as readonly Effect[]);
    if (!spec) {
      // 둘레 전체에 거는 것(대회복) — 「해당 아군」이 그 둘레에 있어야 쓴다
      if (heal && !cand.allies.some((a) => a.hp < a.maxHp && chebyshev(a.pos, unit.pos) <= 1)) continue;
      if (ok() && sure()) return intent();
      continue;
    }
    if (spec.kind === 'allyOne') {
      const list = [...cand.allies].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id.localeCompare(b.id));
      for (const a of list) {
        if (applied.some((st) => hasStatus(a, st))) continue;
        if (heal && a.hp >= a.maxHp) continue;
        if (ok(a.id) && sure(a.id)) return intent(a.id);
      }
      continue;
    }
    const chance = (e: UnitState): number => illusionChance(state, unitId, tactic, e.id) ?? 0;
    const foes = [...cand.enemies].sort((a, b) => chance(b) - chance(a) || a.hp - b.hp || a.id.localeCompare(b.id));
    if (spec.kind === 'enemyOne') {
      for (const e of foes) {
        if (applied.some((st) => hasStatus(e, st))) continue;
        if (ok(e.id) && sure(e.id)) return intent(e.id);
      }
      continue;
    }
    // 칸을 겨누는 것(화계) — 그 적의 칸, 안 되면 둘레 빈 칸
    for (const e of foes) {
      const cells = [e.pos];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const p = { x: e.pos.x + dx, y: e.pos.y + dy };
        if ((dx || dy) && !unitAt(state, p)) cells.push(p);
      }
      const hit = cells.find((p) => ok(p) && sure());
      if (hit) return intent(hit);
    }
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════
// 한 차례
// ═══════════════════════════════════════════════════════════════

/** 이 진영이 지키는 성채의 칸들 — 수성전의 성채(`fort.side`가 이 진영). 없으면 빈 목록 */
function castleOf(state: BattleState, side: Side): Vec2[] {
  return state.terrain.filter((t) => t.fort?.side === side).map((t) => t.pos);
}

/** 방침이 실린 진영의 한 차례. 부르는 자리는 `takeTurn` 하나다 */
export function policyTurn(state: BattleState): { state: BattleState; events: BattleEvent[] } {
  const unitId = state.activeUnit!;
  const side = controllingSide(state, state.units[unitId]!);
  const policy: DefensePolicy = state.policy![side]!;

  let s = state;
  const events: BattleEvent[] = [];
  const done = () => ({ state: s, events });
  const act = (intent: Intent): void => {
    const r = apply(s, side, intent);
    s = r.state;
    events.push(...r.events);
  };
  const strike = (only?: ReadonlySet<UnitId>): boolean => {
    const targets = pickTargets(s, unitId, only);
    if (targets.length === 0) return false;
    act({ t: 'attack', targets });
    return true;
  };
  const move = (to: Vec2): void => act({ t: 'move', to });
  const me = (): UnitState => s.units[unitId]!;

  // 1. 고유기술 방침
  const skill = chooseRuleSkill(s, unitId, policy.skills);
  if (skill && validate(s, side, skill).ok) act(skill);
  if (isOver(s) || !s.activeUnit) return done();   // 시전 지연이 걸린 기술은 그 자리에서 턴이 끝난다

  const theirDepot = supplyDepotOf(s, other(side));
  const theirKing = aliveUnits(s).find((u) => u.side !== side && u.piece === 'King');

  // 2. 지금 이길 수 있으면 이긴다
  if (theirDepot && legalMovesFor(s, unitId).some((p) => samePos(p, theirDepot))) {
    move(theirDepot);
    return done();
  }
  if (theirKing && theirKing.hp <= effectiveAt(me())) {
    const only = new Set([theirKing.id]);
    if (strike(only)) return done();
    const spot = findAttackingSpot(s, unitId, only);
    if (spot) {
      move(spot);
      if (strike(only)) return done();
    }
  }

  // 3. 행동 방침 — 칠 수 있으면 친다(2026-10-31 기획자 확정 — 책략보다 공격이 먼저)
  const stance = policy.stances[me().piece] ?? (me().piece === 'King' ? 'hold' : 'advance');
  const closed = runStance(stance);
  if (closed || isOver(s) || !s.activeUnit) return done();

  // 4. 치지 않았다 — 책략 방침, 아니면 명상 · 턴 종료
  const c = chooseRuleTactic(s, unitId, policy.tactics);
  if (c) {
    act(c);
    return done();
  }
  if (validate(s, side, { t: 'meditate' }).ok) act({ t: 'meditate' });
  else act({ t: 'endTurn' });
  return done();

  /** 행동 방침 하나 — 차례가 닫혔으면(쳤으면) `true` */
  function runStance(st: DefenseStance): boolean {
    if (s.activeTurn!.moved) return strike();
    switch (st) {
      case 'hold': return hold();
      case 'occupy': return occupy();
      case 'advance': return advance();
      case 'assassinate': return assassinate();
      case 'escort': return escort();
    }
  }

  /** 수성 — 성 밖이면 성채 가운데로, 성 안에서는 나가지 않고 칠 수 있는 적만 친다 */
  function hold(): boolean {
    const castle = castleOf(s, me().side);
    if (castle.length === 0) return strike();   // 성이 없는 판 — 제자리에서 칠 수 있는 적만
    const inCastle = (p: Vec2): boolean => castle.some((c) => samePos(c, p));
    const center = castle[Math.floor(castle.length / 2)]!;
    if (!inCastle(me().pos)) {
      const step = stepToward(s, unitId, center, inCastle) ?? pathStep(s, unitId, inCastle);
      if (step) move(step);
      return strike();
    }
    if (strike()) return true;
    const spot = findAttackingSpot(s, unitId, undefined, inCastle);
    if (spot) {
      move(spot);
      return strike();
    }
    return false;
  }

  /** 점령 — 군량고로 간다. 막는 적은 치되 길이 열리면 무시하고 간다. 군량고 위의 적은 친다 */
  function occupy(): boolean {
    if (!theirDepot) return advance();
    // 여포 「인중여포」 · 감녕의 자유이동 — 군량고 둘레에는 못 내리므로 적 King 쪽으로(pptx 123쪽)
    if (hasStatus(me(), 'freeMove') && theirKing) return assassinate();
    const sitter = unitAt(s, theirDepot);
    if (sitter && sitter.side !== me().side) {
      const only = new Set([sitter.id]);
      if (strike(only)) return true;
      const spot = findAttackingSpot(s, unitId, only);
      if (spot) {
        move(spot);
        return strike(only) || strike();
      }
    }
    const step = stepToward(s, unitId, theirDepot) ?? pathStep(s, unitId, (p) => samePos(p, theirDepot));
    if (step) {
      move(step);
      return strike();
    }
    return fightThrough();
  }

  /** 진군 — 적 King을 향해 간다. 조우한 적은 쓰러뜨리며 간다 */
  function advance(): boolean {
    if (strike()) return true;
    const met = engagement(s, me().side).get(unitId);
    if (met) {
      const spot = findAttackingSpot(s, unitId, met);
      if (spot) {
        move(spot);
        return strike(met) || strike();
      }
    }
    if (!theirKing) return false;
    const step = stepToward(s, unitId, theirKing.pos) ?? pathStep(s, unitId, hitsAny(s, unitId, new Set([theirKing.id])));
    if (step) {
      move(step);
      return strike();
    }
    return false;
  }

  /** 암살 — 적 King을 향해 간다. 막는 적은 치되 길이 열리면 무시하고 가서 King을 1순위로 친다 */
  function assassinate(): boolean {
    if (!theirKing) return fightThrough();
    const only = new Set([theirKing.id]);
    if (strike(only)) return true;
    const spot = findAttackingSpot(s, unitId, only);
    if (spot) {
      move(spot);
      return strike(only) || strike();
    }
    const step = stepToward(s, unitId, theirKing.pos) ?? pathStep(s, unitId, hitsAny(s, unitId, only));
    if (step) {
      move(step);
      return strike(only) || strike();
    }
    return fightThrough();
  }

  /** 호위 — 아군 King 둘레 5×5 안에 머물며 그 안으로 다가오는 적을 친다 */
  function escort(): boolean {
    const king = aliveUnits(s).find((u) => u.side === me().side && u.piece === 'King');
    if (!king || king.id === unitId) return advance();
    const inArea = (p: Vec2): boolean => chebyshev(p, king.pos) <= ESCORT_RADIUS;
    const intruders = new Set(aliveUnits(s)
      .filter((e) => e.side !== me().side)
      .filter((e) => inArea(e.pos) || threatRangeFor(s, e.id).some((p) => samePos(p, king.pos)))
      .map((e) => e.id));
    if (intruders.size > 0) {
      if (strike(intruders)) return true;
      const spot = findAttackingSpot(s, unitId, intruders, inArea);
      if (spot) {
        move(spot);
        return strike(intruders) || strike();
      }
    }
    if (!inArea(me().pos)) {
      const step = stepToward(s, unitId, king.pos, inArea) ?? pathStep(s, unitId, inArea);
      if (step) move(step);
    }
    return strike();
  }

  /** 길이 막혔다 — 칠 수 있는 적을 친다(제자리, 아니면 이동해서) */
  function fightThrough(): boolean {
    if (strike()) return true;
    const spot = findAttackingSpot(s, unitId);
    if (spot) {
      move(spot);
      return strike();
    }
    return false;
  }
}
