/**
 * 액션 스프라이트시트의 칸을 언제 보여줄지 정하는 연출 타임라인.
 *
 * 시트는 `public/actions/{장수id}.png` — 110² 다섯 칸이 가로로 붙어 있다
 * (`tools/build_action_sheets.py`). 칸 번호는 아래 `POSE`가 전부다.
 *
 * **엔진은 이 파일을 모른다.** 여기는 `BattleEvent[]`를 읽어 「누가 몇 ms 동안 어떤
 * 칸을 보여줄지」만 정한다. 판정은 이미 끝나 있고, 연출은 그것을 사람이 읽을 수
 * 있는 속도로 늦춰 보여줄 뿐이다. 그래서 되감기·배속을 붙일 자리도 여기다.
 *
 * 연출이 도는 동안 `Playback`은 다음 턴으로 넘어가지 않는다 — `plan()`이 돌려준
 * 시간만큼 `Playback.hold()`가 걸린다. 그러지 않으면 2.4초짜리 공격 연출 위로
 * 다음 유닛의 행동이 겹쳐 버린다.
 *
 * **카메라도 여기서 짠다** (기획 pptx 28쪽). 자세와 **같은 공용 커서** 위에 큐를 놓아야
 * 화면이 옮겨 가는 시점과 그림이 바뀌는 시점이 맞는다 — 카메라만 따로 0에서 세면
 * 때리는 그림이 뜬 뒤에야 화면이 따라가는 어긋남이 생긴다. 큐를 해석해 실제 카메라를
 * 움직이는 일은 `camera.ts`와 `BattleScene`이 맡는다.
 */

import { STATUS_META } from '@samchess/rules';
import { VISUAL_EFFECTS } from '@samchess/data';
import type { BattleEvent, BattleState, StatusId, UnitId, Vec2 } from '@samchess/rules';
import { ringsOfKind } from './visualEffect.ts';
import { CameraTrack, EMPTY_TRACK, SCALE_FIT, SCALE_FOCUS, type CameraCue } from './camera.ts';

/** 시트의 칸 번호 (왼→오). `build_action_sheets.py`의 `ACTIONS`와 같은 순서다. */
export const POSE = {
  idle: 0,
  move: 1,
  attack: 2,
  cast: 3,
  hurt: 4,
} as const;

export const FRAME_SIZE = 110;
export const FRAME_COUNT = 5;

// ── 기획자 확정 타이밍 (2026-08-11 · **2026-08-13 전체 +0.3초**) ────
//
// 2026-08-13에 한 박자씩 늦췄다. 시스템 대화창이 판을 못 따라간다는 지적이 있었고
// (실측: 밀린 줄 평균 2.7 · 최대 8), 기획자가 「애니메이션을 0.3초 정도 더 천천히」로
// 정했다. 대화창도 함께 고쳐 **연출 창 안에서 말이 끝나도록** 간격을 맞춘다
// (`ui/systemLog.ts`의 `pace()`).
/** 이동 — 경로의 **칸마다** 이 시간씩 머문다. 부드럽게 미끄러지지 않고 한 칸씩 뛴다 */
const STEP_MS = 300;
/** 공격 — 0.3초 점멸 → 0.3초 평상 → 2.3초 공격. 마지막 구간에 대상이 피격을 띄운다 */
const ATTACK_FLASH_MS = 300;
const ATTACK_GAP_MS = 300;
const ATTACK_HOLD_MS = 2300;
/** 책략·명상 — 점멸 없이 1.3초. 적에게 건 책략이 성공하면 1.3초 더 */
const CAST_MS = 1300;
/** 퇴각 — 피격 칸을 0.5초 간격으로 3번 점멸한 뒤 사라진다 */
const DIE_BLINK_MS = 500;
const DIE_BLINKS = 3;

/**
 * **카메라가 먼저 도착할 시간** (기획자 지적 2026-08-13).
 *
 * 예전에는 카메라 큐와 자세를 같은 시각에 놓았다. 그런데 `CameraRig`는 지수 감쇠로
 * 부드럽게 따라가느라 실제로 도착하기까지 시간이 걸려서, **줌인·화면 이동이 도는
 * 동안 이미 때리고 있었다** — 정작 움직임이 안 보인다.
 *
 * 그래서 큐를 놓고 이만큼 **기다린 뒤에** 자세를 시작한다.
 * `FOLLOW_PER_SEC = 0.95`에서 0.5초면 거리의 77%, 0.6초면 82%가 좁혀진다 —
 * 남은 몫은 자세가 도는 동안 자연스럽게 붙는다.
 *
 * **큐가 실제로 달라질 때만 붙는다.** 같은 자리를 계속 보고 있으면 기다릴 이유가 없다.
 */
const CAM_LEAD_MS = 600;

/**
 * **한 박자씩 끊어 보여 준다** (기획자 지적 2026-10-09).
 *
 * 서서가 「침묵」을 거는 동안 카메라가 서서에게 가기도 전에 감녕의 장수 카드에 배지가 이미 붙어 있었다 —
 * 판정은 한 통에 다 끝나 있고 화면은 그걸 한꺼번에 그렸다. 그래서 순서를 정했다.
 *
 * 1. 행동하는 장수에게 카메라가 간다 → **도착하고 1초**
 * 2. 동작(이동 · 공격 · 명상 · 책략 · 아이템). 시스템 대화창의 첫 줄이 이때 나온다
 * 3. 책략 · 아이템이 남에게 걸렸으면 대상에게 카메라가 간다 → **도착하고 1초** → 피격 자세
 * 4. 그 뒤에 배지가 붙는다 — 그 자리가 번쩍인다(나쁜 것 검정 · 좋은 것 흰색, `REVEAL_FLASH_MS`)
 *
 * 「도착」은 `CameraRig`의 지수 감쇠(`FOLLOW_PER_SEC = 0.95`)로 1초면 거리의 95%다.
 * 카메라가 **이미 그 자리를 보고 있으면** 1번을 건너뛴다 — 내 차례에는 차례를 받은 순간 이미 와 있다.
 */
