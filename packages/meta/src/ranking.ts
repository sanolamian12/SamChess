/**
 * 랭킹 — **전투 · 도시화 · 컬렉션** 세 분야 (2026-11-20 기획자, 옛 도시 · 부대 · 장수 세 판을 바꿨다)
 *
 * ────────────────────────────────────────────────────────────────
 * 한 프로필에서 행을 뽑는 자리라서 서버와 클라가 같이 쓴다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 서버는 이 함수들로 **전체 유저**를 훑어 1~10위 · 검색 · 내 순위를 낸다(`packages/server-api`의 `ranking.ts`).
 * 클라이언트는 **자기 프로필 하나**에 같은 함수를 돌려 랭킹 메뉴의 「점수」를 낸다 — 서버가 안 닿아도 점수는 뜨고
 * 순위만 「—」다. 이 파일은 다른 유저의 것을 모른다 — 몇 등인가는 서버가 전체를 모아 매긴다.
 *
 * 순위는 **끝까지 정한다** — 점수가 같으면 정해 둔 다음 기준, 마지막은 도시 이름(계정 사이에 고유하다).
 * 그래서 같은 등수가 없고, 검색으로 찾은 도시의 등수가 1~10위 표의 등수와 같은 눈금이다(컬렉션 순위와 같은 규약).
 *
 * ────────────────────────────────────────────────────────────────
 * 전투 — 공격대의 승점 (부대 전적, 2026-11-20)
 * ────────────────────────────────────────────────────────────────
 *
 * 전적은 장수가 아니라 **부대**로 본다. 점수는 그 모드 **공격대 칸의 승점**이고(`Squad.record`의 `points` —
 * 이긴 판마다 100 × (1 − 예상 승률), `rewards.ts`의 `winPoints()`), 「전체」는 두 모드 공격대의 합이다
 * (예상 승률은 모드를 묻지 않는 눈금이라 더해도 된다). 줄에는 병영과 같은 전 · 승 · 무 · 패 · 격파와
 * **수성 성공 수**를 보인다 — 수성 성공은 방어 기록(서버의 `defense_log`)에만 있어 이 함수가 인자로 받는다.
 * 수비대는 줄에 안 선다(수성전은 AI가 두어 수비대 칸에 전적이 안 쌓인다). **한 판도 안 뛴 도시는 줄에 안 선다** —
 * 0점 수천이 같은 꼴찌로 서면 「몇 위」가 뜻이 없다(컬렉션의 「0점은 안 선다」와 같은 결).
 *
 * ────────────────────────────────────────────────────────────────
 * 도시화 — 도시 레벨 · 보유 장수 · 레벨 성숙도의 가중 합 (2026-11-20 기획자)
 * ────────────────────────────────────────────────────────────────
 *
 * 건물 레벨은 뺐다 — 도시 레벨을 올리면 따라 채워지는 것이라 두 번 세게 된다. 보유 장수는 풀 + 보관함
 * (`ownedOfficers()` — 증축 조건 · 황제 판정과 같은 셈), 성숙도는 **풀 장수들이 올린 레벨의 합**(Lv1이면 0 ~ Lv10이면 9).
 * 가중치는 `CITY_RANK_WEIGHTS` 하나다 — 바꾸면 화면의 점수 설명(`ranking.note.city`)도 함께 고친다.
 *
 * ────────────────────────────────────────────────────────────────
 * 컬렉션 — 완성할 때 받는 점수 (`collection.ts`의 `collectionRankRows`, 2026-10-13)
 * ────────────────────────────────────────────────────────────────
 *
 * 줄 세우기는 그쪽에 원래 있던 것 그대로다. 완성한 수는 보여 주기만 한다(점수가 같을 때의 둘째 기준이기는 하다).
 *
 * ────────────────────────────────────────────────────────────────
 * 장수 랭킹 · 부대 랭킹은 없어졌다 (2026-11-20)
 * ────────────────────────────────────────────────────────────────
 *
 * `officerRankRows()`는 남는다 — 이름과 달리 이제 **장수 카드의 행**(내 장수 상세 · 농지 · 부대원 고르기)을 만드는 자리다.
 * 장수 전적 칸은 같은 날 걷었다 — 정산이 세지 않고 저장 형식에도 없다(카드 행에 전적이 없다).
 */

