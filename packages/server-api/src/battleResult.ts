/**
 * 전투 결과를 계정에 반영하는 **공통 마지막 한 걸음** — AI 재생 검증(H3c)·온라인
 * 정산(H3d)·무승부 택1이 전부 여기로 모인다. 셋의 차이는 「`outcome`을 누가,
 * 얼마나 믿고 만드는가」뿐이고 반영 자체(`applyBattleResult` + 저장)는 하나다.
 */
import { applyBattleResult } from '@samchess/meta';
import type { BattleOutcome, BattleRewards, PlayerProfile } from '@samchess/meta';
import { mutateProfile } from './profileStore.ts';

export type SettleResult =
  | { ok: true; profile: PlayerProfile; rewards: BattleRewards }
  | { ok: false; status: 404 | 400; reason: string };

export async function settleOutcome(uid: string, outcome: BattleOutcome, seed: number): Promise<SettleResult> {
  return mutateProfile<SettleResult>(uid, (profile) => {
    if (!profile) return { next: null, value: { ok: false, status: 404, reason: 'no profile' } };
    try {
      const applied = applyBattleResult(profile, outcome, seed);
      return { next: applied.profile, value: { ok: true, profile: applied.profile, rewards: applied.rewards } };
    } catch (e) {
      return { next: null, value: { ok: false, status: 400, reason: e instanceof Error ? e.message : 'invalid outcome' } };
    }
  });
}
