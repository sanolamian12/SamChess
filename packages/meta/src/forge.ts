/**
 * 대장간 — 병기 연구 (2026-11-28 기획자 확정, `history/2026-11-28d_대장간연구개편_2_연구.md`).
 *
 * ────────────────────────────────────────────────────────────────
 * 규칙 여섯
 * ────────────────────────────────────────────────────────────────
 *
 * | | |
 * |---|---|
 * | 단위 | **계정.** 연구한 병기는 장터 진열대에 영구히 오른다 — 사는 것 · 두는 것 · 들려 보내는 것은 장터 아이템과 같다(1회용) |
 * | 몫 | 대장간 Lv*L*에서 **병기 *L*개**를 한 번에 고른다 — 1 + 2 + 3 + 4 + 5 = 15, Lv5면 전부 (`forgeQuota`) |
 * | 후보 | 해금 레벨 ≤ *L*이고 아직 연구 안 한 것 — 아래 레벨에서 안 고른 것은 위 레벨에도 남는다 (`forgeCandidates`) |
 * | 차례 | **Lv1부터 차례로** — 레벨 *L*은 1~*L*−1을 끝내고 대장간 Lv ≥ *L*일 때(태학과 같은 결) |
 * | 진행 | **동시에 하나** · 실제 1시간 · 무료 · 취소 가능 · **되돌리기 없음** |
 * | 진열 | 끝나면 `notice`에 들고, 대장간의 축하 화면을 **본 뒤**(`POST /forge/ack`) 장터에 진열된다 (`forgeShelf`) |
 *
 * 옛 대장간(제조 · 자루 · 지급 · 종류당 피라미드)은 이 개편으로 걷었다. 옛 계정에 남은 자루는
 * `migrateProfile()`이 장터 보관함의 낱개로 옮긴다.
 *
 * 순수 함수다 — 시계는 `nowMs`로 받는다(「meta에 시계를 들이지 않는다」). 부르는 자리는 서버다 —
 * `forge`는 서버 소유 필드라(`SERVER_OWNED_FIELDS`) `PUT`으로 올리면 버려진다.
 */

import { EQUIPMENT, buildingById, equipmentById } from '@samchess/data';
import type { ItemData } from '@samchess/data';
import { buildingLevel } from './city.ts';
import { cityBonus, shortenMs } from './cityBonus.ts';
import type { ForgeState, MetaResult, PlayerProfile, ReasonParams } from './types.ts';
import { rejectWith } from './reject.ts';

/** 한 번 연구에 드는 실제 시간 — 태학과 같은 1시간(기획자 지정). 규칙 상수는 코드에 둔다 */
export const FORGE_RESEARCH_MINUTES = 60;
export const FORGE_RESEARCH_MS: number = FORGE_RESEARCH_MINUTES * 60_000;

/**
 * 이 계정이 `startedAt`에 시작한 연구가 걸리는 시간 — 컬렉션(`forge`, −n%)을 건다. 판정 시각은
 * **시작한 때**다(`cityBonus.ts`). 끝 시각을 묻는 자리(남은 시간 · 거두기 · `doneAt`)가 전부 이것을 지난다.
 */
export const forgeResearchMs = (profile: PlayerProfile, startedAt: number): number =>
  shortenMs(FORGE_RESEARCH_MS, cityBonus(profile, 'forge', startedAt));

/** 대장간의 최대 레벨 — 데이터가 정한다 */
export const FORGE_MAX_LEVEL: number = buildingById.get('forge')?.maxLevel ?? 5;

/** 대장간 레벨 Lv*L*에서 고르는 병기 수 — *L*개 (기획자 지정: 1 · 2 · 3 · 4 · 5 = 15 전부) */
export const forgeQuota = (level: number): number => Math.max(0, Math.min(level, FORGE_MAX_LEVEL));

/** 이 파일의 규칙이 낼 수 있는 이유 코드 — 화면 번역(`reason.{code}`)이 빠지면 테스트가 깨진다 */
export const FORGE_REASONS = [
  'forge.unknown', 'forge.notBuilt', 'forge.locked', 'forge.levelDone', 'forge.busy',
  'forge.count', 'forge.notCandidate', 'forge.idle', 'forge.ended',
] as const;

const EMPTY: ForgeState = { done: [] };

/** 계정의 연구 상태. **없으면 빈 상태** */
export const forgeOf = (profile: PlayerProfile): ForgeState => profile.forge ?? EMPTY;

