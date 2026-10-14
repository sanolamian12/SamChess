/**
 * 컬렉션 도시 효과 — 판정하는 자리는 여기 하나다 (2026-10-15, `Design/컬렉션_기획.md` §3).
 *
 * 키 일곱(`grainRate` · `grainCap` · `forge` · `heal` · `research` · `raidLoot` · `raidResp`)의 값은
 * **완성한 컬렉션의 합**이다(계정마다 한 번씩만 완성되므로 합에 천장이 있다). 금화는 건드리지 않는다.
 *
 * ★ **판정 시각은 「그 일이 시작된 때」다** — 전투 효과가 판 시작 시각으로 판정하는 것과 같은 규약.
 * 제조 · 연구는 `startedAt`, 치료는 치료를 시작한 순간(장수에 `healMs`로 적힌다), 도적떼는 `spawnedAt`.
 * 그래야 진행 중인 일의 끝 시각이 **나중에 완성한 컬렉션 때문에 뒤늦게 바뀌지 않는다**.
 * 군량 충전만 「지금」이다 — 요율이 바뀌는 순간(완성)에 `applyRegisterSlot`이 먼저 정산하므로
 * 지난 구간에 새 요율이 소급되지 않는다.
 *
 * `city.ts` · `forge.ts` · `academy.ts` · `raid.ts`가 이 함수를 부르고, 서버도 같은 함수를 지난다.
 * 데이터와 타입만 안다 — 위 모듈들과 서로 물리지 않게 따로 뒀다.
 */

import { COLLECTIONS } from '@samchess/data';
import type { CollectionCityKey, CollectionData } from '@samchess/data';
import type { PlayerProfile } from './types.ts';

/** `atMs` 이전(같은 시각 포함)에 완성된 컬렉션 중 그 키의 도시 효과를 단 것 */
export function cityBonusSources(profile: PlayerProfile, key: CollectionCityKey, atMs = Infinity): CollectionData[] {
  const done = profile.collection?.completedAt;
  if (!done) return [];
  return COLLECTIONS.filter((c) => {
    const at = done[c.id];
    return at !== undefined && at <= atMs && c.effect.kind === 'city' && c.effect.key === key;
  });
}

/** 그 키의 합 — 완성한 것이 없으면 0 */
export const cityBonus = (profile: PlayerProfile, key: CollectionCityKey, atMs = Infinity): number =>
  cityBonusSources(profile, key, atMs).reduce((s, c) => s + (c.effect.kind === 'city' ? c.effect.value : 0), 0);

/** 「−n%」 키를 시간에 걸어 줄인다 — 정수 ms, 0 밑으로 안 간다 */
export const shortenMs = (baseMs: number, pct: number): number =>
  Math.max(0, Math.round((baseMs * (100 - pct)) / 100));
