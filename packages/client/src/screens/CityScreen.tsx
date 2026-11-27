/**
 * 도시 관리 (pptx 41쪽 왼쪽)
 *
 * ```
 * [← 궁궐로]                도시 관리
 *  도시 이름
 *  Level : 1
 *  황제 : [옹립 / 부재]
 *  등용 장수   현원 5 / 최대 10 명
 *  잉여 장수 카드 : 3 장
 *  군량   시간 당 생산량 : 1   현재 12 / 최대 20
 *  업그레이드 재료 : 4 (다음 레벨 : 10)
 *  [증축 (재료 10 소모)]   [도시 전적 보기]
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 건물이 들어왔다 (2026-09-04 · pptx 56쪽)
 * ────────────────────────────────────────────────────────────────
 *
 * 「시설 자리에 이름을 미리 지어 두지 않는다」로 비워 두었던 자리가 채워졌다 —
 * 이름과 효과가 정해졌다. 황제도 `[옹립/부재]`에 뜻이 생겼다(헌제가 있으면
 * 도시 Lv11(황궁)에 갈 수 있다).
 *
 * ────────────────────────────────────────────────────────────────
 * 이 화면은 **현황판**이다 — 짓지 않는다 (2026-09-04 두 번째 손질) ★
 * ────────────────────────────────────────────────────────────────
 *
 * 짓기·증축과 「남은 건설 기회」는 한때 [건물 관리](`BuildingsScreen.tsx`)로 옮겼고 [도시 증축]도 2026-11-13에 그리로 갔다.
 * **2026-11-23 기획자 — 증축이 건물 셋을 함께 올리게 되며 [건물 관리]와 건설 기회가 없어졌다.** [도시 증축](`CityUpgrade.tsx`)은
 * 이 화면 바닥 명령 판으로 돌아왔다 — 위 판의 증축 조건을 보고 그 자리에서 누른다(조건은 여기, 단추는 한 걸음 안 — 가 풀렸다).
 * 한 화면이 「지금 어떤가」와 「무엇을 할까」를 같이 지면 **아무것도 못 하는 단추
 * 일곱**이 현황을 덮는다 — Lv1 계정은 일곱 줄이 전부 잠겨 있다.
 *
 * 그래서 여기 건물 줄은 **지은 것만** 그리고(안 지어도 값을 내는 농지는 예외),
 * 증분(`row.line`, 「60 → 110」)이 아니라 **지금 값**을 적는다 — 살 수 없는 값을
 * 현황에 섞지 않는다. 확장 도시(산 너머)가 안 지은 건물을 아예 안 그리는 것과
 * 같은 규칙이다.
 *
 * **등용 장수·군량은 건물 줄 안으로 들어왔다** — 둘 다 건물(궁궐·병영)이 여는
 * 한도라, 그 건물 줄이 「지금 얼마나 쓰고 있는가」까지 적는다 — 그 문장을 고르는
 * 자리는 **산 너머와 함께 쓰는** `buildingText.ts` 하나다.
 * 판때기 아래에 같은 숫자를 한 번 더 적는 쪽도 해 봤는데, **같은 값이 두 군데면
 * 언젠가 한쪽만 낡는다.** 상한의 출처는 여전히 하나다(`poolCap`·`grainCap`).
 *
 * **잉여 장수 카드 줄은 지웠다** — 카드는 장수마다 따로 세는 값이라(장수 일람의
 * 표·카드가 그 자리다) 총합 한 숫자는 여기서 아무 결정도 돕지 않았다.
 *
 * ────────────────────────────────────────────────────────────────
 * 숫자는 전부 규칙이 낸다
 * ────────────────────────────────────────────────────────────────
 *
 * 상한·풀·생산량·다음 레벨 재료는 `city.json`이 갖고 있고 `@samchess/meta`가 읽는다.
 * 화면이 「Lv2는 재료 10」을 적으면 엑셀이 바뀌었을 때 **표시만** 조용히 어긋난다.
 * 증축 가능 여부도 `canUpgradeCity()`에 묻는다 — 전투 UI가 `validate()`에 묻는 것과
 * 같은 결이고, **왜 안 되는지도 그쪽이 말한다.**
 *
 * **군량 충전은 여기서 하지 않는다.** 시계를 넣는 자리는 `App.tsx` 하나다 — 군량을
 * 읽는 화면이 넷(메인·병영·편성·도시)이라 화면마다 채우면 하나가 낡은 값을 본다.
 * 다만 **증축은 요율이 바뀌는 자리**라 `applyCityUpgrade(profile, nowMs)`가 안에서
 * 먼저 정산한다 — 그래서 이 화면이 유일하게 시각을 넣는다.
 */

