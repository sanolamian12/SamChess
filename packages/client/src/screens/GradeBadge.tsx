/**
 * 등급 배지(React) — 규칙과 물러나기는 `ui/grade.ts` 한 곳에 있고 여기서는 붙일 뿐이다.
 * 크기는 자리마다 `style.css`가 정한다(「등급 아이콘」절 — 글자 크기의 배수).
 */

import { useState } from 'react';
import { gradeIconUrl } from '../ui/grade.ts';

export function GradeBadge({ grade }: { grade: string }): React.JSX.Element {
  // 실패를 **등급별로** 기억한다 — 같은 자리에 다른 등급이 오면 그림을 다시 청한다
  const [failed, setFailed] = useState<string | null>(null);
  const art = failed !== grade;
  return (
    <span className="gr" data-grade={grade} data-fallback={art ? undefined : '1'} title={grade}>
      {art
        ? <img key={grade} src={gradeIconUrl(grade)} alt={grade} draggable={false} onError={() => setFailed(grade)} />
        : grade}
    </span>
  );
}
