/**
 * 명령 흐름 — 「명령 → 조준 → 확인 → 제출」의 상태 기계 (전투 UI 개편 4단계, 2026-10-06)
 *
 * 옛 `ControlModal`(977줄)이 흐름과 그리기를 한 몸에 들고 있던 것을 갈랐다. 여기는 **DOM이 없다** —
 * 그리기는 `commandPanel.ts`(왼쪽 `#cmd`)와 `contextPanel.ts`(오른쪽 `#ctx`)가 하고, 둘 다 이 흐름을 읽는다.
 * DOM이 없어서 `node --test`로 한 차례를 통째로 밀어 볼 수 있다(`test/commandFlow.test.ts`).
 *
 * ```
 *  [고유기술 물음] ─사용→ (조준) ─→ 제출          ← 쓸 수 있을 때만, [미사용]이면 이번 차례엔 다시 안 묻는다
 *        │미사용
 *        ▼
 *  [명령 선택] ─이동→ [위치 선택] ─칸→ [확정] → 제출         (2026-10-09 — 칸을 누르면 장수가 미리 걸어가 서고 묻는다)
 *             ─공격→ [대상 선택] ─적→ [확인] → 제출
 *             ─책략→ [목록] → (조준) → [확인] → 제출
 *             ─아이템→ [목록 한 줄] → (조준) → [확인] → 제출
 *             ─명상 / 대기→ [확인] → 제출
 * ```
 *
 * 2026-10-06 기획자 확정(`docs/전투UI개편/설계.md` §3 「4단계 확정 일곱」):
 * **[이동]을 눌러야 이동 범위가 깔린다** · **[공격]은 대상이 없어도 열린다** · **대상 없는 책략·아이템도
 * 확인창을 거친다** · 아이템도 **목록 한 줄**을 거친다 · [취소]는 **한 단계 뒤로**(고유기술 조준의 취소는 물음으로).
 *
 * **켜짐 · 후보 · 숫자는 전부 엔진이 낸다** — `commandsFor` · `castCandidates` · `aimingSpec`.
 * 화면이 「누가 대상이 될 수 있나」를 스스로 판단하면 서버와 조용히 어긋난다. 그래서 판에 칠해진 칸은
 * 곧 엔진이 통과시킨 칸이고, 눌렀는데 거부당하는 일이 원리적으로 없다.
 *
 * 옛 「이동 단계」(차례가 오면 이동 범위가 바로 깔리던 것)와 「제자리 대기」(`stayed`)는 없어졌다 —
 * 이동하지 않으려면 [이동]을 안 누르면 된다.
 */

import {
  aimingSpec, castCandidates, castEffects, castIntent, commandsFor, legalMovesFor, legalTargetsFor,
  usableItemOf, validate,
} from '@samchess/rules';
import type { BattleState, CastKind, Commands, Intent, Side, TacticId, UnitId, Vec2 } from '@samchess/rules';

/** 명령 판의 여섯 칸 (pptx 94쪽 — 이동 · 공격 / 명상 · 책략 / 아이템 · 대기) */
export const COMMANDS = ['move', 'attack', 'meditate', 'castTactic', 'useItem', 'endTurn'] as const;
export type Command = typeof COMMANDS[number];

/** 판 클릭이 무엇으로 해석되는지 — 씬이 하이라이트 · 카메라를 고르는 데 쓴다 */
export type BoardMode = 'idle' | 'move' | 'attack' | 'aim';

/** 조준 중인 것 — 책략 · 아이템 · 고유기술이 같은 길을 쓴다 */
export interface Aim {
  k: 'aim';
  kind: CastKind;
  tactic?: TacticId | undefined;
  /** 칸을 고르는가(함정 등) — 그때는 판 전체를 봐야 누를 수 있다 */
  tiles: boolean;
  /**
   * 대상이 시전자 둘레 몇 칸 안이어야 하는가(「8방향 내 아군 1명」이면 1). 있으면 **[공격]처럼** 고른다 (2026-10-09) —
   * 판 전체로 물러나지 않고, 그 범위를 칠하고, 후보가 없으면 「범위 안에 아군이 없습니다」.
   */
  radius?: number | undefined;
  /** 누구를 고르는가 — 후보가 없을 때의 문장이 갈린다 */
  side?: 'ally' | 'enemy' | undefined;
  /** 엔진이 통과시킨 후보. 칸이면 `Vec2`, 장수면 `UnitId` */
  targets: (Vec2 | UnitId)[];
}

