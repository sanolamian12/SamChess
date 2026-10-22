/**
 * 안내 내관의 대본 — 안내 하나가 몇 마디이고 마디마다 무엇을 가리키는가 (2026-10-22, pptx 113~116쪽)
 *
 * 「언제 · 누가」는 `@samchess/meta`의 `guide.ts`(`pendingGuide` · `stewardTier`)가 정하고, 여기는 **말**만 정한다.
 * 대본 설계(무엇을 어느 화면에서 얼마나)는 `Design/내관_안내_대본.md`다 — 안내를 늘리면 그 표와 이 파일을 함께 고친다.
 *
 * - **한 마디는 말풍선 한 장이다** — 세 줄을 넘기지 않는다(두루마리 한 장에 들어가는 양, 처음 하는 사람이 읽다 지치지 않는 양).
 * - `spot`은 그 마디 동안 화면에서 반짝이는 자리다(`#frame[data-guide-spot]`, `style.css`의 「안내 내관」 절).
 *   말로 「화면 상단의 아이콘」이라고 하면 어느 것인지 모른다 — 가리키는 것이 말보다 빠르다.
 */

import { BUILD_ACTIONS_PER_UPGRADE, MAX_CITY_LEVEL, guideHonor, officerLevelCap } from '@samchess/meta';
import type { GuideHonor, GuideId, PlayerProfile } from '@samchess/meta';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';

/** 마디 동안 반짝이는 자리 — 늘리면 `style.css`의 `#frame[data-guide-spot="…"]`도 함께 */
export type GuideSpot = 'info' | 'gate' | 'barracks' | 'palace';

export interface GuideLine {
  text: string;
  spot?: GuideSpot;
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
        { text: t('guide.main.intro.3'), spot: 'palace' },
        { text: t('guide.main.intro.4'), spot: 'barracks' },
        { text: t('guide.main.intro.5'), spot: 'info' },
      ];
    // 헌제가 들어온 뒤 메인에 처음 올 때 — 궁궐이 황궁이 되고 도시 상한이 하나 오른다 (GDD §5.5)
    case 'emperor':
      return [
        { text: t('guide.emperor.1', { honor }) },
        { text: t('guide.emperor.2'), spot: 'palace' },
        { text: t('guide.emperor.3', { lv: MAX_CITY_LEVEL }), spot: 'palace' },
      ];
    case 'city.lv2':
      return [
        { text: t('guide.city.congrats', { honor }) },
        { text: t('guide.city.lv2.build', { n: BUILD_ACTIONS_PER_UPGRADE }), spot: 'palace' },
        { text: t('guide.city.lv2.town') },
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
    case 'town.enter':
      return [{ text: t('guide.town.enter.1'), spot: 'gate' }];
  }
}

/** [사용 안내] 목록의 제목 */
export const guideTitle = (id: GuideId): string => t(`guide.title.${id}` as StringKey);

/**
 * **자동화 브라우저에서는 안내를 끈다** — 개발 서버에서만, `?guide=1`이면 켠다.
 *
 * 말풍선은 메인 아래쪽(장터 · 대자보 언저리)을 덮고 눌리는 판이라, 새 계정으로 메인을 지나는 스모크 · `*_ux` 도구
 * 열다섯 개가 그 밑의 자리를 누르려다 「다른 요소가 가로챈다」로 멈춘다. 도구마다 「안내 끄기」를 심으면 하나가
 * 빠졌을 때 엉뚱한 자리에서 30초를 기다린다. 안내 자체는 `tools/guide_ux.ts`가 `?guide=1`로 본다.
 */
export const guidesEnabled = (): boolean =>
  !(import.meta.env.DEV && navigator.webdriver && !new URLSearchParams(location.search).has('guide'));
