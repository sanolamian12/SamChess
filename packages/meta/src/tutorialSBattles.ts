/**
 * S급 튜토리얼 판 — 그 장수의 고유기술을 써 보는 판 (`Design/튜토리얼_시나리오_초안.md` §4, 2026-10-24~).
 *
 * 판 하나는 `tutorialS/{장수 id}.ts` 하나다 — 공통 손은 `tutorialS/common.ts`. 여기는 **모으기만** 한다.
 * 기본 튜토리얼과 같은 틀이다: 장수 · 자리 · 시작 값은 데이터에 고정, 시드 고정, 대본(`guide`)을 그대로 두면 이기는지
 * 회귀(`tutorialSBattles.test.ts`)가 판마다 본다. 대본이 끝난 차례는 모든 명령이 켜진다.
 * 여기 없는 장수의 판은 목록에서 「준비 중」이다(`tutorialReady`).
 */

import type { TutorialStage } from './tutorialBattles.ts';
import { joJo } from './tutorialS/jo-jo.ts';
import { yeoPo } from './tutorialS/yeo-po.ts';

/** 판이 선 S급 — 장수 id → 판. 여기 없으면 「준비 중」 */
export const S_STAGES: Readonly<Record<string, () => TutorialStage[]>> = {
  'jo-jo': joJo,
  'yeo-po': yeoPo,
};
