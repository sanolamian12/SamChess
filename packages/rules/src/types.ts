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
 *
 * `desc`는 화면에서 상태 배지를 눌렀을 때 띄우는 안내문이다. 라벨과 같은 자리에 두는 이유는
 * 같은 이유다 — 화면이 상태이상 목록을 따로 적어 두면 엔진과 조용히 어긋난다.
 */
export const STATUS_META: Readonly<Record<StatusId, {
  kind: 'buff' | 'debuff'; label: string; desc: string;
}>> = {
  critical100: { kind: 'buff', label: '크리티컬 100%', desc: '공격이 반드시 크리티컬로 들어간다 (데미지 ×2).' },
  incomingDamageHalf: { kind: 'buff', label: '받는 피해 절반', desc: '받는 데미지가 절반이 된다 (내림).' },
  untargetable: { kind: 'buff', label: '지정 불가', desc: '공격 대상이 되지 않는다. 지정해서 겨누는 것만 막고, 광역 공격과 지형 피해는 그대로 들어간다.' },
  illusionImmune: { kind: 'buff', label: '결계', desc: '모든 환술이 무효가 되고, 책략으로 걸린 탈진·질병이 해제된다. 고유기술이 건 지속 피해는 풀리지 않는다.' },
  illusionAlways: { kind: 'buff', label: '환술 100%', desc: '내가 거는 환술이 저항 없이 반드시 성공한다. 「결계」에는 통하지 않는다.' },
  freeMove: { kind: 'buff', label: '자유 이동', desc: '기물의 이동 마스크를 무시하고 맵의 빈 칸 어디로든 이동한다.' },
  counterattack: { kind: 'buff', label: '반격', desc: '공격받으면 사거리를 무시하고 되받아친다. 반격이 다시 반격을 부르지는 않는다.' },
  zeroMpCost: { kind: 'buff', label: 'MP 소모 0', desc: '책략·환술을 MP 소모 없이 시전한다.' },
  damageRedirect: { kind: 'buff', label: '피해 대신받기', desc: '지정한 아군이 받을 공격 피해를 대신 받는다. 지속 피해와 지형 피해는 넘어오지 않는다.' },
  attackAnywhere: { kind: 'buff', label: '사거리 무시', desc: '공격 범위를 무시하고 맵 위의 아무 적이나 공격한다.' },
  attackStacking: { kind: 'buff', label: 'AT 누적', desc: '공격할 때마다 AT가 1씩 오른다. 효과가 끝나면 누적분은 사라진다.' },
  instantKillNext: { kind: 'buff', label: '다음 공격 즉사', desc: '다음 공격 대상이 반드시 쓰러진다. 군주(King)에게는 통하지 않는다.' },
  auraIncomingHalf: { kind: 'buff', label: '오라 — 아군 피해 절반', desc: '반경 안의 아군이 받는 데미지가 절반이 된다. 거리는 피해를 입는 순간마다 다시 잰다.' },
  auraOutgoingHalf: { kind: 'buff', label: '오라 — 적 공격 절반', desc: '반경 안의 적이 주는 데미지가 절반이 된다. 거리는 피해를 입는 순간마다 다시 잰다.' },
  convertOnHit: { kind: 'buff', label: '삼고초려', desc: '내가 때린 적에게 표식이 쌓인다. 3회 쌓이면 그 적의 지휘권을 게임이 끝날 때까지 가져온다.' },
  convertProgress: { kind: 'debuff', label: '삼고초려 피격', desc: '「삼고초려」 표식이 쌓이는 중이다. 다 차면 지휘권을 빼앗긴다 — 소속은 그대로지만 옛 아군을 공격하게 된다.' },
  revivePending: { kind: 'buff', label: '부활 대기', desc: '쓰러져도 자기 진영의 빈 칸에서 한 번 되살아난다. 상태이상은 전부 해제되고 고유기술은 다시 쓸 수 없다.' },
  deathCurse: { kind: 'buff', label: '유언계책', desc: '쓰러진 뒤 일정 시간이 지나면 적 1명이 함께 쓰러진다. 적 군주는 대상에서 빠진다.' },
  outgoingDamageHalf: { kind: 'debuff', label: '공포', desc: '주는 데미지가 절반이 된다 (내림).' },
  silence: { kind: 'debuff', label: '침묵', desc: '책략·환술을 시전할 수 없다.' },
  dot: { kind: 'debuff', label: '지속 피해', desc: '일정 주기마다 HP가 줄어든다. 책략으로 걸린 것(탈진·질병)은 「결계」로 풀리지만, 고유기술이 건 것은 풀리지 않는다.' },
  mustTarget: { kind: 'debuff', label: '지정 강제', desc: '지정된 상대만 공격할 수 있다.' },
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

/**
 * 지형의 표시 이름과 안내문. `STATUS_META`와 같은 자리·같은 이유다.
 *
 * `Record<TerrainId, …>`라 지형이 늘면 이 표가 비어 **컴파일이 깨진다.**
 * 덤으로 지형 목록을 **런타임에서도** 셀 수 있게 되는데, 화면의 지형 그림 표
 * (`client/src/battle/terrain.ts`)가 빠짐없이 채워졌는지 그걸로 검사한다 —
 * 그림 표는 문자열이라 컴파일이 지켜 주지 않는 자리가 있다.
 */
export const TERRAIN_META: Readonly<Record<TerrainId, { label: string; desc: string }>> = {
  fire: { label: '화계', desc: '이 칸에 선 유닛의 HP가 일정 주기마다 1씩 줄어든다.' },
  water: { label: '수계', desc: '유닛이 들어갈 수 없는 칸이다. 이동 경로로도 쓸 수 없다.' },
  holy: { label: '성지', desc: '이 칸에 선 유닛의 HP가 일정 주기마다 1씩 차오른다.' },
};

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
  statChoices: readonly [{ hp: 5 }, { mp: 2 }, { at: 0.5 }];
  maxLevel: number;
  /** Level 2~9 */
  levelUp: readonly LevelUpReq[];
}

