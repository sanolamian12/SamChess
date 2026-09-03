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
 * **궁궐·병영·랭킹과 같은 틀을 쓴다**(`ScreenChrome` + `.place-bar`/`.place-body`/
 * `.place-panel`, 2026-09-02). 예전엔 이 화면부터 [레벨/스킬 관리]·[전적 관리]까지
 * 넷이 `PlaceScreen`·`CityScreen`·`RankingScreen`과 다른 화풍(제목 헤더도 기어도
 * 없는 `.scr-dim` 평면 판)이었다 — 같은 궁궐 갈래인데 문 하나 넘었다고 틀이
 * 바뀌면 「고장인가」로 읽힌다. 안의 표·배지 클래스(`.ofc-row`·`.ofc-tally` 등)는
 * 스모크(`tools/smoke_meta.ts`)가 그대로 잡고 있어 이름을 바꾸지 않는다 — 바뀌는
 * 것은 두르는 틀뿐이다.
 *
 * ────────────────────────────────────────────────────────────────
 * 검색·정렬·표도 랭킹과 같은 화풍이다 (2026-09-02)
 * ────────────────────────────────────────────────────────────────
 *
 * 정렬 넷(가나다·무력·지력·통솔)은 늘 펴 둔 칩 대신 **랭킹의 `SortMenu`를 그대로
 * 재사용**한다 — [정렬 필터] 버튼을 누르면 뜨는 팝업, 같은 목판·같은 장부 패널
 * 그림이다. 새 컴포넌트를 만들지 않고 `RankingCommon.tsx`의 것을 그대로 가져다
 * 쓴다 — 「같은 뜻이면 같은 그림」이 여기서는 「같은 뜻이면 같은 컴포넌트」다.
 *
 * **검색창은 랭킹의 `SearchBar`를 그대로 가져오지 않는다** — 랭킹은 검색이
 * 서버 왕복이라 [검색] 버튼(또는 Enter)을 눌러야 나가지만, 여기는 이미 받은
 * 로스터를 로컬에서 거르는 것이라 **타이핑마다 즉시** 걸러진다(`onChange`).
 * 그림만(`.rk-search.field`의 두루마리 테두리) 빌리고 버튼은 없다 — 값싼 필터에
 * 굳이 제출 단계를 넣으면 오히려 느려 보인다.
 *
 * 표(`.ofc-row`/`.ofc-thead`)는 **그리드 구조를 그대로 두고 색만** 장부 패널
 * 화풍으로 입힌다(`.scr-officers`로 좁힌 CSS, `style.css` 참조) — 랭킹의 `.rk-row`가
 * flex인 것과 다르지만, 열 폭이 이미 고정된 여섯 칸(등급·이름·삼능력·레벨)이라
 * flex로 다시 짤 이유가 없다.
 *
 * ────────────────────────────────────────────────────────────────
 * 열 명씩 쪽 나누기 · 요약 아이콘 · 「보기」 카드 (2026-09-02)
 * ────────────────────────────────────────────────────────────────
 *
 * **쪽은 검색·정렬이 바뀌면 첫 쪽으로 돌아간다** — 3쪽에서 검색어를 지웠는데
 * 줄이 두 쪽뿐이면 빈 화면만 남는다. 쪽 번호는 화면 상태일 뿐 `rows`에서
 * 파생되므로 `useEffect`로 **결과가 바뀔 때만** 되돌린다(검색·정렬 자체가
 * 바뀐 게 아니라 같은 검색으로 프로필만 갱신됐을 때는 있던 쪽에 둔다 —
 * 안 그러면 레벨업하고 돌아왔을 때 늘 1쪽으로 튕긴다).
 *
 * 요약 줄의 「[E]: N [S]: 1」 같은 대괄호 표기를 표 안의 등급 배지(`.gr`)와
 * **같은 그림**으로 바꿨다 — 다른 배지를 새로 그리면 「같은 등급인데 표와
 * 요약이 다른 색」이 된다(CLAUDE.md의 등급 색 단일 출처 규칙과 같은 이유).
 * 황제(`E`)는 셀 수 있는 값이 아니라 있고 없음이라 배지를 흐리게/또렷하게
 * 만으로 나타낸다 — 숫자를 붙이면 「E: 1」이 「황제 1명」처럼 읽힌다.
 *
 * 「보기」는 **랭킹의 장수 카드를 그대로 띄운다**(`OfficerCardModal`,
 * `RankingCommon.tsx`) — 다른 화면을 새로 그리지 않는다. 카드가 받는
 * `OfficerRankRow`는 랭킹의 「내 장수」 구역이 쓰던 `officerRankRows(profile,
 * 'all')`를 그대로 부른다(모드를 안 주면 3v3·5v5를 합친 통산이다) — 장수
 * 일람은 모드를 안 가르므로 딱 맞는다.
 *
 * **[장수 정보] 단추는 지웠다**(2026-09-02, 두 번째 지정) — 이 카드가 이미
 * [장수 정보](`OfficerDetailScreen`)와 같은 내용(그림·능력치·책략·인물 소개)을
 * 보여주므로, 눌러도 「똑같은 정보를 담은 디자인 없는 화면」만 또 뜨는 걸음이었다.
 * 대신 카드 안에서 바로 [레벨/스킬 관리]·[전적 보기]로 간다 — 관리 화면은
 * 여전히 있지만(둘의 「뒤로」가 여전히 거기로 온다), 이 카드에서 곧장 그리로
 * 갈 이유가 없어졌다. [레벨/스킬 관리]는 왼쪽에 이름, 오른쪽(`.sub`)에 보유
 * 카드 수 — `cardsToLevelUp()`이 단일 출처다(`OfficerDetailScreen`의 같은
 * 자리와 같은 규칙).
 *
 * 카드를 열 때 `playSfx('paper')`를 튼다(2026-09-02, 세 번째 지정) —
 * `OfficerRankingScreen`의 「보기」·`OfficerDetailScreen`의 장수 상세가 이미
 * 같은 소리를 쓴다(둘 다 「종이 자료를 펼친다」는 같은 몸짓이다).
 *
 * [정렬 필터] **왼쪽에 지금 기준을 나무판으로 늘 띄운다**(2026-09-02, 네 번째
 * 지정) — 팝업을 열지 않고도 지금 무엇으로 정렬 중인지 보이게 한다. 누르는
 * 자리가 아니라 **보여만 주는 자리**라 `<button>`이 아니라 `<span>`이고
 * `data-action`도 없다 — 눌리는 줄 알고 눌러도 아무 일이 없으면 「고장인가」가
 * 남는다(CLAUDE.md와 같은 결).
 *
 * ────────────────────────────────────────────────────────────────
 * [레벨/스킬 관리]는 더 이상 전면 화면으로 안 넘어간다 (2026-09-02, 다섯 번째 지정)
 * ────────────────────────────────────────────────────────────────
 *
 * 카드(`OfficerCardModal`)의 [레벨/스킬 관리]가 예전엔 `onLevels(officer)`로
 * 전면 화면(`LevelUpScreen`)을 열었다 — 그 화면이 카드와 같은 정보(그림·능력치·
 * 책략)를 다시 보여줄 뿐이었다. 이제 `managing` 상태 하나로 카드 위에
 * `LevelUpPanel`을 겹쳐 띄운다 — 화면 전환이 없으니 `onLevels` prop 자체가
 * 필요 없어졌다(지웠다).
 *
 * **[전적 보기]도 같은 이유로 같은 결을 따른다** (2026-09-03) — 예전엔
 * `onRecords(officer)`로 전면 화면(`RecordsScreen`)을 열었는데, 그 화면도
 * 디자인이 궁궐 나머지와 달랐다. `LevelUpPanel`이 먼저 다졌던 「카드 위에
 * 겹쳐 뜨는 판」 틀(`RecordsPanel`, `.lvp-back`/`.lvp-modal`)을 그대로 재사용해
 * `viewingRecords` 상태 하나로 띄운다 — `onRecords` prop도 같이 지웠다(프로필을
 * 바꾸지 않는 읽기 전용 화면이라 `onChange`만으로 충분하다).
 */

