/**
 * 궁궐 · 병영 · 장터 — 도시 안의 자리 (pptx 35·36쪽)
 *
 * 배경은 도시 레벨에 따라 갈린다 — `1~4`는 `eachBackground.png`, `5` 이상은
 * `eachBackground2.png`(기획자 지정). 나중에 레벨마다 더 잘게 나눌 예정이라
 * 그 경계는 `backdrop.ts`의 `placeTier()` 하나가 정한다.
 *
 * ────────────────────────────────────────────────────────────────
 * 세 자리가 지금 어디까지 이어지는가
 * ────────────────────────────────────────────────────────────────
 *
 * | 자리 | 지금 |
 * |---|---|
 * | **병영** | 지금까지 만든 전투 길의 입구 — `3:3 · 5:5` → 편성 → 전투 |
 * | **궁궐** | 장수 관리(정보·레벨업). pptx 37~41쪽의 「장수 일람」이 여기 들어온다 |
 * | **장터** | 아직 없다. 상점·가챠가 붙을 자리다 |
 *
 * 기획상 병영은 「한두 걸음 더 들어가서」 나오는 화면이지만, 그 사이 화면이 아직
 * 없으므로 **지금은 병영을 누르면 곧바로 대전 규모 고르기**로 간다(기획자 지정).
 * 사이 화면이 생기면 이 파일의 병영 칸만 바뀐다.
 */

import { grainCost, poolUsed } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { placeBackdrop } from './backdrop.ts';
import type { PlaceId } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

const MODES: BattleMode[] = ['3v3', '5v5'];

export function PlaceScreen({ profile, place, onBack, onRoster, onOfficers }: {
  profile: PlayerProfile;
  place: PlaceId;
  onBack: () => void;
  onRoster: (mode: BattleMode) => void;
  onOfficers: () => void;
}): React.JSX.Element {
  useLang();
  // 자리 그림은 **시간대를 타지 않는다** — 원본이 자리별로만 그려져 있다.
  return (
    <ScreenChrome
      backdrop={placeBackdrop(place, profile.cityLevel)}
      className={`scr-place scr-place-${place}`}
      account={null}
    >
      <div className="place-bar">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('place.back')}</button>
        <span className="place-nm">{t(`place.${place}`)}</span>
      </div>

      <div className="place-body">
        {place === 'barracks' && <Barracks profile={profile} onRoster={onRoster} />}
        {place === 'palace' && (
          <section className="place-panel">
            <button className="btn wide" data-action="officers" onClick={onOfficers}>
              <span className="lbl">{t('palace.officers')}</span>
              <span className="sub">{t('palace.officers.sub')}</span>
            </button>
          </section>
        )}
        {place === 'market' && (
          <section className="place-panel">
            <p className="hint">{t('place.soon')}</p>
          </section>
        )}
      </div>
    </ScreenChrome>
  );
}

/**
 * 병영 — AI 대전 규모 고르기.
 *
 * 잠기는 이유가 둘이라(군량 부족 · 장수 부족) **어느 쪽인지 글자로 말해 준다.**
 * 잠긴 버튼만 두면 「왜 안 눌리나」가 남는다. 판정은 `@samchess/meta`가 한다.
 */
function Barracks({ profile, onRoster }: {
  profile: PlayerProfile;
  onRoster: (mode: BattleMode) => void;
}): React.JSX.Element {
  return (
    <section className="place-panel">
      <h2 className="cap">{t('barracks.aiTitle')}</h2>
      {MODES.map((mode) => {
        const cost = grainCost(mode);
        const poor = profile.grain < cost;
        const short = poolUsed(profile) < cost;
        return (
          <button
            key={mode}
            className="btn wide"
            data-mode={mode}
            disabled={poor || short}
            onClick={() => onRoster(mode)}
          >
            <span className="lbl">{mode}</span>
            <span className="sub">
              {short
                ? t('barracks.needOfficers', { n: cost })
                : poor
                  ? t('barracks.shortGrain', { n: cost, have: profile.grain })
                  : t('barracks.needGrain', { n: cost })}
            </span>
          </button>
        );
      })}
      {/* AI 대전은 군량만 준다 — 카드는 온라인·상점에서만 (GDD §6.4, 2026-08-04 확정) */}
      <p className="hint">{t('barracks.aiNote')}</p>
    </section>
  );
}
