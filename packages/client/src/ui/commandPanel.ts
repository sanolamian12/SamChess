/**
 * 명령 판 — 아래 칸 왼쪽 `#cmd` (pptx 94~97쪽, 전투 UI 개편 4단계 · 2026-10-06)
 *
 * ```
 *  ┌ 명령을 선택하세요 ───────┐      내 차례 — 첫 줄 안내 + 여섯 칸 (2026-09-27 기획자 확정)
 *  │ [ 이동 ]   [ 공격 ]      │      켜짐은 엔진(`CommandFlow.enabled` ← `commandsFor`)
 *  │ [ 명상 ]   [ 책략 ]      │      진행 중인 명령은 `.on`
 *  │ [아이템]   [ 대기 ]      │
 *  └─────────────────────────┘
 * ```
 *
 * 그 밖의 때 — 고유기술 물음 중 = **내 장수 카드**(확정 5) · 적 차례 = **지금 차례인 적 장수 카드**(97쪽) ·
 * 배치 · 정찰 = **고유기술 목록**(90쪽, 5단계 — 그리기는 `deployPanel.ts`) · 시간이 흐르는 중 = 비어 있음.
 *
 * 무엇이 떠 있는지는 루트의 `data-view`(`commands` · `card` · `skills` · `empty`)가 말한다 — 스모크가 글자 대신 이것을 본다.
 */

import type { BattleState, Side, UnitId, UnitState } from '@samchess/rules';
import type { PlaybackPhase } from '../battle/playback.ts';
import { t } from '../i18n/index.ts';
import { COMMANDS, type Command, type CommandFlow } from './commandFlow.ts';
import { isPrepPhase, renderSkillRoster, skillRosterKey, type SkillRosterHooks } from './deployPanel.ts';
import { officerCardKey, renderOfficerCard } from './officerCard.ts';
import type { StatusPopup } from './statusPopup.ts';

/** 칸의 문구 키 — 짝이 되는 `.hint` 키가 툴팁이다 */
const LABEL: Record<Command, 'cmd.move' | 'cmd.attack' | 'cmd.meditate' | 'cmd.castTactic' | 'cmd.useItem' | 'cmd.endTurn'> = {
  move: 'cmd.move', attack: 'cmd.attack', meditate: 'cmd.meditate',
  castTactic: 'cmd.castTactic', useItem: 'cmd.useItem', endTurn: 'cmd.endTurn',
};

export class CommandPanel {
  private lastKey = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly tip: StatusPopup,
    private readonly flow: CommandFlow,
    /** 명령 칸 · 그리고 배치 중 고유기술 패널의 두 단추(꼬마 그림 · 라벨) */
    private readonly on: { press(cmd: Command): void } & SkillRosterHooks,
  ) {
    root.replaceChildren();
    root.dataset.view = 'empty';
  }

  /**
   * @param actor 지금(또는 방금) 차례인 장수. 적이 행동하는 순간 엔진은 이미 차례를 끝내 `activeUnit`이 비지만
   *   연출은 그때부터 돈다 — 씬이 마지막 제어권(`controlGranted`)을 들고 있다가 넘긴다.
   */
  refresh(state: BattleState, side: Side | null, phase: PlaybackPhase, busy: boolean, actor: UnitId | null): void {
    const unit = state.activeUnit ? state.units[state.activeUnit] : undefined;
    const mine = phase === 'awaitingInput' && !!unit && !!side;
    const enemy = phase === 'aiThinking' && actor ? state.units[actor] : undefined;
    const opponent = !!enemy?.alive;
    const asking = mine && !busy && this.flow.asking(state, side);
    const view = isPrepPhase(phase) ? 'skills'
      : opponent ? 'card' : !unit ? 'empty' : asking ? 'card' : mine ? 'commands' : 'empty';
    const shown = opponent ? enemy : unit;

    const key = view === 'skills' ? `skills|${skillRosterKey(state)}`
      : `${view}|${busy}|${this.flow.version}|${state.time}|${JSON.stringify(state.activeTurn)}`
        + `|${shown ? officerCardKey(state, shown) : ''}|${state.sp.P1}|${state.sp.P2}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.root.dataset.view = view;
    if (view === 'skills') this.root.replaceChildren(...renderSkillRoster(state, side, this.on));
    else if (view === 'card') this.root.replaceChildren(renderOfficerCard(state, shown!, this.tip));
    else if (view === 'commands') this.root.replaceChildren(...this.commands(state, side, unit!, busy));
    else this.root.replaceChildren();
  }

  private commands(state: BattleState, side: Side | null, _unit: UnitState, busy: boolean): HTMLElement[] {
    const title = document.createElement('div');
    title.className = 'cmd-title';
    title.textContent = t('cmd.title');

    const grid = document.createElement('div');
    grid.className = 'cmd-grid';
    const enabled = this.flow.enabled(state, side);
    const active = this.flow.activeCommand;
    for (const cmd of COMMANDS) {
      const b = document.createElement('button');
      b.dataset.action = cmd;        // 스모크 테스트가 이 이름으로 찾는다
      b.textContent = t(LABEL[cmd]);
      b.title = t(`${LABEL[cmd]}.hint`);
      // 연출이 도는 동안에는 누를 것이 없다 — 턴은 연출이 끝나야 넘어간다
      b.disabled = busy || !enabled[cmd];
      b.classList.toggle('on', active === cmd);
      b.addEventListener('click', () => this.on.press(cmd));
      grid.append(b);
    }
    return [title, grid];
  }
}
