/**
 * 랭킹 화면(전투 · 도시화 · 컬렉션, 2026-11-20)이 같이 쓰는 조각 — pptx 50~52쪽 디자인 가이드.
 * 장수 카드(`OfficerCardModal`)도 여기 산다 — 옛 장수 랭킹에서 태어나 지금은 내 장수 상세 · 농지 · 부대원 고르기가 쓴다.
 *
 * 전투 랭킹의 모드(전체 / 3v3 / 5v5)는 **드롭다운(리스트 박스)**이다. 정렬은
 * **[정렬 필터] 버튼을 누르면 뜨는 팝업**이다(50~52쪽의 화살표가 가리키는 그
 * 뜬 패널). 검색은 입력칸 + [검색] 버튼 — 타이핑마다 서버를 부르지 않고 **누르거나
 * Enter를 쳐야** 나간다(전체 유저를 훑는 요청이라 값싸지 않다).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { skillById, tacticById } from '@samchess/data';
import type { EquipmentData } from '@samchess/data';
import { BATTLE_RANK_MODES, INJURY_PENALTY, RANK_TOP, injuredStat } from '@samchess/meta';
import type { BattleRankMode, OfficerRankRow, RankBoard } from '@samchess/meta';
import { Say } from './Steward.tsx';
import { fetchRanking } from '../meta/ranking.ts';
import type { BoardRows } from '../meta/ranking.ts';
import { OfficerActionArt } from './OfficerArt.tsx';
import { SkillModal } from './SkillModal.tsx';
import { TacticModal } from './TacticModal.tsx';
import { skillArtUrl } from '../ui/art.ts';
import { ItemThumb } from './EquipThumb.tsx';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import {
  pickEquipName, pickEquipText, pickOfficerNameById, pickStory, pickTacticNameById,
  pickTacticTextById,
} from '../i18n/story.ts';
import { GradeBadge } from './GradeBadge.tsx';
import { formatHealLeft } from './healTime.ts';
import { TacticIcon } from './TacticIcon.tsx';
import { GameIcon } from './GameIcon.tsx';
import { BlinkGlow, STAND_GLOW } from './BlinkGlow.tsx';
import { LevelBadge } from './LevelBadge.tsx';

/**
 * 장수 카드의 부상 (GDD §8.2 · §5.7, 트랙 11g). **caller가 넘긴다** — 카드는 프로필도
 * 시계도 모른다(`levelsCards`·`equip`과 같은 이유). 내 장수(`OfficerListScreen`)만 넘기고,
 * 랭킹의 다른 계정 장수에는 안 넘긴다. **안 넘기면 부상이 아니다** — 카드에 아무 흔적도 없다.
 */
export interface CardInjury {
  /** 낫기까지 남은 ms — 치료 중이면 치료가 끝나기까지 */
  left: number;
  /** 병원 치료실에 들어가 있는가 */
  healing: boolean;
  /** 병원이 있을 때만 — 없으면 [입원시키기] 단추가 아예 없다(「병원이 있으면 [치료]」) */
  heal?: {
    /** 지금 못 하는 이유(빈 치료실 없음 등). 되면 `null` */
    blocked: string | null;
    busy: boolean;
    error: string | null;
    onHeal: () => void;
  };
}

/**
 * 「← 도시로」처럼 문구에 화살표가 박혀 있는 「뒤로」 계열 문구(`place.back`·
 * `city.records.back`·`ranking.back`)에서 화살표만 뗀다. 랭킹 화면은 이제
 * `back.png` 아이콘이 화살표 자리를 대신하므로(2026-08-27, 아이콘을 글자
 * 위에 쌓는 자리) 글자에 남은 화살표는 중복이다. 다른 화면(병영·장터 등)의
 * 같은 문구는 그대로 둔다 — 거기는 아직 아이콘이 없어 글자 화살표가
 * 유일한 신호다. 그래서 **번역 문자열 자체는 안 건드리고** 여기서만 잘라낸다.
 */
export const stripBackArrow = (label: string): string => label.replace(/^[←\s]+/, '');

/**
 * 랭킹 세 판의 바닥 명령 판 — [뒤로 가기] 한 칸 (2026-09-18 지정).
 *
 * 예전엔 이 자리에 「내 도시/부대/장수」가 있었는데 랭킹 메뉴(`RankingScreen`)의
 * 위쪽으로 옮겼다. 빈자리에는 대장간 목록 화면(`.frg-back`)처럼 **들어온 길과
 * 같은 모양의 단추**를 놓는다 — 메뉴의 세 단추와 같은 판·같은 목판 단추다.
 * 글자는 매칭·대장간이 쓰는 「뒤로 가기」(`match.back`)를 그대로 가져온다.
 */
export function RankingBackPanel({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <section className="place-panel rk-back">
      <button className="btn wide" data-action="backRanking" onClick={onBack}>
        <span className="lbl">{stripBackArrow(t('match.back'))}</span>
      </button>
    </section>
  );
}

