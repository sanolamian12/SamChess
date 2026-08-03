/**
 * 제어 모달 — 턴의 3단계를 그대로 화면에 옮긴 것 (GDD §3.4 · §3.10)
 *
 * ```
 * [1] 고유기술?   조건이 되면 먼저 묻는다 → [고유기술 발동] [보류]
 *       ↓                                    턴을 소비하지 않는다
 * [2] 이동        갈 칸을 고른다. 제자리를 눌러 그대로 대기해도 된다
 *       ↓
 * [3] 행동        공격 / 책략 / 명상 중 하나 (또는 턴 종료)
 * ```
 *
 * 3상태 (GDD §3.10)
 * | 내가 제어권 | 장수 정보 + 위 단계 |
 * | 상대가 제어권 | "…를 제어 중입니다" + 20초 초과 시 `[턴 넘기기]` |
 * | 누구의 턴도 아님 | 물러난다 — 시계·SP는 HUD가 맡는다 |
 *
 * **버튼 활성 여부를 클라이언트가 판단하지 않는다.** 전부 룰 엔진의 `validate()`에 묻는다.
 * 대상이 있어야 판정되는 것(이동·공격·책략·고유기술)은 **엔진이 준 후보를 하나씩 넣어 물어보고**
 * 하나라도 통과하면 켠다. 조준 하이라이트도 같은 후보 목록이라, 화면에 칠해진 칸은
 * 곧 "엔진이 통과시킨 칸"이다 — 눌렀는데 거부당하는 일이 원리적으로 없다.
 */

import {
  aimingSpec, inBounds, legalMovesFor, legalTargetsFor, tacticMpCost, validate, FORMULA,
} from '@samchess/rules';
import type { BattleState, Intent, Side, TacticId, UnitId, UnitState, Vec2 } from '@samchess/rules';
import { officerById, skillById, tacticById } from '@samchess/data';
import type { PlaybackPhase } from '../battle/playback.ts';

/** 보드 클릭이 무엇으로 해석되는지 — `idle`은 "이동이든 공격이든 누른 대로" */
export type ActionMode = 'idle' | 'move' | 'attack' | 'aim';

/** 상대가 제어권을 쥔 채 이만큼 넘기면 「턴 넘기기」가 열린다 (GDD §3.3) */
const FORCE_SKIP_AFTER_MS = 20_000;

/** 조준 후보 하나 — 칠할 칸과, 그 칸을 골랐을 때 엔진에 보낼 target */
interface Candidate {
  pos: Vec2;
  target: Vec2 | UnitId;
}

/** 시전 대기 중인 것. 책략과 고유기술이 조준 흐름을 공유한다. */
interface Pending {
  kind: 'tactic' | 'unique';
  tactic: TacticId | undefined;
  label: string;
  candidates: Candidate[];
}

interface Handlers {
  submit(intent: Intent): void;
  setMode(mode: ActionMode): void;
}

export class ControlModal {
  private nameEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private noteEl!: HTMLElement;
  private promptEl!: HTMLElement;
  private listEl!: HTMLElement;
  private buttonsEl!: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();

  private mode: ActionMode = 'idle';
  private pending: Pending | null = null;
  private lastKey = '';
  /** 상대 제어가 시작된 실시간 시각. 20초 판정은 엔진이 아니라 여기서 잰다 */
  private opponentSince: number | null = null;

  // ── 턴 단위 클라이언트 상태 ──────────────────────────────────
  // 엔진에는 없는, "이번 턴에 사용자가 무엇을 골랐나"뿐이다. 턴이 바뀌면 전부 초기화된다.
  private turnKey = '';
  /** 「보류」를 눌렀다 — 고유기술 물음을 이번 턴에는 다시 띄우지 않는다 */
  private skillDismissed = false;
  /** 제자리 대기를 골랐다 — 이동 하이라이트를 걷는다 */
  private stayed = false;

