/**
 * 책략 · 학파를 **글자 대신 그림으로** (2026-10-23 기획자 지정 — 태학 · 궁궐 장수 상세 · 레벨업 판).
 *
 * - **책략**(`TacticIcon`) — 전투 화면이 쓰는 것과 같은 책략 엠블럼(`icons/emblem-{책략 id}.png`, `ui/statusChips.ts`의 `emblemUrl`).
 *   태학 개량형(「공포+」)은 원본의 엠블럼에 **「+」 표**를 단다 — 전투 화면의 맥락 판도 개량형을 원본 그림으로 그린다(`contextPanel.ts`).
 * - **학파**(`SchoolIcon`) — 지원책 · 환술 표식(`icons/school-{support|illusion}.png`, `assets/icons/ui/magics.png`를 `tools/build_ui.py`의
 *   `STRIPS`가 가른다).
 *
 * 이름은 `alt` · `title`로 남긴다 — 글자가 사라져도 읽어 주는 것과 마우스를 올린 설명은 그대로다.
 */

import { tacticById } from '@samchess/data';
import { emblemUrl } from '../ui/statusChips.ts';
import { t } from '../i18n/index.ts';

export type School = 'support' | 'illusion';

/** 책략 엠블럼 — 개량형은 원본 그림 + 「+」 */
export function TacticIcon({ id, label, className }: {
  id: string;
  /** 읽어 주는 이름 · 마우스를 올린 설명 */
  label?: string;
  className?: string;
}): React.JSX.Element {
  const def = tacticById.get(id);
  const upgraded = !!def?.base;
  return (
    <span className={`tac-icon${className ? ` ${className}` : ''}`} data-tactic={id} data-school={def?.school}
      data-upgraded={upgraded ? '1' : undefined} title={label}>
      <img src={emblemUrl(def?.base ?? id)} alt={label ?? ''} draggable={false} />
      {upgraded && <b className="tac-icon-plus" aria-hidden>+</b>}
    </span>
  );
}

/** 학파 표식 — 지원책(하트) · 환술(눈) */
export function SchoolIcon({ school, className }: { school: School; className?: string }): React.JSX.Element {
  const name = t(school === 'support' ? 'academy.school.support' : 'academy.school.illusion');
  return (
    <img className={`school-icon${className ? ` ${className}` : ''}`} data-school={school}
      src={`icons/school-${school}.png`} alt={name} title={name} draggable={false} />
  );
}
