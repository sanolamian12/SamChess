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
 */

import type { PlayerProfile } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { rankingBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

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
  return (
    <ScreenChrome
      backdrop={rankingBackdrop(profile.cityLevel)}
      className="scr-ranking"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="ranking">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {t(from === 'main' ? 'place.back' : 'city.records.back')}
        </button>
        <span className="place-nm">{t('main.ranking')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel">
          <button className="btn wide" data-action="rankingCity" onClick={onCity}>
            <span className="lbl">{t('ranking.tab.city')}</span>
          </button>
          <button className="btn wide" data-action="rankingSquad" onClick={onSquad}>
            <span className="lbl">{t('ranking.tab.squad')}</span>
          </button>
          <button className="btn wide" data-action="rankingOfficer" onClick={onOfficer}>
            <span className="lbl">{t('ranking.tab.officer')}</span>
          </button>
        </section>
      </div>
    </ScreenChrome>
  );
}
