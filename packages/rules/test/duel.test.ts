/**
 * 일기토 · 설전 — 엔진 단계 1 (GDD §3.11, `Design/일기토_설전_설계.md` §1 R1 ~ R24 · §8 단계 1의 확인 목록)
 *
 * 판: 관우(P1 Rock · 무 98 · 지 80) ↔ 장합(P2 Bishop · 무 90 · 지 62)이 좌우로 붙어 있고, 관우의 차례다.
 * 관우가 걸면 받는 쪽 장합이 공격권을 쥐고 시작한다(R7).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceTime, apply, createBattle, validate } from '../src/battle.ts';
import { challengeTargets, commandsFor } from '../src/commands.ts';
import { REFEREE_INTENTS, duelForecast, duelOdds, gaugeOf } from '../src/duel.ts';
import { forecastAttack, officerStats, legalTargetsFor } from '../src/state.ts';
import { countFallen, countWounded } from '../src/replay.ts';
import { DUEL_ROUNDS, TIMING_INVARIANTS } from '../src/timing.ts';
import { toWire } from '../src/wire.ts';
import { FORMULA, type BattleEvent, type BattleState, type DuelPick, type Intent, type RosterEntry, type Side } from '../src/types.ts';
import { R, U, battle, giveControl, place } from './fixtures.ts';

const ROCK = U('P1-Rock');     // 관우
const BISHOP = U('P2-Bishop'); // 장합

/** 관우 차례 · 장합이 오른쪽에 붙어 있다. SP는 상한(15)에서 떨어진 5 · 5 */
function setup(at: Record<string, { x: number; y: number }> = {}, base = battle()): BattleState {
  const s = giveControl(place(base, {
    'P1-Rock': { x: 10, y: 10 }, 'P2-Bishop': { x: 11, y: 10 },
    'P1-King': { x: 2, y: 2 }, 'P1-Pawn': { x: 2, y: 6 },
    'P2-King': { x: 22, y: 17 }, 'P2-Queen': { x: 18, y: 17 },
    ...at,
  }), ROCK);
  s.sp = { P1: 5, P2: 5 };
  return s;
}

function go(s: BattleState, side: Side, intent: Intent): BattleState {
  return apply(s, side, intent).state;
}

/** 수락까지 */
function open(kind: 'duel' | 'debate', s = setup()): BattleState {
  return go(go(s, 'P1', { t: 'challenge', kind, target: BISHOP }), 'P2', { t: 'answerChallenge', accept: true });
}

/** 한 합 — 양쪽이 내고 판정 주체가 연다 */
function round(s: BattleState, p1: DuelPick, p2: DuelPick): { state: BattleState; events: BattleEvent[] } {
  return apply(go(go(s, 'P1', { t: 'duelPick', pick: p1 }), 'P2', { t: 'duelPick', pick: p2 }), 'P1', { t: 'duelReveal' });
}

const reason = (s: BattleState, side: Side, intent: Intent): string => {
  const v = validate(s, side, intent);
  return v.ok ? 'ok' : v.reason;
};

// ── 신청 (R1 · R3 · R5 · R20 · R21 · R23) ─────────────────────────

test('R1 — 상하좌우로 붙은 적에게만 건다 (대각선 · 떨어진 적은 아니다)', () => {
  assert.equal(reason(setup(), 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), 'ok');
  assert.match(reason(setup({ 'P2-Bishop': { x: 11, y: 11 } }), 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), /상하좌우/);
  assert.match(reason(setup({ 'P2-Bishop': { x: 12, y: 10 } }), 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), /상하좌우/);
  assert.match(reason(setup(), 'P1', { t: 'challenge', kind: 'duel', target: U('P1-King') }), /적에게만/);
});

