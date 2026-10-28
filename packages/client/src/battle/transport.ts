/**
 * 전투의 **전송 이음매** — 상태를 만드는 쪽과 그리는 쪽 사이.
 *
 * ```
 *   [Playback]  ──의도──▶  [BattleTransport]  ──▶  판정 주체
 *        ◀──「이렇게 됐다」(ServerMsg)──          (로컬: 룰 엔진 · 온라인: 서버)
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 이음매가 필요한가 — **갈래가 넷이었다** ★
 * ────────────────────────────────────────────────────────────────
 *
 * `Playback`은 네 자리에서 **직접 상태를 만들고 있었다.**
 *
 * | | 예전 | 온라인 |
 * |---|---|---|
 * | 내 의도 | `apply()` 즉시 | 보내고 기다린다 |
 * | 상대 | `takeTurn()` (AI) | 서버가 보내 준다 |
 * | 시간 진행 | `advanceTime()` 즉시 | 서버가 보내 준다 |
 * | 마감 시각 | `Date.now() + 30초` | 서버가 준다 |
 *
 * 넷 다 온라인에서는 **「무언가가 도착한다」**로 바뀐다. 네 자리를 각각 갈아 끼우면
 * 갈래가 여덟이 되므로 하나로 모았다 — 그래서 재생기는 이제
 * **상태를 만들지 않고 「도착한 것」을 소화하기만 한다.**
 *
 * 「바뀌는 것은 상대가 사람인지뿐」(§5-32)이 화면 문구가 아니라 **코드에서** 성립하는
 * 자리이기도 하다. `LocalTransport`와 (앞으로) `OnlineTransport`는 같은 계약을 채우고,
 * 그 위의 재생기·씬·UI는 어느 쪽인지 모른다.
 *
 * ────────────────────────────────────────────────────────────────
 * 스냅샷에서 **로그를 뺀다** ★ — 전선의 `O(턴²)`
 * ────────────────────────────────────────────────────────────────
 *
 * 한 판을 끝까지 돌려 실제 값을 쟀다.
 *
 * | | 스냅샷(로그 제외) | 로그 포함 | 턴 |
 * |---|---:|---:|---:|
 * | 3v3 | **2,408 B** | 27,743 B | 48 |
 * | 5v5 | **3,705 B** | 55,089 B | 104 |
 *
 * 로그를 실으면 **한 통이 판 길이에 비례해 커진다** — 매 턴 보내므로 전선에서
 * `O(턴²)`다. `cloneState()`가 로그만 얕게 복사하는 그 지뢰(실측 90배)가
 * 네트워크에 다시 나타나는 것이고, 화면에는 「후반이 좀 버벅이네」로만 보인다.
 *
 * 뺀 로그는 받는 쪽이 **이벤트를 이어 붙여** 되만든다. 그게 정확히 같다는 것은
 * 엔진이 보장한다 — `commit()`이 `state.log.push(...events)` 하고 그 `events`를
 * 그대로 돌려주므로 **`이전 로그 ++ events === 다음 로그`**다. 회귀가 이 등식을
 * 전투 한 판 전체에서 고정한다 (`test/transport.test.ts`).
 *
 * > **이벤트만 보내고 받는 쪽이 상태를 재구성하는 길은 안 골랐다.** 이벤트에서
 * > 상태를 만드는 리듀서가 없고, 만들면 그게 `apply()`의 **두 번째 구현**이다.
 * > 스냅샷을 보내면 어긋남이 구조적으로 불가능하고, **재접속도 덤으로 풀린다** —
 * > 돌아온 사람에게는 지금 스냅샷 한 통이면 된다(이벤트만 보내는 설계였다면
 * > 로그 전체를 되보내야 했다).
 */

import { advanceTime, apply, eventsFor, takeTurn, toWire, validate } from '@samchess/rules';
import { SCOUT_MS, deployLimitMs } from '@samchess/rules';
import type { BattleEvent, BattlePhase, BattleState, Intent, ServerMsg, Side } from '@samchess/rules';
import type { BattleRewards } from '@samchess/meta';

