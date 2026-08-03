/**
 * 삼국 약식 체스 — 룰 엔진 데이터 스키마 v0.1
 *
 * 이 파일은 `packages/rules`의 공개 계약(contract)이다.
 * 서버(권위 판정)와 클라이언트(예측 렌더)가 동일한 타입을 공유한다.
 *
 * 원칙
 *  1. 순수 데이터 + 순수 함수. I/O · Date.now() · Math.random() 사용 금지.
 *  2. 모든 난수는 BattleState.rng를 통과한다 (시드 기반, 재현 가능).
 *  3. 정형 효과는 Effect DSL로, 서사형 S급 스킬은 scriptId 핸들러로 분리한다.
 *
 * 대응 기획서: ../../../../Design/GDD.md
 */

// ═══════════════════════════════════════════════════════════════
// 0. 기본 타입
// ═══════════════════════════════════════════════════════════════

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E';

/** 고유기술을 가지는 등급 */
export type SkillGrade = Extract<Grade, 'S' | 'A' | 'B' | 'E'>;

export type PieceType = 'King' | 'Rock' | 'Bishop' | 'Knight' | 'Queen' | 'Pawn';

export type Side = 'P1' | 'P2';

/** dy+ 가 전진 방향 */
export interface Vec2 {
  x: number;
  y: number;
}

/** 안정적 slug. 표시명(한글)이 바뀌어도 참조가 깨지지 않도록 분리한다. */
export type OfficerId = string & { readonly __brand: 'OfficerId' };
export type SkillId = string & { readonly __brand: 'SkillId' };
export type TacticId = string & { readonly __brand: 'TacticId' };
export type UnitId = string & { readonly __brand: 'UnitId' };

/** 절대시간. time 100 = 게임 내 1일 = 실시간 1초. */
export type Time = number;

// ═══════════════════════════════════════════════════════════════
// 1. 정적 데이터 — 엑셀에서 빌드 타임에 생성
// ═══════════════════════════════════════════════════════════════

/** officers.json — 260건 */
export interface OfficerDef {
  id: OfficerId;
  /** 표준 표시명. Chars/ 폴더 파일명 기준 (GDD §9) */
  name: string;
  grade: Grade;
  /** 무력 0~100 — 크리티컬 확률 */
  might: number;
  /** 지력 0~100 — 환술 성공률/저항 */
  intellect: number;
  /** 통솔력 0~100 — 행동 순서 및 WT 기준값 */
  leadership: number;
  /** 소속 세력. 예: '유비군' */
  faction: string;
  /** 초상화 경로. 예: 'chars/관우.png' (440×540 RGBA) */
  portrait: string;
  /** C·D급은 null */
  uniqueSkill: SkillId | null;
}

/** pieces.json — 6건. GDD §3.2 */
export interface PieceDef {
  type: PieceType;
  /** 이동 가능 상대 오프셋 */
  moveMask: readonly Vec2[];
  /** 경로형(막힘) vs 도약형(관통). Knight만 false */
  moveBlocked: boolean;
  /** 이동 후 위치 기준 공격 가능 상대 오프셋 */
  attackMask: readonly Vec2[];
  /** 한 번에 공격 가능한 대상 수. Pawn만 2, 나머지 1 */
  maxTargets: number;
}

/** uniqueSkills.json — 40건 (S 30 / A 4 / B 5 / E 1). GDD §4.4 */
export interface UniqueSkillDef {
  id: SkillId;
  name: string;
  hanja: string;
  tier: SkillGrade;
  /** B4 / A5 / S6 / E7 */
  spCost: number;
  /** 원문 시전 효과 (UI 표시용) */
  text: string;
  /** 정형 효과. 서사형 스킬은 비어 있을 수 있다. */
  effects: readonly Effect[];
  /** 코드 핸들러 참조. 데이터로 접히지 않는 S급 전용. */
  scriptId?: string;
}