test('화면이 묻는 것 — 걸 수 있는 적 · 명령의 켜짐이 검증과 같다', () => {
  assert.deepEqual(challengeTargets(setup(), 'P1', 'duel'), [BISHOP]);
  assert.deepEqual(challengeTargets(setup({ 'P2-Bishop': { x: 11, y: 11 } }), 'P1', 'duel'), []);
  assert.deepEqual(challengeTargets(setup(), 'P2', 'duel'), [], '내 차례가 아니면 없다');
  const c = commandsFor(setup(), 'P1')!;
  assert.equal(c.duel, true);
  assert.equal(c.debate, true);
  assert.equal(commandsFor(setup({ 'P2-Bishop': { x: 15, y: 10 } }), 'P1')!.duel, false);
});

test('R23 · R3 — 이동 · 행동 전에만, 고유기술과 셋 중 하나만', () => {
  const moved = go(setup(), 'P1', { t: 'move', to: { x: 10, y: 11 } });
  assert.match(reason(moved, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), /이동 · 행동 전/);

  const used = setup();
  used.activeTurn!.usedUniqueSkill = true;
  assert.match(reason(used, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), /이미 고유기술이나 대결/);

  // 대결을 걸고 끝난 뒤 — 고유기술 · 다른 대결은 안 되고, 이동 · 공격 · 명상은 된다(R17)
  const after = go(go(setup(), 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), 'P2', { t: 'answerChallenge', accept: false });
  after.sp.P1 = 15;
  assert.equal(after.phase, 'control');
  assert.equal(after.activeUnit, ROCK, '신청자의 차례가 이어진다');
  assert.match(reason(after, 'P1', { t: 'castUniqueSkill' }), /일기토 · 설전을 걸었다/);
  assert.match(reason(after, 'P1', { t: 'challenge', kind: 'debate', target: BISHOP }), /이미 고유기술이나 대결/);
  assert.equal(reason(after, 'P1', { t: 'move', to: { x: 10, y: 11 } }), 'ok');
  assert.equal(reason(after, 'P1', { t: 'endTurn' }), 'ok');
});

test('R5 — 진영마다 종류당 한 번, 거절당해도 쓴 것이다. 다른 종류는 남는다', () => {
  let s = go(go(setup(), 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), 'P2', { t: 'answerChallenge', accept: false });
  assert.deepEqual(s.duelUsed, { P1: { duel: true } });
  // 다음 차례 — 같은 장수든 다른 장수든 일기토는 막히고 설전은 된다
  s = giveControl(s, ROCK);
  assert.match(reason(s, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), /이미 신청/);
  assert.equal(reason(s, 'P1', { t: 'challenge', kind: 'debate', target: BISHOP }), 'ok');
  // 상대 진영의 신청권은 그대로다
  const theirs = giveControl(s, BISHOP);
  assert.equal(reason(theirs, 'P2', { t: 'challenge', kind: 'duel', target: ROCK }), 'ok');
});

test('R20 — 도적떼 · 튜토리얼 판에는 대결도 SP MAX 버프도 없다. 공성전에는 있다', () => {
  for (const scenario of ['raid', 'tutorial'] as const) {
    const s = setup();
    (s as { scenario?: string }).scenario = scenario;
    assert.match(reason(s, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), /일기토 · 설전이 없다/);
    assert.equal(commandsFor(s, 'P1')!.duel, false);
    s.sp.P1 = s.spCap.P1;
    const f = forecastAttack(s, ROCK, BISHOP)!;
    s.sp.P1 = 0;
    assert.deepEqual(forecastAttack(s, ROCK, BISHOP), f, `${scenario}: 상한이어도 버프가 없다`);
  }
  const siege = setup();
  (siege as { scenario?: string }).scenario = 'siege';
  assert.equal(reason(siege, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), 'ok');
});

test('R21 — 조종당한 장수 · 빠진 장수에게는 못 건다. 시전 중인 장수에게는 건다', () => {
  const controlled = setup();
  controlled.units[BISHOP]!.control = { by: ROCK, mode: 'moveAndAttack', uses: 1 };
  assert.match(reason(controlled, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), /조종당하는 장수/);

  const benched = setup();
  benched.units[BISHOP]!.duelBenched = { duel: true };
  assert.match(reason(benched, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), /빠져 있다/);
  assert.equal(reason(benched, 'P1', { t: 'challenge', kind: 'debate', target: BISHOP }), 'ok', '빠진 것은 그 종류뿐이다');

  const self = setup();
  self.units[ROCK]!.duelBenched = { duel: true };
  assert.match(reason(self, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), /게이지가 다 차기 전/);

  const casting = setup();
  casting.units[BISHOP]!.casting = 'x' as never;
  assert.equal(reason(casting, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), 'ok');
});

