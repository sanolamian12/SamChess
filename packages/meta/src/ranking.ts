/**
 * 랭킹 — 도시 / 부대 / 장수 세 판 (pptx 46~49쪽, 2026-08-26)
 *
 * ────────────────────────────────────────────────────────────────
 * 한 프로필에서 행을 뽑는 자리라서 서버와 클라가 같이 쓴다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 서버는 이 함수들로 **전체 유저**를 훑어 top 5 · 검색을 낸다(`packages/server-api`).
 * 클라이언트는 **자기 프로필 하나**에 똑같은 함수를 돌려 "내 랭킹" 하단을 만든다 —
 * 서버 왕복 없이 즉시 뜨고, 서버가 죽어 있어도 보인다(§5-61과 같은 결).
 *
 * 이 파일은 다른 유저의 것을 절대 모른다 — "내가 몇 등인가"는 여기서 안 낸다.
 * 그건 서버가 전체를 모아 놓고 매기는 일이다.
 *
 * ────────────────────────────────────────────────────────────────
 * "총점" = 승×3 − 패 + 적격파 (2026-08-26 확정)
 * ────────────────────────────────────────────────────────────────
 *
 * pptx 47~49쪽이 요구한 「총점 순」에 어느 엑셀도 공식을 안 갖고 있었다 — 이
 * 프로젝트의 다른 밸런스 수치와 달리 정본 없이 화면만 먼저 왔다. 세 판(도시·부대·
 * 장수) 모두 **같은 식**이고, 계수가 셋뿐이라 툴팁 한 줄로 설명된다(전투력과 같은
 * 요구 — 위 「매칭이 아니다」 절 참조). `battleScore()` 하나가 정본이라, 나중에
 * 바뀌면 여기 한 곳만 고치면 세 판이 같이 따라간다.
 *
 * ────────────────────────────────────────────────────────────────
 * 부대 랭킹에는 "전투력"을 안 보여준다 (2026-08-27 확정 — 한 차례 뒤집었다)
 * ────────────────────────────────────────────────────────────────
 *
 * `power.ts`의 `battlePower()`는 9개 특징에 실측 회귀 계수를 곱한 값이라
 * (`might×1.47 + skillS×34.125 + … − 126.5`) 화면에 "왜 이 숫자인가"를 한 줄로
 * 설명할 수 없다 — 매칭에는 그래도 되지만(승률로 환산되는 눈금이면 충분하다),
 * 랭킹처럼 사람이 보고 납득해야 하는 자리에는 안 맞는다.
 *
 * 처음엔 `squadDisplayPower()`(`GRADE_SCORE` × 레벨의 합)라는 계수 없는 대체
 * 수치를 따로 뒀었는데, **부대 행을 누르면 구성(포지션·등급·레벨·HP·MP·AT)이
 * 그대로 펼쳐지므로** 요약 숫자 하나를 또 낼 필요가 없다고 뒤집었다 — 숫자
 * 하나로 뭉치면 오히려 "이게 뭘 뜻하는 숫자냐"는 질문이 하나 더 생긴다. 그래서
 * `SquadRankRow`에는 `power`가 아예 없다. **매칭·저장 쪽 `battlePower()`는
 * 그대로다** — 여기서 빠진 것은 랭킹 화면의 표시값 뿐이다.
 */

import { officerById, tacticById } from '@samchess/data';
import type { BattleMode, Grade, OfficerId } from '@samchess/rules';
import { atRange } from './officers.ts';
import { gradeScore, statsOf, tacticsOf } from './profile.ts';
import { sumTally, totalTally, whereOf } from './records.ts';
import type { RecordFilter } from './records.ts';
import { squadRow } from './squads.ts';
import type { SquadMember } from './squads.ts';
import type { PlayerProfile, RecordTally, Squad } from './types.ts';

export type RankBoard = 'city' | 'squad' | 'officer';
export type CityRankSort = 'size' | 'battle' | 'total';
export type SquadRankSort = 'battle' | 'total';
/**
 * pptx 49쪽(장수 랭킹)은 47쪽의 정렬 버튼 셋을 그대로 복사해 「도시 규모 순」이 붙어
 * 있는데, 장수 한 명 한 명의 행에는 뜻이 없는 기준이다(같은 슬라이드 틀을 복붙한
 * 흔적으로 보인다). 붙어 있는 열(레벨)에 맞춰 「레벨 순」으로 바꿔 단다.
 */
export type OfficerRankSort = 'level' | 'battle' | 'total';

/** 총점 — 「승×3 − 패 + 적격파」(2026-08-26 확정, 위 머리말 참조). 세 판이 같은 식을 쓴다 */
export const battleScore = (t: RecordTally): number => t.wins * 3 - t.losses + t.kills;

// ── 도시 랭킹 ────────────────────────────────────────────────────

export interface CityRankRow {
  cityName: string;
  cityLevel: number;
  officerCount: number;
  gradeScore: number;
  tally: RecordTally;
  total: number;
}