/**
 * 레벨업 요건. **성공 확률이 없다** — 2026-08-04에 실패를 없애고 전 레벨 100%로
 * 확정했다(GDD §4.3). 난이도는 필요 카드 수로만 조절한다.
 */
export interface LevelUpReq {
  level: number;      // 2~9
  cardsRequired: number;
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
  /** 상점 가챠에 등장하는 등급 — "계정별 유한 랜덤 어레이" 모델(C·D 제외) */
  gachaGrades: readonly Grade[];
  gachaPull: { single: { gold: number }; ten: { gold: number; count: number } };
  /** 장수 1명당 가챠 배열 슬롯 수 = 레벨업 누적 카드 수 × 이 배수. `@samchess/meta`의 `gacha.ts` 참조 */
  gachaSlotMultiplier: number;
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

/**
 * 대전 규모.
 *
 * **1:1은 없앴다** (2026-08-04 기획자 결정). 원문의 「1:1은 군주전」은 King 하나로만 두는
 * 뜻이었는데, 기물 조합이라는 이 게임의 정체성이 통째로 빠지고 편성할 것도 없어진다.
 * GDD §12 미결 #8이 이것으로 해소됐다.
 */
export type BattleMode = '3v3' | '5v5';

/**
 * 전투의 단계. **실시간 제한값은 여기 적지 않는다** — `timing.ts`가 단일 출처다.
 *
 * 예전에는 이 자리에 「배치 60초 · 정찰 15초」가 적혀 있었는데 2026-08-04에 **둘 다
 * 30초로** 조정됐다(GDD §3.9). 코드는 클라이언트의 상수를 읽고 있어 **동작은
 * 멀쩡했고 실행으로는 안 잡혔다** — 숫자를 두 번 적으면 한쪽만 낡는다.
 */
export type BattlePhase =
  | 'deploy'      // 배치 — 진영 안에서 자리를 잡는다 (DEPLOY_MS)
  | 'waiting'     // 상대 준비 대기 (WAITING_MS). **AI 상대에게는 나타나지 않는다**
  | 'scout'       // 정찰 — 양측 기물을 살펴본다 (SCOUT_MS)
  | 'running'     // 절대시간 진행 중
  | 'control'     // 제어권 부여, 절대시간 정지 (CONTROL_MS — 온라인에만)
  | 'finished';

export interface BattleState {
  readonly matchId: string;
  readonly seed: number;
  /** 소비한 난수 개수. 리플레이 재현용 */
  rngCursor: number;

