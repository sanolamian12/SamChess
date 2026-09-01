/**
 * 시각 효과 매핑 회귀 — 「어떤 상태일 때 어떤 링이 뜨는가」를 못 박는다.
 *
 * 눈으로 확인하기가 특히 어려운 층이다. 「여포가 자유 이동을 쓰기 **전에는** 5,
 * 쓰고 나면 10」 같은 규칙은 판이 그 상황이 되기를 기다려야 보이고, 겹친 링의
 * 2초 스왑은 스크린샷 한 장으로는 아예 잡히지 않는다 — 액션 자세 때
 * 「연출은 스크린샷으로 검증할 수 없다」로 밟았던 것과 같은 자리다.
 *
 * `visualEffect.ts`가 Phaser를 부르지 않는 것은 그래서다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { STATUS_META } from '@samchess/rules';
import type { BattleState, StatusId, UnitState } from '@samchess/rules';
import { VISUAL_EFFECTS, officerByName } from '@samchess/data';
import {
  PendingRings, RING_FRAME_MS, SWAP_MS, ringAt, ringFrame, ringsOn, unmappedStatuses,
} from '../src/battle/visualEffect.ts';

const FX = VISUAL_EFFECTS.persistent;

/** 링 판정이 보는 것만 채운다 — 상태·조종·WT 보정·좌표·장수 id */
function unit(officerName: string, patch: Partial<UnitState> = {}): UnitState {
  const officer = officerByName.get(officerName);
  assert.ok(officer, `장수 '${officerName}' 이 없다`);
  return {
    id: 'P1-King', side: 'P1', officer: officer.id, piece: 'King', level: 1,
    hp: 10, maxHp: 10, mp: 5, maxMp: 5, at: 2, wt: 100, wtBase: 100,
    pos: { x: 3, y: 3 }, tactics: [], statuses: [], uniqueSkillUses: 1, alive: true,
    ...patch,
  } as UnitState;
}

/** `aurasOn()`은 실제 엔진을 부른다 — 이 유닛 하나뿐이면 오라 원천이 없어 빈 배열이다 */
function stateOf(u: UnitState, terrain: BattleState['terrain'] = []): BattleState {
  return { units: { [u.id]: u }, terrain, time: 0 } as unknown as BattleState;
}

const status = (s: StatusId, extra: object = {}): UnitState['statuses'][number] =>
  ({ status: s, ...extra });

// ── 표 자체의 건전성 ────────────────────────────────────────────

test('상태이상 22종이 전부 표에 있다 — 새 상태가 링 없이 새지 않는다', () => {
  // `STATUS_META`는 `Record<StatusId, …>`라 상태가 늘면 **컴파일이 깨져** 이름·설명은
  // 반드시 채우게 되어 있다. 그림 표는 JSON이라 그 보호가 없어서 여기서 막는다.
  assert.deepEqual(unmappedStatuses(), [],
    '표에도 noVfx에도 없는 상태가 있다 — extract_data.py의 STATUS_FX_BY_STATUS를 채울 것');
  assert.equal(Object.keys(STATUS_META).length,
    Object.keys(FX.byStatus).length + FX.noVfx.length);
});

test('30장이 하나도 남거나 모자라지 않는다', () => {
  const used = new Set<string>([
    ...Object.values(FX.byStatus), ...Object.values(FX.byAura),
    ...Object.values(FX.byControl), ...Object.values(FX.byTerrain),
    FX.wtModifier, ...FX.combo.map((c) => c.vfx),
    ...Object.values(VISUAL_EFFECTS.oneShot.bySkill),
    ...Object.values(VISUAL_EFFECTS.oneShot.byTactic),
  ]);
  const numbered = [...used].filter((v) => /^\d+$/.test(v));
  const lettered = [...used].filter((v) => /^[A-Z]$/.test(v));
  assert.equal(numbered.length, 23, '지속형 링 23장이 전부 쓰여야 한다');
  assert.equal(lettered.length, 7, '일회성 7장이 전부 쓰여야 한다');
});

// ── 기본 매핑 ───────────────────────────────────────────────────

test('상태 하나면 링 하나 — 「용맹전진」은 받는 피해 절반이라 1', () => {
  const u = unit('조인', { statuses: [status('incomingDamageHalf', { expiresAt: 190 })] });
  assert.deepEqual(ringsOn(stateOf(u), u), ['1']);
});

test('조종은 `statuses`가 아니라 `control`에 있다 — 방식으로 갈린다', () => {
  const puppet = unit('조인', { control: { by: 'P2-King', mode: 'moveOnly', uses: 1 } });
  assert.deepEqual(ringsOn(stateOf(puppet), puppet), ['23'], '「유인」·「연환계」는 이동만');

  const taken = unit('조인', { control: { by: 'P2-King', mode: 'moveAndAttack', uses: null } });
  assert.deepEqual(ringsOn(stateOf(taken), taken), ['6'],
    '「초선」과 삼고초려의 영구 조종은 같은 6');
});

