/**
 * 온라인 대전 결과를 계정에 반영하는 마지막 한 걸음(H3d) — `BattleRoom`이 이미 판정한 `outcome`을
 * `applyBattleResult` + 저장으로 넘긴다. AI 대전은 `aiBattle.ts`가 재생 검증과 함께 같은 함수를 부른다.
 * (2026-10-27까지는 무승부 택1(`/battle/draw-result`)도 여기로 왔다 — 무승부가 패배 보상이 되며 없어졌다)
 */
import { applyBattleResult } from '@samchess/meta';
import type { BattleOutcome, BattleRewards, PlayerProfile } from '@samchess/meta';
import { settleCarried } from '@samchess/meta';
import { readBan } from './ban.ts';
import { mutateProfile } from './profileStore.ts';

export type SettleResult =
  | { ok: true; profile: PlayerProfile; rewards: BattleRewards }
  | { ok: false; status: 404 | 400 | 403; reason: string };

export async function settleOutcome(
  uid: string, outcome: BattleOutcome, seed: number,
): Promise<SettleResult> {
  // **정지된 계정에는 보상을 안 준다** (2026-10-20). 사용자 토큰 길은 `verifyToken`이 이미 막지만, 정지 전에 시작된
  // 온라인 대전은 재접속 · 좌석 예약이 `onAuth`를 다시 안 불러 끝까지 돌고, 끝나면 `/internal/battle-result`(서버 간
  // 비밀)로 여기 온다. 판은 끝까지 두되 반영은 여기서 거절한다 — 대전 서버는 실패를 로그로만 남긴다(`economy.ts`).
  if (await readBan(uid)) return { ok: false, status: 403, reason: 'account_banned' };
  return mutateProfile<SettleResult>(uid, (profile) => {
    if (!profile) return { next: null, value: { ok: false, status: 404, reason: 'no profile' } };
    try {
      const applied = applyBattleResult(profile, outcome, seed);
      // **판이 끝났다 — 들고 나간 것을 내려놓는다** (2026-09-23, GDD §6.5).
      // 액티브든 패시브든 **참전 자체가 소모**라 돌아오는 것이 없다. 그래서
      // 「누가 썼나」를 여기까지 나를 필요도 없다 — 규칙 쪽에서 닫았다(`settleCarried` 주석).
      const next = settleCarried(applied.profile, true, outcome.opponent);
      return { next, value: { ok: true, profile: next, rewards: applied.rewards } };
    } catch (e) {
      return { next: null, value: { ok: false, status: 400, reason: e instanceof Error ? e.message : 'invalid outcome' } };
    }
  });
}
