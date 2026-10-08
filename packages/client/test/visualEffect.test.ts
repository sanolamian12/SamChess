/**
 * 시각 효과 매핑 회귀 — 「어떤 상태일 때 어떤 링이 뜨는가」를 못 박는다.
 *
 * 2026-10-08에 다섯 갈래로 접었다(기획자 확정): 시전 중 `cast-{등급}` · 고유기술 나쁨 `14` ·
 * 책략 나쁨 `2` · 고유기술 좋음 `17` · 책략 좋음 `1`. 여럿이면 이 순서로 3초씩 + 1초 페이드.
 *
 * 눈으로 확인하기가 특히 어려운 층이다 — 겹친 링의 페이드는 스크린샷 한 장으로 안 잡히고,
 * 「삼고초려를 맞은 적」 같은 상황은 판이 그렇게 되기를 기다려야 보인다.
 * `visualEffect.ts`가 Phaser를 부르지 않는 것은 그래서다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { BattleState, StatusId, UnitState } from '@samchess/rules';
import { VISUAL_EFFECTS, officerByName } from '@samchess/data';
import {
  PendingRings, RING_FADE_MS, RING_FRAME_MS, RING_HOLD_MS, SWAP_MS, counterOn, ringAt, ringFrame, ringsOn,
} from '../src/battle/visualEffect.ts';

const FX = VISUAL_EFFECTS.persistent;
const { skillDebuff, tacticDebuff, skillBuff, tacticBuff } = FX.rings;

/** 링 판정이 보는 것만 채운다 — 상태·조종·WT 보정·좌표·장수 id */
function unit(officerName: string, patch: Partial<UnitState> = {}): UnitState {
  const officer = officerByName.get(officerName);
  assert.ok(officer, `장수 '${officerName}' 이 없다`);
  return {
    id: 'P1-King', side: 'P1', officer: officer.id, piece: 'King', level: 1,
    hp: 10, maxHp: 10, mp: 5, maxMp: 5, at: 2, wt: 100, wtBase: 100, turnRank: 0,
    pos: { x: 3, y: 3 }, tactics: [], statuses: [], uniqueSkillUses: 1, alive: true,
    ...patch,
  } as UnitState;
}

/** `aurasOn()`은 실제 엔진을 부른다 — 원천 유닛을 함께 넣어야 오라가 걸린다 */
function stateOf(...us: UnitState[]): BattleState {
  return { units: Object.fromEntries(us.map((u) => [u.id, u])), terrain: [], time: 0 } as unknown as BattleState;
}

const status = (s: StatusId, extra: object = {}): UnitState['statuses'][number] =>
  ({ status: s, ...extra });
const bySkill = { origin: 'skill' } as const;

// ── 표 ──────────────────────────────────────────────────────────

test('다섯 갈래의 그림 — 1 · 2 · 14 · 17 + 시전 등급 넷 (2026-10-08 기획자 확정)', () => {
  assert.deepEqual(FX.rings, { skillDebuff: '14', tacticDebuff: '2', skillBuff: '17', tacticBuff: '1' });
  assert.deepEqual(FX.byCasting, { S: 'cast-S', A: 'cast-A', B: 'cast-B', E: 'cast-E' });
});

// ── 좋음/나쁨 × 고유기술/책략 ───────────────────────────────────

test('같은 상태라도 출처로 갈린다 — 크리티컬 100%는 「증폭」이면 1, 고유기술이면 17', () => {
  const tactic = unit('조인', { statuses: [status('critical100')] });
  const skill = unit('조인', { statuses: [status('critical100', bySkill)] });
  assert.deepEqual(ringsOn(stateOf(tactic), tactic), [tacticBuff]);
  assert.deepEqual(ringsOn(stateOf(skill), skill), [skillBuff]);
});

test('나쁜 효과 — 환술(침묵)은 2, 고유기술(봉인)은 14', () => {
  const silenced = unit('조인', { statuses: [status('silence')] });
  const sealed = unit('조인', { statuses: [status('skillSealed', bySkill)] });
  assert.deepEqual(ringsOn(stateOf(silenced), silenced), [tacticDebuff]);
  assert.deepEqual(ringsOn(stateOf(sealed), sealed), [skillDebuff]);
});

test('조종은 언제나 나쁨 — 「유인」 · 「초선」은 2, 「연환계」 · 삼고초려는 14', () => {
  const tactic = unit('조인', { control: { by: 'P2-King' as never, mode: 'moveOnly', uses: 1 } });
  const skill = unit('조인', { control: { by: 'P2-King' as never, mode: 'moveAndAttack', uses: null, origin: 'skill' } });
  assert.deepEqual(ringsOn(stateOf(tactic), tactic), [tacticDebuff]);
  assert.deepEqual(ringsOn(stateOf(skill), skill), [skillDebuff]);
});

