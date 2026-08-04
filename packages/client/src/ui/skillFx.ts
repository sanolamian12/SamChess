/**
 * 고유기술 발동 연출 (기획 pptx 24쪽)
 *
 * 체스판 위로 가로 배너(`assets/SpecialSkills/`)를 2초 띄운다.
 * 이 2초 동안은 **판이 멈춘다** — 시간도 흐르지 않고 입력도 받지 않는다.
 * 고유기술은 시전해도 턴을 소비하지 않아서(GDD §3.4) 연출 직후 곧바로 이동·공격이
 * 이어지는데, 그 사이에 화면이 바뀌어 버리면 무엇이 터졌는지 볼 겨를이 없다.
 *
 * 배너가 없으면(에셋은 리포에 없다) 기술 이름만 같은 자리·같은 시간으로 띄운다.
 */

import { skillArtUrl } from './art.ts';

/** 배너를 띄워 두는 시간 (기획자 지정 «한 2초») */
const HOLD_MS = 2000;

export class SkillFx {
  private remainMs = 0;

  constructor(private readonly root: HTMLElement) {
    root.replaceChildren();
    root.classList.add('hidden');
  }

  /** 연출 중인가 — 씬이 이 값을 보고 진행과 입력을 멈춘다 */
  get active(): boolean { return this.remainMs > 0; }

  play(skillId: string, skillName: string, casterName: string): void {
    const img = document.createElement('img');
    img.className = 'fx-banner';
    img.alt = skillName;
    // 배너가 없으면 이미지를 걷고 글자만 남긴다 — 자리와 시간은 그대로다
    img.onerror = () => { img.onerror = null; img.remove(); };
    img.src = skillArtUrl(skillId);

    const caption = document.createElement('div');
    caption.className = 'fx-caption';
    caption.textContent = `${casterName} — 「${skillName}」`;

    this.root.replaceChildren(img, caption);
    this.root.classList.remove('hidden');
    // 다시 발동할 때 애니메이션이 재생되도록 클래스를 껐다 켠다
    this.root.classList.remove('play');
    void this.root.offsetWidth;
    this.root.classList.add('play');
    this.remainMs = HOLD_MS;
  }

  update(deltaMs: number): void {
    if (this.remainMs <= 0) return;
    this.remainMs -= deltaMs;
    if (this.remainMs <= 0) {
      this.remainMs = 0;
      this.root.classList.add('hidden');
      this.root.classList.remove('play');
    }
  }
}
