/**
 * 장수 랭킹 (pptx 50쪽 가운데 · 52쪽 표 정의 + 「장수 카드 띄워주기」,
 * 2026-08-27 표 조정 반영)
 *
 * ```
 * [전체 ▾]        (모드 필터 없음 — 장수 전적은 모드를 안 가른다)
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
 * 「보기」를 누르면 위쪽에 장수 카드가 뜬다(52쪽 자주색 화살표) — 다른 계정의
 * 장수라 새로 API를 안 부르고, 이미 받은 행 데이터(이름·등급·레벨·스탯·전적)만으로
 * 그린다. 49쪽 정렬 버튼의 「도시 규모 순」은 장수 한 명 행에는 뜻이 없어 「레벨
 * 순」으로 바꿔 달았다(`@samchess/meta`의 `ranking.ts` 머리말 참조).
 *
 * 상대 필터는 도시·부대 랭킹과 같은 리스트 박스(드롭다운)다(2026-08-26) — 모드
 * 필터가 없어 짝 없이 혼자 놓인다.
 */

import { useMemo, useState } from 'react';
import { skillById } from '@samchess/data';
import { officerRankRows, sortOfficerRows } from '@samchess/meta';
import type { OfficerRankRow, OfficerRankSort, PlayerProfile, RecordFilter } from '@samchess/meta';
import {
  FilterRow, FilterSelect, InfoHeadCell, NoteRow, SearchBar, SortMenu, useRankingRows,
} from './RankingCommon.tsx';
import { currentSession } from '../meta/auth.ts';
import { rankingBackdrop } from './backdrop.ts';
import { OfficerArt } from './OfficerArt.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { SkillModal } from './SkillModal.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

const SORTS = ['total', 'battle', 'level'] as const;

export function OfficerRankingScreen({ profile, onBack }: {
  profile: PlayerProfile;
  onBack: () => void;
}): React.JSX.Element {
  useLang();
  const [filter, setFilter] = useState<RecordFilter>('all');
  const [sort, setSort] = useState<OfficerRankSort>('total');
  const [q, setQ] = useState('');
  const { rows, error, loading } = useRankingRows<OfficerRankRow>({ board: 'officer', filter, sort, q });
  const [card, setCard] = useState<OfficerRankRow | null>(null);
  const [topNote, setTopNote] = useState(false);
  const [mineNote, setMineNote] = useState(false);

  const mine = useMemo(
    () => sortOfficerRows(officerRankRows(profile, filter), sort).slice(0, 3),
    [profile, filter, sort],
  );

  return (
    <ScreenChrome
      backdrop={rankingBackdrop(profile.cityLevel)}
      className="scr-ranking scr-ranking-officer"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="rankingOfficer">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('ranking.back')}</button>
        <span className="place-nm">{t('ranking.tab.officer')}</span>
      </div>

      <div className="place-body rk-body">
        {/* 장수 카드 — 카드 자리(52쪽)가 표보다 위에 있다: 고르면 여기 뜬다.
            위/아래 어느 쪽 행에서 열어도 항상 보이도록 스크롤 영역 밖에 둔다. */}
        {card && <OfficerCard row={card} onClose={() => setCard(null)} />}

        {/* 위 = 서버 랭킹(스크롤), 아래 = 내 정보(화면 바닥에 고정) — 2026-08-26 지정 */}
        <div className="rk-top">
          <FilterRow>
            <FilterSelect value={filter} onChange={setFilter} />
          </FilterRow>
          <div className="rk-searchrow">
            <SearchBar value={q} onSubmit={setQ} placeholder={t('ranking.search.officer')} />
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
                <OfficerRow key={`${r.cityName}-${r.officer}-${i}`} rank={String(i + 1)} row={r} onView={() => setCard(r)} />
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
              {mine.map((r) => <OfficerRow key={r.officer} rank="—" row={r} onView={() => setCard(r)} />)}
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
    <button className="rk-row rk-clickable" onClick={onView}>
      <span className="rk-rk">{rank}</span>
      <span className="rk-nm">{row.cityName}</span>
      <span className="rk-nm"><span className="gr" data-grade={row.grade}>{row.grade}</span> {row.name}</span>
      <span className="rk-n">Lv{row.level}</span>
      <span className="rk-n">{row.tally.plays}</span>
      <span className="rk-n">{row.tally.kills}</span>
      <span className="rk-n">{row.total}</span>
      <span className="rk-btn">{t('ranking.col.view')}</span>
    </button>
  );
}

