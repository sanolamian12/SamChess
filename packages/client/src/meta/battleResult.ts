/**
 * 무승부 택1 반영 — 서버로 보낸다 (H3d). `PUT /profile`이 더는 `grain`을 안 믿게
 * 되면서(서버가 시간 충전·전투 보상만 정본으로 친다), 무승부의 군량 보상은 로컬
 * `applyBattleResult` + `PUT`으로는 더 이상 계정에 남지 않는다 — 이 경로가 그 자리다.
 * AI든 온라인이든 갈리지 않는다(GDD §6.4가 이미 그렇게 정했다).
 */
import type { BattleMode, OfficerId } from '@samchess/rules';
import type {
  BattleOutcome, BattleRewards, DrawReward, OpponentKind, PlayerProfile, RosterPick,
} from '@samchess/meta';
import { authedFetch } from './storage.ts';
import { migrateProfile } from '@samchess/meta';

export interface DrawResultRequest {
  mode: BattleMode;
  opponent: OpponentKind;
  seed: number;
  drawPick: DrawReward;
  picks: readonly RosterPick[];
  kills?: Readonly<Record<OfficerId, number>>;
  power: { mine: number; theirs: number };
  opponentId: string | null;
  mySquad: string | null;
  theirSquad: string | null;
}

export function drawResultRequest(outcome: BattleOutcome & { drawPick: DrawReward }, seed: number): DrawResultRequest {
  return {
    mode: outcome.mode, opponent: outcome.opponent, seed, drawPick: outcome.drawPick,
    picks: outcome.picks, ...(outcome.kills ? { kills: outcome.kills } : {}), power: outcome.power,
    opponentId: outcome.opponentId ?? null, mySquad: outcome.mySquad ?? null, theirSquad: outcome.theirSquad ?? null,
  };
}

export async function settleDrawResult(
  req: DrawResultRequest,
): Promise<{ profile: PlayerProfile; rewards: BattleRewards } | null> {
  try {
    const res = await authedFetch('/battle/draw-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`POST /battle/draw-result → ${res.status}`);
    const body = (await res.json()) as { profile: unknown; rewards: BattleRewards };
    const profile = migrateProfile(body.profile);
    if (!profile) throw new Error('서버가 잘못된 프로필을 줬다');
    return { profile, rewards: body.rewards };
  } catch (err) {
    console.warn('[draw-result] 무승부 반영에 실패했다', err);
    return null;
  }
}