/** tactics.json — 18건 (지원 8 + 진화/매립 2 + 환술 8). GDD §3.7 */
export interface TacticDef {
  id: TacticId;
  name: string;
  school: 'support' | 'illusion';
  /** 습득 가능 레벨 2~9 */
  level: number;
  mpCost: number;
  text: string;
  /** illusion 계열은 성공률 판정을 거친다 */
  requiresResistCheck: boolean;
  effects: readonly Effect[];
}

// ═══════════════════════════════════════════════════════════════
// 2. 효과 DSL
// ═══════════════════════════════════════════════════════════════

export type TargetSpec =
  | { kind: 'self' }
  | { kind: 'allyOne'; withinRadius?: number }
  | { kind: 'enemyOne'; anywhere?: boolean }
  | { kind: 'allAllies' }
  | { kind: 'allEnemies' }
  | { kind: 'alliesInRadius'; radius: number; includeSelf: boolean }
  | { kind: 'tile'; filter?: 'empty' }
  /** 순욱 「구류지책」 — 차례가 가장 가까운 적 N명 */
  | { kind: 'nextEnemiesInTurnOrder'; count: number };

export type StatusId =
  // 버프
  | 'critical100'          // Critical 확률 100% 고정
  | 'incomingDamageHalf'   // 받는 데미지 절반
  | 'untargetable'         // 공격 대상이 되지 않음
  | 'illusionImmune'       // 결계 — 모든 환술 무효 + DoT 해제
  | 'illusionAlways'       // 가후 — 내가 거는 환술 100% 발동
  | 'freeMove'             // 감녕/여포 — 맵 어디든 이동
  | 'counterattack'        // 장합 — 피격 시 반격
  | 'zeroMpCost'           // 명경지수 — 책략/환술 MP 0
  | 'damageRedirect'       // 고육지책 — 아군 피해를 대신 받음
  | 'attackAnywhere'       // 백보천양 — 사거리를 무시하고 아무 적이나 공격
  | 'attackStacking'       // 구벌중원 — 공격할 때마다 AT 누적 (magnitude = 누적치)
  | 'instantKillNext'      // 온주참화웅 — 다음 공격 대상은 반드시 사망 (King 제외)
  /** 허저 「단치도강」 — 반경(magnitude) 안의 **아군**이 받는 데미지 절반 */
  | 'auraIncomingHalf'
  /** 여포 「인중여포」 — 반경(magnitude) 안의 **적**이 주는 데미지 절반 */
  | 'auraOutgoingHalf'
  | 'convertOnHit'         // 삼고초려 — 내가 때린 적에게 표식을 남긴다
  | 'convertProgress'      // 삼고초려 피격 횟수 (magnitude). charges에 도달하면 영구 조종
  | 'revivePending'        // 화용도 — 사망 시 1회 부활
  | 'deathCurse'           // 유언계책 — 사망 후 일정 시간 뒤 적 1명 사망
  // 디버프
  | 'outgoingDamageHalf'   // 공포
  | 'silence'              // 침묵 — 버프/환술 사용 불가
  | 'dot'                  // 탈진/질병/화계 — 주기적 HP 감소
  | 'mustTarget';          // 소패왕전 — 지정 상대만 공격 가능

/**
 * 상태이상의 성격과 표시 이름.
 *
 * 위 union의 `// 버프` / `// 디버프` 구분을 **기계가 읽을 수 있는 형태로** 옮긴 것이다.
 * 화면이 "이게 버프인가 디버프인가"를 자기 나름대로 판단하지 않게 하려고 여기에 둔다.
 * `Record<StatusId, …>`라서 상태를 새로 추가하면 이 표가 비어 **컴파일이 깨진다** —
 * 화면에 빈칸으로 조용히 새는 일이 없다.
 *
 * 효과의 사양 자체는 여전히 `tools/extract_data.py`의 Effect DSL이 단일 출처다.
 * 여기 있는 것은 그 결과를 어떻게 부를지뿐이다.
 */
