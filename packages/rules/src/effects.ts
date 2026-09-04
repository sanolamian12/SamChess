/**
 * Effect DSL 실행기 (GDD §3.7)
 *
 * 책략 18종과 A/B/E급 공유 고유기술은 **데이터로 접힌다** — `tactics.json` /
 * `uniqueSkills.json`의 `effects` 배열이 곧 사양이고, 이 파일이 그 해석기다.
 * 데이터로 접히지 않는 서사형 S급 스킬만 `scriptId` 핸들러로 따로 뺀다.
 *
 * 새 효과를 추가할 때는 `Effect` 유니온에 항목을 더하고 여기 switch에 가지를 늘린다.
 * switch가 전수(exhaustive)라 빠뜨리면 타입 검사에서 걸린다.
 */

import { officerById, tacticById } from '@samchess/data';
import {
  FORMULA,
  type BattleEvent,
  type BattleState,
  type Effect,
  type TacticDef,
  type TacticId,
  type TargetSpec,
  type UnitId,
  type UnitState,
  type Vec2,
} from './types.ts';
import { inBounds } from './pieces.ts';
import {
  aliveUnits, chebyshev, damageUnit, hasStatus, healUnit, isOver, officerStats, resolveAttack, samePos,
  unitAt, unitsOf,
} from './state.ts';

/** 효과가 가리키는 대상. 단일 대상 지정형 효과만 채워 온다. */
export interface EffectContext {
  caster: UnitState;
  targetUnit?: UnitState;
  targetPos?: Vec2;
}

// ═══════════════════════════════════════════════════════════════
// 대상 해석
// ═══════════════════════════════════════════════════════════════

/** 효과 목록 중 실제로 조준이 필요한 첫 TargetSpec. 없으면 undefined. */
export function aimingSpec(effects: readonly Effect[]): TargetSpec | undefined {
  for (const e of effects) {
    if (!('target' in e)) continue;
    const k = e.target.kind;
    if (k === 'allyOne' || k === 'enemyOne' || k === 'tile') return e.target;
  }
  return undefined;
}

/** MP 소모량 — 「명경지수」가 걸려 있으면 0 (GDD §4.4) */
export function tacticMpCost(caster: UnitState, tactic: TacticId): number {
  const def = tacticById.get(tactic);
  if (!def) throw new Error(`알 수 없는 책략: ${tactic}`);
  return hasStatus(caster, 'zeroMpCost') ? 0 : def.mpCost;
}

/**
 * 클라이언트가 보낸 조준 정보(`Intent.target`)를 검증하고 실행 컨텍스트로 바꾼다.
 * 조준이 필요 없는 효과(자기 자신·전체 대상)는 target 없이 통과한다.
 */
export function resolveTacticTarget(
  state: BattleState,
  caster: UnitState,
  effects: readonly Effect[],
  target: Vec2 | UnitId | undefined,
): { ok: true; ctx: EffectContext } | { ok: false; reason: string } {
  const spec = aimingSpec(effects);
  if (!spec) return { ok: true, ctx: { caster } };

  if (spec.kind === 'tile') {
    if (!target || typeof target === 'string') return { ok: false, reason: '칸을 지정해야 한다' };
    if (!inBounds(target)) return { ok: false, reason: '맵 밖이다' };
    if (spec.filter === 'empty' || spec.filter === 'noTerrain') {
      if (state.terrain.some((t) => samePos(t.pos, target))) return { ok: false, reason: '이미 지형이 있다' };
    }
    if (spec.filter === 'empty') {
      if (unitAt(state, target)) return { ok: false, reason: '유닛이 서 있는 칸이다' };
    }
    return { ok: true, ctx: { caster, targetPos: { ...target } } };
  }

  if (!target || typeof target !== 'string') return { ok: false, reason: '대상을 지정해야 한다' };
  const unit = state.units[target];
  if (!unit?.alive) return { ok: false, reason: '살아있는 대상이 아니다' };

  if (spec.kind === 'allyOne') {
    if (unit.side !== caster.side) return { ok: false, reason: '아군만 대상으로 삼는다' };
    if (spec.withinRadius !== undefined && chebyshev(caster.pos, unit.pos) > spec.withinRadius) {
      return { ok: false, reason: `${spec.withinRadius}칸 이내여야 한다` };
    }
  } else {
    if (unit.side === caster.side) return { ok: false, reason: '적군만 대상으로 삼는다' };
    if (hasStatus(unit, 'untargetable')) return { ok: false, reason: '대상으로 삼을 수 없다' };
  }
  return { ok: true, ctx: { caster, targetUnit: unit } };
}

