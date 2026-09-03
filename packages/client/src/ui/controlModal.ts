/**
 * 커맨드 패널 — 체스판 안에 뜨는 플로팅 패널 (기획 pptx 29쪽)
 *
 * ```
 *  ┌─────────────┐   너비 = 판 × 0.375 (3/8)
 *  │ 유봉·Bishop ─│   높이 = 판 × 0.6   (3/5)     ← 최소화하면 × 0.1
 *  ├─────────────┤
 *  │    이동     │   좌상/우상/좌하/우하 중 한 곳.
 *  │    공격     │   상태 팝업과 좌우 대칭이고, 자리는
 *  │    책략     │   `ui/panelSlot.ts`가 제어권 기물을 피해 고른다.
 *  │    명상     │
 *  │    대기     │
 *  └─────────────┘
 * ```
 *
 * **턴은 두 구간이다** (2026-08-12 기획자 확정)
 *
 * ```
 * [이동 단계]   포커스를 받자마자 판에 **이동 범위만** 뜬다. 커맨드 패널은 아직 없다.
 *      ↓        갈 칸을 누르거나, 제자리를 눌러 그대로 둔다
 * [행동 단계]   커맨드 패널이 뜬다 — `공격` `책략` `명상` `대기`
 *              실제로 **움직인 뒤에는 `이동`이 사라진다.** 엔진이 거부하는 수라서다
 *              제자리 대기였다면 `이동`이 남아 **무를 수 있다**
 * ```
 *
 * 그래서 「제자리 대기」는 **화면만의 상태로 남아 있어야 한다** — 이동은 원래 해도 되고
 * 안 해도 되는 단계라 "안 한다"를 선언하는 `Intent`가 룰에 없다. 여기서 하는 일은
 * 이동 범위를 걷고 커맨드 패널을 띄우는 것뿐이고, 엔진에는 아무것도 보내지 않는다.
 * 화면만의 상태이므로 **무를 수도 있어야 한다** — 그 통로가 행동 단계의 `이동`이다.
 *
 * `공격`·`책략`·`명상`·`대기`는 전부 턴을 끝낸다. `대기`는 `endTurn` 의도이고
 * 이름만 기획서 표기를 따랐다.
 *
 * 3상태 (GDD §3.10)
 * | 내가 제어권 | 위 그림 그대로 |
 * | 상대가 제어권 | "…를 제어 중입니다" + 20초 초과 시 `[턴 넘기기]` |
 * | 누구의 턴도 아님 | 물러난다 — 시계·SP는 HUD가, 장수 정보는 카드가 맡는다 |
 *
 * **버튼 활성 여부를 클라이언트가 판단하지 않는다.** 전부 룰 엔진의 `validate()`에 묻는다.
 * 대상이 있어야 판정되는 것(이동·공격·책략·고유기술)은 **엔진이 준 후보를 하나씩 넣어 물어보고**
 * 하나라도 통과하면 켠다. 조준 하이라이트도 같은 후보 목록이라, 화면에 칠해진 칸은
 * 곧 "엔진이 통과시킨 칸"이다 — 눌렀는데 거부당하는 일이 원리적으로 없다.
 */

import {
  aimingSpec, illusionChance, inBounds, legalMovesFor, legalTargetsFor,
  tacticMpCost, validate, FORMULA, SKIP_TO_WIN,
} from '@samchess/rules';
import type { BattleState, Intent, Side, TacticId, UnitId, UnitState, Vec2 } from '@samchess/rules';
import { officerById, skillById, tacticById } from '@samchess/data';
import type { PlaybackPhase } from '../battle/playback.ts';
import { pickOfficerName, pickTacticName, pickTacticText } from '../i18n/story.ts';
import { applySlot, type Slot } from './panelSlot.ts';
import { makeDraggable } from './draggable.ts';
import type { StatusPopup } from './statusPopup.ts';

/**
 * 보드 클릭이 무엇으로 해석되는지.
 *
 * `idle`은 「이동 단계이거나(이동 범위가 떠 있다) 아무것도 안 고르는 중」이다 —
 * 이동은 커맨드가 아니라 **단계**라 별도 모드가 없다(`ControlModal.movePhase`).
 */
export type ActionMode = 'idle' | 'attack' | 'aim';

/*
 * **20초를 여기서 재지 않는다** ★ (H2)
 *
 * 예전에는 `FORCE_SKIP_AFTER_MS = 20_000`을 두고 `performance.now()`로 스스로 쟀다.
 * 서버가 생긴 지금 **재는 주체가 둘**이 되므로 상수가 두 벌이면 어긋나도 화면은
 * 아무 말도 안 한다 — 화면은 단추를 여는데 서버가 안 받아 주거나 그 반대다.
 * 지금은 **판정 주체가 실어 보내는 「남은 ms」**(`Playback.remainingSec`)를 그대로
 * 읽고, 값이 `null`이면 마감이 없는 것이다(오프라인 — `timing.ts` 참조).
 */

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
  /** 칸을 고르는가 유닛을 고르는가. 칸이면 판 전체를 봐야 해서 카메라가 물러난다 */
  tiles: boolean;
}

