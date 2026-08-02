/**
 * 제어 모달 — 3상태 (GDD §3.10 「제어 모달 3상태」)
 *
 * | 상태 | 표시 |
 * |---|---|
 * | 내가 제어권       | 장수 정보 + `[이동][공격][책략][명상]` (+ 「턴 종료」) |
 * | 상대가 제어권     | "…를 제어 중입니다" + 20초 초과 시 `[턴 넘기기]` |
 * | 누구의 턴도 아님  | 조용히 물러난다 — 시계·SP는 HUD가 맡는다 |
 *
 * 1차의 `actionBar.ts`를 키운 것이다. **버튼 활성 여부를 클라이언트가 판단하지 않는다**는
 * 계약은 그대로다 — 전부 룰 엔진의 `validate()`에 묻는다. 「이동」·「공격」처럼 대상이 있어야
 * 판정되는 것은 **엔진이 준 후보(`legalMovesFor`/`legalTargetsFor`)를 하나씩 넣어 물어본다.**
 * 하나라도 통과하면 켠다. 클라이언트가 규칙을 다시 구현하는 일이 없어야 한다.
 *
 * 「이동」·「공격」은 의도가 아니라 **모드**다. 누르면 보드가 그 후보만 칠하고,
 * 실제 의도는 칸을 클릭할 때 만들어진다. 책략·고유기술 시전 UI도 이 결을 따른다.
 */

import { legalMovesFor, legalTargetsFor, validate } from '@samchess/rules';
import type { BattleState, Intent, Side, UnitState } from '@samchess/rules';
import { officerById } from '@samchess/data';
import type { PlaybackPhase } from '../battle/playback.ts';

/** 보드 클릭이 무엇으로 해석되는지 — `idle`은 "이동이든 공격이든 누른 대로" */
export type ActionMode = 'idle' | 'move' | 'attack';

/** 상대가 제어권을 쥔 채 이만큼 넘기면 「턴 넘기기」가 열린다 (GDD §3.3) */
const FORCE_SKIP_AFTER_MS = 20_000;

interface Handlers {
  submit(intent: Intent): void;
  setMode(mode: ActionMode): void;
}

export class ControlModal {
  private infoEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private buttonsEl!: HTMLElement;
  private noteEl!: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private mode: ActionMode = 'idle';
  private lastKey = '';
  /** 상대 제어가 시작된 실시간 시각. 20초 판정은 엔진이 아니라 여기서 잰다 */
  private opponentSince: number | null = null;

  constructor(private readonly root: HTMLElement, private readonly on: Handlers) {
    root.replaceChildren();
    this.infoEl = add(root, 'div', 'ctl-name');
    this.statsEl = add(root, 'div', 'ctl-stats');
    this.noteEl = add(root, 'div', 'ctl-note');
    this.buttonsEl = add(root, 'div', 'ctl-buttons');

    this.button('move', '이동', 'KeyQ', '갈 수 있는 칸을 고른다 (Q)');
    this.button('attack', '공격', 'KeyE', '칠 수 있는 적을 고른다 (E)');
    this.button('castTactic', '책략', 'KeyR', '습득한 책략을 시전한다 (R)');
    this.button('meditate', '명상', 'KeyM', 'MP +1 — 턴을 마친다 (M)');
    this.button('endTurn', '턴 종료', 'Space', '행동 없이 넘긴다 (Space)');
    this.button('forceSkipTurn', '턴 넘기기', undefined, '상대가 20초를 넘겼다');

    window.addEventListener('keydown', (e) => {
      for (const [action, el] of this.buttons) {
        if (el.dataset.key !== e.code || el.disabled) continue;
        e.preventDefault();
        this.press(action);
      }
    });
  }

  private button(action: string, label: string, key: string | undefined, hint: string): void {
    const el = document.createElement('button');
    el.textContent = label;
    el.title = hint;
    el.dataset.action = action;      // 스모크 테스트가 이 이름으로 찾는다
    if (key) el.dataset.key = key;
    el.addEventListener('click', () => this.press(action));
    this.buttonsEl.appendChild(el);
    this.buttons.set(action, el);
  }

  private press(action: string): void {
    // 이동·공격·책략은 대상을 골라야 의도가 완성된다 → 모드로 넘긴다
    if (action === 'move' || action === 'attack') {
      this.setMode(this.mode === action ? 'idle' : action);
      return;
    }
    if (action === 'castTactic') return;   // 시전 UI는 다음 단계
    this.setMode('idle');
    this.on.submit({ t: action } as Intent);
  }

  /** 보드에서 의도가 만들어졌거나 턴이 끝났을 때 씬이 불러 모드를 되돌린다 */
  setMode(mode: ActionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.on.setMode(mode);
    this.lastKey = '';   // 버튼 눌린 표시를 다시 칠하게 한다
  }

  get currentMode(): ActionMode { return this.mode; }

