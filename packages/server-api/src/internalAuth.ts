/**
 * `/internal/*` 엔드포인트의 인증 — 사용자 토큰이 아니라 **서버 간 공유 비밀**이다.
 *
 * `packages/server`(Colyseus)가 참가비·거절 군량·환불을 재검증하려고 부르는 자리라
 * 사람(Supabase 액세스 토큰)이 아니라 우리 자신의 다른 프로세스를 인증한다 —
 * `auth.ts`(사용자용)와 갈라 둔 이유다.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없다 — .env를 확인할 것`);
  return v;
}

const INTERNAL_API_SECRET = requireEnv('INTERNAL_API_SECRET');

export function verifyInternalSecret(header: string | undefined): boolean {
  return header === INTERNAL_API_SECRET;
}
