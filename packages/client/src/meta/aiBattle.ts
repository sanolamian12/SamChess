/**
 * AI 대전의 서버 왕복 (2026-10-15 — 판 시작을 서버가 굳힌다, 규칙은 `@samchess/meta`의 `aiBattle.ts`).
 *
 *  · 상대 찾기(`matchAiOnServer`) — 매칭 화면이 미리 만들어 두는 AI 상대. 시드는 서버가 뽑는다.
 *  · 시작(`startAiOnServer`) — [전투준비]. 참가비 · 휴대품을 내고 명단을 굳힌다. **응답을 기다린 뒤 들어간다.**
 *  · 싸우는 동안 — 도적떼와 같은 수 업로더(`RaidIntentUploader`에 경로만 바꿔 쓴다).
 *  · 정산(`settleAiBattle`) — 사람이 낸 의도만 보낸다. 서버는 적어 둔 판만 한 번 정산한다.
 *
 * **못 닿으면 `null`** — 부르는 쪽이 예전 방식(클라이언트 시드 · 로컬 반영)으로 물러난다. 「서버가 꺼져 있어도 게임은 돈다」
 * (§5-61). 그 판은 끊기면 이어 둘 수 없다 — 서버에 적힌 것이 없다.
 */
import type { BattleMode, Intent } from '@samchess/rules';
import type { AiBattleState, BattleRewards, MatchOpponent, PlayerProfile, RosterPick } from '@samchess/meta';
import { authedFetch } from './storage.ts';
import { migrateProfile } from '@samchess/meta';

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await authedFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { code?: string };
      console.warn(`[ai-battle] ${path} → ${res.status} ${json.code ?? ''}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[ai-battle] ${path}에 못 닿았다`, err);
    return null;
  }
}

/** 상대를 찾는다 — 서버가 뽑은 시드와 그 시드로 만든 상대 */
export const matchAiOnServer = (mode: BattleMode, picks: readonly RosterPick[], squadId: string | null) =>
  post<{ seed: number; opponent: MatchOpponent }>('/battle/ai-match', { mode, picks, squadId });

/** 싸우기 시작한다 — 참가비가 빠진 계정과 굳힌 판 */
export async function startAiOnServer(): Promise<{ profile: PlayerProfile; ai: AiBattleState } | null> {
  const body = await post<{ profile: unknown; ai: AiBattleState }>('/battle/ai-start', {});
  const profile = body ? migrateProfile(body.profile) : null;
  return body && profile ? { profile, ai: body.ai } : null;
}

/** 끝난 판을 정산한다 — 승 · 무 · 패 모두(무승부는 패배와 같은 보상, 2026-10-27) */
export async function settleAiBattle(humanIntents: readonly Intent[]):
  Promise<{ profile: PlayerProfile; rewards: BattleRewards } | null> {
  const body = await post<{ profile?: unknown; rewards?: BattleRewards }>('/battle/ai-result', { humanIntents });
  if (!body) return null;
  const profile = migrateProfile(body.profile);
  return profile && body.rewards ? { profile, rewards: body.rewards } : null;
}
