/**
 * 랭킹 메뉴 (pptx 50쪽 왼쪽) — [도시 랭킹] / [부대 랭킹] / [장수 랭킹] 세 자리.
 *
 * 궁궐·병영과 같은 「자리 → 그 안의 화면」 한 걸음이다(`PlaceScreen.tsx`와 같은
 * 결) — 세 판을 한 화면에 탭으로 몰아넣지 않고, 50쪽 목업 그대로 **여기서 하나를
 * 고르면 그 판의 화면으로 넘어간다.** 뒤로가기는 이 메뉴로 돌아오고, 이 메뉴의
 * 뒤로가기만 메인/궁궐로 나간다(`from`).
 *
 * 배경은 게시판 그림(`rankingBackdrop`) — 도시 전적이 이 그림 위에 있던 자리
 * 그대로다(2026-08-25).
 *
 * ────────────────────────────────────────────────────────────────
 * 위쪽은 「우리 도시」 요약 세 줄 (2026-09-18 지정)
 * ────────────────────────────────────────────────────────────────
 *
 * 세 판 화면의 바닥에 있던 「내 도시 / 내 부대(상위 3) / 내 장수(상위 3)」를
 * 이리로 옮기고 **한 줄씩으로 줄였다** — 세 판 화면의 그 자리엔 [뒤로 가기]
 * 명령 판이 선다(`RankingBackPanel`).
 *
 * ```
 * [성문] 도시 : 3위                  17 점
 * [깃발] 부대 : 2위   선봉대         15 점
 * [투구] 장수 : 5위   조운            9 점
 * └─────────── 5 ───────────┘   └─ 2 ─┘
 * ```
 *
 * 줄 전체가 **가로 5 : 2**(아이콘·제목·순위·이름 : 점수)이고 세 줄이 같은 칸을 쓴다
 * (판 전체가 한 그리드, 줄은 `display: contents`). 글자는 **짧게** — 「도시 랭킹」
 * 「도시 총점」이 아니라 「도시」「점수」다(2026-09-18 지정). 외국어에서 「랭킹」
 * 「총점」까지 붙이면 칸이 모자라 줄마다 접혔다. 점수는 「17 점」으로 오른쪽 끝에
 * 붙인다. 아이콘은 아래 세 단추의 것과 같은 그림을
 * **검정 바탕 → 금테(`ui/stat-frame.png`) → 아이콘** 순으로 겹쳐 띄운다 — 액자
 * 안에 담는 게 아니라 셋을 쌓는다(2026-09-18 지정). 표·[구성 보기]·[보기]는
 * 없다 — 자세히는 단추 너머의 판에서 본다.
 *
 * **이름·총점은 제 프로필로, 순위만 서버에서** (`GET /ranking/mine`). 몇 등인지는
 * 전체를 모아야 알 수 있어서다. 서버가 안 닿으면 순위 칸만 「—」이고 나머지는
 * 그대로 뜬다. 서버가 가리킨 부대·장수가 화면이 고른 것과 다르면(그 사이 전적이
 * 바뀌었다) 그 순위는 **안 쓴다** — 남의 순위를 붙여 보여 주느니 「—」가 낫다.
 *
 * 모드·상대 필터는 없다 — 세 판 화면이 처음 열릴 때의 값(**3 vs 3 · 전체 ·
 * 총점 순**)으로 잰다.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  cityRankRow, officerRankRows, sortOfficerRows, sortSquadRows, squadRankRows,
} from '@samchess/meta';
import type { MyRank, MyRanks, PlayerProfile, RecordFilter } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { fetchMyRanks } from '../meta/ranking.ts';
import { rankingBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

/** 세 판 화면이 처음 열릴 때의 값과 같다 */
const MODE: BattleMode = '3v3';
const FILTER: RecordFilter = 'all';

/** 서버가 준 순위를 글자로 — 없거나(오프라인) **다른 것을 가리키면** 숫자 자리만
    「—」다(「—위」 — 무엇을 적는 칸인지는 남긴다, 2026-09-18 지정) */
const rankText = (r: MyRank | null | undefined, id?: string): string =>
  t('ranking.sum.rank', { n: r && (id === undefined || r.id === id) ? r.rank : '—' });

