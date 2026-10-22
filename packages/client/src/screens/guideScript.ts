/**
 * 안내 내관의 대본 — 안내 하나가 몇 마디이고 마디마다 무엇을 가리키는가 (2026-10-22, pptx 113~116쪽)
 *
 * 「언제 · 누가」는 `@samchess/meta`의 `guide.ts`(`pendingGuide` · `stewardTier`)가 정하고, 여기는 **말**만 정한다.
 * 대본 설계(무엇을 어느 화면에서 얼마나)는 `Design/내관_안내_대본.md`다 — 안내를 늘리면 그 표와 이 파일을 함께 고친다.
 *
 * - **한 마디는 말풍선 한 장이다** — 세 줄을 넘기지 않는다(두루마리 한 장에 들어가는 양, 처음 하는 사람이 읽다 지치지 않는 양).
 * - `spot`은 그 마디 동안 화면에서 반짝이는 자리다 — `SPOT_SELECTOR`가 고른 요소에 `data-guide-glow`가 붙는다
 *   (`Steward.tsx`, `style.css`의 「안내 내관」 절). 말로 「화면 상단의 아이콘」이라고 하면 어느 것인지 모른다 — 가리키는 것이 말보다 빠르다.
 *   **화면은 이 자리를 따로 모른다** — 이미 있는 `data-*`(스모크가 거는 것과 같은 표지)로 고른다.
 */

import { BUILD_ACTIONS_PER_UPGRADE, GUIDE_BUILDINGS, HEAL_MS, MAX_CITY_LEVEL, buildingLevel, guideHonor, officerLevelCap } from '@samchess/meta';
import { CONTROL_MS, DEPLOY_MS, SCOUT_MS } from '@samchess/rules';
import type { GuideHonor, GuideId, GuideScreen, PlayerProfile } from '@samchess/meta';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';

/** 마디 동안 반짝이는 자리 → 그 요소를 고르는 선택자(프레임 안) */
export const SPOT_SELECTOR = {
  // 메인
  info: '.head-tool[data-action="info"]',
  gate: '.city-gate .city-arrow',
  palace: '.city-hot[data-place="palace"]',
  barracks: '.city-hot[data-place="barracks"]',
  // 병영 · 궁궐(`PlaceScreen`) — 튜토리얼 목록의 단추도 `data-action="tutorial"`이라 `data-tutorial`이 없는 것만
  tutorialDoor: '[data-action="tutorial"]:not([data-tutorial])',
  sortieDoor: '[data-action="sortie"]',
  squadsDoor: '[data-action="squads"]',
  grain: '[data-field="grain"]',
  officersDoor: '[data-action="officers"]',
  cityDoor: '[data-action="city"]',
  // 튜토리얼 목록
  basic1: '[data-tutorial="basic-1"]',
  sTutorial: '[data-tutorial^="s-"]',
  // 부대 관리 · 출정 · 결과 · 장수 일람
  squadNew: '[data-action="new"]',
  pickMode: '[data-field="pickMode"]',
  rewards: '[data-field="rewards"]',
  levelSeal: '.ofc-levelup-seal',
  // 둘러보기(2026-10-23) — 메인의 자리 네모 · 장터 홈 · 대자보
  marketHot: '.city-hot[data-place="market"]',
  boardHot: '.city-hot[data-place="ranking"]',
  shopDoor: '[data-action="openShop"]',
  rankingDoor: '[data-action="ranking"]',
  collectionDoor: '[data-action="collection"]',
  // 산 너머 — 지은 건물(선택자는 마디가 `select`로 싣는다)
  built: '',
} as const;
export type GuideSpot = keyof typeof SPOT_SELECTOR;

export interface GuideLine {
  text: string;
  spot?: GuideSpot;
  /** 계정에 따라 달라지는 자리 — 있으면 `SPOT_SELECTOR[spot]` 대신 이것으로 고른다(산 너머의 지은 건물) */
  select?: string;
}

const honorOf = (honor: GuideHonor): string => t(`guide.honor.${honor}` as StringKey);

