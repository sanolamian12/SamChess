/**
 * 시간이 깎거나 채운 HP의 갈래 (2026-11-09 기획자) — 성채 회복은 초록 「+1」, 식소사번 · 질병은 즉사 아이콘 「-1」,
 * 화소연영 · 화계 칸은 불 그림. `dot`은 이유가 하나라 장수에게 남은 상태로 가른다(`tickKind.ts`).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ActiveStatus, BattleEvent, BattleState, UnitId } from '@samchess/rules';
import { tickKind } from '../src/battle/tickKind.ts';

const U = 'P2-Queen' as UnitId;
const stateWith = (statuses: ActiveStatus[], maxHp = 30): BattleState =>
  ({ units: { [U]: { id: U, maxHp, statuses } } }) as unknown as BattleState;
const hp = (delta: number, reason: string): Extract<BattleEvent, { e: 'hpChanged' }> => ({ e: 'hpChanged', unit: U, delta, reason });

const SIK_SO = { status: 'dot', magnitude: 1, period: 110, cleansable: false } as ActiveStatus;      // 식소사번
const JIL_BYEONG = { status: 'dot', magnitude: 1, period: 100 } as ActiveStatus;                     // 질병
const HWA_SO = { status: 'dot', magnitudePct: 0.1, period: 100, cleansable: false } as ActiveStatus; // 화소연영

test('성채 · 성지의 회복은 heal, 시간이 아닌 변화는 null', () => {
  assert.equal(tickKind(stateWith([]), hp(1, 'terrain:holy')), 'heal');
  assert.equal(tickKind(stateWith([]), hp(-4, 'attack')), null);
  assert.equal(tickKind(stateWith([HWA_SO]), hp(-3, 'skill:yuk-son')), null);   // 화소연영 즉시분은 공격과 같은 자리
});

test('화계 칸 · 화소연영은 fire, 식소사번 · 질병은 hurt', () => {
  assert.equal(tickKind(stateWith([]), hp(-1, 'terrain:fire')), 'fire');
  assert.equal(tickKind(stateWith([HWA_SO]), hp(-3, 'dot')), 'fire');
  assert.equal(tickKind(stateWith([SIK_SO]), hp(-1, 'dot')), 'hurt');
  assert.equal(tickKind(stateWith([JIL_BYEONG]), hp(-1, 'dot')), 'hurt');
});

test('둘 다 걸려 있으면 깎인 양으로 가른다 · 이 통에서 풀려 남은 것이 없으면 양으로', () => {
  assert.equal(tickKind(stateWith([SIK_SO, HWA_SO]), hp(-3, 'dot')), 'fire');
  assert.equal(tickKind(stateWith([SIK_SO, HWA_SO]), hp(-1, 'dot')), 'hurt');
  assert.equal(tickKind(stateWith([]), hp(-3, 'dot')), 'fire');
  assert.equal(tickKind(stateWith([]), hp(-1, 'dot')), 'hurt');
});
