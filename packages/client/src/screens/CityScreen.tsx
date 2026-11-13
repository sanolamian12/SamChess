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
 * 짓기·증축과 「남은 건설 기회」는 [건물 관리](`BuildingsScreen.tsx`)로 옮겼다. **[도시 증축]도 2026-11-13에 그리로 옮겼다**(`CityUpgrade.tsx`) —
 * 건물이 들어설수록 이 화면의 줄이 늘어 명령 판을 밀어낸다. 이 화면의 명령 판에는 [건물 관리]만 남았다.
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
import {
  buildingRows, grainCap, grainPerHour, growthCue, pendingGuide, poolCap, poolUsed, upgradeChecklist, upgradeCost,
} from '@samchess/meta';
import type { BuildingRow, PlayerProfile, UpgradeCheck } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { BUILDING_BONUS_KEYS, buildingNameText, buildingStatusText } from './buildingText.ts';
import { CityBonusMark } from './CityBonus.tsx';
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

/** 증축 조건 칸의 그림 — 이름은 올리면(`condLabel`) */
const COND_ICON = {
  emperor: 'emperor', credits: 'build-credit', officers: 'tab-officer',
  topOfficers: 'grade-score', materials: 'res-materials',
} as const satisfies Record<UpgradeCheck['kind'], GameIconName>;

function condLabel(kind: UpgradeCheck['kind']): string {
  return kind === 'materials' ? t('city.materials') : t(`city.cond.${kind}`);
}

/**
 * 건물 줄의 현황 칸 — **도시 관리에서만** 아이콘으로 (2026-11-12 지정). 「현재 20 / 최대 20」만으로는
 * 무엇의 현재 · 최대인지가 안 보였다. 숫자는 `buildingStatusText`와 같은 규칙 함수가 낸다.
 * 건물 관리 · 건물 상세는 글 한 줄(`buildingStatusText`) 그대로다 — 그 문장은 거기서 아직 쓰인다.
 *
 * | 건물 | 칸 |
 * |---|---|
 * | 궁궐 | [투구] 현원 / 최대 — 증축 조건의 「보유 장수」와 같은 그림 |
 * | 병영 | [군량] 현재 / 최대 |
 * | 장터 | [금화] [자재] [장수 카드] 구매 |
 * | 농지 | [시간당 군량] +n/시간 |
 * | 나머지 | 글 한 줄 그대로 |
 */
function BuildingStatus({ profile, row }: { profile: PlayerProfile; row: BuildingRow }): React.JSX.Element {
  switch (row.id) {
    case 'palace':
      return (
        <span className="fx-t fx-ic" data-have={poolUsed(profile)} data-max={poolCap(profile)}>
          <GameIcon name="tab-officer" label={t('city.pool')} />{poolUsed(profile)} / {poolCap(profile)}
        </span>
      );
    case 'barracks':
      return (
        <span className="fx-t fx-ic" data-have={profile.grain} data-max={grainCap(profile)}>
          <GameIcon name="res-grain" label={t('market.grain')} />{profile.grain} / {grainCap(profile)}
        </span>
      );
    case 'market':
      return (
        <span className="fx-t fx-ic">
          <GameIcon name="res-gold" label={t('market.gold')} />
          <GameIcon name="res-materials" label={t('city.materials')} />
          <GameIcon name="res-card" label={t('market.status.cards')} />
          {t('city.bld.market.buy')}
        </span>
      );
    case 'farm':
      return (
        <span className="fx-t fx-ic" data-rate={grainPerHour(profile)}>
          <GameIcon name="grain-rate" label={t('city.bld.label.farm')} />{t('city.bld.farm.rate', { n: grainPerHour(profile) })}
        </span>
      );
    default:
      return <span className="fx-t">{buildingStatusText(profile, row)}</span>;
  }
}

