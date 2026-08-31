/**
 * 판 위에 뜨는 두 패널의 자리 — 커맨드 패널과 상태 팝업 (기획 pptx 28·29쪽)
 *
 * 29쪽 지시는 「패널 위치는 캐릭터 정보 패널의 위치와 대칭되도록, 좌상/우상/좌하/우하 중
 * 1곳에 위치」다. **무엇을 기준으로 고르는지는 적혀 있지 않아** 여기서 정했다(2026-08-12 확정):
 * **포커스된 기물을 가리지 않는 자리.**
 *
 * ```
 *   ┌─────────┬──────┬─────────┐   가로는 3/8 : 1/4 : 3/8 이라
 *   │  3/8    │ 1/4  │   3/8   │   가운데 1/4은 언제나 비어 있다
 *   │ 패널 A  │말풍선│ 패널 B  │   (시스템 대화 말풍선의 자리)
 *   └─────────┴──────┴─────────┘
 * ```
 *
 * 규칙은 둘이다.
 *
 * 1. **세로** — 기물이 있는 절반의 **반대쪽**에 붙인다. 패널 높이가 판의 0.6배라
 *    위에 붙이면 0~60%, 아래에 붙이면 40~100%를 덮는다. 반대쪽에 붙이면
 *    두 패널 **어느 쪽도 기물을 덮지 않는다** — 이게 이 규칙의 존재 이유다.
 * 2. **가로** — 커맨드는 기물의 반대쪽, 상태 팝업은 기물 쪽. 좌우 대칭이 되어
 *    29쪽의 「대칭되도록」을 만족하고, 손이 가는 커맨드가 기물에서 멀어진다.
 *
 * 세로 규칙이 이미 겹침을 막으므로 가로는 순전히 손이 닿는 자리를 고르는 문제다.
 */

import { FORMULA } from '@samchess/rules';
import type { Vec2 } from '@samchess/rules';

export interface Slot {
  x: 'left' | 'right';
  y: 'top' | 'bottom';
}

/**
 * 커맨드 패널이 설 자리. 상태 팝업은 `mirror()`로 뒤집은 자리에 선다.
 *
 * @param focus 포커스된 기물의 격자 좌표. 없으면 기본값(우하 — 29쪽 목업과 같다)
 */
export function commandSlot(focus: Vec2 | null | undefined): Slot {
  if (!focus) return { x: 'right', y: 'bottom' };
  return {
    // 기물이 위쪽 절반이면 아래에, 아래쪽 절반이면 위에 — 덮지 않는다
    y: focus.y < FORMULA.board.rows / 2 ? 'bottom' : 'top',
    // 기물이 왼쪽이면 오른쪽에 — 손이 기물 위를 지나지 않는다
    x: focus.x < FORMULA.board.cols / 2 ? 'right' : 'left',
  };
}

/** 좌우만 뒤집는다. 세로는 그대로 둔다 — 둘 다 기물 반대편이어야 하므로. */
export const mirror = (slot: Slot): Slot => ({ x: slot.x === 'left' ? 'right' : 'left', y: slot.y });

/** 자리를 DOM에 적는다. 실제 좌표는 `style.css`의 `[data-x]`/`[data-y]`가 잡는다. */
export function applySlot(el: HTMLElement, slot: Slot): void {
  // 사용자가 손으로 끌어 옮긴 패널(`draggable.ts`)은 자동 재배치를 멈춘다 —
  // 안 멈추면 포커스가 바뀔 때마다 방금 옮긴 자리가 도로 튕겨 나간다.
  // 손잡이를 두 번 눌러 `dragged`를 지우면 이 함수가 다시 움직인다.
  if (el.dataset.dragged === 'true') return;
  if (el.dataset.x !== slot.x) el.dataset.x = slot.x;
  if (el.dataset.y !== slot.y) el.dataset.y = slot.y;
}
