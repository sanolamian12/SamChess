/**
 * 전투 씬 — 보드 · 유닛 타일 · 입력 (GDD §3.10)
 *
 * 2차 범위: 보드 + 초상화 타일 + HP/MP/WT 바 + 배지 4종 + 이동/공격/조준 하이라이트.
 * 상단 HUD는 `ui/hud.ts`, 제어 모달과 시전 흐름은 `ui/controlModal.ts`가 맡는다.
 *
 * 이 씬은 **판정을 하지 않는다.** 클릭을 `Intent`로 바꿔 `Playback`에 넘길 뿐이고,
 * 무엇이 가능한지는 전부 룰 엔진에게 묻는다(`legalMovesFor` / `legalTargetsFor`).
 * 서버 권위 구조를 클라이언트에서도 그대로 지키기 위함이다.
 */

import Phaser from 'phaser';
import { officerById } from '@samchess/data';
import { STATUS_META, attackCells, deployZone, legalMovesFor, legalTargetsFor } from '@samchess/rules';
import type { BattleEvent, BattleState, UnitId, UnitState, Vec2 } from '@samchess/rules';
import {
  BADGE, BAR_H, BAR_LEFT, BAR_PITCH, BAR_TOP, BAR_W,
  BOARD_H, BOARD_W, CELL_H, CELL_W, COLOR, COLS, LABEL, ROWS, cellAt, cellCenter,
} from './layout.ts';
import { Playback } from './playback.ts';
import { FRAME_SIZE, POSE, PoseDirector } from './poses.ts';
import { CameraRig, SCALE_FIT, SCALE_FOCUS, viewOf, type CameraCue } from './camera.ts';
import { ControlModal, type ActionMode } from '../ui/controlModal.ts';
import { CardStrip } from '../ui/cardStrip.ts';
import { Hud } from '../ui/hud.ts';
import { InspectPanel } from '../ui/inspectPanel.ts';
import { SystemLog } from '../ui/systemLog.ts';
import { SkillFx } from '../ui/skillFx.ts';
import { StatusPopup } from '../ui/statusPopup.ts';
import { PrepPanel } from '../ui/prepPanel.ts';
import { FocusToggle } from '../ui/focusToggle.ts';
import { commandSlot, mirror } from '../ui/panelSlot.ts';
import { describeEvents } from '../ui/eventText.ts';
import { skillById } from '@samchess/data';

/** 판 전체를 보는 큐. 「100% 확대 비율」의 기본 상태다 (pptx 28쪽) */
const FIT_CUE: CameraCue = { from: 0, scale: SCALE_FIT, cell: null };

/**
 * 이만큼 끌어야 「화면을 직접 옮긴다」로 친다.
 *
 * 클릭 한 번에도 손은 1~2px 흔들린다. 문턱이 없으면 그 흔들림이 자동 카메라를 꺼 버린다.
 */
const DRAG_THRESHOLD_PX = 8;

/** 유닛 하나의 화면 표현 — 초상화 + 테두리 + 상단 바 3종 + 배지 4종 */
interface UnitView {
  container: Phaser.GameObjects.Container;
  /** 액션 시트의 한 칸. 칸 번호는 `poses.ts`의 `POSE` */
  portrait: Phaser.GameObjects.Sprite;
  border: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
  mpBar: Phaser.GameObjects.Rectangle;
  wtBar: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  /** 좌상 — 고유기술 상태 · 좌하 — 급+레벨 · 우상/우하 — 버프/디버프 점 */
  skillBadge: Phaser.GameObjects.Arc;
  gradeBadge: Phaser.GameObjects.Text;
  dots: Phaser.GameObjects.Graphics;
}

export class BattleScene extends Phaser.Scene {
  private playback!: Playback;
  /** 화면이 그리고 있는 상태. Playback이 갱신해 준다. */
  private state!: BattleState;
  private views = new Map<UnitId, UnitView>();
  /** 액션 칸 연출. 이벤트를 읽어 「누가 몇 ms 동안 어떤 칸을」을 정한다 */
  private poses = new PoseDirector();
  /** 배지가 마지막으로 센 값 — 스모크 테스트가 엔진 상태와 대조한다 */
  private badgeCounts = new Map<UnitId, { grade: string; buffs: number; debuffs: number }>();
  /** 칸을 채우는 하이라이트. 유닛(depth 10) **아래**에 깔린다 */
  private hints!: Phaser.GameObjects.Graphics;
  /**
   * 칸 테두리. 유닛 **위**(depth 15)에 그린다.
   *
   * 채우기만 쓰면 유닛이 서 있는 칸은 초상화가 그대로 덮어 하이라이트가 사라진다 —
   * 그런데 공격 대상과 책략 조준 후보는 **정확히 유닛이 서 있는 칸**이다.
   * 그래서 테두리는 위층에 따로 그린다.
   */
  private marks!: Phaser.GameObjects.Graphics;
  /** 좌표 눈금 — 첫 행의 `A`~`Y`와 첫 열의 `1`~`20` */
  private labels: Phaser.GameObjects.Text[] = [];
  private selected: UnitId | null = null;
  /** 상단 HUD 한 줄. Phaser 텍스트로 두면 카메라 줌에 함께 확대·축소돼 읽기 어렵다. */
  private hud!: Hud;
  private modal!: ControlModal;
  /** 판 위·아래의 캐릭터 카드 (pptx 27쪽) */
  private cards!: CardStrip;
  /** 상태 팝업 — 제어권과 무관하게 아무 기물이나 눌러 볼 수 있다 (GDD §3.9 · pptx 28쪽) */
  private inspect!: InspectPanel;
  /** 시스템 대화창 — 판 한가운데 말풍선 (pptx 27쪽) */
  private log!: SystemLog;
  /** 고유기술 발동 연출. 재생 중에는 판이 멈춘다 (pptx 24쪽) */
  private fx!: SkillFx;
  /** 상태이상 배지를 눌렀을 때의 설명 팝업 */
  private tip!: StatusPopup;
  /** 배치·정찰 패널 — 전투가 시작되면 물러난다 */
  private prep!: PrepPanel;
  /** 자동 포커싱 토글 — 판 왼쪽 위의 반투명 버튼 */
  private focus!: FocusToggle;
  /** 보드 클릭을 무엇으로 읽을지. 모달의 `[이동]`·`[공격]`이 바꾼다. */
  private actionMode: ActionMode = 'idle';

