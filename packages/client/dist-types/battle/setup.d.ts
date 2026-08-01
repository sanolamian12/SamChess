/**
 * 데모 편성 — 1차 확인용.
 *
 * 편성 화면(GDD §3.9의 「기물 편성」)은 아직 없으므로, 시드에서 결정적으로 뽑아 세운다.
 * 화면을 새로고침해도 같은 판이 나오므로 눈으로 비교하기 쉽다.
 */
import type { BattleState } from '@samchess/rules';
export declare function createDemoBattle(seed: number, mode?: '1v1' | '3v3' | '5v5'): BattleState;
export declare const officerIdsOf: (state: BattleState) => string[];
//# sourceMappingURL=setup.d.ts.map