import { useEffect, useMemo, useState } from 'react';
import type { OfficerId } from '@samchess/rules';
import {
  OFFICER_SORTS, canLevelUp, cardsToLevelUp, gradeTally, officerRankRows, officerRows, poolCap, poolUsed,
  searchRows, sortRows,
} from '@samchess/meta';
import type { OfficerRankRow, OfficerSort, PlayerProfile } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { LevelUpPanel } from './LevelUpPanel.tsx';
import { OfficerCardModal, SortMenu, stripBackArrow } from './RankingCommon.tsx';
import { RecordsPanel } from './RecordsPanel.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { playSfx } from '../audio/sfx.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

/* 등급·레벨은 표 머리와 같은 문구를 그대로 쓴다(`officers.col.*`) — 무력·지력·
   통솔이 이미 그렇게 하고 있다(표 머리·정렬 메뉴가 같은 키를 공유). 새 낱말을
   보태지 않는다. */
const SORT_KEY: Record<OfficerSort, 'officers.col.grade' | 'officers.col.level' | 'officers.sort.name' | 'officers.sort.might' | 'officers.sort.intellect' | 'officers.sort.leadership'> = {
  grade: 'officers.col.grade',
  level: 'officers.col.level',
  name: 'officers.sort.name',
  might: 'officers.sort.might',
  intellect: 'officers.sort.intellect',
  leadership: 'officers.sort.leadership',
};

