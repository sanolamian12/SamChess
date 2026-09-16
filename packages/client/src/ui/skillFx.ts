/**
 * 고유기술 발동 연출 — 두루마리 (2026-09-15 전면 개편, 기획자 지정)
 *
 * **4단으로 이어지고, 도는 동안 내내 판이 멈춘다** — 시간도 흐르지 않고 입력도
 * 받지 않는다. 고유기술은 턴을 소비하지 않아서(GDD §3.4) 연출 직후 곧바로
 * 이동·공격이 이어지는데, 그 사이에 화면이 바뀌면 볼 겨를이 없다.
 *
 * | 단 | 무엇 | 길이 | 소리 | 원본 |
 * |---|---|---|---|---|
 * | `unroll` | 두루마리 1 → 16 (0.1초씩) | 1.6초 | 시작 효과음 | `public/skills/scroll/{n}.png` |
 * | `action` | 종이 위에 기술 장면 1·2·3·4 (1 / 0.5 / 0.5 / 1초) | 3초 | **성우 대사** | `public/skills/action/{기술id}/{n}.jpg` |
 * | `caption` | 종이 위에 라벨 + 효과 설명(붓글씨) | 2초 | — | `public/skills/{기술id}.jpg` |
 * | `roll` | 두루마리 16 → 1 (0.1초씩), 점점 투명해진다 | 1.6초 | — | 1단과 같은 16장 |
 *
 * 합계 **8.2초**. 대사(4~6.5초, `assets/Audio/Specialskills/`)는 2단이 시작하는
 * 프레임에 틀어 8.1초 안에 끝난다 — 그래서 대사를 트는 자리가 씬(`BattleScene`)이
 * 아니라 **이 시간표**다. 씬이 시전 즉시 틀면 1.6초 앞서 나온다.
 *
 * ────────────────────────────────────────────────────────────────
 * 옛 연출에서 걷어낸 것
 * ────────────────────────────────────────────────────────────────
 *
 * 시전자 얼굴(2초) → 기술 배너(4초) → 일회성 그림(`vfx/A..G`, 있는 기술만)이었다.
 * **일회성 그림은 고유기술에서 연결을 끊었다** — 모든 기술이 같은 두루마리로 돈다
 * (`tools/extract_data.py`의 `STATUS_FX_ONESHOT_RETIRED`). 책략의 일회성은 그대로다.
 *
 * ────────────────────────────────────────────────────────────────
 * 칸을 `src` 갈아 끼우기가 아니라 겹쳐 둔 그림의 on/off로 넘긴다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 0.1초마다 한 `<img>`의 `src`를 바꾸면, 캐시에 있어도 디코딩이 한 박자 늦는 칸에서
 * **빈 프레임이 비친다.** 16장을 겹쳐 두고 하나만 보이게 하면 그런 틈이 없다 —
 * 액션 시트가 `background-position`만 옮기는 것과 같은 이유다. 그래도 **처음
 * 받는 순간**은 못 피하므로 전투를 열 때 `preload()`로 미리 받는다.
 *
 * 그림이 없으면(에셋은 리포에 없다) 그 그림만 비고 시간은 그대로 간다.
 * 라벨이 없으면 기술 이름을 글자로 대신 쓴다.
 *
 * ────────────────────────────────────────────────────────────────
 * 시스템 대화는 연출이 끝나고 나온다
 * ────────────────────────────────────────────────────────────────
 *
 * 배경이 어두워진 상태에서 말풍선이 지나가 **글자가 묻혔다**(기획자 지적 2026-08-13).
 * 그래서 `active`인 동안에는 씬이 `SystemLog`를 갱신하지 않는다.
 */

import { scrollFrameUrl, skillActionUrl, skillArtUrl } from './art.ts';
import { currentLang } from '../i18n/index.ts';

