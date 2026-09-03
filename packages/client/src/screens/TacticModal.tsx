/**
 * 책략 설명 팝업 (2026-09-03)
 *
 * 장수 카드(`OfficerCard`)의 책략 칩을 누르면 뜬다. **모바일에는 hover가
 * 없어서** 칩의 `title=`(효과문)이 손가락으로는 영영 안 보였다 — 그 정보를
 * 누를 수 있는 자리로 옮긴 것이다(2026-09-03 지정).
 *
 * 생김새는 **레벨업의 「고르기」가 쓰는 책략 두루마리**(`LevelUpScreen`의
 * `.lv-tactic-row`)를 그대로 가져왔다 — 이름 + 소모 MP, 효과문, 발동 조건
 * 석 줄이다. 새 화풍을 안 만든다: 같은 정보를 두 화면이 다른 모양으로
 * 보여주면 「같은 것인지」를 눈으로 다시 맞춰 봐야 한다. 클래스를 그대로
 * 쓰므로 `.scr-officers`(양피지)와 어두운 화면의 색 두 벌도 공짜로 따라온다.
 *
 * **발동 조건은 학파가 아니라 책략이 정한다** — 지원책이면서 칸에 거는
 * 화계·진화는 겨눌 상대가 없어 공식이 다르다. 갈래를 화면이 다시 적지 않게
 * 엔진의 `isTerrainTactic()`에 묻는다(`Picker`와 같은 자리, 같은 이유).
 *
 * 닫기는 **오른쪽 아래 체크**다(2026-09-03 지정) — 카드 오른쪽 위의 [X]
 * (`.ofcard-close`)와 자리가 겹치면 「카드를 닫으려다 팝업을 닫는」 일이
 * 생긴다. 가리개를 눌러도 닫힌다(다른 팝업과 같은 규약).
 */

import type { TacticData } from '@samchess/data';
import { isTerrainTactic } from '@samchess/rules';
import { t } from '../i18n/index.ts';
import { pickTacticName, pickTacticText } from '../i18n/story.ts';

export function TacticModal({ tactic, onClose }: {
  tactic: TacticData;
  onClose: () => void;
}): React.JSX.Element {
  const cond = isTerrainTactic(tactic)
    ? 'levelup.trigger.terrain'
    : tactic.school === 'support' ? 'levelup.trigger.support' : 'levelup.trigger.illusion';
  return (
    <div className="modal-back" data-modal="tactic" onClick={onClose}>
      <div
        className="tac-modal lv-tactic-row"
        data-school={tactic.school}
        data-tactic={tactic.id}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="lv-tactic-head">
          <span className="lv-tactic-label">
            {pickTacticName(tactic)}{' '}
            {/* 「MP」는 `Lv`·`HP`처럼 번역 없이 그대로 쓰는 약어다(`Picker`와 같다) */}
            <span className="lv-tactic-mp">(MP: {tactic.mpCost})</span>
          </span>
        </span>
        <span className="lv-tactic-text">{pickTacticText(tactic)}</span>
        <span className="lv-tactic-cond">{t(cond)}</span>

        {/* 닫기 표시는 X가 아니라 **체크**다(2026-09-03 지정) — 읽고 나서
            「알겠다」로 접는 자리라, 레벨업의 [확정] 체크(`icons/confirm.png`,
            원본 `button_confirm.png`)와 같은 그림을 쓴다. 하는 일은 그대로
            닫기이므로 `data-action`·읽어 주는 이름은 안 바꾼다. */}
        <button className="tac-close" data-action="close" onClick={onClose} aria-label={t('ranking.card.close')}>
          <img src="icons/confirm.png" alt="" />
        </button>
      </div>
    </div>
  );
}
