/**
 * 관리자 확인 — Supabase 액세스 토큰 + `app_metadata.role === 'admin'`.
 *
 * `../auth.ts`의 `verifyToken()`과 같은 길(`/auth/v1/user`)을 지나는데, 그 응답에
 * `app_metadata`가 이미 실려 있어 왕복이 더 늘지 않는다. **JWT 안의 클레임을 믿지 않고
 * 매번 DB 값을 읽는 셈이라** 역할을 거두면 다음 요청부터 바로 막힌다(토큰 만료를 기다리지 않는다).
 *
 * `app_metadata`는 사용자가 스스로 못 바꾼다(`user_metadata`와 다르다) — 정하는 길은
 * 서비스 키를 쥔 Admin API뿐이고, 이 저장소에서는 `tools/admin_role.ts`다.
 */
import { readAuthUser } from '@samchess/meta';
import type { AdminUser } from './types.ts';

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_ANON_KEY = process.env['SUPABASE_ANON_KEY'];
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('SUPABASE_URL/SUPABASE_ANON_KEY가 없다 — .env를 확인할 것');

export type { AdminUser };

/** 토큰이 없거나 틀리면 `unauthorized`(401), 로그인은 됐는데 관리자가 아니면 `forbidden`(403) */
export async function verifyAdmin(authHeader: string | undefined): Promise<AdminUser | 'unauthorized' | 'forbidden'> {
  if (!authHeader?.startsWith('Bearer ')) return 'unauthorized';
  const token = authHeader.slice('Bearer '.length);
  if (!token) return 'unauthorized';

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY!, Authorization: `Bearer ${token}` },
  });
  // 판정은 게임 API · 대전 서버와 같은 `readAuthUser`다 — 정지된 관리자도 들어오지 못한다
  const r = readAuthUser(res.status, await res.json().catch(() => null), token, Date.now());
  if (r.kind !== 'ok') return 'unauthorized';
  if (r.appMetadata['role'] !== 'admin') return 'forbidden';
  return { uid: r.uid, email: r.email };
}
