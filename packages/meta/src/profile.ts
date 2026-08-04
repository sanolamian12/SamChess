/**
 * 계정 — 생성 · 카드 · 레벨업 (GDD §4.2 · §4.3 · §5 · §8)
 *
 * 전부 **순수 함수**다. 입력 프로필을 건드리지 않고 새 객체를 돌려준다 —
 * 룰 엔진의 `apply()`와 같은 규약이라, 나중에 서버가 그대로 쓴다.
 */

import { CITY_LEVELS, GROWTH, OFFICERS, officerById, officersByGrade, tacticsForLevel } from '@samchess/data';
import { hash32 } from '@samchess/rules';
import type { Grade, OfficerId, TacticId } from '@samchess/rules';
import type { MetaResult, OfficerInstance, PlayerProfile, StatPick } from './types.ts';

/** 저장 형식 버전. 구조가 바뀌면 올린다 */
export const PROFILE_VERSION = 1;

/** 온보딩 초기 지급 — S·A·B·C·D 각 1명 (GDD §8) */
const STARTER_GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D'];

export const cityLevel = (level: number) => CITY_LEVELS.find((c) => c.level === level) ?? CITY_LEVELS[0]!;

/** 도시 레벨이 정하는 보유 상한 (GDD §5) */
export const poolCap = (profile: PlayerProfile): number => cityLevel(profile.cityLevel).characterPool;
export const poolUsed = (profile: PlayerProfile): number => Object.keys(profile.roster).length;

/** 새 장수 인스턴스 — Lv1 · 선택 이력 없음 (GDD §4.2 기본치는 룰 엔진이 계산한다) */
export function newInstance(officer: OfficerId): OfficerInstance {
  return { officer, level: 1, statPicks: [], tactics: [], record: { wins: 0, losses: 0, kills: 0 } };
}

/**
 * 새 계정. 등급별로 한 명씩 **시드에서 결정적으로** 뽑는다.
 *
 * `Math.random()`을 쓰지 않는 이유는 룰 엔진과 같다 — 같은 시드면 같은 계정이 나와야
 * 화면을 눈으로 비교할 수 있고, 나중에 서버가 만들 때도 재현이 된다.
 */
export function createProfile(cityName: string, seed: number): PlayerProfile {
  const roster: Record<OfficerId, OfficerInstance> = {};
  STARTER_GRADES.forEach((grade, i) => {
    const pool = officersByGrade(grade);
    const pick = pool[hash32(seed, i * 977) % pool.length]!;
    roster[pick.id as OfficerId] = newInstance(pick.id as OfficerId);
  });

  return {
    version: PROFILE_VERSION,
    cityName,
    cityLevel: 1,
    // 시간당 충전(GDD §5)은 접속 시각 개념이 필요해 아직 없다. 상한만큼 채워 시작한다.
    grain: cityLevel(1).grainCap,
    gold: 0,
    materials: 0,
    roster,
    cards: {},
  };
}

// ── 카드 ───────────────────────────────────────────────────────

/**
 * 카드 1장을 넣는다.
 *
 * **처음 얻은 장수는 카드가 아니라 풀로 들어간다** — 수집이 곧 보유이기 때문이다.
 * 풀이 가득 차면 넣지 못하고 카드로 쌓인다(GDD §5 「캐릭터 풀 초과 규칙」의 보관함에 해당).
 */
export function addCard(profile: PlayerProfile, officer: OfficerId, count = 1): PlayerProfile {
  const next = clone(profile);
  let remain = count;
  if (!next.roster[officer] && poolUsed(next) < poolCap(next)) {
    next.roster[officer] = newInstance(officer);
    remain -= 1;
  }
  if (remain > 0) next.cards[officer] = (next.cards[officer] ?? 0) + remain;
  return next;
}

// ── 레벨업 (GDD §4.3) ──────────────────────────────────────────

/** 다음 레벨에 필요한 카드 수. 최대 레벨이면 `null` */
export function cardsToLevelUp(level: number): number | null {
  const req = GROWTH.levelUp.find((r) => r.level === level + 1);
  return req ? req.cardsRequired : null;
}

