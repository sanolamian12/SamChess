/**
 * 랭킹 메뉴 — 전투 · 도시화 · 컬렉션 세 분야 (2026-11-20 기획자, 옛 도시 · 부대 · 장수 세 판을 바꿨다).
 *
 * ```
 * ┌ ← 대자보로          랭킹 ─────┐
 * ┌ 위 판 — 내 순위 · 점수 ───────┐
 * │ (승리) 전투   : 3위   1,240 점 │
 * │ (궁궐) 도시화 : 6위     920 점 │
 * │ (관우) 컬렉션 : 2위     250 점 │
 * └─────────────────────────────┘
 *              (게시판 그림)
 * ┌ 명령 판 ─────────────────────┐
 * │ [ 전투 랭킹 ]                  │
 * │ [ 도시화 랭킹 ]                │
 * │ [ 컬렉션 랭킹 ]                │
 * │ [ 뒤로 가기 ]                  │
 * └─────────────────────────────┘
 * ```
 *
 * 궁궐·병영과 같은 「자리 → 그 안의 화면」 한 걸음이다 — 여기서 하나를 고르면 그 분야의 화면(`RankingBoardScreen`)으로
 * 넘어간다. 뒤로가기는 이 메뉴로 돌아오고, 이 메뉴의 뒤로가기만 대자보/궁궐로 나간다(`from`).
 *
 * **점수는 제 프로필로, 순위만 서버에서** (`GET /ranking/mine`). 몇 등인지는 전체를 모아야 알 수 있어서다. 서버가 안
 * 닿으면 순위 칸만 「—위」이고 점수는 그대로 뜬다. 전투는 「전체」(두 모드 공격대의 합)로 잰다. 줄에 안 서는 분야(공격대로
 * 한 판도 안 뜀 · 완성한 컬렉션 없음)는 그 사실을 한 줄로 말한다.
 *
 * 위 판의 줄 꼴(`SummaryLine`)은 대자보(`BoardScreen`)도 그대로 쓴다 — 「이름 : 순위 … 점수」가 두 화면에서 같아야 한다.
 */

