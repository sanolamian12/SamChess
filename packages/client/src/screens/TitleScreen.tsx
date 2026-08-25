/**
 * 간판·로그인 화면 — 게임 URL로 들어오면 가장 먼저 뜨는 화면 (pptx 33·34쪽)
 *
 * ```
 * ┌──────────────────────────┐
 * │ 만민의 삼국지        ⚙   │  ← 제목 · 환경설정 (ScreenChrome)
 * │                          │
 * │      (시간대 배경)        │  ← openBackground.png 의 지금 시간대 칸
 * │                          │
 * │  [ 이메일              ]  │
 * │  [ 비밀번호            ]  │
 * │  [        입장        ]  │
 * │  [      계정 생성      ]  │
 * └──────────────────────────┘
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * H3a — 진짜 로그인이 붙었다
 * ────────────────────────────────────────────────────────────────
 *
 * **로그인이 필수다** — 게스트 진입은 없다(§5-91). 「입장」은 로그인(`signIn`),
 * 「계정 생성」은 회원가입(`signUp`)이다. 확인 메일은 꺼져 있어(개발 단계 결정)
 * 회원가입이 성공하면 그 자리에서 세션이 온다 — 「메일함을 확인하세요」 상태가 없다.
 *
 * 두 요청 다 `App.tsx`로 넘긴다 — 로그인 성공 뒤 "서버에 프로필이 있는가"를 물어
 * 메인으로 갈지 새 계정 화면으로 갈지 정하는 것은 여기 일이 아니다.
 *
 * **Supabase 프로젝트에서 확인 메일이 켜져 있으면 `signUp`이 세션 없이 끝난다** —
 * 그때는 `onSignedIn`을 부르지 않고 "메일함을 확인하세요"만 보여 준다.
 */

import { useState } from 'react';
import { currentSession, signIn, signUp } from '../meta/auth.ts';
import { currentBand, openBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  // 배경은 **화면이 뜰 때 한 번** 정한다. 매 렌더마다 새 `Date`를 만들면 자정에 걸친
  // 판에서 그림이 깜빡일 수 있고, 어차피 한 화면에 머무는 동안 바뀔 일이 아니다.
  const [band] = useState(currentBand);

  const runSignIn = (): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setConfirmSent(false);
    signIn(email, password)
      .then(onSignedIn)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const runSignUp = (): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setConfirmSent(false);
    signUp(email, password)
      .then((result) => {
        if (result.confirmed) onSignedIn();
        else setConfirmSent(true);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

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
      <div className="title-form">
        <div className="field-wrap">
          <input
            className="field"
            type="email"
            value={email}
            maxLength={80}
            placeholder={t('title.email')}
            data-field="email"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSignIn(); }}
          />
          <BrushIcon />
        </div>
        <div className="field-wrap">
          <input
            className="field"
            type="password"
            value={password}
            maxLength={80}
            placeholder={t('title.password')}
            data-field="password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSignIn(); }}
          />
          <BrushIcon />
        </div>
        <button
          className="btn primary wide" data-action="enter" disabled={busy}
          onClick={runSignIn}
        >{busy ? t('title.working') : t('title.enter')}</button>
        <button
          className="btn wide" data-action="signup" disabled={busy}
          onClick={runSignUp}
        >{busy ? t('title.working') : t('title.signup')}</button>
        {confirmSent && <p className="hint" data-field="confirm">{t('title.confirmEmail', { email })}</p>}
        {error && <p className="hint" data-field="error">{t('title.error', { msg: error })}</p>}
      </div>
    </ScreenChrome>
  );
}

/**
 * 붓 아이콘 — 입력칸이 「글씨를 적는 자리」라는 것을 알려 준다(2026-08-25 피드백).
 * 그림 파일을 두지 않고 그린다 — `GearIcon`과 같은 이유(에셋 파이프라인 안 늘림).
 */
function BrushIcon(): React.JSX.Element {
  return (
    <svg className="brush-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 3.5c2 0 4 2 4 4-3.2 1.4-5 3.4-6.6 6.4L9.5 11.5c2.6-3.6 3-8 5-8Z" />
      <path d="M9.8 11.8 4.5 19.5s2.6.6 4.4-1c1.2-1 1.3-2.6.9-3.7l-.5-1.3Z" />
    </svg>
  );
}
