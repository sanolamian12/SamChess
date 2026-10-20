/**
 * 정지된 계정 (2026-10-20) — 서버가 「정지」라고 답한 순간을 한 곳에 모아 화면(`App`)이 안내를 띄운다.
 *
 * 정지는 세 길로 온다. 셋이 각자 화면을 띄우면 하나만 낡으므로, 셋 다 `reportBan()`만 부른다.
 *
 * | 어디서 | 응답 | 기간 · 사유 |
 * |---|---|---|
 * | 계정 API (`storage.ts`의 `authedFetch`) | `403 { error: 'account_banned', until, reason }` | 있다 |
 * | Supabase 로그인 · 토큰 갱신 (`auth.ts`) | `400 { error_code: 'user_banned' }` | 없다 — 세션이 없어 못 묻는다 |
 * | 대전 서버 대기열 (`matchmaking.ts`) | `ServerError(403, 'account_banned')` | 없다 — 계정 API에 한 번 물어 채운다 |
 *
 * **오프라인으로 보지 않는다.** 예전에는 403도 「서버에 못 닿음」이라 캐시로 물러나 「서버가 이상하다」로 보였다.
 * 정지를 판정하는 쪽은 서버(`@samchess/meta`의 `readAuthUser`)이고 여기는 그 답을 옮기기만 한다.
 */

import { ACCOUNT_BANNED } from '@samchess/meta';

export interface BanNotice {
  /** 정지가 풀리는 시각(ISO). 모르면 `null`(로그인 · 대기열에서 막힌 경우) */
  until: string | null;
  reason: string | null;
}

/** 이 오류가 오면 부르는 쪽은 폴백(오프라인 · 로컬 계산)하지 말고 멈춘다 — 안내는 `App`이 띄운다 */
export class AccountBannedError extends Error {
  readonly notice: BanNotice;
  // 매개변수 속성은 Node의 타입 지우기가 못 지운다 — 필드로 적는다
  constructor(notice: BanNotice) {
    super(ACCOUNT_BANNED);
    this.name = 'AccountBannedError';
    this.notice = notice;
  }
}

let current: BanNotice | null = null;
const listeners = new Set<(n: BanNotice) => void>();

/**
 * 정지를 알린다. 같은 정지를 여러 길이 겹쳐 알려도 되고, **나중에 온 기간 · 사유가 빈칸을 채운다**
 * (대기열이 먼저 「정지」만 알리고 계정 API가 기간을 뒤따라 실어 오는 경우).
 */
export function reportBan(notice: BanNotice): void {
  current = {
    until: notice.until ?? current?.until ?? null,
    reason: notice.reason ?? current?.reason ?? null,
  };
  for (const cb of listeners) cb(current);
}

/** 정지 안내를 듣는다. 이미 알려진 정지가 있으면 곧바로 한 번 부른다(구독보다 먼저 온 경우). 돌려준 함수로 끊는다 */
export function onBan(cb: (n: BanNotice) => void): () => void {
  listeners.add(cb);
  if (current) cb(current);
  return () => { listeners.delete(cb); };
}

/** 안내를 닫고 로그아웃한 뒤 — 다른 계정으로 들어오면 그 계정은 정지가 아닐 수 있다 */
export function clearBan(): void { current = null; }

/** 계정 API 응답이 정지인지 본다. 본문을 읽으므로 **복제본**을 넘긴다(`res.clone()`) */
export async function banFromResponse(res: Response): Promise<BanNotice | null> {
  if (res.status !== 403) return null;
  const body = await res.json().catch(() => null) as { error?: unknown; until?: unknown; reason?: unknown } | null;
  if (body?.error !== ACCOUNT_BANNED) return null;
  return {
    until: typeof body.until === 'string' ? body.until : null,
    reason: typeof body.reason === 'string' && body.reason ? body.reason : null,
  };
}

/** 이보다 멀면 「영구」로 보인다 — 관리자 화면의 「영구」는 100년이다(`admin/store.ts`) */
const FOREVER_MS = 50 * 365 * 24 * 3600_000;

/**
 * 안내의 기간 줄 — `forever` · `until`(풀리는 시각) · `unknown`.
 * 시각은 `YYYY.MM.DD HH:mm`로 **언어와 무관한 꼴**이다(`ForgeScreen`의 `formatMade`와 같은 까닭).
 */
export function banTerm(n: BanNotice, nowMs: number): { kind: 'forever' } | { kind: 'until'; at: string } | { kind: 'unknown' } {
  const ms = n.until ? Date.parse(n.until) : NaN;
  if (!Number.isFinite(ms)) return { kind: 'unknown' };
  if (ms - nowMs > FOREVER_MS) return { kind: 'forever' };
  const d = new Date(ms);
  const p = (v: number): string => String(v).padStart(2, '0');
  return { kind: 'until', at: `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` };
}
