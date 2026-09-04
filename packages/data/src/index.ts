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
import buildingsJson from '../generated/buildings.json' with { type: 'json' };
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
  /**
   * 기술명 표기 — 지금 UI 언어의 이름(`OfficerData.nameI18n`과 같은 자리·같은
   * 규약). `assets/Languages/sam_skills.csv`의 `name_{lang}`이 소스다. **40종
   * 전부**(S/A/B/E 등급 무관) 채워져 있다 — 스킬명은 `origin`과 달리 화면에
   * 안 뜨는 자리가 없어야 하므로, 없는 언어는 화면이 한국어(`name`)로 물러난다.
   */
  nameI18n?: Partial<Record<StoryLang, string>>;
  /**
   * 기술 효과 서술 — 「기술 효과: 한, 두줄 정도의 설명」(pptx 38쪽). `origin`과
   * 같은 자리·같은 규약이다(`assets/Languages/sam_skills.csv`의 `text_{lang}`).
   * **40종 전부** 채워져 있다. 없으면(다음에 스킬이 늘면 다시 빌 수 있다) 화면은
   * 한국어(`text`)로 물러난다.
   */
  textI18n?: Partial<Record<StoryLang, string>>;
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
  /**
   * 책략명 표기 — `OfficerData.nameI18n`·`UniqueSkillData.nameI18n`과 같은 자리·
   * 같은 규약(없으면 화면이 한국어 `name`으로 물러난다). 소스는
   * `assets/Languages/sam_tactics.csv`(고유기술의 `sam_skills.csv`와 같은 꼴,
   * 2026-09-03) — 18종 × 열 언어가 다 차 있다. `ko`는 여기 안 담는다:
   * `name`이 이미 그 값이고 정본은 엑셀이다(추출기가 CSV의 `ko`와 엑셀을
   * 대조해 어긋나면 실패한다).
   */
  nameI18n?: Partial<Record<StoryLang, string>>;
  /** 책략 효과 서술 다국어 — `nameI18n`과 같은 소스·같은 규약 */
  textI18n?: Partial<Record<StoryLang, string>>;
}

/**
 * 도시 레벨 한 줄 — **정하는 것은 둘뿐이다** (2026-09-04 개편, GDD §5.1).
 *
 * 예전에는 이 표가 생산량·상한·캐릭터 풀·부대 상한까지 전부 정했다. 지금은
 * 그것들이 **건물**(`BUILDINGS`)로 옮겨 갔고 도시 레벨은 **증축 자재 값**과
 * **건물 해금 게이트** 둘만 남았다. 같은 값을 정하는 출처가 둘이면 어느 쪽이
 * 정본인지 코드에 안 적히기 때문이다.
 */
export interface CityLevelData {
  level: number;
  /** 이 레벨로 올라오는 데 드는 건축 자재. Lv1은 시작 레벨이라 `null` */
  materialsToUpgrade: number | null;
  /** **황궁(헌제 보유)이 있어야 갈 수 있는 레벨인가.** 화면이 `10`을 적지 않게 데이터가 낸다 */
  requiresEmperor: boolean;
}

/** 건물이 정하는 값의 종류. 시장·대장간은 아직 없다(품목 표 미정) */
export type BuildingEffectKey =
  | 'characterPool' | 'grainCap' | 'grainPerHour' | 'hospitalRooms' | 'trainingBonus';

export type BuildingId =
  | 'palace' | 'barracks' | 'market' | 'academy' | 'farm' | 'hospital' | 'forge';

export interface BuildingEffect {
  key: BuildingEffectKey;
  /** 화면 글자 — 「캐릭터 풀」. 규칙은 `key`만 본다 */
  label: string;
  unit: string;
  /**
   * **안 지었을 때의 값.** 기본 건물은 언제나 있으므로 `null`이다.
   * 농지가 `1`인 것이 요점 — 군량이 아예 안 차면 농지를 짓기 전까지 대전을
   * 못 한다. 잠기는 것이 아니라 **느린 것**이라야 한다 (GDD §5.4).
   */
  absent: number | null;
  /** Lv1..Lv5. 길이는 `maxLevel`과 같다 */
  values: number[];
}

/**
 * 건물 하나 (GDD §5.2 · pptx 56쪽).
 *
 * **기본 건물(`basic`)은 도시 Lv1부터 Lv1 상태로 있다** — 지을 필요가 없고 증축만
 * 한다. 추가 건물(`extra`)은 **지어야 생기고 지으면 Lv1**이다.
 *
 * ★ **레벨별 해금 표는 없다** (2026-09-04에 바로잡음). pptx 57쪽의 격자는 「기회를
 * 3회씩 쓰면 어디까지 가나」를 순서대로 놓아 본 **시뮬레이션**이었지 조건표가
 * 아니었다. 진짜 규칙은 상수 하나다 — 도시가 `buildCityLevel` 이상이면 무엇이든
 * 짓거나 올릴 수 있고, 남은 제한은 **건설 기회**뿐이다.
 */
