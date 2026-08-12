/**
 * 카메라 연출 — 100% / 200% 포커스 (기획 pptx 28쪽)
 *
 * ```
 * 100%   판 전체가 화면에 들어가는 배율 (지금까지의 기본값)
 *          · 적군이나 아군이 이동할 때
 *          · 아군의 턴도 적군의 턴도 아닌 채 시간이 흐를 때
 * 200%   그 두 배
 *          · 공격 — **피격되는 대상**을 중심으로. 여럿이 맞으면 포커스를 옮겨 가며
 *          · 책략·명상 — **시전자**
 *          · 내 캐릭터의 차례가 되었을 때
 *          · 카드나 기물을 눌렀을 때 그 자리로
 * ```
 *
 * 「갑자기 한번에 조절하지 말고 부드럽게」가 28쪽의 마지막 줄이다. 그래서 목표만 정해
 * 두고 `CameraRig`가 매 프레임 지수 감쇠로 따라간다 — 트윈을 관리하지 않으므로
 * **연출 도중에 목표가 바뀌어도 끊기지 않고 방향만 바뀐다.** 다중 피격에서 포커스가
 * 대상 사이를 옮겨 다니는 것이 정확히 그 경우다.
 *
 * **이 파일은 Phaser를 부르지 않는다.** `poses.ts`가 Phaser를 모르는 것과 같은 이유다 —
 * 순수 계산이라 헤드리스로 시간표를 잴 수 있고, 눈으로는 부드러움을 검증할 수 없다.
 * 실제 카메라에 값을 넣는 일은 `BattleScene`이 한다.
 */

import type { Vec2 } from '@samchess/rules';
import { BOARD_H, BOARD_W, cellCenter } from './layout.ts';

/** 판 전체 (28쪽의 「100% 확대 비율」) */
export const SCALE_FIT = 1;
/**
 * 포커스 배율.
 *
 * 28쪽은 200%였는데 **2026-08-12에 300%로 올렸다** — 기획자가 눈으로 확인하려는 값이라
 * 되돌릴 수 있다. 여기 한 숫자만 고치면 되고, `camera.test.ts`가 배율을 이 상수로
 * 검증하므로 바꿔도 테스트가 따라온다.
 */
export const SCALE_FOCUS = 3;

/**
 * 언제부터 무엇을 볼지. `from`은 **연출 계획 전체 기준의 절대 시각(ms)** 이다 —
 * `PoseDirector`의 공용 커서와 같은 시계를 쓴다. 카메라만 따로 0에서 세면
 * 자세와 어긋나 "때리는 그림이 뜬 뒤에야 화면이 옮겨 가는" 일이 생긴다.
 */
export interface CameraCue {
  from: number;
  scale: number;
  /** 바라볼 칸. `null`이면 판 한가운데 */
  cell: Vec2 | null;
}

/** 카메라가 놓일 자리 — 월드 좌표와 배율 */
export interface View {
  zoom: number;
  x: number;
  y: number;
}

/**
 * 시각 → 큐. 큐는 시각 오름차순이고, 가장 최근 것이 지금 유효하다.
 *
 * 생성자 파라미터 프로퍼티(`constructor(private cues)`)를 쓰지 않는다 — 이 파일은
 * `poses.test.ts`가 **Node 타입 스트리핑으로 그대로 실행**하는데, 그 문법은 지원되지 않는다.
 */
export class CameraTrack {
  private readonly cues: readonly CameraCue[];

  constructor(cues: readonly CameraCue[] = []) {
    this.cues = cues;
  }

  get length(): number { return this.cues.length; }

  /** `t` 시점에 유효한 큐. 첫 큐보다 이르면 `null` — 그때는 화면이 알아서 정한다. */
  at(t: number): CameraCue | null {
    let found: CameraCue | null = null;
    for (const cue of this.cues) {
      if (cue.from > t) break;
      found = cue;
    }
    return found;
  }

