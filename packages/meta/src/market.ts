/**
 * 시장 아이템 — 보유·하루 매물·지참 (2026-09-23, GDD §6.5).
 *
 * ────────────────────────────────────────────────────────────────
 * 대장간과 다른 두 가지 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 1. **1회용이라 총량에 천장이 없다.** 대장간은 종류당 보유 상한이 있어 전부
 *    만들면 1,495금화에서 끝나는데, 시장은 계속 사고 계속 쓴다. 대신 **하루
 *    매물**(`marketStockLeft`)과 **보유 총량**(`marketCapacity`) 둘이 조인다.
 * 2. **자루가 아니라 개수다.** 대장간은 자루마다 키가 있고(`{id}#{n}`) 값이
 *    「지금 누가 끼고 있나」인데, 시장은 같은 것이 여러 개라 **수량**으로 센다.
 *
 * ────────────────────────────────────────────────────────────────
 * 서버 것과 클라이언트 것이 갈린다
 * ────────────────────────────────────────────────────────────────
 *
 * | 필드 | 임자 | 왜 |
 * |---|---|---|
 * | `marketOwned` (보유 수량) | **서버** | 금화로 산다 |
 * | `marketTaken` (오늘 산 수량) | **서버** | 하루 매물을 재는 값이다 |
 * | `marketCarry` (누가 들고 갈지) | **클라이언트** | 총량을 안 바꾼다 — 대장간 지급·농지 파수꾼과 같은 결 |
 *
 * ────────────────────────────────────────────────────────────────
 * 병기와 **같은 칸**이다
 * ────────────────────────────────────────────────────────────────
 *
 * 장수 하나는 병기 **또는** 아이템 하나만 든다. 그래서 `marketCarry`에 든 장수는
 * 지급받은 병기가 있어도 **아이템을 든다** — 가르는 자리는 `heldFor()` 하나이고
 * `toRosterEntries()`가 그것만 부른다.
 *
 * **지급을 지우지 않는다** — 아이템이 소모되면 병기가 그대로 돌아와야 한다.
 * 「이번 판만 병기 대신 아이템을 든다」가 규칙이고, 지우면 판마다 다섯 명의
 * 병기를 다시 끼우는 잡일이 생긴다.
 */

import { MARKET_ITEMS, marketItemById, marketItemsForMarket } from '@samchess/data';
import type { MarketItemData } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { buildingLevel } from './city.ts';
import { equippedBy } from './forge.ts';
// 날짜 경계는 **계정 전체에 하나**다 — 도적떼와 같은 KST 자정이다. 둘로 두면
// 서버가 날짜를 두 벌 계산해야 하고, 어느 쪽이 오늘인지가 화면마다 갈린다.
import { raidDay as kstDay } from './raid.ts';
import type { MetaResult, PlayerProfile } from './types.ts';

/** 아이템을 파는 최소 시장 레벨 — Lv1 시장은 아이템을 안 판다 (GDD §6.5) */
export const MARKET_ITEM_MIN_LEVEL = 2;
/** 보유 총량 한 칸 — `(시장 Lv − 1) × 20` */
const CAPACITY_PER_LEVEL = 20;

const fail = (reason: string, code: string, params?: Record<string, number>): MetaResult =>
  ({ ok: false, reason, code, ...(params ? { params } : {}) });

// ── 읽기 ───────────────────────────────────────────────────────

/** 이 도시의 시장 레벨 */
export const marketLevel = (profile: PlayerProfile): number => buildingLevel(profile, 'market');

/** 지금 살 수 있는 품목 — **누적이다.** Lv4 시장은 Lv2·Lv3 것도 판다 */
export const marketItemsOf = (profile: PlayerProfile): MarketItemData[] =>
  marketItemsForMarket(marketLevel(profile));

/** 보유 총량 상한 — `(시장 Lv − 1) × 20`. Lv1 이하는 0이다 */
export const marketCapacity = (profile: PlayerProfile): number =>
  Math.max(0, marketLevel(profile) - 1) * CAPACITY_PER_LEVEL;

/** 지금 가진 아이템 수 (종류가 아니라 **낱개**를 센다) */
export const marketOwnedCount = (profile: PlayerProfile): number =>
  Object.values(profile.marketOwned ?? {}).reduce<number>((n, c) => n + Math.max(0, c ?? 0), 0);

/** 그 품목을 몇 개 가졌나 */
export const marketHeldCount = (profile: PlayerProfile, item: string): number =>
  Math.max(0, profile.marketOwned?.[item] ?? 0);

