/**
 * 게임 정보 — 위 칸 오른쪽 (전투 UI 개편 3단계, pptx 93쪽 · `docs/전투UI개편/설계.md` §1)
 *
 * ```
 * 전투 1.2일차
 * 북군 SP 3        턴오버 0
 * 남군(나) SP 1    턴오버 2
 * 남은 시간 15초                ← AI 대전은 「-」
 * [ 항복 ]  /  [ 턴 가져오기 ]          [⋯]
 * ```
 *
 * 옛 상단 HUD(`ui/hud.ts`, pptx 27쪽)를 갈음한다. 단계 이름(내 차례/상대 차례)과
 * 「누구 · 기물」은 빠졌다 — 순서 판의 첫 줄이 같은 것을 보여 준다.
 *
 * - SP는 **정수**(2026-09-27 기획자 확정 9). 턴오버 = `state.skips[side]` — 그 진영이
 *   상대의 차례를 가져온 횟수다. 세는 곳은 엔진 하나다.
 * - 남은 시간은 **판정 주체가 실어 보낸 값**(`Playback.remainingSec`)이다 — 화면이 20초를
 *   다시 재지 않는다. AI 대전에는 제어 마감이 없어 `null`이고 「-」로 적는다(확정 8).
 * - 단추 하나가 자리를 바꾼다: 내 차례엔 [항복], 그 밖엔 [턴 가져오기](= `forceSkipTurn`).
 *   [턴 가져오기]는 상대 차례에 마감이 0이 되고 엔진이 허락할 때만 켜진다 — 규칙 변경 없이
 *   이름과 자리만 바뀌었다(예전엔 커맨드 패널의 「턴 넘기기」). AI 대전에서는 언제나 꺼져 있다.
 * - [항복]은 전투 기록(`#history`) 안에서 여기로 나왔다(설계 확정 7).
 * - ⋯(기록)은 6단계에서 판 왼쪽 위의 [...]로 갔다(`ui/systemLog.ts`).
 *
 * **판정은 하지 않는다.** 켜짐은 엔진(`validate`)과 판정 주체(마감)가 정한다.
 */

import { validate, SKIP_TO_WIN } from '@samchess/rules';
import type { BattleState, Side } from '@samchess/rules';
import type { PlaybackPhase } from '../battle/playback.ts';
import { currentLang, t } from '../i18n/index.ts';
import { armyName } from '../i18n/engineLabel.ts';

export interface GameInfoHooks {
  surrender(): void;
  takeTurn(): void;
}