/** 두루마리 칸 수. `tools/build_portraits.py`의 `SCROLL_FRAMES`와 같아야 한다 */
export const SCROLL_FRAMES = 16;
/** 두루마리 한 칸 (기획자 지정 «0.1초») */
export const SCROLL_FRAME_MS = 100;
/** 기술 장면 넉 장 각각의 길이 (기획자 지정 «1초 · 0.5초 · 0.5초 · 1초») */
export const ACTION_MS = [1000, 500, 500, 1000] as const;
/** 라벨 + 효과 설명 (기획자 지정 «2초») */
export const CAPTION_MS = 2000;

const UNROLL_MS = SCROLL_FRAMES * SCROLL_FRAME_MS;
const ACTION_TOTAL_MS = ACTION_MS.reduce((a, b) => a + b, 0);
/** 연출 전체 — 이만큼 판이 멈춘다 */
export const SKILL_FX_MS = UNROLL_MS + ACTION_TOTAL_MS + CAPTION_MS + UNROLL_MS;

export type SkillFxStage = 'unroll' | 'action' | 'caption' | 'roll';

export interface SkillFxFrame {
  stage: SkillFxStage;
  /** 보여 줄 두루마리 칸, 1~16 */
  scroll: number;
  /** 보여 줄 기술 장면, 1~4. `action` 단이 아니면 0 */
  action: number;
  /** 연출 전체의 불투명도. `roll` 단에서만 1 → 0으로 줄어든다 */
  opacity: number;
}

/**
 * 시전 후 `elapsedMs`가 지났을 때 무엇을 보여 주나. 끝났으면 `null`.
 *
 * **시간표는 이 함수 하나가 정한다** — DOM을 모르므로 `test/skillFx.test.ts`가
 * 8.2초를 통째로 훑어 고정한다. 칸 경계(정확히 100ms)에서 다음 칸으로 넘어간다.
 */
export function skillFxFrame(elapsedMs: number): SkillFxFrame | null {
  let t = Math.max(0, elapsedMs);
  if (t < UNROLL_MS) {
    return { stage: 'unroll', scroll: Math.floor(t / SCROLL_FRAME_MS) + 1, action: 0, opacity: 1 };
  }
  t -= UNROLL_MS;
  if (t < ACTION_TOTAL_MS) {
    let n = 0;
    let edge = 0;
    while (t >= edge + ACTION_MS[n]!) { edge += ACTION_MS[n]!; n++; }
    return { stage: 'action', scroll: SCROLL_FRAMES, action: n + 1, opacity: 1 };
  }
  t -= ACTION_TOTAL_MS;
  if (t < CAPTION_MS) {
    return { stage: 'caption', scroll: SCROLL_FRAMES, action: 0, opacity: 1 };
  }
  t -= CAPTION_MS;
  if (t < UNROLL_MS) {
    return {
      stage: 'roll',
      scroll: SCROLL_FRAMES - Math.floor(t / SCROLL_FRAME_MS),
      action: 0,
      // 말리는 동안 **점점** 사라진다 — 칸 단위로 끊지 않고 이어서 줄여야 부드럽다
      opacity: 1 - t / UNROLL_MS,
    };
  }
  return null;
}

/** 단이 바뀌는 순간 씬이 소리를 틀 자리 */
export interface SkillFxCues {
  /** 1단 첫 프레임 — 시작 효과음 */
  start(skillId: string): void;
  /** 2단 첫 프레임 — 성우 대사 */
  action(skillId: string): void;
  /** 4단이 끝나 연출이 걷히는 프레임 — 붙들어 둔 배경음악을 다시 튼다 */
  end(skillId: string): void;
}

/** 효과 설명의 붓글씨체 — 언어마다 그 문자를 그릴 수 있는 것으로 (`style.css`의 `.fx-desc`) */
const BRUSH_FONT_PROBE = "1em 'Nanum Brush Script'";

export class SkillFx {
  private elapsedMs = 0;
  private running = false;
  private skillId = '';
  private stage: SkillFxStage | null = null;
  private scrollShown = 0;
  private actionShown = 0;

