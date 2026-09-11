/**
 * Supabase Auth — 이메일 로그인/회원가입과 세션 보관.
 *
 * `@supabase/supabase-js`를 쓰지 않는다 — `packages/server-api/src/auth.ts`와 같은 결로
 * 이 저장소는 최소 의존성을 우선한다(CLAUDE.md). REST 엔드포인트를 그대로 `fetch`한다.
 *
 * 세션은 `localStorage`(`samchess.session`)에 두고, 액세스 토큰이 곧 만료되면
 * `getAccessToken()`이 리프레시 토큰으로 자동 갱신한다 — 부르는 쪽은 만료를 몰라도 된다.
 *
 * **확인 메일이 켜져 있으면 `signUp`이 세션 없이 끝난다.** 개발 단계에는 끄기로
 * 했었지만(Supabase 대시보드 설정) 그 설정과 무관하게 코드가 두 응답 모양을
 * 다 받아야 한다 — 확인 메일이 켜진 프로젝트에서는 `/auth/v1/signup`이 `user`로
 * 감싸지 않고 유저 필드를 **최상위에 바로** 돌려주고 `access_token`이 없다.
 * `signUp()`이 그 경우를 `{ confirmed: false }`로 구분해 돌려준다 — 부르는 쪽이
 * "메일함을 확인하세요"로 안내한다.
 */

interface Session {
  uid: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** epoch ms. 이 시각을 지나면(또는 임박하면) 갱신한다 */
  expiresAt: number;
}

const KEY = 'samchess.session';

/**
 * 마지막으로 **로그인에 성공한** 이메일(2026-09-11). 세션(`KEY`)과 따로 두는 이유는
 * 둘의 수명이 다르기 때문이다 — 로그아웃·토큰 만료로 세션이 사라져도 「누구로
 * 들어왔었는가」는 남아야 다음에 이메일을 다시 타이핑하지 않는다.
 *
 * **비밀번호는 여기 안 넣는다.** 평문으로 `localStorage`에 두면 같은 브라우저를
 * 쓰는 누구나·그 출처에서 도는 모든 스크립트가 읽는다. 대신 입력칸에
 * `autocomplete`를 제대로 붙여(`username`/`current-password`) **브라우저·OS의
 * 비밀번호 관리자**가 저장을 맡는다 — 그쪽은 OS 잠금 뒤에 있고 출처까지 검증한다.
 * 「다시 안 적어도 들어간다」는 이미 세션 쪽이 해 준다(리프레시 토큰이 남아 있으면
 * `App.tsx`의 부팅이 간판 화면을 건너뛴다).
 */
const LAST_EMAIL_KEY = 'samchess.lastEmail';

/** `.env`의 `VITE_` 접두사 값만 번들에 들어온다(Vite) */
function env(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string {
  const v = (import.meta as { env?: Record<string, string | undefined> }).env?.[name];
  if (!v) throw new Error(`${name}이 없다 — .env를 확인할 것`);
  return v;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string };
}

interface ErrorResponse {
  error?: string;
  error_description?: string;
  msg?: string;
}

/** `signup`은 확인 메일이 켜져 있으면 아래와 다른 모양(유저 필드가 최상위)으로 온다 */
interface SignupUnconfirmedResponse {
  id: string;
  email?: string;
}

