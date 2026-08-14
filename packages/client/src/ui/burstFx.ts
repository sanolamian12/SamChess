/**
 * 일회성 시각 효과 — 판 한가운데에서 4프레임 애니메이션 (2026-08-13).
 *
 * 그림은 `public/vfx/{A..G}.png`. **가로 4칸짜리 띠**이고 원본 2×2를 시계방향
 * (좌상 → 우상 → 우하 → 좌하)으로 편 것이다 (`tools/build_status_fx.py`).
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 Phaser가 아니라 DOM인가 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 기획자 지시는 「지금 화면에서 **체스판 영역**의 중심」이다. 판의 월드 좌표
 * 한가운데가 아니다 — 카메라가 100%/200%/300%를 오가므로 월드 좌표에 놓으면
 * 확대 중에는 화면 밖으로 나간다.
 *
 * `#burst`는 `#board`에 `inset: 0`으로 붙는 DOM이라 **화면 좌표**다.
 * 카메라 배율이 무엇이든 언제나 판 영역 한가운데에 같은 크기로 뜬다 —
 * 줌아웃 → 연출 → 줌인으로 되돌리는 곡예가 필요 없다.
 * `ui/skillFx.ts`의 배너가 이미 같은 층에 있다.
 *
 * ────────────────────────────────────────────────────────────────
 * 판을 멈추지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * 배너(`SkillFx`)는 판을 멈추지만 이쪽은 아니다. 책략의 연출 창(1~2초,
 * `poses.ts`)이 이미 열려 있어서 그 안에서 끝나기 때문이다. 여기서 또 멈추면
 * 「회복」 한 번에 3초가 걸린다.
 *
 * 고유기술은 사정이 다르다 — 배너가 2초 판을 덮고, 그 **뒤에** 이 애니메이션이
 * 이어져야 한다(기획자 지시). 그 이음은 `SkillFx`가 맡는다.
 */

/** 한 칸을 보여주는 시간 (기획자 지정 «0.2초~0.3초 간격») */
export const FRAME_MS = 250;
/** 띠에 들어 있는 칸 수. `build_status_fx.py`의 `FRAMES`와 같아야 한다 */
export const FRAME_COUNT = 4;
/** 애니메이션 전체 길이 */
export const BURST_MS = FRAME_MS * FRAME_COUNT;

export class BurstFx {
  private remainMs = 0;
  private readonly cell: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    root.replaceChildren();
    root.classList.add('hidden');
    this.cell = document.createElement('div');
    this.cell.className = 'burst-cell';
    root.appendChild(this.cell);
  }

  /** 재생 중인가. 스모크가 연출이 끝나기를 기다리는 데 쓴다. */
  get active(): boolean { return this.remainMs > 0; }

  /** 지금 보여주는 칸 번호. 테스트가 시간표를 읽는 자리다. */
  get frame(): number {
    if (this.remainMs <= 0) return -1;
    const done = BURST_MS - this.remainMs;
    return Math.min(FRAME_COUNT - 1, Math.floor(done / FRAME_MS));
  }

  play(vfx: string): void {
    // 그림이 없어도(에셋은 리포에 없다) 시간은 그대로 흐른다 — 빈 칸이 뜰 뿐이다.
    this.cell.style.backgroundImage = `url(vfx/${vfx}.png)`;
    this.remainMs = BURST_MS;
    this.root.classList.remove('hidden');
    this.paint();
  }

  update(deltaMs: number): void {
    if (this.remainMs <= 0) return;
    this.remainMs -= deltaMs;
    if (this.remainMs <= 0) {
      this.remainMs = 0;
      this.root.classList.add('hidden');
      return;
    }
    this.paint();
  }

  /** 전투가 끝나거나 화면을 다시 세울 때 */
  stop(): void {
    this.remainMs = 0;
    this.root.classList.add('hidden');
  }

  /**
   * 띠를 옆으로 민다. 칸을 4개의 `<img>`로 나누지 않는 이유는 액션 시트와 같다 —
   * 요청이 하나로 끝나고, 갈아 끼울 때 새 그림을 기다리며 한 프레임 비지 않는다.
   */
  private paint(): void {
    const f = this.frame;
    if (f < 0) return;
    this.cell.style.backgroundPosition = `${(f * 100) / (FRAME_COUNT - 1)}% 50%`;
  }
}
