/**
 * 도적떼 알림 — 메인 위에 뜨는 팝업 셋 (GDD §5.11).
 *
 * | 갈래 | 언제 | 단추 |
 * |---|---|---|
 * | `first` | 출몰을 처음 본 순간(메인 화면) | [지금 전투] · [전투 준비] (파수꾼이 없으면 [파수꾼 배치]) |
 * | `lastCall` | 남은 1분 — 어느 메타 화면에서든 | [지금 전투] · [항복] |
 * | `settled` | 마감이 지나 서버가 항복으로 정산했다 | [확인] |
 *
 * **언제 띄울지는 App이 정한다** — 이 컴포넌트는 그리기만 한다. 남은 시간은 `raidRemainingMs()`
 * (meta)가 내고, 문장은 `raidText.ts`의 것을 쓴다.
 */

import { RAID_LOOT_PCT, RAID_RESPONSE_MS, guardsOf, raidRemainingMs } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { formatCountdown } from './raidText.ts';

export type RaidAlertKind = 'first' | 'lastCall' | 'settled';

export function RaidAlert({ kind, profile, nowMs, busy, error, onFight, onPrepare, onSurrender, onToFarm, onClose }: {
  kind: RaidAlertKind;
  profile: PlayerProfile;
  nowMs: number;
  busy: boolean;
  error: string | null;
  onFight: () => void;
  onPrepare: () => void;
  onSurrender: () => void;
  onToFarm: () => void;
  onClose: () => void;
}): React.JSX.Element | null {
  useLang();
  const raid = profile.raid;
  if (!raid) return null;
  const guards = guardsOf(profile).length;
  const pct = raid.bandits * RAID_LOOT_PCT;
  const left = formatCountdown(raidRemainingMs(raid, nowMs));

  return (
    <div className="modal-back raid-alert" data-modal="raidAlert" data-kind={kind}>
      <div className="modal frg-confirm raid-alert-box">
        {kind === 'settled' ? (
          <>
            <p className="modal-ttl">{t('raid.surrendered.title')}</p>
            <p className="frg-confirm-body" data-field="loot" data-loot={raid.loot ?? 0}>
              {t('raid.surrendered.body', { loot: raid.loot ?? 0 })}
            </p>
            <div className="frg-confirm-acts">
              <button className="btn primary wide" data-action="raidOk" onClick={onClose}>{t('raid.ok')}</button>
            </div>
          </>
        ) : (
          <>
            <p className="modal-ttl">{t(kind === 'first' ? 'raid.alert.title' : 'raid.lastCall.title')}</p>
            <p className="frg-confirm-body" data-field="body">
              {kind === 'first'
                ? t('raid.alert.body', { n: raid.bandits, min: Math.round(RAID_RESPONSE_MS / 60_000), pct })
                : t('raid.lastCall.body', { pct })}
            </p>
            <p className="frg-confirm-body" data-field="guards" data-guards={guards}>
              {guards > 0 ? t('raid.alert.guards', { n: guards }) : t('raid.alert.noGuards')}
            </p>
            <p className="raid-left" data-field="left">{t('raid.alert.left', { time: left })}</p>
            {error && <p className="note" data-field="error">{error}</p>}
            <div className="frg-confirm-acts">
              {guards > 0 ? (
                <button className="btn primary wide" data-action="raidFightNow" disabled={busy} onClick={onFight}>
                  {t('raid.fightNow')}
                </button>
              ) : (
                <button className="btn primary wide" data-action="raidToFarm" disabled={busy} onClick={onToFarm}>
                  {t('raid.toFarm')}
                </button>
              )}
              {kind === 'first' ? (
                <button className="btn wide" data-action="raidPrepare" disabled={busy} onClick={onPrepare}>
                  {t('raid.prepare')}
                </button>
              ) : (
                <button className="btn wide" data-action="raidSurrender" disabled={busy} onClick={onSurrender}>
                  {t('raid.surrender')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
