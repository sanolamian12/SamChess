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
 */

import { useState } from 'react';
import { signIn, signUp } from '../meta/auth.ts';
import { currentBand, openBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

export function TitleScreen({ onSignedIn }: {
  onSignedIn: () => void;
}): React.JSX.Element {
  useLang();                                  // 언어를 바꾸면 이 화면도 다시 그린다
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 배경은 **화면이 뜰 때 한 번** 정한다. 매 렌더마다 새 `Date`를 만들면 자정에 걸친
  // 판에서 그림이 깜빡일 수 있고, 어차피 한 화면에 머무는 동안 바뀔 일이 아니다.
  const [band] = useState(currentBand);

  const run = (action: (email: string, password: string) => Promise<unknown>): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    action(email, password)
      .then(onSignedIn)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ScreenChrome backdrop={openBackdrop(band)} className="scr-title" account={null}>
      <div className="title-form">
        <input
          className="field"
          type="email"
          value={email}
          maxLength={80}
          placeholder={t('title.email')}
          data-field="email"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(signIn); }}
        />
        <input
          className="field"
          type="password"
          value={password}
          maxLength={80}
          placeholder={t('title.password')}
          data-field="password"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(signIn); }}
        />
        <button
          className="btn primary wide" data-action="enter" disabled={busy}
          onClick={() => run(signIn)}
        >{busy ? t('title.working') : t('title.enter')}</button>
        <button
          className="btn wide" data-action="signup" disabled={busy}
          onClick={() => run(signUp)}
        >{busy ? t('title.working') : t('title.signup')}</button>
        {error && <p className="hint" data-field="error">{t('title.error', { msg: error })}</p>}
      </div>
    </ScreenChrome>
  );
}
