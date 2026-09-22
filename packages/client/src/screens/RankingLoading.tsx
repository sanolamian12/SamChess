/**
 * 랭킹 화면의 전용 로딩 화면 (2026-09-22).
 *
 * 랭킹은 들어가는 순간 서버를 부른다 — 메뉴는 `GET /ranking/mine`(내 순위 셋), 세 판은
 * `GET /ranking`(상위 목록). 그동안 화면은 이미 그려져 있는데 순위 칸은 「—위」, 표는
 * 비어 있다가 **한 박자 늦게 툭 채워져** 「덜 그려진 화면」으로 읽혔다. 그래서 첫 응답이
 * 올 때까지 화면 전체를 이 판으로 덮는다.
 *
 * 규약 넷 — `BusyVeil`(서버 왕복 가리개)과 같은 생각이고, 다른 점만 적는다.
 *
 * 1. **첫 응답까지만 덮는다.** 필터·검색으로 다시 부를 때는 표가 이미 있으므로 덮지 않고
 *    표만 옅어진다(`.rk-table-wrap[data-loading]`). 검색마다 화면이 통째로 가려지면 그게
 *    더 고장처럼 보인다.
 * 2. **뜸을 들여 나타나고, 한 번 뜨면 잠깐은 머문다** — `useRankingLoading()`. 왕복이
 *    수십 ms면 아예 안 보이고, 180ms를 넘겨 떴으면 적어도 450ms는 남는다. 뜨자마자
 *    사라지면 번쩍임만 남는다.
 * 3. **가두지 않는다** — `BusyVeil`은 입력을 막지만 이 판에는 [뒤로]가 있다. 서버가
 *    멈추면 사람이 여기 갇히는데, 랭킹은 기다리지 않아도 잃는 것이 없는 화면이다.
 * 4. **실패해도 걷힌다** — 응답이 오든 오류든 「끝났다」면 판은 물러나고, 순위 「—」·
 *    「불러오지 못했다」 안내는 원래 화면이 그대로 말한다.
 *
 * 그림은 새 에셋 없이 이미 있는 것을 쌓았다 — 「기다린다」는 옻칠 판(`panel-busy`)과
 * 금빛 원반(`.busy-spin`), 「랭킹」은 1·2·3위 메달(`icons/medal-*.png`, 표의 순위
 * 칸과 같은 그림)이 시상대처럼 차례로 오른다.
 */

import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';

/** 이만큼 지나도 안 끝나면 그때 보인다 — `BusyVeil`의 `SHOW_AFTER_MS`와 같은 값 */
const SHOW_AFTER_MS = 180;
/** 한 번 떴으면 적어도 이만큼은 머문다 */
const MIN_SHOW_MS = 450;

/** 기다리는 중(`waiting`)을 「지금 로딩 화면을 보여야 하는가」로 바꾼다 — 규약 2 */
export function useRankingLoading(waiting: boolean): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (waiting) {
      if (shown) return;
      const id = setTimeout(() => { shownAt.current = performance.now(); setShown(true); }, SHOW_AFTER_MS);
      return () => clearTimeout(id);
    }
    if (!shown) return;
    const left = MIN_SHOW_MS - (performance.now() - shownAt.current);
    if (left <= 0) { setShown(false); return; }
    const id = setTimeout(() => setShown(false), left);
    return () => clearTimeout(id);
  }, [waiting, shown]);

  return shown;
}

const MEDALS = ['medal-silver', 'medal-gold', 'medal-bronze'] as const;

export function RankingLoading({ title, backLabel, onBack }: {
  /** 어느 판을 기다리는가 — 화면 제목과 같은 글자 */
  title: string;
  backLabel: string;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <div className="rk-loading" data-modal="rankingLoading" role="status" aria-live="polite">
      <div className="rk-loading-box">
        <p className="rk-loading-ttl">{title}</p>
        {/* 시상대 — 2위·1위·3위 순으로 서고, 1위가 가운데에서 가장 높다 */}
        <div className="rk-loading-podium" aria-hidden="true">
          {MEDALS.map((m, i) => (
            <span key={m} className="rk-loading-step" data-place={m} style={{ animationDelay: `${i * 0.18}s` }}>
              <img src={`icons/${m}.png`} alt="" />
            </span>
          ))}
        </div>
        <div className="rk-loading-msg">
          <span className="busy-spin" aria-hidden="true" />
          <span className="busy-lbl">{t('ranking.loading')}</span>
        </div>
      </div>
      <button className="btn ghost sm rk-loading-back" data-action="rankingLoadingBack" onClick={onBack}>{backLabel}</button>
    </div>
  );
}