  constructor(
    private readonly makePlayback: (scene: BattleScene) => Playback,
    /** 승부가 나면 한 번 부른다. 보상·전적은 이 상태에서 계산한다 */
    private readonly onFinish?: (state: BattleState) => void,
  ) {
    super('battle');
  }

  preload(): void {
    // 전투에 나오는 유닛의 그림만 불러온다. 260명 전부 받을 이유가 없다.
    //
    // **액션 시트를 `spritesheet`로 읽는다.** 110² 다섯 칸이 가로로 붙어 있고
    // Phaser가 로드 시점에 한 번 잘라 준다 — 상태 전환은 `setFrame(n)`이라
    // 텍스처 교체가 없다. 5개 파일로 쪼개면 요청이 5배가 되고 애니메이션도
    // 직접 짜야 한다 (`tools/build_action_sheets.py` 참조).
    for (const officerId of this.registry.get('officerIds') as string[]) {
      this.load.spritesheet(`act:${officerId}`, `actions/${officerId}.png`,
        { frameWidth: FRAME_SIZE, frameHeight: FRAME_SIZE });
    }
  }

  create(): void {
    this.drawBoard();
    this.hints = this.add.graphics().setDepth(5);
    this.marks = this.add.graphics().setDepth(15);
    this.playback = this.makePlayback(this);
    this.state = this.playback.state;

    for (const unit of Object.values(this.state.units)) this.createUnitView(unit);

    this.setupCamera();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onClick(p));
    // 확대해서 헤맬 때 판 전체로 돌아오는 통로
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyF') this.resetView(); });

    const side = this.playback.humanSide;
    this.tip = new StatusPopup(document.getElementById('tip')!);
    // 「항복」은 전체 기록 안에 있다 (pptx 27쪽). 관전(양쪽 AI)이면 낼 의도가 없어 뺀다.
    this.log = new SystemLog(
      document.getElementById('log')!, document.getElementById('history')!,
      side ? () => { this.playback.submit({ t: 'surrender' }); this.syncUnits(); } : null,
    );
    this.fx = new SkillFx(document.getElementById('fx')!);

    // 「대기」(= endTurn)가 없으면 게임이 멈춘다. 공격 대상이 없고 MP도 가득이면
    // 유효한 의도가 그것 하나뿐이라, 잠기는 순간 화면이 그대로 선다.
    this.modal = new ControlModal(
      document.getElementById('control')!,
      document.getElementById('dialog')!,
      this.tip,
      {
        submit: (intent) => { this.playback.submit(intent); this.syncUnits(); },
        setMode: (mode) => { this.actionMode = mode; this.drawHints(); },
      },
    );
    this.hud = new Hud(
      document.getElementById('hud')!, this.state, side, () => this.log.toggleHistory());
    this.cards = new CardStrip(
      document.getElementById('cards-north')!, document.getElementById('cards-south')!,
      this.state, side,
      {
        pick: (unitId) => {
          // 조준 중이면 카드가 **대상 지정**이 된다 (2026-08-12 기획자 지정) —
          // 판 위의 그 기물은 확대된 화면 밖일 수 있어 누를 수 없다.
          if (this.actionMode === 'aim') { this.modal.aimAtUnit(this.state, unitId); return; }
          // 그 밖에는 그 기물로 카메라가 옮겨 가고 상태 팝업이 뜬다 (pptx 28쪽)
          const next = this.selected === unitId ? null : unitId;
          this.selectUnit(next);         // 여기서 cardFocus가 풀리므로
          this.cardFocus = next;         // 카드로 고른 것만 다시 세운다 (순서를 바꾸지 말 것)
        },
        skill: (unitId) => this.modal.castUnique(this.state, side, unitId),
      },
    );
    this.inspect = new InspectPanel(
      document.getElementById('inspect')!, this.tip, side, () => this.selectUnit(null));
    // 자동 포커싱을 껐다 켜는 통로. 화면을 한 번 건드리면 수동으로 넘어가는데,
    // 그 사실과 돌아가는 길이 화면에 없으면 "그 뒤로 줌인이 안 된다"로만 보인다.
    this.focus = new FocusToggle(document.getElementById('focus')!, () => {
      if (this.manual) this.resetView();      // 자동으로 되돌리고 판 전체부터 다시 잡는다
      else this.manual = true;                // 화면을 사용자에게 넘긴다 (지금 자리 그대로)
    });
    this.prep = new PrepPanel(document.getElementById('prep')!, {
      ready: () => { this.playback.submitReady(); this.syncUnits(); },
      begin: () => { this.playback.beginBattle(); this.syncUnits(); },
    });

