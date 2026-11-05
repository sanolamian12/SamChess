/**
 * 일기토 · 설전 AI (GDD §3.11, 설계서 §3-6) — 신청 · 수락 · 도망을 **기대값 하나**로 정한다.
 *
 * 대결의 승 · 패 · 결판 없음 확률은 정확히 계산된다(`duelForecast` — 공격권 · 남은 타격 수 · 남은 합만 보는 작은 표).
 * 거기에 각 결말이 판에 주는 값을 곱한다.
 *
 * | 결말 | 일기토 | 설전 |
 * |---|---|---|
 * | 이김 | 내 SP +n · 적 SP −n (상한 · 바닥에서 잘린 만큼만) + 버프가 켜지거나 적 버프가 꺼지면 `buff` | 우리 전원 MP +2 · 적 전원 −2 (잘린 만큼, 책략을 아는 장수만 값이 크다) |
 * | 짐 | 그 반대 | 그 반대 |
 * | 0이 되어 짐 | + 진 장수의 부상 값(`wound`) | 같다 |
 * | 결판 없음 | 양쪽 SP +1 | 양쪽 전원 MP +1 |
 *
 * - **신청**: 걸 수 있는 (종류, 대상)마다 기대값을 재 가장 큰 것이 `keepRight`(신청권을 남겨 둘 값)보다 크면 건다.
 * - **수락**: 거절은 「확실한 패배, 부상 없음」이다 — 수락의 기대값이 그보다 작지 않으면 받는다.
 * - **도망**: 매 합 공개 전에 「지금 지는 것(부상 없음)」과 「계속」을 견준다.
 * - **패**는 AI가 안 낸다 — 판정 주체가 채운다(R16). AI 대 AI 측정(`autoDuel`)만 시드 난수로 채운다.
 *
 * 값의 단위는 **SP 1**이다. 가중치는 `DUEL_AI`에 모았다 — `npm run balance:duel`이 잰다.
 *
 * **「SP 상한에서 고유기술을 아낄까」는 안 넣었다** (2026-11-05 측정) — 고유기술은 장수마다 한 번이고 AI는 비용이 모이면 바로 써서,
 * SP가 상한에 닿는 것은 **기술을 다 쓴 뒤**뿐이다. 아끼는 판단을 켜 봐도 2000판이 한 판도 안 달라졌다.
 * 시계 · `Math.random()`을 안 쓴다(룰 엔진의 규약). 같은 상태 → 같은 판단.
 */

import { combatantById } from '@samchess/data';
import { apply } from './battle.ts';
import { challengeBlock, duelForecast, type DuelForecast } from './duel.ts';
import { nextInt, type RngSource } from './rng.ts';
import { aliveUnits, controllingSide } from './state.ts';
import { heldEffectOf } from './held.ts';
import {
  FORMULA, type BattleEvent, type BattleState, type DuelKind, type DuelPick, type Intent, type Side, type UnitId, type UnitState,
} from './types.ts';

/** 판단의 가중치 — 단위는 SP 1. **측정 도구만 바꾼다**(`balance:duel`). 판 안에서는 상수다 */
export const DUEL_AI = {
  /** 내 버프가 켜지거나 · 적 버프가 꺼지는 값 (한 번에) */
  buff: 2,
  /** 책략을 아는 장수의 MP 1 */
  mpTactician: 0.5,
  /** 책략이 없는 장수의 MP 1 — 명상을 아끼는 정도 */
  mpPlain: 0.1,
  /** 0이 되어 다치는 값 — 무 · 지 · 통이 깎이고 WT가 늦어진다 */
  wound: 3,
  /** King이 다치는 값에 더한다 */
  woundKing: 2,
  /** 신청권을 이번에 쓰지 않고 남겨 둘 값 — 이보다 큰 기대값일 때만 건다 */
  keepRight: 0.5,
};