/*
 * **전선 계약 자체는 `@samchess/rules`의 `wire.ts`로 올라갔다** (H2).
 * 서버가 생기면서 같은 모양을 양쪽이 알아야 해졌고, 한쪽에 두면 다른 쪽이 베껴
 * 적는다 — `timing.ts`와 같은 이유다. 여기서는 **쓰는 쪽**만 다시 내보낸다.
 */
export { applyWire, toWire } from '@samchess/rules';
export type { BattleStateWire, RoomClose, ServerMsg } from '@samchess/rules';

/**
 * 전투의 판정 주체와 이야기하는 통로.
 *
 * **재생기는 이 계약 너머를 모른다** — 룰 엔진이 같은 프로세스에 있는지,
 * 방 저편에 서버가 있는지.
 */
export interface BattleTransport {
  /** 시작 상태. 재생기가 첫 프레임을 그릴 때 필요해 **동기로** 들고 있다 */
  readonly initial: BattleState;
  /** 사람이 조작하는 진영. `null`이면 양쪽 다 맡기지 않는다(관전) */
  readonly humanSide: Side | null;
  /**
   * 관전일 때 **아군 자리에 그릴 진영** — 없으면 남군. 방어 기록의 리플레이(GDD §8.8 단계 5)는 방어자가 북군이라
   * 제 수비군을 아군 색으로 보려면 이것이 `P2`다. 조작과는 상관없다(누르는 단추는 `humanSide`가 정한다).
   */
  readonly viewSide?: Side;

  /** 받을 준비가 됐다. **첫 통(지금 상태와 마감)이 여기서 온다** */
  open(inbox: (msg: ServerMsg) => void): void;

  /** 사람이 낸 의도를 보낸다. 결과는 `inbox`로 돌아온다 */
  send(intent: Intent): void;

  /**
   * 「다음 것을 받을 준비가 됐다」 — 연출이 끝나고 재생기가 비었다.
   *
   * **이것을 보고 움직이는 것은 로컬뿐이다.** 서버는 기다려 주지 않으므로
   * 온라인에서는 아무 일도 하지 않는다 — 이 신호의 뜻은 「진행시켜 달라」가 아니라
   * **「나는 밀리지 않았다」**이고, 로컬은 판정 주체가 같은 프로세스에 있어
   * 그 말을 들어줄 수 있을 뿐이다.
   */
  ready(): void;

  close(): void;

  /**
   * 판이 승/패로 끝났다 — **서버가 이미 반영한 보상**을 기다린다 (H3d, `OnlineTransport`
   * 전용). `LocalTransport`(AI 대전)는 이 계약을 안 채운다 — AI 대전은 `settleAiBattle`이
   * 따로 부르는 재생 검증 경로를 쓴다. `undefined`면 「이 판정 주체는 이 일을 안 한다」고,
   * `null`이면 「기다렸지만 서버가 못 줬다」(타임아웃·서버 다운)다 — 둘 다 부르는
   * 쪽에서는 로컬 반영으로 물러난다는 점에서 같지만 뜻이 다르다.
   */
  waitForSettled?(timeoutMs: number): Promise<BattleRewards | null>;
}

/**
 * 단계별 실시간 제한 — **없으면 마감이 없다.**
 *
 * `control`이 빠져 있는 것은 일부러다: 제어 20초(`CONTROL_MS`)는 **상대를 기다리게
 * 하지 않기 위한** 값이라, 혼자 두는 판에서는 생각할 시간을 뺏을 뿐이다.
 * `waiting`도 마찬가지로 AI 상대에게는 나타나지 않는다.
 * 배치는 컬렉션 발동 장면을 앞에 붙인다(`deployLimitMs`) — 서버와 같은 함수다.
 */
function limitFor(state: BattleState): number | undefined {
  if (state.phase === 'deploy') return deployLimitMs(state);
  if (state.phase === 'scout') return SCOUT_MS;
  return undefined;
}