async function rawAuthFetch(path: string, body: unknown): Promise<TokenResponse & ErrorResponse & SignupUnconfirmedResponse> {
  const res = await fetch(`${env('VITE_SUPABASE_URL')}${path}`, {
    method: 'POST',
    headers: { apikey: env('VITE_SUPABASE_ANON_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as TokenResponse & ErrorResponse & SignupUnconfirmedResponse;
  if (!res.ok) throw new Error(data.error_description ?? data.msg ?? data.error ?? '로그인에 실패했다');
  return data;
}

async function authFetch(path: string, body: unknown): Promise<TokenResponse> {
  const data = await rawAuthFetch(path, body);
  if (!data.access_token || !data.user) throw new Error('로그인에 실패했다 — 서버 응답에 세션이 없다');
  return data;
}

function toSession(t: TokenResponse): Session {
  return {
    uid: t.user.id,
    email: t.user.email ?? '',
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  };
}

function save(session: Session): Session {
  try { localStorage.setItem(KEY, JSON.stringify(session)); } catch { /* 무시 */ }
  // 세션을 저장하는 자리가 곧 「로그인에 성공한 자리」다 — 이메일 기억을 부르는
  // 쪽에 맡기면 로그인·회원가입·토큰 갱신 셋 중 하나를 잊는다.
  if (session.email) {
    try { localStorage.setItem(LAST_EMAIL_KEY, session.email); } catch { /* 무시 */ }
  }
  return session;
}

/** 지난번에 들어왔던 이메일. 없으면 빈 문자열 — 입력칸의 초기값으로 쓴다. */
export function lastEmail(): string {
  try { return localStorage.getItem(LAST_EMAIL_KEY) ?? ''; } catch { return ''; }
}

export type SignUpResult =
  | { confirmed: true; session: Session }
  /** 확인 메일이 켜진 프로젝트 — 세션 없이 끝난다. 메일함을 확인한 뒤 `signIn`으로 들어온다 */
  | { confirmed: false };

export async function signUp(email: string, password: string): Promise<SignUpResult> {
  const data = await rawAuthFetch('/auth/v1/signup', { email, password });
  if (!data.access_token || !data.user) return { confirmed: false };
  return { confirmed: true, session: save(toSession(data)) };
}

export function signIn(email: string, password: string): Promise<Session> {
  return authFetch('/auth/v1/token?grant_type=password', { email, password }).then((t) => save(toSession(t)));
}

export function signOut(): void {
  // `LAST_EMAIL_KEY`는 **남긴다** — 로그아웃은 「이 계정에서 나간다」이지
  // 「이 기기를 남에게 넘긴다」가 아니다. 이메일까지 지우면 다시 들어올 때마다
  // 타이핑하게 된다(그게 이 값을 둔 이유다).
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
}

/**
 * 비밀번호 재설정 메일(2026-09-11). Supabase가 메일을 보내고, 링크를 누르면
 * 대시보드의 Site URL로 돌아온다 — **재설정 화면은 아직 이 앱에 없다**(링크는
 * Supabase가 호스팅하는 기본 페이지로 간다). 그 화면을 앱 안에 붙이려면
 * `redirectTo`를 붙이고 복구 토큰을 받는 경로를 따로 만들어야 한다.
 *
 * **없는 계정에도 200이 온다** — Supabase가 일부러 그렇게 답한다(어느 이메일이
 * 가입돼 있는지를 알려 주지 않기 위해서다). 그래서 화면은 「보냈다」까지만
 * 말할 수 있고, 「그런 계정이 없다」는 말할 수 없다.
 */
export async function resetPassword(email: string): Promise<void> {
  await rawAuthFetch('/auth/v1/recover', { email });
}

function loadRaw(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as Session : null;
  } catch {
    return null;
  }
}

/** 갱신 없이 지금 세션을 읽는다 — uid·이메일을 화면에 보여 줄 때 쓴다 */
export function currentSession(): Session | null {
  return loadRaw();
}

/** 만료까지 이 안에 남으면 미리 갱신한다 — 요청 도중에 만료되는 것을 피한다 */
const REFRESH_MARGIN_MS = 60_000;

/**
 * 지금 쓸 수 있는 액세스 토큰. 만료가 임박했으면 리프레시 토큰으로 먼저 갱신한다.
 * 세션이 없거나 갱신에 실패하면(리프레시 토큰도 죽었다) `null` — **로그아웃 처리는
 * 부르는 쪽이 한다**(다시 로그인해야 하니까).
 */
export async function getAccessToken(): Promise<string | null> {
  const session = loadRaw();
  if (!session) return null;
  if (session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return session.accessToken;

  try {
    const t = await authFetch('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refreshToken });
    return save(toSession(t)).accessToken;
  } catch {
    signOut();
    return null;
  }
}
