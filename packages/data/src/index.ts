/**
 * @samchess/data — 정적 게임 데이터 로더
 *
 * generated/ 아래 JSON은 `python tools/extract_data.py`가 원본 엑셀에서 생성한다.
 * **직접 수정하지 말 것.** 원본을 고치고 추출을 다시 돌린다.
 */

import officersJson from '../generated/officers.json' with { type: 'json' };
import uniqueSkillsJson from '../generated/uniqueSkills.json' with { type: 'json' };
import piecesJson from '../generated/pieces.json' with { type: 'json' };
import tacticsJson from '../generated/tactics.json' with { type: 'json' };
import growthJson from '../generated/growth.json' with { type: 'json' };
import cityJson from '../generated/city.json' with { type: 'json' };
import teamScoresJson from '../generated/teamScores.json' with { type: 'json' };
import economyJson from '../generated/economy.json' with { type: 'json' };
import reportJson from '../generated/build-report.json' with { type: 'json' };

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E';
export type PieceType = 'King' | 'Rock' | 'Bishop' | 'Knight' | 'Queen' | 'Pawn';

export interface OfficerData {
  id: string;
  name: string;
  grade: Grade;
  might: number;
  intellect: number;
  leadership: number;
  faction: string;
  portrait: string;
  /** 190 − 통솔력 (GDD §3.3) */
  wtBase: number;
  uniqueSkill: string | null;
}

export interface UniqueSkillData {
  id: string;
  name: string;
  hanja: string;
  tier: 'S' | 'A' | 'B' | 'E';
  spCost: number;
  text: string;
  effects: unknown[];
  scriptId: string | null;
  /** 이 스킬을 가진 장수 id 목록. A/B급은 여럿이 공유한다. */
  holders: string[];
}

export interface PieceData {
  type: PieceType;
  moveMask: { x: number; y: number }[];
  moveBlocked: boolean;
  attackMask: { x: number; y: number }[];
  maxTargets: number;
  /** 이동 후 공격까지의 합집합 (원점 포함) */
  threatRange: number;
}

export interface TacticData {
  id: string;
  name: string;
  school: 'support' | 'illusion';
  level: number;
  mpCost: number;
  text: string;
  requiresResistCheck: boolean;
  effects: unknown[];
}

export interface CityLevelData {
  level: number;
  materialsToUpgrade: number | null;
  grainPerHour: number;
  grainCap: number;
  characterPool: number;
}

export const OFFICERS = officersJson as OfficerData[];
export const UNIQUE_SKILLS = uniqueSkillsJson as UniqueSkillData[];
export const PIECES = piecesJson as PieceData[];
export const TACTICS = tacticsJson as TacticData[];
export const GROWTH = growthJson;
export const CITY_LEVELS = cityJson as CityLevelData[];
export const TEAM_SCORES = teamScoresJson;
export const ECONOMY = economyJson;
export const BUILD_REPORT = reportJson;

// ── 조회 인덱스 ────────────────────────────────────────────────

export const officerById = new Map(OFFICERS.map((o) => [o.id, o]));
export const officerByName = new Map(OFFICERS.map((o) => [o.name, o]));
export const skillById = new Map(UNIQUE_SKILLS.map((s) => [s.id, s]));
export const pieceByType = new Map(PIECES.map((p) => [p.type, p]));
export const tacticById = new Map(TACTICS.map((t) => [t.id, t]));

/** 해당 레벨에서 선택 가능한 책략 (지원 1개 + 환술 1개, Lv6·7은 생성/제거 쌍) */
export function tacticsForLevel(level: number): TacticData[] {
  return TACTICS.filter((t) => t.level === level);
}

export function officersByGrade(grade: Grade): OfficerData[] {
  return OFFICERS.filter((o) => o.grade === grade);
}