/** 대장간 레벨. 안 지었으면 0 */
export const forgeLevel = (profile: PlayerProfile): number => buildingLevel(profile, 'forge');

/** 연구를 끝낸 병기 id 전부 — 축하를 아직 안 본 것까지 */
export function researchedWeapons(profile: PlayerProfile): Set<string> {
  return new Set(forgeOf(profile).done.flatMap((d) => d.items));
}

/**
 * **장터 진열대에 오른 병기** — 연구를 끝내고 축하 화면까지 본 것. 해금 레벨 · 진열 순서대로.
 * 장터 레벨과는 무관하다(기획자 확정 — 장터 레벨은 장터 자체 아이템만 막는다).
 */
export function forgeShelf(profile: PlayerProfile): ItemData[] {
  const f = forgeOf(profile);
  const unseen = new Set(f.notice ?? []);
  const done = new Set(f.done.flatMap((d) => d.items));
  return EQUIPMENT.filter((e) => done.has(e.id) && !unseen.has(e.id))
    .sort((a, b) => a.unlockLevel - b.unlockLevel || a.order - b.order);
}

/** 진열대에 올랐나 — 장터 구매 판정이 부른다 */
export const onForgeShelf = (profile: PlayerProfile, item: string): boolean =>
  forgeShelf(profile).some((e) => e.id === item);

/** 아직 안 끝낸 가장 낮은 레벨. 다 끝냈으면 `FORGE_MAX_LEVEL + 1` */
function firstUndone(f: ForgeState): number {
  let level = 1;
  while (level <= FORGE_MAX_LEVEL && f.done.some((d) => d.level === level)) level++;
  return level;
}

/**
 * 대장간 Lv`level`에서 고를 수 있는 병기 — 해금 레벨이 그 이하이고 **아직 연구 안 한 것**
 * (진행 중인 것도 뺀다). 해금 레벨 · 진열 순서대로.
 */
export function forgeCandidates(profile: PlayerProfile, level: number): ItemData[] {
  const f = forgeOf(profile);
  const taken = new Set([...f.done.flatMap((d) => d.items), ...(f.research?.items ?? [])]);
  return EQUIPMENT.filter((e) => e.unlockLevel <= level && !taken.has(e.id))
    .sort((a, b) => a.unlockLevel - b.unlockLevel || a.order - b.order);
}

/**
 * **[연구하기]가 열 레벨.**
 *
 * | `state` | 뜻 |
 * |---|---|
 * | `open` | 이 레벨의 몫을 고를 수 있다 |
 * | `researching` | 이 레벨을 연구 중이다 |
 * | `locked` | 앞은 다 끝냈는데 대장간이 이 레벨이 아니다 |
 * | `allDone` | 다섯 레벨을 다 끝냈다(병기 열다섯 전부) |
 * | `notBuilt` | 대장간이 없다 |
 */
export type ForgeNext =
  | { state: 'open' | 'locked'; level: number }
  | { state: 'researching'; level: number; items: string[] }
  | { state: 'allDone' | 'notBuilt' };

export function nextForgeResearch(profile: PlayerProfile): ForgeNext {
  const have = forgeLevel(profile);
  if (have < 1) return { state: 'notBuilt' };
  const f = forgeOf(profile);
  if (f.research) return { state: 'researching', level: f.research.level, items: [...f.research.items] };
  const level = firstUndone(f);
  if (level > FORGE_MAX_LEVEL) return { state: 'allDone' };
  return { state: level <= have ? 'open' : 'locked', level };
}

/** 진행 중인 연구의 남은 시간(ms). 끝났거나 없으면 0 */
export function forgeResearchRemainingMs(profile: PlayerProfile, nowMs: number): number {
  const r = forgeOf(profile).research;
  return r ? Math.max(0, r.startedAt + forgeResearchMs(profile, r.startedAt) - nowMs) : 0;
}

/**
 * 고른 병기들로 연구를 시작할 수 있나 — **그 레벨의 몫과 정확히 같은 수**, 겹침 없이, 전부 후보여야 한다.
 * 레벨은 고른 것에서 짐작하지 않고 `nextForgeResearch()`가 정한 레벨이다(화면이 다음 레벨 하나만 보여 준다).
 */