export const STATUS_META: Readonly<Record<StatusId, { kind: 'buff' | 'debuff'; label: string }>> = {
  critical100: { kind: 'buff', label: '크리티컬 100%' },
  incomingDamageHalf: { kind: 'buff', label: '받는 피해 절반' },
  untargetable: { kind: 'buff', label: '지정 불가' },
  illusionImmune: { kind: 'buff', label: '결계' },
  illusionAlways: { kind: 'buff', label: '환술 100%' },
  freeMove: { kind: 'buff', label: '자유 이동' },
  counterattack: { kind: 'buff', label: '반격' },
  zeroMpCost: { kind: 'buff', label: 'MP 소모 0' },
  damageRedirect: { kind: 'buff', label: '피해 대신받기' },
  attackAnywhere: { kind: 'buff', label: '사거리 무시' },
  attackStacking: { kind: 'buff', label: 'AT 누적' },
  instantKillNext: { kind: 'buff', label: '다음 공격 즉사' },
  auraIncomingHalf: { kind: 'buff', label: '오라 — 아군 피해 절반' },
  auraOutgoingHalf: { kind: 'buff', label: '오라 — 적 공격 절반' },
  convertOnHit: { kind: 'buff', label: '삼고초려' },
  convertProgress: { kind: 'debuff', label: '삼고초려 피격' },
  revivePending: { kind: 'buff', label: '부활 대기' },
  deathCurse: { kind: 'buff', label: '유언계책' },
  outgoingDamageHalf: { kind: 'debuff', label: '공포' },
  silence: { kind: 'debuff', label: '침묵' },
  dot: { kind: 'debuff', label: '지속 피해' },
  mustTarget: { kind: 'debuff', label: '지정 강제' },
};

export type Effect =
  /**
   * 상태이상 부여.
   * - `duration` 미지정 = 해제 전까지 영구 (탈진·질병)
   * - `charges` 지정 = N회 소모형 (증폭·반감)
   * - `period` 지정 = DoT 정산 주기
   */
  | { t: 'applyStatus'; target: TargetSpec; status: StatusId; duration?: Time; magnitude?: number; magnitudePct?: number; charges?: number; period?: Time; cleansable?: boolean }
  /** 상태이상 해제. 「결계」가 탈진·질병(dot)을 푸는 데 쓴다. `cleansable: false`인 것은 남는다. */
  | { t: 'removeStatus'; target: TargetSpec; status: StatusId }
  /** 즉시 데미지 (AT 기준 아님, 고정값 또는 최대HP 비율) */
  | { t: 'damage'; target: TargetSpec; flat?: number; pctMaxHp?: number }
  | { t: 'heal'; target: TargetSpec; flat?: number; pctMaxHp?: number }
  /** WT 가감. 음수 = 빨라짐 */
  | { t: 'modifyWt'; target: TargetSpec; delta: number; turns?: number }
  | { t: 'setMp'; target: TargetSpec; value: number }
  /** side: 'enemy' → 적 진영 SP */
  | { t: 'modifySp'; side: 'self' | 'enemy'; delta: number }
  | { t: 'createTerrain'; target: TargetSpec; terrain: TerrainId }
  | { t: 'removeTerrain'; target: TargetSpec; terrain: TerrainId }
  /** 적 유닛 조종 */
  | { t: 'controlEnemy'; target: TargetSpec; mode: 'moveOnly' | 'moveAndAttack'; uses: number }
  /** 장료지제 — 즉시 전 적군 1회 공격 */
  | { t: 'attackAllEnemiesOnce' }
  /** 방덕 — 최대 HP 2배 (현재 HP 유지) */
  | { t: 'multiplyMaxHp'; target: TargetSpec; factor: number }
  /** 제갈량 — 고유기술 사용 횟수 추가 */
  | { t: 'grantUniqueSkillUses'; target: TargetSpec; count: number };