/** 확인창에 올라간 것 */
export type Confirm =
  /** 이동 — 칸을 누르면 장수가 미리 걸어가 서고(씬의 미리보기) 확정을 묻는다. [취소]면 출발점으로 (2026-10-09) */
  | { k: 'move'; to: Vec2 }
  | { k: 'attack'; target: UnitId }
  | { k: 'cast'; kind: 'tactic' | 'item'; tactic?: TacticId | undefined; target?: Vec2 | UnitId | undefined }
  | { k: 'meditate' }
  | { k: 'endTurn' };

export type Step =
  | { k: 'menu' }
  | { k: 'move' }
  | { k: 'attack' }
  | { k: 'list'; kind: 'tactic' | 'item' }
  | Aim
  /** `back`은 [취소]가 돌아갈 자리이자, 확인창이 떠 있는 동안 판 클릭이 해석되는 자리다 */
  | { k: 'confirm'; c: Confirm; back: Step };

/** 판을 누른 결과. `handled`가 거짓이면 씬이 살펴보기로 넘긴다 */
export interface Pick { handled: boolean; intent?: Intent }

const MENU: Step = { k: 'menu' };
const UNHANDLED: Pick = { handled: false };
const HANDLED: Pick = { handled: true };

export class CommandFlow {
  private stepNow: Step = MENU;
  /** [미사용]을 눌렀거나 이미 쐈다 — 이번 차례에는 고유기술을 다시 묻지 않는다 */
  private dismissed = false;
  private turnKey = '';
  /** 흐름이 바뀔 때마다 오른다 — 판들이 「다시 그릴까」를 이것으로 안다 */
  private ver = 0;

  get step(): Step { return this.stepNow; }
  get version(): number { return this.ver; }

  private go(step: Step): void {
    this.stepNow = step;
    this.ver++;
  }

  /**
   * 매 갱신 첫머리에 부른다 — **차례가 바뀌면** 이번 차례에만 유효했던 선택을 전부 버린다.
   * 이동 · 시전 지연 없는 고유기술은 시각을 안 바꾸므로 같은 차례로 남는다.
   */
  sync(state: BattleState): void {
    const key = `${state.activeUnit ?? ''}|${state.time}`;
    if (key === this.turnKey) return;
    this.turnKey = key;
    this.dismissed = false;
    this.go(MENU);
  }

  /** 이 진영의 명령 칸 — 제어권이 없으면 `null` */
  commands(state: BattleState, side: Side | null): Commands | null {
    return side ? commandsFor(state, side) : null;
  }

  /**
   * 지금 「고유기술을 쓰시겠습니까?」를 묻는가 (확정 5).
   *
   * **쓸 수 있게 되는 순간** 묻는다 — 이동한 뒤에야 사거리에 대상이 들어오면 그때 뜬다(옛 물음과 같다).
   * 명령을 고르는 중(목록 · 조준 · 확인)에는 끼어들지 않는다.
   */
  asking(state: BattleState, side: Side | null): boolean {
    if (this.stepNow.k !== 'menu' || this.dismissed) return false;
    return this.commands(state, side)?.unique === true;
  }

  /** 명령 칸마다 켜짐 — 엔진의 `commandsFor`를 그대로. [공격]만 「열 수 있는가」(`attackOpen`)다 */
  enabled(state: BattleState, side: Side | null): Record<Command, boolean> {
    const c = this.commands(state, side);
    return {
      move: c?.move ?? false,
      attack: c?.attackOpen ?? false,
      meditate: c?.meditate ?? false,
      castTactic: c?.castTactic ?? false,
      useItem: c?.useItemOpen ?? false,
      endTurn: c?.endTurn ?? false,
    };
  }

  /** 지금 눌려 있는(진행 중인) 명령 칸 */
  get activeCommand(): Command | null {
    const s = this.stepNow.k === 'confirm' ? rootOf(this.stepNow) : this.stepNow;
    switch (s.k) {
      case 'move': return 'move';
      case 'attack': return 'attack';
      case 'list': return s.kind === 'tactic' ? 'castTactic' : 'useItem';
      case 'aim': return s.kind === 'tactic' ? 'castTactic' : s.kind === 'item' ? 'useItem' : null;
      case 'confirm': return s.c.k === 'meditate' ? 'meditate' : s.c.k === 'endTurn' ? 'endTurn' : null;
      default: return null;
    }
  }

  /** 판 클릭이 해석되는 자리. 확인창이 떠 있으면 그 뒤의 자리(다른 대상을 누르면 바꿔 고른다) */
  get boardMode(): BoardMode {
    const s = this.stepNow.k === 'confirm' ? this.stepNow.back : this.stepNow;
    return s.k === 'move' ? 'move' : s.k === 'attack' ? 'attack' : s.k === 'aim' ? 'aim' : 'idle';
  }

