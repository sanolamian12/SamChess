/**
 * 부대 현황 — 읽기 전용 (pptx 67쪽, 2026-09-17)
 *
 * ```
 * [← 목록으로]        부대 현황
 * ┌ 판 ─────────────────────────────────────────────┐
 * │ 초전박살 (3vs3) – 전투력 : 811 점                  │
 * │ King   [사진] [S] 가후   Lv1   건강   대감도       │
 * │ Rock   [사진] [S] 서황   Lv5   부상   없음         │
 * │ Queen  [사진] [S] 감녕   Lv1   건강   없음         │
 * │  ·                                               │  ← 3v3은 두 줄이 비어 보인다
 * │  ·                                               │
 * └─────────────────────────────────────────────────┘
 * [ 부대 관리 ]   ← 초록
 * [ 부대 삭제 ]   ← 빨강
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 여기서는 아무것도 안 고친다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 예전 편성 화면(`SquadEditScreen`)은 기물 토글·장수 표·전투력·배치 단추가 한
 * 화면에 있었다. 67·68쪽이 그것을 **보기 / 부대원 / 배치** 셋으로 갈랐다 — 고치는
 * 길은 [부대 관리] 하나이고, 그 길이 **반드시 배치 확인을 지나 저장된다**
 * (`SquadMembersScreen` 머리말). 여기서 기물을 바꿀 수 있으면 배치를 안 본 채
 * 저장되는 옛 길이 되살아난다.
 *
 * **판 높이는 다섯 줄로 고정한다**(67쪽) — 3v3과 5v5가 같은 자리에 같은 크기로
 * 서야 화면을 오갈 때 판이 들썩이지 않는다.
 *
 * 줄의 상태·병기는 **규칙이 낸다** — 부상은 `isInjured()`(낫는 시각이 지났는데
 * 필드가 남은 경우를 거기서 거른다), 병기는 `equippedBy()`. 등급 배지와 `Lv` 표기는
 * 장수 일람(`OfficerListScreen`)과 같은 모양이다(67쪽 「마크 통일」).
 */

import { useState } from 'react';
import { officerById } from '@samchess/data';
import { equippedBy, isInjured, squadPower, teamSize } from '@samchess/meta';
import type { PlayerProfile, Squad } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { ItemThumb } from './EquipThumb.tsx';
import { OfficerArt } from './OfficerArt.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickEquipName, pickOfficerName } from '../i18n/story.ts';
import { GradeBadge } from './GradeBadge.tsx';

/** 판이 늘 품는 줄 수 — 5v5의 정원. 3v3은 남는 줄을 비워 그린다 */
export const SQUAD_ROWS = 5;

export const modeText = (mode: Squad['mode']): string => (mode === '3v3' ? '3vs3' : '5vs5');