  // ── 갱신 ─────────────────────────────────────────────────────

  refresh(state: BattleState, side: Side | null, phase: PlaybackPhase): void {
    const unit = state.activeUnit ? state.units[state.activeUnit] : undefined;
    const mine = phase === 'awaitingInput';
    const opponent = phase === 'aiThinking' && !!unit;

    // 상대 제어가 시작된 시각을 기록해 둔다 (20초 판정용)
    if (opponent) this.opponentSince ??= performance.now();
    else this.opponentSince = null;

    const key = `${phase}|${side}|${unit?.id}|${JSON.stringify(state.activeTurn)}|${state.time}|${this.mode}`;
    // 「턴 넘기기」는 시간이 지나면 열려야 하므로 상대 턴일 때만 매번 다시 본다
    if (key === this.lastKey && !opponent) return;
    this.lastKey = key;

    this.root.classList.toggle('hidden', !mine && !opponent);
    if (mine && unit) this.showMine(state, side!, unit);
    else if (opponent && unit) this.showOpponent(state, side, unit);
  }

  private showMine(state: BattleState, side: Side, unit: UnitState): void {
    const officer = officerById.get(unit.officer)!;
    this.infoEl.textContent = `${officer.name} [${unit.piece}]`;
    this.infoEl.dataset.grade = officer.grade;
    this.statsEl.replaceChildren(
      stat('HP', `${unit.hp}/${unit.maxHp}`, 'hp'),
      stat('MP', `${unit.mp}/${unit.maxMp}`, 'mp'),
      stat('AT', String(unit.at), 'at'),
      stat('무력', String(officer.might)),
      stat('지력', String(officer.intellect)),
      stat('통솔', String(officer.leadership)),
      stat('Lv', String(unit.level)),
    );

    // 활성 여부는 전부 엔진에 묻는다. 대상이 필요한 것은 후보를 하나씩 넣어 본다.
    const can = (intent: Intent): boolean => validate(state, side, intent).ok;
    const enabled: Record<string, boolean> = {
      move: legalMovesFor(state, unit.id).some((to) => can({ t: 'move', to })),
      attack: legalTargetsFor(state, unit.id).some((id) => can({ t: 'attack', targets: [id] })),
      // 책략은 대상 규약이 스킬마다 달라 후보를 넣어 보는 것만으로는 판정되지 않는다.
      // 시전 UI(다음 단계)에서 대상을 고른 뒤 물어야 한다. Lv1은 습득한 책략이 없다.
      castTactic: false,
      meditate: can({ t: 'meditate' }),
      endTurn: can({ t: 'endTurn' }),
      forceSkipTurn: false,
    };

    for (const [action, el] of this.buttons) {
      el.disabled = !enabled[action];
      el.classList.toggle('on', this.mode === action);
      el.classList.toggle('hidden', action === 'forceSkipTurn');
    }
    this.buttons.get('castTactic')!.title = unit.tactics.length === 0
      ? '습득한 책략이 없다 (레벨 2부터 습득 — 육성 메타 미구현)'
      : '시전 UI는 다음 단계';

    const turn = state.activeTurn;
    this.noteEl.textContent = this.mode === 'move' ? '갈 칸을 고르세요'
      : this.mode === 'attack' ? '칠 적을 고르세요'
      : turn?.moved ? '이동을 마쳤다 — 공격·명상·턴 종료'
      : '';
  }

  private showOpponent(state: BattleState, side: Side | null, unit: UnitState): void {
    const officer = officerById.get(unit.officer)!;
    this.infoEl.textContent = `상대가 〈${officer.name}〉을 제어 중입니다`;
    delete this.infoEl.dataset.grade;
    this.statsEl.replaceChildren();

    const waited = this.opponentSince ? performance.now() - this.opponentSince : 0;
    const over = waited >= FORCE_SKIP_AFTER_MS;
    // 20초 경과는 실시간이라 엔진이 알 수 없다. 버튼을 여는 것만 여기서 하고,
    // 「자기 차례는 넘길 수 없다」 같은 판정은 그대로 엔진에 묻는다.
    const allowed = over && side !== null && validate(state, side, { t: 'forceSkipTurn' }).ok;
    for (const [action, el] of this.buttons) {
      const isSkip = action === 'forceSkipTurn';
      el.classList.toggle('hidden', !isSkip);
      el.disabled = !allowed;
    }
    this.noteEl.textContent = over ? '' : `${Math.ceil((FORCE_SKIP_AFTER_MS - waited) / 1000)}초 뒤 넘길 수 있습니다`;
  }
}

function add(parent: HTMLElement, tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

function stat(label: string, value: string, kind?: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = kind ? `stat ${kind}` : 'stat';
  const l = document.createElement('i');
  l.textContent = label;
  const v = document.createElement('b');
  v.textContent = value;
  wrap.append(l, v);
  return wrap;
}
