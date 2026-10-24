/**
 * 튜토리얼 판 회귀 — `scenario: 'tutorial'` + `ScenarioSetup` (Design/튜토리얼_시나리오_초안.md)
 *
 * 판 크기 · 자리 · 시작 HP/MP/WT/SP를 데이터가 정하고, King 없이도 서고, 배치 · 정찰 없이 곧장 시간이 흐른다.
 * 승패는 대전과 같은 `checkEnd`(King 격파 또는 전멸)다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { advanceTime, apply, createBattle, legalMovesFor, legalTargetsFor } from '../src/battle.ts';
import { checkGoals, deployZoneOf, supplyDepotOf } from '../src/state.ts';
import { banditOfficerId } from '../src/raid.ts';
import type { BattleConfig, BattleEvent, BattleState, RosterEntry, ScenarioGoals, ScenarioSetup } from '../src/types.ts';
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

// ── 판의 목표 (S급 튜토리얼, 2026-10-24) ───────────────────────────

/** 손견 Rock 하나 vs 도적 둘(HP 넉넉히) — 목표만 바꿔 끼운다 */
const goalLesson = (goals: ScenarioGoals): BattleConfig => ({
  matchId: 'goal-test', seed: 1, mode: '3v3', scenario: 'tutorial',
  rosters: {
    P1: [R('son-gyeon', 'Rock')],
    P2: [{ ...BANDIT, officer: banditOfficerId('Queen'), piece: 'Queen' }, { ...BANDIT, officer: banditOfficerId('Rock'), piece: 'Rock' }],
  },
  setup: {
    board: { x: 9, y: 9 },
    positions: { P1: [{ x: 4, y: 7 }], P2: [{ x: 5, y: 2 }, { x: 0, y: 0 }] },
    overrides: { P1: [{ wt: 0 }] },
    goals,
  },
});

/** 상태를 손으로 고치고 목표를 본다 — 판정만 떼어 본다 */
function judge(s: BattleState, edit: (t: BattleState) => void): BattleState {
  const t = structuredClone(s);
  edit(t);
  const events: BattleEvent[] = [];
  checkGoals(t, events);
  return t;
}

test('목표 없는 튜토리얼 판은 대전과 같다 — checkGoals가 아무것도 안 한다', () => {
  const s = createBattle(rockLesson());
  assert.equal(judge(s, () => {}).phase, 'running');
});

test('killTarget · killCount — 지정 적을 · N명을 쓰러뜨리면 P1이 이긴다(목표 달성)', () => {
  const base = createBattle(goalLesson({ win: [{ kind: 'killTarget', unit: U('P2-Queen') }] }));
  const other = judge(base, (t) => { t.units[U('P2-Rock')]!.alive = false; });
  assert.equal(other.phase, 'running', '다른 적은 목표가 아니다');
  const won = judge(base, (t) => { t.units[U('P2-Queen')]!.alive = false; });
  assert.deepEqual([won.winner, won.outcome], ['P1', 'objective']);

  const two = createBattle(goalLesson({ win: [{ kind: 'killCount', count: 2 }] }));
  assert.equal(judge(two, (t) => { t.units[U('P2-Queen')]!.alive = false; }).phase, 'running');
});

test('hpBelow — 지정 적의 HP가 기준 % 이하가 되는 수에서 끝난다(쓰러뜨리지 않아도)', () => {
  const s = createBattle(goalLesson({ win: [{ kind: 'hpBelow', unit: U('P2-Queen'), pct: 50 }] }));
  assert.equal(judge(s, (t) => { t.units[U('P2-Queen')]!.hp = 6; }).phase, 'running', '최대 10의 60%');
  const half = judge(s, (t) => { t.units[U('P2-Queen')]!.hp = 5; });
  assert.deepEqual([half.winner, half.outcome, half.units[U('P2-Queen')]!.alive], ['P1', 'objective', true]);
});

