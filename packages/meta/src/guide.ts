/**
 * 안내 내관 — 화면마다 처음 들어왔을 때 한 번 나와 설명하는 아바타 (pptx 113~116쪽 「UI update261022」, 2026-10-22)
 *
 * ```
 * 메인 첫 진입      main.intro   인사 · 도시 소개 · [사용 안내]로 다시 보기
 * 헌제를 거느림     emperor      황제를 우리 도시에 모셨다 · 궁궐이 황궁이 된다 (2026-10-22, 10-23 고침)
 * 260명을 거느림    roster.all   팬 장수 신청 안내 — 앞선 100명(`fanOfficerEligible`) (2026-11-12)
 *                  roster.late  101번째부터 — 축하만, 신청 자리는 이미 찼다
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
 *
 * 첫 증축의 길 (2026-11-13 기획자) — 말은 한 번, **표지는 그 일을 할 때까지** (`growthCue`)
 * 궁궐 — 증축할 채비가 됐다   palace.upgrade    [도시 관리]를 누르라
 * 도시 관리 — 그다음         city.build        [건물 관리]를 누르라 (증축 전이든 뒤든 — [도시 증축]이 건물 관리에 있다)
 * 건물 관리 — 증축 전        city.upgrade      [도시 증축]을 누르라
 * 건물 관리 — 증축 뒤 처음   buildings.intro   건설 기회 · [짓기] · [증축] · 기회를 다 써야 도시를 올린다
 *
 * 첫 편성 (2026-11-13 기획자) — 3인팀(3v3)이 아직 없는 동안, 병영의 무관이 한 걸음씩 (`squadCue`가 표지를 정한다)
 * 새 편성 — 이름이 비었다      squadNew.intro     3인팀 · 5인팀 · 3인팀부터 · 이름을 적어라
 * 새 편성 — 이름을 적었다      squadNew.mode      [3 vs 3] → [다음]
 * 부대원 — King · Rock · Queen   squadEdit.king · squadEdit.rock · squadEdit.queen   차례로 [선택] (Queen은 기물을 바꿀 수 있다)
 * 부대원 — 다 찼다            squadEdit.deploy   [부대 배치]
 * 배치 — King이 가운데가 아니다 squadDeploy.swap   기물을 누르면 옮길 칸이 보인다 · King과 Rock의 자리를 바꾼다(단검이 누를 곳을 가리킨다)
 * 배치 — 처음 기물을 집었다    squadDeploy.pick   노란 칸이 설 수 있는 자리 · 단검이 가리키는 칸을 누르라
 * 배치 — 바꿨다              squadDeploy.range  King을 두 번 눌러 움직일 수 있는 칸을 보라 (2026-11-13 기획자 — 판 아래 안내 1 · 2줄을 한 걸음씩)
 * 배치 — 두 번 눌러 봤다       squadDeploy.done   움직일 칸 · 가상의 상대 · 군량고(3 · 4줄은 판에 표시만) · [편성 완료]
 * 부대 현황 — 3인팀이 생겼다    squadView.garrison 첫 부대가 수비군이다 · [수비군 설정]으로
 *
 * 수비군 설정 미션 (2026-11-13 기획자) — 3인팀 수비군의 방침을 아직 한 번도 저장하지 않았다(`garrisonMissionPending`)
 * 수비군 설정 — 처음            garrison.intro     첫 기물의 행동 단추를 눌러 바꿔 보라
 * 수비군 설정 — 하나 바꿨다      garrison.save      책략 · 고유기술 탭 · 보이지 않는다 · [저장]
 * 수비군 설정 — 저장했다        garrison.done      준비 끝 · 5인팀은 직접 해 보라 (이것을 들으면 미션이 닫힌다)
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

import { BUILD_ACTIONS_PER_UPGRADE, BUILD_CITY_LEVEL, buildCreditsLeft, buildingLevel, canUpgradeCity, hasEmperor } from './city.ts';
import { collectionRows } from './collection.ts';
import { allOfficersMilestone, fanOfficerEligible } from './milestone.ts';
import { canLevelUp } from './profile.ts';
import { garrisonOf } from './garrison.ts';
import { squadsOf } from './squads.ts';
import { basicsDone } from './tutorial.ts';
import type { PlayerProfile } from './types.ts';

/** 도시 레벨 안내가 나오는 레벨 — pptx 115 · 116쪽 */
export const CITY_GUIDE_LEVELS = [2, 3, 5, 7, 9] as const;
export type CityGuideLevel = typeof CITY_GUIDE_LEVELS[number];

