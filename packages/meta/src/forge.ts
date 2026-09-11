/**
 * 대장간 — 제조 · 지급 관리 (트랙 11h 이어서, 2026-09-09).
 *
 * ────────────────────────────────────────────────────────────────
 * 세 가지는 이미 굳어 있다 (2026-09-07, `history/2026-09-07_...`) ★
 * ────────────────────────────────────────────────────────────────
 *
 * 1. **아이템은 계정당 1개씩만 만들 수 있다** — 15종 가격 합이 정확히 750금화다.
 *    `craftableEquipment()`가 이미 만든 것을 목록에서 뺀다.
 * 2. **장수 한 명은 병기 하나만 낀다** — `equipOfficer()`가 기존 것을 자동으로
 *    풀어 준다(2026-09-09 기획 확정).
 * 3. **금화를 내고 아이템을 받는 거래라 서버가 판정한다** — 이 파일의 함수들은
 *    다른 meta 함수와 똑같이 순수하지만, **부르는 자리는 클라이언트가 아니라
 *    `packages/server-api`다**(`MarketScreen.buyMaterials`와 같은 결). 지급/해제
 *    (`equipOfficer`/`unequipOfficer`)만은 총량을 안 바꾸므로 클라이언트가 직접
 *    부르고 `PUT`으로 올린다.
 *
 * ────────────────────────────────────────────────────────────────
 * 제조 기간은 실제 경과 시간이다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * Lv*n* 장비는 실제 *n*분이 걸린다 — `syncGrain`과 같은 벽시계 방식이라 시계는
 * 밖에서 넣는다(`city.ts` 머리말과 같은 이유). **끝나는 시각이 아니라 시작
 * 시각을 저장한다** — `injuredAt`과 같은 결로, 기간 상수가 나중에 바뀌어도 이미
 * 저장된 주문이 옛 규칙에 갇히지 않는다.
 *
 * **처음엔 「실제 *n*주」였다**(2026-09-09 기획 확정) — 그때는 이 저장소에 게임
 * 내 시간 개념이 없다고 보고 벽시계 주 단위로 잡았는데, 실제로는 GDD §6이
 * **「실시간 1초 = 게임 내 1일 = `time 100`」**을 이미 정해 두고 있었다. 그
 * 환산대로면 게임 내 1주가 실제 7초라 제조 대기가 아예 없어져서, 2026-09-10에
 * **게임 표기까지 「분」으로 통일**하는 쪽으로 다시 정했다 — Lv1 = 1분 … Lv5 =
 * 5분이고, 화면 글자(`forge.detail.minutesSuffix`)도 같이 바뀌었다.
 */

import { equipmentById, equipmentForForge } from '@samchess/data';
import type { EquipmentData } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { buildingLevel } from './city.ts';
import type { MetaResult, PlayerProfile } from './types.ts';

const ONE_MINUTE_MS = 60 * 1000;

/** Lv*n* 장비의 제조 기간. Lv1 = 1분, Lv2 = 2분 … (위 머리말 ★) */
export const craftDurationMs = (unlockLevel: number): number => unlockLevel * ONE_MINUTE_MS;

/** 대장간 레벨. 안 지었으면 0 — `equipmentForForge(0)`이 빈 배열을 낸다 */
export const forgeLevel = (profile: PlayerProfile): number => buildingLevel(profile, 'forge');

/**
 * 지금 살 수 있는 병기 — 해금됐고 **아직 계정에 없는** 것만. `equipmentForForge()`는
 * 레벨만 보고 누적으로 열지만, 총량이 750금화에서 막혀 있어(§1) 이미 만든 것은
 * 다시 목록에 뜨면 안 된다.
 */
export function craftableEquipment(profile: PlayerProfile): EquipmentData[] {
  return equipmentForForge(forgeLevel(profile)).filter((e) => !(e.id in profile.forgeOwned));
}

/** 보유 종류 / 지급된 수 / 미지급 수 — 화면이 직접 세지 않는다 */
export function forgeSummary(profile: PlayerProfile): { owned: number; assigned: number; spare: number } {
  const owned = Object.keys(profile.forgeOwned).length;
  const assigned = Object.values(profile.forgeOwned).filter((v) => v !== null).length;
  return { owned, assigned, spare: owned - assigned };
}

export function canStartForgeOrder(profile: PlayerProfile, equipmentId: string): MetaResult {
  const item = equipmentById.get(equipmentId);
  if (!item) return { ok: false, reason: `모르는 장비다 — ${equipmentId}` };
  if (item.unlockLevel > forgeLevel(profile)) {
    return { ok: false, reason: `대장간 Lv${item.unlockLevel}이 필요하다 — 지금 Lv${forgeLevel(profile)}` };
  }
  if (equipmentId in profile.forgeOwned) return { ok: false, reason: `${item.name}은 이미 만들었다` };
  if (profile.forgeOrder) return { ok: false, reason: '이미 다른 병기를 제조 중이다' };
  if (profile.gold < item.gold) return { ok: false, reason: `금화가 모자란다 — ${profile.gold}/${item.gold}` };
  return { ok: true };
}

