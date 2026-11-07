/**
 * 일기토 · 설전 — 검증 · 적용 · 결말 · 게이지 (GDD §3.11, 설계서 `Design/일기토_설전_설계.md` §3)
 *
 * 붙어 있는 적 하나를 불러내 합마다 패를 내고, **공격권**을 쥔 쪽이 이기면(일기토) · 숫자가 맞으면(설전) 상대 게이지를
 * 자기 무력 · 지력만큼 깎는다. 공격권이 없는 쪽이 이기면(틀리면) 공격권만 넘어간다. 처음 공격권은 받는 쪽이다.
 *
 * `battle.ts`의 `validate()` · `apply()`가 대결 의도를 여기로 넘긴다. 이 파일은 `battle.ts`를 import하지 않는다.
 *
 * ★ **엔진은 패를 뽑지 않는다** — 카운트가 끝나면 판정 주체가 `duelReveal`을 넣고, 안 낸 쪽 패는 그 의도의 `fill`로 온다
 * (AI 대전은 서버가 · 온라인은 방이 낸다 — R16). 엔진이 시드로 뽑으면 AI 대전에서 클라이언트가 미리 읽는다.
 */

import { combatantById } from '@samchess/data';
import {
  FORMULA,
  type BattleEvent,
  type BattleState,
  type DuelKind,
  type DuelPick,
  type DuelRoundResult,
  type DuelState,
  type Intent,
  type Side,
  type UnitId,
  type UnitState,
  type ValidationResult,
} from './types.ts';
import { heldEffectOf } from './held.ts';
import { SIDES, aliveUnits, baseStats, controllingSide, duelRulesOn, officerStats, other, unitsOf, wtBaseOf } from './state.ts';

const ok: ValidationResult = { ok: true };
const no = (reason: string): ValidationResult => ({ ok: false, reason });

/** 대결 의도인가 — `validate()` · `apply()`가 여기로 넘길지 가른다 */
export type DuelIntent = Extract<Intent, { t: 'challenge' | 'answerChallenge' | 'duelPick' | 'duelFlee' | 'duelReveal' | 'duelAnswerTimeout' }>;
const DUEL_INTENTS = new Set<Intent['t']>(['challenge', 'answerChallenge', 'duelPick', 'duelFlee', 'duelReveal', 'duelAnswerTimeout']);

/**
 * **판정 주체만 넣는 의도** — 카운트 끝 · 응답 마감. 엔진은 누가 넣었는지 모르므로, 사람의 손에서 온 것을
 * 걸러 내는 자리(온라인 방의 `accepts`, AI 대전 서버의 덧붙이기)가 이 목록 하나를 본다 — 두 벌이면 한쪽만 낡는다.
 */
export const REFEREE_INTENTS: ReadonlySet<Intent['t']> = new Set(['duelReveal', 'duelAnswerTimeout']);
export const isDuelIntent = (intent: Intent): intent is DuelIntent => DUEL_INTENTS.has(intent.t);

// ═══════════════════════════════════════════════════════════════
// 읽기
// ═══════════════════════════════════════════════════════════════

/** 종류마다의 게이지 이름 — 일기토는 전의, 설전은 정신력 */
export const GAUGE_OF: Readonly<Record<DuelKind, 'morale' | 'mental'>> = { duel: 'morale', debate: 'mental' };

/**
 * 지금 게이지. **읽는 자리는 여기 하나다** — 한 번도 안 깎인 장수는 값을 안 들고 있다(판 스냅샷이 대결 없는 판에서 그대로다).
 */
export function gaugeOf(unit: UnitState, kind: DuelKind): number {
  return unit[GAUGE_OF[kind]] ?? gaugeMaxOf(unit, kind);
}

/**
 * 게이지의 상한이자 시작값 = 100 + **판 시작의** 무력(전의) · 지력(정신력) (2026-11-06 기획자). 컬렉션 · 안고 들어온 부상은 들어가고,
 * **판 안에서 대결에 져서 깎인 능력은 안 들어간다** — 상한이 판 도중에 줄면 「다 찼다」가 흔들린다.
 */
