/**
 * 랭킹 한 분야 — 전투 · 도시화 · 컬렉션 (2026-11-20 기획자, 옛 `CityRankingScreen` · `SquadRankingScreen` · `OfficerRankingScreen`을 바꿨다).
 *
 * ```
 * [전체 ▾]                      ← 전투만 (전체 / 3 vs 3 / 5 vs 5)
 * [도시명으로 검색          ]
 * 순위 도시명 …분야마다의 열… 점수
 * …1~10위 (검색하면 그 이름이 든 도시들 — 진짜 등수 그대로)…
 * ─ 내 도시 (열 줄에 없으면 밑에 한 줄 더) ─
 * [뒤로 가기]
 * ```
 *
 * 검색은 친구의 도시를 찾아보는 자리다 — 줄의 등수는 1~10위 표와 **같은 눈금**이다(서버가 전체를 줄 세운 뒤 거른다).
 * 열은 분야마다 다르다:
 * - 전투: 전 · 승/무/패 · 격파 · 수성 · 승점 — 병영의 모드 줄과 같은 값(공격대의 부대 전적 + 수성 성공)
 * - 도시화: 레벨 · 장수(풀 + 보관함) · 성숙도(올린 레벨의 합) · 점수
 * - 컬렉션: 완성 수(보여 주기만) · 점수
 * 점수 열의 머리를 누르면 그 바로 밑에 셈이 펼쳐진다(`InfoHeadCell` / `NoteRow`).
 */

