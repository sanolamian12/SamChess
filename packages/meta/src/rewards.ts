/**
 * 전투 보상과 전적 — GDD §6.4 · §7
 *
 * ```
 * 승리 — 군량 +1, 장수 카드 1장 (팀 구성에 따른 핸디캡 보정)
 * 패배 — C~D급 중 1장
 * ```
 *
 * **AI 대전은 군량만 준다. 카드는 없다** (2026-08-04 확정) — 봇 파밍으로 수집이 굴러가지
 * 않게 하려는 것이다. 그래서 오프라인만으로는 §1의 핵심 루프가 닫히지 않는다.
 * 개발 중에는 장수 관리 화면의 「개발용 카드 지급」으로 성장 흐름을 시험한다.
 */

import { officerById, officersByGrade } from '@samchess/data';
import { hash32 } from '@samchess/rules';
import type { Grade, OfficerId } from '@samchess/rules';
import { addCard, cityLevel } from './profile.ts';
import type { BattleOutcome, BattleRewards, PlayerProfile } from './types.ts';

/**
 * 승리 시 카드 등급 (GDD §6.4).
 *
 * D급을 넣을수록 좋은 카드가 나온다 — 약한 편성으로 이긴 것에 대한 핸디캡 보정이다.
 */
function winGrades(picks: readonly { officer: OfficerId }[]): Grade[] {
  const dCount = picks.filter((p) => officerById.get(p.officer)?.grade === 'D').length;
  if (dCount >= 2) return ['B'];
  if (dCount === 1) return ['C'];
  return ['B', 'C', 'D'];
}

/** 등급 후보에서 시드로 한 명 뽑는다 */
function drawCard(grades: readonly Grade[], seed: number): { officer: OfficerId; grade: Grade } {
  const pool = grades.flatMap((g) => officersByGrade(g));
  const pick = pool[hash32(seed, 4241) % pool.length]!;
  return { officer: pick.id as OfficerId, grade: pick.grade };
}

/**
 * 전투 결과를 계정에 반영한다.
 *
 * 군량 소모는 여기서 하지 않는다 — 출전할 때 이미 냈다(`roster.ts`의 `spendGrain`).
 * 여기서 더하는 `grain`은 승리 보상이다.
 */
export function applyBattleResult(
  profile: PlayerProfile,
  outcome: BattleOutcome,
  seed: number,
): { profile: PlayerProfile; rewards: BattleRewards } {
  let next: PlayerProfile = structuredClone(profile);

  // 전적 — 출전한 장수 전원의 승·패와 처치 수 (GDD §7 랭킹 지표)
  for (const pick of outcome.picks) {
    const inst = next.roster[pick.officer];
    if (!inst) continue;
    if (outcome.won) inst.record.wins += 1;
    else inst.record.losses += 1;
    inst.record.kills += outcome.kills?.[pick.officer] ?? 0;
  }

  const rewards: BattleRewards = { grain: 0, card: null, cardGrade: null };

  if (outcome.won) {
    rewards.grain = 1;
    next.grain = Math.min(next.grain + 1, grainCapOf(next));
  }

  // 온라인만 카드를 준다
  if (outcome.opponent === 'online') {
    const grades = outcome.won ? winGrades(outcome.picks) : (['C', 'D'] as Grade[]);
    const drawn = drawCard(grades, seed);
    rewards.card = drawn.officer;
    rewards.cardGrade = drawn.grade;
    next = addCard(next, drawn.officer);
  }

  return { profile: next, rewards };
}

/** 도시 레벨이 정하는 군량 상한 (GDD §5) */
const grainCapOf = (profile: PlayerProfile): number => cityLevel(profile.cityLevel).grainCap;
