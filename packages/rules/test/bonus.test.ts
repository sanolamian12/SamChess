/**
 * 컬렉션 전투 효과 — `RosterEntry.bonuses` (2026-10-14, `Design/컬렉션_기획.md` §3).
 *
 * 여기서 고정하는 것.
 *  - 조건(`with` · `min` · `vs`)은 **판을 만들 때 한 번** 판정하고, 켜진 것만 `UnitState.bonuses`에 남는다
 *  - HP · MP · AT는 유닛 값에, 무 · 지 · 통은 `officerStats()`에, 통솔은 `wtBase`에까지 닿는다
 *  - 고유기술 SP 비용은 `uniqueSkillCost()` 하나 — 검사 · 적용 · 단추 상태가 같은 값을 본다
 *  - 진영 SP는 여럿 켜져도 **가장 큰 값 하나**
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combatantById, skillById } from '@samchess/data';
import { apply, createBattle, validate } from '../src/battle.ts';
import { skillStatus } from '../src/commands.ts';
import { officerStats, uniqueSkillCost } from '../src/state.ts';
import {
  COLLECTION_HOLD_MS, COLLECTION_IN_MS, COLLECTION_OUT_MS, COLLECTION_SWAP_MS, COLLECTION_TITLE_MS, DEPLOY_MS, collectionIntroMs, deployLimitMs, firedCollections,
} from '../src/timing.ts';
import type { BattleState, OfficerId, RosterBonus, RosterEntry } from '../src/types.ts';
import { R, U, giveControl } from './fixtures.ts';

const O = (id: string): OfficerId => id as OfficerId;
const withB = (e: RosterEntry, ...bonuses: RosterBonus[]): RosterEntry => ({ ...e, bonuses });

/** 유비 · 관우 · 조식 vs 조조 · 장합 · 헌제 — `fixtures.battle()`과 같은 판에 보너스만 얹는다 */
function make(p1: RosterEntry[], p2?: RosterEntry[]): BattleState {
  return createBattle({
    matchId: 't', seed: 1, mode: '3v3',
    rosters: {
      P1: p1,
      P2: p2 ?? [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
    },
  });
}
const plain = (): BattleState => make([R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')]);

test('보너스 — 조건 없는 능력치 여섯이 제자리에 닿는다 (통솔은 WT까지)', () => {
  const s0 = plain();
  const s = make([
    withB(R('yu-bi', 'King'),
      { source: 'a', kind: 'stat', stat: 'might', value: 1 },
      { source: 'b', kind: 'stat', stat: 'intellect', value: 2 },
      { source: 'c', kind: 'stat', stat: 'leadership', value: 3 },
      { source: 'd', kind: 'stat', stat: 'hp', value: 2 },
      { source: 'e', kind: 'stat', stat: 'mp', value: 1 },
      { source: 'f', kind: 'stat', stat: 'at', value: 0.5 }),
    R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'),
  ]);
  const a = s0.units[U('P1-King')]!;
  const b = s.units[U('P1-King')]!;
  assert.equal(officerStats(b).might - officerStats(a).might, 1);
  assert.equal(officerStats(b).intellect - officerStats(a).intellect, 2);
  assert.equal(officerStats(b).leadership - officerStats(a).leadership, 3);
  assert.equal(a.wtBase - b.wtBase, 3, '`WT = 190 − 통솔력` — 통솔 +3이면 차례가 3 빨리 온다');
  assert.equal(b.maxHp - a.maxHp, 2);
  assert.equal(b.hp, b.maxHp);
  assert.equal(b.maxMp - a.maxMp, 1);
  assert.equal(b.at - a.at, 0.5);
  assert.equal(b.bonuses?.length, 6);
  assert.equal(a.bonuses, undefined, '보너스가 없으면 키 자체가 없다');
});

test('보너스 — `with`는 제 진영에 전원, `min`이면 그 수 이상', () => {
  const hp = (src: string, cond: Partial<RosterBonus>): RosterBonus =>
    ({ source: src, kind: 'stat', stat: 'hp', value: 2, ...cond }) as RosterBonus;
  const s = make([
    withB(R('yu-bi', 'King'),
      hp('allHere', { with: [O('yu-bi'), O('gwan-u')] }),
      hp('oneMissing', { with: [O('yu-bi'), O('gwan-u'), O('jang-bi')] }),
      hp('min2', { with: [O('yu-bi'), O('gwan-u'), O('jang-bi')], min: 2 }),
      hp('min3', { with: [O('yu-bi'), O('gwan-u'), O('jang-bi')], min: 3 })),
    R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'),
  ]);
  assert.deepEqual(s.units[U('P1-King')]!.bonuses?.map((b) => b.source), ['allHere', 'min2']);
});

test('보너스 — `vs`는 상대 진영에 전원, 제 진영에 있는 것은 안 친다', () => {
  const s = make([
    withB(R('yu-bi', 'King'),
      { source: 'foeHere', kind: 'stat', stat: 'might', value: 2, vs: [O('jo-jo')] },
      { source: 'foeMissing', kind: 'stat', stat: 'might', value: 2, vs: [O('jo-jo'), O('yeo-po')] },
      { source: 'allyNotFoe', kind: 'stat', stat: 'might', value: 2, vs: [O('gwan-u')] },
      { source: 'both', kind: 'stat', stat: 'might', value: 2, with: [O('gwan-u')], vs: [O('jang-hap')] }),
    R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'),
  ]);
  assert.deepEqual(s.units[U('P1-King')]!.bonuses?.map((b) => b.source), ['foeHere', 'both']);
});

test('보너스 — 고유기술 SP −1: 비용 · 단추 상태 · 검사 · 적용이 같은 값을 본다', () => {
  const skill = skillById.get(combatantById.get('yu-bi')!.uniqueSkill!)!;
  const cheap = make([
    withB(R('yu-bi', 'King'), { source: 'sam-go', kind: 'skillSp', skill: skill.id, delta: -1 }),
    R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'),
  ]);
  const unit = cheap.units[U('P1-King')]!;
  assert.equal(uniqueSkillCost(plain().units[U('P1-King')]!), skill.spCost);
  assert.equal(uniqueSkillCost(unit), skill.spCost - 1);

  // SP를 「깎인 비용」에 정확히 맞춘다 — 원래 비용으로는 모자라고 깎인 비용으로는 된다
  const s = giveControl(cheap, U('P1-King'));
  s.sp.P1 = skill.spCost - 1;
  assert.equal(skillStatus(s, U('P1-King')), 'ready');
  const v = validate(s, 'P1', { t: 'castUniqueSkill' });
  assert.ok(v.ok || !v.reason.includes('SP'), v.ok ? '' : v.reason);

  const p = giveControl(plain(), U('P1-King'));
  p.sp.P1 = skill.spCost - 1;
  assert.equal(skillStatus(p, U('P1-King')), 'poor', '보너스가 없으면 같은 SP로 모자란다');

  if (v.ok) {
    const { state } = apply(s, 'P1', { t: 'castUniqueSkill' });
    assert.equal(state.sp.P1, 0, '깎인 비용만큼만 나간다');
  }
});

test('보너스 — 다른 고유기술을 가리키는 SP 보너스는 안 먹는다', () => {
  const s = make([
    withB(R('yu-bi', 'King'), { source: 'x', kind: 'skillSp', skill: 'cha-dong-pung', delta: -1 }),
    R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'),
  ]);
  const skill = skillById.get(combatantById.get('yu-bi')!.uniqueSkill!)!;
  assert.equal(uniqueSkillCost(s.units[U('P1-King')]!), skill.spCost);
});

test('보너스 — 진영 SP는 켜진 것 중 가장 큰 값 하나로 시작한다 (더하지 않는다)', () => {
  const team = (src: string, cond: Partial<RosterBonus> = {}): RosterBonus =>
    ({ source: src, kind: 'teamSp', value: 1, ...cond }) as RosterBonus;
  assert.deepEqual(plain().sp, { P1: 0, P2: 0 });

  const s = make([
    withB(R('yu-bi', 'King'), team('a'), team('b')),
    withB(R('gwan-u', 'Rock'), team('a')),
    R('jo-sik', 'Pawn'),
  ]);
  assert.deepEqual(s.sp, { P1: 1, P2: 0 }, '셋이 켜져도 +1, 상대 진영은 그대로');

  const off = make([
    withB(R('yu-bi', 'King'), team('a', { vs: [O('yeo-po')] })),
    R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'),
  ]);
  assert.deepEqual(off.sp, { P1: 0, P2: 0 }, '조건이 안 맞으면 안 켜진다');
});

test('보너스 — 부상과 겹치면 보너스를 먼저 더하고 부상을 뺀다', () => {
  const s = make([
    { ...withB(R('yu-bi', 'King'), { source: 'a', kind: 'stat', stat: 'might', value: 2 }), injured: true },
    R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'),
  ]);
  const hurt = make([{ ...R('yu-bi', 'King'), injured: true }, R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')]);
  assert.equal(officerStats(s.units[U('P1-King')]!).might - officerStats(hurt.units[U('P1-King')]!).might, 2);
});

test('발동 장면 — 북군 먼저 · 진영마다 컬렉션 한 장(여러 장수에 붙어도) · 길이는 장 수로, 배치 마감은 장면 + 30초', () => {
  const hp = (src: string): RosterBonus => ({ source: src, kind: 'stat', stat: 'hp', value: 1 }) as RosterBonus;
  const none = plain();
  assert.equal(collectionIntroMs(none), 0, '켜진 것이 없는데 장면 길이가 있다');
  assert.equal(deployLimitMs(none), DEPLOY_MS, '켜진 것이 없으면 배치는 곧장 30초다');
  // 남군 둘(그중 하나는 두 장수에 붙었다) · 북군 하나 — 같은 컬렉션이 양 진영에 켜지면 진영마다 한 장
  const s = make(
    [withB(R('yu-bi', 'King'), hp('shared'), hp('south')), withB(R('gwan-u', 'Rock'), hp('shared')), R('jo-sik', 'Pawn')],
    [withB(R('jo-jo', 'King'), hp('shared')), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')],
  );
  assert.deepEqual(firedCollections(s).map((f) => `${f.side}|${f.source}`), ['P2|shared', 'P1|shared', 'P1|south']);
  // 마디 둘 — 북군 1장 · 남군 2장, 마디마다 제목이 앞에 선다
  const seg = (n: number): number =>
    COLLECTION_TITLE_MS + COLLECTION_IN_MS + n * COLLECTION_HOLD_MS + (n - 1) * COLLECTION_SWAP_MS + COLLECTION_OUT_MS;
  const ms = seg(1) + seg(2);
  assert.equal(collectionIntroMs(s), ms);
  assert.equal(deployLimitMs(s), DEPLOY_MS + ms);
  assert.equal(COLLECTION_HOLD_MS, 700, '「짠」 하고 머무는 시간은 0.7초다 (기획자 지정 — 1초에서 줄였다)');
  // 한쪽만 켜졌으면 그쪽 제목만 — 켜진 것이 없는 진영의 마디는 0
  const oneSide = make([withB(R('yu-bi', 'King'), hp('south')), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')]);
  assert.equal(collectionIntroMs(oneSide), seg(1), '켜진 것이 없는 진영에도 제목 마디가 섰다');
});
