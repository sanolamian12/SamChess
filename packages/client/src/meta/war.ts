/**
 * 선전포고의 서버 왕복 (2026-10-28, GDD §8.8 단계 4 — 서버는 `server-api/src/war.ts`, 규칙은 `@samchess/meta`의 `war.ts`).
 *
 *  · 걸기(`declareWar`) — 「누구에게 · 어느 모드 · 내 어느 부대로」만. 명단은 서버가 계정에서 낸다.
 *  · 묻기(`fetchWar`) — 걸려 있는 동안 두 화면이 `WAR_POLL_MS`마다. 받은 선전포고는 접속 핑(`presence.ts`)이 싣고 온다.
 *  · 응전 · 거절(`replyWar`) · 수락 · 취소(`answerWar`).
 *
 * 선전포고는 서버 없이는 안 된다 — 못 닿으면 `code: 'net'`이고 화면이 「다시 시도」를 적는다(로컬로 물러나지 않는다).
 */
import type { BattleMode } from '@samchess/rules';
import type { WarView } from '@samchess/meta';
import { authedFetch } from './storage.ts';

export type WarReply = { ok: true; war: WarView } | { ok: false; code: string; params?: Record<string, number> };

async function call(path: string, init?: RequestInit): Promise<WarReply> {
  try {
    const res = await authedFetch(path, init);
    const body = (await res.json().catch(() => ({}))) as { war?: WarView; code?: string; params?: Record<string, number> };
    if (!res.ok || !body.war) return { ok: false, code: body.code ?? `http.${res.status}`, ...(body.params ? { params: body.params } : {}) };
    return { ok: true, war: body.war };
  } catch {
    return { ok: false, code: 'net' };
  }
}

const post = (path: string, body: unknown): Promise<WarReply> =>
  call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const declareWar = (defenderId: string, mode: BattleMode, squadId: string): Promise<WarReply> =>
  post('/war/declare', { defenderId, mode, squadId });

export const fetchWar = (id: string): Promise<WarReply> => call(`/war/${encodeURIComponent(id)}`);

/** 받은 쪽 — 부대 id로 [응전], `null`이면 [거절] */
export const replyWar = (id: string, squadId: string | null): Promise<WarReply> =>
  post(`/war/${encodeURIComponent(id)}/reply`, { squadId });

/** 건 쪽 — `true`면 [수락], `false`면 [취소] */
export const answerWar = (id: string, accept: boolean): Promise<WarReply> =>
  post(`/war/${encodeURIComponent(id)}/accept`, { accept });