export type TerrainId =
  | 'fire'    // 화계 — time 100마다 HP 1 감소
  | 'water'   // 수계 — 진입 불가
  | 'holy';   // 수성지주 — time 100마다 HP 1 회복

export interface TerrainTile {
  pos: Vec2;
  terrain: TerrainId;
  /** 마지막으로 정산한 절대시간 */
  lastTickedAt: Time;
}

// ═══════════════════════════════════════════════════════════════
// 3. 성장 · 경제 테이블
// ═══════════════════════════════════════════════════════════════

/** growth.json. GDD §4.2 */
export interface GrowthConfig {
  /** Level 1 기본치 */
  base: { hp: 10; mp: 5; at: 2 };
  /** 레벨업 시 택1 */
  statChoices: readonly [{ hp: 5 }, { mp: 2 }, { at: 1 }];
  maxLevel: number;
  /** Level 2~9 */
  levelUp: readonly LevelUpReq[];
}

export interface LevelUpReq {
  level: number;      // 2~9
  cardsRequired: number;
  successRate: number; // 0.0~1.0
}

/** city.json. GDD §5 */
export interface CityLevelDef {
  level: number;          // 1~9
  materialsToUpgrade: number | null; // Lv1은 null
  grainPerHour: number;
  grainCap: number;
  characterPool: number;
}

/** economy.json. GDD §6 */
export interface EconomyConfig {
  goldPacks: readonly { gold: number; krw: number }[];
  grainPerGold: number;      // 20
  materialsPerGold: number;  // 1
  cardPacks: readonly { gold: number; cards: number }[];
  /** 구매 카드에 등장하는 등급 (D 제외) */
  gachaGrades: readonly Grade[];
  /** 등급별 출현 확률 — 확률형 아이템 공시 의무 대상 */
  gachaRates: Readonly<Record<string, number>>;
  recycle: {
    cardsIn: number;   // 10
    /** 등급 환산 점수 S=10 A=8 B=6 C=4 D=2 */
    gradeScore: Readonly<Record<Grade, number>>;
  };
  respecItemGold: number; // 둔갑천서 10
}

// ═══════════════════════════════════════════════════════════════
// 4. 전투 런타임 상태 — 서버 권위
// ═══════════════════════════════════════════════════════════════

export type BattlePhase =
  | 'deploy'      // 배치 (최대 60초)
  | 'waiting'     // 상대 준비 대기 (최대 60초)
  | 'scout'       // 정찰 (15초, 20초 카운트)
  | 'running'     // 절대시간 진행 중
  | 'control'     // 제어권 부여, 절대시간 정지 (최대 20초)
  | 'finished';

export interface BattleState {
  readonly matchId: string;
  readonly seed: number;
  /** 소비한 난수 개수. 리플레이 재현용 */
  rngCursor: number;

  /** 항상 { x: 25, y: 20 } — 대전 규모와 무관하게 고정 (GDD §3.1) */
  readonly boardSize: Vec2;
  readonly mode: '1v1' | '3v3' | '5v5';

  phase: BattlePhase;
  /** 절대시간. phase === 'control' 동안 정지 */
  time: Time;

  units: Record<UnitId, UnitState>;
  terrain: TerrainTile[];

  /** 진영 공유 SP. cap = 참여 아군 수 × 5 */
  sp: Record<Side, number>;
  spCap: Record<Side, number>;

  /** 현재 제어권을 가진 유닛. phase === 'control'일 때만 non-null */
  activeUnit: UnitId | null;
  /** 현재 턴에 무엇을 소진했는지. phase === 'control'일 때만 non-null */
  activeTurn: TurnProgress | null;
  /** 제어 시작 시각 (실시간 ms). 20초 타임아웃 판정용 — 서버가 주입 */
  controlStartedAtMs: number | null;

  /** 배치 완료 여부. 양측 true → 'scout' */
  ready: Record<Side, boolean>;

  /** 지연 발동 대기열 — 곽가 「유언계책」처럼 "사후 time N 뒤" 터지는 것들 */
  pending: PendingEffect[];

