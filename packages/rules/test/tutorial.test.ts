/**
 * 튜토리얼 판 회귀 — `scenario: 'tutorial'` + `ScenarioSetup` (Design/튜토리얼_시나리오_초안.md)
 *
 * 판 크기 · 자리 · 시작 HP/MP/WT/SP를 데이터가 정하고, King 없이도 서고, 배치 · 정찰 없이 곧장 시간이 흐른다.
 * 승패는 대전과 같은 `checkEnd`(King 격파 또는 전멸)다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { advanceTime, apply, createBattle, legalMovesFor, legalTargetsFor } from '../src/battle.ts';
import { deployZoneOf, supplyDepotOf } from '../src/state.ts';
import { banditOfficerId } from '../src/raid.ts';
import type { BattleConfig, RosterEntry, ScenarioSetup } from '../src/types.ts';
import { R, U } from './fixtures.ts';

const BANDIT: RosterEntry = { officer: banditOfficerId('King'), piece: 'King', level: 1, statPicks: [], tactics: [] };

/** 기본 1의 한 판 꼴 — 손견 Rock 하나 vs HP 1 도적 하나, 9 × 9 */
const rockLesson = (setup?: Partial<ScenarioSetup>): BattleConfig => ({
  matchId: 'tutorial-test', seed: 1, mode: '3v3', scenario: 'tutorial',
  rosters: { P1: [R('son-gyeon', 'Rock')], P2: [BANDIT] },
  setup: {
    board: { x: 9, y: 9 },
    positions: { P1: [{ x: 4, y: 7 }], P2: [{ x: 5, y: 2 }] },
    overrides: { P1: [{ wt: 0 }], P2: [{ hp: 1 }] },
    ...setup,
  },
});

test('튜토리얼 판 — King 없이 서고, 판 크기 · 자리는 setup이 정한다', () => {
  const s = createBattle(rockLesson());
  assert.equal(s.scenario, 'tutorial');
  assert.deepEqual(s.boardSize, { x: 9, y: 9 });
  assert.deepEqual(s.units[U('P1-Rock')]!.pos, { x: 4, y: 7 });
  assert.deepEqual(s.units[U('P2-King')]!.pos, { x: 5, y: 2 });
  assert.deepEqual(s.terrain, []);
});

test('튜토리얼 판 — 배치 · 정찰 없이 running으로 시작하고, 첫 advanceTime이 차례를 준다', () => {
  const s = createBattle(rockLesson());
  assert.equal(s.phase, 'running');
  assert.deepEqual(s.ready, { P1: true, P2: true });
  const t = advanceTime(s).state;
  assert.equal(t.phase, 'control');
  assert.equal(t.activeUnit, U('P1-Rock'), 'WT 0으로 덮어쓴 쪽이 먼저');
});

test('덮어쓰기 — 지금 HP만 바뀌고 최대치는 그대로(다친 도적이지 약한 도적이 아니다)', () => {
  const s = createBattle(rockLesson());
  const bandit = s.units[U('P2-King')]!;
  assert.equal(bandit.hp, 1);
  assert.equal(bandit.maxHp, 10);
  assert.equal(s.units[U('P1-Rock')]!.wt, 0);
});

test('기본 1의 한 판 — 이동 한 번 → 공격 한 번에 도적이 쓰러지고 P1이 이긴다', () => {
  let s = advanceTime(createBattle(rockLesson())).state;
  // Rock은 십자로 움직이고 대각으로 친다 — 제자리에서는 안 닿는다
  assert.deepEqual(legalTargetsFor(s, U('P1-Rock')), []);
  assert.ok(legalMovesFor(s, U('P1-Rock')).some((p) => p.x === 4 && p.y === 3));
  s = apply(s, 'P1', { t: 'move', to: { x: 4, y: 3 } }).state;
  assert.deepEqual(legalTargetsFor(s, U('P1-Rock')), [U('P2-King')]);
  s = apply(s, 'P1', { t: 'attack', targets: [U('P2-King')] }).state;
  assert.equal(s.phase, 'finished');
  assert.equal(s.winner, 'P1');
});

test('King이 없는 쪽은 전멸로 진다', () => {
  // 도적도 King이 아니게 — 판정이 King 격파가 아니라 전멸로 나는지
  const config = rockLesson();
  config.rosters.P2 = [{ ...BANDIT, officer: banditOfficerId('Queen'), piece: 'Queen' }];
  let s = advanceTime(createBattle(config)).state;
  s = apply(s, 'P1', { t: 'move', to: { x: 4, y: 3 } }).state;
  s = apply(s, 'P1', { t: 'attack', targets: [U('P2-Queen')] }).state;
  assert.equal(s.outcome, 'wipeOut');
  assert.equal(s.winner, 'P1');
});

test('진영 SP 시작값 — setup.startSp가 정한다(상한 안에서)', () => {
  const s = createBattle(rockLesson({ startSp: { P1: 3 } }));
  assert.equal(s.sp.P1, 3);
  assert.equal(s.sp.P2, 0);
  const capped = createBattle(rockLesson({ startSp: { P1: 999 } }));
  assert.equal(capped.sp.P1, capped.spCap.P1);
});

test('튜토리얼 판에는 군량고가 없고, 진영은 판 전체다', () => {
  const s = createBattle(rockLesson());
  assert.equal(supplyDepotOf(s, 'P1'), null);
  assert.equal(supplyDepotOf(s, 'P2'), null);
  assert.deepEqual(deployZoneOf(s, 'P1'), { x0: 0, x1: 8, y0: 0, y1: 8 });
});

test('잘못 적은 setup은 판이 열리는 순간 던진다', () => {
  const { setup: _, ...bare } = rockLesson();
  assert.throws(() => createBattle(bare), /setup/);
  assert.throws(() => createBattle(rockLesson({ positions: { P1: [], P2: [{ x: 5, y: 2 }] } })), /자리 0개/);
  assert.throws(() => createBattle(rockLesson({ positions: { P1: [{ x: 9, y: 0 }], P2: [{ x: 5, y: 2 }] } })), /판 밖/);
  assert.throws(() => createBattle(rockLesson({ positions: { P1: [{ x: 5, y: 2 }], P2: [{ x: 5, y: 2 }] } })), /겹친다/);
  assert.throws(() => createBattle(rockLesson({ overrides: { P2: [{ hp: 11 }] } })), /HP 11/);
  assert.throws(() => createBattle(rockLesson({ overrides: { P2: [{ hp: 0 }] } })), /HP 0/);
});

test('대전은 그대로 — King 필수 검사가 튜토리얼에만 풀린다', () => {
  assert.throws(() => createBattle({
    matchId: 'x', seed: 1, mode: '3v3',
    rosters: {
      P1: [R('son-gyeon', 'Rock'), R('gwan-u', 'Queen'), R('jo-sik', 'Pawn')],
      P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
    },
  }), /King은 필수/);
});