export function RankingScreen({ profile, from, onBack, onCity, onSquad, onOfficer }: {
  profile: PlayerProfile;
  /** 「뒤로」 글자와 목적지 — 궁궐(도시 관리)에서 왔으면 「도시 관리로」, 메인의
      랭킹 자리에서 왔으면 「도시로」다(2026-08-25 세 번째 리디자인의 관례 그대로). */
  from: 'city' | 'main';
  onBack: () => void;
  onCity: () => void;
  onSquad: () => void;
  onOfficer: () => void;
}): React.JSX.Element {
  useLang();
  const [ranks, setRanks] = useState<MyRanks | null>(null);
  useEffect(() => {
    let live = true;
    fetchMyRanks(FILTER, MODE).then((r) => { if (live) setRanks(r); }).catch(() => { /* 순위만 「—」 */ });
    return () => { live = false; };
  }, []);

  const city = useMemo(() => cityRankRow(profile, FILTER, MODE), [profile]);
  const squad = useMemo(() => sortSquadRows(squadRankRows(profile, FILTER, MODE), 'total')[0], [profile]);
  const officer = useMemo(() => sortOfficerRows(officerRankRows(profile, FILTER, MODE), 'total')[0], [profile]);

  return (
    <ScreenChrome
      backdrop={rankingBackdrop(profile.cityLevel)}
      className="scr-ranking scr-ranking-menu"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="ranking">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t(from === 'main' ? 'place.back' : 'city.records.back'))}
        </button>
        <span className="place-nm">{t('main.ranking')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel rk-summary" data-field="mine">
          <SummaryLine board="city" icon="tab-city" title="ranking.sum.ttl.city"
            rank={rankText(ranks?.city)} total={t('ranking.sum.total', { total: city.total })} />
          <SummaryLine board="squad" icon="tab-squad" title="ranking.sum.ttl.squad"
            {...(squad
              ? {
                rank: rankText(ranks?.squad, squad.squad.id), name: squad.squad.name,
                total: t('ranking.sum.total', { total: squad.total }),
              }
              : { empty: t('ranking.mine.empty.squad') })} />
          <SummaryLine board="officer" icon="tab-officer" title="ranking.sum.ttl.officer"
            {...(officer
              ? {
                rank: rankText(ranks?.officer, officer.officer),
                name: pickOfficerNameById(officer.officer, officer.name),
                total: t('ranking.sum.total', { total: officer.total }),
              }
              : { empty: t('ranking.mine.empty.officer') })} />
        </section>

        <section className="place-panel rk-menu">
          <button className="btn wide" data-action="rankingCity" onClick={onCity}>
            <img className="rk-tab-icon" src="icons/tab-city.png" alt="" />
            <span className="lbl">{t('ranking.tab.city')}</span>
          </button>
          <button className="btn wide" data-action="rankingSquad" onClick={onSquad}>
            <img className="rk-tab-icon" src="icons/tab-squad.png" alt="" />
            <span className="lbl">{t('ranking.tab.squad')}</span>
          </button>
          <button className="btn wide" data-action="rankingOfficer" onClick={onOfficer}>
            <img className="rk-tab-icon" src="icons/tab-officer.png" alt="" />
            <span className="lbl">{t('ranking.tab.officer')}</span>
          </button>
        </section>
      </div>
    </ScreenChrome>
  );
}

/**
 * 요약 한 줄 — [아이콘] 「○○ :」 | 순위 + 이름 | 점수 (줄 전체 5 : 2).
 * 줄 자신은 칸을 안 만든다(`display: contents`) — 판(`.rk-summary`)의 그리드 칸에
 * 자식 넷이 그대로 앉아야 세 줄의 3 : 1 경계가 한 세로선에 맞는다.
 * 아직 없으면(`empty`) 안내문이 순위·총점 두 칸을 다 쓴다.
 */
function SummaryLine({ board, icon, title, rank, name, total, empty }: {
  board: 'city' | 'squad' | 'officer';
  icon: string;
  title: StringKey;
  rank?: string;
  name?: string;
  total?: string;
  empty?: string;
}): React.JSX.Element {
  return (
    <div className="rk-sum-line" data-mine={board}>
      <span className="rk-sum-icon">
        <img src={`icons/${icon}.png`} alt="" />
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
