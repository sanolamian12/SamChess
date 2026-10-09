/**
 * 화면이 묻는 것 — 전투 UI 개편 1단계 (2026-09-27, `src/commands.ts`)
 *
 * 순서 예보는 **엔진을 실제로 돌려 본 순서와 맞춰 본다** — 예보가 제 셈만 믿으면
 * 엔진의 `endTurn()` 순서(시간 1 → WT 되돌리기)가 바뀌었을 때 화면만 조용히 틀린다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OFFICERS } from '@samchess/data';
import { advanceTime, apply, createBattle, validate } from '../src/battle.ts';
import {
  canCast, castCandidates, commandsFor, meditateGain, skillStatus, turnForecast,
} from '../src/commands.ts';
import { legalMovesFor } from '../src/state.ts';
import type { BattleState, OfficerId, PieceType, RosterEntry, UnitId } from '../src/types.ts';
import { R, T, U, battle, giveControl, learn, runTurns, running } from './fixtures.ts';

/** 5v5 — 명단 앞에서부터 열 명 */
function battle5(seed: number): BattleState {
  const pieces: PieceType[] = ['King', 'Queen', 'Rock', 'Bishop', 'Knight'];
  const ids = OFFICERS.filter((o) => o.portrait !== '').slice(0, 10).map((o) => o.id as OfficerId);
  const roster = (from: number): RosterEntry[] => pieces.map((p, i) => R(ids[from + i]!, p));
  return createBattle({ matchId: 't', seed, mode: '5v5', rosters: { P1: roster(0), P2: roster(5) } });
}

// ── 순서 예보 ──────────────────────────────────────────────────

test('순서 예보는 엔진이 실제로 준 제어권 순서와 같다 (3v3 · 5v5, 여러 시드)', () => {
  for (let seed = 1; seed <= 12; seed++) {
    for (const s of [running(battle(seed)), running(battle5(seed))]) {
      const expect = runTurns(s, 15).order;
      const got = turnForecast(s, 15).map((x) => x.unit);
      assert.deepEqual(got, expect, `seed ${seed} ${s.mode}`);
    }
  }
});

test('지금 차례가 있으면 첫 줄이 그 유닛이고(active, at 0), 뒤는 엔진 순서다', () => {
  const ctl = advanceTime(running(battle5(3))).state;   // 엔진이 준 첫 제어권
  const first = ctl.activeUnit!;
  const slots = turnForecast(ctl, 8);
  assert.equal(slots[0]!.unit, first);
  assert.equal(slots[0]!.active, true);
  assert.equal(slots[0]!.at, 0);
  assert.ok(slots.slice(1).every((x) => !x.active));
  // 뒤따르는 순서 = 그 차례를 그냥 넘기고 엔진을 돌린 순서
  const ended = apply(ctl, ctl.units[first]!.side, { t: 'endTurn' }).state;
  assert.deepEqual(slots.slice(1).map((x) => x.unit), runTurns(ended, 7).order);
});

test('예보의 시각은 줄지 않고, 통솔이 높은 장수는 두 번 나올 수 있다', () => {
  const slots = turnForecast(running(battle5(1)), 20);
  assert.equal(slots.length, 20);
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i]!.at >= slots[i - 1]!.at);
  const counts = new Map<UnitId, number>();
  for (const x of slots) counts.set(x.unit, (counts.get(x.unit) ?? 0) + 1);
  assert.ok([...counts.values()].some((n) => n >= 2), '20줄이면 누군가는 두 번 온다');
});

test('WT가 전부 같으면 예보도 엔진도 동점 순번대로 — 난수를 안 쓴다', () => {
  const s = running(battle5(9));
  for (const u of Object.values(s.units)) u.wt = 50;
  const byRank = Object.values(s.units).sort((a, b) => a.turnRank - b.turnRank).map((u) => u.id);
  const slots = turnForecast(s, 10).map((x) => x.unit);
  assert.deepEqual(slots, byRank);
  assert.deepEqual(runTurns(s, 10).order, byRank);
  assert.equal(runTurns(s, 10).state.rngCursor, s.rngCursor, '차례를 넘기기만 하면 난수 소비 없음');
});

