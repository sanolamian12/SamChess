/**
 * 장수가 **들고 온 것** — 대장간 병기 하나 또는 시장 아이템 하나 (2026-09-23).
 *
 * ────────────────────────────────────────────────────────────────
 * 칸이 하나라 길도 하나다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 장수 한 명은 **병기 또는 아이템 하나**만 든다(GDD §6.5). 그래서 전투로
 * 나르는 값도 `RosterEntry.held` **하나**이고, 그것이 어느 표의 것인지는
 * **여기서만** 가른다 — 두 군데서 가르면 한쪽이 새 품목을 모르게 된다.
 *
 * 병기(`equipment.json`)는 `effect`를, 시장 아이템(`marketItems.json`)은
 * 패시브면 `passive`를 준다. **액티브 아이템은 여기서 아무것도 안 준다** —
 * 쓰는 순간 `effects`(Effect DSL)가 도는 것이고 들고만 있는 동안은 아무 일도
 * 없다.
 *
 * ────────────────────────────────────────────────────────────────
 * 병기 효과는 2026-09-23까지 **아무 데서도 안 읽혔다**
 * ────────────────────────────────────────────────────────────────
 *
 * `EquipmentEffect`(결정타 +5%p · 베리어 …)가 데이터와 검증 테스트에만 있었고
 * 엔진에는 닿는 길이 없었다 — 금화를 내고 만들어 지급한 병기가 화면에만 뜨고
 * 전투에서는 아무 일도 안 했다. 시장 아이템이 **같은 칸을 다투는** 사이라
 * 길을 하나로 놓으면서 그 공백도 함께 닫았다.
 *
 * **전투력(`battlePower`)은 여전히 이것을 안 본다** — 실측 상수라 넣으면
 * 매칭 상대까지 흔들린다(확정 사항).
 */

import { equipmentById, marketItemById } from '@samchess/data';
import type { MarketItemData } from '@samchess/data';
import type { UnitState } from './types.ts';

/**
 * 들고 온 것이 주는 값 — **병기와 아이템 패시브의 합집합**이다.
 * **없는 키는 0이다**(`?? 0`으로 읽는다).
 */
export interface HeldEffect {
  // ── 병기 (`EquipmentEffect`) ──
  /** 결정타 확률에 더하는 %p. `FORMULA.criticalRate` 결과에 얹고 clamp(0,100) */
  criticalRate?: number;
  /** 결정타일 때만 더하는 데미지. **감쇠 뒤에** 더한다 */
  criticalDamage?: number;
  /** AT에 더한다 — 감쇠보다 **먼저**라 크리티컬이면 두 배로 불어난다 */
  attack?: number;
  /** 추가 HP. 회복되지 않고 데미지를 **먼저** 받아낸다 */
  barrier?: number;

  // ── 시장 아이템 패시브 (`MarketItemPassive`) ──
  /** `wtBase`에서 빼는 값. 음수 = 빨라진다 */
  wtDelta?: number;
  /** HP가 절반 이하일 때 `wtDelta` **대신** 쓰는 값 (합산이 아니다 — 절영) */
  wtDeltaLowHp?: number;
  /** HP가 0이 될 때 한 번 HP 1로 버틴다 (적로) */
  surviveOnce?: boolean;
  /** 피격 시 반격할 확률 %. 시드 PRNG를 거친다 */
  counterChance?: number;
  /** 책략 MP 소모에서 빼는 값 (하한 0) */
  tacticMpDiscount?: number;
  /** 책략 성공률에 더하고, **대상일 때는 빼는** %p */
  tacticChanceBonus?: number;
  /** 모든 계산이 끝난 뒤 주는 데미지에 더한다 */
  finalDamageDealt?: number;
  /** 모든 계산이 끝난 뒤 받는 데미지에 더한다. 음수 = 덜 받는다 */
  finalDamageTaken?: number;

  // ── 엔진 밖에서 읽는 것 ──
  /** 판이 끝난 뒤 부상을 안 당한다 — `meta`의 `applyInjuries()`가 본다 */
  noInjury?: boolean;
  /** 정찰 단계에서 상대 책략을 본다 — `toWire(state, side)`가 본다 */
  revealTactics?: boolean;
}

const NONE: HeldEffect = {};

/**
 * id 하나로 두 표를 본다. **가르는 자리는 여기 하나다.**
 *
 * 모르는 id는 **빈 값**이다 — 던지지 않는다. 저장된 계정에 지워진 품목이
 * 남아 있을 수 있고, 그때 판이 안 만들어지는 것보다 아무 효과가 없는 편이 낫다.
 */
export function heldEffectOf(held: string | undefined): HeldEffect {
  if (!held) return NONE;
  const equip = equipmentById.get(held);
  if (equip) return equip.effect;
  const item = marketItemById.get(held);
  // 액티브는 들고만 있는 동안 아무것도 안 준다 — `effects`는 쓸 때 돈다
  return item?.passive ?? NONE;
}

/** 이 유닛이 들고 온 것이 주는 값 */
export const heldOf = (unit: UnitState): HeldEffect => heldEffectOf(unit.held);

/**
 * **지금 쓸 수 있는 액티브 아이템** — 없으면 `undefined` (2026-09-23, GDD §6.5).
 *
 * 「들고 있는가」와 「쓸 수 있는가」를 한 자리에서 답한다 — `validate`·`apply`·
 * 화면이 각자 `marketItemById`를 뒤지면 「이미 썼다」를 한 군데서 빠뜨린다.
 * 병기(`equipmentById`)는 여기서 `undefined`다: 영구 효과라 쓸 것이 없다.
 */
export function usableItemOf(unit: UnitState): MarketItemData | undefined {
  if (!unit.held || unit.itemUsed) return undefined;
  const item = marketItemById.get(unit.held);
  /*
   * ⚠ **`kind` 줄은 지금 어느 검사도 구별하지 못한다** (변이로 확인했다) —
   * 패시브 열에는 `effects`가 키째로 없어 아래 줄이 먼저 걸러 내고, 병기는
   * `marketItemById`에 아예 없다. 「막는 줄이 둘인데 하나만 시험된다」는 것을
   * 주장하지 않고 적어 둔다. 지우지 않는 이유는 **뜻이 다르기 때문**이다:
   * 이 줄은 「액티브만 쓴다」는 규칙이고, 아래 줄은 「데이터가 비면 안전하게
   * 물러난다」는 방어다. 실제로 갈리는 것은 `items.test.ts`의 데이터 검사
   * (「패시브는 `effects`가 없다」)가 지킨다.
   */
  if (item?.kind !== 'active') return undefined;
  // 효과가 비었으면 **쓸 수 없는 것으로 본다** — 데이터가 그런 꼴이면 판이
  // 터지는 것보다 단추가 안 켜지는 편이 낫다(`heldEffectOf`가 모르는 id를
  // 빈 값으로 두는 것과 같은 결). 액티브 여섯이 전부 효과를 갖는 것은 회귀가 고정한다.
  return item.effects?.length ? item : undefined;
}

/**
 * WT 기준값 — **`unit.wtBase`에는 `wtDelta`가 이미 들어 있다**(유닛을 만들 때
 * 한 번 얹는다). 여기서 더하는 것은 절영처럼 **HP에 따라 값이 바뀌는** 몫뿐이다.
 *
 * 절영은 「−10이 −15로 **바뀐다**」(합산이 아니다)라 그 차이만 얹는다.
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