export const GUIDE_IDS = [
  'main.intro',
  'emperor',
  'roster.all',
  'roster.late',
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
  'city.build',
  'buildings.intro',
  'palace.upgrade',
  'city.upgrade',
  'squadNew.intro',
  'squadNew.mode',
  'squadEdit.king',
  'squadEdit.rock',
  'squadEdit.queen',
  'squadEdit.deploy',
  'squadDeploy.swap',
  'squadDeploy.pick',
  'squadDeploy.range',
  'squadDeploy.done',
  'squadView.garrison',
  'garrison.intro',
  'garrison.save',
  'garrison.done',
] as const;
export type GuideId = typeof GUIDE_IDS[number];

/**
 * **안내가 서는 화면** — 다시 보기 목록이 이 단위로 묶인다(2026-10-22 기획자). 차례는 처음 하는 사람이 지나가는 길이다.
 */
export const GUIDE_SCREENS = [
  'main', 'palace', 'market', 'board', 'barracks', 'tutorial', 'squads', 'squadNew', 'squadEdit', 'squadDeploy', 'squadView', 'garrison', 'sortie', 'result',
  'officers', 'city', 'buildings', 'building',
] as const;
export type GuideScreen = typeof GUIDE_SCREENS[number];

export const GUIDE_SCREEN_OF: Record<GuideId, GuideScreen> = {
  'main.intro': 'main', emperor: 'main', 'roster.all': 'main', 'roster.late': 'main',
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
  'city.build': 'city', 'buildings.intro': 'buildings', 'palace.upgrade': 'palace', 'city.upgrade': 'buildings',
  'squadNew.intro': 'squadNew', 'squadNew.mode': 'squadNew',
  'squadEdit.king': 'squadEdit', 'squadEdit.rock': 'squadEdit', 'squadEdit.queen': 'squadEdit', 'squadEdit.deploy': 'squadEdit',
  'squadDeploy.swap': 'squadDeploy', 'squadDeploy.pick': 'squadDeploy', 'squadDeploy.range': 'squadDeploy', 'squadDeploy.done': 'squadDeploy', 'squadView.garrison': 'squadView',
  'garrison.intro': 'garrison', 'garrison.save': 'garrison', 'garrison.done': 'garrison',
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
  /**
   * 첫 편성의 화면 사정 (2026-11-13) — 계정에 없는, 화면만 아는 값.
   * `squad` — 지금 만드는 것이 새 3인팀인가(새 편성 화면은 언제나 참). `named` — 이름이 규칙을 통과했나(새 편성).
   * `filled` — 앞에서부터 장수가 찬 줄 수(부대원). `swapped` — King이 가운데 · Rock이 왼쪽에 섰나(배치)
   * `held` — 우리 기물을 집고 있나 · `ranged` — 바꾼 뒤 King을 두 번 눌러 움직일 칸을 봤나(배치)
   */
  squad?: boolean;
  named?: boolean;
  filled?: number;
  swapped?: boolean;
  held?: boolean;
  ranged?: boolean;
  /** 수비군 설정 — 손댄 칸이 있나 · 방금 저장했나 */
  dirty?: boolean;
  saved?: boolean;
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
      // 첫 증축의 길 (2026-11-13) — 증축할 채비가 됐으면 [도시 관리]를 누르라고 한 번
      if (growthCue(profile) === 'upgrade') return once(profile, 'palace.upgrade');
      // 도시 Lv2부터 — 건축 · 증축 · 장수 레벨업. Lv1에서는 셋 다 못 한다
      return profile.cityLevel >= 2 ? once(profile, 'palace.grow') : null;
    }
    // 첫 증축의 길 (2026-11-13) — 도시 관리는 첫 증축 직후(아직 한 번도 안 지었다), 건물 관리는 처음 들어왔을 때(지을 수 있는 레벨)
    // [도시 증축]은 건물 관리 바닥에 있다(2026-11-13 — 도시 관리에서 옮겼다). 도시 관리는 증축 전이든 뒤든 [건물 관리]로 보낸다
    case 'city': return growthCue(profile) ? once(profile, 'city.build') : null;
    case 'buildings': {
      if (growthCue(profile) === 'upgrade') return once(profile, 'city.upgrade');
      return profile.cityLevel >= BUILD_CITY_LEVEL ? once(profile, 'buildings.intro') : null;
    }
    // 첫 편성 (2026-11-13) — 3인팀이 아직 없을 때만, 화면이 넘겨준 사정(`ctx`)으로 걸음을 고른다
    case 'squadNew':
      if (!firstSquadPending(profile)) return null;
      return once(profile, ctx.named ? 'squadNew.mode' : 'squadNew.intro');
    case 'squadEdit': {
      if (!firstSquadPending(profile) || !ctx.squad) return null;
      const filled = ctx.filled ?? 0;
      const step: GuideId = filled >= 3 ? 'squadEdit.deploy' : (['squadEdit.king', 'squadEdit.rock', 'squadEdit.queen'] as const)[filled]!;
      return once(profile, step);
    }
    case 'squadDeploy':
      if (!firstSquadPending(profile) || !ctx.squad) return null;
      // 판 아래 안내 1줄(누르면 옮길 칸)은 바꾸기로, 2줄(두 번 누르면 움직일 칸)은 바꾼 뒤 King으로 해 본다 — 3 · 4줄은 끝 마디가 판에 가리키며 말한다
      if (!ctx.swapped) return once(profile, 'squadDeploy.swap') ?? (ctx.held ? once(profile, 'squadDeploy.pick') : null);
      return once(profile, ctx.ranged ? 'squadDeploy.done' : 'squadDeploy.range');
    // 첫 3인팀 직후 — 그 부대(3인팀 수비군)의 현황에서 수비군 설정으로 (2026-11-13). `ctx.squad` — 지금 보는 부대가 3인팀 수비군인가
    case 'squadView':
      return ctx.squad && garrisonMissionPending(profile) ? once(profile, 'squadView.garrison') : null;
    // 수비군 설정 미션 — 바꿨나(`dirty`) · 저장했나(`saved`)로 걸음을 고른다. 끝 마디(`garrison.done`)를 들으면 닫힌다
    case 'garrison':
      if (!ctx.squad || guideSeen(profile, 'garrison.done')) return null;
      if (ctx.saved) return 'garrison.done';
      if (!garrisonMissionPending(profile)) return null;
      return once(profile, ctx.dirty ? 'garrison.save' : 'garrison.intro');
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
  // 260명을 거느림 — **순번을 받은 뒤에만**(서버가 적는다). 둘 중 하나만 나온다
  if (allOfficersMilestone(profile)?.seat !== undefined && !guideSeen(profile, 'roster.all') && !guideSeen(profile, 'roster.late')) {
    return fanOfficerEligible(profile) ? 'roster.all' : 'roster.late';
  }
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
 * **첫 증축의 길에서 지금 가리킬 일** (2026-11-13 기획자) — 말(`city.ready` · `city.build` · `buildings.intro`)은 한 번이지만,
 * 표지(메인 궁궐 자리의 가리킴 · 명령 판 단추의 네온)는 **그 일을 할 때까지** 남는다. 화면들이 이 함수 하나를 읽는다 —
 * 메인은 궁궐 자리, 궁궐은 [도시 관리], 도시 관리는 `upgrade`면 [도시 증축] · `build`면 [건물 관리], 건물 관리는 지을 수 있는 줄.
 *
 * | 값 | 언제 | 끝나는 때 |
 * |---|---|---|
 * | `upgrade` | 도시 Lv1이고 첫 증축 조건이 다 찼다 | 증축하면(Lv2) |
 * | `build` | 첫 증축 레벨(`BUILD_CITY_LEVEL`)이고 건설 기회를 하나도 안 썼다 | 하나라도 지으면 |
 *
 * 저장하지 않는다 — 계정에서 낸다(`pendingGuide`와 같은 결). 안내를 끈 사람에게는 화면이 안 그린다(`guidesEnabled`).
 */
