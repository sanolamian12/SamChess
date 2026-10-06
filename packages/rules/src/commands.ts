/**
 * 화면이 묻는 것 — 명령 여섯 칸 · 고유기술 표시 · 명상 회복량 · 순서 예보
 * (전투 UI 개편 1단계, 2026-09-27, `docs/전투UI개편/설계.md` §2)
 *
 * 개편된 전투 화면은 **같은 판정을 여러 곳에서** 보여 준다 — 고유기술 상태는 순서 판의
 * 표시등·배치 목록·장수 팝업 셋에, 명령 가능 여부는 명령 판과 맥락 판 둘에 뜬다.
 * 화면마다 계산하면 조용히 어긋나므로(실제로 카드와 살펴보기의 고유기술 상태가 이미
 * 달랐다 — 살펴보기에는 「SP 부족」이 없었다) 판정은 여기 한 곳에서 낸다.
 *
 * 전부 **읽기 전용**이다. 상태를 바꾸지 않고 난수를 쓰지 않는다 — 미리보기가
 * 굴리면 `rngCursor`가 밀려 리플레이가 깨진다(CLAUDE.md 「화면이 미리 보여 주는
 * 숫자는 엔진이 낸다」).
 */

import { combatantById, skillById, tacticById } from '@samchess/data';
import {
  FORMULA,
  type BattleState,
  type Effect,
  type Intent,
  type Side,
  type TacticId,
  type Time,
  type UnitId,
  type UnitState,
  type Vec2,
} from './types.ts';
import { usableItemOf, wtHeldAdjust } from './held.ts';
import { inBounds } from './pieces.ts';
import { aliveUnits, byTurnRank, controllingSide, legalMovesFor, legalTargetsFor } from './state.ts';
import { aimingSpec, isSkillSealed } from './effects.ts';
import { validate } from './battle.ts';

// ═══════════════════════════════════════════════════════════════
// 고유기술 상태
// ═══════════════════════════════════════════════════════════════

/**
 * 고유기술 표시등의 다섯 상태 (pptx 92쪽 + 2026-09-27 기획자 확정).
 *
 * | 값 | 색 | 뜻 |
 * |---|---|---|
 * | `none` | — | 고유기술이 없다(도적 등) |
 * | `sealed` | 빨강 | 조조 「영웅론」에 봉인 |
 * | `used` | 회색 | 다 썼다 |
 * | `poor` | 노랑 | SP가 모자란다 |
 * | `ready` | 초록 | 발동 조건 충족 |
 *
 * **봉인을 「다 씀」보다 먼저 본다** — 봉인은 횟수를 안 건드린다(차동풍으로 돌려받아도 막힌다).
 * 시전 중(`casting`)은 이미 횟수를 썼으므로 `used`다.
 */
export type SkillStatus = 'none' | 'sealed' | 'used' | 'poor' | 'ready';

export function skillStatus(state: BattleState, unitId: UnitId): SkillStatus {
  const unit = state.units[unitId];
  const skill = unit && skillById.get(combatantById.get(unit.officer)?.uniqueSkill ?? '');
  if (!unit || !skill) return 'none';
  if (isSkillSealed(unit)) return 'sealed';
  if (unit.uniqueSkillUses <= 0) return 'used';
  return state.sp[unit.side] < skill.spCost ? 'poor' : 'ready';
}

// ═══════════════════════════════════════════════════════════════
// 명상
// ═══════════════════════════════════════════════════════════════

/**
 * 명상으로 **실제로 오를** MP — 확인창 「MP를 N 회복합니다」의 N (pptx 96쪽).
 * `apply()`의 `meditate` 갈래와 같은 식이다. 최대치에 가까우면 그만큼만 오른다.
 */
export function meditateGain(state: BattleState, unitId: UnitId): number {
  const unit = state.units[unitId];
  if (!unit) return 0;
  return Math.max(0, Math.min(FORMULA.meditateMp, unit.maxMp - unit.mp));
}

// ═══════════════════════════════════════════════════════════════
// 시전(책략 · 아이템 · 고유기술)의 조준 후보
// ═══════════════════════════════════════════════════════════════

export type CastKind = 'tactic' | 'item' | 'unique';

/** 시전할 것의 효과 목록. 없으면 빈 배열 */
export function castEffects(unit: UnitState, kind: CastKind, tactic?: TacticId): readonly Effect[] {
  if (kind === 'tactic') return (tacticById.get(tactic!)?.effects ?? []) as readonly Effect[];
  if (kind === 'item') return (usableItemOf(unit)?.effects ?? []) as readonly Effect[];
  const skill = skillById.get(combatantById.get(unit.officer)?.uniqueSkill ?? '');
  return (skill?.effects ?? []) as readonly Effect[];
}