  /** 항상 { x: 25, y: 20 } — 대전 규모와 무관하게 고정 (GDD §3.1) */
  readonly boardSize: Vec2;
  readonly mode: BattleMode;

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

  /**
   * `[차례 넘기기]`를 누른 횟수 (진영별 **누적**). `SKIP_TO_WIN`에 닿으면 그 쪽이 이긴다
   * (GDD §3.3 · §3.9 · 2026-08-19 확정).
   *
   * **되돌리지 않는다** — 한 판 동안 센다. 중간에 상대가 정신을 차려도 그대로 남는다.
   * 한 번 누르려면 상대가 `CONTROL_MS`를 통째로 흘려보내야 하므로 3번은 **최소 60초의
   * 무응답**이다.
   *
   * **저장 형식이 아니다** — `BattleState`는 런타임 상태라 마이그레이션이 없다.
   */
  skips: Record<Side, number>;

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
  /**
   * 상대가 제어 20초를 넘겨 `[차례 넘기기]`가 눌렸다. `count`는 **누적 횟수**이고
   * 화면이 「(2/3)」를 이 값에서 읽는다 — 세는 곳이 둘이면 언젠가 어긋난다.
   */
  | { e: 'turnSkipped'; by: Side; count: number }
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
  /**
   * 조조 「화용도」 — 쓰러진 자리(`from`)에서 부활 자리(`at`)로 옮겨 갔다.
   *
   * `from`이 있는 이유는 **연출 순서 때문**이다. 부활은 `unit.pos`를 곧바로 갈아 끼우므로
   * 화면이 권위 좌표만 보면 맞자마자 부활 자리로 순간이동해 **거기서 피격 점멸**을 한다
   * (기획자 지적 2026-08-13). 점멸이 끝날 때까지 붙들어 둘 자리가 필요하다.
   */
  | { e: 'unitRevived'; unit: UnitId; at: Vec2; from: Vec2 }
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
  mode: BattleMode;
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
  /** 크리티컬 확률 % — clamp(0,100). 0이면 절대 미발동, 100이면 반드시 발동 (2026-08-31, 30→20 하향) */
  criticalRate: (attackerMight: number, defenderMight: number): number =>
    Math.max(0, Math.min(100, 20 + attackerMight - defenderMight)),

  /** 환술 성공률 % — 실패해도 MP는 소모된다 (GDD §3.7) */
  illusionRate: (casterInt: number, targetInt: number): number =>
    Math.max(0, Math.min(100, 20 + casterInt - targetInt)),

  /**
   * 지원책 발동 확률 % — clamp(0,100) (2026-08-31 확정, 이전엔 100% 확정 발동이었다).
   *
   * 환술·크리티컬처럼 「공격측 − 수비측」이 아니라 **시전자 지력 + 대상 지력의 합**이다 —
   * 지원은 대상과의 대결이 아니라 둘의 손발이 맞는 정도이기 때문이다. 자기 자신에게 쓰면
   * `targetInt === casterInt`가 되어 자연히 `2 × 본인 지력`이 나온다 — 자가시전 전용
   * 분기가 필요 없다. 아군 대상이 없는 지형형 지원책(화계 등)도 시전자 지력을 자기
   * 자신의 것으로 두 번 넣어 같은 값으로 떨어진다(호출부 규약, `effects.ts` 참고).
   */
  supportRate: (casterInt: number, targetInt: number): number =>
    Math.max(0, Math.min(100, casterInt + targetInt)),

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