test('성지(holy) 위에 서면 켜진다 — 손권 「수성지주」', () => {
  const u = unit('손권', { pos: { x: 4, y: 7 } });
  const on = stateOf(u, [{ pos: { x: 4, y: 7 }, terrain: 'holy', lastTickedAt: 0 }]);
  assert.deepEqual(ringsOn(on, u), ['17']);

  const off = stateOf(u, [{ pos: { x: 9, y: 9 }, terrain: 'holy', lastTickedAt: 0 }]);
  assert.deepEqual(ringsOn(off, u), [], '자리를 벗어나면 꺼진다');
});

test('`wtModifiers`가 남은 동안 19 — 「병귀신속」 3턴 · 「신속」 1턴', () => {
  const fast = unit('서황', { wtModifiers: [{ delta: -50, turnsLeft: 3 }] });
  assert.deepEqual(ringsOn(stateOf(fast), fast), ['19']);

  const done = unit('서황', { wtModifiers: [{ delta: -50, turnsLeft: 0 }] });
  assert.deepEqual(ringsOn(stateOf(done), done), [], '다 쓰면 꺼진다');
});

// ── 장수별 예외 셋 ──────────────────────────────────────────────

test('조운 「간뇌도지」 — 반감+크리티컬이 전용 링 12 하나로 접힌다', () => {
  const jo = unit('조운', {
    statuses: [status('incomingDamageHalf', { expiresAt: 290 }),
      status('critical100', { expiresAt: 290 })],
  });
  assert.deepEqual(ringsOn(stateOf(jo), jo), ['12'], '1과 4가 사라지고 12만 남는다');

  // 다른 장수가 같은 둘을 얻었다면 접지 않는다 — 조운 전용 그림이다
  const other = unit('조인', {
    statuses: [status('incomingDamageHalf'), status('critical100')],
  });
  assert.deepEqual(ringsOn(stateOf(other), other), ['1', '4']);
});

test('조운 — 한쪽만 걸려 있으면 접지 않는다', () => {
  const half = unit('조운', { statuses: [status('incomingDamageHalf')] });
  assert.deepEqual(ringsOn(stateOf(half), half), ['1'],
    '「반감」 책략만 맞았을 때까지 12가 되면 간뇌도지와 구분이 안 된다');
});

test('여포 「인중여포」 — 자유 이동이 남았으면 5, 쓰고 나면 10', () => {
  const before = unit('여포', {
    statuses: [status('freeMove', { charges: 1 }),
      status('auraOutgoingHalf', { expiresAt: 290, magnitude: 2 })],
  });
  assert.deepEqual(ringsOn(stateOf(before), before), ['5'],
    '이동 단계에는 감녕과 같은 5 하나만 — 스왑하면 「아직 남았나」가 안 보인다');

  const after = unit('여포', {
    statuses: [status('auraOutgoingHalf', { expiresAt: 290, magnitude: 2 })],
  });
  assert.deepEqual(ringsOn(stateOf(after), after), ['10'],
    'freeMove가 빠지면 자기 표식 10이 저절로 드러난다');
});

test('여포 — 반경 안의 적이 보는 것은 9다 (「공포」와 같은 그림)', () => {
  // 오라는 **영향받는 쪽에 흔적이 없다**(GDD §12 A1). 시전자의 10과 다른 그림이라야
  // 「누가 켰나」와 「내가 걸렸나」가 구분된다.
  assert.equal(FX.byStatus['auraOutgoingHalf'], '10', '켠 쪽');
  assert.equal(FX.byAura['auraOutgoingHalf'], '9', '당하는 쪽');
  assert.equal(FX.byStatus['outgoingDamageHalf'], '9', '「공포」도 같은 뜻이라 같은 그림');
});

test('허저 「단기도강」 — 켠 쪽과 당하는 쪽이 같은 1이다', () => {
  assert.equal(FX.byStatus['auraIncomingHalf'], '1');
  assert.equal(FX.byAura['auraIncomingHalf'], '1');
});

// ── 유비 3단계 ──────────────────────────────────────────────────

test('유비 「삼고초려」 — 14(유비) → 13(맞은 적) → 6(넘어간 적)', () => {
  const yu = unit('유비', { statuses: [status('convertOnHit', { expiresAt: 490, charges: 3 })] });
  assert.deepEqual(ringsOn(stateOf(yu), yu), ['14'], '표식을 쌓는 중인 유비 자신');

  const marked = unit('조인', {
    statuses: [status('convertProgress', { charges: 3, sourceUnit: 'P1-King' })],
  });
  assert.deepEqual(ringsOn(stateOf(marked), marked), ['13'], '아직 1~2회 — 넘어가기 전');

  const taken = unit('조인', { control: { by: 'P1-King', mode: 'moveAndAttack', uses: null } });
  assert.deepEqual(ringsOn(stateOf(taken), taken), ['6'], '3회를 채워 영구히 넘어갔다');
});

// ── 겹칠 때 — 2초 스왑 ──────────────────────────────────────────