/** 같은 갈래로 의도를 만든다 — `castEffects`와 짝이다 */
export function castIntent(kind: CastKind, tactic: TacticId | undefined, target?: Vec2 | UnitId): Intent {
  const aim = target === undefined ? {} : { target };
  if (kind === 'tactic') return { t: 'castTactic', tactic: tactic!, ...aim };
  if (kind === 'item') return { t: 'useItem', ...aim };
  return { t: 'castUniqueSkill', ...aim };
}

/**
 * 엔진이 통과시키는 조준 후보 — 칸이면 `Vec2`, 유닛이면 `UnitId`.
 *
 * 조준 규약(`aimingSpec`)으로 무엇을 고르는지 알고, 후보 하나하나를 `validate()`에
 * 넣어 통과한 것만 남긴다. **화면은 「누가 대상이 될 수 있는가」를 스스로 판단하지
 * 않는다** — 사거리·무적·아군 판정이 새어 나가면 서버와 어긋나기 시작한다.
 * 조준이 필요 없는 것(자기 자신·전체 대상)은 빈 배열이다 — 쓸 수 있는지는
 * `canCast()`가 대상 없는 `validate()`로 따로 묻는다.
 */
export function castCandidates(
  state: BattleState, side: Side, unitId: UnitId, kind: CastKind, tactic?: TacticId,
): (Vec2 | UnitId)[] {
  const unit = state.units[unitId];
  if (!unit) return [];
  const spec = aimingSpec(castEffects(unit, kind, tactic));
  if (!spec) return [];
  const ok = (target: Vec2 | UnitId): boolean => validate(state, side, castIntent(kind, tactic, target)).ok;

  if (spec.kind === 'tile') {
    const out: Vec2[] = [];
    for (let y = 0; y < state.boardSize.y; y++) {
      for (let x = 0; x < state.boardSize.x; x++) {
        const pos = { x, y };
        if (inBounds(pos, state.boardSize) && ok(pos)) out.push(pos);
      }
    }
    return out;
  }
  return Object.values(state.units).filter((u) => u.alive && ok(u.id)).map((u) => u.id);
}

/** 지금 쓸 수 있는가 — 대상 없이 통과하거나, 겨눌 후보가 하나라도 있다 */
export function canCast(
  state: BattleState, side: Side, unitId: UnitId, kind: CastKind, tactic?: TacticId,
): boolean {
  if (validate(state, side, castIntent(kind, tactic)).ok) return true;
  return castCandidates(state, side, unitId, kind, tactic).length > 0;
}

// ═══════════════════════════════════════════════════════════════
// 명령 여섯 칸
// ═══════════════════════════════════════════════════════════════

/**
 * 명령 판의 여섯 칸과 고유기술 (pptx 94쪽 「현재 턴인 아군일 때, 명령 가능한 것만 enable」).
 *
 * `castTactic`은 **쓸 수 있는 책략이 하나라도 있을 때** 켜진다 — 예전 화면은 책략을
 * 배웠기만 하면 켜 두고 목록 안에서 하나씩 껐는데, 그러면 눌러 놓고 전부 꺼진 목록을
 * 만난다. 목록의 켜짐은 `tactics`가 따로 말한다.
 */
export interface Commands {
  move: boolean;
  attack: boolean;
  /**
   * [공격]을 **눌러 열 수 있다** — 칠 대상이 없어도 사거리를 보고 「대상이 없다」를 듣는다
   * (2026-10-06 기획자 확정, 전투 UI 개편 4단계). `attack`은 「지금 칠 수 있는 적이 있다」이고
   * 이쪽은 「이 차례에 공격이라는 행동이 막혀 있지 않다」다 — 이미 행동했거나 「이동만」 조종을
   * 당하는 중이면 닫힌다. `validate()`의 `attack` 갈래에서 대상 판정을 뺀 것과 같다
   * (`attack`이 참이면 언제나 참 — 회귀가 고정한다).
   */
  attackOpen: boolean;
  meditate: boolean;
  castTactic: boolean;
  useItem: boolean;
  endTurn: boolean;
  /** 고유기술을 지금 쓸 수 있다 — 맥락 판의 「고유기술을 쓰시겠습니까?」가 뜨는 조건 */
  unique: boolean;
  /** 배운 책략마다 지금 쓸 수 있는가 */
  tactics: Record<TacticId, boolean>;
}

