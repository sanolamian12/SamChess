/**
 * 전투 씬 — 보드 · 유닛 타일 · 입력 (GDD §3.10)
 *
 * 2차 범위: 보드 + 초상화 타일 + HP/MP/WT 바 + 이동/공격 하이라이트.
 * 배지 4종 · 제어 모달 · 시전 UI는 아직이다. 상단 HUD는 `ui/hud.ts`가 맡는다.
 *
 * 이 씬은 **판정을 하지 않는다.** 클릭을 `Intent`로 바꿔 `Playback`에 넘길 뿐이고,
 * 무엇이 가능한지는 전부 룰 엔진에게 묻는다(`legalMovesFor` / `legalTargetsFor`).
 * 서버 권위 구조를 클라이언트에서도 그대로 지키기 위함이다.
 */

import Phaser from 'phaser';
import { officerById } from '@samchess/data';
import { legalMovesFor, legalTargetsFor } from '@samchess/rules';
import type { BattleState, UnitId, UnitState, Vec2 } from '@samchess/rules';
import {
  BAR_H, BAR_LEFT, BAR_PITCH, BAR_TOP, BAR_W,
  BOARD_H, BOARD_W, CELL_H, CELL_W, COLOR, COLS, ROWS, cellAt, cellCenter,
} from './layout.ts';
import { Playback } from './playback.ts';
import { ActionBar } from '../ui/actionBar.ts';
import { Hud } from '../ui/hud.ts';

/** 유닛 하나의 화면 표현 — 초상화 + 테두리 + 상단 바 3종 */
interface UnitView {
  container: Phaser.GameObjects.Container;
  portrait: Phaser.GameObjects.Image;
  border: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
  mpBar: Phaser.GameObjects.Rectangle;
  wtBar: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

export class BattleScene extends Phaser.Scene {
  private playback!: Playback;
  /** 화면이 그리고 있는 상태. Playback이 갱신해 준다. */
  private state!: BattleState;
  private views = new Map<UnitId, UnitView>();
  private hints!: Phaser.GameObjects.Graphics;
  private selected: UnitId | null = null;
  /** 상단 HUD. Phaser 텍스트로 두면 카메라 줌에 함께 확대·축소돼 읽기 어렵다. */
  private hud!: Hud;
  private actionBar!: ActionBar;

  constructor(private readonly makePlayback: (scene: BattleScene) => Playback) {
    super('battle');
  }

  preload(): void {
    // 전투에 나오는 유닛의 초상화만 불러온다. 260장 전부 받을 이유가 없다.
    for (const officerId of this.registry.get('officerIds') as string[]) {
      this.load.image(`portrait:${officerId}`, `portraits/${officerId}.png`);
    }
  }

  create(): void {
    this.drawBoard();
    this.hints = this.add.graphics().setDepth(5);
    this.playback = this.makePlayback(this);
    this.state = this.playback.state;

    for (const unit of Object.values(this.state.units)) this.createUnitView(unit);

    this.setupCamera();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onClick(p));

    // 이동만 하고 끝낼 수 있어야 한다. 공격 대상이 없고 MP도 가득이면
    // 「턴 종료」 외에 유효한 의도가 하나도 없어 화면이 그대로 멈춘다.
    this.actionBar = new ActionBar(
      document.getElementById('actions')!,
      (intent) => { this.playback.submit(intent); this.syncUnits(); },
    );
    this.hud = new Hud(document.getElementById('hud')!, this.state, this.playback.humanSide);

    // 화면 구성이 끝난 뒤에 진행을 시작한다
    this.playback.start();
    this.syncUnits();
  }

  private lastPhase = '';

  override update(_time: number, delta: number): void {
    this.playback.update(delta);
    // 제어권 획득은 **상태 변경이 아니라 시간 경과**로 일어난다(displayTime이 목표에 닿는 순간).
    // 그래서 onChange만으로는 하이라이트를 다시 그릴 계기가 없다.
    if (this.playback.phase !== this.lastPhase) {
      this.lastPhase = this.playback.phase;
      this.syncUnits();
    }
    // WT 게이지와 시계는 상태가 아니라 **시간**에 따라 움직이므로 매 프레임 갱신한다
    this.syncWaitBars();
    this.refreshStatus();
  }

  // ── 보드 ─────────────────────────────────────────────────────

