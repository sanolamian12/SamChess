/**
 * 도시 전적 (pptx 41쪽 오른쪽)
 *
 * ```
 * [← 도시 관리로]          도시 전적
 *  도시 이름
 *  [전체] [온라인] [AI]
 *  3v3      12전 · 7승 1무 4패 · 적격파 19
 *  5v5       3전 · 2승 0무 1패 · 적격파  5
 *  총 출전   15전 · 9승 1무 5패 · 적격파 24
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 도시 전적은 **장수 전적의 합이 아니다** ★
 * ────────────────────────────────────────────────────────────────
 *
 * 한 판에 3~5명이 함께 뛰므로 장수 전적을 더하면 출전 수가 **사람 수만큼 부푼다.**
 * 그래서 C1이 계정 칸(`PlayerProfile.record`)을 따로 세어 뒀고, 여기는 그것을 읽기만
 * 한다 — `accountTally()` · `accountModeRows()` 둘뿐이다. 「40쪽의 총합과 왜 다른가」로
 * 보일 수 있으나 **판수와 인원수는 다른 것**이고, `records.test.ts`가 그 차이를 고정한다.
 *
 * 41쪽 목업 글자는 「온라인 대전」 하나지만, **AI도 세기로 뒤집혔다**(2026-08-18 §5-31).
 * 40쪽과 같은 세 갈래 필터를 그대로 단다 — 세지 않는 대신 갈라 본다.
 */

import { useState } from 'react';
import { RECORD_FILTERS, accountModeRows, accountTally } from '@samchess/meta';
import type { PlayerProfile, RecordFilter, RecordTally } from '@samchess/meta';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

const FILTER_KEY: Record<RecordFilter, 'records.filter.all' | 'records.filter.online' | 'records.filter.ai'> = {
  all: 'records.filter.all', online: 'records.filter.online', ai: 'records.filter.ai',
};

export function CityRecordsScreen({ profile, onBack }: {
  profile: PlayerProfile;
  onBack: () => void;
}): React.JSX.Element {
  useLang();
  const [filter, setFilter] = useState<RecordFilter>('all');

  const modes = accountModeRows(profile, filter);
  const total = accountTally(profile, filter);

  return (
    <ScreenChrome
      backdrop={placeBackdrop('palace', profile.cityLevel)}
      className="scr-cityrec"
      account={null}
    >
      <div className="place-bar" data-screen="cityRecords" data-filter={filter}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('city.records.back')}</button>
        <span className="place-nm">{t('city.records')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel cty-info">
          <h2 className="cap" data-field="cityName">{profile.cityName}</h2>

          <div className="ofc-sorts rec-filters">
            {RECORD_FILTERS.map((f) => (
              <button
                key={f}
                className={`opt${filter === f ? ' on' : ''}`}
                data-record-filter={f}
                data-on={filter === f ? '1' : '0'}
                onClick={() => setFilter(f)}
              >
                {t(FILTER_KEY[f])}
              </button>
            ))}
          </div>

          {/* 모드별 두 줄 · 총합 한 줄. **총합은 모드별의 합과 언제나 같다** —
              따로 세지 않고 `sumTally()` 하나가 낸다 (40쪽과 같은 자리) */}
          <div className="rec-sums cty-sums">
            {modes.map(({ mode, tally }) => (
              <p key={mode} className="rec-sum" data-sum={mode}>
                <span className="k">{mode}</span>{sumText(tally)}
              </p>
            ))}
            <p className="rec-sum" data-sum="total">
              <span className="k">{t('records.total')}</span>{sumText(total)}
            </p>
          </div>

          <p className="note" data-field="note">{t('city.records.note')}</p>
        </section>
      </div>
    </ScreenChrome>
  );
}

/** 「12전 · 7승 1무 4패 · 적격파 19」 — 40쪽과 같은 문구를 쓴다 */
const sumText = (tally: RecordTally): string => t('records.sum', {
  plays: tally.plays, w: tally.wins, d: tally.draws, l: tally.losses, k: tally.kills,
});