/** 한 쪽에 열 명 (요청 지정) */
const PAGE_SIZE = 10;

export function OfficerListScreen({ profile, onBack, onChange }: {
  profile: PlayerProfile;
  onBack: () => void;
  onChange: (p: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<OfficerSort>('grade');
  const [page, setPage] = useState(0);
  // 열려 있는 카드는 **장수 id**로만 들고 있는다 — 행(`OfficerRankRow`)째 담아
  // 두면 그 순간의 **스냅샷**이라, 카드 위에서 레벨을 올려도(`LevelUpPanel`이
  // 프로필을 갈아 끼워도) 카드는 옛 Lv·HP·책략을 계속 보여준다. 닫았다 다시
  // 열어야 맞는 값이 나오던 것이 그것이다(2026-09-03). id만 들고 `cardRows`에서
  // 매 렌더 다시 찾으면 프로필이 바뀔 때 카드도 함께 따라온다.
  const [cardOf, setCardOf] = useState<OfficerId | null>(null);
  const [managing, setManaging] = useState(false);
  const [viewingRecords, setViewingRecords] = useState(false);

  const rows = useMemo(() => sortRows(searchRows(officerRows(profile), query), sort), [profile, query, sort]);
  const tally = useMemo(() => gradeTally(profile), [profile]);
  // 「보기」 카드용 — 모드를 안 줘 3v3·5v5 통산이다(장수 일람은 모드를 안 가른다)
  const cardRows = useMemo(() => officerRankRows(profile, 'all'), [profile]);
  // 계정에서 빠진 장수(있을 수 없지만)면 `null`이 되어 카드가 닫힌다
  const card = cardOf ? cardRows.find((r) => r.officer === cardOf) ?? null : null;

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => setPage(0), [query, sort]);
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const openCard = (officer: OfficerId): void => {
    if (!cardRows.some((r) => r.officer === officer)) return;
    playSfx('paper');
    setCardOf(officer); setManaging(false); setViewingRecords(false);
  };

  /** [레벨/스킬 관리] 오른쪽에 붙는 「{보유} / {필요}장」 — `OfficerDetailScreen`의
      같은 자리와 같은 규칙(`cardsToLevelUp()`이 단일 출처)이다. */
  const cardsLabel = (row: OfficerRankRow): string => {
    const need = cardsToLevelUp(row.level);
    if (need === null) return t('officer.cards.max');
    return t('officer.cards.have', { have: profile.cards[row.officer] ?? 0, need });
  };

  return (
    <ScreenChrome
      backdrop={placeBackdrop('palace', profile.cityLevel)}
      className="scr-officers"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="officer-list">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{stripBackArrow(t('officers.back'))}</button>
        <span className="place-nm">{t('officers.title')}</span>
      </div>

      <div className="place-body">
        <input
          className="field rk-search"
          data-field="search"
          value={query}
          placeholder={t('officers.search')}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="ofc-sortrow">
          {/* 지금 정렬 기준 — 팝업을 안 열어도 보이는 나무판. 누르는 자리가
              아니라서 버튼이 아니다(위 파일 머리말 참조). */}
          <span className="ofc-sort-current">{t(SORT_KEY[sort])}</span>
          <SortMenu options={OFFICER_SORTS} value={sort} onChange={setSort} label={(v) => t(SORT_KEY[v])} />
        </div>

        <section className="place-panel block grow ofc-table">
          {/* 표 머리는 목록과 같은 그리드를 쓴다 — 열 폭이 갈리면 숫자가 어긋나 보인다.
              열 순서는 등급 · 레벨 · 보유 카드 · 이름 · 무력 · 지력 · 통솔이다
              (2026-09-02 재배치 — 등급 다음에 레벨이 오도록, 레벨과 이름 사이에
              보유 카드 수를 더했다). 레벨은 **왼쪽 정렬**로 등급에 붙인다 —
              오른쪽 정렬(`.c-st`와 같은 결)이면 좁은 등급 칸과 넓은 레벨 칸
              사이가 비어 두 열이 멀어 보인다(스크린샷으로 확인). */}
          <div className="ofc-row ofc-thead">
            <span className="c-gr">{t('officers.col.grade')}</span>
            <span className="c-lv">{t('officers.col.level')}</span>
            <span className="c-cd">{t('officers.col.cards')}</span>
            <span className="c-nm">{t('officers.col.name')}</span>
            <span className="c-st">{t('officers.sort.might')}</span>
            <span className="c-st">{t('officers.sort.intellect')}</span>
            <span className="c-st">{t('officers.sort.leadership')}</span>
          </div>
          <div className="ofc-rows">
            {pageRows.map((r) => (
              <button
                key={r.officer}
                className="ofc-row"
                data-officer={r.officer}
                data-grade={r.grade}
                data-levelup={r.canLevelUp ? '1' : '0'}
                onClick={() => openCard(r.officer)}
              >
                <span className="c-gr"><span className="gr" data-grade={r.grade}>{r.grade}</span></span>
                <span className="c-lv">Lv{r.level}</span>
                {/* 이 장수의 여분 카드 수 — `officerRows()`가 `profile.cards`에서
                    이미 계산해 낸다(화면은 다시 세지 않는다) */}
                <span className="c-cd">{r.cards}</span>
                {/* 레벨업 Flag — 예전엔 글자 뱃지("레벨업")를 레벨 칸에 얹었는데
                    번역이 길어지면(포르투갈어 "Subir de nível" 등) 카드 수·이름
                    칸을 가려 뷰가 깨졌다(2026-09-02 피드백 스크린샷으로 확인).
                    글자 대신 이름 옆 도장 애니메이션(`.ofc-levelup-seal`) 하나만
                    붙인다 — 언어 길이에 안 흔들린다. 줄 전체를 두르던 금색
                    액자는 2026-09-02에 다시 걷어냈다(style.css 참조). */}
                <span className="c-nm">
                  <span className="c-nm-text">{pickOfficerNameById(r.officer, r.name)}</span>
                  {r.canLevelUp && <span className="ofc-levelup-seal" role="img" aria-label={t('officers.flag')} />}
                </span>
                <span className="c-st">{r.might}</span>
                <span className="c-st">{r.intellect}</span>
                <span className="c-st">{r.leadership}</span>
              </button>
            ))}
            {rows.length === 0 && <p className="hint">{t('officers.empty', { q: query.trim() })}</p>}
          </div>

          {/* 쪽 나누기 — 열 명을 넘을 때만 뜬다 */}
          {pageCount > 1 && (
            <div className="ofc-pager" data-page={page + 1} data-pages={pageCount}>
              <button
                className="btn sm" data-action="prevPage"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {t('officers.pager.prev')}
              </button>
              <span className="ofc-pager-n">{t('officers.pager.page', { cur: page + 1, max: pageCount })}</span>
              <button
                className="btn sm" data-action="nextPage"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                {t('officers.pager.next')}
              </button>
            </div>
          )}
        </section>

        {/* 요약 줄 (38·39쪽 아래) — 표의 등급 배지(`.gr`)와 같은 그림.
            황제는 수가 아니라 있고 없음이라 배지를 흐리게/또렷하게로만 나타낸다. */}
        <footer className="place-panel foot ofc-tally" data-tally={`${tally.hasEmperor ? 'Y' : 'N'}/${tally.S}/${tally.A}/${tally.B}/${tally.C}/${tally.D}`}>
          <span className="ofc-count">{t('officers.count', { cur: poolUsed(profile), max: poolCap(profile) })}</span>
          <span className="ofc-grades">
            <span className="ofc-grade-item" data-have={tally.hasEmperor ? '1' : '0'} title={t('officers.col.grade')}>
              <span className="gr" data-grade="E">E</span>
            </span>
            {(['S', 'A', 'B', 'C', 'D'] as const).map((g) => (
              <span key={g} className="ofc-grade-item">
                <span className="gr" data-grade={g}>{g}</span>
                <b>{tally[g]}</b>
              </span>
            ))}
          </span>
        </footer>
      </div>

      {card && (
        <OfficerCardModal
          row={card}
          onClose={() => { setCardOf(null); setManaging(false); setViewingRecords(false); }}
          onLevels={() => setManaging(true)}
          onRecords={() => setViewingRecords(true)}
          levelsSub={cardsLabel(card)}
          levelsEligible={canLevelUp(profile, card.officer).ok}
        />
      )}

      {/* 카드 위에 겹쳐 뜨는 판 — 전면 화면 전환이 아니다(파일 머리말 참조).
          닫으면 카드(`managing: false`)로 돌아온다, `card` 자체는 안 지운다. */}
      {managing && card && (
        <LevelUpPanel
          profile={profile}
          officer={card.officer}
          onChange={onChange}
          onClose={() => setManaging(false)}
        />
      )}

      {/* 전적 보기 판도 같은 결 — 닫으면 카드(`viewingRecords: false`)로 돌아온다 */}
      {viewingRecords && card && (
        <RecordsPanel
          profile={profile}
          officer={card.officer}
          onClose={() => setViewingRecords(false)}
        />
      )}
    </ScreenChrome>
  );
}
