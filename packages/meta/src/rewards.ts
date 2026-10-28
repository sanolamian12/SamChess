/**
 * 전투 보상과 전적 — GDD §6.4 · §7 (2026-10-27 전면 개편)
 *
 * ```
 *                 카드 ①                         카드 ②     자재  군량
 * 센 상대에게 승   보유 전원 + 새 B·C              D 전원      1     2
 * 약한 상대에게 승 보유 B 이하 + 새 C              D 전원      —     1     ← 도적떼 승리도 이 줄
 * 센 상대에게 무·패 보유 B 이하 + D 전원           —           —     1
 * 약한 상대에게 무·패 보유 C 이하 + D 전원         —           —     —
 * ```
 *
 * 값은 `economy.json`의 `battleRewards` ← 추출기 `ECONOMY`다. 이 파일은 표를 **읽기만** 한다.
 *
 * ────────────────────────────────────────────────────────────────
 * 상대가 센가 약한가 ★ 2026-10-27 기획자 확정 — 2026-08-17 「격차로 보상을 나누지 않는다」를 뒤집는다
 * ────────────────────────────────────────────────────────────────
 *
 * 예전에는 매칭이 대등한 상대를 붙여 줬으므로 격차를 볼 이유가 없었고, 담합(짜고 큰 이변을 만들어
 * 좋은 카드를 몰아주기)을 막으려 일부러 안 봤다. **공성전에서 상대를 직접 고르게 되자** 같은 보상을
 * 가장 쉬운 상대에게서 받는 길이 열렸다. 그래서 **약한 상대만 깎는다** — 센 상대를 이겨도 더 주지는
 * 않으므로(상위 도전은 레벨 차이가 커도 같은 줄이다) 담합으로 얻을 것은 여전히 없다.
 *
 * 경계는 `rewardTier()` 하나다 — 「상대 전투력 ≥ 내 전투력 − `MATCH_BAND`」면 센 상대(예상 승률 55% 이하).
 * 비슷한 상대가 몇 점 차이로 깎이지 않게 매칭의 「인접」 폭만큼 봐준다. 전투력은 **판이 시작될 때의
 * 값**(`BattleOutcome.power`)이다 — 판 도중 레벨업이 등급을 바꾸지 않는다.
 *
 * **무승부는 패배와 같다** (같은 날 확정). 예전의 「셋 중 택1」은 판정 주체가 사라진 뒤에 오는 경로
 * (`/battle/draw-result`)라 장수 · 격파 · 전투력을 클라이언트 값으로 받아야 했다 — 마지막 남은 위조
 * 여지였는데, 고를 것이 없어지자 무승부도 승 · 패와 같은 정산 길을 지난다.
 *
 * ────────────────────────────────────────────────────────────────
 * AI와 온라인이 갈리지 않는다 ★ 2026-08-18
 * ────────────────────────────────────────────────────────────────
 *
 * 상대가 사람인지 AI인지로 보상이 갈리면 접속 시간대가 곧 보상이 된다. 갈리는 것은 **전투력**뿐이다 —
 * AI 상대는 내 전투력에 맞춰 만들어지므로 언제나 「센 상대」 줄이다.
 */

import { ECONOMY, OFFICERS } from '@samchess/data';
import { hash32 } from '@samchess/rules';
import type { Grade, OfficerId } from '@samchess/rules';
import { addCard, ownedOfficers } from './profile.ts';
import { applyInjuries, grainCap } from './city.ts';
import { fallenAfterShield } from './market.ts';
import { carriedOf } from './types.ts';
import { MATCH_BAND, winChance } from './power.ts';
import { MATCH_LOG_CAP, accountKey, bumpTally, recordKey } from './records.ts';
import type {
  BattleOutcome, BattleResult, BattleRewards, MatchRow, PlayerProfile,
} from './types.ts';

const RW = ECONOMY.battleRewards;

/**
 * 카드 추첨의 등급 가중치 — S×1 · A×2 · B×3 · C×4 · D×5 · E×1 (2026-09-14 기획자 확정).
 * 단일 출처는 `economy.json` ← 추출기의 `ECONOMY`. 화면·서버가 숫자를 다시 적지 않는다.
 */
export const CARD_WEIGHT = RW.gradeWeight as Record<Grade, number>;

/** 카드 한 장의 추첨 풀 — **보유**한 `owned` 등급 + **아직 없는** `fresh` 등급 */
export interface CardPool { owned: readonly Grade[]; fresh: readonly Grade[] }

/** 보상표의 한 줄 — 카드는 칸마다 한 장 */
export interface RewardSpec { cards: readonly CardPool[]; materials: number; grain: number }

/** 상대가 센가 약한가 */
export type RewardTier = 'strong' | 'weak';

/** 보상표의 네 줄 */
export type RewardKey = 'strongWin' | 'weakWin' | 'strongLose' | 'weakLose';

const specOf = (raw: { cards: readonly { ownedGrades: readonly string[]; newGrades: readonly string[] }[]; materials: number; grain: number }): RewardSpec => ({
  cards: raw.cards.map((c) => ({ owned: c.ownedGrades as readonly Grade[], fresh: c.newGrades as readonly Grade[] })),
  materials: raw.materials,
  grain: raw.grain,
});

