/**
 * 입장 팝업 · 계정 생성 팝업 — 간판 화면의 [입장] · [계정 생성]을 누르면 뜬다 (2026-09-11, 2026-10-19 둘로 가름)
 *
 * ```
 *   mode="login"                     mode="signup"
 *        입 장                        계정 생성             ← 청동 명패 (`.modal-ttl`)
 *  [ 이메일            ]          [ 이메일            ]
 *  [ 비밀번호          ]          [ 비밀번호          ]
 *  [        입장       ] 옥색      [     계정 생성      ] 금빛
 *  [   비밀번호 초기화  ] 참나무    [       취소        ] 붉은
 *  [       취소        ] 붉은
 * ```
 *
 * **계정 생성은 간판의 따로 난 길이다**(2026-10-19 기획자 지정) — 처음엔 입장 팝업 안의 단추 하나였는데, 첫 화면에서
 * 「처음 온 사람의 길」이 안 보였다. 입력칸 · 바쁨 · 오류 · 안내 칸은 같아 한 컴포넌트의 두 모드로 둔다.
 * 닫기는 바닥의 붉은 [취소]와 바깥 누르기다 — 같은 날 잠깐 판 구석에 X 아이콘을 달았다가 [취소]가 돌아오며 걷었다(기획자 지정).
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
import type { EnterPhase } from './EnterLoading.tsx';

export function LoginModal({ mode = 'login', initialEmail, onSignedIn, onPhase, onSwitch, onClose }: {
  /** `login` — 입장, `signup` — 계정 생성 */
  mode?: 'login' | 'signup';
  /** 로그인 뒤 프로필을 불러와 다음 화면으로 넘어갈 때까지 — 끝나야 로딩 화면이 걷힌다 */
  onSignedIn: () => Promise<void>;
  /** 입성 로딩 화면의 걸음(`EnterLoading`). `null`이면 걷는다(실패 · 확인 메일) */
  onPhase: (phase: EnterPhase | null) => void;
  /** 처음 채울 이메일 — 계정 생성 안내에서 [입장하러 가기]로 넘어올 때 */
  initialEmail?: string | undefined;
  /** 다른 팝업으로 넘어간다(계정 생성 → 입장, 이메일을 들고) */
  onSwitch?: (mode: 'login' | 'signup', email: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  useLang();
  // 지난번에 들어왔던 이메일로 시작한다 — 비밀번호는 비워 둔다(브라우저의
  // 비밀번호 관리자가 채울 자리다).
  // 계정 생성은 빈 칸에서 시작한다 — 지난 이메일은 이미 있는 계정의 것이다
  const [email, setEmail] = useState(() => initialEmail ?? (mode === 'login' ? lastEmail() : ''));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 「메일을 보냈다」 안내 — 회원가입 확인 메일과 비밀번호 재설정 메일 둘 다 쓴다 */
  const [sent, setSent] = useState<'confirm' | 'reset' | null>(null);
  /** 이미 가입한 이메일로 계정 생성을 눌렀다(`signUp`의 `exists`) */
  const [exists, setExists] = useState(false);
  /** 청동 명패는 한 줄이라야 한다 — 긴 번역이면 글자를 줄인다 */
  const title = mode === 'login' ? t('title.loginTitle') : t('title.signup');
  const titleRef = useFitText<HTMLHeadingElement>(title);

  /** 세 갈래(로그인·회원가입·재설정)가 같은 바쁨·오류·안내 칸을 쓴다 */
  const run = (work: () => Promise<void>): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSent(null);
    setExists(false);
    work()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  /**
   * 입성 — 인증 왕복은 로딩 화면(`EnterLoading`)이, 프로필 왕복은 **입장 하늘**(`EnterSky`, 2026-10-19)이 덮는다.
   * 인증만 덮고 둘째 왕복을 비워 두면 [입장]이 「입장」으로 돌아온 채 멈춰 「잘못 넣었나」가 된다.
   * 인증이 끝나도 로딩 화면을 **걷지 않는다** — 걷으면 어두운 가리개가 툭 사라져 「갑자기 다 사라진다」로 보였다(기획자 실기).
   * 이 팝업 · 간판 단추와 함께 0.7초 동안 흐려진다(`#frame[data-sky] .scr-title > *`), 그 뒤 하늘이 올라간다.
   * 실패하면 걷고 오류는 이 팝업이 그대로 말한다.
   */
  const enter = (auth: () => Promise<boolean>): void => run(async () => {
    onPhase('auth');
    try {
      if (!(await auth())) { onPhase(null); return; }
      await onSignedIn();
    } catch (err) {
      onPhase(null);
      throw err;
    }
  });

  const runSignIn = (): void => enter(() => signIn(email, password).then(() => true));

  const runSignUp = (): void => enter(() => signUp(email, password).then((result) => {
    if (!result.confirmed) {
      if (result.exists) setExists(true);
      else setSent('confirm');
    }
    return result.confirmed;
  }));

  /**
   * 계정 생성 팝업의 안내는 [취소] 밑 글줄이 아니라 **팝업 하나 더**다 (2026-10-19 기획자 지정) — 확인 메일 · 이미 가입함 · 오류.
   * 확인 메일과 이미 가입함은 [입장]으로 이어지는 일이라 그 이메일을 들고 입장 팝업으로 넘긴다.
   */
  const notice: null | 'confirm' | 'exists' | 'error' = mode !== 'signup' ? null
    : exists ? 'exists' : sent === 'confirm' ? 'confirm' : error ? 'error' : null;
  const dismiss = (): void => { setExists(false); setSent(null); setError(null); };
  const toLogin = (): void => (onSwitch ? onSwitch('login', email.trim()) : dismiss());

  // 이메일 없이 누르면 Supabase가 422로 답하는데, 그 문장이 사용자에게는
  // 「무엇을 어떻게 해야 하는지」를 안 알려 준다 — 여기서 먼저 막고 한 줄로 말한다.
  const runReset = (): void => {
    if (!email.trim()) { setError(t('title.resetNeedEmail')); setSent(null); return; }
    run(() => resetPassword(email).then(() => setSent('reset')));
  };

  return (
    <>
    <div className="modal-back" onClick={onClose}>
      {/* 안쪽을 누르는 것은 닫기가 아니다 — 바깥을 눌러야 닫힌다(`SettingsModal`과 같다) */}
      <form
        className="modal mod-plank login-modal" data-modal={mode}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (mode === 'login') runSignIn(); else runSignUp(); }}
      >
        <h2 className="modal-ttl fit" ref={titleRef}>{title}</h2>

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
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            maxLength={80}
            placeholder={t('title.password')}
            data-field="password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <BrushIcon />
        </div>

        {/* **`type="button"`을 꼭 적는다** — 폼 안의 버튼은 기본이 `submit`이라,
            빼면 [비밀번호 초기화]·[취소]가 전부 로그인(계정 생성)을 시도한다. */}
        {mode === 'login' ? (
          <>
            <button className="btn primary wide" type="submit" data-action="enter" disabled={busy}>
              {busy ? t('title.working') : t('title.enter')}
            </button>
            <button className="btn wide" type="button" data-action="reset" disabled={busy} onClick={runReset}>
              {t('title.reset')}
            </button>
          </>
        ) : (
          <button className="btn wide" type="submit" data-action="signup" disabled={busy}>
            {busy ? t('title.working') : t('title.signup')}
          </button>
        )}
        <button className="btn wide" type="button" data-action="loginCancel" onClick={onClose}>
          {t('title.cancel')}
        </button>

        {/* 입장 팝업의 안내는 그대로 글줄이다 — 계정 생성의 안내는 아래 팝업이 말한다 */}
        {mode === 'login' && sent === 'reset' && <p className="hint" data-field="resetSent">{t('title.resetSent', { email })}</p>}
        {mode === 'login' && error && <p className="hint" data-field="error">{t('title.error', { msg: error })}</p>}
      </form>
    </div>
    {notice && (
      <div className="modal-back" onClick={dismiss}>
        <div className="modal mod-plank login-notice" data-modal="signupNotice" data-kind={notice} onClick={(e) => e.stopPropagation()}>
          <h2 className="modal-ttl">{t('title.notice')}</h2>
          <p className="row" data-field={notice}>
            {notice === 'confirm' ? t('title.confirmEmail', { email })
              : notice === 'exists' ? t('title.signupExists', { email })
                : t('title.error', { msg: error ?? '' })}
          </p>
          {notice === 'exists' && (
            <button className="btn primary wide" type="button" data-action="noticeToLogin" onClick={toLogin}>
              {t('title.toLogin')}
            </button>
          )}
          <button
            className={notice === 'confirm' ? 'btn primary wide' : 'btn wide'}
            type="button"
            data-action="noticeOk"
            // 확인 메일을 보냈으면 다음 일은 메일함 → [입장]이다 — 그 이메일을 든 입장 팝업으로 넘긴다
            onClick={notice === 'confirm' ? toLogin : dismiss}
          >
            {t('title.ok')}
          </button>
        </div>
      </div>
    )}
    </>
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