// ═══════════════════════════════════════════════════════════════
// 결말의 값
// ═══════════════════════════════════════════════════════════════

const clampDelta = (now: number, delta: number, max: number): number => Math.max(0, Math.min(max, now + delta)) - now;

/** 진영 SP를 `delta`만큼 움직인 값 — 잘린 만큼만, 상한에 닿거나 상한에서 떨어지면 버프 값 */
function spValue(state: BattleState, side: Side, delta: number, mine: Side): number {
  const now = state.sp[side];
  const cap = state.spCap[side];
  const real = clampDelta(now, delta, cap);
  const was = now >= cap;
  const will = now + real >= cap;
  const toggle = was === will ? 0 : will ? DUEL_AI.buff : -DUEL_AI.buff;
  // 내 진영이면 오르는 것이 좋고, 적 진영이면 내리는 것이 좋다
  return (side === mine ? 1 : -1) * (real + toggle);
}

/** 진영 전원의 MP를 `delta`만큼 — 책략을 아는 장수일수록 값이 크다 */
function mpValue(state: BattleState, side: Side, delta: number, mine: Side): number {
  let v = 0;
  for (const u of aliveUnits(state)) {
    if (u.side !== side) continue;
    const real = clampDelta(u.mp, delta, u.maxMp);
    v += real * (u.tactics.length > 0 ? DUEL_AI.mpTactician : DUEL_AI.mpPlain);
  }
  return side === mine ? v : -v;
}

/** 0이 되어 지면 붙는 부상의 값 — 안 다치는 장수(헌제 · 청낭서)는 0, 이미 그 종류로 다쳤으면 빠짐만 남아 작다 */
function woundValue(unit: UnitState, kind: DuelKind): number {
  if (combatantById.get(unit.officer)?.grade === 'E' || heldEffectOf(unit.held).noInjury) return 0;
  const base = DUEL_AI.wound + (unit.piece === 'King' ? DUEL_AI.woundKing : 0);
  if (unit.duelWound?.[kind]) return 0.5;
  return unit.injured ? base / 2 : base;
}

/** 결말 셋의 값 — `me`의 진영에서 본다 */
interface Stakes { win: number; lose: number; draw: number }

function stakes(state: BattleState, me: UnitState, foe: UnitState, kind: DuelKind): Stakes {
  const mine = me.side;
  const theirs = foe.side;
  if (kind === 'duel') {
    const n = FORMULA.duelWinSp[state.mode];
    return {
      win: spValue(state, mine, n, mine) + spValue(state, theirs, -n, mine),
      lose: spValue(state, mine, -n, mine) + spValue(state, theirs, n, mine),
      draw: spValue(state, mine, FORMULA.duelDrawSp, mine) + spValue(state, theirs, FORMULA.duelDrawSp, mine),
    };
  }
  const n = FORMULA.debateWinMp;
  return {
    win: mpValue(state, mine, n, mine) + mpValue(state, theirs, -n, mine),
    lose: mpValue(state, mine, -n, mine) + mpValue(state, theirs, n, mine),
    draw: mpValue(state, mine, FORMULA.debateDrawMp, mine) + mpValue(state, theirs, FORMULA.debateDrawMp, mine),
  };
}

/**
 * `me`가 `foe`와 이 종류로 겨룰 때의 기대값(지금 상태에서 끝까지 둔다고 보고). 이기면 상대가, 지면 내가 0이 되어 다친다 —
 * 표의 승 · 패는 전부 「0으로 만듦」이다(도망은 따로 견준다).
 */
export function duelExpectation(state: BattleState, me: UnitId, foe: UnitId, kind: DuelKind): { value: number; forecast: DuelForecast } | null {
  const a = state.units[me];
  const b = state.units[foe];
  const f = duelForecast(state, me, foe, kind);
  if (!a || !b || !f) return null;
  const v = stakes(state, a, b, kind);
  const value = f.win * (v.win + woundValue(b, kind)) + f.lose * (v.lose - woundValue(a, kind)) + f.draw * v.draw;
  return { value, forecast: f };
}

