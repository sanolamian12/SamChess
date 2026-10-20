/**
 * 관리자 조정 회귀 (2026-10-20, `src/admin.ts`).
 *
 * 여기서 고정하는 것.
 *  - **값은 0 밑으로 안 내려간다** — 모자라면 계정을 안 바꾸고 이유를 말한다
 *  - **군량은 창고 상한까지** — 넘기면 다음 충전에서 `syncGrain`이 조용히 깎는다
 *  - **카드 지급은 게임의 `addCard`를 지난다** — 처음 얻은 장수는 풀로 들어간다
 *  - **카드 회수는 여분만** — 풀에 든 장수 본체는 못 건드린다
 *  - **들려 보낼 예정인 아이템 · 장수가 끼고 있는 병기는 못 거둔다**
 *  - **병기 지급은 비어 있는 가장 작은 번호로** — 게임의 제조 완성과 같은 규칙
 *  - **본문 검사** — 0 · 소수 · 상한 초과 · 모르는 id를 거른다
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADJUST_LIMITS, addCard, applyAdjustment, carryItem, changedProfileFields, createProfile, equipOfficer, forgeItemKey, grainCap,
  parseAdjustment,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';
import type { OfficerId } from '@samchess/rules';

const NOW = 1_800_000_000_000;
const fresh = (): PlayerProfile => createProfile('관리시험', 7);
const firstOfficer = (p: PlayerProfile): OfficerId => Object.keys(p.roster)[0] as OfficerId;
/** 새 계정이 안 가진 장수 하나 */
const unowned = (p: PlayerProfile): OfficerId => (['gwan-u', 'jang-bi', 'yu-bi', 'jo-jo'] as OfficerId[]).find((id) => !p.roster[id])!;

describe('재화', () => {
  it('금화를 주고 거둔다', () => {
    const p = applyAdjustment(fresh(), { kind: 'gold', delta: 50 }, NOW);
    assert.equal(p.gold, fresh().gold + 50);
    assert.equal(applyAdjustment(p, { kind: 'gold', delta: -50 }, NOW).gold, fresh().gold);
  });

  it('가진 것보다 많이 거두면 거절하고 원본은 그대로다', () => {
    const p = fresh();
    assert.throws(() => applyAdjustment(p, { kind: 'materials', delta: -(p.materials + 1) }, NOW), /모자라다/);
  });

  it('군량은 창고 상한을 넘기지 못한다', () => {
    const p = fresh();
    const room = grainCap(p) - p.grain;
    assert.equal(applyAdjustment(p, { kind: 'grain', delta: room }, NOW).grain, grainCap(p));
    assert.throws(() => applyAdjustment(p, { kind: 'grain', delta: room + 1 }, NOW), /상한/);
  });
});

describe('카드', () => {
  it('처음 얻는 장수는 풀로 들어가고 나머지가 여분 카드가 된다', () => {
    const p = fresh();
    const id = unowned(p);
    const next = applyAdjustment(p, { kind: 'cards', officer: id, delta: 3 }, NOW);
    assert.ok(next.roster[id], '풀에 들어가야 한다');
    assert.equal(next.cards[id], 2);
  });

  it('여분만 거두고, 0이 되면 키째 없앤다', () => {
    const id = firstOfficer(fresh());
    const p = addCard(fresh(), id, 2);
    const one = applyAdjustment(p, { kind: 'cards', officer: id, delta: -1 }, NOW);
    assert.equal(one.cards[id], 1);
    const none = applyAdjustment(one, { kind: 'cards', officer: id, delta: -1 }, NOW);
    assert.equal(id in none.cards, false);
    assert.ok(none.roster[id], '본체는 그대로다');
    assert.throws(() => applyAdjustment(none, { kind: 'cards', officer: id, delta: -1 }, NOW), /여분 카드가 모자라다/);
  });
});

