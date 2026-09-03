/**
 * 책략 16종 회귀 테스트 — Effect DSL (GDD §3.7)
 *
 * 사양의 단일 출처는 `tools/extract_data.py`의 `TACTIC_EFFECTS`다.
 * 여기서는 그 데이터가 엔진에서 의도대로 굴러가는지를 본다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TACTICS, officerById, tacticById } from '@samchess/data';
import { advanceTime, apply, legalMovesFor, legalTargetsFor, validate } from '../src/battle.ts';
import { aimingSpec, illusionChance, isTerrainTactic } from '../src/effects.ts';
import { FORMULA, type BattleState, type Effect, type TacticId, type UnitId } from '../src/types.ts';
import { R, T, U, battle, giveControl, learn, place } from './fixtures.ts';

/** 관우(Rock)가 책략을 배운 편성. 조식은 Pawn, 유비는 King. */
function withTactics(p1: TacticId[], p2: TacticId[] = []): BattleState {
  return battle(1, {
    P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock', 1, [], p1), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop', 1, [], p2), R('heon-je', 'Queen')],
  });
}

/** 관우에게 제어권을 주고 지정 위치에 세운다. */
function caster(tactics: TacticId[], at: Record<string, { x: number; y: number }> = {}): BattleState {
  return giveControl(place(withTactics(tactics), {
    'P1-Rock': { x: 10, y: 10 },
    'P1-King': { x: 3, y: 3 },
    'P1-Pawn': { x: 10, y: 11 },
    'P2-Bishop': { x: 12, y: 12 },
    'P2-King': { x: 20, y: 2 },
    'P2-Queen': { x: 21, y: 2 },
    ...at,
  }), U('P1-Rock'));
}

const cast = (s: BattleState, tactic: TacticId, target?: UnitId | { x: number; y: number }) =>
  apply(s, 'P1', { t: 'castTactic', tactic, ...(target !== undefined ? { target } : {}) });

// ── 데이터 정합성 ──────────────────────────────────────────────

test('16종 전부 Effect DSL이 채워져 있다', () => {
  assert.equal(TACTICS.length, 16);
  for (const t of TACTICS) {
    assert.ok(t.effects.length > 0, `${t.name}: effects 비어 있음`);
    for (const e of t.effects as Effect[]) assert.ok(e.t, `${t.name}: 효과에 t가 없다`);
  }
});

test('조준 규약 — 환술은 반드시 적 1명을 겨눈다', () => {
  for (const t of TACTICS) {
    const spec = aimingSpec(t.effects as Effect[]);
    if (t.school === 'illusion') {
      assert.equal(spec?.kind, 'enemyOne', t.name);
      continue;
    }
    // 지원은 아군 1명 또는 칸을 겨눈다. 「대회복」만 범위형이라 조준이 없다.
    if (t.name === '대회복') assert.equal(spec, undefined);
    else assert.ok(spec?.kind === 'allyOne' || spec?.kind === 'tile', `${t.name}: ${spec?.kind}`);
  }
});

// ── 시전 공통 규칙 ─────────────────────────────────────────────

test('습득하지 않은 책략 · MP 부족 · 잘못된 대상은 거부된다', () => {
  const s = caster([T('증폭')]);
  assert.equal(validate(s, 'P1', { t: 'castTactic', tactic: T('공포'), target: U('P2-Bishop') }).ok, false);
  assert.equal(validate(s, 'P1', { t: 'castTactic', tactic: T('증폭'), target: U('P2-Bishop') }).ok, false, '적에게 아군 버프');
  assert.equal(validate(s, 'P1', { t: 'castTactic', tactic: T('증폭') }).ok, false, '대상 미지정');
  assert.equal(validate(s, 'P1', { t: 'castTactic', tactic: T('증폭'), target: U('P1-King') }).ok, true);

  const broke = structuredClone(s);
  broke.units[U('P1-Rock')]!.mp = 0;
  assert.equal(validate(broke, 'P1', { t: 'castTactic', tactic: T('증폭'), target: U('P1-King') }).ok, false);
});

test('책략은 턴을 마치는 행동이고 MP를 소모한다', () => {
  const s = caster([T('증폭')]);
  const r = cast(s, T('증폭'), U('P1-King'));
  assert.equal(r.state.units[U('P1-Rock')]!.mp, 4);   // 5 − 1
  assert.equal(r.state.phase, 'running');
  assert.ok(r.events.some((e) => e.e === 'tacticCast' && e.resisted === false));
});

