/**
 * 입장 팝업 — 간판 화면의 [입장]을 누르면 뜬다 (2026-09-11 지정)
 *
 * ```
 *        입 장            ← 청동 명패 (`.modal-ttl`)
 *  [ 이메일            ]
 *  [ 비밀번호          ]
 *  [        입장       ]   ← 옥색 목판 (primary)
 *  [   비밀번호 초기화  ]
 *  [     계정 생성      ]
 *  [       닫기        ]
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 입력칸이 화면에서 팝업으로 내려왔나
 * ────────────────────────────────────────────────────────────────
 *
 * 간판 화면에 이메일·비밀번호·입장·계정 생성 넷이 나란히 서 있었다. 비밀번호
 * 초기화처럼 **로그인에 딸린 것이 하나 더 붙을 자리가 없었다** — 늘리면 첫
 * 화면이 꽉 차 보이고, 언어 설정처럼 **로그인보다 먼저 와야 하는 것**을 올려
 * 둘 곳도 없었다. 그래서 첫 화면은 단추 셋(언어·크레딧·입장)만 남기고,
 * 로그인에 딸린 넷은 전부 이 팝업 안으로 들어왔다.
 *
 * **`data-action="enter"`는 여기 있다** — 예전 간판 화면의 [입장]이 달고 있던
 * 이름 그대로다. 팝업을 여는 단추는 `loginOpen`이라 이름이 안 겹친다.
 *
 * ────────────────────────────────────────────────────────────────
 * 비밀번호는 우리가 저장하지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * 「로그인한 아이디·비밀번호 자동저장」은 **브라우저·OS의 비밀번호 관리자**에
 * 맡긴다 — `<form>` + `autocomplete`(`username`·`current-password`)가 그 통로다.
 * 우리가 평문으로 들고 있으면 같은 출처에서 도는 모든 스크립트가 읽는다
 * (`meta/auth.ts`의 `LAST_EMAIL_KEY` 주석 참조). 이메일만 기억하고(`lastEmail()`),
 * 「다시 안 적어도 들어간다」는 세션(리프레시 토큰)이 이미 해 준다.
 *
 * **`<form onSubmit>`이라야 비밀번호 관리자가 「저장할까요」를 띄운다** — 버튼
 * `onClick`만으로는 많은 브라우저가 로그인인지 모른다. 그래서 Enter 처리도
 * 따로 안 적는다(폼이 기본으로 해 준다).
 */

import { useState } from 'react';
import { lastEmail, resetPassword, signIn, signUp } from '../meta/auth.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { useFitText } from './useFitText.ts';

export function LoginModal({ onSignedIn, onClose }: {
  onSignedIn: () => void;
  onClose: () => void;
}): React.JSX.Element {
  useLang();
  // 지난번에 들어왔던 이메일로 시작한다 — 비밀번호는 비워 둔다(브라우저의
  // 비밀번호 관리자가 채울 자리다).
  const [email, setEmail] = useState(lastEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 「메일을 보냈다」 안내 — 회원가입 확인 메일과 비밀번호 재설정 메일 둘 다 쓴다 */
  const [sent, setSent] = useState<'confirm' | 'reset' | null>(null);
  /** 청동 명패는 한 줄이라야 한다 — 긴 번역이면 글자를 줄인다 */
  const titleRef = useFitText<HTMLHeadingElement>(t('title.loginTitle'));

  /** 세 갈래(로그인·회원가입·재설정)가 같은 바쁨·오류·안내 칸을 쓴다 */
  const run = (work: () => Promise<void>): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSent(null);
    work()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const runSignIn = (): void => run(() => signIn(email, password).then(onSignedIn));

  const runSignUp = (): void => run(() => signUp(email, password).then((result) => {
    if (result.confirmed) onSignedIn();
    else setSent('confirm');
  }));

  // 이메일 없이 누르면 Supabase가 422로 답하는데, 그 문장이 사용자에게는
  // 「무엇을 어떻게 해야 하는지」를 안 알려 준다 — 여기서 먼저 막고 한 줄로 말한다.
  const runReset = (): void => {
    if (!email.trim()) { setError(t('title.resetNeedEmail')); setSent(null); return; }
    run(() => resetPassword(email).then(() => setSent('reset')));
  };

  return (
    <div className="modal-back" onClick={onClose}>
      {/* 안쪽을 누르는 것은 닫기가 아니다 — 바깥을 눌러야 닫힌다(`SettingsModal`과 같다) */}
      <form
        className="modal mod-plank login-modal" data-modal="login"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); runSignIn(); }}
      >
        <h2 className="modal-ttl fit" ref={titleRef}>{t('title.loginTitle')}</h2>

        <div className="field-wrap">
          <input
            className="field"
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            maxLength={80}
            placeholder={t('title.email')}
            data-field="email"
            onChange={(e) => setEmail(e.target.value)}
          />
          <BrushIcon />
        </div>
        <div className="field-wrap">
          <input
            className="field"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            maxLength={80}
            placeholder={t('title.password')}
            data-field="password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <BrushIcon />
        </div>

        <button className="btn primary wide" type="submit" data-action="enter" disabled={busy}>
          {busy ? t('title.working') : t('title.enter')}
        </button>
        {/* **`type="button"`을 꼭 적는다** — 폼 안의 버튼은 기본이 `submit`이라,
            빼면 [비밀번호 초기화]·[계정 생성]·[닫기]가 전부 로그인을 시도한다. */}
        <button className="btn wide" type="button" data-action="reset" disabled={busy} onClick={runReset}>
          {t('title.reset')}
        </button>
        <button className="btn wide" type="button" data-action="signup" disabled={busy} onClick={runSignUp}>
          {t('title.signup')}
        </button>
        <button className="btn wide" type="button" data-action="loginClose" onClick={onClose}>
          {t('title.close')}
        </button>

        {sent === 'confirm' && <p className="hint" data-field="confirm">{t('title.confirmEmail', { email })}</p>}
        {sent === 'reset' && <p className="hint" data-field="resetSent">{t('title.resetSent', { email })}</p>}
        {error && <p className="hint" data-field="error">{t('title.error', { msg: error })}</p>}
      </form>
    </div>
  );
}

/**
 * 붓 아이콘 — 입력칸이 「글씨를 적는 자리」라는 것을 알려 준다(2026-08-25 피드백).
 * 그림 파일을 두지 않고 그린다 — `GearIcon`과 같은 이유(에셋 파이프라인 안 늘림).
 * 간판 화면에 있던 것이 입력칸과 함께 이 팝업으로 내려왔다(2026-09-11) — CSS는
 * 그대로다(`.scr-title .brush-icon`, 이 팝업도 간판 화면 안이다).
 */
function BrushIcon(): React.JSX.Element {
  return (
    <svg className="brush-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 3.5c2 0 4 2 4 4-3.2 1.4-5 3.4-6.6 6.4L9.5 11.5c2.6-3.6 3-8 5-8Z" />
      <path d="M9.8 11.8 4.5 19.5s2.6.6 4.4-1c1.2-1 1.3-2.6.9-3.7l-.5-1.3Z" />
    </svg>
  );
}
