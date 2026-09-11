/**
 * 언어 팝업 — 간판 화면의 첫 단추 (2026-09-11 지정)
 *
 * ```
 *   언어 (Language)        ← 청동 명패
 *   Language    한국어      ← 지금 고른 언어의 제 이름
 *   KR EN ES IT JA
 *   MN BR PT CN TW         ← 한 줄에 다섯, 두 줄
 *   [      닫기      ]
 * ```
 *
 * **환경설정(`SettingsModal`)의 언어 줄과 같은 칩·같은 동작이다** — `setLang()`이
 * 한 자리이고 고르면 그 순간 바뀐다. 그런데도 팝업을 따로 둔 이유는 **순서**다:
 * 국제적으로 내놓을 게임이라 언어가 로그인보다 먼저 와야 하고, 기어 아이콘은
 * 처음 들어온 사람이 눈으로 찾아야 하는 자리다. 환경설정에서도 계속 바꿀 수
 * 있으니 여기는 **첫 화면에서 바로 닿는 지름길**이다.
 *
 * 칩 markup(`.langs` · `.opt` · `data-lang`)을 환경설정과 똑같이 쓴다 — 화풍
 * (`.mod-plank`)도 같은 선택자가 입히므로 CSS를 새로 적지 않는다.
 */

import { LANGS, setLang, t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { useFitText } from './useFitText.ts';

export function LanguageModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const lang = useLang();
  const langLabel = LANGS.find((l) => l.id === lang)?.label ?? '';
  // 명패·언어 이름은 한 줄이라야 한다 — 넘치면 글자를 줄인다(`useFitText`)
  const titleRef = useFitText<HTMLHeadingElement>(t('title.language'));
  const langRef = useFitText<HTMLSpanElement>(langLabel);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal mod-plank" data-modal="language" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-ttl fit" ref={titleRef}>{t('title.language')}</h2>

        <div className="opt-row">
          <span className="k">{t('settings.language')}</span>
          <span className="v dim fit" ref={langRef}>{langLabel}</span>
        </div>
        <div className="langs">
          {LANGS.map((l) => (
            <button
              key={l.id}
              className={`opt${lang === l.id ? ' on' : ''}`}
              data-lang={l.id}
              onClick={() => setLang(l.id)}
            >{l.short}</button>
          ))}
        </div>

        {/* [닫기]는 옥색(primary)이 아니라 **붉은 판**이다(2026-09-11 지정) —
            그림 배선은 `style.css`의 `[data-action="languageClose"]` 절이 한다 */}
        <button className="btn wide" data-action="languageClose" onClick={onClose}>{t('title.close')}</button>
      </div>
    </div>
  );
}
