/**
 * AI 대전 결과를 **재생해서 검증**하고, 맞으면 그 자리에서 보상까지 반영한다.
 *
 * AI 대전은 `LocalTransport`(클라이언트 프로세스)가 실시간으로 판정한다 —
 * 화면·속도는 그대로 두고(§5-96 설계안 참조, 서버 방을 매 판 붙드는 대안은 부하
 * 때문에 기각했다), **판이 끝난 뒤에만** 서버가 개입한다. 클라이언트는 사람이 낸
 * 의도의 순서만 넘기고, 서버는 계정에서 직접 뽑은 로스터 · 같은 시드로 다시 만든
 * AI 상대로 **처음부터 다시 재생**해 같은 결말이 나오는지 본다
 * (`@samchess/rules`의 `replayLocalMatch`).
 *
 * **클라이언트가 대는 값 중 신뢰 경계 밖인 것은 셋뿐이다** — 사람 쪽 로스터는
 * 서버가 가진 계정에서 다시 만들고(계정에 없는 장수·레벨은 자칭 불가), 배치
 * 프리셋도 계정의 저장된 부대에서 다시 찾는다. `targetPower`(AI 상대를 고르는
 * 눈금)는 클라이언트 값을 믿지만, 보상표(GDD §6.4)가 상대 세기와 무관하게
 * 고정이라 경제적 이득은 없다(알려진 채로 남기는 자리 — §5-96 계획 참조).
 *
 * **무승부는 이 라우트를 쓰지 않는다** — "셋 중 하나를 고르기 전까지 계정에
 * 아무것도 반영하지 않는다"(GDD §6.4)가 그대로라, 무승부는 지금처럼 클라이언트가
 * 택1을 고른 뒤 로컬 `applyBattleResult` + `PUT /profile`한다.
 */
import {
  applyBattleResult, battlePower, makeAiOpponent, squadDeployment, toRosterEntries,
} from '@samchess/meta';
import type { BattleOutcome, PlayerProfile, RosterPick } from '@samchess/meta';
import { countKills, replayLocalMatch } from '@samchess/rules';
import type { BattleMode, Intent, OfficerId } from '@samchess/rules';
import { getProfile, saveProfile } from './profileStore.ts';

export interface AiBattleRequest {
  mode: BattleMode;
  seed: number;
  /** AI 상대를 고르는 눈금 — `makeAiOpponent`가 클라이언트 미리보기와 같은 값을 받아야
   * 정확히 같은 상대가 나온다(같은 시드의 순수 함수라서다) */
  targetPower: number;
  exclude: readonly OfficerId[];
  picks: readonly RosterPick[];
  /** 배치 프리셋을 찾을 부대. 없으면(즉석 편성이었거나 못 찾으면) 기본 배치 */
  squadId: string | null;
  humanIntents: readonly Intent[];
}

export type AiBattleResult =
  | { ok: true; profile: PlayerProfile; rewards: ReturnType<typeof applyBattleResult>['rewards'] }
  | { ok: false; status: 404 | 400; reason: string };

export async function settleAiBattle(uid: string, req: AiBattleRequest): Promise<AiBattleResult> {
  const profile = await getProfile(uid);
  if (!profile) return { ok: false, status: 404, reason: 'no profile' };

  let myEntries;
  try {
    myEntries = toRosterEntries(profile, req.picks);
  } catch (e) {
    return { ok: false, status: 400, reason: e instanceof Error ? e.message : 'invalid picks' };
  }

  const opponent = makeAiOpponent(req.mode, req.targetPower, req.seed, req.exclude);

  const squad = req.squadId ? profile.squads.find((s) => s.id === req.squadId) ?? null : null;
  const deploy = squad ? squadDeployment(profile, squad, 'P1') : null;

  const replay = replayLocalMatch({
    matchId: `ai-${uid}-${req.seed}`,
    mode: req.mode,
    seed: req.seed,
    humanSide: 'P1',
    rosters: { P1: myEntries, P2: opponent.entries },
    deploy,
    humanIntents: req.humanIntents,
  });
  if (!replay.ok) {
    console.error(`[ai-battle] 재생 실패 — uid=${uid} reason=${replay.reason}`);
    return { ok: false, status: 400, reason: replay.reason };
  }
  const { state } = replay;
  if (state.winner === null) return { ok: false, status: 400, reason: '무승부는 이 경로를 쓰지 않는다' };

  const result = state.winner === 'P1' ? 'win' : 'lose';
  const outcome: BattleOutcome = {
    result, mode: req.mode, opponent: 'ai', picks: req.picks,
    kills: countKills(state, 'P1'),
    power: { mine: battlePower(req.mode, myEntries), theirs: battlePower(req.mode, opponent.entries) },
    at: Date.now(),
    opponentId: null, mySquad: squad?.name ?? null, theirSquad: null,
  };

  const applied = applyBattleResult(profile, outcome, req.seed);
  const saved = await saveProfile(uid, applied.profile);
  return { ok: true, profile: saved ?? applied.profile, rewards: applied.rewards };
}
