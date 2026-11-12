/**
 * 기본 튜토리얼 세 판의 **판 짜임** — 누가 · 어디 · 몇 HP로 서는가 (`Design/튜토리얼_시나리오_초안.md` §2 · §3 · §3b).
 *
 * 장수는 **데이터에 고정**이다(2026-10-22 기획자) — 계정의 카드와 무관하게 언제나 같은 연출이라, 이 파일은
 * `PlayerProfile`을 받지 않는다. 시드도 고정이다: 사람의 수가 안내대로 정해져 있으므로 **판 전체가 결정적**이고,
 * 크리티컬 같은 굴림도 매번 같은 결과가 난다 — 회귀가 「안내대로 두면 이긴다」를 판마다 확인한다.
 *
 * 안내 문장 · 강조는 화면(client)의 몫이다. 여기는 `lesson` 열쇠로 그 자리를 가리킬 뿐이다.
 */

import type { BattleConfig, BattleEvent, BattleState, DuelPick, Intent, OfficerId, PieceType, RosterEntry, Side, TacticId, TerrainId, UnitId, Vec2 } from '@samchess/rules';
import { DUEL_COUNT_MS, DUEL_FIRST_COUNT_MS, apply, banditOfficerId, controllingSide, idleTurn, legalTargetsFor, takeTurn } from '@samchess/rules';
import type { TutorialId } from './tutorial.ts';
import { S_STAGES } from './tutorialSBattles.ts';

/** 안내가 켜 두는 명령 — 명령 판 여섯 칸 + 차례 맨 앞 물음의 고유기술 · 일기토 · 설전 */
export type GuideCommand = 'move' | 'attack' | 'meditate' | 'castTactic' | 'useItem' | 'endTurn' | 'unique' | 'duel' | 'debate';

/**
 * 차례 안의 한 단계 — 안내를 띄우고(닫으면) **켜 둔 명령만** 누를 수 있다(2026-10-22 기획자: 튜토리얼 중에는
 * 스토리 밖의 명령을 막는다). `until: 'moved'`면 이동을 마치는 순간 다음 단계로, 없으면 차례가 끝날 때까지 간다.
 */
export interface GuidePhase {
  /** 이 단계 앞에 띄울 안내 — 화면의 문구 열쇠(`tut.` 이름 공간), 차례대로 한 장씩. 등장인물의 대사(`GuideSay`)가 사이에 낀다 */
  readonly lines: readonly GuideLine[];
  readonly allow: readonly GuideCommand[];
  /** [이동]에서 누를 수 있는 **단 한 칸** (기본 1 확정, 기본 2도 같은 방식) — 엉뚱한 칸으로 가 공격이 안 닿는 일이 없게 */
  readonly moveTo?: Vec2;
  /** 책략 · 아이템을 걸 대상 — 조준에서 이 장수만 고를 수 있다 */
  readonly target?: UnitId;
  /** 고육지책의 물음(「아군을 쳐서 적군을 속이시겠습니까?」)에 누를 수 있는 답 하나 — `yes` 짝을 친다 · `no` 적을 친다 (2026-11-10, 주유 판) */
  readonly bitter?: 'yes' | 'no';
  /**
   * 이 단계가 끝나는 때 — `moved`는 이동을 마치는 순간, `skill`은 고유기술을 쓰는 순간(쓴 뒤에도 그 차례에 이동 · 공격이 남는다).
   * 없으면 차례가 끝날 때까지 간다.
   */
  readonly until?: 'moved' | 'skill';
}

/**
 * **등장인물의 대사** 한 장 (2026-10-26 기획자) — 안내 사이에 끼어 극을 살린다. 화면은 안내 창 대신 대사 패널
 * (왼쪽 초상 액자 + 오른쪽 대사 판)을 띄우고, 이름 · 초상은 `by`의 장수에서 찾는다. 아군 · 적군은 같은 그림이고
 * 이름 색만 다르다 — 판 위의 그 장수의 진영으로 가르고, 판에 없는 장수는 `foe`가 정한다(끝 장면에 나타나는 적은 `true`,
 * 판에 안 서고 목소리만 내는 아군은 `false` — 강유 판의 왕평, 2026-10-27).
 */
export interface GuideSay {
  /** 문구 열쇠 — `tut.s.{장수}.say{n}` */
  readonly say: string;
  readonly by: OfficerId;
  /** 판에 없는 장수의 진영 — `true` 적 · `false` 아군(판에 있으면 그 진영을 읽고 이 칸은 비운다) */
  readonly foe?: boolean;
  /** 이 대사가 떠 있는 동안 카메라가 말하는 장수(판에 선)를 비춘다 (2026-11-10 기획자, 제갈량 판의 주유) */
  readonly focus?: boolean;
}

/**
 * 화면 판때기에서 금빛으로 깜빡일 자리 (2026-11-12 기획자, 기본 3) — 안내가 「순서 판 · 통솔 · SP」를 말하는 동안 그 자리를 가리킨다.
 * 자리 이름만 적고 고르는 선택자는 화면(`BattleScene`의 `GUIDE_SPOT_SELECTOR`)이 정한다.
 * `order` 순서 판 테두리 · `day` 전투 n일 · `leadership` 장수 정보의 통솔 · `sp` 아군 SP(게임 정보) · `skillSp` 장수 정보의 고유기술 SP
 */