// ── 받는 쪽 (R10 ① · R18) ─────────────────────────────────────

test('신청하면 대결 단계 — 받는 쪽만 답하고, 그 밖의 수는 막힌다', () => {
  const s = go(setup(), 'P1', { t: 'challenge', kind: 'duel', target: BISHOP });
  assert.equal(s.phase, 'duel');
  assert.equal(s.duel!.holder, BISHOP, '처음 공격권은 받는 쪽 (R7)');
  assert.match(reason(s, 'P1', { t: 'answerChallenge', accept: true }), /받은 쪽만/);
  assert.match(reason(s, 'P2', { t: 'duelPick', pick: 'rock' }), /아직 합이/);
  assert.match(reason(s, 'P1', { t: 'move', to: { x: 10, y: 11 } }), /제어 단계가 아니다/);
  assert.match(reason(s, 'P2', { t: 'forceSkipTurn' }), /제어 단계가 아니다/);
});

test('R10 ① 거절 — 건 쪽의 승리, 보상이 나가고 아무도 안 다친다', () => {
  const r = apply(go(setup(), 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), 'P2', { t: 'answerChallenge', accept: false });
  assert.deepEqual(r.state.sp, { P1: 6, P2: 4 });
  assert.ok(r.events.some((e) => e.e === 'duelEnded' && e.reason === 'refused' && e.winner === 'P1'));
  assert.equal(r.state.duel, undefined);
  assert.equal(r.state.units[BISHOP]!.injured, undefined);
  assert.equal(gaugeOf(r.state.units[BISHOP]!, 'duel'), 100);
});

test('R18 · R19 — 무응답은 수락 + AI 대리, 패를 내면 되찾는다. 안 낸 패는 판정 주체가 채운다', () => {
  let s = go(go(setup(), 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), 'P1', { t: 'duelAnswerTimeout' });
  assert.equal(s.duel!.step, 'round');
  assert.deepEqual(s.duel!.auto, { P2: true });
  assert.match(reason(s, 'P1', { t: 'duelReveal' }), /패가 없다/);

  s = go(s, 'P1', { t: 'duelPick', pick: 'rock' });
  const r = apply(s, 'P1', { t: 'duelReveal', fill: { P2: 'rock' } });
  const ev = r.events.find((e) => e.e === 'duelRound')!;
  assert.ok(ev.e === 'duelRound' && ev.result === 'tie');
  assert.deepEqual(ev.e === 'duelRound' && ev.auto, ['P2']);

  // 받는 쪽이 아무 패나 누르면 대리가 풀린다
  const back = go(r.state, 'P2', { t: 'duelPick', pick: 'paper' });
  assert.deepEqual(back.duel!.auto, {});
  // 내가 낸 패는 채움이 덮지 않는다
  const kept = apply(go(back, 'P1', { t: 'duelPick', pick: 'scissors' }), 'P1', { t: 'duelReveal', fill: { P2: 'rock', P1: 'rock' } });
  const ev2 = kept.events.find((e) => e.e === 'duelRound')!;
  assert.deepEqual(ev2.e === 'duelRound' && ev2.picks, { P1: 'scissors', P2: 'paper' });
  assert.deepEqual(ev2.e === 'duelRound' && ev2.auto, []);
});

test('패 검사 — 일기토는 손, 설전은 1 ~ 3', () => {
  assert.match(reason(open('duel'), 'P1', { t: 'duelPick', pick: 2 }), /낼 수 없는 패/);
  assert.match(reason(open('debate'), 'P1', { t: 'duelPick', pick: 'rock' }), /낼 수 없는 패/);
  assert.equal(reason(open('debate'), 'P2', { t: 'duelPick', pick: 3 }), 'ok');
});

