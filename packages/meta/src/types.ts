/**
 * 메타(계정·수집·성장) 타입 계약 — GDD §4.2 · §5 · §6 · §7
 *
 * **`packages/rules`와 같은 자리에 선다.** 룰 엔진이 전투의 권위이듯, 여기는 계정의 권위다.
 * 나중에 서버가 이 규칙을 그대로 돌리고 클라이언트는 같은 코드로 화면을 그린다 —
 * "보유하지 않은 장수를 편성했다" 같은 것을 화면이 스스로 판단하지 않게 하려는 것이다.
 *
 * 순수하게 유지한다: I/O 없음, `Date.now()` 없음, `Math.random()` 없음.
 * 저장은 `packages/client/src/meta/storage.ts`가 맡고, 난수는 시드를 받아 쓴다.
 */

import type { BattleMode, Grade, OfficerId, PieceType, TacticId } from '@samchess/rules';

/** 레벨업마다 고르는 능력 향상 (GDD §4.2) */
export type StatPick = 'hp' | 'mp' | 'at';

/**
 * 레벨업 한 번에 고른 것 (저장 형식 v2, 2026-08-17).
 *
 * `tactics`가 배열인 이유는 **Lv6·Lv7의 지원이 둘씩 들어오기 때문**이다 —
 * 「화계+진화」·「수계+매립」. 생성과 제거가 한 쌍이라 따로 배우게 하면
 * 제거 수단만 가진 빌드가 생긴다(GDD §3.7).
 */
export interface GrowthStep {
  stat: StatPick;
  tactics: TacticId[];
}

/**
 * 보유 장수 한 명.
 *
 * ────────────────────────────────────────────────────────────────
 * `growth.length === level - 1`은 **언제나** 참이다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * v1은 `statPicks`(길이 = level−1)와 `tactics`(평면. Lv6·7 탓에 더 길다)를 나란히
 * 들고 있어서 **레벨과 선택이 1:1이 아니었다.** 그래서 「Lv7 캐릭터를 Lv5로 내려라」를
 * 정확히 자를 수 없었다 — 책략 배열의 어디까지가 Lv5분인지 되짚을 방법이 없다.
 *
 * 레벨별로 묶으면 **하향은 `growth.slice(0, cap - 1)` 한 줄**이 된다.
 * 그 불변식을 깨는 상태를 저장하지 않는 것이 이 형식의 전부다 —
 * 재설계(둔갑천서)가 「스택을 비운 채로」 저장되지 않는 이유도 그것이다
 * (비운 상태는 화면 안에서만 살고, `applyRespec`이 한 번에 갈아 끼운다).
 *
 * 읽을 때는 **반드시 `statPicksOf()` · `tacticsOf()`를 지난다.** 두 함수가 단일
 * 출처이고, 화면도 편성도 엔진 변환도 전투력도 거기만 부른다.
 */
export interface OfficerInstance {
  officer: OfficerId;
  level: number;
  /** 성장 스택. `growth[0]`이 Lv1→Lv2다. **길이 = level - 1** */
  growth: GrowthStep[];
  record: { wins: number; losses: number; kills: number };
}

/** 계정 하나. 온라인이 붙으면 서버 DB의 한 행이 된다. */
export interface PlayerProfile {
  /** 저장 형식 버전. 구조가 바뀌면 올리고 마이그레이션한다 */
  version: number;
  cityName: string;
  cityLevel: number;
  grain: number;
  gold: number;
  materials: number;
  /** 보유 장수 풀 — 도시 레벨이 상한을 정한다 (GDD §5) */
  roster: Record<OfficerId, OfficerInstance>;
  /** 레벨업용 여분 카드. 처음 얻은 장수는 카드가 아니라 풀로 들어간다 */
  cards: Record<OfficerId, number>;
}

/** 편성 한 자리 — 기물 하나에 장수 하나 (GDD §3.9 「기물 편성」) */
export interface RosterPick {
  piece: PieceType;
  officer: OfficerId;
}

export type MetaResult = { ok: true } | { ok: false; reason: string };

/** 전투가 끝난 뒤 계정에 반영할 것 */
export interface BattleOutcome {
  won: boolean;
  mode: BattleMode;
  /** AI 대전은 카드를 주지 않는다 (GDD §6.4, 2026-08-04 확정) */
  opponent: 'ai' | 'online';
  picks: readonly RosterPick[];
  /** 장수별 적 처치 수 (GDD §7 랭킹 지표) */
  kills?: Readonly<Record<string, number>>;
}

export interface BattleRewards {
  grain: number;
  /** 받은 카드. AI 대전이면 항상 `null` */
  card: OfficerId | null;
  cardGrade: Grade | null;
}
