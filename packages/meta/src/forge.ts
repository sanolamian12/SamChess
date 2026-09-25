/**
 * 대장간 — 제조 · 지급 관리 (트랙 11h 이어서, 2026-09-09).
 *
 * ────────────────────────────────────────────────────────────────
 * 세 가지는 이미 굳어 있다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 1. **종류당 개수는 대장간 레벨이 정한다 — 피라미드** (2026-09-14 기획 확정).
 *    종류당 최대 = `대장간 Lv − 해금 Lv + 1` — 대장간 Lv5에서 해금 Lv1 병기는 다섯 자루,
 *    … 해금 Lv5 병기는 한 자루다. 예전엔 **계정당 1개**였고 15종 가격 합 750금화가 매출
 *    상한이었다. 피라미드면 상한이 **1,495금화**로 두 배가 되지만 **최상위(해금 Lv5) 병기는
 *    종류당 1자루 그대로**라 전투력 천장은 움직이지 않는다. 황궁(도시 Lv11) 보상으로 더 여는
 *    안은 **기각했다(Lv5 동결)**. 근거는 `history/2026-09-14_도시증축조건_보관함이관_패배카드.md` §5.
 * 2. **장수 한 명은 병기 하나만 낀다** — `equipOfficer()`가 기존 것을 자동으로
 *    풀어 준다(2026-09-09 기획 확정).
 * 3. **금화를 내고 아이템을 받는 거래라 서버가 판정한다** — 이 파일의 함수들은
 *    다른 meta 함수와 똑같이 순수하지만, **부르는 자리는 클라이언트가 아니라
 *    `packages/server-api`다**(`MarketScreen.buyMaterials`와 같은 결). 지급/해제
 *    (`equipOfficer`/`unequipOfficer`)만은 총량을 안 바꾸므로 클라이언트가 직접
 *    부르고 `PUT`으로 올린다.
 *
 * ────────────────────────────────────────────────────────────────
 * 보유 목록의 키는 「종류」가 아니라 「자루」다 (저장 형식 v6, 2026-09-14) ★
 * ────────────────────────────────────────────────────────────────
 *
 * `forgeOwned`·`forgeMadeAt`의 키가 `EquipmentData.id`에서 **`{id}#{n}`**으로 바뀌었다 —
 * 같은 병기를 여러 자루 가지면 지급 대상도 제작일도 자루마다 달라야 해서다. 지급·해제·
 * 요약·서버 소유 경계(`guardServerOwned`)는 **키를 그대로 들고 다니므로 뜻이 안 바뀌었고**,
 * 키에서 병기를 찾는 자리만 `equipmentIdOfKey()`를 지난다. v5까지의 맨 id는
 * `migrateProfile()`이 `#1`로 되접는다.
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

import { buildingById, equipmentById, equipmentForForge } from '@samchess/data';
import type { EquipmentData } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { buildingLevel } from './city.ts';
import type { MetaResult, PlayerProfile } from './types.ts';

const ONE_MINUTE_MS = 60 * 1000;

/** Lv*n* 장비의 제조 기간. Lv1 = 1분, Lv2 = 2분 … (위 머리말 ★) */
export const craftDurationMs = (unlockLevel: number): number => unlockLevel * ONE_MINUTE_MS;

/** 대장간 레벨. 안 지었으면 0 — `equipmentForForge(0)`이 빈 배열을 낸다 */
export const forgeLevel = (profile: PlayerProfile): number => buildingLevel(profile, 'forge');

// ── 자루 키 (v6) ────────────────────────────────────────────────

const COPY_SEP = '#';

/** 자루 키 → 병기 id. `dae-gam-do#2` → `dae-gam-do`. v5의 맨 id도 그대로 받는다 */
export function equipmentIdOfKey(key: string): string {
  const at = key.lastIndexOf(COPY_SEP);
  return at < 0 ? key : key.slice(0, at);
}

