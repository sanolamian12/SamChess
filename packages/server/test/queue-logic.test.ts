/**
 * 대기열의 회귀 — `queue-logic.ts`의 순수 층을 가짜 시각으로 고정한다.
 *
 * `room-logic.test.ts`와 같은 결이다 — 여기서 잡는 것들(즉시 매칭 · 거절 기억 ·
 * 우선권 · 즉시 이탈)도 브라우저 둘을 띄워야 눈으로 보이는 종류다.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { MATCH_BAND } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import {
  confirm, decline, emptyQueue, enqueue, gone, leave,
} from '../src/queue-logic.ts';
import type { Enlist } from '../src/protocol.ts';

// ═══════════════════════════════════════════════════════════════
// 표본
// ═══════════════════════════════════════════════════════════════

function enlist(id: string): Enlist {
  return { playerId: id, entries: [], squadName: `${id}의 부대`, power: 800, deploy: null };
}

function entry(id: string, power = 800, mode: BattleMode = '3v3') {
  return { playerId: id, mode, power, enlist: enlist(id), queuedAt: 0 };
}

// ═══════════════════════════════════════════════════════════════
// 1. 매칭 — 인접 전투력 · 같은 모드
// ═══════════════════════════════════════════════════════════════

test('아무도 없으면 대기열에 들어갈 뿐이다', () => {
  const r = enqueue(emptyQueue(), entry('alice'));
  assert.equal(r.matched, null);
  assert.equal(r.state.waiting.length, 1);
});

test('인접한 전투력의 상대가 있으면 즉시 매칭된다', () => {
  const q = enqueue(emptyQueue(), entry('alice', 800)).state;
  const r = enqueue(q, entry('bob', 800));
  assert.ok(r.matched, '매칭이 안 됐다');
  assert.equal(r.state.waiting.length, 0, '매칭됐으면 대기열이 비어야 한다');
  assert.equal(r.state.pending.length, 1);
  const pair = [r.matched!.a.playerId, r.matched!.b.playerId].sort();
  assert.deepEqual(pair, ['alice', 'bob']);
});

test('매칭 구간 밖이면 매칭되지 않는다 — 온라인도 안 넓힌다 (§5-62)', () => {
  const q = enqueue(emptyQueue(), entry('alice', 800)).state;
  const r = enqueue(q, entry('bob', 800 + MATCH_BAND + 1));
  assert.equal(r.matched, null);
  assert.equal(r.state.waiting.length, 2);
});

test('구간 경계값(=MATCH_BAND)은 매칭된다', () => {
  const q = enqueue(emptyQueue(), entry('alice', 800)).state;
  const r = enqueue(q, entry('bob', 800 + MATCH_BAND));
  assert.ok(r.matched, '경계값인데 매칭이 안 됐다');
});

test('모드가 다르면 매칭되지 않는다', () => {
  const q = enqueue(emptyQueue(), entry('alice', 800, '3v3')).state;
  const r = enqueue(q, entry('bob', 800, '5v5'));
  assert.equal(r.matched, null);
  assert.equal(r.state.waiting.length, 2);
});

// ═══════════════════════════════════════════════════════════════
// 2. 검색을 그만둔다 — 매칭 전
// ═══════════════════════════════════════════════════════════════

test('leave() — 매칭 전이면 대기열에서 즉시 빠진다', () => {
  const q = enqueue(emptyQueue(), entry('alice')).state;
  const after = leave(q, 'alice');
  assert.equal(after.waiting.length, 0);
});

// ═══════════════════════════════════════════════════════════════
// 3. 확인 — 둘 다 눌러야 방이 열린다 (§5-60)
// ═══════════════════════════════════════════════════════════════

test('한쪽만 확인하면 아직 안 열린다', () => {
  const q = enqueue(emptyQueue(), entry('alice')).state;
  const m = enqueue(q, entry('bob')).matched!;
  const r = confirm({ waiting: [], pending: [m], avoid: new Map() }, m.id, 'alice');
  assert.equal(r.opened, null, '한쪽만 확인했는데 열렸다');
  assert.equal(r.state.pending.length, 1);
});

test('둘 다 확인하면 열리고 pending에서 빠진다', () => {
  const q = enqueue(emptyQueue(), entry('alice')).state;
  const m = enqueue(q, entry('bob')).matched!;
  const s = { waiting: [], pending: [m], avoid: new Map() };
  const r1 = confirm(s, m.id, m.a.playerId);
  assert.equal(r1.opened, null);
  const r2 = confirm(r1.state, m.id, m.b.playerId);
  assert.ok(r2.opened, '둘 다 확인했는데 안 열렸다');
  assert.equal(r2.state.pending.length, 0);
});

test('모르는 matchId·playerId의 확인은 조용히 무시한다', () => {
  const r = confirm(emptyQueue(), 'nope', 'nobody');
  assert.equal(r.opened, null);
});

// ═══════════════════════════════════════════════════════════════
// 4. 거절 — 거절한 쪽만 기억하고, 둘 다 맨 앞으로 (§5-63)
// ═══════════════════════════════════════════════════════════════

test('거절한 쪽은 기억에 남고, 그 상대와 다시 안 붙는다', () => {
  let q = enqueue(emptyQueue(), entry('alice')).state;
  const m = enqueue(q, entry('bob')).matched!;
  q = { waiting: [], pending: [m], avoid: new Map() };

  const r = decline(q, m.id, 'alice', 1_000);
  assert.equal(r.notifyDeclined?.playerId, 'bob', '거절당한 쪽에 알려야 한다');
  assert.equal(r.state.pending.length, 0);
  assert.ok(r.state.avoid.get('alice')?.has('bob'), '거절한 쪽의 기억에 상대가 없다');
  assert.ok(!r.state.avoid.get('bob')?.has('alice'), '거절당한 쪽은 기억하지 않는다');

  // 셋째 사람 없이 다시 넣으면 서로를 피해 **둘 다 대기열에 남는다**
  assert.equal(r.state.waiting.length, 2, '둘 다 대기열로 안 돌아갔다');
  assert.equal(r.decliderMatch, null);
  assert.equal(r.partnerMatch, null);
});

test('거절 뒤 셋째 사람이 있으면 그 자리에서 곧바로 다시 매칭된다', () => {
  let q = enqueue(emptyQueue(), entry('alice')).state;
  const m = enqueue(q, entry('bob')).matched!;
  q = { waiting: [entry('carol')], pending: [m], avoid: new Map() };

  // alice가 거절한다 — bob은 기다리던 carol과 곧바로 매칭돼야 한다
  const r = decline(q, m.id, 'alice', 1_000);
  assert.ok(r.partnerMatch, '거절당한 쪽이 대기 중이던 사람과 안 붙었다');
  const pair = [r.partnerMatch!.a.playerId, r.partnerMatch!.b.playerId].sort();
  assert.deepEqual(pair, ['bob', 'carol']);
  assert.equal(r.decliderMatch, null, 'alice는 혼자다 — 매칭될 사람이 없다');
});

test('avoid는 방향이 있다 — 상대는 여전히 나와 새로 매칭될 수 있다(내가 안 거절한 이상)', () => {
  // alice가 bob을 거절한 뒤, alice가 다시 들어와도 bob과는 안 붙는다(§ 위 검사)지만
  // **carol이 bob을 새로 찾는 것**은 막히지 않는다 — 거절 기억은 alice만의 것이다
  let q = enqueue(emptyQueue(), entry('alice')).state;
  const m = enqueue(q, entry('bob')).matched!;
  q = { waiting: [], pending: [m], avoid: new Map() };
  const declined = decline(q, m.id, 'alice', 1_000).state;

  const r = enqueue(declined, entry('carol'));
  assert.ok(r.matched, 'carol이 대기 중인 사람과 못 붙었다');
});

test('모르는 matchId의 거절은 조용히 무시한다', () => {
  const r = decline(emptyQueue(), 'nope', 'nobody', 0);
  assert.equal(r.notifyDeclined, null);
});

// ═══════════════════════════════════════════════════════════════
// 5. 사라졌다 — 대기열은 재접속 유예를 안 둔다
// ═══════════════════════════════════════════════════════════════

test('gone() — 아직 대기 중이면 즉시 빠질 뿐, 아무에게도 알리지 않는다', () => {
  const q = enqueue(emptyQueue(), entry('alice')).state;
  const r = gone(q, 'alice', 0);
  assert.equal(r.state.waiting.length, 0);
  assert.equal(r.notifyPartner, null);
});

test('gone() — 확인 대기 중 사라지면 상대만 되돌아간다, 기억은 안 남는다', () => {
  let q = enqueue(emptyQueue(), entry('alice')).state;
  const m = enqueue(q, entry('bob')).matched!;
  q = { waiting: [], pending: [m], avoid: new Map() };

  const r = gone(q, 'alice', 1_000);
  assert.equal(r.notifyPartner?.playerId, 'bob');
  assert.equal(r.state.pending.length, 0, '펜딩이 안 없어졌다');
  assert.equal(r.state.avoid.size, 0, '진짜 거절이 아닌데 기억이 남았다');
  assert.equal(r.state.waiting.length, 1, 'bob이 대기열로 안 돌아갔다');
});

test('gone() — 대기열에도 펜딩에도 없으면 아무 일도 없다', () => {
  const r = gone(emptyQueue(), 'nobody', 0);
  assert.equal(r.notifyPartner, null);
  assert.equal(r.rematched, null);
});
