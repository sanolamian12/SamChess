/**
 * **AI 대전 — 판 시작을 서버가 굳힌다** (2026-10-15 기획자 확정).
 *
 * 예전에는 시드를 클라이언트가 정했고(부대마다 늘 같은 값) 서버는 판이 끝난 뒤에만 재생했다. 그래서
 *  · 끊기면 판이 사라졌다(도적떼 · 온라인은 이어 둔다) — 이것이 처음 요청이었다.
 *  · **같은 승리 기록을 다시 보내면 보상이 매번 다시 나왔다** — 서버가 「이 판을 이미 정산했나」를 몰랐다.
 *    시드 · 상대 눈금도 클라이언트 값 그대로였다. 조사하다 드러났다.
 *
 * 이제 걸음이 셋이다 — 모두 서버(`server-api`)가 이 모듈의 순수 함수로 계정 행 잠금 안에서 민다.
 *  1. **상대 찾기**(`matchAiBattle`) — 서버가 시드를 뽑고 계정 명단으로 전투력을 재서 상대를 만든다. 군량은 안 낸다
 *     (매칭만 하고 뒤로 가면 한 톨도 안 나간다 — CLAUDE.md 「참가비」). 다시 찾으면 덮는다.
 *  2. **시작**(`startAiBattle`) — 참가비 · 휴대품을 내고 명단 · 배치를 그 순간의 값으로 굳힌다.
 *  3. **정산**(`settleAiBattleIntents`) — 적힌 판을 덧붙여 둔 수로 시작하는 기록으로 재생해 맞으면 반영하고 **지운다**.
 *     두 번째 정산은 지울 판이 없어 거절된다.
 * 싸우는 동안은 도적떼와 같은 덧붙이기(`appendAiIntents`, 규칙은 `intentLog.ts`)이고, 시작 + 60분이 지나도록 안 끝나면
 * 읽는 순간 **패배로 정산**한다(`syncAiBattle` — 기획자 확정: 지금의 [항복]과 같아 얻는 것도 잃는 것도 없다).
 *
 * meta는 시계 · 난수를 안 읽는다 — 시각과 시드는 인자로 받는다.
 */
import { countFallen, countKills, createBattle, apply, replayLocalMatch, replayPrefix, validate } from '@samchess/rules';
import type { BattleMode, BattleState, Intent, OfficerId } from '@samchess/rules';
import { makeAiOpponent } from './match.ts';
import { battlePower } from './power.ts';
import { consumeCarried, settleCarried } from './market.ts';
import { sortieGate } from './tutorial.ts';
import { applyBattleResult } from './rewards.ts';
import { spendGrain, toRosterEntries } from './roster.ts';
import { squadDeployment } from './squads.ts';
import { appendIntentLog, startsWithIntents } from './intentLog.ts';
import type { MatchOpponent } from './match.ts';
import type { AiBattleState, BattleOutcome, BattleRewards, PlayerProfile, RosterPick } from './types.ts';

/** 끊긴 AI 대전이 패배로 정산되기까지 — 도적떼와 같은 60분(기획자 확정) */
export const AI_ABANDON_MS = 60 * 60 * 1000;

export type AiFail = { ok: false; reason: string; code: string; params?: Record<string, number> };
const fail = (code: string, reason: string, params?: Record<string, number>): AiFail =>
  ({ ok: false, reason, code, ...(params ? { params } : {}) });

/** 지금 싸우는 중인 AI 대전 — 없으면 `null` */
export const fightingAi = (profile: PlayerProfile): AiBattleState | null =>
  profile.aiBattle?.status === 'fighting' ? profile.aiBattle : null;

/** 화면이 들고 다니는 상대 모양으로 — 매칭 화면 · 전투 화면이 같은 값을 그린다 */
export const aiOpponentOf = (ai: AiBattleState): MatchOpponent =>
  ({ kind: 'ai', id: null, squadName: null, entries: ai.foe.entries, power: ai.foe.power });

/**
 * 1. 상대를 찾는다 — 서버가 뽑은 `seed`로. 전투력은 **시각 없이** 잰다(부상 · 컬렉션이 매칭을 흔들지 않는다 —
 * `toRosterEntries` 머리말, 매칭 화면과 같은 눈금). 싸우는 중이면 받지 않는다.
 */
export function matchAiBattle(
  profile: PlayerProfile, mode: BattleMode, picks: readonly RosterPick[], squadId: string | null, seed: number,
): { ok: true; profile: PlayerProfile; ai: AiBattleState } | AiFail {
  if (fightingAi(profile)) return fail('ai.inProgress', '끝나지 않은 AI 대전이 있다');
  let mine;
  try {
    mine = toRosterEntries(profile, picks);
  } catch (e) {
    return fail('ai.badPicks', e instanceof Error ? e.message : 'invalid picks');
  }
  const exclude = mine.map((e) => e.officer);
  const foe = makeAiOpponent(mode, battlePower(mode, mine), seed >>> 0, exclude);
  const ai: AiBattleState = {
    status: 'matched', mode, seed: seed >>> 0,
    picks: picks.map((p) => ({ piece: p.piece, officer: p.officer })),
    squadId, foe: { entries: foe.entries, power: foe.power },
  };
  return { ok: true, profile: { ...profile, aiBattle: ai }, ai };
}

