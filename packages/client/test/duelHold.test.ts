/**
 * 대결 안에서 멈춰 서기 (2026-11-12, 일기토 · 설전 튜토리얼) — `LocalTransport`의 `duelHold` · `releaseDuel`.
 *
 * 튜토리얼 판을 판정 주체 그대로 두고, 가짜 시계로 민다: 첫 합은 준비 장면이 끝난 자리(첫 카운트 3초 전)에서 서고, 서 있는 동안은
 * 아무리 기다려도 공개가 안 오며 마감을 안 싣는다(화면의 카운트가 멎는다). 놓으면 그 자리부터 세어 3초 뒤 공개된다.
 * 다음 합은 공개 연출 뒤(카운트 5초 전)에서 선다. 셋째 합이 끝나면 판의 목표로 이긴다.
 */
import { strict as assert } from 'node:assert';
import { mock, test } from 'node:test';
import { DUEL_COUNT_MS, DUEL_FIRST_COUNT_MS, DUEL_INTRO_MS, DUEL_REVEAL_MS, createBattle } from '@samchess/rules';
import type { ServerMsg, UnitId } from '@samchess/rules';
import { TUTORIAL_HUMAN_SIDE, tutorialDuelAi, tutorialDuelHold, tutorialDuelReveal, tutorialStages } from '@samchess/meta';
import { LocalTransport } from '../src/battle/transport.ts';

test('튜토리얼 대결 — 합마다 카운트 직전에 서고, 놓으면 그 자리부터 센다 · 셋째 합에 판의 목표로 이긴다', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const [stage] = tutorialStages('basic-duel');
    const held: number[] = [];
    const t = new LocalTransport(createBattle(stage!.config), TUTORIAL_HUMAN_SIDE, {
      now: () => Date.now(),
      ai: (s) => { throw new Error(`적 차례가 오면 안 된다 (${s.activeUnit})`); },
      duelAi: tutorialDuelAi,
      duelReveal: (s) => Promise.resolve(tutorialDuelReveal(s)),
      duelHold: (s) => tutorialDuelHold(stage!, s),
      onDuelHeld: (s) => held.push(s.duel!.history.length),
    });
    let last!: ServerMsg;
    t.open((m) => { last = m; });
    t.ready();
    assert.equal(last.state.phase, 'control');
    t.send({ t: 'challenge', kind: 'duel', target: 'P2-King' as UnitId });
    assert.equal(last.state.duel?.step, 'round', '적은 곧바로 받는다');
    assert.equal(last.deadlineInMs, DUEL_INTRO_MS + DUEL_FIRST_COUNT_MS);

    const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
    // 첫 합 — 준비 장면이 끝나면 선다
    mock.timers.tick(DUEL_INTRO_MS);
    assert.deepEqual(held, [0]);
    assert.equal(t.duelHeld, true);
    assert.equal(last.deadlineInMs, null, '서 있는 동안 마감을 안 싣는다 — 화면의 카운트가 멎는다');
    mock.timers.tick(60_000);
    await flush();
    assert.equal(last.state.duel?.history.length ?? 0, 0, '서 있는 동안 공개가 안 온다');
    t.releaseDuel();
    assert.equal(last.deadlineInMs, DUEL_FIRST_COUNT_MS, '놓으면 첫 카운트 3초부터');
    mock.timers.tick(DUEL_FIRST_COUNT_MS);
    await flush();
    assert.equal(last.state.duel?.history.length, 1, '첫 합이 열렸다');

    // 둘째 · 셋째 합 — 공개 연출 뒤에 선다
    for (const round of [1, 2]) {
      mock.timers.tick(DUEL_REVEAL_MS);
      assert.deepEqual(held.at(-1), round);
      t.releaseDuel();
      assert.equal(last.deadlineInMs, DUEL_COUNT_MS);
      mock.timers.tick(DUEL_COUNT_MS);
      await flush();
    }
    assert.equal(last.state.phase, 'finished');
    assert.equal(last.state.winner, 'P1');
    assert.equal(last.state.outcome, 'objective');
    t.close();
  } finally {
    mock.timers.reset();
  }
});
