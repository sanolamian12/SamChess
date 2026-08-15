/**
 * 메인 — 도시 (pptx 35쪽)
 *
 * ```
 * ┌──────────────────────────┐
 * │ 만민의 삼국지        ⚙   │
 * │ 도시 이름                 │
 * │ [도시 정보]               │
 * │            ┌────┐         │
 * │            │궁궐│         │  ← 배경(시간대) 위에 세 자리가 얹힌다
 * │   ┌────┐   └────┘         │
 * │   │병영│                  │
 * │   └────┘   ┌────┐         │
 * │            │장터│         │
 * └────────────└────┘─────────┘
 * ```
 *
 * 세 자리는 **배경 그림 위에 얹힌 간판**이다. 자리(가로·세로 %)는 기획자 목업의
 * 배치를 그대로 옮겼다 — 지그재그로 놓인 것이 그림의 빈 곳을 피하기 때문이다.
 *
 * 자리를 %로 잡는 이유는 프레임이 320px~700px로 변하기 때문이다. px로 적으면
 * 좁은 화면에서 간판이 서로 겹친다.
 *
 * ────────────────────────────────────────────────────────────────
 * 「AI 대전」은 여기서 병영으로 옮겼다
 * ────────────────────────────────────────────────────────────────
 *
 * 3:3 · 5:5 고르기는 원래 이 화면에 있었는데, 기획자 지정대로 **병영** 안으로
 * 들어갔다(`PlaceScreen`). 도시는 갈림길만 보여주고 하는 일은 각 자리가 맡는다.
 */

import { poolCap, poolUsed, gradeScore } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { clearProfile } from '../meta/storage.ts';
import { currentBand, mainBackdrop, PLACES } from './backdrop.ts';
import type { PlaceId } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { useState } from 'react';

/** 간판이 앉는 자리 — 배경 그림 안에서의 가로·세로 %. 기획자 목업(35쪽) 그대로다. */
const SPOTS: Record<PlaceId, { left: number; top: number }> = {
  palace: { left: 56, top: 33 },
  barracks: { left: 6, top: 54 },
  market: { left: 56, top: 73 },
};

export function MainScreen({ profile, onGo, onReset }: {
  profile: PlayerProfile;
  onGo: (place: PlaceId) => void;
  onReset: () => void;
}): React.JSX.Element {
  useLang();
  const [band] = useState(currentBand);

  return (
    <ScreenChrome backdrop={mainBackdrop(band)} className="scr-main" account={null}>
      <div className="city">
        <h1 className="title">{profile.cityName}</h1>
        <div className="stats">
          <span className="stat"><i>{t('main.cityLevel')}</i><b>Lv{profile.cityLevel}</b></span>
          <span className="stat"><i>{t('main.grain')}</i><b>{profile.grain}</b></span>
          <span className="stat"><i>{t('main.officers')}</i><b>{poolUsed(profile)}/{poolCap(profile)}</b></span>
          <span className="stat"><i>{t('main.gradeScore')}</i><b>{gradeScore(profile)}</b></span>
        </div>
      </div>

      <div className="city-map">
        {PLACES.map((place) => (
          <button
            key={place}
            className="spot"
            data-place={place}
            style={{ left: `${SPOTS[place].left}%`, top: `${SPOTS[place].top}%` }}
            onClick={() => onGo(place)}
          >
            <span className="nm">{t(`place.${place}`)}</span>
            <span className="sub">{t(`place.${place}.sub`)}</span>
          </button>
        ))}
      </div>

      <footer className="foot">
        <button
          className="btn ghost sm"
          onClick={() => {
            if (window.confirm('계정을 지우고 처음부터 시작할까요? 되돌릴 수 없습니다.')) {
              clearProfile();
              onReset();
            }
          }}
        >{t('main.reset')}</button>
      </footer>
    </ScreenChrome>
  );
}