/** 전투 랭킹의 모드 이름 — 「전체」는 두 모드 공격대의 합 */
export const RANK_MODE_KEY: Record<BattleRankMode, StringKey> = {
  all: 'records.filter.all', '3v3': 'ranking.mode.3v3', '5v5': 'ranking.mode.5v5',
};

/**
 * 화면 화풍을 두른 드롭다운 — 원래는 브라우저 기본 `<select>`였는데, 펼쳤을 때
 * 뜨는 목록은 OS가 그려서 **CSS로 손댈 수 없다**(2026-08-27 다섯 번째 피드백 —
 * "닫힌 상자는 두루마리인데 펼친 목록은 이질감이 크다"). `SortMenu`(정렬 팝업)가
 * 이미 쓰던 「버튼 + 뜨는 패널」 모양을 그대로 가져와 진짜 화면 요소로 그린다 —
 *
 * **랭킹 밖에서도 쓴다** (2026-09-16) — 부대 목록(`SquadListScreen`)의
 * 「3 vs 3 / 5 vs 5 / 전체」가 같은 리스트 박스다. `FilterSelect`·`ModeSelect`처럼
 * 값 묶음이 고정된 짝을 하나 더 만드는 대신 **이 일반형을 내보낸다** — 그쪽은
 * `RecordFilter`·`BattleMode`인데 부대 목록은 **「전체」가 섞인 세 값**이라
 * 어느 짝에도 안 맞는다. 그림·팝업은 전역 규칙(`.rk-dropdown`·`.rk-pop`)이라
 * 화면이 달라져도 같은 모양이 된다.
 * 그래서 목록도 나머지와 같은 그림으로 입힐 수 있다. 닫힌 상자는 `.btn`
 * (참나무 목판, [정렬 필터]와 같은 그림 — 2026-08-27 열한 번째 지정: "리스트
 * 중 하나를 고른다는 점이 같으니 세 자리를 한 그림으로") 그대로 쓰고, 펼친
 * 목록은 `.rk-pop`(장부 패널) 안에 언어 칩과 같은 나뭇결/옥색 칩(`.opt`/
 * `.opt.on`)을 늘어놓는다 — 새 그림이 필요 없다, 이미 있는 자산의 재사용이다.
 */
export function Dropdown<T extends string>({ value, options, label, dataField, buttonLabel, onChange }: {
  value: T; options: readonly T[]; label: (v: T) => string; dataField: string; onChange: (v: T) => void;
  /** 닫힌 상자에 **값 대신** 적을 글자(「분류」·「정렬」). 안 주면 예전처럼
      상자 자신이 값을 적는다(랭킹 셋). 부대 목록은 **아직 안 골랐을 때만** 주고,
      고른 뒤에는 빼서 값이 보이게 한다(2026-09-16). */
  buttonLabel?: string;
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
        {buttonLabel ?? label(value)}
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

/** 전투 랭킹의 모드 — 리스트 박스(드롭다운) 하나. 「전체 / 3 vs 3 / 5 vs 5」 */
export function RankModeSelect({ value, onChange }: {
  value: BattleRankMode; onChange: (v: BattleRankMode) => void;
}): React.JSX.Element {
  return (
    <Dropdown
      value={value} options={BATTLE_RANK_MODES} dataField="mode"
      label={(v) => t(RANK_MODE_KEY[v])} onChange={onChange}
    />
  );
}

/** 리스트 박스를 한 줄에 놓는다 — 순서 그대로가 곧 왼쪽·오른쪽이다 */
export function FilterRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="rk-filterrow">{children}</div>;
}

/**
 * [정렬 필터] 버튼 → 세 기준이 세로로 뜨는 팝업 (50~52쪽 오른쪽 다이어그램).
 * `buttonLabel`을 안 주면 `t('ranking.sortBtn')`("정렬 필터")다.
 */
export function SortMenu<T extends string>({ options, value, onChange, label, buttonLabel }: {
  options: readonly T[]; value: T; onChange: (v: T) => void; label: (v: T) => string;
  buttonLabel?: string;
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
        {buttonLabel ?? t('ranking.sortBtn')}
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

/**
 * 검색 창 + [검색] 버튼. 제출해야(Enter·클릭) 나간다.
 *
 * **`debounceMs`를 주면 단추가 사라지고 스스로 나간다** (2026-09-16, 부대 목록).
 * 부대 목록은 내 부대를 메모리에서 거르는 것이라 비용이 없다. **랭킹 셋도 이쪽으로
 * 옮겼다** (2026-09-18 지정 — [검색] 단추를 없앴다). 랭킹은 전체 유저를 훑는 서버
 * 요청이라 글자마다 나가면 안 되므로 **0.5초**(`RANK_SEARCH_DEBOUNCE_MS`) 조용해진
 * 뒤에만 나간다. 단추 있는 갈래는 지금 부르는 곳이 없지만 남겨 둔다 — 어느
 * 쪽인지는 부르는 쪽이 정한다.
 */
export function SearchBar({ value, onSubmit, placeholder, debounceMs }: {
  value: string; onSubmit: (v: string) => void; placeholder: string;
  /** 주면 이 밀리초만큼 조용해진 뒤 스스로 제출한다(단추 없음) */
  debounceMs?: number;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  /*
   * 마지막 타이머만 산다 — 글자마다 새로 걸고 이전 것을 지운다. `onSubmit`은
   * 부르는 쪽에서 `useState`의 setter(신원이 고정)로 주므로 이 효과가 매 렌더
   * 다시 돌지 않는다. 처음 한 번은 빈 글자로 돌지만 값이 이미 빈 글자라 아무
   * 일도 안 일어난다.
   */
  useEffect(() => {
    if (debounceMs === undefined) return;
    const id = window.setTimeout(() => onSubmit(draft.trim()), debounceMs);
    return () => window.clearTimeout(id);
  }, [draft, debounceMs, onSubmit]);

  return (
    <div className={`rk-searchbar${debounceMs === undefined ? '' : ' rk-searchbar-solo'}`}>
      <input
        className="field rk-search"
        data-field="search"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(draft.trim()); }}
      />
      {debounceMs === undefined && (
        <button className="btn sm" data-action="search" onClick={() => onSubmit(draft.trim())}>
          {t('ranking.searchBtn')}
        </button>
      )}
    </div>
  );
}

/** 랭킹 검색창이 멈춘 뒤 스스로 나가기까지 — 0.5초 (2026-09-18 지정). 글자마다 전체 훑기가 나가지 않게 */
export const RANK_SEARCH_DEBOUNCE_MS = 500;

/**
 * 한 분야의 1~10위(또는 검색) + 내 줄 — 서버 요청을 갈무리한다(2026-11-20). 서버가 열 줄로 자르지만 여기서 한 번 더
 * 자른다(`RANK_TOP`) — 서버를 다시 안 띄운 채로도 화면이 약속을 지킨다.
 */
export function useRankingBoard<B extends RankBoard>(board: B, mode: BattleRankMode, q: string): {
  rows: BoardRows[B][]; mine: BoardRows[B] | null; error: boolean; loading: boolean; ready: boolean;
} {
  const [rows, setRows] = useState<BoardRows[B][]>([]);
  const [mine, setMine] = useState<BoardRows[B] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  /** 첫 응답(성공이든 실패든)이 왔는가 — 전용 로딩 화면(`RankingLoading.tsx`)은 그때까지만 덮는다 */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchRanking(board, mode, q)
      .then((r) => { if (alive) { setRows(r.rows.slice(0, RANK_TOP)); setMine(r.mine); setError(false); setLoading(false); setReady(true); } })
      .catch(() => { if (alive) { setRows([]); setError(true); setLoading(false); setReady(true); } });
    return () => { alive = false; };
  }, [board, mode, q]);

  return { rows, mine, error, loading, ready };
}