export type TutorialSpot = 'order' | 'day' | 'leadership' | 'sp' | 'skillSp';

/**
 * 안내 창 한 장 + 그동안 카메라가 비출 칸(2026-11-10 기획자, 제갈량 판 — 부표를 보여 준다) · 깜빡일 판때기 자리(2026-11-12, 기본 3).
 * 깜빡임은 그 장이 떠 있는 동안만이다 — 이어지게 하려면 다음 장에도 적는다
 */
export interface GuideNote {
  readonly note: string;
  readonly focus?: Vec2;
  readonly spots?: readonly TutorialSpot[];
}

/** 안내 한 장 — 문구 열쇠(안내 창) · 대사(대사 패널) · 칸을 비추는 안내 */
export type GuideLine = string | GuideSay | GuideNote;

export const isSay = (line: GuideLine): line is GuideSay => typeof line !== 'string' && 'say' in line;

/** 한 장의 문구 열쇠 — 열쇠가 다 있는가 · 길이를 재는 자리가 둘을 함께 본다 */
export const lineKey = (line: GuideLine): string => (typeof line === 'string' ? line : 'say' in line ? line.say : line.note);

/** 사람의 차례 하나 — 그 차례의 장수와 단계들. 대본이 다 끝나면 나머지 차례는 모든 명령이 켜진다 */
export interface GuideTurn {
  readonly unit: UnitId;
  readonly phases: readonly GuidePhase[];
  /**
   * 이 차례가 **끝난 뒤** 띄울 안내 · 대사 — 다음 장수가 움직이기 전에 판을 세워 두고 띄운다(2026-11-10 기획자, 유비 판:
   * 「유비가 치고 나서 유비가 말하고, 제갈량이 치고 나서 제갈량이 답한다」). 판을 끝낸 차례면 안 뜬다 — 그때는 `outro`다
   */
  readonly after?: readonly GuideLine[];
  /** 이 차례가 열릴 때 판에 세우는 부표 — 처음부터가 아니라 이야기의 그 때에(2026-11-10 기획자, 제갈량 판) */
  readonly buoys?: readonly Vec2[];
}

type Turn = (s: BattleState) => { state: BattleState; events: BattleEvent[] };

/** 판의 적 차례 — 화면(`TutorialBattleScreen`)과 회귀(`tutorialPlay.ts`)가 함께 쓴다 */
export function tutorialEnemyTurn(stage: Pick<TutorialStage, 'enemy' | 'hold'>): Turn {
  const base: Turn = stage.enemy === 'idle' ? idleTurn : takeTurn;
  const hold = new Set(stage.hold ?? []);
  if (!hold.size) return base;
  return (s) => {
    const me = s.activeUnit;
    if (!me || !hold.has(me)) return base(s);
    const side = controllingSide(s, s.units[me]!);
    const targets = legalTargetsFor(s, me).map((id) => s.units[id]!)
      .sort((a, b) => Number(b.piece === 'King') - Number(a.piece === 'King') || a.hp - b.hp || a.id.localeCompare(b.id));
    return apply(s, side, targets.length ? { t: 'attack', targets: [targets[0]!.id] } : { t: 'endTurn' });
  };
}