export function SquadViewScreen({ profile, squad, onBack, onManage, onDelete }: {
  profile: PlayerProfile;
  squad: Squad;
  onBack: () => void;
  onManage: () => void;
  onDelete: (id: string) => void;
}): React.JSX.Element {
  useLang();
  const [asking, setAsking] = useState(false);

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squad-edit scr-squad-view"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="squadView" data-squad={squad.id} data-mode={squad.mode}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('squad.cancel'))}
        </button>
        <span className="place-nm">{t('squad.view.title')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel sqv-panel">
          <SquadRoster profile={profile} squad={squad} />
        </section>

        <section className="place-panel sqd-acts">
          <button className="btn primary wide" data-action="manage" onClick={onManage}>
            {t('squad.view.manage')}
          </button>
          <button className="btn wide sqd-del" data-action="delete" onClick={() => setAsking(true)}>
            {t('squads.delete')}
          </button>
        </section>
      </div>

      {asking && (
        <div className="modal-back" data-modal="squadDelete" onClick={() => setAsking(false)}>
          <div className="modal sqd-modal" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t('squads.delete.title')}</p>
            <p className="row" data-field="what">{t('squads.delete.what', { name: squad.name })}</p>
            <div className="sqd-acts">
              <button className="btn primary wide" data-action="deleteConfirm" onClick={() => { setAsking(false); onDelete(squad.id); }}>
                {t('squads.delete.ok')}
              </button>
              <button className="btn wide" data-action="deleteCancel" onClick={() => setAsking(false)}>
                {t('squads.delete.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ScreenChrome>
  );
}

/**
 * 부대 현황 **판의 속** — 제목 줄 + 열 제목 + 다섯 줄 (2026-09-18에 떼어 냈다).
 *
 * 출정하기의 부대 목록에서 한 줄을 누르면 **같은 표가 팝업으로** 뜬다
 * (`SortieScreen`의 `SquadPeekModal`). 거기서 다시 적으면 열 하나가 늘거나
 * 상태 판정이 바뀔 때 **한쪽만 낡는데, 화면은 아무 말도 안 한다** — 부대 현황이
 * 두 벌이 되는 것이라 판때기(`.place-panel`)만 부르는 쪽이 정하고 속은 여기 하나다.
 *
 * 줄의 상태·병기는 **규칙이 낸다** — 부상은 `isInjured()`, 병기는 `equippedBy()`.
 */
export function SquadRoster({ profile, squad }: {
  profile: PlayerProfile;
  squad: Squad;
}): React.JSX.Element {
  const power = squadPower(profile, squad);
  const now = Date.now();
  const size = teamSize(squad.mode);
  return (
    <>
      <h2 className="cap sqv-head" data-field="head" data-power={power ?? ''}>
        {t('squad.view.head', {
          name: squad.name, mode: modeText(squad.mode),
          power: power === null ? '—' : power.toLocaleString(),
        })}
      </h2>
      {/* 열 제목 (2026-09-17 지정) — 사진은 이름 칸 안에 함께 들어 제목이 없다.
          등급·이름·레벨은 장수 일람의 키를 그대로 빌린다(같은 뜻, 같은 열쇠) */}
      <div className="sqv-row sqv-thead" aria-hidden="true">
        <span className="pc">{t('squad.col.piece')}</span>
        <span className="who">{t('officers.col.name')}</span>
        <span className="gr-cell">{t('officers.col.grade')}</span>
        <span className="lv">{t('officers.col.level')}</span>
        <span className="st">{t('squad.col.status')}</span>
        <span className="eq">{t('squad.col.equip')}</span>
      </div>
      <div className="sqv-rows">
        {Array.from({ length: SQUAD_ROWS }, (_, i) => {
          const pick = i < size ? squad.picks[i] : undefined;
          const inst = pick ? profile.roster[pick.officer] : undefined;
          const data = pick ? officerById.get(pick.officer) : undefined;
          if (!pick || !inst || !data) {
            return (
              <div key={i} className="sqv-row" data-empty="1" data-off={i >= size ? '1' : '0'}>
                <span className="pc">{pick?.piece ?? ''}</span>
              </div>
            );
          }
          const hurt = isInjured(inst, now);
          const eq = equippedBy(profile, pick.officer);
          return (
            <div key={i} className="sqv-row" data-piece={pick.piece} data-officer={pick.officer}>
              <span className="pc">{pick.piece}</span>
              <span className="who">
                <OfficerArt officer={data.id} className="thumb" />
                <span className="nm">{pickOfficerName(data)}</span>
              </span>
              <span className="gr-cell"><GradeBadge grade={data.grade} /></span>
              <span className="lv" data-field="level">Lv{inst.level}</span>
              <span className="st" data-field="status" data-injured={hurt ? '1' : '0'}>
                {hurt ? t('squad.status.injured') : t('squad.status.ok')}
              </span>
              {/* 병기는 **그림**이다(2026-09-17 지정) — 이름 글자는 칸이 좁아 옅게 잘려
                  안 읽혔다. 그림은 대장간 지급 목록의 줄 그림(`ItemThumb` row)과 같고,
                  이름은 `title`로 남는다. 없으면 먹색 줄표 하나 */}
              <span className="eq" data-field="equip" data-held={eq ? '1' : '0'} title={eq ? pickEquipName(eq) : t('officers.equip.none')}>
                {eq ? <ItemThumb item={eq} variant="row" /> : <span className="none">—</span>}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
