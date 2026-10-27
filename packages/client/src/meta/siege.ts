/**
 * 공성전의 서버 왕복 (2026-10-27, GDD §8.8 단계 2 — 서버는 `server-api/src/siege.ts`).
 *
 *  · 도시 목록(`fetchSiegeTargets`) — 탭(추천 · 상위 도전)마다 한 번. 못 받으면 `null`(화면이 「불러오지 못했다」를 적는다).
 *  · 상대 정하기(`matchSiegeOnServer`) — 「누구를」만 보낸다. 서버가 그 순간의 수비군을 읽어 판의 상대로 굳힌다.
 *    그 뒤 시작 · 덧붙이기 · 정산은 AI 대전과 같은 함수다(`aiBattle.ts`의 `startAiOnServer` · `settleAiBattle`).
 *
 * **공성전은 서버 없이는 안 된다** — 상대가 다른 사람의 도시라 로컬로 지어낼 수 없다. AI 대전처럼 로컬로 물러나지 않는다.
 */
import type { BattleMode } from '@samchess/rules';
import type { MatchOpponent, RosterPick, SiegeListRow, SiegeTab } from '@samchess/meta';
import { authedFetch } from './storage.ts';

export async function fetchSiegeTargets(mode: BattleMode, tab: SiegeTab): Promise<SiegeListRow[] | null> {
  try {
    const res = await authedFetch(`/siege/targets?mode=${mode}&tab=${tab}`);
    if (!res.ok) { console.warn(`[siege] 목록 → ${res.status}`); return null; }
    return ((await res.json()) as { rows: SiegeListRow[] }).rows;
  } catch (err) {
    console.warn('[siege] 목록에 못 닿았다', err);
    return null;
  }
}

/** 상대를 정한다 — 거절되면 이유 코드(`siege.noTarget` · `siege.lowerCity` …)를 돌려준다 */
export async function matchSiegeOnServer(defenderId: string, mode: BattleMode, picks: readonly RosterPick[], squadId: string | null):
  Promise<{ ok: true; seed: number; opponent: MatchOpponent } | { ok: false; code: string }> {
  try {
    const res = await authedFetch('/siege/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defenderId, mode, picks, squadId }),
    });
    const body = (await res.json().catch(() => ({}))) as { code?: string; seed?: number; opponent?: MatchOpponent };
    if (!res.ok || !body.opponent || body.seed === undefined) return { ok: false, code: body.code ?? `http.${res.status}` };
    return { ok: true, seed: body.seed, opponent: body.opponent };
  } catch {
    return { ok: false, code: 'net' };
  }
}
