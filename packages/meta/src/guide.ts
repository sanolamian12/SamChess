/**
 * 안내 내관 — 화면마다 처음 들어왔을 때 한 번 나와 설명하는 아바타 (pptx 113~116쪽 「UI update261022」, 2026-10-22)
 *
 * ```
 * 메인 첫 진입      main.intro   인사 · 도시 소개 · [사용 안내]로 다시 보기
 * 헌제를 거느림     emperor      황제 등극 축하 · 궁궐이 황궁이 된다 (2026-10-22 기획자)
 * 도시 Lv2·3·5·7·9  city.lvN     「축하 드립니다」 · 새로 쓸 수 있는 것
 * 산 너머 첫 건물    town.open    [마을로]를 눌러 보라
 * 산 너머 첫 입장    town.enter   [궁성으로] 돌아오는 길
 * ```
 *
 * - **본 것만 저장한다** — `PlayerProfile.guide`. 보상이 없고 건너뛰어 얻는 것도 없어 **클라이언트 소유**다
 *   (`farmGuards` · `marketCarry`와 같은 결, `SERVER_OWNED_FIELDS`에 안 넣는다). 기기를 바꿔도 다시 안 나오게 계정에 둔다.
 * - **무엇을 띄울지는 계산한다** — `pendingGuide()`. 도시 레벨이 오르는 길(증축 · 관리자 조정)마다 「안내를 켠다」를
 *   적으면 한 길이 빠졌을 때 조용히 안 나온다(튜토리얼 S급 해금과 같은 결).
 * - **대사는 여기 없다** — 화면의 문구 키(`guide.*`)다. 여기는 「언제 · 누가」만 정한다.
 *
 * 순수 함수다. 시계 · 난수를 들이지 않는다.
 */

import { hasEmperor } from './city.ts';
import type { PlayerProfile } from './types.ts';

/** 도시 레벨 안내가 나오는 레벨 — pptx 115 · 116쪽 */
export const CITY_GUIDE_LEVELS = [2, 3, 5, 7, 9] as const;
export type CityGuideLevel = typeof CITY_GUIDE_LEVELS[number];

export const GUIDE_IDS = [
  'main.intro',
  'emperor',
  ...CITY_GUIDE_LEVELS.map((lv) => `city.lv${lv}` as const),
  'town.open',
  'town.enter',
] as const;
export type GuideId = typeof GUIDE_IDS[number];

const KNOWN = new Set<string>(GUIDE_IDS);
export const isGuideId = (id: unknown): id is GuideId => typeof id === 'string' && KNOWN.has(id);

/** 본 안내 — 본 순서대로 */
export interface GuideProgress {
  seen: GuideId[];
}

export const guideSeen = (profile: PlayerProfile, id: GuideId): boolean =>
  profile.guide?.seen.includes(id) ?? false;

/**
 * 봤다고 적는다. 이미 봤으면 **같은 객체**를 돌려준다 — 화면이 「바뀌었으면 저장」으로 쓴다.
 *
 * 도시 레벨 안내는 **그 아래 레벨 것까지 함께 적는다** — Lv3에서 처음 이 기능을 만난 계정(또는 관리자가 레벨을
 * 올린 계정)이 Lv2 안내를 뒤늦게 받지 않게. 지난 레벨의 소식은 이미 지난 일이다.
 */
export function markGuideSeen(profile: PlayerProfile, id: GuideId): PlayerProfile {
  const ids: GuideId[] = [id];
  const lv = cityGuideLevelOf(id);
  if (lv !== null) for (const l of CITY_GUIDE_LEVELS) if (l < lv) ids.push(`city.lv${l}`);
  const fresh = ids.filter((g) => !guideSeen(profile, g));
  if (fresh.length === 0) return profile;
  return { ...profile, guide: { seen: [...(profile.guide?.seen ?? []), ...fresh] } };
}