test('WT 보정(병귀신속 류)도 예보에 들어간다', () => {
  const s = running(battle(4));
  // 가장 느린 장수를 크게 당겨야 순서가 실제로 뒤바뀐다(작은 보정은 순서를 안 바꿔 검사가 헛돈다)
  const slow = Object.values(s.units).sort((a, b) => b.wtBase - a.wtBase)[0]!;
  s.units[slow.id]!.wtModifiers = [{ delta: -(slow.wtBase - 5), turnsLeft: 3 }];
  const expect = runTurns(s, 12).order;
  assert.deepEqual(turnForecast(s, 12).map((x) => x.unit), expect);
  const plain = running(battle(4));
  assert.notDeepEqual(runTurns(plain, 12).order, expect, '보정이 순서를 실제로 바꾸는 판이어야 검사가 산다');
});

test('차례를 마칠 때 흐르는 시간 1이 예보에 들어간다 — 1 차이 동점', () => {
  // X가 차례를 마치면 기준값으로 돌아가고, Y는 그 1만큼 더 줄어 **X와 동점**이 된다.
  // 동점 순번은 Y가 앞이도록 맞춘다 — 시간 1을 빼먹으면 X가 먼저 나온다.
  const base = running(battle(6));
  const [x, y] = Object.values(base.units).slice(0, 2);
  const s = giveControl(base, x!.id);
  for (const u of Object.values(s.units)) u.wt = 999;
  s.units[x!.id]!.wt = 0;
  s.units[y!.id]!.wt = s.units[x!.id]!.wtBase + 1;
  (s.units[x!.id] as { turnRank: number }).turnRank = 1;
  (s.units[y!.id] as { turnRank: number }).turnRank = 0;
  const slots = turnForecast(s, 3).map((z) => z.unit);
  assert.deepEqual(slots, [x!.id, y!.id, x!.id]);
  const ended = apply(s, s.units[x!.id]!.side, { t: 'endTurn' }).state;
  assert.deepEqual(slots.slice(1), runTurns(ended, 2).order);
});

test('죽은 유닛은 예보에 없다', () => {
  const s = running(battle(2));
  s.units[U('P2-King')]!.alive = false;
  assert.ok(turnForecast(s, 10).every((x) => x.unit !== U('P2-King')));
});

// ── 고유기술 상태 ──────────────────────────────────────────────

test('고유기술 상태 — 봉인 > 다 씀 > SP 부족 > 준비', () => {
  const s = giveControl(battle(), U('P1-Rock'));
  const id = U('P1-Rock');
  s.sp.P1 = 0;
  assert.equal(skillStatus(s, id), 'poor');
  s.sp.P1 = s.spCap.P1;
  assert.equal(skillStatus(s, id), 'ready');
  s.units[id]!.uniqueSkillUses = 0;
  assert.equal(skillStatus(s, id), 'used');
  s.units[id]!.statuses.push({ status: 'skillSealed' });
  assert.equal(skillStatus(s, id), 'sealed', '봉인은 다 쓴 것보다 먼저');
  assert.equal(skillStatus(s, U('없는-유닛')), 'none');
});

// ── 명상 ──────────────────────────────────────────────────────

test('명상 회복량은 실제로 오르는 만큼이다', () => {
  const s = giveControl(battle(), U('P1-Rock'));
  const u = s.units[U('P1-Rock')]!;
  u.mp = u.maxMp;
  assert.equal(meditateGain(s, u.id), 0);
  u.mp = u.maxMp - 1;
  const gain = meditateGain(s, u.id);
  assert.equal(gain, 1);
  u.mp = 0;
  const r = apply(s, 'P1', { t: 'meditate' });
  assert.equal(r.state.units[u.id]!.mp, meditateGain(s, u.id), '확인창의 숫자 = 실제 증가량');
});

// ── 명령 여섯 칸 ──────────────────────────────────────────────

test('명령 칸은 제어권을 쥔 진영에게만 있다', () => {
  const s = giveControl(battle(), U('P1-Rock'));
  assert.ok(commandsFor(s, 'P1'));
  assert.equal(commandsFor(s, 'P2'), null);
  assert.equal(commandsFor(running(battle()), 'P1'), null, '제어 단계가 아니면 없다');
});

