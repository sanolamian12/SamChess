/**
 * 일기토 · 설전 AI — 엔진 단계 2 (GDD §3.11, 설계서 §3-6 · §8 단계 2)
 *
 * 판: 관우(P1 Rock · 무 98 · 지 80) ↔ 장합(P2 Bishop · 무 90 · 지 62)이 좌우로 붙어 있다(`duel.test.ts`와 같은 판).
 * 관우는 거는 종류에 맞는 기물(일기토 Knight · 설전 Bishop, R25)을 쥐고 선다 — `duel.test.ts`와 같은 수법.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, createBattle } from '../src/battle.ts';
import { autoBattle, takeTurn } from '../src/ai.ts';
import { autoDuel, chooseAnswer, chooseChallenge, duelExpectation, shouldFlee } from '../src/duelAi.ts';
import { DUEL_CHALLENGER_PIECE, gaugeOf } from '../src/duel.ts';
import { legalMovesFor } from '../src/state.ts';
import type { BattleState, DuelKind, Intent, Side } from '../src/types.ts';
import { R, U, battle, giveControl, place } from './fixtures.ts';

const ROCK = U('P1-Rock');
const BISHOP = U('P2-Bishop');

function setup(at: Record<string, { x: number; y: number }> = {}, who = ROCK, kind: DuelKind = 'duel'): BattleState {
  const s = giveControl(place(battle(), {
    'P1-Rock': { x: 10, y: 10 }, 'P2-Bishop': { x: 11, y: 10 },
    'P1-King': { x: 2, y: 2 }, 'P1-Pawn': { x: 2, y: 6 },
    'P2-King': { x: 22, y: 17 }, 'P2-Queen': { x: 18, y: 17 },
    ...at,
  }), who);
  s.sp = { P1: 5, P2: 5 };
  (s.units[ROCK] as { piece: string }).piece = DUEL_CHALLENGER_PIECE[kind];
  return s;
}
const go = (s: BattleState, side: Side, intent: Intent): BattleState => apply(s, side, intent).state;

test('신청 — 이길 만한 상대에게만 건다 (깎인 적 · 센 나)', () => {
  // 맞수(2타 대 2타)는 받는 쪽이 유리하다 — 걸지 않는다
  assert.equal(chooseChallenge(setup()), undefined);
  // 장합의 전의가 깎여 있으면(한 대면 0) 일기토를 건다
  const hurt = setup();
  hurt.units[BISHOP]!.morale = 40;
  assert.deepEqual(chooseChallenge(hurt), { t: 'challenge', kind: 'duel', target: BISHOP });
  // 걸 수 없는 처지(이동 뒤)면 아무것도
  const moved = go(hurt, 'P1', { t: 'move', to: legalMovesFor(hurt, ROCK)[0]! });
  assert.equal(chooseChallenge(moved), undefined);
});

test('수락 — 받는 쪽은 공격권을 쥐어 웬만하면 받고, 걸린 것이 싸고 질 판이면 거절해 부상을 피한다', () => {
  // 꽉 찬 맞수끼리 — 받는 쪽이 유리하다(32 : 50)
  const even = go(setup(), 'P1', { t: 'challenge', kind: 'duel', target: BISHOP });
  assert.deepEqual(chooseAnswer(even), { t: 'answerChallenge', accept: true });

  // 장합 전의 40(한 대면 0)이어도 공격권을 쥐고 시작해 41 : 52 — 받는 편이 확실한 SP ±1(값 −2)보다 낫다
  const hurt = setup();
  hurt.units[BISHOP]!.morale = 40;
  const offered = go(hurt, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP });
  const e = duelExpectation(offered, BISHOP, ROCK, 'duel')!;
  assert.ok(e.value > -2, `받기 ${e.value.toFixed(2)}`);
  assert.deepEqual(chooseAnswer(offered), { t: 'answerChallenge', accept: true });

  // 설전 — 장합 정신력 40(한 번 맞으면 0), 걸린 것은 Lv1의 MP(책략이 없어 값이 작다) → 거절해 부상을 피한다
  const weak = setup({}, ROCK, 'debate');
  weak.units[BISHOP]!.mental = 40;
  const debate = go(weak, 'P1', { t: 'challenge', kind: 'debate', target: BISHOP });
  assert.deepEqual(chooseAnswer(debate), { t: 'answerChallenge', accept: false });
});

test('도망 — 상대가 공격권을 쥐고 한 대면 내가 0일 때 · 계속이 더 나으면 버틴다', () => {
  let s = go(go(setup(), 'P1', { t: 'challenge', kind: 'duel', target: BISHOP }), 'P2', { t: 'answerChallenge', accept: true });
  assert.equal(shouldFlee(s, 'P1'), false, '처음 — 둘 다 꽉 찼다');
  // 관우가 이미 깎여 100에서 — 장합(공격권)이 한 번 이긴다 → 관우 전의 10, 공격권은 여전히 장합
  s.units[ROCK]!.morale = 100;
  s = apply(go(go(s, 'P1', { t: 'duelPick', pick: 'rock' }), 'P2', { t: 'duelPick', pick: 'paper' }), 'P1', { t: 'duelReveal' }).state;
  assert.equal(gaugeOf(s.units[ROCK]!, 'duel'), 10);
  assert.equal(shouldFlee(s, 'P1'), true, '다음 합에 1/3로 0 — 공격권을 되찾아 두 번 이겨야 한다');
  assert.equal(shouldFlee(s, 'P2'), false);
});

test('autoDuel — 열린 대결을 끝까지 두고 차례를 신청자에게 돌려준다 · 같은 시드 → 같은 판', () => {
  const hurt = setup();
  hurt.units[BISHOP]!.morale = 40;
  const offered = go(hurt, 'P1', { t: 'challenge', kind: 'duel', target: BISHOP });
  const a = autoDuel(offered);
  const b = autoDuel(offered);
  assert.deepEqual(a.state, b.state);
  assert.equal(a.state.phase, 'control');
  assert.equal(a.state.activeUnit, ROCK);
  assert.ok(a.events.some((e) => e.e === 'duelEnded'));
});

test('takeTurn — 기본은 걸지 않는다(사람과 두는 AI 대전은 단계 3에서 켠다) · 켜면 걸고 대결 단계에서 멈춘다', () => {
  const hurt = setup();
  hurt.units[BISHOP]!.morale = 40;
  const plain = takeTurn(hurt);
  assert.ok(!plain.events.some((e) => e.e === 'challengeOffered'));

  const on = takeTurn(hurt, { duels: true });
  assert.equal(on.state.phase, 'duel');
  assert.deepEqual(on.events.filter((e) => e.e === 'challengeOffered').length, 1);

  // 대결이 끝나면 다시 불러 차례를 이어 간다 — 이번에는 걸지 않고 이동 · 공격 · 끝내기로
  const after = autoDuel(on.state).state;
  const rest = takeTurn(after, { duels: true });
  assert.ok(!rest.events.some((e) => e.e === 'challengeOffered'));
  assert.ok(rest.events.some((e) => e.e === 'turnEnded'), '차례가 닫힌다');
});

/** 3v3 · 5v5 판 */
function make(mode: '3v3' | '5v5', seed: number): BattleState {
  if (mode === '3v3') return battle(seed);
  return createBattle({
    matchId: 'ai5', seed, mode,
    rosters: {
      P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'), R('jang-bi', 'Knight'), R('je-gal-ryang', 'Bishop')],
      P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen'), R('yeo-po', 'Rock'), R('go-ram', 'Pawn')],
    },
  });
}