const FOCUS_ARRIVE_MS = 1000;
const FOCUS_BEAT_MS = 1000;
const FOCUS_LEAD_MS = FOCUS_ARRIVE_MS + FOCUS_BEAT_MS;
/** 배지가 드러나며 번쩍이는 시간. 이만큼은 판을 붙들어 둔다 — 번쩍임 위로 다음 수가 겹치지 않게 */
export const REVEAL_FLASH_MS = 700;
/** 같은 편에게 건 책략 — 피격 자세가 없으니 배지가 붙은 뒤 이만큼 더 보여 준다 */
const ALLY_HOLD_MS = 600;

/**
 * 한 칸을 보여주는 구간. **계획 전체의 절대 시각**이다(트랙 시작 기준이 아니라).
 *
 * 한 턴에 「이동 → 공격」이 이어지면 공격 연출은 이동이 끝난 뒤에 시작한다.
 * 그 밀림은 **때리는 쪽만이 아니라 맞는 쪽에도 똑같이** 걸려야 한다 — 각 유닛의
 * 트랙을 따로 0에서 시작하면 대상이 이동 중에 먼저 아파한다(실측으로 잡은 버그).
 * 그래서 이벤트를 훑으며 공용 커서를 밀고, 모든 구간을 그 커서 위에 놓는다.
 */
interface Seg {
  from: number;
  until: number;
  frame: number;
}

/**
 * HP가 **화면에서** 줄어드는 시각.
 *
 * 엔진은 판정을 이미 끝냈으므로 `unit.hp`는 맞은 뒤의 값이다. 그대로 그리면
 * **게이지가 먼저 줄고 때리는 그림이 나중에** 뜬다 (기획자 지적 2026-08-13).
 * 그래서 「언제 얼마가 변하는가」를 따로 적어 두고, 그 시각이 오기 전까지는
 * 화면이 변화분을 도로 더해 **맞기 전 값**을 보여준다.
 */
interface HpCue {
  unit: UnitId;
  at: number;
  delta: number;
}

interface Track {
  segs: Seg[];
  end: number;
  /** 이동 경로와 그 시작 시각. 칸마다 STEP_MS 씩 머물며 좌표가 따라간다 */
  path?: Vec2[];
  pathFrom?: number;
  /** 퇴각 점멸. 있으면 alpha 가 깜빡이고 끝나면 사라진다 */
  dying?: boolean;
  dyingFrom?: number;
  /**
   * **연출이 시작되기 전까지 붙들어 둘 자리** — `holdUntil`까지 여기에 그린다.
   *
   * `state`는 이미 적용이 끝난 상태라 `unit.pos`가 **결과 자리**다. 붙들지 않으면
   * 연출이 시작되기 전 구간에서 화면이 결과를 먼저 보여 준다. 두 군데서 물린다.
   *
   * - **이동** — 카메라가 물러나는 0.6초 동안 도착지에 한 번 떴다가, 걷기가
   *   시작되면 출발점으로 되돌아갔다 (기획자 지적 2026-08-13).
   */
  holdAt?: Vec2;
  holdUntil?: number;
}

/**
 * `from`에서 `to`까지 지나는 칸들 (`from` 제외, `to` 포함).
 *
 * Rock·Bishop·Queen 은 경로형이라 직선 위의 칸을 하나씩 밟는다.
 *
 * **Knight 는 「긴 축으로 두 칸 → 짧은 축으로 한 칸」으로 걷는다** (2026-08-13 기획자 지정).
 * 규칙상으로는 도약이라 중간 칸을 밟지 않지만(경로가 막혀도 간다), 한 번에 순간이동하면
 * 어디로 갔는지 눈이 못 따라간다. 체스에서 나이트를 손으로 옮기는 모양 그대로 보여준다.
 *
 * ```
 *  . . ③        dx=1, dy=2 → 긴 축은 y. (0,1) → (0,2) → (1,2)
 *  . ② .
 *  ⓪ ① .
 * ```
 */
function pathCells(from: Vec2, to: Vec2): Vec2[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const straight = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);

  if (!straight) {
    // 긴 축으로 두 칸, 그다음 짧은 축으로 한 칸. 마지막 칸은 반드시 `to`가 된다.
    const long: Vec2 = Math.abs(dx) > Math.abs(dy) ? { x: sx, y: 0 } : { x: 0, y: sy };
    const step1 = { x: from.x + long.x, y: from.y + long.y };
    const step2 = { x: step1.x + long.x, y: step1.y + long.y };
    return [step1, step2, { ...to }];
  }

  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const out: Vec2[] = [];
  for (let i = 1; i <= steps; i++) out.push({ x: from.x + sx * i, y: from.y + sy * i });
  return out;
}

/**
 * 책략·고유기술이 누구에게 걸렸는지. 이벤트 자체에는 대상이 없어서
 * **뒤따르는 이벤트를 훑는다** — `ui/eventText.ts`의 `collectEffects`와 같은 규칙이다.
 * 다음 행동 이벤트를 만나면 멈춘다.
 */
function affected(events: readonly BattleEvent[], from: number, caster: UnitId): UnitId[] {
  const out = new Set<UnitId>();
  for (let i = from; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.e === 'tacticCast' || ev.e === 'uniqueSkillCast' || ev.e === 'uniqueSkillResolved'
      || ev.e === 'itemUsed'
      || ev.e === 'attacked' || ev.e === 'moved' || ev.e === 'turnEnded' || ev.e === 'timeAdvanced') break;
    if ((ev.e === 'statusApplied' || ev.e === 'hpChanged' || ev.e === 'wtChanged'
      || ev.e === 'controlChanged') && ev.unit !== caster) out.add(ev.unit);
  }
  return [...out];
}

/**
 * 「지금 이 시각에 무슨 소리를 낼 것인가」— 자세·카메라와 같은 공용 커서 위에 얹는다.
 *
 * **소리 자체는 여기서 안 정한다.** `k`만 사건의 종류를 말하고, 실제로 어떤 파일을
 * 트는지는 `BattleScene`이 안다(효과음이냐 성우 대사냐도 거기서 갈린다) — 이
 * 파일은 카메라·자세와 마찬가지로 Phaser도 오디오도 모른다(헤드리스로 검사할 수 있어야
 * 한다는 파일 머리말의 원칙과 같다).
 */