/** 튜토리얼 판 하나 */
export interface TutorialStage {
  /** 화면이 안내 문장을 고르는 열쇠의 머리 — `basic-1.King` 꼴 */
  readonly lesson: string;
  readonly config: BattleConfig;
  /**
   * 적의 차례 — `idle`은 곧장 턴을 넘긴다(허수아비), `standard`는 기준 AI(`takeTurn`)다.
   * 시간 흐름 · 적의 행동은 기본 3에서 처음 보여 준다.
   */
  readonly enemy: 'idle' | 'standard';
  /**
   * **자리를 지키는 적** — 움직이지 않고, 그 자리에서 닿는 상대만 친다(King 먼저, 그다음 HP 낮은 순). 닿는 상대가 없으면 넘긴다.
   * 기준 AI는 제 King이 노려지면 돌아가 지키고 King은 노려지는 칸을 피해 물러나서, 「한쪽은 성문에 붙어 치고 한쪽은 일대일」 같은
   * 판을 짤 수 없었다(방덕 판, 2026-10-30). 기준 AI(`ai.ts`)는 대전의 것이라 고치지 않고 튜토리얼 층에서 가른다 — `tutorialEnemyTurn`.
   */
  readonly hold?: readonly UnitId[];
  /**
   * **판을 여는 안내** — 첫 수가 놓이기 전에 띄운다(그동안 판을 세워 둔다). 적이 먼저 움직이는 판에서 장면을 소개하기 전에
   * 적이 달려드는 일이 없게(2026-11-10 기획자, 장비 판). 사람이 먼저 두는 판은 첫 차례의 안내로 충분해 안 쓴다
   */
  readonly opening?: readonly GuideLine[];
  /** 사람의 차례마다의 대본 — 회귀가 **이 대본 그대로** 두어 이기는지 본다 */
  readonly guide: readonly GuideTurn[];
  /** 이 판을 이기면 띄울 안내 */
  readonly outro: readonly GuideLine[];
  /**
   * **대결 안의 안내** (2026-11-12 기획자, 일기토 · 설전 판) — 합마다(몇째 합인가 = 배열 자리) 대결을 멈춰 세우고 띄운다. 첫 합은 준비 장면이
   * 끝나고 카운트 직전, 다음 합부터는 앞 합의 공개를 보인 뒤 카운트 직전이다. 닫으면 그 자리부터 카운트를 센다(`LocalTransport.duelHold`).
   * 줄이 없는 합은 멈추지 않는다
   */
  readonly duelGuide?: readonly (readonly GuideLine[])[];
  /** 판에 깔 지도 — S급 판의 장수 id(`public/ui/tutorial/{id}.jpg`). 없으면 판 종류의 지도 */
  readonly map?: string;
  /**
   * **숨겨 둔 장수** — 판에 서 있지만 그리지 않고 순서 판에도 안 올린다. 장면(`scene.move`)이 처음 옮기는 순간 나타나 걸어 들어온다
   * (2026-11-10 기획자, 주유 판의 감택). 차례가 안 오게 첫 WT를 크게 주고 자리를 지키게(`hold`) 둔다
   */
  readonly hidden?: readonly UnitId[];
  /**
   * **이 판에서만 다른 이름** — 장수 id → 문구 열쇠(`alias.*`, 열 언어). 명단에 없는 인물을 비슷한 장수로 세울 때(2026-11-10 기획자,
   * 주유 판: 장간이 명단에 없어 채중을 장간으로). 카드 · 순서 판 · 대사 · 전투 기록이 다 이 이름을 쓴다. 그림은 그 장수의 것 그대로다
   */
  readonly alias?: Readonly<Record<string, string>>;
  /** 판 위에 세워 두는 **부표** — 그림만(판정 없음). 방통 판: 끌어올 2×2 자리를 가리킨다 */
  readonly buoys?: readonly Vec2[];
  /** **판 도중의 장면** — 한 장수의 차례가 끝나는 순간 한 번 일어난다(`applyTutorialScene`). 여럿이면 각자 제 때에(제갈량 판: 화계 · 바람) */
  readonly scene?: TutorialScene | readonly TutorialScene[];
  /**
   * **끝 장면** — 판이 끝난 뒤의 연출(엔진은 모른다). 여포 판: 유비 · 관우가 나타나고 여포가 물러난다.
   * 판이 이미 끝나 싸울 일이 없으므로 엔진에 유닛을 세우지 않는다(2026-10-24 기획자).
   */
  readonly finale?: TutorialFinale;
}

export interface TutorialFinale {
  /** 판 위에 나타나는 장수 — 그림만(판정 없음) */
  readonly appear: readonly { readonly officer: OfficerId; readonly piece: PieceType; readonly at: Vec2 }[];
  /** 물러나는 장수와 그 자리 — 여럿이면 함께 걷는다(마초 판: 마초 · 장비가 각자 본진으로) */
  readonly retreat?: readonly { readonly unit: UnitId; readonly to: Vec2 }[];
  /**
   * 물러나기 전에 띄울 끝맺음(`outro`) 줄 수 — 나타남 → 그 줄들 → 물러남 → 나머지 줄. 없으면 나타남 · 물러남을 다 돌린 뒤 끝맺음을
   * 띄운다(2026-11-10 기획자, 여포 판 — 유비 · 관우가 나타나자마자 여포가 내려가 버려 대사를 다 듣고 물러나게 했다)
   */
  readonly retreatAfter?: number;
  /**
   * **단계로 짠 끝 장면** (2026-11-10 기획자, 제갈량 판) — 나타남 → 대사 → 또 나타남 → 대사 → 함께 걸어 나감처럼 차례로 돈다.
   * 있으면 `appear` · `retreat` · `retreatAfter` 대신 이것을 돌리고, 끝나면 `outro`를 띄운다. 물러나는 쪽은 판의 장수(`unit`)이거나
   * 이 끝 장면에 나타난 장수(`officer`)다
   */
  readonly steps?: readonly FinaleStep[];
}

export interface FinaleStep {
  readonly appear?: readonly { readonly officer: OfficerId; readonly piece: PieceType; readonly at: Vec2 }[];
  readonly lines?: readonly GuideLine[];
  readonly retreat?: readonly ({ readonly unit: UnitId; readonly to: Vec2 } | { readonly officer: OfficerId; readonly to: Vec2 })[];
  /** 물러난 뒤 흐려져 판에서 사라진다 — 전장을 빠져나간다 */
  readonly leave?: boolean;
  /** 제자리에서 흐려지며 사라진다(대사 뒤) — 제갈량 판: 제갈량 · 조운이 유유히 떠난다(2026-11-10 기획자) */
  readonly vanish?: readonly ({ readonly unit: UnitId } | { readonly officer: OfficerId })[];
}

/** 판의 안내 · 대사 전부, 나오는 차례대로 — 열쇠가 다 있는가 · 길이를 재는 자리가 함께 쓴다 */
export const stageLines = (st: TutorialStage): GuideLine[] => [
  ...(st.opening ?? []),
  ...st.guide.flatMap((t) => [...t.phases.flatMap((p) => p.lines), ...(t.after ?? [])]),
  ...(st.duelGuide ?? []).flat(),
  ...(st.finale?.steps ?? []).flatMap((x) => x.lines ?? []),
  ...st.outro,
];