function resolveUnits(state: BattleState, ctx: EffectContext, spec: TargetSpec): UnitState[] {
  const { caster } = ctx;
  switch (spec.kind) {
    case 'self':
      return [caster];
    case 'allyOne':
    case 'enemyOne':
      return ctx.targetUnit ? [ctx.targetUnit] : [];
    case 'allAllies':
      return unitsOf(state, caster.side).filter((u) => u.alive);
    case 'allEnemies':
      return aliveUnits(state).filter((u) => u.side !== caster.side);
    case 'alliesInRadius':
      return unitsOf(state, caster.side)
        .filter((u) => u.alive)
        .filter((u) => (spec.includeSelf || u.id !== caster.id) && chebyshev(caster.pos, u.pos) <= spec.radius);
    case 'nextEnemiesInTurnOrder':
      return aliveUnits(state)
        .filter((u) => u.side !== caster.side)
        .sort((a, b) => a.wt - b.wt || a.id.localeCompare(b.id))
        .slice(0, spec.count);
    case 'tile':
      // 지형 효과는 칸을 직접 쓴다. 굳이 유닛을 뽑아야 하면 그 칸에 선 유닛.
      return ctx.targetPos ? [unitAt(state, ctx.targetPos)].filter((u): u is UnitState => !!u) : [];
  }
}

function tilesOf(ctx: EffectContext, spec: TargetSpec): Vec2[] {
  if (spec.kind === 'tile') return ctx.targetPos ? [ctx.targetPos] : [];
  return ctx.targetUnit ? [ctx.targetUnit.pos] : [ctx.caster.pos];
}

// ═══════════════════════════════════════════════════════════════
// 실행
// ═══════════════════════════════════════════════════════════════

/** HP 비율 효과는 내림 (데미지 규약과 동일, GDD §3.5) */
const portion = (maxHp: number, pct: number | undefined): number => (pct ? Math.floor(maxHp * pct) : 0);

export function applyEffects(
  state: BattleState,
  ctx: EffectContext,
  effects: readonly Effect[],
  reason: string,
  events: BattleEvent[],
): void {
  for (const effect of effects) {
    if (isOver(state)) return;
    applyEffect(state, ctx, effect, reason, events);
  }
}

