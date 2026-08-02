/**
 * 행동 바 — 제어 모달의 씨앗 (GDD §3.10)
 *
 * **버튼의 활성 여부를 클라이언트가 판단하지 않는다.** 전부 룰 엔진의 `validate()`에 묻는다.
 * 그래야 "화면에서는 눌리는데 서버가 거부하는" 어긋남이 생기지 않는다.
 *
 * DOM으로 만든 이유: Phaser 텍스트로 두면 카메라 줌에 함께 확대·축소되고,
 * 기술 스택상 UI는 원래 DOM(React) 담당이다. 2차에서 React로 옮겨도 이 계약은 그대로다.
 */

import { validate } from '@samchess/rules';
import type { BattleState, Intent, Side } from '@samchess/rules';

interface ActionDef {
  label: string;
  intent: Intent;
  /** 키보드 단축키 (event.code) */
  key?: string;
  hint: string;
}

const ACTIONS: ActionDef[] = [
  { label: '명상', intent: { t: 'meditate' }, key: 'KeyM', hint: 'MP +1 (M)' },
  { label: '턴 종료', intent: { t: 'endTurn' }, key: 'Space', hint: '행동 없이 넘긴다 (Space)' },
];

export class ActionBar {
  private root: HTMLElement;
  private buttons: { def: ActionDef; el: HTMLButtonElement }[] = [];
  private submit: (intent: Intent) => void;
  private lastKey = '';

  constructor(root: HTMLElement, submit: (intent: Intent) => void) {
    this.root = root;
    this.submit = submit;

    for (const def of ACTIONS) {
      const el = document.createElement('button');
      el.textContent = def.label;
      el.title = def.hint;
      el.addEventListener('click', () => this.submit(def.intent));
      root.appendChild(el);
      this.buttons.push({ def, el });
    }

    window.addEventListener('keydown', (e) => {
      const hit = this.buttons.find((b) => b.def.key === e.code);
      if (!hit || hit.el.disabled) return;
      e.preventDefault();
      this.submit(hit.def.intent);
    });
  }

  /**
   * 지금 무엇을 할 수 있는지 엔진에 물어 반영한다.
   * `canAct`가 false면(상대 차례·시간 진행 중) 전부 잠근다.
   */
  refresh(state: BattleState, side: Side | null, canAct: boolean): void {
    // 매 프레임 불리므로 실제로 바뀔 때만 DOM을 건드린다
    const key = `${canAct}|${side}|${state.activeUnit}|${JSON.stringify(state.activeTurn)}|${state.time}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    let any = false;
    for (const { def, el } of this.buttons) {
      const ok = canAct && side !== null && validate(state, side, def.intent).ok;
      el.disabled = !ok;
      any ||= ok;
    }
    this.root.classList.toggle('idle', !any);
  }
}