// ── 공격권 (R7) · 결말 (R10 · R11 · R12) ─────────────────────────

test('일기토 R7 — 공격권 쪽이 이기면 깎고 쥐고, 다른 쪽이 이기면 공격권만, 비김은 아무 일 없다 → 0이면 승리', () => {
  let s = open('duel');
  // 비김
  let r = round(s, 'rock', 'rock');
  assert.ok(r.events.some((e) => e.e === 'duelRound' && e.result === 'tie' && e.damage === 0));
  assert.equal(r.state.duel!.holder, BISHOP);
  // 장합(공격권)이 이긴다 → 관우 전의 − 장합 무력 90
  r = round(r.state, 'rock', 'paper');
  assert.equal(gaugeOf(r.state.units[ROCK]!, 'duel'), 10);
  assert.equal(r.state.duel!.holder, BISHOP, '공격권을 쥔 채다');
  // 관우가 이긴다 → 공격권만 넘어온다
  r = round(r.state, 'scissors', 'paper');
  assert.equal(r.state.duel!.holder, ROCK);
  assert.equal(gaugeOf(r.state.units[BISHOP]!, 'duel'), 100, '공격권을 뺏는 합에는 피해가 없다');
  // 관우(공격권)가 두 번 이긴다 → 100 − 98 = 2 → 0
  r = round(r.state, 'rock', 'scissors');
  assert.equal(gaugeOf(r.state.units[BISHOP]!, 'duel'), 2);
  r = round(r.state, 'paper', 'rock');
  s = r.state;
  assert.equal(gaugeOf(s.units[BISHOP]!, 'duel'), 0);
  assert.ok(r.events.some((e) => e.e === 'duelEnded' && e.reason === 'zero' && e.winner === 'P1'));
  assert.deepEqual(s.sp, { P1: 6, P2: 4 }, '3v3 일기토 승 — SP ±1 (R12)');
  assert.equal(s.phase, 'control');
  assert.equal(s.activeUnit, ROCK);
  assert.equal(gaugeOf(s.units[ROCK]!, 'duel'), 10, '이긴 쪽의 깎인 게이지도 남는다 (R9)');
});

test('설전 R7 — 맞으면 공격권 쪽이 깎고, 틀리면 공격권이 넘어간다. 이기면 전원 MP ±2 (R13)', () => {
  let s = open('debate');
  for (const u of Object.values(s.units)) u.mp = u.side === 'P1' ? 1 : 3;
  let r = round(s, 2, 2);   // 장합(공격권) 맞힘 → 관우 정신력 − 62
  assert.equal(gaugeOf(r.state.units[ROCK]!, 'debate'), 38);
  r = round(r.state, 1, 3); // 틀림 → 공격권이 관우에게
  assert.equal(r.state.duel!.holder, ROCK);
  r = round(r.state, 3, 3); // 관우 맞힘 → 100 − 80 = 20
  r = round(r.state, 1, 1); // → 0
  s = r.state;
  assert.equal(gaugeOf(s.units[BISHOP]!, 'debate'), 0);
  for (const u of Object.values(s.units)) assert.equal(u.mp, u.side === 'P1' ? 3 : 1, `${u.id} MP`);
  assert.ok(r.events.some((e) => e.e === 'mpChanged' && e.reason === 'debate'));
  assert.deepEqual(s.sp, { P1: 5, P2: 5 }, '설전은 SP를 안 건드린다');
});

test('R10 ② 도망 — 언제든, 상대의 승리. 도망한 쪽은 안 다친다', () => {
  const s = round(open('duel'), 'rock', 'paper').state;   // 관우 전의 10
  const r = apply(s, 'P1', { t: 'duelFlee' });
  assert.ok(r.events.some((e) => e.e === 'duelFled' && e.unit === ROCK));
  assert.ok(r.events.some((e) => e.e === 'duelEnded' && e.reason === 'fled' && e.winner === 'P2'));
  assert.deepEqual(r.state.sp, { P1: 4, P2: 6 });
  assert.equal(r.state.units[ROCK]!.injured, undefined);
  assert.equal(gaugeOf(r.state.units[ROCK]!, 'duel'), 10);
});