function applyEffect(
  state: BattleState,
  ctx: EffectContext,
  effect: Effect,
  reason: string,
  events: BattleEvent[],
): void {
  switch (effect.t) {
    case 'applyStatus': {
      for (const u of resolveUnits(state, ctx, effect.target)) {
        // 같은 상태를 다시 걸면 갱신한다 (중첩하지 않는다)
        const existing = u.statuses.findIndex((s) => s.status === effect.status);
        if (existing >= 0) u.statuses.splice(existing, 1);

        const expiresAt = effect.duration === undefined ? undefined : state.time + effect.duration;
        u.statuses.push({
          status: effect.status,
          ...(expiresAt !== undefined ? { expiresAt } : {}),
          ...(effect.magnitude !== undefined ? { magnitude: effect.magnitude } : {}),
          ...(effect.magnitudePct !== undefined ? { magnitudePct: effect.magnitudePct } : {}),
          ...(effect.cleansable !== undefined ? { cleansable: effect.cleansable } : {}),
          ...(effect.charges !== undefined ? { charges: effect.charges } : {}),
          ...(effect.period !== undefined ? { period: effect.period, lastTickedAt: state.time } : {}),
          sourceUnit: ctx.caster.id,
        });
        events.push({
          e: 'statusApplied',
          unit: u.id,
          status: effect.status,
          ...(expiresAt !== undefined ? { expiresAt } : {}),
        });
      }
      return;
    }

    case 'removeStatus': {
      for (const u of resolveUnits(state, ctx, effect.target)) {
        for (let i = u.statuses.length - 1; i >= 0; i--) {
          const st = u.statuses[i]!;
          if (st.status !== effect.status) continue;
          // S급이 건 도트(식소사번·화소연영)는 「결계」로 지워지지 않는다 (2026-07-31 확정)
          if (st.cleansable === false) continue;
          u.statuses.splice(i, 1);
          events.push({ e: 'statusExpired', unit: u.id, status: effect.status });
        }
      }
      return;
    }

    case 'damage': {
      for (const u of resolveUnits(state, ctx, effect.target)) {
        damageUnit(state, u, (effect.flat ?? 0) + portion(u.maxHp, effect.pctMaxHp), reason, events);
        if (isOver(state)) return;
      }
      return;
    }

    case 'heal': {
      for (const u of resolveUnits(state, ctx, effect.target)) {
        healUnit(state, u, (effect.flat ?? 0) + portion(u.maxHp, effect.pctMaxHp), reason, events);
      }
      return;
    }

    case 'modifyWt': {
      for (const u of resolveUnits(state, ctx, effect.target)) {
        if (effect.turns !== undefined) {
          // 지속형 — 지금 WT는 그대로 두고, 앞으로 N번의 턴 종료 시 기준값에 더해진다.
          // 「병귀신속」이 시전한 턴에 바로 또 차례가 오지 않게 하는 규약 (GDD §12).
          (u.wtModifiers ??= []).push({ delta: effect.delta, turnsLeft: effect.turns });
        } else {
          u.wt = Math.max(0, u.wt + effect.delta);
          events.push({ e: 'wtChanged', unit: u.id, to: u.wt, reason });
        }
      }
      return;
    }

    case 'setMp': {
      for (const u of resolveUnits(state, ctx, effect.target)) {
        const next = Math.max(0, Math.min(effect.value, u.maxMp));
        if (next === u.mp) continue;
        const delta = next - u.mp;
        u.mp = next;
        events.push({ e: 'mpChanged', unit: u.id, delta, reason });
      }
      return;
    }

    case 'modifySp': {
      const side = effect.side === 'self' ? ctx.caster.side : (ctx.caster.side === 'P1' ? 'P2' : 'P1');
      const next = Math.max(0, Math.min(state.sp[side] + effect.delta, state.spCap[side]));
      if (next === state.sp[side]) return;
      state.sp[side] = next;
      events.push({ e: 'spChanged', side, to: next });
      return;
    }

    case 'createTerrain': {
      for (const pos of tilesOf(ctx, effect.target)) {
        const i = state.terrain.findIndex((t) => samePos(t.pos, pos));
        if (i >= 0) state.terrain.splice(i, 1);
        state.terrain.push({ pos: { ...pos }, terrain: effect.terrain, lastTickedAt: state.time });
        events.push({ e: 'terrainChanged', pos: { ...pos }, terrain: effect.terrain });
      }
      return;
    }

    case 'removeTerrain': {
      for (const pos of tilesOf(ctx, effect.target)) {
        const i = state.terrain.findIndex((t) => samePos(t.pos, pos) && t.terrain === effect.terrain);
        if (i < 0) continue;
        state.terrain.splice(i, 1);
        events.push({ e: 'terrainChanged', pos: { ...pos }, terrain: null });
      }
      return;
    }

    case 'controlEnemy': {
      for (const u of resolveUnits(state, ctx, effect.target)) {
        // 「삼고초려」로 걸린 영구 조종(uses === null)은 덮어쓰지 않는다.
        // 덮어쓰면 MP 3짜리 「초선」이 한 턴 뒤 풀리면서 SP 6짜리 영구 조종까지 날려버린다.
        if (u.control?.uses === null) continue;
        u.control = { by: ctx.caster.id, mode: effect.mode, uses: effect.uses };
        events.push({ e: 'controlChanged', unit: u.id, by: ctx.caster.id, mode: effect.mode });
      }
      return;
    }

    case 'multiplyMaxHp': {
      for (const u of resolveUnits(state, ctx, effect.target)) {
        u.maxHp = Math.floor(u.maxHp * effect.factor);   // 현재 HP는 그대로 (방덕 「사재종군」)
      }
      return;
    }

    case 'grantUniqueSkillUses': {
      for (const u of resolveUnits(state, ctx, effect.target)) u.uniqueSkillUses += effect.count;
      return;
    }

    case 'attackAllEnemiesOnce': {
      // 장료 「장료지제」 — 지금 즉시 전 적군을 한 번씩. 사거리는 무시한다.
      // 정산 순서는 WT 오름차순으로 고정한다 — 동시 사망의 승패가 여기서 갈린다 (GDD §3.9).
      // 「백의도강」(공격 대상 불가)은 **지정해서 겨누는 것만** 막으므로 여기서는 걸러내지 않는다 (§12 A2).
      const targets = aliveUnits(state)
        .filter((u) => u.side !== ctx.caster.side)
        .sort((a, b) => a.wt - b.wt || a.id.localeCompare(b.id));
      for (const t of targets) {
        if (isOver(state) || !t.alive) break;
        resolveAttack(state, ctx.caster, t, events);
      }
      return;
    }
  }
}