/** 자루 키의 번호. 맨 id거나 번호가 이상하면 1 */
export function copyNumberOfKey(key: string): number {
  const at = key.lastIndexOf(COPY_SEP);
  if (at < 0) return 1;
  const n = Number(key.slice(at + 1));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** 병기 id와 번호로 자루 키를 짓는다 — 키를 짓는 자리는 이 함수 하나다 */
export const forgeItemKey = (equipmentId: string, copy: number): string => `${equipmentId}${COPY_SEP}${copy}`;

// ── 종류당 개수 (피라미드) ──────────────────────────────────────

/**
 * 종류당 최대 자루 수 — `대장간 Lv − 해금 Lv + 1`, 아직 해금 전이면 0 (위 머리말 ★1).
 * 대장간 레벨 상한(5)과 해금 레벨 상한(5)이 같아 **해금 Lv5 병기는 언제나 1자루까지**다.
 */
export const forgeCopiesAllowed = (forgeLv: number, unlockLevel: number): number =>
  Math.max(0, forgeLv - unlockLevel + 1);

/** 이미 가진 자루 수 — 진행 중인 주문은 세지 않는다(그건 `forgeOrder`가 따로 본다) */
export function forgeCopiesOwned(profile: PlayerProfile, equipmentId: string): number {
  return Object.keys(profile.forgeOwned).filter((k) => equipmentIdOfKey(k) === equipmentId).length;
}

/**
 * 지금 살 수 있는 병기 — 해금됐고 **종류당 상한에 아직 안 닿은** 것만. 진행 중인 주문도
 * 한 자루로 센다 — 주문이 끝나 들어올 자루까지 합쳐 상한을 넘으면 목록에 뜨면 안 된다.
 */
export function craftableEquipment(profile: PlayerProfile): EquipmentData[] {
  const lv = forgeLevel(profile);
  return equipmentForForge(lv).filter((e) => {
    const pending = profile.forgeOrder?.equipmentId === e.id ? 1 : 0;
    return forgeCopiesOwned(profile, e.id) + pending < forgeCopiesAllowed(lv, e.unlockLevel);
  });
}

/** 보유 자루 / 지급된 수 / 미지급 수 — 화면이 직접 세지 않는다 */
export function forgeSummary(profile: PlayerProfile): { owned: number; assigned: number; spare: number } {
  const owned = Object.keys(profile.forgeOwned).length;
  const assigned = Object.values(profile.forgeOwned).filter((v) => v !== null).length;
  return { owned, assigned, spare: owned - assigned };
}

export function canStartForgeOrder(profile: PlayerProfile, equipmentId: string): MetaResult {
  const item = equipmentById.get(equipmentId);
  if (!item) return { ok: false, reason: `모르는 장비다 — ${equipmentId}` };
  const lv = forgeLevel(profile);
  if (item.unlockLevel > lv) {
    return { ok: false, reason: `대장간 Lv${item.unlockLevel}이 필요하다 — 지금 Lv${lv}` };
  }
  const allowed = forgeCopiesAllowed(lv, item.unlockLevel);
  if (forgeCopiesOwned(profile, equipmentId) >= allowed) {
    const maxed = lv >= (buildingById.get('forge')?.maxLevel ?? lv);
    return {
      ok: false,
      reason: maxed
        ? `${item.name}은 ${allowed}자루까지만 만들 수 있다`
        : `${item.name}은 대장간 Lv${lv}에서 ${allowed}자루까지다 — 대장간을 올리면 더 만들 수 있다`,
    };
  }
  if (profile.forgeOrder) return { ok: false, reason: '이미 다른 병기를 제조 중이다' };
  if (profile.gold < item.gold) return { ok: false, reason: `금화가 모자란다 — ${profile.gold}/${item.gold}` };
  return { ok: true };
}

/**
 * 주문을 시작한다 — 금화를 내고 시작 시각을 찍는다. **부르는 자리는 서버다**(위 §3).
 *
 * **확정이 곧 결제이고 되돌리는 길은 없다** (2026-09-25 기획자 확정). 예전엔 완성 전
 * 언제든 취소하면 전액 환불했는데(`applyCancelForgeOrder`, `POST /forge/cancel`) 통째로
 * 걷어 냈다. 「금화는 오직 결제로만 생긴다」와 같은 날 정한 것이다 — 금화를 **돌려주는**
 * 길이 하나라도 있으면 그 길마다 「어디서 냈던 금화인가」를 따져야 하고, 「마지막 1분만
 * 취소 불가」 같은 중간안은 예치 상태를 금화를 쓰는 자리 전부에 퍼뜨린다. 대신 화면이
 * **확정 전에 한 번 묻고 「취소·환불되지 않는다」고 알린다**(`ForgeScreen`의 주문 확인).
 */
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
  const missing = Object.keys(profile.forgeOwned).filter((key) => !made[key]);
  if (missing.length === 0) return profile;
  const next = { ...made };
  for (const key of missing) next[key] = nowMs;
  return { ...profile, forgeMadeAt: next };
}

