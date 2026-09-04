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
 * 이름과 효과가 정해졌으므로 일곱 줄을 그린다. 황제도 `[옹립/부재]`에 뜻이 생겼다
 * (헌제가 있으면 도시 Lv10에 갈 수 있다).
 *
 * **못 짓는 줄도 빼지 않는다** — 무엇이 있는지 안 보이면 도시를 왜 올리는지 알 수
 * 없다. 대신 잠긴 단추 옆에 규칙이 이유를 적는다. 값이 아직 없는 건물(시장·대장간)도
 * 쓰임은 적는다 — 그 줄만 텅 비면 「고장인가」로 읽힌다.
 *
 * **판정도 계산도 서버가 한다** — `PUT /profile`이 `buildings`·`buildCredits`를
 * 버리므로(H3d의 `grain`과 같은 자리) 로컬로 계산해 올리면 조용히 삼켜진다.
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
  BUILD_ACTIONS_PER_UPGRADE, BUILD_CITY_LEVEL, applyBuild, buildCreditsLeft, buildingRows,
  canUpgradeCity, grainCap, grainPerHour, gradeTally, poolCap, poolUsed, upgradeCost,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { BuildingId } from '@samchess/data';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { buildOnServer, upgradeCityOnServer } from '../meta/city.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

