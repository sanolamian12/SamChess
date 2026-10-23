/**
 * 안내 내관 — 화면마다 처음 들어왔을 때 한 번 나와 설명하는 아바타 (pptx 113~116쪽 「UI update261022」, 2026-10-22)
 *
 * ```
 * 메인 첫 진입      main.intro   인사 · 도시 소개 · [사용 안내]로 다시 보기
 * 헌제를 거느림     emperor      황제를 우리 도시에 모셨다 · 궁궐이 황궁이 된다 (2026-10-22, 10-23 고침)
 * 도시 Lv2·3·5·7·9  city.lvN     「축하 드립니다」 · 새로 쓸 수 있는 것
 * 산 너머 첫 건물    town.open    [마을로]를 눌러 보라
 * 산 너머 첫 입장    town.enter   [궁성으로] 돌아오는 길
 *
 * 1차 묶음 — 첫 판과 첫 레벨업까지의 길 (2026-10-22 기획자)
 * 병영 첫 진입       barracks.intro       [출정하기]가 잠겼다 · 튜토리얼부터
 * 기본 셋을 끝낸 병영 barracks.sortieOpen  출정 길이 열렸다 · 군량 · 부대 관리
 * 튜토리얼 목록      tutorial.list        기본 1 · 2 · 3 · S급 판
 * 부대 관리         squads.intro         3대3 · 5대5 · 한 장수 여러 부대 · 배치
 * 출정              sortie.intro         상대 찾기 · 참가비 · 30초 · 30초 · 20초
 * 첫 결과           result.first         보상 · 카드는 궁궐에서
 * 궁궐              palace.intro         장수 일람 · 도시 관리 · 레벨 상한
 * 장수 일람(레벨업)  officer.levelup      레벨업이 처음 켜졌을 때
 *
 * 동선 재설계 (2026-10-23 기획자) — 가벼운 곳부터 둘러보고 병영을 뒤로, 그 뒤 도시 키우기
 * 메인 — 다음 곳 가리키기  tour.market · tour.board · tour.barracks   (궁궐은 인사가 가리킨다)
 * 장터 · 대자보           market.intro · board.intro
 * 대자보 — 컬렉션을 채울 수 있게 됐다   board.collection
 * 메인 — 증축할 채비가 끝났다(처음 한 번)   city.ready
 * 궁궐 — 도시 Lv2 이후 첫 진입   palace.grow   (건축 · 증축 · 장수 레벨업)
 * 산 너머 건물 — 지은 것에 처음 들어갈 때   building.{academy · farm · hospital · forge}
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

import { buildingLevel, canUpgradeCity, hasEmperor } from './city.ts';
import { collectionRows } from './collection.ts';
import { canLevelUp } from './profile.ts';
import { basicsDone } from './tutorial.ts';
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
  'barracks.intro',
  'barracks.sortieOpen',
  'tutorial.list',
  'squads.intro',
  'sortie.intro',
  'result.first',
  'palace.intro',
  'officer.levelup',
  'tour.market',
  'tour.board',
  'tour.barracks',
  'market.intro',
  'board.intro',
  'board.collection',
  'city.ready',
  'palace.grow',
  'building.academy',
  'building.farm',
  'building.hospital',
  'building.forge',
] as const;
export type GuideId = typeof GUIDE_IDS[number];

/**
 * **안내가 서는 화면** — 다시 보기 목록이 이 단위로 묶인다(2026-10-22 기획자). 차례는 처음 하는 사람이 지나가는 길이다.
 */
export const GUIDE_SCREENS = [
  'main', 'palace', 'market', 'board', 'barracks', 'tutorial', 'squads', 'sortie', 'result', 'officers', 'building',
] as const;
export type GuideScreen = typeof GUIDE_SCREENS[number];

