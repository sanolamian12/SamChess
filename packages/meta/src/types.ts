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

import type { BuildingId } from '@samchess/data';
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
 * `tactics`가 배열인 이유는 **Lv6·Lv7의 지원이 둘씩 들어왔기 때문**이다 —
 * 「화계+진화」·「수계+매립」. 2026-09-03에 수계·매립을 지우고 진화를 Lv7로 옮겨
 * **지금은 언제나 길이 1**이지만, 모양은 그대로 둔다 — 낱개로 바꾸면 저장 형식이
 * 한 번 더 갈리고(마이그레이션 한 벌), 둘씩 주는 레벨이 다시 생기면 되돌려야 한다.
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
  /**
   * **부상당한 시각**(epoch ms). 없으면 건강하다 (GDD §5.7, 2026-09-04).
   *
   * ★ **`injuredUntil`이 아니라 `injuredAt`이다.** 회복 시간(60분)과 치료 시간
   * (1분)이 **엑셀에서 오므로**, 끝나는 시각을 저장하면 그 값을 바꿔도 이미
   * 저장된 계정은 옛 규칙으로 남는다. `grainAt`과 같은 결 — **마지막 사건의
   * 시각**을 저장하고 규칙은 매번 다시 읽는다.
   *
   * 읽을 때는 `isInjured()` · `injuryHealsAt()`을 지난다. 낫는 시각이 지나도
   * 필드는 잠시 남아 있고 `syncCity()`가 늦게 지운다 — 판정이 이미 「나았다」로
   * 보므로 청소가 늦어도 규칙은 옳다.
   */
  injuredAt?: number;
  /** **치료를 시작한 시각.** 있으면 `HEAL_MS` 뒤에 낫는다(자연 회복보다 빠르다) */
  healingAt?: number;
}

/** 계정 하나. 온라인이 붙으면 서버 DB의 한 행이 된다. */
export interface PlayerProfile {
  /** 저장 형식 버전. 구조가 바뀌면 올리고 마이그레이션한다 */
  version: number;
  cityName: string;
  /**
   * 도시 이름을 마지막으로 바꾼 시각(epoch ms). **없으면 한 번도 안 바꿨다** —
   * 만든 직후의 이름은 쿨다운 대상이 아니다. `canRenameCity()`가 여기에 쿨다운
   * (`RENAME_COOLDOWN_MS`)을 더해 다음 변경 가능 시각을 계산한다.
   */
  cityNameChangedAt?: number;
  cityLevel: number;
  grain: number;
  /**
   * 군량을 **마지막으로 정산한 시각**(epoch ms). `0`이면 아직 정산한 적 없다.
   *
   * 시간 충전은 `syncGrain(profile, nowMs)`가 하고 **시계는 화면이 넣는다**
   * (`city.ts` 참조). 남은 자투리 시간이 다음 접속으로 이어지도록 「지금」이
   * 아니라 **번 만큼만 앞으로 민 시각**이 들어간다 — `nowMs`로 찍으면 30분씩
   * 접속하는 사람은 영원히 한 톨도 못 받는다.
   */
  grainAt: number;
  gold: number;
  materials: number;
  /**
   * 건물 레벨 (GDD §5.2, 2026-09-04 · 저장 형식 v4).
   *
   * **완전 레코드이고 `0`이 「아직 안 지었다」**다. 일곱 개가 고정이라 희소일
   * 이유가 없고, 부분 레코드로 두면 읽는 자리마다 `?? 0`이 흩어진다 —
   * 읽는 자리는 `buildingLevel(profile, id)` **하나**다.
   *
   * 기본 건물(궁궐·병영·시장)은 언제나 1 이상, 추가 건물은 0에서 시작한다.
   */
  buildings: Record<BuildingId, number>;
  /**
   * 남은 **건설 기회** (GDD §5.2, 2026-09-04). 도시를 한 단계 올릴 때마다 쌓인다.
   *
   * **건물에는 건축 자재가 들지 않는다** — 값을 받는 것은 도시 증축뿐이고, 건물이
   * 쓰는 것은 이 기회다. 제한이라기보다 **속도**에 가깝다.
   *
   * **새 계정은 0이다** (v5, 2026-09-04) — Lv1에서는 아무것도 지을 수 없어서
   * 「쓸 수 없는 기회 3회」가 화면에 떠 있기만 했다. 첫 3회는 Lv2 증축에서 온다.
   *
   * **황궁 레벨에서는 이 값을 안 본다** — 남은 것을 전부 지을 수 있다. 그래서
   * 낮은 레벨에서 무엇을 미뤄 뒀든 황궁(Lv11)이 전부 회수한다. 읽는 자리는
   * `buildCreditsLeft()` 하나이고 `null`이 「제한 없음」이다.
   */
  buildCredits: number;
  /**
   * 병원에서 **바쁜 room이 비는 시각**들 (epoch ms). 지난 값은 `syncCity()`가 지운다.
   *
   * ★ **room에 번호를 붙이지 않는다.** 필요한 사실은 「몇 개가 바쁜가」뿐이라
   * 살아 있는 길이가 곧 바쁜 수다 — room을 식별하면 쓰지 않는 정체성이 저장
   * 형식에 영원히 남는다.
   */
  hospitalBusy: number[];
  /** 보유 장수 풀 — **궁궐**이 상한을 정한다 (GDD §5.4) */
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
  /**
   * 저장된 부대 (E · 42·43쪽). **개수 상한은 10 고정이다** — `squadCap()`
   * (2026-09-04에 「도시 레벨이 정한다」에서 뒤집혔다).
   *
   * 필드가 더해질 뿐 기존 필드의 뜻이 안 바뀌어 **저장 형식 버전을 올리지 않았다**
   * (C2의 `grainAt`과 같은 자리). 되접기는 없으면 빈 배열이다.
   */
  squads: Squad[];
  /** 다음 부대 id. **줄지 않는다** — 지운 부대의 번호를 다시 쓰면 옛 참조가 되살아난다 */
  squadSeq: number;
  /**
   * 상점 가챠 — "계정별 유한 랜덤 어레이"의 상태 (트랙 9, `gacha.ts` 참조).
   *
   * 배열 자체는 저장하지 않는다 — `seed`로 매번 같은 순서를 다시 셔플해 내고
   * `drawn`개를 건너뛴 나머지가 "남은 배열"이다(전투 리플레이가 로그 대신 시드를
   * 들고 다니는 것과 같은 이유). **첫 가챠 시점에 한 번만 `seed`를 만든다** — 없으면
   * 아직 가챠를 시작하지 않은 계정이다.
   */
  gachaPool?: { seed: number; drawn: number };
}