export function CityScreen({ profile, onBack, onChange, onRecords }: {
  profile: PlayerProfile;
  onBack: () => void;
  onChange: (next: PlayerProfile) => void;
  onRecords: () => void;
}): React.JSX.Element {
  useLang();
  const [asking, setAsking] = useState(false);
  /** 서버가 거부한 이유. **규칙이 한 말을 그대로 보여 준다** — 화면이 다시 짓지 않는다 */
  const [refused, setRefused] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  /** 서버 왕복 중에는 두 번 누르지 못하게 한다 — 기회를 두 번 쓴다 */
  const [busy, setBusy] = useState(false);

  const cost = upgradeCost(profile.cityLevel);
  const can = canUpgradeCity(profile);
  const rows = buildingRows(profile);
  const credits = buildCreditsLeft(profile);

  /**
   * 짓거나 올린다. **판정도 계산도 서버가 한다** — `PUT /profile`이 `buildings`·
   * `buildCredits`를 버리므로 로컬로 계산해 올리면 조용히 삼켜진다.
   * 못 닿으면 로컬로 물러나고(§5-61), 규칙이 거부한 것은 그대로 보여 준다.
   */
  const build = (id: BuildingId): void => {
    setRefused(null);
    setBusy(true);
    void (async () => {
      try {
        const fromServer = await buildOnServer(id);
        onChange(fromServer ?? applyBuild(profile, id, Date.now()));
      } catch (err) {
        setRefused(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    })();
  };
  const spare = Object.values(profile.cards).reduce((n, c) => n + c, 0);
  const emperor = gradeTally(profile).hasEmperor;

  return (
    <ScreenChrome
      backdrop={placeBackdrop('palace', profile.cityLevel)}
      className="scr-city"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="city" data-city-level={profile.cityLevel}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('city.back')}</button>
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

          <p className="cty-row" data-field="pool">
            <span className="k">{t('city.pool')}</span>
            <b className="v">{t('city.pool.n', { have: poolUsed(profile), max: poolCap(profile) })}</b>
          </p>

          <p className="cty-row" data-field="cards">
            <span className="k">{t('city.spareCards')}</span>
            <b className="v">{t('city.spareCards.n', { n: spare })}</b>
          </p>

          <p className="cty-row" data-field="grain">
            <span className="k">{t('city.grain')}</span>
            <b className="v">
              {t('city.grain.n', {
                per: grainPerHour(profile), have: profile.grain, max: grainCap(profile),
              })}
            </b>
          </p>

          <p className="cty-row" data-field="materials" data-have={profile.materials}>
            <span className="k">{t('city.materials')}</span>
            <b className="v">
              {cost === null
                ? t('city.materials.max', { have: profile.materials })
                : t('city.materials.n', { have: profile.materials, need: cost })}
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
            <b className="v" data-field="credits">
              {credits === null
                ? t('city.credits.free')
                : t('city.credits.n', { n: credits })}
            </b>
          </p>

          {rows.map((row) => (
            <div className="cty-bld" key={row.id} data-building={row.id} data-level={row.level}>
              <span className="nm">{row.name}</span>
              <span className="lv">{row.level > 0 ? `Lv${row.level}` : t('city.bld.none')}</span>
              <span className="fx">
                {row.effect === null
                  // 값이 아직 없는 건물(시장·대장간) — **쓰임이라도 적는다**
                  ? t('city.bld.pending', { what: row.purpose })
                  : row.effect.next === null
                    ? `${row.effect.label} ${row.effect.now}`
                    : `${row.effect.label} ${row.effect.now} → ${row.effect.next}`}
              </span>
              <button
                className="btn ghost sm"
                data-action="build"
                disabled={!row.can.ok || busy}
                title={row.can.ok ? '' : row.can.reason}
                onClick={() => build(row.id)}
              >
                {row.level === 0 ? t('city.bld.make') : t('city.bld.up')}
              </button>
            </div>
          ))}

          {/* 잠긴 단추만 두면 「고장인가」가 남는다 — **첫 줄의 이유만** 적는다.
              일곱 줄이 같은 이유(도시 레벨)로 잠기는 것이 보통이라 일곱 번 적으면 시끄럽다 */}
          {rows.every((r) => !r.can.ok) && rows[0] && !rows[0].can.ok && (
            <p className="note" data-field="whyBuild">{rows[0].can.reason}</p>
          )}
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
          {/* 잠긴 단추만 두면 「고장인가」가 남는다 — 왜인지는 규칙이 말한다 */}
          {!can.ok && <p className="note" data-field="why">{can.reason}</p>}
          {/* 화면은 눌리는데 서버가 거부한 경우 — 서버가 한 말을 그대로 옮긴다 */}
          {refused && <p className="note" data-field="refused">{refused}</p>}

          <button className="btn wide" data-action="records" onClick={onRecords}>
            {t('city.records')}
          </button>

          {/* 재료는 승리 보상 1뿐이라 Lv2까지 열 판을 이겨야 [증축]이 눌린다.
              「카드 +5」·「금화 +10」과 같은 자리이고 상점이 붙으면 함께 지운다. */}
          <div className="devtools">
            <span className="cap">개발용</span>
            <button
              className="btn ghost sm"
              data-dev="materials"
              onClick={() => onChange({ ...profile, materials: profile.materials + 10 })}
            >
              재료 +10
            </button>
            <span className="dim">시험용 통로다. 상점이 붙으면 없앤다.</span>
          </div>
        </section>
      </div>

      {asking && cost !== null && (
        <UpgradeModal
          profile={profile}
          cost={cost}
          onClose={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            setRefused(null);
            /*
             * **증축은 서버가 한다** (2026-09-04). `PUT /profile`이 `materials`·
             * `buildings`·`buildCredits`를 통째로 버리므로, 로컬로 계산해 올리면
             * 아무 오류 없이 삼켜진다 — 「자재만 줄고 레벨은 그대로」가 된다.
             *
             * **못 닿으면 로컬로 물러난다**(§5-61). 규칙이 거부한 것(400)은 다른
             * 사건이라 물러나지 않고 이유를 보여 준다 — 로컬로 해 봐야 같은
             * 이유로 거부된다.
             */
            void (async () => {
              try {
                const fromServer = await upgradeCityOnServer();
                onChange(fromServer ?? applyCityUpgrade(profile, Date.now()));
              } catch (err) {
                setRefused(err instanceof Error ? err.message : String(err));
              }
            })();
          }}
        />
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