/** 지금 포기하면(거절 · 도망) — 확실한 패배, 다치지 않는다 */
function giveUpValue(state: BattleState, me: UnitState, foe: UnitState, kind: DuelKind): number {
  return stakes(state, me, foe, kind).lose;
}

// ═══════════════════════════════════════════════════════════════
// 판단 셋
// ═══════════════════════════════════════════════════════════════

/** 지금 차례의 장수가 걸 대결 — 걸 것이 없거나 남겨 두는 편이 나으면 `undefined` */
export function chooseChallenge(state: BattleState): Intent | undefined {
  if (!state.activeUnit) return undefined;
  const unit = state.units[state.activeUnit]!;
  const side = controllingSide(state, unit);
  let best: { value: number; intent: Intent } | undefined;
  for (const kind of ['duel', 'debate'] as const) {
    if (challengeBlock(state, side, kind) !== null) continue;
    for (const foe of aliveUnits(state)) {
      if (challengeBlock(state, side, kind, foe.id) !== null) continue;
      const e = duelExpectation(state, unit.id, foe.id, kind);
      if (!e) continue;
      if (!best || e.value > best.value) best = { value: e.value, intent: { t: 'challenge', kind, target: foe.id } };
    }
  }
  return best && best.value > DUEL_AI.keepRight ? best.intent : undefined;
}

/** 받는 쪽의 답 — 수락의 기대값이 거절(확실한 패배)보다 작지 않으면 받는다 */
export function chooseAnswer(state: BattleState): Intent {
  const d = state.duel!;
  const me = state.units[d.defender]!;
  const foe = state.units[d.challenger]!;
  const accept = duelExpectation(state, me.id, foe.id, d.kind);
  return { t: 'answerChallenge', accept: !accept || accept.value >= giveUpValue(state, me, foe, d.kind) };
}

/** 이 진영이 지금(다음 공개 전에) 도망할까 — 계속의 기대값이 지금 지는 것보다 나쁘면 */
export function shouldFlee(state: BattleState, side: Side): boolean {
  const d = state.duel;
  if (!d || d.step !== 'round') return false;
  const meId = state.units[d.challenger]!.side === side ? d.challenger : d.defender;
  const foeId = meId === d.challenger ? d.defender : d.challenger;
  const me = state.units[meId]!;
  const go = duelExpectation(state, meId, foeId, d.kind);
  return !!go && go.value < giveUpValue(state, me, state.units[foeId]!, d.kind);
}

// ═══════════════════════════════════════════════════════════════
// AI 대 AI — 열린 대결을 끝까지 (측정 · 회귀 전용)
// ═══════════════════════════════════════════════════════════════

const HANDS: readonly DuelPick[] = ['rock', 'paper', 'scissors'];
const NUMBERS: readonly DuelPick[] = [1, 2, 3];

/**
 * 이 진영의 AI가 **지금** 대결에서 낼 의도 — 받는 쪽이면 답, 합 중이면 도망할지. 없으면 `null`.
 *
 * ★ 판정 주체(`LocalTransport`)와 서버 재생(`replayLocalMatch`)이 **같은 자리에서** 부른다 — 상태가 바뀔 때마다,
 * 사람의 다음 의도를 받기 전에. AI의 판단은 상태만 보므로 두 쪽이 같은 순서로 같은 수를 낸다.
 * 패는 여기서 안 낸다 — AI 패는 판정 주체가 채운다(`revealWithSeed`, 단계 5에서 서버 패로 바뀐다).
 */