/** 보상표 — `economy.json`의 네 줄 그대로 */
export const REWARD_TABLE: Readonly<Record<RewardKey, RewardSpec>> = {
  strongWin: specOf(RW.strongWin),
  weakWin: specOf(RW.weakWin),
  strongLose: specOf(RW.strongLose),
  weakLose: specOf(RW.weakLose),
};

/**
 * **센 상대인가** — 상대 전투력이 내 전투력보다 `MATCH_BAND` 넘게 낮을 때만 약한 상대다.
 * 화면이 「보상이 줄어듭니다」를 미리 띄울 때도 이것을 부른다 — 경계를 다시 적지 않는다.
 */
export const rewardTier = (power: { mine: number; theirs: number }): RewardTier =>
  (power.theirs >= power.mine - MATCH_BAND ? 'strong' : 'weak');

/** 결말과 등급으로 보상표의 줄을 고른다 — **무승부는 패배 줄이다** */
export const rewardKey = (result: BattleResult, tier: RewardTier): RewardKey =>
  (result === 'win' ? `${tier}Win` : `${tier}Lose`);

/**
 * **승점** — 이긴 판 하나에 `100 × (1 − 내 예상 승률)` (2026-10-27 기획자 확정, GDD §7).
 *
 * 비슷한 상대를 이기면 50, 이기기 어려웠던 상대일수록 100에 가깝고, 약한 상대를 이겨도 조금은 오른다.
 * 한 판이 100을 넘지 않아 「훨씬 센 상대에 계속 덤벼 한 번 이기기」가 복권이 되지 않는다. 예상 승률은
 * 모드를 묻지 않는 공통 눈금이라(`winChance`) 3v3과 5v5의 승점을 더해도 된다 — 전투력 **차이**를 더했다면
 * 두 모드의 눈금이 섞였다. 지거나 비긴 판은 0이다.
 */
export const winPoints = (power: { mine: number; theirs: number }): number =>
  Math.round(100 * (1 - winChance(power.mine, power.theirs)));

export interface CardCandidate { officer: OfficerId; grade: Grade; weight: number }

/**
 * 추첨 후보 — 보유한 장수는 `owned` 등급이면, 아직 없는 장수는 `fresh` 등급이면 들어간다.
 * 보유는 **풀 + 보관함**이다(`ownedOfficers`).
 *
 * **데이터 순서**(`OFFICERS`)로 늘어놓는다 — 같은 계정·같은 시드면 언제나 같은 장수가
 * 나와야 서버가 판을 재생해 보상을 다시 계산할 수 있다(H3c).
 */
export function cardCandidates(
  profile: PlayerProfile, owned: readonly Grade[], fresh: readonly Grade[],
): CardCandidate[] {
  const have = new Set<string>(ownedOfficers(profile));
  return OFFICERS
    .filter((o) => (have.has(o.id) ? owned : fresh).includes(o.grade as Grade))
    .map((o) => ({ officer: o.id as OfficerId, grade: o.grade as Grade, weight: CARD_WEIGHT[o.grade as Grade] ?? 0 }))
    .filter((c) => c.weight > 0);
}

/** 가중치대로 한 명 — 후보가 없으면 `null`. 가중치가 정수라 난수 하나로 끝난다 */
function pickWeighted(cands: readonly CardCandidate[], seed: number, salt: number): CardCandidate | null {
  const total = cands.reduce((n, c) => n + c.weight, 0);
  if (total <= 0) return null;
  let r = hash32(seed, salt) % total;
  for (const c of cands) {
    if (r < c.weight) return c;
    r -= c.weight;
  }
  return cands[cands.length - 1]!;
}

/**
 * 전투 결과를 계정에 반영한다 — **전적 · 이력 · 보상이 한 번에 움직인다.**
 *
 * 군량 소모는 여기서 하지 않는다(출전할 때 이미 냈다 — `roster.ts`의 `spendGrain`).
 */