test('침묵이 걸리면 책략을 못 쓴다', () => {
  const s = structuredClone(caster([T('증폭')]));
  s.units[U('P1-Rock')]!.statuses.push({ status: 'silence', expiresAt: 500 });
  assert.equal(validate(s, 'P1', { t: 'castTactic', tactic: T('증폭'), target: U('P1-King') }).ok, false);
});

// ── 지원 계열 ──────────────────────────────────────────────────

test('증폭 — 다음 공격 1회가 확정 크리티컬, 그 뒤엔 소모된다', () => {
  // 장합(무90)에게 관우(무98)가 붙어도 38%. 증폭이면 확정이어야 한다.
  let s = caster([T('증폭')], { 'P2-Bishop': { x: 11, y: 11 } });
  s = cast(s, T('증폭'), U('P1-Rock')).state;
  assert.equal(s.units[U('P1-Rock')]!.statuses[0]!.status, 'critical100');
  assert.equal(s.units[U('P1-Rock')]!.statuses[0]!.charges, 1);
  const cursorBefore = s.rngCursor;

  s = giveControl(s, U('P1-Rock'));
  const r = apply(s, 'P1', { t: 'attack', targets: [U('P2-Bishop')] });
  const hit = r.events.find((e) => e.e === 'attacked')!;
  assert.equal(hit.critical, true);
  assert.equal(hit.damage, 4);
  assert.equal(r.state.rngCursor, cursorBefore, '증폭은 크리티컬 판정 자체를 건너뛴다');
  assert.equal(r.state.units[U('P1-Rock')]!.statuses.length, 0, '1회 쓰면 사라진다');
});

test('반감 — 받는 데미지가 절반, 1회만', () => {
  let s = caster([T('반감')], { 'P2-Bishop': { x: 11, y: 10 } });
  s = cast(s, T('반감'), U('P1-Rock')).state;

  // 장합(무90)이 관우(무98)를 침 → 30 − 8 = 22%. 크리티컬이 아니면 2 → 1
  s = giveControl(s, U('P2-Bishop'));
  const r = apply(s, 'P2', { t: 'attack', targets: [U('P1-Rock')] });
  const hit = r.events.find((e) => e.e === 'attacked')!;
  assert.equal(hit.damage, hit.critical ? 2 : 1);
  assert.equal(r.state.units[U('P1-Rock')]!.statuses.length, 0);
});

test('회복 — 최대 HP의 20%, 8방향 밖은 거부', () => {
  let s = structuredClone(caster([T('회복')]));
  s.units[U('P1-Pawn')]!.hp = 4;    // 인접 (10,11)
  assert.equal(validate(s, 'P1', { t: 'castTactic', tactic: T('회복'), target: U('P1-King') }).ok, false, '(3,3)은 멀다');

  const r = cast(s, T('회복'), U('P1-Pawn'));
  assert.equal(r.state.units[U('P1-Pawn')]!.hp, 6);  // 4 + floor(10 × 0.2)
});

test('대회복 — 8방향 내 아군 전원, 시전자 포함, 최대치를 넘지 않는다', () => {
  let s = structuredClone(caster([T('대회복')], { 'P1-King': { x: 9, y: 9 } }));
  s.units[U('P1-Rock')]!.hp = 5;
  s.units[U('P1-Pawn')]!.hp = 5;
  s.units[U('P1-King')]!.hp = 9;

  const r = cast(s, T('대회복'));
  assert.equal(r.state.units[U('P1-Rock')]!.hp, 7, '시전자 자신도 회복한다');
  assert.equal(r.state.units[U('P1-Pawn')]!.hp, 7);
  assert.equal(r.state.units[U('P1-King')]!.hp, 10, '최대치에서 멈춘다');
});

test('결계 — time 200 환술 면역이고 탈진·질병을 해제한다', () => {
  let s = structuredClone(caster([T('결계')], { 'P1-Pawn': { x: 10, y: 11 } }));
  s.units[U('P1-Pawn')]!.statuses.push({ status: 'dot', period: 100, magnitude: 1, lastTickedAt: 0 });

  const castAt = s.time;
  const r = cast(s, T('결계'), U('P1-Pawn'));
  const statuses = r.state.units[U('P1-Pawn')]!.statuses;
  assert.deepEqual(statuses.map((x) => x.status), ['illusionImmune']);
  assert.equal(statuses[0]!.expiresAt, castAt + 200, '지속시간은 시전 시각부터 센다');
  assert.ok(r.events.some((e) => e.e === 'statusExpired' && e.status === 'dot'), 'DoT 해제 이벤트');
});