const cityGuideLevelOf = (id: GuideId): CityGuideLevel | null => {
  const m = /^city\.lv(\d+)$/.exec(id);
  return m ? Number(m[1]) as CityGuideLevel : null;
};

/** 도시의 어느 쪽에 서 있나 — 성 안(`core`) · 산 너머(`ext`). `MainScreen`의 `CityView`와 같은 값 */
export type GuideView = 'core' | 'ext';

/**
 * **지금 띄울 안내 하나** — 없으면 `null`. 차례는 인사 → 황제 등극 → 도시 레벨 → 마을이다.
 *
 * - **황제 등극은 헌제 카드가 들어온 뒤 메인에 처음 올 때** — 카드를 얻는 길(가챠 · 보상 · 우편 · 관리자 지급)이
 *   어느 것이든 `hasEmperor()`(풀 + 보관함) 하나로 본다. 큰 일이라 밀린 레벨 안내보다 먼저다.
 *
 * - 도시 레벨 안내는 **지금 레벨 이하에서 가장 높은 것 하나**만 — 여럿이 밀려 있으면 위 것만 보이고
 *   `markGuideSeen()`이 아래 것을 함께 지운다.
 * - `extended` — 산 너머 건물이 하나라도 있나(`hasExtendedCity`, 화면 쪽 함수라 값으로 받는다).
 */
export function pendingGuide(profile: PlayerProfile, view: GuideView, extended: boolean): GuideId | null {
  if (view === 'ext') return guideSeen(profile, 'town.enter') ? null : 'town.enter';
  if (!guideSeen(profile, 'main.intro')) return 'main.intro';
  if (hasEmperor(profile) && !guideSeen(profile, 'emperor')) return 'emperor';
  const lv = [...CITY_GUIDE_LEVELS].reverse().find((l) => l <= profile.cityLevel);
  if (lv !== undefined && !guideSeen(profile, `city.lv${lv}`)) return `city.lv${lv}`;
  if (extended && !guideSeen(profile, 'town.open')) return 'town.open';
  return null;
}

/**
 * **내관 그림 · 호칭의 단** — 도시 레벨 둘씩 한 사람이다(pptx 116쪽, `assets/Backgrounds/Lv1-2.png` …).
 *
 * | 단 | 도시 | 호칭 |
 * |---|---|---|
 * | 1 | Lv1~2 | 주공 |
 * | 2 | Lv3~4 | 장군 |
 * | 3 | Lv5~6 | 대장군 |
 * | 4 | Lv7~8 | 승상 |
 * | 5 | Lv9~ | 전하 |
 *
 * 황제(Lv11)도 5단이다 — 그림이 다섯 장뿐이다. 호칭만은 헌제를 거느리면 **폐하**다(`honorOf`).
 */
export type StewardTier = 1 | 2 | 3 | 4 | 5;
export const stewardTier = (cityLevel: number): StewardTier =>
  Math.min(5, Math.max(1, Math.ceil(cityLevel / 2))) as StewardTier;

/** 저장된 값을 되접는다(`migrateProfile`). 모르는 id는 버리고 겹친 것은 하나로. 비면 `undefined` */
export function readGuide(raw: unknown): GuideProgress | undefined {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { seen?: unknown }).seen)) return undefined;
  const seen = [...new Set((raw as { seen: unknown[] }).seen.filter(isGuideId))];
  return seen.length > 0 ? { seen } : undefined;
}

/**
 * **호칭** — 그림의 단과 같이 가되, 헌제를 거느리면 도시 레벨과 상관없이 **폐하**다(2026-10-22 기획자 — 황제 등극).
 * 화면은 이 값을 문구 키(`guide.honor.{값}`)로 번역한다.
 */
export type GuideHonor = StewardTier | 'emperor';
export const guideHonor = (profile: PlayerProfile): GuideHonor =>
  hasEmperor(profile) ? 'emperor' : stewardTier(profile.cityLevel);
