/**
 * 관리자 확인 — Supabase 액세스 토큰 + `app_metadata.role === 'admin'` + **MFA(TOTP)를 지난 세션**.
 *
 * `../auth.ts`의 `verifyToken()`과 같은 길(`/auth/v1/user`)을 지나는데, 그 응답에
 * `app_metadata`가 이미 실려 있어 왕복이 더 늘지 않는다. **JWT 안의 클레임을 믿지 않고
 * 매번 DB 값을 읽는 셈이라** 역할을 거두면 다음 요청부터 바로 막힌다(토큰 만료를 기다리지 않는다).
 *
 * `app_metadata`는 사용자가 스스로 못 바꾼다(`user_metadata`와 다르다) — 정하는 길은
 * 서비스 키를 쥔 Admin API뿐이고, 이 저장소에서는 `tools/admin_role.ts`다.
 *
 * **MFA (2026-10-21)** — 비밀번호만으로 받은 토큰(`aal1`)은 관리자 API에 못 들어온다. 판정은 둘 다 본다:
 * - 토큰의 `aal === 'aal2'` — TOTP를 이 세션에서 지났다. 서명은 방금 `/auth/v1/user`가 받아 준 그 토큰이라 따로 보지 않는다.
 * - 같은 응답의 `factors`에 인증된 TOTP가 있다 — factor를 지워도(`admin:role -- --reset-mfa`) 이미 받은 `aal2` 토큰은
 *   만료까지 `aal2`로 남는다(실측). 지금 factor가 없으면 그 토큰도 막는다.
 * 역할을 MFA보다 먼저 본다 — 관리자가 아닌 계정에게 「MFA를 등록하라」고 하지 않는다.
 * aal1 토큰으로는 이미 인증된 factor를 지우거나 새로 더하지 못한다(Supabase가 `insufficient_aal`) — 비밀번호만 털려도 MFA는 못 바꾼다.
 */
import { readAuthUser } from '@samchess/meta';
import type { AdminUser } from './types.ts';

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_ANON_KEY = process.env['SUPABASE_ANON_KEY'];
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('SUPABASE_URL/SUPABASE_ANON_KEY가 없다 — .env를 확인할 것');

export type { AdminUser };

/**
 * 토큰이 없거나 틀리면 `unauthorized`(401), 로그인은 됐는데 관리자가 아니면 `forbidden`(403),
 * 관리자인데 이 세션이 MFA를 안 지났으면 `mfa_required`(403)
 */
export async function verifyAdmin(authHeader: string | undefined): Promise<AdminUser | 'unauthorized' | 'forbidden' | 'mfa_required'> {
  if (!authHeader?.startsWith('Bearer ')) return 'unauthorized';
  const token = authHeader.slice('Bearer '.length);
  if (!token) return 'unauthorized';

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY!, Authorization: `Bearer ${token}` },
  });
  const body: unknown = await res.json().catch(() => null);
  // 판정은 게임 API · 대전 서버와 같은 `readAuthUser`다 — 정지된 관리자도 들어오지 못한다
  const r = readAuthUser(res.status, body, token, Date.now());
  if (r.kind !== 'ok') return 'unauthorized';
  if (r.appMetadata['role'] !== 'admin') return 'forbidden';
  if (jwtAal(token) !== 'aal2' || !hasVerifiedTotp(body)) return 'mfa_required';
  return { uid: r.uid, email: r.email };
}

/** JWT 가운데 토막의 `aal` */
function jwtAal(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { aal?: unknown };
    return typeof payload.aal === 'string' ? payload.aal : null;
  } catch {
    return null;
  }
}

/** `/auth/v1/user` 응답의 `factors[]`에 인증을 마친 TOTP가 있는가 */
function hasVerifiedTotp(body: unknown): boolean {
  const factors = (body as { factors?: unknown } | null)?.factors;
  return Array.isArray(factors) && factors.some((f: { status?: unknown; factor_type?: unknown }) =>
    f?.status === 'verified' && f?.factor_type === 'totp');
}