export const GUIDE_SCREEN_OF: Record<GuideId, GuideScreen> = {
  'main.intro': 'main', emperor: 'main',
  'city.lv2': 'main', 'city.lv3': 'main', 'city.lv5': 'main', 'city.lv7': 'main', 'city.lv9': 'main',
  'town.open': 'main', 'town.enter': 'main',
  'barracks.intro': 'barracks', 'barracks.sortieOpen': 'barracks',
  'tutorial.list': 'tutorial',
  'squads.intro': 'squads',
  'sortie.intro': 'sortie',
  'result.first': 'result',
  'palace.intro': 'palace',
  'officer.levelup': 'officers',
  'tour.market': 'main', 'tour.board': 'main', 'tour.barracks': 'main',
  'market.intro': 'market',
  'board.intro': 'board', 'board.collection': 'board',
  'city.ready': 'main',
  'palace.grow': 'palace',
  'building.academy': 'building', 'building.farm': 'building', 'building.hospital': 'building', 'building.forge': 'building',
};

/**
 * **둘러보기의 차례** (2026-10-23 기획자) — 도시 Lv1에서 덩치가 가장 큰 병영을 뒤로 미룬다.
 * 「다녀왔다」는 그곳의 첫 안내를 들었는가다 — 병영은 기본 셋 전이든 뒤든 그곳 안내 하나를 들었으면 다녀온 것이다.
 */
export const TOUR_STOPS = ['palace', 'market', 'board', 'barracks'] as const;
export type TourStop = typeof TOUR_STOPS[number];

const TOUR_VISITED: Record<TourStop, readonly GuideId[]> = {
  palace: ['palace.intro'],
  market: ['market.intro'],
  board: ['board.intro'],
  barracks: ['barracks.intro', 'barracks.sortieOpen'],
};

/**
 * **다음에 들를 곳** — 메인 인사를 듣기 전이거나 다 돌았으면 `null`. 차례를 어기고 먼저 가 본 곳은 건너뛴다.
 * 메인은 이곳 자리에 표지(`MainScreen`의 가리킴 아이콘)를 세우고, 처음 한 번 `tour.*`로 한 마디 한다.
 */
export function nextTourStop(profile: PlayerProfile): TourStop | null {
  if (!guideSeen(profile, 'main.intro')) return null;
  return TOUR_STOPS.find((stop) => !TOUR_VISITED[stop].some((id) => guideSeen(profile, id))) ?? null;
}

/** 산 너머 건물 넷 — `building.*` 안내의 꼬리. 데이터의 건물 id와 같다 */
export const GUIDE_BUILDINGS = ['academy', 'farm', 'hospital', 'forge'] as const;
export type GuideBuilding = typeof GUIDE_BUILDINGS[number];

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

/** 화면이 넘겨주는 사정 — 메인만 쓴다. `extended`는 산 너머 건물이 하나라도 있나(`hasExtendedCity`, 화면 쪽 함수라 값으로 받는다) */
export interface GuideContext {
  view?: GuideView;
  extended?: boolean;
  /** 산 너머 건물 화면 — 어느 건물인가 */
  building?: string;
}

/** 이 화면에서 아직 안 본 것 하나 */
const once = (profile: PlayerProfile, id: GuideId): GuideId | null => (guideSeen(profile, id) ? null : id);

/**
 * **이 화면에서 지금 띄울 안내 하나** — 없으면 `null`.
 *
 * - **병영**은 기본 튜토리얼 셋을 끝냈는지로 갈린다 — 끝냈으면 「출정 길이 열렸다」만 나온다(잠긴 이야기는 지난 일이다).
 * - **장수 일람**은 레벨업할 수 있는 장수가 처음 생겼을 때 — 레벨업이 없는 첫 방문에는 「궁궐」 안내가 이미 이 화면을 말했다.
 */
