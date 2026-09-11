/**
 * 쪽 넘김 단추 — [처음] · [이전] · [다음] · [마지막].
 *
 * 그림은 아이콘이 아니라 **단추 자체**다(`assets/icons/to_next.png` ·
 * `to_end.png` → `ui/pager-next.png` · `pager-end.png`). 화살표 모양으로 깎인
 * 목판이고, 그 위에 글자를 얹는다(2026-09-11 지정 — "버튼 안에 글을 넣자").
 * 갈색 판은 한 칸 움직임([이전]·[다음]), 초록 판은 끝까지([처음]·[마지막]).
 *
 * ★ **뒤집는 것은 판뿐이다.** 원본은 오른쪽 방향 둘뿐이라 왼쪽은 좌우로
 * 뒤집어 쓰는데, 단추째 `scaleX(-1)`을 걸면 **글자까지 거울로 뒤집힌다.**
 * 그래서 그림은 `::before`에 깔고 그것만 뒤집으며, 글자는 그 위에 따로 얹는다
 * (`style.css`의 `.pg-btn::before` · `.pg-lbl`).
 *
 * **컴포넌트인 이유** — 판·글자·읽어 주는 이름 셋이 `data-dir` 하나로 함께
 * 정해진다. 속성 묶음만 넘기던 예전 방식은 글자를 부르는 쪽마다 다시 적게
 * 만들어, 한 곳만 빠뜨리면 그 단추만 빈 판이 된다.
 */
import { t } from '../i18n/index.ts';

export type PagerDir = 'first' | 'prev' | 'next' | 'last';

const LABEL: Record<PagerDir, 'officers.pager.first' | 'officers.pager.prev' | 'officers.pager.next' | 'officers.pager.last'> = {
  first: 'officers.pager.first',
  prev: 'officers.pager.prev',
  next: 'officers.pager.next',
  last: 'officers.pager.last',
};

export function PagerButton({ dir, action, disabled, onClick }: {
  dir: PagerDir;
  /** 스모크가 집는 이름 — 같은 화면에 쪽 줄이 둘이면 갈라야 한다 */
  action: string;
  disabled: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const label = t(LABEL[dir]);
  return (
    <button
      className="btn pg-btn"
      data-dir={dir}
      data-action={action}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="pg-lbl">{label}</span>
    </button>
  );
}
