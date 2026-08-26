/**
 * 부대 랭킹 (pptx 50쪽 가운데 · 51쪽 표 정의 + 오른쪽 「부대 상세보기」,
 * 2026-08-27 표·필터 조정 반영)
 *
 * ```
 * [3 vs 3 ▾]  [전체 ▾]
 * 순위 도시명 부대명 승/무/패 적격파 총점* [구성 보기]
 * …top 5…            └ 누르면 아래에 포지션·장수명·레벨·등급·HP·MP·AT 펼침
 * ── 내 부대 (상위 3) ──
 * ```
 * (* 「총점」을 누르면 바로 아래 줄에 공식이 펼쳐진다)
 *
 * "구성 보기"는 51쪽에서 별도 화면(「부대 상세보기」)으로 그려져 있지만, 다른
 * 화면으로 완전히 넘어가면 표를 다시 훑어야 해서 **행 펼침**으로 갈음한다 —
 * 서버가 이미 `SquadRankRow.members`에 구성을 실어 보내므로 새 요청도 없다.
 * 「전·승·무」 세 열은 **한 열(승/무/패)로 접었고**, 모드·상대 필터는
 * 리스트 박스(드롭다운) 둘을 한 줄에 놓는다 — 도시 랭킹과 같은 결이다.
 *
 * **"전투력" 열은 뺐다** (2026-08-27) — `ranking.ts` 머리말 참조. 행을 누르면
 * 구성(등급·레벨·HP·MP·AT)이 그대로 펼쳐지니 요약 숫자가 따로 필요 없다.
 */

