/**
 * 장수 그림 한 장 — 수묵화 → 타일 초상화 → 빈자리 순으로 물러난다.
 *
 * 대체 규칙은 `ui/art.ts` 한 곳에 있고 여기서는 그걸 React에 붙일 뿐이다.
 * 수묵화(`assets/CharsInBattle/`)는 260명 중 일부만 있어서, 없는 장수가 더 흔하다.
 */

import { setOfficerArt } from '../ui/art.ts';

export function OfficerArt({ officer, className }: {
  officer: string;
  className?: string;
}): React.JSX.Element {
  return (
    <img
      className={className ?? 'art'}
      alt=""
      // key를 두어 장수가 바뀌면 img를 새로 만든다 — onerror 사슬이 남아 있으면
      // 이전 장수의 대체 경로로 흘러간다
      key={officer}
      ref={(el) => { if (el) setOfficerArt(el, officer); }}
    />
  );
}
