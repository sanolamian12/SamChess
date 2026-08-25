/**
 * 고유기술 발동 연출 (기획 pptx 24쪽 · 2026-08-13 확장, 2026-08-26 길이 조정)
 *
 * **3단으로 이어진다.** 순서는 기획자 지정이고, 도는 동안 내내 **판이 멈춘다** —
 * 시간도 흐르지 않고 입력도 받지 않는다. 고유기술은 턴을 소비하지 않아서(GDD §3.4)
 * 연출 직후 곧바로 이동·공격이 이어지는데, 그 사이에 화면이 바뀌면 볼 겨를이 없다.
 *
 * | 단 | 무엇 | 길이 | 원본 |
 * |---|---|---|---|
 * | 1 | **시전자 얼굴**이 판 전체에 번쩍 떴다 부드럽게 사라진다 | 2초 | `public/battle/{장수id}.jpg` |
 * | 2 | 기술 배너 + 이름 | 4초 | `public/skills/{기술id}.jpg` |
 * | 3 | 일회성 시각 효과 (있는 기술만) | 1초 | `public/vfx/{A..G}.png` |
 *
 * 1단이 붙은 이유는 **누가 쐈는지가 안 보였기 때문**이다. 배너는 기술 그림이라
 * 이름을 읽기 전에는 시전자를 알 수 없었다. 1·2단 길이는 성우 대사(4~6.5초,
 * `assets/Audio/Specialskills/`)가 배너 구간 안에서 다 나오도록 2026-08-26에
 * 1초·2초에서 늘렸다 — `BattleScene.playSoundCue`가 대사를 트는 시각(`skillCastStart`,
 * 1단이 시작하는 바로 그 프레임)과 맞춰서 6초(2+4) 동안 판이 멈춰 있는다.
 *
 * 그림이 없으면(에셋은 리포에 없다) 그 단은 글자만 남기고 시간은 그대로 간다.
 *
 * ────────────────────────────────────────────────────────────────
 * 시스템 대화는 연출이 끝나고 나온다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 배경이 어두워진 상태에서 말풍선이 지나가 **글자가 묻혔다**(기획자 지적 2026-08-13).
 * 그래서 `active`인 동안에는 씬이 `SystemLog`를 갱신하지 않는다 — 「누가 무엇을
 * 발동했다」는 연출이 걷히고 나서 읽힌다.
 */

import { battleArtUrl, skillArtUrl } from './art.ts';
import { BurstFx } from './burstFx.ts';

/** 1단 — 시전자 얼굴이 번쩍 떴다 사라지기까지 (기획자 지정 «2초», 2026-08-26) */
const FACE_MS = 2000;
/** 2단 — 배너를 띄워 두는 시간 (기획자 지정 «4초», 2026-08-26) */
const HOLD_MS = 4000;

type Stage = 'face' | 'banner';

export class SkillFx {
  private remainMs = 0;
  private stage: Stage = 'face';
  /** 다음 단으로 넘어갈 때 쓸 것들. `play()`가 담아 두고 단이 바뀔 때 꺼낸다. */
  private next: {
    skillId: string; skillName: string; casterName: string; burstVfx: string | undefined;
  } | null = null;

  constructor(private readonly root: HTMLElement, private readonly burst?: BurstFx) {
    root.replaceChildren();
    root.classList.add('hidden');
  }

  /**
   * 연출 중인가 — 씬이 이 값을 보고 진행·입력·**대화**를 멈춘다.
   *
   * **이어지는 단까지 전부 포함한다.** 한 단만 세면 그 사이에 판이 다시 돌기
   * 시작해 다음 행동이 연출 위로 겹친다.
   */
  get active(): boolean { return this.remainMs > 0 || (this.burst?.active ?? false); }

  /** 지금 어느 단인가. 스모크가 순서를 확인하는 자리다. */
  get phase(): 'face' | 'banner' | 'burst' | 'idle' {
    if (this.remainMs > 0) return this.stage;
    return this.burst?.active ? 'burst' : 'idle';
  }

  /**
   * @param officerId 시전자 — 1단의 얼굴 그림을 찾는 데 쓴다
   * @param burstVfx 배너 뒤에 이어 붙일 일회성 그림(`A`~`G`). 없으면 배너로 끝난다.
   */
  play(
    skillId: string, skillName: string, casterName: string,
    officerId: string, burstVfx?: string,
  ): void {
    this.next = { skillId, skillName, casterName, burstVfx };
    this.showFace(officerId, casterName);
  }

  /** 1단 — 시전자 얼굴. 「누가 발동했는지」를 그림으로 먼저 알린다. */
  private showFace(officerId: string, casterName: string): void {
    const img = document.createElement('img');
    img.className = 'fx-face';
    img.alt = casterName;
    img.onerror = () => { img.onerror = null; img.remove(); };
    img.src = battleArtUrl(officerId);

    const name = document.createElement('div');
    name.className = 'fx-caster';
    name.textContent = casterName;

    this.root.replaceChildren(img, name);
    this.show('face');
    this.stage = 'face';
    this.remainMs = FACE_MS;
  }

  /** 2단 — 기술 배너 + 이름 */
  private showBanner(): void {
    const n = this.next!;
    const img = document.createElement('img');
    img.className = 'fx-banner';
    img.alt = n.skillName;
    // 배너가 없으면 이미지를 걷고 글자만 남긴다 — 자리와 시간은 그대로다
    img.onerror = () => { img.onerror = null; img.remove(); };
    img.src = skillArtUrl(n.skillId);

    const caption = document.createElement('div');
    caption.className = 'fx-caption';
    caption.textContent = `${n.casterName} — 「${n.skillName}」`;

    this.root.replaceChildren(img, caption);
    this.show('banner');
    this.stage = 'banner';
    this.remainMs = HOLD_MS;
  }

  /** 애니메이션을 다시 재생시키려면 클래스를 껐다 켜야 한다 */
  private show(stage: Stage): void {
    this.root.classList.remove('hidden', 'play');
    this.root.dataset.stage = stage;
    void this.root.offsetWidth;
    this.root.classList.add('play');
  }

  update(deltaMs: number): void {
    if (this.remainMs > 0) {
      this.remainMs -= deltaMs;
      if (this.remainMs > 0) return;
      this.remainMs = 0;
      // 다음 단으로 **바로 그 프레임에** 넘어간다. 다음 갱신으로 미루면 한 프레임
      // 동안 아무것도 없는 판이 비쳐 단과 단이 끊겨 보인다.
      if (this.stage === 'face') { this.showBanner(); return; }
      this.root.classList.add('hidden');
      this.root.classList.remove('play');
      delete this.root.dataset.stage;
      if (this.next?.burstVfx && this.burst) this.burst.play(this.next.burstVfx);
      this.next = null;
      return;
    }
    this.burst?.update(deltaMs);
  }
}