export function canStartForgeResearch(profile: PlayerProfile, items: readonly string[]): MetaResult {
  const have = forgeLevel(profile);
  if (have < 1) return no('대장간을 아직 짓지 않으셨습니다', 'notBuilt');
  const f = forgeOf(profile);
  if (f.research) return no('이미 다른 연구가 진행 중입니다', 'busy');
  const level = firstUndone(f);
  if (level > FORGE_MAX_LEVEL) return no('모든 병기의 연구를 마치셨습니다', 'levelDone', { level: FORGE_MAX_LEVEL });
  if (level > have) return no(`대장간 Lv${level}이 필요합니다 — 지금 Lv${have}`, 'locked', { need: level, have });
  for (const id of items) {
    if (!equipmentById.has(id)) return no(`알 수 없는 병기입니다 — ${id}`, 'unknown');
  }
  const quota = forgeQuota(level);
  if (new Set(items).size !== items.length || items.length !== quota) {
    return no(`대장간 Lv${level}에서는 병기 ${quota}개를 고르셔야 합니다`, 'count', { level, n: quota });
  }
  const open = new Set(forgeCandidates(profile, level).map((e) => e.id));
  const bad = items.find((id) => !open.has(id));
  if (bad) return no(`지금 고를 수 없는 병기입니다 — ${bad}`, 'notCandidate', { equipment: bad });
  return { ok: true };
}

/** 연구를 시작한다 — 시작 시각을 찍는다. 무료다. **부르는 자리는 서버다**(`POST /forge/research`) */
export function applyStartForgeResearch(profile: PlayerProfile, items: readonly string[], nowMs: number): PlayerProfile {
  const check = canStartForgeResearch(profile, items);
  if (!check.ok) rejectWith(check);
  const f = forgeOf(profile);
  // 진열 순서로 적는다 — 고른 순서는 뜻이 없고, 같은 고름이 늘 같은 값이어야 되접기 · 비교가 곧다
  const order = forgeCandidates(profile, firstUndone(f)).map((e) => e.id);
  const sorted = [...items].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return {
    ...profile,
    forge: { ...f, research: { level: firstUndone(f), items: sorted, startedAt: Math.floor(nowMs) } },
  };
}

export function canCancelForgeResearch(profile: PlayerProfile): MetaResult {
  return forgeOf(profile).research ? { ok: true } : no('진행 중인 연구가 없습니다', 'idle');
}

/**
 * 진행 중인 연구를 그만둔다 — **무료라 잃는 것이 없다**. 그 레벨은 다시 `open`이 되어 다른 병기를 고를 수 있다.
 * 이미 끝난 연구는 취소가 아니다(`syncCity()`가 먼저 거둔다 — 서버 경로는 `getProfile()`이 늘 먼저 정산한다).
 */
export function applyCancelForgeResearch(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const check = canCancelForgeResearch(profile);
  if (!check.ok) rejectWith(check);
  if (forgeResearchRemainingMs(profile, nowMs) <= 0) rejectWith({ reason: '이미 끝난 연구는 취소하실 수 없습니다', code: 'forge.ended' });
  const { research: _drop, ...rest } = forgeOf(profile);
  return { ...profile, forge: rest };
}

/**
 * 끝난 연구를 거둔다 — `done`으로 옮기고 `notice`에 넣는다. 아직이면 **같은 객체**를 돌려준다
 * (`syncCity()`의 「바뀐 게 없으면 같은 참조」 규약). **`syncCity()`가 이 함수를 부르는 하나의 자리다.**
 * `doneAt`은 정산 시각이 아니라 **시작 + 연구 시간**이다(태학과 같은 결).
 */
export function collectForgeResearch(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const f = profile.forge;
  const r = f?.research;
  if (!f || !r) return profile;
  const doneAt = r.startedAt + forgeResearchMs(profile, r.startedAt);
  if (doneAt > nowMs) return profile;
  const { research: _drop, ...rest } = f;
  return {
    ...profile,
    forge: {
      ...rest,
      done: [...f.done.filter((d) => d.level !== r.level), { level: r.level, items: [...r.items], doneAt }],
      notice: [...new Set([...(f.notice ?? []), ...r.items])],
    },
  };
}

/** 축하 화면을 봤다 — `notice`를 비운다. 그때부터 장터에 진열된다. 비어 있으면 같은 객체 */
export function applyAckForge(profile: PlayerProfile): PlayerProfile {
  const f = profile.forge;
  if (!f?.notice?.length) return profile;
  const { notice: _drop, ...rest } = f;
  return { ...profile, forge: rest };
}

const no = (reason: string, code: string, params?: ReasonParams): MetaResult =>
  ({ ok: false, reason, code: `forge.${code}`, ...(params ? { params } : {}) });
