/**
 * 게임 정보 — 위 칸 오른쪽 (전투 UI 개편 3단계, pptx 93쪽 · `docs/전투UI개편/설계.md` §1)
 *
 * ```
 * 전투 1.2일차
 * 북군 SP 3        턴오버 0
 * 남군(나) SP 1    턴오버 2
 * 남은 시간 15초                ← AI 대전은 「시간제한 없음」
 * [ 항복 ]  /  [ 턴 가져오기 ]          [⋯]
 * ```
 *
 * 옛 상단 HUD(`ui/hud.ts`, pptx 27쪽)를 갈음한다. 단계 이름(내 차례/상대 차례)과
 * 「누구 · 기물」은 빠졌다 — 순서 판의 첫 줄이 같은 것을 보여 준다.
 *
 * - SP는 **정수**(2026-09-27 기획자 확정 9). 턴오버 = `state.skips[side]` — 그 진영이
 *   상대의 차례를 가져온 횟수다. 세는 곳은 엔진 하나다. **점 `SKIP_TO_WIN`개로 그린다**(●●○, 2026-10-10 기획자
 *   확정) — 숫자로는 「세 번이면 이긴다」가 안 보였다.
 * - 진영 색은 **판의 기물 아이콘과 같다** — 아군 녹청 · 적군 구리빛(`pieceIcon.ts`가 `mine`으로 가른다).
 *   북군 · 남군이 아니라 **나에게서 본** 색이라, 북군으로 서는 온라인에서도 내 줄이 녹청이다. 관전은 남군을 아군 자리로.
 * - 남은 시간이 5초 이하면 붉게 맥박친다(`HURRY_SEC`).
 * - **글자 대신 그림이다** (2026-10-10 기획자 지정 — 번역되면 칸이 모자란다). 진영 = 깃발(북군 ↓ 구리 · 남군 ↑ 녹청),
 *   「나」 = 투구 배지, 턴오버 = 영전을 낚아채는 손 + 구슬 홈 셋, 남은 시간 = 해시계(오른쪽 끝, 그 왼쪽에 「15초」 · AI 대전은 「시간제한 없음」), 전투 n일차 = 해와 달 원반 + 「n일」(`hud.info.dayNum`, 영어는 「Day n」).
 *   글자로 남는 것은 숫자와 「SP」뿐이다. **번역 문구는 `title` · `aria-label`로** 남긴다 — 스모크도 그것을 읽는다.
 *   그림은 `tools/build_ui.py`의 `CELL_SHEETS`가 `public/ui/gi/`에 굽고, 붙이는 자리는 `style.css`의 `.gi-ic`다.
 *   깃발 색은 **진영 고정**이고 줄의 색(아군 · 적군)과 따로 논다 — 화살표가 진영을 말한다.
 * - 남은 시간은 **판정 주체가 실어 보낸 값**(`Playback.remainingSec`)이다 — 화면이 20초를
 *   다시 재지 않는다. AI 대전에는 제어 마감이 없어 `null`이고 「시간제한 없음」으로 적는다
 *   (확정 8은 「-」였다 — 2026-10-10 기획자가 글로 바꿨다. `data-left`는 여전히 `-`).
 * - 단추 하나가 자리를 바꾼다: 내 차례엔 [항복], 그 밖엔 [턴 가져오기](= `forceSkipTurn`).
 *   [턴 가져오기]는 상대 차례에 마감이 0이 되고 엔진이 허락할 때만 켜진다 — 규칙 변경 없이
 *   이름과 자리만 바뀌었다(예전엔 커맨드 패널의 「턴 넘기기」). AI 대전에서는 언제나 꺼져 있다.
 * - [항복]은 전투 기록(`#history`) 안에서 여기로 나왔다(설계 확정 7). 되돌릴 수 없어 한 번 더 묻는다 —
 *   브라우저 기본 `window.confirm` 대신 목판 팝업(`panel-settings`, 2026-10-10 기획자 확정 「시안 B」).
 *   단추는 맥락 판과 같은 그림 · 같은 순서다(위 [취소] 금빛 · 맨 아래 [항복] — 진행 단추가 맨 아래).
 *   [항복]만은 붉은 목판이다(게임 정보의 [항복]과 같은 그림, 2026-10-10).
 *   **내 차례가 끝나면 저절로 닫힌다** — 열어 둔 채 차례가 넘어가면 [항복]이 버려질 의도가 된다.
 * - ⋯(기록)은 6단계에서 판 왼쪽 위의 [...]로 갔다(`ui/systemLog.ts`).
 *
 * **판정은 하지 않는다.** 켜짐은 엔진(`validate`)과 판정 주체(마감)가 정한다.
 */

