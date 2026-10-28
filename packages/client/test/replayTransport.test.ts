/**
 * 방어 기록 리플레이(`ReplayTransport`, GDD §8.8 단계 5) — **화면이 보여 주는 판이 서버가 정산한 판과 같은가.**
 *
 * 서버는 같은 기록을 `replayLocalMatch`(끝까지) · `replayPrefix`(방치한 판, 둔 데까지)로 다시 둔다. 리플레이가 그와 다른 걸음을
 * 밟으면 방어자는 실제와 다른 판을 보는데 **화면은 아무 말도 안 한다** — 그래서 끝 상태를 견준다.
 * 기록은 사람(남군)이 늘 [대기]만 두는 공성전이다(재생 검증 회귀 `rules/test/replay.test.ts`와 같은 꼴).
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  advanceTime, apply, controllingSide, openReplay, replayLocalMatch, replayPrefix, takeTurn, validate,
} from '@samchess/rules';
import type { BattleState, Intent, OfficerId, PieceType, RosterEntry, ServerMsg, Side } from '@samchess/rules';
import { REPLAY_SCOUT_MS, ReplayTransport } from '../src/battle/replayTransport.ts';
import type { DefenseReplay } from '../src/battle/replayTransport.ts';

const E = (officer: string, piece: PieceType): RosterEntry => ({ officer: officer as OfficerId, piece, level: 1, statPicks: [], tactics: [] });
const ENTRIES: Record<Side, RosterEntry[]> = {
  P1: [E('yu-bi', 'King'), E('gwan-u', 'Rock'), E('jo-sik', 'Pawn')],
  P2: [E('jo-jo', 'King'), E('jang-hap', 'Bishop'), E('heon-je', 'Queen')],
};

/** 공격자가 [대기]만 두는 공성전을 끝까지 둔다 — 그 수가 기록이다 */
function recordSiege(seed: number): DefenseReplay {
  let s = openReplay({ matchId: `siege-${seed}`, mode: '3v3', seed, humanSide: 'P1', rosters: ENTRIES, deploy: null, aiDeploy: null });
  const intents: Intent[] = [{ t: 'ready' }];
  s = apply(s, 'P2', { t: 'ready' }).state;
  s = apply(s, 'P1', { t: 'ready' }).state;
  for (let i = 0; i < 5_000 && s.phase !== 'finished'; i++) {
    if (s.phase === 'scout' || s.phase === 'running') { s = advanceTime(s).state; continue; }
    const unit = s.units[s.activeUnit!]!;
    if (controllingSide(s, unit) === 'P1') {
      assert.ok(validate(s, 'P1', { t: 'endTurn' }).ok);
      s = apply(s, 'P1', { t: 'endTurn' }).state;
      intents.push({ t: 'endTurn' });
    } else s = takeTurn(s).state;
  }
  assert.equal(s.phase, 'finished');
  return { seed, mode: '3v3', entries: ENTRIES, deploy: { P1: null, P2: null }, intents };
}

/** 재생기처럼 민다 — 통을 받을 때마다 「다음」을 청한다(연출은 없다) */
function watch(t: ReplayTransport): BattleState {
  let last: ServerMsg | null = null;
  t.open((m) => { last = m; });
  for (let i = 0; i < 20_000 && !t.exhausted && t.current.phase !== 'finished'; i++) t.ready();
  assert.ok(last, '첫 통이 안 왔다');
  return t.current;
}

const summary = (s: BattleState): string =>
  `${s.phase}/${s.winner}/${s.time}/${s.rngCursor}/${Object.values(s.units).map((u) => `${u.id}:${u.hp}`).sort().join(',')}`;

test('끝까지 둔 판 — 리플레이의 끝 상태가 서버 재생(`replayLocalMatch`)과 같다', () => {
  const rec = recordSiege(5);
  const server = replayLocalMatch({ matchId: `siege-${rec.seed}`, mode: rec.mode, seed: rec.seed, humanSide: 'P1', rosters: rec.entries, deploy: null, aiDeploy: null, humanIntents: rec.intents });
  assert.ok(server.ok);
  const t = new ReplayTransport(rec);
  assert.equal(t.humanSide, null, '리플레이에는 단추가 없다');
  assert.equal(t.viewSide, 'P2', '방어자의 수비군이 아군 자리다');
  assert.equal(summary(watch(t)), summary(server.ok ? server.state : t.current));
  assert.equal(t.exhausted, false);
});

test('방치한 판 — 기록의 끝에서 멈추고 알린다(`replayPrefix`와 같은 자리)', () => {
  const rec = recordSiege(5);
  const cut = { ...rec, intents: rec.intents.slice(0, Math.floor(rec.intents.length / 2)) };
  const server = replayPrefix({ matchId: `siege-${cut.seed}`, mode: cut.mode, seed: cut.seed, humanSide: 'P1', rosters: cut.entries, deploy: null, aiDeploy: null, humanIntents: cut.intents });
  assert.ok(server.ok);
  let told = 0;
  const t = new ReplayTransport(cut, () => { told += 1; });
  const end = watch(t);
  assert.equal(t.exhausted, true);
  assert.equal(told, 1, '멈춘 것을 한 번 알린다');
  assert.notEqual(end.phase, 'finished');
  assert.equal(summary(end), summary(server.ok ? server.state : end));
  t.ready();
  assert.equal(summary(t.current), summary(end), '멈춘 뒤에는 더 두지 않는다');
});

test('보내는 의도는 버린다 — 관전에는 낼 의도가 없다', () => {
  const t = new ReplayTransport(recordSiege(5));
  t.open(() => {});
  const before = summary(t.current);
  t.send();
  assert.equal(summary(t.current), before);
});

test('정찰은 짧은 마감으로 선다 — 비워 보내면 재생기가 영원히 기다린다', () => {
  const t = new ReplayTransport(recordSiege(5), () => {}, () => 1_000);
  const scouts: (number | null)[] = [];
  t.open((m) => { if (m.t === 'sync' && m.state.phase === 'scout') scouts.push(m.deadlineInMs); });
  assert.equal(t.current.phase, 'scout', '열자마자 배치를 기록대로 마친다');
  assert.deepEqual(scouts, [REPLAY_SCOUT_MS]);
});