test('R8 · R14 — 10합에 결판이 없으면 일기토는 양쪽 SP +1, 설전은 양쪽 전원 MP +1', () => {
  let s = open('duel');
  for (let i = 0; i < DUEL_ROUNDS; i++) s = round(s, 'rock', 'rock').state;
  assert.equal(s.phase, 'control');
  assert.deepEqual(s.sp, { P1: 6, P2: 6 });
  assert.ok(s.log.some((e) => e.e === 'duelEnded' && e.reason === 'cap' && e.winner === undefined));

  let d = open('debate');
  for (const u of Object.values(d.units)) u.mp = 2;
  for (let i = 0; i < DUEL_ROUNDS; i++) d = round(d, 1, 2).state;   // 늘 틀린다 → 공격권만 오간다
  for (const u of Object.values(d.units)) assert.equal(u.mp, 3, `${u.id} MP +1`);
});

test('SP · MP는 상한 · 바닥에서 자른다', () => {
  const s = setup();
  s.sp = { P1: 15, P2: 0 };
  const r = go(go(s, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), 'P2', { t: 'answerChallenge', accept: false });
  assert.deepEqual(r.sp, { P1: 15, P2: 0 });
  assert.ok(!r.log.some((e) => e.e === 'spChanged'), '안 바뀐 값은 이벤트도 없다');
});

test('R12 — 5v5 일기토 승은 SP ±2', () => {
  const five = createBattle({
    matchId: 't5', seed: 1, mode: '5v5',
    rosters: {
      P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'), R('jang-bi', 'Knight'), R('je-gal-ryang', 'Bishop')],
      P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen'), R('yeo-po', 'Rock'), R('go-ram', 'Pawn')],
    },
  });
  const s = setup({ 'P1-Knight': { x: 2, y: 9 }, 'P1-Bishop': { x: 2, y: 12 }, 'P2-Rock': { x: 22, y: 12 }, 'P2-Pawn': { x: 22, y: 8 } }, five);
  s.sp = { P1: 10, P2: 10 };
  const r = go(go(s, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), 'P2', { t: 'answerChallenge', accept: false });
  assert.deepEqual(r.sp, { P1: 12, P2: 8 });
});

// ── 게이지 0 — 빠짐 · 부상 (R11) ─────────────────────────────────

/** 장합을 일기토에서 0으로 만든다 (관우가 공격권을 뺏고 두 번 이긴다) */
function knockOut(s: BattleState, kind: 'duel' | 'debate' = 'duel'): { state: BattleState; events: BattleEvent[] } {
  const [a, b, c] = kind === 'duel' ? (['scissors', 'paper', 'rock'] as const) : ([1, 2, 3] as const);
  let st = open(kind, s);
  st = round(st, a, b).state;   // 관우가 공격권을 뺏는다(일기토: 가위 > 보, 설전: 틀림)
  let r = round(st, c, kind === 'duel' ? 'scissors' : 3);
  r = round(r.state, c, kind === 'duel' ? 'scissors' : 3);
  return r;
}

test('R11 — 0이 되면 퇴각하지 않고, 그 종류에서 빠지고, 다친다(일반 −10 + 무력 −10 더) · WT는 다음 차례부터 늦다', () => {
  const before = setup().units[BISHOP]!;
  const r = knockOut(setup());
  const u = r.state.units[BISHOP]!;
  assert.equal(u.alive, true, '퇴각 없음');
  assert.deepEqual(u.duelBenched, { duel: true });
  assert.equal(u.injured, true);
  assert.deepEqual(officerStats(u), { might: 70, intellect: 52, leadership: 78 }, '무 90−20 · 지 62−10 · 통 88−10');
  assert.equal(u.wtBase, before.wtBase + 10, '통솔 −10 → 기준값 +10');
  assert.equal(u.wt, before.wt, '지금 WT는 그대로 — 다음 차례부터');
  assert.ok(r.events.some((e) => e.e === 'duelWounded' && e.unit === BISHOP && e.hurt));
});