// **고유기술 성우(`uniqueSkillCast`)는 여기 없다** (2026-08-31) — 연출이 도는 동안
// `BattleScene.update()`가 `fx.active`를 보고 이 시각표 전체(`update`/`drainSounds`)를
// 건너뛰므로, 여기 큐를 심어도 연출이 다 끝난 뒤에야 흐르기 시작해 대사가 늦게
// 들렸다. 그 소리는 두루마리 연출의 시간표(`ui/skillFx.ts`)가 직접 튼다.
export type SoundCue =
  | { at: number; k: 'attackHit'; ev: Extract<BattleEvent, { e: 'attacked' }> }
  | { at: number; k: 'moveStart'; ev: Extract<BattleEvent, { e: 'moved' }> }
  // 시장 아이템도 같은 소리를 쓴다 (2026-09-23) — 전용 효과음이 아직 없고,
  // 「무언가를 발동했다」는 결이 책략과 같다. 그림이 오면 여기서 갈린다
  | { at: number; k: 'castStart'; ev: Extract<BattleEvent, { e: 'tacticCast' | 'itemUsed' }> }
  | { at: number; k: 'dieBlink'; ev: Extract<BattleEvent, { e: 'unitDied' }> }
  | { at: number; k: 'terrainSet'; ev: Extract<BattleEvent, { e: 'terrainChanged' }> };

/**
 * 「이 유닛의 이 링은 `until`까지 감춘다」— 책략이 성공한 순간(카메라가 대상에
 * 도착하고 피격 자세가 뜨는 그 시각) **전에는** 디버프 띠가 먼저 보이면 안 된다
 * (기획자 지적 2026-08-26). 상태 자체는 이미 `state`에 적용돼 있으므로(판정은
 * 끝났다), 화면이 그리는 쪽에서 그 시각까지 걸러야 한다 — HP가 `hpPending`으로
 * 「맞기 전 값」을 대신 보여주는 것과 같은 결이다.
 */
export interface HideCue { unit: UnitId; vfx: string; until: number }

/**
 * 「이 유닛의 이 배지는 `at`에 붙는다」— 장수 카드의 엠블럼 (2026-10-09). `key`는 `statusChips.ts`의
 * `StatusEntry.key`와 같은 이름이다(상태 id · `control`). 그 전에는 감추고, 붙는 순간부터 `REVEAL_FLASH_MS` 동안 번쩍인다.
 */
export interface RevealCue { unit: UnitId; key: string; at: number }

/** 장수 카드가 읽는 것 — 아직 감출 배지와 지금 번쩍이는 배지 */
export interface StatusVeil { hidden: ReadonlySet<string>; flashing: ReadonlySet<string> }
const NO_VEIL: StatusVeil = { hidden: new Set(), flashing: new Set() };

/** 연출이 시작되는 순간 카메라가 이미 보고 있는 것 — 같으면 「카메라가 간다」를 건너뛴다 */
export interface PlanFrom {
  camera?: CameraCue | null;
  /**
   * 행동하는 장수를 먼저 비추고 1초를 쉴 것인가 — 기본은 그렇다. **내가 낸 수에는 끈다**: 내 차례는 받는 순간 이미 카메라가
   * 그 장수에게 와 있고, [이동]을 고르면 판 전체로 물러나 있다 — 거기서 다시 장수에게 다가갔다 물러나면 누른 뒤 2초가 헛돈다.
   */
  intro?: boolean;
}

/**
 * **이벤트마다** 화면에서 일어나는 시각 (2026-10-09) — 번호는 `plan()`에 넣은 `events`의 자리다.
 *  · `start`  — 행동 이벤트(이동 · 공격 · 책략 · 아이템 · 명상 · 고유기술)는 **그 동작이 시작되는** 시각,
 *               그 밖(피해 · 상태 · 퇴각 …)은 눈에 보이는 시각
 *  · `effect` — 그 행동의 결과가 보이는 시각(책략이면 배지가 붙는 순간)
 * 대화창은 줄마다 이것으로 시각을 고르고(`LogLine.ev`), 오른쪽 판은 겨눈 장수를 그 행동의 `start`에 올린다.
 * 예전엔 「계획 전체의 첫 동작」 하나였다 — AI가 이동하고 책략을 한 통에 보내면 대상 카드가 **걷기 시작할 때** 떴다.
 */
export interface EventTiming { start: readonly number[]; effect: readonly number[] }

/**
 * 바라보는 쪽 — `1`은 그림 그대로(화면 오른쪽), `-1`은 좌우 반전 (2026-10-10 기획자 확정).
 *
 * 액션 시트 260장의 이동 · 공격 칸은 **전원 화면 오른쪽**을 본다(YuNet으로 고개 방향을 재 249명 오른쪽 ·
 * 나머지 12명은 눈으로 확인). 판은 반전을 안 해서 왼쪽으로 걷는 수는 누구든 뒷걸음(「문워크」)이었다.
 *
 * - 걸을 때는 **도착지의 가로 방향**을 본다 — 칸마다 따지면 Knight가 세로 두 칸을 걷다 마지막에 돌아선다.
 * - 공격 · 책략 · 아이템은 **대상 쪽**, 맞는 쪽은 **때린 쪽**을 본다.
 * - 같은 열이면(가로 차이 0) 돌아서지 않는다. 돌아선 쪽은 **기억한다** — 다음에 다른 쪽으로 움직일 때까지.
 */
export type Facing = 1 | -1;

/** 「`at`부터 `unit`은 `dir`을 본다」 — 계획 안의 돌아섬 */
interface TurnCue { unit: UnitId; at: number; dir: Facing }