export function applyBattleResult(
  profile: PlayerProfile,
  outcome: BattleOutcome,
  seed: number,
): { profile: PlayerProfile; rewards: BattleRewards } {
  let next: PlayerProfile = structuredClone(profile);
  const { result, mode, opponent } = outcome;
  // ── 전적 — 기물별 × 모드별 × 갈래별로 한 번만 센다 (40쪽) ──
  // **순수 AI 대전은 세지 않는다** (2026-10-28 기획자 확정) — 전적 · 이력 · 승점 어디에도. 보상 · 부상만 아래로 간다
  if (opponent !== 'ai') {
    // 승점은 이긴 판에만 — 계정 · 부대 · 장수 칸에 같은 값을 더한다(세 랭킹이 같은 식)
    const points = result === 'win' ? winPoints(outcome.power) : 0;
    let teamKills = 0;
    for (const pick of outcome.picks) {
      const kills = outcome.kills?.[pick.officer] ?? 0;
      teamKills += kills;
      const inst = next.roster[pick.officer];
      // 이미 계정에서 빠진 장수(초기화·정정)는 건너뛴다. 계정 칸에는 그대로 센다
      if (!inst) continue;
      bumpTally(inst.record, recordKey(opponent, mode, pick.piece), result, kills, points);
    }
    bumpTally(next.record, accountKey(opponent, mode), result, teamKills, points);

    // 부대 전적 — `outcome.mySquad`는 **부대 이름**이다(`BattleScreen.tsx`가 `squad?.name`을
    // 싣는다). 지운 부대·부대 없이 나간 판(mySquad가 `null`)은 조용히 건너뛴다 —
    // 계정 전적과 같은 관용(§7 부대 랭킹, 2026-08-26)
    if (outcome.mySquad) {
      const squad = next.squads.find((s) => s.name === outcome.mySquad);
      if (squad) bumpTally(squad.record, accountKey(opponent, mode), result, teamKills, points);
    }
  }

  // ── 부상 (GDD §5.7, 2026-09-04) ──
  //
  // **승패와 무관하다** — 「HP 0으로 퇴각했다」가 곧 부상이라 별도 판정이 없다.
  // 시각은 `outcome.at`을 그대로 쓴다(meta에 시계를 들이지 않는다). 헌제를
  // 거르는 것도 중첩을 막는 것도 `applyInjuries()` 안에 있다.
  // **청낭서를 들고 나간 장수는 빠진다** (2026-09-23, GDD §6.5) — 무엇이 나갔는지는
  // `marketInPlay`가 들고 있고, 이 정산 뒤에 `settleCarried()`가 비운다. **이 판(`opponent`)에 든 것만** 본다 —
  // 같은 장수가 도적떼에 든 청낭서는 이 판을 안 지킨다(2026-10-21)
  if (outcome.fallen?.length) {
    const hurt = fallenAfterShield(next, carriedOf(opponent), outcome.fallen);
    if (hurt.length) next = applyInjuries(next, hurt, outcome.at);
  }

  // ── 이력 한 줄 (DB 한 행) — AI 대전은 안 남긴다 ──
  if (opponent === 'ai') return grantBattleRewards(next, rewardKey(result, rewardTier(outcome.power)), seed);
  const row: MatchRow = {
    seq: next.matchSeq,
    at: outcome.at,
    mode,
    opponent,
    opponentId: outcome.opponentId ?? null,
    mySquad: outcome.mySquad ?? null,
    theirSquad: outcome.theirSquad ?? null,
    myPower: outcome.power.mine,
    theirPower: outcome.power.theirs,
    // 예상 승률은 **여기서 딱 한 번** 낸다 — 화면도 서버도 공식을 다시 적지 않는다(D)
    chance: winChance(outcome.power.mine, outcome.power.theirs),
    result,
    picks: outcome.picks.map((p) => ({
      piece: p.piece, officer: p.officer, kills: outcome.kills?.[p.officer] ?? 0,
    })),
  };
  next.matchSeq += 1;
  next.matches.push(row);
  // 브라우저 저장 동안만 꼬리를 덜어 낸다. **통산 집계는 위에서 이미 쌓았다**
  if (next.matches.length > MATCH_LOG_CAP) next.matches = next.matches.slice(-MATCH_LOG_CAP);

  // ── 보상 ──
  return grantBattleRewards(next, rewardKey(result, rewardTier(outcome.power)), seed);
}

/**
 * **보상만** 준다 — 전적 · 이력 · 부상은 건드리지 않는다.
 *
 * `applyBattleResult()`의 뒷부분이고, 도적떼 승리(GDD §5.11)가 이것만 따로 부른다 —
 * 「약한 상대에게 승」 줄이고(2026-10-27 기획자 확정) 전적에는 안 센다. 둘이 같은 함수를 지나므로
 * 보상 식을 두 벌 적지 않는다.
 */
export function grantBattleRewards(
  profile: PlayerProfile,
  key: RewardKey,
  seed: number,
): { profile: PlayerProfile; rewards: BattleRewards } {
  const spec = REWARD_TABLE[key];
  let next = profile;
  const rewards: BattleRewards = { grain: 0, materials: 0, cards: [] };

  // 칸마다 한 장 — **뽑는 순간의 계정**으로 후보를 만든다(방금 들어온 장수도 보유다). 소금은 칸의 차례
  spec.cards.forEach((pool, i) => {
    const got = pickWeighted(cardCandidates(next, pool.owned, pool.fresh), seed, 4241 + i * 2);
    if (!got) return;
    rewards.cards.push({ officer: got.officer, grade: got.grade });
    next = addCard(next, got.officer);
  });
  if (spec.materials > 0) {
    next = { ...next, materials: next.materials + spec.materials };
    rewards.materials = spec.materials;
  }
  if (spec.grain > 0) {
    const before = next.grain;
    next = { ...next, grain: Math.min(next.grain + spec.grain, grainCapOf(next)) };
    // 창고가 가득 찼으면 **들어간 만큼만** 적는다 — 화면이 없는 군량을 보여주지 않게
    rewards.grain = next.grain - before;
  }
  return { profile: next, rewards };
}

/** 군량 상한은 **병영**이 정한다 (GDD §5.4) */
const grainCapOf = grainCap;
