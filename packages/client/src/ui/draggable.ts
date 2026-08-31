/**
 * 플로팅 패널(`.panel`)을 손잡이 자리를 눌러 판 안에서 끌 수 있게 한다.
 *
 * PC는 마우스 좌클릭 프레스, 모바일은 손가락 프레스 — Pointer Events 하나로 둘 다
 * 받는다(마우스 전용 API를 따로 안 둔다). 손잡이는 **DOM 참조가 아니라 셀렉터**로
 * 받는다 — `InspectPanel`처럼 매 갱신마다 `replaceChildren()`으로 속을 통째로
 * 새로 그리는 패널은 손잡이 엘리먼트 자체가 계속 바뀌므로, 리스너는 안 바뀌는
 * `panel` 루트에 걸고 이벤트 위임(`closest(handleSelector)`)으로 손잡이를 고른다.
 *
 * 자리는 `panelSlot.ts`의 `applySlot()`이 `data-x`/`data-y`로 계속 정하는데,
 * 드래그로 자리를 옮기면 `dataset.dragged`를 세워 그 자동 배치를 멈춘다
 * (`applySlot()` 쪽에서 확인) — 안 멈추면 포커스가 바뀔 때마다 사용자가
 * 옮겨 둔 자리가 도로 튕겨 나간다. 손잡이를 두 번 누르면 자동 배치로 되돌아간다.
 */
export function makeDraggable(panel: HTMLElement, handleSelector: string): void {
  let dragging = false;
  let pointerId: number | null = null;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const isInteractive = (el: HTMLElement): boolean =>
    !!el.closest('button, a, input, select, textarea');

  panel.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.closest(handleSelector) || isInteractive(target)) return;
    const parent = panel.offsetParent as HTMLElement | null;
    if (!parent) return;
    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    startLeft = panelRect.left - parentRect.left;
    startTop = panelRect.top - parentRect.top;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
    dragging = true;
    pointerId = e.pointerId;
    panel.setPointerCapture(e.pointerId);
  });

  panel.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const parent = panel.offsetParent as HTMLElement | null;
    if (!parent) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    // 3px 미만은 드래그로 치지 않는다 — 손잡이의 버튼이 아닌 곳을 그냥 눌렀을 뿐인데
    // 위치가 px 단위로 흔들리며 「고정됐다」로 잡히는 것을 막는다
    if (!moved && Math.hypot(dx, dy) < 3) return;
    if (!moved) {
      moved = true;
      panel.classList.add('dragging');
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
    const parentRect = parent.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const maxLeft = Math.max(0, parentRect.width - panelRect.width);
    const maxTop = Math.max(0, parentRect.height - panelRect.height);
    panel.style.left = `${clamp(startLeft + dx, 0, maxLeft)}px`;
    panel.style.top = `${clamp(startTop + dy, 0, maxTop)}px`;
    e.preventDefault();
  });

  const endDrag = (e: PointerEvent): void => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    panel.classList.remove('dragging');
    if (moved) panel.dataset.dragged = 'true';
    if (panel.hasPointerCapture(e.pointerId)) panel.releasePointerCapture(e.pointerId);
  };
  panel.addEventListener('pointerup', endDrag);
  panel.addEventListener('pointercancel', endDrag);

  panel.addEventListener('dblclick', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest(handleSelector)) return;
    delete panel.dataset.dragged;
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
  });
}

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), Math.max(min, max));