export function duelAiIntent(state: BattleState, aiSide: Side): Intent | null {
  const d = state.duel;
  if (state.phase !== 'duel' || !d) return null;
  if (d.step === 'offer') return state.units[d.defender]!.side === aiSide ? chooseAnswer(state) : null;
  const inDuel = state.units[d.challenger]!.side === aiSide || state.units[d.defender]!.side === aiSide;
  return inDuel && shouldFlee(state, aiSide) ? { t: 'duelFlee' } : null;
}

/**
 * 카운트가 끝났다 — **아직 안 낸 진영의 패를 판의 시드 난수로 채워** 연다(대결에 선 순서: 건 쪽 → 받는 쪽).
 * 뽑은 만큼 커서가 밀린다(같은 시드 + 같은 수 → 같은 판). 사람이 낸 패는 덮지 않는다.
 *
 * ★ **AI 대전에서는 임시다** — 클라이언트가 시드를 알아 AI 패를 미리 읽을 수 있다. 단계 5(설계서 §3-5)에서 AI 패를
 * 서버가 내는 것으로 바꾼다. AI 대 AI(`autoDuel`)는 미리 읽을 사람이 없어 이대로 맞다.
 */
export function revealWithSeed(state: BattleState): { state: BattleState; events: BattleEvent[] } {
  const rng = { seed: state.seed, rngCursor: state.rngCursor };
  return revealWith(state, rng, () => ({ ...state, rngCursor: rng.rngCursor }));
}

/**
 * 같은 공개를 **판 밖의 난수로** — 온라인 방(`room-logic.ts`)이 쓴다. 판의 시드 · 커서는 전선에 실려 가서, 그것으로 채우면
 * 손댄 클라이언트가 AI 대리(무응답 · 끊김) 상대의 패를 미리 계산한다. 방은 전선에 안 싣는 제 난수를 넘긴다. 판의 커서는 그대로다.
 */
export function revealWithRng(state: BattleState, rng: RngSource): { state: BattleState; events: BattleEvent[] } {
  return revealWith(state, rng, () => state);
}

function revealWith(
  state: BattleState, rng: RngSource, base: () => BattleState,
): { state: BattleState; events: BattleEvent[] } {
  const d = state.duel!;
  const sides: Side[] = [state.units[d.challenger]!.side, state.units[d.defender]!.side];
  const pool = d.kind === 'duel' ? HANDS : NUMBERS;
  const fill: Partial<Record<Side, DuelPick>> = {};
  for (const side of sides) if (d.picks[side] === undefined) fill[side] = pool[nextInt(rng, pool.length)]!;
  // 뽑은 뒤의 커서로 판을 만든다 — 시드 판(`revealWithSeed`)은 커서가 밀린 판, 방의 판은 그대로
  return apply(base(), sides[0]!, { t: 'duelReveal', fill });
}

/**
 * 열린 대결을 끝까지 — **양쪽이 다 AI인** 자동 대전(`autoBattle`)만 쓴다. 받는 쪽이 답하고, 합마다 양쪽이 도망을 따져 보고,
 * 패는 판의 시드 난수(`revealWithSeed`). 실제 판의 판정 주체는 같은 두 함수를 시계에 맞춰 부른다.
 */
export function autoDuel(state: BattleState): { state: BattleState; events: BattleEvent[] } {
  let s = state;
  const events: BattleEvent[] = [];
  const take = (r: { state: BattleState; events: BattleEvent[] }): void => {
    s = r.state;
    events.push(...r.events);
  };
  for (let guard = 0; s.phase === 'duel' && guard < FORMULA.duelRounds + 2; guard++) {
    const d = s.duel!;
    let acted = false;
    for (const side of [s.units[d.challenger]!.side, s.units[d.defender]!.side]) {
      const intent = duelAiIntent(s, side);
      if (!intent) continue;
      take(apply(s, side, intent));
      acted = true;
      break;
    }
    if (acted) continue;
    take(revealWithSeed(s));
  }
  if (s.phase === 'duel') throw new Error('대결이 합 상한 안에 안 끝났다');
  return { state: s, events };
}
