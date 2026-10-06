/**
 * 순서 판 — 위 칸 왼쪽 (전투 UI 개편 3단계, pptx 90·92쪽 · `docs/전투UI개편/설계.md` §1 · §3)
 *
 * ```
 *  1  King    곽가     차례   ●     ← 지금 차례: 들여쓰기 + 큰 글씨
 *  2  Rock    여몽     0.25일 ●
 * ```
 *
 * - 배치 · 정찰 중에는 **전원**을 두 열(1~5 · 6~10)로, 전투 중에는 **지금부터 5번째까지**.
 *   배치 중에는 위 칸 전체를 쓴다(게임 정보가 숨는다 — 90쪽 목업, 2026-10-06 기획자 확정).
 * - 순서는 엔진의 `turnForecast()`가 낸다 — 「다들 넘긴다」 가정이라 틀릴 수 있고,
 *   **상태가 바뀔 때마다 다시 부른다**(2026-09-27 기획자 확정). 화면이 순서를 셈하지 않는다.
 * - WT는 **매 프레임** 다시 적는다 — 예보 시각에 화면 지연(`state.time − displayTime`)을
 *   더한다. `advanceTime()`은 다음 제어권까지 한 번에 뛰므로, 안 더하면 숫자가 순간이동한다
 *   (옛 카드 줄 · 타일의 WT 게이지와 같은 보정).
 * - 표시등은 `skillStatus()` 다섯 값 그대로 `data-state`다(노랑 SP 부족 · 초록 준비 ·
 *   회색 사용 후 · 빨강 봉인 · 없음). 누르면 고유기술 설명 — 재생 없이 닫기만.
 * - **줄을 누르면 카메라가 그 장수에게 가고 살펴보기가 뜬다** (2026-10-06 기획자 확정) —
 *   옛 카드 줄의 「카드 → 카메라」(28쪽)를 이어받는다. 판정은 씬이 한다(`on.focus`).
 *
 * **판정은 하지 않는다.** 엔진이 낸 것을 그대로 그린다.
 */

import { combatantById, skillById } from '@samchess/data';
import { skillStatus, turnForecast } from '@samchess/rules';
import type { BattleState, Side, TurnSlot, UnitId } from '@samchess/rules';
import type { PlaybackPhase } from '../battle/playback.ts';
import { currentLang, t } from '../i18n/index.ts';
import { castDelayNote, pickOfficerName, pickSkillName, pickSkillText } from '../i18n/story.ts';
import type { StatusPopup } from './statusPopup.ts';

/** 전투 중 순서 판의 줄 수 (92쪽 「현재 차례부터 향후 5번째까지」) */
export const ORDER_BATTLE_ROWS = 5;

interface Row {
  slot: TurnSlot;
  root: HTMLElement;
  wt: HTMLElement;
  skill: HTMLButtonElement;
}

export interface OrderPanelHooks {
  /** 줄을 눌렀다 — 카메라 · 살펴보기는 씬이 정한다 */
  focus(unitId: UnitId): void;
}

