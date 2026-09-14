/**
 * 전투 보상과 전적 — GDD §6.4 · §7 (2026-08-18 전면 개편, 저장 형식 v3)
 *
 * ```
 * 승리    카드 1장(C·D면 +1장) + 재료 1 + 군량 3v3 1 / 5v5 2
 * 무승부  셋 중 택1 — 카드(승리와 같은 추첨) · 재료 · 군량   ← 고르기 전까지 아무것도 반영하지 않는다
 * 패배    카드 1장(C·D급) + 군량 승리와 같은 양
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 카드는 등급 가중치로 뽑는다 ★ 2026-09-14 기획자 확정
 * ────────────────────────────────────────────────────────────────
 *
 * ```
 * 가중치  S×1 · A×2 · B×3 · C×4 · D×5 · E×1
 * 승리    보유한 모든 장수 + 아직 없는 B      → 1장. C·D가 나오면 보유한 C·D에서 1장 더
 * 패배    보유한 C·D + 아직 없는 C·D          → 1장
 * ```
 *
 * 예전에는 B·C·D 189명 균등이라 **카드가 흩어져** 한 장수가 거의 안 컸다. 보유한 장수를
 * 풀에 넣어 카드가 가진 장수에게 모이게 했다. **새 S·A·E는 여전히 가챠로만 들어온다** —
 * 승리에서 나오는 S·A·E는 이미 가진 장수의 카드뿐이다(증축의 S·A 조건, GDD §5.1).
 *
 * ────────────────────────────────────────────────────────────────
 * AI와 온라인이 갈리지 않는다 ★ 2026-08-04를 뒤집는다
 * ────────────────────────────────────────────────────────────────
 *
 * 예전 규칙은 「AI 대전은 군량만, 카드는 없다」(봇 파밍 방지)였다. 그 전제는
 * **플레이어가 AI를 고른다**는 것이었는데, 병영의 문이 [출정하기] 하나로 합쳐지면서
 * (F·45쪽) 온라인 상대를 30초 찾다가 못 찾으면 AI로 넘어간다 — 상대가 사람인지
 * AI인지는 **고르는 것이 아니라 그때의 운**이다. 보상이 갈리면 접속 시간대가 곧
 * 보상이 되므로 완전히 같게 둔다(2026-08-18 기획자 확정).
 *
 * > 남은 위험은 하나다 — 사람이 적은 시간대에 몰아 붙이면 약한 상대(AI)로만
 * > 카드를 모을 수 있다. 막아야 할 때 손댈 자리는 **`cardCandidates`와 가중치 추첨**
 * > 하나뿐이고, 저장 형식은 건드리지 않는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 카드 등급에 격차 보정을 두지 않는다 (§5-22)
 * ────────────────────────────────────────────────────────────────
 *
 * 「약한 편성으로 이기면 좋은 카드」는 담합의 표적이 된다 — 두 계정이 짜고 큰 이변을
 * 만들어 한쪽에 좋은 카드를 몰아줄 수 있고, **상한이 곧 파밍 목표**가 된다.
 * 그래서 구간 자체를 두지 않고 **새로 들어오는 장수는 B급까지**로 막는다(이미 가진
 * 장수의 카드는 등급과 무관하게 나오지만 **격차는 여전히 안 본다**). 예상 승률은 보상이 아니라
 * **기록**으로 쓴다(§5-23) — 「예상 승률 12%를 뒤집은 승리」는 명예지 값이 아니다.
 */

import { ECONOMY, OFFICERS } from '@samchess/data';
import { hash32 } from '@samchess/rules';
import type { BattleMode, Grade, OfficerId } from '@samchess/rules';
import { addCard, ownedOfficers } from './profile.ts';
import { applyInjuries, grainCap } from './city.ts';
import { winChance } from './power.ts';
import { MATCH_LOG_CAP, accountKey, bumpTally, recordKey } from './records.ts';
import type {
  BattleOutcome, BattleRewards, DrawReward, MatchRow, PlayerProfile,
} from './types.ts';

/** 승리 군량 — 기물 수에 맞춘다 (GDD §6.4). 패배도 같은 양이다 */
export const GRAIN_REWARD: Record<BattleMode, number> = { '3v3': 1, '5v5': 2 };

/** 승리 재료 — 모드와 무관하게 1 (§5-10) */
export const MATERIAL_REWARD = 1;

/** 무승부가 고르는 셋. 화면은 이 차례로 늘어놓는다 */
export const DRAW_REWARDS: readonly DrawReward[] = ['card', 'material', 'grain'];

const RW = ECONOMY.battleRewards;

/**
 * 카드 추첨의 등급 가중치 — S×1 · A×2 · B×3 · C×4 · D×5 · E×1 (2026-09-14 기획자 확정).
 * 단일 출처는 `economy.json` ← 추출기의 `ECONOMY`. 화면·서버가 숫자를 다시 적지 않는다.
 */
export const CARD_WEIGHT = RW.gradeWeight as Record<Grade, number>;

/** 승리의 추첨 풀 — **보유**한 `owned` 등급 + **아직 없는** `fresh` 등급. `bonus`가 나오면 한 장 더 */
export const WIN_CARD_POOL = {
  owned: RW.win.ownedGrades as readonly Grade[],
  fresh: RW.win.newGrades as readonly Grade[],
  bonus: RW.win.bonusGrades as readonly Grade[],
};

