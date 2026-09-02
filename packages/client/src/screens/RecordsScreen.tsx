/**
 * 전적 관리 (pptx 40쪽)
 *
 * 40쪽 원문 — 「전적은 온라인 대전 기준임. AI 대전에서는 카운트하지 않음」 /
 * 기물별 「출전 수 · 승리 · 적격파」 / 「총 출전 · 3v3 · 5v5」.
 *
 * ────────────────────────────────────────────────────────────────
 * 원문에서 하나가 뒤집혔다 ★ (2026-08-18 기획자 확정)
 * ────────────────────────────────────────────────────────────────
 *
 * **AI 대전도 센다.** 병영의 문이 [출정하기] 하나로 합쳐지면(F·45쪽) 온라인 상대를
 * 못 찾았을 때 AI로 넘어가므로, 상대가 사람인지 AI인지는 고르는 것이 아니다.
 * 세지 않는 대신 **`[AI]` 라벨을 붙이고 필터로 가른다** — 전체 / 온라인 / AI.
 *
 * ────────────────────────────────────────────────────────────────
 * 화면은 숫자를 만들지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * 기물 여섯 줄·모드 두 줄·총합 한 줄은 전부 `records.ts`의 `sumTally()`가 낸다.
 * 화면이 「기물별을 더해 총합을 만들면」 필터가 걸렸을 때 한쪽만 어긋난다 —
 * 어긋나도 화면은 아무 말도 하지 않는 종류다.
 *
 * 부대 이름과 상대 id 열은 **비어 있다** — E(42·43쪽)와 온라인이 채운다. 없으면
 * `—`로 찍는다. 여기서는 열을 지우지 않는다(나중에 형식을 또 올리지 않으려고).
 */