  constructor(private readonly root: HTMLElement, private readonly on: Handlers) {
    root.replaceChildren();
    this.nameEl = add(root, 'div', 'ctl-name');
    this.statsEl = add(root, 'div', 'ctl-stats');
    this.promptEl = add(root, 'div', 'ctl-prompt');
    this.listEl = add(root, 'div', 'ctl-list');
    this.noteEl = add(root, 'div', 'ctl-note');
    this.buttonsEl = add(root, 'div', 'ctl-buttons');

    this.button('move', '이동', 'KeyQ', '갈 칸을 고른다. 제자리를 누르면 그대로 대기한다 (Q)');
    this.button('attack', '공격', 'KeyE', '공격 범위를 보고 적을 고른다 (E)');
    this.button('castTactic', '책략', 'KeyR', '습득한 책략을 시전한다 (R)');
    this.button('meditate', '명상', 'KeyM', 'MP +1 — 턴을 마친다 (M)');
    this.button('endTurn', '턴 종료', 'Space', '행동 없이 넘긴다 (Space)');
    this.button('cancel', '취소', 'Escape', '고르던 것을 무른다 (Esc)');
    this.button('forceSkipTurn', '턴 넘기기', undefined, '상대가 20초를 넘겼다');

    window.addEventListener('keydown', (e) => {
      for (const [action, el] of this.buttons) {
        if (el.dataset.key !== e.code || el.disabled || el.classList.contains('hidden')) continue;
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

  // ── 조작 ─────────────────────────────────────────────────────

  private press(action: string): void {
    if (action === 'cancel') { this.cancel(); return; }
    if (action === 'move' || action === 'attack') {
      this.cancelAim();
      if (action === 'move') this.stayed = false;   // 다시 고르겠다는 뜻이다
      this.setMode(this.mode === action ? 'idle' : action);
      return;
    }
    if (action === 'castTactic') { this.toggleTacticList(); return; }
    this.cancel();
    this.on.submit({ t: action } as Intent);
  }

  private cancel(): void {
    this.cancelAim();
    this.listEl.replaceChildren();
    this.setMode('idle');
  }

  private cancelAim(): void {
    this.pending = null;
    this.lastKey = '';
  }

  /** 보드에서 의도가 만들어졌거나 턴이 끝났을 때 씬이 불러 모드를 되돌린다 */
  setMode(mode: ActionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.on.setMode(mode);
    this.lastKey = '';
  }

  get currentMode(): ActionMode { return this.mode; }
  /** 제자리 대기를 골랐는가 — 씬이 이동 하이라이트를 걷는 데 쓴다 */
  get staying(): boolean { return this.stayed; }

  /**
   * 제자리 대기. **엔진에 보낼 의도가 없다** — 이동은 원래 해도 되고 안 해도 되는 단계라
   * "안 한다"를 선언하는 의도가 룰에 없다. 여기서 하는 일은 이동 하이라이트를 걷고
   * 행동을 고르라고 알리는 것뿐이다. 「이동」을 다시 누르면 그대로 무를 수 있다.
   */
  confirmStay(): void {
    this.stayed = true;
    this.setMode('idle');
    this.lastKey = '';
  }

  // ── 조준 ─────────────────────────────────────────────────────

  /** 지금 조준 중인 후보 칸들. 씬이 이 목록을 그대로 칠한다. */
  aimCandidates(_state: BattleState): Vec2[] {
    return this.pending?.candidates.map((c) => c.pos) ?? [];
  }

  /** 보드에서 칸을 눌렀다. 후보에 있으면 시전하고, 아니면 이유를 알린다. */
  aimAt(state: BattleState, cell: Vec2, unitId: UnitId | null): void {
    const p = this.pending;
    if (!p) return;
    const hit = p.candidates.find((c) =>
      (typeof c.target === 'string' ? c.target === unitId : samePos(c.pos, cell)));
    if (!hit) {
      this.noteEl.textContent = `${p.label} — 고를 수 없는 칸입니다`;
      return;
    }
    const intent: Intent = p.kind === 'tactic'
      ? { t: 'castTactic', tactic: p.tactic!, target: hit.target }
      : { t: 'castUniqueSkill', target: hit.target };
    this.cancel();
    this.on.submit(intent);
  }

  /**
   * 엔진이 통과시키는 조준 후보를 모은다.
   *
   * 조준 규약(`aimingSpec`)은 엔진이 알려 주고, 후보 하나하나를 다시 `validate()`에 넣어
   * 통과한 것만 남긴다. **클라이언트는 "누가 대상이 될 수 있는가"를 스스로 판단하지 않는다** —
   * 사거리·무적·아군 판정 같은 규칙이 여기로 새어 나오면 서버와 어긋나기 시작한다.
   */
  private candidatesFor(
    state: BattleState, side: Side, unit: UnitState,
    kind: 'tactic' | 'unique', tactic?: TacticId,
  ): Candidate[] {
    const effects = kind === 'tactic'
      ? (tacticById.get(tactic!)?.effects as never[] ?? [])
      : (skillById.get(officerById.get(unit.officer)!.uniqueSkill!)?.effects as never[] ?? []);
    const spec = aimingSpec(effects);
    const make = (target: Vec2 | UnitId): Intent => kind === 'tactic'
      ? { t: 'castTactic', tactic: tactic!, target }
      : { t: 'castUniqueSkill', target };

    // 조준이 필요 없는 것(자기 자신·전체 대상)은 고를 칸이 없다.
    // 쓸 수 있는지는 호출한 쪽이 대상 없는 `validate()`로 따로 묻는다.
    if (!spec) return [];

    if (spec.kind === 'tile') {
      const out: Candidate[] = [];
      for (let y = 0; y < FORMULA.board.rows; y++) {
        for (let x = 0; x < FORMULA.board.cols; x++) {
          const pos = { x, y };
          if (inBounds(pos) && validate(state, side, make(pos)).ok) out.push({ pos, target: pos });
        }
      }
      return out;
    }
    return Object.values(state.units)
      .filter((u) => u.alive && validate(state, side, make(u.id)).ok)
      .map((u) => ({ pos: u.pos, target: u.id }));
  }

  /** 조준이 필요 없으면 바로 쏘고, 필요하면 조준 모드로 들어간다. */
  private begin(state: BattleState, side: Side, unit: UnitState, kind: 'tactic' | 'unique', tactic?: TacticId): void {
    const label = kind === 'tactic'
      ? tacticById.get(tactic!)!.name
      : skillById.get(officerById.get(unit.officer)!.uniqueSkill!)!.name;
    const effects = kind === 'tactic'
      ? (tacticById.get(tactic!)?.effects as never[] ?? [])
      : (skillById.get(officerById.get(unit.officer)!.uniqueSkill!)?.effects as never[] ?? []);

    if (!aimingSpec(effects)) {
      const intent: Intent = kind === 'tactic'
        ? { t: 'castTactic', tactic: tactic! }
        : { t: 'castUniqueSkill' };
      this.cancel();
      this.on.submit(intent);
      return;
    }
    const candidates = this.candidatesFor(state, side, unit, kind, tactic);
    if (candidates.length === 0) {
      this.noteEl.textContent = `${label} — 지금 고를 수 있는 대상이 없습니다`;
      return;
    }
    this.listEl.replaceChildren();
    this.pending = { kind, tactic, label, candidates };
    this.setMode('aim');
    this.noteEl.textContent = `${label} — 대상을 고르세요 (Esc 취소)`;
  }

  private toggleTacticList(): void {
    if (this.listEl.childElementCount > 0) { this.cancel(); return; }
    this.pendingListOpen = true;
    this.lastKey = '';
  }

  private pendingListOpen = false;

  // ── 갱신 ─────────────────────────────────────────────────────

  refresh(state: BattleState, side: Side | null, phase: PlaybackPhase): void {
    const unit = state.activeUnit ? state.units[state.activeUnit] : undefined;
    const mine = phase === 'awaitingInput';
    const opponent = phase === 'aiThinking' && !!unit;

    // 턴이 바뀌면 이번 턴에만 유효했던 선택(보류·제자리·조준)을 전부 버린다
    const turnKey = `${unit?.id ?? ''}|${state.time}`;
    if (turnKey !== this.turnKey) {
      this.turnKey = turnKey;
      this.skillDismissed = false;
      this.stayed = false;
      this.pending = null;
      this.pendingListOpen = false;
      this.listEl.replaceChildren();
      if (this.mode !== 'idle') this.setMode('idle');
    }

    if (opponent) this.opponentSince ??= performance.now();
    else this.opponentSince = null;

    const key = `${phase}|${side}|${unit?.id}|${JSON.stringify(state.activeTurn)}|${state.time}`
      + `|${this.mode}|${this.skillDismissed}|${this.stayed}|${this.pendingListOpen}`;
    if (key === this.lastKey && !opponent) return;
    this.lastKey = key;

    this.root.classList.toggle('hidden', !mine && !opponent);
    if (mine && unit && side) this.showMine(state, side, unit);
    else if (opponent && unit) this.showOpponent(state, side, unit);
  }

  private showMine(state: BattleState, side: Side, unit: UnitState): void {
    const officer = officerById.get(unit.officer)!;
    this.nameEl.textContent = `${officer.name} [${unit.piece}]`;
    this.nameEl.dataset.grade = officer.grade;
    this.statsEl.replaceChildren(
      stat('HP', `${unit.hp}/${unit.maxHp}`, 'hp'),
      stat('MP', `${unit.mp}/${unit.maxMp}`, 'mp'),
      stat('AT', String(unit.at), 'at'),
      stat('무력', String(officer.might)),
      stat('지력', String(officer.intellect)),
      stat('통솔', String(officer.leadership)),
      stat('Lv', String(unit.level)),
    );

    // ── [1] 고유기술을 먼저 묻는다 (GDD §3.4) ──
    const canCastUnique = validate(state, side, { t: 'castUniqueSkill' }).ok
      || this.candidatesFor(state, side, unit, 'unique').length > 0;
    const asking = canCastUnique && !this.skillDismissed && this.mode !== 'aim';
    this.promptEl.replaceChildren();
    this.promptEl.classList.toggle('hidden', !asking);
    if (asking) {
      const skill = skillById.get(officer.uniqueSkill!)!;
      const head = add(this.promptEl, 'div', 'ask');
      head.textContent = `고유기술 「${skill.name}」 — SP ${skill.spCost}`;
      add(this.promptEl, 'div', 'ask-text').textContent = skill.text;
      const row = add(this.promptEl, 'div', 'ask-buttons');
      const fire = document.createElement('button');
      fire.textContent = '고유기술 발동';
      fire.dataset.action = 'castUniqueSkill';
      fire.addEventListener('click', () => this.begin(state, side, unit, 'unique'));
      const hold = document.createElement('button');
      hold.textContent = '보류';
      hold.dataset.action = 'holdUniqueSkill';
      hold.addEventListener('click', () => { this.skillDismissed = true; this.lastKey = ''; });
      row.append(fire, hold);
    }

    // ── 책략 목록 ──
    this.listEl.replaceChildren();
    if (this.pendingListOpen && this.mode !== 'aim') {
      for (const id of unit.tactics) {
        const def = tacticById.get(id)!;
        const usable = this.candidatesFor(state, side, unit, 'tactic', id).length > 0
          || validate(state, side, { t: 'castTactic', tactic: id }).ok;
        const el = document.createElement('button');
        el.className = 'tactic';
        el.dataset.tactic = id;
        el.disabled = !usable;
        el.title = def.text;
        el.append(
          spanOf('lv', `Lv${def.level}`),
          spanOf('nm', def.name),
          spanOf('mp', `MP ${tacticMpCost(unit, id)}`),
        );
        el.addEventListener('click', () => this.begin(state, side, unit, 'tactic', id));
        this.listEl.appendChild(el);
      }
      if (unit.tactics.length === 0) {
        add(this.listEl, 'div', 'empty').textContent = '습득한 책략이 없다';
      }
    }

    // ── [2][3] 행동 버튼 ──
    const can = (intent: Intent): boolean => validate(state, side, intent).ok;
    const aiming = this.mode === 'aim';
    const enabled: Record<string, boolean> = {
      move: !aiming && legalMovesFor(state, unit.id).some((to) => can({ t: 'move', to })),
      attack: !aiming && legalTargetsFor(state, unit.id).some((id) => can({ t: 'attack', targets: [id] })),
      castTactic: !aiming && unit.tactics.length > 0,
      meditate: !aiming && can({ t: 'meditate' }),
      endTurn: !aiming && can({ t: 'endTurn' }),
      cancel: aiming || this.pendingListOpen,
      forceSkipTurn: false,
    };
    for (const [action, el] of this.buttons) {
      el.disabled = !enabled[action];
      el.classList.toggle('on', this.mode === action || (action === 'castTactic' && this.pendingListOpen));
      el.classList.toggle('hidden', action === 'forceSkipTurn' || (action === 'cancel' && !enabled['cancel']));
    }

    const turn = state.activeTurn;
    if (!aiming) {
      this.noteEl.textContent = asking ? '고유기술을 쓸지 먼저 고르세요'
        : this.mode === 'move' ? '갈 칸을 고르세요 — 제자리를 누르면 그대로 대기합니다'
        : this.mode === 'attack' ? '공격 범위 안의 적을 고르세요'
        : this.stayed ? '제자리 대기 — 공격·책략·명상을 고르세요'
        : turn?.moved ? '이동을 마쳤다 — 공격·책략·명상·턴 종료'
        : '';
    }
  }

  private showOpponent(state: BattleState, side: Side | null, unit: UnitState): void {
    const officer = officerById.get(unit.officer)!;
    this.nameEl.textContent = `상대가 〈${officer.name}〉을 제어 중입니다`;
    delete this.nameEl.dataset.grade;
    this.statsEl.replaceChildren();
    this.promptEl.replaceChildren();
    this.promptEl.classList.add('hidden');
    this.listEl.replaceChildren();

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

const samePos = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

function add(parent: HTMLElement, tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

function spanOf(className: string, text: string): HTMLElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
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
