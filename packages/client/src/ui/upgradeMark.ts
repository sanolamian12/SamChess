/**
 * 태학 개량 책략 표지 — 옥색 마름모 (2026-10-14 기획자 지정, 그림 `ui/badge-upgrade.png`)
 *
 * 개량형(「회복+」 등, GDD §5.12)은 이름 끝의 「+」 하나로만 원본과 갈렸다. 전투 화면에서 책략을 고르는 목록(`contextPanel`)과
 * 적 책략 팝업(`deployPanel`)의 이름 앞에 작은 마름모를 붙인다. 개량형인지는 데이터의 `base`(원본 id)가 말한다 —
 * 화면이 이름의 「+」를 보고 가르지 않는다(언어마다 이름이 다르다).
 * 그림이 없으면 CSS로 그린 옥색 마름모로 물러난다(컬렉션 인장과 같은 규약).
 */

import type { TacticData } from '@samchess/data';

export const isUpgraded = (def: TacticData): boolean => !!def.base;

export function upgradeMark(def: TacticData): HTMLElement | null {
  if (!isUpgraded(def)) return null;
  const mark = document.createElement('span');
  mark.className = 'um';
  mark.dataset.upgrade = def.base!;
  const art = document.createElement('img');
  art.alt = '';
  art.src = 'ui/badge-upgrade.png';
  art.addEventListener('error', () => { art.remove(); mark.classList.add('um-css'); });
  mark.append(art);
  return mark;
}