export function cityRankRow(
  profile: PlayerProfile, filter: RecordFilter, mode?: BattleMode,
): CityRankRow {
  const where = { ...whereOf(filter), ...(mode ? { mode } : {}) };
  const tally = sumTally(profile.record, where);
  return {
    cityName: profile.cityName,
    cityLevel: profile.cityLevel,
    officerCount: Object.keys(profile.roster).length,
    gradeScore: gradeScore(profile),
    tally,
    total: battleScore(tally),
  };
}

export function sortCityRows(rows: readonly CityRankRow[], sort: CityRankSort): CityRankRow[] {
  const out = [...rows];
  if (sort === 'size') {
    out.sort((a, b) => b.cityLevel - a.cityLevel || b.officerCount - a.officerCount);
  } else if (sort === 'battle') {
    out.sort((a, b) => b.tally.wins - a.tally.wins || b.tally.kills - a.tally.kills);
  } else {
    out.sort((a, b) => b.total - a.total);
  }
  return out;
}

// ── 부대 랭킹 ────────────────────────────────────────────────────

export interface SquadRankRow {
  cityName: string;
  squad: Squad;
  members: SquadMember[];
  tally: RecordTally;
  total: number;
}

/** 이 프로필의 부대를 전부 행으로 편다 — `mode`를 주면 그 모드만(3v3/5v5는 안 섞는다) */
export function squadRankRows(
  profile: PlayerProfile, filter: RecordFilter, mode?: BattleMode,
): SquadRankRow[] {
  const where = whereOf(filter);
  return profile.squads
    .filter((s) => !mode || s.mode === mode)
    .map((squad) => {
      const row = squadRow(profile, squad);
      const tally = sumTally(squad.record, where);
      return {
        cityName: profile.cityName,
        squad,
        members: row.members,
        tally,
        total: battleScore(tally),
      };
    });
}

export function sortSquadRows(rows: readonly SquadRankRow[], sort: SquadRankSort): SquadRankRow[] {
  const out = [...rows];
  if (sort === 'battle') {
    out.sort((a, b) => b.tally.wins - a.tally.wins || b.tally.kills - a.tally.kills);
  } else {
    out.sort((a, b) => b.total - a.total);
  }
  return out;
}

// ── 장수 랭킹 ────────────────────────────────────────────────────

export interface OfficerRankRow {
  cityName: string;
  officer: OfficerId;
  name: string;
  /** 자(字) — 없는 장수도 있다(G1이 아직 218/260명만 채웠다, `@samchess/data` 참조) */
  courtesyName?: string;
  grade: Grade;
  might: number;
  intellect: number;
  leadership: number;
  level: number;
  stats: { hp: number; mp: number };
  /** 공격력은 「AT 2-5」처럼 평타·크리티컬 범위로 보여준다 — `atRange()` 하나가 정본이다 */
  at: { min: number; max: number };
  /** 인물 서사 — 없을 수 있다(위와 같은 공백) */
  story?: string;
  /**
   * 고유기술 id — `@samchess/data`의 `skillById`로 직접 찾는다. 정적 장수 데이터라
   * (레벨에 안 따라간다) 통째로 안 싣는다 — SP·유래·효과문까지 매 랭킹 행마다
   * 실으면 네트워크만 무거워진다(스냅샷에 로그를 안 싣는 것과 같은 결).
   */
  uniqueSkillId?: string;
  /**
   * 배운 책략 — 이건 **성장(레벨)에 달려 같은 장수라도 계정마다 다르다**, 그래서
   * 위 고유기술과 달리 여기서 직접 계산해 싣는다. `tacticsOf(inst)`가 단일 출처다.
   */
  tactics: { id: string; name: string; school: 'support' | 'illusion'; text: string }[];
  tally: RecordTally;
  total: number;
}

/** 이 프로필의 보유 장수를 전부 행으로 편다 — 40쪽 장수 전적과 같은 필터 두 갈래 */
export function officerRankRows(profile: PlayerProfile, filter: RecordFilter): OfficerRankRow[] {
  const rows: OfficerRankRow[] = [];
  for (const inst of Object.values(profile.roster)) {
    const data = officerById.get(inst.officer);
    if (!data) continue; // 데이터에 없는 장수(정정으로 id가 갈린 옛 저장분)는 버린다
    const tally = totalTally(inst, filter);
    const { hp, mp } = statsOf(inst, inst.level);
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
      tally,
      total: battleScore(tally),
    });
  }
  return rows;
}

export function sortOfficerRows(rows: readonly OfficerRankRow[], sort: OfficerRankSort): OfficerRankRow[] {
  const out = [...rows];
  if (sort === 'level') {
    out.sort((a, b) => b.level - a.level);
  } else if (sort === 'battle') {
    out.sort((a, b) => b.tally.wins - a.tally.wins || b.tally.kills - a.tally.kills);
  } else {
    out.sort((a, b) => b.total - a.total);
  }
  return out;
}