import { useRef, useState } from 'react';
import { CityUpgrade } from './CityUpgrade.tsx';
import { buildingRows, growthCue, pendingGuide, upgradeChecklist } from '@samchess/meta';
import type { PlayerProfile, UpgradeCheck } from '@samchess/meta';
import type { BuildingId } from '@samchess/data';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { buildingNameText } from './buildingText.ts';
import { BuildingPeek } from './BuildingPeek.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { useFitNames } from './fitNames.ts';
import { useAllLangLayout } from './useAllLangLayout.ts';
import { useGuide } from './useGuide.tsx';
import { guidesEnabled } from './guideScript.ts';
import { BuildingIcon, GameIcon } from './GameIcon.tsx';
import type { GameIconName } from '../ui/gameIcon.ts';
import { BuildingLevelBadge, CityLevelBadge } from './LevelBadge.tsx';

/** 증축 조건 칸의 그림 — 이름은 올리면(`condLabel`) */
const COND_ICON = {
  emperor: 'emperor', officers: 'tab-officer',
  topOfficers: 'grade-score', wins: 'rec-win', materials: 'res-materials',
} as const satisfies Record<UpgradeCheck['kind'], GameIconName>;

function condLabel(kind: UpgradeCheck['kind']): string {
  return kind === 'materials' ? t('city.materials') : t(`city.cond.${kind}`);
}


