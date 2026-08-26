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

/**
 * 「← 도시로」처럼 문구에 화살표가 박혀 있는 「뒤로」 계열 문구(`place.back`·
 * `city.records.back`·`ranking.back`)에서 화살표만 뗀다. 랭킹 화면은 이제
 * `back.png` 아이콘이 화살표 자리를 대신하므로(2026-08-27, 아이콘을 글자
 * 위에 쌓는 자리) 글자에 남은 화살표는 중복이다. 다른 화면(병영·장터 등)의
 * 같은 문구는 그대로 둔다 — 거기는 아직 아이콘이 없어 글자 화살표가
 * 유일한 신호다. 그래서 **번역 문자열 자체는 안 건드리고** 여기서만 잘라낸다.
 */
export const stripBackArrow = (label: string): string => label.replace(/^[←\s]+/, '');

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

/**
 * 화면 화풍을 두른 드롭다운 — 원래는 브라우저 기본 `<select>`였는데, 펼쳤을 때
 * 뜨는 목록은 OS가 그려서 **CSS로 손댈 수 없다**(2026-08-27 다섯 번째 피드백 —
 * "닫힌 상자는 두루마리인데 펼친 목록은 이질감이 크다"). `SortMenu`(정렬 팝업)가
 * 이미 쓰던 「버튼 + 뜨는 패널」 모양을 그대로 가져와 진짜 화면 요소로 그린다 —
 * 그래서 목록도 나머지와 같은 그림으로 입힐 수 있다. 닫힌 상자는 `.btn`
 * (참나무 목판, [정렬 필터]와 같은 그림 — 2026-08-27 열한 번째 지정: "리스트
 * 중 하나를 고른다는 점이 같으니 세 자리를 한 그림으로") 그대로 쓰고, 펼친
 * 목록은 `.rk-pop`(장부 패널) 안에 언어 칩과 같은 나뭇결/옥색 칩(`.opt`/
 * `.opt.on`)을 늘어놓는다 — 새 그림이 필요 없다, 이미 있는 자산의 재사용이다.
 */
function Dropdown<T extends string>({ value, options, label, dataField, onChange }: {
  value: T; options: readonly T[]; label: (v: T) => string; dataField: string; onChange: (v: T) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="rk-dropdown">
      <button
        type="button"
        className="btn sm rk-select"
        data-field={dataField}
        data-open={open ? '1' : '0'}
        onClick={() => setOpen((o) => !o)}
      >
        {label(value)}
      </button>
      {open && (
        <>
          <div className="rk-sortveil" onClick={() => setOpen(false)} />
          <div className="rk-pop">
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

/** 상대 필터 — 리스트 박스(드롭다운) 하나. `FilterRow` 안에서 오른쪽에 둔다 */
export function FilterSelect({ value, onChange }: {
  value: RecordFilter; onChange: (v: RecordFilter) => void;
}): React.JSX.Element {
  return (
    <Dropdown
      value={value} options={RECORD_FILTERS} dataField="filter"
      label={(v) => t(FILTER_KEY[v])} onChange={onChange}
    />
  );
}

/** 모드 필터 — 리스트 박스(드롭다운) 하나. `FilterRow` 안에서 왼쪽에 둔다 */
export function ModeSelect({ value, onChange }: {
  value: BattleMode; onChange: (v: BattleMode) => void;
}): React.JSX.Element {
  return (
    <Dropdown
      value={value} options={BATTLE_MODES} dataField="mode"
      label={(v) => t(MODE_KEY[v])} onChange={onChange}
    />
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
        className="btn sm rk-sortbtn"
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
          <div className="rk-pop">
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
      <button className="btn sm" data-action="search" onClick={() => onSubmit(draft.trim())}>
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
