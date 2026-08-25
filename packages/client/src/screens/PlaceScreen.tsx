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
 * | **병영** | 42·45쪽의 셋 — `[부대 편성]` · `[출정하기]` · `[튜토리얼 시나리오]`(잠김) |
 * | **궁궐** | 장수 일람(37~40쪽)과 도시 관리(41쪽) 두 갈래 |
 * | **장터** | 아직 없다. 상점·가챠가 붙을 자리다 |
 *
 * ────────────────────────────────────────────────────────────────
 * 문이 하나로 합쳐졌다 ★ (F · 45쪽 · §5-32)
 * ────────────────────────────────────────────────────────────────
 *
 * 예전에는 병영에 `3:3` · `5:5` 두 단추가 있었고 그것이 곧 「AI 대전」이었다.
 * 45쪽의 출전지 셋(`AI 연습 대전` · `온라인 실전` · `튜토리얼 시나리오`) 중
 * **앞의 둘이 [출정하기] 하나로 합쳐졌으므로**(상대가 사람인지 AI인지는 고르는 것이
 * 아니라 그때의 운이다) 출전지 화면은 **살아 있는 단추가 하나뿐**이 된다 —
 * 그런 화면은 §5-20의 「자리만 만든 것」이라 두지 않고, 셋을 병영에 그대로 편다.
 *
 * 참여 인원(3v3·5v5)은 [출정하기] 안의 첫 걸음으로 내려갔다 (45쪽 「구성을 선택해주세요.」).
 */

import type { PlayerProfile } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import type { PlaceId } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

export function PlaceScreen({ profile, place, onBack, onSortie, onSquads, onOfficers, onCity, onMarket }: {
  profile: PlayerProfile;
  place: PlaceId;
  onBack: () => void;
  onSortie: () => void;
  onSquads: () => void;
  onOfficers: () => void;
  onCity: () => void;
  onMarket: () => void;
}): React.JSX.Element {
  useLang();
  // 자리 그림은 **시간대를 타지 않는다** — 원본이 자리별로만 그려져 있다.
  return (
    <ScreenChrome
      backdrop={placeBackdrop(place, profile.cityLevel)}
      className={`scr-place scr-place-${place}`}
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('place.back')}</button>
        <span className="place-nm">{t(`place.${place}`)}</span>
      </div>

      <div className="place-body">
        {place === 'barracks' && <Barracks onSortie={onSortie} onSquads={onSquads} />}
        {place === 'palace' && (
          /* 37쪽의 두 갈래. **[도시 관리]는 C2(41쪽)가 열었다** — 잠겨 있던 동안
             「아직 열리지 않았다」를 달아 둔 것이 「눌리는데 아무 일도 없으면
             「고장인가」가 남는다」에 대한 처리였다. */
          <section className="place-panel">
            <button className="btn wide" data-action="officers" onClick={onOfficers}>
              <span className="lbl">{t('palace.officers')}</span>
              <span className="sub">{t('palace.officers.sub')}</span>
            </button>
            <button className="btn wide" data-action="city" onClick={onCity}>
              <span className="lbl">{t('palace.city')}</span>
              <span className="sub">{t('palace.city.sub')}</span>
            </button>
          </section>
        )}
        {place === 'market' && (
          /* 42쪽처럼 「자리 → 그 안의 화면」 한 걸음이다 — 가챠 하나뿐이라도
             지금까지의 결(궁궐·병영)을 그대로 따른다. 골드 충전·카드 정리는
             아직 결정 안 됐으므로 이름을 미리 붙이지 않는다(§5-20). */
          <section className="place-panel">
            <button className="btn wide" data-action="gacha" onClick={onMarket}>
              <span className="lbl">{t('place.gacha')}</span>
              <span className="sub">{t('place.gacha.sub')}</span>
            </button>
          </section>
        )}
      </div>
    </ScreenChrome>
  );
}

/**
 * 병영 — 42·45쪽의 셋.
 *
 * **[출정하기]는 잠그지 않는다.** 잠기는 이유가 둘이라(군량 부족 · 장수 부족) 여기서
 * 막으면 「3v3은 되는데 5v5는 안 된다」를 말할 자리가 없다 — 그 판정은 안쪽의
 * 「구성을 선택해주세요.」가 모드마다 글자로 말한다(`SortieScreen`).
 *
 * **튜토리얼은 잠긴 채로 왜인지 적는다** (G3 · §5-20). 자리만 두고 아무 말이 없으면
 * 「눌리는데 아무 일도 없으면 「고장인가」가 남는다」에 걸린다.
 */
function Barracks({ onSortie, onSquads }: {
  onSortie: () => void;
  onSquads: () => void;
}): React.JSX.Element {
  return (
    <section className="place-panel">
      <button className="btn wide" data-action="squads" onClick={onSquads}>
        <span className="lbl">{t('barracks.squads')}</span>
        <span className="sub">{t('barracks.squads.sub')}</span>
      </button>

      <button className="btn wide primary" data-action="sortie" onClick={onSortie}>
        <span className="lbl">{t('barracks.sortie')}</span>
        <span className="sub">{t('barracks.sortie.sub')}</span>
      </button>
      {/* 안내문은 **제 단추 바로 밑에** 둔다 — 끝에 몰아 두면 어느 단추 이야기인지 모른다.
          보상도 전적도 온라인과 같다 (GDD §6.4 · §5-30) */}
      <p className="hint">{t('barracks.aiNote')}</p>

      <button className="btn wide" data-action="tutorial" disabled>
        <span className="lbl">{t('barracks.tutorial')}</span>
        <span className="sub">{t('barracks.tutorial.sub')}</span>
      </button>
      <p className="hint" data-field="tutorialWhy">{t('place.soon')}</p>
    </section>
  );
}
