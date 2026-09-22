/**
 * 태학 — 책략 개량 연구 (GDD §5.12, 2026-09-22 기획자 확정)
 *
 * ────────────────────────────────────────────────────────────────
 * 규칙 다섯
 * ────────────────────────────────────────────────────────────────
 *
 * | | |
 * |---|---|
 * | 단위 | **계정.** 「회복+」를 연구하면 회복을 익힌 장수 **전원**이 전투에서 회복+를 쓴다 |
 * | 주제 | 태학 레벨마다 하나(3중 택1). 레벨 L의 주제는 태학 Lv ≥ L이면 **순서와 무관하게** |
 * | 진행 | **동시에 하나** · 실제 1시간 · 무료 · 취소 가능(잃는 것이 없다) |
 * | 끝남 | `syncCity()`가 거두고 `notice`에 넣는다 — 전투 화면이 아닌 곳에서 축하 팝업 |
 * | 되돌리기 | 금화 10냥(둔갑천서와 같은 값) — 끝낸 연구를 전부 비우고 Lv1부터 다시 고른다 |
 *
 * ────────────────────────────────────────────────────────────────
 * 바꿔 끼우는 자리는 하나다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 장수의 성장 스택(`growth`)은 **원본 id 그대로**다 — 연구가 장수를 건드리지 않는다.
 * 전투로 들어가는 길(`toRosterEntries()`)에서 `upgradeTactics()`가 원본을 개량형으로
 * 갈아 끼우고, 화면도 같은 함수로 이름을 고른다. 성장 스택에 개량형 id를 적으면
 * 되돌리기가 장수 260명을 훑어야 하고, 레벨업 검산(`checkGrowth`)이 그 id를 모른다.
 *
 * ────────────────────────────────────────────────────────────────
 * 「언제 끝났나」가 재생 검증의 뜻이다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * AI 대전은 판이 **끝난 뒤** 서버가 같은 시드로 다시 돌려 검증한다. 전투 도중에 연구가
 * 끝나면 클라이언트는 원본으로 싸웠는데 서버는 개량형으로 재생해 **정상 플레이가
 * 거부된다.** 그래서 전투를 만드는 자리는 판의 시작 시각을 넘기고, 그때까지 **끝나
 * 있던** 연구만 적용한다(`researchedUpgrades(profile, atMs)`). 부상(`isInjured`)이
 * 같은 이유로 같은 시각을 받는다. 그래서 `doneAt`은 정산한 시각이 아니라
 * **시작 + 연구 시간**이다.
 *
 * 순수 함수다 — 시계는 `nowMs`로 받는다(「meta에 시계를 들이지 않는다」).
 */

import {
  ACADEMY_RESEARCH_MINUTES, ACADEMY_TOPICS, ECONOMY, buildingById, tacticById, upgradeIdOf,
} from '@samchess/data';
import type { TacticData } from '@samchess/data';
import type { TacticId } from '@samchess/rules';
import { buildingLevel } from './city.ts';
import { tacticsOf } from './profile.ts';
import type { AcademyState, MetaResult, PlayerProfile } from './types.ts';

/** 한 번 연구에 드는 실제 시간 — 데이터(`tacticUpgrades.json`)에서 온다 */
export const ACADEMY_RESEARCH_MS: number = ACADEMY_RESEARCH_MINUTES * 60_000;

/**
 * 연구 되돌리기 값 — **둔갑천서와 같은 금화**(2026-09-22 기획자 지정). 도시 이름 변경
 * (`CITY_RENAME_GOLD`)처럼 새 숫자를 늘리지 않고 같은 자리를 쓴다. 상점에서 파는 칸은
 * 아직 없다 — 서버 경로(`POST /academy/reset`)만 먼저 섰다.
 */
// `profile.ts`의 `RESPEC_GOLD`를 import하지 않고 같은 출처를 직접 읽는다 — profile → city →
// academy → profile 순환에서 모듈 최상단 상수는 아직 초기화 전일 수 있다(TDZ)
export const ACADEMY_RESET_GOLD: number = ECONOMY.respecItemGold;

/** 태학의 최대 레벨 = 주제 수. 데이터가 정한다 */
export const ACADEMY_MAX_LEVEL: number = buildingById.get('academy')?.maxLevel ?? 5;

/** 이 파일의 규칙이 낼 수 있는 이유 코드 — 화면 번역(`reason.{code}`)이 빠지면 테스트가 깨진다 */
export const ACADEMY_REASONS = [
  'academy.unknown', 'academy.notBuilt', 'academy.locked', 'academy.levelDone', 'academy.busy',
  'academy.idle', 'academy.nothing', 'academy.gold',
] as const;

const EMPTY: AcademyState = { done: [] };

/** 계정의 연구 상태. **없으면 빈 상태** — 읽는 자리마다 `?? { done: [] }`가 흩어지지 않게 */
export const academyOf = (profile: PlayerProfile): AcademyState => profile.academy ?? EMPTY;

