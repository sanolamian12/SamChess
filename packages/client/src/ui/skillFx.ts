/**
 * 고유기술 발동 연출 — 두루마리 (2026-09-15 전면 개편, 기획자 지정)
 *
 * **4단으로 이어지고, 도는 동안 내내 판이 멈춘다** — 시간도 흐르지 않고 입력도
 * 받지 않는다. 고유기술은 턴을 소비하지 않아서(GDD §3.4) 연출 직후 곧바로
 * 이동·공격이 이어지는데, 그 사이에 화면이 바뀌면 볼 겨를이 없다.
 *
 * | 단 | 무엇 | 길이 | 소리 | 원본 |
 * |---|---|---|---|---|
 * | `unroll` | 두루마리 1 → 16 (0.1초씩) | 1.6초 | 시작 효과음 | `public/skills/scroll.webp` 16칸 띠 |
 * | `action` | 종이 위에 기술 장면 — 1번 페이드인 1초 → 1·2·3·4 (1 / 0.5 / 0.5 / 1초) → 4번 페이드아웃 1초 | 5초 | **성우 대사** | `public/skills/action/{기술id}/{n}.jpg` |
 * | `caption` | 두루마리 **위**에 라벨, 종이 한가운데 효과 설명(붓글씨), 오른쪽 아래 도장 | 3초 | — | `public/skills/{기술id}.jpg` |
 * | `roll` | 두루마리 16 → 1 (0.1초씩), 점점 투명해진다 | 1.6초 | — | 1단과 같은 띠 |
 *
 * 합계 **11.2초** (2026-09-18 기획자 지정 — 장면 앞뒤 페이드 1초씩 · 효과 설명 +1초. 그전 8.2초).
 * 대사(4~6.5초, `assets/Audio/Specialskills/`)는 2단이 시작하는(= 1번이 떠오르기 시작하는)
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
 * 두루마리는 띠 한 장의 `background-position`으로 넘긴다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 0.1초마다 한 `<img>`의 `src`를 바꾸면, 캐시에 있어도 디코딩이 한 박자 늦는 칸에서
 * **빈 프레임이 비친다.** 그래서 16장을 겹쳐 두고 on/off로 넘기다가(2026-09-15)
 * 2026-09-18에 원본이 움직이는 그림 한 장(`scroll_anim.webp`)으로 바뀌며 **16칸 가로
 * 띠 한 장**이 됐다 — 액션 시트와 같은 기법이고, 받는 것도 한 번이다.
 *
 * **움직이는 그림을 그대로 틀지 않는다.** 거꾸로(말기) 못 틀고, 같은 주소로 다시
 * 틀면 처음부터 안 돌며, 안 보이는 동안 시계가 가는지가 브라우저마다 달라 이
 * 시간표와 맞출 수 없다. 원본은 도구(`tools/build_portraits.py`)만 읽는다.
 * 그래도 **처음 받는 순간**은 못 피하므로 전투를 열 때 `preload()`로 미리 받는다.
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

import { scrollSheetUrl, sealUrl, skillActionUrl, skillArtUrl } from './art.ts';
import { currentLang } from '../i18n/index.ts';

/** 두루마리 칸 수. `tools/build_portraits.py`의 `SCROLL_FRAMES`와 같아야 한다 */
export const SCROLL_FRAMES = 16;
/** 두루마리 한 칸 (기획자 지정 «0.1초») */
export const SCROLL_FRAME_MS = 100;
/** 기술 장면 넉 장 각각의 길이 (기획자 지정 «1초 · 0.5초 · 0.5초 · 1초») — 페이드는 뺀 값이다 */
export const ACTION_MS = [1000, 500, 500, 1000] as const;
/**
 * 첫 장이 떠오르는 시간 · 마지막 장이 사라지는 시간 (2026-09-18 기획자 지정 «1초씩 더»).
 * `ACTION_MS`에 **더하는** 시간이다 — 첫 장은 1초에 걸쳐 떠오른 뒤 1초 온전히 보이고,
 * 마지막 장은 1초 온전히 보인 뒤 1초에 걸쳐 사라진다.
 */