/**
 * 카드(`.ofcard`) 위에 겹쳐 뜨는 둘째 모달(레벨/스킬 관리·전적 보기)이 앉을
 * 지점을 잰다. 두 모달이 `position: absolute; inset: 0` 형제라 CSS만으로는
 * 뒤 카드의 실제 높이를 알 수 없다(카드마다 이름 줄바꿈·자(字) 유무로 키가
 * 달라진다) — 실제로 그 요소를 찾아 화면 좌표로 잰다.
 *
 * **기준점은 둘 중 하나다** — `'art'`(카드 그림(`.ofcard-art`)이 끝나는
 * 지점, `LevelUpPanel`의 기본값, 2026-09-02 지정 — "캐릭터 이미지가 끝나는
 * 바로 끝지점으로")와 `'top'`(카드(`.ofcard`) 자체가 시작하는 지점,
 * 레벨/스킬 관리 판이 쓴다, 2026-09-03 지정 — "시작점을 장수 정보 패널과
 * 똑같은 y 위치에서 표출해도 돼").
 *
 * **패널마다 따로 재지 않는다** — 카드 위에 겹쳐 뜨는 판은 이 훅 하나로 잰다. 카드가 먼저 그려진 뒤에만 잴 수 있으므로 **패널이 뜬 다음에** 재고,
 * 못 찾으면(드문 경합) 예전처럼 화면 아래에 붙는 CSS 기본값으로 물러난다.
 */
export function useOfficerCardOverlayPos(anchor: 'art' | 'top' = 'art'): {
  backRef: React.RefObject<HTMLDivElement | null>;
  backStyle: React.CSSProperties | undefined;
  modalStyle: React.CSSProperties | undefined;
} {
  const backRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const back = backRef.current;
    const card = document.querySelector('.ofcard');
    const target = anchor === 'top' ? card : card?.querySelector('.ofcard-art');
    if (!back || !target) return;
    const measure = (): void => {
      const backRect = back.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const edge = anchor === 'top' ? targetRect.top : targetRect.bottom;
      const top = Math.max(0, edge - backRect.top);
      setPos({ top, maxHeight: Math.max(120, backRect.height - top - 16) });
    };
    measure();
    // 프레임 폭이 바뀌면(`useFrameFit`) 그림 높이도 같이 바뀐다 — 다시 잰다
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);

  return {
    backRef,
    // 위쪽 패딩은 0으로 비운다 — 안 비우면 `.lvp-back`의 `padding: 1rem`만큼
    // 더 밀려 잰 지점보다 한 뼘 아래에 앉는다(실측으로 확인, 2026-09-02).
    backStyle: pos ? { alignItems: 'flex-start', paddingTop: 0 } : undefined,
    modalStyle: pos ? { marginTop: `${pos.top}px`, maxHeight: `${pos.maxHeight}px` } : undefined,
  };
}

