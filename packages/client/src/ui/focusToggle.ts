/**
 * 자동 포커싱 토글 — 판 왼쪽 위의 반투명 버튼 (2026-08-12 기획자 지정)
 *
 * 카메라는 평소 스스로 움직인다(pptx 28쪽). 그런데 사용자가 휠이나 드래그로 화면을
 * 한 번 건드리면 **수동 모드**로 넘어가 자동 포커싱이 멎는다 — 직접 보고 있는 자리를
 * 화면이 제멋대로 뺏어 가면 안 되기 때문이다.
 *
 * 문제는 **되돌릴 길이 눈에 안 보인다**는 것이었다. `F` 키가 있었지만 휴대폰에는 키보드가
 * 없고, 무엇보다 「지금 수동이다」라는 사실 자체가 화면에 없었다. 그래서 상태와 통로를
 * 한 버튼으로 합쳤다.
 *
 * **글자는 「상태」가 아니라 「누르면 되는 것」이다.**
 *
 * | 지금 | 버튼 |
 * |---|---|
 * | 수동 (내가 화면을 잡고 있다) | `자동 포커싱 ON` — 누르면 자동으로 돌아간다 |
 * | 자동 | `자동 포커싱 OFF` — 누르면 화면을 내가 잡는다 |
 */

export class FocusToggle {
  private readonly el: HTMLButtonElement;
  private last: boolean | null = null;

  constructor(root: HTMLElement, onToggle: () => void) {
    root.replaceChildren();
    this.el = document.createElement('button');
    this.el.className = 'focus-toggle';
    this.el.dataset.action = 'toggleFocus';
    this.el.addEventListener('click', onToggle);
    root.appendChild(this.el);
  }

  /** @param manual 사용자가 화면을 직접 잡고 있는가 */
  refresh(manual: boolean): void {
    if (manual === this.last) return;
    this.last = manual;
    this.el.textContent = manual ? '자동 포커싱 ON' : '자동 포커싱 OFF';
    this.el.title = manual
      ? '카메라를 다시 자동으로 맡긴다 (F)'
      : '카메라를 직접 잡는다 — 휠로 확대, 끌어서 이동';
    // 수동일 때는 「돌아가는 길」이라 눈에 띄어야 하고, 자동일 때는 판을 방해하면 안 된다
    this.el.dataset.state = manual ? 'manual' : 'auto';
  }

  /** 스모크 테스트용 */
  get label(): string { return this.el.textContent ?? ''; }
}