/**
 * 하루에 풀리는 매물 — 종류당 `시장 Lv − 해금 Lv + 1`개.
 *
 * **대장간 피라미드(`forgeCopiesAllowed`)와 같은 식이고 뜻만 다르다** —
 * 대장간은 종류당 보유 상한, 시장은 하루 매물이다. 아직 해금 전이면 0이다.
 */
export const marketDailyStock = (marketLv: number, unlockLevel: number): number =>
  Math.max(0, marketLv - unlockLevel + 1);

/**
 * 오늘 그 품목을 **몇 개 더 살 수 있나.**
 *
 * ★ **날이 바뀌면 `marketTaken`은 「없는 것」이 된다** — 지우지 않고 날짜만
 * 비교한다. 지우려면 누군가 그 순간에 계정을 만져야 하는데, 아무도 안 들르는
 * 계정도 다음 날이면 매물이 차 있어야 한다(군량 충전과 같은 결).
 */
export function marketStockLeft(profile: PlayerProfile, item: string, nowMs: number): number {
  const def = marketItemById.get(item);
  if (!def) return 0;
  const total = marketDailyStock(marketLevel(profile), def.unlockLevel);
  const taken = profile.marketTaken?.day === kstDay(nowMs)
    ? Math.max(0, profile.marketTaken.counts[item] ?? 0)
    : 0;
  return Math.max(0, total - taken);
}

// ── 사기 ───────────────────────────────────────────────────────

/**
 * 살 수 있나 — **금화 · 하루 매물 · 보유 총량 셋**을 본다.
 *
 * 거부하는 말을 여기서 낸다 — 화면이 이유를 다시 짓지 않는다.
 */
export function canBuyMarketItem(
  profile: PlayerProfile, item: string, nowMs: number,
): MetaResult {
  const def = marketItemById.get(item);
  if (!def) return fail(`모르는 아이템이다 — ${item}`, 'market.unknownItem');

  const lv = marketLevel(profile);
  if (lv < MARKET_ITEM_MIN_LEVEL) {
    return fail(`시장 Lv${MARKET_ITEM_MIN_LEVEL}부터 아이템을 판다 (지금 Lv${lv})`,
      'market.notBuilt', { need: MARKET_ITEM_MIN_LEVEL, have: lv });
  }
  if (def.unlockLevel > lv) {
    return fail(`시장 Lv${def.unlockLevel}이 필요하다 — 지금 Lv${lv}`,
      'market.locked', { need: def.unlockLevel, have: lv });
  }
  if (marketStockLeft(profile, item, nowMs) <= 0) {
    return fail('오늘 나온 물량이 다 나갔다', 'market.soldOut');
  }
  if (marketOwnedCount(profile) >= marketCapacity(profile)) {
    return fail(`더 둘 곳이 없다 (${marketOwnedCount(profile)}/${marketCapacity(profile)})`,
      'market.full', { have: marketOwnedCount(profile), max: marketCapacity(profile) });
  }
  if (profile.gold < def.gold) {
    return fail(`금화가 모자란다 (${profile.gold}/${def.gold})`,
      'market.notEnoughGold', { have: profile.gold, need: def.gold });
  }
  return { ok: true };
}

/**
 * 한 개 산다 — 금화를 빼고 보유를 늘리고 **오늘 산 수를 센다.**
 *
 * 판정은 `canBuyMarketItem()`이 이미 했다고 보고 여기서는 계산만 한다
 * (`applyBuyMaterials()`와 같은 결). 부르는 쪽이 서버라 검사와 적용이 한 요청 안에 있다.
 */
export function applyBuyMarketItem(
  profile: PlayerProfile, item: string, nowMs: number,
): PlayerProfile {
  const def = marketItemById.get(item);
  if (!def) throw new Error(`모르는 아이템이다: ${item}`);
  const today = kstDay(nowMs);
  // 날이 바뀌었으면 오늘 것부터 다시 센다 — 어제 산 수는 아무 뜻이 없다
  const counts = profile.marketTaken?.day === today ? { ...profile.marketTaken.counts } : {};
  counts[item] = (counts[item] ?? 0) + 1;
  return {
    ...profile,
    gold: profile.gold - def.gold,
    marketOwned: { ...profile.marketOwned, [item]: marketHeldCount(profile, item) + 1 },
    marketTaken: { day: today, counts },
  };
}

// ── 들려 보내기 ────────────────────────────────────────────────

/**
 * **이 장수가 이번 판에 들고 갈 것** — 아이템이 있으면 아이템, 없으면 병기.
 *
 * 가르는 자리는 여기 하나다. `toRosterEntries()`가 이것만 부르고, 엔진 쪽에서
 * 두 표를 가르는 것은 `rules`의 `heldEffectOf()` 하나다.
 */
