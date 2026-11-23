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
import { BuildingLevelBadge, LevelBadge } from './LevelBadge.tsx';
import { LEVEL_BADGE_MAX } from '../ui/levelBadge.ts';
import { BuildingIcon, GameIcon } from './GameIcon.tsx';
import { buildingLineText, buildingNameText } from './buildingText.ts';
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
      <Say text={refused} level={profile.cityLevel} name="refused" />

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

/** 건물 한 줄에 적을 효과 — 규칙이 낸 줄(`buildingLineText`)에 셋만 갈아 끼운다(옛 [건물 관리]의 `lineOf` 그대로) */
function effectLine(row: BuildingRow): string {
  if (row.id === 'market') return t('city.bld.market.what');
  if (row.id === 'forge') return t('city.bld.forge.what');
  if (row.id === 'farm' && row.level === 0 && row.effect?.next != null) {
    return t('city.bld.farm.gain', { n: row.effect.next - row.effect.now });
  }
  return buildingLineText(row) ?? t('city.bld.pending', { what: row.purpose });
}

/** 「[Lv1] → [Lv2]」 · 「없음 → [Lv1]」, 만렙은 「[Lv5]」 하나 — 레벨은 배지 그림(2026-11-19 기획자) */
function StepLevels({ row }: { row: BuildingRow }): React.JSX.Element {
  const from = row.level > 0 ? <BuildingLevelBadge level={row.level} /> : <span className="bld-none">{t('city.bld.none')}</span>;
  if (row.level >= row.maxLevel) return <span className="bld-step">{from}</span>;
  return <span className="bld-step">{from}<span className="bld-arrow">→</span><BuildingLevelBadge level={row.level + 1} /></span>;
}

/**
 * 증축 확인 — **올릴 건물을 고른다** (2026-11-23 기획자).
 *
 * ```
 * ┌ 증 축 ──────────────────────┐
 * │      도시 Lv2 → Lv3          │
 * │  올릴 건물  1 / 3             │
 * │  [궁궐   Lv1 → Lv2]  ✓       │  ← 누르면 고르고 · 다시 누르면 푼다 (최대 레벨은 잠김)
 * │  [병영   Lv1 → Lv2]          │
 * │  …                           │
 * │  ┌ 고른 건물의 효과 한 줄 ┐    │  ← 마지막에 누른 건물. 높이는 두 줄로 못 박는다(판이 출렁이지 않게)
 * │  [ 증축한다 ]  [ 그만둔다 ]   │  ← 셋을 다 골라야 켜진다
 * └─────────────────────────────┘
 * ```
 *
 * 되돌릴 수 없고 값이 나가는 한 수라 한 번 묻는다. 황궁으로 오르는 증축은 고르지 않는다 — 목록 대신 「모든 건물이 최대 레벨이 된다」 한 줄.
 */
function UpgradeModal({ profile, cue, onClose, onConfirm }: {
  /** 첫 증축의 길이면 [증축한다]도 빛난다(2026-11-13 기획자) */
  profile: PlayerProfile; cue: boolean; onClose: () => void; onConfirm: (picks: BuildingId[]) => void;
}): React.JSX.Element {
  const level = profile.cityLevel;
  const need = upgradePickCount(profile);
  const rows = buildingRows(profile);
  const [picks, setPicks] = useState<BuildingId[]>([]);
  /** 효과 줄이 보여 줄 건물 — 마지막에 누른 것 */
  const [focus, setFocus] = useState<BuildingId | null>(null);
  const toggle = (id: BuildingId): void => {
    setFocus(id);
    setPicks((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : xs.length >= need ? xs : [...xs, id]));
  };
  const focusRow = rows.find((r) => r.id === focus) ?? null;
  /* 줄 높이 · 목록 높이는 열 언어 가운데 가장 큰 것에 맞춘다 — 몽골어만 긴 이름이 두 줄로 접혀 판이 14px 컸다(2026-11-23, `look:doneLang`) */
  const listRef = useRef<HTMLDivElement>(null);
  useAllLangLayout([{ box: listRef, rows: ':scope > .cty-up-row' }], JSON.stringify([need, rows.map((x) => [x.id, x.level])]));
  const ready = picks.length === need;
  return (
    <div className="modal-back" data-modal="upgrade" onClick={onClose}>
      <div className="modal mod-plank cty-modal cty-up" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('city.upgrade.title')}</p>
        <p className="cty-up-lv" data-field="what">{t('city.upgrade.levels', { from: level, to: level + 1 })}</p>
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
                return (
                  <button
                    key={row.id} type="button" className={`cty-up-row${on ? ' on' : ''}`}
                    data-action="pickBuilding" data-building={row.id} data-on={on ? '1' : '0'}
                    aria-pressed={on} disabled={maxed}
                    onClick={() => toggle(row.id)}
                  >
                    <span className="nm"><BuildingIcon id={row.id} label={buildingNameText(row.id)} text /></span>
                    <span className="lv"><StepLevels row={row} /></span>
                    <span className="ck" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <p className="cty-up-what" data-field="pickWhat">{focusRow ? effectLine(focusRow) : t('city.upgrade.pickHint', { n: need })}</p>
          </>
        )}
        <div className="cty-acts">
          <button className="btn primary wide" data-action="upgradeConfirm" data-guide-cue={cue && ready ? '' : undefined}
            disabled={!ready} onClick={() => onConfirm(picks)}>
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
 * 증축이 **끝났다** — 축하 팝업 (2026-09-04 지정). 큰 글씨 「도시 Lv3」 아래에 **함께 오른 건물**을 한 줄씩(이름 + 새 레벨 배지,
 * 새로 세운 것은 「건설」 표시). 황궁에 닿았으면 「모든 건물이 최대 레벨이 되었다」.
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
            <p key={b.id} className="cty-done-bldrow" data-building={b.id} data-level={b.level} data-new={b.isNew ? '1' : '0'}>
              <BuildingIcon id={b.id} label={buildingNameText(b.id)} text />
              {b.isNew && <span className="cty-done-new">{t('city.done.new')}</span>}
              <BuildingLevelBadge level={b.level} />
            </p>
          ))}
        </div>
      )}
      {done.allMax && <p className="row dim" data-field="donePalace">{t('city.done.palace')}</p>}
    </Celebrate>
  );
}
