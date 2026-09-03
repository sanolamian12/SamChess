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
 * | 3 | 전적이 평평한 `{wins,losses,kills}` → **기물 × 모드 × 상대 교차 + 대전 이력** (2026-08-18) |
 *
 * **버전은 뜻이 바뀔 때만 올린다.** 필드가 더해지기만 하는 변경은 마이그레이션이
 * 기본값으로 채우므로 버전을 올리지 않는다 — 올리면 되접을 것이 없는데도
 * 옛 계정이 한 번씩 그 길을 지나게 된다. v3는 `record`의 **뜻이** 바뀌어서 올렸다.
 */
export const PROFILE_VERSION = 3;

/** 온보딩 초기 지급 — S·A·B·C·D 각 1명 (GDD §8) */
const STARTER_GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D'];

export const cityLevel = (level: number) => CITY_LEVELS.find((c) => c.level === level) ?? CITY_LEVELS[0]!;

/** 도시 레벨이 정하는 보유 상한 (GDD §5) */
export const poolCap = (profile: PlayerProfile): number => cityLevel(profile.cityLevel).characterPool;
export const poolUsed = (profile: PlayerProfile): number => Object.keys(profile.roster).length;

/** 새 장수 인스턴스 — Lv1 · 성장 스택 비어 있음 (GDD §4.2 기본치는 룰 엔진이 계산한다) */
export function newInstance(officer: OfficerId): OfficerInstance {
  // 전적은 **희소하다** — 뛴 적 없는 기물의 칸은 만들지 않는다 (40쪽 표는 합으로 낸다)
  return { officer, level: 1, growth: [], record: {} };
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
    // 상한만큼 채워 시작한다. 시간 충전(GDD §5)은 `syncGrain()`이 맡는다 —
    // 여기서 `grainAt`을 찍지 못하는 것은 meta가 시계를 안 읽기 때문이고,
    // 0이면 첫 정산이 도장만 찍고 지나간다(상한에서 시작하니 잃는 것도 없다).
    grain: cityLevel(1).grainCap,
    grainAt: 0,
    gold: 0,
    materials: 0,
    roster,
    cards: {},
    record: {},
    matches: [],
    // 1부터 센다 — 0은 「아직 한 판도 안 했다」와 구별이 안 된다
    matchSeq: 1,
    // 부대는 사람이 만든다 — 처음에는 없다 (E · 42쪽)
    squads: [],
    squadSeq: 1,
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
 * **레벨마다 지원 하나 · 환술 하나**다 (2026-09-03 재정리). 그전에는 Lv6이
 * 「화계+진화」, Lv7이 「수계+매립」으로 **둘씩** 들어왔다 — 생성과 제거가 한 쌍이라
 * 따로 배우면 제거 수단만 가진 빌드가 생긴다는 이유였다. 수계·매립을 지우면서
 * (진입 불가 지형이 판을 막아 결착이 안 나는 판을 만들 수 있었다) 화계를 Lv6,
 * 진화를 Lv7에 하나씩 두는 것으로 접었다 — 제거 수단만 가진 빌드는 이제 「Lv7까지
 * 올렸는데 Lv6에서 환술을 골랐다」뿐이고, 그건 사람이 고른 결과다.
 *
 * **반환 타입은 배열 그대로 둔다** — 지금은 언제나 길이 1이지만, 저장 형식
 * (`GrowthStep.tactics`)이 배열이라 여기서 낱개로 바꾸면 두 자리가 서로 다른
 * 모양을 갖게 된다.
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
 * 책략 id가 아니라 `school`을 받는다 — 그 레벨에서 무엇을 주는지는 데이터가
 * 정하므로(`tacticChoices`), 화면이 id를 골라 보내면 데이터가 바뀔 때 화면도
 * 같이 고쳐야 한다. 예전엔 Lv6·7의 지원이 둘씩이라 **꼭 그래야** 했고,
 * 2026-09-03에 하나씩이 된 뒤에도 그대로 둔다.
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
// **레벨업에 쓴 카드를 전부 돌려주고 Lv1로 되돌린다** (2026-08-17 기획자 확정).
//
// ────────────────────────────────────────────────────────────────
// 「되감기」이지 「다시 고르기」가 아니다 ★
// ────────────────────────────────────────────────────────────────
//
// 처음 설계는 「레벨은 유지하고 선택만 전부 새로」였다. 그러면 **재설계 전용 절차**가
// 하나 더 생긴다 — Lv2부터 순서대로 다시 고르는 마법사, 걸음 되돌리기, 중간에 나가면
// 원래대로. 레벨업과 화면은 같아도 **규칙은 두 벌**이고, 무엇보다 「고르는 도중」이라는
// 어디에도 없던 상태를 화면이 들고 있어야 했다.
//
// 카드를 돌려주고 Lv1로 되돌리면 그게 전부 사라진다. 레벨업은 어차피
// **「카드 N장 → 레벨 +1 + 선택 하나」**이므로, 그걸 쓰기 전으로 되감으면 된다.
// 남는 절차는 **레벨업 하나뿐**이고 재설계는 그 앞의 한 수가 된다.
//
// > **되돌려주는 양이 정확히 누적 필요분이라 남지도 모자라지도 않는다.** 재설계한
// > 뒤 같은 레벨까지 다시 올리면 카드가 딱 떨어진다 — `growth.test.ts`가 고정한다.

/** 재설계 비용 — 둔갑천서 10냥 (GDD §6.2). 단일 출처는 엑셀 → `economy.json` */
export const RESPEC_GOLD: number = ECONOMY.respecItemGold;

/**
 * 그 레벨까지 오는 데 든 카드의 **누적**. Lv9면 100장이다 (GDD §4.3).
 *
 * 재설계가 돌려주는 양이자, 화면이 「카드 N장을 돌려받는다」로 보여 주는 값이다.
 * **표를 옮겨 적지 않는다** — `cardsToLevelUp()`을 그대로 더한다.
 */
export function cardsSpentOn(level: number): number {
  let sum = 0;
  for (let lv = 1; lv < level; lv++) sum += cardsToLevelUp(lv) ?? 0;
  return sum;
}

// ────────────────────────────────────────────────────────────────
// 도시 이름 변경 — 랭킹·매칭에 노출되므로 값싼 재설정을 막는다
// ────────────────────────────────────────────────────────────────
//
// 비용은 재설계(둔갑천서)와 **같은 자리의 금화**를 그대로 쓴다(2026-08-25 기획) —
// 새 상수를 늘리지 않고 플레이어에게도 이미 익숙한 기준이다. 쿨다운은 `nowMs`를
// 받는 다른 함수들(`syncGrain`·`applyCityUpgrade`)과 같은 규약 — meta는 시계를
// 스스로 읽지 않는다.

/** 도시 이름 변경 비용 — 재설계와 같다 */
export const CITY_RENAME_GOLD: number = RESPEC_GOLD;

/** 도시 이름을 바꾼 뒤 다시 바꿀 수 없는 기간 — 3일 (2026-08-25 기획) */
export const RENAME_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

/** 도시 이름 최대 길이. `NewGameScreen`의 최초 입력과 같은 값이다 */
export const CITY_NAME_MAX = 12;

/** 도시 이름을 바꿀 수 있는가 */
export function canRenameCity(profile: PlayerProfile, name: string, nowMs: number): MetaResult {
  const trimmed = name.trim();
  if (!trimmed) return no('도시 이름을 입력해야 한다');
  if (trimmed.length > CITY_NAME_MAX) return no(`${CITY_NAME_MAX}자까지만 된다`);
  if (trimmed === profile.cityName) return no('지금과 같은 이름이다');
  if (profile.cityNameChangedAt !== undefined) {
    const nextOk = profile.cityNameChangedAt + RENAME_COOLDOWN_MS;
    if (nowMs < nextOk) return no(`아직 바꿀 수 없다 — ${Math.ceil((nextOk - nowMs) / 86_400_000)}일 남았다`);
  }
  if (profile.gold < CITY_RENAME_GOLD) return no(`금화가 부족하다 — ${profile.gold}/${CITY_RENAME_GOLD}`);
  return { ok: true };
}

/** 도시 이름을 바꾼다 — 금화를 내고 쿨다운 시각을 찍는다 */
export function applyRenameCity(profile: PlayerProfile, name: string, nowMs: number): PlayerProfile {
  const trimmed = name.trim();
  const check = canRenameCity(profile, trimmed, nowMs);
  if (!check.ok) throw new Error(`도시 이름을 바꿀 수 없다: ${check.reason}`);

  const next = clone(profile);
  next.cityName = trimmed;
  next.gold -= CITY_RENAME_GOLD;
  next.cityNameChangedAt = nowMs;
  return next;
}

/** 재설계할 수 있는가. Lv1은 되감을 것이 없다 */
export function canRespec(profile: PlayerProfile, officer: OfficerId): MetaResult {
  const inst = profile.roster[officer];
  if (!inst) return no('보유하지 않은 장수다');
  if (inst.level < 2) return no('Lv1은 아직 올린 적이 없다');
  if (profile.gold < RESPEC_GOLD) return no(`둔갑천서가 필요하다 — 금화 ${profile.gold}/${RESPEC_GOLD}`);
  return { ok: true };
}

/**
 * 레벨업을 되감는다 — **쓴 카드를 전부 돌려주고 Lv1로.**
 *
 * 성장 스택은 비고 레벨도 1이 되므로 `growth.length === level - 1`은 그대로 참이다
 * (`0 === 0`). 그 뒤는 **정상 레벨업 절차**를 다시 밟는다 — 재설계 전용 규칙이 없다.
 *
 * **전적(`record`)은 건드리지 않는다.** 되감는 것은 성장이지 그 캐릭터가 싸운 역사가
 * 아니다. 보유 자체도 그대로다(풀에서 빠지지 않는다).
 *
 * **결과는 정상 성장과 구별되지 않는다** — 표식을 남기지 않는다. 남기면 그게 곧
 * 차별 대상이 된다(매칭·랭킹에서 「재설계한 캐릭터」를 따로 볼 이유가 없다).
 */
export function applyRespec(profile: PlayerProfile, officer: OfficerId): PlayerProfile {
  const check = canRespec(profile, officer);
  if (!check.ok) throw new Error(`재설계할 수 없다(${officer}): ${check.reason}`);

  const next = clone(profile);
  const inst = next.roster[officer]!;
  const refund = cardsSpentOn(inst.level);

  next.gold -= RESPEC_GOLD;
  // 이미 갖고 있던 여분 카드에 **더한다** — 덮어쓰면 모아 둔 것이 사라진다
  next.cards[officer] = (next.cards[officer] ?? 0) + refund;
  inst.level = 1;
  inst.growth = [];
  return next;
}

/**
 * 성장 스택이 그 레벨에 성립하는가. 어긋나면 **왜인지**를 돌려준다(성립하면 `null`).
 *
 * **「성립하는 성장 스택」의 단일 정의다** — 레벨마다 능력 하나, 책략은 그 레벨의
 * 한 school **전부**(Lv6·7의 지원은 짝을 통째로). `migrateProfile()`이 되접은 결과를
 * 이걸로 검산해 **성립하는 데까지만** 남긴다. 저장소에는 사람이 손으로 고친 것도
 * 들어 있을 수 있고, 어긋난 스택은 `createBattle`이 던져 전투를 막는다.
 */
export function checkGrowth(steps: readonly GrowthStep[], level: number): string | null {
  if (steps.length !== level - 1) return `${steps.length}단계, Lv${level}에는 ${level - 1}단계가 필요하다`;
  for (const [i, step] of steps.entries()) {
    const lv = i + 2;
    if (!GROWTH.statChoices.some((c) => step.stat in c)) return `Lv${lv}: 알 수 없는 능력 「${step.stat}」`;
    const school = tacticById.get(step.tactics[0] ?? '')?.school;
    if (!school) return `Lv${lv}: 책략을 고르지 않았거나 알 수 없는 책략이다`;
    // 그 레벨이 주는 것을 **전부** 가져야 한다 — 예전 Lv6·7처럼 둘씩 주는 레벨이
    // 다시 생겨도(지금은 전부 하나씩) 이 검사는 그대로 선다
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
