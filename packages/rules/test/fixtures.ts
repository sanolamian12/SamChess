/**
 * 테스트 공용 픽스처. `*.test.ts`가 아니므로 러너가 직접 실행하지는 않는다.
 */

import { TACTICS } from '@samchess/data';
import { advanceTime, apply, createBattle } from '../src/battle.ts';
import type {
  BattleState, OfficerId, PieceType, RosterEntry, Side, TacticId, UnitId, Vec2,
} from '../src/types.ts';

export const U = (id: string): UnitId => id as UnitId;

/** 이름으로 책략 id를 찾는다 — 로마자 슬러그 규칙이 바뀌어도 테스트가 버틴다. */
export const T = (name: string): TacticId => {
  const t = TACTICS.find((x) => x.name === name);
  if (!t) throw new Error(`책략을 찾을 수 없다: ${name}`);
  return t.id as TacticId;
};

export const R = (
  officer: string,
  piece: PieceType,
  level = 1,
  statPicks: ('hp' | 'mp' | 'at')[] = [],
  tactics: TacticId[] = [],
): RosterEntry => ({ officer: officer as OfficerId, piece, level, statPicks, tactics });

/** 유비(통솔91) · 관우(100) · 조식(13) vs 조조(98) · 장합(88) · 헌제(1) */
export function battle(seed = 1, rosters?: { P1: RosterEntry[]; P2: RosterEntry[] }): BattleState {
  return createBattle({
    matchId: 'test',
    seed,
    mode: '3v3',
    rosters: rosters ?? {
      P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')],
      P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
    },
  });
}

/** 배치·정찰을 건너뛰고 바로 전투 단계로. */
export function running(s: BattleState): BattleState {
  const t = structuredClone(s);
  t.ready = { P1: true, P2: true };
  t.phase = 'running';
  return t;
}

/** 특정 유닛에게 제어권을 강제로 준다 (판정만 떼어 보고 싶을 때). */
export function giveControl(s: BattleState, id: UnitId): BattleState {
  const t = running(s);
  t.phase = 'control';
  t.activeUnit = id;
  t.activeTurn = { moved: false, acted: false, usedUniqueSkill: false };
  return t;
}

/** 이미 만든 상태의 유닛에게 책략을 쥐여 준다 (UnitState.tactics는 readonly라 여기서만 우회). */
export function learn(s: BattleState, id: UnitId, tactics: TacticId[]): BattleState {
  const t = structuredClone(s);
  (t.units[id] as unknown as { tactics: TacticId[] }).tactics = tactics;
  return t;
}

export function place(s: BattleState, at: Record<string, Vec2>): BattleState {
  const t = structuredClone(s);
  for (const [id, pos] of Object.entries(at)) t.units[U(id)]!.pos = pos;
  return t;
}

export const sideOf = (s: BattleState, id: UnitId): Side => s.units[id]!.side;

/** 제어권을 얻는 대로 턴만 넘기며 n턴 진행. 제어권 순서를 기록한다. */
export function runTurns(start: BattleState, n: number): { state: BattleState; order: UnitId[] } {
  let s = start;
  const order: UnitId[] = [];
  for (let i = 0; i < n && !s.winner; i++) {
    s = advanceTime(s).state;
    if (!s.activeUnit) break;
    order.push(s.activeUnit);
    s = apply(s, sideOf(s, s.activeUnit), { t: 'endTurn' }).state;
  }
  return { state: s, order };
}
