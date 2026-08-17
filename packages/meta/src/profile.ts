/**
 * 계정 — 생성 · 카드 · 레벨업 (GDD §4.2 · §4.3 · §5 · §8)
 *
 * 전부 **순수 함수**다. 입력 프로필을 건드리지 않고 새 객체를 돌려준다 —
 * 룰 엔진의 `apply()`와 같은 규약이라, 나중에 서버가 그대로 쓴다.
 */

import { CITY_LEVELS, ECONOMY, GROWTH, OFFICERS, officerById, officersByGrade, tacticById, tacticsForLevel } from '@samchess/data';
import { FORMULA, hash32 } from '@samchess/rules';
import type { Grade, OfficerId, TacticId } from '@samchess/rules';
import type { GrowthStep, MetaResult, OfficerInstance, PlayerProfile, StatPick } from './types.ts';

/**
 * 저장 형식 버전. 구조가 바뀌면 올리고 **`migrate.ts`가 되접는다.**
 *
 * | | 무엇이 바뀌었나 |
 * |---|---|
 * | 1 | 최초 |
 * | 2 | `statPicks`·`tactics` 평면 배열 → **레벨별 `growth` 스택** (2026-08-17) |
 *
 * **버전은 뜻이 바뀔 때만 올린다.** 필드가 더해지기만 하는 변경은 마이그레이션이
 * 기본값으로 채우므로 버전을 올리지 않는다 — 올리면 되접을 것이 없는데도
 * 옛 계정이 한 번씩 그 길을 지나게 된다.
 */
export const PROFILE_VERSION = 2;

/** 온보딩 초기 지급 — S·A·B·C·D 각 1명 (GDD §8) */
const STARTER_GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D'];

export const cityLevel = (level: number) => CITY_LEVELS.find((c) => c.level === level) ?? CITY_LEVELS[0]!;

/** 도시 레벨이 정하는 보유 상한 (GDD §5) */
export const poolCap = (profile: PlayerProfile): number => cityLevel(profile.cityLevel).characterPool;
export const poolUsed = (profile: PlayerProfile): number => Object.keys(profile.roster).length;

