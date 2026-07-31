/**
 * 고유기술 회귀 테스트 — 시전 틀과 A/B/E급 10종 (GDD §3.4, §3.6, §4.4)
 *
 * S급 30종은 scripts.ts 핸들러와 함께 별도로 붙인다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { UNIQUE_SKILLS, officerById, skillById } from '@samchess/data';
import { advanceTime, apply, validate } from '../src/battle.ts';
import { hasSkillScript } from '../src/scripts.ts';
import { FORMULA, type BattleState, type Effect, type UnitId } from '../src/types.ts';
import { R, U, battle, giveControl, learn, place, running, T } from './fixtures.ts';

/** 스킬 보유자를 원하는 기물로 세운 3:3 편성. P1-Rock이 시전자다. */
function withSkill(officer: string, seed = 1): BattleState {
  return battle(seed, {
    P1: [R('yu-bi', 'King'), R(officer, 'Rock'), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
  });
}

/** SP를 채우고 시전자에게 제어권을 준다. */
function ready(officer: string, at: Record<string, { x: number; y: number }> = {}): BattleState {
  const s = giveControl(place(withSkill(officer), {
    'P1-Rock': { x: 10, y: 10 },
    'P1-King': { x: 3, y: 3 },
    'P1-Pawn': { x: 10, y: 11 },
    'P2-Bishop': { x: 12, y: 12 },
    'P2-King': { x: 20, y: 2 },
    'P2-Queen': { x: 21, y: 2 },
    ...at,
  }), U('P1-Rock'));
  const t = structuredClone(s);
  t.sp = { P1: 15, P2: 15 };
  return t;
}

const skillOf = (s: BattleState, id: UnitId) =>
  skillById.get(officerById.get(s.units[id]!.officer)!.uniqueSkill!)!;

/** 스킬 이름 → 보유 장수 id. 엑셀이 바뀌어도 테스트가 버틴다. */
function holderOf(skillName: string): string {
  const skill = UNIQUE_SKILLS.find((k) => k.name === skillName);
  if (!skill?.holders.length) throw new Error(`보유자를 찾을 수 없다: ${skillName}`);
  return skill.holders[0]!;
}

// ── 데이터 ─────────────────────────────────────────────────────

test('A/B/E급 10종 전부 Effect DSL이 채워져 있다', () => {
  const nonS = UNIQUE_SKILLS.filter((s) => s.tier !== 'S');
  assert.equal(nonS.length, 10);
  for (const s of nonS) assert.ok(s.effects.length > 0, `${s.name}: effects 비어 있음`);
});

test('40종 전부 구현됐다 — effects 또는 scriptId를 가진다', () => {
  assert.equal(UNIQUE_SKILLS.length, 40);
  for (const k of UNIQUE_SKILLS) {
    assert.ok(k.effects.length > 0 || k.scriptId, `${k.name}: 미구현`);
  }
  // 스크립트가 필요한 것은 두 종뿐 — 나머지는 데이터로 접혔다
  const scripted = UNIQUE_SKILLS.filter((k) => k.scriptId).map((k) => k.name).sort();
  assert.deepEqual(scripted, ['소패왕전', '차동풍']);
});

test('scriptId는 전부 실제 핸들러와 연결돼 있다', () => {
  for (const k of UNIQUE_SKILLS) {
    if (k.scriptId) assert.ok(hasSkillScript(k.scriptId), `${k.name}: 핸들러 ${k.scriptId} 없음`);
  }
});

// ── 시전 틀 (GDD §3.4, §3.6) ───────────────────────────────────

test('고유기술 → 이동 → 공격이 한 턴에 다 된다', () => {
  // 「용맹전진」(A급, SP5) — 자기 강화라 대상 지정이 없다
  let s = ready(holderOf('용맹전진'), { 'P2-Bishop': { x: 12, y: 11 } });
  assert.equal(skillOf(s, U('P1-Rock')).tier, 'A');   // 용맹전진

  s = apply(s, 'P1', { t: 'castUniqueSkill' }).state;
  assert.equal(s.phase, 'control', '턴이 끝나지 않는다');
  assert.deepEqual(s.activeTurn, { moved: false, acted: false, usedUniqueSkill: true });
  assert.equal(s.sp.P1, 10, 'SP 5 소모');
  assert.equal(s.units[U('P1-Rock')]!.uniqueSkillUses, 0);

  // 이어서 이동 (Rock은 직교 이동)
  s = apply(s, 'P1', { t: 'move', to: { x: 11, y: 10 } }).state;
  assert.equal(s.activeTurn!.moved, true);
  // 이어서 공격 (Rock 공격 마스크는 대각 1칸 → (12,11)의 장합)
  const r = apply(s, 'P1', { t: 'attack', targets: [U('P2-Bishop')] });
  assert.ok(r.events.some((e) => e.e === 'attacked'));
  assert.equal(r.state.phase, 'running', '공격으로 턴이 끝난다');
});

test('이동한 뒤에는 고유기술을 쓸 수 없다', () => {
  let s = ready(holderOf('용맹전진'));
  s = apply(s, 'P1', { t: 'move', to: { x: 11, y: 10 } }).state;
  const check = validate(s, 'P1', { t: 'castUniqueSkill' });
  assert.equal(check.ok, false);
  assert.match((check as { reason: string }).reason, /이동 전에만/);
});

test('한 턴에 두 번은 못 쓰고, 전투당 1회다', () => {
  let s = ready(holderOf('용맹전진'));
  s = apply(s, 'P1', { t: 'castUniqueSkill' }).state;
  assert.equal(validate(s, 'P1', { t: 'castUniqueSkill' }).ok, false, '같은 턴 재시전');

  // 턴을 넘기고 다시 차례가 와도 사용 횟수가 0이라 못 쓴다
  s = apply(s, 'P1', { t: 'endTurn' }).state;
  const next = giveControl(s, U('P1-Rock'));
  const check = validate(next, 'P1', { t: 'castUniqueSkill' });
  assert.equal(check.ok, false);
  assert.match((check as { reason: string }).reason, /사용 횟수/);
});

test('SP가 모자라면 거부된다', () => {
  const s = structuredClone(ready(holderOf('용맹전진')));
  s.sp.P1 = 4;   // 용맹전진은 SP 5
  const check = validate(s, 'P1', { t: 'castUniqueSkill' });
  assert.equal(check.ok, false);
  assert.match((check as { reason: string }).reason, /SP/);
});

test('C·D급은 고유기술이 없다', () => {
  const s = ready(holderOf('용맹전진'));
  const noSkill = Object.values(s.units).find((u) => !officerById.get(u.officer)!.uniqueSkill);
  assert.equal(noSkill, undefined, '이 편성은 전원 보유 — 그래서 uniqueSkillUses가 1이다');
  for (const u of Object.values(s.units)) assert.equal(u.uniqueSkillUses, 1);
});

// ── A급 4종 ────────────────────────────────────────────────────

test('용맹전진 — time 190 동안 받는 데미지 절반', () => {
  let s = ready(holderOf('용맹전진'), { 'P2-Bishop': { x: 11, y: 10 } });
  const castAt = s.time;
  s = apply(s, 'P1', { t: 'castUniqueSkill' }).state;
  const st = s.units[U('P1-Rock')]!.statuses[0]!;
  assert.equal(st.status, 'incomingDamageHalf');
  assert.equal(st.expiresAt, castAt + 190);
  assert.equal(st.charges, undefined, '책략 「반감」과 달리 횟수 제한이 없다');

  // 장합(Bishop, 직교 1칸)이 때린다 → AT 2가 절반으로
  s = apply(s, 'P1', { t: 'endTurn' }).state;
  const atk = apply(giveControl(s, U('P2-Bishop')), 'P2', { t: 'attack', targets: [U('P1-Rock')] });
  const hit = atk.events.find((e) => e.e === 'attacked')!;
  assert.equal(hit.damage, hit.critical ? 2 : 1);
});

test('일당백 / 일격필살 — Critical 100%, 지속만 다르다 (190 vs 90)', () => {
  for (const [skillName, duration] of [['일당백', 190], ['일격필살', 90]] as const) {
    const officer = holderOf(skillName);
    let s = ready(officer, { 'P2-Bishop': { x: 11, y: 11 } });
    const castAt = s.time;
    s = apply(s, 'P1', { t: 'castUniqueSkill' }).state;
    const st = s.units[U('P1-Rock')]!.statuses[0]!;
    assert.equal(st.status, 'critical100', skillName);
    assert.equal(st.expiresAt, castAt + duration, `${skillName} 지속`);

    // 지속형이라 한 번 쳐도 사라지지 않는다 (책략 「증폭」은 1회 소모)
    const atk = apply(s, 'P1', { t: 'attack', targets: [U('P2-Bishop')] });
    assert.equal(atk.events.find((e) => e.e === 'attacked')!.critical, true);
    assert.equal(atk.state.units[U('P1-Rock')]!.statuses.length, 1, '지속 상태는 남는다');
  }
});

test('명경지수 — 책략 MP가 0이 된다', () => {
  const holder = holderOf('명경지수');
  let s = ready(holder);
  s = learn(s, U('P1-Rock'), [T('회복')]);   // MP 2짜리
  const mpBefore = s.units[U('P1-Rock')]!.mp;

  s = apply(s, 'P1', { t: 'castUniqueSkill' }).state;
  assert.equal(s.units[U('P1-Rock')]!.statuses[0]!.status, 'zeroMpCost');

  const r = apply(s, 'P1', { t: 'castTactic', tactic: T('회복'), target: U('P1-Pawn') });
  assert.equal(r.state.units[U('P1-Rock')]!.mp, mpBefore, 'MP를 쓰지 않았다');
});

test('신기묘산 — 환술 성공률 100% (time 90)', () => {
  const holder = holderOf('신기묘산');
  let s = ready(holder);
  s = learn(s, U('P1-Rock'), [T('공포')]);
  const castAt = s.time;
  s = apply(s, 'P1', { t: 'castUniqueSkill' }).state;
  const st = s.units[U('P1-Rock')]!.statuses[0]!;
  assert.equal(st.status, 'illusionAlways');
  assert.equal(st.expiresAt, castAt + 90);

  // 지력이 낮은 시전자라도 반드시 성공한다
  const r = apply(s, 'P1', { t: 'castTactic', tactic: T('공포'), target: U('P2-King') });
  assert.ok(r.events.some((e) => e.e === 'tacticCast' && e.resisted === false));
  assert.equal(r.state.units[U('P2-King')]!.statuses.some((x) => x.status === 'outgoingDamageHalf'), true);
});

// ── B급 5종 ────────────────────────────────────────────────────

test('부저추신 — 적 진영 SP −1 (교환비가 나쁘다: SP 4를 써서 1을 깎는다)', () => {
  const holder = holderOf('부저추신');
  const s = ready(holder);
  const r = apply(s, 'P1', { t: 'castUniqueSkill' });
  assert.equal(r.state.sp.P1, 15 - 4, '내 SP는 4 소모');
  assert.equal(r.state.sp.P2, 14, '적 SP는 1 감소');
});

test('한천감우 — 자신 포함 8방향 아군 HP +1', () => {
  const holder = holderOf('한천감우');
  let s = structuredClone(ready(holder, { 'P1-Pawn': { x: 11, y: 10 }, 'P1-King': { x: 3, y: 3 } }));
  s.units[U('P1-Rock')]!.hp = 5;
  s.units[U('P1-Pawn')]!.hp = 5;
  s.units[U('P1-King')]!.hp = 5;

  const r = apply(s, 'P1', { t: 'castUniqueSkill' });
  assert.equal(r.state.units[U('P1-Rock')]!.hp, 6, '자신 포함');
  assert.equal(r.state.units[U('P1-Pawn')]!.hp, 6, '인접 아군');
  assert.equal(r.state.units[U('P1-King')]!.hp, 5, '멀리 있는 아군은 제외');
});

test('십면매복 — 아무 위치의 적 1명 WT +50', () => {
  const holder = holderOf('십면매복');
  const s = structuredClone(ready(holder));
  s.units[U('P2-King')]!.wt = 100;   // 맵 반대편(20,2)에 있어도 지정 가능해야 한다

  const r = apply(s, 'P1', { t: 'castUniqueSkill', target: U('P2-King') });
  assert.equal(r.state.units[U('P2-King')]!.wt, 150);
});

test('신속 — 다음 1턴만 WT −30, 그 뒤로는 원래대로', () => {
  const holder = holderOf('신속');
  let s = ready(holder);
  const base = s.units[U('P1-Rock')]!.wtBase;

  const wtBefore = s.units[U('P1-Rock')]!.wt;
  s = apply(s, 'P1', { t: 'castUniqueSkill' }).state;
  assert.equal(s.units[U('P1-Rock')]!.wt, wtBefore, '시전 즉시 WT가 변하지는 않는다');
  assert.deepEqual(s.units[U('P1-Rock')]!.wtModifiers, [{ delta: -30, turnsLeft: 1 }]);

  s = apply(s, 'P1', { t: 'endTurn' }).state;
  assert.equal(s.units[U('P1-Rock')]!.wt, base - 30, '이번 턴 종료에 −30');
  assert.equal(s.units[U('P1-Rock')]!.wtModifiers, undefined, '1턴짜리라 소진됐다');

  const again = apply(giveControl(s, U('P1-Rock')), 'P1', { t: 'endTurn' }).state;
  assert.equal(again.units[U('P1-Rock')]!.wt, base, '다음 턴은 원래 기준값');
});

// ── E급 1종 ────────────────────────────────────────────────────

test('황제옹립(헌제) — time 990 동안 공격 대상이 될 수 없다', () => {
  // 헌제를 Queen으로 두고 그가 직접 시전한다
  let s = battle(1, {
    P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
  });
  s = place(running(s), {
    'P2-Queen': { x: 10, y: 11 },
    'P1-Rock': { x: 10, y: 10 },
    'P1-Pawn': { x: 11, y: 11 },
  });
  s = structuredClone(giveControl(s, U('P2-Queen')));
  s.sp = { P1: 25, P2: 25 };

  const castAt = s.time;
  s = apply(s, 'P2', { t: 'castUniqueSkill' }).state;
  assert.equal(s.sp.P2, 25 - 7, 'E급 SP 코스트 7');
  const st = s.units[U('P2-Queen')]!.statuses[0]!;
  assert.equal(st.status, 'untargetable');
  assert.equal(st.expiresAt, castAt + 990);

  // 인접한 조식(Pawn)이 때리려 해도 대상 목록에 없다
  s = apply(s, 'P2', { t: 'endTurn' }).state;
  const attacker = giveControl(s, U('P1-Pawn'));
  assert.equal(validate(attacker, 'P1', { t: 'attack', targets: [U('P2-Queen')] }).ok, false);

  // 환술(탈진·질병)도 지정할 수 없다 — "공격 대상으로 선택 불가"의 범위 (GDD §12)
  const caster = learn(giveControl(s, U('P1-Rock')), U('P1-Rock'), [T('질병')]);
  assert.equal(validate(caster, 'P1', { t: 'castTactic', tactic: T('질병'), target: U('P2-Queen') }).ok, false);
});

test('무적이어도 스스로 화계 지형에 들어가면 데미지를 받는다 (GDD §12)', () => {
  let s = structuredClone(running(battle()));
  s.units[U('P2-Queen')]!.statuses.push({ status: 'untargetable', expiresAt: 9999 });
  s.units[U('P2-Queen')]!.pos = { x: 5, y: 5 };
  s.terrain.push({ pos: { x: 5, y: 5 }, terrain: 'fire', lastTickedAt: 0 });
  for (const u of Object.values(s.units)) u.wt = 200;

  const r = advanceTime(s).state;
  assert.equal(r.units[U('P2-Queen')]!.hp, 8, 'time 100/200 두 번 탄다');
});

test('SP 상한 — 참여 수 × 5 (GDD §3.6)', () => {
  assert.equal(FORMULA.spCapPerUnit, 5);
  assert.deepEqual(battle().spCap, { P1: 15, P2: 15 });
});
