/**
 * [도시 증축] — 단추 · 막힌 이유 · **올릴 건물 고르기** · 완료 팝업 · 서버 왕복.
 *
 * ★ **2026-11-23 기획자 — 증축과 건물 짓기가 한 단계가 됐다.** 예전에는 증축이 「건설 기회」 셋을 주고 [건물 관리]에서 따로 지었다.
 * 이제는 장수 레벨업이 능력치 · 책략을 고른 채로 오르듯, **증축 팝업에서 서로 다른 건물 셋을 고르고 [증축한다]** 한 번에
 * 도시 레벨과 그 셋이 함께 오른다(meta `applyCityUpgrade(profile, nowMs, picks)`). [건물 관리] 화면은 없어졌고 이 단추는
 * 도시 관리의 바닥 명령 판에 돌아왔다 — 증축 조건표(같은 화면의 위 판)를 보고 바로 누른다.
 *
 * - 고를 수는 `upgradePickCount()` — 보통 셋, 최대가 아닌 건물이 적으면 그 수, **황궁으로 오르는 증축은 0**(모든 건물이 최대가 된다).
 * - 맞는지는 서버도 같은 함수(`checkUpgradePicks`)로 본다 — 화면은 수가 차기 전에 [증축한다]를 막을 뿐이다.
 * - 팝업이 떠 있는지를 부른 쪽에 알린다(`onModal`) — 안내 내관이 그 위로 겹치지 않게 부른 쪽이 미룬다.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  applyCityUpgrade, buildingLevel, buildingRows, canUpgradeCity, MAX_CITY_LEVEL, upgradeCost, upgradePickCount,
} from '@samchess/meta';
import type { BuildingRow, PlayerProfile } from '@samchess/meta';
import type { BuildingId } from '@samchess/data';
import { Say } from './Steward.tsx';
import { upgradeCityOnServer } from '../meta/city.ts';
import { t } from '../i18n/index.ts';
import { reasonText } from '../i18n/reason.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { Celebrate } from './Celebrate.tsx';
import { BuildingLevelBadge, CityLevelBadge, LevelBadge } from './LevelBadge.tsx';
import { BuildingPeek, nextBuilding } from './BuildingPeek.tsx';
import { LEVEL_BADGE_MAX } from '../ui/levelBadge.ts';
import { BuildingIcon, GameIcon } from './GameIcon.tsx';
import { buildingNameText } from './buildingText.ts';
import { useAllLangLayout } from './useAllLangLayout.ts';

/** 방금 끝난 증축 — 오른 도시 레벨과 함께 오른 건물(서버가 준 계정에서 읽은 새 레벨) */
interface Done { level: number; built: { id: BuildingId; level: number; isNew: boolean }[]; allMax: boolean }

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
  /** 방금 끝난 증축. **축하 팝업을 닫아야** 새 판때기가 보인다 (2026-09-04 지정) */
  const [done, setDone] = useState<Done | null>(null);
  const open = asking || busy || done !== null;
  useEffect(() => { onModal?.(open); }, [open]);

  const cost = upgradeCost(profile.cityLevel);
  const can = canUpgradeCity(profile);
  /*
   * **자재가 모자란 것은 안 적는다** — 증축 조건표(같은 화면 위 판)가 이미 말한다. 자재를 무한으로 두고 물으면 남는 것이 곧 「화면에 없는 이유」다
   * (2026-09-14).
   */
  const why = canUpgradeCity({ ...profile, materials: Number.MAX_SAFE_INTEGER });
  const whyShown = !why.ok;

  /*
   * 팝업 · 가리개는 **화면(`.scr`)에** 띄운다 — 단추가 바닥 명령 판 안에 있어 그 자리에 그리면 판을 기준으로 앉아 화면 가운데에서
   * 비껴 선다(`smoke:meta`가 67px로 잡았다). 단추에서 화면을 찾아 그리로 보낸다(장터의 `Layer`와 같은 결)
   */
  const [host, setHost] = useState<HTMLElement | null>(null);
  const layer = (node: React.ReactNode): React.ReactNode => (host ? createPortal(node, host) : node);

  const commit = (picks: BuildingId[]): void => {
    setAsking(false);
    setRefused(null);
    setBusy(true);
    /*
     * **증축은 서버가 한다** (2026-09-04). `PUT /profile`이 `materials`·`buildings`를 통째로 버리므로, 로컬로 계산해 올리면
     * 아무 오류 없이 삼켜진다 — 「자재만 줄고 레벨은 그대로」가 된다. **못 닿으면 로컬로 물러난다**(§5-61). 규칙이 거부한 것(400)은
     * 다른 사건이라 물러나지 않고 이유를 보여 준다.
     *
     * **오른 레벨은 「받은 계정」에서 읽는다** — `+1`로 짐작하면 서버가 다른 판정을 했을 때 축하 팝업만 거짓말을 한다.
     */
    void (async () => {
      try {
        const fromServer = await upgradeCityOnServer(picks);
        const next = fromServer ?? applyCityUpgrade(profile, Date.now(), picks);
        onChange(next);
        setDone({
          level: next.cityLevel,
          built: picks.map((id) => ({ id, level: buildingLevel(next, id), isNew: buildingLevel(profile, id) === 0 })),
          allMax: next.cityLevel >= MAX_CITY_LEVEL,
        });
      } catch (err) {
        setRefused(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <button
        // 다시 그릴 때마다 React가 옛 ref를 `null`로 부른다 — 그때 `host`를 비우면 팝업이 포털 밖으로 나갔다 돌아오며 **통째로 다시 붙어**
        // 축하 화면이 도입부부터 다시 돌았다(군량 정산 같은 주기적 갱신이 축하 도중에 오면, 2026-11-23 look:doneLang이 잡았다). `null`은 무시한다
        ref={(el) => { const scr = el?.closest<HTMLElement>('.scr') ?? null; if (scr && scr !== host) setHost(scr); }}
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
      {/* 왜 안 되는지는 내관이 말한다(2026-11-19 기획자 — 판 안 글씨는 판 크기를 출렁여 걷었다). 자재가 모자란 이유만은 안 말한다 */}
      <Say text={whyShown ? reasonText(why) : null} level={profile.cityLevel} name="why" code={whyShown ? why.code : undefined} />
      <Say text={refused} level={profile.cityLevel} name="refused" repeat />

      {layer(<>
        {asking && cost !== null && (
          <UpgradeModal profile={profile} cue={cue} onClose={() => setAsking(false)} onConfirm={commit} />
        )}

        {/* 증축이 끝났다 — 확인을 누르면 Lv가 오른 판때기가 드러난다. 팝업 뒤의 화면은 **이미 새 값**이다(`onChange`가 먼저 갔다) */}
        {done && <UpgradeDoneModal done={done} onClose={() => setDone(null)} />}

        {/* 왕복이 짧으면 안 보인다 — 뜸을 들여 나타난다(`BusyVeil.tsx`) */}
        {busy && <BusyVeil label={t('city.upgrade.busy')} />}
      </>)}
    </>
  );
}

/**
 * 증축 확인 — **올릴 건물을 고른다** (2026-11-23 기획자). 판은 장수 강화 판(`.lvp-back` · `.lvp-modal`)과 같다.
 *
 * ```
 * ┌───────────────────────────────┐
 * │   [도시] [Lv4 배지]  증축        │  ← 도시 그림 · 오를 도시 레벨 배지 · 「증축」
 * │  선택                   1 / 3   │
 * │ [그림][Lv2] 궁궐          (보기) │  ← 줄 = 전투 명령 단추 그림. 안 고르면 흑백 · 회색 글, 고르면 제 색 + 섬광 + 초록 네온
 * │ [그림][Lv1] 농지          (보기) │  ← 오를 레벨 배지(새로 지으면 Lv1). 최대 레벨은 잠김
 * │ …                               │
 * │ [ 증축한다 ]                     │  ← 셋을 다 골라야 켜진다
 * │ [ 그만둔다 ]                     │
 * └───────────────────────────────┘
 * ```
 *
 * [보기]는 **오른 뒤의** 건물 한 장(`BuildingPeek`의 `future` — 지금 형편 줄은 뺀다). 되돌릴 수 없고 값이 나가는 한 수라 한 번 묻는다.
 * 황궁으로 오르는 증축은 고르지 않는다 — 목록 대신 「모든 건물이 최대 레벨이 된다」 한 줄.
 */
function UpgradeModal({ profile, cue, onClose, onConfirm }: {
  /** 첫 증축의 길이면 [증축한다]도 빛난다(2026-11-13 기획자) */
  profile: PlayerProfile; cue: boolean; onClose: () => void; onConfirm: (picks: BuildingId[]) => void;
}): React.JSX.Element {
  const level = profile.cityLevel;
  const need = upgradePickCount(profile);
  const rows = buildingRows(profile);
  const [picks, setPicks] = useState<BuildingId[]>([]);
  /** [보기]로 연 건물 — 오른 뒤의 한 장 */
  const [peek, setPeek] = useState<BuildingId | null>(null);
  const toggle = (id: BuildingId): void => {
    setPicks((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : xs.length >= need ? xs : [...xs, id]));
  };
  /* 줄 높이 · 목록 높이는 열 언어 가운데 가장 큰 것에 맞춘다 — 몽골어만 긴 이름이 두 줄로 접혀 판이 14px 컸다(2026-11-23, `look:doneLang`) */
  const listRef = useRef<HTMLDivElement>(null);
  useAllLangLayout([{ box: listRef, rows: ':scope > .cty-up-row' }], JSON.stringify([need, rows.map((x) => [x.id, x.level])]));
  const ready = picks.length === need;
  const peeked = peek ? nextBuilding(profile, peek) : null;
  return (
    <div className="lvp-back cty-up-back" data-modal="upgrade" onClick={onClose}>
      <div className="place-panel lvp-modal cty-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="lvp-title cty-up-ttl" data-field="what" data-to={level + 1}>
          <GameIcon name="tab-city" label={t('city.summary.level', { level: level + 1 })} />
          <CityLevelBadge level={level + 1} />
          <span>{t('city.upgrade')}</span>
        </h3>
        {need === 0 ? (
          <p className="row cty-up-allmax" data-field="allMax">{t('city.upgrade.allMax')}</p>
        ) : (
          <>
            <p className="cty-up-head" data-field="pickHead" data-picked={picks.length} data-need={need}>
              <span>{t('city.upgrade.pick')}</span>
              <b>{picks.length} / {need}</b>
            </p>
            <div className="cty-up-list" role="group" ref={listRef}>
              {rows.map((row) => {
                const maxed = row.level >= row.maxLevel;
                const on = picks.includes(row.id);
                const name = buildingNameText(row.id);
                return (
                  // 줄 안에 [보기] 단추가 있어 줄은 `<button>`이 아니라 누를 수 있는 `<div>`다(단추 안에 단추는 못 넣는다)
                  <div
                    key={row.id} className={`cty-up-row${on ? ' on' : ''}`} role="button" tabIndex={maxed ? -1 : 0}
                    data-action="pickBuilding" data-building={row.id} data-on={on ? '1' : '0'} data-maxed={maxed ? '1' : '0'}
                    aria-pressed={on} aria-disabled={maxed}
                    onClick={() => { if (!maxed) toggle(row.id); }}
                    onKeyDown={(e) => { if (!maxed && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(row.id); } }}
                  >
                    <span className="ic cty-up-shine"><BuildingIcon id={row.id} label={name} /></span>
                    <span className="lv"><BuildingLevelBadge level={maxed ? row.level : row.level + 1} /></span>
                    <span className="nm">{name}</span>
                    {!maxed && (
                      <button type="button" className="cty-view" data-action="viewNext" data-building={row.id}
                        aria-label={t('city.bld.view')} title={t('city.bld.view')}
                        onClick={(e) => { e.stopPropagation(); setPeek(row.id); }}>
                        <GameIcon name="mk-view" label={t('city.bld.view')} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className="lv-acts cty-acts">
          <button className="btn primary wide" data-action="upgradeConfirm" data-guide-cue={cue && ready ? '' : undefined}
            disabled={!ready} onClick={() => onConfirm(picks)}>
            {t('city.upgrade.ok')}
          </button>
          <button className="btn wide" data-action="upgradeCancel" onClick={onClose}>
            {t('city.upgrade.cancel')}
          </button>
        </div>
      </div>
      {peeked && (
        // 가리개 클릭이 뒤의 증축 판까지 올라가 닫지 않게 막는다(포털이 아니라 같은 나무라 React 이벤트가 오른다)
        <div onClick={(e) => e.stopPropagation()}>
          <BuildingPeek profile={peeked.profile} row={peeked.row} future onClose={() => setPeek(null)} />
        </div>
      )}
    </div>
  );
}

/**
 * 증축이 **끝났다** — 축하 팝업 (2026-09-04 지정). 큰 글씨 「도시 Lv3」 아래에 **함께 오른 건물**을 한 줄씩(이름 + 새 레벨 배지,
 * 새로 세운 것도 표시 없이 Lv1 배지만 — 2026-11-23 기획자). 황궁에 닿았으면 「모든 건물이 최대 레벨이 되었다」.
 *
 * 뒤 화면은 이미 새 값이다(`onChange`가 먼저 갔다) — 이 팝업이 덮고 있다가 [확인]에 걷힌다.
 * **오른 레벨은 서버가 준 계정에서 읽는다**(부르는 쪽 참조).
 */
function UpgradeDoneModal({ done, onClose }: { done: Done; onClose: () => void }): React.JSX.Element {
  return (
    // 판 · 연출은 공용 축하 판(`Celebrate`, 2026-11-20) — 글만 넘긴다. 크기 · 글자 꼴은 `.cty-done`
    // 비계 탑 위에 도시 레벨 배지 — 배지는 Lv1~10뿐이라 황궁(Lv11)에서는 글만
    <Celebrate modal="upgradeDone" intro="city" className="cty-done" title={t('city.done.title')}
      art={<img className="cel-art-img" src="ui/cel-build.png" alt="" />}
      badge={done.level <= LEVEL_BADGE_MAX ? <LevelBadge level={done.level} className="cel-badge-img" /> : undefined}
      big={t('city.done.level', { lv: done.level })} onClose={onClose}>
      {done.built.length > 0 && (
        <div className="cty-done-blds" data-field="doneBuilt">
          {done.built.map((b) => (
            <p key={b.id} className="lvd-row cty-done-bldrow" data-building={b.id} data-level={b.level} data-new={b.isNew ? '1' : '0'}>
              <BuildingIcon id={b.id} label={buildingNameText(b.id)} text />
              <BuildingLevelBadge level={b.level} />
            </p>
          ))}
        </div>
      )}
      {done.allMax && <p className="row dim" data-field="donePalace">{t('city.done.palace')}</p>}
    </Celebrate>
  );
}