  /** 테스트가 읽는다 — 계획된 큐 전부 */
  get all(): readonly CameraCue[] { return this.cues; }
}

export const EMPTY_TRACK = new CameraTrack();

/**
 * 큐를 실제 카메라 자리로 바꾼다.
 *
 * **화면이 판 밖으로 나가지 않게 가둔다.** 가장자리 기물을 200%로 비추면 절반이
 * 빈 공간이 되고, 좌표 눈금(첫 행·첫 열)도 함께 밀려 나가 읽을 수 없게 된다.
 * 배율이 낮아 판이 화면보다 작을 때는 가둘 것이 없으므로 한가운데에 둔다.
 *
 * @param fitZoom 판 전체가 들어가는 배율 (= 100%)
 */
export function viewOf(cue: CameraCue, fitZoom: number, viewW: number, viewH: number): View {
  const zoom = fitZoom * cue.scale;
  const center = cue.cell ? cellCenter(cue.cell.x, cue.cell.y) : { x: BOARD_W / 2, y: BOARD_H / 2 };
  return {
    zoom,
    x: clampAxis(center.x, viewW / zoom, BOARD_W),
    y: clampAxis(center.y, viewH / zoom, BOARD_H),
  };
}

function clampAxis(center: number, span: number, board: number): number {
  if (span >= board) return board / 2;        // 판이 화면보다 작다 — 가운데
  const half = span / 2;
  return Math.min(Math.max(center, half), board - half);
}

/** 1초 동안 목표까지 남은 거리의 이만큼을 좁힌다. 프레임률과 무관하게 같은 속도가 된다. */
const FOLLOW_PER_SEC = 0.95;
/** 이보다 가까우면 붙여 버린다 — 영원히 수렴만 하는 것을 막는다 */
const SNAP_PX = 0.5;
const SNAP_ZOOM = 1e-4;

/**
 * 목표를 향해 매 프레임 다가가는 카메라.
 *
 * 배율은 **로그 공간에서** 섞는다. 선형으로 섞으면 1→2가 2→1보다 느리게 느껴진다
 * (배율은 곱셈으로 인지되기 때문). 로그를 쓰면 양방향이 같은 속도가 된다.
 */
export class CameraRig {
  private view: View | null = null;
  private want: View | null = null;

  /** 이 자리를 향해 간다. 매 프레임 불러도 된다 — 목표만 갈아 끼운다. */
  target(view: View): void {
    this.want = view;
    this.view ??= { ...view };      // 첫 목표는 곧바로 그 자리에서 시작한다
  }

  /** 트윈 없이 바로 놓는다 (창 크기 변경·전투 시작 등) */
  snap(view: View): void {
    this.view = { ...view };
    this.want = { ...view };
  }

  /** 목표에 닿았는가. 스모크 테스트가 클릭 전에 이걸 기다린다. */
  get settled(): boolean {
    if (!this.view || !this.want) return true;
    return Math.abs(this.view.x - this.want.x) < SNAP_PX
      && Math.abs(this.view.y - this.want.y) < SNAP_PX
      && Math.abs(this.view.zoom - this.want.zoom) < SNAP_ZOOM * Math.max(1, this.want.zoom);
  }

  /** 매 프레임. 카메라에 넣을 값을 돌려준다. 목표가 없으면 `null`. */
  update(deltaMs: number): View | null {
    const view = this.view;
    const want = this.want;
    if (!view || !want) return null;
    if (this.settled) {
      this.view = { ...want };
      return this.view;
    }
    const k = 1 - (1 - FOLLOW_PER_SEC) ** (Math.max(0, deltaMs) / 1000);
    view.x += (want.x - view.x) * k;
    view.y += (want.y - view.y) * k;
    view.zoom = Math.exp(Math.log(view.zoom) + (Math.log(want.zoom) - Math.log(view.zoom)) * k);
    return view;
  }

  /** 지금 자리. 아직 목표를 받지 않았으면 `null`. */
  get current(): View | null { return this.view; }
}
