/**
 * 전투 엔진 회귀 테스트 — CTB 스케줄러와 행동 판정.
 *
 *   node --test --experimental-strip-types packages/rules/test/*.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { officerById } from '@samchess/data';
import {
  advanceTime, apply, attackRange, createBattle, deployZone, forecastAttack, legalMovesFor,
  legalTargetsFor, validate,
} from '../src/battle.ts';
import { floatAt, roll } from '../src/rng.ts';
import { SKIP_TO_WIN } from '../src/timing.ts';
import { FORMULA, type BattleState, type RosterEntry, type Side, type UnitId } from '../src/types.ts';
import { R, U, battle, giveControl, place, runTurns, running, sideOf } from './fixtures.ts';

// ── 생성 · 배치 ────────────────────────────────────────────────

test('createBattle — 초기값과 기본 배치', () => {
  const s = battle();
  assert.equal(s.phase, 'deploy');
  assert.equal(s.time, 0);
  assert.deepEqual(s.boardSize, { x: 25, y: 20 });
  assert.deepEqual(s.spCap, { P1: 15, P2: 15 }); // 3명 × 5
  assert.deepEqual(s.sp, { P1: 0, P2: 0 });
  assert.equal(Object.keys(s.units).length, 6);

  for (const u of Object.values(s.units)) {
    // Lv1 기본치 (GDD §4.2)
    assert.deepEqual([u.hp, u.maxHp, u.mp, u.maxMp, u.at], [10, 10, 5, 5, 2]);
    // 초기 WT = 기준값이라 첫 순서가 통솔력 내림차순이 된다
    assert.equal(u.wt, u.wtBase);
    assert.equal(u.wtBase, FORMULA.wtBase(officerById.get(u.officer)!.leadership));
    assert.ok(u.alive);
    const z = deployZone(s.mode, u.side);
    assert.ok(u.pos.x >= z.x0 && u.pos.x <= z.x1 && u.pos.y >= z.y0 && u.pos.y <= z.y1, `${u.id} 진영 밖`);
  }
  // 같은 칸에 겹치지 않는다
  const cells = new Set(Object.values(s.units).map((u) => `${u.pos.x},${u.pos.y}`));
  assert.equal(cells.size, 6);
});

test('배치 구역 — 참여 수 × 5열을 25열 중앙에 정렬 (GDD §3.1)', () => {
  assert.deepEqual(deployZone('3v3', 'P1'), { x0: 5, x1: 19, y0: 15, y1: 19 });
  assert.deepEqual(deployZone('3v3', 'P2'), { x0: 5, x1: 19, y0: 0, y1: 4 });
  assert.deepEqual(deployZone('5v5', 'P1'), { x0: 0, x1: 24, y0: 15, y1: 19 });
});

test('편성 규칙 — 인원수 · 기물 중복 · King 필수', () => {
  const cfg = (rosters: RosterEntry[]) => () => createBattle({
    matchId: 'x', seed: 1, mode: '3v3',
    rosters: { P1: rosters, P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')] },
  });
  assert.throws(cfg([R('yu-bi', 'King')]), /편성/);
  assert.throws(cfg([R('yu-bi', 'King'), R('gwan-u', 'King'), R('jo-sik', 'Pawn')]), /종류당 1개/);
  assert.throws(cfg([R('yu-bi', 'Rock'), R('gwan-u', 'Bishop'), R('jo-sik', 'Pawn')]), /King은 필수/);
  assert.throws(cfg([R('yu-bi', 'King', 3, ['hp']), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')]), /능력 선택/);
});

test('레벨업 능력 선택이 능력치에 반영된다', () => {
  const s = createBattle({
    matchId: 'x', seed: 1, mode: '3v3',
    rosters: {
      P1: [R('gwan-u', 'King', 4, ['hp', 'mp', 'at']), R('jang-bi', 'Rock'), R('jo-un', 'Pawn')],
      P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
    },
  });
  const u = s.units[U('P1-King')]!;
  assert.deepEqual([u.maxHp, u.maxMp, u.at], [15, 7, 2.5]); // 10+5 / 5+2 / 2+0.5
});

test('공격치는 평타~크리티컬 범위로 읽는다 — 0.5는 크리티컬에서만 산다', () => {
  // 데미지가 `floor(AT × 배수)`이고 **매 타격마다 따로 내림**한다.
  // AT 성장이 0.5씩이라(GDD §4.2) 홀수 번 찍으면 평타는 그대로이고 크리티컬만 오른다 —
  // 화면이 단일 숫자로 적으면 「찍었는데 왜 그대로지」가 된다. 그래서 `AT 2-4` 표기다.
  const s = createBattle({
    matchId: 'x', seed: 1, mode: '3v3',
    rosters: {
      P1: [R('gwan-u', 'King'), R('jang-bi', 'Rock', 2, ['at']), R('jo-un', 'Pawn', 3, ['at', 'at'])],
      P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
    },
  });
  assert.deepEqual(attackRange(s, U('P1-King')), { min: 2, max: 4 }, 'Lv1 — AT 2');
  assert.deepEqual(attackRange(s, U('P1-Rock')), { min: 2, max: 5 }, 'AT 2.5 — 평타는 그대로');
  assert.deepEqual(attackRange(s, U('P1-Pawn')), { min: 3, max: 6 }, 'AT 3 — 둘 다 오른다');
});

// ── 공격 미리보기 (확인창이 쓴다) ──────────────────────────────

test('forecastAttack — 실제 판정과 같은 값을 미리 낸다', () => {
  // 확인창이 보여 준 숫자와 실제로 들어가는 데미지가 다르면 그게 제일 나쁘다.
  // 「크리티컬 100%」를 걸어 난수를 없애고 실제 공격과 맞대어 본다.
  let s = giveControl(battle(), U('P1-Rock'));                  // 관우
  s = place(s, { 'P1-Rock': { x: 5, y: 5 }, 'P2-King': { x: 6, y: 4 } });   // Rock 공격은 대각 1칸
  s.units[U('P1-Rock')]!.statuses.push({ status: 'critical100' });

  const f = forecastAttack(s, U('P1-Rock'), U('P2-King'))!;
  assert.equal(f.criticalRate, 100, '「일당백」류가 걸리면 확정이다');
  assert.equal(f.victim, U('P2-King'));

  const hpBefore = s.units[U('P2-King')]!.hp;
  const { state: after } = apply(s, 'P1', { t: 'attack', targets: [U('P2-King')] });
  assert.equal(hpBefore - after.units[U('P2-King')]!.hp, f.critical,
    '미리 잰 크리티컬 데미지가 실제와 같다');
  assert.equal(after.units[U('P2-King')]!.hp, f.hpAfter.min, '남을 HP도 같다');
});

test('forecastAttack — 난수를 쓰지 않는다 (rngCursor가 그대로)', () => {
  // 여기서 굴리면 실제 판정의 난수 순서가 밀려 재현성이 깨진다 (GDD §10).
  let s = giveControl(battle(), U('P1-Rock'));
  s = place(s, { 'P1-Rock': { x: 5, y: 5 }, 'P2-King': { x: 6, y: 4 } });
  const before = s.rngCursor;
  forecastAttack(s, U('P1-Rock'), U('P2-King'));
  forecastAttack(s, U('P1-Rock'), U('P2-King'));
  assert.equal(s.rngCursor, before);
});

test('forecastAttack — 감쇠와 쓰러짐을 미리 알려 준다', () => {
  let s = giveControl(battle(), U('P1-Rock'));
  s = place(s, { 'P1-Rock': { x: 5, y: 5 }, 'P2-King': { x: 6, y: 4 } });

  const plain = forecastAttack(s, U('P1-Rock'), U('P2-King'))!;
  assert.equal(plain.halved, false);
  assert.equal(plain.lethal, 'never', 'Lv1 AT로는 한 방에 안 죽는다');

  // 「반감」이 걸린 대상은 절반만 들어간다 — 그 사실을 화면이 적을 수 있어야 한다
  s.units[U('P2-King')]!.statuses.push({ status: 'incomingDamageHalf' });
  const halved = forecastAttack(s, U('P1-Rock'), U('P2-King'))!;
  assert.equal(halved.halved, true);
  assert.ok(halved.critical < plain.critical, '감쇠가 실제로 숫자에 반영된다');

  // HP가 얼마 없으면 「쓰러진다」를 미리 말해 준다
  s.units[U('P2-King')]!.hp = 1;
  assert.equal(forecastAttack(s, U('P1-Rock'), U('P2-King'))!.lethal, 'always');
});

test('forecastAttack — 「고육지책」 대신받기는 **맞는 쪽**을 짚어 준다', () => {
  // 고른 대상과 실제로 맞는 쪽이 다르다. 확인창이 이걸 말해 주지 않으면
  // 엉뚱한 유닛의 HP가 줄어 버그처럼 보인다.
  let s = giveControl(battle(), U('P1-Rock'));
  s = place(s, {
    'P1-Rock': { x: 5, y: 5 }, 'P2-King': { x: 6, y: 4 }, 'P2-Bishop': { x: 4, y: 4 },
  });
  s.units[U('P2-Bishop')]!.statuses.push({
    status: 'damageRedirect', sourceUnit: U('P2-King'),
  });
  const f = forecastAttack(s, U('P1-Rock'), U('P2-King'))!;
  assert.equal(f.victim, U('P2-Bishop'), '대신받는 쪽이 victim이다');
});

test('배치 → 준비 → 정찰 → 전투', () => {
  let s = battle();
  const zone = deployZone(s.mode, 'P1');
  const placements = [
    { unit: U('P1-King'), pos: { x: zone.x0, y: zone.y0 } },
    { unit: U('P1-Rock'), pos: { x: zone.x0 + 1, y: zone.y0 } },
    { unit: U('P1-Pawn'), pos: { x: zone.x0 + 2, y: zone.y0 } },
  ];
  s = apply(s, 'P1', { t: 'deploy', placements }).state;
  assert.deepEqual(s.units[U('P1-King')]!.pos, { x: zone.x0, y: zone.y0 });

  // 진영 밖 · 겹침 · 남의 유닛은 거부
  assert.equal(validate(s, 'P1', { t: 'deploy', placements: [{ ...placements[0]!, pos: { x: 0, y: 10 } }, placements[1]!, placements[2]!] }).ok, false);
  assert.equal(validate(s, 'P1', { t: 'deploy', placements: [placements[0]!, { ...placements[1]!, pos: placements[0]!.pos }, placements[2]!] }).ok, false);
  assert.equal(validate(s, 'P2', { t: 'deploy', placements }).ok, false);

  s = apply(s, 'P1', { t: 'ready' }).state;
  assert.equal(s.phase, 'deploy', '한쪽만 준비해서는 넘어가지 않는다');
  s = apply(s, 'P2', { t: 'ready' }).state;
  assert.equal(s.phase, 'scout');

  // 정찰 시간은 서버가 실시간으로 재고, 만료 시 advanceTime을 부른다
  s = advanceTime(s).state;
  assert.equal(s.phase, 'control');
});

// ── CTB 스케줄러 ───────────────────────────────────────────────

test('첫 제어권은 통솔력이 가장 높은 유닛 — WT = 190 − 통솔력의 귀결', () => {
  const s = advanceTime(running(battle())).state;
  assert.equal(s.activeUnit, U('P1-Rock'));       // 관우 통솔 100 → WT 90
  assert.equal(s.time, 90);
  assert.equal(s.phase, 'control');
  assert.deepEqual(s.activeTurn, { moved: false, acted: false, usedUniqueSkill: false });
});

test('각 유닛의 첫 행동 순서 = 통솔력 내림차순 (GDD §3.3)', () => {
  const { state, order } = runTurns(running(battle()), 30);
  const firsts = order.filter((id, i) => order.indexOf(id) === i);
  const expected = Object.values(state.units)
    .sort((a, b) => officerById.get(b.officer)!.leadership - officerById.get(a.officer)!.leadership)
    .map((u) => u.id);
  assert.deepEqual(firsts, expected);
});

test('턴을 마치면 절대시간 +1, WT는 기준값으로 복귀', () => {
  let s = advanceTime(running(battle())).state;
  const active = s.activeUnit!;
  const t0 = s.time;
  const others = Object.values(s.units).filter((u) => u.id !== active).map((u) => [u.id, u.wt] as const);

  s = apply(s, sideOf(s, active), { t: 'endTurn' }).state;
  assert.equal(s.time, t0 + FORMULA.turnEndTimeStep);
  assert.equal(s.units[active]!.wt, s.units[active]!.wtBase);
  assert.equal(s.phase, 'running');
  assert.equal(s.activeUnit, null);
  for (const [id, wt] of others) assert.equal(s.units[id]!.wt, Math.max(0, wt - 1), `${id}의 WT도 함께 줄어야 한다`);
});

test('WT 동률이면 시드 난수로 고르고, 난수를 1개 소비한다', () => {
  const base = running(battle());
  // 관우와 조조를 같은 WT로 맞추고 나머지는 뒤로 밀어 둔다
  const s = structuredClone(base);
  for (const u of Object.values(s.units)) u.wt = 500;
  s.units[U('P1-Rock')]!.wt = 100;
  s.units[U('P2-King')]!.wt = 100;

  const winners = new Set<UnitId>();
  for (let seed = 0; seed < 20; seed++) {
    const t = { ...structuredClone(s), seed };
    const r = advanceTime(t);
    assert.equal(r.state.rngCursor, 1, '동률 판정은 난수 1개만 쓴다');
    winners.add(r.state.activeUnit!);
  }
  assert.equal(winners.size, 2, '시드에 따라 양쪽 다 나와야 한다');

  // 단독 후보일 때는 난수를 쓰지 않는다
  const solo = structuredClone(s);
  solo.units[U('P2-King')]!.wt = 300;
  assert.equal(advanceTime(solo).state.rngCursor, 0);
});

test('SP는 time 100마다 +1, 상한에서 멈춘다', () => {
  let s = running(battle());
  for (let i = 0; i < 200 && !s.winner; i++) {
    s = advanceTime(s).state;
    const expected = Math.min(Math.floor(s.time / FORMULA.spPerTime), s.spCap.P1);
    assert.equal(s.sp.P1, expected, `time ${s.time}`);
    assert.equal(s.sp.P2, expected);
    if (!s.activeUnit) break;
    s = apply(s, sideOf(s, s.activeUnit), { t: 'endTurn' }).state;
  }
  assert.ok(s.time > FORMULA.spPerTime * s.spCap.P1, '상한 도달까지 진행했다');
  assert.equal(s.sp.P1, s.spCap.P1);
});

// ── 이동 ───────────────────────────────────────────────────────

test('Rock은 경로가 막히면 넘어가지 못하고, Knight는 도약한다', () => {
  const s = place(running(battle()), {
    'P1-Rock': { x: 10, y: 10 },
    'P1-Pawn': { x: 10, y: 12 },   // 위쪽 2칸에 아군이 막고 섰다
  });
  const moves = legalMovesFor(s, U('P1-Rock')).map((p) => `${p.x},${p.y}`);
  assert.ok(moves.includes('10,11'), '막힌 칸 앞까지는 간다');
  assert.ok(!moves.includes('10,12'), '점유된 칸에는 못 간다');
  assert.ok(!moves.includes('10,13'), '관통 이동은 없다');
  assert.ok(moves.includes('14,10'), '가로 4칸은 열려 있다');

  const knight = createBattle({
    matchId: 'k', seed: 1, mode: '3v3',
    rosters: {
      P1: [R('gwan-u', 'Knight'), R('yu-bi', 'King'), R('jo-un', 'Pawn')],
      P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
    },
  });
  const ks = place(running(knight), { 'P1-Knight': { x: 10, y: 10 }, 'P2-King': { x: 10, y: 11 } });
  const kmoves = legalMovesFor(ks, U('P1-Knight')).map((p) => `${p.x},${p.y}`);
  assert.ok(kmoves.includes('10,12') || kmoves.includes('11,12'), 'Knight는 인접 유닛을 넘는다');
});

test('수계 지형은 진입 불가', () => {
  let s = place(running(battle()), { 'P1-Rock': { x: 10, y: 10 } });
  s = structuredClone(s);
  s.terrain.push({ pos: { x: 11, y: 10 }, terrain: 'water', lastTickedAt: 0 });
  const moves = legalMovesFor(s, U('P1-Rock')).map((p) => `${p.x},${p.y}`);
  assert.ok(!moves.includes('11,10'));
  assert.ok(!moves.includes('12,10'), '수계 너머로 관통하지도 못한다');
});

test('이동은 턴당 1회, 행동 뒤에는 불가', () => {
  const s = giveControl(place(battle(), { 'P1-Rock': { x: 10, y: 10 } }), U('P1-Rock'));
  const moved = apply(s, 'P1', { t: 'move', to: { x: 11, y: 10 } }).state;
  assert.deepEqual(moved.units[U('P1-Rock')]!.pos, { x: 11, y: 10 });
  assert.equal(moved.activeTurn!.moved, true);
  assert.equal(validate(moved, 'P1', { t: 'move', to: { x: 12, y: 10 } }).ok, false);
  assert.equal(validate(s, 'P1', { t: 'move', to: { x: 10, y: 15 } }).ok, false, '마스크 밖');
  assert.equal(validate(s, 'P2', { t: 'move', to: { x: 11, y: 10 } }).ok, false, '내 차례가 아니다');
});

// ── 공격 (GDD §3.5) ────────────────────────────────────────────

test('크리티컬 확률 100%/0%는 판정 없이 확정된다', () => {
  // 관우(무98)의 Rock 공격 마스크는 대각 1칸
  const s = giveControl(place(battle(), {
    'P1-Rock': { x: 10, y: 10 },
    'P2-Queen': { x: 11, y: 11 },   // 헌제(무1) → 30 + 97 = 100% 고정
  }), U('P1-Rock'));

  assert.deepEqual(legalTargetsFor(s, U('P1-Rock')), [U('P2-Queen')]);
  const { state, events } = apply(s, 'P1', { t: 'attack', targets: [U('P2-Queen')] });
  const hit = events.find((e) => e.e === 'attacked')!;
  assert.equal(hit.critical, true);
  assert.equal(hit.damage, 4);                       // AT 2 × 2
  assert.equal(state.units[U('P2-Queen')]!.hp, 6);
  assert.equal(state.phase, 'running', '공격하면 턴이 끝난다');

  // 반대 방향: 헌제(무1)가 관우(무98)를 치면 30 − 97 → 0%
  const back = giveControl(place(battle(), {
    'P1-Rock': { x: 10, y: 10 },
    'P2-Queen': { x: 10, y: 11 },   // Queen 공격 마스크는 상하 1칸
  }), U('P2-Queen'));
  const r2 = apply(back, 'P2', { t: 'attack', targets: [U('P1-Rock')] });
  const hit2 = r2.events.find((e) => e.e === 'attacked')!;
  assert.equal(hit2.critical, false);
  assert.equal(hit2.damage, 2);
});

test('Pawn은 2명까지 동시 공격, 그 이상은 거부', () => {
  const s = giveControl(place(battle(), {
    'P1-Pawn': { x: 10, y: 10 },
    'P2-King': { x: 10, y: 11 },
    'P2-Bishop': { x: 11, y: 10 },
    'P2-Queen': { x: 10, y: 9 },
  }), U('P1-Pawn'));

  assert.equal(legalTargetsFor(s, U('P1-Pawn')).length, 3);
  assert.equal(validate(s, 'P1', { t: 'attack', targets: [U('P2-King'), U('P2-Bishop')] }).ok, true);
  assert.equal(validate(s, 'P1', { t: 'attack', targets: [U('P2-King'), U('P2-King')] }).ok, false, '중복 지정');
  assert.equal(validate(s, 'P1', { t: 'attack', targets: [U('P2-King'), U('P2-Bishop'), U('P2-Queen')] }).ok, false);

  const r = apply(s, 'P1', { t: 'attack', targets: [U('P2-Bishop'), U('P2-Queen')] });
  assert.equal(r.events.filter((e) => e.e === 'attacked').length, 2);
});

test('King이 쓰러지면 즉시 승리 — 조식으로도 이긴다', () => {
  let s = place(battle(), { 'P1-Pawn': { x: 10, y: 10 }, 'P2-King': { x: 10, y: 11 } });
  s = structuredClone(s);
  s.units[U('P2-King')]!.hp = 2;
  s = giveControl(s, U('P1-Pawn'));

  const r = apply(s, 'P1', { t: 'attack', targets: [U('P2-King')] });
  assert.equal(r.state.winner, 'P1');
  assert.equal(r.state.phase, 'finished');
  assert.ok(r.events.some((e) => e.e === 'unitDied' && e.unit === U('P2-King')));
  assert.ok(r.events.some((e) => e.e === 'battleEnded' && e.winner === 'P1'));
  assert.equal(validate(r.state, 'P1', { t: 'endTurn' }).ok, false);
});

test('항복하면 상대가 이긴다', () => {
  const r = apply(running(battle()), 'P2', { t: 'surrender' });
  assert.equal(r.state.winner, 'P1');
});

// ── 명상 · 턴 넘기기 ───────────────────────────────────────────

test('명상은 MP +1, 가득 차 있으면 거부', () => {
  let s = giveControl(battle(), U('P1-Rock'));
  assert.equal(validate(s, 'P1', { t: 'meditate' }).ok, false, 'MP 만땅');
  s = structuredClone(s);
  s.units[U('P1-Rock')]!.mp = 3;
  const r = apply(s, 'P1', { t: 'meditate' });
  assert.equal(r.state.units[U('P1-Rock')]!.mp, 4);
  assert.equal(r.state.phase, 'running', '명상도 턴을 마치는 행동이다');
});

test('[차례 넘기기]는 상대만 누를 수 있다', () => {
  const s = giveControl(battle(), U('P1-Rock'));
  assert.equal(validate(s, 'P1', { t: 'forceSkipTurn' }).ok, false);
  assert.equal(validate(s, 'P2', { t: 'forceSkipTurn' }).ok, true);
  const r = apply(s, 'P2', { t: 'forceSkipTurn' });
  assert.equal(r.state.units[U('P1-Rock')]!.wt, r.state.units[U('P1-Rock')]!.wtBase);
});

// ── DoT · 지형 (GDD §3.7, §3.8, §3.9) ──────────────────────────

test('DoT는 주기마다 정산되고 결계로 풀린 뒤에는 멈춘다', () => {
  let s = running(battle());
  s = structuredClone(s);
  const target = s.units[U('P2-Bishop')]!;
  target.statuses.push({ status: 'dot', period: 100, magnitude: 1, lastTickedAt: 0 }); // 질병
  for (const u of Object.values(s.units)) u.wt = 250;

  const r = advanceTime(s);
  assert.equal(r.state.time, 250);
  assert.equal(r.state.units[U('P2-Bishop')]!.hp, 8, 'time 100, 200 두 번 정산');

  // 결계로 해제하면 더 이상 깎이지 않는다
  let cleared = structuredClone(r.state);
  cleared.units[U('P2-Bishop')]!.statuses = [];
  cleared.phase = 'running';
  for (const u of Object.values(cleared.units)) u.wt = 300;
  cleared = advanceTime(cleared).state;
  assert.equal(cleared.units[U('P2-Bishop')]!.hp, 8);
});

test('화계는 밟고 선 유닛의 HP를 깎고, 성지는 회복시킨다', () => {
  let s = place(running(battle()), { 'P1-Rock': { x: 3, y: 3 }, 'P1-Pawn': { x: 4, y: 4 } });
  s = structuredClone(s);
  s.terrain.push({ pos: { x: 3, y: 3 }, terrain: 'fire', lastTickedAt: 0 });
  s.terrain.push({ pos: { x: 4, y: 4 }, terrain: 'holy', lastTickedAt: 0 });
  s.units[U('P1-Pawn')]!.hp = 5;
  for (const u of Object.values(s.units)) u.wt = 300;

  const r = advanceTime(s).state;
  assert.equal(r.units[U('P1-Rock')]!.hp, 7, 'time 90/180/270 세 번');
  assert.equal(r.units[U('P1-Pawn')]!.hp, 8);
  assert.ok(r.units[U('P1-Pawn')]!.hp <= r.units[U('P1-Pawn')]!.maxHp);
});

test('DoT 동시 사망은 WT가 작은 쪽부터 정산한다 (GDD §3.9)', () => {
  const make = (p1Wt: number, p2Wt: number): BattleState => {
    const s = structuredClone(running(battle()));
    for (const u of Object.values(s.units)) u.wt = 1000;
    for (const id of ['P1-King', 'P2-King'] as const) {
      const u = s.units[U(id)]!;
      u.hp = 1;
      u.statuses.push({ status: 'dot', period: 100, magnitude: 1, lastTickedAt: 0 });
    }
    s.units[U('P1-King')]!.wt = p1Wt;
    s.units[U('P2-King')]!.wt = p2Wt;
    return s;
  };
  // WT가 작은 쪽이 먼저 쓰러지므로 그 상대가 이긴다
  assert.equal(advanceTime(make(150, 160)).state.winner, 'P2');
  assert.equal(advanceTime(make(160, 150)).state.winner, 'P1');
});

// ── 재현성 ─────────────────────────────────────────────────────

test('같은 시드 · 같은 의도열 → 완전히 같은 상태', () => {
  const script = (seed: number): BattleState => runTurns(running(battle(seed)), 25).state;
  assert.deepEqual(script(12345), script(12345));
  // 커서는 판정을 할 때만 는다
  assert.ok(script(12345).rngCursor >= 0);
});

test('rngCursor는 소비 순서를 그대로 기록한다', () => {
  const s = giveControl(place(battle(), {
    'P1-Rock': { x: 10, y: 10 },
    'P2-Bishop': { x: 11, y: 11 },   // 장합(무90) vs 관우(무98) → 38%
  }), U('P1-Rock'));
  assert.equal(s.rngCursor, 0);

  const r = apply(s, 'P1', { t: 'attack', targets: [U('P2-Bishop')] });
  assert.equal(r.state.rngCursor, 1, '크리티컬 판정 1회');

  // 같은 커서 위치의 난수로 같은 결론이 나와야 한다
  const hit = r.events.find((e) => e.e === 'attacked')!;
  assert.equal(hit.critical, floatAt(s.seed, 0) * 100 < FORMULA.criticalRate(98, 90));
});

test('roll은 0%에서 절대, 100%에서 반드시 — 그래도 난수는 소비한다', () => {
  const rng = { seed: 7, rngCursor: 0 };
  for (let i = 0; i < 50; i++) assert.equal(roll(rng, 0), false);
  for (let i = 0; i < 50; i++) assert.equal(roll(rng, 100), true);
  assert.equal(rng.rngCursor, 100);
});

test('난수 분포가 한쪽으로 쏠리지 않는다', () => {
  const rng = { seed: 20260731, rngCursor: 0 };
  let hits = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) if (roll(rng, 30)) hits++;
  const rate = hits / N;
  assert.ok(Math.abs(rate - 0.3) < 0.02, `30% 판정이 ${(rate * 100).toFixed(1)}%로 나왔다`);
});

// ── 불변식 ─────────────────────────────────────────────────────

test('apply/advanceTime은 입력 상태를 건드리지 않는다', () => {
  const idle = running(battle());
  const idleBefore = structuredClone(idle);
  advanceTime(idle);
  advanceTime(idle);
  assert.deepEqual(idle, idleBefore);

  const controlling = advanceTime(idle).state;
  const before = structuredClone(controlling);
  apply(controlling, sideOf(controlling, controlling.activeUnit!), { t: 'endTurn' });
  apply(controlling, 'P2', { t: 'surrender' });
  assert.deepEqual(controlling, before);
});

test('로그는 얕게 복사한다 — 긴 전투가 O(턴²)이 되지 않는다', () => {
  const s = advanceTime(running(battle())).state;
  assert.ok(s.log.length > 0);
  const next = apply(s, sideOf(s, s.activeUnit!), { t: 'endTurn' }).state;

  assert.notEqual(next.log, s.log, '배열 자체는 따로여야 입력이 오염되지 않는다');
  assert.equal(next.log.length > s.log.length, true);
  // 이벤트는 만들고 나면 바뀌지 않는 값이라 참조를 나눠 갖는다.
  // 여기서 deep clone으로 돌아가면 자동 대전(HANDOFF §7 5번)이 턴 수의 제곱으로 느려진다.
  assert.equal(next.log[0], s.log[0], '이벤트 객체는 참조를 공유해야 한다');
});

test('장기 진행 불변식 — HP/MP/SP 범위, 시간 단조 증가', () => {
  let s = running(battle());
  let prevTime = -1;
  for (let i = 0; i < 60 && !s.winner; i++) {
    s = advanceTime(s).state;
    assert.ok(s.time > prevTime, '절대시간은 단조 증가');
    prevTime = s.time;
    for (const u of Object.values(s.units)) {
      assert.ok(u.hp >= 0 && u.hp <= u.maxHp, `${u.id} HP ${u.hp}`);
      assert.ok(u.mp >= 0 && u.mp <= u.maxMp, `${u.id} MP ${u.mp}`);
      assert.ok(u.wt >= 0, `${u.id} WT ${u.wt}`);
    }
    for (const side of ['P1', 'P2'] as const) {
      assert.ok(s.sp[side] >= 0 && s.sp[side] <= s.spCap[side]);
    }
    if (!s.activeUnit) break;
    s = apply(s, sideOf(s, s.activeUnit), { t: 'endTurn' }).state;
  }
  assert.equal(s.log.length > 0, true);
});

// ── 무승부 상한 (GDD §3.9) ─────────────────────────────────────

test('time 6000에 닿으면 총 HP가 많은 쪽이 판정승', () => {
  let s = structuredClone(running(battle()));
  s.time = FORMULA.drawTimeLimit - 100;
  for (const u of Object.values(s.units)) u.wt = 200;   // 상한을 넘겨 진행시킨다
  s.units[U('P1-Rock')]!.hp = 3;                        // P1 총 23 vs P2 총 30

  const r = advanceTime(s);
  assert.equal(r.state.phase, 'finished');
  assert.equal(r.state.winner, 'P2', 'HP 합계가 큰 쪽');
  assert.equal(r.state.outcome, 'timeLimit');
  assert.ok(r.events.some((e) => e.e === 'battleEnded' && e.outcome === 'timeLimit'));
});

test('총 HP까지 같으면 진짜 무승부 — winner는 null이다', () => {
  let s = structuredClone(running(battle()));
  s.time = FORMULA.drawTimeLimit - 100;
  for (const u of Object.values(s.units)) u.wt = 200;

  const r = advanceTime(s);
  assert.equal(r.state.phase, 'finished');
  assert.equal(r.state.winner, null);
  assert.equal(r.state.outcome, 'draw');
  // winner만 보고 "안 끝났다"고 판단하면 안 된다
  assert.equal(validate(r.state, 'P1', { t: 'endTurn' }).ok, false);
});

test('죽은 유닛의 HP는 합계에 넣지 않는다', () => {
  let s = structuredClone(running(battle()));
  s.time = FORMULA.drawTimeLimit - 100;
  for (const u of Object.values(s.units)) u.wt = 200;
  // P2의 Bishop이 죽어 있으면 P1이 앞선다
  s.units[U('P2-Bishop')]!.alive = false;
  s.units[U('P2-Bishop')]!.hp = 0;

  assert.equal(advanceTime(s).state.winner, 'P1');
});

test('상한 전에는 판정하지 않는다', () => {
  let s = structuredClone(running(battle()));
  s.time = FORMULA.drawTimeLimit - 500;
  for (const u of Object.values(s.units)) u.wt = 100;   // 아직 상한에 못 미친다
  const r = advanceTime(s);
  assert.notEqual(r.state.phase, 'finished');
  assert.equal(r.state.outcome, undefined);
});

test('King 격파가 상한 판정보다 우선한다', () => {
  let s = place(battle(), { 'P1-Pawn': { x: 10, y: 10 }, 'P2-King': { x: 10, y: 11 } });
  s = structuredClone(s);
  s.time = FORMULA.drawTimeLimit - 1;
  s.units[U('P2-King')]!.hp = 2;
  // P2가 총 HP로는 앞서지만, King이 잡히면 그대로 진다
  s.units[U('P2-Bishop')]!.hp = 10;
  s = giveControl(s, U('P1-Pawn'));

  const r = apply(s, 'P1', { t: 'attack', targets: [U('P2-King')] });
  assert.equal(r.state.winner, 'P1');
  assert.equal(r.state.outcome, 'kingDown');
});

test('차례를 받을 유닛이 진행 중에 죽어도 스케줄러가 멈추지 않는다', () => {
  // 곽가 「유언계책」의 지연 사망이 "이제 곧 행동할 유닛"을 죽이는 상황을 만든다.
  // 예전에는 여기서 WT 0인 유닛이 사라져 activeUnit이 null인 채로 돌아왔고,
  // 호출자 입장에서는 전투가 그대로 멈춰 버렸다.
  let s = structuredClone(running(battle()));
  for (const u of Object.values(s.units)) u.wt = 500;
  const doomed = s.units[U('P2-Bishop')]!;
  doomed.wt = 100;          // 가장 먼저 차례가 온다
  doomed.hp = 1;
  doomed.statuses.push({ status: 'dot', period: 100, magnitude: 5, lastTickedAt: 0 });

  const r = advanceTime(s);
  assert.equal(r.state.units[U('P2-Bishop')]!.alive, false, '진행 중에 죽었다');
  assert.notEqual(r.state.activeUnit, null, '다음 유닛에게 제어권이 넘어가야 한다');
  assert.equal(r.state.phase, 'control');
});

// ═══════════════════════════════════════════════════════════════
// `[차례 넘기기]` 3번 — 「붙어 있는데 아무것도 안 두는」 쪽을 끝낸다 (§5-67)
// ═══════════════════════════════════════════════════════════════

/*
 * **20초 경과는 여기서 안 잰다** — 실시간이라 엔진이 모르고, 서버가
 * `controlStartedAtMs`로 막는다(`packages/server`의 `accepts()`). 엔진이 하는 일은
 * **세는 것**과 다 세었을 때 **끝내는 것**뿐이고, 그 둘이 여기 걸려 있다.
 */