test('hpBelow — 실제 공격 한 번이 목표를 이루면 그 수(apply)에서 판이 끝난다', () => {
  let s = advanceTime(createBattle(goalLesson({ win: [{ kind: 'hpBelow', unit: U('P2-Queen'), pct: 90 }] }))).state;
  s = apply(s, 'P1', { t: 'move', to: { x: 4, y: 3 } }).state;
  const r = apply(s, 'P1', { t: 'attack', targets: [U('P2-Queen')] });
  assert.equal(r.state.outcome, 'objective');
  assert.ok(r.events.some((e) => e.e === 'battleEnded'), '끝을 알리는 이벤트가 그 수에 실린다');
  assert.equal(r.state.log.at(-1)?.e, 'phaseChanged', '로그에도 같은 순서로 남는다');
});

test('reach — 지정 아군이 구역에 제 손으로 서면 이긴다, 조종당한 채면 아니다', () => {
  const area = { x0: 0, x1: 8, y0: 0, y1: 1 };
  const s = createBattle(goalLesson({ win: [{ kind: 'reach', unit: U('P1-Rock'), area }] }));
  assert.equal(judge(s, (t) => { t.units[U('P1-Rock')]!.pos = { x: 4, y: 2 }; }).phase, 'running');
  assert.equal(judge(s, (t) => { t.units[U('P1-Rock')]!.pos = { x: 4, y: 1 }; }).winner, 'P1');
  const pushed = judge(s, (t) => {
    const u = t.units[U('P1-Rock')]!;
    u.pos = { x: 4, y: 1 };
    u.control = { by: U('P2-Queen'), mode: 'moveOnly', uses: 1 };
  });
  assert.equal(pushed.phase, 'running', '「유인」으로 끌려 들어간 것은 도착이 아니다');
});

test('survive · timeUp — 시각에 닿으면 이기거나 진다', () => {
  const live = createBattle(goalLesson({ win: [{ kind: 'survive', until: 300 }] }));
  assert.equal(judge(live, (t) => { t.time = 299; }).phase, 'running');
  assert.equal(judge(live, (t) => { t.time = 300; }).winner, 'P1');
  const late = createBattle(goalLesson({ lose: [{ kind: 'timeUp', at: 300 }] }));
  const lost = judge(late, (t) => { t.time = 300; });
  assert.deepEqual([lost.winner, lost.outcome], ['P2', 'objective']);
});

test('convert · unitLost — 영구 조종(삼고초려)은 「얻었다」 · 「잃었다」다. 횟수가 있는 조종은 아니다', () => {
  const win = createBattle(goalLesson({ win: [{ kind: 'convert', unit: U('P2-Queen') }] }));
  const charmed = judge(win, (t) => { t.units[U('P2-Queen')]!.control = { by: U('P1-Rock'), mode: 'moveAndAttack', uses: 1 }; });
  assert.equal(charmed.phase, 'running', '「초선」 한 번 부리기는 전향이 아니다');
  const converted = judge(win, (t) => { t.units[U('P2-Queen')]!.control = { by: U('P1-Rock'), mode: 'moveAndAttack', uses: null }; });
  assert.equal(converted.winner, 'P1');

  const keep = createBattle(goalLesson({ lose: [{ kind: 'unitLost', unit: U('P1-Rock') }] }));
  const taken = judge(keep, (t) => { t.units[U('P1-Rock')]!.control = { by: U('P2-Queen'), mode: 'moveAndAttack', uses: null }; });
  assert.deepEqual([taken.winner, taken.outcome], ['P2', 'objective'], '1:1에서 조조가 넘어가면 판이 멈추는 대신 진다');
  assert.equal(judge(keep, (t) => { t.units[U('P1-Rock')]!.alive = false; }).winner, 'P2');
});

test('지는 쪽을 먼저 본다 — 같은 수에 둘이 겹치면 잃은 것이 먼저다', () => {
  const s = createBattle(goalLesson({
    win: [{ kind: 'killTarget', unit: U('P2-Queen') }],
    lose: [{ kind: 'timeUp', at: 100 }],
  }));
  const both = judge(s, (t) => { t.units[U('P2-Queen')]!.alive = false; t.time = 100; });
  assert.equal(both.winner, 'P2');
});
