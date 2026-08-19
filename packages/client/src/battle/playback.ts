/**
 * 이벤트 재생 레이어 — 판정 주체의 즉시 판정을 실시간 흐름으로 푼다.
 *
 * 룰 엔진의 `advanceTime()`은 다음 제어권까지 **한 번에 점프**한다.
 * 하지만 화면에서는 `time 100`이 실시간 1초에 걸쳐 흘러야 한다 (GDD §3.3).
 * 그 간극을 메우는 것이 이 층이다.
 *
 * ────────────────────────────────────────────────────────────────
 * **이 층은 상태를 만들지 않는다** ★ — 도착한 것을 소화할 뿐이다
 * ────────────────────────────────────────────────────────────────
 *
 * 예전에는 여기서 `apply()` · `advanceTime()` · `takeTurn()`을 직접 부르고
 * 마감 시각도 `Date.now()`로 스스로 찍었다 — 네 자리가 전부 온라인에서
 * 「서버가 보내 준다」로 바뀌는 것들이었다. 지금은 그 넷이
 * [`transport.ts`](./transport.ts)의 이음매 하나로 모여 있고, 이 층은
 *
 * 1. 받은 통을 **큐에 쌓았다가**
 * 2. 연출이 안 도는 동안 하나씩 꺼내 상태를 갈아 끼우고
 * 3. `displayTime`이 `state.time`을 **실시간 속도로 뒤쫓게** 하고
 * 4. 비면 「다음 것을 달라」(`ready()`)고 말한다
 *
 * 만 한다. **온라인이 붙어도 이 파일은 안 바뀐다** — 통을 채우는 쪽만 바뀐다.
 *
 * 상태는 두 갈래다.
 *  - `state`      판정 주체가 만든 **권위 상태**. 항상 최신이다.
 *  - `displayTime` 화면에 보여주는 절대시간. `state.time`을 실시간에 맞춰 뒤쫓는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 재진입을 막는 자리 — **받는 곳과 소화하는 곳을 가른다**
 * ────────────────────────────────────────────────────────────────
 *
 * 로컬 판정 주체는 **즉시** 답한다: `ready()`를 부르면 그것이 돌아오기 전에
 * 통이 이미 도착해 있다. 그래서 **콜백은 큐에 넣기만 하고** 꺼내는 것은
 * `pump()` 하나로 모았다.
 *
 * 잠금(`pumping`)은 그 위에 얹은 것인데, **순서를 지키는 것은 아니다** —
 * 잠금을 빼도 `소화 → ready() → 도착 → 소화`가 재귀로 파고들 뿐 꺼내는 차례는
 * 같다(실제로 빼고 회귀를 돌려 봤더니 전부 통과했다). 잠금이 막는 것은
 * **깊이**다: 없으면 스택이 판의 턴 수만큼 쌓인다. 검사로 잡히지 않는 종류라
 * 여기 적어 둔다 — 「도는 적이 없는 검사」를 만드는 대신 사실을 적는 쪽을 골랐다.
 */

import { TIME_PER_SECOND } from '@samchess/rules';
import type { BattleEvent, BattleState, Intent, Side } from '@samchess/rules';
import { applyWire } from './transport.ts';
import type { BattleTransport, RoomClose, ServerMsg } from './transport.ts';

/**
 * 상대가 뜸을 들이는 것처럼 보이는 시간. 없으면 상대 턴이 눈에 안 보이고 지나간다.
 *
 * **재생 쪽의 값이지 규칙이 아니다** — 사람이 상대면 진짜 걸리는 만큼 걸리고,
 * 그때 이 값은 「통이 오기 전 최소한 이만큼은 기다려 본다」로 읽힌다.
 */
const OPPONENT_PACE_MS = 350;