/** 끝 장면에 나타나는 장수 전부 — 그림을 미리 불러 둔다 */
export const finaleOfficers = (f: TutorialFinale | undefined): OfficerId[] =>
  f ? [...f.appear, ...(f.steps ?? []).flatMap((st) => st.appear ?? [])].map((a) => a.officer) : [];

/**
 * **판 도중의 장면** (2026-11-02, 방통 판) — `after`의 차례가 끝나는 순간 한 번: `move`의 장수가 그 칸으로 걸어가고,
 * `burn`의 장수들이 불길에 휩싸여 HP가 `hp`로 떨어진다. 엔진의 규칙으로 일어나는 일이 아니라 **이야기의 한 장면**이라
 * 의도로 둘 수 없다 — 판정 주체(`LocalTransport`의 `after`)와 회귀(`tutorialPlay.ts`)가 같은 `applyTutorialScene`을 부른다.
 * 화면은 불길의 HP 변화(`BURN_REASON`)를 보고 그 장수 위에 화계 그림을 띄운다.
 */
export interface TutorialScene {
  readonly after: UnitId;
  /** `after`의 몇째 차례가 끝날 때인가 (기본 1 — 첫 차례). 장비 판: 고함을 쓴 다음 차례에 다리를 부순다(2026-11-10 기획자) */
  readonly afterTurn?: number;
  readonly move?: { readonly unit: UnitId; readonly to: Vec2 };
  readonly burn?: { readonly units: readonly UnitId[]; readonly hp: number };
  /**
   * **무너짐** (2026-11-02, 서서 판) — 불길 없이 HP만 `hp`로 떨어진다. 팔문금쇄진의 생문이 뚫려 진이 흐트러지는 장면처럼
   * 「무엇에 맞은 것」이 아닌 타격이다. 화면은 맞는 자세만 보이고 화계 그림 · 소리는 안 띄운다(`ROUT_REASON`).
   */
  readonly rout?: { readonly units: readonly UnitId[]; readonly hp: number };
  /** **지형을 깐다** (2026-11-10, 장비 판 — 장비가 장판교에 바위를 굴려 막는다). 그 칸에 있던 지형은 갈아 끼운다 */
  readonly terrain?: { readonly at: readonly Vec2[]; readonly terrain: TerrainId };
  /** **사람 진영 SP를 이만큼으로** (상한 안에서, 2026-11-10 기획자 — 제갈량 판: 칠성단의 바람이 장수들의 기세를 되살린다) */
  readonly sp?: number;
}

/** 장면의 불길이 깎은 HP의 이유 — 화면이 이것을 보고 불길을 띄운다 */
export const BURN_REASON = 'tutorial:burn';
/** 장면의 무너짐이 깎은 HP의 이유 — 화면은 불길 없이 맞는 자세만 */
export const ROUT_REASON = 'tutorial:rout';

/** 장면 하나를 판에 적용한다 — 새 상태와 그 사건들(로그에도 잇는다: `이전 로그 ++ events === 다음 로그`) */
export function applyTutorialScene(s: BattleState, scene: TutorialScene): { state: BattleState; events: BattleEvent[] } {
  const state = structuredClone(s);
  const events: BattleEvent[] = [];
  if (scene.move) {
    const u = state.units[scene.move.unit]!;
    events.push({ e: 'moved', unit: u.id, from: { ...u.pos }, to: { ...scene.move.to } });
    u.pos = { ...scene.move.to };
  }
  for (const [hit, reason] of [[scene.burn, BURN_REASON], [scene.rout, ROUT_REASON]] as const) {
    for (const id of hit?.units ?? []) {
      const u = state.units[id]!;
      if (!u.alive || u.hp <= hit!.hp) continue;
      events.push({ e: 'hpChanged', unit: u.id, delta: hit!.hp - u.hp, reason });
      u.hp = hit!.hp;
    }
  }
  if (scene.terrain) {
    for (const pos of scene.terrain.at) {
      state.terrain = state.terrain.filter((t) => t.pos.x !== pos.x || t.pos.y !== pos.y);
      state.terrain.push({ pos: { ...pos }, terrain: scene.terrain.terrain, lastTickedAt: state.time });
      events.push({ e: 'terrainChanged', pos: { ...pos }, terrain: scene.terrain.terrain });
    }
  }
  if (scene.sp !== undefined) {
    const to = Math.min(state.spCap.P1, scene.sp);
    if (to !== state.sp.P1) { state.sp = { ...state.sp, P1: to }; events.push({ e: 'spChanged', side: 'P1', to }); }
  }
  state.log.push(...events);
  return { state, events };
}

/** 판의 장면들 — 하나든 여럿이든 배열로 */
export const scenesOf = (stage: Pick<TutorialStage, 'scene'>): readonly TutorialScene[] =>
  !stage.scene ? [] : Array.isArray(stage.scene) ? stage.scene : [stage.scene as TutorialScene];