export class PoseDirector {
  /** 지난 계획들이 끝난 뒤 바라보는 쪽 — 없으면 그림 그대로(`1`) */
  private facing = new Map<UnitId, Facing>();
  /** 이번 계획의 돌아섬. 다음 계획(또는 `clear()`)이 `facing`에 접어 넣는다 */
  private turns: TurnCue[] = [];
  private tracks = new Map<UnitId, Track>();
  private cam = EMPTY_TRACK;
  private hp: HpCue[] = [];
  private t = 0;
  /** 재생 예정 소리 — 시각순으로 정렬돼 있다. `soundCursor`가 어디까지 냈는지 가리킨다 */
  private sounds: SoundCue[] = [];
  private soundCursor = 0;
  private hide: HideCue[] = [];
  private reveal: RevealCue[] = [];
  /**
   * **이동 미리보기** (2026-10-09) — 내가 칸을 누르면 장수가 그 칸까지 걸어가 서고 「이동을 확정하시겠습니까?」를 묻는다.
   * 엔진에는 아직 아무것도 안 보냈다 — [취소]면 이것만 지우면 출발점으로 돌아간다. [확정]으로 온 `moved`는
   * 이미 걸어간 길이라 다시 걷지 않는다(`plan()`의 `moved`).
   */
  private pv: { unit: UnitId; fromX: number; to: Vec2; path: Vec2[]; t: number } | null = null;
  private timing: EventTiming = { start: [], effect: [] };

  /** 연출이 도는 중인가. 도는 동안은 입력도 시간도 멈춘다. */
  get busy(): boolean {
    for (const tr of this.tracks.values()) if (this.t < tr.end) return true;
    // 자세는 없고 게이지만 움직일 차례일 수도 있다 (도트 정산). 그것도 연출이다.
    for (const c of this.hp) if (this.t < c.at) return true;
    for (const c of this.reveal) if (this.t < c.at + REVEAL_FLASH_MS) return true;
    return false;
  }

  /** 장수를 `to`까지 미리 걸려 세운다 — 계획(`plan`)과 따로 돈다 */
  preview(unit: UnitId, from: Vec2, to: Vec2): void {
    this.pv = { unit, fromX: from.x, to: { ...to }, path: pathCells(from, to), t: 0 };
  }

  clearPreview(): void { this.pv = null; }

  /** 미리보기 장수가 아직 걷는 중인가 — 씬이 그동안 매 프레임 다시 그린다 */
  get previewWalking(): boolean { return this.pv !== null && this.pv.t < this.pv.path.length * STEP_MS; }

  /** 이번 계획에서 이벤트마다 화면에 일어나는 시각 (`EventTiming`) */
  get eventTiming(): EventTiming { return this.timing; }

  /** 이 유닛의 배지 중 아직 감출 것 · 지금 번쩍이는 것 — `RevealCue` 참조 */
  statusVeil(unit: UnitId): StatusVeil {
    let hidden: Set<string> | null = null;
    let flashing: Set<string> | null = null;
    for (const c of this.reveal) {
      if (c.unit !== unit) continue;
      if (this.t < c.at) (hidden ??= new Set()).add(c.key);
      else if (this.t < c.at + REVEAL_FLASH_MS) (flashing ??= new Set()).add(c.key);
    }
    if (!hidden && !flashing) return NO_VEIL;
    return { hidden: hidden ?? NO_VEIL.hidden, flashing: flashing ?? NO_VEIL.flashing };
  }

  /** 이번 계획의 카메라 큐 (pptx 28쪽). 씬이 `elapsed`와 함께 읽는다. */
  get camera(): CameraTrack { return this.cam; }

  /** 계획이 시작한 뒤 흐른 시간(ms) */
  get elapsed(): number { return this.t; }

  /**
   * 지금 시각(`t`)에 닿은 소리 큐를 꺼낸다. **한 번만** 돌려준다 — `soundCursor`가
   * 넘긴 자리를 기억하므로 매 프레임 다시 물어도 같은 소리가 두 번 나지 않는다.
   */
  drainSounds(): SoundCue[] {
    const out: SoundCue[] = [];
    while (this.soundCursor < this.sounds.length && this.sounds[this.soundCursor]!.at <= this.t) {
      out.push(this.sounds[this.soundCursor]!);
      this.soundCursor++;
    }
    return out;
  }

  /** 이 유닛의 이 링을 지금 감춰야 하는가 — `HideCue` 참조. */
  isHidden(unit: UnitId, vfx: string): boolean {
    return this.hide.some((h) => h.unit === unit && h.vfx === vfx && this.t < h.until);
  }