export function heldFor(profile: PlayerProfile, officer: OfficerId): string | undefined {
  const carried = profile.marketCarry?.[officer];
  if (carried && marketItemById.has(carried)) return carried;
  return equippedBy(profile, officer)?.id;
}

/** 지금 아이템을 들려 보낸 장수 수 — 보유보다 많이 들려 보낼 수 없다 */
export const carriedCount = (profile: PlayerProfile, item: string): number =>
  Object.values(profile.marketCarry ?? {}).filter((id) => id === item).length;

/**
 * 들려 보낼 수 있나 — **보유한 만큼만.** 한 장수는 하나다(덮어쓴다).
 *
 * 「한 판에 1인 1개」가 여기서 구조로 선다 — `marketCarry`가 장수 하나에 값
 * 하나인 표라 두 개를 들 자리가 없다.
 */
export function canCarryItem(
  profile: PlayerProfile, officer: OfficerId, item: string,
): MetaResult {
  if (!marketItemById.has(item)) return fail(`모르는 아이템이다 — ${item}`, 'market.unknownItem');
  if (!profile.roster[officer]) return fail('보유하지 않은 장수다', 'market.noOfficer');
  const already = profile.marketCarry?.[officer] === item ? 1 : 0;
  if (carriedCount(profile, item) - already >= marketHeldCount(profile, item)) {
    return fail(`가진 만큼만 들려 보낼 수 있다 (${marketHeldCount(profile, item)}개)`,
      'market.noneLeft', { have: marketHeldCount(profile, item) });
  }
  return { ok: true };
}

/** 들려 보낸다 — 한 장수에 하나라 이전 것은 자동으로 내려놓는다 */
export function carryItem(
  profile: PlayerProfile, officer: OfficerId, item: string,
): PlayerProfile {
  return { ...profile, marketCarry: { ...profile.marketCarry, [officer]: item } };
}

/** 내려놓는다. 안 들고 있었으면 그대로 돌려준다 */
export function uncarryItem(profile: PlayerProfile, officer: OfficerId): PlayerProfile {
  if (!profile.marketCarry?.[officer]) return profile;
  const carry = { ...profile.marketCarry };
  delete carry[officer];
  return { ...profile, marketCarry: carry };
}

// ── 소모와 환불 ────────────────────────────────────────────────

/** 판에 실제로 실린 아이템 — `{장수: 아이템}`. 안 든 장수는 안 들어온다 */
export function carriedFor(
  profile: PlayerProfile, officers: readonly OfficerId[],
): Partial<Record<OfficerId, string>> {
  const out: Partial<Record<OfficerId, string>> = {};
  for (const officer of officers) {
    const item = profile.marketCarry?.[officer];
    if (item && marketItemById.has(item)) out[officer] = item;
  }
  return out;
}

/**
 * **판이 열리는 순간 차감한다** — 참가비(군량)와 같은 자리다 (GDD §6.5).
 *
 * ★ **판이 끝난 뒤에 차감하면 같은 아이템을 여러 판에 쓸 수 있다** — 온라인 한
 * 판을 열어 둔 채 다른 탭에서 도적떼 방어전에 같은 탕약을 다시 들려 보낸다.
 *
 * 들려 보낸 것은 **함께 내려놓고**(`marketCarry`) 판이 도는 동안 **`marketInPlay`에
 * 옮겨 둔다.** 지급받은 병기는 그대로 남아 있어 **저절로 돌아온다**
 * (`heldFor()`가 아이템이 없으면 병기를 본다).
 *
 * ★ **옮겨 두지 않으면 환불을 할 수 없다.** 판이 끝났을 때 `marketCarry`는 이미
 * 비어 있고, 「내가 무엇을 들었다」를 클라이언트에게 물으면 **아이템을 찍어 낼 수
 * 있다**(환불은 보유를 늘린다). 그래서 서버가 기억한다 — `forgeOrder`·
 * `hospitalBusy`와 같은 자리의 서버 소유 필드다.
 *
 * **이미 도는 판이 있으면 덮어쓰지 않는다** — 두 판이 겹치면 앞 판의 환불이
 * 사라진다. 부르는 쪽이 판 하나에 한 번만 부른다.
 */
