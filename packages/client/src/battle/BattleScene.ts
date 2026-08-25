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
import { VISUAL_EFFECTS, officerById } from '@samchess/data';
import {
  STATUS_META, attackCells, deployZone, forecastAttack, legalMovesFor, legalTargetsFor,
} from '@samchess/rules';
import type { BattleEvent, BattleState, UnitId, UnitState, Vec2 } from '@samchess/rules';
import {
  BADGE, BAR_H, BAR_LEFT, BAR_PITCH, BAR_TOP, BAR_W,
  BOARD_H, BOARD_W, CELL_H, CELL_W, COLOR, COLS, LABEL, ROWS, cellAt, cellCenter,
} from './layout.ts';
import { Playback } from './playback.ts';
import type { RoomClose } from './transport.ts';
import { FRAME_SIZE, POSE, PoseDirector, type SoundCue } from './poses.ts';
import { CameraRig, SCALE_FIT, SCALE_FOCUS, viewOf, type CameraCue } from './camera.ts';
import { PendingRings, SWAP_MS, ringAt, ringUrl, ringsOn } from './visualEffect.ts';
import { TERRAIN_ALPHA, TERRAIN_ART, TERRAIN_SIZE, terrainUrl } from './terrain.ts';
import { ControlModal, type ActionMode } from '../ui/controlModal.ts';
import { BurstFx } from '../ui/burstFx.ts';
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
import { BOARD_MAP_URL } from '../ui/art.ts';
import { playBgm, trackForPhase } from '../audio/bgm.ts';
import { playSfx } from '../audio/sfx.ts';
import { playSkillVoice } from '../audio/skillVoice.ts';
import { skillById } from '@samchess/data';

/** 판 전체를 보는 큐. 「100% 확대 비율」의 기본 상태다 (pptx 28쪽) */
const FIT_CUE: CameraCue = { from: 0, scale: SCALE_FIT, cell: null };

/**
 * 이만큼 끌어야 「화면을 직접 옮긴다」로 친다.
 *
 * 클릭 한 번에도 손은 1~2px 흔들린다. 문턱이 없으면 그 흔들림이 자동 카메라를 꺼 버린다.
 */
const DRAG_THRESHOLD_PX = 8;

/**
 * 지속형 시각 효과 링의 지름 (px, 월드 좌표).
 *
 * 칸이 96×120이고 캐릭터는 110²로 그려진다. 링을 캐릭터보다 조금 크게 잡아야
 * 도넛 구멍에 캐릭터가 들어앉은 것처럼 보인다 — 같으면 테두리가 몸에 겹친다.
 */
const RING_SIZE = 124;

/**
 * 격자선의 **화면** 굵기(px). 월드가 아니라 화면 기준이라 배율이 바뀌면 다시 긋는다
 * (`syncScreenScale`). 판 전체를 보는 배율에서도 칸을 셀 수 있어야 하는 값이다.
 */
const GRID_PX = 1.1;

/** 유닛 하나의 화면 표현 — 링 + 초상화 + 테두리 + 상단 바 3종 + 배지 4종 */
interface UnitView {
  container: Phaser.GameObjects.Container;
  /**
   * 지속형 시각 효과 (2026-08-13). **컨테이너의 첫째 자식**이라 캐릭터 뒤에 깔린다 —
   * 기획자 지시가 「오라 이미지 위에 캐릭터 이미지가 덮는 식」이다.
   * 컨테이너 안에 두는 이유는 이동 연출 때 캐릭터와 **같이 움직여야** 하기 때문이다.
   */
  ring: Phaser.GameObjects.Image;
  /** 액션 시트의 한 칸. 칸 번호는 `poses.ts`의 `POSE` */
  portrait: Phaser.GameObjects.Sprite;
  /** **차례인 기물에게만** 보인다 — 아군 초록 · 적군 빨강 (2026-08-13) */
  border: Phaser.GameObjects.Rectangle;
  /** 판 위에 남은 유일한 게이지. MP·WT는 카드와 상태 팝업이 맡는다 */
  hpBar: Phaser.GameObjects.Rectangle;
  /** 좌상 — 고유기술 상태 · 우상/우하 — 버프/디버프 점 */
  skillBadge: Phaser.GameObjects.Arc;
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
   * 지형 그림 — **칸**이 키다(`"x,y"`). 유닛과 함께 움직이는 링(`UnitView.ring`)과
   * 달리 판에 붙박이라 유닛 컨테이너 밖에 둔다.
   *
   * 깊이는 판(0)과 하이라이트(5) **사이**다 — 이동 후보를 칠하면 지형 위에 얹혀야
   * 「저 칸에 갈 수 있다」가 보이고, 유닛(10)은 그 위에 서 있어야 한다.
   */
  private readonly terrainViews = new Map<string, Phaser.GameObjects.Image>();
  /**
   * 칸 테두리. 유닛 **위**(depth 15)에 그린다.
   *
   * 채우기만 쓰면 유닛이 서 있는 칸은 초상화가 그대로 덮어 하이라이트가 사라진다 —
   * 그런데 공격 대상과 책략 조준 후보는 **정확히 유닛이 서 있는 칸**이다.
   * 그래서 테두리는 위층에 따로 그린다.
   */
  private marks!: Phaser.GameObjects.Graphics;
  /** 조준 중 대상 칸에 얹는 크리티컬 확률 글자. 다시 그릴 때마다 통째로 버린다 */
  private readonly odds: Phaser.GameObjects.Text[] = [];
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
  /**
   * 일회성 시각 효과 — 판 한가운데 4프레임 (2026-08-13).
   *
   * 둘을 따로 두는 이유: 고유기술은 **배너 뒤에** 이어져 판을 멈춘 채 돌고
   * (`SkillFx`가 물고 있다), 책략은 연출 창(1~2초) 안에서 판을 멈추지 않고 돈다.
   */
  private burst!: BurstFx;
  /** 「선공」처럼 즉시 끝나는 WT 보정을 다음 차례까지 붙들어 두는 자리 */
  private readonly pendingRings = new PendingRings();
  /**
   * 링 스왑용 **공용 시계**(ms). 유닛마다 따로 세면 링들이 제각각 갈아 끼워진다 —
   * 자세 연출에서 「유닛마다 시계를 따로 두면 안 된다」로 밟았던 것과 같은 결이다.
   */
  private ringClockMs = 0;
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
    private readonly onFinish?: (state: BattleState, close: RoomClose | null) => void,
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