describe('시장 아이템', () => {
  it('주면 수량과 구매일 줄이 함께 늘고, 거두면 오래된 것부터 빠진다', () => {
    const p = applyAdjustment(fresh(), { kind: 'item', item: 'tang-yak', delta: 2 }, NOW);
    assert.equal(p.marketOwned?.['tang-yak'], 2);
    assert.deepEqual(p.marketBoughtAt?.['tang-yak'], [NOW, NOW]);
    const later = applyAdjustment(p, { kind: 'item', item: 'tang-yak', delta: 1 }, NOW + 1);
    const taken = applyAdjustment(later, { kind: 'item', item: 'tang-yak', delta: -2 }, NOW + 2);
    assert.equal(taken.marketOwned?.['tang-yak'], 1);
    assert.deepEqual(taken.marketBoughtAt?.['tang-yak'], [NOW + 1]);
    const gone = applyAdjustment(taken, { kind: 'item', item: 'tang-yak', delta: -1 }, NOW);
    assert.equal('tang-yak' in (gone.marketOwned ?? {}), false);
  });

  it('들려 보낼 예정인 것은 못 거둔다', () => {
    const base = applyAdjustment(fresh(), { kind: 'item', item: 'tang-yak', delta: 1 }, NOW);
    const p = carryItem(base, firstOfficer(base), 'tang-yak');
    assert.throws(() => applyAdjustment(p, { kind: 'item', item: 'tang-yak', delta: -1 }, NOW), /들려 보낼/);
  });
});

describe('병기', () => {
  it('비어 있는 가장 작은 번호로 들어오고 제작일이 찍힌다', () => {
    const p = applyAdjustment(fresh(), { kind: 'equipmentGrant', equipmentId: 'dae-gam-do', count: 2 }, NOW);
    const k1 = forgeItemKey('dae-gam-do', 1);
    const k2 = forgeItemKey('dae-gam-do', 2);
    assert.deepEqual(Object.keys(p.forgeOwned).sort(), [k1, k2]);
    assert.equal(p.forgeMadeAt?.[k1], NOW);
    // 1번을 거두면 다음 지급이 1번 자리를 채운다
    const holed = applyAdjustment(p, { kind: 'equipmentRevoke', key: k1 }, NOW);
    assert.equal(k1 in holed.forgeOwned, false);
    assert.equal(k1 in (holed.forgeMadeAt ?? {}), false);
    const refilled = applyAdjustment(holed, { kind: 'equipmentGrant', equipmentId: 'dae-gam-do', count: 1 }, NOW + 5);
    assert.equal(refilled.forgeMadeAt?.[k1], NOW + 5);
  });

  it('장수가 끼고 있으면 못 거둔다', () => {
    const base = applyAdjustment(fresh(), { kind: 'equipmentGrant', equipmentId: 'dae-gam-do', count: 1 }, NOW);
    const key = forgeItemKey('dae-gam-do', 1);
    const p = equipOfficer(base, key, firstOfficer(base));
    assert.throws(() => applyAdjustment(p, { kind: 'equipmentRevoke', key }, NOW), /끼고 있다/);
    assert.throws(() => applyAdjustment(p, { kind: 'equipmentRevoke', key: 'no-such#1' }, NOW), /그런 자루가 없다/);
  });
});

describe('본문 검사', () => {
  it('맞는 모양은 통과한다', () => {
    assert.deepEqual(parseAdjustment({ kind: 'gold', delta: -5, reason: 'x' }), { kind: 'gold', delta: -5 });
    assert.deepEqual(parseAdjustment({ kind: 'cards', officer: 'gwan-u', delta: 1 }), { kind: 'cards', officer: 'gwan-u', delta: 1 });
  });

  it('0 · 소수 · 상한 초과 · 모르는 id · 음수 지급 개수를 거른다', () => {
    for (const bad of [
      { kind: 'gold', delta: 0 },
      { kind: 'gold', delta: 1.5 },
      { kind: 'gold', delta: ADJUST_LIMITS.gold + 1 },
      { kind: 'cards', officer: 'nobody', delta: 1 },
      { kind: 'item', item: 'nothing', delta: 1 },
      { kind: 'equipmentGrant', equipmentId: 'dae-gam-do', count: -1 },
      { kind: 'equipmentRevoke' },
      { kind: 'roster', delta: 1 },
      null,
    ]) {
      assert.equal(typeof parseAdjustment(bad), 'string', JSON.stringify(bad));
    }
  });
});

describe('감사 로그 diff', () => {
  it('바뀐 최상단 필드만 담는다', () => {
    const p = fresh();
    const d = changedProfileFields(p, { ...p, gold: p.gold + 1 });
    assert.deepEqual(d, { before: { gold: p.gold }, after: { gold: p.gold + 1 } });
  });
});
