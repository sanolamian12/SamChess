/**
 * 잉여 카드 — 더는 장수를 키울 수 없는 카드를 모아 **등급 확정 모집**에 쓴다 (2026-11-24 기획자, GDD §6.3 — 카드 정리를 대신한다).
 *
 * ```
 * 들어오는 길  Lv9(최대) 장수에게 들어온 카드           ← addCard · 레벨업의 남은 몫 · 되접기(foldSurplus)
 *             (궁궐이 가득 차면 새 장수는 안 들어온다 — 모집은 `canPullGacha`가 막고, 전투 보상은 보유한 장수로
 *              다시 뽑고(`cardCandidates`), 우편은 못 받는다(`mailSeatCheck`). 그래서 「자리 없는 새 장수」는 잉여가 안 된다)
 * 쓰는 길     잉여 카드 10장 → A급 확정 · 20장 → S급 확정 · 30장 → E급(헌제) 확정 — 카드 1장
 * ```
 *
 * - **받는 장수는 보유한 그 등급 장수 중 무작위 한 명**이다(풀 + 보관함). 잉여 카드가 쌓이는 장수(Lv9)는 뺀다 —
 *   주자마자 다시 잉여 카드가 되면 값만 나간다. 받을 장수가 없으면 모집할 수 없다.
 * - **E급은 헌제를 거느릴 때만**(`hasEmperor`) — 화면은 칸을 잿빛으로 막는다.
 * - **도시 레벨 상한에 막힌 장수의 카드는 잉여가 아니다** — 도시가 오르면 쓴다(`isSurplusOfficer`).
 * - 무작위는 서버가 시드를 넣는다 — meta는 `Math.random()`을 안 읽는다(가챠 시드와 같은 결).
 *
 * 잉여 카드(`surplusCards`)는 **서버 소유**다(`authority.ts`) — 바꾸는 길은 가챠 · 정산 · 레벨업 · `POST /market/surplus`.
 */

import { ECONOMY, officerById } from '@samchess/data';
import { shuffle } from '@samchess/rules';
import type { OfficerId } from '@samchess/rules';
import { hasEmperor } from './city.ts';
import { addCard, isSurplusOfficer, ownedOfficers } from './profile.ts';
import { rejectWith } from './reject.ts';
import type { MetaResult, PlayerProfile } from './types.ts';

/** 잉여 카드로 모집하는 등급 — 차례가 곧 화면의 칸 차례다 */
export const SURPLUS_GRADES = ['A', 'S', 'E'] as const;
export type SurplusGrade = typeof SURPLUS_GRADES[number];
export const isSurplusGrade = (v: unknown): v is SurplusGrade => (SURPLUS_GRADES as readonly unknown[]).includes(v);

/** 가진 잉여 카드 */
export const surplusOf = (profile: PlayerProfile): number => Math.max(0, Math.floor(profile.surplusCards ?? 0));

/** 이 등급 모집에 드는 잉여 카드 — 단일 출처는 `economy.json`의 `surplusExchange` */
export const surplusCost = (grade: SurplusGrade): number => ECONOMY.surplusExchange[grade];

/** 받을 수 있는 장수 — 보유한 그 등급 장수(풀 + 보관함) 중 잉여 카드가 쌓이지 않는 */
export function surplusTargets(profile: PlayerProfile, grade: SurplusGrade): OfficerId[] {
  return ownedOfficers(profile).filter((id) => officerById.get(id)?.grade === grade && !isSurplusOfficer(profile, id));
}

/** 지금 이 등급을 모집할 수 있는가 — 막힌 까닭의 차례는 헌제 → 받을 장수 → 잉여 카드 수 */
export function canExchangeSurplus(profile: PlayerProfile, grade: SurplusGrade): MetaResult {
  if (grade === 'E' && !hasEmperor(profile)) {
    return { ok: false, reason: '황제를 모셔야 E급을 모집할 수 있습니다', code: 'market.surplus.noEmperor' };
  }
  if (surplusTargets(profile, grade).length === 0) {
    return { ok: false, reason: `받을 ${grade}급 장수가 없습니다`, code: 'market.surplus.noTarget', params: { grade } };
  }
  const have = surplusOf(profile);
  const need = surplusCost(grade);
  if (have < need) {
    return { ok: false, reason: `잉여 카드가 모자랍니다 — ${have}/${need}장`, code: 'market.surplus.notEnough', params: { have, need } };
  }
  return { ok: true };
}

/**
 * 잉여 카드를 내고 그 등급 장수 한 명의 카드 1장을 받는다. `seed`로 받는 장수를 고른다(서버가 넣는다).
 * 받은 카드는 `addCard`를 지난다 — 보관함 장수는 풀에 빈자리가 있으면 그 자리에 든다.
 */
export function exchangeSurplus(profile: PlayerProfile, grade: SurplusGrade, seed: number): { profile: PlayerProfile; officer: OfficerId } {
  const check = canExchangeSurplus(profile, grade);
  if (!check.ok) rejectWith(check);
  const targets = surplusTargets(profile, grade).sort();
  const officer = shuffle({ seed, rngCursor: 0 }, targets)[0]!;
  const paid: PlayerProfile = { ...profile, surplusCards: surplusOf(profile) - surplusCost(grade) };
  return { profile: addCard(paid, officer), officer };
}