import { useMemo, useState } from 'react';
import { sortSquadRows, squadRankRows } from '@samchess/meta';
import type { PlayerProfile, RecordFilter, SquadRankRow, SquadRankSort } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import {
  FilterRow, FilterSelect, InfoHeadCell, ModeSelect, NoteRow, SearchBar, SortMenu, useRankingRows,
} from './RankingCommon.tsx';
import { currentSession } from '../meta/auth.ts';
import { rankingBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

const SORTS = ['total', 'battle'] as const;

export function SquadRankingScreen({ profile, onBack }: {
  profile: PlayerProfile;
  onBack: () => void;
}): React.JSX.Element {
  useLang();
  const [mode, setMode] = useState<BattleMode>('3v3');
  const [filter, setFilter] = useState<RecordFilter>('all');
  const [sort, setSort] = useState<SquadRankSort>('total');
  const [q, setQ] = useState('');
  const { rows, error, loading } = useRankingRows<SquadRankRow>({ board: 'squad', filter, mode, sort, q });
  const [open, setOpen] = useState<string | null>(null);
  const [topNote, setTopNote] = useState(false);
  const [mineNote, setMineNote] = useState(false);

  const mine = useMemo(
    () => sortSquadRows(squadRankRows(profile, filter, mode), sort).slice(0, 3),
    [profile, filter, mode, sort],
  );

  return (
    <ScreenChrome
      backdrop={rankingBackdrop(profile.cityLevel)}
      className="scr-ranking scr-ranking-squad"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="rankingSquad">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('ranking.back')}</button>
        <span className="place-nm">{t('ranking.tab.squad')}</span>
      </div>

      <div className="place-body rk-body">
        {/* 위 = 서버 랭킹(스크롤), 아래 = 내 정보(화면 바닥에 고정) — 2026-08-26 지정 */}
        <div className="rk-top">
          <FilterRow>
            <ModeSelect value={mode} onChange={setMode} />
            <FilterSelect value={filter} onChange={setFilter} />
          </FilterRow>
          <div className="rk-searchrow">
            <SearchBar value={q} onSubmit={setQ} placeholder={t('ranking.search.squad')} />
            <SortMenu options={SORTS} value={sort} onChange={setSort} label={(v) => t(`ranking.sort.${v}`)} />
          </div>

          <section className="place-panel rk-table-wrap">
            <div className="rk-table">
              <SquadHead noteOpen={topNote} onToggleNote={() => setTopNote((o) => !o)} />
              {topNote && <NoteRow note={t('ranking.total.note')} />}
              {loading && rows.length === 0 && <p className="hint">{t('ranking.loading')}</p>}
              {error && rows.length === 0 && !loading && <p className="hint">{t('ranking.loadError')}</p>}
              {!error && !loading && rows.length === 0 && <p className="hint">{t('ranking.empty.squad')}</p>}
              {rows.map((r, i) => (
                <SquadBlock key={`${r.cityName}-${r.squad.id}-${i}`} rank={String(i + 1)} row={r}
                  open={open === `t${i}`} onToggle={() => setOpen(open === `t${i}` ? null : `t${i}`)} />
              ))}
            </div>
          </section>
        </div>

        <section className="place-panel rk-mine">
          <h2 className="cap">{t('ranking.mine.squad')}</h2>
          {mine.length === 0 && <p className="hint">{t('ranking.mine.empty.squad')}</p>}
          {mine.length > 0 && (
            <div className="rk-table">
              <SquadHead noteOpen={mineNote} onToggleNote={() => setMineNote((o) => !o)} />
              {mineNote && <NoteRow note={t('ranking.total.note')} />}
              {mine.map((r, i) => (
                <SquadBlock key={r.squad.id} rank="—" row={r}
                  open={open === `m${i}`} onToggle={() => setOpen(open === `m${i}` ? null : `m${i}`)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </ScreenChrome>
  );
}

function SquadHead({ noteOpen, onToggleNote }: {
  noteOpen: boolean; onToggleNote: () => void;
}): React.JSX.Element {
  return (
    <div className="rk-row rk-thead">
      <span className="rk-rk">{t('ranking.col.rank')}</span>
      <span className="rk-nm">{t('ranking.col.city')}</span>
      <span className="rk-nm">{t('ranking.col.squad')}</span>
      <span className="rk-wdl">{t('ranking.col.wdl')}</span>
      <span className="rk-n">{t('ranking.col.kills')}</span>
      <InfoHeadCell className="rk-n" label={t('ranking.col.total')} open={noteOpen} onToggle={onToggleNote} />
      <span className="rk-btn" />
    </div>
  );
}

function SquadBlock({ rank, row, open, onToggle }: {
  rank: string; row: SquadRankRow; open: boolean; onToggle: () => void;
}): React.JSX.Element {
  return (
    <>
      <button className="rk-row rk-clickable" data-squad={row.squad.id} onClick={onToggle}>
        <span className="rk-rk">{rank}</span>
        <span className="rk-nm">{row.cityName}</span>
        <span className="rk-nm">{row.squad.name}</span>
        <span className="rk-wdl">{t('ranking.wdl', { w: row.tally.wins, d: row.tally.draws, l: row.tally.losses })}</span>
        <span className="rk-n">{row.tally.kills}</span>
        <span className="rk-n">{row.total}</span>
        <span className="rk-btn">{open ? t('ranking.collapse') : t('ranking.expand')}</span>
      </button>
      {open && (
        <div className="rk-squad-detail">
          <div className="rk-row rk-thead">
            <span className="rk-nm">{t('ranking.col.officer')}</span>
            <span className="rk-n">{t('ranking.col.level')}</span>
            <span className="rk-n">{t('ranking.col.hp')}</span>
            <span className="rk-n">{t('ranking.col.mp')}</span>
            <span className="rk-n">{t('ranking.col.at')}</span>
          </div>
          {row.members.map((m) => (
            <div className="rk-row" key={m.officer}>
              <span className="rk-nm">
                <span className="gr" data-grade={m.grade}>{m.grade}</span> {m.name}
              </span>
              <span className="rk-n">Lv{m.level}</span>
              <span className="rk-n">{m.stats.hp}</span>
              <span className="rk-n">{m.stats.mp}</span>
              <span className="rk-n">{m.stats.at}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