/** 장수 카드 아래의 한 수 — `OfficerCardModal`의 `action` */
export interface CardAction {
  /** `select`는 옥색 목판, `release`는 붉은 목판 */
  kind: 'select' | 'release';
  label: string;
  onPress: () => void;
  /** 지금은 못 하는 이유 — 있으면 단추가 꺼지고 그 밑에 이유가 뜬다 */
  blocked?: string | null;
}

/**
 * 「장수 카드」를 화면 위에 띄우는 껍데기 — `.modal-back`(가리개) + `.ofcard-modal`
 * (너비 제한) 안에 `OfficerCard`를 앉힌다. 원래 `OfficerRankingScreen`에만 있던
 * 자리를 뗐다(2026-09-02) — `OfficerListScreen`(내 로스터)도 「보기」 카드가
 * 필요해졌는데, 가리개를 감싸는 마크업까지 두 화면이 각자 베끼면 한쪽만
 * `onClick={(e) => e.stopPropagation()}`을 빠뜨리는 식으로 갈릴 수 있다.
 */
/**
 * [아이템] 단추의 모양 — 왼쪽 둥근 금테 배지(지닌 것의 그림, 빈손이면 회수 그림) · 가운데 글(지닌 것의 이름, 빈손이면 「아이템 지급」)
 * (2026-11-23 기획자). 카드는 프로필을 모르므로 caller(`OfficerDetailModal`)가 그림 · 글을 만들어 넘긴다
 */
export interface ItemsLook {
  /** 지닌 것의 id — 빈손이면 '' (`data-held`) */
  held: string;
  badge: React.ReactNode;
  label: string;
}

/**
 * [아이템] 배지의 모양 — `square`: 아이템 설정 화면의 네모 칸(`.sqh-tile`, 가는 금테 · 검은 바탕) 그대로,
 * `round`: 둥근 금테 배지(쓰는 것). 네모는 줄인 설정 칸이 안 예뻐 둥근 것으로 돌아왔고, 금테를 얇게 · 배지를 조금 작게 해 단추의 금빛 테 안에 들였다 (2026-11-23 기획자)
 */
const HELD_BADGE: 'square' | 'round' = 'round';

