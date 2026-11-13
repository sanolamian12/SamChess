/**
 * [도시 증축] — 단추 · 막힌 이유 · 확인 팝업 · 완료 팝업 · 서버 왕복 (2026-11-13 기획자 — 도시 관리에서 **건물 관리**로 옮겼다).
 *
 * 도시 관리는 건물이 들어설수록 줄이 늘어 아래 명령 판을 밀어낸다 — 그래서 증축은 건물 관리의 바닥 명령 판, [뒤로 가기] 위에 선다.
 * 증축 조건표는 여전히 도시 관리의 현황판에 있다(`upgradeChecklist`). 옮긴 것은 모양 그대로이고, 바뀐 것은 둘이다.
 *  · 막힌 이유 가운데 **건설 기회가 남았다**(`city.credits`)는 안 띄운다 — 건물 관리 머리의 「남은 건설 기회 n회」(남았으면 붉은 글)가 같은 말을 한다.
 *  · 팝업이 떠 있는지를 부른 쪽에 알린다(`onModal`) — 안내 내관이 그 위로 겹치지 않게 부른 쪽이 미룬다.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  applyCityUpgrade, BUILD_ACTIONS_PER_UPGRADE, BUILD_CITY_LEVEL, buildCreditsLeft, canUpgradeCity, upgradeCost,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { upgradeCityOnServer } from '../meta/city.ts';
import { t } from '../i18n/index.ts';
import { reasonText } from '../i18n/reason.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { FitLine } from './FitLine.tsx';
import { GameIcon } from './GameIcon.tsx';

export function CityUpgrade({ profile, onChange, cue, onModal }: {
  profile: PlayerProfile;
  onChange: (next: PlayerProfile) => void;
  /** 첫 증축의 길이면 단추 · [증축한다]가 빛난다(meta `growthCue` === 'upgrade') */
  cue: boolean;
  /** 확인 · 완료 팝업이나 서버 왕복이 떠 있는가 */
  onModal?: (open: boolean) => void;
}): React.JSX.Element {
  const [asking, setAsking] = useState(false);
  /** 서버가 거부한 이유. **규칙이 한 말을 그대로 보여 준다** — 화면이 다시 짓지 않는다 */
  const [refused, setRefused] = useState<string | null>(null);
  /** 서버 왕복 중 — 가리개를 덮는다(`BusyVeil`). 「멈춘 것」과 「기다리는 것」은 다르다 */
  const [busy, setBusy] = useState(false);
  /** 방금 오른 도시 레벨. **축하 팝업을 닫아야** 새 판때기가 보인다 (2026-09-04 지정) */
  const [done, setDone] = useState<number | null>(null);
  const open = asking || busy || done !== null;
  useEffect(() => { onModal?.(open); }, [open]);

  const cost = upgradeCost(profile.cityLevel);
  const can = canUpgradeCity(profile);
  /*
   * **자재가 모자란 것은 안 적는다** — 증축 조건표(도시 관리)가 이미 말한다. 자재를 무한으로 두고 물으면 남는 것이 곧 「화면에 없는 이유」다
   * (2026-09-14). **건설 기회가 남은 것도 안 적는다**(2026-11-13) — 이 화면 머리의 「남은 건설 기회 n회」가 말한다.
   */
  const why = canUpgradeCity({ ...profile, materials: Number.MAX_SAFE_INTEGER });
  const whyShown = !why.ok && why.code !== 'city.credits';

  /*
   * 팝업 · 가리개는 **화면(`.scr`)에** 띄운다 — 단추가 바닥 명령 판 안에 있어 그 자리에 그리면 판을 기준으로 앉아 화면 가운데에서
   * 비껴 선다(`smoke:meta`가 67px로 잡았다). 단추에서 화면을 찾아 그리로 보낸다(장터의 `Layer`와 같은 결)
   */
  const [host, setHost] = useState<HTMLElement | null>(null);
  const layer = (node: React.ReactNode): React.ReactNode => (host ? createPortal(node, host) : node);

  return (
    <>
      <button
        ref={(el) => { const scr = el?.closest<HTMLElement>('.scr') ?? null; if (scr !== host) setHost(scr); }}
        className="btn wide primary"
        data-action="upgrade"
        data-guide-cue={cue ? '' : undefined}
        disabled={!can.ok}
        onClick={() => setAsking(true)}
      >
        {cost === null
          ? <GameIcon name="bld-max" label={t('city.upgrade.max')} text />
          : (
            // 「도시 증축 ([자재] -10)」 — 무엇을 내는지 글자 대신 자재 그림으로 (2026-11-12 지정)
            <>
              <GameIcon name="city-upgrade" label={t('city.upgrade')} text />
              <span className="cty-cost" data-field="cost" data-cost={cost}>
                (<GameIcon name="res-materials" label={t('city.materials')} />-{cost})
              </span>
            </>
          )}
      </button>
      {/* 왜 안 되는지는 **[도시 증축] 바로 밑**에 판 안의 글씨로 (2026-09-18 지정 — 예전엔
          판 밖 주황 글씨였다). 규칙이 거부한 것(`why`)과 서버가 거부한 것(`refused`)이
          같은 자리에 온다 — 둘 다 이 단추의 이야기다. 자재가 모자란 이유만은 안 뜬다
          (자재 줄의 「75 / 25」가 이미 말한다, `why` 주석 참조). 규칙의 이유는 **코드로
          번역한다**(`reasonText`) — 서버가 거부한 이유(`refused`)는 코드가 없어 원문이다 */}
      {(whyShown || refused) && (
        <div className="cty-whys">
          {whyShown && <p className="cty-why" data-field="why" data-code={why.code}><GameIcon name="mk-lock" label={reasonText(why)} text /></p>}
          {refused && <p className="cty-why" data-field="refused">{refused}</p>}
        </div>
      )}

      {layer(<>
      {asking && cost !== null && (
        <UpgradeModal
          profile={profile}
          cue={cue}
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


      {/* 왕복이 짧으면 안 보인다 — 뜸을 들여 나타난다(`BusyVeil.tsx`) */}
      {busy && <BusyVeil label={t('city.upgrade.busy')} />}
      </>)}
    </>
  );
}

/**
 * 증축 확인.
 *
 * 되돌릴 수 없고 값이 나가는 한 수라 한 번 묻는다(재설계와 같은 결).
 *
 * **큰 글씨로 「도시 Lv1 → Lv2」 하나뿐이다** (2026-11-13 기획자 — 설명은 뺐다). 내는 자재는 누른 단추(「도시 증축 (-10)」)가
 * 이미 말했고, 얻는 것(건설 기회 · 건물 짓기)은 끝난 뒤의 축하 팝업(`UpgradeDoneModal`)과 안내 내관(`city.build`)이 말한다.
 */
function UpgradeModal({ profile, cue, onClose, onConfirm }: {
  /** 첫 증축의 길이면 [증축한다]도 빛난다(2026-11-13 기획자) */
  profile: PlayerProfile; cue: boolean; onClose: () => void; onConfirm: () => void;
}): React.JSX.Element {
  const level = profile.cityLevel;
  return (
    <div className="modal-back" data-modal="upgrade" onClick={onClose}>
      <div className="modal mod-plank cty-modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('city.upgrade.title')}</p>
        <p className="cty-up-lv" data-field="what">{t('city.upgrade.levels', { from: level, to: level + 1 })}</p>
        <div className="cty-acts">
          <button className="btn primary wide" data-action="upgradeConfirm" data-guide-cue={cue ? '' : undefined} onClick={onConfirm}>
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
 * | 큰 글씨 「도시 Lv2」 | 언제나 (「도시가 Lv2가 되었다」 줄은 2026-11-13에 뺐다 — 같은 말이다) |
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
      {/* 제목 1.3배 · 「도시 Lv2」 · 아래 줄 0.8배 — 「도시가 Lv2가 되었다」는 큰 글씨와 같은 말이라 뺐다 (2026-11-13 기획자).
          크기는 `.cty-done` 공통 — 건물 관리의 완료 팝업도 같은 꼴이다 */}
      <div className="modal cty-modal cty-done" onClick={(e) => e.stopPropagation()}>
        <FitLine className="modal-ttl" field="doneTitle" text={t('city.done.title')} />
        <FitLine className="cty-done-lv" field="doneLevel" text={t('city.done.level', { lv: level })} />
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