/** 주문을 시작한다 — 금화를 내고 시작 시각을 찍는다. **부르는 자리는 서버다**(위 §3) */
export function applyStartForgeOrder(profile: PlayerProfile, equipmentId: string, nowMs: number): PlayerProfile {
  const check = canStartForgeOrder(profile, equipmentId);
  if (!check.ok) throw new Error(check.reason);
  const item = equipmentById.get(equipmentId)!;
  return {
    ...profile,
    gold: profile.gold - item.gold,
    forgeOrder: { equipmentId, startedAt: nowMs },
  };
}

export function canCancelForgeOrder(profile: PlayerProfile): MetaResult {
  if (!profile.forgeOrder) return { ok: false, reason: '진행 중인 주문이 없다' };
  return { ok: true };
}

/** 주문을 취소한다 — **전액 환불**, 완성 전이면 언제든 가능하다 */
export function applyCancelForgeOrder(profile: PlayerProfile): PlayerProfile {
  const check = canCancelForgeOrder(profile);
  if (!check.ok) throw new Error(check.reason);
  const item = equipmentById.get(profile.forgeOrder!.equipmentId)!;
  const { forgeOrder: _drop, ...rest } = profile;
  return { ...rest, gold: profile.gold + item.gold };
}

/** 주문이 끝나기까지 남은 시간(ms). 이미 끝났으면 0 — 난수 없는 표시 전용 값 */
export function forgeOrderRemainingMs(order: { equipmentId: string; startedAt: number }, nowMs: number): number {
  const item = equipmentById.get(order.equipmentId);
  if (!item) return 0;
  return Math.max(0, order.startedAt + craftDurationMs(item.unlockLevel) - nowMs);
}

/**
 * 제작일이 없는 보유 병기에 **지금 시각을 찍는다** (2026-09-11).
 *
 * 제작일(`forgeMadeAt`)은 이 필드가 생기기 전에 만든 병기에는 없다. 진짜
 * 제작일은 **아무 데도 안 남아 있어 되살릴 수 없고**, 그렇다고 지어낸 과거를
 * 적으면 화면이 거짓을 말한다 — 「기록을 시작한 시각」을 적는 쪽이 정직하다.
 * 한 번 찍히면 다시는 안 바뀐다(이미 있는 값은 안 건드린다).
 *
 * `syncCity()`가 부르는 자리 하나이고, 그래서 시각을 인자로 받는다
 * (`collectForgeOrder()`와 같은 규약).
 */
export function stampForgeDates(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const made = profile.forgeMadeAt ?? {};
  const missing = Object.keys(profile.forgeOwned).filter((id) => !made[id]);
  if (missing.length === 0) return profile;
  const next = { ...made };
  for (const id of missing) next[id] = nowMs;
  return { ...profile, forgeMadeAt: next };
}

/**
 * 끝난 주문을 거둔다 — 완성됐으면 미지급 상태로 `forgeOwned`에 넣고 주문을 지운다.
 * 아직이면 그대로 돌려준다(같은 참조 — `syncCity()`가 「바뀐 게 없으면 같은
 * 객체」를 지키는 것과 같은 결). **`city.ts`의 `syncCity()`가 이 함수를 부르는
 * 하나의 자리다** — 서버(`getProfile()`)도 클라이언트(로컬 폴백)도 따로 부르지
 * 않는다.
 */
export function collectForgeOrder(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const order = profile.forgeOrder;
  if (!order) return profile;
  if (forgeOrderRemainingMs(order, nowMs) > 0) return profile;
  const { forgeOrder: _drop, ...rest } = profile;
  return {
    ...rest,
    forgeOwned: { ...profile.forgeOwned, [order.equipmentId]: null },
    // 제작일은 **여기 한 번만** 찍힌다 — 지급·해제는 이 값을 안 건드린다
    forgeMadeAt: { ...profile.forgeMadeAt, [order.equipmentId]: nowMs },
  };
}

/**
 * 장수에게 병기를 지급한다. **대상 장수가 이미 다른 것을 끼고 있으면 자동으로
 * 풀어 준다**(2026-09-09 기획 확정 — 장수당 슬롯 하나).
 */
export function equipOfficer(profile: PlayerProfile, equipmentId: string, officer: OfficerId): PlayerProfile {
  const forgeOwned = { ...profile.forgeOwned };
  for (const [id, holder] of Object.entries(forgeOwned)) {
    if (holder === officer) forgeOwned[id] = null;
  }
  forgeOwned[equipmentId] = officer;
  return { ...profile, forgeOwned };
}

/** 지급을 해제한다 — 그 항목만 미지급으로 되돌린다 */
export function unequipOfficer(profile: PlayerProfile, equipmentId: string): PlayerProfile {
  if (!(equipmentId in profile.forgeOwned)) return profile;
  return { ...profile, forgeOwned: { ...profile.forgeOwned, [equipmentId]: null } };
}

/** 장수 하나가 지금 낀 병기. 없으면 `undefined` — 장수 상세 화면 등에서 쓴다 */
export function equippedBy(profile: PlayerProfile, officer: OfficerId): EquipmentData | undefined {
  const id = Object.entries(profile.forgeOwned).find(([, holder]) => holder === officer)?.[0];
  return id ? equipmentById.get(id) : undefined;
}
