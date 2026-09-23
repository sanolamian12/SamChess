/**
 * 대장간 회귀 — 제조 · 지급 · 서버 소유 경계 (2026-09-09, 피라미드·자루 키 2026-09-14).
 *
 * 여기서 고정하는 것.
 *  - **종류당 개수 = 대장간 Lv − 해금 Lv + 1** — 상한에 닿으면 목록에서 빠지고 주문을 거부한다.
 *    **해금 Lv5 병기는 대장간 Lv5에서도 한 자루**다(Lv5 동결, 기획 확정)
 *  - **제조 슬롯은 하나** — 진행 중에는 다른 주문을 못 넣고, 진행 중인 주문도 한 자루로 센다
 *  - **완성된 자루는 새 번호로 들어온다** — 같은 병기 두 자루가 따로 지급된다
 *  - **장수당 슬롯은 하나** — 다른 병기를 낀 장수를 고르면 자동으로 갈아 끼운다
 *  - **v5의 맨 id는 `#1`로 되접히고 두 번 지나도 같다** (저장 형식 v6)
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
  equippedBy, equippedKey, forgeCopiesAllowed, forgeItemKey, forgeSummary, guardServerOwned,
  migrateProfile, toRosterEntries, unequipOfficer,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

const T0 = 1_700_000_000_000;

function forge(over: Partial<PlayerProfile> = {}): PlayerProfile {
  const p = createProfile('대장간성', 3);
  return { ...p, gold: 1000, buildings: { ...p.buildings, forge: 5 }, ...over };
}

const LV1_WEAPON = EQUIPMENT.find((e) => e.kind === 'weapon' && e.unlockLevel === 1)!;
const LV2_WEAPON = EQUIPMENT.find((e) => e.kind === 'weapon' && e.unlockLevel === 2)!;
const LV4_ITEM = EQUIPMENT.find((e) => e.unlockLevel === 4)!;
const LV5_ITEM = EQUIPMENT.find((e) => e.unlockLevel === 5)!;
const K1 = forgeItemKey(LV1_WEAPON.id, 1);
const K1B = forgeItemKey(LV1_WEAPON.id, 2);
const K2 = forgeItemKey(LV2_WEAPON.id, 1);

describe('가격 총량과 종류당 개수 (2026-09-14 피라미드)', () => {
  it('15종 가격 합은 750이고, 대장간 Lv5의 피라미드 매출 상한은 1,495금화다', () => {
    assert.equal(EQUIPMENT.reduce((n, e) => n + e.gold, 0), 750);
    const cap = EQUIPMENT.reduce((n, e) => n + e.gold * forgeCopiesAllowed(5, e.unlockLevel), 0);
    assert.equal(cap, 1495);
  });

  it('종류당 개수 = 대장간 Lv − 해금 Lv + 1 — 해금 Lv5는 대장간 Lv5에서도 한 자루다(동결) ★', () => {
    assert.equal(forgeCopiesAllowed(5, 1), 5);
    assert.equal(forgeCopiesAllowed(5, 5), 1);
    assert.equal(forgeCopiesAllowed(3, 1), 3);
    assert.equal(forgeCopiesAllowed(3, 4), 0, '아직 해금 전이면 0');
  });
});

describe('제조 (대장간)', () => {
  it('대장간 레벨이 낮으면 목록에 안 뜨고 주문도 거부한다', () => {
    const p = forge({ buildings: { ...forge().buildings, forge: 0 } });
    assert.equal(craftableEquipment(p).length, 0);
    assert.equal(canStartForgeOrder(p, LV1_WEAPON.id).ok, false);
  });

  it('상한 전까지는 같은 병기를 또 만들고, 닿으면 목록에서 빠지고 거부한다 ★', () => {
    // 대장간 Lv5에서 해금 Lv4는 두 자루
    const one = forge({ forgeOwned: { [forgeItemKey(LV4_ITEM.id, 1)]: null } });
    assert.ok(craftableEquipment(one).some((e) => e.id === LV4_ITEM.id), '한 자루면 아직 뜬다');
    assert.equal(canStartForgeOrder(one, LV4_ITEM.id).ok, true);

    const two = forge({
      forgeOwned: { [forgeItemKey(LV4_ITEM.id, 1)]: null, [forgeItemKey(LV4_ITEM.id, 2)]: null },
    });
    assert.ok(!craftableEquipment(two).some((e) => e.id === LV4_ITEM.id), '두 자루면 빠진다');
    assert.equal(canStartForgeOrder(two, LV4_ITEM.id).ok, false);
  });

  it('해금 Lv5 병기는 한 자루면 끝이다 — 대장간이 만렙이라 「올리면 더」를 말하지 않는다', () => {
    const owned = forge({ forgeOwned: { [forgeItemKey(LV5_ITEM.id, 1)]: null } });
    const check = canStartForgeOrder(owned, LV5_ITEM.id);
    if (check.ok) assert.fail('해금 Lv5 두 번째 자루는 거부해야 한다');
    assert.ok(!check.reason.includes('올리면'), `만렙인데 더 올리라고 한다: "${check.reason}"`);
  });

  it('대장간이 낮으면 상한도 낮다 — 올리면 더 만들 수 있다고 말한다', () => {
    const low = forge({ buildings: { ...forge().buildings, forge: 1 }, forgeOwned: { [K1]: null } });
    const check = canStartForgeOrder(low, LV1_WEAPON.id);
    if (check.ok) assert.fail('대장간 Lv1에서 해금 Lv1은 한 자루까지다');
    assert.ok(check.reason.includes('올리면'), `이유가 다음 길을 안 알려 준다: "${check.reason}"`);
  });

  it('진행 중인 주문도 한 자루로 센다 — 끝나 들어올 것까지 합쳐 상한을 넘지 않는다', () => {
    const p = forge({
      forgeOwned: { [forgeItemKey(LV4_ITEM.id, 1)]: null },
      forgeOrder: { equipmentId: LV4_ITEM.id, startedAt: T0 },
    });
    assert.ok(!craftableEquipment(p).some((e) => e.id === LV4_ITEM.id));
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

  it('기간 전엔 같은 객체, 기간 후엔 **새 번호로** 정확히 한 번만 거둔다 ★', () => {
    const started = applyStartForgeOrder(forge({ forgeOwned: { [K1]: null } }), LV1_WEAPON.id, T0);
    const dur = craftDurationMs(LV1_WEAPON.unlockLevel);
    assert.equal(dur, 60 * 1000, 'Lv1 = 실제 1분');

    const early = collectForgeOrder(started, T0 + dur - 1);
    assert.equal(early, started, '아직이면 같은 참조를 돌려준다');

    const done = collectForgeOrder(started, T0 + dur);
    assert.equal(done.forgeOrder, undefined);
    assert.equal(done.forgeOwned[K1B], null, '두 번째 자루는 #2로, 미지급 상태로 들어간다');
    assert.equal(done.forgeMadeAt?.[K1B], T0 + dur, '제작일도 그 자루에 붙는다');
    assert.equal(Object.keys(done.forgeOwned).length, 2, '첫 자루를 덮어쓰지 않는다');

    const again = collectForgeOrder(done, T0 + dur + 1);
    assert.equal(again, done, '주문이 없으면 다시 거둬도 그대로다(멱등)');
  });
});

describe('지급 · 해제', () => {
  it('장수당 슬롯 하나 — 이미 낀 병기가 있으면 자동으로 갈아 끼운다', () => {
    const p = forge();
    const [a, b] = Object.keys(p.roster) as OfficerId[];
    assert.ok(a && b && a !== b);

    const withOwned = { ...p, forgeOwned: { [K1]: null, [K2]: null } };
    const first = equipOfficer(withOwned, K1, a!);
    assert.equal(first.forgeOwned[K1], a);

    const swapped = equipOfficer(first, K2, a!);
    assert.equal(swapped.forgeOwned[K2], a, '새 병기가 그 장수에게 붙는다');
    assert.equal(swapped.forgeOwned[K1], null, '옛 병기는 자동으로 풀린다');
    assert.equal(equippedBy(swapped, a!)?.id, LV2_WEAPON.id);
  });

  it('같은 병기 두 자루를 서로 다른 장수에게 따로 준다 ★', () => {
    const p = forge();
    const [a, b] = Object.keys(p.roster) as OfficerId[];
    const withTwo = { ...p, forgeOwned: { [K1]: null, [K1B]: null } };
    const both = equipOfficer(equipOfficer(withTwo, K1, a!), K1B, b!);
    assert.equal(both.forgeOwned[K1], a, '첫 자루는 그대로다');
    assert.equal(both.forgeOwned[K1B], b);
    assert.equal(equippedBy(both, b!)?.id, LV1_WEAPON.id, '키에서 병기를 찾는다');
    assert.equal(equippedKey(both, b!), K1B);
  });

  it('해제는 그 자루만 미지급으로 되돌린다', () => {
    const p = forge();
    const [a] = Object.keys(p.roster) as OfficerId[];
    const withOwned = { ...p, forgeOwned: { [K1]: null } };
    const equipped = equipOfficer(withOwned, K1, a!);
    const unequipped = unequipOfficer(equipped, K1);
    assert.equal(unequipped.forgeOwned[K1], null);
  });

  it('forgeSummary가 보유 자루·지급·여유를 화면 대신 센다', () => {
    const p = forge();
    const [a] = Object.keys(p.roster) as OfficerId[];
    const withOwned = { ...p, forgeOwned: { [K1]: null, [K1B]: null, [K2]: null } };
    const one = equipOfficer(withOwned, K1, a!);
    assert.deepEqual(forgeSummary(one), { owned: 3, assigned: 1, spare: 2 });
  });
});

describe('되접기 (저장 형식 v6)', () => {
  it('v5의 맨 id는 #1로 되접고 지급·제작일도 따라온다 — 두 번 지나도 같다 ★', () => {
    const p = forge();
    const [a] = Object.keys(p.roster) as OfficerId[];
    const v5 = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    v5['version'] = 5;
    v5['forgeOwned'] = { [LV1_WEAPON.id]: a, [LV2_WEAPON.id]: null };
    v5['forgeMadeAt'] = { [LV1_WEAPON.id]: T0 };

    const once = migrateProfile(v5)!;
    assert.deepEqual(once.forgeOwned, { [K1]: a, [K2]: null });
    assert.deepEqual(once.forgeMadeAt, { [K1]: T0 });

    const twice = migrateProfile(JSON.parse(JSON.stringify(once)))!;
    assert.deepEqual(twice.forgeOwned, once.forgeOwned);
    assert.deepEqual(twice.forgeMadeAt, once.forgeMadeAt);
  });
});

describe('서버 소유 경계 (`guardServerOwned`)', () => {
  it('forgeOrder는 통째로 서버 값을 지킨다 — 클라이언트가 지어내도 사라진다', () => {
    const current = forge({ forgeOrder: { equipmentId: LV1_WEAPON.id, startedAt: T0 } });
    const incoming = { ...current, forgeOrder: { equipmentId: LV2_WEAPON.id, startedAt: T0 + 1 } };
    const guarded = guardServerOwned(incoming, current);
    assert.deepEqual(guarded.forgeOrder, current.forgeOrder);
  });

  it('forgeOwned는 키(보유 자루)만 지키고 값(지급 대상)은 클라이언트 것을 받는다', () => {
    const [a, b] = Object.keys(forge().roster) as OfficerId[];
    const current = forge({ forgeOwned: { [K1]: null } });
    // 클라이언트가 지급을 바꾸고(정당), 없던 자루를 하나 지어냈다(부정 — 같은 병기 둘째 자루)
    const incoming = { ...current, forgeOwned: { [K1]: a!, [K1B]: b! } };
    const guarded = guardServerOwned(incoming, current);
    assert.equal(guarded.forgeOwned[K1], a, '지급 변경은 통과한다');
    assert.equal(K1B in guarded.forgeOwned, false, '없던 자루는 되살지 않는다');
  });
});

describe('지급한 병기가 전투로 실린다 — `RosterEntry.held` (2026-09-23) ★', () => {
  // **2026-09-23 이전에는 안 실렸다.** `toRosterEntries()`가 `equippedBy()`를
  // 안 불러, 금화를 내고 만들어 지급한 병기가 화면에만 뜨고 전투에서 아무 일도
  // 안 했다. 시장 아이템이 같은 칸을 다투는 사이라 길을 하나로 놓으며 닫았다.
  const withOfficer = (): { profile: PlayerProfile; officer: OfficerId } => {
    const p = forge();
    const officer = Object.keys(p.roster)[0] as OfficerId;
    return { profile: p, officer };
  };

  it('안 지급했으면 `held`가 없고, 지급하면 병기 id가 실린다', () => {
    const { profile, officer } = withOfficer();
    const picks = [{ piece: 'King' as const, officer }];

    const bare = toRosterEntries(profile, picks);
    assert.equal(bare[0]!.held, undefined, '맨손이면 키째로 없다');

    const armed = equipOfficer({ ...profile, forgeOwned: { [K1]: null } }, K1, officer);
    assert.equal(toRosterEntries(armed, picks)[0]!.held, LV1_WEAPON.id,
      '자루 키(`{id}#{n}`)가 아니라 **병기 id**가 실린다');
  });

  it('갈아 끼우면 실리는 것도 따라 바뀌고, 해제하면 사라진다', () => {
    const { profile, officer } = withOfficer();
    const picks = [{ piece: 'King' as const, officer }];
    const p1 = equipOfficer({ ...profile, forgeOwned: { [K1]: null, [K2]: null } }, K1, officer);
    assert.equal(toRosterEntries(p1, picks)[0]!.held, LV1_WEAPON.id);

    const p2 = equipOfficer(p1, K2, officer);
    assert.equal(toRosterEntries(p2, picks)[0]!.held, LV2_WEAPON.id, '장수당 칸은 하나다');

    const p3 = unequipOfficer(p2, K2);
    assert.equal(toRosterEntries(p3, picks)[0]!.held, undefined);
  });
});
