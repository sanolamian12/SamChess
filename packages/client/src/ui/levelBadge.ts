/**
 * 장수 레벨 배지 그림 — 메타 화면(`screens/LevelBadge.tsx`)과 전투의 장수 팝업(`officerCard.ts`)이 함께 쓴다 (2026-11-18 기획자).
 * 그림은 `public/icons/level/lv-{1..10}.png`(「Lv」와 숫자가 그려져 있다), 굽기는 `tools/build_ui.py`의 `build_level_badges`.
 */
export const LEVEL_BADGE_MAX = 10;

export function levelBadgeUrl(level: number): string {
  return `icons/level/lv-${Math.max(1, Math.min(LEVEL_BADGE_MAX, Math.round(level)))}.png`;
}

/** DOM으로 그리는 화면(전투)용 — 숫자는 `data-level`로 싣는다(검사는 그림이 아니라 속성으로 본다) */
export function levelBadgeImg(level: number, className = ''): HTMLImageElement {
  const img = document.createElement('img');
  img.className = `lv-badge${className ? ` ${className}` : ''}`;
  img.src = levelBadgeUrl(level);
  img.alt = img.title = `Lv${level}`;
  img.dataset.level = String(level);
  img.draggable = false;
  return img;
}