/**
 * 대상을 고른 뒤 **확정을 기다리는 중** (2026-08-12 기획자 지정).
 *
 * 책략은 판 반대편까지 대상이 퍼지고 환술은 저항당할 수도 있어서, 고르자마자 쏘면
 * 「뭐가 어디에 걸렸는지」를 알 수 없다. 그래서 대상으로 카메라를 옮기고
 * **이름 · 효과 · 발동 확률**을 보여준 뒤 확정을 받는다.
 */
/**
 * **공격에는 확인창을 두지 않는다** (2026-08-13 기획자 확정, 한 번 붙였다 뺐다).
 *
 * 붙여 봤더니 모달이 판 한가운데를 덮어 정작 공격 연출이 안 보였다. 공격은 인접 칸에
 * 한 번 치는 것이라 책략만큼 되돌릴 값어치가 없다 — 대신 **조준 중에 대상 칸 위로
 * 크리티컬 확률을 반투명 숫자로** 띄운다 (`BattleScene.drawHints`).
 */
type PendingConfirm = { tactic: TacticId; candidate: Candidate };

interface Handlers {
  submit(intent: Intent): void;
  setMode(mode: ActionMode): void;
}

export class ControlModal {
  private headEl!: HTMLElement;
  private minEl!: HTMLButtonElement;
  private noteEl!: HTMLElement;
  /** [1] 고유기술 물음. 판 한가운데에 뜨므로 패널이 아니라 별도 자리에 그린다 */
  private promptEl!: HTMLElement;
  private listEl!: HTMLElement;
  private buttonsEl!: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();

  private mode: ActionMode = 'idle';
  private pending: Pending | null = null;
  /** 대상을 고르고 확정을 기다리는 중 */
  private confirm: PendingConfirm | null = null;
  private lastKey = '';
  /** 최소화 상태. 사용자가 접으면 턴이 바뀌어도 접힌 채로 둔다 (29쪽) */
  private minimized = false;
  /**
   * 상대 차례라 **저절로** 접혀 있다 (기획자 지적 2026-08-13).
   *
   * 상대 차례에는 누를 것이 없는데 패널이 판을 가린다 — 그것도 하필 지금 무슨 일이
   * 일어나는지 봐야 할 때다. 사용자가 손으로 접은 것(`minimized`)과 구분해 두어야
   * 내 차례가 왔을 때 **원래 상태로** 돌아간다.
   *
   * 「턴 넘기기」가 열리면 풀린다 — 눌러야 할 것이 생겼는데 접혀 있으면 안 된다.
   */
  private autoMin = false;
  /** 상대 제어가 새로 시작됐는가 — **저절로 접는** 시점을 잡는 데만 쓴다 */
  private opponentSince = false;

  // ── 턴 단위 클라이언트 상태 ──────────────────────────────────
  // 엔진에는 없는, "이번 턴에 사용자가 무엇을 골랐나"뿐이다. 턴이 바뀌면 전부 초기화된다.
  private turnKey = '';
  /** 「아니오」를 눌렀다 — 고유기술 물음을 이번 턴에는 다시 띄우지 않는다 */
  private skillDismissed = false;
  /** 제자리를 눌렀다 — 이동하지 않고 행동 단계로 넘어간다. **엔진에는 보내지 않는다** */
  private stayed = false;
  private listOpen = false;