export function pendingGuide(profile: PlayerProfile, screen: GuideScreen, ctx: GuideContext = {}): GuideId | null {
  switch (screen) {
    case 'main': return pendingMainGuide(profile, ctx.view ?? 'core', ctx.extended ?? false);
    case 'barracks': return once(profile, basicsDone(profile) ? 'barracks.sortieOpen' : 'barracks.intro');
    case 'tutorial': return once(profile, 'tutorial.list');
    case 'market': return once(profile, 'market.intro');
    case 'board': {
      if (!guideSeen(profile, 'board.intro')) return 'board.intro';
      // 컬렉션은 도시 Lv1부터 열려 있다 — 지금 가진 것으로 빈칸 하나라도 채울 수 있게 됐을 때 다시 말한다
      if (guideSeen(profile, 'board.collection')) return null;
      return collectionRows(profile).some((r) => r.ready > 0) ? 'board.collection' : null;
    }
    case 'building': {
      const b = ctx.building;
      if (!b || !(GUIDE_BUILDINGS as readonly string[]).includes(b)) return null;
      // 안 지은 건물에 들어가면(「아직 열리지 않았다」) 안 나온다 — 강제 입장도 없다
      return buildingLevel(profile, b as GuideBuilding) > 0 ? once(profile, `building.${b as GuideBuilding}`) : null;
    }
    case 'squads': return once(profile, 'squads.intro');
    case 'sortie': return once(profile, 'sortie.intro');
    case 'result': return once(profile, 'result.first');
    case 'palace': {
      if (!guideSeen(profile, 'palace.intro')) return 'palace.intro';
      // 도시 Lv2부터 — 건축 · 증축 · 장수 레벨업. Lv1에서는 셋 다 못 한다
      return profile.cityLevel >= 2 ? once(profile, 'palace.grow') : null;
    }
    case 'officers': {
      if (guideSeen(profile, 'officer.levelup')) return null;
      const ready = Object.keys(profile.roster).some((id) => canLevelUp(profile, id as Parameters<typeof canLevelUp>[1]).ok);
      return ready ? 'officer.levelup' : null;
    }
  }
}

/**
 * **메인에서 지금 띄울 안내** — 차례는 인사 → 황제 등극 → 도시 레벨 → 마을이다.
 *
 * - **황제 등극은 헌제 카드가 들어온 뒤 메인에 처음 올 때** — 카드를 얻는 길(가챠 · 보상 · 우편 · 관리자 지급)이
 *   어느 것이든 `hasEmperor()`(풀 + 보관함) 하나로 본다. 큰 일이라 밀린 레벨 안내보다 먼저다.
 *
 * - 도시 레벨 안내는 **지금 레벨 이하에서 가장 높은 것 하나**만 — 여럿이 밀려 있으면 위 것만 보이고
 *   `markGuideSeen()`이 아래 것을 함께 지운다.
 * - `extended` — 산 너머 건물이 하나라도 있나(`hasExtendedCity`, 화면 쪽 함수라 값으로 받는다).
 */
function pendingMainGuide(profile: PlayerProfile, view: GuideView, extended: boolean): GuideId | null {
  if (view === 'ext') return guideSeen(profile, 'town.enter') ? null : 'town.enter';
  if (!guideSeen(profile, 'main.intro')) return 'main.intro';
  if (hasEmperor(profile) && !guideSeen(profile, 'emperor')) return 'emperor';
  const lv = [...CITY_GUIDE_LEVELS].reverse().find((l) => l <= profile.cityLevel);
  if (lv !== undefined && !guideSeen(profile, `city.lv${lv}`)) return `city.lv${lv}`;
  // 둘러보기 — 다음 곳을 한 마디로(처음 한 번). 궁궐은 인사의 마지막 마디가 이미 가리켰다
  const stop = nextTourStop(profile);
  if (stop && stop !== 'palace' && !guideSeen(profile, `tour.${stop}`)) return `tour.${stop}`;
  // 증축할 채비가 끝났다 — **처음 한 번만**(2026-10-23 기획자). 그 뒤의 증축은 궁궐의 `palace.grow`가 한 번 일러 둔다
  if (!guideSeen(profile, 'city.ready') && canUpgradeCity(profile).ok) return 'city.ready';
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
 * 황제(Lv11)도 5단이다 — 그림이 다섯 장뿐이다.
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
 * **호칭** — 그림의 단과 같이 간다(주공 · 장군 · 대장군 · 승상 · 전하). 화면은 이 값을 문구 키(`guide.honor.{값}`)로 번역한다.
 *
 * **헌제를 거느려도 군주는 폐하가 아니다** (2026-10-23 기획자) — 군주가 황제에 오르는 것이 아니라 **황제를 우리 도시에 모시는**
 * 것이다. 10-22에는 헌제가 들어오면 호칭 · 목소리를 폐하로 바꿨는데 걷었다.
 */
export type GuideHonor = StewardTier;
export const guideHonor = (profile: PlayerProfile): GuideHonor => stewardTier(profile.cityLevel);
