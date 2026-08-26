/**
 * 랭킹 세 화면(도시·부대·장수)이 같이 쓰는 조각 — pptx 50~52쪽 디자인 가이드.
 *
 * 필터(온라인/AI/전체, 3v3/5v5)는 **드롭다운(리스트 박스) 둘**이고 한 줄에
 * 나란히 놓인다 — 모드가 왼쪽, 상대가 오른쪽(2026-08-26 지정). 정렬은
 * **[정렬 필터] 버튼을 누르면 뜨는 팝업**이다(50~52쪽의 화살표가 가리키는 그
 * 뜬 패널). 검색은 입력칸 + [검색] 버튼 — 타이핑마다 서버를 부르지 않고 **누르거나
 * Enter를 쳐야** 나간다(전체 유저를 훑는 요청이라 값싸지 않다).
 */

import { useEffect, useState } from 'react';
import { RECORD_FILTERS } from '@samchess/meta';
import type { RankBoard, RecordFilter, RecordTally } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { fetchRanking } from '../meta/ranking.ts';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';

export const FILTER_KEY: Record<RecordFilter, StringKey> = {
  all: 'records.filter.all', online: 'records.filter.online', ai: 'records.filter.ai',
};
export const MODE_KEY: Record<BattleMode, StringKey> = {
  '3v3': 'ranking.mode.3v3', '5v5': 'ranking.mode.5v5',
};
export const BATTLE_MODES: readonly BattleMode[] = ['3v3', '5v5'];

/** 「12전 · 7승 1무 4패 · 적격파 19」 — 40·41쪽과 같은 문구 */
export const sumText = (tally: RecordTally): string => t('records.sum', {
  plays: tally.plays, w: tally.wins, d: tally.draws, l: tally.losses, k: tally.kills,
});

/** 상대 필터 — 리스트 박스(드롭다운) 하나. `FilterRow` 안에서 오른쪽에 둔다 */
export function FilterSelect({ value, onChange }: {
  value: RecordFilter; onChange: (v: RecordFilter) => void;
}): React.JSX.Element {
  return (
    <select
      className="field rk-select"
      data-field="filter"
      value={value}
      onChange={(e) => onChange(e.target.value as RecordFilter)}
    >
      {RECORD_FILTERS.map((f) => <option key={f} value={f}>{t(FILTER_KEY[f])}</option>)}
    </select>
  );
}

/** 모드 필터 — 리스트 박스(드롭다운) 하나. `FilterRow` 안에서 왼쪽에 둔다 */
export function ModeSelect({ value, onChange }: {
  value: BattleMode; onChange: (v: BattleMode) => void;
}): React.JSX.Element {
  return (
    <select
      className="field rk-select"
      data-field="mode"
      value={value}
      onChange={(e) => onChange(e.target.value as BattleMode)}
    >
      {BATTLE_MODES.map((m) => <option key={m} value={m}>{t(MODE_KEY[m])}</option>)}
    </select>
  );
}

/** 모드·상대 리스트 박스를 한 줄에 놓는다 — 순서 그대로가 곧 왼쪽·오른쪽이다 */
export function FilterRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="rk-filterrow">{children}</div>;
}

/** [정렬 필터] 버튼 → 세 기준이 세로로 뜨는 팝업 (50~52쪽 오른쪽 다이어그램) */
export function SortMenu<T extends string>({ options, value, onChange, label }: {
  options: readonly T[]; value: T; onChange: (v: T) => void; label: (v: T) => string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="rk-sortmenu">
      <button
        className="btn ghost sm rk-sortbtn"
        data-action="sortMenu"
        data-open={open ? '1' : '0'}
        onClick={() => setOpen((o) => !o)}
      >
        {t('ranking.sortBtn')}
      </button>
      {open && (
        <>
          {/* 팝업 밖을 누르면 닫힌다 — 팝업 자체는 그 뒤에 그려 클릭이 안 새게 한다 */}
          <div className="rk-sortveil" onClick={() => setOpen(false)} />
          <div className="rk-sortpop">
            {options.map((v) => (
              <button
                key={v}
                className={`opt${value === v ? ' on' : ''}`}
                data-value={v}
                data-on={value === v ? '1' : '0'}
                onClick={() => { onChange(v); setOpen(false); }}
              >
                {label(v)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 「총점」처럼 계산식이 있는 열 머리 — 평소엔 글자만, **누르면** 바로 아래 줄에
 * 공식이 펼쳐진다(2026-08-27, 표 밑에 늘 떠 있던 안내문을 눌러야 뜨는 것으로
 * 바꿨다). 열 폭 클래스(`rk-n` 등)를 그대로 받아 표의 다른 칸과 폭이 맞는다.
 */
export function InfoHeadCell({ className, label, open, onToggle }: {
  className: string; label: string; open: boolean; onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`${className} rk-infohead`}
      data-open={open ? '1' : '0'}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

/** `InfoHeadCell`이 열렸을 때 그 표 안에 끼워 넣는 설명 줄 */
export function NoteRow({ note }: { note: string }): React.JSX.Element {
  return (
    <div className="rk-noterow">
      <p className="note">{note}</p>
    </div>
  );
}

/** 검색 창 + [검색] 버튼. 제출해야(Enter·클릭) 나간다 */
export function SearchBar({ value, onSubmit, placeholder }: {
  value: string; onSubmit: (v: string) => void; placeholder: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  return (
    <div className="rk-searchbar">
      <input
        className="field rk-search"
        data-field="search"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(draft.trim()); }}
      />
      <button className="btn ghost sm" data-action="search" onClick={() => onSubmit(draft.trim())}>
        {t('ranking.searchBtn')}
      </button>
    </div>
  );
}

/** top-5(또는 검색) 서버 요청을 갈무리한다 — 세 화면이 모양만 다르고 흐름은 같다.
    "내 랭킹"은 여기 안 온다 — 화면이 `profile`로 직접 낸다(§ranking.ts 머리말) */
export function useRankingRows<Row>(
  params: { board: RankBoard; filter: RecordFilter; mode?: BattleMode; sort: string; q: string },
): { rows: Row[]; error: boolean; loading: boolean } {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const { board, filter, mode, sort, q } = params;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchRanking({ board, filter, ...(mode ? { mode } : {}), sort, ...(q ? { q } : {}) })
      .then((r) => { if (alive) { setRows(r as Row[]); setError(false); setLoading(false); } })
      .catch(() => { if (alive) { setRows([]); setError(true); setLoading(false); } });
    return () => { alive = false; };
  }, [board, filter, mode, sort, q]);

  return { rows, error, loading };
}
