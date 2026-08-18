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

// ── 전적 (저장 형식 v3, 2026-08-18 · pptx 40쪽) ─────────────────

/** 상대가 사람인가 AI인가. **보상도 전적도 같다** (2026-08-18 기획자 확정) */
export type OpponentKind = 'ai' | 'online';

/** 전투의 세 결말. 엔진은 예전부터 무승부를 냈고 메타가 `boolean`으로 뭉개고 있었다 */
export type BattleResult = 'win' | 'draw' | 'lose';

/**
 * 전적 한 칸. **`plays === wins + draws + losses`는 언제나 참이다.**
 *
 * 40쪽 표는 「출전 수 · 승리 · 적격파」 세 열뿐이지만 무승부가 생겼으므로
 * 넷을 다 센다 — 출전에서 승리를 빼면 무엇이 남는지 알 수 없게 된다.
 */
export interface RecordTally {
  plays: number;
  wins: number;
  draws: number;
  losses: number;
  /** 적격파 = 적 격파 수 (§5-11) */
  kills: number;
}

/**
 * 대전 이력 한 줄. **한 줄이 DB 한 행이다** (2026-08-18 기획자 지정).
 *
 * 브라우저 저장은 프로토타입이고 서버 DB로 옮길 것이 정해져 있어, 줄을 **평평하게**
 * 두고 참조를 만들지 않는다 — `seq`가 곧 PK이고, `picks`는 자식 테이블
 * (`match_officers`) 한 벌에 그대로 대응한다. 읽는 자리를 `recentMatches()` 하나로
 * 모아 둔 것도 같은 이유다. 그때 이 함수만 쿼리로 갈면 화면은 안 바뀐다.
 */
export interface MatchRow {
  /** 줄 번호. **오래된 줄을 덜어 내도 다시 쓰지 않는다** (DB 시퀀스와 같은 뜻) */
  seq: number;
  /** 기록 시각(epoch ms). **화면이 넣는다** — meta는 시계를 읽지 않는다 */
  at: number;
  mode: BattleMode;
  opponent: OpponentKind;
  /** 온라인 상대의 계정 id. **AI면 `null`** — 화면이 그때 「AI」라고 적는다 */
  opponentId: string | null;
  /** 부대 이름. **E(42·43쪽)가 채운다** — 그전에는 `null`이고 화면은 `—`로 찍는다 */
  mySquad: string | null;
  theirSquad: string | null;
  myPower: number;
  theirPower: number;
  /** 내 기준 예상 승률(0~1). `winChance(myPower, theirPower)`와 **언제나 같다** */
  chance: number;
  result: BattleResult;
  /** 내가 낸 편성. 장수별로 걸러 보려면 이게 있어야 한다 */
  picks: MatchPick[];
}

export interface MatchPick {
  piece: PieceType;
  officer: OfficerId;
  kills: number;
}

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
  /**
   * 전적 — 키는 **`{상대}/{모드}/{기물}`**(`'online/3v3/King'`), 희소하게 쌓인다.
   *
   * 40쪽이 요구하는 것은 기물별 표 **와** 모드별 요약 **와** 총합이다. 셋을
   * 따로 세면 언젠가 서로 어긋나므로 **교차로 한 번만 세고 나머지는 합으로 낸다** —
   * 「기물별 합 = 총합」이 지켜야 할 계약이 아니라 산수가 된다.
   * 읽는 자리는 `records.ts`의 `sumTally()` 하나다.
   */
  record: Record<string, RecordTally>;
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
  /**
   * 계정 전적 — 키는 **`{상대}/{모드}`**. C2의 「도시 전적」이 이걸 쓴다.
   *
   * **장수 전적을 더해서는 만들 수 없다** — 한 판에 3~5명이 함께 뛰므로 출전 수가
   * 사람 수만큼 부풀려진다. 그래서 계정 칸을 따로 센다.
   */
  record: Record<string, RecordTally>;
  /** 대전 이력. **최근 것이 뒤**이고 `seq` 오름차순이다 */
  matches: MatchRow[];
  /** 다음 줄 번호. 오래된 줄을 덜어 내도 **줄지 않는다** */
  matchSeq: number;
}

/** 편성 한 자리 — 기물 하나에 장수 하나 (GDD §3.9 「기물 편성」) */
export interface RosterPick {
  piece: PieceType;
  officer: OfficerId;
}

export type MetaResult = { ok: true } | { ok: false; reason: string };

/** 무승부가 고르는 셋 (GDD §6.4). **고르기 전까지 계정에 아무것도 반영하지 않는다** */
export type DrawReward = 'card' | 'material' | 'grain';

/**
 * 전투가 끝난 뒤 계정에 반영할 것.
 *
 * **`won: boolean`이 `result`로 갈렸다** (2026-08-18, v3). 엔진은 예전부터 진짜
 * 무승부를 냈고(`winner: null`, 실측 0.02%) 메타 층만 그걸 뭉개고 있었다.
 *
 * **AI와 온라인이 갈리지 않는다** (2026-08-18 기획자 확정) — 병영의 문이 하나로
 * 합쳐지면서(F·45쪽) 플레이어는 상대가 사람인지 AI인지 **고르지 못한다.** 보상이
 * 갈리면 「접속 시간대 운」이 곧 보상이 된다. `opponent`는 이력의 라벨과 전적
 * 필터로만 쓰인다.
 */
export interface BattleOutcome {
  result: BattleResult;
  mode: BattleMode;
  opponent: OpponentKind;
  picks: readonly RosterPick[];
  /** 장수별 적 처치 수 (GDD §7 랭킹 지표) */
  kills?: Readonly<Record<string, number>>;
  /** 양쪽 부대 전투력 (D·GDD §7.1). 예상 승률은 여기서 `winChance()`로 나온다 */
  power: { mine: number; theirs: number };
  /** 기록 시각(epoch ms). **부르는 쪽이 넣는다** — meta에 시계를 들이지 않는다 */
  at: number;
  /** `result === 'draw'`면 **반드시** 있어야 한다. 없으면 반영을 거부한다 */
  drawPick?: DrawReward;
  /** 온라인 상대 계정 id. AI면 생략한다 */
  opponentId?: string | null;
  /** 부대 이름 — E가 붙기 전에는 없다 */
  mySquad?: string | null;
  theirSquad?: string | null;
}

export interface BattleRewards {
  grain: number;
  /** 재료 — 온라인·AI 모두 승리 1 (GDD §6.4, 2026-08-18) */
  materials: number;
  card: OfficerId | null;
  cardGrade: Grade | null;
}