  winner: Side | null;
  /** 승부가 난 방식. King 격파는 'kingDown', 상한 판정은 'timeLimit' */
  outcome?: 'kingDown' | 'wipeOut' | 'surrender' | 'timeLimit' | 'draw';
  log: BattleEvent[];
}

/** 예약된 효과. 절대시간이 `at`을 지날 때 정산된다. */
export interface PendingEffect {
  at: Time;
  kind: 'randomEnemyDies';
  /** 발동시킨 쪽. 그 **반대편**이 대상이 된다 */
  side: Side;
  source: UnitId;
}

/**
 * 한 턴은 「이동(또는 제자리)」 + 「공격 / 책략 / 명상 중 하나」로 끝난다 (GDD §3.4).
 * 고유기술은 행동과 별개라 별도로 센다.
 */
export interface TurnProgress {
  moved: boolean;
  acted: boolean;
  usedUniqueSkill: boolean;
}

export interface UnitState {
  readonly id: UnitId;
  readonly side: Side;
  readonly officer: OfficerId;
  readonly piece: PieceType;
  readonly level: number; // 1~9

  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  at: number;

  /** 0이 되면 제어권 획득 */
  wt: number;
  /** 행동 후 재설정되는 기준값 = 190 − 통솔력 (GDD §3.3, 확정) */
  readonly wtBase: number;
  /**
   * N턴 동안 유지되는 WT 보정. 턴을 마치고 WT를 되돌릴 때 delta가 더해지고 turnsLeft가 준다.
   * 서황 「병귀신속」(3턴 −50) · B급 「신속」(1턴 −30)
   */
  wtModifiers?: { delta: number; turnsLeft: number }[];

  pos: Vec2;
  /** 레벨업으로 습득한 책략 */
  readonly tactics: readonly TacticId[];

  statuses: ActiveStatus[];
  /** 남은 고유기술 사용 횟수. 기본 1, 「차동풍」으로 증가 */
  uniqueSkillUses: number;
  alive: boolean;

  /**
   * 조종당하는 중. 이 동안 지시를 내리는 쪽은 `by`의 진영이다.
   *
   * - 「유인」(이동만) · 「초선」(이동+공격) — 턴을 한 번 쓰면 풀린다
   * - 유비 「삼고초려」 — `uses: null`로 **게임이 끝날 때까지 영구**
   *
   * 진영(`side`)은 바뀌지 않는다. 소속은 그대로인 채 지휘권만 넘어간 상태다 —
   * 그래서 승패 판정에서는 여전히 원래 편의 유닛으로 센다.
   */
  control?: { by: UnitId; mode: 'moveOnly' | 'moveAndAttack'; uses: number | null };
}

export interface ActiveStatus {
  status: StatusId;
  /** 만료 절대시간. undefined = 해제 전까지 지속 (탈진·질병은 영구) */
  expiresAt?: Time;
  magnitude?: number;
  /** 최대 HP 비율 피해. magnitude 대신 쓴다 (육손 「화소연영」 10%) */
  magnitudePct?: number;
  /** DoT 정산 주기. 질병 100 / 탈진 200 (GDD §3.7) */
  period?: Time;
  /**
   * 「결계」로 해제되는가. 미지정=true.
   * 책략발(탈진·질병)은 해제되지만, S급발(식소사번·화소연영)은 `false`라 해제되지 않는다.
   */
  cleansable?: boolean;
  /** 「증폭」처럼 1회 소모형인 경우 */
  charges?: number;
  /** 부여자 (고육지책의 대상 지정 등) */
  sourceUnit?: UnitId;
  /** DoT 마지막 정산 시각 */
  lastTickedAt?: Time;
}

// ═══════════════════════════════════════════════════════════════
// 5. 입력(Intent) — 클라이언트가 보내는 것
// ═══════════════════════════════════════════════════════════════

