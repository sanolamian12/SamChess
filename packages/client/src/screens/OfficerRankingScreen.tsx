/**
 * 장수 랭킹 (pptx 50쪽 가운데 · 52쪽 표 정의 + 「장수 카드 띄워주기」,
 * 2026-08-27 표 조정 반영)
 *
 * ```
 * [3 vs 3 ▾] [전체 ▾]   (2026-08-27 열세 번째 지정 — 장수 일람처럼 모드를 나눈다)
 * [검색 창          ] [검색] [정렬 필터]
 * 순위 도시명 장수명 레벨 참전수 적격파 총점* [보기]
 * …top 5…
 * ── 내 장수 (상위 3) ──
 * ```
 * (* 「총점」을 누르면 바로 아래 줄에 공식이 펼쳐진다)
 *
 * **HP·MP·AT 열은 뺐다** (2026-08-27) — 「보기」로 뜨는 장수 카드가 이미 그
 * 셋을 보여주므로 표에 또 늘어놓을 필요가 없다. 빠진 자리에 **"총점" 열을
 * 새로 얹었다** — 정렬 기준(「총점 순」)인데 표에 없으면 무엇을 기준으로
 * 줄 세운 건지 확인할 길이 없었다.
 *
 * 「보기」를 누르면 **팝업**으로 장수 카드가 뜬다(52쪽 자주색 화살표,
 * 2026-08-27 열세 번째 피드백으로 표를 밀어내리던 인라인 배치를 진짜
 * 모달로 바꿨다) — 다른 계정의 장수라 새로 API를 안 부르고, 이미 받은
 * 행 데이터(이름·등급·레벨·스탯·전적)만으로 그린다. 49쪽 정렬 버튼의
 * 「도시 규모 순」은 장수 한 명 행에는 뜻이 없어 「레벨 순」으로 바꿔
 * 달았다(`@samchess/meta`의 `ranking.ts` 머리말 참조).
 *
 * 모드·상대 필터는 도시·부대 랭킹과 같은 리스트 박스(드롭다운) 둘이다
 * (2026-08-27 열세 번째 지정) — 장수 전적도 `장수 일람`(§`OfficerDetailScreen`
 * 아님, §전적 화면)처럼 3v3/5v5를 나눠 잴 수 있어 도시·부대와 갈라 둘 이유가
 * 없었다. `officerRankRows(profile, filter, mode)`(`@samchess/meta`)가
 * 모드 인자를 받도록 넓혔다 — 서버(`server-api`)도 같은 인자를 그대로 넘긴다.
 */