export interface BuildingData {
  id: BuildingId;
  name: string;
  kind: 'basic' | 'extra';
  maxLevel: number;
  /**
   * 이 건물이 하는 일 — 「캐릭터 풀」·「구매 장비」. **`effect`가 `null`이어도 있다.**
   * 값이 없는 건물(시장·대장간)의 줄이 화면에서 통째로 비면 「고장인가」로 읽힌다.
   */
  purpose: string;
  /**
   * **안 지었을 때 보여 줄 한 줄** — 「장수 훈련 가능」.
   *
   * 「훈련 보정 0 → 2」는 그 건물이 뭘 하는지 모르는 사람에게 아무 말도 안 한다.
   * 짓기 전에 필요한 것은 증분이 아니라 **무슨 건물인가**다. 없으면(`null`) 화면이
   * 평소대로 값을 적는다 — 기본 건물은 늘 지어져 있어 이 줄을 쓸 일이 없다.
   */
  blurb: string | null;
  /** 시장·대장간은 `null` — 「Up 할수록 다양화」만 있고 품목 표가 아직 없다 */
  effect: BuildingEffect | null;
}

/** 도시 상수 — 엑셀 「도시 건물」 [4] 블록. **코드가 숫자를 다시 적지 않는다** */
export interface CityConstants {
  /** 황궁이 여는 도시 레벨(=최대 레벨). 헌제가 없으면 그 아래가 상한이다 */
  emperorCityLevel: number;
  /**
   * 건물을 짓거나 올릴 수 있게 되는 도시 레벨. **그 아래에서는 기본 건물 셋만
   * Lv1로 있다** — 추가 건물은 아직 못 짓고 기본 건물도 못 올린다.
   */
  buildCityLevel: number;
  /**
   * 도시를 한 단계 올릴 때 받는 **건설 기회**. 쌓이고, 소모하는 것은 자재가 아니라 이것이다.
   *
   * 해금 표가 레벨마다 정확히 이만큼 열도록 짜여 있다 — 그래서 이 값은 제한이라기보다
   * **속도**다. 다만 **황궁 레벨에서는 제한이 풀린다** (`emperorCityLevel`) — 거기 닿으면
   * 남은 것을 전부 지을 수 있다.
   */
  buildActionsPerUpgrade: number;
  /** 저장할 수 있는 부대 개수. **도시 레벨과 무관하게 고정** (2026-09-04) */
  squadCap: number;
  /** 부상이 무·지·통에서 각각 깎는 값 (하한 1) */
  injuryPenalty: number;
  /** 부상이 저절로 낫는 데 걸리는 시간(분) */
  injuryRecoverMin: number;
  /** 병원 치료에 걸리는 시간(분). **0이 아니다** — 즉시 완치면 치료가 화면에서 사라진다 */
  healMin: number;
  /** 치료가 끝난 뒤 room이 다시 비기까지(분). 재사용 주기는 `healMin + roomCooldownMin` */
  roomCooldownMin: number;
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
export const BUILDINGS = (buildingsJson.buildings as unknown) as BuildingData[];
export const CITY_RULES = buildingsJson.constants as CityConstants;
export const TEAM_SCORES = teamScoresJson;
export const ECONOMY = economyJson;
export const BUILD_REPORT = reportJson;

// ── 조회 인덱스 ────────────────────────────────────────────────

export const officerById = new Map(OFFICERS.map((o) => [o.id, o]));
export const officerByName = new Map(OFFICERS.map((o) => [o.name, o]));
export const skillById = new Map(UNIQUE_SKILLS.map((s) => [s.id, s]));
export const pieceByType = new Map(PIECES.map((p) => [p.type, p]));
export const buildingById = new Map(BUILDINGS.map((b) => [b.id, b]));
export const tacticById = new Map(TACTICS.map((t) => [t.id, t]));

/** 해당 레벨에서 선택 가능한 책략 (지원 1개 + 환술 1개, Lv6·7은 생성/제거 쌍) */
export function tacticsForLevel(level: number): TacticData[] {
  return TACTICS.filter((t) => t.level === level);
}

export function officersByGrade(grade: Grade): OfficerData[] {
  return OFFICERS.filter((o) => o.grade === grade);
}