/** 태학 레벨. 안 지었으면 0 */
export const academyLevel = (profile: PlayerProfile): number => buildingLevel(profile, 'academy');

/** 그 태학 레벨이 여는 주제 셋(개량형 정의). 범위 밖이면 빈 배열 */
export function academyTopics(level: number): TacticData[] {
  return (ACADEMY_TOPICS.get(level) ?? [])
    .map((id) => tacticById.get(id))
    .filter((t): t is TacticData => !!t);
}

/** 개량형 정의. 개량형이 아니면 `undefined` */
export function upgradeDef(id: string): TacticData | undefined {
  const def = tacticById.get(id);
  return def?.base ? def : undefined;
}

/** 진행 중인 연구의 남은 시간(ms). 끝났거나 없으면 0 */
export function researchRemainingMs(profile: PlayerProfile, nowMs: number): number {
  const r = academyOf(profile).research;
  return r ? Math.max(0, r.startedAt + ACADEMY_RESEARCH_MS - nowMs) : 0;
}

/**
 * 태학 레벨 하나의 형편 — 화면의 [연구하기] 목록이 이것을 그대로 그린다.
 *
 * | 값 | 뜻 |
 * |---|---|
 * | `locked` | 태학이 아직 그 레벨이 아니다 |
 * | `open` | 고를 수 있다(진행 중인 연구가 있으면 `canStartResearch`가 막는다) |
 * | `researching` | 이 레벨의 주제 하나를 연구 중이다 — `tactic`이 그것 |
 * | `done` | 이 레벨은 끝났다 — `tactic`이 고른 것 |
 */
export type AcademySlot =
  | { level: number; state: 'locked' | 'open' }
  | { level: number; state: 'researching' | 'done'; tactic: TacticId };

export function academySlots(profile: PlayerProfile): AcademySlot[] {
  const lv = academyLevel(profile);
  const a = academyOf(profile);
  const out: AcademySlot[] = [];
  for (let level = 1; level <= ACADEMY_MAX_LEVEL; level++) {
    const done = a.done.find((d) => d.level === level);
    if (done) out.push({ level, state: 'done', tactic: done.tactic });
    else if (a.research?.level === level) out.push({ level, state: 'researching', tactic: a.research.tactic });
    else out.push({ level, state: level <= lv ? 'open' : 'locked' });
  }
  return out;
}

export function canStartResearch(profile: PlayerProfile, tactic: string): MetaResult {
  const def = upgradeDef(tactic);
  if (!def || def.academyLevel === undefined) return no(`모르는 연구 주제다 — ${tactic}`, 'unknown');
  const level = def.academyLevel;
  const have = academyLevel(profile);
  if (have < 1) return no('태학을 아직 짓지 않았다', 'notBuilt');
  if (level > have) return no(`태학 Lv${level}이 필요하다 — 지금 Lv${have}`, 'locked', { level, have });
  const a = academyOf(profile);
  if (a.done.some((d) => d.level === level)) return no(`태학 Lv${level}의 연구는 이미 끝냈다`, 'levelDone', { level });
  if (a.research) return no('이미 다른 연구가 진행 중이다', 'busy');
  return { ok: true };
}

/** 연구를 시작한다 — 시작 시각을 찍는다. **부르는 자리는 서버다**(`POST /academy/research`) */
export function applyStartResearch(profile: PlayerProfile, tactic: string, nowMs: number): PlayerProfile {
  const check = canStartResearch(profile, tactic);
  if (!check.ok) throw new Error(check.reason);
  const def = upgradeDef(tactic)!;
  const a = academyOf(profile);
  return {
    ...profile,
    academy: { ...a, research: { level: def.academyLevel!, tactic: def.id as TacticId, startedAt: Math.floor(nowMs) } },
  };
}

export function canCancelResearch(profile: PlayerProfile): MetaResult {
  return academyOf(profile).research ? { ok: true } : no('진행 중인 연구가 없다', 'idle');
}

/**
 * 진행 중인 연구를 그만둔다 — **무료라 잃는 것이 없다**(기획자 확정). 그 레벨은 다시
 * `open`이 되어 다른 주제를 고를 수 있다.
 *
 * ⚠ **끝난 연구는 취소가 아니다.** 부르기 전에 `syncCity()`로 거두어 두지 않으면
 * 이미 1시간이 지난 연구를 여기서 지워 버린다 — 서버 경로는 `getProfile()`이 늘
 * 먼저 정산하므로 안전하다. 그래도 여기서 한 번 더 막는다.
 */
export function applyCancelResearch(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const check = canCancelResearch(profile);
  if (!check.ok) throw new Error(check.reason);
  if (researchRemainingMs(profile, nowMs) <= 0) throw new Error('이미 끝난 연구는 취소할 수 없다');
  const { research: _drop, ...rest } = academyOf(profile);
  return { ...profile, academy: rest };
}

