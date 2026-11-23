/**
 * 일기토 효과 · 설전 효과 (2026-11-23 기획자, GDD §3.11 R12 · R13) — 이긴 진영 전원에게 1일.
 *
 * - 일기토 효과(`duelBoon`): 내 공격은 크리티컬 100% · 공격으로 받는 데미지 절반
 * - 설전 효과(`debateBoon`): 책략 MP 소모 0 · 책략이 반드시 걸린다(지형 · 지원 · 환술 — 「결계」를 두른 상대의 환술만 막힌다)
 *
 * 「걸리는가」는 `duel.test.ts`가 보고, 여기서는 **걸린 뒤 판에서 무엇이 달라지는가**를 본다.
 * 확정 판정은 **굴리지 않는다** — `rngCursor`가 안 밀린다(리플레이 규약).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceTime, apply } from '../src/battle.ts';
import { illusionChance, tacticMpCost } from '../src/effects.ts';
import { forecastAttack, legalTargetsFor } from '../src/state.ts';
import { FORMULA, type BattleState, type StatusId, type TacticId, type UnitId } from '../src/types.ts';
import { R, U, battle, giveControl, place } from './fixtures.ts';

const ROCK = U('P1-Rock');     // 관우
const FOE = U('P2-Bishop');    // 장합

/** 관우의 차례, 장합이 공격 범위 안. 관우 · 장합 둘 다 책략을 안다 */
function board(tactics: TacticId[] = []): BattleState {
  return giveControl(place(battle(1, {
    P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock', 1, [], tactics), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop', 1, [], tactics), R('heon-je', 'Queen')],
  }), {
    'P1-Rock': { x: 10, y: 10 }, 'P2-Bishop': { x: 11, y: 11 },
    'P1-King': { x: 2, y: 2 }, 'P1-Pawn': { x: 10, y: 11 },
    'P2-King': { x: 22, y: 17 }, 'P2-Queen': { x: 18, y: 17 },
  }), ROCK);
}

const give = (s: BattleState, id: UnitId, status: StatusId, extra: object = {}): void => {
  s.units[id]!.statuses.push({ status, expiresAt: s.time + FORMULA.duelBoonTime, ...extra });
};

test('일기토 효과 — 공격은 반드시 크리티컬이고 굴리지 않는다 · 확인창과 실제가 같다', () => {
  const s = board();
  const target = legalTargetsFor(s, ROCK).includes(FOE) ? FOE : legalTargetsFor(s, ROCK)[0]!;
  const plain = forecastAttack(s, ROCK, target)!;
  assert.ok(plain.criticalRate < 100, '표본은 평소 크리가 확정이 아니다');
  give(s, ROCK, 'duelBoon');
  const f = forecastAttack(s, ROCK, target)!;
  assert.equal(f.criticalRate, 100);
  assert.equal(f.critical, plain.critical, '크리 한 대의 크기는 그대로');

  const r = apply(s, 'P1', { t: 'attack', targets: [target] });
  const hit = r.events.find((e) => e.e === 'attacked')!;
  assert.ok(hit.e === 'attacked' && hit.critical);
  assert.equal(hit.damage, f.critical);
  assert.equal(r.state.rngCursor, s.rngCursor, '확정 크리는 난수를 안 쓴다');
});

test('일기토 효과 — 맞는 쪽이면 받는 데미지가 절반 · 「증폭」 · 「반감」의 횟수는 아낀다', () => {
  const s = board();
  const target = legalTargetsFor(s, ROCK).includes(FOE) ? FOE : legalTargetsFor(s, ROCK)[0]!;
  const plain = forecastAttack(s, ROCK, target)!;
  give(s, target, 'duelBoon');
  const halved = forecastAttack(s, ROCK, target)!;
  assert.ok(halved.halved);
  assert.equal(halved.normal, FORMULA.damage(2, false, true, false), 'AT 2 평타 → 반감');
  assert.ok(halved.normal <= plain.normal);

  // 둘 다 일기토 효과 + 횟수형 증폭 · 반감 — 효과가 이미 정하니 횟수는 안 깎인다
  give(s, ROCK, 'duelBoon');
  s.units[ROCK]!.statuses.push({ status: 'critical100', charges: 2 });
  s.units[target]!.statuses.push({ status: 'incomingDamageHalf', charges: 2 });
  const r = apply(s, 'P1', { t: 'attack', targets: [target] });
  assert.equal(r.state.units[ROCK]!.statuses.find((x) => x.status === 'critical100')?.charges, 2);
  assert.equal(r.state.units[target]!.statuses.find((x) => x.status === 'incomingDamageHalf')?.charges, 2);
});