export function OfficerCardModal({ row, onClose, onLevels, onItems, itemsLook, levelsCards, levelsEligible, levelsNote, equip, injury, action }: {
  row: OfficerRankRow; onClose: () => void;
  /** 있으면 카드 맨 아래, [뒤로 가기] 밑에 그 자리의 한 수 (2026-11-16 기획자, 농지 보초병) —
      고르는 팝업에서는 옥색 [선택하기], 세운 보초병 · 부대원에서는 붉은 [해제하기] */
  action?: CardAction;
  /** 있으면 카드 안에 [강화](옛 [레벨/스킬 관리]) 단추가 뜬다 — 누르면 곧장 레벨업 고르기(2026-11-20 기획자).
      내 장수일 때만 준다(`OfficerDetailModal`). 다른 계정의 장수(랭킹)는 안 준다 — 그 계정을 관리할 수 없으니까. */
  onLevels?: () => void;
  /** 있으면 [강화] 위에 [아이템] — 병기 · 아이템 고르기(2026-11-19 기획자, 병영 부대 편집과 같은 단추). 내 장수일 때만 */
  onItems?: () => void;
  /** [아이템] 단추의 배지 · 글 — 없으면 「아이템」 글자만 */
  itemsLook?: ItemsLook;
  /** [강화] 오른쪽 끝의 「{have} / {need} (카드 그림)」 — `need`가 `null`이면 최대 레벨. caller(`OfficerDetailModal`)가 넘긴다 —
      카드 수는 `profile.cards`에서 나오는데, 이 카드는 `OfficerRankRow`만 받아 프로필을 모른다. */
  levelsCards?: { have: number; need: number | null };
  /** 카드는 넉넉한데 못 올리는 까닭(도시 레벨 상한) — 그 자리의 사람이 말한다. 카드가 모자란 것은 빤해서 말하지 않는다 */
  levelsNote?: string | null;
  /** 지금 레벨업이 가능하면(`canLevelUp`) `true` — 장수 일람 표의 레벨업
      액자·인장과 같은 신호를 카드에서도 보여준다(2026-09-02, "이 프레임과
      마크를 보고 클릭을 하면"). caller가 이미 판정한 값을 그대로 받는다 —
      `OfficerRankRow`가 그 판정에 필요한 카드 보유량을 모르는 것도 위
      `levelsCards`와 같은 이유다. 거짓이면 [강화]가 꺼진다. */
  levelsEligible?: boolean;
  /** `OfficerCard`로 그대로 넘긴다 — 뜻은 그쪽 주석 참조 */
  equip?: EquipmentData;
  /** 부상이면 — 뜻은 `CardInjury` 참조 */
  injury?: CardInjury;
}): React.JSX.Element {
  // 고유기술 팝업(`SkillModal`)은 여기서 연다 — `OfficerCard`(`.ofcard`) 안에서
  // 열면 그 `position: relative`가 `.modal-back`의 기준점이 되어 팝업이 카드
  // 안쪽 여백만큼 좁아진다(2026-09-03, "패널 크기가 안 변했어" 피드백의 원인).
  // `.ofcard-modal`과 형제로 두면 이 바깥 `.modal-back`(`.scr-bg`에 `inset: 0`)이
  // 그대로 기준점이 되어 카드와 같은 폭으로 뜬다.
  const [skillOpen, setSkillOpen] = useState(false);
  const skill = row.uniqueSkillId ? skillById.get(row.uniqueSkillId) : undefined;
  // 책략 설명 팝업도 같은 자리에서 연다(위와 같은 `position: relative` 사정).
  // 열린 책략은 **id로** 들고 정의는 매번 찾는다 — 카드 자체가 id만 실어 온다.
  const [tacticOpen, setTacticOpen] = useState<string | null>(null);
  const tactic = tacticOpen ? tacticById.get(tacticOpen) : undefined;
  return (
    <div className="modal-back ofcard-back" onClick={onClose}>
      <div className="ofcard-modal" data-officer={row.officer} onClick={(e) => e.stopPropagation()}>
        <OfficerCard
          row={row} onClose={onClose}
          {...(onLevels ? { onLevels } : {})}
          {...(onItems ? { onItems } : {})}
          {...(itemsLook ? { itemsLook } : {})}
          {...(levelsCards ? { levelsCards } : {})}
          {...(levelsNote ? { levelsNote } : {})}
          {...(equip ? { equip } : {})}
          {...(injury ? { injury } : {})}
          {...(action ? { action } : {})}
          levelsEligible={levelsEligible ?? false}
          onOpenSkill={() => setSkillOpen(true)}
          onOpenTactic={setTacticOpen}
        />
      </div>
      {skillOpen && skill && <SkillModal skill={skill} onClose={() => setSkillOpen(false)} />}
      {tactic && <TacticModal tactic={tactic} onClose={() => setTacticOpen(null)} />}
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
 * **왼쪽 그림은 정적 초상화가 아니라 전투 액션 시트를 돌려가며 보여준다**
 * (2026-09-02) — `OfficerActionArt`(`OfficerArt.tsx`)가 평상 자세 5초 뒤 평상 동작 · 공격 · 마법 중 하나를
 * 18칸 애니메이션 시트로 돈다(2026-11-16 — 그전에는 다섯 칸을 좌우 무작위로 갈아 끼웠다). 시트가 없으면 그 컴포넌트
 * 안에서 예전 방식(`OfficerArt`의 `primary="portrait"` — `assets/Chars/` →
 * `portraits/{id}.png`, 알파 있는 보드 타일)으로 조용히 물러난다(`ui/art.ts`).
 * 액자(`market/frame-{grade}.png`)는 배경 스트레치 대신 `border-image`로
 * 두른다(2026-08-27 열세 번째 피드백 — "캐릭터가 잘려 보인다"의 원인이
 * `object-fit: cover` + 정사각形 칸이었다. `border-image`는 프레임 그림을
 * 늘려도 모서리 장식이 안 뭉개지고, 안쪽은 그냥 빈 칸이라 `object-fit: contain`
 * 인물 그림이 잘리지 않고 통째로 들어간다).
 *
 * **고유기술 줄이 통째로 바뀌었다** (2026-08-27 열세 번째 피드백 — "고유
 * 스킬 줄은 없애고, 있으면 `assets/icons/skills/` 연출 이미지를 패널 폭
 * 전체로"). 그 이미지는 이미 전투 연출에서 쓰던 것과 같은 자리
 * (`skillArtUrl()`, `ui/art.ts` — `packages/client/public/skills/{기술id}.jpg`,
 * `assets/icons/skills/`를 굽는 빌드 산출물)를 그대로 재사용한다 — 새로
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
function OfficerCard({ row, onClose, onLevels, onItems, itemsLook, levelsCards, levelsEligible, levelsNote, equip, injury, action, onOpenSkill, onOpenTactic }: {
  row: OfficerRankRow; onClose: () => void;
  /** `OfficerCardModal`의 같은 이름 */
  action?: CardAction;
  onLevels?: () => void; onItems?: () => void; itemsLook?: ItemsLook; levelsCards?: { have: number; need: number | null }; levelsEligible?: boolean; levelsNote?: string | null;
  /** 이 장수가 낀 병기 — **caller가 넘긴다**(`levelsCards`와 같은 이유). 카드는
      `OfficerRankRow`만 받아 프로필을 모르고, 랭킹의 다른 계정 장수는 애초에
      알 수 없는 값이라 그쪽은 안 넘긴다 — 그러면 이 줄째로 사라진다. */
  equip?: EquipmentData;
  injury?: CardInjury;
  /** 고유기술 배너를 눌렀을 때 — `SkillModal`은 이 카드 안이 아니라
      `OfficerCardModal`이 연다(`position: relative` 문제, 위 참조). */
  onOpenSkill: () => void;
  /** 책략 칩을 눌렀을 때 — `TacticModal`도 위와 **같은 이유로** 카드 밖에서 연다 */
  onOpenTactic: (id: string) => void;
}): React.JSX.Element {
  const skill = row.uniqueSkillId ? skillById.get(row.uniqueSkillId) : undefined;
  // `courtesyName`/`story`가 언어별 맵이라(2026-08-27 열 언어 배선) 지금 UI
  // 언어로 고른다 — 없으면 한국어로 물러난다(`pickStory()` 참조).
  const courtesyName = pickStory(row.courtesyName);
  const story = pickStory(row.story);
  // [부상] 라벨을 눌러 펼친 설명 — 닫혀 있는 것이 기본이다(라벨이 이유를 이미 말한다)
  const [injuryOpen, setInjuryOpen] = useState(false);
  /** 부상이면 **깎인 값 하나만** 보인다 — 「40 (−10)」처럼 나란히 두지 않는다(GDD §8.2) */
  const shown = (base: number): number => (injury ? injuredStat(base) : base);

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
      {/* 이름 줄 — 장수 일람과 같은 꼴: [등급][레벨 배지] 이름 (2026-11-19 기획자). 레벨은 그 밑 능력치 줄에서 이리로 올라왔다.
          상세에서는 이름 뒤에 자(字)까지 — 「조조 맹덕」(같은 날 기획자) */}
      <h2 className="ofcard-title">
        <GradeBadge grade={row.grade} />
        <LevelBadge level={row.level} />
        <span className="ofcard-name">{pickOfficerNameById(row.officer, row.name)}</span>
        {courtesyName && <span className="ofcard-courtesy" data-field="courtesy">{courtesyName}</span>}
      </h2>

      {/* 그림 · 능력치 판 — 컬렉션 빈 칸을 돌려 4 : 6으로 편 판(`ui/slot-card.png`, 2026-11-19 기획자). 왼쪽 띠에 장수(줄이지 않고 판 위에 그대로 —
          S급 자주 · A급 흰 별빛 · E급 금 후광은 병영 꼬마 뒤의 그 별빛), 오른쪽 종이에 여섯 값을 두 줄 셋씩 — 무력 · 지력 · 통솔 / HP · MP · AT.
          장수 전적은 걷었다(같은 날 기획자 — 전적은 부대만). 레벨은 이름 줄의 배지 */}
      <div className="ofcard-layout" data-field="statPanel">
        <div className="ofcard-figure">
          {STAND_GLOW[row.grade] && <BlinkGlow tone={STAND_GLOW[row.grade]!} className="ofcard-glow" />}
          <OfficerActionArt officer={row.officer} className="art ofcard-art" />
        </div>
        <div className="ofcard-bars">
          {/* 판 이름 — 「능력치」(열 언어, 2026-11-19 기획자) */}
          <h3 className="ofcard-stat-head" data-field="headStats">{t('ranking.card.head.stats')}</h3>
          <div className="ofcard-bar ofcard-bar-abl" data-injured={injury ? '1' : '0'}>
            <Stat icon={{ src: 'icons/stat-might.png', alt: t('ranking.card.might') }} v={shown(row.might)} field="might" />
            <Stat icon={{ src: 'icons/stat-intellect.png', alt: t('ranking.card.intellect') }} v={shown(row.intellect)} field="intellect" />
            <Stat icon={{ src: 'icons/stat-leadership.png', alt: t('ranking.card.leadership') }} v={shown(row.leadership)} field="leadership" />
          </div>
          <div className="ofcard-bar ofcard-bar-lv">
            <Stat k={<GameIcon name="stat-hp" label="HP" />} v={row.stats.hp} field="hp" />
            <Stat k={<GameIcon name="stat-mp" label="MP" />} v={row.stats.mp} field="mp" />
            <Stat k={<GameIcon name="stat-at" label="AT" />} v={`${row.at.min}-${row.at.max}`} field="at" />
          </div>
          {/* 부상 (GDD §8.2, 트랙 11g) — 라벨 하나. 누르면 언제 낫는지 · 깎인 폭 · 병원이 있으면
              [입원시키기]. 능력치 바로 밑에 둔다 — 붉은 숫자의 **이유**를 바로 옆에서 말해야 한다. */}
          {injury && (
            <div className="ofcard-injury" data-field="injury" data-healing={injury.healing ? '1' : '0'}>
              <button className="ofcard-injury-tag" data-action="injury" aria-expanded={injuryOpen}
                onClick={() => setInjuryOpen((o) => !o)}>
                <GameIcon name="st-injured" label={t('squad.status.injured')} text />
              </button>
              {injuryOpen && (
                <div className="ofcard-injury-info" data-field="injuryInfo">
                  <span data-field="injuryLeft">
                    {injury.healing
                      ? <GameIcon name="st-healing" label={t('hospital.ward.healing.short', { time: formatHealLeft(injury.left) })} text />
                      : <GameIcon name="st-recover" label={t('hospital.pick.natural', { time: formatHealLeft(injury.left) })} text />}
                  </span>
                  <span>{t('hospital.penalty', { n: INJURY_PENALTY })}</span>
                  {injury.heal && !injury.healing && (
                    <>
                      <button className="btn sm" data-action="healOfficer"
                        disabled={injury.heal.busy || injury.heal.blocked !== null}
                        onClick={injury.heal.onHeal}>
                        <GameIcon name="hosp-admit" label={t('hospital.admit')} text />
                      </button>
                      <Say text={injury.heal.blocked} who="doctor" name="healBlocked" />
                    </>
                  )}
                  <Say text={injury.heal?.error} who="doctor" name="healError" repeat />
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/*
        낀 병기 (2026-09-10) — 책략 바로 위, 같은 폭·같은 막대(`.ofcard-bar`).

        대장간 쪽(지급 목록·지급할 장수 고르기 표)에는 내내 보였는데 **장수 카드를
        직접 열면 안 보였다** — 지급까지 다 만들고 나니 「이 장수가 무엇을 끼고
        있나」를 확인할 자리가 없었다. **없으면 이 줄째로 사라진다**(고유기술
        배너·인물 소개와 같은 규약) — 「병기: 없음」으로 빈 자리를 남기면 데이터가
        빠진 것인지 원래 없는 것인지 구별이 안 된다. 책략 줄이 「습득한 책략이
        없음」을 남기는 것과 갈리는데, 그쪽은 **모든 장수가 언젠가 갖는 것**이고
        병기는 계정에 15개뿐이라 대부분의 장수에게 영영 없다.

        이름은 **이름뿐**이다(2026-09-11 지정) — 예전엔 대장간이 쓰는
        `Lv{해금 레벨} {이름}` 형태를 그대로 가져왔는데, 이 카드에서 해금
        레벨은 「이 장수가 Lv1인데 병기가 Lv4」처럼 **장수 레벨로 잘못
        읽힌다**(바로 윗줄이 `Lv 1 HP 10 …`이다). 대장간 목록은 레벨을
        아이콘으로 따로 세우므로 그쪽에서 잃는 것도 없다.
      */}
      {equip && (
        <div className="ofcard-bar ofcard-bar-equip" data-field="equip" data-item={equip.id}>
          {/* 그림은 **대장간 제작 목록과 같은 것**이다(2026-09-11 여섯 번째
              지정) — 얇은 금테 · 검정 바탕 · 해금 레벨 색 후광. 예전엔 원본
              사진을 글자 높이에 맞춰 눌러 놓기만 해서, 같은 무기가 화면마다
              다른 그림으로 보였다. `ItemThumb`이 단일 출처다. */}
          <ItemThumb item={equip} variant="row" />
          <b>{pickEquipName(equip)}</b>
          <span className="eff">{pickEquipText(equip)}</span>
        </div>
      )}

      {/* 배운 책략 — **그림 아래·인물 열전 위, 카드 폭 전체**(2026-09-03 지정).
          예전에는 오른쪽 3:7 단 안에 있어(`.ofcard-bars`의 넷째 줄) 좁은 폭에
          두 개씩 접혀 쌓였다 — 레벨이 오를수록(최대 여덟) 오른쪽 단만 길어져
          왼쪽 그림과 높이가 어긋났다. 없어도 줄은 남는다(「습득한 책략이 없음」). */}
      {/* 칸 이름 — 책략 · 고유 기술 · 장수 열전, 왼쪽 정렬 (2026-11-19 기획자) */}
      <h3 className="ofcard-head" data-field="headTactics">{t('ranking.card.head.tactics')}</h3>
      <div className="ofcard-bar ofcard-bar-tactics">
        {row.tactics.length === 0
          ? <span className="empty">{t('ranking.card.noTactics')}</span>
          : row.tactics.map((x) => (
            // 행이 실어 온 `name`/`text`는 **한국어 평문**이다(meta는 언어를
            // 모른다) — 화면이 id로 다시 골라 찍는다(`pickOfficerNameById`와 같은 결)
            // 누르면 설명 팝업(`TacticModal`) — 모바일엔 hover가 없어 `title=`이
            // 손가락으로는 영영 안 보인다(2026-09-03). `title`은 그대로 둔다:
            // 마우스 쪽은 굳이 누르지 않아도 되게.
            <button
              key={x.id} type="button" className={`chip ${x.school}`}
              data-tactic={x.id} title={`${pickTacticNameById(x.id, x.name)} — ${pickTacticTextById(x.id, x.text)}`}
              aria-label={pickTacticNameById(x.id, x.name)}
              onClick={() => onOpenTactic(x.id)}
            >
              {/* 글자 대신 책략 엠블럼(2026-10-23 기획자 지정) — 이름은 `aria-label` · 누르면 뜨는 설명 팝업이 말한다 */}
              <TacticIcon id={x.id} />
            </button>
          ))}
      </div>

      {/* 고유기술 연출 배너 — 패널 폭 전체. 눌러서 설명 팝업(SkillModal, `OfficerCardModal`이 연다). 없으면 명패 */}
      <h3 className="ofcard-head" data-field="headSkill">{t('ranking.card.head.skill')}</h3>
      {row.uniqueSkillId && skill ? (
        <button type="button" className="ofcard-skillbanner" data-action="skill" onClick={onOpenSkill}>
          <img src={skillArtUrl(row.uniqueSkillId)} alt={skill.name} />
        </button>
      ) : (
        /* 고유기술이 없는 장수(C · D급 등) — 배너 자리에 명패(`ui/plate-settings.png`)를 같은 크기로 씌우고 「고유 기술 없음」(열 언어, 2026-11-19 기획자).
           자리가 비지 않아 카드마다 칸 차례 · 높이가 같다 */
        <div className="ofcard-noskill" data-field="noSkill">{t('ranking.card.noSkill')}</div>
      )}

      {/* 인물 소개 — 대나무 테두리(`btn-ghost.png`, 2026-08-27 열세 번째 지정).
          G1이 218/260명만 채웠다. 없으면 이 줄째로 사라진다(§data 머리말) */}
      {story && <h3 className="ofcard-head" data-field="headStory">{t('ranking.card.head.story')}</h3>}
      {story && <p className="ofcard-story">{story}</p>}

      {/* 아래 단추 — [아이템] · [레벨/스킬 관리] · [뒤로 가기], 그 밑에 그 자리의 한 수(옥색 [선택하기] · 붉은 [해제하기]) (2026-11-19 기획자).
          [아이템] · [레벨/스킬 관리]는 내 장수일 때만 — 랭킹의 다른 계정 장수는 [X]만(그 계정을 관리할 수 없다).
          예전의 [전적 보기](기물 · 모드별 전적 판)는 걷었다 — 전적은 맨 윗줄의 출전 · 승 · 무 · 패 · 격파뿐이다 */}
      {onItems && (
        /* 왼쪽 정렬 — 둥근 금테 배지 + 글 (2026-11-23 기획자). 글은 배지 몫만큼 오른쪽에도 비워 단추 가운데에 선다 */
        <button className={`btn wide ofcard-lead${itemsLook ? ' ofcard-held' : ''}`} data-action="heldOpen" data-held={itemsLook?.held}
          onClick={onItems}>
          {itemsLook && (HELD_BADGE === 'round'
            ? <span className="ofcard-held-badge" data-field="heldBadge" data-shape="round"><span className="ofcard-held-in">{itemsLook.badge}</span></span>
            : <span className="ofcard-held-badge sqh-tile" data-field="heldBadge" data-shape="square">{itemsLook.badge}</span>)}
          <span className="lbl" data-field="heldLabel">{itemsLook?.label ?? t('squad.cmd.items')}</span>
        </button>
      )}
      {onLevels && (
        /* [강화](옛 [레벨/스킬 관리], 2026-11-20 기획자) — 이름은 가운데, 오른쪽 끝에 「보유 / 필요 (카드 그림)」.
           올릴 수 없으면(`levelsEligible` 거짓 — 카드 모자람 · 도시 상한 · 최대 레벨) 꺼진다. 누르면 곧장 레벨업 고르기 */
        <>
          <button className="btn wide ofcard-mid ofcard-enhance" data-action="levels" disabled={!levelsEligible} onClick={onLevels}>
            <span className="lbl">{t('officer.levels')}</span>
            {levelsCards && (
              <span className={`sub ofcard-enhance-cards${levelsEligible ? ' levelup-ready' : ''}`} data-field="enhanceCards">
                {levelsCards.need === null ? t('officer.cards.max') : (
                  <>{levelsCards.have} / {levelsCards.need}<img src="market/market_card.png" alt={t('officers.col.cards')} /></>
                )}
              </span>
            )}
          </button>
          <Say text={levelsNote} name="levelCap" />
        </>
      )}
      {(onItems || onLevels || action) && (
        <button className="btn wide ofcard-mid" data-action="cardBack" onClick={onClose}>
          <span className="lbl">{stripBackArrow(t('match.back'))}</span>
        </button>
      )}
      {action && (
        <>
          <button
            className={`btn primary wide ofcard-${action.kind}`}
            data-action={action.kind === 'select' ? 'cardSelect' : 'cardRelease'}
            disabled={!!action.blocked}
            title={action.blocked ?? undefined}
            onClick={action.onPress}
          >
            <span className="lbl">{action.label}</span>
          </button>
          <Say text={action.blocked} name="cardActionNote" />
        </>
      )}
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
function Stat({ k, v, icon, field }: { k?: React.ReactNode; v: string | number; icon?: { src: string; alt: string }; field?: string }): React.JSX.Element {
  return (
    <span className="ofcard-stat" {...(field ? { 'data-field': field } : {})}>
      {icon
        ? <img className="ofcard-stat-icon" src={icon.src} alt={icon.alt} title={icon.alt} />
        : k && <span className="k">{k}</span>}
      <span className="v">{v}</span>
    </span>
  );
}