/**
 * 환술 성공 판정 (GDD §3.5, §3.7).
 *
 * - 「결계」(illusionImmune)가 걸린 대상에게는 **무조건 실패**한다. 판정도 하지 않는다.
 * - 가후 「좌도방술」(illusionAlways)이면 **무조건 성공**한다.
 * - 그 외에는 `20 + 시전자 지력 − 대상 지력`으로 판정한다.
 *
 * 실패해도 MP는 소모된다 — 호출부가 책임진다.
 */
export function illusionSucceeds(
  rollFn: (rate: number) => boolean,
  casterIntellect: number,
  target: UnitState | undefined,
  targetIntellect: number,
  casterAlwaysHits: boolean,
): boolean {
  if (target && hasStatus(target, 'illusionImmune')) return false;
  if (casterAlwaysHits) return true;
  return rollFn(FORMULA.illusionRate(casterIntellect, targetIntellect));
}

/**
 * 「칸에 거는 책략인가」 — 화계·진화가 그렇다 (2026-09-03).
 *
 * 지원책이지만 겨눌 상대가 없어 발동 공식이 다르다(`FORMULA.terrainRate`).
 * **표를 따로 안 적고 효과에서 파생시킨다** — 효과가 **전부** 칸(`kind: 'tile'`)을
 * 겨누면 지형 책략이다. 지형 책략이 늘거나 줄어도 데이터만 고치면 따라온다.
 * (손권 「수성지주」처럼 칸을 만드는 **고유기술**은 책략이 아니라 여기 안 온다.)
 */
export function isTerrainTactic(def: Pick<TacticDef, 'effects'> | { effects: readonly unknown[] }): boolean {
  // `Effect` 중에는 `target`이 아예 없는 것도 있다(`modifySp` 등) — 그런 효과가
  // 섞이면 지형 책략이 아니다.
  const effects = def.effects as readonly { target?: TargetSpec }[];
  return effects.length > 0 && effects.every((e) => e.target?.kind === 'tile');
}