/**
 * 해당 레벨에서 고를 수 있는 책략.
 *
 * **Lv6·Lv7의 지원은 둘씩 들어온다** — 「화계+진화」, 「수계+매립」. 생성과 제거가
 * 한 쌍이라 따로 배우게 하면 제거 수단만 가진 빌드가 생긴다(GDD §3.7의 표도 한 줄이다).
 */
export function tacticChoices(level: number): { support: TacticId[]; illusion: TacticId[] } {
  const all = tacticsForLevel(level);
  return {
    support: all.filter((t) => t.school === 'support').map((t) => t.id as TacticId),
    illusion: all.filter((t) => t.school === 'illusion').map((t) => t.id as TacticId),
  };
}

/** 레벨업이 가능한가. **실패 확률은 없다** — 2026-08-04 확정 (GDD §4.3) */
export function canLevelUp(profile: PlayerProfile, officer: OfficerId): MetaResult {
  const inst = profile.roster[officer];
  if (!inst) return no('보유하지 않은 장수다');
  const need = cardsToLevelUp(inst.level);
  if (need === null) return no(`이미 최대 레벨이다 (Lv${GROWTH.maxLevel})`);
  const have = profile.cards[officer] ?? 0;
  if (have < need) return no(`카드가 모자란다 — ${have}/${need}장`);
  return { ok: true };
}

/**
 * 레벨을 하나 올린다. 능력 향상과 책략을 **각각 하나씩** 고른다 (GDD §4.2).
 *
 * `school`을 받는 이유는 Lv6·7에서 지원이 둘씩 들어오기 때문이다 —
 * 책략 id 하나를 받으면 짝을 어떻게 넣을지 호출한 쪽이 알아야 한다.
 */
export function applyLevelUp(
  profile: PlayerProfile,
  officer: OfficerId,
  stat: StatPick,
  school: 'support' | 'illusion',
): PlayerProfile {
  const check = canLevelUp(profile, officer);
  if (!check.ok) throw new Error(`레벨업할 수 없다(${officer}): ${check.reason}`);

  const next = clone(profile);
  const inst = next.roster[officer]!;
  const need = cardsToLevelUp(inst.level)!;
  const gained = tacticChoices(inst.level + 1)[school];
  if (gained.length === 0) throw new Error(`Lv${inst.level + 1}에 ${school} 책략이 없다`);

  next.cards[officer] = (next.cards[officer] ?? 0) - need;
  if (next.cards[officer] === 0) delete next.cards[officer];
  inst.level += 1;
  inst.statPicks.push(stat);
  inst.tactics.push(...gained);
  return next;
}

/** 장수 하나의 현재 능력치. 룰 엔진이 전투에서 쓰는 계산과 같은 식이다 (GDD §4.2) */
export function statsOf(inst: OfficerInstance): { hp: number; mp: number; at: number } {
  const base = GROWTH.base;
  const add = { hp: 0, mp: 0, at: 0 };
  for (const pick of inst.statPicks) {
    const step = GROWTH.statChoices.find((c) => pick in c) as Record<string, number> | undefined;
    add[pick] += step?.[pick] ?? 0;
  }
  return { hp: base.hp + add.hp, mp: base.mp + add.mp, at: base.at + add.at };
}

/** 등급 환산 점수 합계 (GDD §7 랭킹) */
export const GRADE_SCORE: Record<Grade, number> = { S: 10, A: 8, B: 6, C: 4, D: 2, E: 0 };

export function gradeScore(profile: PlayerProfile): number {
  return Object.keys(profile.roster)
    .reduce((n, id) => n + (GRADE_SCORE[officerById.get(id)?.grade ?? 'D'] ?? 0), 0);
}

/** 전체 장수 목록 — 화면이 "아직 없는 장수"까지 보여줄 때 쓴다 */
export const ALL_OFFICERS = OFFICERS;

const no = (reason: string): MetaResult => ({ ok: false, reason });

/**
 * 프로필 복사. `structuredClone`을 쓰는 이유는 룰 엔진의 `cloneState`와 같다 —
 * 중첩된 배열·객체까지 확실히 끊어야 호출한 쪽의 상태가 몰래 바뀌지 않는다.
 * 프로필은 전투 로그처럼 커지지 않으므로 여기서는 얕게 할 이유가 없다.
 */
const clone = (p: PlayerProfile): PlayerProfile => structuredClone(p);