  /** 칸을 고르는 조준인가 — 판 전체가 보여야 누를 수 있다 */
  get aimingTiles(): boolean {
    const s = this.stepNow.k === 'confirm' ? this.stepNow.back : this.stepNow;
    return s.k === 'aim' && s.tiles;
  }

  /** 조준 후보 칸 — 씬이 이 목록을 그대로 칠한다 */
  aimCells(state: BattleState): Vec2[] {
    const s = this.stepNow.k === 'confirm' ? this.stepNow.back : this.stepNow;
    if (s.k !== 'aim') return [];
    return s.targets.flatMap((t) => {
      if (typeof t !== 'string') return [t];
      const u = state.units[t];
      return u ? [u.pos] : [];
    });
  }

  /** 확정을 기다리는 이동의 도착 칸 — 씬이 장수를 거기 미리 세운다 */
  get pendingMove(): Vec2 | null {
    return this.stepNow.k === 'confirm' && this.stepNow.c.k === 'move' ? this.stepNow.c.to : null;
  }

  /** 지금 조준이 둘레 몇 칸 안으로 묶였는가 — 있으면 카메라가 판 전체로 물러나지 않는다 */
  get aimRadius(): number | null {
    const s = this.stepNow.k === 'confirm' ? this.stepNow.back : this.stepNow;
    return s.k === 'aim' && s.radius !== undefined ? s.radius : null;
  }

  /** 확인창이 겨누는 장수 — 카메라가 비춘다(무엇에 거는지 보여 주고 묻는 것이 확인창의 목적이다) */
  get cameraFocus(): UnitId | null {
    if (this.stepNow.k !== 'confirm') return null;
    const c = this.stepNow.c;
    const t = c.k === 'attack' ? c.target : c.k === 'cast' ? c.target : undefined;
    return typeof t === 'string' ? t : null;
  }

  // ── 누름 ─────────────────────────────────────────────────────

  /** 명령 칸을 눌렀다. 눌려 있는 칸을 다시 누르면 명령 선택으로 돌아간다 */
  press(cmd: Command, state: BattleState, side: Side | null): void {
    if (!this.enabled(state, side)[cmd]) return;
    if (this.activeCommand === cmd) { this.go(MENU); return; }
    switch (cmd) {
      case 'move': this.go({ k: 'move' }); return;
      case 'attack': this.go({ k: 'attack' }); return;
      case 'castTactic': this.go({ k: 'list', kind: 'tactic' }); return;
      case 'useItem': this.go({ k: 'list', kind: 'item' }); return;
      case 'meditate': this.go({ k: 'confirm', c: { k: 'meditate' }, back: MENU }); return;
      case 'endTurn': this.go({ k: 'confirm', c: { k: 'endTurn' }, back: MENU }); return;
    }
  }

  /** 목록에서 책략 하나를 골랐다 */
  pickTactic(state: BattleState, side: Side | null, tactic: TacticId): void {
    if (!side || this.stepNow.k !== 'list') return;
    if (!this.commands(state, side)?.tactics[tactic]) return;
    this.begin(state, side, 'tactic', tactic);
  }

  /** 목록에서 아이템(한 줄)을 골랐다 */
  pickItem(state: BattleState, side: Side | null): void {
    if (!side || this.stepNow.k !== 'list') return;
    if (!this.commands(state, side)?.useItemOpen) return;
    this.begin(state, side, 'item');
  }

  /** 고유기술 [사용]. 조준이 없으면 바로 쏜다 — [사용]이 곧 확인이다(한 행동에 확인창 둘은 성가시다) */
  useUnique(state: BattleState, side: Side | null): Intent | null {
    if (!side || !this.asking(state, side)) return null;
    const aim = this.aimFor(state, side, 'unique');
    if (aim) { this.go(aim); return null; }
    this.dismissed = true;
    this.go(MENU);
    return castIntent('unique', undefined);
  }

  /** 고유기술 [미사용] */
  skipUnique(): void {
    this.dismissed = true;
    this.go(MENU);
  }

  /** [취소] — **한 단계 뒤로.** 고유기술 조준을 무르면 물음으로 돌아간다(확정 7) */
  cancel(): void {
    const s = this.stepNow;
    switch (s.k) {
      case 'confirm': this.go(s.back); return;
      case 'aim': this.go(s.kind === 'unique' ? MENU : { k: 'list', kind: s.kind }); return;
      default: this.go(MENU);
    }
  }

  /** 확인창의 [확인] */
  commit(): Intent | null {
    if (this.stepNow.k !== 'confirm') return null;
    const c = this.stepNow.c;
    this.go(MENU);
    switch (c.k) {
      case 'move': return { t: 'move', to: c.to };
      case 'attack': return { t: 'attack', targets: [c.target] };
      case 'cast': return castIntent(c.kind, c.tactic, c.target);
      case 'meditate': return { t: 'meditate' };
      case 'endTurn': return { t: 'endTurn' };
    }
  }