import { useEffect, useMemo, useState } from 'react';
import { battleRankRow, cityRankRow, collectionPoints } from '@samchess/meta';
import type { MyRank, MyRanks, PlayerProfile, RankBoard } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { fetchMyRanks } from '../meta/ranking.ts';
import { rankingBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { GAME_ICONS } from '../ui/gameIcon.ts';
import type { GameIconName } from '../ui/gameIcon.ts';
import { RankingLoading, useRankingLoading } from './RankingLoading.tsx';

/** 서버가 준 순위를 글자로 — 없으면(오프라인 · 줄에 안 섬) 숫자 자리만 「—」다(「—위」) */
export const rankText = (r: MyRank | null | undefined): string => t('ranking.sum.rank', { n: r ? r.rank : '—' });

/** 분야마다 아이콘 · 이름 — 위 판의 줄과 아래 단추가 같은 그림이다. 둥근 메달 셋(2026-11-20 기획자) — 전투 = 승리 메달 · 도시화 =
    궁궐 메달 · 컬렉션 = 관우 꼬마 얼굴 메달(`build_icons_composed.py`의 `ic_rec_collection`) */
export const BOARD_ICON: Record<RankBoard, GameIconName> = { battle: 'rec-win', city: 'bld-palace', collection: 'rec-collection' };
export const BOARD_TITLE: Record<RankBoard, StringKey> = {
  battle: 'ranking.tab.battle', city: 'ranking.tab.city', collection: 'ranking.tab.collection',
};
const SUM_TITLE: Record<RankBoard, StringKey> = {
  battle: 'ranking.sum.ttl.battle', city: 'ranking.sum.ttl.city', collection: 'ranking.sum.ttl.collection',
};
const BOARD_ACTION: Record<RankBoard, string> = { battle: 'rankingBattle', city: 'rankingCity', collection: 'rankingCollection' };

/** 내 점수 — 제 프로필로 낸다(서버가 안 닿아도 뜬다). 그 분야 줄에 안 서면 `null` */
export function myScore(profile: PlayerProfile, board: RankBoard): number | null {
  if (board === 'battle') {
    const row = battleRankRow(profile, 'all');
    return row.tally.plays > 0 ? row.total : null;
  }
  if (board === 'city') return cityRankRow(profile).total;
  const n = collectionPoints(profile);
  return n > 0 ? n : null;
}

/** 위 판의 한 분야 줄 — 줄에 안 서면 그 사실을 한 줄로 */
export function BoardSummary({ profile, board, ranks }: {
  profile: PlayerProfile; board: RankBoard; ranks: MyRanks | null;
}): React.JSX.Element {
  const score = myScore(profile, board);
  const empty: Partial<Record<RankBoard, StringKey>> = { battle: 'ranking.mine.none.battle', collection: 'ranking.mine.none.collection' };
  return (
    <SummaryLine board={board} icon={BOARD_ICON[board]} title={SUM_TITLE[board]}
      {...(score === null
        ? { empty: t(empty[board]!) }
        : { rank: rankText(ranks?.[board]), total: t('ranking.sum.total', { total: score.toLocaleString() }) })} />
  );
}

export function RankingScreen({ profile, from, onBack, onBoard }: {
  profile: PlayerProfile;
  /** 「뒤로」 글자와 목적지 — 궁궐(도시 관리)에서 왔으면 「도시 관리로」, 메인에서
      대자보를 지나 왔으면 「대자보로」다. */
  from: 'city' | 'main';
  onBack: () => void;
  onBoard: (board: RankBoard) => void;
}): React.JSX.Element {
  useLang();
  const [ranks, setRanks] = useState<MyRanks | null>(null);
  /** 서버 답(성공이든 실패든)이 왔는가 — 그때까지 전용 로딩 화면이 덮는다(`RankingLoading.tsx`) */
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
  const backLabel = stripBackArrow(t(from === 'main' ? 'board.back' : 'city.records.back'));
  const boards = useMemo((): RankBoard[] => ['battle', 'city', 'collection'], []);

  return (
    <ScreenChrome
      backdrop={rankingBackdrop(profile.cityLevel)}
      className="scr-ranking scr-ranking-menu"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="ranking">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {backLabel}
        </button>
        <span className="place-nm">{t('board.ranking')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel rk-summary" data-field="mine">
          {boards.map((b) => <BoardSummary key={b} profile={profile} board={b} ranks={ranks} />)}
        </section>

        <section className="place-panel rk-menu">
          {boards.map((b) => (
            <button key={b} className="btn wide" data-action={BOARD_ACTION[b]} onClick={() => onBoard(b)}>
              <img className="rk-tab-icon" src={GAME_ICONS[BOARD_ICON[b]]} alt="" />
              <span className="lbl">{t(BOARD_TITLE[b])}</span>
            </button>
          ))}
          {/* 세 단추 밑에 [뒤로 가기] (2026-11-20 기획자) — 위 띠의 「← 대자보로」와 같은 곳으로 나간다 */}
          <button className="btn wide" data-action="backRanking" onClick={onBack}>
            <span className="lbl">{stripBackArrow(t('match.back'))}</span>
          </button>
        </section>
      </div>
      {veil && <RankingLoading title={t('board.ranking')} backLabel={backLabel} onBack={onBack} />}
    </ScreenChrome>
  );
}

/**
 * 요약 한 줄 — [아이콘] 「○○ :」 | 순위 + 이름 | 점수 (줄 전체 5 : 2).
 * 줄 자신은 칸을 안 만든다(`display: contents`) — 판(`.rk-summary`)의 그리드 칸에
 * 자식 넷이 그대로 앉아야 세 줄의 경계가 한 세로선에 맞는다.
 * 아직 없으면(`empty`) 안내문이 순위·점수 두 칸을 다 쓴다.
 */
export function SummaryLine({ board, icon, title, rank, name, total, empty }: {
  board: RankBoard;
  icon: GameIconName;
  title: StringKey;
  rank?: string;
  name?: string;
  total?: string;
  empty?: string;
}): React.JSX.Element {
  return (
    <div className="rk-sum-line" data-mine={board}>
      <span className="rk-sum-icon">
        <img src={GAME_ICONS[icon]} alt="" />
      </span>
      <b className="rk-sum-ttl">{t('ranking.sum.head', { title: t(title) })}</b>
      {empty !== undefined ? (
        <span className="rk-sum-empty">{empty}</span>
      ) : (
        <>
          <span className="rk-sum-val">
            <span className="rk-sum-rank" data-field="rank">{rank}</span>
            {name && <span className="rk-sum-name">{name}</span>}
          </span>
          <span className="rk-sum-total" data-field="total">{total}</span>
        </>
      )}
    </div>
  );
}