  constructor(
    private readonly root: HTMLElement,
    /** 판 한가운데의 물음 자리 (pptx 23쪽) */
    private readonly promptHost: HTMLElement,
    private readonly tip: StatusPopup,
    private readonly on: Handlers,
  ) {
    root.replaceChildren();
    promptHost.replaceChildren();
    root.classList.add('panel');

    const head = add(root, 'div', 'cmd-head');
    this.headEl = add(head, 'span', 'cmd-who');
    // 최소화 — 「좌상/우상단이면 위로, 좌하/우하단이면 아래로 붙어서」는 자리(data-y)가
    // 이미 정해 놓았다. 여기서는 높이만 접으면 그대로 그 방향으로 붙는다.
    this.minEl = document.createElement('button');
    this.minEl.className = 'cmd-min';
    this.minEl.dataset.action = 'minimize';
    this.minEl.addEventListener('click', () => {
      // 상대 차례에 저절로 접힌 것을 펴려는 것이라면 그 자동 접힘만 푼다 —
      // 「펼치기」를 눌렀는데 아무 일도 안 일어나면 버튼이 고장 난 것처럼 보인다.
      if (this.autoMin) this.autoMin = false;
      else this.minimized = !this.minimized;
      this.syncMinimized();
    });
    head.appendChild(this.minEl);

    this.noteEl = add(root, 'div', 'cmd-note');
    this.listEl = add(root, 'div', 'cmd-list');
    this.buttonsEl = add(root, 'div', 'cmd-buttons');

    // 손잡이는 머리띠(`.cmd-head`) — 최소화 버튼은 `draggable.ts`가 알아서 제외한다
    makeDraggable(root, '.cmd-head');

    this.promptEl = add(promptHost, 'div', 'ctl-prompt');
    this.promptEl.classList.add('hidden');

    // 「이동」은 **제자리 대기를 무르는 자리**로만 남는다 (2026-08-12 확정) —
    // 실제로 움직인 뒤에는 사라진다. 아래 `showMine` 참조.
    // 「종료」는 「대기」로 이름만 바뀌었고 의도는 그대로 `endTurn`이다.
    //
    // **키보드 단축키는 두지 않는다** (2026-08-26 기획자 지정) — 모바일과 동등한
    // 조작만 남긴다. 눌러야 할 것은 전부 이 버튼들뿐이다.
    this.button('move', '이동', '제자리 대기를 무르고 다시 갈 칸을 고른다');
    this.button('attack', '공격', '공격 범위를 보고 적을 고른다');
    this.button('castTactic', '책략', '습득한 책략을 시전한다');
    this.button('meditate', '명상', 'MP +1 — 턴을 마친다');
    this.button('endTurn', '대기', '행동 없이 턴을 마친다');
    this.button('cancel', '취소', '고르던 것을 무른다');
    // 공격 범위 안에 적이 없을 때 유일하게 남는 버튼 (2026-08-12 기획자 지정)
    this.button('back', '뒤로', '이전 커맨드로 돌아간다');
    this.button('forceSkipTurn', '턴 넘기기', '상대가 제어 마감을 넘겼다');

    this.syncMinimized();
  }

  private button(action: string, label: string, hint: string): void {
    const el = document.createElement('button');
    el.textContent = label;
    el.title = hint;
    el.dataset.action = action;      // 스모크 테스트가 이 이름으로 찾는다
    el.addEventListener('click', () => this.press(action));
    this.buttonsEl.appendChild(el);
    this.buttons.set(action, el);
  }

  /** 패널이 설 사분면. `ui/panelSlot.ts`가 제어권 기물을 피해 고른 것을 씬이 넘겨 준다. */
  place(slot: Slot): void {
    applySlot(this.root, slot);
  }

  /** 지금 접혀 있는가 — 손으로 접었거나, 상대 차례라 저절로 접혔거나 */
  private get folded(): boolean { return this.minimized || this.autoMin; }

  private syncMinimized(): void {
    this.root.classList.toggle('min', this.folded);
    this.minEl.textContent = this.folded ? '▢' : '—';
    this.minEl.title = this.folded ? '펼치기' : '최소화';
  }

  // ── 조작 ─────────────────────────────────────────────────────

  private press(action: string): void {
    if (action === 'cancel' || action === 'back') { this.cancel(); return; }
    if (action === 'move') {
      // 제자리 대기를 무른다 — 이동 단계로 되돌아간다. 엔진에 보낼 것은 없고,
      // `movePhase()`가 다시 참이 되면서 패널이 물러나고 이동 범위가 살아난다.
      this.cancel();
      this.stayed = false;
      this.lastKey = '';
      return;
    }
    if (action === 'attack') {
      // **공격 범위는 「공격」을 눌러야 뜬다** (2026-08-12 확정). 예전에는 아무 모드도
      // 아닐 때 이동 범위와 공격 범위가 함께 떠서, 무엇을 고르는 중인지가 흐려졌다.
      this.cancelAim();
      this.setMode(this.mode === action ? 'idle' : action);
      return;
    }
    if (action === 'castTactic') { this.toggleTacticList(); return; }
    this.cancel();
    this.on.submit({ t: action } as Intent);
  }

  private cancel(): void {
    this.cancelAim();
    this.listOpen = false;
    this.listEl.replaceChildren();
    this.setMode('idle');
  }

  private cancelAim(): void {
    this.pending = null;
    this.confirm = null;
    this.lastKey = '';
  }

  /**
   * 카메라가 지금 비춰야 하는 기물. 없으면 씬의 기본 규칙을 따른다.
   *
   * 확정을 기다리는 동안에는 **대상**을 비춘다 — 무엇에 거는지 보여 주고 묻는 것이
   * 확인창의 목적이다. 확정하거나 취소하면 다시 시전자로 돌아간다.
   */
  get cameraFocus(): UnitId | null {
    const t = this.confirm?.candidate.target;
    return typeof t === 'string' ? t : null;
  }

  /** 조준 중인데 **칸**을 골라야 하는가 — 그때는 판 전체가 보여야 누를 수 있다 */
  get aimingTiles(): boolean { return this.pending?.tiles === true; }