/**
 * 2. 싸우기 시작한다 — 참가비를 내고 들고 가는 시장 아이템을 내려놓는다(예전 `/battle/fee`와 같은 자리).
 * 명단은 **시작 시각**으로 만들어 굳힌다(부상 · 태학 개량 · 컬렉션). 배치도 이 순간의 부대 것을 굳힌다.
 * 도적떼가 살아 있으면 막는다(GDD §5.11) — 거절 코드는 예전 그대로 `raid.blocksSortie`다.
 */
export function startAiBattle(profile: PlayerProfile, nowMs: number):
  { ok: true; profile: PlayerProfile; ai: AiBattleState } | AiFail {
  const ai = profile.aiBattle;
  if (ai?.status !== 'matched') return fail('ai.notMatched', '시작할 AI 대전이 없다 — 상대를 다시 찾는다');
  // 기본 튜토리얼 · 도적떼(GDD §5.11) — 거절 코드는 막은 쪽의 것이다(예전 그대로 `raid.blocksSortie`도)
  const gate = sortieGate(profile);
  if (!gate.ok) return fail(gate.code ?? 'raid.blocksSortie', gate.reason);
  const startedAt = Math.floor(nowMs);
  let next: PlayerProfile;
  let entries;
  try {
    entries = toRosterEntries(profile, ai.picks, startedAt);
    next = spendGrain(profile, ai.mode);
  } catch (e) {
    return fail('ai.cannotStart', e instanceof Error ? e.message : 'cannot start');
  }
  next = consumeCarried(next, ai.picks.map((p) => p.officer), 'ai');
  const squad = ai.squadId ? profile.squads.find((s) => s.id === ai.squadId) ?? null : null;
  const fighting: AiBattleState = {
    ...ai, status: 'fighting', startedAt, entries,
    deploy: squad ? squadDeployment(profile, squad, 'P1') : null, intents: [],
  };
  return { ok: true, profile: { ...next, aiBattle: fighting }, ai: fighting };
}

/** 판의 설정 — 클라이언트(첫 판 · 재개)와 서버(덧붙이기 · 정산)가 **같은 값으로** 만든다 */
function replayInput(ai: AiBattleState, intents: readonly Intent[]) {
  return {
    matchId: `ai-${ai.seed}`, mode: ai.mode, seed: ai.seed, humanSide: 'P1' as const,
    rosters: { P1: ai.entries ?? [], P2: ai.foe.entries }, deploy: ai.deploy ?? null, humanIntents: intents,
  };
}

/**
 * 전투 화면이 띄울 판 — 덧붙여 둔 수가 없으면 새 판(배치 프리셋을 깐다), 있으면 그 수까지 재생해 **끊긴 자리**(다음 사람 차례).
 * 새 판도 재생기(`replayPrefix`, 수 0개)에 맡기면 상대의 준비까지 미리 돌아 배치 화면이 비어 보이므로 따로 만든다 —
 * 도적떼 화면과 같은 갈림이다.
 */
export function aiBattleState(ai: AiBattleState): { ok: true; state: BattleState } | { ok: false; reason: string } {
  if (ai.status !== 'fighting' || !ai.entries) return { ok: false, reason: '진행 중인 AI 대전이 없다' };
  const intents = ai.intents ?? [];
  if (intents.length > 0) return replayPrefix(replayInput(ai, intents));
  const input = replayInput(ai, []);
  let state = createBattle({ matchId: input.matchId, seed: input.seed, mode: input.mode, rosters: input.rosters });
  if (input.deploy && validate(state, 'P1', { t: 'deploy', placements: input.deploy }).ok) {
    state = apply(state, 'P1', { t: 'deploy', placements: input.deploy }).state;
  }
  return { ok: true, state };
}

/** 싸우는 동안 낸 의도를 덧붙인다 — 규칙은 도적떼와 같다(`intentLog.ts`) */
export function appendAiIntents(profile: PlayerProfile, from: number, intents: readonly Intent[]):
  { ok: true; profile: PlayerProfile } | AiFail {
  const ai = fightingAi(profile);
  if (!ai) return fail('ai.notFighting', '진행 중인 AI 대전이 없다');
  const r = appendIntentLog(ai.intents ?? [], from, intents, (next) => replayPrefix(replayInput(ai, next)));
  if (!r.ok) return r.kind === 'gap' ? fail('ai.intentsGap', r.reason, { have: r.have }) : fail('ai.intentsRejected', r.reason);
  if (!r.next) return { ok: true, profile };
  return { ok: true, profile: { ...profile, aiBattle: { ...ai, intents: r.next } } };
}