test('autoBattle — 대결이 든 자동 대전이 끝까지 가고 같은 시드면 같은 판이다', () => {
  for (const mode of ['3v3', '5v5'] as const) {
    for (let seed = 1; seed <= 4; seed++) {
      const first = autoBattle(make(mode, seed));
      assert.equal(first.state.phase, 'finished');
      assert.deepEqual(first.state, autoBattle(make(mode, seed)).state, `${mode} 시드 ${seed}`);
    }
  }
});

test('autoBattle — 대결을 끄면 신청도 회복 정산도 없다', () => {
  const r = autoBattle(battle(7), { duels: false });
  assert.ok(!r.state.log.some((e) => e.e === 'challengeOffered'));
  assert.ok(!r.state.log.some((e) => e.e === 'gaugeChanged'));
});

test('autoDuel의 패는 시드 난수 — 판 여럿을 두면 세 가지가 다 나온다', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 30 && seen.size < 6; seed++) {
    for (const e of autoBattle(make(seed % 2 ? '3v3' : '5v5', seed)).state.log) {
      if (e.e === 'duelRound') for (const p of Object.values(e.picks)) seen.add(String(p));
    }
  }
  assert.ok(['rock', 'paper', 'scissors'].every((p) => seen.has(p)) || ['1', '2', '3'].every((p) => seen.has(p)),
    `나온 패: ${[...seen].join(' ')}`);
});