  /** 보드에서 의도가 만들어졌거나 턴이 끝났을 때 씬이 불러 모드를 되돌린다 */
  setMode(mode: ActionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.on.setMode(mode);
    this.lastKey = '';
  }

  get currentMode(): ActionMode { return this.mode; }

  /**
   * 지금이 **이동 단계**인가 — 판에 이동 범위만 뜨고 커맨드 패널은 아직 없는 구간.
   *
   * 씬이 하이라이트·카메라·패널 자리를 정하는 데 함께 쓰므로 매 프레임 새로 계산한다.
   * 캐시해 두면 「패널은 떴는데 이동 범위도 남아 있는」 어긋난 프레임이 생긴다.
   *
   * **갈 곳이 하나도 없으면 이동 단계가 아니다.** 「경직」·포위로 이동 후보가 0이면
   * 판을 눌러 넘어갈 방법이 없어 화면이 그대로 멈춘다.
   */
  movePhase(state: BattleState, side: Side | null): boolean {
    const active = state.activeUnit;
    const turn = state.activeTurn;
    if (!side || !active || !turn) return false;
    if (turn.moved || turn.acted || this.stayed || this.mode !== 'idle') return false;
    return legalMovesFor(state, active).some((to) => validate(state, side, { t: 'move', to }).ok);
  }

  /**
   * 제자리 대기 — 이동하지 않고 행동 단계로 넘어간다.
   *
   * **엔진에 보낼 의도가 없다.** 이동은 원래 해도 되고 안 해도 되는 단계라
   * "안 한다"를 선언하는 `Intent`가 룰에 없다. 여기서 하는 일은 이동 범위를 걷고
   * 커맨드 패널을 띄우는 것뿐이다.
   */
  confirmStay(): void {
    this.stayed = true;
    this.lastKey = '';
  }

  /** 제자리 대기를 골랐는가 */
  get staying(): boolean { return this.stayed; }

  // ── 조준 ─────────────────────────────────────────────────────

  /** 지금 조준 중인 후보 칸들. 씬이 이 목록을 그대로 칠한다. */
  aimCandidates(_state: BattleState): Vec2[] {
    return this.pending?.candidates.map((c) => c.pos) ?? [];
  }

  /** 보드에서 칸을 눌렀다. */
  aimAt(state: BattleState, cell: Vec2, unitId: UnitId | null): void {
    const p = this.pending;
    if (!p) return;
    const hit = p.candidates.find((c) =>
      (typeof c.target === 'string' ? c.target === unitId : samePos(c.pos, cell)));
    if (!hit) {
      this.noteEl.textContent = `${p.label} — 고를 수 없는 칸입니다`;
      return;
    }
    this.take(hit);
  }

  /**
   * **카드**로 대상을 골랐다 (2026-08-12 기획자 지정).
   *
   * 책략 대상은 판 반대편까지 퍼지는데 시전 중에는 카메라가 시전자에 붙어 있어서,
   * 판 위의 그 기물이 화면 밖일 수 있다 — 안 보이는 것은 누를 수도 없다.
   * 카드는 판 바깥이라 언제나 눌리므로 **이쪽이 정식 경로**다.
   */
  aimAtUnit(state: BattleState, unitId: UnitId): void {
    const p = this.pending;
    if (!p) return;
    const hit = p.candidates.find((c) => c.target === unitId);
    if (!hit) {
      this.noteEl.textContent = `${p.label} — 고를 수 없는 대상입니다`;
      this.lastKey = '';
      return;
    }
    this.take(hit);
  }

  /**
   * 후보 하나를 골랐다.
   *
   * 책략은 곧바로 쏘지 않고 **확정을 묻는다** — 무엇에 거는지 보여 주고, 환술이면
   * 발동 확률까지 알려 준 다음이다. 고유기술은 이미 23쪽 물음창을 거쳤으므로 바로 쏜다
   * (한 행동에 확인창이 둘이면 그저 성가시다).
   */
  private take(hit: Candidate): void {
    const p = this.pending!;
    if (p.kind === 'tactic') {
      this.confirm = { tactic: p.tactic!, candidate: hit };
      this.lastKey = '';
      return;
    }
    this.cancel();
    this.on.submit({ t: 'castUniqueSkill', target: hit.target });
  }

