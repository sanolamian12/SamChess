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

/**
 * 쪽 넘김 **줄 하나** — [처음] · [이전] · `1 / 2` · [다음] · [끝] (2026-09-14 지정).
 *
 * **모든 목록이 같은 모양이다.** 예전엔 두 벌이었다 — 대장간은 `1 / 2`를 굵은 미색
 * 글자로, 장수 일람은 `1 / 2 쪽`을 먹색으로(중국어는 「第 1 / 2 页」까지) 적었고,
 * 줄의 간격·여백도 따로 잡혀 있었다. 기획자가 대장간 쪽을 기준으로 정했다 — 숫자만,
 * 짧게. 한 컴포넌트로 모으니 새 목록이 생겨도 모양이 저절로 같다.
 *
 * **[처음]·[끝]은 목록이 늘어날 수 있는 화면만** 켠다(`ends`). 장수 일람은 장수가
 * 계속 느는데, 대장간은 병기가 열다섯뿐이라 쪽이 몇 개 안 된다 — 거기 끝으로 가는
 * 단추를 달면 누를 일이 없는 단추가 는다.
 *
 * `actionPrefix` — 한 화면에 쪽 줄이 **둘** 겹칠 때 스모크가 집는 이름을 가른다
 * (대장간 지급 목록 위에 장수 고르기 팝업이 뜬다: `assignPrevPage` 대 `prevPage`).
 */
export function Pager({ page, pageCount, onPage, ends = false, actionPrefix = '', field }: {
  /** 0부터 센 지금 쪽 */
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  /** [처음]·[끝]을 그리는가 — 목록이 늘어날 수 있는 화면만 */
  ends?: boolean;
  actionPrefix?: string;
  /** 스모크가 줄을 집는 `data-field` */
  field?: string;
}): React.JSX.Element {
  const act = (name: string): string => (
    actionPrefix ? `${actionPrefix}${name[0]!.toUpperCase()}${name.slice(1)}` : name
  );
  const atFirst = page <= 0;
  const atLast = page >= pageCount - 1;
  return (
    <div className="pager" data-field={field} data-ends={ends ? '1' : '0'} data-page={page + 1} data-pages={pageCount}>
      {ends && <PagerButton dir="first" action={act('firstPage')} disabled={atFirst} onClick={() => onPage(0)} />}
      <PagerButton dir="prev" action={act('prevPage')} disabled={atFirst} onClick={() => onPage(Math.max(0, page - 1))} />
      <span className="pager-label">{t('pager.page', { cur: page + 1, max: pageCount })}</span>
      <PagerButton dir="next" action={act('nextPage')} disabled={atLast} onClick={() => onPage(Math.min(pageCount - 1, page + 1))} />
      {ends && <PagerButton dir="last" action={act('lastPage')} disabled={atLast} onClick={() => onPage(pageCount - 1)} />}
    </div>
  );
}

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