  private drawBoard(): void {
    const g = this.add.graphics().setDepth(0);

    // 진영 구역을 먼저 칠하고 그 위에 격자를 얹는다
    g.fillStyle(COLOR.campP2, 1).fillRect(0, 0, BOARD_W, 5 * CELL_H);
    g.fillStyle(COLOR.campP1, 1).fillRect(0, BOARD_H - 5 * CELL_H, BOARD_W, 5 * CELL_H);
    g.fillStyle(COLOR.boardDark, 1).fillRect(0, 5 * CELL_H, BOARD_W, BOARD_H - 10 * CELL_H);

    // 체스판처럼 한 칸 걸러 밝게 — 좌표를 눈으로 세기 쉬워진다
    g.fillStyle(COLOR.boardLight, 0.25);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if ((x + y) % 2 === 0) g.fillRect(x * CELL_W, y * CELL_H, CELL_W, CELL_H);
      }
    }

    g.lineStyle(1, COLOR.grid, 0.6);
    for (let x = 0; x <= COLS; x++) g.lineBetween(x * CELL_W, 0, x * CELL_W, BOARD_H);
    for (let y = 0; y <= ROWS; y++) g.lineBetween(0, y * CELL_H, BOARD_W, y * CELL_H);
    g.lineStyle(3, COLOR.grid, 1).strokeRect(0, 0, BOARD_W, BOARD_H);
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    // setBounds를 쓰지 않는다 — 축소해서 보드가 화면보다 작아지면 Phaser가 스크롤을
    // 경계로 끌어당겨 중앙 정렬이 깨진다. 자유 카메라로 두고 중심만 맞춘다.
    cam.setZoom(Math.min(this.scale.width / BOARD_W, this.scale.height / BOARD_H) * 0.92);
    cam.centerOn(BOARD_W / 2, BOARD_H / 2);

    // 휠 줌
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.15, 2));
    });
    // 드래그 스크롤
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown || !this.dragging) return;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    this.input.on('pointerdown', () => { this.dragging = true; });
    this.input.on('pointerup', () => { this.dragging = false; });
  }

  private dragging = false;

  // ── 유닛 ─────────────────────────────────────────────────────

  private createUnitView(unit: UnitState): void {
    const officer = officerById.get(unit.officer)!;
    const key = `portrait:${unit.officer}`;

    const border = this.add.rectangle(0, 0, CELL_W - 4, CELL_H - 4)
      .setStrokeStyle(3, unit.side === 'P1' ? COLOR.p1 : COLOR.p2);
    const portrait = this.add.image(0, 0, this.textures.exists(key) ? key : '__MISSING')
      .setDisplaySize(CELL_W - 10, CELL_H - 10);

    // 바 3종 — HP(초록) · MP(파랑) · WT(회색→흰색). 각 줄에 어두운 바닥을 깔아
    // 게이지가 줄었을 때 "얼마나 비었는지"가 초상화에 묻히지 않게 한다.
    const bars: Phaser.GameObjects.Rectangle[] = [];
    const gauge = (row: number, color: number): Phaser.GameObjects.Rectangle => {
      const y = BAR_TOP + row * BAR_PITCH;
      bars.push(this.add.rectangle(BAR_LEFT, y, BAR_W, BAR_H, COLOR.barBack, 0.75).setOrigin(0, 0.5));
      const bar = this.add.rectangle(BAR_LEFT, y, BAR_W, BAR_H, color).setOrigin(0, 0.5);
      bars.push(bar);
      return bar;
    };
    const hpBar = gauge(0, COLOR.hpFull);
    const mpBar = gauge(1, COLOR.mp);
    const wtBar = gauge(2, COLOR.wtIdle);

    const label = this.add.text(0, CELL_H / 2 - 14, `${officer.name}·${unit.piece[0]}`, {
      fontFamily: 'sans-serif', fontSize: '15px', color: '#ffffff',
      backgroundColor: '#000000aa', padding: { x: 3, y: 1 },
    }).setOrigin(0.5);

    const container = this.add.container(0, 0, [portrait, border, ...bars, label]).setDepth(10);
    this.views.set(unit.id, { container, portrait, border, hpBar, mpBar, wtBar, label });
  }

  /** 권위 상태를 화면에 반영한다. 상태가 바뀔 때마다 호출된다. */
  syncUnits(): void {
    for (const unit of Object.values(this.state.units)) {
      const view = this.views.get(unit.id);
      if (!view) continue;
      if (!unit.alive) { view.container.setVisible(false); continue; }

      const p = cellCenter(unit.pos.x, unit.pos.y);
      view.container.setPosition(p.x, p.y).setVisible(true);

      const ratio = unit.hp / unit.maxHp;
      view.hpBar.width = BAR_W * ratio;
      view.hpBar.fillColor = ratio > 0.34 ? COLOR.hpFull : COLOR.hpLow;
      view.mpBar.width = BAR_W * (unit.maxMp > 0 ? unit.mp / unit.maxMp : 0);

      // 조종당하는 중이면 지휘하는 쪽 색으로 테두리를 바꾼다 (「초선」·「삼고초려」)
      const commander = unit.control
        ? this.state.units[unit.control.by]?.side ?? unit.side
        : unit.side;
      const active = this.state.activeUnit === unit.id;
      view.border.setStrokeStyle(active ? 5 : 3,
        active ? COLOR.selected : commander === 'P1' ? COLOR.p1 : COLOR.p2);
    }
    this.syncWaitBars();
    this.drawHints();
  }

  /**
   * WT 게이지 — **매 프레임** 다시 그린다. 상태 변경이 아니라 시간 경과로 변하기 때문이다.
   *
   * 주의할 점: `advanceTime()`은 다음 제어권까지 한 번에 점프하므로 `unit.wt`는 이미
   * **점프가 끝난 뒤의 값**이다. 그대로 그리면 게이지가 순간이동한다.
   * 화면이 아직 따라잡지 못한 만큼(`state.time − displayTime`)을 되돌려 더해 주면
   * "지금 화면 시각 기준으로 몇 남았나"가 되어 실시간으로 차오른다.
   */
  private syncWaitBars(): void {
    const lag = this.state.time - this.playback.displayTime;
    for (const unit of Object.values(this.state.units)) {
      const view = this.views.get(unit.id);
      if (!view || !unit.alive) continue;

      const remain = Math.max(0, unit.wt + lag);
      // 「경직」·「함정」으로 wtBase를 넘길 수 있다 — 넘치면 그냥 빈 게이지로 둔다
      const filled = 1 - Math.min(1, remain / Math.max(1, unit.wtBase));
      view.wtBar.width = BAR_W * filled;
      view.wtBar.fillColor = remain <= 0
        ? COLOR.wtReady
        : lerpColor(COLOR.wtIdle, COLOR.wt, filled);
    }
  }

  // ── 입력 ─────────────────────────────────────────────────────

  private onClick(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const cell = cellAt(world.x, world.y);
    if (!cell) return;

    const state = this.state;
    const active = state.activeUnit;
    if (this.playback.phase !== 'awaitingInput' || !active) return;

    const clicked = Object.values(state.units).find(
      (u) => u.alive && u.pos.x === cell.x && u.pos.y === cell.y);

    // 공격 가능한 적을 눌렀다
    if (clicked && legalTargetsFor(state, active).includes(clicked.id)) {
      this.playback.submit({ t: 'attack', targets: [clicked.id] });
      this.selected = null;
      return;
    }
    // 갈 수 있는 칸을 눌렀다
    if (!clicked && legalMovesFor(state, active).some((m) => m.x === cell.x && m.y === cell.y)) {
      this.playback.submit({ t: 'move', to: cell });
      return;
    }
    // 그 외에는 선택만 (정보 확인)
    this.selected = clicked?.id ?? null;
    this.drawHints();
  }

  /** 이동 가능 칸(초록)과 공격 가능 대상(빨강)을 칠한다. */
  private drawHints(): void {
    this.hints.clear();
    const state = this.state;
    const active = state.activeUnit;
    if (this.playback.phase !== 'awaitingInput' || !active) return;

    const paint = (cells: Vec2[], color: number) => {
      this.hints.fillStyle(color, 0.28).lineStyle(2, color, 0.9);
      for (const c of cells) {
        this.hints.fillRect(c.x * CELL_W + 3, c.y * CELL_H + 3, CELL_W - 6, CELL_H - 6);
        this.hints.strokeRect(c.x * CELL_W + 3, c.y * CELL_H + 3, CELL_W - 6, CELL_H - 6);
      }
    };
    const turn = state.activeTurn;
    if (turn && !turn.moved && !turn.acted) paint(legalMovesFor(state, active), COLOR.moveHint);
    if (turn && !turn.acted) {
      paint(legalTargetsFor(state, active).map((id) => state.units[id]!.pos), COLOR.attackHint);
    }
  }

  private refreshStatus(): void {
    this.hud.refresh(this.state, this.playback.displayTime, this.playback.phase);
    this.actionBar.refresh(this.state, this.playback.humanSide, this.playback.phase === 'awaitingInput');
  }

  // ── 테스트 하네스 통로 ───────────────────────────────────────
  // 스크린샷만으로는 "클릭이 판정으로 이어졌는가"를 볼 수 없다. tools/smoke_ui.ts가 쓴다.

  get debugPlayback(): Playback { return this.playback; }

  /** 지금 활성 유닛의 이동 가능 칸. 씬이 하이라이트에 쓰는 것과 같은 경로다. */
  debugLegalMoves(): Vec2[] {
    const active = this.state.activeUnit;
    return active && this.playback.phase === 'awaitingInput' ? legalMovesFor(this.state, active) : [];
  }

  /** 지금 화면에 보이는 각 유닛의 잔여 WT. WT 게이지가 쓰는 것과 같은 계산이다. */
  debugWaitTimes(): Record<string, number> {
    const lag = this.state.time - this.playback.displayTime;
    const out: Record<string, number> = {};
    for (const u of Object.values(this.state.units)) {
      if (u.alive) out[u.id] = Math.max(0, u.wt + lag);
    }
    return out;
  }

  /** Playback이 상태를 바꿀 때마다 부른다. */
  onStateChanged(state: BattleState): void {
    this.state = state;
    if (this.views.size > 0) this.syncUnits();
  }
}

/** 두 색을 채널별로 섞는다. WT 게이지가 회색 → 흰색으로 넘어가는 데 쓴다. */
function lerpColor(from: number, to: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const mix = (shift: number): number => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * k) << shift;
  };
  return mix(16) | mix(8) | mix(0);
}
