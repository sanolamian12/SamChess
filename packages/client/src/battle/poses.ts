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

import type { BattleEvent, BattleState, UnitId, Vec2 } from '@samchess/rules';
import { VISUAL_EFFECTS } from '@samchess/data';
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
/** 부활 — 점멸이 **끝난 뒤** 새 자리에 나타나 이만큼 머문다 (조조 「화용도」) */
const REVIVE_MS = 900;

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
   * - **부활** — 맞자마자 부활 자리로 순간이동해 거기서 피격 점멸을 했다.
   */
  holdAt?: Vec2;
  holdUntil?: number;
  /** 부활이 끝나는 시각. 점멸의 끝(alpha 0)에 갇히지 않게 하는 데 쓴다 */
  revivedAt?: number;
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
    if (ev.e === 'tacticCast' || ev.e === 'uniqueSkillCast' || ev.e === 'attacked'
      || ev.e === 'moved' || ev.e === 'turnEnded' || ev.e === 'timeAdvanced') break;
    if ((ev.e === 'statusApplied' || ev.e === 'hpChanged' || ev.e === 'wtChanged'
      || ev.e === 'controlChanged') && ev.unit !== caster) out.add(ev.unit);
  }
  return [...out];
}

/**
 * `affected()`와 같은 구간을 훑되, **어느 상태가 걸렸는지**까지 골라낸다
 * (`targets`에 든 유닛만) — 새로 걸린 링을 `hitAt`까지 감추는 데 쓴다
 * (`HideCue` 참조).
 */
function statusesApplied(
  events: readonly BattleEvent[], from: number, targets: readonly UnitId[],
): { unit: UnitId; status: string }[] {
  const out: { unit: UnitId; status: string }[] = [];
  for (let i = from; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.e === 'tacticCast' || ev.e === 'uniqueSkillCast' || ev.e === 'attacked'
      || ev.e === 'moved' || ev.e === 'turnEnded' || ev.e === 'timeAdvanced') break;
    if (ev.e === 'statusApplied' && targets.includes(ev.unit)) out.push({ unit: ev.unit, status: ev.status });
  }
  return out;
}

/**
 * 「지금 이 시각에 무슨 소리를 낼 것인가」— 자세·카메라와 같은 공용 커서 위에 얹는다.
 *
 * **소리 자체는 여기서 안 정한다.** `k`만 사건의 종류를 말하고, 실제로 어떤 파일을
 * 트는지는 `BattleScene`이 안다(효과음이냐 성우 대사냐도 거기서 갈린다) — 이
 * 파일은 카메라·자세와 마찬가지로 Phaser도 오디오도 모른다(헤드리스로 검사할 수 있어야
 * 한다는 파일 머리말의 원칙과 같다).
 */
export type SoundCue =
  | { at: number; k: 'attackHit'; ev: Extract<BattleEvent, { e: 'attacked' }> }
  | { at: number; k: 'moveStart'; ev: Extract<BattleEvent, { e: 'moved' }> }
  | { at: number; k: 'castStart'; ev: Extract<BattleEvent, { e: 'tacticCast' }> }
  | { at: number; k: 'skillCastStart'; ev: Extract<BattleEvent, { e: 'uniqueSkillCast' }> }
  | { at: number; k: 'dieBlink'; ev: Extract<BattleEvent, { e: 'unitDied' }> };

/**
 * 「이 유닛의 이 링은 `until`까지 감춘다」— 책략이 성공한 순간(카메라가 대상에
 * 도착하고 피격 자세가 뜨는 그 시각) **전에는** 디버프 띠가 먼저 보이면 안 된다
 * (기획자 지적 2026-08-26). 상태 자체는 이미 `state`에 적용돼 있으므로(판정은
 * 끝났다), 화면이 그리는 쪽에서 그 시각까지 걸러야 한다 — HP가 `hpPending`으로
 * 「맞기 전 값」을 대신 보여주는 것과 같은 결이다.
 */
export interface HideCue { unit: UnitId; vfx: string; until: number }

export class PoseDirector {
  private tracks = new Map<UnitId, Track>();
  private cam = EMPTY_TRACK;
  private hp: HpCue[] = [];
  private t = 0;
  /** 재생 예정 소리 — 시각순으로 정렬돼 있다. `soundCursor`가 어디까지 냈는지 가리킨다 */
  private sounds: SoundCue[] = [];
  private soundCursor = 0;
  private hide: HideCue[] = [];