  private readonly stageEl: HTMLElement;
  private readonly scrolls: HTMLImageElement[] = [];
  private readonly actions: HTMLImageElement[] = [];
  private readonly label: HTMLImageElement;
  private readonly name: HTMLElement;
  private readonly desc: HTMLElement;
  /** 미리 받아 둔 그림을 붙들어 둔다 — 참조가 없으면 브라우저가 디코딩본을 버린다 */
  private readonly warm: HTMLImageElement[] = [];

  private readonly root: HTMLElement;
  private readonly cues: SkillFxCues | undefined;

  // 파라미터 프로퍼티(`constructor(private readonly root…)`)를 안 쓴다 — Node 타입
  // 스트리핑이 막아 `test/skillFx.test.ts`가 이 파일을 못 불러온다(CLAUDE.md)
  constructor(root: HTMLElement, cues?: SkillFxCues) {
    this.root = root;
    this.cues = cues;
    root.classList.add('hidden');

    this.stageEl = el('div', 'fx-stage');
    for (let n = 1; n <= SCROLL_FRAMES; n++) {
      const img = hideOnError(el('img', 'fx-scroll'));
      img.alt = '';
      img.src = scrollFrameUrl(n);
      img.hidden = true;
      this.scrolls.push(img);
    }

    const paper = el('div', 'fx-paper');
    for (let n = 1; n <= ACTION_MS.length; n++) {
      const img = hideOnError(el('img', 'fx-action'));
      img.alt = '';
      img.hidden = true;
      this.actions.push(img);
    }
    const caption = el('div', 'fx-card');
    this.label = el('img', 'fx-label');
    this.label.alt = '';
    // 라벨이 없으면 그림을 걷고 기술 이름을 글자로 쓴다 — 자리와 시간은 그대로다
    this.label.onerror = () => { caption.dataset.noart = '1'; };
    this.name = el('div', 'fx-name');
    this.desc = el('p', 'fx-desc');
    caption.append(this.label, this.name, this.desc);
    paper.append(...this.actions, caption);

    this.stageEl.append(...this.scrolls, paper);
    root.replaceChildren(this.stageEl);
  }

  /**
   * 연출 중인가 — 씬이 이 값을 보고 진행·입력·**대화**를 멈춘다.
   * 4단 전부를 포함한다. 한 단만 세면 그 사이에 판이 다시 돌아 다음 행동이 겹친다.
   */
  get active(): boolean { return this.running; }

  /** 지금 어느 단인가. 스모크가 순서를 확인하는 자리다(`#fx[data-stage]`와 같다). */
  get phase(): SkillFxStage | 'idle' { return this.stage ?? 'idle'; }

  /**
   * 이번 판에 나올 수 있는 기술의 그림을 미리 받는다. 전투를 열 때 한 번 부른다.
   *
   * 0.1초짜리 칸을 시전하는 순간에 받으면 첫 재생에서 두루마리가 건너뛴다.
   * 두루마리 16장은 생성자가 이미 `src`를 걸어 받기 시작했다.
   */
  preload(skillIds: Iterable<string>): void {
    for (const id of new Set(skillIds)) {
      const urls = [skillArtUrl(id)];
      for (let n = 1; n <= ACTION_MS.length; n++) urls.push(skillActionUrl(id, n));
      for (const url of urls) {
        const img = new Image();
        img.src = url;
        this.warm.push(img);
      }
    }
    // 붓글씨체는 전투 전 화면에서 거의 안 쓰여 처음 뜰 때 받는다 — 2초짜리 설명이
    // 대체 글꼴로 떴다 바뀌지 않게 미리 받아 둔다(없으면 조용히 넘어간다)
    void document.fonts?.load(BRUSH_FONT_PROBE).catch(() => { /* 오프라인 */ });
  }