export function consumeCarried(
  profile: PlayerProfile, officers: readonly OfficerId[],
): PlayerProfile {
  const carried = carriedFor(profile, officers);
  const entries = Object.entries(carried) as [OfficerId, string][];
  if (entries.length === 0) return profile;

  const owned = { ...profile.marketOwned };
  const carry = { ...profile.marketCarry };
  const inPlay = [...(profile.marketInPlay ?? [])];
  for (const [officer, item] of entries) {
    const left = Math.max(0, (owned[item] ?? 0) - 1);
    if (left > 0) owned[item] = left; else delete owned[item];
    delete carry[officer];
    inPlay.push({ officer, item });
  }
  return { ...profile, marketOwned: owned, marketCarry: carry, marketInPlay: inPlay };
}

/**
 * 판이 끝났다 — **돌려줄 것만 돌려주고 기억을 비운다.**
 *
 * - `settled === false`(성립하지 않은 판) → 실린 것 **전부**
 * - `settled === true` → **하나도 안 돌려준다**
 *
 * ★ **참전하면 소모된다 — 액티브도 마찬가지다** (2026-09-23 기획자 확정,
 * 「안 쓴 액티브는 돌려준다」를 뒤집음). 안 쓴 것을 돌려주려면 **「누가 썼나」를
 * 정산에 날라야 하는데**, 무승부 택1은 판정 주체가 이미 사라진 뒤에 오는 경로라
 * (`/battle/draw-result`) 서버가 그 값을 검증할 길이 없다 — 「안 썼다」고 대면
 * 쓴 것을 돌려받는다. 돌려주지 않으면 그 자리가 통째로 없어지고, 규칙도
 * 「들고 나가면 없어진다」 한 줄로 줄어든다.
 *
 * **성립하지 않은 판은 그대로 전부 돌려준다** — 거기는 **참전한 적이 없다**
 * (배치 중 이탈 · 양쪽 이탈 · 양쪽 유휴). 참가비 환불과 같은 자리다.
 *
 * **실린 것이 없어도 기억은 비운다** — 안 비우면 다음 판에 앞 판의 것이 섞인다.
 */
export function settleCarried(profile: PlayerProfile, settled: boolean): PlayerProfile {
  const inPlay = profile.marketInPlay ?? [];
  if (inPlay.length === 0) return profile;
  const next = settled ? profile : refundItems(profile, inPlay.map((x) => x.item));
  const { marketInPlay: _drop, ...rest } = next;
  return rest;
}

/**
 * 돌려준다 — **성립하지 않은 판**(배치 중 이탈 · 양쪽 이탈 · 양쪽 유휴)뿐이다.
 *
 * ★ **성립한 판에서는 아무것도 안 돌아온다** — 쓰든 안 쓰든, 항복이든 패배든
 * 참전 자체가 소모다(2026-09-23 확정).
 */
export function refundItems(
  profile: PlayerProfile, items: readonly string[],
): PlayerProfile {
  if (items.length === 0) return profile;
  const owned = { ...profile.marketOwned };
  for (const item of items) {
    if (!marketItemById.has(item)) continue;
    owned[item] = (owned[item] ?? 0) + 1;
  }
  return { ...profile, marketOwned: owned };
}

/**
 * **이 판에서 부상을 면제받는 장수** — 청낭서를 들고 나간 사람들 (GDD §6.5).
 *
 * 출처는 `marketInPlay`다 — **판이 열릴 때 무엇이 나갔는지**를 서버가 적어 둔
 * 그 값이고, 정산 순간까지 살아 있다(`settleCarried()`가 그 뒤에 비운다).
 * `marketCarry`를 보면 안 된다: 소모할 때 이미 비워졌고, 판이 도는 동안 사람이
 * 다음 판의 지참을 고쳤을 수도 있다.
 *
 * **거르는 자리는 `applyInjuries()`를 부르는 쪽**이다 — 그 함수 안에서 거르면
 * 병원 시험용 강제 부상(`/dev/grant`)까지 면제된다.
 */
export function injuryShielded(profile: PlayerProfile): Set<OfficerId> {
  const out = new Set<OfficerId>();
  for (const { officer, item } of profile.marketInPlay ?? []) {
    if (marketItemById.get(item)?.passive?.noInjury) out.add(officer);
  }
  return out;
}

/** 부상을 입을 장수만 남긴다 — 청낭서를 든 사람은 빠진다 */
export const fallenAfterShield = (
  profile: PlayerProfile, fallen: readonly OfficerId[],
): OfficerId[] => {
  const shielded = injuryShielded(profile);
  return shielded.size === 0 ? [...fallen] : fallen.filter((o) => !shielded.has(o));
};

/** 데이터에 있는 모든 아이템 id — 되접기가 모르는 키를 거를 때 쓴다 */
export const MARKET_ITEM_IDS: ReadonlySet<string> = new Set(MARKET_ITEMS.map((m) => m.id));
