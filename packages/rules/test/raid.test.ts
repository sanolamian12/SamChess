/**
 * 도적떼 방어전 회귀 — 전용 판(25×15) · 성채 · 도적 편성 · 양쪽 인원이 다른 판 (GDD §5.11)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OFFICERS, RAID, combatantById, officerById } from '@samchess/data';
import { advanceTime, apply, createBattle, legalMovesFor, validate } from '../src/battle.ts';
import { autoBattle, takeTurn } from '../src/ai.ts';
import { controllingSide, deployZoneOf } from '../src/state.ts';
import { replayLocalMatch } from '../src/replay.ts';
import {
  BANDIT_SIDE, GUARD_SIDE, MAX_BANDITS, RAID_BOARD, RAID_CASTLE_CENTER,
  banditRoster, raidDefaultPositions, raidMode, raidZone,
} from '../src/raid.ts';
import type { BattleState, Intent, RosterEntry } from '../src/types.ts';
import { R, U, giveControl, place } from './fixtures.ts';

const GUARDS_5: RosterEntry[] = [
  R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'), R('jang-bi', 'Queen'), R('jo-un', 'Knight'),
];

const raid = (guards: RosterEntry[], farmLevel: number, seed = 1): BattleState => createBattle({
  matchId: 'raid-test', seed, mode: raidMode(guards.length), scenario: 'raid',
  rosters: { P1: guards, P2: banditRoster(farmLevel) },
});

// ── 도적 편성 ─────────────────────────────────────────────────

test('도적 편성 — 농지 Lv n이면 King · Queen · Rock · Bishop · Knight의 앞 n명, 레벨 n', () => {
  assert.deepEqual(banditRoster(1).map((r) => r.piece), ['King']);
  assert.deepEqual(banditRoster(3).map((r) => r.piece), ['King', 'Queen', 'Rock']);
  assert.deepEqual(banditRoster(5).map((r) => r.piece), ['King', 'Queen', 'Rock', 'Bishop', 'Knight']);
  for (let lv = 1; lv <= MAX_BANDITS; lv++) {
    for (const r of banditRoster(lv)) {
      assert.equal(r.level, lv);
      assert.equal(r.statPicks.length, lv - 1, '성장 스택 = 레벨 − 1');
      assert.deepEqual(r.tactics, [], '도적은 책략이 없다');
    }
  }
  assert.throws(() => banditRoster(0), /범위 밖/);
  assert.throws(() => banditRoster(MAX_BANDITS + 1), /범위 밖/);
});

test('도적의 성장 — HP → AT → HP … 번갈아 찍는다', () => {
  assert.deepEqual(banditRoster(5)[0]!.statPicks, ['hp', 'at', 'hp', 'at']);
  const s = raid([R('yu-bi', 'King')], 5);
  const king = s.units[U('P2-King')]!;
  // Lv1 기본 HP 10 · AT 2 → HP 두 번(+5 × 2), AT 두 번(+0.5 × 2)
  assert.deepEqual([king.hp, king.at, king.mp], [20, 3, 5]);
});

test('도적은 무·지·통 30 — WT 160, 고유기술 없음', () => {
  const s = raid([R('yu-bi', 'King')], 5);
  for (const u of Object.values(s.units).filter((x) => x.side === BANDIT_SIDE)) {
    const o = combatantById.get(u.officer)!;
    assert.deepEqual([o.might, o.intellect, o.leadership], [30, 30, 30]);
    assert.equal(o.uniqueSkill, null);
    assert.equal(u.wtBase, 160);
    assert.equal(u.uniqueSkillUses, 0);
  }
});

test('도적은 260명 명단 밖이다 — 가챠·랭킹·AI 상대 풀이 훑는 자리에 안 들어간다', () => {
  assert.equal(OFFICERS.length, 260);
  assert.equal(officerById.size, 260);
  for (const r of banditRoster(MAX_BANDITS)) {
    assert.equal(officerById.has(r.officer), false, `${r.officer}가 명단에 섞였다`);
    assert.ok(combatantById.has(r.officer), `${r.officer}를 전투가 못 찾는다`);
  }
  assert.equal(RAID.banditPieces[0], 'King');
});

// ── 판 ─────────────────────────────────────────────────────

test('도적떼 판 — 25×15, 진영은 전체 폭 × 5행', () => {
  const s = raid([R('yu-bi', 'King')], 1);
  assert.equal(s.scenario, 'raid');
  assert.deepEqual(s.boardSize, { x: 25, y: 15 });
  assert.deepEqual(raidZone(GUARD_SIDE), { x0: 0, x1: 24, y0: 10, y1: 14 });
  assert.deepEqual(raidZone(BANDIT_SIDE), { x0: 0, x1: 24, y0: 0, y1: 4 });
  // 전투 안의 조회는 이 판의 구역을 낸다 — 대전의 식(인원 × 5 폭, 20행)이 아니라
  assert.deepEqual(deployZoneOf(s, GUARD_SIDE), raidZone(GUARD_SIDE));
});

test('성채 — 처음부터 3×3 성지가 서 있고, 그 한가운데가 파수꾼 King의 자리다', () => {
  const s = raid(GUARDS_5, 5);
  assert.equal(s.terrain.length, 9);
  for (const t of s.terrain) {
    assert.equal(t.terrain, 'holy');
    assert.equal(t.fort?.side, GUARD_SIDE);
    assert.equal(t.pos.x - RAID_CASTLE_CENTER.x, t.fort!.dx);
    assert.equal(t.pos.y - RAID_CASTLE_CENTER.y, t.fort!.dy);
  }
  const xs = s.terrain.map((t) => t.pos.x);
  const ys = s.terrain.map((t) => t.pos.y);
  // 기획자 표기(1부터): 가로 12~14 · 남쪽 진영 세로 2~4
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [11, 13]);
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [11, 13]);
  assert.deepEqual(s.units[U('P1-King')]!.pos, { x: 12, y: 12 });
});

test('기본 자리 — King이 가운데, 나머지는 안쪽부터. 모두 제 진영 안이고 겹치지 않는다', () => {
  const s = raid(GUARDS_5, 5);
  const cells = new Set<string>();
  for (const u of Object.values(s.units)) {
    const z = raidZone(u.side);
    assert.ok(u.pos.x >= z.x0 && u.pos.x <= z.x1 && u.pos.y >= z.y0 && u.pos.y <= z.y1, `${u.id} 진영 밖`);
    cells.add(`${u.pos.x},${u.pos.y}`);
  }
  assert.equal(cells.size, 10);
  // King이 편성 맨 앞이 아니어도 가운데에 선다
  assert.deepEqual(raidDefaultPositions(GUARD_SIDE, ['Rock', 'King']), [{ x: 7, y: 12 }, { x: 12, y: 12 }]);
  assert.deepEqual(s.units[U('P2-King')]!.pos, { x: 12, y: 2 });
});

test('양쪽 인원이 달라도 된다 — 파수꾼 1명 vs 도적 5명, SP 상한은 제 인원 × 5', () => {
  const s = raid([R('yu-bi', 'King')], 5);
  assert.equal(Object.values(s.units).filter((u) => u.side === 'P1').length, 1);
  assert.equal(Object.values(s.units).filter((u) => u.side === 'P2').length, 5);
  assert.deepEqual(s.spCap, { P1: 5, P2: 25 });
});

test('편성 규칙 — 1~5명, King 필수, 기물·장수 중복 금지', () => {
  assert.throws(() => raid([], 1), /1~5명/);
  assert.throws(() => raid([...GUARDS_5, R('jo-jo', 'Bishop')], 1), /1~5명/);
  assert.throws(() => raid([R('gwan-u', 'Rock')], 1), /King은 필수/);
  assert.throws(() => raid([R('yu-bi', 'King'), R('gwan-u', 'King')], 1), /종류당 1개/);
  // 대전은 여전히 인원이 딱 맞아야 한다
  assert.throws(() => createBattle({
    matchId: 'x', seed: 1, mode: '3v3',
    rosters: { P1: [R('yu-bi', 'King')], P2: banditRoster(1) },
  }), /3명이어야/);
});

test('보상 등급 — 파수꾼 3명 이하는 3v3, 4명 이상은 5v5', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(raidMode), ['3v3', '3v3', '3v3', '5v5', '5v5']);
});

// ── 배치 ─────────────────────────────────────────────────────

test('배치 — 파수꾼 King은 성채 한가운데를 떠날 수 없다', () => {
  const s = raid([R('yu-bi', 'King'), R('gwan-u', 'Rock')], 2);
  const at = (king: { x: number; y: number }, rock: { x: number; y: number }): Intent => ({
    t: 'deploy', placements: [{ unit: U('P1-King'), pos: king }, { unit: U('P1-Rock'), pos: rock }],
  });
  assert.equal(validate(s, 'P1', at({ x: 12, y: 12 }, { x: 0, y: 10 })).ok, true, '나머지는 진영 어디든');
  assert.equal(validate(s, 'P1', at({ x: 12, y: 12 }, { x: 24, y: 14 })).ok, true);
  const moved = validate(s, 'P1', at({ x: 12, y: 13 }, { x: 0, y: 10 }));
  assert.equal(moved.ok, false);
  assert.match(moved.ok ? '' : moved.reason, /성채/);
  assert.equal(validate(s, 'P1', at({ x: 12, y: 12 }, { x: 0, y: 9 })).ok, false, '중립 지대');
  assert.equal(validate(s, 'P1', at({ x: 12, y: 12 }, { x: 0, y: 15 })).ok, false, '판 밖(20행 판이라면 안쪽)');
});

// ── 판 경계 ─────────────────────────────────────────────────

test('판 경계 — 15행 판에서는 y 15 이상으로 걸어 나가지 않는다', () => {
  let s = raid([R('yu-bi', 'King'), R('gwan-u', 'Rock')], 1);
  s = place(s, { 'P1-Rock': { x: 0, y: 14 } });
  s = giveControl(s, U('P1-Rock'));
  const moves = legalMovesFor(s, U('P1-Rock'));
  assert.ok(moves.length > 0);
  assert.ok(moves.every((p) => p.y < RAID_BOARD.y && p.y >= 0), `판 밖: ${JSON.stringify(moves.filter((p) => p.y >= 15))}`);

  // 「자유이동」(맵 전체)도 이 판의 크기로 훑는다
  s.units[U('P1-Rock')]!.statuses.push({ status: 'freeMove' });
  const free = legalMovesFor(s, U('P1-Rock'));
  assert.equal(free.length, 25 * 15 - 3, '제자리 · 파수꾼 King · 도적 King을 뺀 전부');
  assert.ok(free.every((p) => p.y < 15));
});

test('AI끼리 끝까지 — 어느 판에서도 유닛이 판 밖에 서지 않는다', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const guards = GUARDS_5.slice(0, 1 + (seed % 5));
    const result = autoBattle(raid(guards, 1 + ((seed * 3) % 5), seed));
    assert.ok(['kingDown', 'wipeOut', 'timeLimit', 'draw'].includes(result.outcome));
    for (const ev of result.state.log) {
      if (ev.e !== 'moved') continue;
      assert.ok(ev.to.x >= 0 && ev.to.x < 25 && ev.to.y >= 0 && ev.to.y < 15, `seed ${seed}: ${JSON.stringify(ev.to)}`);
    }
  }
});

test('성채 — 그 칸에 선 유닛은 time 90마다 HP 1을 되찾는다', () => {
  let s = raid([R('yu-bi', 'King')], 1);
  s = apply(s, 'P2', { t: 'ready' }).state;
  s = apply(s, 'P1', { t: 'ready' }).state;
  s.units[U('P1-King')]!.hp = 5;
  let healed = false;
  for (let i = 0; i < 50 && s.phase !== 'finished' && s.time < 95; i++) {
    if (s.phase === 'control') s = apply(s, controllingSide(s, s.units[s.activeUnit!]!), { t: 'endTurn' }).state;
    else s = advanceTime(s).state;
    healed ||= s.log.some((e) => e.e === 'hpChanged' && e.unit === 'P1-King' && e.reason === 'terrain:holy');
  }
  assert.ok(healed, '성채 회복이 한 번도 안 일어났다');
});

// ── 재생 검증 ─────────────────────────────────────────────────

test('재생 검증 — 도적떼 판도 사람의 의도만으로 같은 결말이 나온다', () => {
  const guards = [R('yu-bi', 'King'), R('gwan-u', 'Rock')];
  const cfg = { matchId: 'raid-replay', seed: 5, mode: raidMode(guards.length), scenario: 'raid' as const };
  const rosters = { P1: guards, P2: banditRoster(3) };

  // 참조 — 사람(P1)은 언제나 차례만 넘긴다. 재생 쪽 구현과 독립으로 다시 적는다
  let state = createBattle({ ...cfg, rosters });
  const humanIntents: Intent[] = [];
  state = apply(state, 'P2', { t: 'ready' }).state;
  state = apply(state, 'P1', { t: 'ready' }).state;
  humanIntents.push({ t: 'ready' });
  for (let guard = 0; guard < 5_000 && state.phase !== 'finished'; guard++) {
    if (state.phase !== 'control') { state = advanceTime(state).state; continue; }
    const unit = state.units[state.activeUnit!]!;
    if (controllingSide(state, unit) === 'P1') {
      state = apply(state, 'P1', { t: 'endTurn' }).state;
      humanIntents.push({ t: 'endTurn' });
    } else {
      state = takeTurn(state).state;
    }
  }
  assert.equal(state.phase, 'finished');

  const replay = replayLocalMatch({ ...cfg, humanSide: 'P1', rosters, deploy: null, humanIntents });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.state.winner, state.winner);
  assert.deepEqual(replay.state.log, state.log);

  // scenario를 빼고 재생하면 같은 판이 아니다 — 인원 규칙부터 어긋난다
  const { scenario: _, ...asDuel } = cfg;
  assert.throws(() => replayLocalMatch({ ...asDuel, humanSide: 'P1', rosters, deploy: null, humanIntents }));
});
