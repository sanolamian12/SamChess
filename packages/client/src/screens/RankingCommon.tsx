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
import { skillById } from '@samchess/data';
import { RECORD_FILTERS } from '@samchess/meta';
import type { OfficerRankRow, RankBoard, RecordFilter, RecordTally } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { fetchRanking } from '../meta/ranking.ts';
import { OfficerArt } from './OfficerArt.tsx';
import { SkillModal } from './SkillModal.tsx';
import { skillArtUrl } from '../ui/art.ts';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { pickOfficerNameById, pickStory } from '../i18n/story.ts';

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

/**
 * 「장수 카드」를 화면 위에 띄우는 껍데기 — `.modal-back`(가리개) + `.ofcard-modal`
 * (너비 제한) 안에 `OfficerCard`를 앉힌다. 원래 `OfficerRankingScreen`에만 있던
 * 자리를 뗐다(2026-09-02) — `OfficerListScreen`(내 로스터)도 「보기」 카드가
 * 필요해졌는데, 가리개를 감싸는 마크업까지 두 화면이 각자 베끼면 한쪽만
 * `onClick={(e) => e.stopPropagation()}`을 빠뜨리는 식으로 갈릴 수 있다.
 */
export function OfficerCardModal({ row, onClose, onLevels, onRecords, levelsSub, levelsEligible }: {
  row: OfficerRankRow; onClose: () => void;
  /** 있으면 카드 안에 [레벨/스킬 관리]·[전적 보기] 단추가 뜬다 — 내 장수라 더
      갈 곳이 있을 때만 준다(`OfficerListScreen`). 다른 계정의 장수(랭킹)는
      안 준다 — 그 계정을 관리할 수 없으니까. 둘은 늘 같이 준다(둘 다 「내
      장수」에서만 뜻이 있다), 그래서 하나만 주는 경우는 다루지 않는다. */
  onLevels?: () => void; onRecords?: () => void;
  /** [레벨/스킬 관리] 오른쪽에 붙는 보유 카드 수 — 「{have} / {need}장」 같은
      이미 만들어진 문구를 caller(`OfficerListScreen`)가 넘긴다. 여기서 다시
      계산하지 않는다 — 카드 수는 `profile.cards`에서 나오는데, 이 카드는
      `OfficerRankRow`만 받아 프로필을 모른다. */
  levelsSub?: string;
  /** 지금 레벨업이 가능하면(`canLevelUp`) `true` — 장수 일람 표의 레벨업
      액자·인장과 같은 신호를 카드에서도 보여준다(2026-09-02, "이 프레임과
      마크를 보고 클릭을 하면"). caller가 이미 판정한 값을 그대로 받는다 —
      `OfficerRankRow`가 그 판정에 필요한 카드 보유량을 모르는 것도 위
      `levelsSub`와 같은 이유다. */
  levelsEligible?: boolean;
}): React.JSX.Element {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="ofcard-modal" onClick={(e) => e.stopPropagation()}>
        <OfficerCard
          row={row} onClose={onClose}
          {...(onLevels ? { onLevels } : {})}
          {...(onRecords ? { onRecords } : {})}
          {...(levelsSub !== undefined ? { levelsSub } : {})}
          levelsEligible={levelsEligible ?? false}
        />
      </div>
    </div>
  );
}

