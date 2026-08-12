/**
 * 설명 팝업 — 눌러서 뜻을 보는 것 전부가 여기로 온다.
 *
 * 버프/디버프 배지(상태 팝업·카드), **고유기술**, **책략**이 같은 창을 쓴다 —
 * 기획 pptx 28쪽이 셋 다 「클릭을 하면 설명 보여줌」으로 같은 조작을 지정했다.
 * 휴대폰에는 호버가 없어 누르는 쪽이 본체다.
 *
 * 상태이상의 이름·분류·설명은 엔진의 `STATUS_META`가 출처다 — 화면이 상태 목록을 따로
 * 적어 두면 상태가 늘었을 때 조용히 어긋난다.
 */

import { STATUS_META } from '@samchess/rules';
import type { StatusId } from '@samchess/rules';

/** 창의 색조. 상태이상은 버프/디버프, 그 밖은 무엇을 설명하는지에 따른다. */
export type TipKind = 'buff' | 'debuff' | 'skill' | 'tactic';

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
   * `STATUS_META`에 없는 것을 설명한다 — 「조종」(상태 배열이 아니라 `UnitState.control`에
   * 들어간다) · 고유기술 · 책략.
   */
  showRaw(kind: TipKind, label: string, desc: string, extra?: string): void {
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
