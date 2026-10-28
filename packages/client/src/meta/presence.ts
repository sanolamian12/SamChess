/**
 * 접속 상태 핑 (2026-10-28, GDD §8.8 단계 3 · 4 — 서버는 `server-api/src/war.ts`의 `pingAction`). 부르는 자리는 `App.tsx` 하나다.
 *
 * 「여기 있다」와 「지금 전투 · 튜토리얼 화면이다」(`busy`)를 보낸다 — 시각은 서버가 찍는다. 응답에 **열린 선전포고**가 실려 온다
 * (받은 쪽이면 그 순간이 「화면에 뜬 순간」이라 응답 30초가 거기서 시작한다).
 * **실패해도 아무 말 없이 넘어간다** — 핑이 빠지면 내 도시가 잠시 「미접속」으로 보일 뿐이고 다음 핑이 고친다(`undefined`).
 */
import type { WarView } from '@samchess/meta';
import { authedFetch } from './storage.ts';

export async function pingPresence(busy: boolean): Promise<WarView | null | undefined> {
  try {
    const res = await authedFetch('/presence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ busy }),
    });
    if (!res.ok) { console.warn(`[presence] 핑 → ${res.status}`); return undefined; }
    return ((await res.json().catch(() => ({}))) as { war?: WarView | null }).war ?? null;
  } catch {
    // 서버에 못 닿았다 · 로그아웃 중 — 다음 핑이 다시 간다
    return undefined;
  }
}
