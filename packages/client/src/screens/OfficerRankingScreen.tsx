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
import { skillById } from '@samchess/data';
import { officerRankRows, sortOfficerRows } from '@samchess/meta';
import type { OfficerRankRow, OfficerRankSort, PlayerProfile, RecordFilter } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import {
  FilterRow, FilterSelect, InfoHeadCell, ModeSelect, NoteRow, SearchBar, SortMenu, stripBackArrow, useRankingRows,
} from './RankingCommon.tsx';
import { currentSession } from '../meta/auth.ts';
import { rankingBackdrop } from './backdrop.ts';
import { OfficerArt } from './OfficerArt.tsx';
import { skillArtUrl } from '../ui/art.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { SkillModal } from './SkillModal.tsx';
import { playSfx } from '../audio/sfx.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById, pickStory } from '../i18n/story.ts';

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
            피드백 — "기존 화면을 덮는 팝업 형태로"). `.modal-back`(환경설정
            팝업과 같은 배경 가리개)으로 감싸 화면 위에 뜨게 한다 — 안쪽을
            누르는 것은 안 닫히고 바깥(가리개)을 눌러야 닫힌다. */}
        {card && (
          <div className="modal-back" onClick={() => setCard(null)}>
            <div className="ofcard-modal" onClick={(e) => e.stopPropagation()}>
              <OfficerCard row={card} onClose={() => setCard(null)} />
            </div>
          </div>
        )}

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

/**
 * 「장수 카드 띄워주기」(52·53쪽) — 이제 표를 밀어내리지 않는 진짜 팝업이다
 * (2026-08-27 열세 번째 피드백, 부르는 자리는 `OfficerRankingScreen`의
 * `.modal-back` 참조). 53쪽 목업을 기반으로 네 차례 사용자 지정을 거쳤다:
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
function OfficerCard({ row, onClose }: { row: OfficerRankRow; onClose: () => void }): React.JSX.Element {
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