/** 판정 주체에 거는 고리 — `after`의 차례가 끝난 통 뒤에 **한 번** 장면을 낸다. 판마다 새로 만든다(한 번을 기억한다) */
export function tutorialSceneHook(stage: Pick<TutorialStage, 'scene'>): ((s: BattleState, events: readonly BattleEvent[]) => { state: BattleState; events: BattleEvent[] } | null) | undefined {
  const scenes = scenesOf(stage);
  if (!scenes.length) return undefined;
  const done = scenes.map(() => false);
  const ended = scenes.map(() => 0);
  return (s, events) => {
    let out: { state: BattleState; events: BattleEvent[] } | null = null;
    scenes.forEach((scene, i) => {
      if (done[i] || !events.some((e) => e.e === 'turnEnded' && e.unit === scene.after)) return;
      if (++ended[i]! < (scene.afterTurn ?? 1)) return;
      done[i] = true;
      const r = applyTutorialScene(out?.state ?? s, scene);
      out = { state: r.state, events: [...(out?.events ?? []), ...r.events] };
    });
    return out;
  };
}

const U = (id: string): UnitId => id as UnitId;

/** 사람은 언제나 남쪽(P1)이다 — 대전 · 도적떼와 같다 */
export const TUTORIAL_HUMAN_SIDE = 'P1' as const;

const SEED = 20261022;
const SON_GYEON = 'son-gyeon' as OfficerId;
const GA_HU = 'ga-hu' as OfficerId;
const MA_DEUNG = 'ma-deung' as OfficerId;
const JEUNG_POK = 'jeung-pok' as TacticId;
const TANG_YAK = 'tang-yak';

const entry = (officer: OfficerId, piece: PieceType, extra: Partial<RosterEntry> = {}): RosterEntry =>
  ({ officer, piece, level: 1, statPicks: [], tactics: [], ...extra });

/** 도적 — 명단(`OFFICERS`) 밖 전투원이다. 넣으면 AI 상대 풀 · 가챠 · 랭킹이 뽑는다 */
const bandit = (piece: PieceType): RosterEntry => entry(banditOfficerId(piece), piece);

const config = (id: string, rosters: BattleConfig['rosters'], setup: NonNullable<BattleConfig['setup']>): BattleConfig => ({
  matchId: `tutorial-${id}`,
  seed: SEED,
  // 튜토리얼에서 `mode`는 뜻이 없다 — 보상 · 전적 · 전투력 어디에도 안 들어간다
  mode: '3v3',
  scenario: 'tutorial',
  rosters,
  setup,
});

// ── 기본 1 — 기물 여섯 ──────────────────────────────────────────

/**
 * 9 × 9 판, 손견 하나 vs **HP 1 도적** 하나. 적은 「한 번 이동하면 공격 범위에 들어오는」 칸에 선다 —
 * 이동 → 공격 두 걸음이 꼭 필요하다(제자리에서는 안 닿는다는 것을 회귀가 확인한다).
 */
const PIECE_LESSONS: readonly { piece: PieceType; from: Vec2; to: Vec2; enemy: Vec2 }[] = [
  { piece: 'King', from: { x: 4, y: 6 }, to: { x: 4, y: 5 }, enemy: { x: 4, y: 4 } },
  // Rock — 십자로 멀리 가서 대각으로 친다
  { piece: 'Rock', from: { x: 4, y: 7 }, to: { x: 4, y: 3 }, enemy: { x: 5, y: 2 } },
  // Bishop — 대각으로 멀리 가서 십자로 친다
  { piece: 'Bishop', from: { x: 2, y: 7 }, to: { x: 5, y: 4 }, enemy: { x: 5, y: 3 } },
  // Knight — 앞으로 둘 + 옆으로 하나를 뛰어넘는다
  { piece: 'Knight', from: { x: 4, y: 7 }, to: { x: 5, y: 5 }, enemy: { x: 5, y: 4 } },
  // Queen — 8방향 3칸, 위아래만 친다
  { piece: 'Queen', from: { x: 4, y: 7 }, to: { x: 4, y: 4 }, enemy: { x: 4, y: 3 } },
  // Pawn — 한 칸 가서 마름모 2칸 거리를 쏜다
  { piece: 'Pawn', from: { x: 4, y: 7 }, to: { x: 5, y: 6 }, enemy: { x: 5, y: 4 } },
];

/** 덧붙일 규칙 한 장이 있는 기물 — King(쓰러지면 진다) · Rock(막힌다) · Knight(뛰어넘는다) · Pawn(마름모 두 칸) */
const PIECE_RULES: readonly PieceType[] = ['King', 'Rock', 'Knight', 'Pawn'];

const basic1 = (): TutorialStage[] => PIECE_LESSONS.map(({ piece, from, to, enemy }, i) => ({
  lesson: `basic-1.${piece}`,
  enemy: 'idle',
  guide: [{
    unit: U(`P1-${piece}`),
    phases: [
      // 첫 판(King)만 머리말 — 판 · 차례 · 승패를 먼저 말한다
      // 한 장에 한두 문장 — 설명과 지시를 다른 장으로 나눈다(2026-10-24 기획자)
      {
        lines: [
          ...(i === 0 ? ['tut.b1.welcome', 'tut.b1.welcome2', 'tut.b1.board', 'tut.b1.board2'] : []),
          `tut.b1.${piece}.move`, ...(PIECE_RULES.includes(piece) ? [`tut.b1.${piece}.rule`] : []), 'tut.go.move',
        ],
        allow: ['move'], moveTo: to, until: 'moved',
      },
      { lines: [`tut.b1.${piece}.attack`], allow: ['attack'] },
    ],
  }],
  outro: i === PIECE_LESSONS.length - 1 ? ['tut.b1.done', 'tut.b1.done2']
    : piece === 'King' ? ['tut.b1.King.done', 'tut.b1.King.done2'] : [`tut.b1.${piece}.done`],
  config: config(`basic-1-${piece}`, { P1: [entry(SON_GYEON, piece)], P2: [bandit('King')] }, {
    board: { x: 9, y: 9 },
    positions: { P1: [from], P2: [enemy] },
    overrides: { P1: [{ wt: 0 }], P2: [{ hp: 1 }] },
  }),
}));