/**
 * 같은 프로세스에서 룰 엔진을 돌리는 판정 주체 — **AI 대전이 이걸 쓴다.**
 *
 * 서버를 흉내 내는 것이 아니라 **정말 판정을 한다** — 온라인 서버가 할 일을 그대로
 * 하되 주소가 여기일 뿐이다. 그래서 서버가 꺼져 있어도 AI 대전은 돈다.
 *
 * **온라인 서버와 다른 것 둘.**
 * - **즉시 답한다.** `send`/`ready`가 돌아오기 전에 `inbox`가 이미 불린다 —
 *   덕분에 「클릭 → 화면 갱신」이 예전과 한 프레임도 다르지 않다.
 * - **기다려 준다.** 진짜 서버는 재생기의 연출을 안 기다리지만, 여기서는
 *   `ready()`를 받을 때까지 다음 것을 만들지 않는다. 혼자 두는 판에서 시뮬레이션이
 *   연출을 앞질러 달릴 이유가 없다.
 */
export class LocalTransport implements BattleTransport {
  readonly initial: BattleState;
  readonly humanSide: Side | null;

  private state: BattleState;
  private inbox: ((msg: ServerMsg) => void) | null = null;
  private readonly now: () => number;
  /**
   * 사람이 낸 의도를 순서대로 쌓아 둔다 — AI 대전이 끝난 뒤 서버가 **같은 시드로
   * 재생**해 결과를 검증하는 데 쓰인다(`@samchess/rules`의 `replayLocalMatch`).
   * AI의 수·시간 진행은 결정적이라 다시 계산해 내면 되므로 여기 안 쌓는다.
   */
  private readonly intentLog: Intent[];
  /** 사람이 수를 낼 때마다 — 도적떼가 서버에 덧붙여 둔다(끊긴 자리에서 이어 두기, 2026-10-15) */
  private readonly onIntent: (() => void) | null;

  /** 지금 단계가 시작된 실시간. **통마다 새로 재면 마감이 되살아난다** */
  private phaseAt = 0;
  private phaseNow: BattlePhase | null = null;

