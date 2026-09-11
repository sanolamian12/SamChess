/**
 * 크레딧 팝업 — 간판 화면의 둘째 단추 (2026-09-11 지정)
 *
 * **아직 내용이 없다.** 크레딧 화면은 따로 만들기로 했고(기획자 지정), 단추는
 * 그보다 먼저 자리를 잡았다. 그래서 여기서는 **「준비 중이다」를 그대로 말한다** —
 * 「눌리는데 아무 일도 없는 단추」로 두지 않는다(`SettingsModal`의 화면 모드 칩을
 * 잠가 두고 이유를 적은 것과 같은 결).
 *
 * 내용이 정해지면 이 팝업을 화면(`CreditsScreen`)으로 키울지, 팝업 안에 스크롤로
 * 담을지를 그때 정한다 — 지금 미리 고르면 둘 중 하나가 죽은 코드로 남는다.
 */

import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { useFitText } from './useFitText.ts';

export function CreditsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  useLang();
  const titleRef = useFitText<HTMLHeadingElement>(t('title.credits'));

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal mod-plank" data-modal="credits" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-ttl fit" ref={titleRef}>{t('title.credits')}</h2>
        <p className="row" data-field="soon">{t('title.creditsSoon')}</p>
        {/* [닫기]는 붉은 판이다 — `LanguageModal`과 같은 자리·같은 이유 */}
        <button className="btn wide" data-action="creditsClose" onClick={onClose}>{t('title.close')}</button>
      </div>
    </div>
  );
}