/**
 * 지원책 성공 판정 (2026-08-31 확정 — 이전엔 무조건 성공이었다).
 *
 * 환술과 달리 저항 상태(결계·좌도방술)를 보지 않는다 — 그건 「적이 내 환술에 걸리는가」
 * 이고 이건 「내가 아군에게 거는 지원이 손발이 맞는가」라 서로 다른 개념이다.
 *
 * 실패해도 MP는 소모된다 — 환술과 같은 규약을 따른다 (호출부가 책임진다).
 */
export function supportSucceeds(
  rollFn: (rate: number) => boolean,
  casterIntellect: number,
  targetIntellect: number,
): boolean {
  return rollFn(FORMULA.supportRate(casterIntellect, targetIntellect));
}

/**
 * 지형 책략(화계·진화) 성공 판정 (2026-09-03 확정 — 이전엔 `지력 × 2`였다).
 *
 * 겨눌 상대가 없어 인자가 시전자 지력 **하나**뿐이다. 저항 상태(결계·좌도방술)도
 * 보지 않는다 — 거는 대상이 유닛이 아니라 칸이라 저항할 사람이 없다.
 * 실패해도 MP는 소모된다(지원책·환술과 같은 규약).
 */
export function terrainSucceeds(
  rollFn: (rate: number) => boolean,
  casterIntellect: number,
): boolean {
  return rollFn(FORMULA.terrainRate(casterIntellect));
}

/**
 * **화면에 보여줄** 책략 발동 확률 %. 판정이 아니라 표시용이다.
 *
 * 시전 확인 창이 「이 책략이 몇 %로 걸리는가」를 적으려면 필요하다. 화면이 공식을
 * 다시 적으면 바뀌었을 때 조용히 어긋나므로 여기서 낸다 — 실제 판정(`illusionSucceeds`·
 * `supportSucceeds`)과 **같은 상수·같은 예외**를 쓴다.
 *
 * 갈래는 **셋**이고 `battle.ts`의 `castTactic`과 반드시 같은 갈래를 타야 한다 —
 * 지형(`isTerrainTactic`, 칸에 건다) · 지원(`school: 'support'`) · 환술
 * (`school: 'illusion'`). 지형을 **지원보다 먼저** 본다(지형 책략도 계열은
 * 지원이라 순서를 뒤집으면 지형이 영영 안 걸린다).
 *
 * 지원책인데 아군을 특정해 조준하지 않는 경우(자기 자신 함축형)는 대상 지력을
 * 시전자 자신의 것으로 둔다 — 그래야 `FORMULA.supportRate`가 자연히
 * `2 × 본인 지력`을 낸다. 예전에는 **화계 같은 지형형도 여기로 흘러** 같은
 * `2 × 지력`을 받았는데, 2026-09-03에 지형이 제 공식을 갖게 되면서 갈라졌다.
 */
export function illusionChance(
  state: BattleState,
  casterId: UnitId,
  tactic: TacticId,
  targetId: UnitId | undefined,
): number | null {
  const def = tacticById.get(tactic);
  const caster = state.units[casterId];
  if (!def || !caster) return null;

  const casterIntellect = officerStats(caster).intellect;
  const target = targetId ? state.units[targetId] : undefined;

  if (isTerrainTactic(def)) return FORMULA.terrainRate(casterIntellect);

  if (def.school === 'support') {
    return FORMULA.supportRate(
      casterIntellect,
      target ? officerStats(target).intellect : casterIntellect,
    );
  }

  if (target && hasStatus(target, 'illusionImmune')) return 0;      // 「결계」 — 무조건 실패
  if (hasStatus(caster, 'illusionAlways')) return 100;              // 「좌도방술」 — 무조건 성공
  return FORMULA.illusionRate(casterIntellect, target ? officerStats(target).intellect : 0);
}
