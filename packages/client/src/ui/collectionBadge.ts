/**
 * 컬렉션 배지 — 장수 카드의 초상 모서리 · 고유기술 SP 앞 (2026-10-14, `Design/컬렉션_기획.md` §4)
 *
 * ```
 *  ┌────────┐
 *  │ 초상    │        감녕
 *  │        │   [룩] (S)  Lv1
 *  ◆────────┘                        ◆ 발동 효과 — 판을 만들 때 조건이 맞아 켜진 능력치 · 진영 SP
 *  …
 *  [ 고유기술 라벨 ]      ◇ SP 6 5     ◇ 기술 변형 — 고유기술 SP −1 (6에 줄, 5는 엔진의 `uniqueSkillCost`)
 * ```
 *
 * **상태 엠블럼(카드 위 테의 둥근 메달)과 자리 · 모양을 나눈다** — 이쪽은 네모 인장 · 마름모다.
 * **상대에게도 보인다**: 안 보이면 상대 HP가 왜 12인지 설명할 길이 없다.
 *
 * 근거는 엔진이 판을 만들 때 남긴 `UnitState.bonuses` 하나다 — 화면이 조건을 다시 재지 않는다.
 * 글은 `collectionText.ts`의 `effectLine()`(다국어 조립)을 그대로 쓴다.
 *
 * 그림(`ui/badge-*.png`)이 아직 없으면 CSS로 그린 임시 표지로 물러난다 — 고유기술 라벨이 그림 없을 때 글자로 물러나는 것과 같은 규약.
 */

import { collectionById } from '@samchess/data';
import type { CollectionData } from '@samchess/data';
import type { RosterBonus, UnitState } from '@samchess/rules';
import { t } from '../i18n/index.ts';
import { collectionTitle, effectLine } from '../screens/collectionText.ts';
import type { StatusPopup } from './statusPopup.ts';

/** 배지 두 종류 — `fx` 발동 효과(능력치 · 진영 SP) · `skill` 기술 변형(고유기술 SP) */
export type BadgeKind = 'fx' | 'skill';

const isKind = (b: RosterBonus, kind: BadgeKind): boolean => (kind === 'skill') === (b.kind === 'skillSp');

/** 이 유닛에게 켜진 컬렉션 — 한 컬렉션이 보너스를 여럿 줘도 한 번만, 엔진이 실은 순서대로 */
export function unitCollections(unit: UnitState, kind?: BadgeKind): CollectionData[] {
  const ids = [...new Set((unit.bonuses ?? []).filter((b) => !kind || isKind(b, kind)).map((b) => b.source))];
  return ids.map((id) => collectionById.get(id)).filter((c): c is CollectionData => !!c);
}

/** 「도원결의 — 유비·관우·장비 함께 참전 시 유비·관우·장비 HP+2」 */
export const collectionLine = (c: CollectionData): string => `${collectionTitle(c)} — ${effectLine(c)}`;

/** 배지 하나. 켜진 것이 없으면 `null` */
export function collectionBadge(unit: UnitState, kind: BadgeKind, tip: StatusPopup): HTMLElement | null {
  const list = unitCollections(unit, kind);
  if (list.length === 0) return null;
  const b = document.createElement('button');
  b.className = `cb cb-${kind}`;
  b.dataset.bonus = kind;                              // 스모크는 글자가 아니라 이것으로 건다
  b.dataset.source = list.map((c) => c.id).join(',');
  const title = t(kind === 'fx' ? 'collection.battle.fx' : 'collection.battle.skill');
  b.title = title;
  const art = document.createElement('img');
  art.alt = '';
  art.src = `ui/badge-${kind === 'fx' ? 'active' : 'skill'}.png`;
  art.addEventListener('error', () => { art.remove(); b.classList.add('cb-css'); });
  b.append(art);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    tip.showLines('buff', title, list.map(collectionLine));
  });
  return b;
}
