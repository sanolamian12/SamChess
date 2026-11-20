/**
 * 대자보 — 메인의 게시판 자리로 들어오면 가장 먼저 뜨는 화면 (2026-10-13 기획자 지정)
 *
 * ```
 * ┌ ← 도시로        대자보 ───────┐
 * ┌ 위 정보 판 ──────────────────┐
 * │           랭킹                 │   ← 2026-11-20 기획자: 제목 + 세 분야(전투 → 도시화 → 컬렉션), 랭킹 메뉴와 같은 줄
 * │ (승리) 전투   : 6위     94 점 │
 * │ (궁궐) 도시화 : 21위   340 점 │
 * │ (관우) 컬렉션 : 3위    250 점 │
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
 * 순위는 서버다. 못 닿으면 「—위」, 줄에 안 서면(컬렉션 0점 · 공격대로 0판) 그 사실을 한 줄로 말한다 —
 * 숫자를 지어내 채우지 않는다.
 *
 * 위 판은 랭킹 메뉴의 줄(`BoardSummary`)을 그대로 쓴다 — 「이름 : 순위 … 점수」 꼴이
 * 두 화면에서 같아야 한다. 순위는 서버(`GET /ranking/mine` 한 번에 세 분야), 점수는 제 프로필이다.
 * **응답이 올 때까지** 랭킹 화면과 같은 로딩 판이 덮는다 — 한 줄만 먼저 차면 판이 들썩인다.
 */

import { useEffect, useState } from 'react';
import { RANK_BOARDS } from '@samchess/meta';
import type { MyRanks, PlayerProfile } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { fetchMyRanks } from '../meta/ranking.ts';
import { rankingBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { BoardSummary } from './RankingScreen.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { RankingLoading, useRankingLoading } from './RankingLoading.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

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
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let live = true;
    fetchMyRanks()
      .then((r) => { if (live) setRanks(r); })
      .catch(() => { /* 순위만 「—」 */ })
      .finally(() => { if (live) setSettled(true); });
    return () => { live = false; };
  }, []);
  const veil = useRankingLoading(!settled);
  const backLabel = stripBackArrow(t('place.back'));

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
          {/* 랭킹 메뉴의 위 판과 같은 줄 — 점수는 제 프로필, 순위는 서버(`GET /ranking/mine`).
              2026-11-20 기획자: 「랭킹」 제목 밑에 전투 · 도시화 · 컬렉션 세 줄 */}
          <b className="rk-sum-head" data-field="boardTitle">{t('board.ranking')}</b>
          {RANK_BOARDS.map((b) => <BoardSummary key={b} profile={profile} board={b} ranks={ranks} />)}
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