test('설전 효과 — 책략 MP 0, 지형 · 지원 · 환술 모두 100% (결계를 두른 상대의 환술만 0) · 표시와 판정이 같고 굴리지 않는다', () => {
  const T = (id: string): TacticId => id as TacticId;
  const s = board([T('hoe-bok'), T('hwa-gye'), T('gong-po')]);
  s.units[ROCK]!.mp = 0;
  give(s, ROCK, 'debateBoon');
  for (const id of ['hoe-bok', 'hwa-gye', 'gong-po']) assert.equal(tacticMpCost(s.units[ROCK]!, T(id)), 0, id);
  assert.equal(illusionChance(s, ROCK, T('hoe-bok'), U('P1-Pawn')), 100, '지원');
  assert.equal(illusionChance(s, ROCK, T('hwa-gye'), undefined), 100, '지형');
  assert.equal(illusionChance(s, ROCK, T('gong-po'), FOE), 100, '환술');

  // MP 0인데 환술이 걸린다 — 난수 없이
  const r = apply(s, 'P1', { t: 'castTactic', tactic: T('gong-po'), target: FOE });
  const cast = r.events.find((e) => e.e === 'tacticCast')!;
  assert.ok(cast.e === 'tacticCast' && !cast.resisted);
  assert.equal(r.state.units[ROCK]!.mp, 0);
  assert.equal(r.state.rngCursor, s.rngCursor, '확정 판정은 난수를 안 쓴다');
  assert.ok(r.state.units[FOE]!.statuses.some((x) => x.status === 'outgoingDamageHalf'));

  // 결계 — 환술은 막힌다(좌도방술과 같은 규약)
  const ward = board([T('gong-po')]);
  give(ward, ROCK, 'debateBoon');
  ward.units[FOE]!.statuses.push({ status: 'illusionImmune' });
  assert.equal(illusionChance(ward, ROCK, T('gong-po'), FOE), 0);
  const blocked = apply(ward, 'P1', { t: 'castTactic', tactic: T('gong-po'), target: FOE }).events.find((e) => e.e === 'tacticCast')!;
  assert.ok(blocked.e === 'tacticCast' && blocked.resisted);
});

test('효과는 1일 — 시간이 흐르면 풀린다', () => {
  const s = board();
  for (const u of Object.values(s.units)) if (u.side === 'P1') give(s, u.id, 'duelBoon');
  // 차례를 그냥 넘긴다 — 제어를 받은 장수의 WT를 처음 값으로 되돌리고 시간을 다시 흘린다
  const pass = (y: BattleState): BattleState => {
    const z = structuredClone(y);
    if (z.activeUnit) z.units[z.activeUnit]!.wt = z.units[z.activeUnit]!.wtBase;
    return { ...z, phase: 'running', activeUnit: null, activeTurn: null } as BattleState;
  };
  let x = pass(s);
  const until = s.time + FORMULA.duelBoonTime;
  let expired = false;
  for (let i = 0; i < 400 && !expired; i++) {
    const r = advanceTime(x);
    x = r.state;
    if (r.events.some((e) => e.e === 'statusExpired' && e.status === 'duelBoon')) expired = true;
    if (x.phase === 'control') x = pass(x);
  }
  assert.ok(expired, '풀리는 이벤트가 온다');
  assert.ok(x.time >= until);
  assert.ok(!Object.values(x.units).some((u) => u.statuses.some((st) => st.status === 'duelBoon')));
});