import { Fragment, useState } from 'react';
import { CITY_RANK_WEIGHTS } from '@samchess/meta';
import type { BattleRankMode, PlayerProfile, RankBoard } from '@samchess/meta';
import type { BoardRows } from '../meta/ranking.ts';
import {
  FilterRow, InfoHeadCell, NoteRow, RANK_SEARCH_DEBOUNCE_MS, RankModeSelect, RankingBackPanel, SearchBar, stripBackArrow,
  useRankingBoard,
} from './RankingCommon.tsx';
import { BOARD_TITLE } from './RankingScreen.tsx';
import { currentSession } from '../meta/auth.ts';
import { rankingBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { RankingLoading, useRankingLoading } from './RankingLoading.tsx';
import { GameIcon, WdlHead } from './GameIcon.tsx';

/** 줄이 하나도 없을 때 — 검색이 아니면 분야마다의 사정(도시화는 모든 도시가 서므로 빈 적이 없다) */
const EMPTY: Record<RankBoard, StringKey> = {
  battle: 'ranking.empty.battle', city: 'ranking.empty.search', collection: 'ranking.empty.collection',
};

export function RankingBoardScreen<B extends RankBoard>({ profile, board, onBack }: {
  profile: PlayerProfile;
  board: B;
  onBack: () => void;
}): React.JSX.Element {
  useLang();
  const [mode, setMode] = useState<BattleRankMode>('all');
  const [q, setQ] = useState('');
  const { rows, mine, error, loading, ready } = useRankingBoard(board, mode, q);
  const veil = useRankingLoading(!ready);
  const [note, setNote] = useState(false);
  const title = t(BOARD_TITLE[board]);
  // 내 줄이 보인 줄 안에 없으면 밑에 한 줄 더 — 검색 중에는 안 붙인다(찾은 것만 보인다)
  const mineShown = !!mine && rows.some((r) => r.cityName === mine.cityName);

  return (
    <ScreenChrome
      backdrop={rankingBackdrop(profile.cityLevel)}
      className={`scr-ranking scr-ranking-${board}`}
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="rankingBoard" data-board={board}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{stripBackArrow(t('ranking.back'))}</button>
        <span className="place-nm">{title}</span>
      </div>

      <div className="place-body rk-body">
        <div className="rk-top">
          {board === 'battle' && (
            <FilterRow>
              <RankModeSelect value={mode} onChange={setMode} />
            </FilterRow>
          )}
          <SearchBar value={q} onSubmit={setQ} placeholder={t('ranking.search.city')} debounceMs={RANK_SEARCH_DEBOUNCE_MS} />

          <section className="place-panel rk-table-wrap" data-loading={ready && loading ? '1' : undefined}>
            <div className="rk-table" data-board={board}>
              <Head board={board} noteOpen={note} onToggleNote={() => setNote((o) => !o)} />
              {note && <NoteRow note={noteText(board)} />}
              {loading && rows.length === 0 && <p className="hint">{t('ranking.loading')}</p>}
              {error && rows.length === 0 && !loading && <p className="hint">{t('ranking.loadError')}</p>}
              {!error && !loading && rows.length === 0 && <p className="hint">{t(q ? 'ranking.empty.search' : EMPTY[board])}</p>}
              {rows.map((r) => <Row key={r.cityName} board={board} row={r} mine={r.cityName === profile.cityName} />)}
              {!q && mine && !mineShown && (
                <Fragment>
                  <div className="rk-gap" aria-hidden="true">⋮</div>
                  <Row board={board} row={mine} mine />
                </Fragment>
              )}
            </div>
          </section>
        </div>

        <RankingBackPanel onBack={onBack} />
      </div>
      {veil && <RankingLoading title={title} backLabel={stripBackArrow(t('ranking.back'))} onBack={onBack} />}
    </ScreenChrome>
  );
}

/** 점수 열의 셈 — 도시화의 가중치는 meta의 값을 끼운다(문장에 숫자를 다시 적지 않는다) */
function noteText(board: RankBoard): string {
  if (board === 'battle') return t('ranking.total.note');
  if (board === 'city') {
    const w = CITY_RANK_WEIGHTS;
    return t('ranking.note.city', { a: w.cityLevel, b: w.officer, c: w.level });
  }
  return t('ranking.note.collection');
}

function Head({ board, noteOpen, onToggleNote }: {
  board: RankBoard; noteOpen: boolean; onToggleNote: () => void;
}): React.JSX.Element {
  const score = (label: string) => <InfoHeadCell className="rk-n" label={label} open={noteOpen} onToggle={onToggleNote} />;
  return (
    <div className="rk-row rk-thead">
      <span className="rk-rk">{t('ranking.col.rank')}</span>
      <span className="rk-nm">{t('ranking.col.city')}</span>
      {board === 'battle' && (
        <>
          <span className="rk-n">{t('ranking.col.plays')}</span>
          <span className="rk-wdl"><WdlHead w={t('records.result.win')} d={t('records.result.draw')} l={t('records.result.lose')} /></span>
          <span className="rk-n"><GameIcon name="rec-kills" label={t('ranking.col.kills')} /></span>
          <span className="rk-n">{t('ranking.col.held')}</span>
          {score(t('ranking.col.total'))}
        </>
      )}
      {board === 'city' && (
        <>
          <span className="rk-n">{t('ranking.col.level')}</span>
          <span className="rk-n">{t('ranking.col.officerCount')}</span>
          <span className="rk-n">{t('ranking.col.maturity')}</span>
          {score(t('ranking.col.score'))}
        </>
      )}
      {board === 'collection' && (
        <>
          <span className="rk-n">{t('collection.sum.done')}</span>
          {score(t('ranking.col.score'))}
        </>
      )}
    </div>
  );
}

function Row<B extends RankBoard>({ board, row, mine }: {
  board: B; row: BoardRows[B]; mine: boolean;
}): React.JSX.Element {
  const rank = String(row.rank);
  return (
    <div className="rk-row" data-city={row.cityName} data-rank={rank} data-mine={mine ? '1' : undefined}>
      <span className="rk-rk">{rank}</span>
      <span className="rk-nm">{row.cityName}</span>
      <Cells board={board} row={row} />
    </div>
  );
}

function Cells({ board, row }: { board: RankBoard; row: BoardRows[RankBoard] }): React.JSX.Element {
  if (board === 'battle' && 'tally' in row) {
    return (
      <>
        <span className="rk-n">{row.tally.plays}</span>
        <span className="rk-wdl">{t('ranking.wdl', { w: row.tally.wins, d: row.tally.draws, l: row.tally.losses })}</span>
        <span className="rk-n">{row.tally.kills}</span>
        <span className="rk-n" data-field="held">{row.held}</span>
        <span className="rk-n" data-field="score">{row.total.toLocaleString()}</span>
      </>
    );
  }
  if (board === 'city' && 'maturity' in row) {
    return (
      <>
        <span className="rk-n">Lv{row.cityLevel}</span>
        <span className="rk-n">{row.officers}</span>
        <span className="rk-n">{row.maturity}</span>
        <span className="rk-n" data-field="score">{row.total.toLocaleString()}</span>
      </>
    );
  }
  if ('points' in row) {
    return (
      <>
        <span className="rk-n">{row.done}</span>
        <span className="rk-n" data-field="score">{row.points.toLocaleString()}</span>
      </>
    );
  }
  return <></>;
}