/** 안내 하나의 마디들 — 계정 값(호칭 · 도시 이름 · 레벨 상한)을 넣어 지금 언어로 만든다 */
export function guideLines(id: GuideId, profile: PlayerProfile): GuideLine[] {
  const honor = honorOf(guideHonor(profile));
  switch (id) {
    case 'main.intro':
      return [
        { text: t('guide.main.intro.1', { honor }) },
        { text: t('guide.main.intro.2', { city: profile.cityName }) },
        { text: t('guide.main.intro.3'), spot: 'info' },
        // 둘러보기의 첫 곳 — 가벼운 곳(궁궐 · 장터 · 대자보)부터, 병영은 마지막 (2026-10-23 기획자)
        { text: t('guide.main.intro.4'), spot: 'palace' },
      ];
    // 헌제가 들어온 뒤 메인에 처음 올 때 — 궁궐이 황궁이 되고 도시 상한이 하나 오른다 (GDD §5.5)
    case 'emperor':
      return [
        { text: t('guide.emperor.1', { honor }) },
        { text: t('guide.emperor.2'), spot: 'palace' },
        { text: t('guide.emperor.3', { lv: MAX_CITY_LEVEL }), spot: 'palace' },
      ];
    // 건축 · 증축 · 장수 레벨업은 궁궐(`palace.grow`)이 말한다 — 메인은 「궁궐로」만 (2026-10-23)
    case 'city.lv2':
      return [
        { text: t('guide.city.congrats', { honor }) },
        { text: t('guide.city.lv2.palace'), spot: 'palace' },
      ];
    case 'city.lv3':
    case 'city.lv5':
    case 'city.lv7':
    case 'city.lv9': {
      const lv = Number(id.slice('city.lv'.length));
      const lines: GuideLine[] = [
        { text: t('guide.city.congrats', { honor }) },
        // 이 레벨들은 호칭이 **바뀌는** 자리다(도시 둘씩 한 단) — 군주가 진급했다는 소식이다 (2026-10-22 기획자)
        { text: t(`guide.city.promote.${lv}` as StringKey) },
        { text: t('guide.city.grow', { lv: officerLevelCap(profile), n: BUILD_ACTIONS_PER_UPGRADE }), spot: 'palace' },
      ];
      if (id === 'city.lv9') lines.push({ text: t('guide.city.lv9.emperor') });
      return lines;
    }
    case 'town.open':
      return [{ text: t('guide.town.open.1'), spot: 'gate' }];
    case 'town.enter': {
      // 지은 건물만 이어 적고 그 자리를 빛낸다. 하나도 없을 수는 없다(산 너머는 지어야 열린다)
      const built = GUIDE_BUILDINGS.filter((b) => buildingLevel(profile, b) > 0);
      const lines: GuideLine[] = [];
      if (built.length > 0) {
        lines.push({
          text: t('guide.town.enter.list', { list: built.map((b) => t(`place.${b}` as StringKey)).join(' · ') }),
          spot: 'built',
          select: built.map((b) => `.city-hot[data-place="${b}"]`).join(', '),
        });
      }
      lines.push({ text: t('guide.town.enter.1'), spot: 'gate' });
      return lines;
    }
    case 'tour.market':
      return [{ text: t('guide.tour.market'), spot: 'marketHot' }];
    case 'tour.board':
      return [{ text: t('guide.tour.board'), spot: 'boardHot' }];
    case 'tour.barracks':
      return [{ text: t('guide.tour.barracks'), spot: 'barracks' }];
    case 'market.intro':
      return [
        { text: t('guide.market.intro.1'), spot: 'shopDoor' },
        { text: t('guide.market.intro.2'), spot: 'shopDoor' },
      ];
    case 'board.intro':
      return [
        { text: t('guide.board.intro.1'), spot: 'rankingDoor' },
        { text: t('guide.board.intro.2'), spot: 'collectionDoor' },
      ];
    case 'board.collection':
      return [
        { text: t('guide.board.collection.1', { honor }), spot: 'collectionDoor' },
        { text: t('guide.board.collection.2') },
      ];
    case 'city.ready':
      return [
        { text: t('guide.city.ready.1', { honor }) },
        { text: t('guide.city.ready.2'), spot: 'palace' },
      ];
    case 'palace.grow':
      return [
        { text: t('guide.palace.grow.1', { n: BUILD_ACTIONS_PER_UPGRADE }), spot: 'cityDoor' },
        { text: t('guide.palace.grow.2'), spot: 'cityDoor' },
        { text: t('guide.palace.grow.3', { lv: officerLevelCap(profile) }), spot: 'officersDoor' },
        { text: t('guide.palace.grow.4') },
      ];
    case 'building.academy':
      return [{ text: t('guide.building.academy.1') }, { text: t('guide.building.academy.2') }];
    case 'building.farm':
      return [{ text: t('guide.building.farm.1') }, { text: t('guide.building.farm.2') }];
    case 'building.hospital':
      return [{ text: t('guide.building.hospital.1') }, { text: t('guide.building.hospital.2', { n: HEAL_MS / 60_000 }) }];
    case 'building.forge':
      return [{ text: t('guide.building.forge.1') }, { text: t('guide.building.forge.2') }];

    // ── 1차 묶음 — 첫 판과 첫 레벨업까지 (2026-10-22 기획자) ──
    case 'barracks.intro':
      return [
        { text: t('guide.barracks.intro.1') },
        { text: t('guide.barracks.intro.2'), spot: 'tutorialDoor' },
      ];
    case 'barracks.sortieOpen':
      return [
        { text: t('guide.barracks.sortieOpen.1', { honor }), spot: 'sortieDoor' },
        { text: t('guide.barracks.sortieOpen.2') },
        { text: t('guide.barracks.sortieOpen.3'), spot: 'grain' },
        { text: t('guide.barracks.sortieOpen.4'), spot: 'squadsDoor' },
      ];
    case 'tutorial.list':
      return [
        { text: t('guide.tutorial.list.1'), spot: 'basic1' },
        { text: t('guide.tutorial.list.2'), spot: 'sTutorial' },
      ];
    case 'squads.intro':
      return [
        { text: t('guide.squads.intro.1'), spot: 'squadNew' },
        { text: t('guide.squads.intro.2') },
        { text: t('guide.squads.intro.3') },
      ];
    case 'sortie.intro':
      return [
        { text: t('guide.sortie.intro.1'), spot: 'pickMode' },
        // 시간은 대본에 적지 않는다 — 판을 재는 클라 · 서버가 같이 읽는 `timing.ts`에서
        { text: t('guide.sortie.intro.2', { deploy: DEPLOY_MS / 1000, scout: SCOUT_MS / 1000, control: CONTROL_MS / 1000 }) },
      ];
    case 'result.first':
      return [
        { text: t('guide.result.first.1', { honor }), spot: 'rewards' },
        { text: t('guide.result.first.2') },
      ];
    case 'palace.intro':
      return [
        { text: t('guide.palace.intro.1'), spot: 'officersDoor' },
        { text: t('guide.palace.intro.2', { lv: officerLevelCap(profile) }), spot: 'cityDoor' },
      ];
    case 'officer.levelup':
      return [
        { text: t('guide.officer.levelup.1'), spot: 'levelSeal' },
        { text: t('guide.officer.levelup.2') },
      ];
  }
}

/** [사용 안내] 목록의 제목 */
export const guideTitle = (id: GuideId): string => t(`guide.title.${id}` as StringKey);
/** [사용 안내] 목록의 묶음 이름 — 화면 단위 */
export const guideScreenTitle = (screen: GuideScreen): string => t(`guide.screen.${screen}` as StringKey);

/**
 * **자동화 브라우저에서는 안내를 끈다** — 개발 서버에서만, `?guide=1`이면 켠다.
 *
 * 말풍선은 메인 아래쪽(장터 · 대자보 언저리)을 덮고 눌리는 판이라, 새 계정으로 메인을 지나는 스모크 · `*_ux` 도구
 * 열다섯 개가 그 밑의 자리를 누르려다 「다른 요소가 가로챈다」로 멈춘다. 도구마다 「안내 끄기」를 심으면 하나가
 * 빠졌을 때 엉뚱한 자리에서 30초를 기다린다. 안내 자체는 `tools/guide_ux.ts`가 `?guide=1`로 본다.
 */
export const guidesEnabled = (): boolean =>
  !(import.meta.env.DEV && navigator.webdriver && !new URLSearchParams(location.search).has('guide'));
