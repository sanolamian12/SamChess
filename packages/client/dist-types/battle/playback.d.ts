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
import type { BattleEvent, BattleState, Intent, Side } from '@samchess/rules';
/** 실시간 1초 = 절대시간 100 (GDD §3.3) */
export declare const TIME_PER_SECOND = 100;
export type PlaybackPhase = 
/** 절대시간이 흐르는 중 — displayTime이 state.time을 뒤쫓고 있다 */
'advancing'
/** 사람 차례. 입력을 기다린다 */
 | 'awaitingInput'
/** AI 차례. 잠깐 뜸을 들인 뒤 둔다 */
 | 'aiThinking' | 'finished';
export interface PlaybackListener {
    /** 상태가 바뀌었다 (행동 적용·제어권 이동 등). 화면을 다시 그린다. */
    onChange(state: BattleState, events: BattleEvent[]): void;
    /** 매 프레임 흐르는 시간. HUD의 시계용 */
    onTick(displayTime: number): void;
}
export declare class Playback {
    state: BattleState;
    displayTime: number;
    phase: PlaybackPhase;
    /** 사람이 조작하는 진영. 나머지는 AI가 둔다. `null`이면 양쪽 다 AI (관전). */
    readonly humanSide: Side | null;
    private waitMs;
    private listener;
    constructor(initial: BattleState, humanSide: Side | null, listener: PlaybackListener);
    /**
     * 첫 진행을 시작한다. **생성자에서 하지 않는 이유**: 곧바로 `onChange`가 불리는데,
     * 그 시점에는 호출자가 아직 이 인스턴스를 변수에 담지 못해 리스너 안에서
     * 자기 자신을 참조할 수 없다. 생성과 시작을 나눠 그 창을 없앤다.
     */
    start(): void;
    /** 매 프레임 호출한다. `deltaMs`는 실시간 경과. */
    update(deltaMs: number): void;
    /** 사람이 낸 의도를 적용한다. 유효하지 않으면 아무 일도 일어나지 않는다. */
    submit(intent: Intent): boolean;
    /** 다음 제어권까지 진행시킨다. */
    private step;
    private enterControl;
    private runAi;
}
//# sourceMappingURL=playback.d.ts.map