/** 판의 기록 — 승패 정산 · 방치 정산 · 무승부가 같은 모양을 만든다 */
function outcomeOf(ai: AiBattleState, state: BattleState, result: BattleOutcome['result'], at: number, squadName: string | null): BattleOutcome {
  return {
    result, mode: ai.mode, opponent: 'ai', picks: ai.picks,
    kills: countKills(state, 'P1'), fallen: countFallen(state, 'P1') as OfficerId[],
    power: { mine: battlePower(ai.mode, ai.entries ?? []), theirs: ai.foe.power },
    at, opponentId: null, mySquad: squadName, theirSquad: null,
  };
}

const squadNameOf = (profile: PlayerProfile, ai: AiBattleState): string | null =>
  (ai.squadId ? profile.squads.find((s) => s.id === ai.squadId)?.name : null) ?? null;

/**
 * 3. 끝난 판을 정산한다 — **적힌 판만, 한 번만.** 올라온 기록은 덧붙여 둔 수로 시작해야 한다.
 * 무승부도 여기서 반영한다 — 패배와 같은 보상이라 고를 것이 없다(2026-10-27, 예전에는 택1 뒤 `/battle/draw-result`).
 */
export function settleAiBattleIntents(profile: PlayerProfile, humanIntents: readonly Intent[], nowMs: number):
  | { ok: true; profile: PlayerProfile; rewards: BattleRewards }
  | AiFail {
  const ai = fightingAi(profile);
  if (!ai) return fail('ai.notFighting', '정산할 AI 대전이 없다 — 이미 정산했거나 시작하지 않았다');
  if (!startsWithIntents(ai.intents ?? [], humanIntents)) return fail('ai.intentsGap', '덧붙여 둔 수로 시작하지 않는다');
  const replay = replayLocalMatch(replayInput(ai, humanIntents));
  if (!replay.ok) return fail('ai.replayFailed', replay.reason);
  const { state } = replay;
  const result = state.winner === 'P1' ? 'win' : state.winner === null ? 'draw' : 'lose';
  const outcome = outcomeOf(ai, state, result, Math.floor(nowMs), squadNameOf(profile, ai));
  const applied = applyBattleResult(profile, outcome, ai.seed);
  const { aiBattle: _done, ...rest } = settleCarried(applied.profile, true, 'ai');
  return { ok: true, profile: rest, rewards: applied.rewards };
}

/** 손대지 않으면 패배로 정산되는 시각(시작 + 60분) — 싸우는 중이 아니면 `null`. 관리자 화면의 정리 경고도 이것을 띄운다 */
export const aiAbandonAt = (profile: PlayerProfile): number | null => {
  const ai = fightingAi(profile);
  return ai?.startedAt !== undefined ? ai.startedAt + AI_ABANDON_MS : null;
};

/** 끊긴 채 패배로 정산되기까지 남은 시간 — 싸우는 중이 아니면 0 */
export const aiAbandonRemainingMs = (profile: PlayerProfile, nowMs: number): number => {
  const at = aiAbandonAt(profile);
  return at !== null ? Math.max(0, at - nowMs) : 0;
};

/**
 * 읽을 때마다 민다(서버의 `mutateProfile`, 도적떼의 `syncRaid` 옆) — 시작 + 60분이 지난 판을 **패배로 정산**한다.
 * 정산 시각은 「지금」이 아니라 시작 + 60분이다(군량 충전의 「번 만큼만 민다」와 같은 결 — 언제 들러도 같은 값).
 * 덧붙여 둔 수까지의 판으로 전과(격파 · 퇴각)를 센다. 남는 기록은 `abandoned` — 화면이 한 번 알린다.
 */
export function syncAiBattle(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const at = aiAbandonAt(profile);
  if (at === null || nowMs < at) return profile;
  return forfeitAiBattle(profile, at);
}

/**
 * 싸우는 중인 AI 대전을 `at` 시각에 **패배로 정산**한다 — `syncAiBattle`(시작 + 60분)과 관리자의 「지금 정리」
 * (`admin.ts`)가 함께 쓰는 하나다. 싸우는 중이 아니면 그대로 돌려준다.
 */
export function forfeitAiBattle(profile: PlayerProfile, at: number): PlayerProfile {
  const ai = fightingAi(profile);
  if (!ai || ai.startedAt === undefined) return profile;
  const replay = replayPrefix(replayInput(ai, ai.intents ?? []));
  // 재생이 안 되는 기록(덧붙이기가 막으므로 오지 않는다)이면 처음 판으로 센다 — 정산은 막지 않는다
  const fresh = replay.ok ? null : aiBattleState({ ...ai, intents: [] });
  const base = replay.ok ? replay.state : fresh?.ok ? fresh.state : null;
  if (!base) return { ...profile, aiBattle: { ...ai, status: 'abandoned', settledAt: at } };
  const applied = applyBattleResult(profile, outcomeOf(ai, base, 'lose', at, squadNameOf(profile, ai)), ai.seed);
  return { ...settleCarried(applied.profile, true, 'ai'), aiBattle: { ...ai, status: 'abandoned', settledAt: at } };
}