export const ACTION_FADE_MS = 1000;
/** 라벨 + 효과 설명 (기획자 지정 «2초» → 2026-09-18 «읽는 데 1초 더» 3초) */
export const CAPTION_MS = 3000;

const UNROLL_MS = SCROLL_FRAMES * SCROLL_FRAME_MS;
const ACTION_SHOW_MS = ACTION_MS.reduce((a, b) => a + b, 0);
const ACTION_TOTAL_MS = ACTION_FADE_MS + ACTION_SHOW_MS + ACTION_FADE_MS;
/** 연출 전체 — 이만큼 판이 멈춘다 */
export const SKILL_FX_MS = UNROLL_MS + ACTION_TOTAL_MS + CAPTION_MS + UNROLL_MS;

export type SkillFxStage = 'unroll' | 'action' | 'caption' | 'roll';

export interface SkillFxFrame {
  stage: SkillFxStage;
  /** 보여 줄 두루마리 칸, 1~16 */
  scroll: number;
  /** 보여 줄 기술 장면, 1~4. `action` 단이 아니면 0 */
  action: number;
  /** 기술 장면의 불투명도 — 첫 장이 떠오르는 동안 0 → 1, 마지막 장이 사라지는 동안 1 → 0 */
  actionOpacity: number;
  /** 연출 전체의 불투명도. `roll` 단에서만 1 → 0으로 줄어든다 */
  opacity: number;
}

/**
 * 시전 후 `elapsedMs`가 지났을 때 무엇을 보여 주나. 끝났으면 `null`.
 *
 * **시간표는 이 함수 하나가 정한다** — DOM을 모르므로 `test/skillFx.test.ts`가
 * 11.2초를 통째로 훑어 고정한다. 칸 경계(정확히 100ms)에서 다음 칸으로 넘어간다.
 */
