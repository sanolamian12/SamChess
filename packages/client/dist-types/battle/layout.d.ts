/**
 * 보드 레이아웃 상수.
 *
 * 셀을 96×120으로 잡으면 `25열 × 96 = 2400`, `20행 × 120 = 2400`이 되어
 * **보드 전체가 정확히 정사각형**이 된다. 초상화 원본(440×540)의 세로비도 그대로 유지된다.
 */
export declare const CELL_W = 96;
export declare const CELL_H = 120;
export declare const COLS: 25;
export declare const ROWS: 20;
export declare const BOARD_W: number;
export declare const BOARD_H: number;
/** 격자 좌표 → 셀 중심의 픽셀 좌표 */
export declare const cellCenter: (x: number, y: number) => {
    x: number;
    y: number;
};
/** 픽셀 좌표 → 격자 좌표. 보드 밖이면 null */
export declare function cellAt(px: number, py: number): {
    x: number;
    y: number;
} | null;
export declare const COLOR: {
    readonly boardLight: 2764084;
    readonly boardDark: 2303532;
    readonly grid: 3817287;
    readonly campP1: 1980975;
    readonly campP2: 3808804;
    readonly p1: 5153643;
    readonly p2: 12603983;
    readonly selected: 15779444;
    readonly moveHint: 5153643;
    readonly attackHint: 12603983;
    readonly hpFull: 6076508;
    readonly hpLow: 14242639;
    readonly mp: 6003669;
    readonly wt: 14540253;
};
//# sourceMappingURL=layout.d.ts.map