// ── 기본 2 — 증폭 · 탕약 · 협동 ─────────────────────────────────

/**
 * 2:2. 가후(Lv2, 증폭, 탕약)가 돕고 손견이 친다. 도적 HP는 **손견의 보통 공격 × 2**(4) — 보통 한 대로는 안 쓰러지고
 * 크리(×2) 한 대면 쓰러진다. 손견은 **다친 채**(HP 4) 시작해 탕약을 쓸 이유가 있다.
 * 차례는 가후 → 손견으로 시작한다(첫 WT). 둘의 통솔이 같아(81) 그 뒤로도 번갈아 돈다.
 */
const GA_HU_UNIT = U('P1-Bishop');
const SON_UNIT = U('P1-Knight');

const basic2 = (): TutorialStage[] => [{
  lesson: 'basic-2',
  enemy: 'idle',
  // 이동 칸은 엔진으로 훑어 고른 것이다 — 회귀가 이 대본 그대로 두어 이기는지 본다
  guide: [
    { unit: GA_HU_UNIT, phases: [{ lines: ['tut.b2.welcome', 'tut.b2.welcome2', 'tut.b2.tactic', 'tut.b2.tactic2'], allow: ['castTactic'], target: SON_UNIT }] },
    { unit: SON_UNIT, phases: [
      { lines: ['tut.go.move'], allow: ['move'], moveTo: { x: 3, y: 4 }, until: 'moved' },
      { lines: ['tut.b2.son.attack'], allow: ['attack'] },
    ] },
    { unit: GA_HU_UNIT, phases: [
      { lines: ['tut.b2.item', 'tut.b2.item2', 'tut.b2.item.move', 'tut.go.move'], allow: ['move'], moveTo: { x: 4, y: 5 }, until: 'moved' },
      { lines: ['tut.b2.item.use'], allow: ['useItem'], target: SON_UNIT },
    ] },
    { unit: SON_UNIT, phases: [
      { lines: ['tut.b2.son.approach', 'tut.go.move'], allow: ['move'], moveTo: { x: 4, y: 2 }, until: 'moved' },
      { lines: [], allow: ['endTurn'] },
    ] },
    { unit: GA_HU_UNIT, phases: [{ lines: ['tut.b2.again'], allow: ['castTactic'], target: SON_UNIT }] },
    { unit: SON_UNIT, phases: [
      { lines: ['tut.b2.finish', 'tut.go.move'], allow: ['move'], moveTo: { x: 6, y: 3 }, until: 'moved' },
      { lines: [], allow: ['attack'] },
    ] },
  ],
  outro: ['tut.b2.done', 'tut.b2.done2'],
  config: config('basic-2', {
    P1: [
      entry(GA_HU, 'Bishop', { level: 2, statPicks: ['mp'], tactics: [JEUNG_POK], held: TANG_YAK }),
      entry(SON_GYEON, 'Knight'),
    ],
    P2: [bandit('Queen'), bandit('Rock')],
  }, {
    board: { x: 9, y: 9 },
    positions: { P1: [{ x: 2, y: 7 }, { x: 4, y: 6 }], P2: [{ x: 3, y: 3 }, { x: 6, y: 2 }] },
    overrides: { P1: [{ wt: 0 }, { wt: 1, hp: 4 }], P2: [{ hp: 4 }, { hp: 4 }] },
  }),
}];

// ── 기본 3 — 일당백 · 시간 · SP ─────────────────────────────────

/**
 * 1:1. 마등(일당백 — SP 5, 시전 지연 30, 1.9일 동안 크리 100%)이 도적 두목을 쓰러뜨린다. 적은 **처음으로 움직이고 친다**.
 * SP는 3에서 시작한다 — 0이면 5일을 기다려야 해서 1:1 판이 늘어진다(2026-10-22 기획자).
 *
 * **판은 7 × 7이다** — 11 × 11에서는 도적 두목(King, 한 칸씩)이 닿기 전에 일당백(1.9일)이 끝났다. 엔진으로 자리를 훑어
 * 고른 짜임: 1일째 기다림 → 2일째 시전 → 그사이 두목이 다가와 한 대 → 시전이 터진 뒤 두 차례 크리로 HP 8을 깎는다.
 */
const MA_UNIT = U('P1-Knight');
const BANDIT_KING = U('P2-King');

