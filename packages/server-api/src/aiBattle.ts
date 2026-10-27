/**
 * AI 대전 — **판 시작을 서버가 굳히고, 적힌 판만 한 번 정산한다** (2026-10-15, 규칙은 `@samchess/meta`의 `aiBattle.ts`).
 *
 * AI 대전은 여전히 `LocalTransport`(클라이언트 프로세스)가 실시간으로 판정한다 — 서버가 판마다 방을 붙들지 않는다
 * (§5-96, 부하 때문에 기각한 안). 바뀐 것은 판의 **앞과 뒤**다.
 *  · 상대 찾기(`/battle/ai-match`) — 시드를 서버가 뽑는다(`randomInt`). 예전에는 클라이언트가 부대마다 같은 시드를 댔다.
 *  · 시작(`/battle/ai-start`) — 참가비 · 휴대품을 내고 명단 · 배치를 굳힌다. 예전 `/battle/fee`의 자리다.
 *  · 싸우는 동안(`/battle/ai-intents`) — 도적떼와 같은 덧붙이기. 끊기면 이것으로 그 자리에서 이어 둔다.
 *  · 정산(`/battle/ai-result`) — 적힌 판을 재생해 맞으면 반영하고 **지운다.** 예전에는 같은 승리 기록을 다시 보내면
 *    보상이 다시 나왔다(시드 · 상대 눈금도 클라이언트 값이었다).
 *
 * 무승부도 이 정산을 지난다 — 패배와 같은 보상이라 고를 것이 없다(2026-10-27, 예전에는 택1 뒤 `/battle/draw-result`).
 *
 * 모든 쓰기는 `mutateProfile()`(행 잠금) 안에서 meta의 순수 함수로 한다. 시작 + 60분이 지난 판은 그 읽기 자체가
 * 패배로 정산한다(`syncAiBattle`).
 */
import { randomInt } from 'node:crypto';
import {
  aiOpponentOf, appendAiIntents, matchAiBattle, settleAiBattleIntents, startAiBattle,
} from '@samchess/meta';
import type { AiBattleState, BattleRewards, MatchOpponent, PlayerProfile, RosterPick, SettledAi } from '@samchess/meta';
import type { BattleMode, Intent } from '@samchess/rules';
import { mutateProfile } from './profileStore.ts';
import { logDefense } from './siege.ts';

export type AiAction<T> =
  | ({ ok: true } & T)
  | { ok: false; status: 400 | 404 | 409; reason: string; code?: string; params?: Record<string, number> };

const NO_PROFILE = { ok: false as const, status: 404 as const, reason: 'no profile' };
/** 규칙이 거절한 것 — 「상태가 맞지 않는다」는 409, 모양이 틀린 것은 400 */
const rejected = (r: { reason: string; code: string; params?: Record<string, number> }) => ({
  ok: false as const, status: (r.code === 'ai.badPicks' || r.code === 'ai.cannotStart' ? 400 : 409) as 400 | 409,
  reason: r.reason, code: r.code, ...(r.params ? { params: r.params } : {}),
});

/** 1. 상대를 찾는다 — 시드는 서버가 뽑는다. 군량은 안 낸다 */
export async function matchAiAction(uid: string, mode: BattleMode, picks: readonly RosterPick[], squadId: string | null):
  Promise<AiAction<{ seed: number; opponent: MatchOpponent }>> {
  const seed = randomInt(0, 2 ** 31);
  return mutateProfile<AiAction<{ seed: number; opponent: MatchOpponent }>>(uid, (profile) => {
    if (!profile) return { next: null, value: NO_PROFILE };
    const r = matchAiBattle(profile, mode, picks, squadId, seed);
    if (!r.ok) return { next: null, value: rejected(r) };
    return { next: r.profile, value: { ok: true, seed: r.ai.seed, opponent: aiOpponentOf(r.ai) } };
  });
}

/**
 * 2. 싸우기 시작한다 — 참가비 · 휴대품 · 명단 굳히기가 한 번에. **출정의 문**이라 도적떼를 출몰시키고, 살아 있으면 막는다.
 * 막혔어도 방금 출몰한 도적떼는 저장한다(`next: profile`) — `applyGrainAction`과 같은 까닭(안 그러면 10분이 다시 선다).
 */
export async function startAiAction(uid: string): Promise<AiAction<{ profile: PlayerProfile; ai: AiBattleState }>> {
  const now = Date.now();
  return mutateProfile<AiAction<{ profile: PlayerProfile; ai: AiBattleState }>>(uid, (profile) => {
    if (!profile) return { next: null, value: NO_PROFILE };
    const r = startAiBattle(profile, now);
    if (!r.ok) return { next: profile, value: rejected(r) };
    return { next: r.profile, value: { ok: true, profile: r.profile, ai: r.ai } };
  }, { spawnRaid: true });
}

/** 싸우는 동안 낸 의도를 덧붙인다 — 저장된 길이만 돌려준다(매 수마다 오는 요청이다) */
export async function appendAiIntentsAction(uid: string, from: number, intents: readonly Intent[]):
  Promise<AiAction<{ have: number }>> {
  return mutateProfile<AiAction<{ have: number }>>(uid, (profile) => {
    if (!profile) return { next: null, value: NO_PROFILE };
    const r = appendAiIntents(profile, from, intents);
    if (!r.ok) return { next: null, value: rejected(r) };
    return { next: r.profile, value: { ok: true, have: r.profile.aiBattle?.intents?.length ?? 0 } };
  });
}

/** 3. 끝난 판을 정산한다 — 적힌 판만, 한 번만 */
export async function settleAiAction(uid: string, humanIntents: readonly Intent[]):
  Promise<AiAction<{ profile: PlayerProfile; rewards: BattleRewards }>> {
  const now = Date.now();
  let settled: SettledAi | null = null;
  return mutateProfile<AiAction<{ profile: PlayerProfile; rewards: BattleRewards }>>(uid, (profile) => {
    if (!profile) return { next: null, value: NO_PROFILE };
    const r = settleAiBattleIntents(profile, humanIntents, now);
    if (!r.ok) {
      if (r.code === 'ai.replayFailed') console.error(`[ai-battle] 재생 실패 — uid=${uid} reason=${r.reason}`);
      return { next: null, value: rejected(r) };
    }
    settled = r.settled;
    return { next: r.profile, value: { ok: true, profile: r.profile, rewards: r.rewards } };
  }, {
    // 공성전이면 방어 기록을 **같은 트랜잭션에서** 덧붙인다(GDD §8.8) — 정산과 기록이 갈리지 않는다
    onWrite: async (tx, _prev, next) => {
      const s = settled as SettledAi | null;
      if (s) await logDefense(tx, uid, next, s.ai, s.result, s.intents, 'settled');
    },
  });
}