/**
 * 「장수 카드 띄워주기」(52·53쪽) — 표 위쪽 자리에 뜬다. 53쪽 목업을 기반으로
 * 세 차례 사용자 지정을 거쳤다(2026-08-27, 마지막이 지금 줄 순서):
 *
 * ```
 * ┌──────────── 이름 자 [등급] (중앙 상단) ─────────────┐
 * │ 4          │ 6                                      │
 * │ 기물 그림  │ 1. 파랑 전적·적격파                       │
 * │ (칸을 채움)│ 2. 보라 무력·지력·통솔                    │
 * │            │ 3. 금색 고유기술명 (누르면 설명 팝업),     │
 * │            │    없으면 「고유 기술 없음」               │
 * │            │ 4. 초록 Lv·HP·MP·AT                      │
 * │            │ 5. 배운 책략 목록, 없으면 「습득한 책략이   │
 * │            │    없음」                                │
 * ├──────────────────────────────────────────────────────┤
 * │ 인물 열전                                             │
 * └──────────────────────────────────────────────────────┘
 * ```
 *
 * **왼쪽 그림은 전투 수묵화가 아니라 "체스 게임에 들어갔을 때 기물로 쓰는
 * 이미지"다** — `OfficerArt`에 `primary="portrait"`를 줘서 `assets/Chars/` →
 * `portraits/{id}.png`(알파 있는 보드 타일)를 먼저 찾게 한다(`ui/art.ts`).
 *
 * **다섯 줄 다 없으면 줄째로 사라지지 않는다** (2026-08-27 재지정 — 고유기술도
 * 처음엔 없으면 숨겼다가 뒤집었다). 고유기술·책략 둘 다 「없음」 문구를 직접 보여준다.
 *
 * **고유기술과 책략은 서로 다른 자리에서 온다.** 고유기술은 장수 고정값이라
 * `@samchess/data`의 `skillById`로 여기서 직접 찾는다(레벨을 안 타므로 행에
 * 안 실어도 된다). 책략은 **계정마다 다르다**(같은 장수라도 레벨업으로 무엇을
 * 배웠는지가 갈린다) — `OfficerRankRow.tactics`가 서버에서 이미 `tacticsOf()`로
 * 계산해 실어 보낸 값이고, 화면은 그걸 그대로 그릴 뿐이다.
 *
 * **각 스탯 항목은 따로따로 DOM에 얹는다** (한 문자열로 잇지 않는다) — 지금은
 * "Lv 9 | HP 40 | ..."처럼 보여도, 이후 항목마다 다른 자리·꾸밈을 넣으려면
 * (아이콘, 강조색 등) 미리 나눠 둔 쪽이 CSS만으로 끝난다.
 */
function OfficerCard({ row, onClose }: { row: OfficerRankRow; onClose: () => void }): React.JSX.Element {
  const [skillOpen, setSkillOpen] = useState(false);
  const skill = row.uniqueSkillId ? skillById.get(row.uniqueSkillId) : undefined;

  return (
    <section className="place-panel ofcard">
      <button className="btn ghost sm ofcard-close" data-action="closeCard" onClick={onClose} aria-label={t('ranking.card.close')}>✕</button>

      <h2 className="ofcard-title">
        <span className="ofcard-name">{row.name}</span>
        {row.courtesyName && <span className="ofcard-courtesy">{row.courtesyName}</span>}
        <span className="gr ofcard-grade" data-grade={row.grade}>[{row.grade}]</span>
      </h2>

      <div className="ofcard-layout">
        <OfficerArt officer={row.officer} className="art ofcard-art" primary="portrait" />

        <div className="ofcard-bars">
          {/* 1. 전적 */}
          <div className="ofcard-bar ofcard-bar-rec">
            <Stat v={t('ranking.wdl', { w: row.tally.wins, d: row.tally.draws, l: row.tally.losses })} />
            <Stat k={t('ranking.col.kills')} v={row.tally.kills} />
          </div>

          {/* 2. 삼능력 */}
          <div className="ofcard-bar ofcard-bar-abl">
            <Stat k={t('ranking.card.might')} v={row.might} />
            <Stat k={t('ranking.card.intellect')} v={row.intellect} />
            <Stat k={t('ranking.card.leadership')} v={row.leadership} />
          </div>

          {/* 3. 고유기술 — C·D급처럼 없는 장수도 있다. **다섯 줄 다 이제 안 사라진다**
              (2026-08-27 재지정) — 있으면 눌러서 설명 팝업(SkillModal), 없으면
              「고유 기술 없음」을 그대로 보여주고 안 눌린다. */}
          {skill ? (
            <button
              type="button"
              className="ofcard-bar ofcard-bar-skill ofcard-clickable"
              data-action="skill"
              onClick={() => setSkillOpen(true)}
            >
              <Stat v={skill.name} />
            </button>
          ) : (
            <div className="ofcard-bar ofcard-bar-skill">
              <span className="empty">{t('ranking.card.noSkill')}</span>
            </div>
          )}

          {/* 4. 레벨·능력치 */}
          <div className="ofcard-bar ofcard-bar-lv">
            <Stat k="Lv" v={row.level} />
            <Stat k="HP" v={row.stats.hp} />
            <Stat k="MP" v={row.stats.mp} />
            <Stat k="AT" v={`${row.at.min}-${row.at.max}`} />
          </div>

          {/* 5. 배운 책략 — 없어도 줄은 남는다(현행 유지) — 「습득한 책략이 없음」 */}
          <div className="ofcard-bar ofcard-bar-tactics">
            {row.tactics.length === 0
              ? <span className="empty">{t('ranking.card.noTactics')}</span>
              : row.tactics.map((x) => (
                <span key={x.id} className={`chip ${x.school}`} title={x.text}>{x.name}</span>
              ))}
          </div>
        </div>
      </div>

      {/* 인물 소개 — G1이 218/260명만 채웠다. 없으면 이 줄째로 사라진다(§data 머리말) */}
      {row.story && <p className="ofcard-story">{row.story}</p>}

      {skillOpen && skill && <SkillModal skill={skill} onClose={() => setSkillOpen(false)} />}
    </section>
  );
}

/** 카드 띠 안의 항목 하나 — 「구분 문자열」이 아니라 각자 자기 자리를 가진 요소다 */
function Stat({ k, v }: { k?: string; v: string | number }): React.JSX.Element {
  return (
    <span className="ofcard-stat">
      {k && <span className="k">{k}</span>}
      <span className="v">{v}</span>
    </span>
  );
}
