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

import { tacticById } from '@samchess/data';
import {
  FORMULA,
  type BattleEvent,
  type BattleState,
  type Effect,
  type TacticId,
  type TargetSpec,
  type UnitId,
  type UnitState,
  type Vec2,
} from './types.ts';
import { inBounds } from './pieces.ts';
import {
  aliveUnits, chebyshev, damageUnit, hasStatus, healUnit, samePos, unitAt, unitsOf,
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
    if (spec.filter === 'empty') {
      if (unitAt(state, target)) return { ok: false, reason: '유닛이 서 있는 칸이다' };
      if (state.terrain.some((t) => samePos(t.pos, target))) return { ok: false, reason: '이미 지형이 있다' };
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
    if (state.winner) return;
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
          if (u.statuses[i]!.status !== effect.status) continue;
          u.statuses.splice(i, 1);
          events.push({ e: 'statusExpired', unit: u.id, status: effect.status });
        }
      }
      return;
    }

    case 'damage': {
      for (const u of resolveUnits(state, ctx, effect.target)) {
        damageUnit(state, u, (effect.flat ?? 0) + portion(u.maxHp, effect.pctMaxHp), reason, events);
        if (state.winner) return;
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
      if (effect.turns !== undefined) throw new Error('modifyWt.turns는 아직 구현되지 않았다');
      for (const u of resolveUnits(state, ctx, effect.target)) {
        u.wt = Math.max(0, u.wt + effect.delta);
        events.push({ e: 'wtChanged', unit: u.id, to: u.wt, reason });
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

    case 'attackAllEnemiesOnce':
      // 「장료지제」 — 공격 판정을 부르므로 순환 참조를 피해 S급 스크립트 단계에서 붙인다
      throw new Error('attackAllEnemiesOnce는 S급 스크립트 단계에서 구현한다');
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
