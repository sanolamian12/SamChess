/**
 * 도시 랭킹 (pptx 50쪽 가운데 · 51쪽 표 정의, 2026-08-26 표·필터 조정 반영)
 *
 * ```
 * [3 vs 3 ▾]  [전체 ▾]
 * [검색 창          ] [검색] [정렬 필터]
 * 순위 도시명 레벨 장수수 승/무/패 적격파 총점
 * …top 5…
 * [뒤로 가기]
 * ```
 *
 * **「내 도시」 줄은 랭킹 메뉴(`RankingScreen`) 위쪽으로 옮겼다** (2026-09-18 지정) —
 * 그 자리엔 [뒤로 가기] 명령 판(`RankingBackPanel`)이 선다. 표 머리·줄
 * (`CityHead`·`CityRow`)은 메뉴가 그대로 가져다 쓰도록 내보낸다.
 *
 * "아이디"·"외교" 열은 뺐다(2026-08-26 확정 — 다른 유저 이메일 비공개, 외교는 범위 밖).
 * 51쪽 목업의 「전·승·무」 세 열은 **한 열(승/무/패)로 접는다** — 「전」(출전 수)은
 * 승+무+패로 다시 셀 수 있어 따로 안 보여준다. 모드·상대 필터는 알약 버튼 줄
 * 대신 **리스트 박스(드롭다운) 둘을 한 줄에**(모드 왼쪽·상대 오른쪽) 놓는다
 * (`RankingCommon.tsx`의 `FilterRow`/`ModeSelect`/`FilterSelect`).
 *
 * **"총점" 공식은 표 밑에 늘 떠 있지 않는다** (2026-08-27) — 「총점」 글자 자체가
 * 버튼이라, 누르면 바로 아래 줄에 펼쳐진다(`InfoHeadCell`/`NoteRow`). 안 눌렀으면
 * 아무 설명도 안 뜬다.
 *
 * ────────────────────────────────────────────────────────────────
 * "내 도시" 줄의 순위는 비운다 ★ (그 줄은 이제 `RankingScreen`에 있다)
 * ────────────────────────────────────────────────────────────────
 *
 * `ranking.ts`의 방침대로 "내 랭킹"은 전체 유저를 안 훑고 내 프로필 하나로만 낸다
 * (서버 왕복 없이 항상 뜬다, §5-61과 같은 결). 그래서 **내가 실제로 몇 등인지는
 * 모른다** — top-5에 없으면 순위 칸은 「—」로 둔다. 전체 순위를 매 화면마다 재려면
 * top-5·검색과 똑같이 전체 스캔이 필요해서 값싸지 않다.
 */

import { useState } from 'react';
import type { CityRankRow, PlayerProfile, RecordFilter } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import {
  FilterRow, FilterSelect, InfoHeadCell, ModeSelect, NoteRow, RANK_SEARCH_DEBOUNCE_MS, RankingBackPanel, SearchBar, stripBackArrow,
  useRankingRows,
} from './RankingCommon.tsx';
import { currentSession } from '../meta/auth.ts';
import { rankingBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { RankingLoading, useRankingLoading } from './RankingLoading.tsx';


export function CityRankingScreen({ profile, onBack }: {
  profile: PlayerProfile;
  onBack: () => void;
}): React.JSX.Element {
  useLang();
  const [mode, setMode] = useState<BattleMode>('3v3');
  const [filter, setFilter] = useState<RecordFilter>('all');
  const [q, setQ] = useState('');
  const { rows, error, loading, ready } = useRankingRows<CityRankRow>({ board: 'city', filter, mode, sort: 'total', q });
  const veil = useRankingLoading(!ready);
  const [topNote, setTopNote] = useState(false);

  return (
    <ScreenChrome
      backdrop={rankingBackdrop(profile.cityLevel)}
      className="scr-ranking scr-ranking-city"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="rankingCity">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{stripBackArrow(t('ranking.back'))}</button>
        <span className="place-nm">{t('ranking.tab.city')}</span>
      </div>

      <div className="place-body rk-body">
        {/* 위 = 서버 랭킹(스크롤), 아래 = [뒤로 가기](화면 바닥에 고정) — 2026-09-18 지정 */}
        <div className="rk-top">
          <FilterRow>
            <ModeSelect value={mode} onChange={setMode} />
            <FilterSelect value={filter} onChange={setFilter} />
          </FilterRow>
          <SearchBar
            value={q} onSubmit={setQ} placeholder={t('ranking.search.city')}
            debounceMs={RANK_SEARCH_DEBOUNCE_MS}
          />

          <section className="place-panel rk-table-wrap" data-loading={ready && loading ? '1' : undefined}>
            <div className="rk-table">
              <CityHead noteOpen={topNote} onToggleNote={() => setTopNote((o) => !o)} />
              {topNote && <NoteRow note={t('ranking.total.note')} />}
              {loading && rows.length === 0 && <p className="hint">{t('ranking.loading')}</p>}
              {error && rows.length === 0 && !loading && <p className="hint">{t('ranking.loadError')}</p>}
              {!error && !loading && rows.length === 0 && <p className="hint">{t('ranking.empty.city')}</p>}
              {rows.map((r, i) => <CityRow key={`${r.cityName}-${i}`} rank={String(i + 1)} row={r} />)}
            </div>
          </section>
        </div>

        <RankingBackPanel onBack={onBack} />
      </div>
      {veil && <RankingLoading title={t('ranking.tab.city')} backLabel={stripBackArrow(t('ranking.back'))} onBack={onBack} />}
    </ScreenChrome>
  );
}

function CityHead({ noteOpen, onToggleNote }: {
  noteOpen: boolean; onToggleNote: () => void;
}): React.JSX.Element {
  return (
    <div className="rk-row rk-thead">
      <span className="rk-rk">{t('ranking.col.rank')}</span>
      <span className="rk-nm">{t('ranking.col.city')}</span>
      <span className="rk-n">{t('ranking.col.level')}</span>
      <span className="rk-n">{t('ranking.col.officerCount')}</span>
      <span className="rk-wdl">{t('ranking.col.wdl')}</span>
      <span className="rk-n">{t('ranking.col.kills')}</span>
      <InfoHeadCell className="rk-n" label={t('ranking.col.total')} open={noteOpen} onToggle={onToggleNote} />
    </div>
  );
}

function CityRow({ rank, row }: {
  rank: string; row: CityRankRow;
}): React.JSX.Element {
  return (
    <div className="rk-row" data-city={row.cityName} data-rank={rank}>
      <span className="rk-rk">{rank}</span>
      <span className="rk-nm">{row.cityName}</span>
      <span className="rk-n">Lv{row.cityLevel}</span>
      <span className="rk-n">{row.officerCount}</span>
      <span className="rk-wdl">{t('ranking.wdl', { w: row.tally.wins, d: row.tally.draws, l: row.tally.losses })}</span>
      <span className="rk-n">{row.tally.kills}</span>
      <span className="rk-n">{row.total}</span>
    </div>
  );
}