const basic3 = (): TutorialStage[] => [{
  lesson: 'basic-3',
  enemy: 'standard',
  // 적이 움직이므로 칸을 정하지 않는다 — 대본이 끝난 뒤의 차례는 모든 명령이 켜진다
  guide: [
    // 안내가 말하는 동안 그 판때기 자리가 금빛으로 깜빡인다(2026-11-12 기획자) — 순서 판 · 일 → 통솔 → SP 둘(두 장 이어서) → [대기]에서 끈다
    { unit: MA_UNIT, phases: [{ lines: [
      'tut.b3.welcome', 'tut.b3.welcome2',
      { note: 'tut.b3.time', spots: ['order', 'day'] },
      { note: 'tut.b3.time2', spots: ['leadership'] },
      { note: 'tut.b3.sp', spots: ['sp', 'skillSp'] },
      { note: 'tut.b3.sp2', spots: ['sp', 'skillSp'] },
      'tut.b3.wait',
    ], allow: ['endTurn'] }] },
    { unit: MA_UNIT, phases: [{ lines: [{ note: 'tut.b3.ready', spots: ['sp', 'skillSp'] }, 'tut.b3.cast'], allow: ['unique'] }] },
    // 일당백이 터질 때면 두목이 이미 붙어 있다 — [공격] 하나만 켜서 단추 · 대상이 깜빡이게, 두 대 만에 쓰러진다(회귀가 본다)
    { unit: MA_UNIT, phases: [{ lines: ['tut.b3.crit'], allow: ['attack'], target: BANDIT_KING }] },
    { unit: MA_UNIT, phases: [{ lines: ['tut.b3.again'], allow: ['attack'], target: BANDIT_KING }] },
  ],
  outro: ['tut.b3.done', 'tut.b3.next', 'tut.b3.next2'],
  config: config('basic-3', { P1: [entry(MA_DEUNG, 'Knight')], P2: [bandit('King')] }, {
    board: { x: 7, y: 7 },
    positions: { P1: [{ x: 3, y: 5 }], P2: [{ x: 3, y: 3 }] },
    // 크리(4) 두 대 = 8 — 보통 공격으로는 네 대가 든다
    overrides: { P2: [{ hp: 8 }] },
    startSp: { P1: 3 },
  }),
}];

// ── 일기토 · 설전 — 전투 기초의 넷째 · 다섯째 (2026-11-12) ─────────────

/**
 * **대결을 가르치는 판의 적** — 받은 신청은 언제나 수락하고, 합 중에 도망하지 않는다. 기준 AI(`duelAiIntent`)는 질 것 같으면
 * 거절 · 도망해 「합을 두어 보는」 판이 서지 않는다. 판정 주체(`LocalTransport`의 `duelAi`)와 회귀가 같은 이것을 부른다.
 */
export function tutorialDuelAi(state: BattleState, aiSide: Side): Intent | null {
  const d = state.duel;
  if (state.phase !== 'duel' || !d || d.step !== 'offer') return null;
  return state.units[d.defender]!.side === aiSide ? { t: 'answerChallenge', accept: true } : null;
}

/** 손 모양이 이기는 상대 — 바위는 가위를, 보는 바위를, 가위는 보를 이긴다 */
const BEATS: Readonly<Record<string, DuelPick>> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/**
 * **대결 튜토리얼의 공개** — 카운트가 끝나면 적의 패를 **사람이 그 합을 이기는 쪽으로** 채운다(2026-11-12).
 * 판이 「안내대로 두면 이긴다」를 지키려면 대결의 결말도 정해져 있어야 한다 — 무작위면 열 합 결판 없음 · 패배가 나고 그 뒤의 안내
 * (「SP가 꽉 찼다」 · 「MP가 올랐다」)가 거짓이 된다. 사람이 어느 패를 내든 같은 결말이라 판 전체가 여전히 결정적이다:
 *
 *  - 첫 합 — 공격권은 받는 쪽(적)에 있다. 사람이 이겨(설전은 못 맞혀) **공격권을 빼앗는다**
 *  - 그다음 — 공격권을 쥔 사람이 이겨(설전은 맞혀) 상대 게이지를 **내 무력 · 지력만큼** 깎는다. 0이 될 때까지
 *
 * 안 낸 사람 패는 바위 · 1로 채운다(대결 층이 카운트 중에 하나를 미리 골라 두므로 거의 안 온다). 판의 난수를 안 쓴다.
 */
export function tutorialDuelReveal(state: BattleState): Intent {
  const d = state.duel!;
  const me = TUTORIAL_HUMAN_SIDE;
  const foe: Side = 'P2';
  const mine: DuelPick = d.picks[me] ?? (d.kind === 'duel' ? 'rock' : 1);
  const holding = state.units[d.holder]!.side === me;
  const theirs: DuelPick = d.kind === 'duel' ? BEATS[mine as string]!
    : holding ? mine : ((Number(mine) % 3) + 1) as DuelPick;
  return {
    t: 'duelReveal',
    fill: { ...(d.picks[me] === undefined ? { [me]: mine } : {}), ...(d.picks[foe] === undefined ? { [foe]: theirs } : {}) },
  };
}

/**
 * 대결 안의 멈춤 자리 — 남은 마감이 이만큼일 때 선다(`LocalTransport.duelHold`). 첫 합은 준비 장면이 끝난 뒤(첫 카운트 직전),
 * 다음 합부터는 앞 합의 공개 연출이 끝난 뒤(카운트 직전). 그 합의 안내(`duelGuide`)가 없으면 안 선다
 */