  /** 상대가 늦게 준비하는 판(`?late=1`)의 기다림. `null`이면 곧바로 준비한다 */
  private readonly opponentReadyMs: number | null;
  /** 상대의 차례를 두는 것 — 기본은 기준 AI. 튜토리얼의 허수아비는 `idleTurn` */
  private readonly ai: (state: BattleState) => { state: BattleState; events: BattleEvent[] };
  private lateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    initial: BattleState,
    humanSide: Side | null,
    opts?: {
      now?: () => number; opponentReadyMs?: number;
      /** 되살린 판이면 그 판까지 낸 의도 — 기록의 앞부분이 된다(정산은 처음부터 재생한다) */
      intentLog?: readonly Intent[];
      onIntent?: () => void;
      /** 상대의 차례 (기본 `takeTurn`) — 튜토리얼 기본 1 · 2의 허수아비는 `idleTurn` */
      ai?: (state: BattleState) => { state: BattleState; events: BattleEvent[] };
    },
  ) {
    this.ai = opts?.ai ?? takeTurn;
    this.intentLog = [...(opts?.intentLog ?? [])];
    this.onIntent = opts?.onIntent ?? null;
    this.initial = initial;
    this.state = initial;
    this.humanSide = humanSide;
    this.now = opts?.now ?? Date.now;
    this.opponentReadyMs = opts?.opponentReadyMs ?? null;
  }

  open(inbox: (msg: ServerMsg) => void): void {
    this.inbox = inbox;
    // 첫 통 — 「지금 이렇고, 이만큼 남았다」. 온라인에서도 방에 들어가면 이게 온다
    this.emit([]);
    /*
     * **상대는 곧바로 준비를 마친다.** 온라인이라면 여기가 「매칭 대기 최대 1분」
     * (GDD §3.9)이고 상대의 `ready`를 기다리는 자리인데, AI에게는 기다릴 것이 없다.
     * 그래서 `waiting` 단계가 오프라인에서는 엔진에도 화면에도 나타나지 않는다.
     *
     * **판정 주체가 하는 일이다** — 예전에는 재생기가 상대 대신 `ready`를 냈다.
     *
     * 예외는 흉내 통로 `opponentReadyMs`(데모의 `?late=1`, 전투 UI 개편 8단계)다 — 상대가
     * **사람이 준비한 뒤** 그만큼 늦게 준비해 대기(`waiting`) 화면이 실제로 선다. 그 갈래는
     * 온라인 두 탭으로만 닿아 스모크가 한 번도 안 지나던 자리였다.
     */
    if (this.opponentReadyMs === null) this.readyOpponents();
  }

  private readyOpponents(): void {
    if (this.state.phase !== 'deploy') return;
    for (const side of ['P1', 'P2'] as Side[]) {
      if (side === this.humanSide || this.state.ready[side]) continue;
      this.run(() => apply(this.state, side, { t: 'ready' }));
    }
  }

  send(intent: Intent): void {
    const side = this.humanSide;
    if (!side) return;
    /*
     * **검증하고 적용한다** — 서버가 할 일 그대로다(GDD §10 「클라이언트는 의도만
     * 보낸다」). 다만 여기서 거부되는 것은 **우리 UI의 버그**다(「화면에 칠해진 칸 =
     * 엔진이 통과시킨 칸」이 계약이므로). 조용히 넘기면 「눌리는데 아무 일도 없다」가
     * 되므로 던진다 — 온라인의 「믿을 수 없는 클라를 거절한다」와는 다른 일이다.
     */
    const check = validate(this.state, side, intent);
    if (!check.ok) throw new Error(`거부된 의도(${side}, ${intent.t}): ${check.reason}`);
    this.intentLog.push(intent);
    this.run(() => apply(this.state, side, intent));
    this.onIntent?.();
    if (intent.t === 'ready' && this.opponentReadyMs !== null && this.lateTimer === null) {
      this.lateTimer = setTimeout(() => {
        if (this.inbox) this.readyOpponents();
      }, this.opponentReadyMs);
    }
  }

  /** 지금까지 사람이 낸 의도, 순서 그대로 — 서버 재생 검증에 실어 보낸다 */
  getIntentLog(): readonly Intent[] { return this.intentLog; }

  ready(): void {
    if (!this.inbox) return;
    /*
     * 다음 것을 만든다. **무엇을 만들지는 상태가 정한다** — 재생기가 「시간을
     * 진행시켜라」와 「상대의 수를 둬라」를 갈라 부르지 않는 이유다. 온라인에서는
     * 그 판단조차 서버 몫이라, 갈라 두면 재생기가 서버의 일을 알게 된다.
     */
    if (this.state.phase === 'control') {
      const unit = this.state.activeUnit ? this.state.units[this.state.activeUnit] : undefined;
      if (!unit) return;
      const commander = unit.control
        ? this.state.units[unit.control.by]?.side ?? unit.side
        : unit.side;
      if (commander === this.humanSide) return;   // 사람 차례다 — 기다린다
      this.run(() => this.ai(this.state));
      return;
    }
    if (this.state.phase === 'running' || this.state.phase === 'scout') {
      this.run(() => advanceTime(this.state));
    }
  }

  close(): void {
    this.inbox = null;
    if (this.lateTimer !== null) clearTimeout(this.lateTimer);
  }

  private run(step: () => { state: BattleState; events: BattleEvent[] }): void {
    const result = step();
    this.state = result.state;
    this.emit(result.events);
  }

  /** 한 통 보낸다. **마감은 단계가 바뀔 때만 다시 잰다** */
  private emit(events: BattleEvent[]): void {
    if (!this.inbox) return;
    if (this.state.phase !== this.phaseNow) {
      this.phaseNow = this.state.phase;
      this.phaseAt = this.now();
    }
    const limit = limitFor(this.state);
    const left = limit === undefined ? null : Math.max(0, limit - (this.now() - this.phaseAt));
    this.inbox({ t: 'sync', state: toWire(this.state, this.humanSide), events: this.humanSide ? eventsFor(this.state, events, this.humanSide) : events, deadlineInMs: left });
  }
}