test('R11 — 설전에서 지면 지력이 10 더 깎인다', () => {
  const u = knockOut(setup(), 'debate').state.units[BISHOP]!;
  assert.deepEqual(officerStats(u), { might: 80, intellect: 42, leadership: 78 });
});

test('R11 — 부상은 겹치지 않는다: 다친 채 들어온 장수는 추가 −10만, 같은 종류에서 또 져도 한 번', () => {
  const hurt = battle(1, {
    P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), { ...R('jang-hap', 'Bishop'), injured: true }, R('heon-je', 'Queen')],
  });
  const before = setup({}, hurt).units[BISHOP]!;
  const s = knockOut(setup({}, hurt)).state;
  const u = s.units[BISHOP]!;
  assert.deepEqual(officerStats(u), { might: 70, intellect: 52, leadership: 78 });
  assert.equal(u.wtBase, before.wtBase, '통솔은 이미 깎여 있었다');

  // 게이지가 다 찬 뒤 다른 판처럼 또 진다(신청권을 지우고 다시 건다) — 무력은 여전히 −20
  const again = giveControl(s, ROCK);
  delete again.duelUsed;
  again.units[BISHOP]!.morale = 100;
  delete again.units[BISHOP]!.duelBenched;
  const twice = knockOut(again).state.units[BISHOP]!;
  assert.deepEqual(officerStats(twice), { might: 70, intellect: 52, leadership: 78 });
});

test('R11 — 헌제 · 청낭서를 든 장수는 빠지기만 하고 안 다친다', () => {
  // 헌제(P2 Queen)를 관우 옆에
  const emp = setup({ 'P2-Queen': { x: 10, y: 9 }, 'P2-Bishop': { x: 20, y: 10 } });
  let st = go(go(emp, 'P1', { t: 'challenge', kind: 'duel', target: U('P2-Queen') }), 'P2', { t: 'answerChallenge', accept: true });
  let r = round(st, 'rock', 'rock');
  for (let i = 0; r.state.phase === 'duel' && i < 9; i++) {
    // 헌제 무력 1 — 공격권을 뺏은 뒤 관우가 한 번 이기면 끝난다
    r = r.state.duel!.holder === ROCK ? round(r.state, 'rock', 'scissors') : round(r.state, 'scissors', 'paper');
  }
  const e = r.state.units[U('P2-Queen')]!;
  assert.deepEqual(e.duelBenched, { duel: true });
  assert.equal(e.injured, undefined);
  assert.ok(r.events.some((x) => x.e === 'duelWounded' && !x.hurt));

  const shielded = battle(1, {
    P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), { ...R('jang-hap', 'Bishop'), held: 'cheong-nang-seo' } as RosterEntry, R('heon-je', 'Queen')],
  });
  const u = knockOut(setup({}, shielded)).state.units[BISHOP]!;
  assert.deepEqual(u.duelBenched, { duel: true });
  assert.equal(u.injured, undefined);
  assert.deepEqual(officerStats(u), { might: 90, intellect: 62, leadership: 88 });
});

// ── 회복 (R24) ─────────────────────────────────────────────────

test('R24 — time 10마다 +5, 100에서 멈추고, 꽉 차면 빠짐이 풀린다. 제어 중에는 안 찬다', () => {
  const s = knockOut(setup()).state;
  assert.equal(gaugeOf(s.units[BISHOP]!, 'duel'), 0);
  // 제어 중 — 수를 둬도 시간이 안 흐르니 그대로
  const moved = go(s, 'P1', { t: 'move', to: { x: 10, y: 11 } });
  assert.equal(gaugeOf(moved.units[BISHOP]!, 'duel'), 0);

  let t = go(moved, 'P1', { t: 'endTurn' });
  const start = { time: t.time, morale: gaugeOf(t.units[BISHOP]!, 'duel') };
  t = advanceTime(t).state;
  const ticks = Math.floor(t.time / 10) - Math.floor(start.time / 10);
  assert.ok(ticks > 0, '시간이 흘렀다');
  assert.equal(gaugeOf(t.units[BISHOP]!, 'duel'), Math.min(100, start.morale + 5 * ticks));

  // 95에서 한 번 더 차면 100 — 빠짐이 풀린다
  const near = structuredClone(t);
  near.units[BISHOP]!.morale = 95;
  near.activeUnit = null; near.activeTurn = null; near.phase = 'running';
  for (const u of Object.values(near.units)) u.wt = Math.max(u.wt, 30);   // 다음 차례 전에 time 10을 꼭 지나게
  const full = advanceTime(near).state.units[BISHOP]!;
  assert.equal(gaugeOf(full, 'duel'), 100);
  assert.equal(full.duelBenched, undefined);
  assert.equal(full.injured, true, '부상은 판 끝까지 남는다');
});

