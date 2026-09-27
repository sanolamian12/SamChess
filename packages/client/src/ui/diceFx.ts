/**
 * 동점 추첨 주사위 — 배치 화면이 열릴 때 한 번 (2026-09-27, pptx 90쪽).
 *
 * 그림은 `public/battle/dice.webp`(`tools/build_dice.py`가 생성 영상에서 배경을 걷어 구운
 * 스프라이트), 소리는 `effects/dice.mp3`. 투명 동영상이 아니라 스프라이트인 이유는 그
 * 도구의 머리말에 있다(사파리가 알파 WebM을 못 튼다).
 *
 * ────────────────────────────────────────────────────────────────
 * 주사위는 **이미 뽑힌 순번을 보여 줄 뿐이다** ★
 * ────────────────────────────────────────────────────────────────
 *
 * 동점 순번(`UnitState.turnRank`)은 엔진이 판을 만들 때 시드로 뽑아 둔다. 여기서는
 * 굴리는 흉내를 낸 뒤 그 결과(「관우 → 조조」)를 적는다 — 화면이 난수를 굴리면
 * `rngCursor`가 밀려 리플레이가 깨진다(CLAUDE.md). 그래서 온라인에서도 두 사람이 같은
 * 결과를 본다.
 *
 * 판을 멈추지 않는다(`BurstFx`와 같은 결) — 배치 30초가 흐르는 중이고, 클릭은 통과한다.
 * 그림이 없으면(에셋 방침) 주사위 없이 결과 글만 띄운다.
 */

/** `build_dice.py`의 출력과 같은 값이어야 한다 — 도구가 실행할 때 찍어 준다 */
export const DICE_FRAMES = 55;
export const DICE_COLS = 8;
const DICE_ROWS = Math.ceil(DICE_FRAMES / DICE_COLS);
/** 원본 영상과 같은 24fps */
const FRAME_MS = 1000 / 24;
const ROLL_MS = DICE_FRAMES * FRAME_MS;
/** 멈춘 뒤 결과를 읽을 시간 */
const HOLD_MS = 2600;
/** 사라지는 시간 — CSS `.dice-fx.out`의 transition과 같다 */
const FADE_MS = 500;
export const DICE_TOTAL_MS = ROLL_MS + HOLD_MS + FADE_MS;

export const DICE_URL = 'battle/dice.webp';

/** 한 동점 무리 — 순번대로 */
export interface DiceGroup {
  members: { name: string; mine: boolean }[];
}

export class DiceFx {
  private readonly root: HTMLElement;
  private readonly sprite: HTMLElement;
  private readonly result: HTMLElement;
  private elapsed = -1;
  private art: 'unknown' | 'ok' | 'missing' = 'unknown';

  constructor(root: HTMLElement) {
    this.root = root;
    root.replaceChildren();
    root.className = 'dice-fx hidden';
    this.sprite = document.createElement('div');
    this.sprite.className = 'dice-sprite';
    this.sprite.style.backgroundImage = `url(${DICE_URL})`;
    this.sprite.style.backgroundSize = `${DICE_COLS * 100}% ${DICE_ROWS * 100}%`;
    this.result = document.createElement('div');
    this.result.className = 'dice-result';
    root.append(this.sprite, this.result);

    // 그림이 있는지 먼저 본다 — CSS 배경은 404여도 아무 말이 없어 빈 자리만 굴러간다
    const probe = new Image();
    probe.onload = () => { this.art = 'ok'; };
    probe.onerror = () => { this.art = 'missing'; this.sprite.classList.add('hidden'); };
    probe.src = DICE_URL;
  }

  get active(): boolean { return this.elapsed >= 0; }

  /** 지금 칸 번호. 굴러가는 중이 아니면 −1 — 스모크가 읽는다 */
  get frame(): number {
    if (this.elapsed < 0) return -1;
    return Math.min(DICE_FRAMES - 1, Math.floor(this.elapsed / FRAME_MS));
  }

  play(title: string, groups: readonly DiceGroup[]): void {
    this.result.replaceChildren();
    const head = document.createElement('div');
    head.className = 'dice-title';
    head.textContent = title;
    this.result.append(head);
    for (const g of groups) {
      const line = document.createElement('div');
      line.className = 'dice-line';
      g.members.forEach((m, i) => {
        if (i > 0) {
          const arrow = document.createElement('span');
          arrow.className = 'dice-arrow';
          arrow.textContent = '→';
          line.append(arrow);
        }
        const name = document.createElement('span');
        name.className = 'dice-name';
        name.dataset.side = m.mine ? 'mine' : 'theirs';
        name.textContent = m.name;
        line.append(name);
      });
      this.result.append(line);
    }
    this.root.classList.remove('hidden', 'out', 'landed');
    this.root.dataset.art = this.art;
    this.elapsed = 0;
    this.paint();
  }

  update(delta: number): void {
    if (this.elapsed < 0) return;
    this.elapsed += delta;
    if (this.elapsed >= DICE_TOTAL_MS) {
      this.elapsed = -1;
      this.root.classList.add('hidden');
      return;
    }
    this.paint();
  }

  private paint(): void {
    const f = this.frame;
    const col = f % DICE_COLS;
    const row = Math.floor(f / DICE_COLS);
    this.sprite.style.backgroundPosition =
      `${(col / (DICE_COLS - 1)) * 100}% ${(row / (DICE_ROWS - 1)) * 100}%`;
    // 멈춘 순간 결과가 떠오른다 — 그림이 없으면 처음부터 결과만
    this.root.classList.toggle('landed', this.elapsed >= ROLL_MS * 0.85 || this.art === 'missing');
    this.root.classList.toggle('out', this.elapsed >= ROLL_MS + HOLD_MS);
  }
}
