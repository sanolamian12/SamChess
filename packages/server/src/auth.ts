/**
 * Supabase가 발급한 액세스 토큰을 검증한다.
 *
 * `packages/server-api/src/auth.ts`와 **같은 방식**(`/auth/v1/user` 호출)이지만
 * **별도 사본**이다 — `server-api`와 `server`(Colyseus)는 완전히 분리된 프로세스라
 * 서로 import하지 않는다(§5-54·89). 입력도 다르다: 여기서 검증하는 값은 Colyseus의
 * `static onAuth(token, …)`이 이미 "Bearer " 없이 넘겨주는 **원 토큰**이다.
 *
 * 응답을 읽는 판정은 사본이 아니다 — `@samchess/meta`의 `readAuthUser` 하나를 게임 API · 관리자 API와 함께 쓴다.
 * **정지된 계정이면 `ServerError(403, 'account_banned')`를 던진다** — 대기열(`QueueRoom`)과 방(`BattleRoom`)에
 * 못 들어오고, 게임 화면은 그 코드로 「정지된 계정」 안내를 띄운다. 이미 시작된 판은 여기를 다시 안 지나므로
 * 끝까지 돌고, 보상은 게임 API의 정산(`settleOutcome`)이 거절한다.
 */
import { ServerError } from '@colyseus/core';
import { ACCOUNT_BANNED, readAuthUser } from '@samchess/meta';

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
  const body: unknown = await res.json().catch(() => null);
  const r = readAuthUser(res.status, body, token, Date.now());
  if (r.kind === 'banned') throw new ServerError(403, ACCOUNT_BANNED);
  return r.kind === 'ok' ? { uid: r.uid } : null;
}