export class GameInfo {
  private readonly dayEl: HTMLElement;
  private readonly spEl: Record<Side, HTMLElement>;
  private readonly skipEl: Record<Side, HTMLElement>;
  private readonly leftEl: HTMLElement;
  private readonly actBtn: HTMLButtonElement | null;
  private last = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly humanSide: Side | null,
    on: GameInfoHooks,
  ) {
    root.replaceChildren();
    this.dayEl = add(root, 'div', 'gi-day');

    const sides = add(root, 'div', 'gi-sides');
    this.spEl = {} as Record<Side, HTMLElement>;
    this.skipEl = {} as Record<Side, HTMLElement>;
    for (const side of ['P2', 'P1'] as Side[]) {       // 북군 먼저 — 판의 위아래와 같은 순서
      const line = add(sides, 'div', `gi-side ${side.toLowerCase()}`);
      line.dataset.side = side;
      if (side === humanSide) line.classList.add('mine');
      add(line, 'span', 'gi-army').textContent =
        armyName(side) + (side === humanSide ? t('battle.army.mine') : '');
      const sp = add(line, 'span', 'gi-sp');
      add(sp, 'i', '').textContent = 'SP';
      this.spEl[side] = add(sp, 'b', 'num');
      const skip = add(line, 'span', 'gi-skip');
      add(skip, 'i', '').textContent = t('hud.info.skips');
      this.skipEl[side] = add(skip, 'b', 'num');
    }

    const left = add(root, 'div', 'gi-left');
    add(left, 'i', '').textContent = t('hud.info.left');
    this.leftEl = add(left, 'b', 'num');

    const foot = add(root, 'div', 'gi-foot');
    // 관전(양쪽 AI)·데모에는 낼 의도가 없다 — 단추를 아예 두지 않는다
    if (humanSide) {
      const btn = document.createElement('button');
      btn.className = 'gi-act';
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'surrender') {
          // 되돌릴 수 없어 한 번 더 묻는다 (기록 안에 있을 때와 같은 물음)
          if (window.confirm(t('hist.surrender.confirm'))) on.surrender();
        } else if (btn.dataset.action === 'takeTurn') {
          on.takeTurn();
        }
      });
      foot.appendChild(btn);
      this.actBtn = btn;
    } else {
      this.actBtn = null;
    }
  }

  /**
   * 매 프레임 불린다. `displayTime`은 **화면이 따라잡은 시각**이다 — 시계가 실제로
   * 흐르는 것처럼 보여야 하므로 권위 상태의 `time`이 아니라 이쪽을 쓴다.
   *
   * @param deadlineSec 제어 마감까지 남은 초. 마감이 없으면(AI 대전 · 제어 단계 밖) `null`
   */
  refresh(
    state: BattleState, displayTime: number, phase: PlaybackPhase,
    busy: boolean, deadlineSec: number | null,
  ): void {
    // GDD §3.3 — UI는 0.1일(= time 10) 단위로 증가를 보여준다
    const day = (Math.floor(displayTime / 10) / 10).toFixed(1);
    const side = this.humanSide;
    const activeSide = state.activeUnit ? state.units[state.activeUnit]?.side ?? null : null;
    const myTurn = phase === 'awaitingInput';
    // 상대 차례: 제어 단계이고, 쥔 쪽이 내가 아니다
    const theirTurn = side !== null && state.phase === 'control' && activeSide !== null && !myTurn
      && phase !== 'advancing';
    const canTake = theirTurn && deadlineSec === 0
      && validate(state, side!, { t: 'forceSkipTurn' }).ok;
    const action = myTurn ? 'surrender' : 'takeTurn';
    const enabled = myTurn ? !busy : canTake;

    const key = [day, state.sp.P1, state.sp.P2, state.skips.P1, state.skips.P2,
      deadlineSec, action, enabled, state.phase, currentLang()].join('|');
    if (key === this.last) return;
    this.last = key;

    this.dayEl.textContent = t('hud.info.day', { days: day });
    this.dayEl.dataset.day = day;
    for (const s of ['P1', 'P2'] as Side[]) {
      const sp = Math.floor(state.sp[s]);
      const was = this.spEl[s].dataset.sp;
      this.spEl[s].textContent = String(sp);
      this.spEl[s].dataset.sp = String(sp);
      // 오르면 노랗게 번쩍이며 아래에서 솟는다 (2026-10-09 기획자 지정). 숫자 자체는 곧바로 맞는 값이다 — 연출만 덧붙인다.
      // 쓴 것(내림)과 첫 그리기에는 안 돈다. 같은 클래스를 다시 걸어도 애니메이션은 안 돌아서 한 번 떼고 다시 붙인다
      if (was !== undefined && sp > Number(was)) {
        this.spEl[s].classList.remove('gi-sp-up');
        void this.spEl[s].offsetWidth;
        this.spEl[s].classList.add('gi-sp-up');
      }
      this.skipEl[s].textContent = String(state.skips[s]);
      this.skipEl[s].dataset.skips = String(state.skips[s]);
    }
    this.leftEl.textContent = deadlineSec === null ? '-' : t('hud.info.leftSec', { n: deadlineSec });
    this.leftEl.dataset.left = deadlineSec === null ? '-' : String(deadlineSec);
    this.leftEl.title = deadlineSec === null ? t('cmd.note.noDeadline') : '';
    this.root.classList.toggle('over', state.phase === 'finished');

    const btn = this.actBtn;
    if (btn) {
      btn.dataset.action = action;
      btn.textContent = t(myTurn ? 'hist.surrender' : 'hud.takeTurn');
      btn.title = myTurn ? '' : t('hud.takeTurn.hint', { max: SKIP_TO_WIN });
      btn.disabled = !enabled || state.phase === 'finished';
    }
  }
}

function add(parent: HTMLElement, tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}