/**
 * 「장수 카드 띄워주기」(52·53쪽) — 표를 밀어내리지 않는 진짜 팝업이다
 * (2026-08-27 열세 번째 피드백). 53쪽 목업을 기반으로 네 차례 사용자 지정을 거쳤다:
 *
 * ```
 * ┌──────────── [등급] 이름 자 (중앙 상단, 내 장수 표와 같은 배지) ────┐
 * │ 4          │ 6                                      │
 * │ 기물 그림  │ 1. 파랑 전적·적격파                       │
 * │ (칸을 채움)│ 2. 보라 무력·지력·통솔                    │
 * │            │ 3. 초록 Lv·HP·MP·AT                      │
 * │            │ 4. 배운 책략 목록, 없으면 「습득한 책략이   │
 * │            │    없음」                                │
 * ├──────────────────────────────────────────────────────┤
 * │ 고유기술 연출 배너 (있을 때만, 패널 폭 전체)              │
 * ├──────────────────────────────────────────────────────┤
 * │ 인물 열전 (대나무 테두리)                               │
 * └──────────────────────────────────────────────────────┘
 * ```
 *
 * **왼쪽 그림은 전투 수묵화가 아니라 "체스 게임에 들어갔을 때 기물로 쓰는
 * 이미지"다** — `OfficerArt`에 `primary="portrait"`를 줘서 `assets/Chars/` →
 * `portraits/{id}.png`(알파 있는 보드 타일)를 먼저 찾게 한다(`ui/art.ts`).
 * 액자(`market/frame-{grade}.png`)는 배경 스트레치 대신 `border-image`로
 * 두른다(2026-08-27 열세 번째 피드백 — "캐릭터가 잘려 보인다"의 원인이
 * `object-fit: cover` + 정사각形 칸이었다. `border-image`는 프레임 그림을
 * 늘려도 모서리 장식이 안 뭉개지고, 안쪽은 그냥 빈 칸이라 `object-fit: contain`
 * 인물 그림이 잘리지 않고 통째로 들어간다).
 *
 * **고유기술 줄이 통째로 바뀌었다** (2026-08-27 열세 번째 피드백 — "고유
 * 스킬 줄은 없애고, 있으면 `assets/SpecialSkills/` 연출 이미지를 패널 폭
 * 전체로"). 그 이미지는 이미 전투 연출에서 쓰던 것과 같은 자리
 * (`skillArtUrl()`, `ui/art.ts` — `packages/client/public/skills/{기술id}.jpg`,
 * `assets/SpecialSkills/`를 굽는 빌드 산출물)를 그대로 재사용한다 — 새로
 * 만들 그림이 없다. **여기서는 "없으면 문구로" 규칙을 깬다** — 다섯 줄 중
 * 유일하게, 없으면 줄째로 사라진다(고유기술 자체가 없는 C·D급이 있으므로).
 *
 * **책략은 계정마다 다르다**(같은 장수라도 레벨업으로 무엇을 배웠는지가
 * 갈린다) — `OfficerRankRow.tactics`가 서버에서 이미 `tacticsOf()`로 계산해
 * 실어 보낸 값이고, 화면은 그걸 그대로 그릴 뿐이다.
 *
 * **각 스탯 항목은 따로따로 DOM에 얹는다** (한 문자열로 잇지 않는다) — 지금은
 * "Lv 9 | HP 40 | ..."처럼 보여도, 이후 항목마다 다른 자리·꾸밈을 넣으려면
 * (아이콘, 강조색 등) 미리 나눠 둔 쪽이 CSS만으로 끝난다.
 */
