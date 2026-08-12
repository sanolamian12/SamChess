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

/**
 * 전투 이전 단계의 실시간 제한 (GDD §3.9).
 *
 * **엔진은 시계를 갖지 않는다.** 절대시간(`time`)은 전투가 시작해야 흐르고, 배치·정찰은
 * 실시간이라 재는 주체가 따로 있어야 한다. 지금은 여기(클라이언트)가 재지만,
 * 온라인에서는 **서버가 마감 시각을 내려 주고** 이 층은 그 값을 받아 보여주기만 한다 —
 * 그래서 남은 시간을 세는 자리를 `deadlineMs` 하나로 몰아 뒀다.
 */
/**
 * 배치 30초 · 정찰 30초 (2026-08-04 기획자 조정).
 *
 * 원래는 배치 60초 · 정찰 20초였는데, **배치가 길면 판이 늘어진다.** 기물 몇 개를
 * 옮기는 데 1분은 과하고, 오히려 서로를 살펴보는 정찰이 짧았다. 둘을 30초로 맞췄다 —
 * 전투 이전 단계 전체는 그대로 1분이다.
 */
const DEPLOY_MS = 30_000;
const SCOUT_MS = 30_000;
/** 정찰은 끝까지 세되 **마지막 5초만** 카운트다운을 보여준다 (GDD §3.9) */
export const SCOUT_COUNTDOWN_MS = 5_000;

export type PlaybackPhase =
  /** 배치 — 내 진영 안에서 자리를 잡는다. 절대시간은 아직 0 */
  | 'deploying'
  /** 정찰 — 양측 기물을 살펴본다. 곧 전투가 시작된다 */
  | 'scouting'
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

  /**
   * 연출이 끝날 때까지 남은 시간(ms). 0보다 크면 **시간도 입력도 멈춘다.**
   *
   * `onChange` 안에서 화면이 `hold()`로 채운다 — 연출 계획을 세우는 쪽이 그 길이를
   * 알기 때문이다. 이 층은 몇 ms인지만 알면 되고 무엇을 그리는지는 모른다.
   * 온라인이 되어도 그대로다: 서버가 보낸 이벤트를 사람이 읽을 속도로 늦추는 일은
   * 화면의 몫이고, 서버는 기다려 주지 않는다(재생기가 뒤처질 뿐이다).
   */
  private holdMs = 0;
  /** 연출 때문에 미뤄 둔 `step()`이 있는가 */
  private stepPending = false;

  /**
   * 배치·정찰의 마감 시각 (실시간 ms). 그 단계가 아니면 `null`.
   *
   * **온라인에서는 서버가 이 값을 내려 준다.** 지금은 여기서 만들지만 읽는 쪽
   * (화면의 남은 시간 표시)은 그때도 그대로다 — `BattleState.controlStartedAtMs`를
   * 서버가 주입하기로 한 것과 같은 자리다.
   */
  deadlineMs: number | null = null;

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
    if (this.state.phase === 'deploy') { this.enterDeploy(); return; }
    if (this.state.phase === 'scout') { this.enterScout(); return; }
    this.step();
  }

  /** 남은 시간(초). 배치·정찰 단계에서만 값이 있다. */
  get remainingSec(): number | null {
    if (this.deadlineMs === null) return null;
    return Math.max(0, Math.ceil((this.deadlineMs - Date.now()) / 1000));
  }

  /**
   * 배치 단계에 들어간다.
   *
   * **상대(AI)는 곧바로 준비를 마친다.** 온라인이라면 여기가 「매칭 대기 최대 1분」
   * (GDD §3.9)이고 상대의 `ready`를 기다리는 자리인데, AI에게는 기다릴 것이 없다.
   * 그래서 `waiting` 단계는 엔진에도 화면에도 나타나지 않는다.
   */
  private enterDeploy(): void {
    this.phase = 'deploying';
    this.deadlineMs = Date.now() + DEPLOY_MS;
    for (const side of ['P1', 'P2'] as Side[]) {
      if (side === this.humanSide || this.state.ready[side]) continue;
      const result = apply(this.state, side, { t: 'ready' });
      this.state = result.state;
      this.listener.onChange(this.state, result.events);
    }
    // 관전(양쪽 AI)이면 이미 양쪽 준비가 끝나 정찰로 넘어가 있다
    if (this.state.phase === 'scout') this.enterScout();
  }

  private enterScout(): void {
    this.phase = 'scouting';
    this.deadlineMs = Date.now() + SCOUT_MS;
  }

  /** 정찰을 건너뛰고 전투를 시작한다. 시간이 다 되어도 같은 길로 온다. */
  beginBattle(): void {
    if (this.phase !== 'scouting') return;
    this.deadlineMs = null;
    this.step();
  }

  /** 연출에 필요한 시간을 알린다. `onChange` 안에서 화면이 부른다. */
  hold(ms: number): void {
    if (ms > 0) this.holdMs = Math.max(this.holdMs, ms);
  }

  /** 연출이 도는 중인가. 화면이 입력을 막는 데 쓴다. */
  get busy(): boolean {
    return this.holdMs > 0;
  }

  /** 매 프레임 호출한다. `deltaMs`는 실시간 경과. */
  update(deltaMs: number): void {
    if (this.phase === 'finished') return;

    // 연출 중에는 아무것도 진행하지 않는다 — 절대시간도, AI도, 마감 시계도.
    if (this.holdMs > 0) {
      this.holdMs -= deltaMs;
      if (this.holdMs > 0) return;
      this.holdMs = 0;
      if (this.stepPending) { this.stepPending = false; this.step(); }
      return;
    }

    // 배치·정찰은 실시간 제한이다 — 절대시간은 아직 흐르지 않는다
    if (this.phase === 'deploying') {
      if (this.remainingSec === 0) this.submitReady();
      return;
    }
    if (this.phase === 'scouting') {
      if (this.remainingSec === 0) this.beginBattle();
      return;
    }

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

  /** 배치를 마쳤다고 선언한다. 시간이 다 되면 자동으로도 불린다. */
  submitReady(): void {
    if (this.phase !== 'deploying' || !this.humanSide) return;
    if (this.state.ready[this.humanSide]) return;
    this.submit({ t: 'ready' });
  }

  /** 사람이 낸 의도를 적용한다. 유효하지 않으면 아무 일도 일어나지 않는다. */
  submit(intent: Intent): boolean {
    const pre = this.phase === 'deploying' && (intent.t === 'deploy' || intent.t === 'ready');
    if (!pre && this.phase !== 'awaitingInput') return false;
    if (!this.humanSide) return false;
    if (this.holdMs > 0) return false;      // 연출이 도는 중에는 다음 수를 받지 않는다

    const result = apply(this.state, this.humanSide, intent);
    this.state = result.state;
    this.listener.onChange(this.state, result.events);

    // 배치 단계 — 양쪽이 준비를 마치면 엔진이 정찰로 넘긴다
    if (pre) {
      if (this.state.phase === 'scout') this.enterScout();
      return true;
    }
    // 이동은 턴을 끝내지 않는다 — 계속 입력을 받는다
    if (this.state.phase === 'control') return true;
    this.stepOrHold();
    return true;
  }

  /** 연출이 걸려 있으면 그것이 끝난 뒤에 진행한다. */
  private stepOrHold(): void {
    if (this.holdMs > 0) { this.stepPending = true; return; }
    this.step();
  }

  /** 다음 제어권까지 진행시킨다. */
  private step(): void {
    this.deadlineMs = null;
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
    this.stepOrHold();
  }
}