    // 지속형 시각 효과 링 (`tools/build_status_fx.py`). 23장뿐이라 전부 받는다 —
    // 누가 무엇에 걸릴지는 판이 돌아 봐야 알고, 걸린 뒤에 받으면 한 박자 늦는다.
    // 일회성(`A`~`G`)은 DOM이 배경 그림으로 쓰므로 여기서 받지 않는다.
    for (const vfx of Object.values(VISUAL_EFFECTS.persistent.byStatus)
      .concat(Object.values(VISUAL_EFFECTS.persistent.byAura))
      .concat(Object.values(VISUAL_EFFECTS.persistent.byControl))
      .concat(Object.values(VISUAL_EFFECTS.persistent.byTerrain))
      .concat(VISUAL_EFFECTS.persistent.wtModifier)
      .concat(VISUAL_EFFECTS.persistent.combo.map((c) => c.vfx))) {
      if (!this.textures.exists(`vfx:${vfx}`)) this.load.image(`vfx:${vfx}`, ringUrl(vfx));
    }

    // 지형 그림 3종 (`tools/build_terrain.py`). 링과 같은 이유로 전부 미리 받는다 —
    // 「화계」·「수계」·「수성지주」는 판이 도는 중에 갑자기 칸을 만든다.
    for (const terrain of Object.keys(TERRAIN_ART) as (keyof typeof TERRAIN_ART)[]) {
      this.load.image(`terrain:${terrain}`, terrainUrl(terrain));
    }

    // 판 아래에 깔리는 지도 (`assets/map/chessmap.png`). 없으면 예전처럼
    // 어두운 격자만 뜬다 — `drawBoard()` 참조.
    this.load.image('boardmap', BOARD_MAP_URL);
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
    // 판 전체로 돌아오는 통로는 좌상단 `FocusToggle` 버튼 하나다 — 키보드
    // 단축키는 두지 않는다(2026-08-26, 모바일과 동등한 조작만 남긴다).