import { officerById, tacticById } from '@samchess/data';
import type { StoryLang } from '@samchess/data';
import type { BattleMode, Grade, OfficerId } from '@samchess/rules';
import { atRange } from './officers.ts';
import { ownedOfficers, statsOf, tacticsOf } from './profile.ts';
import { sumTally } from './records.ts';
import { squadAt } from './squads.ts';
import type { PlayerProfile, RecordTally } from './types.ts';

/** 세 분야 */
export type RankBoard = 'battle' | 'city' | 'collection';
export const RANK_BOARDS: readonly RankBoard[] = ['battle', 'city', 'collection'];

/** 전투 랭킹의 모드 — `all`은 두 모드 공격대의 합 */
export type BattleRankMode = BattleMode | 'all';
export const BATTLE_RANK_MODES: readonly BattleRankMode[] = ['all', '3v3', '5v5'];

/** 상세 화면이 보이는 줄 수 — 1~10위. 검색해도 열 줄까지 */
export const RANK_TOP = 10;

/** 승점 — 이긴 판마다 쌓인 `winPoints()`의 합(2026-10-27 확정). 전투 랭킹 · 공성전 목록의 도시 점수가 같은 값을 쓴다 */
export const battleScore = (t: RecordTally): number => t.points;

/** 순위가 붙은 줄 — 1부터, 같은 등수 없음 */
export type Ranked<T> = T & { rank: number };

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** 줄 세운 목록에 1부터 등수를 붙인다 */
export const withRanks = <T>(sorted: readonly T[]): Ranked<T>[] => sorted.map((r, i) => ({ ...r, rank: i + 1 }));

// ── 전투 랭킹 ────────────────────────────────────────────────────

export interface BattleRankRow {
  cityName: string;
  /** 공격대 전적 — `all`이면 두 모드의 합 */
  tally: RecordTally;
  /** 수성 성공 수 — 방어 기록에서 센 값(서버가 넣는다) */
  held: number;
  /** 점수 = 승점 */
  total: number;
}

const modesOf = (mode: BattleRankMode): readonly BattleMode[] => (mode === 'all' ? ['3v3', '5v5'] : [mode]);

/** 공격대 전적 — 병영의 모드 줄과 같은 값(그 모드 공격대 칸의 `record`). `all`이면 두 칸을 더한다 */
export function attackTally(profile: PlayerProfile, mode: BattleRankMode): RecordTally {
  // 키가 `{상대}/{모드}`라 두 모드 칸이 겹치지 않는다 — 합쳐 한 번에 센다
  return sumTally(Object.assign({}, ...modesOf(mode).map((m) => squadAt(profile, m, 'attack')?.record ?? {})));
}

/** 전투 랭킹의 한 줄 — `heldByMode`는 서버가 방어 기록에서 센 수성 성공(없으면 0) */
export function battleRankRow(
  profile: PlayerProfile, mode: BattleRankMode, heldByMode?: Partial<Record<BattleMode, number>>,
): BattleRankRow {
  const tally = attackTally(profile, mode);
  const held = modesOf(mode).reduce((n, m) => n + (heldByMode?.[m] ?? 0), 0);
  return { cityName: profile.cityName, tally, held, total: battleScore(tally) };
}

/** 줄에 서는가 — 공격대로 한 판이라도 뛰었다 */
export const battleRankable = (row: BattleRankRow): boolean => row.tally.plays > 0;

/** 승점 → 승 → 격파 → 도시 이름 */
export function sortBattleRows<T extends BattleRankRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.total - a.total || b.tally.wins - a.tally.wins
    || b.tally.kills - a.tally.kills || byName(a.cityName, b.cityName));
}

// ── 도시화 랭킹 ──────────────────────────────────────────────────

/**
 * 도시화 점수의 가중치 (2026-11-20 기획자 — 가중 합). 범위는 도시 레벨 1~11 · 보유 장수 ~260 · 올린 레벨 합 ~2,340이라
 * 한 계정에서 대략 100~1,100 · 10~2,600 · 0~2,340이 된다. **리터럴로 적는다** — 화면의 설명 문장이 이 값을 끼운다.
 */
export const CITY_RANK_WEIGHTS = { cityLevel: 100, officer: 10, level: 1 } as const;

export interface CityRankRow {
  cityName: string;
  cityLevel: number;
  /** 보유 장수 — 풀 + 보관함 */
  officers: number;
  /** 레벨 성숙도 — 풀 장수들이 올린 레벨의 합 */
  maturity: number;
  /** 점수 = 가중 합 */
  total: number;
}

