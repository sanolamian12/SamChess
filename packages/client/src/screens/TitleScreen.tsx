/**
 * 간판·로그인 화면 — 게임 URL로 들어오면 가장 먼저 뜨는 화면 (pptx 33·34쪽)
 *
 * ```
 * ┌──────────────────────────┐
 * │ 만민의 삼국지        ⚙   │  ← 제목 · 환경설정 (ScreenChrome)
 * │                          │
 * │      (시간대 배경)        │  ← openBackground.png 의 지금 시간대 칸
 * │                          │
 * │  [   언어 (Language)   ]  │  → LanguageModal
 * │  [     크레딧 보기     ]  │  → CreditsModal
 * │  [        입장         ]  │  → LoginModal
 * └──────────────────────────┘
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 첫 화면은 단추 셋이다 ★ (2026-09-11 지정)
 * ────────────────────────────────────────────────────────────────
 *
 * 예전에는 이메일·비밀번호 입력칸과 [입장]·[계정 생성]이 **이 화면에 직접** 있었다.
 * 비밀번호 초기화처럼 로그인에 딸린 것이 하나만 더 붙어도 첫 화면이 꽉 차 보여,
 * **로그인에 딸린 것은 전부 팝업으로 내렸다**(`LoginModal`).
 *
 * 남은 셋의 **순서가 곧 뜻**이다 — 언어가 가장 위다(국제적으로 내놓는 게임이라
 * 「무슨 글자로 읽을지」가 로그인보다 먼저 온다). [입장]만 옥색 목판(primary)이고
 * 나머지 둘은 참나무(secondary)라, 셋이 나란히 있어도 할 일이 하나로 보인다.
 *
 * ────────────────────────────────────────────────────────────────
 * H3a — 진짜 로그인이 붙었다 (판정은 `LoginModal`로 옮겼다)
 * ────────────────────────────────────────────────────────────────
 *
 * **로그인이 필수다** — 게스트 진입은 없다(§5-91). 로그인·회원가입·비밀번호 재설정
 * 셋 다 `LoginModal`이 부르고, 성공하면 여기로 올라온 `onSignedIn`이 그대로
 * `App.tsx`로 간다 — 로그인 성공 뒤 "서버에 프로필이 있는가"를 물어 메인으로 갈지
 * 새 계정 화면으로 갈지 정하는 것은 이 화면 일이 아니다.
 */

import { useState } from 'react';
import { currentSession } from '../meta/auth.ts';
import { currentBand, openBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { CreditsModal } from './CreditsModal.tsx';
import { LanguageModal } from './LanguageModal.tsx';
import { LoginModal } from './LoginModal.tsx';
import { currentLang, t, type Lang } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

/**
 * 성문 위 붓글씨 제목의 언어별 폰트(2026-08-25). 진짜 붓글씨체는 한글에만 있다
 * (Nanum Brush Script, 한국어 전용 웹폰트) — 나머지는 획이 굵은 세리프로 물러난다.
 * `index.html`의 머리말 주석과 짝이다.
 */
const HERO_FONT: Record<Lang, string> = {
  ko: "'Nanum Brush Script', cursive",
  en: "'Cinzel Decorative', serif",
  es_419: "'Cinzel Decorative', serif",
  it: "'Cinzel Decorative', serif",
  pt_BR: "'Cinzel Decorative', serif",
  pt_PT: "'Cinzel Decorative', serif",
  ja: "'Noto Serif JP', serif",
  zh_Hans: "'Noto Serif SC', serif",
  zh_Hant: "'Noto Serif TC', serif",
  // 몽골어(키릴)에 맞는 무료 붓글씨/장식 서체를 못 찾아 시스템 세리프로 둔다.
  mn: 'Georgia, serif',
};

export function TitleScreen({ onSignedIn }: {
  onSignedIn: () => void;
}): React.JSX.Element {
  useLang();                                  // 언어를 바꾸면 이 화면도 다시 그린다
  /** 지금 열린 팝업. 셋 중 하나만 뜬다 — 한 값으로 두면 「둘 다 떠 있다」가 불가능해진다 */
  const [modal, setModal] = useState<'login' | 'language' | 'credits' | null>(null);
  // 배경은 **화면이 뜰 때 한 번** 정한다. 매 렌더마다 새 `Date`를 만들면 자정에 걸친
  // 판에서 그림이 깜빡일 수 있고, 어차피 한 화면에 머무는 동안 바뀔 일이 아니다.
  const [band] = useState(currentBand);

  // 「만인의 / 삼국지」반 줄 어긋난 두 줄 배치는 한국어를 보고 정한 것이다
  // (2026-08-25 피드백) — 다른 언어는 낱말 수·길이가 저마다 달라서 그대로 옮기면
  // 긴 제목(영어 "Everyone's Three Kingdoms" 등)이 줄마다 다시 접혀 겹친다.
  // 한국어만 어긋나게 쌓고, 나머지는 한 덩어리로 가운데 정렬 + 자동 줄바꿈이다.
  const heroLang = currentLang();
  const heroTitle = t('game.title');
  const heroSpaceAt = heroLang === 'ko' ? heroTitle.indexOf(' ') : -1;
  const heroFirst = heroSpaceAt < 0 ? heroTitle : heroTitle.slice(0, heroSpaceAt);
  const heroRest = heroSpaceAt < 0 ? '' : heroTitle.slice(heroSpaceAt + 1);

  return (
    <ScreenChrome backdrop={openBackdrop(band)} className="scr-title" account={currentSession()?.email ?? null}>
      {/* 배경 그림 위에 얹는 붓글씨 제목 — 진짜 헤더(`.brand`)와는 다른 자리다.
          `pointer-events: none`이라 아래 성문 그림·입력창을 절대 가리지 않는다.
          첫 낱말과 나머지를 반 줄씩 어긋나게 쌓는다(2026-08-25 피드백) — 띄어쓰기가
          없는 언어(번역이 채워지면)는 `heroRest`가 빈 문자열이라 한 줄로 물러난다. */}
      <div className="title-hero" aria-hidden="true" style={{ fontFamily: HERO_FONT[currentLang()] }}>
        <span className={heroRest ? 'ln1' : 'solo'}>{heroFirst}</span>
        {heroRest && <span className="ln2">{heroRest}</span>}
      </div>
      {/* 단추 셋 — 위에서부터 언어 · 크레딧 · 입장(위 머리말의 「순서가 곧 뜻」).
          [입장]만 `primary`라 화면에서 유일하게 옥색이다. */}
      <div className="title-form">
        <button className="btn wide" data-action="languageOpen" onClick={() => setModal('language')}>
          {t('title.language')}
        </button>
        <button className="btn wide" data-action="creditsOpen" onClick={() => setModal('credits')}>
          {t('title.credits')}
        </button>
        <button className="btn primary wide" data-action="loginOpen" onClick={() => setModal('login')}>
          {t('title.enter')}
        </button>
      </div>

      {modal === 'login' && <LoginModal onSignedIn={onSignedIn} onClose={() => setModal(null)} />}
      {modal === 'language' && <LanguageModal onClose={() => setModal(null)} />}
      {modal === 'credits' && <CreditsModal onClose={() => setModal(null)} />}
    </ScreenChrome>
  );
}