/**
 * 끝난 연구를 거둔다 — `done`으로 옮기고 `notice`에 넣는다. 아직이면 **같은 객체**를
 * 돌려준다(`syncCity()`의 「바뀐 게 없으면 같은 참조」 규약).
 *
 * **`city.ts`의 `syncCity()`가 이 함수를 부르는 하나의 자리다** — 대장간의
 * `collectForgeOrder()`와 같은 결.
 */
export function collectResearch(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const a = profile.academy;
  const r = a?.research;
  if (!a || !r) return profile;
  if (r.startedAt + ACADEMY_RESEARCH_MS > nowMs) return profile;
  const { research: _drop, ...rest } = a;
  return {
    ...profile,
    academy: {
      ...rest,
      // 같은 레벨이 두 번 들어가지 않게 — 되접기(`migrate`)가 이미 막지만 여기서도 지킨다
      done: [...a.done.filter((d) => d.level !== r.level),
        { level: r.level, tactic: r.tactic, doneAt: r.startedAt + ACADEMY_RESEARCH_MS }],
      notice: [...(a.notice ?? []).filter((t) => t !== r.tactic), r.tactic],
    },
  };
}

/** 축하 팝업을 봤다 — `notice`를 비운다. 비어 있으면 같은 객체 */
export function applyAckResearch(profile: PlayerProfile): PlayerProfile {
  const a = profile.academy;
  if (!a?.notice?.length) return profile;
  const { notice: _drop, ...rest } = a;
  return { ...profile, academy: rest };
}

export function canResetAcademy(profile: PlayerProfile): MetaResult {
  const a = academyOf(profile);
  if (a.done.length === 0 && !a.research) return no('되돌릴 연구가 없다', 'nothing');
  if (profile.gold < ACADEMY_RESET_GOLD) {
    return no(`금화가 부족하다 — ${profile.gold}/${ACADEMY_RESET_GOLD}`, 'gold', { have: profile.gold, need: ACADEMY_RESET_GOLD });
  }
  return { ok: true };
}

/**
 * 연구를 **전부** 되돌린다 — 끝낸 것도 진행 중인 것도 비운다. 그 뒤는 정상 연구 절차를
 * 다시 밟는다(되돌리기 전용 규칙이 없다 — 둔갑천서의 「되감기」와 같은 결).
 * **부르는 자리는 서버다**(`POST /academy/reset`, 금화가 서버 소유라서다).
 */
export function applyResetAcademy(profile: PlayerProfile): PlayerProfile {
  const check = canResetAcademy(profile);
  if (!check.ok) throw new Error(check.reason);
  return { ...profile, gold: profile.gold - ACADEMY_RESET_GOLD, academy: { done: [] } };
}

/**
 * 적용 중인 개량형 id들.
 *
 * `atMs`를 주면 **그 시각까지 끝나 있던 것만** 센다 — 전투를 만드는 자리(판의 시작
 * 시각)와 서버의 재생 검증이 같은 답을 내게 하려는 것이다(머리말 ★). 아직 거두지
 * 않았지만 그 시각에 이미 끝난 진행 중 연구도 센다 — 정산이 늦었을 뿐이다.
 * `atMs`가 없으면 끝낸 것 전부다(화면 표시).
 */
export function researchedUpgrades(profile: PlayerProfile, atMs?: number): Set<string> {
  const a = academyOf(profile);
  const out = new Set<string>();
  for (const d of a.done) if (atMs === undefined || d.doneAt <= atMs) out.add(d.tactic);
  const r = a.research;
  if (r && atMs !== undefined && r.startedAt + ACADEMY_RESEARCH_MS <= atMs) out.add(r.tactic);
  return out;
}

/**
 * 원본 책략 id들을 **연구된 만큼** 개량형으로 갈아 끼운다. 순서는 그대로다.
 *
 * `toRosterEntries()`(전투)와 화면(장수 상세)이 부른다 — 바꿔 끼우는 규칙은 여기 하나다.
 */
export function upgradeTactics(
  profile: PlayerProfile, tactics: readonly TacticId[], atMs?: number,
): TacticId[] {
  const have = researchedUpgrades(profile, atMs);
  if (have.size === 0) return [...tactics];
  return tactics.map((id) => {
    const up = upgradeIdOf.get(id);
    return up && have.has(up) ? (up as TacticId) : id;
  });
}

/**
 * 이 개량형을 **쓰게 되는** 보유 장수 수 — 축하 팝업의 「N명에게 일괄 적용」.
 * 원본을 익힌 장수를 센다(풀에 있는 장수만 — 보관함은 성장 스택이 없다).
 */
export function officersUsingUpgrade(profile: PlayerProfile, upgradeId: string): number {
  const base = upgradeDef(upgradeId)?.base;
  if (!base) return 0;
  return Object.values(profile.roster).filter((inst) => tacticsOf(inst).includes(base as TacticId)).length;
}

const no = (reason: string, code?: string, params?: Record<string, number>): MetaResult =>
  ({ ok: false, reason, ...(code ? { code: `academy.${code}` } : {}), ...(params ? { params } : {}) });
