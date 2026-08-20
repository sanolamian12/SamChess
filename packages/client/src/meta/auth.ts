/**
 * Supabase Auth — 이메일 로그인/회원가입과 세션 보관.
 *
 * `@supabase/supabase-js`를 쓰지 않는다 — `packages/server-api/src/auth.ts`와 같은 결로
 * 이 저장소는 최소 의존성을 우선한다(CLAUDE.md). REST 엔드포인트를 그대로 `fetch`한다.
 *
 * 세션은 `localStorage`(`samchess.session`)에 두고, 액세스 토큰이 곧 만료되면
 * `getAccessToken()`이 리프레시 토큰으로 자동 갱신한다 — 부르는 쪽은 만료를 몰라도 된다.
 *
 * **확인 메일은 꺼져 있다**(개발 단계 결정) — `signUp`이 성공하면 그 자리에서 곧바로
 * 세션이 온다. 나중에 켜면 `signUp`의 응답에 `session`이 없는 경우를 갈라야 한다.
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

async function authFetch(path: string, body: unknown): Promise<TokenResponse> {
  const res = await fetch(`${env('VITE_SUPABASE_URL')}${path}`, {
    method: 'POST',
    headers: { apikey: env('VITE_SUPABASE_ANON_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as TokenResponse & ErrorResponse;
  if (!res.ok) throw new Error(data.error_description ?? data.msg ?? data.error ?? '로그인에 실패했다');
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
  return session;
}

export function signUp(email: string, password: string): Promise<Session> {
  return authFetch('/auth/v1/signup', { email, password }).then((t) => save(toSession(t)));
}

export function signIn(email: string, password: string): Promise<Session> {
  return authFetch('/auth/v1/token?grant_type=password', { email, password }).then((t) => save(toSession(t)));
}

export function signOut(): void {
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
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
