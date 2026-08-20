/**
 * Supabase가 발급한 액세스 토큰을 검증한다.
 *
 * JWKS를 로컬에서 검증하지 않고 Supabase의 `/auth/v1/user`를 그대로 호출한다 —
 * 매 요청마다 왕복이 붙지만, 이 저장소는 최소 의존성을 우선한다(CLAUDE.md).
 * 트래픽이 커지면 그때 로컬 JWKS 검증으로 바꾼다 — 지금 바꾸는 건 이른 최적화다.
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

export async function verifyToken(authHeader: string | undefined): Promise<AuthedUser | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  if (!token) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { id?: string };
  return body.id ? { uid: body.id } : null;
}