  /**
   * 판의 칸을 눌렀다. 확인창이 떠 있으면 그 뒤의 자리로 해석한다 — 다른 후보를 누르면 대상을 바꾼다.
   * 후보가 아닌 곳은 `handled: false`로 돌려 씬이 살펴보기를 띄운다(조준 중은 예외 — 아래).
   */
  pickCell(state: BattleState, side: Side | null, cell: Vec2, unitId: UnitId | null): Pick {
    const active = state.activeUnit;
    if (!side || !active) return UNHANDLED;
    const s = this.stepNow.k === 'confirm' ? this.stepNow.back : this.stepNow;

    if (s.k === 'move') {
      const to = legalMovesFor(state, active).find((m) => m.x === cell.x && m.y === cell.y);
      if (!unitId && to && validate(state, side, { t: 'move', to }).ok) {
        this.go({ k: 'confirm', c: { k: 'move', to: { ...to } }, back: s });
        return HANDLED;
      }
      return UNHANDLED;
    }
    if (s.k === 'attack') {
      if (unitId && legalTargetsFor(state, active).includes(unitId)
        && validate(state, side, { t: 'attack', targets: [unitId] }).ok) {
        this.go({ k: 'confirm', c: { k: 'attack', target: unitId }, back: s });
        return HANDLED;
      }
      return UNHANDLED;
    }
    if (s.k === 'aim') {
      const hit = s.targets.find((t) =>
        (typeof t === 'string' ? t === unitId : t.x === cell.x && t.y === cell.y));
      return hit === undefined ? UNHANDLED : this.take(s, hit);
    }
    return UNHANDLED;
  }

  /**
   * 장수를 직접 골랐다 — 순서 판의 줄(2026-10-06 기획자 확정 4: 조준 중이면 **후보일 때 대상 지정**).
   * 옛 카드 줄이 하던 일이다: 판 반대편의 대상도 판을 안 거치고 고를 수 있다.
   */
  pickUnit(unitId: UnitId): Pick {
    const s = this.stepNow.k === 'confirm' ? this.stepNow.back : this.stepNow;
    if (s.k !== 'aim') return UNHANDLED;
    return s.targets.includes(unitId) ? this.take(s, unitId) : UNHANDLED;
  }

  // ── 안쪽 ─────────────────────────────────────────────────────

  private take(aim: Aim, target: Vec2 | UnitId): Pick {
    if (aim.kind === 'unique') {
      this.dismissed = true;
      this.go(MENU);
      return { handled: true, intent: castIntent('unique', undefined, target) };
    }
    this.go({ k: 'confirm', c: { k: 'cast', kind: aim.kind, tactic: aim.tactic, target }, back: aim });
    return HANDLED;
  }

  /** 조준이 필요하면 조준 단계를, 필요 없으면 `null` */
  private aimFor(state: BattleState, side: Side, kind: CastKind, tactic?: TacticId): Aim | null {
    const unit = state.units[state.activeUnit!]!;
    const spec = aimingSpec(castEffects(unit, kind, tactic));
    if (!spec) return null;
    const near = spec.kind === 'allyOne' || spec.kind === 'enemyOne' ? spec.withinRadius : undefined;
    return {
      k: 'aim', kind, tactic, tiles: spec.kind === 'tile',
      targets: castCandidates(state, side, unit.id, kind, tactic),
      radius: near,
      side: spec.kind === 'allyOne' ? 'ally' : spec.kind === 'enemyOne' ? 'enemy' : undefined,
    };
  }

  /** 목록에서 고른 뒤 — 조준이 필요하면 조준, 아니면 곧장 확인창(확정 2) */
  private begin(state: BattleState, side: Side, kind: 'tactic' | 'item', tactic?: TacticId): void {
    if (kind === 'item' && !usableItemOf(state.units[state.activeUnit!]!)) return;
    const aim = this.aimFor(state, side, kind, tactic);
    // 대상 없이 열어도 되는 것은 둘레가 정해진 조준뿐이다 — 나머지는 엔진이 통과시켜야 한다
    if (kind === 'item' && !this.commands(state, side)?.useItem && aim?.radius === undefined) return;
    const list: Step = { k: 'list', kind };
    this.go(aim ?? { k: 'confirm', c: { k: 'cast', kind, tactic }, back: list });
  }
}

/** 확인창이 겹겹이 올라가 있으면 맨 처음 자리 */
function rootOf(step: Step): Step {
  return step.k === 'confirm' && step.back.k !== 'menu' ? rootOf(step.back) : step;
}