/** 레벨 성숙도 — 풀 장수들이 올린 레벨(Lv − 1)의 합 */
export const levelMaturity = (profile: PlayerProfile): number =>
  Object.values(profile.roster).reduce((n, inst) => n + Math.max(0, inst.level - 1), 0);

export function cityRankRow(profile: PlayerProfile): CityRankRow {
  const officers = ownedOfficers(profile).length;
  const maturity = levelMaturity(profile);
  const w = CITY_RANK_WEIGHTS;
  return {
    cityName: profile.cityName, cityLevel: profile.cityLevel, officers, maturity,
    total: profile.cityLevel * w.cityLevel + officers * w.officer + maturity * w.level,
  };
}

/** 점수 → 도시 레벨 → 도시 이름 */
export function sortCityRows<T extends CityRankRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.total - a.total || b.cityLevel - a.cityLevel || byName(a.cityName, b.cityName));
}

// ── 내 순위 (랭킹 메뉴 위쪽 판) ──────────────────────────────────

/** 한 분야에서의 내 순위 · 점수 — 줄에 안 서면(전투 0판 · 컬렉션 0점) 그 분야가 `null` */
export interface MyRank { rank: number; total: number }

export interface MyRanks {
  battle: MyRank | null;
  city: MyRank;
  collection: MyRank | null;
}

// ── 장수 카드의 행 (옛 장수 랭킹의 행 — 이제 카드 데이터) ────────

export interface OfficerRankRow {
  cityName: string;
  officer: OfficerId;
  name: string;
  /**
   * 자(字) — 없는 장수도 있다(G1이 아직 218/260명만 채웠다, `@samchess/data` 참조).
   * 언어별 맵 그대로 싣는다(2026-08-27 열 언어 배선) — 어느 언어로 보여줄지는
   * `meta`가 안 고른다, 화면(클라이언트)이 `pickStory()`로 고른다.
   */
  courtesyName?: Partial<Record<StoryLang, string>>;
  grade: Grade;
  might: number;
  intellect: number;
  leadership: number;
  level: number;
  stats: { hp: number; mp: number };
  /** 공격력은 「AT 2-5」처럼 평타·크리티컬 범위로 보여준다 — `atRange()` 하나가 정본이다 */
  at: { min: number; max: number };
  /** 인물 서사 — 없을 수 있다(위와 같은 공백). 위 `courtesyName`과 같은 언어별 맵. */
  story?: Partial<Record<StoryLang, string>>;
  /**
   * 고유기술 id — `@samchess/data`의 `skillById`로 직접 찾는다. 정적 장수 데이터라
   * (레벨에 안 따라간다) 통째로 안 싣는다.
   */
  uniqueSkillId?: string;
  /**
   * 배운 책략 — **성장(레벨)에 달려 같은 장수라도 계정마다 다르다**, 그래서
   * 위 고유기술과 달리 여기서 직접 계산해 싣는다. `tacticsOf(inst)`가 단일 출처다.
   */
  tactics: { id: string; name: string; school: 'support' | 'illusion'; text: string }[];
}

/** 이 프로필의 보유 장수를 전부 카드 행으로 편다 */
export function officerRankRows(profile: PlayerProfile): OfficerRankRow[] {
  const rows: OfficerRankRow[] = [];
  for (const inst of Object.values(profile.roster)) {
    const data = officerById.get(inst.officer);
    if (!data) continue; // 데이터에 없는 장수(정정으로 id가 갈린 옛 저장분)는 버린다
    const { hp, mp } = statsOf(inst);
    const tactics = tacticsOf(inst)
      .map((id) => tacticById.get(id))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => ({ id: x.id, name: x.name, school: x.school, text: x.text }));
    rows.push({
      cityName: profile.cityName,
      officer: inst.officer,
      name: data.name,
      ...(data.courtesyName ? { courtesyName: data.courtesyName } : {}),
      grade: data.grade,
      might: data.might,
      intellect: data.intellect,
      leadership: data.leadership,
      level: inst.level,
      stats: { hp, mp },
      at: atRange(inst),
      ...(data.story ? { story: data.story } : {}),
      ...(data.uniqueSkill ? { uniqueSkillId: data.uniqueSkill } : {}),
      tactics,
    });
  }
  return rows;
}