  /** 확인창의 [확정] */
  private commitCast(): void {
    const c = this.confirm;
    if (!c) return;
    this.cancel();
    this.on.submit({ t: 'castTactic', tactic: c.tactic, target: c.candidate.target });
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
      ? pickTacticName(tacticById.get(tactic!)!)
      : skillById.get(officerById.get(unit.officer)!.uniqueSkill!)!.name;
    const effects = kind === 'tactic'
      ? (tacticById.get(tactic!)?.effects as never[] ?? [])
      : (skillById.get(officerById.get(unit.officer)!.uniqueSkill!)?.effects as never[] ?? []);

    // 고유기술은 물음을 닫고 나서 쏜다. 시전과 동시에 연출이 판을 덮고 그동안 갱신이
    // 멈추므로, 여기서 안 걷으면 물음창이 연출 뒤에 그대로 남는다.
    if (kind === 'unique') this.dismissPrompt();

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
    this.listOpen = false;
    this.listEl.replaceChildren();
    this.pending = { kind, tactic, label, candidates, tiles: aimingSpec(effects)!.kind === 'tile' };
    this.setMode('aim');
    this.noteEl.textContent = this.pending.tiles
      ? `${label} — 칸을 고르세요 (Esc 취소)`
      : `${label} — 대상을 고르세요. 카드를 눌러도 됩니다 (Esc 취소)`;
  }

  /**
   * 시전 확인창 — 대상 위에 뜬다 (2026-08-12 기획자 지정).
   *
   * 「거는 책략 이름 · 효과 · 발동 확률」 셋을 알리고 [확정]/[취소]를 받는다. 환술·지원
   * 둘 다 확률이 있다(2026-08-31부터 지원책도 100% 확정이 아니다).
   * **확률은 엔진의 `illusionChance()`가 낸다** — 화면이 공식을 다시 적으면 바뀌었을 때
   * 조용히 어긋난다.
   *
   * 자리는 **대상의 반대쪽 띠**다. 카메라가 대상을 비추고 있으므로 한가운데에 띄우면
   * 정작 무엇에 거는지가 가려진다.
   */
  private renderConfirm(state: BattleState, caster: UnitState): void {
    const c = this.confirm!;
    const box = add(this.promptHost, 'div', 'cast-confirm');
    const at = this.renderTacticConfirm(state, caster, box, c);

    const rowEl = add(box, 'div', 'ask-buttons');
    const no = document.createElement('button');
    no.textContent = '취소';
    no.dataset.action = 'cancelCast';
    // 취소도 **다시 그릴 계기**를 만들어야 한다 — 상태가 안 바뀌므로 씬이 스스로는 모른다.
    // `setMode`는 씬에 알림이 가는 유일한 통로라, 같은 모드로 불러도 되도록 한 번 비틀어 쓴다.
    no.addEventListener('click', () => {
      this.confirm = null;
      this.lastKey = '';
      this.on.setMode(this.mode);
    });
    const yes = document.createElement('button');
    yes.textContent = '확정';
    yes.dataset.action = 'commitCast';
    yes.addEventListener('click', () => this.commitCast());
    rowEl.append(no, yes);

    // 대상을 가리지 않도록 반대쪽 띠에 놓는다 (커맨드/상태 패널의 자리 규칙과 같은 결)
    this.promptHost.dataset.y = at.y < FORMULA.board.rows / 2 ? 'bottom' : 'top';
  }

  /** 책략 확인창의 속 — 「이름 · 대상 · 효과 · 발동 확률」 */
  private renderTacticConfirm(
    state: BattleState, caster: UnitState, box: HTMLElement,
    c: { tactic: TacticId; candidate: Candidate },
  ): Vec2 {
    const def = tacticById.get(c.tactic)!;
    const targetId = typeof c.candidate.target === 'string' ? c.candidate.target : undefined;
    const target = targetId ? state.units[targetId] : undefined;
    const chance = illusionChance(state, caster.id, c.tactic, targetId);

    add(box, 'div', 'ask').textContent = `「${pickTacticName(def)}」`;
    const targetOfficer = target ? officerById.get(target.officer) : undefined;
    add(box, 'div', 'ask-sub').textContent = target
      ? `${targetOfficer ? pickOfficerName(targetOfficer) : ''} [${target.piece}] 에게 · MP ${tacticMpCost(caster, c.tactic)}`
      : `${c.candidate.pos.x + 1}, ${c.candidate.pos.y + 1} 칸 · MP ${tacticMpCost(caster, c.tactic)}`;
    add(box, 'div', 'ask-text').textContent = pickTacticText(def);
    if (chance !== null) {
      const row = add(box, 'div', 'ask-rate');
      row.dataset.level = chance >= 80 ? 'high' : chance >= 40 ? 'mid' : 'low';
      row.append(spanOf('k', '발동 확률'), spanOf('v', `${chance}%`));
    }
    return target?.pos ?? c.candidate.pos;
  }

