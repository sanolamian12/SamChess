/**
 * 도적떼 — 서버 쪽 세 행위: 시작 · 결과 · 항복 (GDD §5.11)
 *
 * 모양은 도시 행위와 같다 — 잠근 행 위에서 `@samchess/meta`의 순수 함수를 부르고,
 * 시각과 시드는 **서버가 넣는다.** 클라이언트가 보내는 것은 결과에서 사람이 낸 의도뿐이다.
 *
 * ────────────────────────────────────────────────────────────────
 * 결과는 AI 대전처럼 재생해서 믿는다 (H3c)
 * ────────────────────────────────────────────────────────────────
 *
 * 판은 클라이언트의 `LocalTransport`가 실시간으로 돌린다. 끝나면 사람이 낸 의도만 올라오고,
 * 서버는 **시작할 때 굳혀 둔 것**(`raid.battle` — 시드 · 시각 · 파수꾼)과 출몰 때 굳은
 * 도적 수로 판을 다시 만들어 처음부터 돌린다(`raidBattleConfig` → `replayLocalMatch`).
 * 클라이언트가 고칠 수 있는 값이 판에 들어가지 않는다.
 *
 * **재생이 어긋나면 항복으로 정산한다.** 조작된 기록이 공짜가 되면 안 되고, 싸우는 중으로
 * 남겨 두면 60분 동안 출정이 막힌다. 항복 약탈은 언제나 패배 약탈보다 크거나 같으므로
 * 정직한 패배를 조작으로 바꿔 얻는 것이 없다.
 */

import { randomInt } from 'node:crypto';
import {
  canStartRaid, raidActive, raidBattleConfig, settleRaid, startRaid, surrenderRaid,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { BANDIT_SIDE, GUARD_SIDE, countFallen, replayLocalMatch } from '@samchess/rules';
import type { Intent } from '@samchess/rules';
import { mutateProfile } from './profileStore.ts';

export type RaidActionResult =
  | { ok: true; profile: PlayerProfile }
  | { ok: false; status: number; reason: string; code?: string };

const fail = (status: number, reason: string, code?: string): RaidActionResult =>
  ({ ok: false, status, reason, ...(code ? { code } : {}) });

/** [지금 전투] — 시드를 내고 그날의 도적떼를 써 버린다 */
export async function startRaidAction(uid: string): Promise<RaidActionResult> {
  const now = Date.now();
  const seed = randomInt(0, 2 ** 31);
  return mutateProfile<RaidActionResult>(uid, (profile) => {
    if (!profile) return { next: null, value: fail(404, 'no profile') };
    const check = canStartRaid(profile, now);
    if (!check.ok) return { next: null, value: fail(409, check.reason, check.code) };
    const next = startRaid(profile, now, seed);
    return { next, value: { ok: true, profile: next } };
  });
}

/** [항복] — 알림에서든 전투 화면에서든 */
export async function surrenderRaidAction(uid: string): Promise<RaidActionResult> {
  const now = Date.now();
  return mutateProfile<RaidActionResult>(uid, (profile) => {
    if (!profile) return { next: null, value: fail(404, 'no profile') };
    if (!raidActive(profile.raid)) return { next: null, value: fail(409, '항복할 도적떼가 없다', 'raid.none') };
    const next = surrenderRaid(profile, now);
    return { next, value: { ok: true, profile: next } };
  });
}

/**
 * 끝난 판 — 재생해 검증하고 정산한다. 60분을 넘겨 이미 항복으로 정산됐으면
 * (`mutateProfile`이 먼저 민다) 싸우는 중이 아니라 409다.
 */
export async function settleRaidAction(uid: string, humanIntents: readonly Intent[]): Promise<RaidActionResult> {
  const now = Date.now();
  return mutateProfile<RaidActionResult>(uid, (profile) => {
    if (!profile) return { next: null, value: fail(404, 'no profile') };
    if (profile.raid?.status !== 'fighting') {
      return { next: null, value: fail(409, '진행 중인 도적떼 전투가 없다', 'raid.notFighting') };
    }

    const { humanSide, ...config } = raidBattleConfig(profile);
    const replay = replayLocalMatch({
      matchId: config.matchId, mode: config.mode, scenario: 'raid', seed: config.seed,
      humanSide, rosters: config.rosters, deploy: null, humanIntents,
    });
    if (!replay.ok) {
      console.error(`[raid] 재생 실패 — uid=${uid} reason=${replay.reason}`);
      const next = surrenderRaid(profile, now);
      return { next, value: fail(400, replay.reason, 'raid.replayFailed') };
    }

    const { state } = replay;
    const banditsAlive = Object.values(state.units).filter((u) => u.side === BANDIT_SIDE && u.alive).length;
    const next = settleRaid(profile, { winner: state.winner, banditsAlive, fallen: countFallen(state, GUARD_SIDE) }, now);
    return { next, value: { ok: true, profile: next } };
  });
}