export function CityScreen({ profile, onBack, onChange, onBuildings }: {
  profile: PlayerProfile;
  onBack: () => void;
  onChange: (next: PlayerProfile) => void;
  onBuildings: () => void;
}): React.JSX.Element {
  const lang = useLang();
  const namesRef = useFitNames(lang);
  /*
   * 첫 증축의 길 (2026-11-13 기획자) — [도시 증축]은 건물 관리로 옮겼다(`CityUpgrade.tsx`). 여기서는 증축할 채비가 됐거나 첫 증축 뒤
   * 아직 안 지었으면(`growthCue`) [건물 관리]가 빛나고, 안내 내관(`city.build`)이 한 번 그 단추를 가리킨다
   */
  const [guidesOn] = useState(guidesEnabled);
  const cue = guidesOn ? growthCue(profile) : null;
  const guide = useGuide(profile, onChange, pendingGuide(profile, 'city'), 'city');
  /** 다음 레벨에 드는 자재 — 현황판의 자재 줄이 쓴다. 진짜 최대면 `null` */
  const cost = upgradeCost(profile.cityLevel);
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
          {/* 도시 이름 · [이름 변경] · 황제는 **궁궐 첫 화면의 현황 판**으로 옮겼다(2026-09-18 지정,
              `PlaceScreen`의 `PalaceStatus`). 여기는 증축을 고르는 자리라 레벨과 자재 두 줄이다.
              자재는 「가진 수 / 다음 레벨에 드는 수」. 채웠는지는 오른쪽 조건 칸이 색 · 체크로 말한다
              (예전엔 자재 줄 끝에 「(증축 조건 충족)」을 붙였다 — 조건이 넷이 되며 칸으로 옮겼다) */}
          {/* **2단** (2026-11-12 지정) — 왼쪽은 지금(레벨 · 자재), 오른쪽은 다음 레벨의 조건.
              격자의 차례가 「레벨 · 조건 머리 · 자재 · 조건 칸」이라 같은 줄끼리 높이가 맞는다 */}
          <div className="cty-grid">
            <p className="cty-row" data-field="level">
              <span className="k">{t('city.level')}</span>
              <b className="v">Lv{profile.cityLevel}</b>
            </p>

            <p className="cty-row cty-cond-head" data-field="condHead">
              {checklist
                ? t('city.cond.head', { from: checklist.from, to: checklist.to })
                : <GameIcon name="bld-max" label={t('city.upgrade.max')} text />}
            </p>

            <p className="cty-row" data-field="materials" data-have={profile.materials}>
              <span className="k"><GameIcon name="res-materials" label={t('city.materials')} text /></span>
              <b className="v">
                {cost === null
                  ? t('city.materials.max', { have: profile.materials })
                  : t('city.materials.have', { have: profile.materials, need: cost })}
              </b>
            </p>

            {/* 조건 칸 — 아이콘 + 「가진 수/필요한 수」, 이름은 올리면(`title`). 칸마다 채웠는지(`data-ok`)를
                색으로(옥색 채움 · 붉은 먹 모자람 — 체크 그림은 작게 놓으면 붉은 점으로 읽혀 뺐다). 표는 규칙이 낸다(`upgradeChecklist` — 단추의 잠금과 같은 표) */}
            <p className="cty-conds" data-field="conds">
              {checklist?.checks.map((c) => (
                <span key={c.kind} className="cty-cond" data-cond={c.kind} data-ok={c.ok ? '1' : '0'}>
                  <GameIcon name={COND_ICON[c.kind]} label={condLabel(c.kind)} />
                  {c.kind === 'emperor' ? null : c.kind === 'credits' ? c.have : `${c.have}/${c.need}`}                </span>
              ))}
            </p>
          </div>
        </section>

        {/*
          ── 건물 (2026-09-04 · pptx 56쪽) ──────────────────────────
          **못 짓는 줄도 빼지 않는다** — 무엇이 있는지 안 보이면 도시를 왜
          올리는지 알 수 없다. 대신 잠긴 단추 옆에 규칙이 이유를 적는다.
        */}
        <section className="place-panel cty-blds cty-blds-st" ref={namesRef}>
          {/* 판 제목 「건물」은 걷었다(2026-11-12 지정) — 건물 그림 · 이름이 이미 말한다 */}
          {/* 안 지은 농지도 뜬다 — 「없음」에 회색이지만 시간당 1은 실제로 찬다.
              **등용 장수·군량 두 줄이 여기로 들어왔다**(2026-09-04 세 번째 손질) —
              같은 숫자를 판때기 아래에 한 번 더 적으면 언젠가 한쪽만 낡는다 */}
          {rows.map((row) => (
            <div
              className="cty-bld" key={row.id}
              data-building={row.id} data-level={row.level} data-field={row.id}
            >
              <span className="nm"><BuildingIcon id={row.id} label={buildingNameText(row.id)} text /></span>
              <span className="lv">{row.level > 0 ? `Lv${row.level}` : t('city.bld.none')}</span>
              {/* 말줄임은 글에만 — 인장까지 같은 칸에 두면 긴 번역(몽골어)에서 인장이 잘려 나간다 */}
              <span className="fx v">
                <BuildingStatus profile={profile} row={row} />
                {BUILDING_BONUS_KEYS[row.id] && <CityBonusMark profile={profile} keys={BUILDING_BONUS_KEYS[row.id]!} />}
              </span>
            </div>
          ))}
        </section>

        <section className="place-panel cty-acts" ref={actsRef}>
          {/* 건물 관리 — 짓기·증축과 「남은 건설 기회」가 사는 자리.
              **[도시 전적 보기]는 없앴다**(2026-09-04 세 번째 손질) — 눌러도
              메인의 「랭킹」 자리와 같은 화면으로 갔다. 같은 곳으로 가는 문이
              둘이면 하나는 언젠가 낡는다 */}
          <button className="btn wide" data-action="buildings" data-guide-cue={cue ? '' : undefined} onClick={onBuildings}>
            <GameIcon name="build-credit" label={t('city.buildings.manage')} text />
          </button>
        </section>

      </div>

      {guide.node}
    </ScreenChrome>
  );
}

