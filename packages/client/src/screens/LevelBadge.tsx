/**
 * 장수 레벨 배지 — 「Lv」와 숫자가 그려진 그림 열 장(`public/icons/level/lv-{1..10}.png`, 2026-11-18 기획자).
 *
 * 목록에서 장수 레벨을 **열로 따로 두지 않고 이름 오른쪽에** 이 배지를 둔다 — 좁은 「레벨」 열과 그 머리가 글자를 작게 만들던 자리였다.
 * 장수 상세 · 전투의 장수 팝업도 같은 배지다(경로는 `ui/levelBadge.ts` 하나). 원본은 `assets/icons/new/장수 레벨.png`(5 × 2).
 * 크기는 글줄을 따라간다(`em`) — 이름과 같은 줄에 서므로. 숫자는 `data-level`로 싣는다(검사는 그림이 아니라 속성으로 본다).
 */
import { BUILDING_BADGE_MAX, buildingBadgeUrl, levelBadgeUrl } from '../ui/levelBadge.ts';
import { BlinkGlow } from './BlinkGlow.tsx';
import { BuildingIcon } from './GameIcon.tsx';
import { t } from '../i18n/index.ts';

export function LevelBadge({ level, className }: { level: number; className?: string }): React.JSX.Element {
  return (
    <img className={`lv-badge${className ? ` ${className}` : ''}`} src={levelBadgeUrl(level)}
      alt={`Lv${level}`} title={`Lv${level}`} data-level={level} draggable={false} />
  );
}

/**
 * 건물 레벨 배지 — 「Lv」와 숫자가 그려진 그림 다섯 장(2026-11-19 기획자, 원본 `assets/icons/new/건물 레벨.png`).
 * 건물 레벨을 글자(「Lv3」)로 적던 자리는 전부 이 배지다. 0(안 지음)은 그림이 없어 부르는 쪽이 「없음」을 적는다.
 */
export function BuildingLevelBadge({ level, className }: { level: number; className?: string }): React.JSX.Element {
  return (
    // 그림 뒤 후광은 병영 꼬마 뒤의 그 별빛(`BlinkGlow`) — Lv5 자주, Lv4 이하 흰 별빛(2026-11-19 기획자).
    // 둥근 그라데이션은 「네온처럼 뿌옇다」였다
    <span className={`bld-badge${className ? ` ${className}` : ''}`} data-level={level} title={`Lv${level}`}>
      <BlinkGlow tone={level >= BUILDING_BADGE_MAX ? 'purple' : 'plain'} className="bld-glow" />
      <img src={buildingBadgeUrl(level)} alt={`Lv${level}`} draggable={false} />
    </span>
  );
}

/** 「[건물 아이콘][레벨 배지]」 — 각 건물 현황판의 「궁궐 Lv2」 자리. 이름은 아이콘에 올리면 뜬다. 안 지은 건물(0)은 「없음」 */
export function BuildingLevel({ id, name, level }: { id: string; name: string; level: number }): React.JSX.Element {
  return (
    <span className="bld-lv" data-level={level} title={`${name} Lv${level}`}>
      <BuildingIcon id={id} label={name} />
      {level > 0 ? <BuildingLevelBadge level={level} /> : <span className="bld-none">{t('city.bld.none')}</span>}
    </span>
  );
}

/**
 * 도시 레벨 배지 — 장수 레벨과 같은 그림(`lv-n`)에 건물 배지와 같은 별빛 후광(2026-11-19 기획자, 궁궐 현황판).
 * Lv10 금, Lv8 · 9 자주, 그 밑은 흰 별빛.
 */
export function CityLevelBadge({ level }: { level: number }): React.JSX.Element {
  const tone = level >= 10 ? 'gold' : level >= 8 ? 'purple' : 'plain';
  return (
    <span className="bld-badge city-badge" data-level={level} title={`Lv${level}`}>
      <BlinkGlow tone={tone} className="bld-glow" />
      <img src={levelBadgeUrl(level)} alt={`Lv${level}`} draggable={false} />
    </span>
  );
}
