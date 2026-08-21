/**
 * 재생 검증(`replayLocalMatch`) 회귀 — AI 대전 서버 이관(§5-96)의 핵심 계약이다.
 *
 * 여기서 도는 "참조 시뮬레이션"은 `replayLocalMatch` 내부와 **독립적으로** 다시
 * 적는다 — 같은 코드를 두 번 부르는 것으로는 자기 자신의 버그를 못 잡는다.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceTime, apply, createBattle, validate } from '../src/battle.ts';
import { takeTurn } from '../src/ai.ts';
import { controllingSide } from '../src/state.ts';
import { replayLocalMatch } from '../src/replay.ts';
import type { BattleState, Intent, RosterEntry } from '../src/types.ts';
import { R } from './fixtures.ts';

const ROSTERS: { P1: RosterEntry[]; P2: RosterEntry[] } = {
  P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')],
  P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
};

/**
 * "사람"이 P1을 잡고 **언제나 [차례 넘기기 없는 그냥 턴 종료]만** 두는 참조
 * 시뮬레이션. P2는 진짜 AI(`takeTurn`)라 결국 어느 한쪽이 끝낸다. 사람이 낸
 * 의도(전부 `endTurn`)를 기록해 둔다 — `replayLocalMatch`에 그대로 먹인다.
 */
function playReference(seed: number): { state: BattleState; humanIntents: Intent[] } {
  let state = createBattle({ matchId: 'replay-test', seed, mode: '3v3', rosters: ROSTERS });
  const humanIntents: Intent[] = [];
  /*
   * **AI(P2)가 먼저 준비한다** — 실제 `LocalTransport.open()`이 그렇게 한다(사람
   * 쪽이 아닌 진영을 배치 시작 즉시 자동으로 준비시킨다). 사람의 `ready`만 기록한다.
   */
  state = apply(state, 'P2', { t: 'ready' }).state;
  state = apply(state, 'P1', { t: 'ready' }).state;
  humanIntents.push({ t: 'ready' });

  for (let guard = 0; guard < 5_000 && state.phase !== 'finished'; guard++) {
    if (state.phase === 'scout' || state.phase === 'running') {
      state = advanceTime(state).state;
      continue;
    }
    if (state.phase === 'control') {
      const unit = state.activeUnit ? state.units[state.activeUnit] : undefined;
      if (!unit) break;
      if (controllingSide(state, unit) === 'P1') {
        const intent: Intent = { t: 'endTurn' };
        assert.equal(validate(state, 'P1', intent).ok, true);
        state = apply(state, 'P1', intent).state;
        humanIntents.push(intent);
      } else {
        state = takeTurn(state).state;
      }
      continue;
    }
    break;
  }
  assert.equal(state.phase, 'finished', '참조 시뮬레이션이 안 끝났다 — 시드나 로직을 확인할 것');
  return { state, humanIntents };
}

test('재생은 실제로 돌린 판과 같은 결말을 낸다', () => {
  const { state: ref, humanIntents } = playReference(7);

  const replay = replayLocalMatch({
    matchId: 'replay-test', mode: '3v3', seed: 7, humanSide: 'P1',
    rosters: ROSTERS, deploy: null, humanIntents,
  });

  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.state.winner, ref.winner);
  assert.equal(replay.state.outcome, ref.outcome);
  assert.equal(replay.state.rngCursor, ref.rngCursor);
  assert.deepEqual(replay.state.log, ref.log);
});

test('같은 입력을 두 번 재생하면 완전히 같은 상태가 나온다', () => {
  const { humanIntents } = playReference(11);
  const input = {
    matchId: 'replay-test', mode: '3v3' as const, seed: 11, humanSide: 'P1' as const,
    rosters: ROSTERS, deploy: null, humanIntents,
  };
  const a = replayLocalMatch(input);
  const b = replayLocalMatch(input);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.deepEqual(a.state, b.state);
});

test('조작된 의도(불법 수)는 재생을 거부한다', () => {
  const { humanIntents } = playReference(13);
  // 첫 번째 사람 의도를 있을 수 없는 것으로 바꿔치기한다
  const tampered = [{ t: 'attack', targets: [] } as Intent, ...humanIntents.slice(1)];

  const replay = replayLocalMatch({
    matchId: 'replay-test', mode: '3v3', seed: 13, humanSide: 'P1',
    rosters: ROSTERS, deploy: null, humanIntents: tampered,
  });

  assert.equal(replay.ok, false);
});

test('의도가 모자라면(끝까지 안 두면) 재생을 거부한다', () => {
  const { humanIntents } = playReference(17);
  const replay = replayLocalMatch({
    matchId: 'replay-test', mode: '3v3', seed: 17, humanSide: 'P1',
    rosters: ROSTERS, deploy: null, humanIntents: humanIntents.slice(0, -1),
  });
  assert.equal(replay.ok, false);
});
