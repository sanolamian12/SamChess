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

// ── 기획자 확정 타이밍 (2026-08-11) ──────────────────────────────
/** 이동 — 경로의 **칸마다** 이 시간씩 머문다. 부드럽게 미끄러지지 않고 한 칸씩 뛴다 */
const STEP_MS = 200;
/** 공격 — 0.2초 점멸 → 0.2초 평상 → 2초 공격. 마지막 2초에 대상이 피격을 띄운다 */
const ATTACK_FLASH_MS = 200;
const ATTACK_GAP_MS = 200;
const ATTACK_HOLD_MS = 2000;
/** 책략·명상 — 점멸 없이 1초. 적에게 건 책략이 성공하면 1초 더 */
const CAST_MS = 1000;
/** 퇴각 — 피격 칸을 0.4초 간격으로 3번 점멸한 뒤 사라진다 */
const DIE_BLINK_MS = 400;
const DIE_BLINKS = 3;

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

interface Track {
  segs: Seg[];
  end: number;
  /** 이동 경로와 그 시작 시각. 칸마다 STEP_MS 씩 머물며 좌표가 따라간다 */
  path?: Vec2[];
  pathFrom?: number;
  /** 퇴각 점멸. 있으면 alpha 가 깜빡이고 끝나면 사라진다 */
  dying?: boolean;
  dyingFrom?: number;
}

/**
 * `from`에서 `to`까지 지나는 칸들 (`from` 제외, `to` 포함).
 *
 * Rock·Bishop·Queen 은 경로형이라 직선 위의 칸을 하나씩 밟는다. Knight 는
 * 도약형이라 중간 칸이 없다 — 축이 어긋나면 한 번에 건너뛴 것으로 본다.
 */
function pathCells(from: Vec2, to: Vec2): Vec2[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const straight = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
  if (!straight) return [to];

  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
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

export class PoseDirector {
  private tracks = new Map<UnitId, Track>();
  private cam = EMPTY_TRACK;
  private t = 0;

  /** 연출이 도는 중인가. 도는 동안은 입력도 시간도 멈춘다. */
  get busy(): boolean {
    for (const tr of this.tracks.values()) if (this.t < tr.end) return true;
    return false;
  }

  /** 이번 계획의 카메라 큐 (pptx 28쪽). 씬이 `elapsed`와 함께 읽는다. */
  get camera(): CameraTrack { return this.cam; }

  /** 계획이 시작한 뒤 흐른 시간(ms) */
  get elapsed(): number { return this.t; }

  /**
   * 이벤트를 읽어 연출을 짠다. **필요한 시간(ms)** 을 돌려준다.
   *
   * 새 계획은 이전 것을 지운다 — 겹쳐 재생하지 않는다. `Playback`이 이 시간만큼
   * 기다려 주므로 겹칠 일이 원래 없지만, 항복·전투 종료처럼 중간에 끊는 길이 있다.
   */
  plan(events: readonly BattleEvent[], state: BattleState): number {
    const next = new Map<UnitId, Track>();
    const cues: CameraCue[] = [];
    /** 이벤트가 순서대로 일어난 시각. 행동 하나가 끝나야 다음이 시작한다. */
    let cursor = 0;

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
    const look = (scale: number, unit?: UnitId): void => {
      const cell = unit ? state.units[unit]?.pos ?? null : null;
      cues.push({ from: cursor, scale, cell: cell ? { ...cell } : null });
    };

    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      switch (ev.e) {
        case 'moved': {
          const path = pathCells(ev.from, ev.to);
          const len = path.length * STEP_MS;
          const tr = track(ev.unit);
          tr.path = path;
          tr.pathFrom = cursor;
          show(ev.unit, 0, len, POSE.move);
          look(SCALE_FIT);            // 이동은 판 전체 — 어디서 어디로 갔는지가 보여야 한다
          cursor += len;
          break;
        }

        case 'attacked': {
          const hold = ATTACK_FLASH_MS + ATTACK_GAP_MS;
          show(ev.unit, 0, ATTACK_FLASH_MS, POSE.attack);
          show(ev.unit, hold, ATTACK_HOLD_MS, POSE.attack);
          // 대상은 **두 번째 공격 그림이 뜨는 동안** 피격을 띄운다.
          // 그 사이 시스템 대화창의 「누가 공격했다 · 크리티컬」을 읽게 된다.
          show(ev.target, hold, ATTACK_HOLD_MS, POSE.hurt);
          // **피격되는 쪽**을 비춘다. 「장료지제」처럼 여럿이 맞으면 `attacked`가 여러 번
          // 나오고 커서가 그때마다 밀리므로, 포커스가 대상 사이를 옮겨 다닌다 (28쪽).
          look(SCALE_FOCUS, ev.target);
          cursor += hold + ATTACK_HOLD_MS;
          break;
        }

        case 'tacticCast': {
          const targets = affected(events, i + 1, ev.unit)
            .filter((id) => state.units[id]?.side !== state.units[ev.unit]?.side);
          // 적에게 건 책략이 통했을 때만 두 번째 1초가 붙는다. 명상·자기 버프는 1초.
          const twice = !ev.resisted && targets.length > 0;
          const len = twice ? CAST_MS * 2 : CAST_MS;
          show(ev.unit, 0, len, POSE.cast);
          if (twice) for (const id of targets) show(id, CAST_MS, CAST_MS, POSE.hurt);
          look(SCALE_FOCUS, ev.unit);   // 책략은 **시전자**를 비춘다 (28쪽)
          // 걸렸으면 두 번째 1초에 **맞는 쪽**으로 옮겨 간다 (2026-08-12 기획자 지정) —
          // 피격 자세가 뜨는 구간이라, 무엇이 어떻게 됐는지는 거기서 보인다.
          if (twice) {
            cursor += CAST_MS;
            look(SCALE_FOCUS, targets[0]!);
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
          break;

        case 'unitDied': {
          // 커서를 밀지 않는다 — 한 방에 둘이 쓰러지면 같이 점멸해야 한다.
          // 공격으로 죽은 경우는 커서가 이미 그 공격 뒤에 있어 자연히 이어진다.
          const tr = track(ev.unit);
          tr.dying = true;
          tr.dyingFrom = cursor;
          show(ev.unit, 0, DIE_BLINK_MS * DIE_BLINKS, POSE.hurt);
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
        show(active, 0, CAST_MS, POSE.cast);
        look(SCALE_FOCUS, active);    // 명상도 시전자를 비춘다 (28쪽)
      }
    }

    // 자세가 하나도 없어도 계획은 갈아 끼운다 — 고유기술처럼 **카메라 큐만 있는** 배치가
    // 있고(자세는 평상이다), 지난 계획을 남겨 두면 다 끝난 연출의 흔적이 그대로 남는다.
    this.tracks = next;
    this.cam = new CameraTrack(cues);
    this.t = 0;
    if (next.size === 0) return 0;
    return Math.max(...[...next.values()].map((tr) => tr.end));
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
    if (!tr?.path || tr.pathFrom === undefined) return null;
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
    this.t = 0;
  }
}
