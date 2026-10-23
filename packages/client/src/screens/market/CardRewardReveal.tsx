/**
 * 보상 카드 공개 — 전투 보상으로 받은 장수 카드를 붉은 금박 판(`panel-done`)에 보여 준다.
 *
 * 도적떼 방어전 승리처럼 보상에 장수 카드가 있으면, 결과 두루마리를 펴기 **전에** 이것이 먼저 뜬다.
 * 한 장이면 제목 자리에 등급 표 + 이름, 두 장(C·D 덤)이면 장터 8연처럼 칸마다 이름이 붙는다.
 *
 * 2026-10-23 기획자 지정 — 장터 1회 뽑기에서 빌려 오던 **섬광(폭죽) · 효과음은 뺐다**. 판과 그림은 장터 판의 70%이고,
 * [확인] 단추 대신 결과 두루마리와 같은 「누르면 다음으로」 — 화면 어디를 눌러도 넘어간다.
 */

import type { OfficerId, Grade } from '@samchess/rules';
import { t } from '../../i18n/index.ts';
import { Portrait, Who } from './MercView.tsx';
import { Layer } from './parts.tsx';

export function CardRewardReveal({ cards, onDone }: {
  cards: readonly { officer: OfficerId; grade: Grade }[];
  onDone: () => void;
}): React.JSX.Element {
  const one = cards.length === 1;
  return (
    <Layer>
      {/* `data-action`을 가리개에 단다 — 누르는 자리가 화면 전체다(스모크가 이것을 누른다) */}
      <div className="modal-back mkt-reward-back" data-modal="rewardCards" data-action="rewardCardsOk" onClick={onDone}>
        <div className="mkt-reward-col">
          <div className="modal mkt-done mkt-reward">
            {one && <p className="modal-ttl"><Who officer={cards[0]!.officer} /></p>}
            <div className="mkt-done-body">
              {one ? (
                <div className="mkt-reveal-one" data-officer={cards[0]!.officer}>
                  <Portrait officer={cards[0]!.officer} />
                </div>
              ) : (
                <div className="mkt-reveal-grid" data-count={cards.length}>
                  {cards.map((c, i) => (
                    <div key={`${c.officer}-${i}`} className="mkt-reveal-cell" data-officer={c.officer} data-grade={c.grade}>
                      <Portrait officer={c.officer} size="sm" />
                      <Who officer={c.officer} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="brs-tap">{t('result.tap')}</p>
        </div>
      </div>
    </Layer>
  );
}