export function gaugeMaxOf(unit: UnitState, kind: DuelKind): number {
  const startInjured = !!unit.injured && !unit.duelInjured;
  const s = baseStats(unit.officer, unit.bonuses ?? [], startInjured);
  return FORMULA.duelGaugeBase + (kind === 'duel' ? s.might : s.intellect);
}

/** 한 번의 회복량 — 상한의 `duelRegen`%(올림). 상한이 달라도 0에서 꽉 차기까지 같은 시간(R24) */
export const gaugeRegenOf = (unit: UnitState, kind: DuelKind): number =>
  Math.ceil((gaugeMaxOf(unit, kind) * FORMULA.duelRegen) / 100);

/**
 * 대결에 아예 안 서는 장수 — **헌제**(황제 등급 E)는 걸 수도 걸릴 수도 없다(2026-11-06 기획자).
 * 등급으로 가른다(장수 id를 엔진에 적지 않는다). 신청을 막는 자리(`challengeBlock`)가 본다.
 */
export const duelExempt = (unit: UnitState): boolean => combatantById.get(unit.officer)?.grade === 'E';

/** 이 진영이 이 판에 그 종류의 신청권을 썼는가 (R5) */
export function duelUsedBy(state: BattleState, side: Side, kind: DuelKind): boolean {
  return !!state.duelUsed?.[side]?.[kind];
}

/** 한 번 맞으면 깎이는 양 = 공격권 쪽 무력(일기토) · 지력(설전). 부상 · 컬렉션이 반영된 「지금 쓰는」 값이다 */
export function duelHit(unit: UnitState, kind: DuelKind): number {
  const s = officerStats(unit);
  return (kind === 'duel' ? s.might : s.intellect) * FORMULA.duelDamagePerStat;
}

/** 상 · 하 · 좌 · 우 (R1) — 대각선은 아니다 */
const adjacent4 = (a: UnitState, b: UnitState): boolean =>
  Math.abs(a.pos.x - b.pos.x) + Math.abs(a.pos.y - b.pos.y) === 1;

const isPick = (kind: DuelKind, pick: unknown): pick is DuelPick =>
  kind === 'duel' ? pick === 'rock' || pick === 'paper' || pick === 'scissors' : pick === 1 || pick === 2 || pick === 3;

/** 이 대결에 선 두 진영 */
const duelSides = (state: BattleState, d: DuelState): Side[] =>
  [state.units[d.challenger]!.side, state.units[d.defender]!.side];

// ═══════════════════════════════════════════════════════════════
// 검증
// ═══════════════════════════════════════════════════════════════

/**
 * 신청을 막는 까닭 — 대상까지 본다. `validate()`의 `challenge` 갈래와 화면의 대상 고르기(`challengeTargets`)가 이것 하나다.
 * `target`이 없으면 **장수 쪽 조건만** 본다(「이 차례에 걸 수 있는 처지인가」 — 붙은 적이 없어도).
 */
export function challengeBlock(state: BattleState, side: Side, kind: DuelKind, target?: UnitId): string | null {
  if (state.phase !== 'control' || !state.activeUnit) return '제어 단계가 아니다';
  const unit = state.units[state.activeUnit]!;
  const turn = state.activeTurn!;
  if (controllingSide(state, unit) !== side) return '내 차례가 아니다';
  if (!duelRulesOn(state)) return '이 판에는 일기토 · 설전이 없다';
  if (unit.control) return '조종당하는 중에는 걸 수 없다';
  if (turn.usedUniqueSkill || turn.challenged) return '이번 차례에 이미 고유기술이나 대결을 썼다';
  if (turn.moved || turn.acted) return '이동 · 행동 전에만 건다';
  if (duelUsedBy(state, unit.side, kind)) return '이 판에 이미 신청했다';
  if (duelExempt(unit)) return '헌제는 일기토 · 설전을 걸 수 없다';
  if (unit.duelBenched?.[kind]) return '게이지가 다 차기 전에는 걸 수 없다';
  if (target === undefined) return null;
  const foe = state.units[target];
  if (!foe?.alive) return '대상이 없다';
  if (foe.side === unit.side) return '적에게만 건다';
  if (foe.control) return '조종당하는 장수에게는 걸 수 없다';
  if (duelExempt(foe)) return '헌제에게는 걸 수 없다';
  if (foe.duelBenched?.[kind]) return '그 장수는 게이지가 다 차기 전이라 빠져 있다';
  if (!adjacent4(unit, foe)) return '상하좌우로 붙은 적에게만 건다';
  return null;
}

