/**
 * 캐릭터 보상 공개 — 전투 · 도적떼 · 튜토리얼 결과에서 받은 장수 카드를 **장수 모집 결과와 같은 무대**로 보여 준다
 * (2026-11-26 기획자 — 옛 붉은 금박 판(`panel-done`)은 걷었다).
 *
 * 결과 두루마리가 「보상」을 크게 쓴 뒤 화면째 어두워지면(`ResultScroll`의 `interlude`) **걷는 장면 없이 곧장** 무대가 열린다 —
 * 계정 문장 앞에 받은 장수가 낮은 등급부터 하나씩 「팡」(`RecruitCast`), 뒤에서 가장 높은 등급의 빛줄기가 돈다.
 * 장수가 하나 튀어나올 때마다 결과 두루마리와 같은 「결과표출」 소리. 승리 곡은 멈추지 않는다(`Celebrate`의 `instant`).
 * 단추 없이 화면 어디를 누르거나 아무 키나 누르면 닫히고, 두루마리가 다시 밝아진다.
 *
 * 검사가 거는 이름은 옛 판과 같다 — `data-modal="rewardCards"` · 누름 칸 `data-action="rewardCardsOk"` · 장수마다 `data-officer`.
 */

import { useEffect } from 'react';
import { officerById } from '@samchess/data';
import type { OfficerId, Grade } from '@samchess/rules';
import { t } from '../../i18n/index.ts';
import { playSfx } from '../../audio/sfx.ts';
import { Celebrate } from '../Celebrate.tsx';
import { officerBlink } from '../BlinkGlow.tsx';
import { CAST_FROM_MS, CAST_STEP_MS, RecruitCast } from './MercView.tsx';
import { Layer } from './parts.tsx';

const GRADE_ORDER: readonly Grade[] = ['E', 'S', 'A', 'B', 'C', 'D'];

export function CardRewardReveal({ cards, onDone }: {
  cards: readonly { officer: OfficerId; grade: Grade }[];
  onDone: () => void;
}): React.JSX.Element {
  const drawn = cards.map((c) => c.officer);
  const top = [...cards].map((c) => officerById.get(c.officer)?.grade ?? c.grade)
    .sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b))[0] ?? 'B';

  // 무대가 열리는 소리는 `Celebrate`가(`sound`), 둘째 장수부터는 튀어나오는 박자에 맞춰 여기서 — `RecruitCast`의 늦춤과 같은 값
  useEffect(() => {
    const timers = cards.slice(1).map((_, i) => window.setTimeout(() => playSfx('result_pop'), CAST_FROM_MS + (i + 1) * CAST_STEP_MS));
    return () => timers.forEach((id) => window.clearTimeout(id));
    // 열린 동안 같은 카드다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Layer>
      <Celebrate modal="rewardCards" okAction="rewardCardsOk" className="rcr-done brs-cel" title={t('result.cardReward')}
        instant sound="result_pop"
        tone={officerBlink(top)}
        art={<img className="cel-art-img" src="ui/cel-recruit.png" alt="" />}
        cast={<RecruitCast got={{ drawn, fates: drawn.map(() => 'card' as const) }} />}
        onClose={onDone} />
    </Layer>
  );
}
