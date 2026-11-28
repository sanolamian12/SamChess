/**
 * 장수가 **들고 온 것** — 전투 아이템 하나 (2026-09-23, 2026-11-28 대장간 연구 개편).
 *
 * ────────────────────────────────────────────────────────────────
 * 칸이 하나라 길도 하나다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 장수 한 명은 **아이템 하나**만 든다. 장터 아이템이든 대장간 병기든 같은 꼴(`ItemData`)이고 같은 표
 * (`itemById`)에서 찾는다 — 2026-11-28 전까지는 병기(영구)와 장터 아이템(1회용)이 다른 꼴이라 여기서 갈랐다.
 *
 * **Passive**는 들고 있는 동안 `passive` 값을 준다(전투 준비에서 자동으로 「쓰인다」). **Active**는 여기서
 * 아무것도 안 준다 — 쓰는 순간 `effects`(Effect DSL)가 돌고, **차례를 끝내지 않는다**(쓰고 이동 · 공격 · 책략).
 *
 * **전투력(`battlePower`)은 이것을 안 본다** — 실측 상수라 넣으면 매칭 상대까지 흔들린다(확정 사항).
 */

import { itemById } from '@samchess/data';
import type { ItemData, ItemPassive } from '@samchess/data';
import type { UnitState } from './types.ts';

/** 들고 온 것이 주는 값 — Passive 아이템의 `passive`. **없는 키는 0이다**(`?? 0`으로 읽는다) */
export type HeldEffect = ItemPassive;

const NONE: HeldEffect = {};

/**
 * id 하나로 아이템 표를 본다. **Active는 들고만 있는 동안 아무것도 안 준다** — `effects`는 쓸 때 돈다.
 *
 * 모르는 id는 **빈 값**이다 — 던지지 않는다. 저장된 계정에 지워진 품목이
 * 남아 있을 수 있고, 그때 판이 안 만들어지는 것보다 아무 효과가 없는 편이 낫다.
 */
export function heldEffectOf(held: string | undefined): HeldEffect {
  if (!held) return NONE;
  return itemById.get(held)?.passive ?? NONE;
}

/** 이 유닛이 들고 온 것이 주는 값 */
export const heldOf = (unit: UnitState): HeldEffect => heldEffectOf(unit.held);

/**
 * **지금 쓸 수 있는 액티브 아이템** — 없으면 `undefined` (2026-09-23, GDD §6.5).
 *
 * 「들고 있는가」와 「쓸 수 있는가」를 한 자리에서 답한다 — `validate`·`apply`·
 * 화면이 각자 `itemById`를 뒤지면 「이미 썼다」를 한 군데서 빠뜨린다.
 */
export function usableItemOf(unit: UnitState): ItemData | undefined {
  if (!unit.held || unit.itemUsed) return undefined;
  const item = itemById.get(unit.held);
  /*
   * ⚠ **`kind` 줄은 지금 어느 검사도 구별하지 못한다** (변이로 확인했다) —
   * 패시브 열에는 `effects`가 키째로 없어 아래 줄이 먼저 걸러 낸다.
   * 「막는 줄이 둘인데 하나만 시험된다」는 것을
   * 주장하지 않고 적어 둔다. 지우지 않는 이유는 **뜻이 다르기 때문**이다:
   * 이 줄은 「액티브만 쓴다」는 규칙이고, 아래 줄은 「데이터가 비면 안전하게
   * 물러난다」는 방어다. 실제로 갈리는 것은 `items.test.ts`의 데이터 검사
   * (「패시브는 `effects`가 없다」)가 지킨다.
   */
  if (item?.kind !== 'active') return undefined;
  // 효과가 비었으면 **쓸 수 없는 것으로 본다** — 데이터가 그런 꼴이면 판이
  // 터지는 것보다 단추가 안 켜지는 편이 낫다(`heldEffectOf`가 모르는 id를
  // 빈 값으로 두는 것과 같은 결). Active가 전부 효과를 갖는 것은 추출기(`build_item`)와 회귀가 고정한다.
  return item.effects?.length ? item : undefined;
}

/**
 * WT 기준값 — **`unit.wtBase`에는 `wtDelta`가 이미 들어 있다**(유닛을 만들 때
 * 한 번 얹는다). 여기서 더하는 것은 적로처럼 **HP에 따라 값이 바뀌는** 몫뿐이다.
 *
 * `wtDeltaLowHp`는 `wtDelta`를 **바꾼다**(합산이 아니다)라 그 차이만 얹는다 — 적로는 `wtDelta`가 없어 −20 그대로다.
 */
export function wtHeldAdjust(unit: UnitState): number {
  const held = heldOf(unit);
  if (held.wtDeltaLowHp === undefined) return 0;
  const lowHp = unit.hp * 2 <= unit.maxHp;
  return lowHp ? held.wtDeltaLowHp - (held.wtDelta ?? 0) : 0;
}

/**
 * 손자병법서 — **모든 계산이 끝난 뒤** 주는 쪽은 더하고 받는 쪽은 뺀다.
 * 하한은 0이다: **약한 공격이 완전히 무효가 되는 것은 의도이고 값으로 보정한다**
 * (GDD §6.5).
 *
 * `resolveAttack`과 `forecastAttack`이 **같은 함수를 부른다** — 화면이 공식을
 * 다시 적으면 표시만 조용히 어긋난다.
 */
export function applyFinalDamage(
  damage: number, attacker: UnitState, victim: UnitState,
): number {
  const dealt = heldOf(attacker).finalDamageDealt ?? 0;
  const taken = heldOf(victim).finalDamageTaken ?? 0;
  return Math.max(0, damage + dealt + taken);
}