  /**
   * @param skillName 화면 언어의 기술 이름 — 라벨 그림이 없을 때만 보인다
   * @param skillText 화면 언어의 효과 설명 — 3단에서 라벨 아래에 쓴다
   */
  play(skillId: string, skillName: string, skillText: string): void {
    // **돌던 연출이 있으면 그 칸부터 걷는다.** 보이는 칸 번호만 0으로 되돌리면 그 칸이
    // 켜진 채 남아 두루마리가 겹쳐 그려진다 — 한 묶음의 이벤트에 고유기술이 둘이면
    // (사망 시 발동 + 시전) 실제로 이어서 불린다
    this.finish(false);
    this.skillId = skillId;
    this.elapsedMs = 0;
    this.running = true;

    this.actions.forEach((img, i) => {
      img.hidden = true;
      img.style.visibility = '';
      img.src = skillActionUrl(skillId, i + 1);
    });
    const card = this.label.parentElement!;
    delete card.dataset.noart;
    this.label.src = skillArtUrl(skillId);
    this.label.alt = skillName;
    this.name.textContent = skillName;
    this.desc.textContent = skillText;
    // 종이는 좁고 설명 길이는 언어마다 4배까지 벌어진다(한국어 최장 60자 · 포르투갈어 147자).
    // 세 칸으로 글자를 줄여 2초 안에 한 화면에 들게 한다(`style.css`의 `.fx-desc[data-len]`)
    this.desc.dataset.len = skillText.length > 80 ? 'l' : skillText.length > 40 ? 'm' : 's';
    this.root.dataset.lang = currentLang();

    this.root.style.opacity = '1';
    this.root.classList.remove('hidden', 'play');
    void this.root.offsetWidth;          // 어둠이 짙어지는 애니메이션을 다시 재생시킨다
    this.root.classList.add('play');
    this.render();
  }

  update(deltaMs: number): void {
    if (!this.running) return;
    this.elapsedMs += deltaMs;
    this.render();
  }

  /** 지금 시각의 칸을 화면에 맞춘다. 단이 바뀌는 **바로 그 프레임에** 소리를 튼다. */
  private render(): void {
    const f = skillFxFrame(this.elapsedMs);
    if (!f) { this.finish(true); return; }

    if (f.stage !== this.stage) {
      this.stage = f.stage;
      this.root.dataset.stage = f.stage;
      if (f.stage === 'unroll') this.cues?.start(this.skillId);
      if (f.stage === 'action') this.cues?.action(this.skillId);
    }
    if (f.scroll !== this.scrollShown) {
      if (this.scrollShown) this.scrolls[this.scrollShown - 1]!.hidden = true;
      this.scrolls[f.scroll - 1]!.hidden = false;
      this.scrollShown = f.scroll;
    }
    if (f.action !== this.actionShown) {
      if (this.actionShown) this.actions[this.actionShown - 1]!.hidden = true;
      if (f.action) this.actions[f.action - 1]!.hidden = false;
      this.actionShown = f.action;
    }
    this.root.style.opacity = String(f.opacity);
  }

  /** @param notify 연출이 **끝까지 돌아** 걷힐 때만 `end`를 알린다 — 새 연출이 덮을 때는 안 알린다 */
  private finish(notify: boolean): void {
    const was = this.running;
    this.running = false;
    this.stage = null;
    this.root.classList.add('hidden');
    this.root.classList.remove('play');
    delete this.root.dataset.stage;
    if (this.scrollShown) this.scrolls[this.scrollShown - 1]!.hidden = true;
    if (this.actionShown) this.actions[this.actionShown - 1]!.hidden = true;
    this.scrollShown = 0;
    this.actionShown = 0;
    if (was && notify) this.cues?.end(this.skillId);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** 그림이 없으면 자리만 비운다 — `hidden`은 시간표가 쥐고 있으므로 건드리지 않는다 */
function hideOnError(img: HTMLImageElement): HTMLImageElement {
  img.onerror = () => { img.style.visibility = 'hidden'; };
  return img;
}