test('여포 오라 — 켠 여포는 17, 반경 안의 적은 14 (오라는 영향받는 쪽에 흔적이 없다)', () => {
  const yeo = unit('여포', {
    id: 'P2-King' as never, side: 'P2', pos: { x: 5, y: 3 },
    statuses: [status('auraOutgoingHalf', { magnitude: 2, ...bySkill })],
  });
  const near = unit('조인', { pos: { x: 3, y: 3 } });
  const far = unit('조인', { id: 'P1-Rock' as never, pos: { x: 15, y: 15 } });
  const s = stateOf(yeo, near, far);
  assert.deepEqual(ringsOn(s, yeo), [skillBuff]);
  assert.deepEqual(ringsOn(s, near), [skillDebuff]);
  assert.deepEqual(ringsOn(s, far), [], '반경 밖');
});

test('허저 오라 — 반경 안의 아군은 17', () => {
  const heo = unit('허저', {
    id: 'P1-Rock' as never, pos: { x: 4, y: 3 },
    statuses: [status('auraIncomingHalf', { magnitude: 1, ...bySkill })],
  });
  const ally = unit('조인');
  assert.deepEqual(ringsOn(stateOf(heo, ally), ally), [skillBuff]);
});

test('`wtModifiers`(병귀신속 · 신속)는 고유기술 좋음 — 다 쓰면 꺼진다', () => {
  const fast = unit('서황', { wtModifiers: [{ delta: -50, turnsLeft: 3 }] });
  const done = unit('서황', { wtModifiers: [{ delta: -50, turnsLeft: 0 }] });
  assert.deepEqual(ringsOn(stateOf(fast), fast), [skillBuff]);
  assert.deepEqual(ringsOn(stateOf(done), done), []);
});

test('성지 칸 위라도 링은 없다 — 칸 그림이 이미 말한다', () => {
  const u = unit('손권', { pos: { x: 4, y: 7 } });
  const s = { ...stateOf(u), terrain: [{ pos: { x: 4, y: 7 }, terrain: 'holy', lastTickedAt: 0 }] } as unknown as BattleState;
  assert.deepEqual(ringsOn(s, u), []);
});

test('유비 「삼고초려」 — 유비 17 → 맞은 적 14(+ 숫자) → 넘어간 적 14', () => {
  const yu = unit('유비', { statuses: [status('convertOnHit', { charges: 3, ...bySkill })] });
  assert.deepEqual(ringsOn(stateOf(yu), yu), [skillBuff]);
  const marked = unit('조인', { statuses: [status('convertProgress', { magnitude: 2, charges: 3, ...bySkill })] });
  assert.deepEqual(ringsOn(stateOf(marked), marked), [skillDebuff]);
  assert.deepEqual(counterOn(marked), { text: '2/3', kind: 'debuff' });
  const taken = unit('조인', { control: { by: 'P1-King' as never, mode: 'moveAndAttack', uses: null, origin: 'skill' } });
  assert.deepEqual(ringsOn(stateOf(taken), taken), [skillDebuff]);
});

// ── 시전 중 ─────────────────────────────────────────────────────

test('고유기술 시전 중에는 장수 **등급**의 오라 — 기술이 아니라 장수로 고른다', () => {
  for (const [name, grade] of [['관우', 'S'], ['조창', 'A'], ['헌제', 'E']] as const) {
    const u = unit(name, { casting: 'x' as never });
    assert.deepEqual(ringsOn(stateOf(u), u), [FX.byCasting[grade]], `${name}(${grade})`);
  }
  const after = unit('관우');
  assert.deepEqual(ringsOn(stateOf(after), after), [], '필드가 없으면 링도 없다');
});

// ── 순서 · 겹침 ─────────────────────────────────────────────────

test('여럿이면 시전 → 고유기술 나쁨 → 책략 나쁨 → 고유기술 좋음 → 책략 좋음 — 걸린 순서와 무관', () => {
  const u = unit('관우', {
    casting: 'x' as never,
    statuses: [status('critical100'), status('incomingDamageHalf', bySkill), status('silence'), status('dot', bySkill)],
  });
  assert.deepEqual(ringsOn(stateOf(u), u), [FX.byCasting.S, skillDebuff, tacticDebuff, skillBuff, tacticBuff]);
});

