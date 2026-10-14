/**
 * 보상 카드 공개 — 장터 1회 뽑기와 **같은 연출**(섬광 → 장수 카드 판)을 보상에 빌려 쓴다 (2026-10-14 기획자 지정).
 *
 * 도적떼 방어전 승리처럼 보상에 장수 카드가 있으면, 결과 두루마리를 펴기 **전에** 이것이 먼저 돈다.
 * 섬광 · 효과음 · 후광 · 카드 판은 전부 장터의 것 그대로다 — 「카드를 얻었다」는 같은 뜻이면 같은 그림이다.
 * 한 장이면 제목 자리에 등급 표 + 이름, 두 장(C·D 덤)이면 장터 8연처럼 칸마다 이름이 붙는다.
 */

import { useEffect, useState } from 'react';
import type { OfficerId, Grade } from '@samchess/rules';
import { playSfx } from '../../audio/sfx.ts';
import { t } from '../../i18n/index.ts';
import { Portrait, Who } from './MercView.tsx';
import { BurstStage, DoneModal } from './parts.tsx';

/** 장터 단발과 같은 소리 · 같은 틈 — `MercView`의 `PULL_SOUND.single` */
const SFX = 'cardx1';
const LEAD_MS = 1500;

export function CardRewardReveal({ cards, onDone }: {
  cards: readonly { officer: OfficerId; grade: Grade }[];
  onDone: () => void;
}): React.JSX.Element {
  const [step, setStep] = useState<'burst' | 'card'>('burst');
  // 소리는 무대가 뜨는 바로 그 순간에 — 섬광의 틈(`lead`)이 이 시각부터 잰다
  useEffect(() => { playSfx(SFX); }, []);

  if (step === 'burst') {
    return <BurstStage grades={cards.map((c) => c.grade)} lead={LEAD_MS} onDone={() => setStep('card')} />;
  }
  const one = cards.length === 1;
  return (
    <DoneModal
      title={one ? <Who officer={cards[0]!.officer} /> : null}
      field="rewardCards"
      onClose={onDone}
      actions={(
        <button className="btn primary wide" data-action="rewardCardsOk" onClick={onDone}>
          <span className="lbl">{t('city.done.ok')}</span>
        </button>
      )}
    >
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
    </DoneModal>
  );
}