export function CityScreen({ profile, onBack, onChange }: {
  profile: PlayerProfile;
  onBack: () => void;
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  const lang = useLang();
  const namesRef = useFitNames(lang);
  /*
   * 첫 증축의 길 (2026-11-13 기획자) — 증축할 채비가 됐으면(`growthCue`) [도시 증축]이 빛나고, 안내 내관(`city.upgrade`)이 한 번
   * 그 단추를 가리킨다. 증축 · 완료 팝업이 떠 있는 동안은 내관을 미룬다(그 위로 겹치지 않게)
   */
  const [guidesOn] = useState(guidesEnabled);
  const cue = guidesOn ? growthCue(profile) : null;
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  /** [보기]로 연 건물 — 건물 한 장(`BuildingPeek`) */
  const [peek, setPeek] = useState<BuildingId | null>(null);
  const guide = useGuide(profile, onChange, upgradeOpen ? null : pendingGuide(profile, 'city'), 'city');
  /** 다음 레벨의 조건표 — 단추의 잠금(`can`)과 **같은 표**다. 진짜 최대면 `null` */
  const checklist = upgradeChecklist(profile);
  /*
   * **지은 것 + 「없어도 값을 내는 것」**을 그린다. 후자는 지금 농지 하나다 —
   * 농지가 없어도 군량은 시간당 1씩 찬다(GDD §5.4, 「잠기는 것이 아니라 느린 것」).
   * 그 1이 어디서 오는지 화면에 없으면 「군량이 왜 이렇게 느리지」의 답이 없다.
   *
   * **`id === 'farm'`이라고 적지 않는다** — 데이터가 그 성질을 이미 들고 있다
   * (`effect.absent`, 안 지었을 때의 값). 태학·병원은 0이라 저절로 빠진다.
   */
  const rows = buildingRows(profile).filter((r) => r.level > 0 || (r.effect?.now ?? 0) > 0);

  /* 줄 · 판 크기는 열 언어 가운데 가장 큰 것에 맞춘다 — 어느 언어로 봐도 판이 같은 크기다
     (`useAllLangLayout`, 2026-11-13 기획자 — 몽골어 · 포르투갈어 · 에스파냐어에서 이름이 두 줄로 접히며 판이 늘었다) */
  const infoRef = useRef<HTMLElement>(null);
  const actsRef = useRef<HTMLElement>(null);
  useAllLangLayout(
    [{ box: infoRef }, { box: namesRef, rows: ':scope > .cty-bld' }, { box: actsRef }],
    JSON.stringify([profile.cityLevel, rows.map((r) => [r.id, r.level]), checklist?.checks.map((c) => c.kind)]),
  );

  /* 건물 줄에 적을 「지금 형편」은 **산 너머와 같은 자리**가 낸다
     (`buildingText.ts`) — 성 안과 성 밖이 같은 건물을 다르게 말하면
     화면을 두 번 오가야만 보인다. */

  return (
    <ScreenChrome
      backdrop={placeBackdrop('palace', profile.cityLevel)}
      className="scr-city"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="city" data-city-level={profile.cityLevel}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('city.back'))}
        </button>
        <span className="place-nm">{t('palace.city')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel cty-info" ref={infoRef}>
          {/* **첫 줄 — 「[지금 레벨] ▶ [다음 레벨] 요건」, 그 밑에 요건 칸** (2026-11-23 기획자). 「도시 레벨 Lv3」 · 「증축 조건 Lv3 → Lv4」 ·
              「건축 자재 5 / 20」 글은 걷었다 — 레벨은 배지가, 자재는 요건 칸이 말한다. 도시 이름 · 황제는 궁궐 현황 판(2026-09-18).
              진짜 최대면 지금 배지 + 「최대 레벨」 */}
          <p className="cty-head" data-field="level" data-level={profile.cityLevel}>
            <CityLevelBadge level={profile.cityLevel} />
            {checklist ? (
              <>
                <img className="cty-head-arrow" src="ui/turn/arrowhead.png" alt="→" draggable={false} />
                <CityLevelBadge level={checklist.to} />
                <span className="cty-head-t" data-field="condHead">{t('city.cond.req')}</span>
              </>
            ) : (
              <span className="cty-head-t" data-field="condHead"><GameIcon name="bld-max" label={t('city.upgrade.max')} text /></span>
            )}
          </p>

          {/* 요건 칸 — 판 폭을 넷으로 똑같이 나눈다(2026-11-23 기획자). 아이콘 + 「가진 수/필요한 수」, 이름은 올리면(`title`).
              채움은 옥색 · 모자람은 붉은 먹(`data-ok`). 표는 규칙이 낸다(`upgradeChecklist` — 단추의 잠금과 같은 표) */}
          {checklist && (
            <p className="cty-conds" data-field="conds">
              {checklist.checks.map((c) => (
                <span
                  key={c.kind} className="cty-cond" data-cond={c.kind} data-ok={c.ok ? '1' : '0'}
                  {...(c.kind === 'materials' ? { 'data-field': 'materials', 'data-have': profile.materials } : {})}
                >
                  <GameIcon name={COND_ICON[c.kind]} label={condLabel(c.kind)} />
                  {c.kind === 'emperor' ? null : `${c.have}/${c.need}`}
                </span>
              ))}
            </p>
          )}
        </section>

        {/* 건물 — 「[건물 그림] [레벨 배지] 이름」 셋만 (2026-11-23 기획자). 현황(장수 · 군량 · 구매 · 연구 …)과 컬렉션 인장은 걷었다 —
            각 건물 화면이 말한다. 이름은 열 언어 모두 한 줄(넘치면 `useFitNames`가 하한까지 줄인다).
            안 지은 농지도 뜬다 — 「없음」에 회색이지만 시간당 1은 실제로 찬다 */}
        <section className="place-panel cty-blds cty-blds-st" ref={namesRef}>
          {rows.map((row) => (
            <div
              className="cty-bld" key={row.id}
              data-building={row.id} data-level={row.level} data-field={row.id}
            >
              <span className="ic"><BuildingIcon id={row.id} label={buildingNameText(row.id)} /></span>
              {/* 안 지은 건물은 「없음」 글자 대신 **흐린 Lv1 배지** — 글자는 언어마다 폭이 달라(몽골어 「Байхгүй」) 이름 열을 밀었다 */}
              <span className="lv" title={row.level > 0 ? undefined : t('city.bld.none')}><BuildingLevelBadge level={Math.max(1, row.level)} /></span>
              <span className="nm"><span className="gic-t">{buildingNameText(row.id)}</span></span>
              {/* [보기] — 줄 오른쪽 끝. 줄에서 걷은 기능 · 현황을 건물 한 장으로 (2026-11-23 기획자) */}
              <button className="cty-view" data-action="viewBuilding" onClick={() => setPeek(row.id)} aria-label={t('city.bld.view')} title={t('city.bld.view')}>
                <GameIcon name="mk-view" label={t('city.bld.view')} />
              </button>
            </div>
          ))}
        </section>

        <section className="place-panel cmd-panel cty-acts" ref={actsRef}>
          {/* [증축] — 누르면 올릴 건물 셋을 고르고 한 번에 오른다(2026-11-23 기획자). 그 밑에 [뒤로 가기](장수 일람의 명령 판과 같은 틀) */}
          <CityUpgrade profile={profile} onChange={onChange} cue={cue === 'upgrade'} onModal={setUpgradeOpen} />
          <button className="btn wide" data-action="backBottom" onClick={onBack}>
            {stripBackArrow(t('match.back'))}
          </button>
        </section>
      </div>

      {(() => {
        const row = peek ? rows.find((r) => r.id === peek) : undefined;
        return row ? <BuildingPeek profile={profile} row={row} onClose={() => setPeek(null)} /> : null;
      })()}

      {guide.node}
    </ScreenChrome>
  );
}