/** 새 장수 인스턴스 — Lv1 · 성장 스택 비어 있음 (GDD §4.2 기본치는 룰 엔진이 계산한다) */
export function newInstance(officer: OfficerId): OfficerInstance {
  return { officer, level: 1, growth: [], record: { wins: 0, losses: 0, kills: 0 } };
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

// ── 성장 스택을 읽는 자리 ★ 여기가 단일 출처다 ──────────────────
//
// 화면도 편성도 엔진 변환도 전투력도 **이 둘만** 부른다. `inst.growth`를 직접
// 펴는 코드가 두 군데 생기는 순간, 한쪽만 `cap`을 잊어 「하향했는데 책략은 그대로」가
// 된다 — 화면에는 아무 표시도 안 나고 전투에서만 드러나는 종류다.

/**
 * 레벨 상한까지의 성장 스택. `cap`을 생략하면 지금 레벨 그대로다.
 *
 * **`cap`은 부대 편성의 레벨 하향(E · 42쪽)이 쓴다.** 전투력을 낮춰 약한 상대와
 * 붙기 위한 장치라, 자른 결과가 **그 레벨까지만 키운 캐릭터와 완전히 같아야** 한다
 * (`growth.test.ts`가 고정한다). 레벨별로 묶어 둔 덕에 자르는 일이 `slice` 한 줄이다.
 */
export function growthUpTo(inst: OfficerInstance, cap?: number): GrowthStep[] {
  const level = Math.max(1, Math.min(cap ?? inst.level, inst.level));
  return inst.growth.slice(0, level - 1);
}

/** 능력 향상 선택을 편 것. 길이 = (cap ?? level) − 1 */
export function statPicksOf(inst: OfficerInstance, cap?: number): StatPick[] {
  return growthUpTo(inst, cap).map((step) => step.stat);
}

/** 습득 책략을 편 것. **Lv6·7 지원이 둘씩이라 `statPicksOf`보다 길 수 있다** */
export function tacticsOf(inst: OfficerInstance, cap?: number): TacticId[] {
  return growthUpTo(inst, cap).flatMap((step) => step.tactics);
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
  // 레벨과 성장 스택은 **함께** 늘어난다 — 둘을 다른 줄에서 건드리지 않는다
  inst.growth.push({ stat, tactics: gained });
  return next;
}

/** 한 단계가 더하는 능력치 (`hp+5` / `mp+2` / `at+0.5`). 단일 출처는 엑셀의 `statChoices`다 */
export function statStep(pick: StatPick): number {
  const step = GROWTH.statChoices.find((c) => pick in c) as Record<string, number> | undefined;
  return step?.[pick] ?? 0;
}

/**
 * 장수 하나의 현재 능력치. 룰 엔진이 전투에서 쓰는 계산과 같은 식이다 (GDD §4.2).
 *
 * `cap`을 주면 그 레벨까지만 센다 — 편성의 레벨 하향(E)이 쓴다.
 */
export function statsOf(inst: OfficerInstance, cap?: number): { hp: number; mp: number; at: number } {
  return statsFrom(statPicksOf(inst, cap));
}

/** 능력 선택 목록에서 곧바로. 성장 스택이 아직 없는 것(미리보기·재설계 중)에도 쓴다 */
export function statsFrom(picks: readonly StatPick[]): { hp: number; mp: number; at: number } {
  const out = { ...GROWTH.base };
  for (const pick of picks) out[pick] += statStep(pick);
  return out;
}

// ── 39쪽의 증분 미리보기 ★ 숫자는 화면이 아니라 여기서 낸다 ─────
//
// 「화면이 미리 보여 주는 숫자는 엔진이 낸다」 — 공격 확인창이 `forecastAttack()`,
// 책략이 `illusionChance()`에 묻는 것과 같은 자리다. 화면이 `+5`를 손으로 적으면
// 엑셀의 `statChoices`가 바뀌었을 때 **표시만** 조용히 어긋난다. 실제로 `AT +1`이
// 화면 글자에만 남아 있던 적이 있다(2026-08-12 → 0.5로 내렸는데 화면은 낡았었다).

/** 39쪽의 「HP: 10,  +5  → 15」 한 줄 */
export interface StatPreview {
  key: StatPick;
  /** 지금 값. `at`은 소수(2.5)일 수 있다 */
  now: number;
  /** 이 선택이 더하는 값. **고르지 않은 줄은 0**이다 (39쪽 목업이 `+0`을 함께 보여준다) */
  add: number;
  next: number;
  /**
   * `at`만 채워진다 — **공격력은 언제나 범위다.** 데미지가 매 타격 내림이라
   * `AT 2 → 2.5`는 `2-4 → 2-5`로 보인다(평타는 그대로, 크리티컬만 는다).
   * 단일 숫자로 적으면 「찍었는데 왜 그대로지」가 된다 (GDD §4.2 · §8.2).
   */
  range?: { now: { min: number; max: number }; next: { min: number; max: number } };
}

/** 이 레벨업에서 `stat`을 고르면 능력치가 어떻게 되는가. 세 줄을 언제나 함께 돌려준다 */
export function growthPreview(inst: OfficerInstance, stat: StatPick): StatPreview[] {
  const before = statsOf(inst);
  const after = statsFrom([...statPicksOf(inst), stat]);
  return (['hp', 'mp', 'at'] as StatPick[]).map((key) => {
    const row: StatPreview = { key, now: before[key], add: after[key] - before[key], next: after[key] };
    if (key === 'at') row.range = { now: damageRange(before.at), next: damageRange(after.at) };
    return row;
  });
}

/** 공격력 표기 범위. **`FORMULA.damage`를 반드시 지난다** — 내림 규칙을 옮겨 적지 않는다 */
export function damageRange(at: number): { min: number; max: number } {
  return { min: FORMULA.damage(at, false, false, false), max: FORMULA.damage(at, true, false, false) };
}

// ── 재설계(둔갑천서) — GDD §4.3 · §6.2 ─────────────────────────
//
// **레벨은 유지하고 선택만 전부 새로 한다** (2026-08-17 기획자 확정).
//
// ────────────────────────────────────────────────────────────────
// 「스택을 비운 상태」를 저장하지 않는다 ★
// ────────────────────────────────────────────────────────────────
//
// 레벨을 둔 채 `growth`를 비우면 `growth.length === level - 1`이 깨지고, 그 상태가
// 저장되는 순간 **편성·전투·전투력·레벨 하향이 전부 그 예외를 알아야 한다.**
// 그래서 비운 상태는 **화면 안에서만** 살고(마법사), 여기 오는 것은 완성된 스택이다.
// 「[확정] 전까지 프로필에 반영하지 않는다」는 기획이 그대로 불변식을 지켜 준다 —
// 중간에 나가면 원래대로인 것도 같은 이유의 다른 얼굴이다.

/** 재설계 비용 — 둔갑천서 10냥 (GDD §6.2). 단일 출처는 엑셀 → `economy.json` */
export const RESPEC_GOLD: number = ECONOMY.respecItemGold;

/** 재설계할 수 있는가. Lv1은 고른 것이 없어 다시 고를 것도 없다 */
export function canRespec(profile: PlayerProfile, officer: OfficerId): MetaResult {
  const inst = profile.roster[officer];
  if (!inst) return no('보유하지 않은 장수다');
  if (inst.level < 2) return no('Lv1은 아직 고른 것이 없다');
  if (profile.gold < RESPEC_GOLD) return no(`둔갑천서가 필요하다 — 금화 ${profile.gold}/${RESPEC_GOLD}`);
  return { ok: true };
}

/**
 * 성장 스택을 통째로 갈아 끼운다. **레벨은 그대로다.**
 *
 * 넘어온 선택을 **검증한다** — 화면이 보낸 것을 그대로 믿으면 Lv2에 「초선」을
 * 심을 수 있다. 둔갑천서는 유료 아이템이라 온라인에서 서버가 반드시 다시 볼
 * 자리인데, 판정이 여기 하나면 두 벌이 안 생긴다(`validateRoster`와 같은 결).
 *
 * **결과는 정상 성장과 구별되지 않는다** — 표식을 남기지 않는다. 남기면 그게 곧
 * 차별 대상이 된다(매칭·랭킹에서 「재설계한 캐릭터」를 따로 볼 이유가 없다).
 */
export function applyRespec(
  profile: PlayerProfile,
  officer: OfficerId,
  steps: readonly GrowthStep[],
): PlayerProfile {
  const check = canRespec(profile, officer);
  if (!check.ok) throw new Error(`재설계할 수 없다(${officer}): ${check.reason}`);

  const inst = profile.roster[officer]!;
  const bad = checkGrowth(steps, inst.level);
  if (bad) throw new Error(`재설계 선택이 올바르지 않다(${officer}): ${bad}`);

  const next = clone(profile);
  next.gold -= RESPEC_GOLD;
  next.roster[officer]!.growth = steps.map((s) => ({ stat: s.stat, tactics: [...s.tactics] }));
  return next;
}

/**
 * 성장 스택이 그 레벨에 성립하는가. 어긋나면 **왜인지**를 돌려준다(성립하면 `null`).
 *
 * 마이그레이션이 되접은 결과도 이걸로 검산한다 — 되접기와 검증이 같은 규칙을 봐야
 * 「불러오면 통과하는데 재설계하면 거부되는」 어긋남이 안 생긴다.
 */
export function checkGrowth(steps: readonly GrowthStep[], level: number): string | null {
  if (steps.length !== level - 1) return `${steps.length}단계, Lv${level}에는 ${level - 1}단계가 필요하다`;
  for (const [i, step] of steps.entries()) {
    const lv = i + 2;
    if (!GROWTH.statChoices.some((c) => step.stat in c)) return `Lv${lv}: 알 수 없는 능력 「${step.stat}」`;
    const school = tacticById.get(step.tactics[0] ?? '')?.school;
    if (!school) return `Lv${lv}: 책략을 고르지 않았거나 알 수 없는 책략이다`;
    // Lv6·7 지원은 **짝을 전부** 가져야 한다 — 하나만 고르면 제거 수단만 가진 빌드가 된다
    const expect = tacticChoices(lv)[school];
    if (step.tactics.length !== expect.length || step.tactics.some((t, k) => t !== expect[k])) {
      return `Lv${lv}: 그 레벨의 ${school} 책략은 [${expect.join(', ')}]이다`;
    }
  }
  return null;
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
