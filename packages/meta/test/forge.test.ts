/**
 * 대장간 회귀 — 제조 · 지급 · 서버 소유 경계 (2026-09-09).
 *
 * 여기서 고정하는 것 넷.
 *  - **아이템은 계정당 1개** — 이미 만든 것은 목록에서 빠지고 다시 주문할 수 없다
 *  - **제조 슬롯은 하나** — 진행 중에는 다른 주문을 못 넣는다
 *  - **장수당 슬롯은 하나** — 다른 병기를 낀 장수를 고르면 자동으로 갈아 끼운다
 *  - **`forgeOwned`는 키(보유)만 서버가 지키고 값(지급)은 클라이언트가 바꾼다**,
 *    `forgeOrder`는 통째로 서버가 지킨다 — `guardServerOwned()`가 그 경계다
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EQUIPMENT } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  applyCancelForgeOrder, applyStartForgeOrder, canCancelForgeOrder, canStartForgeOrder,
  collectForgeOrder, craftDurationMs, craftableEquipment, createProfile, equipOfficer,
  equippedBy, forgeSummary, guardServerOwned, unequipOfficer,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

const T0 = 1_700_000_000_000;

function forge(over: Partial<PlayerProfile> = {}): PlayerProfile {
  const p = createProfile('대장간성', 3);
  return { ...p, gold: 1000, buildings: { ...p.buildings, forge: 5 }, ...over };
}

const LV1_WEAPON = EQUIPMENT.find((e) => e.kind === 'weapon' && e.unlockLevel === 1)!;
const LV2_WEAPON = EQUIPMENT.find((e) => e.kind === 'weapon' && e.unlockLevel === 2)!;

describe('가격 총량 (2026-09-07 기획)', () => {
  it('15종 가격 합이 정확히 750이다 — 계정당 1개 제한의 근거', () => {
    assert.equal(EQUIPMENT.reduce((n, e) => n + e.gold, 0), 750);
  });
});

describe('제조 (대장간)', () => {
  it('대장간 레벨이 낮으면 목록에 안 뜨고 주문도 거부한다', () => {
    const p = forge({ buildings: { ...forge().buildings, forge: 0 } });
    assert.equal(craftableEquipment(p).length, 0);
    assert.equal(canStartForgeOrder(p, LV1_WEAPON.id).ok, false);
  });

  it('이미 만든 것은 다시 목록에 안 뜨고 다시 주문할 수 없다', () => {
    const owned = forge({ forgeOwned: { [LV1_WEAPON.id]: null } });
    assert.ok(!craftableEquipment(owned).some((e) => e.id === LV1_WEAPON.id));
    const check = canStartForgeOrder(owned, LV1_WEAPON.id);
    assert.equal(check.ok, false);
  });

  it('금화가 모자라면 거부하고, 충분하면 정확히 그만큼 깎고 주문을 찍는다', () => {
    const poor = forge({ gold: LV1_WEAPON.gold - 1 });
    assert.equal(canStartForgeOrder(poor, LV1_WEAPON.id).ok, false);

    const rich = forge({ gold: 100 });
    const started = applyStartForgeOrder(rich, LV1_WEAPON.id, T0);
    assert.equal(started.gold, 100 - LV1_WEAPON.gold);
    assert.deepEqual(started.forgeOrder, { equipmentId: LV1_WEAPON.id, startedAt: T0 });
  });

  it('제조 슬롯은 하나 — 진행 중에 다른 주문을 못 넣는다', () => {
    const started = applyStartForgeOrder(forge(), LV1_WEAPON.id, T0);
    assert.equal(canStartForgeOrder(started, LV2_WEAPON.id).ok, false);
  });

  it('취소하면 전액 환불하고 주문이 사라진다', () => {
    const p = forge({ gold: 100 });
    const started = applyStartForgeOrder(p, LV1_WEAPON.id, T0);
    assert.equal(canCancelForgeOrder(started).ok, true);
    const cancelled = applyCancelForgeOrder(started);
    assert.equal(cancelled.gold, 100);
    assert.equal(cancelled.forgeOrder, undefined);
    assert.equal(canCancelForgeOrder(cancelled).ok, false, '취소할 주문이 없으면 거부한다');
  });

  it('기간 전엔 아무 일도 안 하고(같은 객체), 기간 후엔 정확히 한 번만 거둔다', () => {
    const started = applyStartForgeOrder(forge(), LV1_WEAPON.id, T0);
    const dur = craftDurationMs(LV1_WEAPON.unlockLevel);
    assert.equal(dur, 7 * 24 * 60 * 60 * 1000, 'Lv1 = 실제 1주');

    const early = collectForgeOrder(started, T0 + dur - 1);
    assert.equal(early, started, '아직이면 같은 참조를 돌려준다');

    const done = collectForgeOrder(started, T0 + dur);
    assert.equal(done.forgeOrder, undefined);
    assert.equal(done.forgeOwned[LV1_WEAPON.id], null, '완성되면 미지급 상태로 들어간다');

    const again = collectForgeOrder(done, T0 + dur + 1);
    assert.equal(again, done, '주문이 없으면 다시 거둬도 그대로다(멱등)');
  });
});

describe('지급 · 해제', () => {
  it('장수당 슬롯 하나 — 이미 낀 병기가 있으면 자동으로 갈아 끼운다', () => {
    const p = forge();
    const [a, b] = Object.keys(p.roster) as OfficerId[];
    assert.ok(a && b && a !== b);

    const withOwned = { ...p, forgeOwned: { [LV1_WEAPON.id]: null, [LV2_WEAPON.id]: null } };
    const first = equipOfficer(withOwned, LV1_WEAPON.id, a!);
    assert.equal(first.forgeOwned[LV1_WEAPON.id], a);

    const swapped = equipOfficer(first, LV2_WEAPON.id, a!);
    assert.equal(swapped.forgeOwned[LV2_WEAPON.id], a, '새 병기가 그 장수에게 붙는다');
    assert.equal(swapped.forgeOwned[LV1_WEAPON.id], null, '옛 병기는 자동으로 풀린다');
    assert.equal(equippedBy(swapped, a!)?.id, LV2_WEAPON.id);
  });

  it('해제는 그 항목만 미지급으로 되돌린다', () => {
    const p = forge();
    const [a] = Object.keys(p.roster) as OfficerId[];
    const withOwned = { ...p, forgeOwned: { [LV1_WEAPON.id]: null } };
    const equipped = equipOfficer(withOwned, LV1_WEAPON.id, a!);
    const unequipped = unequipOfficer(equipped, LV1_WEAPON.id);
    assert.equal(unequipped.forgeOwned[LV1_WEAPON.id], null);
  });

  it('forgeSummary가 보유·지급·여유를 화면 대신 센다', () => {
    const p = forge();
    const [a] = Object.keys(p.roster) as OfficerId[];
    const withOwned = { ...p, forgeOwned: { [LV1_WEAPON.id]: null, [LV2_WEAPON.id]: null } };
    const one = equipOfficer(withOwned, LV1_WEAPON.id, a!);
    assert.deepEqual(forgeSummary(one), { owned: 2, assigned: 1, spare: 1 });
  });
});

describe('서버 소유 경계 (`guardServerOwned`)', () => {
  it('forgeOrder는 통째로 서버 값을 지킨다 — 클라이언트가 지어내도 사라진다', () => {
    const current = forge({ forgeOrder: { equipmentId: LV1_WEAPON.id, startedAt: T0 } });
    const incoming = { ...current, forgeOrder: { equipmentId: LV2_WEAPON.id, startedAt: T0 + 1 } };
    const guarded = guardServerOwned(incoming, current);
    assert.deepEqual(guarded.forgeOrder, current.forgeOrder);
  });

  it('forgeOwned는 키(보유)만 지키고 값(지급 대상)은 클라이언트 것을 받는다', () => {
    const [a, b] = Object.keys(forge().roster) as OfficerId[];
    const current = forge({ forgeOwned: { [LV1_WEAPON.id]: null } });
    // 클라이언트가 지급을 바꾸고(정당), 없던 항목을 하나 지어냈다(부정)
    const incoming = {
      ...current,
      forgeOwned: { [LV1_WEAPON.id]: a!, [LV2_WEAPON.id]: b! },
    };
    const guarded = guardServerOwned(incoming, current);
    assert.equal(guarded.forgeOwned[LV1_WEAPON.id], a, '지급 변경은 통과한다');
    assert.equal(LV2_WEAPON.id in guarded.forgeOwned, false, '없던 보유는 되살지 않는다');
  });
});