import { useMemo, useState } from 'react';
import { officerRankRows, sortOfficerRows } from '@samchess/meta';
import type { OfficerRankRow, OfficerRankSort, PlayerProfile, RecordFilter } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import {
  FilterRow, FilterSelect, InfoHeadCell, ModeSelect, NoteRow, OfficerCardModal, SearchBar, SortMenu, stripBackArrow,
  useRankingRows,
} from './RankingCommon.tsx';
import { currentSession } from '../meta/auth.ts';
import { rankingBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { playSfx } from '../audio/sfx.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

const SORTS = ['total', 'battle', 'level'] as const;

export function OfficerRankingScreen({ profile, onBack }: {
  profile: PlayerProfile;
  onBack: () => void;
}): React.JSX.Element {
  useLang();
  const [mode, setMode] = useState<BattleMode>('3v3');
  const [filter, setFilter] = useState<RecordFilter>('all');
  const [sort, setSort] = useState<OfficerRankSort>('total');
  const [q, setQ] = useState('');
  const { rows, error, loading } = useRankingRows<OfficerRankRow>({ board: 'officer', filter, mode, sort, q });
  const [card, setCard] = useState<OfficerRankRow | null>(null);
  const [topNote, setTopNote] = useState(false);
  const [mineNote, setMineNote] = useState(false);
  // 「보기」로 장수 카드(팝업)가 열리는 순간 — `OfficerDetailScreen`이 장수를
  // 펼쳐 볼 때 트는 것과 같은 소리(파일 머리말 참조)
  const openCard = (row: OfficerRankRow): void => { playSfx('paper'); setCard(row); };

  const mine = useMemo(
    () => sortOfficerRows(officerRankRows(profile, filter, mode), sort).slice(0, 3),
    [profile, filter, mode, sort],
  );

  return (
    <ScreenChrome
      backdrop={rankingBackdrop(profile.cityLevel)}
      className="scr-ranking scr-ranking-officer"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="rankingOfficer">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{stripBackArrow(t('ranking.back'))}</button>
        <span className="place-nm">{t('ranking.tab.officer')}</span>
      </div>

      <div className="place-body rk-body">
        {/* 장수 카드 — 표를 밀어내리지 않는 진짜 팝업이다(2026-08-27 열세 번째
            피드백 — "기존 화면을 덮는 팝업 형태로"). 껍데기(`.modal-back`
            가리개 + `.ofcard-modal`)는 `OfficerCardModal`(`RankingCommon.tsx`)
            하나다 — `OfficerListScreen`(내 로스터)도 같은 카드를 띄운다. */}
        {card && <OfficerCardModal row={card} onClose={() => setCard(null)} />}

        {/* 위 = 서버 랭킹(스크롤), 아래 = 내 정보(화면 바닥에 고정) — 2026-08-26 지정 */}
        <div className="rk-top">
          <FilterRow>
            <ModeSelect value={mode} onChange={setMode} />
            <FilterSelect value={filter} onChange={setFilter} />
          </FilterRow>
          <SearchBar value={q} onSubmit={setQ} placeholder={t('ranking.search.officer')} />
          <div className="rk-sortrow">
            <SortMenu options={SORTS} value={sort} onChange={setSort} label={(v) => t(`ranking.sort.${v}`)} />
          </div>

          <section className="place-panel rk-table-wrap">
            <div className="rk-table">
              <OfficerHead noteOpen={topNote} onToggleNote={() => setTopNote((o) => !o)} />
              {topNote && <NoteRow note={t('ranking.total.note')} />}
              {loading && rows.length === 0 && <p className="hint">{t('ranking.loading')}</p>}
              {error && rows.length === 0 && !loading && <p className="hint">{t('ranking.loadError')}</p>}
              {!error && !loading && rows.length === 0 && <p className="hint">{t('ranking.empty.officer')}</p>}
              {rows.map((r, i) => (
                <OfficerRow key={`${r.cityName}-${r.officer}-${i}`} rank={String(i + 1)} row={r} onView={() => openCard(r)} />
              ))}
            </div>
          </section>
        </div>

        <section className="place-panel rk-mine">
          <h2 className="cap">{t('ranking.mine.officer')}</h2>
          {mine.length === 0 && <p className="hint">{t('ranking.mine.empty.officer')}</p>}
          {mine.length > 0 && (
            <div className="rk-table">
              <OfficerHead noteOpen={mineNote} onToggleNote={() => setMineNote((o) => !o)} />
              {mineNote && <NoteRow note={t('ranking.total.note')} />}
              {mine.map((r) => <OfficerRow key={r.officer} rank="—" row={r} onView={() => openCard(r)} />)}
            </div>
          )}
        </section>
      </div>
    </ScreenChrome>
  );
}

function OfficerHead({ noteOpen, onToggleNote }: {
  noteOpen: boolean; onToggleNote: () => void;
}): React.JSX.Element {
  return (
    <div className="rk-row rk-thead">
      <span className="rk-rk">{t('ranking.col.rank')}</span>
      <span className="rk-nm">{t('ranking.col.city')}</span>
      <span className="rk-nm">{t('ranking.col.officer')}</span>
      <span className="rk-n">{t('ranking.col.level')}</span>
      <span className="rk-n">{t('ranking.col.participation')}</span>
      <span className="rk-n">{t('ranking.col.kills')}</span>
      <InfoHeadCell className="rk-n" label={t('ranking.col.total')} open={noteOpen} onToggle={onToggleNote} />
      <span className="rk-btn" />
    </div>
  );
}

function OfficerRow({ rank, row, onView }: {
  rank: string; row: OfficerRankRow; onView: () => void;
}): React.JSX.Element {
  return (
    <button className="rk-row rk-clickable" data-rank={rank} onClick={onView}>
      <span className="rk-rk">{rank}</span>
      <span className="rk-nm">{row.cityName}</span>
      <span className="rk-nm"><span className="gr" data-grade={row.grade}>{row.grade}</span> {pickOfficerNameById(row.officer, row.name)}</span>
      <span className="rk-n">Lv{row.level}</span>
      <span className="rk-n">{row.tally.plays}</span>
      <span className="rk-n">{row.tally.kills}</span>
      <span className="rk-n">{row.total}</span>
      <span className="rk-btn">{t('ranking.col.view')}</span>
    </button>
  );
}

/* 「장수 카드」(52·53쪽)는 `OfficerCard`/`Stat`(`RankingCommon.tsx`)로 옮겼다
   (2026-09-02) — `OfficerListScreen`(내 로스터)도 같은 카드가 필요해져서다. */
