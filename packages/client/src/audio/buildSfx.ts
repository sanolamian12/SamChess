/**
 * 공사장 소리 — 도시 이름 짓기 화면에 내려앉는 순간 (2026-10-19 기획자 지정)
 *
 * 「도시를 세운다」 소리(`build_city`, 4.5초)를 바닥에 깔고, 그 위에 망치질(`hammar`)과 나무를 두드리는 짧은 소리
 * (`battle_command_click` · `battle_info_click`)를 **엇박자로** 여러 번 얹는다. 같은 소리가 같은 높이 · 같은 크기로
 * 되풀이되면 기계 소리로 들려서 하나하나 빠르기(높낮이)와 크기를 조금씩 흔든다.
 *
 * 박자표는 **정해 둔 값**이다(난수가 아니다) — 들을 때마다 같은 공사장이어야 고칠 때 비교할 수 있다. 흩어져 들리는 것은
 * 간격이 고르지 않아서다. 화면이 내려가면(`cancel`) 아직 안 난 소리는 거둔다.
 */

import { playSfx } from './sfx.ts';
import type { SfxId } from './sfx.ts';

/** [시각(ms), 소리, 크기 배율, 빠르기] */
const SCORE: readonly (readonly [number, SfxId, number, number])[] = [
  [0, 'build_city', 1, 1],
  [180, 'hammar', 0.75, 1.0],
  [520, 'battle_command_click', 0.9, 0.85],
  [760, 'battle_info_click', 0.6, 1.15],
  [1150, 'hammar', 0.55, 1.12],
  [1380, 'battle_command_click', 0.7, 1.1],
  [1620, 'battle_command_click', 0.5, 0.95],
  [2050, 'hammar', 0.8, 0.92],
  [2300, 'battle_info_click', 0.5, 0.9],
  [2740, 'battle_command_click', 0.8, 0.8],
  [3000, 'hammar', 0.6, 1.06],
  [3420, 'battle_info_click', 0.55, 1.2],
  [3650, 'battle_command_click', 0.6, 1.0],
  [3980, 'hammar', 0.45, 0.97],
];

/** 공사장 소리를 튼다. 돌려주는 함수를 부르면 아직 안 난 소리를 거둔다 */
export function playConstruction(): () => void {
  const timers = SCORE.map(([at, id, volume, rate]) =>
    window.setTimeout(() => playSfx(id, { volume, rate }), at));
  return () => timers.forEach((t) => window.clearTimeout(t));
}