/**
 * 패배의 추첨 풀 — 보유한 C·D + 아직 없는 C·D, 곧 **C·D 전원**이다. 도시 증축이 보유 장수
 * 수를 요구하므로(GDD §5.1) 지는 판도 수집에 보탬이 되게 했다.
 */
export const LOSS_CARD_POOL = {
  owned: RW.lose.ownedGrades as readonly Grade[],
  fresh: RW.lose.newGrades as readonly Grade[],
};

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
 *
 * **무승부는 고른 뒤에만 반영된다.** 「고르는 도중」이라는 상태를 저장하지 않는 것이
 * 이 규칙의 요점이라, 안 고르고 부르면 던진다 — 조용히 아무것도 안 주면 전적만
 * 오르고 보상이 사라진 계정이 남는다. 재설계(B)가 「비운 스택을 저장하지 않는다」로
 * 푼 것과 같은 자리다.
 */
export function applyBattleResult(
  profile: PlayerProfile,
  outcome: BattleOutcome,
  seed: number,
): { profile: PlayerProfile; rewards: BattleRewards } {
  if (outcome.result === 'draw' && !outcome.drawPick) {
    throw new Error('무승부는 보상 셋 중 하나를 고른 뒤에 반영한다 (GDD §6.4)');
  }

  let next: PlayerProfile = structuredClone(profile);
  const { result, mode, opponent } = outcome;

  // ── 전적 — 기물별 × 모드별 × 상대별로 한 번만 센다 (40쪽) ──
  let teamKills = 0;
  for (const pick of outcome.picks) {
    const kills = outcome.kills?.[pick.officer] ?? 0;
    teamKills += kills;
    const inst = next.roster[pick.officer];
    // 이미 계정에서 빠진 장수(초기화·정정)는 건너뛴다. 계정 칸에는 그대로 센다
    if (!inst) continue;
    bumpTally(inst.record, recordKey(opponent, mode, pick.piece), result, kills);
  }
  bumpTally(next.record, accountKey(opponent, mode), result, teamKills);

  // 부대 전적 — `outcome.mySquad`는 **부대 이름**이다(`BattleScreen.tsx`가 `squad?.name`을
  // 싣는다). 지운 부대·부대 없이 나간 판(mySquad가 `null`)은 조용히 건너뛴다 —
  // 계정 전적과 같은 관용(§7 부대 랭킹, 2026-08-26)
  if (outcome.mySquad) {
    const squad = next.squads.find((s) => s.name === outcome.mySquad);
    if (squad) bumpTally(squad.record, accountKey(opponent, mode), result, teamKills);
  }

  // ── 부상 (GDD §5.7, 2026-09-04) ──
  //
  // **승패와 무관하다** — 「HP 0으로 퇴각했다」가 곧 부상이라 별도 판정이 없다.
  // 시각은 `outcome.at`을 그대로 쓴다(meta에 시계를 들이지 않는다). 헌제를
  // 거르는 것도 중첩을 막는 것도 `applyInjuries()` 안에 있다.
  if (outcome.fallen?.length) next = applyInjuries(next, outcome.fallen, outcome.at);

  // ── 이력 한 줄 (DB 한 행) ──
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
  const rewards: BattleRewards = { grain: 0, materials: 0, cards: [] };

  /** 한 장을 뽑아 넣는다. **뽑는 순간의 계정**으로 후보를 만든다 — 방금 들어온 장수도 보유다 */
  const drawInto = (owned: readonly Grade[], fresh: readonly Grade[], salt: number): CardCandidate | null => {
    const got = pickWeighted(cardCandidates(next, owned, fresh), seed, salt);
    if (got) {
      rewards.cards.push({ officer: got.officer, grade: got.grade });
      next = addCard(next, got.officer);
    }
    return got;
  };

  /** 승리의 카드 — `bonus` 등급(C·D)이 나오면 보유한 그 등급에서 한 장 더. 같은 장수일 수도 있다 */
  const winCards = (): void => {
    const first = drawInto(WIN_CARD_POOL.owned, WIN_CARD_POOL.fresh, 4241);
    if (first && WIN_CARD_POOL.bonus.includes(first.grade)) drawInto(WIN_CARD_POOL.bonus, [], 4243);
  };

  const give = (what: DrawReward): void => {
    if (what === 'grain') {
      const before = next.grain;
      next.grain = Math.min(next.grain + GRAIN_REWARD[mode], grainCapOf(next));
      // 창고가 가득 찼으면 **들어간 만큼만** 적는다 — 화면이 없는 군량을 보여주지 않게
      rewards.grain += next.grain - before;
    } else if (what === 'material') {
      next.materials += MATERIAL_REWARD;
      rewards.materials += MATERIAL_REWARD;
    } else {
      winCards();
    }
  };

  if (result === 'win') { give('card'); give('material'); give('grain'); }
  else if (result === 'draw') give(outcome.drawPick!);
  else { drawInto(LOSS_CARD_POOL.owned, LOSS_CARD_POOL.fresh, 4241); give('grain'); }

  return { profile: next, rewards };
}

/** 군량 상한은 **병영**이 정한다 (GDD §5.4) */
const grainCapOf = grainCap;