  /**
   * 카드 스트립의 고유기술 버튼이 부른다 (pptx 27쪽).
   *
   * 물음창(23쪽)과 **같은 길로 들어간다** — 조준 흐름을 한 번 더 구현하지 않기 위해서다.
   * 지금 그 유닛이 제어권을 쥐고 있지 않으면 발동할 수 없으므로(엔진 규칙), 그때는
   * 대신 기술 설명을 띄운다. 카드는 그 경우 상태 표시등일 뿐이다.
   */
  castUnique(state: BattleState, side: Side | null, unitId: UnitId): void {
    const unit = state.units[unitId];
    if (!unit) return;
    const skill = skillById.get(officerById.get(unit.officer)?.uniqueSkill ?? '');
    const castable = side !== null && state.activeUnit === unitId
      && (validate(state, side, { t: 'castUniqueSkill' }).ok
        || this.candidatesFor(state, side, unit, 'unique').length > 0);

    if (castable) { this.begin(state, side!, unit, 'unique'); return; }
    if (skill) {
      const casterOfficer = officerById.get(unit.officer);
      this.tip.showRaw('skill', `「${skill.name}」`, skill.text,
        `${casterOfficer ? pickOfficerName(casterOfficer) : ''} · 고유기술 · SP ${skill.spCost}`
        + (unit.uniqueSkillUses > 0 ? '' : ' · 이미 사용함'));
    }
  }

  /** 고유기술 물음을 이번 턴에는 끝낸다 (「아니오」를 눌렀거나 실제로 쐈거나) */
  private dismissPrompt(): void {
    this.skillDismissed = true;
    this.promptEl.replaceChildren();
    this.promptEl.classList.add('hidden');
    this.lastKey = '';
  }

  private toggleTacticList(): void {
    this.listOpen = !this.listOpen;
    if (!this.listOpen) this.listEl.replaceChildren();
    this.lastKey = '';
  }

  // ── 갱신 ─────────────────────────────────────────────────────

  /**
   * @param busy 연출이 도는 중인가 (`Playback.busy`).
   *
   * **연출 중에는 패널이 물러난다** (2026-08-12 기획자 지적). 공격 대상을 고른 뒤에도
   * 턴이 실제로 넘어가는 것은 연출이 끝난 뒤라, 그동안 `phase`는 여전히 `awaitingInput`이다.
   * 그대로 두면 패널이 **공격 직후에 한 번 더 떴다가** 사라져 두 번 깜빡인다.
   * 고를 것이 없는 구간이므로 띄울 이유도 없다.
   */
  refresh(
    state: BattleState, side: Side | null, phase: PlaybackPhase, busy = false,
    /**
     * 지금 단계가 끝나기까지 **남은 초** — 판정 주체가 실어 보낸 값이다.
     * 제어 단계에서는 이것이 0이 되는 순간 상대에게 `[턴 넘기기]`가 열린다.
     * `null`이면 마감이 없다(오프라인 — 혼자 두는 판에서 20초를 재면 생각할
     * 시간을 뺏을 뿐 지킬 상대가 없다).
     */
    deadlineSec: number | null = null,
  ): void {
    const unit = state.activeUnit ? state.units[state.activeUnit] : undefined;
    const mine = phase === 'awaitingInput' && !busy;
    const opponent = phase === 'aiThinking' && !!unit;

    // 턴이 바뀌면 이번 턴에만 유효했던 선택(아니오·제자리·조준·책략 목록)을 전부 버린다
    const turnKey = `${unit?.id ?? ''}|${state.time}`;
    if (turnKey !== this.turnKey) {
      this.turnKey = turnKey;
      this.skillDismissed = false;
      this.stayed = false;
      this.pending = null;
      this.listOpen = false;
      this.listEl.replaceChildren();
      if (this.mode !== 'idle') this.setMode('idle');
    }

    // 상대 차례에는 **저절로 접는다** (기획자 지적 2026-08-13) — 누를 것이 없는데
    // 패널이 판을 가린다. 상대 차례가 **새로 시작할 때마다** 다시 접는다:
    // 한 번 펴 두면 그 차례에는 펴진 채로 두되, 다음 차례에 그대로 물려주지 않는다.
    if (opponent) {
      if (!this.opponentSince) {
        this.opponentSince = true;
        this.autoMin = true;
        this.syncMinimized();
      }
    } else {
      this.opponentSince = false;
      if (this.autoMin) { this.autoMin = false; this.syncMinimized(); }
    }

    // 이동 단계에는 패널이 뜨지 않는다 — 판에 이동 범위만 두고, 갈 칸을 고르게 한다
    const moving = mine && this.movePhase(state, side);

    const key = `${phase}|${busy}|${side}|${unit?.id}|${JSON.stringify(state.activeTurn)}|${state.time}`
      + `|${this.mode}|${this.skillDismissed}|${this.stayed}|${this.listOpen}|${moving}`
      + `|${this.confirm ? `${this.confirm.tactic}:${String(this.confirm.candidate.target)}` : ''}`
      + `|${unit ? `${unit.hp}/${unit.mp}/${unit.at}` : ''}`;
    if (key === this.lastKey && !opponent) return;
    this.lastKey = key;

    this.root.classList.toggle('hidden', moving || (!mine && !opponent));
    // 고유기술 물음(23쪽)은 패널이 아니라 판 한가운데에 뜨므로 이동 단계에도 살아 있다
    if (mine && unit && side) this.showMine(state, side, unit);
    else if (opponent && unit) this.showOpponent(state, side, unit, deadlineSec);
    else this.promptEl.classList.add('hidden');
  }

