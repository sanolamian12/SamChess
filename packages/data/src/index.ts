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
import visualEffectsJson from '../generated/visualEffects.json' with { type: 'json' };
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
  /**
   * 이름의 다른 언어 표기 — `assets/Languages/sam_people.csv`의 `name_{lang}`
   * (2026-09-02, 랭킹 화면의 장수 정보 패널에서 인물 열전은 번역되는데 이름은
   * 한국어 그대로인 것을 보고 연결). `name`(한국어, id·Map 키로 쓰는 기준
   * 언어)은 여기 다시 담지 않는다 — 화면은 `nameI18n?.[lang] ?? name`으로
   * 고른다, `courtesyName`·`story`와 같은 규약이다.
   */
  nameI18n?: Partial<Record<StoryLang, string>>;
  /**
   * 자(字) — `assets/Languages/sam_people.csv`의 `courtesy_{lang}` (G1,
   * 2026-08-27 연결 · 같은 날 두 번째 세션에서 열 언어로 넓힘). 장수 카드의
   * 「이름 자 [등급]」 제목에 쓴다. **모든 장수가 다 있다** — 2026-08-31,
   * G1이 나머지 42명분을 채워 260/260 연결(`npm run extract` 로그의
   * `[열전]` 참고 — 그때 이름 표기 8건이 엑셀·초상화 파일명과 어긋난 것도
   * 함께 잡아 `tools/extract_data.py`의 `NAME_FIXES`에 정리했다). 다만
   * **있는 장수도 언어별로 빠질 수 있다** — 그래서
   * `Partial<Record<StoryLang, string>>`이다. 화면(클라이언트)이 현재 UI
   * 언어로 찾고, 없으면 `ko`로 물러난다 — `t()`가 번역 없을 때 하는 것과
   * 같은 규약이다. **이 패키지 자신은 "지금 UI 언어가 뭔지" 모른다** — 그건
   * 클라이언트의 `i18n`이 아는 일이라, 여기서 언어를 고르지 않고 맵 전체를
   * 그대로 낸다.
   */
  courtesyName?: Partial<Record<StoryLang, string>>;
  /**
   * 인물 서사 — 「인물 소개: 두 문장 정도?」 (pptx 38·53쪽). **G1이 채웠다**
   * (2026-08-27 최초 218명 · 2026-08-31 나머지 42명까지 채워 260/260,
   * `sam_people.csv`의 `bio_{lang}`) — 열 언어 다 채워져 있다(실측). 그래도
   * 화면은 이 필드를 여전히 optional로 다뤄야 한다 — 다음에 장수가 늘면
   * 다시 공백이 생긴다. 없으면 상세 화면은 **그 줄째로 물러난다** —
   * `assets/`가 없으면 건너뛰는 것과 같은 규약이다. 언어 선택은 위
   * `courtesyName`과 같은 규약 — 여기서 안 고르고 맵을 그대로 낸다.
   */
  story?: Partial<Record<StoryLang, string>>;
}

/**
 * 장수 열전(`courtesyName`/`story`)이 갖는 언어 코드 — 클라이언트 `Lang`
 * (`packages/client/src/i18n/index.ts`)과 **값이 같아야 한다**(둘 다
 * `assets/Languages/`의 열 언어를 그대로 따른다). 이 패키지가 클라이언트를
 * 참조할 수는 없어(의존 방향이 반대다) 여기 따로 적는다 — 열 언어 목록 자체가
 * 바뀌는 일은 드물다(2026-08-15 최초 지정 이후 안 바뀜).
 */
export type StoryLang = 'ko' | 'en' | 'es_419' | 'it' | 'ja' | 'mn' | 'pt_BR' | 'pt_PT' | 'zh_Hans' | 'zh_Hant';

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
  /**
   * 기술 유래 — 「기술 유래: 두 세줄 정도」 (pptx 38쪽). `assets/Languages/
   * sam_skills.csv`의 `origin_{lang}`이 소스다(`OfficerData.story`와 같은
   * 자리·같은 규약 — 열 개 언어를 전부 연결하되 언어별로 빠질 수 있어
   * `Partial<Record<StoryLang, string>>`). **S급 30종 + E급 1종(고사가 있는
   * 것)만 채워져 있다** — A/B급 9종은 정형 효과라 고사가 없으므로 이 필드
   * 자체가 없다. 화면은 `story`와 마찬가지로 없으면 그 줄이 사라진다.
   */
  origin?: Partial<Record<StoryLang, string>>;
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
  /**
   * 저장할 수 있는 부대(편성) 개수 — Lv1 10개, 레벨마다 +5 (GDD §5).
   *
   * **이 열만 엑셀에 없다** — 추출기(`extract_city`)가 계산해 넣는다. 규칙이
   * 확정치뿐이라 `growth.json`의 `base`·`statChoices`와 같은 처리이고,
   * 읽는 자리는 `meta/src/city.ts`의 `squadCap()` 하나다.
   */
  squadCap: number;
}

/**
 * 시각 효과 매핑 — `assets/SpecialStatus/` 30장을 언제 띄울지.
 *
 * **엔진의 「오라」와 다른 것이다.** `aurasOn()`은 여포·허저의 반경 **판정**이고,
 * 이쪽은 화면에 겹쳐 그리는 **그림**이다 (2026-08-13 기획자와 이름을 갈랐다).
 * 표의 단일 출처는 `tools/extract_data.py`의 `STATUS_FX_*` 이고,
 * 해석은 `client/src/battle/visualEffect.ts` 가 한다.
 */
export interface VisualEffectData {
  persistent: {
    /** 상태이상 → 링. 여기 없는 상태는 링이 없다 (`noVfx` 참조) */
    byStatus: Record<string, string>;
    /** 오라에 **영향받는 쪽** → 링. 이 유닛에는 상태가 없다 (GDD §12 A1) */
    byAura: Record<string, string>;
    byControl: Record<string, string>;
    byTerrain: Record<string, string>;
    /** `wtModifiers`가 남아 있는 동안 (병귀신속·신속) */
    wtModifier: string;
    /** 전용 그림이 없는 상태. 같은 스킬의 다른 상태가 대신 띄운다 */
    noVfx: string[];
    /** 한 장수가 상태 둘을 한꺼번에 얻어 전용 그림이 있는 경우 (조운) */
    combo: { officer: string; requires: string[]; vfx: string }[];
    /** 같이 뜨면 안 되고 차례로 떠야 하는 경우 (여포) */
    exclusive: { officer: string; prefer: string; over: string }[];
    /**
     * 즉시 차례를 당기고 흔적을 남기지 않는 것들 (「선공」).
     * 추출기가 Effect DSL을 훑어 뽑는다 — `modifyWt` · `delta < 0` · `turns` 없음.
     */
    hastenWt: { skills: string[]; tactics: string[] };
  };
  oneShot: {
    bySkill: Record<string, string>;
    byTactic: Record<string, string>;
  };
}

export const VISUAL_EFFECTS = visualEffectsJson as VisualEffectData;

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