test('결계 대상에게는 환술이 통하지 않는다 — 그래도 MP는 소모된다', () => {
  let s = structuredClone(caster([], { 'P2-Bishop': { x: 12, y: 12 } }));
  s = learn(s, U('P1-Rock'), [T('공포')]);
  s.units[U('P2-Bishop')]!.statuses.push({ status: 'illusionImmune', expiresAt: 9999 });

  const r = cast(s, T('공포'), U('P2-Bishop'));
  assert.ok(r.events.some((e) => e.e === 'tacticCast' && e.resisted === true));
  assert.equal(r.state.units[U('P2-Bishop')]!.statuses.length, 1, '공포가 붙지 않았다');
  assert.equal(r.state.units[U('P1-Rock')]!.mp, 4, 'MP는 소모된다 (GDD §3.7)');
});

test('화계 / 진화 — 지형 생성과 제거', () => {
  let s = caster([T('화계'), T('진화')]);
  const spot = { x: 11, y: 10 };
  const castAt = s.time;
  s = cast(s, T('화계'), spot).state;
  assert.deepEqual(s.terrain.map((t) => t.terrain), ['fire']);
  assert.equal(s.terrain[0]!.lastTickedAt, castAt, '생성 시각부터 정산한다');

  s = giveControl(s, U('P1-Rock'));
  s = cast(s, T('진화'), spot).state;
  assert.equal(s.terrain.length, 0);
});

test('화계 — 이미 지형이 있는 칸(성지 포함)은 덮어쓰지 못한다', () => {
  let s = caster([T('화계')]);
  const spot = { x: 11, y: 10 };
  s = { ...s, terrain: [{ pos: spot, terrain: 'holy', lastTickedAt: s.time }] };
  const v = validate(s, 'P1', { t: 'castTactic', tactic: T('화계'), target: spot });
  assert.equal(v.ok, false, '성지 위에 화계를 덮어쓸 수 없어야 한다');
});

// ── 지형 책략의 발동 공식 (2026-09-03) ──────────────────────────
//
// 「수계·매립 삭제」와 같은 날 정해졌다 — 칸에 거는 책략은 겨눌 상대가 없어
// 지원책 공식(`지력 + 대상 지력`)에 시전자를 두 번 넣고 있었고, 그러면 지력 50이
// 곧 100%라 사실상 무조건 발동이었다. 이제 `지력 − 10` 하나로 잰다.
test('지형 책략(화계·진화)은 제 공식을 쓴다 — 지원책 공식이 아니다', () => {
  const s = caster([T('화계'), T('진화')]);
  const int = officerById.get('gwan-u')!.intellect;

  for (const tactic of [T('화계'), T('진화')]) {
    const def = tacticById.get(tactic)!;
    assert.ok(isTerrainTactic(def), `${def.name}은 지형 책략이어야 한다`);
    assert.equal(
      illusionChance(s, U('P1-Rock'), tactic, undefined),
      FORMULA.terrainRate(int),
      `${def.name}: 확인창의 숫자가 지형 공식이어야 한다`,
    );
    assert.notEqual(
      illusionChance(s, U('P1-Rock'), tactic, undefined),
      FORMULA.supportRate(int, int),
      `${def.name}: 예전의 「지력 × 2」로 돌아가면 안 된다`,
    );
  }

  // 아군을 겨누는 지원책은 그대로 「내 지력 + 대상 지력」이다
  const support = tacticById.get(T('증폭'))!;
  assert.ok(!isTerrainTactic(support));
});

test('terrainRate — 지력 − 10, clamp(0,100)', () => {
  assert.equal(FORMULA.terrainRate(100), 90);
  assert.equal(FORMULA.terrainRate(50), 40);
  assert.equal(FORMULA.terrainRate(10), 0, '바닥은 0%다 — 환술의 20%와 다르다');
  assert.equal(FORMULA.terrainRate(0), 0);
  assert.equal(FORMULA.terrainRate(200), 100);
});