  private showMine(state: BattleState, side: Side, unit: UnitState): void {
    const officer = officerById.get(unit.officer)!;
    // 이름·능력치·상태는 **카드 스트립과 상태 팝업이 맡는다** (27·28쪽).
    // 여기는 "지금 누구를 조작하는가" 한 줄이면 된다.
    this.headEl.textContent = `${pickOfficerName(officer)} · ${unit.piece}`;
    this.headEl.dataset.grade = officer.grade;

    // 판 한가운데 자리는 「고유기술 물음」과 「시전 확인창」이 나눠 쓴다.
    // 둘이 동시에 뜰 일은 없다 — 조준 중에는 물음이 걷힌다.
    for (const el of [...this.promptHost.children]) if (el !== this.promptEl) el.remove();
    if (this.confirm) {
      this.promptEl.replaceChildren();
      this.promptEl.classList.add('hidden');
      this.renderConfirm(state, unit);
      this.listEl.replaceChildren();
      for (const [, el] of this.buttons) el.classList.add('hidden');
      this.noteEl.textContent = '';
      this.root.classList.add('aiming');
      return;
    }
    delete this.promptHost.dataset.y;

    // ── [1] 고유기술을 먼저 묻는다 (GDD §3.4 · pptx 23쪽) ──
    const canCastUnique = validate(state, side, { t: 'castUniqueSkill' }).ok
      || this.candidatesFor(state, side, unit, 'unique').length > 0;
    const asking = canCastUnique && !this.skillDismissed && this.mode !== 'aim';
    this.promptEl.replaceChildren();
    this.promptEl.classList.toggle('hidden', !asking);
    if (asking) {
      const skill = skillById.get(officer.uniqueSkill!)!;
      add(this.promptEl, 'div', 'ask').textContent = `「${skill.name}」`;
      add(this.promptEl, 'div', 'ask-sub').textContent = `${pickOfficerName(officer)} · 고유기술 · SP ${skill.spCost}`;
      add(this.promptEl, 'div', 'ask-text').textContent = skill.text;
      add(this.promptEl, 'div', 'ask-q').textContent = '발동하시겠습니까?';
      const rowEl = add(this.promptEl, 'div', 'ask-buttons');
      const hold = document.createElement('button');
      hold.textContent = '아니오';
      hold.dataset.action = 'holdUniqueSkill';
      hold.addEventListener('click', () => this.dismissPrompt());
      const fire = document.createElement('button');
      fire.textContent = '예';
      fire.dataset.action = 'castUniqueSkill';
      fire.addEventListener('click', () => this.begin(state, side, unit, 'unique'));
      rowEl.append(hold, fire);
    }

    // ── 책략 목록 — 패널 안을 덮고 뜬다 ──
    this.listEl.replaceChildren();
    if (this.listOpen && this.mode !== 'aim') {
      for (const id of unit.tactics) {
        const def = tacticById.get(id)!;
        const usable = this.candidatesFor(state, side, unit, 'tactic', id).length > 0
          || validate(state, side, { t: 'castTactic', tactic: id }).ok;
        const el = document.createElement('button');
        el.className = 'tactic';
        el.dataset.tactic = id;
        el.disabled = !usable;
        el.title = pickTacticText(def);
        el.append(
          spanOf('nm', pickTacticName(def)),
          spanOf('mp', `MP ${tacticMpCost(unit, id)}`),
        );
        el.addEventListener('click', () => this.begin(state, side, unit, 'tactic', id));
        this.listEl.appendChild(el);
      }
      if (unit.tactics.length === 0) {
        add(this.listEl, 'div', 'empty').textContent = '습득한 책략이 없다';
      }
    }

    // ── 커맨드 (29쪽에서 「이동」이 빠진 넷) ──
    const can = (intent: Intent): boolean => validate(state, side, intent).ok;
    const aiming = this.mode === 'aim';
    const turn = state.activeTurn;
    /*
     * **「이동」은 아직 실제로 움직이지 않았을 때만 남는다** (2026-08-12 확정).
     *
     * 제자리 대기는 화면만의 상태라 무를 수 있어야 한다 — 실수로 눌렀는데 되돌릴 길이
     * 없으면 엔진은 이동을 허용하는데 화면에 통로가 없는 함정이 된다.
     * 반대로 한 번 움직인 뒤에는 엔진이 거부하므로 자리조차 두지 않는다.
     */
    const undoStay = !turn?.moved && this.stayed;

    /*
     * 「공격」은 **대상이 없어도 눌린다** — 의도가 아니라 **보기 전환**이라서다.
     * 대상이 있을 때만 열면 "내 사거리가 어디까지인가"를 볼 방법이 아예 없어진다.
     *
     * 다만 **눌러 보니 적이 없을 때는 「뒤로」 하나만 남긴다** (2026-08-12 기획자 지정) —
     * 안내문만 띄우고 다른 버튼을 그대로 두면 「공격이 될 것 같은데 안 된다」로 읽힌다.
     * 계약은 그대로다: 실제로 칠 수 있는 적은 여전히 `validate()`가 고른다.
     */
    const canHit = legalTargetsFor(state, unit.id).some((id) => can({ t: 'attack', targets: [id] }));
    const deadEnd = this.mode === 'attack' && !canHit;

    const enabled: Record<string, boolean> = {
      move: !aiming && undoStay,
      attack: !aiming,
      castTactic: !aiming && unit.tactics.length > 0,
      meditate: !aiming && can({ t: 'meditate' }),
      endTurn: !aiming && can({ t: 'endTurn' }),
      cancel: aiming || this.listOpen,
      back: deadEnd,
      forceSkipTurn: false,
    };
    /** 이 구간에서는 이것 하나만 남긴다 — 조준 중이면 「취소」, 막다른 공격이면 「뒤로」 */
    const only = aiming ? 'cancel' : deadEnd ? 'back' : null;
    for (const [action, el] of this.buttons) {
      el.disabled = !enabled[action];
      el.classList.toggle('on', this.mode === action || (action === 'castTactic' && this.listOpen));
      el.classList.toggle('hidden', action === 'forceSkipTurn'
        || (action === 'cancel' && !enabled['cancel'])
        || (action === 'back' && !enabled['back'])
        || (action === 'move' && !undoStay)
        || (only !== null && action !== only));
    }
    // 접어 두면 그만큼 판이 드러난다 — 고를 것이 하나뿐인 구간이라 자리를 비운다
    this.root.classList.toggle('aiming', aiming || deadEnd);

    if (!aiming) {
      this.noteEl.textContent = asking ? '고유기술을 먼저 고르세요'
        : this.mode === 'attack' ? (canHit ? '공격 범위 안의 적을 고르세요' : '공격 범위 안에 적이 없다')
        : turn?.moved ? '이동을 마쳤다 — 공격·책략·명상·대기'
        : undoStay ? '제자리 대기 — 「이동」으로 무를 수 있습니다'
        : '';
    }
  }

