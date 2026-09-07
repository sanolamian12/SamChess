/**
 * 시전 지연 회귀 (2026-09-07 확정) — 「고유기술을 시전하는 데는 시간이 걸린다」
 *
 * 규칙은 셋이다.
 *   1. 지연 대상(`castDelay > 0`)은 **시전한 자리에서 턴이 끝나고** WT가 그 값이 된다.
 *   2. **제어권이 돌아오는 바로 그 순간** 효과가 발동하고, 지속시간도 그때부터 센다.
 *   3. 그 사이에 시전자가 죽으면 **무산**된다 — SP·사용횟수는 안 돌려준다.
 *
 * ★ 이 파일은 **지연을 아는 유일한 회귀**다. 다른 스킬 회귀는 `castSkill()`
 *   픽스처가 지연을 삼켜 주므로, 엔진에서 지연을 걷어내도 **여기만 깨진다.**
 *   그래서 「지연이 없어도 통과하는」 검사를 여기에 두지 않는다 —
 *   지연을 지우고 돌려서 아래 전부가 깨지는 것을 확인했다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { UNIQUE_SKILLS, skillById } from '@samchess/data';
import { advanceTime, apply } from '../src/battle.ts';
import { takeTurn } from '../src/ai.ts';
import { findStatus } from '../src/state.ts';
import { type BattleState, type UnitId } from '../src/types.ts';
import { R, U, battle, giveControl, place } from './fixtures.ts';

const holderOf = (name: string): string =>
  UNIQUE_SKILLS.find((k) => k.name === name)!.holders[0]!;

const DELAY = skillById.get(UNIQUE_SKILLS.find((k) => k.name === '온주참화웅')!.id)!.castDelay;

/** 시전자를 P1-Rock에 세우고 SP를 채운 뒤 제어권을 준다. */
function ready(skillName: string, at: Record<string, { x: number; y: number }> = {}): BattleState {
  const s = battle(1, {
    P1: [R('yu-bi', 'King'), R(holderOf(skillName), 'Rock'), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
  });
  const t = structuredClone(giveControl(place(s, {
    'P1-King': { x: 3, y: 3 }, 'P1-Rock': { x: 10, y: 10 }, 'P1-Pawn': { x: 10, y: 11 },
    'P2-King': { x: 20, y: 2 }, 'P2-Bishop': { x: 11, y: 11 }, 'P2-Queen': { x: 21, y: 2 },
    ...at,
  }), U('P1-Rock')));
  t.sp = { P1: 15, P2: 15 };
  return t;
}

const cast = (s: BattleState, target?: UnitId) =>
  apply(s, 'P1', { t: 'castUniqueSkill', ...(target !== undefined ? { target } : {}) });

// ── 1. 시전은 턴을 끝내고 WT를 고정한다 ────────────────────────

test('지연 기술은 시전한 자리에서 턴이 끝나고 WT가 castDelay가 된다', () => {
  const s = ready('온주참화웅');
  const before = s.units[U('P1-Rock')]!;
  const r = cast(s);
  const kwan = r.state.units[U('P1-Rock')]!;

  assert.equal(kwan.wt, DELAY, `WT는 기준값(${before.wtBase})이 아니라 ${DELAY}`);
  assert.equal(r.state.activeUnit, null, '턴이 끝났다');
  assert.equal(r.state.phase, 'running');
  assert.ok(kwan.casting, '시전 중 표식이 선다');

  // ★ 아직 효과가 없다 — 여기가 「시전하고 곧바로 죽인다」를 막는 자리다
  assert.equal(findStatus(kwan, 'instantKillNext'), undefined, '아직 확정사가 안 붙었다');
  assert.equal(r.events.some((e) => e.e === 'uniqueSkillCast'), true, '연출은 시전 때 뜬다');
  assert.equal(r.events.some((e) => e.e === 'uniqueSkillResolved'), false, '발동은 아직');
});

test('지연이 없는 기술은 종전대로 — 즉시 걸리고 턴도 안 끝난다', () => {
  const s = ready('용맹전진');
  const r = cast(s);
  assert.equal(skillById.get(UNIQUE_SKILLS.find((k) => k.name === '용맹전진')!.id)!.castDelay, 0);
  assert.equal(r.state.activeUnit, U('P1-Rock'), '이어서 이동·행동을 한다');
  assert.ok(findStatus(r.state.units[U('P1-Rock')]!, 'incomingDamageHalf'), '즉시 걸린다');
  assert.equal(r.state.units[U('P1-Rock')]!.casting, undefined);
});

// ── 2. 발동은 제어권과 함께 온다 ───────────────────────────────

test('castDelay가 지나 제어권이 돌아오는 순간 발동한다 — 지속도 그때부터', () => {
  let s = ready('일당백');
  const castAt = s.time;
  s = cast(s).state;

  const r = advanceTime(s);
  const kwan = r.state.units[U('P1-Rock')]!;
  assert.equal(r.state.activeUnit, U('P1-Rock'), '제어권이 돌아왔다');
  assert.equal(kwan.casting, undefined, '표식이 걷혔다');

  const st = findStatus(kwan, 'critical100')!;
  assert.ok(st, '이제 걸린다');
  // 지속 190은 **발동 시점**부터. 시전 시점부터면 castAt + 190 = 190이 된다
  assert.equal(st.expiresAt, r.state.time + 190);
  assert.notEqual(st.expiresAt, castAt + 190, '시전 시점부터 세면 안 된다');

  // 발동 → 제어권 순서가 이벤트에도 남는다
  const resolved = r.events.findIndex((e) => e.e === 'uniqueSkillResolved');
  const granted = r.events.findIndex((e) => e.e === 'controlGranted');
  assert.ok(resolved >= 0 && granted > resolved, '발동이 제어권보다 먼저다');
});

test('관우 — 시전 직후에는 못 죽이고, 30 뒤 돌아온 턴에 죽인다', () => {
  let s = ready('온주참화웅');
  s.units[U('P2-Bishop')]!.hp = 99;
  s.units[U('P2-Bishop')]!.maxHp = 99;

  s = cast(s).state;
  s = advanceTime(s).state;
  assert.equal(s.activeUnit, U('P1-Rock'));

  const hit = apply(s, 'P1', { t: 'attack', targets: [U('P2-Bishop')] });
  assert.equal(hit.state.units[U('P2-Bishop')]!.alive, false, 'HP 99라도 즉사');
});

test('발동이 판을 끝내면 제어권을 주지 않는다 — 장료지제가 마지막 적을 칠 때', () => {
  let s = ready('장료지제');
  for (const id of ['P2-King', 'P2-Bishop', 'P2-Queen']) s.units[U(id)]!.hp = 1;
  s = cast(s).state;

  const r = advanceTime(s);
  assert.equal(r.state.phase, 'finished');
  assert.equal(r.state.winner, 'P1');
  assert.equal(r.state.activeUnit, null, '끝난 판에 제어권을 주지 않는다');
});

test('장료지제는 발동 시점에 살아 있는 적만 센다 — 시전 시점이 아니다', () => {
  let s = ready('장료지제');
  s = cast(s).state;
  // 시전한 뒤, 발동 전에 적 하나가 사라진다
  s = structuredClone(s);
  s.units[U('P2-Queen')]!.alive = false;
  s.units[U('P2-Queen')]!.hp = 0;

  const r = advanceTime(s);
  const struck = new Set(r.events.filter((e) => e.e === 'attacked').map((e) => e.target));
  assert.equal(struck.has(U('P2-Queen')), false, '죽은 적은 안 친다');
  assert.equal(struck.has(U('P2-Bishop')), true);
});

// ── 3. WT를 미는 기술이 시전을 밀어낸다 ────────────────────────

test('시전 중인 적의 WT를 밀면 발동이 그만큼 늦어진다 (십면매복·장판하뢰)', () => {
  let s = ready('온주참화웅');
  s = cast(s).state;
  assert.equal(s.units[U('P1-Rock')]!.wt, DELAY);

  // 「관우의 WT 30에 150이 더해져 180이 된 상태에서 다시 감소하기 시작한다」
  s = structuredClone(s);
  s.units[U('P1-Rock')]!.wt += 150;

  // 상대가 먼저 차례를 받는다 — 시전은 아직 안 끝났다
  const r = advanceTime(s);
  assert.notEqual(r.state.activeUnit, U('P1-Rock'), '관우 차례가 아니다');
  assert.ok(r.state.units[U('P1-Rock')]!.casting, '아직 시전 중');
  assert.equal(findStatus(r.state.units[U('P1-Rock')]!, 'instantKillNext'), undefined);
});

// ── 4. 시전 중 사망 = 무산 ─────────────────────────────────────

test('시전 중에 죽으면 무산된다 — SP도 사용횟수도 안 돌려준다', () => {
  let s = ready('온주참화웅');
  const spBefore = s.sp.P1;
  s = cast(s).state;
  assert.equal(s.sp.P1, spBefore - 6, 'S급 6 소모');
  assert.equal(s.units[U('P1-Rock')]!.uniqueSkillUses, 0, '사용횟수도 나갔다');

  // 발동 전에 죽인다 — 장합을 관우의 옆칸(Bishop이 닿는 자리)으로 옮긴다
  const dead = structuredClone(s);
  dead.units[U('P2-Bishop')]!.pos = { x: 11, y: 10 };
  dead.units[U('P1-Rock')]!.hp = 1;
  const r = apply(giveControl(dead, U('P2-Bishop')), 'P2', { t: 'attack', targets: [U('P1-Rock')] });

  const corpse = r.state.units[U('P1-Rock')]!;
  assert.equal(corpse.alive, false);
  assert.equal(corpse.casting, undefined, '예약이 무산됐다');
  assert.ok(r.events.some((e) => e.e === 'uniqueSkillFizzled'), '무산을 알린다');
  assert.equal(r.state.sp.P1, spBefore - 6, 'SP는 안 돌아온다');
  assert.equal(corpse.uniqueSkillUses, 0, '사용횟수도 안 돌아온다');
});

// ── 5. AI가 지연 기술을 써도 죽지 않는다 ───────────────────────

test('AI는 지연 기술을 시전하면 그 턴을 거기서 접는다', () => {
  // 가드가 없으면 activeUnit이 null인 채로 공격을 시도해 apply()가 던진다
  const s = ready('온주참화웅');
  const r = takeTurn(s);
  assert.ok(r.events.some((e) => e.e === 'uniqueSkillCast'), 'AI가 시전했다');
  assert.equal(r.state.activeUnit, null, '턴이 끝났다');
  assert.equal(r.events.some((e) => e.e === 'attacked'), false, '이어서 때리지 않는다');
});

// ── 6. 데이터 계약 ─────────────────────────────────────────────

test('지연 대상 13종은 전부 대상 지정이 없다 — 그래서 스킬 id만 실으면 된다', () => {
  const delayed = UNIQUE_SKILLS.filter((k) => k.castDelay > 0);
  assert.equal(delayed.length, 13);
  assert.equal(delayed.reduce((n: number, k) => n + k.holders.length, 0), 36, '보유 36명');

  for (const k of delayed) {
    assert.equal(k.castDelay, DELAY, `${k.name} — 값은 한 벌이다`);
    for (const e of k.effects as { target?: { kind: string } }[]) {
      const kind = e.target?.kind;
      assert.ok(
        kind === undefined || kind === 'self' || kind === 'allAllies' || kind === 'allEnemies',
        `${k.name}: 단일 대상(${kind})을 지연시키려면 대상 id도 함께 실어야 한다`,
      );
    }
  }
});