export type GrowthCue = 'upgrade' | 'build';

/**
 * **첫 편성의 길이 열려 있나** (2026-11-13 기획자) — 3인팀(3v3)이 하나도 없다. 부대 관리의 [새 편성] · 새 편성의 이름 칸 · [3 vs 3] · [다음] ·
 * 부대원의 [선택] · [부대 배치] · 배치의 미션 칸 · [편성 완료]가 이것이 참인 동안 빛난다(화면이 지금 걸음을 고른다). 3인팀을 저장하면 닫힌다.
 */
export const firstSquadPending = (profile: PlayerProfile): boolean => squadsOf(profile, '3v3').length === 0;

/**
 * **수비군 설정 미션이 열려 있나** (2026-11-13 기획자) — 3인팀 수비군이 있고, 그 방침을 아직 한 번도 저장하지 않았고(`Squad.policy`가 없다),
 * 미션의 끝 마디(`garrison.done`)를 듣지 않았다. 부대 현황의 [수비군 설정] · 수비군 설정의 첫 기물 행동 단추 · [저장]이 이것이 참인 동안 빛난다.
 */
export function garrisonMissionPending(profile: PlayerProfile): boolean {
  if (guideSeen(profile, 'garrison.done')) return false;
  const sq = garrisonOf(profile, '3v3');
  return !!sq && sq.policy === undefined;
}
export function growthCue(profile: PlayerProfile): GrowthCue | null {
  if (profile.cityLevel < BUILD_CITY_LEVEL) return canUpgradeCity(profile).ok ? 'upgrade' : null;
  if (profile.cityLevel === BUILD_CITY_LEVEL && buildCreditsLeft(profile) === BUILD_ACTIONS_PER_UPGRADE) return 'build';
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

// ── 지난 설명의 분류 — 3단 (2026-10-23 기획자) ─────────────────────────────
//
// ```
// 1단  메인 화면 · 궁궐 · 병영 · 장터 · 대자보 · 태학 · 농지 · 병원 · 대장간   ← 안내가 서는 곳
// 2단  메인 화면만 — 첫 인사 · 둘러보기 · 증축 · 진급 셋 · 마을 · 황제 · 천하의 장수   ← 9종(색은 8가지라 하나를 함께 쓴다)
// 3단  안내 하나하나
// ```
//
// 건물은 1단 → 3단이다. 병영은 그 안에서 열리는 화면(튜토리얼 · 부대 · 출정 · 첫 결과)까지, 궁궐은 장수 일람까지 품는다.
// 표가 `Record<GuideId, …>`라 안내를 더하면서 분류를 빠뜨리면 타입 검사가 깨진다.

export const GUIDE_CHAPTERS = ['main', 'palace', 'barracks', 'market', 'board', 'academy', 'farm', 'hospital', 'forge'] as const;
export type GuideChapter = typeof GUIDE_CHAPTERS[number];

/** 메인 화면의 2단 — 9종(2026-11-12에 「천하의 장수」를 더했다). 진급은 도시 레벨 안내 다섯을 셋으로 가른다(Lv2·3 / Lv5·7 / Lv9) */
export const GUIDE_MAIN_TOPICS = ['intro', 'tour', 'ready', 'rank1', 'rank2', 'rank3', 'town', 'emperor', 'roster'] as const;
export type GuideMainTopic = typeof GUIDE_MAIN_TOPICS[number];

export type GuidePlace = { chapter: 'main'; topic: GuideMainTopic } | { chapter: Exclude<GuideChapter, 'main'> };

export const GUIDE_PLACE: Record<GuideId, GuidePlace> = {
  'main.intro': { chapter: 'main', topic: 'intro' },
  'tour.market': { chapter: 'main', topic: 'tour' },
  'tour.board': { chapter: 'main', topic: 'tour' },
  'tour.barracks': { chapter: 'main', topic: 'tour' },
  'city.ready': { chapter: 'main', topic: 'ready' },
  'city.lv2': { chapter: 'main', topic: 'rank1' },
  'city.lv3': { chapter: 'main', topic: 'rank1' },
  'city.lv5': { chapter: 'main', topic: 'rank2' },
  'city.lv7': { chapter: 'main', topic: 'rank2' },
  'city.lv9': { chapter: 'main', topic: 'rank3' },
  'town.open': { chapter: 'main', topic: 'town' },
  'town.enter': { chapter: 'main', topic: 'town' },
  emperor: { chapter: 'main', topic: 'emperor' },
  'roster.all': { chapter: 'main', topic: 'roster' },
  'roster.late': { chapter: 'main', topic: 'roster' },
  'palace.intro': { chapter: 'palace' },
  'palace.grow': { chapter: 'palace' },
  'officer.levelup': { chapter: 'palace' },
  'barracks.intro': { chapter: 'barracks' },
  'barracks.sortieOpen': { chapter: 'barracks' },
  'tutorial.list': { chapter: 'barracks' },
  'squads.intro': { chapter: 'barracks' },
  'sortie.intro': { chapter: 'barracks' },
  'result.first': { chapter: 'barracks' },
  'market.intro': { chapter: 'market' },
  'board.intro': { chapter: 'board' },
  'board.collection': { chapter: 'board' },
  'building.academy': { chapter: 'academy' },
  'building.farm': { chapter: 'farm' },
  'building.hospital': { chapter: 'hospital' },
  'building.forge': { chapter: 'forge' },
  'city.build': { chapter: 'palace' },
  'buildings.intro': { chapter: 'palace' },
  'palace.upgrade': { chapter: 'palace' },
  'city.upgrade': { chapter: 'palace' },
  'squadNew.intro': { chapter: 'barracks' }, 'squadNew.mode': { chapter: 'barracks' },
  'squadEdit.king': { chapter: 'barracks' }, 'squadEdit.rock': { chapter: 'barracks' }, 'squadEdit.queen': { chapter: 'barracks' },
  'squadEdit.deploy': { chapter: 'barracks' }, 'squadDeploy.swap': { chapter: 'barracks' },
  'squadDeploy.pick': { chapter: 'barracks' }, 'squadDeploy.range': { chapter: 'barracks' }, 'squadDeploy.done': { chapter: 'barracks' },
  'squadView.garrison': { chapter: 'barracks' },
  'garrison.intro': { chapter: 'barracks' }, 'garrison.save': { chapter: 'barracks' }, 'garrison.done': { chapter: 'barracks' },
};

/** 지난 설명 목록 한 칸 — 1단(과 메인이면 2단)의 들은 안내. 비어 있는 칸은 안 낸다 */
export interface GuideShelf {
  chapter: GuideChapter;
  /** 메인 화면만 — 2단마다 들은 안내 */
  topics: { topic: GuideMainTopic; ids: GuideId[] }[];
  /** 메인이 아니면 그 칸의 들은 안내. 메인이면 `topics`를 이은 것 */
  ids: GuideId[];
}

/**
 * **들은 것만** 3단으로 묶는다 — 차례는 1단 · 2단 표의 차례, 안은 대본 차례(`GUIDE_IDS`).
 * 본 순서로 늘어놓으면 함께 지나간 아래 레벨 안내(`markGuideSeen`)가 위 레벨 뒤에 붙는다.
 */
export function guideShelves(profile: PlayerProfile): GuideShelf[] {
  const seen = GUIDE_IDS.filter((id) => guideSeen(profile, id));
  return GUIDE_CHAPTERS.map((chapter): GuideShelf => {
    const ids = seen.filter((id) => GUIDE_PLACE[id].chapter === chapter);
    const topics = chapter !== 'main' ? [] : GUIDE_MAIN_TOPICS
      .map((topic) => ({ topic, ids: ids.filter((id) => { const p = GUIDE_PLACE[id]; return p.chapter === 'main' && p.topic === topic; }) }))
      .filter((g) => g.ids.length > 0);
    return { chapter, topics, ids: chapter === 'main' ? topics.flatMap((g) => g.ids) : ids };
  }).filter((s) => s.ids.length > 0);
}
