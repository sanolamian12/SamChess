/**
 * 컬렉션 배지 — 장수 카드의 초상 모서리 (2026-10-14, `Design/컬렉션_기획.md` §4)
 *
 * ```
 *  ┌────────┐
 *  │ 초상    │        감녕
 *  │        │   [룩] (S)  Lv1
 *  ■────────┘                        ■ 붉은 네모 인장 — 판을 만들 때 켜진 컬렉션 효과 **전부**(능력치 · 진영 SP · 고유기술 SP)
 *  …
 *  [ 고유기술 라벨 ]        SP 6 5     고유기술 SP가 바뀌었으면 SP 칸은 원래 값에 줄만 긋는다(배지는 인장 하나)
 * ```
 *
 * 처음엔 배지가 둘(발동 효과 인장 · 기술 변형 옥색 마름모)이었는데, 기획자가 옥색 마름모를 **태학 개량 책략**의 표지로
 * 돌렸다(`ui/upgradeMark.ts`) — 컬렉션은 인장 하나가 다 맡는다(2026-10-14).
 *
 * **상태 엠블럼(카드 위 테의 둥근 메달)과 자리 · 모양을 나눈다.** **상대에게도 보인다**: 안 보이면 상대 HP가 왜 12인지 설명할 길이 없다.
 * 근거는 엔진이 판을 만들 때 남긴 `UnitState.bonuses` 하나다 — 화면이 조건을 다시 재지 않는다.
 * 글은 `collectionText.ts`의 `effectLine()`(다국어 조립)을 그대로 쓴다.
 * 그림(`ui/badge-active.png`)이 없으면 CSS로 그린 임시 표지로 물러난다.
 */

import { collectionById } from '@samchess/data';
import type { CollectionData } from '@samchess/data';
import type { UnitState } from '@samchess/rules';
import { t } from '../i18n/index.ts';
import { collectionTitle, effectLine } from '../screens/collectionText.ts';
import type { StatusPopup } from './statusPopup.ts';

/** 이 유닛에게 켜진 컬렉션 — 한 컬렉션이 보너스를 여럿 줘도 한 번만, 엔진이 실은 순서대로 */
export function unitCollections(unit: UnitState): CollectionData[] {
  const ids = [...new Set((unit.bonuses ?? []).map((b) => b.source))];
  return ids.map((id) => collectionById.get(id)).filter((c): c is CollectionData => !!c);
}

/** 「도원결의 — 유비·관우·장비 함께 참전 시 유비·관우·장비 HP+2」 */
export const collectionLine = (c: CollectionData): string => `${collectionTitle(c)} — ${effectLine(c)}`;

/** 인장 하나. 켜진 것이 없으면 `null` */
export function collectionBadge(unit: UnitState, tip: StatusPopup): HTMLElement | null {
  const list = unitCollections(unit);
  if (list.length === 0) return null;
  const b = document.createElement('button');
  b.className = 'cb cb-fx';
  b.dataset.bonus = 'collection';                      // 스모크는 글자가 아니라 이것으로 건다
  b.dataset.source = list.map((c) => c.id).join(',');
  const title = t('collection.battle.fx');
  b.title = title;
  const art = document.createElement('img');
  art.alt = '';
  art.src = 'ui/badge-active.png';
  art.addEventListener('error', () => { art.remove(); b.classList.add('cb-css'); });
  b.append(art);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    tip.showLines('buff', title, list.map(collectionLine));
  });
  return b;
}
