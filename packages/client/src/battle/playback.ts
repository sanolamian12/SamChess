/**
 * 이벤트 재생 레이어 — 엔진의 즉시 판정을 실시간 흐름으로 푼다.
 *
 * 룰 엔진의 `advanceTime()`은 다음 제어권까지 **한 번에 점프**한다.
 * 하지만 화면에서는 `time 100`이 실시간 1초에 걸쳐 흘러야 한다 (GDD §3.3).
 * 그 간극을 메우는 것이 이 층이다.
 *
 * **이 구조는 온라인 대전(HANDOFF §7 7번)이 요구하는 것과 같다.**
 * 서버가 권위 판정 후 `BattleEvent[]`를 브로드캐스트하면 클라이언트는 그걸 재생한다.
 * 지금 여기서 만드는 것이 그때 그대로 쓰인다 — 그래서 "AI 대전 만들기"가 아니라
 * "재생기 만들기"로 보는 편이 맞다.
 *
 * 상태는 두 갈래로 나뉜다.
 *  - `state`      엔진이 만든 **권위 상태**. 항상 최신이다.
 *  - `displayTime` 화면에 보여주는 절대시간. `state.time`을 실시간에 맞춰 뒤쫓는다.
 */

import { advanceTime, apply, isOver, takeTurn } from '@samchess/rules';
import type { BattleEvent, BattleState, Intent, Side } from '@samchess/rules';

/** 실시간 1초 = 절대시간 100 (GDD §3.3) */
export const TIME_PER_SECOND = 100;

/** AI가 생각하는 척하는 시간. 없으면 상대 턴이 눈에 안 보이고 지나간다. */
const AI_THINK_MS = 350;

export type PlaybackPhase =
  /** 절대시간이 흐르는 중 — displayTime이 state.time을 뒤쫓고 있다 */
  | 'advancing'
  /** 사람 차례. 입력을 기다린다 */
  | 'awaitingInput'
  /** AI 차례. 잠깐 뜸을 들인 뒤 둔다 */
  | 'aiThinking'
  | 'finished';

export interface PlaybackListener {
  /** 상태가 바뀌었다 (행동 적용·제어권 이동 등). 화면을 다시 그린다. */
  onChange(state: BattleState, events: BattleEvent[]): void;
  /** 매 프레임 흐르는 시간. HUD의 시계용 */
  onTick(displayTime: number): void;
}

export class Playback {
  state: BattleState;
  displayTime: number;
  phase: PlaybackPhase = 'advancing';

  /** 사람이 조작하는 진영. 나머지는 AI가 둔다. `null`이면 양쪽 다 AI (관전). */
  readonly humanSide: Side | null;

  private waitMs = 0;
  private listener: PlaybackListener;

  constructor(initial: BattleState, humanSide: Side | null, listener: PlaybackListener) {
    this.state = initial;
    this.displayTime = initial.time;
    this.humanSide = humanSide;
    this.listener = listener;
  }

  /**
   * 첫 진행을 시작한다. **생성자에서 하지 않는 이유**: 곧바로 `onChange`가 불리는데,
   * 그 시점에는 호출자가 아직 이 인스턴스를 변수에 담지 못해 리스너 안에서
   * 자기 자신을 참조할 수 없다. 생성과 시작을 나눠 그 창을 없앤다.
   */
  start(): void {
    this.step();
  }

  /** 매 프레임 호출한다. `deltaMs`는 실시간 경과. */
  update(deltaMs: number): void {
    if (this.phase === 'finished') return;

    if (this.phase === 'advancing') {
      // 절대시간을 실시간 속도로 흘린다. 프레임이 튀어도 목표를 넘지 않는다.
      const gained = (deltaMs / 1000) * TIME_PER_SECOND;
      this.displayTime = Math.min(this.state.time, this.displayTime + gained);
      this.listener.onTick(this.displayTime);
      if (this.displayTime >= this.state.time) this.enterControl();
      return;
    }

    if (this.phase === 'aiThinking') {
      this.waitMs -= deltaMs;
      if (this.waitMs <= 0) this.runAi();
    }
  }

  /** 사람이 낸 의도를 적용한다. 유효하지 않으면 아무 일도 일어나지 않는다. */
  submit(intent: Intent): boolean {
    if (this.phase !== 'awaitingInput' || !this.humanSide) return false;
    const result = apply(this.state, this.humanSide, intent);
    this.state = result.state;
    this.listener.onChange(this.state, result.events);

    // 이동은 턴을 끝내지 않는다 — 계속 입력을 받는다
    if (this.state.phase === 'control') return true;
    this.step();
    return true;
  }

  /** 다음 제어권까지 진행시킨다. */
  private step(): void {
    if (isOver(this.state)) {
      this.phase = 'finished';
      return;
    }
    const before = this.state.time;
    const result = advanceTime(this.state);
    this.state = result.state;
    this.listener.onChange(this.state, result.events);

    if (isOver(this.state)) {
      this.phase = 'finished';
      return;
    }
    // 시간이 흐르지 않았다면 곧바로 제어 단계로 (동시 행동 등)
    this.phase = 'advancing';
    this.displayTime = before;
    if (this.displayTime >= this.state.time) this.enterControl();
  }

  private enterControl(): void {
    this.displayTime = this.state.time;
    const unit = this.state.activeUnit ? this.state.units[this.state.activeUnit] : undefined;
    if (!unit) {
      this.phase = 'finished';
      return;
    }
    const commander = unit.control
      ? this.state.units[unit.control.by]?.side ?? unit.side
      : unit.side;

    if (commander === this.humanSide) {
      this.phase = 'awaitingInput';
    } else {
      this.phase = 'aiThinking';
      this.waitMs = AI_THINK_MS;
    }
  }

  private runAi(): void {
    const result = takeTurn(this.state);
    this.state = result.state;
    this.listener.onChange(this.state, result.events);
    this.step();
  }
}