export type PlaybackPhase =
  /** 배치 — 내 진영 안에서 자리를 잡는다. 절대시간은 아직 0 */
  | 'deploying'
  /** 정찰 — 양측 기물을 살펴본다. 곧 전투가 시작된다 */
  | 'scouting'
  /** 절대시간이 흐르는 중 — displayTime이 state.time을 뒤쫓고 있다 */
  | 'advancing'
  /** 사람 차례. 입력을 기다린다 */
  | 'awaitingInput'
  /**
   * 내 차례가 아니다 — **상대의 수를 기다린다.**
   *
   * 이름은 AI 시절 그대로지만 뜻은 처음부터 「내가 둘 차례가 아니다」였다.
   * 사람이 상대일 때도 같은 자리이고, 화면은 이 둘을 구별할 이유가 없다.
   */
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

  /** 사람이 조작하는 진영. 나머지는 상대가 둔다. `null`이면 양쪽 다 관전. */
  readonly humanSide: Side | null;

  /**
   * 배치·정찰의 마감 시각 (실시간 ms). 그 단계가 아니면 `null`.
   *
   * **판정 주체가 「남은 ms」로 준 것을 제 시계에 얹은 값이다** — 절대시각을
   * 그대로 받으면 서버와 사람의 시계 어긋남이 카운트다운에 그대로 나온다
   * (`ServerMsg.deadlineInMs` 참조).
   */
  deadlineMs: number | null = null;

  /**
   * 방이 접혔다 — **성립하지 않은 판**이다 (배치 중 이탈 · 양쪽 이탈 · 양쪽 유휴).
   *
   * 엔진이 낸 결말이 아니므로 `state.winner`는 `null`이고, 화면은 전적도 보상도
   * 남기지 않고 **정산(환불)만** 한다. 오프라인에서는 언제나 `null`이다 —
   * 혼자 두는 판에는 사라질 상대도 접힐 방도 없다.
   */
  close: RoomClose | null = null;

  private readonly transport: BattleTransport;
  private readonly listener: PlaybackListener;
  private readonly now: () => number;

  /** 도착했지만 아직 안 꺼낸 통. **연출이 도는 동안 여기 쌓인다** */
  private readonly inbox: ServerMsg[] = [];
  /** `pump()` 재진입 잠금 (파일 머리 참조) */
  private pumping = false;
  /** 「다음 것을 달라」를 이미 말했는가. 통이 오면 풀린다 */
  private asked = false;
  /** 연출 때문에 미뤄 둔 걸음 결정이 있는가 (`settle()`) */
  private settlePending = false;

  private waitMs = 0;

  /**
   * 연출이 끝날 때까지 남은 시간(ms). 0보다 크면 **시간도 입력도 멈춘다.**
   *
   * `onChange` 안에서 화면이 `hold()`로 채운다 — 연출 계획을 세우는 쪽이 그 길이를
   * 알기 때문이다. 이 층은 몇 ms인지만 알면 되고 무엇을 그리는지는 모른다.
   * 온라인이 되어도 그대로다: 서버가 보낸 것을 사람이 읽을 속도로 늦추는 일은
   * 화면의 몫이고, 서버는 기다려 주지 않는다(통이 큐에 쌓일 뿐이다).
   */
  private holdMs = 0;

  constructor(transport: BattleTransport, listener: PlaybackListener, opts?: { now?: () => number }) {
    this.transport = transport;
    this.state = transport.initial;
    this.displayTime = transport.initial.time;
    this.humanSide = transport.humanSide;
    this.listener = listener;
    this.now = opts?.now ?? Date.now;
  }

  /**
   * 통을 받기 시작한다. **생성자에서 하지 않는 이유**: 곧바로 `onChange`가 불리는데,
   * 그 시점에는 호출자가 아직 이 인스턴스를 변수에 담지 못해 리스너 안에서
   * 자기 자신을 참조할 수 없다. 생성과 시작을 나눠 그 창을 없앤다.
   */
  start(): void {
    this.transport.open((msg) => { this.inbox.push(msg); this.pump(); });
    this.pump();
  }

  /** 남은 시간(초). 배치·정찰 단계에서만 값이 있다. */
  get remainingSec(): number | null {
    if (this.deadlineMs === null) return null;
    return Math.max(0, Math.ceil((this.deadlineMs - this.now()) / 1000));
  }

  /** 연출에 필요한 시간을 알린다. `onChange` 안에서 화면이 부른다. */
  hold(ms: number): void {
    if (ms > 0) this.holdMs = Math.max(this.holdMs, ms);
  }

  /** 연출이 도는 중인가. 화면이 입력을 막는 데 쓴다. */
  get busy(): boolean {
    return this.holdMs > 0;
  }

  /** 배치를 마쳤다고 선언한다. 시간이 다 되면 자동으로도 불린다. */
  submitReady(): void {
    if (this.phase !== 'deploying' || !this.humanSide) return;
    if (this.state.ready[this.humanSide]) return;
    this.submit({ t: 'ready' });
  }

  /** 정찰을 건너뛰고 전투를 시작한다. 시간이 다 되어도 같은 길로 온다. */
  beginBattle(): void {
    if (this.phase !== 'scouting') return;
    this.deadlineMs = null;
    this.request();
  }

  /**
   * 사람이 낸 의도를 보낸다. 낼 수 없는 때면 `false`.
   *
   * **예전에는 여기서 곧바로 `apply()`가 돌았다.** 지금은 판정 주체에게 보내고,
   * 로컬이면 그것이 돌아오기 전에 결과가 이미 도착해 있다(`LocalTransport`가
   * 즉시 답한다) — 그래서 「클릭 → 화면 갱신」이 한 프레임도 안 밀린다.
   *
   * > ⚠ **`false`를 조용히 삼키는 자리가 여기다** (GDD §12 미해결). 내 차례가
   * > 아닐 때 [항복]이 눌려도 아무 일이 없다 — 화면에 표시가 없어 「고장인가」가
   * > 남는다. 전투 UI를 손보는 세션이 가져간다.
   */
  submit(intent: Intent): boolean {
    const pre = this.phase === 'deploying' && (intent.t === 'deploy' || intent.t === 'ready');
    if (!pre && this.phase !== 'awaitingInput') return false;
    if (!this.humanSide) return false;
    if (this.holdMs > 0) return false;      // 연출이 도는 중에는 다음 수를 받지 않는다
    this.transport.send(intent);
    return true;
  }

  /** 매 프레임 호출한다. `deltaMs`는 실시간 경과. */
  update(deltaMs: number): void {
    if (this.phase === 'finished') return;

    // 연출 중에는 아무것도 진행하지 않는다 — 절대시간도, 마감 시계도.
    // **통은 그동안에도 도착한다.** 다 돌고 나면 쌓인 것부터 꺼낸다.
    if (this.holdMs > 0) {
      this.holdMs -= deltaMs;
      if (this.holdMs > 0) return;
      this.holdMs = 0;
      if (this.settlePending) { this.settlePending = false; this.settle(); }
      this.pump();
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
      // 따라잡았으면 그 자리에서 다음 걸음을 정한다
      if (this.displayTime >= this.state.time) this.settle();
      return;
    }

    if (this.phase === 'aiThinking') {
      this.waitMs -= deltaMs;
      if (this.waitMs <= 0) this.request();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 안쪽 — 큐를 꺼내고, 걸음을 정하고, 다음 것을 청한다
  // ═══════════════════════════════════════════════════════════════

  /**
   * 쌓인 통을 꺼내 소화한다 — **큐에서 꺼내는 유일한 자리.**
   *
   * 연출이 걸리면(`hold()`) 그 자리에서 멈춘다 — 남은 통은 큐에 그대로 있고
   * 연출이 끝나는 프레임에 다시 불린다. **한 판이 통째로 밀려들어도** 마찬가지다
   * (서버는 기다려 주지 않는다 — `test/transport.test.ts`의 `ScriptedTransport`).
   *
   * 잠금은 재귀 깊이를 막는 것이지 차례를 지키는 것이 아니다 (파일 머리 참조).
   */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.holdMs <= 0 && this.inbox.length > 0) {
        this.consume(this.inbox.shift()!);
      }
    } finally {
      this.pumping = false;
    }
  }

  /**
   * 통 하나를 상태에 반영한다.
   *
   * **`displayTime`은 건드리지 않는다** — 시계는 스스로 앞서지 않고 뒤쫓기만 한다.
   * 그래서 `state.time`이 점프해도 화면의 시계는 있던 자리에서 출발한다.
   */
  private consume(msg: ServerMsg): void {
    this.state = applyWire(this.state, msg);
    this.deadlineMs = msg.deadlineInMs === null ? null : this.now() + msg.deadlineInMs;
    this.asked = false;
    // **접힘은 마지막 통에 실려 온다.** 걸음을 정하기 전에 받아 둬야 `settle()`이 안다
    if (msg.close) this.close = msg.close;
    this.listener.onChange(this.state, msg.events);
    /*
     * **연출이 걸렸으면 걸음은 그것이 끝난 뒤에 정한다** ★
     *
     * 여기서 곧바로 정하면 「때리는 연출이 도는 2.6초」 동안 단계가 벌써
     * `advancing`이 된다 — 화면은 아무것도 안 흐르는데 「시간이 흐르는 중」이라고
     * 말하는 것이고, 실제로 WT 게이지가 멈춘 채 그 이름을 달고 있었다
     * (스모크가 「151.0 → 151.0」으로 잡았다).
     *
     * `phase`는 화면이 읽는 값이라 **거짓말을 하면 안 된다.** 옛 `stepOrHold()`가
     * 「연출이 걸려 있으면 그것이 끝난 뒤에 진행한다」였던 것과 같은 자리이고,
     * 여기서는 **진행이 아니라 「걸음 정하기」**를 미룬다.
     */
    if (this.holdMs > 0) { this.settlePending = true; return; }
    this.settle();
  }

  /**
   * 지금 상태에서 재생기가 어느 걸음에 있어야 하는지 정한다.
   *
   * **권위 상태의 단계 하나가 정한다** — 예전처럼 「어느 함수를 지나왔는가」로
   * 갈리지 않는다. 재접속으로 한복판 상태가 통째로 떨어져도 같은 답이 나와야 한다.
   */
  private settle(): void {
    // 방이 접혔으면 단계와 무관하게 끝이다 — 엔진은 아직 `deploy`일 수도 있다
    if (this.close) { this.phase = 'finished'; return; }
    switch (this.state.phase) {
      case 'deploy':
        this.phase = 'deploying';
        return;
      case 'waiting':
        // 상대의 준비를 기다린다 (GDD §3.9). **AI 상대에게는 나타나지 않는다**
        this.phase = 'aiThinking';
        this.waitMs = OPPONENT_PACE_MS;
        return;
      case 'scout':
        this.phase = 'scouting';
        return;
      case 'finished':
        this.phase = 'finished';
        return;
      case 'running':
        /*
         * 시간이 흐르는 중이다. 화면의 시계가 따라잡으면 다음 것을 청한다.
         *
         * **연출이 도는 중에도 청한다** — 받아 두는 것과 꺼내는 것은 다른 일이고,
         * 서버는 어차피 기다려 주지 않는다. 받은 것은 큐에서 제 차례를 기다린다.
         */
        this.phase = 'advancing';
        if (this.displayTime >= this.state.time) this.request();
        return;
      case 'control':
        if (this.displayTime < this.state.time) { this.phase = 'advancing'; return; }
        this.enterControl();
        return;
    }
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
      this.waitMs = OPPONENT_PACE_MS;
    }
  }

  /**
   * 「다음 것을 달라」 — **통이 하나 올 때까지 한 번만 말한다.**
   *
   * 온라인에서는 이 말이 아무것도 시키지 않는다(서버는 기다려 주지 않는다).
   * 그래도 부르는 것은, 로컬과 갈래를 두지 않기 위해서다 — 재생기는 저편이
   * 누구인지 모른다.
   */
  private request(): void {
    if (this.asked) return;
    this.asked = true;
    this.transport.ready();
  }
}
