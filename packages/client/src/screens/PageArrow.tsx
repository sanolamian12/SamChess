/**
 * 쪽 넘김 꺾쇠 — 판 가운데 위(이전) · 아래(다음)의 나무 테 위에 크게, 쪽 번호는 없다 (2026-11-27 기획자, 장터 전투 아이템에서 시작).
 *
 * **이제부터 쪽 넘김은 이 방식이다** (2026-11-27 기획자 — 장수 일람부터 [처음] · [이전] · [다음] · [끝](`Pager`)을 걷는다).
 * 그림은 내 차례 표의 겹 갈매기(`ui/turn/chevron.png`, 아래를 향한 그림) — 위 것은 뒤집는다. 갈 수 있는 쪽 화살은 위아래로 살짝 오르내리고,
 * 끝 쪽에서는 흐려지고 안 눌린다(자리는 남아 판이 안 흔들린다). 쪽이 하나면 둘 다 안 그린다(`show`).
 *
 * 판은 `position: relative`여야 하고, 테 두께가 1.5rem이 아니면 판에 `--page-arrow-bar`를 준다(`style.css`의 `.page-arrow-row`).
 */
import { t } from '../i18n/index.ts';

export function PageArrow({ dir, show, disabled, onClick }: {
  dir: 'prev' | 'next'; show: boolean; disabled: boolean; onClick: () => void;
}): React.JSX.Element {
  return (
    <div className="page-arrow-row" data-dir={dir}>
      {show && (
        <button type="button" className="page-arrow" data-dir={dir} data-action={dir === 'prev' ? 'prevPage' : 'nextPage'}
          aria-label={t(dir === 'prev' ? 'officers.pager.prev' : 'officers.pager.next')} disabled={disabled} onClick={onClick}>
          <img src="ui/turn/chevron.png" alt="" />
        </button>
      )}
    </div>
  );
}
