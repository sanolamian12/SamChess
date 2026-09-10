/**
 * 상단 HUD — 한 줄 (기획 pptx 27쪽)
 *
 * ```
 * 1.3일  [내 차례]  유봉 · Bishop        북군 SP 1  남군 SP 1   [⋯]
 * ```
 *
 * 27쪽 지시는 셋이다 — 「가장 상단에 절대시간(일수), 현재 차례 요약 텍스트」 ·
 * 「북군 SP와 남군 SP는 각각 **숫자로** 표시」 · 「시스템 대화창 히스토리 확인 버튼은
 * 오른쪽 상단으로」.
 *
 * **예전의 3층 HUD에서 두 층이 빠졌다.** SP 칸(pip)은 숫자로 바뀌었고, 고유기술 보유
 * 현황 줄은 **카드 스트립이 통째로 가져갔다**(`ui/cardStrip.ts`) — 카드마다 고유기술
 * 버튼이 색으로 상태를 알리므로 같은 것을 두 곳에서 그릴 이유가 없다.
 * 그만큼 얇아진 덕에 카드 스트립이 판 바로 위까지 올라온다.
 *
 * DOM으로 두는 이유는 그대로다 — Phaser 텍스트는 카메라 줌에 함께 확대·축소돼 읽을 수 없다.
 *
 * **판정은 하지 않는다.** 상태를 그대로 읽어 보여줄 뿐이다.
 */

import { officerById } from '@samchess/data';
import type { BattleState, Side } from '@samchess/rules';
import type { PlaybackPhase } from '../battle/playback.ts';
import { currentLang, t } from '../i18n/index.ts';
import { armyName, outcomeLabel } from '../i18n/engineLabel.ts';
import { pickOfficerName } from '../i18n/story.ts';

/**
 * 단계 이름. **화면 언어가 바뀌면 따라와야 하므로 상수 표가 아니라 함수다** —
 * 모듈이 처음 읽힐 때 굳혀 두면 언어를 바꿔도 「내 차례」가 한국어로 남는다.
 */
const phaseLabel = (phase: PlaybackPhase): string => t(`hud.phase.${phase}`);

export class Hud {
  private clockEl!: HTMLElement;
  private phaseEl!: HTMLElement;
  private whoEl!: HTMLElement;
  private outcomeEl!: HTMLElement;
  private spNum: Record<Side, HTMLElement> = {} as Record<Side, HTMLElement>;
  private last = '';

  constructor(
    private readonly root: HTMLElement,
    _state: BattleState,
    humanSide: Side | null,
    /** 「⋯」 — 시스템 대화 전체 기록을 연다. 「항복」은 그 안에 있다 (27쪽) */
    onHistory: () => void,
  ) {
    root.replaceChildren();
    const row = add(root, 'div', 'hud-top');

    this.clockEl = add(row, 'span', 'clock');
    this.phaseEl = add(row, 'span', 'phase');
    this.whoEl = add(row, 'span', 'who');
    this.outcomeEl = add(row, 'span', 'outcome');

    // SP는 숫자 둘. 코스트가 B4/A5/S6/E7이라 「몇 개 더 모으면 쓰나」가 바로 읽힌다.
    const sp = add(row, 'span', 'hud-sp');
    for (const side of ['P2', 'P1'] as Side[]) {          // 북군 먼저 — 판의 위아래와 같은 순서
      const cell = add(sp, 'span', `sp ${side.toLowerCase()}`);
      if (side === humanSide) cell.classList.add('mine');
      cell.appendChild(text('span', 'tag',
        armyName(side) + (side === humanSide ? t('battle.army.mine') : '')));
      this.spNum[side] = text('b', 'num', '0');
      cell.appendChild(this.spNum[side]);
    }

    const more = document.createElement('button');
    more.className = 'hud-more';
    more.textContent = '⋯';
    more.title = t('hud.more');
    more.dataset.action = 'history';
    more.addEventListener('click', onHistory);
    row.appendChild(more);
  }

  /**
   * 매 프레임 불린다. `displayTime`은 권위 상태의 `time`이 아니라 **화면이 따라잡은 시각**이다
   * (`Playback` 참조) — 시계가 실제로 흐르는 것처럼 보여야 하므로 이쪽을 쓴다.
   */
  refresh(state: BattleState, displayTime: number, phase: PlaybackPhase): void {
    // GDD §3.3 — UI는 0.1일(= time 10) 단위로 증가를 보여준다
    const day = (Math.floor(displayTime / 10) / 10).toFixed(1);
    const unit = state.activeUnit ? state.units[state.activeUnit] : undefined;
    const who = unit
      ? (() => {
          const officer = officerById.get(unit.officer);
          return `${officer ? pickOfficerName(officer) : unit.officer} · ${unit.piece}`;
        })()
      : '—';
    // 결말의 까닭도 **이름으로** 적는다 — 예전에는 `state.outcome`의 id(`kingDown`)가
    // 그대로 괄호 안에 들어갔다. 로그와 같은 표(`outcomeLabel`)를 쓴다.
    const outcome = state.phase === 'finished'
      ? (state.winner
          ? t('hud.win', { army: armyName(state.winner), how: outcomeLabel(state.outcome!) })
          : t('hud.draw'))
      : '';

    // 시계는 초당 10번 바뀐다. 실제로 글자가 달라질 때만 DOM을 건드린다.
    // **언어도 키에 넣는다** — 안 넣으면 언어를 바꿔도 같은 키라 DOM을 안 건드려
    // 단계 이름만 옛 언어로 남는다(값은 이미 바뀌었는데 화면이 안 따라온다).
    const key = `${day}|${phase}|${who}|${outcome}|${state.sp.P1}|${state.sp.P2}|${currentLang()}`;
    if (key === this.last) return;
    this.last = key;

    this.clockEl.textContent = t('hud.day', { days: day });
    this.phaseEl.textContent = phaseLabel(phase);
    this.phaseEl.className = `phase ${phase}`;
    this.whoEl.textContent = who;
    this.outcomeEl.textContent = outcome;
    this.root.classList.toggle('over', state.phase === 'finished');
    for (const side of ['P1', 'P2'] as Side[]) this.spNum[side]!.textContent = String(state.sp[side]);
  }
}

function add(parent: HTMLElement, tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

function text(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}