/**
 * 편성 한 자리 — 기물 하나에 장수 하나 (GDD §3.9 「기물 편성」)
 *
 * **`level`은 「상한」이지 「스냅샷」이 아니다** (E · 42쪽, 2026-08-18 기획자 확정).
 * 부대는 자기 장수를 **일부러 낮춰** 전투력을 내리고 약한 상대와 매칭될 수 있다.
 * 그 레벨의 능력치·책략은 새로 정하는 것이 아니라 **성장 스택에서 그대로 꺼낸다** —
 * `growthUpTo(inst, cap)`가 `slice` 한 줄로 자르는 것이 이것이다(GDD §4.2).
 *
 * 그래서 여기 적힌 값이 보유 레벨보다 크면 **보유 레벨로 눌러 담는다**(약해지는
 * 방향이라 안전하다). 누르는 자리도 `toRosterEntries()` 하나다.
 */
export interface RosterPick {
  piece: PieceType;
  officer: OfficerId;
  /** 하향 레벨(1 ~ 보유 레벨). **없으면 보유 레벨 그대로** */
  level?: number;
}

// ── 부대 편성 (E · pptx 42·43쪽, 2026-08-18) ────────────────────

/**
 * 배치 프리셋의 한 칸. **평평하고 참조가 없다** — C1의 `MatchRow`와 같은 규약이다.
 *
 * **기물을 키로 든다.** 엔진의 `UnitId`가 이미 `${side}-${piece}`라 그대로 옮겨지고,
 * 무엇보다 **위치 배열로 두면 구성을 고쳤을 때 조용히 어긋난다** — 세 번째 자리의
 * 좌표가 어느 기물의 것인지 되짚을 방법이 없다.
 */
export interface SquadCell {
  piece: PieceType;
  x: number;
  y: number;
}

/**
 * 저장된 부대 하나 (pptx 42·43쪽).
 *
 * ```
 * 참여인원   편성 명      전투력   구성
 *  3 vs 3    초전박살      843     조조, 관흥, 능통
 * ```
 *
 * **`deploy`는 남군(P1)·북군(P2) 각각 따로다** (§5-14). 배치 구역이 진영마다
 * 다른 5행이라 한쪽 좌표를 다른 쪽에 쓸 수 없다. 불러올 때 검증하고 **어긋나면
 * 조용히 기본 배치로 물러난다** — 엔진이 어차피 5×5 중앙에 세운다.
 */
export interface Squad {
  /** 계정 안에서만 유일하다. `PlayerProfile.squadSeq`에서 나온다 */
  id: string;
  /** 최대 12자 · 계정 안에서 중복 불허 — 같은 이름이면 목록에서 구별이 안 된다 */
  name: string;
  mode: BattleMode;
  /** 구성. `level`이 채워진 채로 저장된다 */
  picks: RosterPick[];
  deploy: { P1: SquadCell[] | null; P2: SquadCell[] | null };
  /**
   * 부대 전적 — 키는 계정 전적과 같은 **`{상대}/{모드}`**(`accountKey()`).
   * `mode`는 이미 부대에 고정된 값이라 키 안의 모드는 중복 정보지만, 계정·장수
   * 전적과 같은 키 규약을 하나로 유지하려고 그대로 둔다(부대 랭킹, 2026-08-26).
   *
   * **이력(`matches[]`)에서 파생시키지 않는다** — 이력은 `MATCH_LOG_CAP`(200줄)에서
   * 꼬리를 덜어 내므로, 오래 쓴 부대일수록 거기서 다시 세면 통산이 조용히 준다.
   * 계정 전적과 같은 이유로 여기 따로 쌓는다.
   */
  record: Record<string, RecordTally>;
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
  /**
   * **HP 0으로 퇴각한 내 장수들** — 부상이 여기서 매겨진다 (GDD §5.7, 2026-09-04).
   *
   * 승패와 무관하다. 「퇴각했다」가 곧 부상이라 별도 판정이 없고, 시각은
   * `at`을 그대로 쓴다 — meta에 시계를 들이지 않는다.
   */
  fallen?: readonly OfficerId[];
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