test('겹치면 2초마다 갈아 끼운다 — 줄여서 겹치지 않는다', () => {
  const rings = ['1', '4', '19'];
  assert.equal(ringAt(rings, 0), '1');
  assert.equal(ringAt(rings, SWAP_MS - 1), '1');
  assert.equal(ringAt(rings, SWAP_MS), '4');
  assert.equal(ringAt(rings, SWAP_MS * 2), '19');
  assert.equal(ringAt(rings, SWAP_MS * 3), '1', '한 바퀴 돌면 처음으로');
});

test('하나뿐이면 스왑하지 않는다 · 없으면 null', () => {
  assert.equal(ringAt(['4'], SWAP_MS * 7), '4');
  assert.equal(ringAt([], 0), null);
});

// ── 4칸 띠(「불꽃」류 시범, 2026-09-01) — 0.5초마다 칸 넘기기 ──────

test('4칸 띠는 0.5초마다 칸을 넘긴다 — 좌상(0)부터 시계방향', () => {
  assert.equal(ringFrame(0, 4), 0);
  assert.equal(ringFrame(RING_FRAME_MS - 1, 4), 0);
  assert.equal(ringFrame(RING_FRAME_MS, 4), 1);
  assert.equal(ringFrame(RING_FRAME_MS * 3, 4), 3);
  assert.equal(ringFrame(RING_FRAME_MS * 4, 4), 0, '한 바퀴 돌면 처음으로');
});

test('한 칸짜리 정지 이미지는 언제나 0 — frameCount가 그림의 갈래를 말해 준다', () => {
  assert.equal(ringFrame(0, 1), 0);
  assert.equal(ringFrame(RING_FRAME_MS * 9, 1), 0);
});

test('링 순서는 결정적이다 — 스왑이 순서를 타므로 깜빡이면 안 된다', () => {
  const u = unit('조인', {
    statuses: [status('critical100'), status('silence'), status('zeroMpCost')],
    control: { by: 'P2-King', mode: 'moveOnly', uses: 1 },
  });
  const s = stateOf(u);
  assert.deepEqual(ringsOn(s, u), ringsOn(s, u));
  assert.deepEqual(ringsOn(s, u), ['4', '22', '20', '23'], '걸린 순서 그대로, 조종이 마지막');
});

test('같은 그림이 두 번 나오면 한 번만 센다', () => {
  // 「고육지책」은 받는 피해 절반(1)과 대신받기를 함께 걸고, 대신받기는 전용 그림이 없다
  const u = unit('조인', {
    statuses: [status('incomingDamageHalf'), status('damageRedirect')],
  });
  assert.deepEqual(ringsOn(stateOf(u), u), ['1'],
    '전용 그림이 없는 상태는 조용히 빠진다 — 같은 스킬의 1이 대신 띄운다');
});

// ── 「선공」 — 엔진에 흔적이 없는 것을 화면이 물고 있는다 ──────────

test('즉시 차례를 당기는 것은 데이터가 알려 준다 — 「선공」뿐', () => {
  assert.deepEqual(FX.hastenWt.tactics, ['seon-gong'],
    '`modifyWt` · delta<0 · turns 없음. 지속이 붙는 날 목록에서 저절로 빠진다');
  assert.deepEqual(FX.hastenWt.skills, [], '신속·병귀신속은 turns가 있어 wtModifiers에 남는다');
});

test('붙들어 둔 링은 제어권을 받는 순간 지워진다', () => {
  const held = new PendingRings();
  held.mark('P1-Rock', FX.wtModifier);
  assert.equal(held.get('P1-Rock'), '19');
  held.clear('P1-Rock');
  assert.equal(held.get('P1-Rock'), undefined, '당겨진 차례가 실제로 왔다');
});

// ── 일회성 ──────────────────────────────────────────────────────

test('일회성은 기술·책략 id 가 키다 — 상태로는 잡을 수 없다', () => {
  const { bySkill, byTactic } = VISUAL_EFFECTS.oneShot;
  // 방덕 「세한지송백」(multiplyMaxHp)은 **이벤트조차 내지 않는다**. 회복·WT는
  // 이벤트가 있지만 「누가 걸었나」가 없어서, 결국 시전 자체로 잡는 편이 한 가지다.
  assert.equal(bySkill['se-han-ji-song-baek'], 'C');
  assert.equal(bySkill['ji-gon-sang-jeung'], 'A');
  assert.equal(bySkill['han-cheon-gam-u'], 'A', '같은 회복이면 같은 그림');
  assert.equal(byTactic['hoe-bok'], 'A');
  assert.equal(bySkill['jang-pan-ha-roe'], 'D');
  assert.equal(byTactic['gyeong-jik'], 'D', 'WT를 미는 것은 전부 D');
});

test('지속형과 일회성이 겹치는 id 는 없다', () => {
  const persistent = new Set([...Object.values(FX.byStatus), ...Object.values(FX.byAura)]);
  for (const vfx of Object.values(VISUAL_EFFECTS.oneShot.bySkill)) {
    assert.ok(!persistent.has(vfx), `${vfx} 가 양쪽에 있다`);
  }
});