import { validate, SKIP_TO_WIN } from '@samchess/rules';
import type { BattleState, Side } from '@samchess/rules';
import type { PlaybackPhase } from '../battle/playback.ts';
import { currentLang, t } from '../i18n/index.ts';
import { armyName } from '../i18n/engineLabel.ts';

/** 이 초 이하로 남으면 남은 시간이 붉게 맥박친다 (2026-10-10 기획자 확정) */
const HURRY_SEC = 5;

export interface GameInfoHooks {
  surrender(): void;
  takeTurn(): void;
}

export class GameInfo {
  private readonly dayEl: HTMLElement;
  private readonly dayNum: HTMLElement;
  private readonly spEl: Record<Side, HTMLElement>;
  private readonly skipEl: Record<Side, HTMLElement>;
  private readonly leftBox: HTMLElement;
  private readonly leftEl: HTMLElement;
  private readonly actBtn: HTMLButtonElement | null;
  /** 떠 있는 항복 물음 — 없으면 `null` */
  private ask: HTMLElement | null = null;
  private last = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly humanSide: Side | null,
    private readonly on: GameInfoHooks,
  ) {
    root.replaceChildren();
    this.dayEl = add(root, 'div', 'gi-day');
    icon(this.dayEl, 'days');
    this.dayNum = add(this.dayEl, 'b', 'num');

    const sides = add(root, 'div', 'gi-sides');
    this.spEl = {} as Record<Side, HTMLElement>;
    this.skipEl = {} as Record<Side, HTMLElement>;
    for (const side of ['P2', 'P1'] as Side[]) {       // 북군 먼저 — 판의 위아래와 같은 순서
      const line = add(sides, 'div', `gi-side ${side.toLowerCase()}`);
      line.dataset.side = side;
      if (side === humanSide) line.classList.add('mine');
      line.classList.add(side === (humanSide ?? 'P1') ? 'ally' : 'foe');
      const army = add(line, 'span', 'gi-army');
      label(army, armyName(side) + (side === humanSide ? t('battle.army.mine') : ''));
      icon(army, side === 'P2' ? 'army-north' : 'army-south');
      if (side === humanSide) icon(army, 'me');
      const sp = add(line, 'span', 'gi-sp');
      add(sp, 'i', '').textContent = 'SP';
      this.spEl[side] = add(sp, 'b', 'num');
      const skip = add(line, 'span', 'gi-skip');
      label(skip, t('hud.info.skips'));
      icon(skip, 'turnover');
      this.skipEl[side] = add(skip, 'b', 'num gi-pips');
      for (let i = 0; i < SKIP_TO_WIN; i++) add(this.skipEl[side], 'span', 'gi-pip');
    }

    const left = this.leftBox = add(root, 'div', 'gi-left');
    label(left, t('hud.info.left'));
    this.leftEl = add(left, 'b', 'num');   // 제한이 먼저, 해시계가 오른쪽 끝
    icon(left, 'timer');

    const foot = add(root, 'div', 'gi-foot');
    // 관전(양쪽 AI)·데모에는 낼 의도가 없다 — 단추를 아예 두지 않는다
    if (humanSide) {
      const btn = document.createElement('button');
      btn.className = 'gi-act';
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'surrender') {
          this.openAsk();
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

    this.dayNum.textContent = t('hud.info.dayNum', { days: day });   // 「1.5일」 · 「Day 1.5」 — 「전투 …차」는 원반 그림이 대신한다
    label(this.dayEl, t('hud.info.day', { days: day }));
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
      const skips = state.skips[s];
      this.skipEl[s].dataset.skips = String(skips);
      label(this.skipEl[s].parentElement!, `${t('hud.info.skips')} ${skips} / ${SKIP_TO_WIN}`);
      this.skipEl[s].querySelectorAll('.gi-pip').forEach((pip, i) => pip.classList.toggle('on', i < skips));
    }
    this.leftEl.textContent = deadlineSec === null ? t('hud.info.noLimit') : t('hud.info.leftSec', { n: deadlineSec });
    this.leftEl.dataset.left = deadlineSec === null ? '-' : String(deadlineSec);
    label(this.leftBox, deadlineSec === null ? `${t('hud.info.left')} — ${t('cmd.note.noDeadline')}` : t('hud.info.left'));
    this.leftBox.classList.toggle('gi-hurry', deadlineSec !== null && deadlineSec <= HURRY_SEC && state.phase !== 'finished');
    this.root.classList.toggle('over', state.phase === 'finished');

    if (this.ask && (!myTurn || state.phase === 'finished')) this.closeAsk();

    const btn = this.actBtn;
    if (btn) {
      btn.dataset.action = action;
      btn.textContent = t(myTurn ? 'hist.surrender' : 'hud.takeTurn');
      btn.title = myTurn ? '' : t('hud.takeTurn.hint', { max: SKIP_TO_WIN });
      btn.disabled = !enabled || state.phase === 'finished';
    }
  }

  /** 항복 물음을 띄운다 — 판 위 가운데의 목판. 가리개를 누르면 [취소]와 같다 */
  private openAsk(): void {
    if (this.ask) return;
    const back = document.createElement('div');
    back.className = 'modal-back gi-ask-back';
    back.dataset.modal = 'surrender';
    back.addEventListener('click', (e) => { if (e.target === back) this.closeAsk(); });
    const box = add(back, 'div', 'modal gi-ask');
    add(box, 'p', 'modal-ttl').textContent = t('hist.surrender');
    // 물음과 그 결과를 두 줄로 — 물음표 뒤에서 끊는다(언어마다 문장은 하나의 키다)
    add(box, 'div', 'gi-ask-q').textContent = t('hist.surrender.confirm').replace(/([?？])\s*/, '$1\n');
    const acts = add(box, 'div', 'gi-ask-acts');
    const no = add(acts, 'button', '') as HTMLButtonElement;
    no.dataset.action = 'cancel';
    no.textContent = t('cmd.cancel');
    no.addEventListener('click', () => this.closeAsk());
    const yes = add(acts, 'button', 'go') as HTMLButtonElement;
    yes.dataset.action = 'surrender';
    yes.textContent = t('hist.surrender');
    yes.addEventListener('click', () => { this.closeAsk(); this.on.surrender(); });
    // 프레임 안에 붙인다 — 글꼴(`#frame.battle`)을 물려받는다. 자리는 `position: fixed`가 잡는다(CSS)
    (this.root.closest('#frame') ?? document.body).appendChild(back);
    this.ask = back;
  }

  private closeAsk(): void {
    this.ask?.remove();
    this.ask = null;
  }
}

/** 그림 한 칸 — `style.css`의 `.gi-ic[data-ic]`가 `ui/gi/{name}.png`를 깐다 */
function icon(parent: HTMLElement, name: string): HTMLElement {
  const el = add(parent, 'span', 'gi-ic');
  el.dataset.ic = name;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** 그림으로 갈음한 글자의 자리 — 마우스를 올리면 보이고, 화면 낭독기가 읽는다 */
function label(el: HTMLElement, text: string): void {
  el.title = text;
  el.setAttribute('aria-label', text);
}

function add(parent: HTMLElement, tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}
