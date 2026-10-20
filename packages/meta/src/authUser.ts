/**
 * Supabase `/auth/v1/user` 응답 읽기 — **로그인 확인 세 곳이 함께 쓰는 하나** (2026-10-20).
 *
 * 같은 호출이 세 벌 있다: 게임 API(`server-api/src/auth.ts`) · 대전 서버(`server/src/auth.ts`) ·
 * 관리자 API(`server-api/src/admin/auth.ts`). 프로세스가 갈라져 있어 호출은 각자 하되, **응답을 읽는 판정은
 * 여기 하나다** — 한 곳만 정지를 보면 나머지가 조용히 뚫린다.
 *
 * 정지된 계정의 응답은 **두 모양을 다 받는다.** 외부 서비스의 설정은 코드만 읽어서는 드러나지 않는다:
 *
 * | 모양 | 언제 |
 * |---|---|
 * | `403 { error_code: 'user_banned' }` | 실측(2026-10-20) — 정지 전에 받은 토큰도 바로 이렇게 거절된다 |
 * | `200 { id, banned_until: 미래 }` | 서버 설정 · 버전에 따라 이렇게 통과시킬 수도 있다 — 그래도 정지로 본다 |
 *
 * 403 모양에는 본문에 uid가 없어 **토큰의 `sub`를 읽는다.** 서명은 여기서 확인하지 않지만, Supabase가
 * `user_banned`라고 답한 것은 토큰을 이미 검증하고 그 사용자를 찾았다는 뜻이다(틀린 토큰은 다른 오류다).
 *
 * **순수 함수다** — 호출(I/O)은 부르는 쪽이 한다.
 */

export type AuthUserCheck =
  | { kind: 'ok'; uid: string; email: string; appMetadata: Record<string, unknown> }
  /** `uid`는 토큰에서 못 읽었으면 `null` — 정지인 것은 확실하다 */
  | { kind: 'banned'; uid: string | null }
  | { kind: 'invalid' };

/** 게임 API · 대전 서버가 정지된 계정에 돌려주는 오류 코드 — 게임 화면이 이 값으로 「정지된 계정」 안내를 띄운다 */
export const ACCOUNT_BANNED = 'account_banned';

export function readAuthUser(status: number, body: unknown, token: string, nowMs: number): AuthUserCheck {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  if (status === 403 && b['error_code'] === 'user_banned') return { kind: 'banned', uid: jwtSub(token) };
  if (status !== 200 || typeof b['id'] !== 'string' || !b['id']) return { kind: 'invalid' };

  const uid = b['id'];
  const until = typeof b['banned_until'] === 'string' ? Date.parse(b['banned_until']) : NaN;
  if (until > nowMs) return { kind: 'banned', uid };

  const meta = b['app_metadata'];
  return {
    kind: 'ok',
    uid,
    email: typeof b['email'] === 'string' ? b['email'] : '',
    appMetadata: meta && typeof meta === 'object' ? meta as Record<string, unknown> : {},
  };
}

/** JWT 가운데 토막의 `sub`. 서명은 보지 않는다(머리말) */
function jwtSub(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(atob(b64)) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}
