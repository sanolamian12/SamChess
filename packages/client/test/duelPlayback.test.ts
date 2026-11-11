/**
 * 일기토 · 설전 — 재생기의 두 걸음 (GDD §3.11, 설계서 §8 단계 3b)
 *
 * `Playback.submit()`은 받을 걸음이 아닌 의도를 **조용히 버린다**(CLAUDE.md 「조용히 무시하는 경로」). 대결은 상대 차례에
 * 내가 내는 의도(답 · 패 · 도망)가 처음으로 정상 흐름이 되는 자리라, 걸음이 없으면 단추가 눌려도 아무 일이 없다.
 *
 * 판: 장합(AI, P2 Bishop)의 차례 · 관우(사람, P1 Rock)가 옆에 붙어 있고 관우의 전의가 깎여 있다 → AI가 일기토를 건다.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DUEL_COUNT_MS, DUEL_FIRST_COUNT_MS, DUEL_INTRO_MS, createBattle } from '@samchess/rules';
import type { BattleState, OfficerId, PieceType, RosterEntry, UnitId } from '@samchess/rules';
import { LocalTransport } from '../src/battle/transport.ts';
import { Playback } from '../src/battle/playback.ts';

const R = (officer: string, piece: PieceType): RosterEntry => ({ officer: officer as OfficerId, piece, level: 1, statPicks: [], tactics: [] });
const U = (id: string): UnitId => id as UnitId;

function aiTurnNextToMe(): BattleState {
  const s = createBattle({
    matchId: 'duel-pb', seed: 3, mode: '3v3',
    rosters: { P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')], P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')] },
  });
  const pos: Record<string, { x: number; y: number }> = {
    'P1-Rock': { x: 10, y: 10 }, 'P2-Bishop': { x: 11, y: 10 }, 'P1-King': { x: 2, y: 2 }, 'P1-Pawn': { x: 2, y: 6 },
    'P2-King': { x: 22, y: 17 }, 'P2-Queen': { x: 18, y: 17 },
  };
  for (const [id, p] of Object.entries(pos)) s.units[U(id)]!.pos = p;
  s.units[U('P1-Rock')]!.morale = 40;   // 한 대면 0 — AI가 걸 만하다
  s.sp = { P1: 5, P2: 5 };   // 걸린 SP가 있어야 건다(0이면 이겨도 깎을 것이 없다)
  s.ready = { P1: true, P2: true };
  s.phase = 'control';
  s.activeUnit = U('P2-Bishop');
  s.activeTurn = { moved: false, acted: false, usedUniqueSkill: false };
  return s;
}

test('AI가 걸면 「답할 차례」, 받으면 「패를 낼 수 있음」 — 그 걸음에서만 대결 의도를 받는다', () => {
  const transport = new LocalTransport(aiTurnNextToMe(), 'P1', { now: () => 0 });
  const pb = new Playback(transport, { onChange: () => {}, onTick: () => {} }, { now: () => 0 });
  try {
    pb.start();
    assert.equal(pb.phase, 'aiThinking');
    pb.update(1_000);   // 상대의 수를 청한다 → AI가 건다
    assert.equal(pb.state.phase, 'duel');
    assert.equal(pb.phase, 'answering');
    assert.equal(pb.deadlineMs, 10_000, '응답 10초가 마감으로 온다');

    assert.equal(pb.submit({ t: 'endTurn' }), false, '답할 차례에 다른 수는 버려진다');
    assert.equal(pb.submit({ t: 'duelPick', pick: 'rock' }), false, '받기 전에는 패를 못 낸다');
    assert.equal(pb.submit({ t: 'answerChallenge', accept: true }), true);
    assert.equal(pb.phase, 'dueling');
    assert.equal(pb.deadlineMs, DUEL_INTRO_MS + DUEL_FIRST_COUNT_MS, '첫 합은 준비 17초 + 첫 카운트 3초');

    assert.equal(pb.submit({ t: 'answerChallenge', accept: true }), false, '이미 답했다');
    assert.equal(pb.submit({ t: 'duelPick', pick: 'paper' }), true);
    assert.equal(pb.submit({ t: 'duelPick', pick: 'rock' }), true, '카운트 중엔 몇 번이든 바꾼다');

    // 카운트 끝마다 판정 주체가 연다 — 대결이 끝나면 신청자(AI)의 차례가 이어진다
    for (let i = 0; i < 12 && pb.state.phase === 'duel'; i++) transport.expireDuelStep();
    assert.equal(pb.state.phase, 'control');
    assert.equal(pb.state.activeUnit, U('P2-Bishop'));
    assert.equal(pb.phase, 'aiThinking');
    assert.equal(pb.submit({ t: 'duelPick', pick: 'rock' }), false, '대결이 끝나면 패는 버려진다');
  } finally {
    transport.close();
  }
});

test('내가 걸면 AI가 곧바로 답한다 — 받으면 「패를 낼 수 있음」, 도망도 이 걸음에서', () => {
  const s = aiTurnNextToMe();
  s.activeUnit = U('P1-Rock');
  delete s.units[U('P1-Rock')]!.morale;
  s.units[U('P2-Bishop')]!.morale = 100;
  const transport = new LocalTransport(s, 'P1', { now: () => 0 });
  const pb = new Playback(transport, { onChange: () => {}, onTick: () => {} }, { now: () => 0 });
  try {
    pb.start();
    assert.equal(pb.phase, 'awaitingInput');
    assert.equal(pb.submit({ t: 'challenge', kind: 'duel', target: U('P2-Bishop') }), true);
    // 맞수 — 받는 쪽(AI)이 유리해 받는다
    assert.equal(pb.state.duel?.step, 'round');
    assert.equal(pb.phase, 'dueling');
    assert.equal(pb.submit({ t: 'duelFlee' }), true);
    assert.equal(pb.state.phase, 'control');
    assert.equal(pb.phase, 'awaitingInput', '도망해도 내 차례는 이어진다 (R17)');
    assert.ok(pb.state.log.some((e) => e.e === 'duelEnded' && e.reason === 'fled' && e.winner === 'P2'));
  } finally {
    transport.close();
  }
});
