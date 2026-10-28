/**
 * 대자보 — 메인의 게시판 자리로 들어오면 가장 먼저 뜨는 화면 (2026-10-13 기획자 지정)
 *
 * ```
 * ┌ ← 도시로        대자보 ───────┐
 * ┌ 위 정보 판 ──────────────────┐
 * │ [▣] 수집 컬렉션 : 3위    250점 │
 * │ [성] 도시 랭킹  : 6위     4 점 │
 * └─────────────────────────────┘
 *              (게시판 그림)
 * ┌ 명령 판 ─────────────────────┐
 * │ [ 컬렉션 보기 ]  → 컬렉션        │
 * │ [  랭킹 보기  ]  → 랭킹 메뉴    │
 * │ [방어 기록 보기] → 방어 기록 (붉은 표지 = 안 본 판, GDD §8.8 단계 5) │
 * └─────────────────────────────┘
 * ```
 *
 * 대자보는 **랭킹과 컬렉션 둘을 담는 자리**다. 랭킹은 원래 이 자리에 있던 랭킹 메뉴
 * (`RankingScreen`)가 한 걸음 안으로 들어간 것이고, 컬렉션(`CollectionScreen`, 2026-10-13)은
 * 장수 · 병기 · 아이템을 엮어 정사 · 연의의 이야기와 잇는다. 위 판의 점수는 제 프로필에서 바로 내고,
 * 순위는 서버다 — 컬렉션은 컬렉션 화면과 같은 `GET /ranking/collection`(2026-10-15). 못 닿거나
 * 점수가 0이라 줄에 안 서면 「—위」다 — 숫자를 지어내 채우지 않는다.
 *
 * 위 판은 랭킹 메뉴의 요약 줄(`SummaryLine`)을 그대로 쓴다 — 「이름 : 순위 … 점수」 꼴이
 * 두 화면에서 같아야 한다. 도시 순위는 서버(`GET /ranking/mine`), 점수는 제 프로필이다.
 * **두 응답이 다 올 때까지** 랭킹 화면과 같은 로딩 판이 덮는다 — 한 줄만 먼저 차면 판이 들썩인다.
 */

import { useEffect, useMemo, useState } from 'react';
import { cityRankRow, collectionPoints } from '@samchess/meta';
import type { MyRanks, PlayerProfile, RecordFilter } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { fetchCollectionRanking, fetchMyRanks } from '../meta/ranking.ts';
import type { CollectionRanking } from '../meta/ranking.ts';
import { rankingBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { SummaryLine, rankText } from './RankingScreen.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { RankingLoading, useRankingLoading } from './RankingLoading.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

/** 랭킹 메뉴와 같은 값으로 잰다 — 두 화면의 도시 순위가 같아야 한다 */
const MODE: BattleMode = '3v3';
const FILTER: RecordFilter = 'all';

export function BoardScreen({ profile, onBack, onRanking, onCollection, onDefense, defenseUnseen = 0 }: {
  profile: PlayerProfile;
  onBack: () => void;
  onRanking: () => void;
  onCollection: () => void;
  /** [방어 기록 보기] (GDD §8.8 단계 5) */
  onDefense: () => void;
  /** 안 본 방어 기록 — 단추의 표지 */
  defenseUnseen?: number;
}): React.JSX.Element {
  useLang();
  const [ranks, setRanks] = useState<MyRanks | null>(null);
  const [collection, setCollection] = useState<CollectionRanking | null>(null);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.allSettled([
      fetchMyRanks(FILTER, MODE).then((r) => { if (live) setRanks(r); }),
      fetchCollectionRanking().then((r) => { if (live) setCollection(r); }),
    ]).then(() => { if (live) setSettled(true); });   // 실패한 쪽은 순위만 「—」
    return () => { live = false; };
  }, []);
  const veil = useRankingLoading(!settled);
  const backLabel = stripBackArrow(t('place.back'));
  const city = useMemo(() => cityRankRow(profile, FILTER, MODE), [profile]);

  return (
    <ScreenChrome
      backdrop={rankingBackdrop(profile.cityLevel)}
      // 랭킹 메뉴와 같은 틀이다 — 위 정보 판 · 바닥 명령 판의 규칙을 그대로 받는다
      className="scr-ranking scr-ranking-menu scr-board"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="board">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {backLabel}
        </button>
        <span className="place-nm">{t('main.ranking')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel rk-summary" data-field="board">
          {/* 줄 꼴은 도시 줄과 같다(「순위 … 값」) — 점수는 제 프로필, 순위는 서버 (2026-10-15) */}
          <SummaryLine board="collection" icon="records" title="board.sum.collection"
            rank={t('ranking.sum.rank', { n: collection?.mine?.rank ?? '—' })} total={t('collection.sum.board', { n: collectionPoints(profile).toLocaleString() })} />
          <SummaryLine board="city" icon="tab-city" title="ranking.tab.city"
            rank={rankText(ranks?.city)} total={t('ranking.sum.total', { total: city.total })} />
        </section>

        <section className="place-panel rk-menu">
          <button className="btn wide" data-action="collection" onClick={onCollection}>
            <span className="lbl">{t('board.view.collection')}</span>
          </button>
          <button className="btn wide" data-action="ranking" onClick={onRanking}>
            <span className="lbl">{t('board.view.ranking')}</span>
          </button>
          <button className="btn wide" data-action="defense" data-unseen={defenseUnseen} onClick={onDefense}>
            <span className="lbl">{t('board.view.defense')}</span>
            {defenseUnseen > 0 && <i className="brd-badge" data-field="badge">{defenseUnseen}</i>}
          </button>
        </section>
      </div>
      {veil && <RankingLoading title={t('main.ranking')} backLabel={backLabel} onBack={onBack} />}
    </ScreenChrome>
  );
}
