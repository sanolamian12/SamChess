/**
 * 일기토 · 설전 — 로컬 판정 주체와 서버 재생이 **같은 판**을 낸다 (GDD §3.11, 설계서 §8 단계 3a)
 *
 * 사람과 두는 AI 대전은 클라이언트(`LocalTransport`)가 판을 돌리고, 끝난 뒤 서버가 사람의 기록만으로 다시 둔다
 * (`replayLocalMatch`). 대결이 들면 둘이 같은 자리에서 같은 것을 해야 한다 —
 * AI의 답 · 도망(상태가 바뀔 때마다 바로), 판정 주체의 마감 둘(응답 10초 · 카운트 끝 — 기록에 「여기서 왔다」가 남는다),
 * 채우는 패(시드 난수 — 서버가 다시 뽑는다). 어긋나면 정상 플레이가 정산에서 거부된다.
 *
 * 사람은 단순하게 둔다 — 붙은 적이 있으면 걸고(종류를 번갈아), 아니면 차례를 넘긴다. 대결에서는 받기 · 시간 넘기기 ·
 * 패 내기 · 안 내기 · 가끔 도망을 섞는다.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { challengeTargets, controllingSide, openReplay, replayLocalMatch, toWire } from '@samchess/rules';
import type { BattleMode, BattleState, DuelPick, Intent, RosterEntry, ServerMsg, Side } from '@samchess/rules';
import { makeAiOpponent } from '@samchess/meta';
import { LocalTransport } from '../src/battle/transport.ts';

function rosters(mode: BattleMode, seed: number): Record<Side, RosterEntry[]> {
  const a = makeAiOpponent(mode, 800, seed);
  const b = makeAiOpponent(mode, 800, seed + 1000, a.entries.map((e) => e.officer));
  return { P1: a.entries, P2: b.entries };
}

interface Played { transport: LocalTransport; last: ServerMsg; offered: Record<Side, number>; input: Parameters<typeof replayLocalMatch>[0] }

function play(mode: BattleMode, seed: number): Played {
  const input = { matchId: `duel-${seed}`, mode, seed, humanSide: 'P1' as Side, rosters: rosters(mode, seed), deploy: null, humanIntents: [] as Intent[] };
  const transport = new LocalTransport(openReplay(input), 'P1', { now: () => 0 });
  let last!: ServerMsg;
  const offered: Record<Side, number> = { P1: 0, P2: 0 };
  transport.open((m) => {
    last = m;
    for (const e of m.events) if (e.e === 'challengeOffered') offered[m.state.units[e.by]!.side]++;
  });
  let n = 0;
  try {
    for (let i = 0; i < 40_000; i++) {
      const s = { ...last.state, log: [] } as BattleState;
      if (s.phase === 'finished') break;
      n++;
      if (s.phase === 'deploy' && !s.ready.P1) { transport.send({ t: 'ready' }); continue; }
      if (s.phase === 'control' && s.activeUnit && controllingSide(s, s.units[s.activeUnit]!) === 'P1') {
        const kind = n % 2 ? 'duel' : 'debate';
        const target = challengeTargets(s, 'P1', kind)[0];
        transport.send(target ? { t: 'challenge', kind, target } : { t: 'endTurn' });
        continue;
      }
      if (s.phase === 'duel') {
        const d = s.duel!;
        if (d.step === 'offer') {
          // 사람이 받는 쪽이면 — 받기와 시간 넘기기를 번갈아. AI가 받는 쪽이면 판정 주체가 이미 답했다
          if (s.units[d.defender]!.side === 'P1' && n % 2) transport.send({ t: 'answerChallenge', accept: true });
          else transport.expireDuelStep();
          continue;
        }
        if (n % 17 === 0) { transport.send({ t: 'duelFlee' }); continue; }
        if (n % 3 !== 0) {
          const hands: DuelPick[] = d.kind === 'duel' ? ['rock', 'paper', 'scissors'] : [1, 2, 3];
          transport.send({ t: 'duelPick', pick: hands[n % 3]! });
        }
        transport.expireDuelStep();
        continue;
      }
      transport.ready();
    }
  } finally {
    transport.close();
  }
  return { transport, last, offered, input };
}

test('로컬로 둔 판(대결 포함)을 서버가 기록만으로 다시 두면 같은 판이다', () => {
  const total: Record<Side, number> = { P1: 0, P2: 0 };
  for (const mode of ['3v3', '5v5'] as const) {
    for (let seed = 1; seed <= 6; seed++) {
      const p = play(mode, seed);
      assert.equal(p.last.state.phase, 'finished', `${mode} 시드 ${seed}: 끝까지 갔다`);
      const log = p.transport.getIntentLog();
      const r = replayLocalMatch({ ...p.input, humanIntents: log });
      assert.ok(r.ok, `${mode} 시드 ${seed}: ${r.ok ? '' : r.reason}`);
      assert.deepEqual(toWire(r.state, 'P1'), p.last.state, `${mode} 시드 ${seed}: 재생이 같은 판을 낸다`);
      total.P1 += p.offered.P1;
      total.P2 += p.offered.P2;
    }
  }
  assert.ok(total.P1 > 0, `사람이 건 대결이 있었다 (${total.P1})`);
  assert.ok(total.P2 > 0, `AI가 사람에게 건 대결이 있었다 (${total.P2})`);
});

test('기록의 마감은 「여기서 왔다」뿐이다 — 채울 패를 위조해도 서버는 다시 뽑는다', () => {
  const p = play('3v3', 2);
  const log = p.transport.getIntentLog();
  assert.ok(log.some((i) => i.t === 'duelReveal'), '카운트 끝이 기록에 있다');
  assert.ok(log.every((i) => i.t !== 'duelReveal' || i.fill === undefined), '패는 안 싣는다');
  const forged = log.map((i): Intent => (i.t === 'duelReveal' ? { t: 'duelReveal', fill: { P1: 'rock', P2: 'scissors' } } : i));
  const r = replayLocalMatch({ ...p.input, humanIntents: forged });
  assert.ok(r.ok);
  assert.deepEqual(toWire(r.state, 'P1'), p.last.state);
});