export class OrderPanel {
  private readonly listEl: HTMLElement;
  private rows: Row[] = [];
  /** 예보를 다시 부르는 계기 — 상태 객체가 바뀌었거나 단계(배치/전투)가 바뀌었다 */
  private lastState: BattleState | null = null;
  private lastMode = '';
  private lastLang = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly tip: StatusPopup,
    private readonly humanSide: Side | null,
    private readonly on: OrderPanelHooks,
  ) {
    root.replaceChildren();
    const head = document.createElement('div');
    head.className = 'ord-head';
    head.textContent = t('hud.order.title');
    this.listEl = document.createElement('div');
    this.listEl.className = 'ord-list';
    root.append(head, this.listEl);
  }

  /**
   * 매 프레임 불린다. 예보는 상태가 바뀔 때만 다시 부르고, 그 사이에는 WT 글자만 고친다.
   *
   * @param focused 지금 카메라가 붙어 있는(줄로 고른) 장수 — 그 줄에 테를 두른다
   * @param flash   반짝일 장수 — 주사위 쪽지가 떠 있는 동안 동점 무리 (설계 §5-1 끝)
   */
  refresh(
    state: BattleState, displayTime: number, phase: PlaybackPhase,
    focused: UnitId | null, flash: ReadonlySet<UnitId>,
  ): void {
    const deploy = phase === 'deploying' || phase === 'scouting';
    const mode = deploy ? 'deploy' : 'battle';
    if (state !== this.lastState || mode !== this.lastMode || currentLang() !== this.lastLang) {
      this.lastState = state;
      this.lastMode = mode;
      this.lastLang = currentLang();
      this.root.dataset.mode = mode;
      const count = deploy ? Object.values(state.units).filter((u) => u.alive).length : ORDER_BATTLE_ROWS;
      this.rebuild(state, turnForecast(state, count));
    }

    const lag = Math.max(0, state.time - displayTime);
    for (const row of this.rows) {
      const { slot } = row;
      // 지금 차례 줄은 「차례」. 나머지는 일 단위, 소수 둘째 자리 (2026-09-27 기획자 확정)
      const text = slot.active ? t('card.wait.turn')
        : t('card.wait.days', { days: ((slot.at + lag) / 100).toFixed(2) });
      if (row.wt.textContent !== text) row.wt.textContent = text;
      row.root.classList.toggle('focused', focused === slot.unit);
      row.root.classList.toggle('flash', flash.has(slot.unit));
    }
  }

  private rebuild(state: BattleState, slots: TurnSlot[]): void {
    this.rows = slots.map((slot, i) => this.row(state, slot, i + 1));
    this.listEl.replaceChildren(...this.rows.map((r) => r.root));
  }

  private row(state: BattleState, slot: TurnSlot, n: number): Row {
    const unit = state.units[slot.unit]!;
    const officer = combatantById.get(unit.officer);
    const skill = officer?.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;
    // 사람 쪽이 없으면(관전 · 데모) 남군을 아군 색으로 — 판의 아래쪽이 남군이다
    const mine = slot.side === (this.humanSide ?? 'P1');

    const root = document.createElement('div');
    root.className = 'ord-row';
    root.dataset.unit = slot.unit;
    root.dataset.side = mine ? 'mine' : 'foe';
    if (slot.active) root.dataset.active = '1';
    root.title = officer ? pickOfficerName(officer) : unit.officer;

    root.append(
      span('ord-n', String(n)),
      span('ord-pc', unit.piece),
      span('ord-name', officer ? pickOfficerName(officer) : unit.officer),
    );
    const wt = span('ord-wt', '');
    root.appendChild(wt);

    const status = skillStatus(state, slot.unit);
    const button = document.createElement('button');
    button.className = 'ord-skill';
    button.dataset.state = status;
    button.disabled = !skill;
    if (skill) {
      button.title = `${pickSkillName(skill)} (${skill.spCost})`;
      button.addEventListener('click', (e) => {
        e.stopPropagation();          // 줄의 카메라 이동과 겹치지 않게
        const tail = { hanja: skill.hanja, sp: skill.spCost, delay: castDelayNote(skill) };
        this.tip.showRaw('skill', `「${pickSkillName(skill)}」`, pickSkillText(skill),
          t(status === 'sealed' ? 'ins.skillTail.sealed'
            : status === 'used' ? 'ins.skillTail.used' : 'ins.skillTail', tail));
      });
    }
    root.appendChild(button);
    root.addEventListener('click', () => this.on.focus(slot.unit));
    return { slot, root, wt, skill: button };
  }

  /** 순서 판이 실제로 그린 것 — 스모크가 엔진의 예보와 맞춘다 */
  debugRows(): { unit: string; side: string; active: boolean; wt: string; skill: string }[] {
    return this.rows.map((r) => ({
      unit: r.slot.unit,
      side: r.root.dataset.side ?? '',
      active: r.slot.active,
      wt: r.wt.textContent ?? '',
      skill: r.skill.dataset.state ?? '',
    }));
  }
}

function span(className: string, text: string): HTMLElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}