import { useState } from 'react';
import { officerById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { RECORD_FILTERS, modeRows, pieceRows, recentMatches, totalTally } from '@samchess/meta';
import type { MatchRow, PlayerProfile, RecordFilter, RecordTally } from '@samchess/meta';
import { backdropStyle, placeBackdrop } from './backdrop.ts';
import { OfficerArt } from './OfficerArt.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';

const FILTER_KEY: Record<RecordFilter, 'records.filter.all' | 'records.filter.online' | 'records.filter.ai'> = {
  all: 'records.filter.all', online: 'records.filter.online', ai: 'records.filter.ai',
};

const RESULT_KEY = {
  win: 'records.result.win', draw: 'records.result.draw', lose: 'records.result.lose',
} as const;

/** 목록에 보여 줄 최근 판수. **통산 집계는 이 수와 무관하다** */
const RECENT = 20;

export function RecordsScreen({ profile, officer, onList, onDetail, onLevels }: {
  profile: PlayerProfile;
  officer: OfficerId;
  onList: () => void;
  onDetail: () => void;
  onLevels: () => void;
}): React.JSX.Element {
  useLang();
  const [filter, setFilter] = useState<RecordFilter>('all');

  const inst = profile.roster[officer];
  const data = officerById.get(officer);
  if (!inst || !data) return <div className="scr scr-records"><p className="hint" onClick={onList}>{t('officer.toList')}</p></div>;

  // **훅으로 감싸지 않는다** — 위에서 이미 한 번 돌아 나갈 수 있어(보유에서 빠진 장수)
  // 훅을 여기 두면 호출 순서가 갈린다. 합은 칸 수십 개짜리라 매번 세도 싸다.
  const pieces = pieceRows(inst, filter);
  const modes = modeRows(inst, filter);
  const total = totalTally(inst, filter);
  const matches = recentMatches(profile, { filter, officer, limit: RECENT });

  return (
    <div
      className="scr scr-records scr-dim"
      data-screen="records"
      data-officer={officer}
      data-filter={filter}
      style={backdropStyle(placeBackdrop('palace', profile.cityLevel))}
    >
      <header className="ofc-nav">
        <button className="btn ghost sm" data-action="list" onClick={onList}>{t('officer.toList')}</button>
        <button className="btn sm" data-action="detail" onClick={onDetail}>{t('officer.detail')}</button>
        <button className="btn sm" data-action="levels" onClick={onLevels}>{t('officer.levels')}</button>
      </header>

      <section className="block rec-who">
        <OfficerArt officer={data.id} className="rec-art" />
        <div className="ofc-who">
          <h2 className="nm">
            <span className="gr" data-grade={data.grade}>[{data.grade}]</span>
            {' '}{pickOfficerName(data)}{' '}
            <span className="lv">Lv{inst.level}</span>
          </h2>
          <p className="row dim">{t('records.note')}</p>
        </div>
      </section>

      {/* 전체 / 온라인 / AI — 세지 않는 대신 갈라 본다 */}
      <div className="ofc-sorts rec-filters">
        {RECORD_FILTERS.map((f) => (
          <button
            key={f}
            className={`opt${filter === f ? ' on' : ''}`}
            data-record-filter={f}
            data-on={filter === f ? '1' : '0'}
            onClick={() => setFilter(f)}
          >
            {t(FILTER_KEY[f])}
          </button>
        ))}
      </div>

      <section className="block rec-table">
        <div className="rec-row rec-thead">
          <span className="c-pc">{t('records.col.piece')}</span>
          <span className="c-n">{t('records.col.plays')}</span>
          <span className="c-n">{t('records.col.wins')}</span>
          <span className="c-n">{t('records.col.kills')}</span>
        </div>
        {pieces.map(({ piece, tally }) => (
          <div key={piece} className="rec-row" data-piece={piece} data-plays={tally.plays}>
            <span className="c-pc">{piece}</span>
            <span className="c-n">{tally.plays}</span>
            <span className="c-n">{tally.wins}</span>
            <span className="c-n">{tally.kills}</span>
          </div>
        ))}
      </section>

      {/* 총 출전 · 3v3 · 5v5 — 기물별 합과 **언제나 같다** (합으로 내기 때문이다) */}
      <section className="block rec-sums">
        <p className="rec-sum" data-sum="total">
          <span className="k">{t('records.total')}</span>{sumText(total)}
        </p>
        {modes.map(({ mode, tally }) => (
          <p key={mode} className="rec-sum" data-sum={mode}>
            <span className="k">{mode}</span>{sumText(tally)}
          </p>
        ))}
      </section>

      <section className="block grow rec-log">
        <h3 className="cap">{t('records.recent')}</h3>
        <div className="rec-rows">
          {/* 열이 여덟이라 머리가 없으면 `—`가 무엇의 빈칸인지 알 수 없다 */}
          <div className="rec-log-row rec-loghead">
            <span className="c-md">{t('records.col.mode')}</span>
            <span className="c-sq">{t('records.col.squad')}</span>
            <span className="c-pw">{t('records.col.power')}</span>
            <span className="c-vs">{t('records.col.vs')}</span>
            <span className="c-sq">{t('records.col.squad')}</span>
            <span className="c-pw">{t('records.col.power')}</span>
            <span className="c-ch">{t('records.col.chance')}</span>
            <span className="c-rs">{t('records.col.result')}</span>
          </div>
          {matches.map((row) => <LogRow key={row.seq} row={row} />)}
          {matches.length === 0 && <p className="hint" data-field="empty">{t('records.empty')}</p>}
        </div>
      </section>
    </div>
  );
}

/** 이력 한 줄 — [모드][내 부대][내 전투력] vs [상대][상대 부대][상대 전투력][예상 승률][결과] */
function LogRow({ row }: { row: MatchRow }): React.JSX.Element {
  const dash = t('records.noSquad');
  return (
    <div className="rec-log-row" data-seq={row.seq} data-opponent={row.opponent} data-result={row.result}>
      <span className="c-md">{row.mode}</span>
      <span className="c-sq">{row.mySquad ?? dash}</span>
      <span className="c-pw">{row.myPower}</span>
      <span className="c-vs" data-field="opponent">{row.opponentId ?? t('records.ai')}</span>
      <span className="c-sq">{row.theirSquad ?? dash}</span>
      <span className="c-pw">{row.theirPower}</span>
      <span className="c-ch">{t('records.chance', { p: Math.round(row.chance * 100) })}</span>
      <span className={`c-rs ${row.result}`}>{t(RESULT_KEY[row.result])}</span>
    </div>
  );
}

/** 「출전 12 · 7승 1무 4패 · 적격파 19」 — 40쪽 요약 줄. 무승부가 생겨 승만 적을 수 없다 */
const sumText = (tally: RecordTally): string => t('records.sum', {
  plays: tally.plays, w: tally.wins, d: tally.draws, l: tally.losses, k: tally.kills,
});