/** 이 병기의 비어 있는 가장 작은 번호 — 되접기로 번호가 비어도 새 자루가 그 자리를 채운다 */
function nextCopy(profile: PlayerProfile, equipmentId: string): number {
  let n = 1;
  while (forgeItemKey(equipmentId, n) in profile.forgeOwned) n += 1;
  return n;
}

/**
 * 끝난 주문을 거둔다 — 완성됐으면 **새 자루 키로** 미지급 상태로 `forgeOwned`에 넣고 주문을
 * 지운다. 아직이면 그대로 돌려준다(같은 참조 — `syncCity()`가 「바뀐 게 없으면 같은
 * 객체」를 지키는 것과 같은 결). **`city.ts`의 `syncCity()`가 이 함수를 부르는
 * 하나의 자리다** — 서버(`getProfile()`)도 클라이언트(로컬 폴백)도 따로 부르지
 * 않는다.
 */
export function collectForgeOrder(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const order = profile.forgeOrder;
  if (!order) return profile;
  if (forgeOrderRemainingMs(order, nowMs) > 0) return profile;
  const key = forgeItemKey(order.equipmentId, nextCopy(profile, order.equipmentId));
  const { forgeOrder: _drop, ...rest } = profile;
  return {
    ...rest,
    forgeOwned: { ...profile.forgeOwned, [key]: null },
    // 제작일은 **여기 한 번만** 찍힌다 — 지급·해제는 이 값을 안 건드린다
    forgeMadeAt: { ...profile.forgeMadeAt, [key]: nowMs },
  };
}

/**
 * 장수에게 병기 한 자루를 지급한다. **대상 장수가 이미 다른 것을 끼고 있으면 자동으로
 * 풀어 준다**(2026-09-09 기획 확정 — 장수당 슬롯 하나). `itemKey`는 자루 키다.
 */
export function equipOfficer(profile: PlayerProfile, itemKey: string, officer: OfficerId): PlayerProfile {
  const forgeOwned = { ...profile.forgeOwned };
  for (const [key, holder] of Object.entries(forgeOwned)) {
    if (holder === officer) forgeOwned[key] = null;
  }
  forgeOwned[itemKey] = officer;
  return { ...profile, forgeOwned };
}

/** 지급을 해제한다 — 그 자루만 미지급으로 되돌린다 */
export function unequipOfficer(profile: PlayerProfile, itemKey: string): PlayerProfile {
  if (!(itemKey in profile.forgeOwned)) return profile;
  return { ...profile, forgeOwned: { ...profile.forgeOwned, [itemKey]: null } };
}

/** 장수 하나가 지금 낀 자루의 키. 없으면 `undefined` */
export function equippedKey(profile: PlayerProfile, officer: OfficerId): string | undefined {
  return Object.entries(profile.forgeOwned).find(([, holder]) => holder === officer)?.[0];
}

/** 장수 하나가 지금 낀 병기. 없으면 `undefined` — 장수 카드·일람 등에서 쓴다 */
export function equippedBy(profile: PlayerProfile, officer: OfficerId): EquipmentData | undefined {
  const key = equippedKey(profile, officer);
  return key ? equipmentById.get(equipmentIdOfKey(key)) : undefined;
}
