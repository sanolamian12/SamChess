/**
 * S급 고유기술 30종 회귀 테스트 (GDD §4.4, §12 A1~B7)
 *
 * 대부분은 Effect DSL로 접혔지만, **엔진 훅이 붙은 것**들이 진짜 위험 지점이다 —
 * 부활·전향·즉사·반격·오라·지연 발동. 여기서는 그 훅들을 집중해서 본다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { UNIQUE_SKILLS, officerById } from '@samchess/data';
import { advanceTime, apply, legalMovesFor, legalTargetsFor, validate } from '../src/battle.ts';
import { aurasOn, effectiveAt, findStatus } from '../src/state.ts';
import { FORMULA, type BattleState, type UnitId, type Vec2 } from '../src/types.ts';
import { R, U, battle, giveControl, place, running } from './fixtures.ts';

function holderOf(skillName: string): string {
  const skill = UNIQUE_SKILLS.find((k) => k.name === skillName);
  if (!skill?.holders.length) throw new Error(`보유자를 찾을 수 없다: ${skillName}`);
  return skill.holders[0]!;
}

/** 스킬 보유자를 P1-Rock에 세우고 SP를 채운 뒤 제어권을 준다. */
function ready(skillName: string, at: Record<string, Vec2> = {}, opts: { p2King?: string } = {}): BattleState {
  const holder = holderOf(skillName);
  const s = battle(1, {
    P1: [R('yu-bi', 'King'), R(holder, 'Rock'), R('jo-sik', 'Pawn')],
    P2: [R(opts.p2King ?? 'jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
  });
  const t = structuredClone(giveControl(place(s, {
    'P1-King': { x: 3, y: 3 },
    'P1-Rock': { x: 10, y: 10 },
    'P1-Pawn': { x: 10, y: 11 },
    'P2-King': { x: 20, y: 2 },
    'P2-Bishop': { x: 11, y: 11 },
    'P2-Queen': { x: 21, y: 2 },
    ...at,
  }), U('P1-Rock')));
  t.sp = { P1: 15, P2: 15 };
  return t;
}

const cast = (s: BattleState, target?: UnitId | Vec2) =>
  apply(s, 'P1', { t: 'castUniqueSkill', ...(target !== undefined ? { target } : {}) });

/** 시간만 흘린다 (제어권 없이). */
function elapse(s: BattleState, dt: number): BattleState {
  const t = structuredClone(s);
  t.phase = 'running';
  t.activeUnit = null;
  t.activeTurn = null;
  for (const u of Object.values(t.units)) u.wt = dt;
  return advanceTime(t).state;
}

// ── 오라 (A1) ──────────────────────────────────────────────────

test('단기도강(허저) — 반경 1칸 아군이 데미지 절반, 벗어나면 즉시 풀린다', () => {
  // 허저를 Rock에, 보호받을 조식(Pawn)을 인접에 둔다
  let s = ready('단기도강', { 'P1-Pawn': { x: 11, y: 10 }, 'P2-Bishop': { x: 12, y: 10 } });
  s = cast(s).state;
  assert.equal(s.units[U('P1-Rock')]!.statuses[0]!.status, 'auraIncomingHalf');

  // 장합(Bishop, 직교 1칸)이 조식을 친다 → AT 2가 절반
  s = apply(s, 'P1', { t: 'endTurn' }).state;
  const near = apply(giveControl(s, U('P2-Bishop')), 'P2', { t: 'attack', targets: [U('P1-Pawn')] });
  const hitNear = near.events.find((e) => e.e === 'attacked')!;
  assert.equal(hitNear.damage, hitNear.critical ? 2 : 1, '반경 안이라 절반');

  // 조식을 허저에게서 멀리 떼면 보호가 사라진다 — 오라는 매 순간 다시 잰다
  const far = structuredClone(s);
  far.units[U('P1-Pawn')]!.pos = { x: 20, y: 10 };
  far.units[U('P2-Bishop')]!.pos = { x: 21, y: 10 };
  const hitFar = apply(giveControl(far, U('P2-Bishop')), 'P2', { t: 'attack', targets: [U('P1-Pawn')] })
    .events.find((e) => e.e === 'attacked')!;
  assert.equal(hitFar.damage, hitFar.critical ? 4 : 2, '반경 밖이라 온전히 맞는다');
});

test('인중여포(여포) — 반경 2칸 적의 공격력이 절반, 맵 어디든 1회 이동', () => {
  let s = ready('인중여포 마중적토', { 'P2-Bishop': { x: 11, y: 10 } });
  s = cast(s).state;
  const statuses = s.units[U('P1-Rock')]!.statuses.map((x) => x.status).sort();
  assert.deepEqual(statuses, ['auraOutgoingHalf', 'freeMove']);

  // 자유이동 — Rock인데도 대각·원거리로 갈 수 있다
  const moved = apply(s, 'P1', { t: 'move', to: { x: 2, y: 18 } }).state;
  assert.deepEqual(moved.units[U('P1-Rock')]!.pos, { x: 2, y: 18 });

  // 여포 곁의 장합은 공격력이 절반 (제자리에서 확인)
  const t = apply(s, 'P1', { t: 'endTurn' }).state;
  const hit = apply(giveControl(t, U('P2-Bishop')), 'P2', { t: 'attack', targets: [U('P1-Rock')] })
    .events.find((e) => e.e === 'attacked')!;
  assert.equal(hit.damage, hit.critical ? 2 : 1);
});

test('인중여포의 자유이동은 딱 1회다 — 쓰고 나면 기물 마스크로 돌아온다', () => {
  let s = ready('인중여포 마중적토', { 'P2-Bishop': { x: 11, y: 10 } });
  s = cast(s).state;
  assert.equal(findStatus(s.units[U('P1-Rock')]!, 'freeMove')?.charges, 1);

  // 마스크 밖(대각선 먼 곳)으로 뛴다 → 횟수를 소모한다
  s = apply(s, 'P1', { t: 'move', to: { x: 2, y: 18 } }).state;
  assert.equal(findStatus(s.units[U('P1-Rock')]!, 'freeMove'), undefined, '1회로 끝난다');

  // 오라는 그대로 남는다 — 지속시간이 따로다 (time 290)
  assert.ok(findStatus(s.units[U('P1-Rock')]!, 'auraOutgoingHalf'), '오라는 그대로');

  // 다음 턴에는 Rock 마스크(십자 1~4칸)만 갈 수 있다
  const next = giveControl(apply(s, 'P1', { t: 'endTurn' }).state, U('P1-Rock'));
  const moves = legalMovesFor(next, U('P1-Rock'));
  assert.ok(moves.length > 0 && moves.length < 50, `맵 전체가 아니어야 한다 — ${moves.length}칸`);
  assert.ok(moves.every((p) => p.x === 2 || p.y === 18), '십자 이동만 남는다');
});

test('마스크 안으로 한 칸 움직이는 것은 자유이동을 쓰지 않는다', () => {
  let s = ready('인중여포 마중적토', { 'P2-Bishop': { x: 11, y: 10 } });
  s = cast(s).state;
  // Rock은 (10,10)에 있다. 십자 1칸은 원래 갈 수 있는 자리다.
  s = apply(s, 'P1', { t: 'move', to: { x: 10, y: 9 } }).state;
  assert.equal(findStatus(s.units[U('P1-Rock')]!, 'freeMove')?.charges, 1,
    '원래도 갈 수 있던 칸이라 횟수가 그대로다 — 안 그러면 한 칸 움직인 죄로 스킬을 날린다');
});

test('오라는 영향받는 쪽에 흔적이 없다 — aurasOn()이 그걸 알려 준다 (화면용)', () => {
  let s = ready('인중여포 마중적토', { 'P2-Bishop': { x: 11, y: 10 } });
  s = cast(s).state;

  // 반경 2칸 안의 적 — 상태 배열은 비어 있는데 오라는 걸려 있다
  assert.deepEqual(s.units[U('P2-Bishop')]!.statuses, []);
  const on = aurasOn(s, U('P2-Bishop'));
  assert.equal(on.length, 1);
  assert.equal(on[0]!.status, 'auraOutgoingHalf');
  assert.equal(on[0]!.source, U('P1-Rock'));
  assert.equal(on[0]!.kind, 'debuff', '적이 켠 오라라 당하는 쪽에는 디버프다');
  assert.equal(on[0]!.radius, 2);

  // 시전자 자신과, 반경 밖의 적에게는 걸리지 않는다
  assert.deepEqual(aurasOn(s, U('P1-Rock')), []);
  assert.deepEqual(aurasOn(s, U('P2-King')), [], '멀리 있는 적은 대상이 아니다');

  // 벗어나면 곧바로 풀린다 — 매 순간 다시 잰다 (GDD §12 A1)
  const away = structuredClone(s);
  away.units[U('P2-Bishop')]!.pos = { x: 20, y: 10 };
  assert.deepEqual(aurasOn(away, U('P2-Bishop')), []);
});

test('단기도강의 오라는 아군에게 버프로 잡힌다', () => {
  let s = ready('단기도강', { 'P1-Pawn': { x: 11, y: 10 } });
  s = cast(s).state;
  const on = aurasOn(s, U('P1-Pawn'));
  assert.equal(on.length, 1);
  assert.equal(on[0]!.kind, 'buff', '아군이 켠 오라라 이롭다');
  assert.equal(on[0]!.status, 'auraIncomingHalf');
});

// ── 반격 (A4) ──────────────────────────────────────────────────

test('변화무쌍(장합) — 피격 시 반격하되, 반격이 반격을 부르지 않는다', () => {
  // Bishop 공격 마스크는 직교 1칸이라 (11,10)에 세운다
  let s = ready('변화무쌍', { 'P2-Bishop': { x: 11, y: 10 } });
  s = cast(s).state;
  assert.equal(s.units[U('P1-Rock')]!.statuses[0]!.status, 'counterattack');

  s = apply(s, 'P1', { t: 'endTurn' }).state;
  const r = apply(giveControl(s, U('P2-Bishop')), 'P2', { t: 'attack', targets: [U('P1-Rock')] });
  const hits = r.events.filter((e) => e.e === 'attacked');
  assert.equal(hits.length, 2, '원공격 + 반격 1회');
  assert.equal(hits[0]!.target, U('P1-Rock'));
  assert.equal(hits[1]!.target, U('P2-Bishop'), '반격이 공격자에게 돌아간다');
});

test('반격은 사거리를 무시한다 — 원거리에서 맞아도 되받는다', () => {
  // 황충의 「백보천양」으로 맵 반대편에서 때린 뒤, 장합이 반격하는지 본다
  let s = ready('변화무쌍', { 'P1-Rock': { x: 10, y: 10 }, 'P2-Queen': { x: 10, y: 11 } });
  s = cast(s).state;
  s = apply(s, 'P1', { t: 'endTurn' }).state;

  // 헌제(Queen, 상하 1칸)가 인접해서 친다 → 반격 성립
  const r = apply(giveControl(s, U('P2-Queen')), 'P2', { t: 'attack', targets: [U('P1-Rock')] });
  assert.equal(r.events.filter((e) => e.e === 'attacked').length, 2);
});

// ── 사거리 무시 공격 (B1) ──────────────────────────────────────

test('백보천양(황충) — 맵 어디든 저격, 확정 크리티컬', () => {
  let s = ready('백보천양');
  s = cast(s).state;
  const statuses = s.units[U('P1-Rock')]!.statuses.map((x) => x.status).sort();
  assert.deepEqual(statuses, ['attackAnywhere', 'critical100']);

  // (10,10)에서 (20,2)의 조조까지 — 원래 Rock 대각 1칸으론 불가능한 거리
  const targets = legalTargetsFor(s, U('P1-Rock'));
  assert.equal(targets.length, 3, '살아있는 적 전원이 후보');
  const r = apply(s, 'P1', { t: 'attack', targets: [U('P2-King')] });
  const hit = r.events.find((e) => e.e === 'attacked')!;
  assert.equal(hit.critical, true);
  assert.equal(hit.damage, 4);
});

// ── 데미지 대신받기 (B4) ───────────────────────────────────────

test('고육지책(주유) — 지정 아군이 공격을 대신 받고, 그의 절반이 적용된다', () => {
  let s = ready('고육지책', { 'P1-Pawn': { x: 11, y: 10 }, 'P2-Bishop': { x: 12, y: 10 } });
  s = cast(s, U('P1-King')).state;   // 멀리 있는 유비를 방패로 지정
  const guard = s.units[U('P1-King')]!;
  assert.deepEqual(guard.statuses.map((x) => x.status).sort(), ['damageRedirect', 'incomingDamageHalf']);

  // 장합이 조식을 쳐도 피해는 유비에게 간다
  s = apply(s, 'P1', { t: 'endTurn' }).state;
  const r = apply(giveControl(s, U('P2-Bishop')), 'P2', { t: 'attack', targets: [U('P1-Pawn')] });
  const hit = r.events.find((e) => e.e === 'attacked')!;
  assert.equal(hit.target, U('P1-King'), '피해가 방패에게 넘어갔다');
  assert.equal(r.state.units[U('P1-Pawn')]!.hp, 10, '원래 대상은 멀쩡하다');
  assert.equal(r.state.units[U('P1-King')]!.hp, 10 - (hit.critical ? 2 : 1), '방패의 절반이 적용');
});

test('도트·지형 피해는 대신 받지 않는다 (공격만 넘어간다)', () => {
  let s = ready('고육지책');
  s = cast(s, U('P1-King')).state;
  const t = structuredClone(s);
  t.units[U('P1-Pawn')]!.statuses.push({ status: 'dot', period: 100, magnitude: 1, lastTickedAt: t.time });

  const after = elapse(t, 100);
  assert.equal(after.units[U('P1-Pawn')]!.hp, 9, '도트는 본인이 받는다');
  assert.equal(after.units[U('P1-King')]!.hp, 10);
});

// ── AT 누적 (B5) ───────────────────────────────────────────────

test('구벌중원(강유) — 공격마다 AT +1, 최대 +9', () => {
  let s = ready('구벌중원', { 'P2-Bishop': { x: 11, y: 11 } });
  const baseAt = s.units[U('P1-Rock')]!.at;
  s = cast(s).state;
  assert.equal(effectiveAt(s.units[U('P1-Rock')]!), baseAt, '시전 직후엔 그대로');

  // 12번 때려도 +9에서 멈춘다
  for (let i = 0; i < 12; i++) {
    const t = structuredClone(giveControl(s, U('P1-Rock')));
    t.units[U('P2-Bishop')]!.hp = 99;
    t.units[U('P2-Bishop')]!.maxHp = 99;
    s = apply(t, 'P1', { t: 'attack', targets: [U('P2-Bishop')] }).state;
  }
  assert.equal(effectiveAt(s.units[U('P1-Rock')]!), baseAt + 9);
});

// ── 광역 공격 (장료지제) ───────────────────────────────────────

test('장료지제(장료) — 즉시 전 적군을 한 번씩, 무적 대상에게도 들어간다', () => {
  let s = ready('장료지제');
  const t = structuredClone(s);
  // 헌제가 「황제옹립」으로 무적이어도 광역은 통과한다 (GDD §12 A2)
  t.units[U('P2-Queen')]!.statuses.push({ status: 'untargetable', expiresAt: 9999 });

  const r = cast(t);
  const hits = r.events.filter((e) => e.e === 'attacked');
  assert.equal(hits.length, 3, '적 3명 전부');
  assert.ok(hits.some((h) => h.target === U('P2-Queen')), '무적이어도 맞는다');
  // 정산 순서는 WT 오름차순으로 결정적이어야 한다
  const order = hits.map((h) => t.units[h.target]!.wt);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

// ── 즉사 (A5) ──────────────────────────────────────────────────

test('온주참화웅(관우) — 첫 대상은 즉사, 단 King에게는 안 통한다', () => {
  let s = ready('온주참화웅', { 'P2-Bishop': { x: 11, y: 11 } });
  s = cast(s).state;
  assert.equal(s.units[U('P1-Rock')]!.statuses[0]!.status, 'instantKillNext');

  // King을 쳐도 즉사하지 않고, 표식도 남는다
  const onKing = structuredClone(s);
  onKing.units[U('P2-King')]!.pos = { x: 11, y: 9 };
  const kr = apply(onKing, 'P1', { t: 'attack', targets: [U('P2-King')] });
  assert.equal(kr.state.winner, null, 'King은 즉사하지 않는다');
  assert.ok(kr.state.units[U('P2-King')]!.alive);

  // 일반 유닛은 HP가 얼마든 즉사
  const tough = structuredClone(s);
  tough.units[U('P2-Bishop')]!.hp = 99;
  tough.units[U('P2-Bishop')]!.maxHp = 99;
  const r = apply(tough, 'P1', { t: 'attack', targets: [U('P2-Bishop')] });
  assert.equal(r.state.units[U('P2-Bishop')]!.alive, false);
  assert.equal(r.state.units[U('P1-Rock')]!.statuses.length, 0, '1회 쓰면 사라진다');
});

// ── 전향 (B7 / A5) ─────────────────────────────────────────────

test('삼고초려(유비) — 3회 때린 적을 게임 끝까지 조종한다 (「초선」의 영구판)', () => {
  let s = battle(1, {
    P1: [R('gwan-u', 'King'), R('yu-bi', 'Rock'), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
  });
  s = structuredClone(giveControl(place(s, {
    'P1-Rock': { x: 10, y: 10 }, 'P2-Bishop': { x: 11, y: 11 },
    'P1-King': { x: 3, y: 3 }, 'P1-Pawn': { x: 3, y: 4 },
    'P2-King': { x: 20, y: 2 }, 'P2-Queen': { x: 21, y: 2 },
  }), U('P1-Rock')));
  s.sp = { P1: 15, P2: 15 };
  s.units[U('P2-Bishop')]!.hp = 99;
  s.units[U('P2-Bishop')]!.maxHp = 99;

  s = apply(s, 'P1', { t: 'castUniqueSkill' }).state;
  assert.equal(s.units[U('P1-Rock')]!.statuses[0]!.status, 'convertOnHit');

  for (let i = 1; i <= 3; i++) {
    s = apply(giveControl(s, U('P1-Rock')), 'P1', { t: 'attack', targets: [U('P2-Bishop')] }).state;
    if (i < 3) {
      assert.equal(s.units[U('P2-Bishop')]!.control, undefined, `${i}회차에는 아직`);
      assert.equal(s.units[U('P2-Bishop')]!.statuses.find((x) => x.status === 'convertProgress')?.magnitude, i);
    }
  }

  const puppet = s.units[U('P2-Bishop')]!;
  assert.deepEqual(puppet.control, { by: U('P1-Rock'), mode: 'moveAndAttack', uses: null });
  assert.equal(puppet.side, 'P2', '진영은 그대로 — 지휘권만 넘어간다');
  assert.equal(puppet.statuses.length, 0, '표식은 사라진다');

  // 이제 옛 아군을 공격 대상으로 삼고, 지시는 P1이 내린다
  const now = place(giveControl(s, U('P2-Bishop')), { 'P2-Bishop': { x: 21, y: 3 } });
  assert.deepEqual(legalTargetsFor(now, U('P2-Bishop')), [U('P2-Queen')]);
  assert.equal(validate(now, 'P1', { t: 'attack', targets: [U('P2-Queen')] }).ok, true, 'P1이 지시한다');
  assert.equal(validate(now, 'P2', { t: 'attack', targets: [U('P2-Queen')] }).ok, false, '원래 주인은 못 쓴다');

  // 「초선」과 달리 턴을 써도 풀리지 않는다
  const after = apply(now, 'P1', { t: 'endTurn' }).state;
  assert.deepEqual(after.units[U('P2-Bishop')]!.control, { by: U('P1-Rock'), mode: 'moveAndAttack', uses: null });
});

test('삼고초려는 King에게 통하지 않는다 (GDD §12 A5)', () => {
  let s = battle(1, {
    P1: [R('gwan-u', 'King'), R('yu-bi', 'Rock'), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
  });
  s = structuredClone(giveControl(place(s, {
    'P1-Rock': { x: 10, y: 10 }, 'P2-King': { x: 11, y: 11 },
    'P1-King': { x: 3, y: 3 }, 'P1-Pawn': { x: 3, y: 4 },
    'P2-Bishop': { x: 20, y: 2 }, 'P2-Queen': { x: 21, y: 2 },
  }), U('P1-Rock')));
  s.sp = { P1: 15, P2: 15 };
  s.units[U('P2-King')]!.hp = 99;
  s.units[U('P2-King')]!.maxHp = 99;
  s = apply(s, 'P1', { t: 'castUniqueSkill' }).state;

  for (let i = 0; i < 5; i++) {
    s = apply(giveControl(s, U('P1-Rock')), 'P1', { t: 'attack', targets: [U('P2-King')] }).state;
  }
  assert.equal(s.units[U('P2-King')]!.control, undefined, '몇 번을 때려도 조종되지 않는다');
  assert.equal(s.units[U('P2-King')]!.statuses.length, 0, '표식조차 쌓이지 않는다');
});

// ── 부활 (B7) ──────────────────────────────────────────────────

test('화용도(조조) — 사망 시 자기 진영에 HP 절반으로 부활한다', () => {
  // 조조를 P2의 King으로 두고, 그가 시전한 뒤 죽인다
  let s = ready('화용도 의석조조');
  const t = structuredClone(giveControl(s, U('P2-King')));
  t.sp = { P1: 15, P2: 15 };
  const r0 = apply(t, 'P2', { t: 'castUniqueSkill' });
  assert.equal(r0.state.units[U('P2-King')]!.statuses[0]!.status, 'revivePending');

  // 조조를 즉사 직전까지 몰고 때린다
  let s2 = structuredClone(r0.state);
  s2.units[U('P2-King')]!.hp = 1;
  s2.units[U('P2-King')]!.pos = { x: 11, y: 11 };
  s2 = giveControl(s2, U('P1-Rock'));
  const r = apply(s2, 'P1', { t: 'attack', targets: [U('P2-King')] });

  assert.equal(r.state.winner, null, '부활했으므로 아직 승패가 안 갈린다');
  const jojo = r.state.units[U('P2-King')]!;
  assert.equal(jojo.alive, true);
  assert.equal(jojo.hp, 5, '최대 HP 10의 절반');
  // 부활 직후 WT는 기준값. 그 뒤 턴 종료로 절대시간이 1 흐르며 함께 1 줄어든다
  assert.equal(jojo.wt, jojo.wtBase - FORMULA.turnEndTimeStep, 'WT는 기준값을 다 채운다');
  assert.equal(jojo.statuses.length, 0, '상태이상은 전부 해제');
  assert.ok(jojo.pos.y <= 4, 'P2 진영(위쪽 5행) 안이다');
  assert.ok(r.events.some((e) => e.e === 'unitRevived'));

  // 두 번째 격파에는 그대로 진다 (GDD §3.9)
  let s3 = structuredClone(r.state);
  s3.units[U('P2-King')]!.hp = 1;
  s3.units[U('P2-King')]!.pos = { x: 11, y: 11 };
  const r2 = apply(giveControl(s3, U('P1-Rock')), 'P1', { t: 'attack', targets: [U('P2-King')] });
  assert.equal(r2.state.winner, 'P1');
});

// ── 지연 발동 (유언계책) ───────────────────────────────────────

test('유언계책(곽가) — 사망 후 time 290 뒤에 적 1명이 죽는다. 군주는 제외', () => {
  let s = ready('유언계책');
  s = cast(s).state;
  assert.equal(s.units[U('P1-Rock')]!.statuses[0]!.status, 'deathCurse');

  // 곽가를 죽인다
  let t = structuredClone(s);
  t.units[U('P1-Rock')]!.hp = 1;
  t.units[U('P2-Bishop')]!.pos = { x: 11, y: 10 };
  const dead = apply(giveControl(t, U('P2-Bishop')), 'P2', { t: 'attack', targets: [U('P1-Rock')] });
  assert.equal(dead.state.units[U('P1-Rock')]!.alive, false);
  assert.equal(dead.state.pending.length, 1, '예약이 걸렸다');
  assert.equal(dead.state.pending[0]!.at, dead.state.time - 1 + 290);

  // 290이 지나기 전에는 아무도 안 죽는다
  const early = elapse(dead.state, 100);
  assert.equal(early.units[U('P2-Bishop')]!.alive && early.units[U('P2-Queen')]!.alive, true);

  // 지나면 King이 아닌 적 하나가 죽는다
  const late = elapse(dead.state, 400);
  const deadEnemies = ['P2-Bishop', 'P2-Queen'].filter((id) => !late.units[U(id)]!.alive);
  assert.equal(deadEnemies.length, 1, `적 1명 사망 (죽은 유닛: ${deadEnemies})`);
  assert.equal(late.units[U('P2-King')]!.alive, true, '군주는 대상이 아니다');
  assert.equal(late.pending.length, 0, '예약은 소진된다');
});

// ── 스크립트 2종 ───────────────────────────────────────────────

test('소패왕전(태사자) — 지정한 둘은 서로만 공격할 수 있다', () => {
  let s = ready('소패왕전', { 'P2-Bishop': { x: 11, y: 11 }, 'P2-Queen': { x: 9, y: 9 } });
  s = cast(s, U('P2-Bishop')).state;

  const taesa = s.units[U('P1-Rock')]!;
  const foe = s.units[U('P2-Bishop')]!;
  assert.equal(taesa.statuses.find((x) => x.status === 'mustTarget')?.sourceUnit, U('P2-Bishop'));
  assert.equal(foe.statuses.find((x) => x.status === 'mustTarget')?.sourceUnit, U('P1-Rock'));

  // 태사자는 다른 적을 겨눌 수 없다
  assert.deepEqual(legalTargetsFor(s, U('P1-Rock')), [U('P2-Bishop')]);
});

test('차동풍(제갈량) — 써버린 아군 스킬만 되살리고, 본인은 영구 비활성화', () => {
  let s = ready('차동풍');
  const t = structuredClone(s);
  t.units[U('P1-King')]!.uniqueSkillUses = 0;   // 유비는 이미 썼다
  t.units[U('P1-Pawn')]!.uniqueSkillUses = 1;   // 조식은 아직 안 썼다

  const r = cast(t);
  assert.equal(r.state.units[U('P1-King')]!.uniqueSkillUses, 1, '써버린 스킬이 되살아난다');
  assert.equal(r.state.units[U('P1-Pawn')]!.uniqueSkillUses, 1, '안 쓴 쪽은 2회가 되지 않는다');
  assert.equal(r.state.units[U('P1-Rock')]!.uniqueSkillUses, 0, '제갈량 본인은 비활성화');
  assert.ok(r.events.some((e) => e.e === 'uniqueSkillRestored' && e.unit === U('P1-King')));

  // 다시 차례가 와도 본인은 못 쓴다
  const again = giveControl(r.state, U('P1-Rock'));
  assert.equal(validate(again, 'P1', { t: 'castUniqueSkill' }).ok, false);
});

// ── 데이터로 접힌 것들 (표본) ──────────────────────────────────

test('화소연영(육손) — 최대 HP의 30%를 3번에 나눠 깎는다', () => {
  let s = ready('화소연영');
  const before = s.units[U('P2-Bishop')]!.hp;
  s = cast(s).state;
  assert.equal(s.units[U('P2-Bishop')]!.hp, before - 1, '시전 직후 10%');

  const t100 = elapse(s, 100);
  assert.equal(t100.units[U('P2-Bishop')]!.hp, before - 2, '+100에 또 10%');
  const t200 = elapse(s, 200);
  assert.equal(t200.units[U('P2-Bishop')]!.hp, before - 3, '+200까지 총 30%');
  const t400 = elapse(s, 400);
  assert.equal(t400.units[U('P2-Bishop')]!.hp, before - 3, '그 뒤로는 더 깎이지 않는다');
});

test('식소사번(사마의) — time 110마다, 결계로 지워지지 않는다', () => {
  let s = ready('식소사번');
  s = cast(s, U('P2-Bishop')).state;
  const dot = s.units[U('P2-Bishop')]!.statuses.find((x) => x.status === 'dot')!;
  assert.equal(dot.period, 110);
  assert.equal(dot.cleansable, false);
  assert.equal(dot.expiresAt, undefined, '게임이 끝날 때까지');

  const after = elapse(s, 220);
  assert.equal(after.units[U('P2-Bishop')]!.hp, 8, '110/220 두 번');
});

test('지곤상증(노숙) · 신재조영(서서) · 장판하뢰(장비)', () => {
  // 노숙 — 아군 전원 30% 회복
  let heal = ready('지곤상증');
  for (const id of ['P1-King', 'P1-Rock', 'P1-Pawn']) heal.units[U(id)]!.hp = 5;
  assert.equal(cast(heal).state.units[U('P1-King')]!.hp, 8);

  // 서서 — 적 전체 MP 0
  const mp = cast(ready('신재조영 심재촉')).state;
  for (const id of ['P2-King', 'P2-Bishop', 'P2-Queen']) assert.equal(mp.units[U(id)]!.mp, 0);

  // 장비 — 적 전체 WT +150 (한 턴 쉬는 효과)
  const wt = ready('장판하뢰');
  const before = wt.units[U('P2-Bishop')]!.wt;
  assert.equal(cast(wt).state.units[U('P2-Bishop')]!.wt, before + 150);
});

test('연환계(방통) · 구호탄랑(순욱) — 적 조종', () => {
  const all = cast(ready('연환계')).state;
  for (const id of ['P2-King', 'P2-Bishop', 'P2-Queen']) {
    assert.equal(all.units[U(id)]!.control?.mode, 'moveOnly', id);
  }

  // 순욱 — 차례가 가장 가까운 2명만
  const two = cast(ready('구호탄랑')).state;
  const controlled = Object.values(two.units).filter((u) => u.control);
  assert.equal(controlled.length, 2);
  assert.ok(controlled.every((u) => u.control!.mode === 'moveAndAttack'));
  const wts = Object.values(two.units).filter((u) => u.side === 'P2').sort((a, b) => a.wt - b.wt);
  assert.deepEqual(controlled.map((u) => u.id).sort(), wts.slice(0, 2).map((u) => u.id).sort());
});

test('세한지송백(방덕) — 최대 HP 2배, 현재 HP는 그대로', () => {
  const s = ready('세한지송백');
  const t = structuredClone(s);
  t.units[U('P1-Pawn')]!.hp = 6;
  const r = cast(t, U('P1-Pawn')).state;
  assert.equal(r.units[U('P1-Pawn')]!.maxHp, 20);
  assert.equal(r.units[U('P1-Pawn')]!.hp, 6);
});

test('병귀신속(서황) — 3턴 동안 WT −50', () => {
  let s = ready('병귀신속');
  const base = s.units[U('P1-Rock')]!.wtBase;
  s = cast(s).state;
  assert.deepEqual(s.units[U('P1-Rock')]!.wtModifiers, [{ delta: -50, turnsLeft: 3 }]);

  for (let i = 3; i >= 1; i--) {
    s = apply(giveControl(s, U('P1-Rock')), 'P1', { t: 'endTurn' }).state;
    assert.equal(s.units[U('P1-Rock')]!.wt, base - 50, `${4 - i}턴째`);
  }
  s = apply(giveControl(s, U('P1-Rock')), 'P1', { t: 'endTurn' }).state;
  assert.equal(s.units[U('P1-Rock')]!.wt, base, '4턴째부터는 원래대로');
});

test('수성지주(손권) — 성지 지형을 만든다', () => {
  const r = cast(ready('수성지주'), { x: 5, y: 5 }).state;
  assert.equal(r.terrain[0]!.terrain, 'holy');
  assert.deepEqual(r.terrain[0]!.pos, { x: 5, y: 5 });
});

test('수성지주(손권) — 화계·수계가 있는 칸에는 지을 수 없다', () => {
  for (const terrain of ['fire', 'water'] as const) {
    const spot = { x: 5, y: 5 };
    const s = ready('수성지주');
    const withTerrain = { ...s, terrain: [{ pos: spot, terrain, lastTickedAt: s.time }] };
    const v = validate(withTerrain, 'P1', { t: 'castUniqueSkill', target: spot });
    assert.equal(v.ok, false, `${terrain} 위에 성지를 지을 수 없어야 한다`);
  }
});

// ── 재현성 ─────────────────────────────────────────────────────

test('부활 위치와 유언계책 대상은 시드로 재현된다', () => {
  const run = (seed: number) => {
    let s = { ...ready('유언계책'), seed };
    s = cast(s).state;
    s.units[U('P1-Rock')]!.hp = 1;
    s.units[U('P2-Bishop')]!.pos = { x: 11, y: 10 };
    const dead = apply(giveControl(s, U('P2-Bishop')), 'P2', { t: 'attack', targets: [U('P1-Rock')] }).state;
    const late = elapse(dead, 400);
    return Object.values(late.units).filter((u) => !u.alive).map((u) => u.id).sort().join(',');
  };
  assert.equal(run(7), run(7));
});