test('넘기기는 진영별로 누적된다 — 되돌리지 않는다', () => {
  let s = giveControl(battle(9), U('P1-King'));
  const foe = sideOf(s, U('P1-King')) === 'P1' ? 'P2' : 'P1';
  const r = apply(s, foe, { t: 'forceSkipTurn' });
  s = r.state;
  assert.equal(s.skips[foe], 1);
  assert.equal(s.skips[foe === 'P1' ? 'P2' : 'P1'], 0, '누른 적 없는 쪽까지 셌다');
  assert.deepEqual(r.events.filter((e) => e.e === 'turnSkipped'),
    [{ e: 'turnSkipped', by: foe, count: 1 }], '화면이 「(n/3)」을 읽을 이벤트가 없다');
  // 그 사이에 정상적인 수가 오가도 횟수는 그대로다
  const back = giveControl(s, U('P1-King'));
  assert.equal(apply(back, 'P1', { t: 'endTurn' }).state.skips[foe], 1, '누적을 되돌렸다');
});

test('먼저 SKIP_TO_WIN번 누른 쪽이 이긴다 — 결말은 항복과 같이 적는다', () => {
  let s = battle(9);
  let winner: Side = 'P2';
  for (let i = 0; i < SKIP_TO_WIN; i++) {
    s = giveControl(s, U('P1-King'));
    winner = sideOf(s, U('P1-King')) === 'P1' ? 'P2' : 'P1';
    s = apply(s, winner, { t: 'forceSkipTurn' }).state;
  }
  assert.equal(s.phase, 'finished', `${SKIP_TO_WIN}번을 눌렀는데 안 끝났다`);
  assert.equal(s.winner, winner);
  // **엔진에 새 결말이 늘지 않는다** — 이탈 처리와 같은 장치를 세 번째로 쓴다
  assert.equal(s.outcome, 'surrender');
});

test('자기 차례는 넘길 수 없다 — 「빨리 세 번 누르기」가 되지 않게', () => {
  const s = giveControl(battle(9), U('P1-King'));
  const mine = sideOf(s, U('P1-King'));
  assert.equal(validate(s, mine, { t: 'forceSkipTurn' }).ok, false);
});
