/**
 * 방어 기록의 서버 왕복 (2026-10-28, GDD §8.8 단계 5 — 서버는 `server-api/src/defense.ts`, 읽는 규칙은 `@samchess/meta`의 `defense.ts`).
 *
 * 지금 읽는 자리는 병영의 모드 줄(수성 성공 · `summary.heldByMode`) 하나다 — 대자보의 [방어 기록 보기] 목록 · 리플레이와
 * 안 본 판 팝업 · 표지는 2026-11-20에 걷었다(기획자). 못 닿으면 `null`이고 화면이 「—」를 적는다(로컬로 지어내지 않는다).
 */
import type { DefenseRow, DefenseSummary } from '@samchess/meta';
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