test('R24 — 대결이 없던 판에는 회복 정산이 아예 없다(로그가 예전 그대로)', () => {
  let s = setup();
  s = go(s, 'P1', { t: 'endTurn' });
  for (let i = 0; i < 5 && s.phase !== 'finished'; i++) {
    s = advanceTime(s).state;
    if (s.phase === 'control') s = go(s, s.units[s.activeUnit!]!.side, { t: 'endTurn' });
  }
  assert.ok(!s.log.some((e) => e.e === 'gaugeChanged'));
});

// ── SP MAX 버프 (R15) ─────────────────────────────────────────

test('R15 — SP가 상한일 때만 공격 AT +1, 크리티컬은 (AT + 1) × 2 · 확인창과 실제가 같다', () => {
  const s = setup({ 'P2-Bishop': { x: 11, y: 11 } });
  const target = legalTargetsFor(s, ROCK).includes(BISHOP) ? BISHOP : legalTargetsFor(s, ROCK)[0]!;
  s.sp.P1 = s.spCap.P1 - 1;
  const plain = forecastAttack(s, ROCK, target)!;
  s.sp.P1 = s.spCap.P1;
  const buffed = forecastAttack(s, ROCK, target)!;
  assert.equal(buffed.normal, plain.normal + 1);
  assert.equal(buffed.critical, (2 + 1) * 2, 'AT 2 → (2 + 1) × 2');
  assert.equal(plain.critical, 2 * 2);

  const hit = apply(s, 'P1', { t: 'attack', targets: [target] }).events.find((e) => e.e === 'attacked')!;
  assert.ok(hit.e === 'attacked');
  assert.equal(hit.damage, hit.critical ? buffed.critical : buffed.normal);
  // 적의 버프는 내 공격에 안 붙는다
  s.sp = { P1: 0, P2: s.spCap.P2 };
  assert.deepEqual(forecastAttack(s, ROCK, target), plain);
});

// ── 전선 · 재현 ────────────────────────────────────────────────

test('전선은 상대 진영의 공개 전 패를 뗀다 — 내 것은 남는다', () => {
  const s = go(go(open('duel'), 'P1', { t: 'duelPick', pick: 'rock' }), 'P2', { t: 'duelPick', pick: 'paper' });
  assert.deepEqual(toWire(s, 'P1').duel!.picks, { P1: 'rock' });
  assert.deepEqual(toWire(s, 'P2').duel!.picks, { P2: 'paper' });
  assert.deepEqual(toWire(s).duel!.picks, { P1: 'rock', P2: 'paper' }, '관점이 없으면 그대로');
  const p = apply(open('duel'), 'P2', { t: 'duelPick', pick: 'paper' }).events;
  assert.deepEqual(p, [{ e: 'duelPicked', side: 'P2' }], '패를 냈다는 것만 — 무엇인지는 싣지 않는다');
});

test('같은 수 → 같은 판 (리플레이). 대결은 난수를 안 쓴다', () => {
  const play = (): BattleState => knockOut(setup()).state;
  const a = play();
  const b = play();
  assert.deepEqual(a, b);
  assert.equal(a.rngCursor, setup().rngCursor);
});

test('대결 중 항복 — 판이 끝나고 대결은 사라진다', () => {
  const s = go(open('duel'), 'P2', { t: 'surrender' });
  assert.equal(s.phase, 'finished');
  assert.equal(s.duel, undefined);
  assert.equal(s.winner, 'P1');
});