/**
 * 클라이언트는 "의도"만 보낸다. 판정 결과는 절대 보내지 않는다.
 * 서버가 검증 → 적용 → 결과 BattleEvent[]를 브로드캐스트한다.
 */
export type Intent =
  | { t: 'deploy'; placements: { unit: UnitId; pos: Vec2 }[] }
  | { t: 'ready' }
  | { t: 'move'; to: Vec2 }
  | { t: 'attack'; targets: UnitId[] }
  | { t: 'castTactic'; tactic: TacticId; target?: Vec2 | UnitId }
  | { t: 'meditate' }
  | { t: 'castUniqueSkill'; target?: Vec2 | UnitId }
  /** 이동만 하고(또는 아무것도 하지 않고) 턴을 넘긴다 */
  | { t: 'endTurn' }
  /** 상대 제어 20초 초과 시 노출되는 [차례 넘기기]. 20초 경과 판정은 서버가 한다 */
  | { t: 'forceSkipTurn' }
  | { t: 'surrender' };

export type BattleEvent =
  | { e: 'phaseChanged'; phase: BattlePhase }
  | { e: 'timeAdvanced'; to: Time }
  | { e: 'controlGranted'; unit: UnitId }
  | { e: 'turnEnded'; unit: UnitId }
  | { e: 'deployed'; side: Side; placements: { unit: UnitId; pos: Vec2 }[] }
  | { e: 'ready'; side: Side }
  | { e: 'moved'; unit: UnitId; from: Vec2; to: Vec2 }
  | { e: 'attacked'; unit: UnitId; target: UnitId; damage: number; critical: boolean }
  | { e: 'tacticCast'; unit: UnitId; tactic: TacticId; resisted: boolean }
  | { e: 'uniqueSkillCast'; unit: UnitId; skill: SkillId }
  /** 차동풍 — 이미 쓴 고유기술이 다시 활성화됐다 */
  | { e: 'uniqueSkillRestored'; unit: UnitId }
  | { e: 'statusApplied'; unit: UnitId; status: StatusId; expiresAt?: Time }
  | { e: 'statusExpired'; unit: UnitId; status: StatusId }
  /** 조종 시작/해제. `by === null`이면 해제, `permanent`면 「삼고초려」로 영구 */
  | { e: 'controlChanged'; unit: UnitId; by: UnitId | null; mode?: 'moveOnly' | 'moveAndAttack'; permanent?: boolean }
  | { e: 'hpChanged'; unit: UnitId; delta: number; reason: string }
  | { e: 'mpChanged'; unit: UnitId; delta: number; reason: string }
  | { e: 'wtChanged'; unit: UnitId; to: Time; reason: string }
  | { e: 'unitDied'; unit: UnitId }
  | { e: 'unitRevived'; unit: UnitId; at: Vec2 }
  | { e: 'spChanged'; side: Side; to: number }
  | { e: 'terrainChanged'; pos: Vec2; terrain: TerrainId | null }
  | { e: 'battleEnded'; winner: Side | null; outcome: NonNullable<BattleState['outcome']> };

// ═══════════════════════════════════════════════════════════════
// 6. 순수 함수 시그니처 — 룰 엔진 공개 API
// ═══════════════════════════════════════════════════════════════

export interface RulesEngine {
  /** 시드와 편성으로 초기 상태 생성. 초기 순서 = 통솔력 내림차순 */
  createBattle(config: BattleConfig): BattleState;

  /** 유효성 검사만. 부작용 없음. UI 활성화 판정에 쓴다. */
  validate(state: BattleState, side: Side, intent: Intent): ValidationResult;

  /**
   * 의도를 적용해 새 상태와 이벤트를 반환한다.
   * 동일 (state, intent) → 동일 결과여야 한다. rngCursor가 이를 보장한다.
   */
  apply(state: BattleState, side: Side, intent: Intent): { state: BattleState; events: BattleEvent[] };

  /** 절대시간을 다음 이벤트까지 진행 (SP 충전, DoT, 지속시간 만료 정산 포함) */
  advanceTime(state: BattleState): { state: BattleState; events: BattleEvent[] };

