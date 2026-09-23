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
      // **판이 끝났다 — 들고 나간 것을 정산한다** (2026-09-23, GDD §6.5).
      // 패시브는 참전만으로 소모되고 **안 쓴 액티브만** 돌아온다. 항복·패배도
      // 여기로 오므로 「지겠다 싶으면 다 쓰고 항복」이 공짜가 되지 않는다.
      //
      // ⚠ `usedBy`가 아직 **언제나 빈 배열**이다 — 액티브를 쓰는 의도(`useItem`)가
      // 엔진에 없어 **쓸 방법 자체가 없다.** 붙으면 그때 실제로 쓴 장수를 넘긴다.
      const next = settleCarried(applied.profile, [], true);
      return { next, value: { ok: true, profile: next, rewards: applied.rewards } };
    } catch (e) {
      return { next: null, value: { ok: false, status: 400, reason: e instanceof Error ? e.message : 'invalid outcome' } };
    }
  });
}