export function validateDuel(state: BattleState, side: Side, intent: DuelIntent): ValidationResult {
  if (intent.t === 'challenge') {
    const why = challengeBlock(state, side, intent.kind, intent.target);
    return why ? no(why) : ok;
  }
  const d = state.duel;
  if (state.phase !== 'duel' || !d) return no('대결 중이 아니다');
  switch (intent.t) {
    case 'answerChallenge':
      if (d.step !== 'offer') return no('이미 답했다');
      return state.units[d.defender]!.side === side ? ok : no('신청을 받은 쪽만 답한다');
    case 'duelAnswerTimeout':
      return d.step === 'offer' ? ok : no('이미 답했다');
    case 'duelPick':
      if (d.step !== 'round') return no('아직 합이 시작되지 않았다');
      if (!duelSides(state, d).includes(side)) return no('대결에 선 진영이 아니다');
      return isPick(d.kind, intent.pick) ? ok : no(`이 대결에 낼 수 없는 패다: ${String(intent.pick)}`);
    case 'duelFlee':
      if (d.step !== 'round') return no('아직 합이 시작되지 않았다');
      return duelSides(state, d).includes(side) ? ok : no('대결에 선 진영이 아니다');
    case 'duelReveal': {
      if (d.step !== 'round') return no('아직 합이 시작되지 않았다');
      for (const s of duelSides(state, d)) {
        const pick = d.picks[s] ?? intent.fill?.[s];
        if (pick === undefined) return no(`${s}의 패가 없다 — 판정 주체가 채워 넣어야 한다`);
        if (!isPick(d.kind, pick)) return no(`이 대결에 낼 수 없는 패다: ${String(pick)}`);
      }
      return ok;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 적용
// ═══════════════════════════════════════════════════════════════

/** `validateDuel()`을 통과한 의도만 온다. `s`는 이미 떠 둔 작업용 사본이다 */
export function applyDuel(s: BattleState, side: Side, intent: DuelIntent, events: BattleEvent[]): void {
  if (intent.t === 'challenge') {
    const unit = s.units[s.activeUnit!]!;
    s.duelUsed = { ...s.duelUsed, [unit.side]: { ...s.duelUsed?.[unit.side], [intent.kind]: true } };
    s.activeTurn!.challenged = true;
    s.duel = {
      kind: intent.kind, challenger: unit.id, defender: intent.target, step: 'offer', round: 1,
      holder: intent.target, picks: {}, auto: {}, history: [],
    };
    s.phase = 'duel';
    events.push(
      { e: 'challengeOffered', kind: intent.kind, by: unit.id, to: intent.target },
      { e: 'phaseChanged', phase: 'duel' },
    );
    return;
  }

  const d = s.duel!;
  const sideOf = (id: UnitId): Side => s.units[id]!.side;
  switch (intent.t) {
    case 'answerChallenge':
      events.push({ e: 'challengeAnswered', accept: intent.accept });
      if (intent.accept) d.step = 'round';
      else endDuel(s, 'refused', sideOf(d.challenger), events);
      return;
    case 'duelAnswerTimeout':
      // 무응답 = 수락 + 받는 쪽 AI 대리 (R18)
      events.push({ e: 'challengeAnswered', accept: true, timeout: true });
      d.step = 'round';
      d.auto = { ...d.auto, [sideOf(d.defender)]: true };
      return;
    case 'duelPick':
      d.picks = { ...d.picks, [side]: intent.pick };
      // 아무 패나 누르면 그 순간 본인이 되찾는다 (R19)
      if (d.auto[side]) {
        const { [side]: _gone, ...rest } = d.auto;
        d.auto = rest;
      }
      events.push({ e: 'duelPicked', side });
      return;
    case 'duelFlee': {
      const fleer = sideOf(d.challenger) === side ? d.challenger : d.defender;
      events.push({ e: 'duelFled', unit: fleer, round: d.round });
      endDuel(s, 'fled', other(side), events);
      return;
    }
    case 'duelReveal':
      revealRound(s, intent.fill ?? {}, events);
      return;
  }
}

/** 일기토 — 가위는 보를, 보는 바위를, 바위는 가위를 이긴다 */
const BEATS: Readonly<Record<string, string>> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

/** 한 합의 판정 (R7) — 공격권 쪽의 패와 다른 쪽의 패로 */
export function roundResult(kind: DuelKind, holderPick: DuelPick, otherPick: DuelPick): DuelRoundResult {
  if (kind === 'debate') return holderPick === otherPick ? 'hit' : 'turnover';
  if (holderPick === otherPick) return 'tie';
  return BEATS[holderPick as string] === otherPick ? 'hit' : 'turnover';
}

function revealRound(s: BattleState, fill: Partial<Record<Side, DuelPick>>, events: BattleEvent[]): void {
  const d = s.duel!;
  const holder = s.units[d.holder]!;
  const foe = s.units[d.holder === d.challenger ? d.defender : d.challenger]!;

  // 안 낸 진영은 판정 주체가 채운 패 — 그 진영은 AI 대리로 적힌다 (R19)
  const auto: Side[] = [];
  const picks = {} as Record<Side, DuelPick>;
  for (const side of [holder.side, foe.side]) {
    const own = d.picks[side];
    if (own === undefined || d.auto[side]) auto.push(side);
    picks[side] = (own ?? fill[side])!;
  }
  if (auto.length) d.auto = { ...d.auto, ...Object.fromEntries(auto.map((x) => [x, true])) };

  const result = roundResult(d.kind, picks[holder.side], picks[foe.side]);
  const damage = result === 'hit' ? duelHit(holder, d.kind) : 0;
  events.push({ e: 'duelRound', round: d.round, picks, holder: holder.id, result, damage, auto });
  d.history.push({ round: d.round, picks, holder: holder.id, result, damage, auto });

  if (result === 'hit') setGauge(foe, d.kind, gaugeOf(foe, d.kind) - damage, events);
  if (result === 'turnover') d.holder = foe.id;

  d.picks = {};
  d.round += 1;
  if (gaugeOf(foe, d.kind) <= 0) endDuel(s, 'zero', holder.side, events);
  else if (d.round > FORMULA.duelRounds) endDuel(s, 'cap', null, events);
}

function setGauge(unit: UnitState, kind: DuelKind, to: number, events: BattleEvent[]): void {
  const next = Math.max(0, Math.min(gaugeMaxOf(unit, kind), to));
  if (next === gaugeOf(unit, kind)) return;
  unit[GAUGE_OF[kind]] = next;
  events.push({ e: 'gaugeChanged', unit: unit.id, gauge: GAUGE_OF[kind], to: next });
}

// ═══════════════════════════════════════════════════════════════
// 결말 · 보상 · 부상 — 거절 · 도망 · 0 · 10합 넷이 전부 `endDuel` 하나를 지난다
// ═══════════════════════════════════════════════════════════════

/**
 * 대결을 끝낸다 — 보상(R12 ~ R14)을 내고, 게이지 0이면 진 장수를 빼고 다치게 하고(R11), **차례를 신청자에게 돌려준다**(R17).
 * `winner`는 이긴 진영이고 결판 없음(`cap`)이면 `null`이다.
 */
export function endDuel(
  s: BattleState, reason: 'refused' | 'fled' | 'zero' | 'cap', winner: Side | null, events: BattleEvent[],
): void {
  const d = s.duel!;
  events.push({ e: 'duelEnded', kind: d.kind, reason, ...(winner ? { winner } : {}) });

  if (winner === null) {
    if (d.kind === 'duel') for (const side of SIDES) addSp(s, side, FORMULA.duelDrawSp, events);
    else for (const u of aliveUnits(s)) addMp(u, FORMULA.debateDrawMp, d.kind, events);
  } else if (d.kind === 'duel') {
    const n = FORMULA.duelWinSp[s.mode];
    addSp(s, winner, n, events);
    addSp(s, other(winner), -n, events);
  } else {
    for (const u of unitsOf(s, winner)) if (u.alive) addMp(u, FORMULA.debateWinMp, d.kind, events);
    for (const u of unitsOf(s, other(winner))) if (u.alive) addMp(u, -FORMULA.debateWinMp, d.kind, events);
  }

  if (reason === 'zero') {
    const loser = s.units[d.challenger]!.side === winner ? d.defender : d.challenger;
    woundByDuel(s.units[loser]!, d.kind, events);
  }

  delete s.duel;
  s.phase = 'control';
  events.push({ e: 'phaseChanged', phase: 'control' });
}

function addSp(s: BattleState, side: Side, delta: number, events: BattleEvent[]): void {
  const next = Math.max(0, Math.min(s.spCap[side], s.sp[side] + delta));
  if (next === s.sp[side]) return;
  s.sp[side] = next;
  events.push({ e: 'spChanged', side, to: next });
}

function addMp(unit: UnitState, delta: number, kind: DuelKind, events: BattleEvent[]): void {
  const next = Math.max(0, Math.min(unit.maxMp, unit.mp + delta));
  if (next === unit.mp) return;
  events.push({ e: 'mpChanged', unit: unit.id, delta: next - unit.mp, reason: kind });
  unit.mp = next;
}

/**
 * 게이지 0 (R11) — **그 종류에서 빠지고**(게이지가 다시 꽉 찰 때까지) **즉시 다친다**.
 *
 * 다침 = 일반 부상(`injured` — 무 · 지 · 통 −10, 겹치지 않는다) + 진 종류의 능력 −10 더(`duelWound`, 같은 종류는 한 번).
 * 통솔이 깎이므로 **`wtBase`를 다시 잰다** — 안 그러면 통솔 −10이 화면 숫자에만 남는다. 지금 WT는 그대로라 **다음 차례부터** 늦다.
 * 청낭서를 든 장수는 안 다친다(GDD §5.7 · §6.5) — 빠지는 것은 같다. 헌제는 2026-11-06부터 대결에 아예 안 선다(`duelExempt`) — 등급 검사는 지킴으로 남긴다.
 */
export function woundByDuel(unit: UnitState, kind: DuelKind, events: BattleEvent[]): void {
  unit.duelBenched = { ...unit.duelBenched, [kind]: true };
  const hurt = combatantById.get(unit.officer)?.grade !== 'E' && !heldEffectOf(unit.held).noInjury;
  if (hurt) {
    if (!unit.injured) unit.duelInjured = true;
    unit.injured = true;
    unit.duelWound = { ...unit.duelWound, [kind]: true };
    const next = wtBaseOf(officerStats(unit).leadership, unit.held);
    if (next !== unit.wtBase) unit.wtBase = next;
  }
  events.push({ e: 'duelWounded', unit: unit.id, kind, hurt });
}

// ═══════════════════════════════════════════════════════════════
// 회복 (R24) — `battle.ts`의 주기 정산이 부른다
// ═══════════════════════════════════════════════════════════════

/** 덜 찬 게이지가 있는가 — 없으면 주기 정산을 아예 안 모은다(평소 판의 로그 · 순서가 그대로다) */
export function anyGaugeLow(state: BattleState): boolean {
  return aliveUnits(state).some((u) => gaugeOf(u, 'duel') < gaugeMaxOf(u, 'duel') || gaugeOf(u, 'debate') < gaugeMaxOf(u, 'debate'));
}

/** 한 번의 회복 — 덜 찬 게이지마다 상한의 `duelRegen`%. 꽉 차면 그 종류의 「빠짐」이 풀린다 */
export function regenGauges(state: BattleState, events: BattleEvent[]): void {
  for (const u of aliveUnits(state)) {
    for (const kind of ['duel', 'debate'] as const) {
      const now = gaugeOf(u, kind);
      const max = gaugeMaxOf(u, kind);
      if (now >= max) continue;
      setGauge(u, kind, now + gaugeRegenOf(u, kind), events);
      if (gaugeOf(u, kind) >= max && u.duelBenched?.[kind]) {
        const { [kind]: _gone, ...rest } = u.duelBenched;
        if (Object.keys(rest).length) u.duelBenched = rest;
        else delete u.duelBenched;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 미리 재기 — 화면 · AI가 쓴다. 난수를 안 쓴다
// ═══════════════════════════════════════════════════════════════

/** 승 · 패 · 결판 없음 확률 (합이 0 ~ 1) */
export interface DuelOdds { win: number; lose: number; draw: number }

/**
 * 양쪽이 무작위로 낸다고 본 **정확한** 확률 — 나의 남은 타격 수 · 상대의 남은 타격 수 · 공격권 · 남은 합으로 (설계서 §2-1).
 * 일기토는 한 합에 공격권 쪽 이김 · 다른 쪽 이김 · 비김이 1/3씩, 설전은 맞음 1/3 · 틀림 2/3이다.
 */
export function duelOdds(kind: DuelKind, iHold: boolean, myHits: number, theirHits: number, rounds: number): DuelOdds {
  const memo = new Map<string, DuelOdds>();
  const hit = 1 / 3;
  const turn = kind === 'duel' ? 1 / 3 : 2 / 3;
  const stay = 1 - hit - turn;
  const go = (hold: boolean, mine: number, theirs: number, left: number): DuelOdds => {
    if (theirs <= 0) return { win: 1, lose: 0, draw: 0 };
    if (mine <= 0) return { win: 0, lose: 1, draw: 0 };
    if (left <= 0) return { win: 0, lose: 0, draw: 1 };
    const key = `${+hold}.${mine}.${theirs}.${left}`;
    const seen = memo.get(key);
    if (seen) return seen;
    const parts: [number, DuelOdds][] = [
      [hit, hold ? go(hold, mine, theirs - 1, left - 1) : go(hold, mine - 1, theirs, left - 1)],
      [turn, go(!hold, mine, theirs, left - 1)],
      [stay, go(hold, mine, theirs, left - 1)],
    ];
    const out = { win: 0, lose: 0, draw: 0 };
    for (const [p, o] of parts) {
      if (p === 0) continue;
      out.win += p * o.win; out.lose += p * o.lose; out.draw += p * o.draw;
    }
    memo.set(key, out);
    return out;
  };
  return go(iHold, myHits, theirHits, rounds);
}

/** 남은 타격 수 — 지금 게이지를 한 번에 깎이는 양으로 나눠 올린다 */
const hitsToZero = (gauge: number, hit: number): number => (gauge <= 0 ? 0 : Math.ceil(gauge / Math.max(1, hit)));

/** 신청 전 · 대결 중의 예보 — 거는 쪽(`me`)에서 본다 */
export interface DuelForecast extends DuelOdds {
  /** 내가 상대를 0으로 만드는 데 필요한 타격 수 */
  hitsToWin: number;
  /** 상대가 나를 0으로 만드는 데 필요한 타격 수 */
  hitsToLose: number;
  /** 지금 공격권이 나에게 있는가 — 신청 전이면 언제나 거짓(받는 쪽이 먼저 쥔다) */
  iHold: boolean;
  /** 남은 합 */
  rounds: number;
}

/**
 * 「이 장수에게 걸면 / 지금 이 대결은」 — 화면의 확인창 · 대결 층과 AI가 같은 숫자를 본다.
 * 대결 중이면 그 대결의 공격권 · 남은 합으로, 아니면 새로 거는 셈(받는 쪽이 공격권, 합 전부)으로 잰다.
 */
export function duelForecast(state: BattleState, me: UnitId, foe: UnitId, kind: DuelKind): DuelForecast | null {
  const a = state.units[me];
  const b = state.units[foe];
  if (!a?.alive || !b?.alive) return null;
  const d = state.duel;
  const live = d && d.kind === kind && [d.challenger, d.defender].includes(me) && [d.challenger, d.defender].includes(foe);
  const iHold = live ? d.holder === me : false;
  const rounds = live ? FORMULA.duelRounds - d.round + 1 : FORMULA.duelRounds;
  const hitsToWin = hitsToZero(gaugeOf(b, kind), duelHit(a, kind));
  const hitsToLose = hitsToZero(gaugeOf(a, kind), duelHit(b, kind));
  return { ...duelOdds(kind, iHold, hitsToLose, hitsToWin, rounds), hitsToWin, hitsToLose, iHold, rounds };
}