  /**
   * 이벤트를 읽어 연출을 짠다. **필요한 시간(ms)** 을 돌려준다.
   *
   * 새 계획은 이전 것을 지운다 — 겹쳐 재생하지 않는다. `Playback`이 이 시간만큼
   * 기다려 주므로 겹칠 일이 원래 없지만, 항복·전투 종료처럼 중간에 끊는 길이 있다.
   */
  plan(events: readonly BattleEvent[], state: BattleState, from: PlanFrom = {}): number {
    this.settleFacing();
    const next = new Map<UnitId, Track>();
    const turnCues: TurnCue[] = [];
    /** `unit`이 `at`부터 `toX` 쪽을 본다 — 같은 열이면 그대로 */
    const face = (unit: UnitId, at: number, fromX: number | undefined, toX: number | undefined): void => {
      if (fromX === undefined || toX === undefined || toX === fromX) return;
      turnCues.push({ unit, at, dir: toX > fromX ? 1 : -1 });
    };
    const xOf = (id: UnitId | undefined): number | undefined => (id ? state.units[id]?.pos?.x : undefined);
    const cues: CameraCue[] = [];
    const hpCues: HpCue[] = [];
    const soundCues: SoundCue[] = [];
    const hideCues: HideCue[] = [];
    const revealCues: RevealCue[] = [];
    /** 새로 걸린 상태가 화면에 붙는 시각 — 행동마다 정한다. 정하지 않은 갈래(도트 정산 등)는 `hitAt`과 같다 */
    let revealAt = 0;
    /** 이벤트마다 — `EventTiming`. `actStart`는 지금 행동의 동작이 시작되는 시각 */
    const evStart: number[] = [];
    const evEffect: number[] = [];
    let actStart = 0;
    /** 이벤트가 순서대로 일어난 시각. 행동 하나가 끝나야 다음이 시작한다. */
    let cursor = 0;
    /**
     * 지금 진행 중인 행동에서 **피해가 눈에 보이는** 시각.
     *
     * 공격이면 피격 자세가 뜨는 순간, 책략이면 대상이 아파하는 두 번째 구간이다.
     * `hpChanged`는 그 행동 이벤트 **바로 뒤에** 붙어 오므로 이 값을 그대로 쓴다.
     */
    let hitAt = 0;

    const track = (unit: UnitId): Track => {
      let tr = next.get(unit);
      if (!tr) { tr = { segs: [], end: 0 }; next.set(unit, tr); }
      return tr;
    };
    /** `unit`에게 커서 기준 `offset`부터 `len` 동안 `frame`을 보여준다. */
    const show = (unit: UnitId, offset: number, len: number, frame: number): void => {
      const tr = track(unit);
      tr.segs.push({ from: cursor + offset, until: cursor + offset + len, frame });
      tr.end = Math.max(tr.end, cursor + offset + len);
    };
    /**
     * 카메라 큐를 **커서 자리에** 놓는다 (pptx 28쪽).
     *
     * 행동이 시작하는 시점에 걸어 두면 그림이 바뀌는 동안 화면이 다가간다 —
     * 공격이라면 점멸·간격 0.4초가 이동 시간이 되어, 실제로 맞는 순간에는 이미 도착해 있다.
     */
    /** 마지막으로 놓은 큐 — 같은 자리를 다시 보라고 하면 기다릴 이유가 없다 */
    // 카메라가 지금 보고 있는 것에서 시작한다 — 같은 자리를 다시 보라고 하면 기다리지 않는다
    let lastCue: CameraCue | null = from.camera ?? null;

    /**
     * 카메라 큐를 놓고, **자리가 달라졌으면 도착할 시간을 준다**(`CAM_LEAD_MS`).
     *
     * 커서를 밀기 때문에 **반드시 `show()`보다 먼저** 불러야 한다 — 순서가 뒤집히면
     * 자세가 이미 시작된 자리에 큐가 놓인다.
     *
     * `at`은 비출 칸 — 이동한 장수는 `state`에 이미 도착지가 적혀 있어, 출발점을 비추려면 따로 준다.
     */
    const look = (scale: number, unit?: UnitId, lead = CAM_LEAD_MS, at?: Vec2): void => {
      const cell = at ?? (unit ? state.units[unit]?.pos ?? null : null);
      const cue: CameraCue = { from: cursor, scale, cell: cell ? { ...cell } : null };
      const same = lastCue !== null && lastCue.scale === cue.scale && (lastCue.lean ?? 0) === 0
        && lastCue.cell?.x === cue.cell?.x && lastCue.cell?.y === cue.cell?.y;
      cues.push(cue);
      lastCue = cue;
      if (!same) cursor += lead;
    };

    /** 행동하는 장수를 먼저 비춘다 — 도착하고 1초 (`FOCUS_LEAD_MS`, 2026-10-09). 한 계획에 한 번 */
    let introduced = false;
    const introduce = (actor: UnitId, at?: Vec2): void => {
      if (!introduced && from.intro !== false) {
        introduced = true;
        look(SCALE_FOCUS, actor, FOCUS_LEAD_MS, at);
      }
    };

    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      switch (ev.e) {
        case 'moved': {
          // 미리보기로 이미 걸어가 서 있다 — 확정한 것을 다시 걷지 않는다
          if (this.pv?.unit === ev.unit && this.pv.to.x === ev.to.x && this.pv.to.y === ev.to.y) {
            actStart = cursor;
            face(ev.unit, cursor, ev.from.x, ev.to.x);   // 미리보기가 돌려세운 쪽을 이어받는다
            break;
          }
          introduce(ev.unit, ev.from); // 먼저 그 장수(출발점)를 비추고 1초
          look(SCALE_FIT);            // 이동은 판 전체 — 어디서 어디로 갔는지가 보여야 한다
          // 발소리는 **줌아웃이 끝나고 실제로 걷기 시작하는 시각**에 튼다 — 이벤트가
          // 도착한 즉시 틀면 카메라가 아직 도착하지 않았는데 소리만 먼저 난다.
          soundCues.push({ at: cursor, k: 'moveStart', ev });
          actStart = cursor;
          const path = pathCells(ev.from, ev.to);
          const len = path.length * STEP_MS;
          const tr = track(ev.unit);
          tr.path = path;
          tr.pathFrom = cursor;       // 줌아웃이 끝난 **뒤에** 걷기 시작한다
          // 그 0.6초 동안은 **출발점**에 붙들어 둔다. 안 그러면 권위 좌표(도착지)에
          // 한 번 떴다가 걷기가 시작되며 출발점으로 되돌아간다.
          tr.holdAt = { ...ev.from };
          tr.holdUntil = cursor;
          face(ev.unit, cursor, ev.from.x, ev.to.x);     // 첫걸음과 함께 돌아선다
          show(ev.unit, 0, len, POSE.move);
          cursor += len;
          hitAt = cursor;             // 지형 피해는 도착하고 나서
          revealAt = hitAt;
          break;
        }

        case 'attacked': {
          // **피격되는 쪽**을 먼저 비춘다. 「장료지제」처럼 여럿이 맞으면 `attacked`가
          // 여러 번 나오고 커서가 그때마다 밀리므로, 포커스가 대상 사이를 옮겨 다닌다 (28쪽).
          // 줌인이 끝나고 나서 때리기 시작한다 (2026-08-13).
          // 그 전에 **때리는 쪽**을 먼저 비추고 1초 (2026-10-09) — 대상은 언제나 이웃 칸이라 그다음 옮김은 짧다.
          introduce(ev.unit);
          look(SCALE_FOCUS, ev.target);
          const hold = ATTACK_FLASH_MS + ATTACK_GAP_MS;
          // **게이지는 피격 그림과 함께 줄어든다.** 예전에는 판정 순서 그대로
          // 게이지가 먼저 줄고 때리는 그림이 나중에 떴다 (기획자 지적 2026-08-13).
          actStart = cursor;
          hitAt = cursor + hold;
          revealAt = hitAt;
          // 피격음도 **같은 시각** — 실제로 맞는(피격 자세가 뜨는) 순간이다.
          // 이벤트가 도착한 즉시 틀면 카메라가 도착하기도 전에 소리만 먼저 난다
          // (기획자 지적 2026-08-26, 상대 턴에서만 도드라졌다 — 내 턴은 대개 카메라가
          // 이미 그 자리를 보고 있어 `CAM_LEAD_MS`가 안 붙었을 뿐이다).
          soundCues.push({ at: hitAt, k: 'attackHit', ev });
          face(ev.unit, cursor, xOf(ev.unit), xOf(ev.target));      // 때리는 쪽은 대상을
          face(ev.target, hitAt, xOf(ev.target), xOf(ev.unit));     // 맞는 쪽은 맞는 순간 때린 쪽을
          show(ev.unit, 0, ATTACK_FLASH_MS, POSE.attack);
          show(ev.unit, hold, ATTACK_HOLD_MS, POSE.attack);
          // 대상은 **두 번째 공격 그림이 뜨는 동안** 피격을 띄운다.
          // 그 사이 시스템 대화창의 「누가 공격했다 · 크리티컬」을 읽게 된다.
          show(ev.target, hold, ATTACK_HOLD_MS, POSE.hurt);
          cursor += hold + ATTACK_HOLD_MS;
          break;
        }

        /*
         * 책략 · 시장 아이템 — **같은 시간표다** (2026-10-09 다시 짰다, 파일 머리의 `FOCUS_*` 참조).
         *
         *   시전자 비춤 → 1초 → 시전 자세 1.3초(대화창 첫 줄) → 대상 비춤 → 1초 → 피격 자세 1.3초 → 배지 번쩍
         *
         * 대상이 같은 편이면(회복 · 버프) 피격 자세 없이 도착 1초 뒤에 배지가 붙는다. 자기에게만 걸었거나
         * 저항당했으면 시전 자세가 끝나는 순간이 끝이다 — 옮겨 갈 대상이 없다.
         *
         * **`look()`이 반드시 `show()`보다 먼저다** (기획자 지적 2026-08-26) — 카메라부터 옮기고, 그 카메라가
         * 실제로 도착한 시각(`look()`이 밀어 둔 새 `cursor`)에 자세를 놓는다. 뒤집으면 「맞는 게 먼저고 포커싱은 나중」이 돌아온다.
         */
        case 'tacticCast':
        case 'itemUsed': {
          const caster = state.units[ev.unit];
          const others = affected(events, i + 1, ev.unit);
          const enemies = others.filter((id) => state.units[id]?.side !== caster?.side);
          const resisted = ev.e === 'tacticCast' && ev.resisted;
          introduce(ev.unit);
          look(SCALE_FOCUS, ev.unit);   // 책략은 **시전자**를 비춘다 (28쪽) — 방금 비췄으면 기다리지 않는다
          // 책략 소리는 **통하든 안 통하든** 시전을 시작하는 이 순간에 튼다 (기획자 지적 2026-08-26)
          soundCues.push({ at: cursor, k: 'castStart', ev });
          actStart = cursor;
          // 시전자는 겨눈 쪽을 본다 — 장수를 겨눴으면 그 장수, 아니면 효과를 받은 첫 장수(자기 자신이면 그대로)
          const aim = ('target' in ev ? ev.target : undefined) ?? (resisted ? undefined : enemies[0] ?? others[0]);
          face(ev.unit, cursor, xOf(ev.unit), xOf(aim));
          show(ev.unit, 0, CAST_MS, POSE.cast);
          cursor += CAST_MS;
          // 자기 버프 · 회복이면 시전이 끝나는 시점에 게이지가 움직이고 배지가 붙는다
          hitAt = cursor;
          revealAt = cursor;
          if (!resisted && others.length > 0) {
            // 아군 회복처럼 적이 없으면 첫 대상으로, 적이 섞였으면 적에게 — 무엇이 어떻게 됐는지 보여야 한다
            look(SCALE_FOCUS, enemies[0] ?? others[0]!, FOCUS_LEAD_MS);
            hitAt = cursor;              // 카메라가 도착하고 1초 = 실제로 「맞는」 시각
            if (enemies.length > 0) {
              for (const id of enemies) {
                face(id, cursor, xOf(id), xOf(ev.unit));     // 맞는 쪽은 시전자를
                show(id, 0, CAST_MS, POSE.hurt);
              }
              cursor += CAST_MS;
              revealAt = cursor;         // 피격 자세가 끝난 뒤에 배지
            } else {
              revealAt = cursor;
              show(others[0]!, 0, ALLY_HOLD_MS, POSE.idle);   // 계획이 그만큼 살아 있게 — 자세는 평상
              cursor += ALLY_HOLD_MS;
            }
          }
          break;
        }

        case 'uniqueSkillCast':
          // 자세는 평상이다 — 두루마리 연출(`ui/skillFx.ts`)이 판 전체를 덮으므로
          // 타일까지 바꿀 필요가 없다는 기획자 판단. 카메라는 시전자에 붙여 둔다:
          // 연출이 걷혔을 때 이미 그 자리를 보고 있어야 효과를 읽을 수 있다.
          // 성우는 여기서 큐를 안 심는다 — 연출의 시간표가 직접 튼다
          // (SoundCue 타입 위 주석 참조).
          look(SCALE_FOCUS, ev.unit);
          actStart = cursor;
          hitAt = cursor;
          revealAt = cursor;
          break;

        case 'uniqueSkillResolved':
          /*
           * **지연이 끝나 실제로 발동하는 순간** (2026-09-07). 배너는 시전할 때
           * 이미 돌았으므로 여기서는 다시 띄우지 않고, **카메라만 시전자에게
           * 보낸다** — 뒤이어 오는 효과(장료 「장료지제」의 연속 공격, 새로 걸리는
           * 상태)를 그 자리에서 읽어야 한다. `look()`이 커서를 미므로 `hitAt`은
           * 그 뒤에 잡는다(파일 머리말 — 카메라가 도착한 뒤에 연출이 시작한다).
           *
           * 시전 자세를 푸는 일은 여기서 안 한다 — 자세는 `unit.casting`이라는
           * **상태**에서 나오고(`BattleScene`), 그 필드는 이 이벤트와 같은 통에
           * 이미 지워져 있다.
           */
          look(SCALE_FOCUS, ev.unit);
          actStart = cursor;
          hitAt = cursor;
          revealAt = cursor;
          break;

        /*
         * 「명상」 — 이벤트가 `mpChanged` 하나뿐이다. 책략과 같은 자리(제어권을 쥔 유닛의 행동)라 같은 칸을 같은 시간 보여준다.
         * **이벤트 순서 그대로 여기서 짠다** (2026-10-09 기획자 지적) — 예전엔 계획 끝에 「이 장수에게 자세가 하나도 없으면」만
         * 붙였는데, AI는 이동하고 명상을 한 통에 보내서 걷기 자세가 있으면 명상이 통째로 빠졌다. 카메라가 곧장 다음 차례로 넘어갔다.
         */
        case 'mpChanged':
          if (ev.reason !== 'meditate') break;
          introduce(ev.unit);           // 명상도 시전자를 비추고 1초 (28쪽 · 2026-10-09)
          look(SCALE_FOCUS, ev.unit);
          actStart = cursor;
          show(ev.unit, 0, CAST_MS, POSE.cast);
          cursor += CAST_MS;
          hitAt = cursor;
          revealAt = cursor;
          break;

        case 'hpChanged':
          // **언제 눈에 보일지**만 적어 둔다. 얼마나 줄지는 이미 `unit.hp`에 반영돼
          // 있으므로, 화면은 아직 안 온 변화분을 도로 더해 「맞기 전 값」을 그린다.
          hpCues.push({ unit: ev.unit, at: hitAt, delta: ev.delta });
          break;

        /*
         * **새로 걸린 상태는 그 행동이 정한 시각(`revealAt`)에 붙는다** (2026-10-09) — 장수 카드의 엠블럼과 판 위의 링 둘 다.
         * `state`는 판정이 끝난 값이라 그대로 그리면 카메라가 시전자에게 가기도 전에 대상 카드에 배지가 먼저 붙는다.
         * 링은 이벤트에 출처(`origin`)가 없어 그 좋고 나쁨의 두 갈래(책략 · 고유기술)를 함께 감춘다.
         */
        case 'statusApplied': {
          revealCues.push({ unit: ev.unit, key: ev.status, at: revealAt });
          const kind = STATUS_META[ev.status as StatusId]?.kind;
          if (kind) for (const vfx of ringsOfKind(kind)) hideCues.push({ unit: ev.unit, vfx, until: revealAt });
          break;
        }

        case 'controlChanged':
          if (ev.by) revealCues.push({ unit: ev.unit, key: 'control', at: revealAt });
          break;

        case 'wtChanged': {
          // 「선공」 · 「함정」처럼 즉시 끝나는 WT 보정의 링 — 씬이 물고 있는 것(`pendingRings`)도 같은 시각까지 감춘다
          const kind = (VISUAL_EFFECTS.persistent.instantWt as Record<string, 'buff' | 'debuff' | undefined>)[ev.reason];
          if (kind) for (const vfx of ringsOfKind(kind)) hideCues.push({ unit: ev.unit, vfx, until: revealAt });
          break;
        }

        case 'terrainChanged':
          // 칸 자체는 `state.terrain`을 그대로 따라가는 붙박이 그림이라(파일 머리 —
          // `battle/terrain.ts`) 여기서 자세를 만들 것은 없다. 소리만 **효과가 눈에
          // 보이는 시각**(`hitAt` — 책략 시전이 끝나는 순간)에 튼다.
          soundCues.push({ at: hitAt, k: 'terrainSet', ev });
          break;

        case 'unitDied': {
          // 커서를 밀지 않는다 — 한 방에 둘이 쓰러지면 같이 점멸해야 한다.
          // 공격으로 죽은 경우는 커서가 이미 그 공격 뒤에 있어 자연히 이어진다.
          const tr = track(ev.unit);
          tr.dying = true;
          tr.dyingFrom = cursor;
          // 사망음은 **점멸이 시작되는 이 시각**에 튼다 — 이벤트 도착 즉시 틀면
          // 아직 공격 연출이 도는 중인데(피격음보다도 먼저) 사망음이 먼저 들린다
          // (기획자 지적 2026-08-26).
          soundCues.push({ at: cursor, k: 'dieBlink', ev });
          show(ev.unit, 0, DIE_BLINK_MS * DIE_BLINKS, POSE.hurt);
          break;
        }

        default:
          break;
      }
      // 이 이벤트가 화면에 일어나는 시각 — `EventTiming`
      const action = ev.e === 'moved' || ev.e === 'attacked' || ev.e === 'tacticCast' || ev.e === 'itemUsed'
        || ev.e === 'uniqueSkillCast' || ev.e === 'uniqueSkillResolved' || (ev.e === 'mpChanged' && ev.reason === 'meditate');
      if (action) {
        evStart[i] = actStart;
        evEffect[i] = ev.e === 'tacticCast' || ev.e === 'itemUsed' ? revealAt : hitAt;
      } else {
        const at = ev.e === 'unitDied' ? cursor
          : ev.e === 'statusApplied' || ev.e === 'controlChanged' ? revealAt : hitAt;
        evStart[i] = at;
        evEffect[i] = at;
      }
    }