test('같은 갈래는 한 번만 — 책략 좋음이 셋이어도 1 하나', () => {
  const u = unit('조인', { statuses: [status('critical100'), status('incomingDamageHalf'), status('illusionImmune')] });
  assert.deepEqual(ringsOn(stateOf(u), u), [tacticBuff]);
});

test('화면이 물고 있는 링(`PendingRings`)도 같은 순서에 끼운다', () => {
  const u = unit('조인', { statuses: [status('critical100')] });
  assert.deepEqual(ringsOn(stateOf(u), u, tacticDebuff), [tacticDebuff, tacticBuff], '「함정」에 밀린 차례가 앞');
});

// ── 3초 + 1초 페이드 ────────────────────────────────────────────

test('하나뿐이면 깜빡이지 않는다 · 없으면 null', () => {
  assert.deepEqual(ringAt(['1'], SWAP_MS * 7 + 10), { vfx: '1', alpha: 1 });
  assert.equal(ringAt([], 0), null);
});

test('겹치면 3초 온전히 + 1초 페이드(나가는 것 반 · 들어오는 것 반)', () => {
  assert.equal(SWAP_MS, RING_HOLD_MS + RING_FADE_MS);
  const rings = ['14', '1'];
  const half = RING_FADE_MS / 2;
  assert.deepEqual(ringAt(rings, 0), { vfx: '14', alpha: 0 }, '들어오기 시작');
  assert.deepEqual(ringAt(rings, half / 2), { vfx: '14', alpha: 0.5 });
  assert.deepEqual(ringAt(rings, half), { vfx: '14', alpha: 1 });
  assert.deepEqual(ringAt(rings, half + RING_HOLD_MS), { vfx: '14', alpha: 1 }, '3초 동안 온전히');
  assert.deepEqual(ringAt(rings, SWAP_MS - half / 2), { vfx: '14', alpha: 0.5 }, '나가는 중');
  assert.equal(ringAt(rings, SWAP_MS)!.vfx, '1', '다음 링');
  assert.equal(ringAt(rings, SWAP_MS * 2)!.vfx, '14', '한 바퀴 돌면 처음으로');
});

// ── 4칸 띠 — 0.5초마다 칸 넘기기 ────────────────────────────────

test('4칸 띠는 0.5초마다 칸을 넘긴다 · 정지 이미지는 언제나 0', () => {
  assert.equal(ringFrame(RING_FRAME_MS - 1, 4), 0);
  assert.equal(ringFrame(RING_FRAME_MS, 4), 1);
  assert.equal(ringFrame(RING_FRAME_MS * 4, 4), 0);
  assert.equal(ringFrame(RING_FRAME_MS * 9, 1), 0);
});

// ── 동그라미 숫자 ───────────────────────────────────────────────

test('「세는」 상태는 고유기술 동그라미의 숫자 — AT 누적은 때린 뒤부터, 즉사는 !', () => {
  assert.equal(counterOn(unit('강유', { statuses: [status('attackStacking', { magnitude: 0 })] })), null, '아직 안 때렸다');
  assert.deepEqual(counterOn(unit('강유', { statuses: [status('attackStacking', { magnitude: 2 })] })), { text: '+2', kind: 'buff' });
  assert.deepEqual(counterOn(unit('관우', { statuses: [status('instantKillNext')] })), { text: '!', kind: 'buff' });
  assert.equal(counterOn(unit('조인')), null);
});

// ── 즉시 WT — 엔진에 흔적이 없는 것을 화면이 물고 있는다 ──────────

test('즉시 WT를 미는 것 · 당기는 것은 데이터가 알려 준다 — 개량형은 원본을 잇는다', () => {
  assert.deepEqual(FX.instantWt, {
    'skill:jang-pan-ha-roe': 'debuff', 'skill:sip-myeon-mae-bok': 'debuff',
    'tactic:gyeong-jik': 'debuff', 'tactic:gyeong-jik-plus': 'debuff',
    'tactic:ham-jeong': 'debuff', 'tactic:ham-jeong-plus': 'debuff',
    'tactic:seon-gong': 'buff', 'tactic:seon-gong-plus': 'buff',
  }, '신속 · 병귀신속은 turns가 있어 wtModifiers에 남는다 — 여기 없다');
});

test('붙들어 둔 링은 제어권을 받는 순간 지워진다', () => {
  const held = new PendingRings();
  held.mark('P1-Rock' as never, tacticBuff);
  assert.equal(held.get('P1-Rock' as never), '1');
  held.clear('P1-Rock' as never);
  assert.equal(held.get('P1-Rock' as never), undefined, '당겨진 차례가 실제로 왔다');
});
