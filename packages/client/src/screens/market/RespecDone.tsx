/**
 * 초심의 서 완료 — 명상하는 선비 도입부(`Celebrate`의 `respec`, 5초) 뒤 무대 (2026-11-26 기획자, `Design/축하연출_초심의서_기획안.html`).
 *
 * 바탕은 장수 모집 무대와 같다(`rcr-done` — 어둠 위 가라앉힌 계정 문장). 그 위에 장수 꼬마와 **장수 카드 아이콘 여러 장을 포갠 묶음**이 나란히 서고,
 * 제목 밑에 다른 축하처럼 붓 획 두 줄 — 「(카드 메달) ×N」(0에서 N까지 오른다) · 「[등급][레벨 배지][이름]」(배지는 옛 레벨에서 1까지 한 칸씩 내려가 1에서 빛난다).
 * 단추는 옛 완료 판과 같은 [궁궐로 이동] · [닫기]이고, 화면 다른 곳을 눌러도 닫힌다.
 * 검사가 거는 이름은 옛 판과 같다 — `data-modal="respecDone"` · `data-field="refund"`(끝 값은 `data-refund`) · `data-action="toPalace"` · `goodsClose`.
 */

import { useEffect, useState } from 'react';
import { officerById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { t } from '../../i18n/index.ts';
import { pickOfficerName } from '../../i18n/story.ts';
import { Celebrate } from '../Celebrate.tsx';
import { GradeBadge } from '../GradeBadge.tsx';
import { LevelBadge } from '../LevelBadge.tsx';
import { Portrait } from './MercView.tsx';
import { Layer } from './parts.tsx';

/** 무대가 열린 뒤 세기 시작하는 때 · 한 칸의 길이 — 붓 획 두 줄이 떠오른(`.rsp-row` 1초) 뒤에 */
const COUNT_FROM_MS = 1200;
const LEVEL_STEP_MS = 110;
const CARD_COUNT_MS = 800;

export function RespecDone({ officer, fromLevel, refund, onPalace, onClose }: {
  officer: OfficerId;
  fromLevel: number;
  refund: number;
  onPalace: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Layer>
      <Celebrate modal="respecDone" okAction="goodsClose" intro="respec" className="rcr-done brs-cel rsp-done" title={t('market.respec.done')}
        art={<img className="cel-art-img" src="ui/cel-recruit.png" alt="" />}
        cast={(
          <span className="rsp-cast">
            <Portrait officer={officer} />
            <span className="rsp-stack" aria-hidden>
              {[0, 1, 2].map((n) => <img key={n} data-n={n} src="market/market_card.png" alt="" />)}
            </span>
          </span>
        )}
        onClose={onClose}>
        <RespecRows officer={officer} fromLevel={fromLevel} refund={refund} />
        <div className="rsp-actions">
          <button type="button" className="btn wide" data-action="toPalace" onClick={(e) => { e.stopPropagation(); onPalace(); }}>{t('market.respec.go')}</button>
          <button type="button" className="btn wide" data-action="goodsClose" onClick={(e) => { e.stopPropagation(); onClose(); }}>{t('market.close')}</button>
        </div>
      </Celebrate>
    </Layer>
  );
}

/** 무대는 도입부 5초 뒤에 열린다 — 이 줄들이 그려지는 순간이 곧 무대가 열린 때다 */
function RespecRows({ officer, fromLevel, refund }: { officer: OfficerId; fromLevel: number; refund: number }): React.JSX.Element {
  const [level, setLevel] = useState(fromLevel);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const timers: number[] = [];
    for (let lv = fromLevel - 1; lv >= 1; lv -= 1) {
      timers.push(window.setTimeout(() => setLevel(lv), COUNT_FROM_MS + (fromLevel - lv) * LEVEL_STEP_MS));
    }
    const t0 = performance.now() + COUNT_FROM_MS;
    let raf = 0;
    const tick = (): void => {
      const k = Math.min(1, Math.max(0, (performance.now() - t0) / CARD_COUNT_MS));
      setShown(Math.round(refund * k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { timers.forEach((id) => window.clearTimeout(id)); cancelAnimationFrame(raf); };
  }, [fromLevel, refund]);

  const data = officerById.get(officer);
  return (
    <>
      <p className="lvd-row rsp-row" data-field="refund" data-refund={refund}>
        <img className="lvd-medal" src="market/medal-card.png" alt="" />
        <b>×{shown}</b>
      </p>
      <p className="lvd-row rsp-row" data-field="respecOfficer" data-officer={officer}>
        <GradeBadge grade={data?.grade ?? 'B'} />
        <span className="rsp-lvslot" data-field="respecLevel" data-level={level} data-final={level === 1 ? '1' : undefined}>
          <LevelBadge key={level} level={level} />
        </span>
        <b>{data ? pickOfficerName(data) : officer}</b>
      </p>
    </>
  );
}
