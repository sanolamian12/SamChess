/**
 * Supabase가 발급한 액세스 토큰을 검증한다.
 *
 * `packages/server-api/src/auth.ts`와 **같은 방식**(`/auth/v1/user` 호출)이지만
 * **별도 사본**이다 — `server-api`와 `server`(Colyseus)는 완전히 분리된 프로세스라
 * 서로 import하지 않는다(§5-54·89). 입력도 다르다: 여기서 검증하는 값은 Colyseus의
 * `static onAuth(token, …)`이 이미 "Bearer " 없이 넘겨주는 **원 토큰**이다.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없다 — .env를 확인할 것`);
  return v;
}

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_ANON_KEY = requireEnv('SUPABASE_ANON_KEY');

export interface AuthedUser {
  uid: string;
}

export async function verifyAccessToken(token: string | undefined): Promise<AuthedUser | null> {
  if (!token) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { id?: string };
  return body.id ? { uid: body.id } : null;
}
