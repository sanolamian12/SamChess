/**
 * 확장 도시(산 너머) 건물 넷의 내부 화면 — 태학 · 농지 · 병원 · 대장간 (트랙 11h).
 *
 * 지금까지는 `MainScreen`의 산 너머 핫스팟을 눌러도 갈 화면이 없어 「아직」
 * 알림만 떴다(2026-09-07 확인, HANDOFF §7 11h). 이 화면이 그 자리를 채운다 —
 * 다만 **대장간을 뺀 셋은 그림과 현황만**이다. 태학의 훈련 화면, 병원의 치료
 * (부상 목록·치료·room 상태)는 여전히 GDD §12 「미해결」이다(사양부터 필요하다).
 *
 * **대장간만은 `ForgeScreen`으로 위임한다**(2026-09-09) — 제조·지급 관리가
 * 자리표시자 한 줄로는 안 되는 자기 상태(제조 큐, 장수 선택 모달)를 가지므로,
 * 이 화면의 얇은 틀 안에 억지로 끼워 넣지 않는다.
 *
 * 현황 한 줄(`buildingStatusText`)과 소개 한 줄(`buildingDescText`)은
 * `CityScreen`·`MainScreen`의 산 너머 이름표가 이미 쓰는 자리
 * (`buildingText.ts`) 그대로 가져다 쓴다 — 같은 건물을 세 화면이 각자
 * 조립하면 하나가 낡는다.
 */

import { buildingRows } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import type { ExtBuildingId } from './backdrop.ts';
import { buildingBackdrop } from './backdrop.ts';
import { buildingDescText, buildingStatusText } from './buildingText.ts';
import { ForgeScreen } from './ForgeScreen.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

export function BuildingScreen({ profile, building, onBack, onChange }: {
  profile: PlayerProfile;
  building: ExtBuildingId;
  onBack: () => void;
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  const row = buildingRows(profile).find((r) => r.id === building);
  const built = (row?.level ?? 0) > 0;

  if (building === 'forge') {
    return <ForgeScreen profile={profile} onBack={onBack} onChange={onChange} />;
  }

  return (
    <ScreenChrome
      backdrop={buildingBackdrop(building)}
      className={`scr-place scr-building-${building}`}
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {t('place.back')}
        </button>
        <span className="place-nm">{t(`place.${building}` as StringKey)}</span>
      </div>

      <div className="place-body">
        <section className="place-panel">
          <p className="hint" data-field="desc">{buildingDescText(building)}</p>
          {/* 안 지었어도 낸다 — 농지처럼 「없어도 값을 내는」 건물이 있고,
              값이 없는 건물(대장간)은 늘 같은 소개를 낸다(`buildingText.ts`) */}
          {row && <p className="hint" data-field="status">{buildingStatusText(profile, row)}</p>}
          {!built && <p className="hint" data-field="notBuilt">{t('place.soon')}</p>}
        </section>
      </div>
    </ScreenChrome>
  );
}