    const side = this.playback.humanSide;
    this.tip = new StatusPopup(document.getElementById('tip')!);
    // 「항복」은 전체 기록 안에 있다 (pptx 27쪽). 관전(양쪽 AI)이면 낼 의도가 없어 뺀다.
    this.log = new SystemLog(
      document.getElementById('log')!, document.getElementById('history')!,
      side ? () => { this.playback.submit({ t: 'surrender' }); this.syncUnits(); } : null,
    );
    this.burst = new BurstFx(document.getElementById('burst')!);
    this.fx = new SkillFx(document.getElementById('fx')!, this.burst);

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
      // **대화는 멈춰 둔다** (기획자 지적 2026-08-13). 배경이 어두워진 상태에서
      // 말풍선이 지나가면 글자가 묻혀 무엇이 발동했는지 읽을 수 없다.
      // 연출이 걷힌 다음 프레임부터 다시 흐른다.
      //
      // 배너가 판을 덮고 있는 동안에도 카메라는 시전자 쪽으로 다가간다 —
      // 걷혔을 때 이미 그 자리를 보고 있어야 무슨 일이 일어났는지 읽힌다.
      this.syncCamera(delta);
      return;
    }
    this.playback.update(delta);
    this.poses.update(delta);
    // 연출 시각표에 걸린 소리를 지금 시각까지 튼다 — `playBurstFor`의 주석 참조.
    for (const cue of this.poses.drainSounds()) this.playSoundCue(cue);
    this.log.update(delta);
    // 책략이 띄운 일회성 애니메이션. 배너와 달리 판을 멈추지 않고 연출 창 안에서 돈다.
    this.burst.update(delta);
    // 링 스왑의 **공용 시계**. 매 프레임 돌려야 겹친 링이 2초마다 갈아 끼워진다 —
    // 상태가 바뀔 때만 그리면 두 번째 링이 영영 뜨지 않는다.
    const swapped = Math.floor(this.ringClockMs / SWAP_MS);
    this.ringClockMs += delta;
    // 연출 중에는 자세·좌표가 매 프레임 바뀐다. **끝난 프레임에도 한 번 더** 그린다 —
    // 마지막 자세를 평상으로 되돌리고 퇴각한 유닛을 치우는 것이 그 프레임이다.
    if (this.poses.busy || this.posing || Math.floor(this.ringClockMs / SWAP_MS) !== swapped) {
      this.syncUnits();
    }
    this.posing = this.poses.busy;
    // 제어권 획득은 **상태 변경이 아니라 시간 경과**로 일어난다(displayTime이 목표에 닿는 순간).
    // 그래서 onChange만으로는 하이라이트를 다시 그릴 계기가 없다.
    if (this.playback.phase !== this.lastPhase) {
      const prevTrack = trackForPhase(this.lastPhase);
      this.lastPhase = this.playback.phase;
      const nextTrack = trackForPhase(this.playback.phase);
      // 배경음악은 **단계**가 정한다 (2026-08-14 기획자 지정) — 배치·정찰은 따로 한 곡이다.
      // 화면(`screens/App.tsx`)은 이 경계를 알 수 없다. 아는 것은 `Playback.phase`뿐이다.
      playBgm(nextTrack);
      // 배치·정찰에서 전투로 넘어가는 그 순간에만 함성이 튄다 — 판마다 한 번뿐이다.
      // `lastPhase`가 `''`인 첫 진입(마운트)은 `prevTrack`이 `'prep'`이 될 수 없어 안 튄다.
      if (prevTrack === 'prep' && nextTrack === 'battle') playSfx('roar2');
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
      this.onFinish?.(this.state, this.playback.close);
    }
    // WT 게이지와 시계는 상태가 아니라 **시간**에 따라 움직이므로 매 프레임 갱신한다
    this.refreshStatus();
    // 카메라는 마지막에 — 이 프레임의 선택·연출 상태를 다 반영한 뒤에 목표를 정한다
    this.syncCamera(delta);
  }

  // ── 보드 ─────────────────────────────────────────────────────

  /**
   * 판을 그린다 — **지도가 있으면 지도 위에, 없으면 예전 어두운 격자로** (2026-08-14).
   *
   * 지도(`assets/map/chessmap.png`)는 판 전체를 덮는 한 장이라 셀에 맞춰 자를 것이
   * 없다. 그 위에 얹는 것은 셋뿐이다 — 진영 구역 색조 · 격자선 · 좌표 눈금.
   *
   * **지도가 깔리면 진영 색과 격자를 옅게 한다.** 예전 값(진영 불투명 · 한 칸 걸러
   * 밝게)은 어두운 바탕을 전제한 것이라, 그대로 얹으면 지도가 통째로 묻힌다.
   * 체스판 무늬(한 칸 걸러 밝게)는 아예 뺀다 — 지도 위에 격자무늬까지 얹으면
   * 강물과 산이 안 읽힌다. 칸을 세는 일은 좌표 눈금이 맡는다.
   */
  private drawBoard(): void {
    const map = this.textures.exists('boardmap');
    if (map) {
      // 750²을 판 전체(2400²)로 늘린다. 수채 느낌이라 확대해도 부드럽게 번진다.
      this.add.image(0, 0, 'boardmap').setOrigin(0, 0)
        .setDisplaySize(BOARD_W, BOARD_H).setDepth(-1);
    }

    const g = this.add.graphics().setDepth(0);

    // 진영 구역. 지도가 있으면 **색조만** 얹는다 (위아래가 누구 자리인지만 보이면 된다).
    // 지도를 눌러 굽고 나서 더 낮췄다 — 옅은 지도 위에서는 같은 값도 더 진해 보인다.
    const camp = map ? 0.13 : 1;
    g.fillStyle(COLOR.campP2, camp).fillRect(0, 0, BOARD_W, 5 * CELL_H);
    g.fillStyle(COLOR.campP1, camp).fillRect(0, BOARD_H - 5 * CELL_H, BOARD_W, 5 * CELL_H);
    if (!map) {
      g.fillStyle(COLOR.boardDark, 1).fillRect(0, 5 * CELL_H, BOARD_W, BOARD_H - 10 * CELL_H);

      // 체스판처럼 한 칸 걸러 밝게 — 좌표를 눈으로 세기 쉬워진다
      g.fillStyle(COLOR.boardLight, 0.25);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if ((x + y) % 2 === 0) g.fillRect(x * CELL_W, y * CELL_H, CELL_W, CELL_H);
        }
      }
    }

    // 격자와 눈금이 「지도가 깔렸는가」를 보므로 **먼저** 세운다
    this.boardMap = map ? { width: BOARD_W, height: BOARD_H, campAlpha: camp } : null;
    this.grid = this.add.graphics().setDepth(1);
    this.drawCoordLabels(map);
  }

  /**
   * 판에 지도가 깔렸는가. 스모크가 읽는다 — 그림이 없으면 `null`이고, 그때는
   * 검사를 건너뛴다(에셋은 리포에 없다).
   */
  private boardMap: { width: number; height: number; campAlpha: number } | null = null;

  debugBoardMap(): { width: number; height: number; campAlpha: number } | null {
    return this.boardMap;
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
  private drawCoordLabels(onMap = false): void {
    // 지도 위에서는 **먹으로 쓰고 종이색으로 두른다** — 밝은 바탕에 흰 글자·검은 외곽선을
    // 그대로 두면 글자는 날아가고 외곽선만 남아 판을 얼룩지게 한다.
    const style = {
      fontFamily: 'ui-monospace, Consolas, monospace',
      fontSize: `${LABEL.fontPx}px`,
      color: onMap ? COLOR.labelInk : COLOR.label,
    };
    const stroke: [string, number] = onMap ? [COLOR.labelPaper, 8] : ['#000000', 8];
    for (let x = 0; x < COLS; x++) {
      this.labels.push(this.add
        .text(x * CELL_W + CELL_W / 2, LABEL.pad, String.fromCharCode(65 + x), style)
        .setOrigin(0.5, 0).setDepth(16).setStroke(...stroke));
    }
    for (let y = 0; y < ROWS; y++) {
      this.labels.push(this.add
        .text(LABEL.pad, y * CELL_H + CELL_H / 2, String(y + 1), style)
        .setOrigin(0, 0.5).setDepth(16).setStroke(...stroke));
    }
    this.syncScreenScale();
  }

  /**
   * 배율이 바뀌어도 **화면에서 같은 굵기**로 남아야 하는 것들 — 좌표 눈금과 격자선.
   *
   * 줄눈이 여기 들어온 것은 2026-08-14 기획자 지적 때문이다(「체스판 줄눈이 더 잘
   * 보이면 좋겠다」). 월드 좌표에 1px로 그으면 판 전체를 보는 배율(0.19배)에서
   * **0.2px가 되어 사라진다.** 지도를 깔면서 「한 칸 걸러 밝게」를 뺐으므로 이제
   * 줄눈이 유일한 눈금이다 — 배율의 역수로 되돌려 늘 같은 굵기로 긋는다.
   */
  private syncScreenScale(): void {
    const zoom = this.cameras.main.zoom;
    for (const t of this.labels) t.setScale(LABEL.sizePx / (LABEL.fontPx * zoom));

    // 배율이 거의 그대로면 다시 긋지 않는다 — 카메라가 매 프레임 움직이는 구간에서
    // 500줄을 매번 새로 긋게 된다.
    if (Math.abs(zoom - this.gridZoom) < 0.002) return;
    this.gridZoom = zoom;

    const map = this.boardMap !== null;
    const line = (px: number): number => px / zoom;
    this.grid.clear();
    this.grid.lineStyle(line(map ? GRID_PX : GRID_PX * 0.9),
      map ? COLOR.gridInk : COLOR.grid, map ? 0.55 : 0.6);
    for (let x = 0; x <= COLS; x++) this.grid.lineBetween(x * CELL_W, 0, x * CELL_W, BOARD_H);
    for (let y = 0; y <= ROWS; y++) this.grid.lineBetween(0, y * CELL_H, BOARD_W, y * CELL_H);
    this.grid.lineStyle(line(GRID_PX * 2.5), map ? COLOR.gridInk : COLOR.grid, map ? 0.8 : 1)
      .strokeRect(0, 0, BOARD_W, BOARD_H);
  }

  /** 격자선. 배율이 바뀔 때마다 다시 긋는다 (`syncScreenScale`) */
  private grid!: Phaser.GameObjects.Graphics;
  /** 마지막으로 격자를 그린 배율. 같은 배율에서 다시 긋지 않으려고 들고 있는다 */
  private gridZoom = -1;

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
      this.syncScreenScale();
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
    this.syncScreenScale();
  }

  /** 판 전체가 보이도록 되돌린다. 확대해서 헤맬 때 빠져나올 통로다. */
  resetView(): void {
    this.manual = false;
    this.rig.snap(this.viewOfCue(FIT_CUE));
    const view = this.rig.current!;
    this.cameras.main.setZoom(view.zoom);
    this.cameras.main.centerOn(view.x, view.y);
    this.syncScreenScale();
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
    // 일회성 효과도 센다 — 책략의 애니메이션은 판을 멈추지 않으므로, 이걸 빼면
    // 스모크가 연출이 도는 한가운데에서 다음 클릭을 넣는다.
    //
    // **`playback.busy`도 센다** (2026-08-13). 대화가 연출보다 길면 판이 그만큼 더
    // 붙들려 있는데(`log.timeToDrain()`), 자세만 보고 「끝났다」고 하면 아직 멈춰 있는
    // 판에 스모크가 클릭을 넣는다.
    return !this.poses.busy && !this.playback.busy && !this.fx.active && !this.burst.active
      && (this.manual || this.rig.settled);
  }

  // ── 유닛 ─────────────────────────────────────────────────────

  private createUnitView(unit: UnitState): void {
    const officer = officerById.get(unit.officer)!;
    const key = `act:${unit.officer}`;

    // 링은 **캐릭터 뒤**다. 컨테이너의 첫째 자식이라 자연히 아래에 깔린다 —
    // 별도 depth로 빼면 이동 연출에서 캐릭터만 움직이고 링이 남는다.
    const ring = this.add.image(0, 0, '__MISSING')
      .setDisplaySize(RING_SIZE, RING_SIZE).setVisible(false);

    /*
     * **테두리는 차례인 기물에게만** (2026-08-13 기획자 지정).
     *
     * 예전에는 전원이 진영 색 테두리를 둘렀다. 그런데 판에 10명이 서면 테두리가
     * 열 개라 「지금 누구 차례인가」가 묻힌다 — 진영은 어차피 위아래로 나뉘어 있어
     * 테두리로 다시 알릴 이유가 없다. 아군 초록 · 적군 빨강, 나머지는 없다.
     */
    const border = this.add.rectangle(0, 0, CELL_W - 4, CELL_H - 4).setVisible(false);
    // 정사각 칸이라 세로에 맞춰 균등 배율로 넣는다. 가로로 조금 넘치는 부분은
    // 무기·이펙트라 투명하고, 옆 칸과 겹쳐 보이는 편이 오히려 자연스럽다.
    const portrait = this.add.sprite(0, 0, this.textures.exists(key) ? key : '__MISSING', POSE.idle)
      .setDisplaySize(CELL_H - 10, CELL_H - 10);

    /*
     * **바는 HP 하나뿐이다** (2026-08-13 기획자 지정).
     *
     * MP·WT까지 세 줄을 얹으면 기본 배율(셀 30px대)에서 그림 위가 줄무늬가 된다.
     * 게다가 셋 다 카드 스트립이 더 크게 보여준다 — WT는 애초에 「판 위에서 안 보인다」는
     * 지적 때문에 카드로 옮겼던 것이고, MP는 상태 팝업이 맡는다.
     * 판 위에 남길 것은 **한눈에 봐야 하는 체력**뿐이다.
     */
    const bars: Phaser.GameObjects.Rectangle[] = [];
    const y = BAR_TOP;
    bars.push(this.add.rectangle(BAR_LEFT, y, BAR_W, BAR_H, COLOR.barBack, 0.75).setOrigin(0, 0.5));
    const hpBar = this.add.rectangle(BAR_LEFT, y, BAR_W, BAR_H, COLOR.hpFull).setOrigin(0, 0.5);
    bars.push(hpBar);

    // 배지 (GDD §3.10). 상태이상 종류가 22가지라 타일에서는 **개수만 점으로** 찍고,
    // 무엇이 걸렸는지는 상태 팝업이 이름으로 적는다.
    //
    // **글자 배지는 전부 뺐다** (2026-08-13 기획자 지정) — 이름·기물(`조조·K`)과
    // 급·레벨(`S1`)이 그림을 덮고 있었다. 기본 배율에서는 어차피 읽히지 않고,
    // 확대하면 카드 스트립이 같은 것을 더 크게 보여준다.
    const skillBadge = this.add.circle(BADGE.left + 4, BADGE.top, 4.5, COLOR.skillReady)
      .setStrokeStyle(1, 0x0b0d10).setVisible(false);
    const dots = this.add.graphics();

    const container = this.add.container(0, 0,
      [ring, portrait, border, ...bars, skillBadge, dots]).setDepth(10);
    this.views.set(unit.id, { container, ring, portrait, border, hpBar, skillBadge, dots });
  }

  /**
   * 지형 그림을 권위 상태에 맞춘다 (2026-08-14).
   *
   * 지형은 판이 도는 중에 생기고 사라진다 — 「화계」·「수계」·「수성지주」가 만들고
   * 「진화」·「매립」이 걷는다. 그래서 처음 한 번 그리고 마는 것이 아니라 **`state.terrain`을
   * 그대로 따라간다**: 있는 칸은 만들고, 없어진 칸은 치운다.
   *
   * 그림을 못 받았으면 조용히 넘어간다 — 에셋은 리포에 없어서 받아 오기 전에는 404다.
   * 무슨 지형이 어디에 생겼는지는 말풍선이 여전히 문장으로 알려 준다.
   */
  private syncTerrain(): void {
    const live = new Set<string>();
    for (const tile of this.state.terrain ?? []) {
      const key = `${tile.pos.x},${tile.pos.y}`;
      const texture = `terrain:${tile.terrain}`;
      if (!this.textures.exists(texture)) continue;
      live.add(key);
      let img = this.terrainViews.get(key);
      if (!img) {
        const p = cellCenter(tile.pos.x, tile.pos.y);
        img = this.add.image(p.x, p.y, texture).setDepth(3).setAlpha(TERRAIN_ALPHA);
        img.setDisplaySize(TERRAIN_SIZE, TERRAIN_SIZE);
        this.terrainViews.set(key, img);
      } else if (img.texture.key !== texture) {
        // 같은 칸의 지형이 바뀔 수 있다 (「진화」로 걷고 그 자리에 「수계」를 놓는 식).
        // `setTexture`는 크기를 원본 픽셀로 되돌리므로 곧바로 다시 잡아 준다.
        img.setTexture(texture).setDisplaySize(TERRAIN_SIZE, TERRAIN_SIZE);
      }
    }
    for (const [key, img] of this.terrainViews) {
      if (live.has(key)) continue;
      img.destroy();
      this.terrainViews.delete(key);
    }
  }

  /** 지금 판에 그려진 지형 칸. 엔진 상태와 어긋나면 화면이 거짓말을 하는 것이다. */
  debugTerrainTiles(): { x: number; y: number; terrain: string }[] {
    return [...this.terrainViews.entries()].map(([key, img]) => {
      const [x, y] = key.split(',');
      return { x: Number(x), y: Number(y), terrain: img.texture.key.replace('terrain:', '') };
    });
  }

  /** 권위 상태를 화면에 반영한다. 상태가 바뀔 때마다 호출된다. */
  syncUnits(): void {
    this.syncTerrain();
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

      // **게이지는 피격 그림과 함께 움직인다** (기획자 지적 2026-08-13).
      // 엔진은 판정을 이미 끝냈으므로 `unit.hp`는 맞은 뒤 값이다 — 아직 오지 않은
      // 변화분을 도로 빼면 「맞기 전」 값이 된다. 카드 스트립도 같은 보정을 쓴다.
      const shownHp = this.poses.shownHp(unit);
      const ratio = shownHp / unit.maxHp;
      view.hpBar.width = BAR_W * ratio;
      view.hpBar.fillColor = ratio > 0.34 ? COLOR.hpFull : COLOR.hpLow;

      /*
       * **테두리는 차례인 기물에게만** (2026-08-13 기획자 지정).
       * 아군(사람이 조작하는 쪽) 초록 · 적군 빨강. 나머지는 아예 그리지 않는다.
       *
       * 조종당하는 중이면(「초선」·「삼고초려」) **지휘하는 쪽** 기준으로 색을 고른다 —
       * 소속은 그대로여도 지금 그 수를 두는 것은 조종자라서다.
       * 배치 중에 고른 기물도 테두리를 준다. 안 그러면 어느 것을 옮기는 중인지 안 보인다.
       */
      const picked = this.state.activeUnit === unit.id || this.deploying === unit.id;
      view.border.setVisible(picked);
      if (picked) {
        const commander = unit.control
          ? this.state.units[unit.control.by]?.side ?? unit.side
          : unit.side;
        const mine = this.playback.humanSide === null
          ? commander === 'P1'                      // 관전이면 남군을 「아군」 자리로 둔다
          : commander === this.playback.humanSide;
        view.border.setStrokeStyle(4, mine ? COLOR.p1 : COLOR.p2);
      }

      this.syncBadges(unit, view);
      this.syncRing(unit, view);
    }
    this.drawHints();
  }

  /**
   * 지속형 시각 효과 링 (2026-08-13). 무엇을 깔지는 `visualEffect.ts`가 정한다.
   *
   * 겹치면 2초마다 갈아 끼운다(기획자 지정). **줄여서 겹쳐 놓지 않는다** —
   * 링이 전부 도넛이라 80%·60%로 줄이면 안쪽 링이 캐릭터 몸에 가려 안 보인다.
   * 몇 개가 걸렸는지는 우상·우하의 점 배지가 이미 알려 준다.
   *
   * **매 프레임 다시 묻는다.** 오라 링은 *다른* 유닛이 움직이면 붙었다 떨어졌다
   * 하는데 이 유닛의 상태는 하나도 안 바뀐다 — `statusChips.ts`의 `auraKey`가
   * 같은 이유로 있다.
   */
  private syncRing(unit: UnitState, view: UnitView): void {
    // 방금 걸린 디버프는 `poses`가 「맞는」 시각으로 정한 순간까지 감춘다 — `state`는
    // 판정이 이미 끝난 값이라 그대로 그리면 카메라가 도착하기도 전에 띠가 먼저 뜬다
    // (기획자 지적 2026-08-26, `poses.ts`의 `HideCue` 참조).
    const rings = ringsOn(this.state, unit).filter((v) => !this.poses.isHidden(unit.id, v));
    // 「선공」처럼 즉시 끝나는 WT 보정은 엔진에 흔적이 없어 화면이 물고 있는다
    const held = this.pendingRings.get(unit.id);
    if (held && !rings.includes(held)) rings.push(held);

    const vfx = ringAt(rings, this.ringClockMs);
    const key = vfx ? `vfx:${vfx}` : null;
    // 그림을 못 받았으면(에셋은 리포에 없다) 조용히 접는다 — 판이 무너지면 안 된다
    if (!key || !this.textures.exists(key)) {
      view.ring.setVisible(false);
      return;
    }
    if (view.ring.texture.key !== key) view.ring.setTexture(key).setDisplaySize(RING_SIZE, RING_SIZE);
    view.ring.setVisible(true);
  }

  /**
   * 지금 **화면에 그려지는** 칸. 권위 좌표(`unit.pos`)와 다를 수 있다 —
   * 걷는 중이거나, 연출이 시작되기 전에 붙들려 있는 동안이다.
   *
   * 「도착지에 한 번 떴다가 출발점으로 되돌아간다」 같은 어긋남은 **스크린샷 한 장으로
   * 검증할 수 없다.** 프레임마다 이 값을 찍어 시계열로 봐야 잡힌다.
   */
  debugPoseCell(unitId: UnitId): Vec2 | null { return this.poses.cellOf(unitId); }

  /** 아직 못 내보낸 대화 줄 수. 연출이 대화를 앞질렀는지 재는 자리다. */
  get debugLogPending(): number { return this.log.pending; }

  /** 스모크·테스트가 읽는 자리 — 지금 이 유닛에 걸린 링 목록 */
  debugRings(unitId: UnitId): string[] {
    const unit = this.state.units[unitId];
    return unit ? ringsOn(this.state, unit) : [];
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
        // 확인창 없이 곧바로 쏜다 (2026-08-13 확정). 확률은 조준하는 동안
        // **대상 칸 위에 이미 떠 있다**(`drawHints`) — 모달로 한 번 더 막지 않는다.
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
    this.clearOdds();
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
      const targets = legalTargetsFor(state, active);
      paint(targets.map((id) => state.units[id]!.pos), COLOR.attackHint);
      this.drawOdds(active, targets);
      return;
    }
    if (this.modal.movePhase(state, this.playback.humanSide)) {
      paint(legalMovesFor(state, active), COLOR.moveHint);
      paint([unit.pos], COLOR.stayHint, 0.22, 3);   // 제자리 대기
    }
  }

  /**
   * 조준 중인 대상 칸 위에 **크리티컬 확률**을 반투명 숫자로 얹는다 (2026-08-13 기획자 지정).
   *
   * 공격 확인창을 한 번 붙였다 뺐다 — 모달이 판 한가운데를 덮어 정작 연출이 안 보였다.
   * 대신 고르기 **전에** 알아야 할 것 하나만 칸 위에 둔다.
   *
   * **확률의 출처는 엔진의 `forecastAttack()`이다.** 화면이 `30 + 무력차`를 다시 적으면
   * 공식이 바뀌었을 때 표시만 조용히 어긋난다 — 책략 확인창이 `illusionChance()`에
   * 묻는 것과 같은 이유다.
   *
   * 글자는 **유닛 위**(depth 17)에 그린다. 초상화(depth 10)에 가리면 없는 것과 같다.
   */
  private drawOdds(attacker: UnitId, targets: readonly UnitId[]): void {
    for (const id of targets) {
      const target = this.state.units[id];
      const f = forecastAttack(this.state, attacker, id);
      if (!target || !f) continue;
      const p = cellCenter(target.pos.x, target.pos.y);
      const text = this.add.text(p.x, p.y, f.execute ? '즉사' : `${f.criticalRate}%`, {
        fontFamily: 'sans-serif', fontSize: '34px', fontStyle: 'bold',
        color: '#ffffff', stroke: '#000000', strokeThickness: 6,
      }).setOrigin(0.5).setAlpha(0.72).setDepth(17);
      this.odds.push(text);
    }
  }

  private clearOdds(): void {
    for (const t of this.odds) t.destroy();
    this.odds.length = 0;
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
    // 카드도 타일 바와 **같은 값**을 그린다 — 두 곳이 다르면 어느 쪽이 맞는지 알 수 없다
    this.cards.refresh(this.state, this.playback.displayTime, (u) => this.poses.shownHp(u));

    // 두 패널의 자리는 **가려서는 안 되는 것을 피해** 정해지고 서로 좌우 대칭이다 (pptx 29쪽).
    // 평소에는 제어권 기물(카메라가 비추는 것)이고, 무언가 고르는 중에는 **후보 칸들**이다 —
    // 패널이 후보를 덮으면 "화면에 칠해져 있는데 눌리지 않는" 칸이 생긴다. 실제로 났다.
    const focus = BattleScene.center(this.choosableCells())
      ?? (this.state.activeUnit ? this.state.units[this.state.activeUnit]?.pos : null);
    const slot = commandSlot(focus);
    this.modal.place(slot);
    this.inspect.place(mirror(slot));
    // 말풍선은 판 영역 한가운데에 고정이다 (2026-08-13) — 자리 잡는 일이 CSS로 내려갔다

    this.inspect.refresh(this.state);
    // 연출이 도는 동안에는 패널이 물러난다 — 공격 직후 한 번 더 뜨는 것을 막는다.
    // 턴은 연출이 끝나야 넘어가므로 그때까지 `phase`는 여전히 `awaitingInput`이다.
    // 제어 마감(20초)은 **판정 주체가 실어 보낸 값**이다 — 화면이 다시 재지 않는다
    this.modal.refresh(this.state, side, this.playback.phase, this.playback.busy,
      this.state.phase === 'control' ? this.playback.remainingSec : null);
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
  /** 확인용 하네스가 모드를 직접 세울 때 (「공격」을 누른 것과 같다) */
  debugSetActionMode(mode: ActionMode): void { this.actionMode = mode; }

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
      // 연출에 걸리는 시간만큼 판을 멈춘다. 그러지 않으면 2.6초짜리 공격 위로
      // 다음 유닛의 행동이 겹친다 — 대화창의 「크리티컬!」을 읽을 겨를도 없다.
      const poseMs = this.poses.plan(events, state);
      // **판은 자기가 설명하는 것을 기다린다** (2026-08-13). 대화는 연출 창에 맞춰
      // 간격을 좁히고, 그래도 모자라면(도트 정산처럼 연출이 없는데 할 말이 많은 구간)
      // 판이 그만큼 더 기다린다. 예전에는 말만 뒤로 밀려 최대 8줄까지 쌓였다.
      this.log.pace(poseMs);
      this.playback.hold(Math.max(poseMs, this.log.timeToDrain()));
      this.playBurstFor(events, state);
    }
    if (this.views.size > 0) this.syncUnits();
  }

  /**
   * 고유기술 배너와 일회성 시각 효과를 띄운다 (2026-08-13).
   *
   * 갈래가 둘이고 판을 멈추는지가 다르다.
   *
   * | | 배너 | 애니메이션 | 판 |
   * |---|---|---|---|
   * | 고유기술 | 2초 | 배너 **뒤에** 1초 | 둘 다 멈춘다 |
   * | 책략 | 없음 | 곧바로 1초 | 안 멈춘다 (연출 창 1~2초 안에서 끝난다) |
   *
   * **저항당한 책략은 띄우지 않는다.** 환술이 막힌 것도 「걸렸다」로 보이면
   * 무엇이 통했는지 알 수 없다 — `resisted`가 그 갈림길이다.
   */
  private playBurstFor(events: readonly BattleEvent[], state: BattleState): void {
    // **효과음·성우는 여기서 안 튼다.** 여기는 이벤트가 도착한 즉시(연출 시작 t=0)
    // 도는 자리인데, 실제 타격·피격 자세는 카메라가 도착한 뒤(`CAM_LEAD_MS`)에야
    // 뜬다 — 그래서 소리가 그림보다 먼저 들리는 어긋남이 났다(기획자 지적
    // 2026-08-26, 상대 턴에서 카메라가 실제로 움직여야 할 때만 도드라졌다). 소리는
    // `poses.ts`가 짠 시각표(`SoundCue`)를 따라 `update()`의 `drainSounds()`가 튼다.
    // 배너·일회성 이펙트는 그대로 즉시 — 판 전체를 덮거나(고유기술) 자리 없는
    // 오버레이(책략)라 카메라 도착과 안 엮인다.
    const oneShot = VISUAL_EFFECTS.oneShot;
    for (const ev of events) {
      if (ev.e === 'uniqueSkillCast') {
        const skill = skillById.get(ev.skill);
        if (!skill) continue;
        const unit = state.units[ev.unit];
        const caster = unit ? officerById.get(unit.officer)?.name ?? '' : '';
        this.fx.play(skill.id, skill.name, caster, unit?.officer ?? '', oneShot.bySkill[skill.id]);
      } else if (ev.e === 'tacticCast' && !ev.resisted) {
        const vfx = oneShot.byTactic[ev.tactic];
        if (vfx) this.burst.play(vfx);
      }
    }
    // 「선공」처럼 즉시 차례를 당기고 끝나는 것 — 엔진에 흔적이 남지 않아 화면이 물고 있는다.
    // 「다음 차례를 받을 때까지」가 기획자 확정이라 `controlGranted`에서 지운다.
    //
    // **어떤 것이 그런지는 데이터가 안다.** `hastenWt`는 추출기가 Effect DSL을 훑어
    // 뽑은 목록이라(`modifyWt` · `delta < 0` · `turns` 없음), 「선공」에 지속이
    // 붙는 날 목록에서 저절로 빠진다.
    const { hastenWt, wtModifier } = VISUAL_EFFECTS.persistent;
    for (const ev of events) {
      if (ev.e === 'controlGranted') this.pendingRings.clear(ev.unit);
      if (ev.e !== 'wtChanged') continue;
      // 이유는 `tactic:{id}` / `skill:{id}` 꼴이다 (`rules/battle.ts`)
      const [kind, id] = ev.reason.split(':');
      const listed = kind === 'tactic' ? hastenWt.tactics : kind === 'skill' ? hastenWt.skills : [];
      if (id && listed.includes(id)) this.pendingRings.mark(ev.unit, wtModifier);
    }
  }

  /**
   * `poses.ts`가 짠 시각표에서 지금 막 닿은 소리 큐 하나를 실제로 튼다
   * (`playBurstFor`의 주석 참조 — 카메라가 도착한 뒤, 자세가 뜨는 그 순간이다).
   */
  private playSoundCue(cue: SoundCue): void {
    switch (cue.k) {
      case 'attackHit': playSfx('battle_attack'); break;
      case 'moveStart': playSfx('battle_moving'); break;
      case 'castStart': playSfx('battle_spell'); break;
      case 'dieBlink': playSfx('battle_dead'); break;
      case 'skillCastStart': {
        const skill = skillById.get(cue.ev.skill);
        // 40종 중 지금 녹음된 18종만 실제로 난다(`skillVoice.ts` 참조)
        if (skill) playSkillVoice(skill.id);
        break;
      }
    }
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
