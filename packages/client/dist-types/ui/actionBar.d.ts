/**
 * 행동 바 — 제어 모달의 씨앗 (GDD §3.10)
 *
 * **버튼의 활성 여부를 클라이언트가 판단하지 않는다.** 전부 룰 엔진의 `validate()`에 묻는다.
 * 그래야 "화면에서는 눌리는데 서버가 거부하는" 어긋남이 생기지 않는다.
 *
 * DOM으로 만든 이유: Phaser 텍스트로 두면 카메라 줌에 함께 확대·축소되고,
 * 기술 스택상 UI는 원래 DOM(React) 담당이다. 2차에서 React로 옮겨도 이 계약은 그대로다.
 */
import type { BattleState, Intent, Side } from '@samchess/rules';
export declare class ActionBar {
    private root;
    private buttons;
    private submit;
    private lastKey;
    constructor(root: HTMLElement, submit: (intent: Intent) => void);
    /**
     * 지금 무엇을 할 수 있는지 엔진에 물어 반영한다.
     * `canAct`가 false면(상대 차례·시간 진행 중) 전부 잠근다.
     */
    refresh(state: BattleState, side: Side | null, canAct: boolean): void;
}
//# sourceMappingURL=actionBar.d.ts.map