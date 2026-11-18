/**
 * 장수 레벨 배지 — 「Lv」와 숫자가 그려진 그림 열 장(`public/icons/level/lv-{1..10}.png`, 2026-11-18 기획자).
 *
 * 목록에서 장수 레벨을 **열로 따로 두지 않고 이름 오른쪽에** 이 배지를 둔다 — 좁은 「레벨」 열과 그 머리가 글자를 작게 만들던 자리였다.
 * 장수 상세 · 전투의 장수 팝업도 같은 배지다(경로는 `ui/levelBadge.ts` 하나). 원본은 `assets/icons/new/장수 레벨.png`(5 × 2).
 * 크기는 글줄을 따라간다(`em`) — 이름과 같은 줄에 서므로. 숫자는 `data-level`로 싣는다(검사는 그림이 아니라 속성으로 본다).
 */
import { levelBadgeUrl } from '../ui/levelBadge.ts';

export function LevelBadge({ level, className }: { level: number; className?: string }): React.JSX.Element {
  return (
    <img className={`lv-badge${className ? ` ${className}` : ''}`} src={levelBadgeUrl(level)}
      alt={`Lv${level}`} title={`Lv${level}`} data-level={level} draggable={false} />
  );
}
