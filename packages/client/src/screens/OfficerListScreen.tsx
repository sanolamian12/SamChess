/**
 * 장수 일람 (pptx 37·38쪽)
 *
 * 37쪽 원문 — 「처음엔 목록 형식으로 제공 / 장수 검색, 가나다순, 무력/지력/통솔력
 * sorting 지원 / 클래스, 성명, [무력, 지력, 통솔력], 레벨, [레벨업 Flag]」.
 *
 * ────────────────────────────────────────────────────────────────
 * 화면은 고르기만 하고 **판정도 정렬도 하지 않는다**
 * ────────────────────────────────────────────────────────────────
 *
 * 줄 만들기·검색·정렬·요약은 전부 `@samchess/meta`의 `officers.ts`에 있다.
 * 화면이 `카드 >= 필요분`을 다시 적으면 규칙이 바뀌었을 때 **배지만** 조용히
 * 어긋나고, 「가나다순」이 진짜 사전 순인지는 스크린샷으로 확인할 수 없다.
 * 전투 UI가 `validate()`에 묻는 것과 같은 결이다.
 *
 * **배경은 눌러 깐다**(`.scr-dim`). 편성 화면과 같은 이유로 — 표가 빽빽해서
 * 그림을 그대로 두면 글자가 묻는다. 여기 그림은 「여기가 궁궐이다」만 말하면 된다.
 */

import { useMemo, useState } from 'react';
import type { OfficerId } from '@samchess/rules';
import { OFFICER_SORTS, gradeTally, officerRows, poolCap, poolUsed, searchRows, sortRows } from '@samchess/meta';
import type { OfficerSort, PlayerProfile } from '@samchess/meta';
import { backdropStyle, placeBackdrop } from './backdrop.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

const SORT_KEY: Record<OfficerSort, 'officers.sort.name' | 'officers.sort.might' | 'officers.sort.intellect' | 'officers.sort.leadership'> = {
  name: 'officers.sort.name',
  might: 'officers.sort.might',
  intellect: 'officers.sort.intellect',
  leadership: 'officers.sort.leadership',
};

export function OfficerListScreen({ profile, onBack, onOpen }: {
  profile: PlayerProfile;
  onBack: () => void;
  onOpen: (officer: OfficerId) => void;
}): React.JSX.Element {
  useLang();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<OfficerSort>('name');

  const rows = useMemo(() => sortRows(searchRows(officerRows(profile), query), sort), [profile, query, sort]);
  const tally = useMemo(() => gradeTally(profile), [profile]);

  return (
    <div
      className="scr scr-officers scr-dim"
      data-screen="officer-list"
      style={backdropStyle(placeBackdrop('palace', profile.cityLevel))}
    >
      <header className="bar">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('officers.back')}</button>
        <span className="ttl">{t('officers.title')}</span>
        <span className="tail">{rows.length}명</span>
      </header>

      <section className="block ofc-find">
        <input
          className="field ofc-search"
          data-field="search"
          value={query}
          placeholder={t('officers.search')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="ofc-sorts">
          {OFFICER_SORTS.map((s) => (
            <button
              key={s}
              className={`opt${sort === s ? ' on' : ''}`}
              data-sort={s}
              data-on={sort === s ? '1' : '0'}
              onClick={() => setSort(s)}
            >
              {t(SORT_KEY[s])}
            </button>
          ))}
        </div>
      </section>

      <section className="block grow ofc-table">
        {/* 표 머리는 목록과 같은 그리드를 쓴다 — 열 폭이 갈리면 숫자가 어긋나 보인다 */}
        <div className="ofc-row ofc-thead">
          <span className="c-gr">{t('officers.col.grade')}</span>
          <span className="c-nm">{t('officers.col.name')}</span>
          <span className="c-st">{t('officers.sort.might')}</span>
          <span className="c-st">{t('officers.sort.intellect')}</span>
          <span className="c-st">{t('officers.sort.leadership')}</span>
          <span className="c-lv">{t('officers.col.level')}</span>
        </div>
        <div className="ofc-rows">
          {rows.map((r) => (
            <button
              key={r.officer}
              className="ofc-row"
              data-officer={r.officer}
              data-grade={r.grade}
              data-levelup={r.canLevelUp ? '1' : '0'}
              onClick={() => onOpen(r.officer)}
            >
              <span className="c-gr"><span className="gr" data-grade={r.grade}>{r.grade}</span></span>
              <span className="c-nm">{pickOfficerNameById(r.officer, r.name)}</span>
              <span className="c-st">{r.might}</span>
              <span className="c-st">{r.intellect}</span>
              <span className="c-st">{r.leadership}</span>
              <span className="c-lv">
                Lv{r.level}
                {/* 레벨업 Flag — 「카드를 보유하고 있다면 ON」(37쪽) */}
                {r.canLevelUp && <span className="ofc-flag" data-flag="levelup">{t('officers.flag')}</span>}
              </span>
            </button>
          ))}
          {rows.length === 0 && <p className="hint">{t('officers.empty', { q: query.trim() })}</p>}
        </div>
      </section>

      {/* 요약 줄 (38·39쪽 아래) — 「장수 : Cur / Max 명 · [E]: Y/N. [S]: x, …」 */}
      <footer className="foot ofc-tally" data-tally={`${tally.hasEmperor ? 'Y' : 'N'}/${tally.S}/${tally.A}/${tally.B}/${tally.C}/${tally.D}`}>
        <span className="ofc-count">{t('officers.count', { cur: poolUsed(profile), max: poolCap(profile) })}</span>
        <span className="ofc-grades">
          <span className="g" data-grade="E">[E]: {tally.hasEmperor ? 'Y' : 'N'}</span>
          {(['S', 'A', 'B', 'C', 'D'] as const).map((g) => (
            <span key={g} className="g" data-grade={g}>[{g}]: {tally[g]}</span>
          ))}
        </span>
      </footer>
    </div>
  );
}