test('선공 — 아군 WT −100, 0 아래로는 내려가지 않는다', () => {
  let s = structuredClone(caster([T('선공')]));
  s.units[U('P1-Pawn')]!.wt = 150;
  s.units[U('P1-King')]!.wt = 30;

  const r = cast(s, T('선공'), U('P1-Pawn'));
  assert.equal(r.state.units[U('P1-Pawn')]!.wt, 50 - FORMULA.turnEndTimeStep);

  const r2 = cast(giveControl(s, U('P1-Rock')), T('선공'), U('P1-King'));
  assert.equal(r2.state.units[U('P1-King')]!.wt, 0, '음수가 되지 않는다');
});

// ── 환술 계열 ──────────────────────────────────────────────────

test('공포 — time 200 동안 공격력 절반', () => {
  let s = structuredClone(caster([]));
  s = learn(s, U('P1-Rock'), [T('공포')]);
  s.units[U('P2-Bishop')]!.pos = { x: 11, y: 11 };
  // 헌제(지력1)를 상대로 하면 20 + 79 → 100%라 저항이 없다
  s.units[U('P2-Queen')]!.pos = { x: 11, y: 9 };

  const castAt = s.time;
  const r = cast(s, T('공포'), U('P2-Queen'));
  const st = r.state.units[U('P2-Queen')]!.statuses[0]!;
  assert.equal(st.status, 'outgoingDamageHalf');
  assert.equal(st.expiresAt, castAt + 200);

  // 헌제(AT 2)가 절반 → 1. Queen 공격 마스크는 상하 1칸이라 조식(10,11) 바로 아래에 세운다
  const t = giveControl(place(r.state, { 'P2-Queen': { x: 10, y: 12 } }), U('P2-Queen'));
  const atk = apply(t, 'P2', { t: 'attack', targets: [U('P1-Pawn')] });
  const hit = atk.events.find((e) => e.e === 'attacked')!;
  assert.equal(hit.critical, false, '헌제 무력 1 → 크리티컬 0%');
  assert.equal(hit.damage, 1);
});

test('침묵 — 대상이 책략을 못 쓴다', () => {
  let s = structuredClone(caster([]));
  s = learn(s, U('P1-Rock'), [T('침묵')]);
  s = learn(s, U('P2-Queen'), [T('증폭')]);

  const r = cast(s, T('침묵'), U('P2-Queen'));
  const silenced = giveControl(r.state, U('P2-Queen'));
  assert.equal(validate(silenced, 'P2', { t: 'castTactic', tactic: T('증폭'), target: U('P2-King') }).ok, false);
});

test('함정 — WT +50에 HP 1 감소', () => {
  let s = structuredClone(caster([]));
  s = learn(s, U('P1-Rock'), [T('함정')]);
  s.units[U('P2-Queen')]!.wt = 100;

  const r = cast(s, T('함정'), U('P2-Queen'));
  const victim = r.state.units[U('P2-Queen')]!;
  assert.equal(victim.wt, 150 - FORMULA.turnEndTimeStep);
  assert.equal(victim.hp, 9);
});

test('경직 — WT +100', () => {
  let s = structuredClone(caster([]));
  s = learn(s, U('P1-Rock'), [T('경직')]);
  s.units[U('P2-Queen')]!.wt = 100;
  const r = cast(s, T('경직'), U('P2-Queen'));
  assert.equal(r.state.units[U('P2-Queen')]!.wt, 200 - FORMULA.turnEndTimeStep);
});

test('탈진은 time 200마다, 질병은 100마다 HP를 깎는다 — 둘 다 영구', () => {
  for (const [name, period, expected] of [['탈진', 200, 2], ['질병', 100, 4]] as const) {
    let s = structuredClone(caster([]));
    s = learn(s, U('P1-Rock'), [T(name)]);
    const r = cast(s, T(name), U('P2-Queen'));
    const st = r.state.units[U('P2-Queen')]!.statuses[0]!;
    assert.equal(st.status, 'dot');
    assert.equal(st.period, period);
    assert.equal(st.expiresAt, undefined, `${name}은 지속시간이 없다`);

    // 시전 직후부터 time 400을 흘린다
    let t = structuredClone(r.state);
    t.phase = 'running';
    t.activeUnit = null;
    t.activeTurn = null;
    for (const u of Object.values(t.units)) u.wt = 400;
    t = advanceTime(t).state;
    assert.equal(t.units[U('P2-Queen')]!.hp, 10 - expected, `${name} 정산 횟수`);
  }
});

