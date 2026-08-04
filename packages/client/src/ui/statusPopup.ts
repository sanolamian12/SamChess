/**
 * 상태이상 안내 팝업 — 버프/디버프 배지를 누르면 뜬다.
 *
 * 하단 패널의 넷째 줄과 정보 팝업이 같은 배지를 쓰고, 배지에는 이름만 들어간다.
 * "그게 무슨 뜻인가"는 여기서 읽는다.
 *
 * 이름·분류·설명은 전부 엔진의 `STATUS_META`가 출처다 — 화면이 상태 목록을 따로
 * 적어 두면 상태가 늘었을 때 조용히 어긋난다.
 */

import { STATUS_META } from '@samchess/rules';
import type { StatusId } from '@samchess/rules';

export class StatusPopup {
  constructor(private readonly root: HTMLElement) {
    root.replaceChildren();
    root.classList.add('hidden');
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.action === 'closeTip') this.hide();
    });
  }

  /** 상태이상 하나를 설명한다. `extra`는 남은 시간 같은 그때그때의 값. */
  show(status: StatusId, extra?: string): void {
    const meta = STATUS_META[status];
    this.render(meta.kind, meta.label, meta.desc, extra);
  }

  /**
   * 「조종」은 상태이상 배열이 아니라 `UnitState.control`에 들어간다 —
   * `STATUS_META`에 없으므로 설명을 직접 넘긴다.
   */
  showRaw(kind: 'buff' | 'debuff', label: string, desc: string, extra?: string): void {
    this.render(kind, label, desc, extra);
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.root.replaceChildren();
  }

  private render(kind: string, label: string, desc: string, extra?: string): void {
    const head = document.createElement('div');
    head.className = 'tip-head';
    const name = document.createElement('span');
    name.className = `tip-name ${kind}`;
    name.textContent = label;
    const close = document.createElement('button');
    close.className = 'tip-close';
    close.textContent = '×';
    close.dataset.action = 'closeTip';
    head.append(name, close);

    const body = document.createElement('div');
    body.className = 'tip-body';
    body.textContent = desc;

    this.root.replaceChildren(head, body);
    if (extra) {
      const tail = document.createElement('div');
      tail.className = 'tip-tail';
      tail.textContent = extra;
      this.root.appendChild(tail);
    }
    this.root.classList.remove('hidden');
  }
}