/** 이 진영이 지금 제어권을 쥐고 있지 않으면 `null` */
export function commandsFor(state: BattleState, side: Side): Commands | null {
  if (state.phase !== 'control' || !state.activeUnit) return null;
  const unit = state.units[state.activeUnit]!;
  if (controllingSide(state, unit) !== side) return null;
  const can = (intent: Intent): boolean => validate(state, side, intent).ok;

  const tactics: Record<TacticId, boolean> = {};
  for (const id of unit.tactics) tactics[id] = canCast(state, side, unit.id, 'tactic', id);

  return {
    move: legalMovesFor(state, unit.id).some((to) => can({ t: 'move', to })),
    attack: legalTargetsFor(state, unit.id).some((id) => can({ t: 'attack', targets: [id] })),
    attackOpen: !state.activeTurn?.acted && unit.control?.mode !== 'moveOnly',
    meditate: can({ t: 'meditate' }),
    castTactic: Object.values(tactics).some(Boolean),
    useItem: usableItemOf(unit) !== undefined && canCast(state, side, unit.id, 'item'),
    endTurn: can({ t: 'endTurn' }),
    unique: canCast(state, side, unit.id, 'unique'),
    tactics,
  };
}

// ═══════════════════════════════════════════════════════════════
// 순서 예보
// ═══════════════════════════════════════════════════════════════

/** 순서 판의 한 줄 */
export interface TurnSlot {
  unit: UnitId;
  side: Side;
  /** 지금부터 차례가 오기까지의 시간. 지금 차례면 0 */
  at: Time;
  /** 지금 제어권을 쥔 유닛이다(순서 판에서 들여쓰고 크게 쓴다) */
  active: boolean;
}

/**
 * 앞으로 `count`번의 차례 (pptx 90·92쪽 — 배치 중엔 전원, 전투 중엔 5번째까지).
 *
 * **「다들 아무것도 안 하고 차례를 넘긴다」고 가정한 예보다.** WT만 돌린다 —
 * 차례를 마친 유닛은 기준값(+ 보정 · 절영 몫)으로 돌아가므로 통솔이 높은 장수는
 * 목록에 **두 번** 나올 수 있다. 버프·스킬이 WT를 바꾸면 틀리고, 화면은 상태가
 * 바뀔 때마다 다시 부른다(2026-09-27 기획자 확정 — 「그대로 보여 주고 바뀌면 다시 그린다」).
 *
 * 동점은 `byTurnRank` — 엔진이 실제로 제어권을 주는 셈과 같다. 그래서 난수를 안 쓰고도
 * 동점에서 틀리지 않는다. 시간 흐름도 엔진과 같다: 차례가 끝나면 `turnEndTimeStep`만큼
 * 모두의 WT가 줄고, 그 다음에 끝낸 유닛의 WT가 기준값으로 돌아간다(`endTurn()`).
 *
 * 시전 중(`casting`)인 유닛은 지금 WT(= 지연)대로 한 번 오고, 그 뒤로는 기준값이다.
 */
export function turnForecast(state: BattleState, count: number): TurnSlot[] {
  type Sim = { unit: UnitState; wt: number; mods: { delta: number; turnsLeft: number }[] };
  const sims: Sim[] = aliveUnits(state).map((unit) => ({
    unit, wt: unit.wt, mods: (unit.wtModifiers ?? []).map((m) => ({ ...m })),
  }));
  if (sims.length === 0 || count <= 0) return [];

  const out: TurnSlot[] = [];
  let now: Time = 0;

  /** 한 차례를 마친다 — `endTurn()`과 같은 순서: 시간 1 → WT 되돌리기 → 보정 1턴 소진 */
  const finish = (sim: Sim): void => {
    const step = FORMULA.turnEndTimeStep;
    for (const s of sims) s.wt = Math.max(0, s.wt - step);
    now += step;
    const bonus = sim.mods.reduce((n, m) => n + m.delta, 0);
    sim.wt = Math.max(0, sim.unit.wtBase + bonus + wtHeldAdjust(sim.unit));
    for (const m of sim.mods) m.turnsLeft -= 1;
    sim.mods = sim.mods.filter((m) => m.turnsLeft > 0);
  };

  const active = state.activeUnit ? sims.find((s) => s.unit.id === state.activeUnit) : undefined;
  if (active) {
    out.push({ unit: active.unit.id, side: active.unit.side, at: 0, active: true });
    finish(active);
  }

  while (out.length < count) {
    const dt = Math.min(...sims.map((s) => s.wt));
    for (const s of sims) s.wt -= dt;
    now += dt;
    const next = sims.filter((s) => s.wt === 0).sort((a, b) => byTurnRank(a.unit, b.unit))[0]!;
    out.push({ unit: next.unit.id, side: next.unit.side, at: now, active: false });
    finish(next);
  }
  return out;
}
