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
import { challengeTargets, controllingSide, openReplay, replayLocalMatch, replayPrefix, toWire } from '@samchess/rules';
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

test('서버를 안 거치는 판(데모)의 카운트 끝은 「여기서 왔다」뿐이다 — 패는 재생이 시드로 다시 뽑는다', () => {
  const p = play('3v3', 2);
  const log = p.transport.getIntentLog();
  assert.ok(log.some((i) => i.t === 'duelReveal'), '카운트 끝이 기록에 있다');
  assert.ok(log.every((i) => i.t !== 'duelReveal' || i.fill === undefined), '패는 안 싣는다');
});

test('기록에 패가 실려 있으면 재생은 그 패를 쓴다 — 그 패가 서버가 적은 것인지는 meta의 덧붙이기 · 정산이 본다 (R16)', () => {
  const p = play('3v3', 2);
  const log = p.transport.getIntentLog();
  // 첫 공개까지만 — 뒤의 수는 원래 패로 둔 판의 것이라 바꾼 패 뒤에서는 맞지 않는다
  const cut = log.findIndex((i) => i.t === 'duelReveal');
  const forged = [...log.slice(0, cut), { t: 'duelReveal', fill: { P1: 'rock', P2: 'paper' } } as Intent];
  const r = replayPrefix({ ...p.input, humanIntents: forged });
  assert.ok(r.ok, r.ok ? '' : r.reason);
  const round = r.ok ? r.state.log.filter((e) => e.e === 'duelRound').at(-1) : undefined;
  assert.ok(round?.e === 'duelRound', '합이 열렸다');
  for (const side of round.auto) assert.equal(round.picks[side], side === 'P1' ? 'rock' : 'paper', `${side}의 패가 기록의 것이다`);
  assert.ok(round.auto.length > 0, '채운 패가 하나는 있었다');
});

// ── 단계 5 — AI 대전은 카운트 끝에 서버가 패를 낸다 (GDD §3.11 R16, 설계서 §3-5) ──

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

/** 서버를 흉내 낸 공개 — 시드와 무관한 패(늘 AI가 이기도록 사람 패에 맞춘다)를 적는다. 물은 횟수를 센다 */
function fakeServer(t: () => LocalTransport) {
  const asked: number[] = [];
  const beats: Record<string, DuelPick> = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
  const reveal = async (): Promise<Intent | null> => {
    const s = t().getIntentLog();
    asked.push(s.length);
    return { t: 'duelReveal', fill: { P2: beats['rock']!, ...(s.at(-1)?.t === 'duelPick' ? {} : { P1: 'rock' as DuelPick }) } };
  };
  return { asked, reveal };
}

/** 사람이 걸어 첫 합까지 — 붙을 때까지 다가가는 대신 붙은 판을 고른다 */
function startDuel(revealer: (t: () => LocalTransport) => () => Promise<Intent | null>) {
  for (let seed = 1; seed < 60; seed++) {
    const input = { matchId: `srv-${seed}`, mode: '3v3' as BattleMode, seed, humanSide: 'P1' as Side, rosters: rosters('3v3', seed), deploy: null, humanIntents: [] as Intent[] };
    let tr!: LocalTransport;
    const asker = revealer(() => tr);
    tr = new LocalTransport(openReplay(input), 'P1', { now: () => 0, duelReveal: asker });
    let last!: ServerMsg;
    tr.open((m) => { last = m; });
    for (let i = 0; i < 4000 && last.state.phase !== 'finished'; i++) {
      const s = last.state as BattleState;
      if (s.phase === 'deploy' && !s.ready.P1) { tr.send({ t: 'ready' }); continue; }
      if (s.phase === 'duel') {
        if (s.duel!.step === 'round' && s.units[s.duel!.challenger]!.side === 'P1') return { tr, input, get last() { return last; } };
        if (s.duel!.step === 'offer') tr.expireDuelStep();
        else tr.send({ t: 'duelFlee' });
        continue;
      }
      if (s.phase === 'control' && s.activeUnit && controllingSide(s, s.units[s.activeUnit]!) === 'P1') {
        const target = challengeTargets(s, 'P1', 'duel')[0];
        tr.send(target ? { t: 'challenge', kind: 'duel', target } : { t: 'endTurn' });
        continue;
      }
      tr.ready();
    }
    tr.close();
  }
  throw new Error('사람이 건 대결의 첫 합에 닿는 시드가 없다');
}

test('★ AI 대전 — 카운트가 끝나면 패를 서버에 묻고, 받은 공개를 그대로 기록에 넣는다', async () => {
  let server!: ReturnType<typeof fakeServer>;
  const g = startDuel((t) => { server = fakeServer(t); return server.reveal; });
  g.tr.send({ t: 'duelPick', pick: 'rock' });
  g.tr.expireDuelStep();
  assert.equal(server.asked.length, 1, '카운트 끝에 서버에 물었다');
  // 묻는 동안 낸 패 · 도망은 버린다 — 그 합은 닫혔다(서버가 적을 기록과 갈리지 않게)
  g.tr.send({ t: 'duelPick', pick: 'scissors' });
  g.tr.send({ t: 'duelFlee' });
  await flush();
  const log = g.tr.getIntentLog();
  const at = server.asked[0]!;
  assert.deepEqual(log[at - 1], { t: 'duelPick', pick: 'rock' }, '묻기 전 패만 남는다');
  assert.deepEqual(log[at], { t: 'duelReveal', fill: { P2: 'paper' } }, '서버가 준 공개가 그 자리에 그대로');
  const round = g.last.events.find((e) => e.e === 'duelRound') ?? g.last.state.duel?.history[0];
  const picks = round && 'picks' in round ? round.picks : null;
  assert.equal(picks?.P2, 'paper', 'AI 패가 시드가 아니라 서버의 것이다');
  // 서버 재생도 기록의 패로 같은 자리에 닿는다
  const r = replayPrefix({ ...g.input, humanIntents: log });
  assert.ok(r.ok, r.ok ? '' : r.reason);
  assert.deepEqual(r.ok && r.state.duel?.history[0]?.picks, picks);
  g.tr.close();
});

test('AI 대전 — 서버가 패를 못 내면 내가 도망한 것이다(로컬 난수로 물러나지 않는다 · 내 통신 문제를 상대가 떠안지 않는다)', async () => {
  const g = startDuel(() => async () => null);
  g.tr.expireDuelStep();
  await flush();
  const log = g.tr.getIntentLog();
  assert.deepEqual(log.at(-1), { t: 'duelFlee' }, '기록에 내 도망이 남는다');
  assert.notEqual(g.last.state.phase, 'duel', '대결이 끝났다');
  assert.ok(g.last.events.some((e) => e.e === 'duelEnded' && e.reason === 'fled' && e.winner === 'P2'), '상대의 승리로 끝났다');
  g.tr.close();
});