export function tutorialDuelHold(stage: Pick<TutorialStage, 'duelGuide'>, state: BattleState): number | null {
  const d = state.duel;
  if (state.phase !== 'duel' || d?.step !== 'round' || !stage.duelGuide?.[d.history.length]?.length) return null;
  return d.history.length === 0 ? DUEL_FIRST_COUNT_MS : DUEL_COUNT_MS;
}

/**
 * **일기토** — 1:1. 손견(Knight, 무력 90)이 위에 붙어 선 도적 두목(무력 30 · 전의 130)에게 건다 (2026-11-12 기획자).
 * 걸기 전 안내는 짧게, 규칙은 **대결 안에서** 합마다 멈춰 세워 말한다(`duelGuide`) — 공격권 빼앗기 → 90 → 0의 세 합.
 * 이기면 판의 목표(`duelWon`)로 곧장 판이 끝나고, 끝맺음이 승리의 효과를 말한다 — SP 14 → 15(상한)로 SP MAX 버프 · 적 SP −1 · 두목의 부상.
 */
const DUEL_SON = U('P1-Knight');

const basicDuel = (): TutorialStage[] => [{
  lesson: 'basic-duel',
  enemy: 'idle',
  guide: [{ unit: DUEL_SON, phases: [{ lines: ['tut.bd.welcome', 'tut.bd.when', 'tut.bd.go'], allow: ['duel'] }] }],
  duelGuide: [
    ['tut.bd.r1', 'tut.bd.r1b', 'tut.bd.r1c'],
    ['tut.bd.r2', 'tut.bd.r2b'],
    ['tut.bd.r3', 'tut.bd.r3b'],
  ],
  outro: [
    { note: 'tut.bd.won', spots: ['sp'] }, { note: 'tut.bd.spmax', spots: ['sp'] }, 'tut.bd.wound', 'tut.bd.done', 'tut.bd.done2',
  ],
  config: config('basic-duel', { P1: [entry(SON_GYEON, 'Knight')], P2: [bandit('King')] }, {
    board: { x: 7, y: 7 },
    positions: { P1: [{ x: 3, y: 4 }], P2: [{ x: 3, y: 3 }] },
    overrides: { P1: [{ wt: 0 }] },
    startSp: { P1: 14 },
    duels: true,
    goals: { win: [{ kind: 'duelWon', duel: 'duel' }] },
  }),
}];

/**
 * **설전** — 1:1. 가후(Bishop, 지력 96, **MP 0**)가 위에 붙어 선 도적 두목(지력 30 · 정신력 130)에게 건다. 일기토 판과 같은 틀 —
 * 합마다 멈춰 세워 말하고(공격권 빼앗기 → 96 → 0), 이기면 곧장 끝나 끝맺음이 효과를 말한다 — 가후 MP 0 → 2(책략을 쓸 수 있다) · 적 MP −2 · 부상.
 */
const DEBATE_GA = U('P1-Bishop');

const basicDebate = (): TutorialStage[] => [{
  lesson: 'basic-debate',
  enemy: 'idle',
  guide: [{ unit: DEBATE_GA, phases: [{ lines: ['tut.bt.welcome', 'tut.bt.mp', 'tut.bt.go'], allow: ['debate'] }] }],
  duelGuide: [
    ['tut.bt.r1', 'tut.bt.r1b', 'tut.bt.r1c', 'tut.bt.r1d'],
    ['tut.bt.r2', 'tut.bt.r2b'],
    ['tut.bt.r3', 'tut.bt.r3b'],
  ],
  outro: ['tut.bt.won', 'tut.bt.mpup', 'tut.bt.wound', 'tut.bt.done', 'tut.bt.done2'],
  config: config('basic-debate', {
    P1: [entry(GA_HU, 'Bishop', { level: 2, statPicks: ['mp'], tactics: [JEUNG_POK] })],
    P2: [bandit('King')],
  }, {
    board: { x: 7, y: 7 },
    positions: { P1: [{ x: 3, y: 4 }], P2: [{ x: 3, y: 3 }] },
    overrides: { P1: [{ wt: 0, mp: 0 }] },
    duels: true,
    goals: { win: [{ kind: 'duelWon', duel: 'debate' }] },
  }),
}];

/** 한 튜토리얼의 판들 — 기본 1은 여섯 판을 **차례로** 잇는다(화면이 이어 붙인다). 아직 판이 없는 S급은 던진다 */
export function tutorialStages(id: TutorialId): TutorialStage[] {
  switch (id) {
    case 'basic-1': return basic1();
    case 'basic-2': return basic2();
    case 'basic-3': return basic3();
    case 'basic-duel': return basicDuel();
    case 'basic-debate': return basicDebate();
  }
  const make = S_STAGES[id.slice(2)];
  if (!make) throw new Error(`튜토리얼 ${id}는 아직 판이 없다`);
  return make();
}

/** 판이 만들어져 있는가 — 목록이 「준비 중」을 가른다(S급 30판은 차례로 선다) */
export const tutorialReady = (id: TutorialId): boolean =>
  !id.startsWith('s-') || S_STAGES[id.slice(2)] !== undefined;