  /** 연출이 도는 중인가. 도는 동안은 입력도 시간도 멈춘다. */
  get busy(): boolean {
    for (const tr of this.tracks.values()) if (this.t < tr.end) return true;
    // 자세는 없고 게이지만 움직일 차례일 수도 있다 (도트 정산). 그것도 연출이다.
    for (const c of this.hp) if (this.t < c.at) return true;
    return false;
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
  plan(events: readonly BattleEvent[], state: BattleState): number {
    const next = new Map<UnitId, Track>();
    const cues: CameraCue[] = [];
    const hpCues: HpCue[] = [];
    const soundCues: SoundCue[] = [];
    const hideCues: HideCue[] = [];
    /** 이벤트가 순서대로 일어난 시각. 행동 하나가 끝나야 다음이 시작한다. */
    let cursor = 0;
    /**
     * 지금 진행 중인 행동에서 **피해가 눈에 보이는** 시각.
     *
     * 공격이면 피격 자세가 뜨는 순간, 책략이면 대상이 아파하는 두 번째 구간이다.
     * `hpChanged`는 그 행동 이벤트 **바로 뒤에** 붙어 오므로 이 값을 그대로 쓴다.
     */
    let hitAt = 0;

    /**
     * 부활한 유닛이 **쓰러진** 자리 (조조 「화용도」).
     *
     * `state`는 이미 적용이 끝난 상태라 `unit.pos`가 부활 자리다. 그대로 카메라를
     * 걸면 **맞기도 전에** 부활 자리를 비추고, 정작 공격과 피격은 화면 밖에서 일어난다
     * (기획자 지적 2026-08-13). 그래서 먼저 훑어 두고 `look()`이 이 값을 쓴다.
     */
    const diedAt = new Map<UnitId, Vec2>();
    for (const ev of events) if (ev.e === 'unitRevived') diedAt.set(ev.unit, ev.from);

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
    /**
     * @param at 비출 칸을 **직접** 지정한다. 이벤트가 좌표를 실어 보내는 경우
     *   (부활의 `at`)에 쓴다 — 권위 좌표를 되읽는 것보다 확실하다.
     */
    /** 마지막으로 놓은 큐 — 같은 자리를 다시 보라고 하면 기다릴 이유가 없다 */
    let lastCue: CameraCue | null = null;

    /**
     * 카메라 큐를 놓고, **자리가 달라졌으면 도착할 시간을 준다**(`CAM_LEAD_MS`).
     *
     * 커서를 밀기 때문에 **반드시 `show()`보다 먼저** 불러야 한다 — 순서가 뒤집히면
     * 자세가 이미 시작된 자리에 큐가 놓인다.
     */
    const look = (scale: number, unit?: UnitId, at?: Vec2): void => {
      // 부활한 유닛은 권위 좌표가 이미 **부활 자리**다. 그 앞의 공격·피격 큐는
      // **쓰러진 자리**를 봐야 한다 — 아니면 맞기도 전에 화면이 새 자리로 가 있고,
      // 정작 공격과 피격은 화면 밖에서 벌어진다 (기획자 지적 2026-08-13).
      const cell = at ?? (unit ? diedAt.get(unit) ?? state.units[unit]?.pos ?? null : null);
      const cue: CameraCue = { from: cursor, scale, cell: cell ? { ...cell } : null };
      const same = lastCue !== null && lastCue.scale === cue.scale
        && lastCue.cell?.x === cue.cell?.x && lastCue.cell?.y === cue.cell?.y;
      cues.push(cue);
      lastCue = cue;
      if (!same) cursor += CAM_LEAD_MS;
    };

    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      switch (ev.e) {
        case 'moved': {
          look(SCALE_FIT);            // 이동은 판 전체 — 어디서 어디로 갔는지가 보여야 한다
          // 발소리는 **줌아웃이 끝나고 실제로 걷기 시작하는 시각**에 튼다 — 이벤트가
          // 도착한 즉시 틀면 카메라가 아직 도착하지 않았는데 소리만 먼저 난다.
          soundCues.push({ at: cursor, k: 'moveStart', ev });
          const path = pathCells(ev.from, ev.to);
          const len = path.length * STEP_MS;
          const tr = track(ev.unit);
          tr.path = path;
          tr.pathFrom = cursor;       // 줌아웃이 끝난 **뒤에** 걷기 시작한다
          // 그 0.6초 동안은 **출발점**에 붙들어 둔다. 안 그러면 권위 좌표(도착지)에
          // 한 번 떴다가 걷기가 시작되며 출발점으로 되돌아간다.
          tr.holdAt = { ...ev.from };
          tr.holdUntil = cursor;
          show(ev.unit, 0, len, POSE.move);
          cursor += len;
          hitAt = cursor;             // 지형 피해는 도착하고 나서
          break;
        }

        case 'attacked': {
          // **피격되는 쪽**을 먼저 비춘다. 「장료지제」처럼 여럿이 맞으면 `attacked`가
          // 여러 번 나오고 커서가 그때마다 밀리므로, 포커스가 대상 사이를 옮겨 다닌다 (28쪽).
          // 줌인이 끝나고 나서 때리기 시작한다 (2026-08-13).
          look(SCALE_FOCUS, ev.target);
          const hold = ATTACK_FLASH_MS + ATTACK_GAP_MS;
          // **게이지는 피격 그림과 함께 줄어든다.** 예전에는 판정 순서 그대로
          // 게이지가 먼저 줄고 때리는 그림이 나중에 떴다 (기획자 지적 2026-08-13).
          hitAt = cursor + hold;
          // 피격음도 **같은 시각** — 실제로 맞는(피격 자세가 뜨는) 순간이다.
          // 이벤트가 도착한 즉시 틀면 카메라가 도착하기도 전에 소리만 먼저 난다
          // (기획자 지적 2026-08-26, 상대 턴에서만 도드라졌다 — 내 턴은 대개 카메라가
          // 이미 그 자리를 보고 있어 `CAM_LEAD_MS`가 안 붙었을 뿐이다).
          soundCues.push({ at: hitAt, k: 'attackHit', ev });
          show(ev.unit, 0, ATTACK_FLASH_MS, POSE.attack);
          show(ev.unit, hold, ATTACK_HOLD_MS, POSE.attack);
          // 대상은 **두 번째 공격 그림이 뜨는 동안** 피격을 띄운다.
          // 그 사이 시스템 대화창의 「누가 공격했다 · 크리티컬」을 읽게 된다.
          show(ev.target, hold, ATTACK_HOLD_MS, POSE.hurt);
          cursor += hold + ATTACK_HOLD_MS;
          break;
        }

        case 'tacticCast': {
          const targets = affected(events, i + 1, ev.unit)
            .filter((id) => state.units[id]?.side !== state.units[ev.unit]?.side);
          // 적에게 건 책략이 통했을 때만 두 번째 1초가 붙는다. 명상·자기 버프는 1초.
          const twice = !ev.resisted && targets.length > 0;
          const len = twice ? CAST_MS * 2 : CAST_MS;
          look(SCALE_FOCUS, ev.unit);   // 책략은 **시전자**를 비춘다 (28쪽). 줌인이 먼저다
          // 책략 소리는 **통하든 안 통하든** 시전을 시작하는 이 순간에 튼다
          // (기획자 지적 2026-08-26) — 성공 여부에 따라 갈리는 것은 소리가 아니라
          // 그 뒤에 오는 디버프 띠·포커싱·피격 자세다.
          soundCues.push({ at: cursor, k: 'castStart', ev });
          // 적에게 걸었으면 대상이 아파하는 두 번째 구간에, 자기 버프·회복이면
          // 시전이 끝나는 시점에 게이지가 움직인다
          hitAt = cursor + CAST_MS;
          show(ev.unit, 0, len, POSE.cast);
          // 걸렸으면 두 번째 1초에 **맞는 쪽**으로 옮겨 간다 (2026-08-12 기획자 지정) —
          // 피격 자세가 뜨는 구간이라, 무엇이 어떻게 됐는지는 거기서 보인다.
          //
          // **`look()`이 반드시 `show()`보다 먼저다** (기획자 지적 2026-08-26). 예전에는
          // 피격 자세를 시전자 구간이 끝나는 시각에 곧바로 얹고, 카메라 이동(`look`)은
          // 그 뒤에야 걸었다 — 그러면 피격 자세·디버프 띠가 카메라가 **도착하기 전**에
          // 이미 떠 있어 「맞는 게 먼저고 포커싱은 나중」으로 보인다. 다른 갈래(`moved`·
          // `attacked`)와 같은 순서로 맞췄다: 카메라부터 옮기고, **그 카메라가 실제로
          // 도착한 시각**(`look()`이 밀어 둔 새 `cursor`)에 자세를 놓는다.
          if (twice) {
            cursor += CAST_MS;
            look(SCALE_FOCUS, targets[0]!);
            hitAt = cursor;              // 카메라가 도착한 시각 = 실제로 「맞는」 시각
            for (const id of targets) show(id, 0, CAST_MS, POSE.hurt);
            // 새로 걸린 디버프 띠는 이 순간까지 감춘다 — 안 그러면 판정이 이미 끝난
            // `state`를 그대로 그리는 링이 카메라가 도착하기도 전에 먼저 보인다.
            for (const { unit, status } of statusesApplied(events, i + 1, targets)) {
              const vfx = VISUAL_EFFECTS.persistent.byStatus[status];
              if (vfx) hideCues.push({ unit, vfx, until: hitAt });
            }
            cursor += CAST_MS;
          } else {
            cursor += len;
          }
          break;
        }

        case 'uniqueSkillCast':
          // 자세는 평상이다 — 전용 배너(`ui/skillFx.ts`)가 판 전체를 덮으므로
          // 타일까지 바꿀 필요가 없다는 기획자 판단. 카메라는 시전자에 붙여 둔다:
          // 배너가 걷혔을 때 이미 그 자리를 보고 있어야 효과를 읽을 수 있다.
          look(SCALE_FOCUS, ev.unit);
          hitAt = cursor;
          soundCues.push({ at: cursor, k: 'skillCastStart', ev });
          break;

        case 'hpChanged':
          // **언제 눈에 보일지**만 적어 둔다. 얼마나 줄지는 이미 `unit.hp`에 반영돼
          // 있으므로, 화면은 아직 안 온 변화분을 도로 더해 「맞기 전 값」을 그린다.
          hpCues.push({ unit: ev.unit, at: hitAt, delta: ev.delta });
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

        case 'unitRevived': {
          // 조조 「화용도」 (기획자 지적 2026-08-13).
          //
          // 부활은 같은 묶음 안에서 `unitDied` 바로 뒤에 오고, 엔진은 그 자리에서
          // `unit.pos`를 부활 자리로 갈아 끼운다. 화면이 권위 좌표만 보면 **맞는 순간**
          // 부활 자리로 순간이동해 거기서 피격 점멸을 한다 — 순서가 거꾸로다.
          //
          // 그래서 점멸이 끝날 때까지 쓰러진 자리(`ev.from`)에 붙들어 두고,
          // 다 끝난 뒤에 새 자리에서 되살아난다.
          const tr = track(ev.unit);
          const blink = tr.dying ? DIE_BLINK_MS * DIE_BLINKS : 0;
          tr.holdAt = { ...ev.from };
          tr.holdUntil = cursor + blink;
          tr.revivedAt = cursor + blink;
          cursor += blink;
          // 커서를 민 **뒤에**, 그리고 이벤트가 준 `at`으로 걸어야 새 자리를 비춘다.
          // 이 큐 하나만 부활 자리를 보고, 앞선 공격·피격 큐는 쓰러진 자리를 본다.
          // `look()`이 카메라 도착 시간만큼 커서를 또 밀므로 `show()`는 그 뒤에 온다.
          look(SCALE_FOCUS, ev.unit, ev.at);
          show(ev.unit, 0, REVIVE_MS, POSE.idle);
          cursor += REVIVE_MS;
          hitAt = cursor;
          break;
        }

        default:
          break;
      }
    }

    // 「명상」은 이벤트가 `mpChanged` 하나뿐이라 위 switch 에 걸리지 않는다.
    // 책략과 같은 자리(제어권을 쥔 유닛의 행동)이므로 같은 칸을 같은 시간 보여준다.
    const active = state.activeUnit;
    if (active && !next.has(active)) {
      const meditated = events.some((e) => e.e === 'mpChanged' && e.unit === active
        && e.reason === 'meditate');
      if (meditated) {
        look(SCALE_FOCUS, active);    // 명상도 시전자를 비춘다 (28쪽). 줌인이 먼저다
        show(active, 0, CAST_MS, POSE.cast);
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
    this.t = 0;
    // HP 큐만 있고 자세가 없는 경우가 있다 — 도트 정산이 그렇다. 그때도 게이지가
    // 제때 움직이도록 그 시각까지는 계획이 살아 있어야 한다.
    const hpEnd = hpCues.length > 0 ? Math.max(...hpCues.map((c) => c.at)) : 0;
    if (next.size === 0) return 0;
    return Math.max(hpEnd, ...[...next.values()].map((tr) => tr.end));
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
  }

  /** 지금 보여줄 칸. 덮는 구간이 없으면 평상이다 — 구간 사이의 빈틈도 평상이다. */
  frameOf(unit: UnitId): number {
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
    const tr = this.tracks.get(unit);
    if (!tr) return null;
    // 연출이 시작되기 전에는 **붙들어 둔 자리**를 보여준다 — 이동이면 출발점,
    // 부활이면 쓰러진 자리다. 권위 좌표는 이미 결과 자리라 이걸 빼면 먼저 새 버린다.
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
    // 되살아난 뒤에는 다시 또렷하다 — 점멸의 끝(alpha 0)에 갇히면 안 된다
    if (tr.revivedAt !== undefined && this.t >= tr.revivedAt) return 1;
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
    this.t = 0;
  }
}
