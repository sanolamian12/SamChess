/**
 * 전투 보상과 전적 — GDD §6.4 · §7 (2026-08-18 전면 개편, 저장 형식 v3)
 *
 * ```
 * 승리    카드 1장(상한 B급) + 재료 1 + 군량 3v3 1 / 5v5 2
 * 무승부  셋 중 택1 — 카드 · 재료 · 군량   ← 고르기 전까지 아무것도 반영하지 않는다
 * 패배    군량만, 승리와 같은 양
 * ```
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
 * > 카드를 모을 수 있다. 막아야 할 때 손댈 자리는 **`CARD_GRADES`와 등급 추첨**
 * > 하나뿐이고, 저장 형식은 건드리지 않는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 카드 등급에 격차 보정을 두지 않는다 (§5-22)
 * ────────────────────────────────────────────────────────────────
 *
 * 「약한 편성으로 이기면 좋은 카드」는 담합의 표적이 된다 — 두 계정이 짜고 큰 이변을
 * 만들어 한쪽에 좋은 카드를 몰아줄 수 있고, **상한이 곧 파밍 목표**가 된다.
 * 그래서 구간 자체를 두지 않고 **상한 B급**으로 막는다. 예상 승률은 보상이 아니라
 * **기록**으로 쓴다(§5-23) — 「예상 승률 12%를 뒤집은 승리」는 명예지 값이 아니다.
 */

import { officersByGrade } from '@samchess/data';
import { hash32 } from '@samchess/rules';
import type { BattleMode, Grade, OfficerId } from '@samchess/rules';
import { addCard, cityLevel } from './profile.ts';
import { winChance } from './power.ts';
import { MATCH_LOG_CAP, accountKey, bumpTally, recordKey } from './records.ts';
import type {
  BattleOutcome, BattleRewards, DrawReward, MatchRow, PlayerProfile,
} from './types.ts';

/** 승리 군량 — 기물 수에 맞춘다 (GDD §6.4). 패배도 같은 양이다 */
export const GRAIN_REWARD: Record<BattleMode, number> = { '3v3': 1, '5v5': 2 };

/** 승리 재료 — 모드와 무관하게 1 (§5-10) */
export const MATERIAL_REWARD = 1;

/** 카드 추첨 풀. **상한이 B급이다** — 격차 보정도 등급 구간도 없다 (§5-22) */
export const CARD_GRADES: readonly Grade[] = ['B', 'C', 'D'];

/** 무승부가 고르는 셋. 화면은 이 차례로 늘어놓는다 */
export const DRAW_REWARDS: readonly DrawReward[] = ['card', 'material', 'grain'];

/** 등급 후보에서 시드로 한 명 뽑는다 */
function drawCard(seed: number): { officer: OfficerId; grade: Grade } {
  const pool = CARD_GRADES.flatMap((g) => officersByGrade(g));
  const pick = pool[hash32(seed, 4241) % pool.length]!;
  return { officer: pick.id as OfficerId, grade: pick.grade };
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
  const rewards: BattleRewards = { grain: 0, materials: 0, card: null, cardGrade: null };

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
      const drawn = drawCard(seed);
      rewards.card = drawn.officer;
      rewards.cardGrade = drawn.grade;
      next = addCard(next, drawn.officer);
    }
  };

  if (result === 'win') { give('card'); give('material'); give('grain'); }
  else if (result === 'draw') give(outcome.drawPick!);
  else give('grain');

  return { profile: next, rewards };
}

/** 도시 레벨이 정하는 군량 상한 (GDD §5) */
const grainCapOf = (profile: PlayerProfile): number => cityLevel(profile.cityLevel).grainCap;
