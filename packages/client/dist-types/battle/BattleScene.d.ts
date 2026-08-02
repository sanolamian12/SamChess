/**
 * 전투 씬 — 보드 · 유닛 타일 · 입력 (GDD §3.10)
 *
 * 1차 범위: 보드 + 초상화 타일 + HP 바 + 이동/공격 하이라이트.
 * 배지 4종 · MP/WT 바 · 상단 HUD · 제어 모달은 2차에서 붙인다.
 *
 * 이 씬은 **판정을 하지 않는다.** 클릭을 `Intent`로 바꿔 `Playback`에 넘길 뿐이고,
 * 무엇이 가능한지는 전부 룰 엔진에게 묻는다(`legalMovesFor` / `legalTargetsFor`).
 * 서버 권위 구조를 클라이언트에서도 그대로 지키기 위함이다.
 */
import Phaser from 'phaser';
import type { BattleState, Vec2 } from '@samchess/rules';
import { Playback } from './playback.ts';
export declare class BattleScene extends Phaser.Scene {
    private readonly makePlayback;
    private playback;
    /** 화면이 그리고 있는 상태. Playback이 갱신해 준다. */
    private state;
    private views;
    private hints;
    private selected;
    /** 상단 상태줄. Phaser 텍스트로 두면 카메라 줌에 함께 확대·축소돼 읽기 어렵다. */
    private statusEl;
    private actionBar;
    constructor(makePlayback: (scene: BattleScene) => Playback);
    preload(): void;
    create(): void;
    private lastPhase;
    update(_time: number, delta: number): void;
    private drawBoard;
    private setupCamera;
    private dragging;
    private createUnitView;
    /** 권위 상태를 화면에 반영한다. 상태가 바뀔 때마다 호출된다. */
    syncUnits(): void;
    private onClick;
    /** 이동 가능 칸(초록)과 공격 가능 대상(빨강)을 칠한다. */
    private drawHints;
    private refreshStatus;
    get debugPlayback(): Playback;
    /** 지금 활성 유닛의 이동 가능 칸. 씬이 하이라이트에 쓰는 것과 같은 경로다. */
    debugLegalMoves(): Vec2[];
    /** Playback이 상태를 바꿀 때마다 부른다. */
    onStateChanged(state: BattleState): void;
}
//# sourceMappingURL=BattleScene.d.ts.map