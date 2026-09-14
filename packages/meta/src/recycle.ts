/**
 * 카드 정리(리사이클) — 같은 등급 카드 셋을 **원하는 장수 카드** 하나로 (GDD §6.3, 2026-09-14)
 *
 * ```
 * 재료   같은 등급 카드 cardsIn장(3)  ← 카드가 minHeld장(2) 이상인 장수에게서만, 1장은 남긴다
 * 받는 것 보유한 같은 등급 장수 중 사람이 고른 1명의 카드 cardsOut장(1)
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 이 규칙인가 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 카드는 전투·가챠 모두 **무작위로 흩어져** 들어온다. 한 장수를 Lv9로 올리는 데 101장이
 * 드는데, 시뮬레이션에서 22.5만 원(10연 30회)을 쓴 계정이 무과금과 같은 속도로 컸다 —
 * 원하는 장수에게 모을 길이 없었기 때문이다. 이 규칙이 「가챠의 억울함」에 대한 보상이다.
 *
 * - **보유한 장수만 받는다** — 아직 없는 S·A를 받게 하면 증축의 S·A 조건(§5.1)을
 *   가챠 없이 채울 수 있다.
 * - **같은 등급끼리만** — 그래서 C·D는 전투만으로 빨리 크고 S·A는 가챠 양에 묶인다.
 *   결제 단계가 S·A 성장으로 갈리는 것이 의도다.
 * - **마지막 1장은 남긴다** — 보관함 장수는 카드 1장이 곧 보유라(`boxedOfficers`),
 *   그 장을 쓰면 장수가 계정에서 사라지고 증축 조건의 보유 수가 줄어든다.
 *
 * **카드는 클라이언트 소유 필드다**(`authority.ts`) — 레벨업과 같은 결로 화면이 이
 * 함수를 부르고 `PUT`으로 올린다. 규칙이 판정하고 화면은 옮겨 적는다.
 */

import { ECONOMY, officerById } from '@samchess/data';
import type { Grade, OfficerId } from '@samchess/rules';
import { cardsToLevelUp, ownedOfficers } from './profile.ts';
import type { MetaResult, PlayerProfile } from './types.ts';

/** 재료 장수 — 단일 출처는 `economy.json` ← 추출기의 `ECONOMY` */
export const RECYCLE_CARDS_IN: number = ECONOMY.recycle.cardsIn;
/** 받는 장수 */
export const RECYCLE_CARDS_OUT: number = ECONOMY.recycle.cardsOut;
/** 이만큼 가진 장수에게서만 재료를 뗀다 — 그 아래 장수(minHeld − 1)는 남긴다 */
export const RECYCLE_MIN_HELD: number = ECONOMY.recycle.minHeld;

const no = (reason: string): MetaResult => ({ ok: false, reason });

/** 재료 — 장수마다 몇 장을 쓰는가. 0이나 빈 칸은 「안 쓴다」 */
export type RecycleInputs = Partial<Record<OfficerId, number>>;

/** 이 장수의 카드 중 재료로 쓸 수 있는 수. `minHeld`장 미만이면 0이고, 쓰더라도 1장은 남는다 */
export function recyclableCards(profile: PlayerProfile, officer: OfficerId): number {
  const held = Math.max(0, Math.floor(profile.cards[officer] ?? 0));
  return held >= RECYCLE_MIN_HELD ? held - (RECYCLE_MIN_HELD - 1) : 0;
}

/** 최대 레벨이라 카드가 더 쓸모없는 장수 — 받는 쪽에서 뺀다 */
const isMaxed = (profile: PlayerProfile, officer: OfficerId): boolean => {
  const inst = profile.roster[officer];
  return !!inst && cardsToLevelUp(inst.level) === null;
};

const gradeOf = (officer: OfficerId): Grade | undefined => officerById.get(officer)?.grade;

/** 받을 수 있는 장수 — 보유한 그 등급 장수 중 아직 최대 레벨이 아닌 (보관함 포함) */
export function recycleTargets(profile: PlayerProfile, grade: Grade): OfficerId[] {
  return ownedOfficers(profile).filter((id) => gradeOf(id) === grade && !isMaxed(profile, id));
}

/** 재료가 될 수 있는 장수와 쓸 수 있는 수. 받을 장수(`target`)는 뺀다 */
export function recycleMaterials(
  profile: PlayerProfile, grade: Grade, target: OfficerId | null,
): { officer: OfficerId; usable: number }[] {
  return ownedOfficers(profile)
    .filter((id) => id !== target && gradeOf(id) === grade)
    .map((officer) => ({ officer, usable: recyclableCards(profile, officer) }))
    .filter((m) => m.usable > 0);
}

/** 고른 재료의 합 */
export const recycleTotal = (inputs: RecycleInputs): number =>
  Object.values(inputs).reduce<number>((n, v) => n + (v ?? 0), 0);

/** 고른 재료로 받는 카드 수 — 단위에 못 미친 나머지는 **안 쓴다**(판정이 막는다) */
export const recycleOutput = (inputs: RecycleInputs): number =>
  Math.floor(recycleTotal(inputs) / RECYCLE_CARDS_IN) * RECYCLE_CARDS_OUT;

/** 바꿀 수 있는가. **왜 안 되는지 글자로 말한다** */
export function canRecycle(profile: PlayerProfile, target: OfficerId, inputs: RecycleInputs): MetaResult {
  const data = officerById.get(target);
  if (!data) return no(`모르는 장수다 — ${target}`);
  if (!ownedOfficers(profile).includes(target)) return no('보유한 장수의 카드만 받을 수 있다');
  if (isMaxed(profile, target)) return no(`${data.name}은 이미 최대 레벨이다`);

  for (const [id, n] of Object.entries(inputs) as [OfficerId, number | undefined][]) {
    if (!n) continue;
    if (!Number.isInteger(n) || n < 0) return no(`재료 수가 이상하다 — ${n}`);
    if (id === target) return no('받을 장수의 카드는 재료로 못 쓴다');
    const from = officerById.get(id);
    if (!from || from.grade !== data.grade) return no(`${data.grade}급 카드만 재료로 쓸 수 있다`);
    const usable = recyclableCards(profile, id);
    if (n > usable) return no(`${from.name}의 카드는 ${usable}장까지 쓸 수 있다 — 장수마다 1장은 남는다`);
  }
  const total = recycleTotal(inputs);
  if (total === 0) return no('재료를 고르지 않았다');
  if (total % RECYCLE_CARDS_IN !== 0) {
    return no(`재료는 ${RECYCLE_CARDS_IN}장 단위다 — 지금 ${total}장`);
  }
  return { ok: true };
}

/** 바꾼다 — 재료 카드를 떼고 받을 장수에게 붙인다. 입력 프로필은 건드리지 않는다 */
export function applyRecycle(profile: PlayerProfile, target: OfficerId, inputs: RecycleInputs): PlayerProfile {
  const check = canRecycle(profile, target, inputs);
  if (!check.ok) throw new Error(check.reason);
  const cards = { ...profile.cards };
  for (const [id, n] of Object.entries(inputs) as [OfficerId, number | undefined][]) {
    if (n) cards[id] = (cards[id] ?? 0) - n;   // 1장은 남으므로 0이 되지 않는다
  }
  cards[target] = (cards[target] ?? 0) + recycleOutput(inputs);
  return { ...profile, cards };
}
