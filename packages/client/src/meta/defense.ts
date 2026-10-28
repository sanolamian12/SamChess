/**
 * 방어 기록의 서버 왕복 (2026-10-28, GDD §8.8 단계 5 — 서버는 `server-api/src/defense.ts`, 읽는 규칙은 `@samchess/meta`의 `defense.ts`).
 *
 * 방어 기록은 서버에만 있다 — 못 닿으면 `null`이고 화면이 「불러오지 못했다」를 적는다(로컬로 지어내지 않는다).
 * 안 본 판(`fetchDefenseUnseen`)만은 못 닿아도 조용하다 — 팝업 · 표지가 안 뜰 뿐이다.
 */
import type { DefenseReplayData, DefenseRow, DefenseSummary, DefenseUnseen } from '@samchess/meta';
import { authedFetch } from './storage.ts';

export async function fetchDefense(): Promise<{ rows: DefenseRow[]; summary: DefenseSummary } | null> {
  try {
    const res = await authedFetch('/defense');
    if (!res.ok) { console.warn(`[defense] 목록 → ${res.status}`); return null; }
    return (await res.json()) as { rows: DefenseRow[]; summary: DefenseSummary };
  } catch {
    return null;
  }
}

export async function fetchDefenseUnseen(): Promise<DefenseUnseen | null> {
  try {
    const res = await authedFetch('/defense/unseen');
    return res.ok ? ((await res.json()) as DefenseUnseen) : null;
  } catch {
    return null;
  }
}

/** 목록을 열었다 — 지금까지의 판을 다 본 것으로 */
export async function markDefenseSeen(): Promise<void> {
  try { await authedFetch('/defense/seen', { method: 'POST' }); } catch { /* 다음에 다시 표지가 뜰 뿐이다 */ }
}

/** 다시 볼 재료 — 규칙이 바뀐 판이면 `'stale'` */
export async function fetchDefenseReplay(id: number): Promise<DefenseReplayData | 'stale' | null> {
  try {
    const res = await authedFetch(`/defense/${id}/replay`);
    if (res.status === 409) return 'stale';
    return res.ok ? ((await res.json()) as DefenseReplayData) : null;
  } catch {
    return null;
  }
}