  /** UI 하이라이트용 — 이동 가능 칸 */
  legalMoves(state: BattleState, unit: UnitId): Vec2[];
  /** UI 하이라이트용 — 현재 위치 기준 공격 가능 대상 */
  legalTargets(state: BattleState, unit: UnitId): UnitId[];
  /** GDD §3.2 "한 턴 위협 범위" — 이동 후 공격까지의 합집합 */
  threatRange(state: BattleState, unit: UnitId): Vec2[];
}

export interface BattleConfig {
  matchId: string;
  seed: number;
  mode: '1v1' | '3v3' | '5v5';
  rosters: Record<Side, RosterEntry[]>;
}

export interface RosterEntry {
  officer: OfficerId;
  piece: PieceType;
  level: number;
  /** 레벨업마다 고른 능력 향상 이력 */
  statPicks: readonly ('hp' | 'mp' | 'at')[];
  /** 레벨업마다 고른 책략 */
  tactics: readonly TacticId[];
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

// ═══════════════════════════════════════════════════════════════
// 7. 계산식 (GDD §3.5) — 단일 정의 지점
// ═══════════════════════════════════════════════════════════════

export const FORMULA = {
  /** 크리티컬 확률 % — clamp(0,100). 0이면 절대 미발동, 100이면 반드시 발동 */
  criticalRate: (attackerMight: number, defenderMight: number): number =>
    Math.max(0, Math.min(100, 30 + attackerMight - defenderMight)),

  /** 환술 성공률 % — 실패해도 MP는 소모된다 (GDD §3.7) */
  illusionRate: (casterInt: number, targetInt: number): number =>
    Math.max(0, Math.min(100, 20 + casterInt - targetInt)),

  /** 최종 데미지 — 감쇠는 곱연산 중첩, 결과는 내림 */
  damage: (at: number, critical: boolean, halveIncoming: boolean, fearOnAttacker: boolean): number =>
    Math.floor(at * (critical ? 2 : 1) * (halveIncoming ? 0.5 : 1) * (fearOnAttacker ? 0.5 : 1)),

  /** WT 기준값 (GDD §3.3, 확정). 통솔 100 → 90, 통솔 1 → 189 */
  wtBase: (leadership: number): number => 190 - leadership,

  criticalMultiplier: 2,

  /**
   * 무승부 상한 (GDD §3.9, 2026-07-31 확정).
   *
   * 절대시간 기준이라 **제어 중에는 흐르지 않는다** — 생각을 오래 하는 쪽이 손해 보지 않는다.
   * 기준 AI 5000판 실측에서 결착 최대가 time 2645(26일)였고, 상한 도달은 0.06%였다.
   */
  drawTimeLimit: 6000,

  /** time 100마다 SP +1 */
  spPerTime: 100,
  spCapPerUnit: 5,

  /** 지형(화계/성지) 정산 주기 (GDD §3.8) */
  terrainPeriod: 100,
  /** 행동 완료 후 진행시키는 최소 시간 — 동일 시각 무한루프 방지 (GDD §3.3 step 4) */
  turnEndTimeStep: 1,
  /** 명상 1회 MP 회복량 (GDD §3.4) */
  meditateMp: 1,

  /** 등급 환산 점수 — 랭킹·리사이클 공용 */
  gradeScore: { S: 10, A: 8, B: 6, C: 4, D: 2, E: 0 } as Readonly<Record<Grade, number>>,

  /** 맵 고정 크기 (GDD §3.1) */
  board: { cols: 25, rows: 20, campDepth: 5, deployWidthPerUnit: 5 },
} as const;

/**
 * 기물 마스크의 단일 출처는 `@samchess/data`의 generated/pieces.json 이다
 * (tools/extract_data.py가 저작 + 위협 범위 검증까지 수행).
 * 계산 함수는 ./pieces.ts 참조.
 */
