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

const PHASE_LABEL: Record<PlaybackPhase, string> = {
  deploying: '배치',
  scouting: '정찰',
  advancing: '시간 진행',
  awaitingInput: '내 차례',
  aiThinking: '상대 차례',
  finished: '종료',
};

/** 진영 이름 (2026-08-12 확정). 판이 P2를 위쪽 5행에 두므로 P2가 북군이다. */
export const ARMY_NAME: Record<Side, string> = { P2: '북군', P1: '남군' };

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
      cell.appendChild(text('span', 'tag', ARMY_NAME[side] + (side === humanSide ? '(나)' : '')));
      this.spNum[side] = text('b', 'num', '0');
      cell.appendChild(this.spNum[side]);
    }

    const more = document.createElement('button');
    more.className = 'hud-more';
    more.textContent = '⋯';
    more.title = '시스템 대화 기록 · 항복';
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
      ? `${officerById.get(unit.officer)?.name ?? unit.officer} · ${unit.piece}`
      : '—';
    const outcome = state.phase === 'finished'
      ? (state.winner ? `${ARMY_NAME[state.winner]} 승 (${state.outcome})` : '무승부')
      : '';

    // 시계는 초당 10번 바뀐다. 실제로 글자가 달라질 때만 DOM을 건드린다.
    const key = `${day}|${phase}|${who}|${outcome}|${state.sp.P1}|${state.sp.P2}`;
    if (key === this.last) return;
    this.last = key;

    this.clockEl.textContent = `${day}일`;
    this.phaseEl.textContent = PHASE_LABEL[phase];
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