    // 자세가 하나도 없어도 계획은 갈아 끼운다 — 고유기술처럼 **카메라 큐만 있는** 배치가
    // 있고(자세는 평상이다), 지난 계획을 남겨 두면 다 끝난 연출의 흔적이 그대로 남는다.
    this.tracks = next;
    this.cam = new CameraTrack(cues);
    this.hp = hpCues;
    // 커서가 이벤트 순서를 그대로 따라가 이미 시각순이지만, 안전하게 한 번 더 정렬한다
    // — `drainSounds()`가 순서를 가정하고 앞에서부터만 훑는다.
    this.sounds = soundCues.sort((a, b) => a.at - b.at);
    this.soundCursor = 0;
    this.hide = hideCues;
    // 자세가 하나도 없으면 시계(`t`)가 안 흐른다(`update()`) — 그때 배지를 감추면 영영 못 붙는다
    this.reveal = next.size > 0 ? revealCues.filter((c) => c.at > 0) : [];
    this.timing = { start: evStart, effect: evEffect };
    // 맞는 쪽의 돌아섬(`hitAt`)이 다음 행동의 것보다 늦을 수도 있다 — 시각순으로 둔다(`facingOf`는 마지막 것을 고른다)
    this.turns = turnCues.sort((a, b) => a.at - b.at);
    this.pv = null;
    this.t = 0;
    // HP 큐만 있고 자세가 없는 경우가 있다 — 도트 정산이 그렇다. 그때도 게이지가
    // 제때 움직이도록 그 시각까지는 계획이 살아 있어야 한다.
    const hpEnd = hpCues.length > 0 ? Math.max(...hpCues.map((c) => c.at)) : 0;
    if (next.size === 0) return 0;
    const revealEnd = this.reveal.length > 0 ? Math.max(...this.reveal.map((c) => c.at)) + REVEAL_FLASH_MS : 0;
    return Math.max(hpEnd, revealEnd, ...[...next.values()].map((tr) => tr.end));
  }

  /**
   * 이 유닛의 HP 중 **아직 화면에 반영하면 안 되는** 몫.
   *
   * `unit.hp`(맞은 뒤 값)에서 이만큼 빼면 지금 그려야 할 값이 된다.
   * 데미지는 `delta`가 음수이므로 빼면 도로 올라간다.
   */
  hpPending(unit: UnitId): number {
    let sum = 0;
    for (const c of this.hp) if (c.unit === unit && this.t < c.at) sum += c.delta;
    return sum;
  }

  /**
   * 지금 화면에 그려야 할 HP. 게이지를 그리는 쪽은 전부 이걸 쓴다
   * (타일 바 · 카드 스트립) — 두 곳이 서로 다른 값을 그리면 어느 쪽이 맞는지 알 수 없다.
   */
  shownHp(unit: { id: UnitId; hp: number; maxHp: number }): number {
    const pending = this.hpPending(unit.id);
    if (pending === 0) return unit.hp;
    return Math.max(0, Math.min(unit.maxHp, unit.hp - pending));
  }

  update(deltaMs: number): void {
    if (this.tracks.size > 0) this.t += deltaMs;
    if (this.pv) this.pv.t += deltaMs;
  }

  /**
   * 지금 바라보는 쪽 (`Facing`). 미리보기로 걷는 장수는 도착지 쪽, 그 밖은 이번 계획에서 이미 지난
   * 마지막 돌아섬 — 없으면 기억해 둔 쪽.
   */
  facingOf(unit: UnitId): Facing {
    const pv = this.pv;
    if (pv?.unit === unit && pv.to.x !== pv.fromX) return pv.to.x > pv.fromX ? 1 : -1;
    let dir = this.facing.get(unit) ?? 1;
    for (const c of this.turns) {
      if (c.at > this.t) break;
      if (c.unit === unit) dir = c.dir;
    }
    return dir;
  }

  /** 이번 계획의 돌아섬을 전부 기억에 접어 넣는다 — 끝까지 안 돌았어도 결과 쪽을 본다(상태가 이미 결과인 것과 같다) */
  private settleFacing(): void {
    for (const c of this.turns) this.facing.set(c.unit, c.dir);
    this.turns = [];
  }

  /** 지금 보여줄 칸. 덮는 구간이 없으면 평상이다 — 구간 사이의 빈틈도 평상이다. */
  frameOf(unit: UnitId): number {
    if (this.pv?.unit === unit) return this.previewWalking ? POSE.move : POSE.idle;
    const tr = this.tracks.get(unit);
    if (!tr) return POSE.idle;
    for (const seg of tr.segs) if (this.t >= seg.from && this.t < seg.until) return seg.frame;
    return POSE.idle;
  }

  /**
   * 이동 중 보여줄 칸 좌표. 이동 연출이 아니면 `null` — 그때는 권위 상태의 좌표를 쓴다.
   * **부드럽게 보간하지 않는다.** 한 칸에 STEP_MS 씩 머물다 다음 칸으로 뛴다.
   */
  cellOf(unit: UnitId): Vec2 | null {
    if (this.pv?.unit === unit) {
      const i = Math.min(this.pv.path.length - 1, Math.floor(this.pv.t / STEP_MS));
      return this.pv.path[i] ?? this.pv.to;
    }
    const tr = this.tracks.get(unit);
    if (!tr) return null;
    // 연출이 시작되기 전에는 **붙들어 둔 자리**(이동의 출발점)를 보여준다.
    // 권위 좌표는 이미 결과 자리라 이걸 빼면 먼저 새 버린다.
    if (tr.holdAt && tr.holdUntil !== undefined && this.t < tr.holdUntil) return tr.holdAt;
    if (!tr.path || tr.pathFrom === undefined) return null;
    const dt = this.t - tr.pathFrom;
    if (dt < 0 || dt >= tr.path.length * STEP_MS) return null;
    return tr.path[Math.floor(dt / STEP_MS)] ?? null;
  }

  /** 퇴각 점멸의 불투명도. 그 외에는 1. */
  alphaOf(unit: UnitId): number {
    const tr = this.tracks.get(unit);
    if (!tr?.dying || tr.dyingFrom === undefined) return 1;
    const dt = this.t - tr.dyingFrom;
    if (dt < 0) return 1;                                   // 아직 쓰러지기 전
    if (dt >= DIE_BLINK_MS * DIE_BLINKS) return 0;
    return Math.floor(dt / DIE_BLINK_MS) % 2 === 0 ? 1 : 0.15;
  }

  /** 쓰러졌지만 아직 점멸 중이라 화면에 남아 있어야 하는가. */
  isFading(unit: UnitId): boolean {
    const tr = this.tracks.get(unit);
    if (!tr?.dying || tr.dyingFrom === undefined) return false;
    return this.t < tr.dyingFrom + DIE_BLINK_MS * DIE_BLINKS;
  }

  /** 전투가 끝나거나 화면을 다시 세울 때. 모든 연출을 버린다. */
  clear(): void {
    this.tracks.clear();
    this.cam = EMPTY_TRACK;
    this.hp = [];
    this.sounds = [];
    this.soundCursor = 0;
    this.hide = [];
    this.reveal = [];
    this.timing = { start: [], effect: [] };
    this.settleFacing();      // 연출은 버려도 돌아선 쪽은 결과로 남긴다
    this.pv = null;
    this.t = 0;
  }
}