  private showOpponent(
    state: BattleState, side: Side | null, unit: UnitState, deadlineSec: number | null,
  ): void {
    const officer = officerById.get(unit.officer)!;
    this.headEl.textContent = `상대가 〈${pickOfficerName(officer)}〉을 제어 중`;
    delete this.headEl.dataset.grade;
    this.promptEl.replaceChildren();
    this.promptEl.classList.add('hidden');
    this.listEl.replaceChildren();

    /*
     * **마감은 판정 주체가 준다** — 화면이 20초를 다시 재지 않는다(파일 머리).
     * 「자기 차례는 넘길 수 없다」 같은 판정은 그대로 엔진에 묻고, 서버는
     * `controlStartedAtMs`로 한 번 더 막는다.
     */
    const over = deadlineSec === 0;
    const allowed = over && side !== null && validate(state, side, { t: 'forceSkipTurn' }).ok;

    /*
     * **누른 횟수를 단추에 적는다** (§5-67) — 「(2/3)」. 누르면 승리에 가까워지는
     * 단추가 아무 말도 안 하면 「눌리는데 아무 일도 없다」의 반대쪽 함정이 된다.
     * 세는 곳은 엔진 하나(`state.skips`)다 — 화면이 따로 세면 언젠가 어긋난다.
     */
    const skipBtn = this.buttons.get('forceSkipTurn');
    if (skipBtn && side) {
      skipBtn.textContent = `턴 넘기기 (${state.skips[side]}/${SKIP_TO_WIN})`;
    }
    // 누를 것이 생겼으면 편다 — 접힌 패널은 버튼을 감춘다
    if (allowed && this.autoMin) { this.autoMin = false; this.syncMinimized(); }
    for (const [action, el] of this.buttons) {
      const isSkip = action === 'forceSkipTurn';
      el.classList.toggle('hidden', !isSkip);
      el.disabled = !allowed;
    }
    /*
     * **없는 이유를 적는다.** 오프라인에는 제어 마감이 없어 이 단추가 영영 안
     * 열리는데, 아무 말도 없으면 「고장인가」가 남는다 — 45쪽에서 [다시 찾기]가
     * 왜 없는지 적은 것과 같은 자리다.
     */
    this.noteEl.textContent = deadlineSec === null ? 'AI 대전에는 제어 마감이 없습니다'
      : over ? `${SKIP_TO_WIN}번 넘기면 승리합니다`
      : `${deadlineSec}초 뒤 넘길 수 있습니다`;
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
