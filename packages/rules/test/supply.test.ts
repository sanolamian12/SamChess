/**
 * 군량고 탈취 (GDD §3.9, 2026-10-19 기획자 확정)
 *
 *  - 군량고는 판 가운데 열의 진영 맨 끝줄 — 남군(P1) (12, 19) · 북군(P2) (12, 0)
 *  - 적 장수가 **제 손으로 걸어 들어와 멈추면** 승리. 지나가는 것 · 조종당한 이동은 아니다
 *  - 제 군량고 위에 아군이 서는 것은 허용 — 그 장수를 쓰러뜨려야 탈취할 수 있다
 *  - 「자유이동」(여포 · 감녕)은 적 군량고의 5×5 필드에 내릴 수 없다
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apply, createBattle, legalMovesFor, legalTargetsFor, threatRangeFor, validate } from '../src/battle.ts';
import type { BattleState } from '../src/types.ts';
import { takeTurn } from '../src/ai.ts';
import { supplyDepotOf, supplyFieldOf } from '../src/state.ts';
import { R, U, battle, giveControl, place } from './fixtures.ts';
import { banditRoster } from '../src/raid.ts';

test('군량고 자리 — 3v3 · 5v5 모두 가운데 열의 진영 끝줄, 도적떼 판에는 없다', () => {
  const s3 = battle();
  assert.deepEqual(supplyDepotOf(s3, 'P1'), { x: 12, y: 19 });
  assert.deepEqual(supplyDepotOf(s3, 'P2'), { x: 12, y: 0 });
  assert.deepEqual(supplyFieldOf(s3, 'P2'), { x0: 10, x1: 14, y0: 0, y1: 4 });
  assert.deepEqual(supplyFieldOf(s3, 'P1'), { x0: 10, x1: 14, y0: 15, y1: 19 });

  const s5 = createBattle({
    matchId: 't', seed: 1, mode: '5v5',
    rosters: {
      P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'), R('jang-bi', 'Knight'), R('jo-un', 'Bishop')],
      P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen'), R('ha-hu-don', 'Knight'), R('heo-jeo', 'Rock')],
    },
  });
  assert.deepEqual(supplyDepotOf(s5, 'P1'), { x: 12, y: 19 });
  assert.deepEqual(supplyDepotOf(s5, 'P2'), { x: 12, y: 0 });
  // 5v5에서는 셋째 장수의 기본 자리가 그 필드의 한가운데다
  assert.deepEqual(s5.units[U('P1-Pawn')]!.pos.x, 12);

  const raid = createBattle({
    matchId: 't', seed: 1, mode: '3v3', scenario: 'raid',
    rosters: { P1: [R('yu-bi', 'King')], P2: banditRoster(1) },
  });
  assert.equal(supplyDepotOf(raid, 'P1'), null);
  assert.equal(supplyDepotOf(raid, 'P2'), null);
});

test('적 군량고에 들어가 멈추면 그 자리에서 이긴다 — 뒤의 공격은 막힌다', () => {
  let s = place(battle(), { 'P1-Rock': { x: 12, y: 4 }, 'P2-Bishop': { x: 3, y: 3 }, 'P2-Queen': { x: 13, y: 1 } });
  s = giveControl(s, U('P1-Rock'));
  const r = apply(s, 'P1', { t: 'move', to: { x: 12, y: 0 } });
  assert.equal(r.state.phase, 'finished');
  assert.equal(r.state.winner, 'P1');
  assert.equal(r.state.outcome, 'supplyTaken');
  assert.ok(r.events.some((e) => e.e === 'battleEnded' && e.outcome === 'supplyTaken'));
  assert.equal(validate(r.state, 'P1', { t: 'attack', targets: [U('P2-Queen')] }).ok, false);
});

test('지나가는 것은 탈취가 아니다', () => {
  let s = place(battle(), { 'P1-Rock': { x: 14, y: 0 }, 'P2-Bishop': { x: 3, y: 3 } });
  s = giveControl(s, U('P1-Rock'));
  const r = apply(s, 'P1', { t: 'move', to: { x: 10, y: 0 } });
  assert.deepEqual(r.state.units[U('P1-Rock')]!.pos, { x: 10, y: 0 });
  assert.equal(r.state.phase, 'control', '군량고를 가로질렀을 뿐이다');
});

test('제 군량고 위에 아군이 서 있으면 그 칸으로는 못 들어간다 — 쓰러뜨려야 한다', () => {
  // 배치 단계에서도 제 군량고에 설 수 있다
  const d = battle();
  const placements = Object.values(d.units).filter((u) => u.side === 'P2')
    .map((u) => ({ unit: u.id, pos: u.piece === 'Bishop' ? { x: 12, y: 0 } : u.pos }));
  assert.ok(validate(d, 'P2', { t: 'deploy', placements }).ok);

  let s = place(battle(), { 'P1-Rock': { x: 12, y: 4 }, 'P2-Bishop': { x: 12, y: 0 } });
  s = giveControl(s, U('P1-Rock'));
  assert.ok(!legalMovesFor(s, U('P1-Rock')).some((p) => p.x === 12 && p.y === 0));
});

test('조종당한 장수가 들어가는 것은 소용없다 — 어느 쪽 군량고든', () => {
  // P2가 조종하는 P1 장수를 P2 군량고에 넣는다 (P1의 승리가 되면 안 된다)
  let s = place(battle(), { 'P1-Rock': { x: 12, y: 4 }, 'P2-Bishop': { x: 3, y: 3 } });
  s.units[U('P1-Rock')]!.control = { by: U('P2-King'), mode: 'moveOnly', uses: null };
  s = giveControl(s, U('P1-Rock'));
  let r = apply(s, 'P2', { t: 'move', to: { x: 12, y: 0 } });
  assert.equal(r.state.phase, 'control');

  // P1이 조종하는 P2 장수를 P1 군량고에 넣는다 (P2의 승리가 되면 안 된다)
  s = place(battle(), { 'P2-Queen': { x: 12, y: 16 }, 'P1-Rock': { x: 3, y: 17 } });
  s.units[U('P2-Queen')]!.control = { by: U('P1-King'), mode: 'moveOnly', uses: null };
  s = giveControl(s, U('P2-Queen'));
  r = apply(s, 'P1', { t: 'move', to: { x: 12, y: 19 } });
  assert.equal(r.state.phase, 'control');
});

test('자유이동은 적 군량고의 5×5 필드에 내리지 못한다 — 기물 마스크로 닿는 칸은 그대로', () => {
  let s = place(battle(), { 'P1-Rock': { x: 12, y: 6 }, 'P2-Bishop': { x: 3, y: 3 } });
  s = giveControl(s, U('P1-Rock'));
  s.units[U('P1-Rock')]!.statuses.push({ status: 'freeMove', charges: 1 });
  const moves = legalMovesFor(s, U('P1-Rock'));
  const inField = moves.filter((p) => p.x >= 10 && p.x <= 14 && p.y <= 4);
  // Rock 십자 4칸 — (12, 2) · (12, 3) · (12, 4)만 걸어서 닿는다
  assert.deepEqual(inField.map((p) => `${p.x},${p.y}`).sort(), ['12,2', '12,3', '12,4']);
  assert.ok(!moves.some((p) => p.x === 12 && p.y === 0), '군량고 칸은 후보가 아니다');
  // 필드 밖 · 제 진영 필드는 그대로 자유롭다
  assert.ok(moves.some((p) => p.x === 9 && p.y === 0));
  assert.ok(moves.some((p) => p.x === 12 && p.y === 18));
});

test('AI — 적 군량고에 닿으면 들어간다', () => {
  let s = place(battle(), { 'P1-Rock': { x: 12, y: 4 }, 'P2-Bishop': { x: 3, y: 3 } });
  s = giveControl(s, U('P1-Rock'));
  const r = takeTurn(s);
  assert.equal(r.state.outcome, 'supplyTaken');
  assert.equal(r.state.winner, 'P1');
});

test('AI — 제 군량고를 노리는 적을 못 죽이면 군량고 칸에 올라서고, 서 있으면 떠나지 않는다', () => {
  let s = place(battle(), { 'P1-Rock': { x: 12, y: 4 }, 'P2-Bishop': { x: 3, y: 3 }, 'P2-Queen': { x: 11, y: 1 } });
  s = giveControl(s, U('P2-Queen'));
  let r = takeTurn(s);
  assert.deepEqual(r.state.units[U('P2-Queen')]!.pos, { x: 12, y: 0 });
  assert.notEqual(r.state.outcome, 'supplyTaken');

  // 이미 서 있으면 그대로 지킨다
  s = place(battle(), { 'P1-Rock': { x: 12, y: 4 }, 'P2-Bishop': { x: 3, y: 3 }, 'P2-Queen': { x: 12, y: 0 } });
  s = giveControl(s, U('P2-Queen'));
  r = takeTurn(s);
  assert.deepEqual(r.state.units[U('P2-Queen')]!.pos, { x: 12, y: 0 });
});

// ── 목표를 따라 걷는 AI (2026-10-19 기획자: 적 King · 적 군량고를 노리고, 내 King · 내 군량고를 지킨다) ──

const threatenedBy = (s: BattleState, id: string): number => {
  const at = s.units[U(id)]!.pos;
  return Object.values(s.units)
    .filter((u) => u.alive && u.side !== s.units[U(id)]!.side)
    .filter((e) => threatRangeFor(s, e.id).some((p) => p.x === at.x && p.y === at.y)).length;
};

test('AI — 죽일 수 있는 King이 있으면 다른 죽일 수 있는 적보다 King을 친다', () => {
  // Rock은 대각선 1칸을 친다
  let s = place(battle(), { 'P1-Rock': { x: 12, y: 5 }, 'P2-King': { x: 11, y: 4 }, 'P2-Queen': { x: 13, y: 4 } });
  s.units[U('P2-King')]!.hp = 2;
  s.units[U('P2-Queen')]!.hp = 1;
  s = giveControl(s, U('P1-Rock'));
  const legal = legalTargetsFor(s, U('P1-Rock'));
  assert.ok(legal.includes(U('P2-King')) && legal.includes(U('P2-Queen')), '둘 다 사거리 안이어야 검사가 뜻이 있다');
  const r = takeTurn(s);
  assert.equal(r.state.outcome, 'kingDown');
  assert.equal(r.state.winner, 'P1');
});

test('AI — 노려지는 King은 덜 노려지는 칸으로 물러난다', () => {
  let s = place(battle(), { 'P2-Queen': { x: 7, y: 13 } });
  s = giveControl(s, U('P1-King'));
  const before = threatenedBy(s, 'P1-King');
  assert.ok(before > 0, 'King이 노려지는 자리여야 검사가 뜻이 있다');
  const r = takeTurn(s);
  assert.ok(threatenedBy(r.state, 'P1-King') < before, `물러나지 않았다 — ${JSON.stringify(r.state.units[U('P1-King')]!.pos)}`);
});

test('AI — 위협이 없으면 King은 제자리를 지키고, 홀로 남은 King은 나선다', () => {
  let s = giveControl(battle(), U('P1-King'));
  let r = takeTurn(s);
  assert.deepEqual(r.state.units[U('P1-King')]!.pos, { x: 7, y: 17 }, '아군이 있으면 King은 나서지 않는다');

  s = battle();
  for (const id of ['P1-Rock', 'P1-Pawn', 'P2-Bishop', 'P2-Queen']) s.units[U(id)]!.alive = false;
  s = giveControl(s, U('P1-King'));
  r = takeTurn(s);
  assert.ok(r.state.units[U('P1-King')]!.pos.y < 17, `홀로 남은 King이 안 나섰다 — ${JSON.stringify(r.state.units[U('P1-King')]!.pos)}`);
});

test('AI — 위협이 없을 때 장수는 적 King · 적 군량고 중 가까운 쪽으로 간다', () => {
  // 두 목표가 **다른 걸음**을 고르게 둔다(Rock은 십자로 걷는다) — 군량고(12, 0)면 위로(14, 6), 적 King이면 왼쪽으로(10, 10)
  const at = { 'P1-Rock': { x: 14, y: 10 }, 'P2-Bishop': { x: 22, y: 2 }, 'P2-Queen': { x: 24, y: 3 } };
  let s = giveControl(place(battle(), { ...at, 'P2-King': { x: 2, y: 2 } }), U('P1-Rock'));
  let to = takeTurn(s).state.units[U('P1-Rock')]!.pos;
  assert.deepEqual(to, { x: 14, y: 6 }, '군량고가 더 가깝다 — 위로');

  // 적 King이 더 가까우면(거리 8 < 군량고 10) 그쪽으로 — 왼쪽으로 곧게
  s = giveControl(place(battle(), { ...at, 'P2-King': { x: 6, y: 10 } }), U('P1-Rock'));
  to = takeTurn(s).state.units[U('P1-Rock')]!.pos;
  assert.deepEqual(to, { x: 10, y: 10 }, 'King이 더 가깝다 — 왼쪽으로');
});

test('AI — 내 King 가까이 온 적에게 가장 가까운 장수가 돌아선다', () => {
  // 적 Queen이 P1 King 곁(거리 4 안)에 들어왔다. P1 Rock은 멀리 앞에 나가 있다
  let s = place(battle(), { 'P2-Queen': { x: 3, y: 14 }, 'P1-Rock': { x: 12, y: 8 }, 'P1-Pawn': { x: 17, y: 17 } });
  s = giveControl(s, U('P1-Rock'));
  const before = s.units[U('P1-Rock')]!.pos;
  const r = takeTurn(s);
  const after = r.state.units[U('P1-Rock')]!.pos;
  const d = (p: { x: number; y: number }) => Math.max(Math.abs(p.x - 3), Math.abs(p.y - 14));
  assert.ok(d(after) < d(before), `침입자 쪽으로 안 돌아섰다 — ${JSON.stringify(after)}`);
});
