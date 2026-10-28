/**
 * 접속 상태 핑 (2026-10-28, GDD §8.8 단계 3 — 서버는 `server-api/src/presence.ts`). 부르는 자리는 `App.tsx` 하나다.
 *
 * 「여기 있다」만 보낸다 — 시각은 서버가 찍는다. **실패해도 아무 말 없이 넘어간다** — 핑이 빠지면 내 도시가 잠시
 * 「미접속」으로 보일 뿐이고 게임은 그대로다(다음 핑이 고친다). 응답은 지금 비어 있고, 단계 4에서 「받은 선전포고」가 실린다.
 */
import { authedFetch } from './storage.ts';

export async function pingPresence(): Promise<void> {
  try {
    const res = await authedFetch('/presence', { method: 'POST' });
    if (!res.ok) console.warn(`[presence] 핑 → ${res.status}`);
  } catch {
    // 서버에 못 닿았다 · 로그아웃 중 — 다음 핑이 다시 간다
  }
}