test('명령 칸의 켜짐은 validate()와 같다 — 이동하면 이동이 꺼진다', () => {
  const s = giveControl(battle(), U('P1-Rock'));
  const c = commandsFor(s, 'P1')!;
  assert.equal(c.move, true);
  assert.equal(c.endTurn, true);
  assert.equal(c.meditate, validate(s, 'P1', { t: 'meditate' }).ok);

  const to = legalMovesFor(s, U('P1-Rock'))[0]!;
  const moved = apply(s, 'P1', { t: 'move', to }).state;
  assert.equal(commandsFor(moved, 'P1')!.move, false);
});

test('책략 칸은 쓸 수 있는 책략이 하나라도 있을 때만 켜진다', () => {
  const none = giveControl(battle(), U('P1-Pawn'));
  assert.equal(commandsFor(none, 'P1')!.castTactic, false, '배운 책략이 없다');

  const s = giveControl(learn(battle(), U('P1-Pawn'), [T('증폭')]), U('P1-Pawn'));
  const c = commandsFor(s, 'P1')!;
  assert.equal(c.tactics[T('증폭')], canCast(s, 'P1', U('P1-Pawn'), 'tactic', T('증폭')));
  assert.equal(c.castTactic, Object.values(c.tactics).some(Boolean));

  s.units[U('P1-Pawn')]!.mp = 0;
  const poor = commandsFor(s, 'P1')!;
  assert.equal(poor.tactics[T('증폭')], false, 'MP가 없으면 못 쓴다');
  assert.equal(poor.castTactic, false);
});

test('조준 후보는 하나하나 validate()를 통과한 것뿐이다', () => {
  const s = giveControl(learn(battle(), U('P1-Pawn'), [T('증폭')]), U('P1-Pawn'));
  for (const target of castCandidates(s, 'P1', U('P1-Pawn'), 'tactic', T('증폭'))) {
    assert.ok(validate(s, 'P1', { t: 'castTactic', tactic: T('증폭'), target }).ok);
  }
});

// ── 4단계 (2026-10-06) ─────────────────────────────────────────

test('[공격]은 대상이 없어도 열린다 — attack이 참이면 attackOpen도 참', () => {
  for (let seed = 1; seed <= 6; seed++) {
    let s = advanceTime(running(battle5(seed))).state;
    for (let i = 0; i < 20 && !s.winner; i++) {
      const side = s.units[s.activeUnit!]!.side;
      const c = commandsFor(s, side)!;
      if (c.attack) assert.ok(c.attackOpen, `seed ${seed}`);
      // [아이템]도 같은 짝이다 (2026-10-09) — 「쓸 수 있다」면 언제나 「열 수 있다」
      if (c.useItem) assert.ok(c.useItemOpen, `seed ${seed}`);
      s = apply(s, side, { t: 'endTurn' }).state;
      while (s.phase !== 'control' && !s.winner) s = advanceTime(s).state;
    }
  }
  const s = giveControl(battle(), U('P1-Rock'));
  assert.equal(commandsFor(s, 'P1')!.attackOpen, true);
  s.activeTurn!.acted = true;
  assert.equal(commandsFor(s, 'P1')!.attackOpen, false, '이미 행동했다');
});

test('시전 이벤트에 겨눈 장수가 실린다 — 칸을 겨눈 것엔 없다 (적 차례의 대상 카드)', () => {
  let unitAimed = 0;
  for (const name of ['공포', '증폭', '화계', '회복']) {
    const tactic = T(name);
    const s = giveControl(learn(battle(), U('P1-Pawn'), [tactic]), U('P1-Pawn'));
    s.units[U('P1-Pawn')]!.mp = s.units[U('P1-Pawn')]!.maxMp;
    const target = castCandidates(s, 'P1', U('P1-Pawn'), 'tactic', tactic)[0];
    if (target === undefined && !validate(s, 'P1', { t: 'castTactic', tactic }).ok) continue;
    const ev = apply(s, 'P1', { t: 'castTactic', tactic, ...(target === undefined ? {} : { target }) })
      .events.find((e) => e.e === 'tacticCast');
    assert.ok(ev && ev.e === 'tacticCast', name);
    if (typeof target === 'string') { assert.equal(ev.target, target, name); unitAimed++; }
    else assert.equal('target' in ev, false, `${name} — 장수를 겨누지 않았다`);
  }
  assert.ok(unitAimed > 0, '장수를 겨누는 책략이 하나는 있어야 검사가 산다');
});