// ── 미리 재기 (설계서 §2-1 표) ─────────────────────────────────

test('확률 표 — 맞수끼리 32/50, 여포가 걸면 52/41, 설전 36/45 · 제갈량 60/34', () => {
  const pct = (o: { win: number; lose: number; draw: number }) => [o.win, o.lose, o.draw].map((x) => Math.round(x * 100));
  // duelOdds(종류, 내가 공격권, 내가 버틸 타격, 상대가 버틸 타격, 합)
  assert.deepEqual(pct(duelOdds('duel', false, 2, 2, 10)), [32, 50, 18]);
  assert.deepEqual(pct(duelOdds('duel', false, 2, 1, 10)), [52, 41, 7]);
  assert.deepEqual(pct(duelOdds('debate', false, 2, 2, 10)), [36, 45, 19]);
  assert.deepEqual(pct(duelOdds('debate', false, 2, 1, 10)), [60, 34, 6]);

  const f = duelForecast(setup(), ROCK, BISHOP, 'duel')!;
  assert.deepEqual([f.hitsToWin, f.hitsToLose, f.iHold, f.rounds], [2, 2, false, 10]);
  assert.deepEqual(pct(f), [32, 50, 18]);
  // 대결 중 — 공격권 · 남은 합을 따라간다
  const mid = round(round(open('duel'), 'rock', 'paper').state, 'scissors', 'paper').state;   // 관우 10 남음 · 공격권 관우 · 3합째
  const g = duelForecast(mid, ROCK, BISHOP, 'duel')!;
  assert.deepEqual([g.hitsToWin, g.hitsToLose, g.iHold, g.rounds], [2, 1, true, 8]);
});

test('시간 — 합 수가 엔진과 같고, 대결 하나는 재접속 유예 안에 든다', () => {
  assert.equal(DUEL_ROUNDS, FORMULA.duelRounds);
  for (const [name, holds] of TIMING_INVARIANTS) assert.ok(holds, name);
});

test('SP 상한 — 대전 · 공성전은 3v3 · 5v5 모두 15 (2026-11-05 기획자), 도적떼 · 튜토리얼은 제 인원 × 5', () => {
  const five = (scenario?: 'siege') => createBattle({
    matchId: 'cap', seed: 1, mode: '5v5', ...(scenario ? { scenario } : {}),
    rosters: {
      P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'), R('jang-bi', 'Knight'), R('je-gal-ryang', 'Bishop')],
      P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen'), R('yeo-po', 'Rock'), R('go-ram', 'Pawn')],
    },
  });
  assert.deepEqual(battle().spCap, { P1: 15, P2: 15 });
  assert.deepEqual(five().spCap, { P1: 15, P2: 15 });
  assert.deepEqual(five('siege').spCap, { P1: 15, P2: 15 });
  assert.equal(FORMULA.battleSpCap, 15);
});

test('계정 부상 — 대결로 다친 채 살아남은 장수를 따로 센다(쓰러진 장수와 별개) · 안 다치는 장수는 안 든다 (R11)', () => {
  const s = knockOut(setup()).state;
  assert.deepEqual(countWounded(s, 'P2'), ['jang-hap']);
  assert.deepEqual(countWounded(s, 'P1'), []);
  assert.deepEqual(countFallen(s, 'P2'), [], '퇴각은 아니다 — 결과 화면의 「퇴각」에는 안 든다');
  const shielded = battle(1, {
    P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), { ...R('jang-hap', 'Bishop'), held: 'cheong-nang-seo' } as RosterEntry, R('heon-je', 'Queen')],
  });
  assert.deepEqual(countWounded(knockOut(setup({}, shielded)).state, 'P2'), [], '청낭서');
});

// ── 단계 5 — 판정 주체 의도 (설계서 §3-5) ──

test('판정 주체만 넣는 의도는 둘이다 — 방 · AI 대전 서버가 이 목록 하나로 사람의 손을 거른다', () => {
  assert.deepEqual([...REFEREE_INTENTS].sort(), ['duelAnswerTimeout', 'duelReveal']);
});
