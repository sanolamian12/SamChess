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
 * 짓기·증축과 「남은 건설 기회」는 [건물 관리](`BuildingsScreen.tsx`)로 옮겼다.
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

import { useState } from 'react';
import {
  CITY_NAME_MAX, CITY_RENAME_GOLD, applyCityUpgrade, applyRenameCity, canRenameCity,
  BUILD_ACTIONS_PER_UPGRADE, BUILD_CITY_LEVEL, buildCreditsLeft, buildingRows,
  canUpgradeCity, gradeTally, upgradeCost,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { upgradeCityOnServer } from '../meta/city.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { buildingStatusText } from './buildingText.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

export function CityScreen({ profile, onBack, onChange, onBuildings }: {
  profile: PlayerProfile;
  onBack: () => void;
  onChange: (next: PlayerProfile) => void;
  onBuildings: () => void;
}): React.JSX.Element {
  useLang();
  const [asking, setAsking] = useState(false);
  /** 서버가 거부한 이유. **규칙이 한 말을 그대로 보여 준다** — 화면이 다시 짓지 않는다 */
  const [refused, setRefused] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  /** 서버 왕복 중 — 가리개를 덮는다(`BusyVeil`). 「멈춘 것」과 「기다리는 것」은 다르다 */
  const [busy, setBusy] = useState(false);
  /** 방금 오른 도시 레벨. **축하 팝업을 닫아야** 새 판때기가 보인다 (2026-09-04 지정) */
  const [done, setDone] = useState<number | null>(null);

  const cost = upgradeCost(profile.cityLevel);
  const can = canUpgradeCity(profile);
  /*
   * **자재가 모자란 것은 안 적는다** (2026-09-04 지정). 바로 위 「건축 자재」 줄이
   * 「5 (Lv3 필요 : 20)」로 이미 같은 말을 하고, 단추도 잠겨 있다 — 같은 사실을
   * 세 번 말하는 셈이었다.
   *
   * ★ **나머지 이유는 그대로 띄운다.** 「Lv10이 상한이다 — Lv11은 황제를 옹립해야
   * 갈 수 있다」는 **화면 어디에도 없는 사실**이라, 이것까지 지우면 잠긴 단추만
   * 남아 「고장인가」가 된다. 그래서 「이유를 다 지운다」가 아니라 **이미 화면에
   * 있는 이유만 뺀다**로 적는다.
   */
  const enoughMaterials = cost === null || profile.materials >= cost;
  /*
   * **지은 것 + 「없어도 값을 내는 것」**을 그린다. 후자는 지금 농지 하나다 —
   * 농지가 없어도 군량은 시간당 1씩 찬다(GDD §5.4, 「잠기는 것이 아니라 느린 것」).
   * 그 1이 어디서 오는지 화면에 없으면 「군량이 왜 이렇게 느리지」의 답이 없다.
   *
   * **`id === 'farm'`이라고 적지 않는다** — 데이터가 그 성질을 이미 들고 있다
   * (`effect.absent`, 안 지었을 때의 값). 태학·병원은 0이라 저절로 빠진다.
   */
  const rows = buildingRows(profile).filter((r) => r.level > 0 || (r.effect?.now ?? 0) > 0);
  const emperor = gradeTally(profile).hasEmperor;

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
        <section className="place-panel cty-info">
          <p className="cty-name-row">
            <h2 className="cap" data-field="cityName">{profile.cityName}</h2>
            <button className="btn ghost sm" data-action="rename" onClick={() => setRenaming(true)}>
              {t('city.rename')}
            </button>
          </p>

          <p className="cty-row" data-field="level">
            <span className="k">{t('city.level')}</span>
            <b className="v">Lv{profile.cityLevel}</b>
          </p>

          {/* 「황제 : [옹립 or 부재]」 = **헌제 보유 여부**다 (§5-4). 지금 효과는 없다 */}
          <p className="cty-row" data-field="emperor" data-emperor={emperor ? '1' : '0'}>
            <span className="k">{t('city.emperor')}</span>
            <b className="v">{emperor ? t('city.emperor.yes') : t('city.emperor.no')}</b>
          </p>

          <p className="cty-row" data-field="materials" data-have={profile.materials}>
            <span className="k">{t('city.materials')}</span>
            <b className="v">
              {cost === null
                ? t('city.materials.max', { have: profile.materials })
                : t('city.materials.n', { have: profile.materials, lv: profile.cityLevel + 1, need: cost })}
            </b>
          </p>
        </section>

        {/*
          ── 건물 (2026-09-04 · pptx 56쪽) ──────────────────────────
          **못 짓는 줄도 빼지 않는다** — 무엇이 있는지 안 보이면 도시를 왜
          올리는지 알 수 없다. 대신 잠긴 단추 옆에 규칙이 이유를 적는다.
        */}
        <section className="place-panel cty-blds">
          <p className="cty-blds-head">
            <span className="cap">{t('city.buildings')}</span>
          </p>

          {/* 안 지은 농지도 뜬다 — 「없음」에 회색이지만 시간당 1은 실제로 찬다.
              **등용 장수·군량 두 줄이 여기로 들어왔다**(2026-09-04 세 번째 손질) —
              같은 숫자를 판때기 아래에 한 번 더 적으면 언젠가 한쪽만 낡는다 */}
          {rows.map((row) => (
            <div
              className="cty-bld" key={row.id}
              data-building={row.id} data-level={row.level} data-field={row.id}
            >
              <span className="nm">{row.name}</span>
              <span className="lv">{row.level > 0 ? `Lv${row.level}` : t('city.bld.none')}</span>
              <span className="fx v">{buildingStatusText(profile, row)}</span>
            </div>
          ))}
        </section>

        <section className="place-panel cty-acts">
          <button
            className="btn wide primary"
            data-action="upgrade"
            disabled={!can.ok}
            onClick={() => setAsking(true)}
          >
            {cost === null ? t('city.upgrade.max') : t('city.upgrade', { need: cost })}
          </button>

          {/* 건물 관리 — 짓기·증축과 「남은 건설 기회」가 사는 자리.
              **[도시 전적 보기]는 없앴다**(2026-09-04 세 번째 손질) — 눌러도
              메인의 「랭킹」 자리와 같은 화면으로 갔다. 같은 곳으로 가는 문이
              둘이면 하나는 언젠가 낡는다 */}
          <button className="btn wide" data-action="buildings" onClick={onBuildings}>
            {t('city.buildings.manage')}
          </button>
        </section>

        {/*
          ── 왜 안 되는지는 **판때기 밖에서** 말한다 (2026-09-04 네 번째 손질) ──
          판 안에 두면 양피지 위 먹색이라 단추 사이에 묻혀 「눌러도 아무 일이 없다」로
          읽힌다. 밖으로 빼 주황색으로 띄운다 — 이 화면에서 **유일하게 판때기 없이
          뜨는 글**이라 눈이 먼저 간다.

          자리는 하나이고 규칙이 거부한 것(`why`)과 서버가 거부한 것(`refused`)이
          함께 온다. 둘이 동시에 뜰 수는 있어도 **뜻이 겹치지 않는다** — 앞은 「지금
          누를 수 없다」, 뒤는 「눌렀는데 서버가 거절했다」다.

          **자재가 모자란 이유만은 안 뜬다** — 위 「건축 자재」 줄이 이미 말한다
          (`enoughMaterials` 주석 참조).
        */}
        {((!can.ok && enoughMaterials) || refused) && (
          <div className="cty-alerts">
            {!can.ok && enoughMaterials && <p className="cty-alert" data-field="why">{can.reason}</p>}
            {refused && <p className="cty-alert" data-field="refused">{refused}</p>}
          </div>
        )}
      </div>

      {asking && cost !== null && (
        <UpgradeModal
          profile={profile}
          cost={cost}
          onClose={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            setRefused(null);
            setBusy(true);
            /*
             * **증축은 서버가 한다** (2026-09-04). `PUT /profile`이 `materials`·
             * `buildings`·`buildCredits`를 통째로 버리므로, 로컬로 계산해 올리면
             * 아무 오류 없이 삼켜진다 — 「자재만 줄고 레벨은 그대로」가 된다.
             *
             * **못 닿으면 로컬로 물러난다**(§5-61). 규칙이 거부한 것(400)은 다른
             * 사건이라 물러나지 않고 이유를 보여 준다 — 로컬로 해 봐야 같은
             * 이유로 거부된다.
             *
             * **오른 레벨은 「받은 계정」에서 읽는다** — `profile.cityLevel + 1`로
             * 짐작하면 서버가 다른 판정을 했을 때 축하 팝업만 거짓말을 한다.
             */
            void (async () => {
              try {
                const fromServer = await upgradeCityOnServer();
                const next = fromServer ?? applyCityUpgrade(profile, Date.now());
                onChange(next);
                setDone(next.cityLevel);
              } catch (err) {
                setRefused(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            })();
          }}
        />
      )}

      {/* 증축이 끝났다 — 확인을 누르면 Lv가 오른 판때기가 드러난다.
          팝업 뒤의 화면은 **이미 새 값**이다(`onChange`가 먼저 갔다) */}
      {done !== null && (
        <UpgradeDoneModal profile={profile} level={done} onClose={() => setDone(null)} />
      )}

      {renaming && (
        <RenameModal
          profile={profile}
          onClose={() => setRenaming(false)}
          onConfirm={(name) => {
            // 쿨다운 판정과 같은 결 — 시각은 여기서 넣는다(meta는 시계를 안 읽는다).
            onChange(applyRenameCity(profile, name, Date.now()));
            setRenaming(false);
          }}
        />
      )}

      {/* 왕복이 짧으면 안 보인다 — 뜸을 들여 나타난다(`BusyVeil.tsx`) */}
      {busy && <BusyVeil label={t('city.upgrade.busy')} />}
    </ScreenChrome>
  );
}

/**
 * 증축 확인.
 *
 * 되돌릴 수 없고 값이 나가는 한 수라 한 번 묻는다(재설계와 같은 결).
 *
 * ★ **도시 증축이 사는 것은 「건설 기회」다** (2026-09-04). 예전에는 풀·군량 상한·
 * 생산량 셋이 이 한 수를 따라 함께 올라갔지만, 이제 그것들은 건물이 정하고 건물은
 * 기회를 쓴다. 그래서 팝업이 적는 것도 「무엇이 늘어나는가」가 아니라 **기회 몇 회,
 * 그리고 (Lv1→Lv2라면) 이제 건물을 지을 수 있다**는 사실이다.
 */
function UpgradeModal({ profile, cost, onClose, onConfirm }: {
  profile: PlayerProfile; cost: number; onClose: () => void; onConfirm: () => void;
}): React.JSX.Element {
  const level = profile.cityLevel;
  // Lv1 → Lv2가 특별하다 — 그때부터 **비로소** 건물을 짓거나 올릴 수 있다
  const opensBuilding = level + 1 === BUILD_CITY_LEVEL;
  return (
    <div className="modal-back" data-modal="upgrade" onClick={onClose}>
      <div className="modal cty-modal" onClick={(e) => e.stopPropagation()}>
        <p className="row"><b>{t('city.upgrade.title')}</b></p>
        <p className="row" data-field="what">{t('city.upgrade.what', { from: level, to: level + 1, cost })}</p>
        <p className="row dim" data-field="gain">
          {t('city.upgrade.credits', { n: BUILD_ACTIONS_PER_UPGRADE })}
          {opensBuilding ? ` ${t('city.upgrade.opensBuilding')}` : ''}
        </p>
        <div className="cty-acts">
          <button className="btn primary wide" data-action="upgradeConfirm" onClick={onConfirm}>
            {t('city.upgrade.ok')}
          </button>
          <button className="btn wide" data-action="upgradeCancel" onClick={onClose}>
            {t('city.upgrade.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 증축이 **끝났다** — 축하 팝업 (2026-09-04 지정).
 *
 * ────────────────────────────────────────────────────────────────
 * 확인을 누른 **뒤에** 새 판때기를 본다
 * ────────────────────────────────────────────────────────────────
 *
 * 뒤 화면은 이미 새 값이다(`onChange`가 먼저 갔다) — 이 팝업이 덮고 있다가
 * [확인]에 걷힌다. 그래서 「무엇이 달라졌는가」를 **읽고 나서** 달라진 화면을 본다.
 * 값을 팝업이 따로 들고 있지 않은 것도 그 때문이다 — 레벨 하나만 받는다.
 *
 * **오른 레벨은 서버가 준 계정에서 읽는다**(부르는 쪽 참조) — `+1`로 짐작하면
 * 서버가 다른 판정을 했을 때 이 팝업만 거짓말을 한다.
 *
 * 세 줄이 뜨는 조건이 각각 다르다.
 *
 * | 줄 | 언제 |
 * |---|---|
 * | 「도시가 Lv2가 되었다」 | 언제나 |
 * | 「건설 기회 3회를 얻었다」 | 황궁 레벨이 **아닐 때** — 거기서는 기회를 안 센다 |
 * | 「이제부터 건물을 짓고 올릴 수 있다」 | Lv2에 닿은 그때 한 번 (`BUILD_CITY_LEVEL`) |
 * | 「궁궐이 황궁이 되었다 — 제한이 풀렸다」 | 황궁 레벨에 닿았을 때 |
 */
function UpgradeDoneModal({ profile, level, onClose }: {
  profile: PlayerProfile; level: number; onClose: () => void;
}): React.JSX.Element {
  // **`buildCreditsLeft`가 `null`이면 황궁이다** — 화면이 레벨 숫자로 다시
  // 판정하지 않는다(§city.ts 「기회를 읽는 자리는 하나」와 같은 결)
  const palace = buildCreditsLeft(profile) === null;
  return (
    <div className="modal-back" data-modal="upgradeDone" onClick={onClose}>
      <div className="modal cty-modal cty-done" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl" data-field="doneTitle">{t('city.done.title')}</p>
        <p className="cty-done-lv" data-field="doneLevel">Lv{level}</p>
        <p className="row" data-field="doneWhat">{t('city.done.what', { lv: level })}</p>
        {!palace && (
          <p className="row dim">{t('city.done.credits', { n: BUILD_ACTIONS_PER_UPGRADE })}</p>
        )}
        {level === BUILD_CITY_LEVEL && <p className="row dim">{t('city.done.opensBuilding')}</p>}
        {palace && <p className="row dim" data-field="donePalace">{t('city.done.palace')}</p>}
        <button className="btn primary wide" data-action="doneOk" onClick={onClose}>
          {t('city.done.ok')}
        </button>
      </div>
    </div>
  );
}

/**
 * 도시 이름 변경 확인 — 랭킹·매칭에 노출될 이름이라 값싼 재설정을 막는
 * 관문(2026-08-25 기획: 금화 소모 + 3일 쿨다운). 값이 나가고 되돌릴 수 없는
 * 수라 증축과 같은 결로 한 번 묻는다. **왜 안 되는지는 `canRenameCity()`가
 * 말한다** — 잠긴 단추만 두면 화면이 「고장인가」로 읽힌다.
 */
function RenameModal({ profile, onClose, onConfirm }: {
  profile: PlayerProfile; onClose: () => void; onConfirm: (name: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState(profile.cityName);
  const check = canRenameCity(profile, name, Date.now());

  return (
    <div className="modal-back" data-modal="rename" onClick={onClose}>
      <div className="modal cty-modal" onClick={(e) => e.stopPropagation()}>
        <p className="row"><b>{t('city.rename.title')}</b></p>
        <input
          className="field"
          value={name}
          maxLength={CITY_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && check.ok) onConfirm(name); }}
          autoFocus
        />
        <p className="row dim" data-field="cost">{t('city.rename.cost', { gold: CITY_RENAME_GOLD })}</p>
        {!check.ok && <p className="note" data-field="why">{check.reason}</p>}
        <div className="cty-acts">
          <button
            className="btn primary wide"
            data-action="renameConfirm"
            disabled={!check.ok}
            onClick={() => onConfirm(name)}
          >
            {t('city.rename.ok')}
          </button>
          <button className="btn wide" data-action="renameCancel" onClick={onClose}>
            {t('city.rename.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
