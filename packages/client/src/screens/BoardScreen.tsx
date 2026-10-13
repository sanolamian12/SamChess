/**
 * 대자보 — 메인의 게시판 자리로 들어오면 가장 먼저 뜨는 화면 (2026-10-13 기획자 지정)
 *
 * ```
 * ┌ ← 도시로        대자보 ───────┐
 * ┌ 위 정보 판 ──────────────────┐
 * │ [▣] 수집 컬렉션 : —위   준비 중 │   ← 장차 「3위 … X/200」
 * │ [성] 도시 랭킹  : 6위     4 점 │
 * └─────────────────────────────┘
 *              (게시판 그림)
 * ┌ 명령 판 ─────────────────────┐
 * │ [ 컬렉션 보기 ]  ← 기획 뒤 연결 │
 * │ [  랭킹 보기  ]  → 랭킹 메뉴    │
 * └─────────────────────────────┘
 * ```
 *
 * 대자보는 **랭킹과 컬렉션 둘을 담는 자리**다. 랭킹은 원래 이 자리에 있던 랭킹 메뉴
 * (`RankingScreen`)가 한 걸음 안으로 들어간 것이고, 컬렉션은 아직 기획 중이다 —
 * 장수 · 병기 · 아이템을 엮어 정사 · 연의의 이야기와 잇고, 점수로 서버 순위를 낸다.
 * 그때까지 [컬렉션 보기]는 꺼 두고 위 판의 그 줄은 「준비 중」이다. 숫자를 지어내
 * 채우지 않는다 — 없는 순위를 있는 것처럼 보여 주면 나중에 「순위가 바뀌었다」로 읽힌다.
 *
 * 위 판은 랭킹 메뉴의 요약 줄(`SummaryLine`)을 그대로 쓴다 — 「이름 : 순위 … 점수」 꼴이
 * 두 화면에서 같아야 한다. 도시 순위는 서버(`GET /ranking/mine`), 점수는 제 프로필이다.
 * 첫 응답까지는 랭킹 화면과 같은 로딩 판이 덮는다.
 */

import { useEffect, useMemo, useState } from 'react';
import { cityRankRow } from '@samchess/meta';
import type { MyRanks, PlayerProfile, RecordFilter } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { fetchMyRanks } from '../meta/ranking.ts';
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

export function BoardScreen({ profile, onBack, onRanking }: {
  profile: PlayerProfile;
  onBack: () => void;
  onRanking: () => void;
}): React.JSX.Element {
  useLang();
  const [ranks, setRanks] = useState<MyRanks | null>(null);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let live = true;
    fetchMyRanks(FILTER, MODE)
      .then((r) => { if (live) setRanks(r); })
      .catch(() => { /* 순위만 「—」 */ })
      .finally(() => { if (live) setSettled(true); });
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
          {/* 줄 꼴은 도시 줄과 같다(「순위 … 값」) — 순위는 「—위」, 값 자리(장차 「X/200」)는 「준비 중」 */}
          <SummaryLine board="collection" icon="records" title="board.sum.collection"
            rank={rankText(null)} total={t('board.soon')} />
          <SummaryLine board="city" icon="tab-city" title="ranking.tab.city"
            rank={rankText(ranks?.city)} total={t('ranking.sum.total', { total: city.total })} />
        </section>

        <section className="place-panel rk-menu">
          {/* 컬렉션은 기획 뒤에 잇는다 — 그때까지 꺼 두고, 위 판의 그 줄이 「준비 중」이라고 말한다 */}
          <button className="btn wide" data-action="collection" disabled>
            <span className="lbl">{t('board.view.collection')}</span>
          </button>
          <button className="btn wide" data-action="ranking" onClick={onRanking}>
            <span className="lbl">{t('board.view.ranking')}</span>
          </button>
        </section>
      </div>
      {veil && <RankingLoading title={t('main.ranking')} backLabel={backLabel} onBack={onBack} />}
    </ScreenChrome>
  );
}
