/**
 * 고유기술 팝업 — 전투 판 위 (전투 그래픽 마감, pptx 100쪽 · 2026-10-07)
 *
 * 배치 화면의 고유기술 패널에서 라벨을 누르면 뜬다. **메타 화면의 `SkillModal`(38쪽 아래)과 같은 껍데기**
 * (`.modal-back` · `.modal.ofc-skill-modal` · 등급별 판때기 그림)와 같은 줄(기술 명 · 유래 · 효과 · 소모 SP · 발동 시간)이다 —
 * 팝업이 화면마다 다른 모양이면 「닫는 곳」을 눈으로 찾게 된다.
 *
 * **[발동 영상 보기]는 없다**(100쪽 4, 기획자 지정) — 전투 판 위에서 연출을 틀면 배치 시계가 도는 동안 판을 덮는다.
 * 전투 UI는 DOM을 직접 다루므로(`BattleStage.tsx` 머리) React 컴포넌트를 다시 쓰지 않고 같은 마크업을 여기서 짓는다.
 * 줄을 고치면 `SkillModal.tsx`도 함께 본다.
 *
 * 닫는 길은 둘 — [뒤로] · 바깥(어둠)을 누른다.
 */

import { skillById } from '@samchess/data';
import { playSfx } from '../audio/sfx.ts';
import { t } from '../i18n/index.ts';
import { pickCastDelay, pickSkillName, pickSkillText, pickStory } from '../i18n/story.ts';
import { skillArtUrl } from './art.ts';

export class SkillPanel {
  constructor(private readonly root: HTMLElement) {
    root.replaceChildren();
    root.classList.add('hidden');
    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === root || target.closest('[data-action="close"]')) this.close();
    });
  }

  get isOpen(): boolean { return !this.root.classList.contains('hidden'); }

  close(): void {
    this.root.classList.add('hidden');
    this.root.replaceChildren();
    delete this.root.dataset.skill;
  }

  show(skillId: string): void {
    const skill = skillById.get(skillId);
    if (!skill) return;
    playSfx('paper');
    const modal = el('div', 'modal ofc-skill-modal');
    // 배경 판때기가 등급별로 두 장(S+E급 / A+B급) — `SkillModal`과 같은 갈래
    modal.dataset.tierGroup = skill.tier === 'S' || skill.tier === 'E' ? 's-e' : 'a-b';

    const banner = document.createElement('img');
    banner.className = 'ofc-banner';
    banner.alt = '';
    banner.src = skillArtUrl(skill.id);
    banner.addEventListener('error', () => banner.classList.add('no-art'));

    const name = el('p', 'row');
    const hanja = document.createElement('b');
    hanja.textContent = skill.hanja;
    name.append(key(t('skill.name')), ' : ', hanja, text('span', 'reading', `(${pickSkillName(skill)})`));

    const rows: HTMLElement[] = [name];
    const origin = pickStory(skill.origin);
    if (origin) rows.push(field('origin', t('skill.origin'), origin));
    rows.push(
      field('effect', t('skill.effect'), pickSkillText(skill)),
      field('sp', t('skill.sp'), String(skill.spCost)),
      field('castDelay', t('skill.castDelay'), pickCastDelay(skill)),
    );

    const back = text('button', 'btn wide', t('skill.close'));
    back.dataset.action = 'close';

    modal.append(banner, ...rows, back);
    this.root.dataset.skill = skill.id;
    this.root.replaceChildren(modal);
    this.root.classList.remove('hidden');
  }
}

function field(name: string, label: string, value: string): HTMLElement {
  const p = el('p', 'row');
  p.dataset.field = name;
  p.append(key(label), ` : ${value}`);
  return p;
}

function key(label: string): HTMLElement {
  return text('span', 'k', label);
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function text(tag: string, className: string, value: string): HTMLElement {
  const node = el(tag, className);
  node.textContent = value;
  return node;
}