function OfficerCard({ row, onClose, onLevels, onRecords, levelsSub, levelsEligible }: {
  row: OfficerRankRow; onClose: () => void;
  onLevels?: () => void; onRecords?: () => void; levelsSub?: string; levelsEligible?: boolean;
}): React.JSX.Element {
  const [skillOpen, setSkillOpen] = useState(false);
  const skill = row.uniqueSkillId ? skillById.get(row.uniqueSkillId) : undefined;
  // `courtesyName`/`story`가 언어별 맵이라(2026-08-27 열 언어 배선) 지금 UI
  // 언어로 고른다 — 없으면 한국어로 물러난다(`pickStory()` 참조).
  const courtesyName = pickStory(row.courtesyName);
  const story = pickStory(row.story);

  return (
    <section className="place-panel ofcard">
      {/* 다른 목판 프레임 없이 X 아이콘만(2026-08-27 열세 번째 피드백 —
          "닫기 박스를 다른 프레임을 씌우지 말고 X자 아이콘만"). */}
      <button className="ofcard-close" data-action="closeCard" onClick={onClose} aria-label={t('ranking.card.close')}>
        <img className="ofcard-close-icon" src="icons/close.png" alt="" />
      </button>

      {/* 이름 줄 — 「내 장수」 표의 등급 배지(`.gr`)·이름(`.rk-nm`)과 같은
          디자인을 그대로 가져와 글자만 키운다(2026-08-27 열세 번째 지정 —
          "폰트만 지금 크기로 키워서"). 새 색·모양을 안 만든다. */}
      <h2 className="ofcard-title">
        <span className="gr" data-grade={row.grade}>{row.grade}</span>
        <span className="ofcard-name">{pickOfficerNameById(row.officer, row.name)}</span>
        {courtesyName && <span className="ofcard-courtesy">{courtesyName}</span>}
      </h2>

      <div className="ofcard-layout">
        {/* 액자 없이 기물 그림만(2026-08-27 열네 번째 지정 — "카드 프레임을
            없애자, 캐릭터만 보이도록"). `market/frame-{grade}.png`는 더 이상
            안 두른다. */}
        <OfficerArt officer={row.officer} className="art ofcard-art" primary="portrait" />

        <div className="ofcard-bars">
          {/* 1. 전적 — 「전적」 이름표를 앞에 단다(2026-08-27 열다섯 번째 지정 —
              "0/0/0 앞에 전적 단어 추가, 적 격파와 같은 폰트로"). `Stat`의
              `k`가 그 자리다 — 옆의 「적 격파」와 같은 `.k` 스타일을 그대로 쓴다. */}
          <div className="ofcard-bar ofcard-bar-rec">
            <Stat k={t('ranking.card.record')} v={t('ranking.wdl', { w: row.tally.wins, d: row.tally.draws, l: row.tally.losses })} />
            <Stat k={t('ranking.col.kills')} v={row.tally.kills} />
          </div>

          {/* 2. 삼능력 — 이름표 대신 아이콘(위 `Stat` 주석 참조) */}
          <div className="ofcard-bar ofcard-bar-abl">
            <Stat icon={{ src: 'icons/stat-might.png', alt: t('ranking.card.might') }} v={row.might} />
            <Stat icon={{ src: 'icons/stat-intellect.png', alt: t('ranking.card.intellect') }} v={row.intellect} />
            <Stat icon={{ src: 'icons/stat-leadership.png', alt: t('ranking.card.leadership') }} v={row.leadership} />
          </div>

          {/* 3. 레벨·능력치 (원래 4번 — 고유기술 줄을 뺀 자리를 당겼다) */}
          <div className="ofcard-bar ofcard-bar-lv">
            <Stat k="Lv" v={row.level} />
            <Stat k="HP" v={row.stats.hp} />
            <Stat k="MP" v={row.stats.mp} />
            <Stat k="AT" v={`${row.at.min}-${row.at.max}`} />
          </div>

          {/* 4. 배운 책략 — 없어도 줄은 남는다(현행 유지) — 「습득한 책략이 없음」 */}
          <div className="ofcard-bar ofcard-bar-tactics">
            {row.tactics.length === 0
              ? <span className="empty">{t('ranking.card.noTactics')}</span>
              : row.tactics.map((x) => (
                <span key={x.id} className={`chip ${x.school}`} title={x.text}>{x.name}</span>
              ))}
          </div>
        </div>
      </div>

      {/* 고유기술 연출 배너 — 있을 때만, 패널 폭 전체. 눌러서 설명 팝업(SkillModal) */}
      {row.uniqueSkillId && skill && (
        <button type="button" className="ofcard-skillbanner" data-action="skill" onClick={() => setSkillOpen(true)}>
          <img src={skillArtUrl(row.uniqueSkillId)} alt={skill.name} />
        </button>
      )}

      {/* 인물 소개 — 대나무 테두리(`btn-ghost.png`, 2026-08-27 열세 번째 지정).
          G1이 218/260명만 채웠다. 없으면 이 줄째로 사라진다(§data 머리말) */}
      {story && <p className="ofcard-story">{story}</p>}

      {/* [레벨/스킬 관리]·[전적 보기] — 내 로스터일 때만(둘이 있을 때만) 뜬다.
          랭킹의 다른 계정 장수는 갈 곳이 없다 — 그 계정을 관리할 수 없으니까.
          예전엔 [장수 정보] 하나가 똑같은 정보를 다시 보여주는 화면(`OfficerDetailScreen`)
          으로 갔다 — 이 카드가 이미 그 정보를 다 보여주므로 그 걸음은 없앴다. */}
      {onLevels && onRecords && (
        <>
          {/* 「레벨/스킬 관리」는 왼쪽 이름, 오른쪽에 보유 카드 수(`.sub`) —
              37·38쪽 표의 레벨업 Flag와 같은 정보를 여기서도 미리 보여준다.
              레벨업 가능하면(`levelsEligible`) 이름 옆에 인장(장수 일람 표의
              같은 신호, `.ofc-levelup-seal`)을 붙이고 카드 수 글자를 파란색
              (`.levelup-ready`)으로 바꾼다(2026-09-02 지정). */}
          <button className="btn wide" data-action="levels" onClick={onLevels}>
            <span className="lbl">{t('officer.levels')}</span>
            {levelsEligible && <span className="ofc-levelup-seal" role="img" aria-label={t('officers.flag')} />}
            {levelsSub && <span className={`sub${levelsEligible ? ' levelup-ready' : ''}`}>{levelsSub}</span>}
          </button>
          <button className="btn wide" data-action="records" onClick={onRecords}>
            {t('officer.records')}
          </button>
        </>
      )}

      {skillOpen && skill && <SkillModal skill={skill} onClose={() => setSkillOpen(false)} />}
    </section>
  );
}

/**
 * 카드 띠 안의 항목 하나 — 「구분 문자열」이 아니라 각자 자기 자리를 가진 요소다.
 * `icon`을 주면 글자 이름표(`k`) 대신 그림을 쓴다(2026-08-27 열일곱 번째
 * 지정 — 삼능력 줄의 "무력/지력/통솔"이 번역마다 길이가 달라 줄바꿈이
 * 들쭉날쭉했다. 아이콘은 언어와 무관하게 폭이 고정이다). `alt`에 여전히
 * 이름을 넣어 스크린리더·툴팁으로는 읽힌다.
 */
function Stat({ k, v, icon }: { k?: string; v: string | number; icon?: { src: string; alt: string } }): React.JSX.Element {
  return (
    <span className="ofcard-stat">
      {icon
        ? <img className="ofcard-stat-icon" src={icon.src} alt={icon.alt} title={icon.alt} />
        : k && <span className="k">{k}</span>}
      <span className="v">{v}</span>
    </span>
  );
}