    // 화면 구성이 끝난 뒤에 진행을 시작한다
    this.playback.start();
    this.syncUnits();
  }

  private lastPhase = '';
  /** 지난 프레임에 연출이 돌고 있었는가 */
  private posing = false;
  /** 승부는 났고, 대화창이 마저 나가기를 기다리는 중 */
  private finishing = false;

  override update(_time: number, delta: number): void {
    // 고유기술 연출 중에는 **판을 멈춘다** — 시간도 흐르지 않고 입력도 받지 않는다.
    // 고유기술은 턴을 소비하지 않으므로(GDD §3.4) 연출이 끝나면 곧바로 이동·행동이 이어진다.
    if (this.fx.active) {
      this.fx.update(delta);
      this.log.update(delta);
      // 배너가 판을 덮고 있는 동안에도 카메라는 시전자 쪽으로 다가간다 —
      // 걷혔을 때 이미 그 자리를 보고 있어야 무슨 일이 일어났는지 읽힌다.
      this.syncCamera(delta);
      return;
    }
    this.playback.update(delta);
    this.poses.update(delta);
    this.log.update(delta);
    // 연출 중에는 자세·좌표가 매 프레임 바뀐다. **끝난 프레임에도 한 번 더** 그린다 —
    // 마지막 자세를 평상으로 되돌리고 퇴각한 유닛을 치우는 것이 그 프레임이다.
    if (this.poses.busy || this.posing) this.syncUnits();
    this.posing = this.poses.busy;
    // 제어권 획득은 **상태 변경이 아니라 시간 경과**로 일어난다(displayTime이 목표에 닿는 순간).
    // 그래서 onChange만으로는 하이라이트를 다시 그릴 계기가 없다.
    if (this.playback.phase !== this.lastPhase) {
      this.lastPhase = this.playback.phase;
      // 차례가 넘어가면 고르던 모드는 의미가 없다. 남겨 두면 다음 유닛이
      // 「공격」 모드로 시작해 이동 하이라이트가 안 보인다.
      this.modal.setMode('idle');
      this.syncUnits();
      // 승부가 났다. 남은 대화가 다 나간 뒤에 알린다 — 결과 화면이 곧바로 덮으면
      // 마지막 한 방이 무엇이었는지 볼 겨를이 없다.
      if (this.playback.phase === 'finished') this.finishing = true;
    }
    if (this.finishing && this.log.pending === 0) {
      this.finishing = false;
      this.onFinish?.(this.state);
    }
    // WT 게이지와 시계는 상태가 아니라 **시간**에 따라 움직이므로 매 프레임 갱신한다
    this.syncWaitBars();
    this.refreshStatus();
    // 카메라는 마지막에 — 이 프레임의 선택·연출 상태를 다 반영한 뒤에 목표를 정한다
    this.syncCamera(delta);
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

    this.drawCoordLabels();
  }

  /**
   * 첫 행에 열 이름(`A`~`Y`), 첫 열에 행 번호(`1`~`20`)를 적는다.
   *
   * 시스템 대화창이 쓰는 칸 이름과 **같은 규약**이라, "조운이 이동했다 (A3 → E3)"를 읽고
   * 판에서 그 칸을 짚을 수 있다.
   *
   * **유닛 위(depth 16)에 그린다.** 배치 구역이 위아래 5행이라 첫 행에는 기물이 서 있기
   * 마련이고, 아래에 깔면 초상화에 그대로 덮여 눈금이 사라진다. 대신 글자를 작게 두고
   * 검은 외곽선을 둘러 기물을 가리지 않게 한다.
   */
  private drawCoordLabels(): void {
    const style = {
      fontFamily: 'ui-monospace, Consolas, monospace',
      fontSize: `${LABEL.fontPx}px`,
      color: COLOR.label,
    };
    for (let x = 0; x < COLS; x++) {
      this.labels.push(this.add
        .text(x * CELL_W + CELL_W / 2, LABEL.pad, String.fromCharCode(65 + x), style)
        .setOrigin(0.5, 0).setDepth(16).setStroke('#000000', 8));
    }
    for (let y = 0; y < ROWS; y++) {
      this.labels.push(this.add
        .text(LABEL.pad, y * CELL_H + CELL_H / 2, String(y + 1), style)
        .setOrigin(0, 0.5).setDepth(16).setStroke('#000000', 8));
    }
    this.syncLabelScale();
  }

  /** 카메라 배율이 바뀌어도 눈금은 화면에서 같은 크기로 남는다 */
  private syncLabelScale(): void {
    const scale = LABEL.sizePx / (LABEL.fontPx * this.cameras.main.zoom);
    for (const t of this.labels) t.setScale(scale);
  }

  // ── 카메라 (pptx 28쪽) ───────────────────────────────────────

  /**
   * 「100% 확대 비율」 = 판 전체가 캔버스에 딱 맞는 배율 (2026-08-12 확정).
   *
   * 캔버스는 게임 프레임의 정사각 칸이고 보드도 2400×2400 정사각이라(셀 96×120 × 25×20),
   * 가로를 맞추면 세로도 맞는다 — 기획 지침 「화면 가로 너비에 맞춰 체스판 크기를 정한다」.
   * 200%는 이 값의 두 배다. 그제서야 셀이 36px대가 되어 타일 위의 바·배지가 읽힌다.
   */
  private get fitZoom(): number {
    return Math.min(this.scale.width / BOARD_W, this.scale.height / BOARD_H);
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    // setBounds를 쓰지 않는다 — 축소해서 보드가 화면보다 작아지면 Phaser가 스크롤을
    // 경계로 끌어당겨 중앙 정렬이 깨진다. 자유 카메라로 두고 중심만 맞춘다.
    // 화면 밖으로 나가지 않게 가두는 일은 `camera.ts`의 `viewOf`가 한다.
    this.resetView();
    // 창 크기가 바뀌면(회전·리사이즈) 트윈 없이 바로 다시 맞춘다.
    // 손으로 확대해 보던 중이면 건드리지 않는다.
    this.scale.on('resize', () => { if (!this.manual) this.rig.snap(this.viewOfCue(FIT_CUE)); });

    // 휠 줌 — 손으로 건드리는 순간 자동 카메라가 물러난다 (F로 되돌린다)
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.manual = true;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.15, 3));
      this.syncLabelScale();
    });
    /*
     * 드래그 스크롤 — **문턱을 넘어야 드래그로 친다.**
     *
     * 문턱이 없으면 그냥 클릭해도 손이 1~2px 흔들리는 순간 `manual`이 서고,
     * 그때부터 자동 카메라가 통째로 죽는다. 「공격할 때 확대가 안 된다」로 나타났다 —
     * 연출 큐는 멀쩡히 만들어지는데 카메라가 그걸 무시하고 있었다.
     * 터치에서는 더 심하다. 손가락은 반드시 몇 px 움직인다.
     */
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown || !this.dragStart) return;
      const far = Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y) >= DRAG_THRESHOLD_PX;
      if (!far && !this.manual) return;
      this.manual = true;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { this.dragStart = { x: p.x, y: p.y }; });
    this.input.on('pointerup', () => { this.dragStart = null; });
  }

  /** 눌린 자리. 여기서 `DRAG_THRESHOLD_PX`를 넘게 끌어야 화면 이동으로 친다 */
  private dragStart: { x: number; y: number } | null = null;
  /** 사용자가 직접 확대·이동했다 — 자동 카메라를 멈춘다. `F`로 되돌아온다. */
  private manual = false;
  private rig = new CameraRig();

  private viewOfCue(cue: CameraCue): ReturnType<typeof viewOf> {
    return viewOf(cue, this.fitZoom, this.scale.width, this.scale.height);
  }

  /**
   * 지금 무엇을 비춰야 하는가. 위에 있는 것이 이긴다.
   *
   * 연출 계획이 최우선인 이유는 그것만이 **시간 축을 가진** 지시이기 때문이다 —
   * 「0.4초 뒤 이 대상을 비춰라」는 아래의 상태 기반 규칙으로는 표현할 수 없다.
   *
   * **고르는 중에는 반드시 판 전체다.** 28쪽에 없는 규칙이지만 없으면 게임이 막힌다 —
   * 200%에서는 판의 4분의 1만 보이는데 이동 후보도 책략 대상도 판 반대편까지 퍼진다.
   * 안 보이는 칸은 누를 수도 없어서, 실제로 「공포」 대상 두 칸이 전부 화면 밖에 있었다.
   * 그래서 `이동`·`공격`·조준을 고르는 동안에는 100%로 물러나 판을 다 보여준다.
   */
  private wantedCue(): CameraCue {
    // 1. 연출 중 — `poses.ts`가 자세와 같은 커서 위에 짜 둔 큐
    if (this.poses.busy) {
      const cue = this.poses.camera.at(this.poses.elapsed);
      if (cue) return cue;
    }
    // 2. 시전 확인창이 떠 있다 — **거는 대상**을 비춘다 (2026-08-12 기획자 지정)
    const confirming = this.modal.cameraFocus ? this.state.units[this.modal.cameraFocus] : undefined;
    if (confirming?.alive) return { from: 0, scale: SCALE_FOCUS, cell: confirming.pos };
    // 3. 카드를 눌러 살펴보는 중 (28쪽 「해당 캐릭터가 있는 위치로 이동하면서 상태 팝업」)
    //    **사용자가 명시적으로 요청한 것**이라 아래의 상황 규칙보다 앞선다.
    //    팝업을 닫으면 곧바로 풀리므로 갇히지 않는다.
    const picked = this.cardFocus ? this.state.units[this.cardFocus] : undefined;
    if (picked?.alive) return { from: 0, scale: SCALE_FOCUS, cell: picked.pos };
    // 4. 판 전체를 봐야 고를 수 있는 구간 — 후보가 판 끝까지 퍼진다
    //    · 이동 단계 (Rock의 이동 후보는 판 반대편까지 간다)
    //    · 칸을 고르는 책략 (「함정」처럼 빈 칸을 찍는 것)
    //    · 배치 (진영 구역 전체를 놓고 자리를 잡는다)
    if (this.playback.phase === 'deploying') return FIT_CUE;
    if (this.modal.aimingTiles) return FIT_CUE;
    if (this.actionMode === 'idle' && this.choosableCells().length > 0) return FIT_CUE;
    // 5. 내 차례 (28쪽 「내 캐릭터의 차례가 되어 포커스를 받았을 때」)
    //    **공격·유닛 조준 중에도 여기 머문다** — 공격 대상은 언제나 인접 칸이라
    //    확대한 채로 다 보이고, 책략 대상은 카드로 고른다 (2026-08-12 기획자 지정).
    if (this.playback.phase === 'awaitingInput' && this.state.activeUnit) {
      const unit = this.state.units[this.state.activeUnit];
      if (unit?.alive) return { from: 0, scale: SCALE_FOCUS, cell: unit.pos };
    }
    // 6. 그 밖 — 판 전체. 상대 차례와 시간 경과가 여기다
    return FIT_CUE;
  }

  /**
   * **카드**로 고른 기물 (28쪽). 판 위의 기물을 누른 것과 구분한다 —
   * 판을 누르는 것은 이동·공격으로 이어지는 조작이라, 그때마다 화면이 확대되면
   * 다음 칸을 고를 수 없게 된다. 28쪽이 확대를 지시한 것도 「카드를 클릭했을 때」다.
   */
  private cardFocus: UnitId | null = null;

  private syncCamera(deltaMs: number): void {
    if (this.manual) return;
    this.rig.target(this.viewOfCue(this.wantedCue()));
    const view = this.rig.update(deltaMs);
    if (!view) return;
    const cam = this.cameras.main;
    cam.setZoom(view.zoom);
    cam.centerOn(view.x, view.y);
    this.syncLabelScale();
  }

  /** 판 전체가 보이도록 되돌린다. 확대해서 헤맬 때 빠져나올 통로다. */
  resetView(): void {
    this.manual = false;
    this.rig.snap(this.viewOfCue(FIT_CUE));
    const view = this.rig.current!;
    this.cameras.main.setZoom(view.zoom);
    this.cameras.main.centerOn(view.x, view.y);
    this.syncLabelScale();
  }

  /** `tools/shot.ts`가 카메라를 직접 잡을 때. 자동 카메라를 비켜 준다. */
  debugFreeCamera(): void { this.manual = true; }

  /** 사용자가 화면을 직접 잡고 있는가 (자동 포커싱 OFF) */
  get debugManualCamera(): boolean { return this.manual; }

  /**
   * 카메라가 목표에 닿았고 연출도 끝났는가. 스모크가 클릭·판정 전에 이걸 기다린다.
   *
   * 둘을 한 값으로 묶는 이유 — 연출이 도는 동안에는 카메라가 **계획 큐**를 따라가므로,
   * 카메라만 멈췄다고 화면이 안정된 것이 아니다(다음 큐에서 또 움직인다).
   */
  get debugCameraSettled(): boolean {
    return !this.poses.busy && !this.fx.active && (this.manual || this.rig.settled);
  }

  // ── 유닛 ─────────────────────────────────────────────────────

  private createUnitView(unit: UnitState): void {
    const officer = officerById.get(unit.officer)!;
    const key = `act:${unit.officer}`;

    const border = this.add.rectangle(0, 0, CELL_W - 4, CELL_H - 4)
      .setStrokeStyle(3, unit.side === 'P1' ? COLOR.p1 : COLOR.p2);
    // 정사각 칸이라 세로에 맞춰 균등 배율로 넣는다. 가로로 조금 넘치는 부분은
    // 무기·이펙트라 투명하고, 옆 칸과 겹쳐 보이는 편이 오히려 자연스럽다.
    const portrait = this.add.sprite(0, 0, this.textures.exists(key) ? key : '__MISSING', POSE.idle)
      .setDisplaySize(CELL_H - 10, CELL_H - 10);

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

    // 배지 4종 (GDD §3.10). 종류가 22가지라 타일에서는 **개수만 점으로** 보여주고,
    // 무엇이 걸렸는지는 제어 모달이 이름으로 적는다 — 기본 줌에서 셀이 30px대로 줄어
    // 글자 배지는 어차피 읽히지 않는다.
    const skillBadge = this.add.circle(BADGE.left + 4, BADGE.top, 4.5, COLOR.skillReady)
      .setStrokeStyle(1, 0x0b0d10).setVisible(false);
    const gradeBadge = this.add.text(BADGE.left, BADGE.bottom, '', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#e8e8e8',
      backgroundColor: '#000000bb', padding: { x: 3, y: 0 },
    }).setOrigin(0, 0.5);
    const dots = this.add.graphics();

    const container = this.add.container(0, 0,
      [portrait, border, ...bars, label, skillBadge, gradeBadge, dots]).setDepth(10);
    this.views.set(unit.id, {
      container, portrait, border, hpBar, mpBar, wtBar, label, skillBadge, gradeBadge, dots,
    });
  }

  /** 권위 상태를 화면에 반영한다. 상태가 바뀔 때마다 호출된다. */
  syncUnits(): void {
    for (const unit of Object.values(this.state.units)) {
      const view = this.views.get(unit.id);
      if (!view) continue;
      // 쓰러진 유닛도 **점멸이 끝날 때까지는 남는다.** 엔진은 이미 죽었다고 하지만
      // 화면은 피격 칸을 세 번 깜빡인 뒤에 치운다 (기획자 확정 2026-08-11).
      if (!unit.alive && !this.poses.isFading(unit.id)) {
        view.container.setVisible(false);
        continue;
      }

      // 이동 연출 중에는 권위 좌표가 아니라 밟고 있는 칸을 보여준다
      const at = this.poses.cellOf(unit.id) ?? unit.pos;
      const p = cellCenter(at.x, at.y);
      view.container.setPosition(p.x, p.y).setVisible(true);
      view.container.setAlpha(this.poses.alphaOf(unit.id));
      view.portrait.setFrame(this.poses.frameOf(unit.id));

      const ratio = unit.hp / unit.maxHp;
      view.hpBar.width = BAR_W * ratio;
      view.hpBar.fillColor = ratio > 0.34 ? COLOR.hpFull : COLOR.hpLow;
      view.mpBar.width = BAR_W * (unit.maxMp > 0 ? unit.mp / unit.maxMp : 0);

      // 조종당하는 중이면 지휘하는 쪽 색으로 테두리를 바꾼다 (「초선」·「삼고초려」)
      const commander = unit.control
        ? this.state.units[unit.control.by]?.side ?? unit.side
        : unit.side;
      // 배치 중에 고른 기물도 제어권자와 같은 금색 테두리로 알린다 — 어느 것을 옮기는
      // 중인지 보이지 않으면 빈 칸을 눌러도 왜 안 가는지 알 수 없다
      const picked = this.state.activeUnit === unit.id || this.deploying === unit.id;
      view.border.setStrokeStyle(picked ? 5 : 3,
        picked ? COLOR.selected : commander === 'P1' ? COLOR.p1 : COLOR.p2);

      this.syncBadges(unit, view);
    }
    this.syncWaitBars();
    this.drawHints();
  }

  /**
   * 배지 4종 — 좌상 고유기술 / 우상 버프 / 좌하 급+레벨 / 우하 디버프 (GDD §3.10).
   *
   * 버프·디버프는 **개수만 점으로** 찍는다. 상태이상이 22종이라 타일에 이름을 넣을 자리가
   * 없고, 기본 줌에서는 셀이 30px대라 글자가 어차피 뭉갠다. 무엇이 걸렸는지는 제어 모달이 맡는다.
   * 버프/디버프 판정은 **엔진의 `STATUS_META`**를 그대로 쓴다 — 화면이 스스로 나누지 않는다.
   */
  private syncBadges(unit: UnitState, view: UnitView): void {
    const officer = officerById.get(unit.officer)!;
    view.gradeBadge.setText(`${officer.grade}${unit.level}`);

    // 좌상 — 고유기술: 아직 쓸 수 있으면 금색, 다 썼으면 회색, 없는 장수면 숨긴다
    const hasSkill = !!officer.uniqueSkill;
    view.skillBadge.setVisible(hasSkill);
    if (hasSkill) {
      view.skillBadge.setFillStyle(unit.uniqueSkillUses > 0 ? COLOR.skillReady : COLOR.skillUsed);
    }

    let buffs = 0;
    let debuffs = 0;
    for (const s of unit.statuses) {
      if (STATUS_META[s.status].kind === 'buff') buffs++;
      else debuffs++;
    }
    // 조종당하는 중이면 디버프 하나로 친다 — 상태이상 배열에는 없고 `control`에 들어간다
    if (unit.control) debuffs++;
    this.badgeCounts.set(unit.id, { grade: `${officer.grade}${unit.level}`, buffs, debuffs });

    view.dots.clear();
    this.paintDots(view.dots, buffs, BADGE.top, COLOR.buff);
    this.paintDots(view.dots, debuffs, BADGE.bottom, COLOR.debuff);
  }

  /** 오른쪽 끝에서 왼쪽으로 점을 찍는다. `dotMax`를 넘으면 마지막 자리를 막대로 바꿔 「더 있음」을 뜻한다. */
  private paintDots(g: Phaser.GameObjects.Graphics, count: number, y: number, color: number): void {
    if (count <= 0) return;
    g.fillStyle(color, 1);
    const shown = Math.min(count, BADGE.dotMax);
    for (let i = 0; i < shown; i++) {
      const x = BADGE.right - i * BADGE.dotGap;
      if (count > BADGE.dotMax && i === shown - 1) g.fillRect(x - 4, y - 1.5, 8, 3);
      else g.fillCircle(x, y, BADGE.dotR);
    }
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
    if (this.fx.active) return;         // 연출 중에는 판이 멈춰 있다
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const cell = cellAt(world.x, world.y);
    if (!cell) return;

    const state = this.state;
    const clicked = Object.values(state.units).find(
      (u) => u.alive && u.pos.x === cell.x && u.pos.y === cell.y);

    // 배치 단계 — 내 기물을 고르고 진영 안 빈 칸으로 옮긴다 (GDD §3.9)
    if (this.playback.phase === 'deploying') {
      this.onDeployClick(cell, clicked?.id ?? null);
      return;
    }
    // 정찰 단계 — 살펴보기만 한다. 양측 다 눌러 볼 수 있다
    if (this.playback.phase === 'scouting') {
      this.selectUnit(clicked?.id ?? null);
      return;
    }

    const active = state.activeUnit;
    if (this.playback.phase !== 'awaitingInput' || !active) return;

    // 책략·고유기술 조준 중이면 보드 클릭은 전부 조준으로 간다
    if (this.actionMode === 'aim') {
      this.modal.aimAt(state, cell, clicked?.id ?? null);
      return;
    }

    // **공격은 「공격」을 누른 뒤에만** (2026-08-12 확정). 예전에는 아무 모드도 아닐 때
    // 이동 범위와 공격 범위가 함께 떠서 무엇을 고르는 중인지가 흐려졌다.
    if (this.actionMode === 'attack') {
      if (clicked && legalTargetsFor(state, active).includes(clicked.id)) {
        this.playback.submit({ t: 'attack', targets: [clicked.id] });
        this.selected = null;
        this.modal.setMode('idle');
      } else {
        this.selectUnit(clicked?.id ?? null);   // 범위 밖을 눌렀으면 살펴보기만
      }
      return;
    }

    // 이동 단계 — 판에 이동 범위만 떠 있고 커맨드 패널은 아직 없다
    if (this.modal.movePhase(state, this.playback.humanSide)) {
      // 제자리를 눌렀다 — 이동하지 않고 행동 단계로 넘어간다 (GDD §3.4 「제자리에 있어도 된다」)
      if (clicked?.id === active) { this.modal.confirmStay(); this.drawHints(); return; }
      if (!clicked && legalMovesFor(state, active).some((m) => m.x === cell.x && m.y === cell.y)) {
        this.playback.submit({ t: 'move', to: cell });
        return;
      }
    }
    // 그 외에는 선택만 — 누른 기물의 정보 팝업을 띄운다 (GDD §3.9 「정찰」)
    this.selectUnit(clicked?.id ?? null);
  }

  /**
   * 배치 단계의 클릭 (GDD §3.9 「진영 내 자유 배치」).
   *
   * 내 기물을 누르면 고르고, 진영 안 빈 칸을 누르면 그 자리로 옮긴다.
   * 남의 기물이나 진영 밖을 누르면 정보만 보여준다.
   *
   * **엔진의 `deploy` 의도는 전원의 자리를 한 번에 받는다.** 한 명만 옮겨도 나머지의
   * 현재 위치까지 함께 보내야 검증을 통과한다 — 부분 배치라는 개념이 룰에 없다.
   */
  private onDeployClick(cell: Vec2, clickedId: UnitId | null): void {
    const side = this.playback.humanSide;
    if (!side || this.state.ready[side]) return;   // 준비를 마쳤으면 더 못 옮긴다

    const clicked = clickedId ? this.state.units[clickedId] : undefined;
    if (clicked?.side === side) {
      // 고른 것을 다시 누르면 해제.
      // **정보 팝업은 띄우지 않는다** — 판 한가운데를 덮어 놓을 자리가 안 보인다.
      // 장수를 살펴보는 것은 다음 단계인 「정찰」이 맡는다 (GDD §3.9).
      this.deploying = this.deploying === clicked.id ? null : clicked.id;
      this.selectUnit(null);
      this.syncUnits();     // 고른 기물에 금색 테두리를 두른다 (하이라이트도 여기서 다시 그린다)
      return;
    }
    if (!this.deploying || clicked) {
      this.selectUnit(clickedId);
      return;
    }

    const placements = Object.values(this.state.units)
      .filter((u) => u.side === side)
      .map((u) => ({ unit: u.id, pos: u.id === this.deploying ? cell : u.pos }));
    if (this.playback.submit({ t: 'deploy', placements })) {
      this.deploying = null;
      this.selectUnit(null);
    }
    this.syncUnits();
  }

  /** 배치 단계에서 고른 내 기물 */
  private deploying: UnitId | null = null;

  /**
   * 상태 팝업을 열고 닫는다. 빈 칸을 누르면 닫힌다.
   *
   * 카메라를 붙여 두는 `cardFocus`는 여기서 **항상 풀린다** — 카드로 고른 경우에만
   * 카드 쪽에서 도로 세운다. 이렇게 두지 않으면 팝업을 닫아도 확대가 남아 갇힌다.
   */
  private selectUnit(unitId: UnitId | null): void {
    this.selected = unitId;
    this.cardFocus = null;
    this.inspect.show(unitId);
    this.drawHints();
  }

  /**
   * 이동 후보(초록) · 공격 범위(옅은 빨강) · 실제 대상(진한 빨강) · 조준 후보(보라)를 칠한다.
   *
   * 하이라이트는 depth 5, 유닛 타일은 depth 10이라 **칸을 칠해도 그 위의 유닛은 가려지지 않는다.**
   * 공격 범위는 대상이 없는 칸까지 칠하므로 더 옅게 둬서 "칠 수 있는 적"과 구분한다.
   */
  private drawHints(): void {
    this.hints.clear();
    this.marks.clear();
    const state = this.state;

    // 채우기는 아래층(유닛에 가려도 되는 정보), 테두리는 위층(가려지면 안 되는 정보)
    const paint = (cells: Vec2[], color: number, alpha = 0.28, line = 2) => {
      this.hints.fillStyle(color, alpha);
      this.marks.lineStyle(line, color, Math.min(1, alpha * 3));
      for (const c of cells) {
        this.hints.fillRect(c.x * CELL_W + 3, c.y * CELL_H + 3, CELL_W - 6, CELL_H - 6);
        this.marks.strokeRect(c.x * CELL_W + 2, c.y * CELL_H + 2, CELL_W - 4, CELL_H - 4);
      }
    };

    // 배치 단계 — 고른 기물이 갈 수 있는 내 진영의 빈 칸을 칠한다
    if (this.playback.phase === 'deploying') {
      const side = this.playback.humanSide;
      if (!side || !this.deploying || state.ready[side]) return;
      const zone = deployZone(state.mode, side);
      const taken = new Set(Object.values(state.units)
        .filter((u) => u.alive && u.id !== this.deploying)
        .map((u) => `${u.pos.x},${u.pos.y}`));
      const cells: Vec2[] = [];
      for (let y = zone.y0; y <= zone.y1; y++) {
        for (let x = zone.x0; x <= zone.x1; x++) {
          if (!taken.has(`${x},${y}`)) cells.push({ x, y });
        }
      }
      paint(cells, COLOR.moveHint, 0.2, 1);
      return;
    }

    const active = state.activeUnit;
    if (this.playback.phase !== 'awaitingInput' || !active) return;
    const unit = state.units[active]!;

    // **한 번에 한 가지만 칠한다** (2026-08-12 확정). 이동 범위와 공격 범위가 함께 뜨면
    // 무엇을 고르는 중인지가 흐려진다 — 지금은 단계가 그것을 정한다.
    if (this.actionMode === 'aim') {
      paint(this.modal.aimCandidates(state), COLOR.aimHint, 0.3);
      return;
    }
    if (this.actionMode === 'attack') {
      // 공격이 닿는 칸 전체를 먼저 옅게 — 적이 없어도 "어디까지 닿는가"가 보여야 한다
      paint(attackCells(unit.piece, unit.pos), COLOR.attackRange, 0.16, 1);
      paint(legalTargetsFor(state, active).map((id) => state.units[id]!.pos), COLOR.attackHint);
      return;
    }
    if (this.modal.movePhase(state, this.playback.humanSide)) {
      paint(legalMovesFor(state, active), COLOR.moveHint);
      paint([unit.pos], COLOR.stayHint, 0.22, 3);   // 제자리 대기
    }
  }

  /**
   * 지금 **눌러야 하는 칸들.** 고르는 중이 아니면 빈 배열.
   *
   * 카메라(전부 보여야 한다)와 패널 자리(가리면 안 된다)가 같은 목록을 본다.
   * 하이라이트를 그리는 `drawHints`와 **같은 단계 판정**을 쓴다 — 화면에 칠해진 칸과
   * 여기가 갈리면 「칠해진 칸 = 누를 수 있는 칸」 계약이 조용히 깨진다.
   */
  private choosableCells(): Vec2[] {
    const state = this.state;
    const active = state.activeUnit;
    if (!active || this.playback.phase !== 'awaitingInput') return [];
    if (this.actionMode === 'aim') return this.modal.aimCandidates(state);
    if (this.actionMode === 'attack') {
      return legalTargetsFor(state, active).map((id) => state.units[id]!.pos);
    }
    if (this.modal.movePhase(state, this.playback.humanSide)) {
      return [...legalMovesFor(state, active), state.units[active]!.pos];
    }
    return [];
  }

  private static center(cells: Vec2[]): Vec2 | null {
    if (cells.length === 0) return null;
    return {
      x: cells.reduce((n, c) => n + c.x, 0) / cells.length,
      y: cells.reduce((n, c) => n + c.y, 0) / cells.length,
    };
  }

  private refreshStatus(): void {
    const side = this.playback.humanSide;
    this.hud.refresh(this.state, this.playback.displayTime, this.playback.phase);
    this.cards.refresh(this.state, this.playback.displayTime);

    // 두 패널의 자리는 **가려서는 안 되는 것을 피해** 정해지고 서로 좌우 대칭이다 (pptx 29쪽).
    // 평소에는 제어권 기물(카메라가 비추는 것)이고, 무언가 고르는 중에는 **후보 칸들**이다 —
    // 패널이 후보를 덮으면 "화면에 칠해져 있는데 눌리지 않는" 칸이 생긴다. 실제로 났다.
    const focus = BattleScene.center(this.choosableCells())
      ?? (this.state.activeUnit ? this.state.units[this.state.activeUnit]?.pos : null);
    const slot = commandSlot(focus);
    this.modal.place(slot);
    this.inspect.place(mirror(slot));
    // 말풍선은 두 패널이 비켜 준 **반대쪽 띠**에 놓는다 — 셋이 겹치지 않는다
    this.log.place(slot.y === 'bottom' ? 'top' : 'bottom');

    this.inspect.refresh(this.state);
    // 연출이 도는 동안에는 패널이 물러난다 — 공격 직후 한 번 더 뜨는 것을 막는다.
    // 턴은 연출이 끝나야 넘어가므로 그때까지 `phase`는 여전히 `awaitingInput`이다.
    this.modal.refresh(this.state, side, this.playback.phase, this.playback.busy);
    this.prep.refresh(this.playback.phase, this.playback.remainingSec,
      side ? this.state.ready[side] : true);
    this.focus.refresh(this.manual);
  }

  // ── 테스트 하네스 통로 ───────────────────────────────────────
  // 스크린샷만으로는 "클릭이 판정으로 이어졌는가"를 볼 수 없다. tools/smoke_ui.ts가 쓴다.

  get debugPlayback(): Playback { return this.playback; }

  /** 지금 활성 유닛의 이동 가능 칸. 씬이 하이라이트에 쓰는 것과 같은 경로다. */
  debugLegalMoves(): Vec2[] {
    const active = this.state.activeUnit;
    return active && this.playback.phase === 'awaitingInput' ? legalMovesFor(this.state, active) : [];
  }

  /** 지금 조준 중인 후보 칸. 화면이 칠하는 것과 같은 목록이다(= 엔진이 통과시킨 칸). */
  debugAimCells(): Vec2[] {
    return this.actionMode === 'aim' ? this.modal.aimCandidates(this.state) : [];
  }

  get debugActionMode(): ActionMode { return this.actionMode; }

  /** 이동 단계인가 — 커맨드 패널이 아직 안 뜨고 판에 이동 범위만 있는 구간 */
  get debugMovePhase(): boolean {
    return this.modal.movePhase(this.state, this.playback.humanSide);
  }

  /** 지금 눌러야 하는 칸들. 하이라이트·카메라·패널 자리가 전부 이걸 본다. */
  debugChoosableCells(): Vec2[] { return this.choosableCells(); }

  /** 타일 배지가 실제로 센 값. 엔진 상태와 어긋나면 화면이 거짓말을 하고 있는 것이다. */
  debugTileBadges(): Record<string, { grade: string; buffs: number; debuffs: number }> {
    return Object.fromEntries(this.badgeCounts);
  }

  /**
   * 유닛 **위**에 그린 테두리의 명령 수. 0이면 "데이터는 있는데 화면에서는 안 보인다"는 뜻이다 —
   * 공격 대상·조준 후보는 유닛이 서 있는 칸이라 채우기만 하면 초상화에 덮인다.
   */
  debugMarkCommands(): number { return this.marks.commandBuffer.length; }

  /** 지금 화면에 보이는 각 유닛의 잔여 WT. WT 게이지가 쓰는 것과 같은 계산이다. */
  debugWaitTimes(): Record<string, number> {
    const lag = this.state.time - this.playback.displayTime;
    const out: Record<string, number> = {};
    for (const u of Object.values(this.state.units)) {
      if (u.alive) out[u.id] = Math.max(0, u.wt + lag);
    }
    return out;
  }

  /** 지금까지 대화창에 나간 줄 — 스모크 테스트가 읽는다 */
  debugLogLines(): string[] { return this.log.lines.map((l) => l.text); }

  /** 카드 스트립이 실제로 그린 상태 — 엔진 상태와 어긋나면 화면이 거짓말을 하는 것이다 */
  debugCards(): ReturnType<CardStrip['debugCards']> { return this.cards.debugCards(); }

  /** 지금 카메라가 겨누는 곳. 100%/200% 규칙이 실제로 도는지 본다 (pptx 28쪽). */
  debugCameraCue(): { scale: number; cell: Vec2 | null } {
    const cue = this.wantedCue();
    return { scale: cue.scale, cell: cue.cell };
  }

  /**
   * Playback이 상태를 바꿀 때마다 부른다.
   *
   * 이벤트는 세 곳으로 간다 — **대화창**(문장으로 풀어 한 줄씩), **연출**(고유기술 배너),
   * **액션 칸**(누가 몇 ms 동안 어떤 자세를). 판정 결과를 화면이 다시 계산하지 않고
   * 엔진이 준 이벤트만 읽는다는 점이 중요하다.
   * 온라인 대전에서 서버가 보내 주는 것이 바로 이 배열이다.
   */
  onStateChanged(state: BattleState, events: readonly BattleEvent[] = []): void {
    this.state = state;
    if (events.length > 0) {
      this.log.push(describeEvents(state, events));
      // 연출에 걸리는 시간만큼 판을 멈춘다. 그러지 않으면 2.4초짜리 공격 위로
      // 다음 유닛의 행동이 겹친다 — 대화창의 「크리티컬!」을 읽을 겨를도 없다.
      this.playback.hold(this.poses.plan(events, state));
      for (const ev of events) {
        if (ev.e !== 'uniqueSkillCast') continue;
        const unit = state.units[ev.unit];
        const skill = skillById.get(ev.skill);
        if (!skill) continue;
        const caster = unit ? officerById.get(unit.officer)?.name ?? '' : '';
        this.fx.play(skill.id, skill.name, caster);
      }
    }
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