export function skillFxFrame(elapsedMs: number): SkillFxFrame | null {
  let t = Math.max(0, elapsedMs);
  if (t < UNROLL_MS) {
    return { stage: 'unroll', scroll: Math.floor(t / SCROLL_FRAME_MS) + 1, action: 0, actionOpacity: 0, opacity: 1 };
  }
  t -= UNROLL_MS;
  if (t < ACTION_TOTAL_MS) {
    const action = (n: number, actionOpacity: number): SkillFxFrame =>
      ({ stage: 'action', scroll: SCROLL_FRAMES, action: n, actionOpacity, opacity: 1 });
    if (t < ACTION_FADE_MS) return action(1, t / ACTION_FADE_MS);
    t -= ACTION_FADE_MS;
    if (t >= ACTION_SHOW_MS) return action(ACTION_MS.length, 1 - (t - ACTION_SHOW_MS) / ACTION_FADE_MS);
    let n = 0;
    let edge = 0;
    while (t >= edge + ACTION_MS[n]!) { edge += ACTION_MS[n]!; n++; }
    return action(n + 1, 1);
  }
  t -= ACTION_TOTAL_MS;
  if (t < CAPTION_MS) {
    return { stage: 'caption', scroll: SCROLL_FRAMES, action: 0, actionOpacity: 0, opacity: 1 };
  }
  t -= CAPTION_MS;
  if (t < UNROLL_MS) {
    return {
      stage: 'roll',
      scroll: SCROLL_FRAMES - Math.floor(t / SCROLL_FRAME_MS),
      action: 0,
      actionOpacity: 0,
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
  /** 두루마리 — 띠 한 장. 보이는 칸은 `data-frame`(스모크가 읽는다) */
  private readonly scroll: HTMLElement;
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

    root.classList.add('fx-root');
    this.stageEl = el('div', 'fx-stage');
    // 띠가 없으면(에셋은 리포에 없다) 배경만 비고 시간은 그대로 간다 — 오류 처리가 필요 없다
    this.scroll = el('div', 'fx-scroll');
    this.scroll.style.backgroundImage = `url(${scrollSheetUrl})`;
    this.scroll.hidden = true;

    const paper = el('div', 'fx-paper');
    for (let n = 1; n <= ACTION_MS.length; n++) {
      const img = hideOnError(el('img', 'fx-action'));
      img.alt = '';
      img.hidden = true;
      this.actions.push(img);
    }
    // 3단 (2026-09-18 기획자 지정) — **라벨은 두루마리 바깥 위**(`.fx-head`, 종이가 아니라
    // 두루마리 상자에 붙는다), **효과 설명은 종이 한가운데**, **도장은 종이 오른쪽 아래**
    const head = el('div', 'fx-head');
    this.label = el('img', 'fx-label');
    this.label.alt = '';
    // 라벨이 없으면 그림을 걷고 기술 이름을 글자로 쓴다 — 자리와 시간은 그대로다
    this.label.onerror = () => { head.dataset.noart = '1'; };
    this.name = el('div', 'fx-name');
    head.append(this.label, this.name);
    const caption = el('div', 'fx-card');
    this.desc = el('p', 'fx-desc');
    const seal = hideOnError(el('img', 'fx-seal'));
    seal.alt = '';
    seal.src = sealUrl;
    caption.append(this.desc, seal);
    paper.append(...this.actions, caption);

    this.stageEl.append(this.scroll, paper, head);
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
   * 두루마리 띠는 `background-image`라 화면에 뜨기 전에는 안 받으므로 여기서 함께 받는다.
   */
  preload(skillIds: Iterable<string>): void {
    const urls = [scrollSheetUrl, sealUrl];
    for (const id of new Set(skillIds)) {
      urls.push(skillArtUrl(id));
      for (let n = 1; n <= ACTION_MS.length; n++) urls.push(skillActionUrl(id, n));
    }
    for (const url of urls) {
      const img = new Image();
      img.src = url;
      this.warm.push(img);
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
    delete this.label.parentElement!.dataset.noart;
    this.label.src = skillArtUrl(skillId);
    this.label.alt = skillName;
    this.name.textContent = skillName;
    this.desc.textContent = skillText;
    // 종이는 좁고 설명 길이는 언어마다 4배까지 벌어진다(한국어 최장 60자 · 포르투갈어 147자).
    // 세 칸으로 글자를 줄여 3초 안에 한 화면에 들게 한다(`style.css`의 `.fx-desc[data-len]`)
    this.desc.dataset.len = skillText.length > 80 ? 'l' : skillText.length > 40 ? 'm' : 's';
    this.root.dataset.lang = currentLang();

    this.root.style.opacity = '1';
    this.root.classList.remove('hidden', 'play');
    void this.root.offsetWidth;          // 어둠이 짙어지는 애니메이션을 다시 재생시킨다
    this.root.classList.add('play');
    this.render();
  }

  /**
   * 끝까지 안 기다리고 걷는다 — 장수 일람의 미리보기에서 눌러 닫을 때만 쓴다.
   * 전투는 연출을 건너뛰지 않는다(판이 멈춰 있는 동안이 곧 연출이다).
   * 걷히는 것은 같으므로 `end`를 알린다 — 붙들어 둔 배경음악이 거기서 풀린다.
   */
  stop(): void {
    if (this.running) this.finish(true);
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
      this.scroll.hidden = false;
      // 띠 16칸 중 `f.scroll`번째 — 0%가 첫 칸, 100%가 끝 칸이다(`background-size: 1600%`)
      this.scroll.style.backgroundPositionX = `${((f.scroll - 1) / (SCROLL_FRAMES - 1)) * 100}%`;
      this.scroll.dataset.frame = String(f.scroll);
      this.scrollShown = f.scroll;
    }
    if (f.action !== this.actionShown) {
      if (this.actionShown) this.actions[this.actionShown - 1]!.hidden = true;
      if (f.action) this.actions[f.action - 1]!.hidden = false;
      this.actionShown = f.action;
    }
    // 페이드는 칸 단위가 아니라 프레임마다 이어서 — 말기의 투명도와 같은 이유다
    if (f.action) this.actions[f.action - 1]!.style.opacity = String(f.actionOpacity);
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
    this.scroll.hidden = true;
    delete this.scroll.dataset.frame;
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
