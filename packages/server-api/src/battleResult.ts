/**
 * 전투 결과를 계정에 반영하는 **공통 마지막 한 걸음** — AI 재생 검증(H3c)·온라인
 * 정산(H3d)·무승부 택1이 전부 여기로 모인다. 셋의 차이는 「`outcome`을 누가,
 * 얼마나 믿고 만드는가」뿐이고 반영 자체(`applyBattleResult` + 저장)는 하나다.
 */
import { applyBattleResult } from '@samchess/meta';
import type { BattleOutcome, BattleRewards, PlayerProfile } from '@samchess/meta';
import { settleCarried } from '@samchess/meta';
import { mutateProfile } from './profileStore.ts';

export type SettleResult =
  | { ok: true; profile: PlayerProfile; rewards: BattleRewards }
  | { ok: false; status: 404 | 400; reason: string };

export async function settleOutcome(uid: string, outcome: BattleOutcome, seed: number): Promise<SettleResult> {
  return mutateProfile<SettleResult>(uid, (profile) => {
    if (!profile) return { next: null, value: { ok: false, status: 404, reason: 'no profile' } };
    try {
      const applied = applyBattleResult(profile, outcome, seed);
      // **판이 끝났다 — 들고 나간 것을 내려놓는다** (2026-09-23, GDD §6.5).
      // 액티브든 패시브든 **참전 자체가 소모**라 돌아오는 것이 없다. 그래서
      // 「누가 썼나」를 여기까지 나를 필요도 없다 — 그 값을 서버가 검증할 수 없는
      // 경로(무승부 택1)가 있어 규칙 쪽에서 닫았다(`settleCarried` 주석).
      const next = settleCarried(applied.profile, true);
      return { next, value: { ok: true, profile: next, rewards: applied.rewards } };
    } catch (e) {
      return { next: null, value: { ok: false, status: 400, reason: e instanceof Error ? e.message : 'invalid outcome' } };
    }
  });
}