test('유인 — 조종당하는 적은 이동만 하고, 조종자가 지시한다', () => {
  let s = structuredClone(caster([]));
  s = learn(s, U('P1-Rock'), [T('유인')]);
  const r = cast(s, T('유인'), U('P2-Queen'));

  const puppet = r.state.units[U('P2-Queen')]!;
  assert.deepEqual(puppet.control, { by: U('P1-Rock'), mode: 'moveOnly', uses: 1 });

  const turn = giveControl(r.state, U('P2-Queen'));
  assert.equal(validate(turn, 'P1', { t: 'move', to: { x: 21, y: 3 } }).ok, true, '조종자가 움직인다');
  assert.equal(validate(turn, 'P2', { t: 'move', to: { x: 21, y: 3 } }).ok, false, '주인은 못 움직인다');
  assert.equal(validate(turn, 'P1', { t: 'attack', targets: [U('P2-King')] }).ok, false, '유인은 이동만');
  // 후보 목록도 비어야 한다 — 아니면 UI가 누를 수 없는 공격 버튼을 켠다
  assert.deepEqual(legalTargetsFor(turn, U('P2-Queen')), []);

  // 한 턴 쓰면 풀린다
  const after = apply(turn, 'P1', { t: 'endTurn' }).state;
  assert.equal(after.units[U('P2-Queen')]!.control, undefined);
});

test('초선 — 조종당한 적이 자기 편을 친다', () => {
  let s = structuredClone(caster([]));
  s = learn(s, U('P1-Rock'), [T('초선')]);
  s.units[U('P2-Queen')]!.pos = { x: 20, y: 3 };   // 조조(P2-King) 바로 아래
  const r = cast(s, T('초선'), U('P2-Queen'));

  const turn = giveControl(r.state, U('P2-Queen'));
  assert.equal(validate(turn, 'P1', { t: 'attack', targets: [U('P2-King')] }).ok, true);
  const atk = apply(turn, 'P1', { t: 'attack', targets: [U('P2-King')] });
  assert.ok(atk.events.some((e) => e.e === 'attacked' && e.target === U('P2-King')));
  assert.ok(atk.state.units[U('P2-King')]!.hp < 10);
});

// ── 실패 판정 ──────────────────────────────────────────────────

test('환술 성공률 = 20 + 지력차, 저항하면 효과가 없다', () => {
  // 조식(지78)이 제갈량(지100)에게 → 20 − 22 = 0% → 반드시 저항
  const s = giveControl(place(battle(1, {
    P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn', 1, [], [T('공포')])],
    P2: [R('je-gal-ryang', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
  }), { 'P1-Pawn': { x: 10, y: 10 }, 'P2-King': { x: 12, y: 12 } }), U('P1-Pawn'));

  const r = apply(s, 'P1', { t: 'castTactic', tactic: T('공포'), target: U('P2-King') });
  assert.ok(r.events.some((e) => e.e === 'tacticCast' && e.resisted === true));
  assert.equal(r.state.units[U('P2-King')]!.statuses.length, 0);
  assert.equal(r.state.units[U('P1-Pawn')]!.mp, 4);
  assert.equal(r.state.rngCursor, 1, '저항 판정에 난수 1개');
});

test('지원책도 100% 확정이 아니다 — 지력이 낮으면 실패하고, 그래도 MP는 소모된다', () => {
  // 헌제(지력1) 자가시전 증폭 → 1+1=2%. seed 1에서는 실패로 떨어진다 (결정적).
  let s = battle(1, {
    P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen', 1, [], [T('증폭')])],
  });
  s = place(s, { 'P2-Queen': { x: 12, y: 12 } });
  s = giveControl(s, U('P2-Queen'));

  const r = apply(s, 'P2', { t: 'castTactic', tactic: T('증폭'), target: U('P2-Queen') });
  assert.ok(r.events.some((e) => e.e === 'tacticCast' && e.resisted === true));
  assert.equal(r.state.units[U('P2-Queen')]!.statuses.length, 0, '실패했으니 크리티컬 확정이 안 붙는다');
  assert.equal(r.state.units[U('P2-Queen')]!.mp, s.units[U('P2-Queen')]!.mp - 1, '실패해도 MP는 소모된다 (환술과 같은 규약)');
  assert.equal(r.state.rngCursor, 1, '지원책도 판정에 난수 1개를 쓴다');
});

test('MP 소모량은 데이터와 일치한다', () => {
  for (const t of TACTICS) {
    assert.equal(tacticById.get(t.id)!.mpCost, t.mpCost);
    assert.ok(t.mpCost >= 1 && t.mpCost <= 3, `${t.name} MP ${t.mpCost}`);
  }
});
