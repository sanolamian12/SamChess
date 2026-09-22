/**
 * 도적떼 알림 — 메인 위에 뜨는 팝업 셋 (GDD §5.11).
 *
 * | 갈래 | 언제 | 단추 |
 * |---|---|---|
 * | `first` | 출몰을 처음 본 순간(메인 화면) | [항복] · [전투 준비] · [지금 전투] (파수꾼이 없으면 마지막이 [파수꾼 배치]) |
 * | `lastCall` | 남은 1분 — 어느 메타 화면에서든 | 위와 같다 — 제목만 「곧 마감이다」 |
 * | `settled` | 마감이 지나 서버가 항복으로 정산했다 | [확인] |
 *
 * **언제 띄울지는 App이 정한다** — 이 컴포넌트는 그리기만 한다. 남은 시간은 `raidRemainingMs()`
 * (meta)가 내고, 문장은 `raidText.ts`의 것을 쓴다.
 */

import { officerById } from '@samchess/data';
import { guardsOf, raidLoot, raidRemainingMs } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { pickOfficerName } from '../i18n/story.ts';
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
  const guards = guardsOf(profile);
  // 항복하면 잃는 군량 — 서버가 항복을 정산할 때 부르는 것과 **같은 함수**다
  const loss = raidLoot(raid, profile.grain, raid.bandits);
  const left = formatCountdown(raidRemainingMs(raid, nowMs));
  const allies = guards.map((g) => {
    const o = officerById.get(g.officer);
    return o ? pickOfficerName(o) : g.officer;
  }).join(', ');

  return (
    <div className="modal-back raid-alert" data-modal="raidAlert" data-kind={kind}>
      <div className="modal frg-confirm raid-alert-box">
        {kind === 'settled' ? (
          <>
            <p className="modal-ttl">{t('raid.surrendered.title')}</p>
            <p className="frg-confirm-body" data-field="loot" data-loot={raid.loot ?? 0}>
              {t('raid.surrendered.body', { loot: raid.loot ?? 0 })}
            </p>
            {/* [확인]도 [지금 전투]와 같은 옥색 판이다(2026-09-22 지정) */}
            <div className="frg-confirm-acts raid-acts">
              <button className="btn wide raid-btn-fight" data-action="raidOk" onClick={onClose}>
                <span className="lbl">{t('raid.ok')}</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="modal-ttl">{t(kind === 'first' ? 'raid.alert.title' : 'raid.lastCall.title')}</p>
            {/* 「이름 : 값」 세 줄 (2026-09-22 지정) — 규모 · 아군 · 항복 시 피해 */}
            <dl className="raid-info" data-field="body">
              <div className="raid-info-line">
                <dt>{t('raid.alert.k.scale')}</dt>
                <dd data-field="bandits" data-n={raid.bandits}>{t('raid.alert.v.scale', { n: raid.bandits })}</dd>
              </div>
              <div className="raid-info-line">
                <dt>{t('raid.alert.k.allies')}</dt>
                <dd data-field="guards" data-guards={guards.length} data-none={guards.length === 0 ? '1' : '0'}>
                  {guards.length > 0 ? allies : t('raid.alert.v.alliesNone')}
                </dd>
              </div>
              <div className="raid-info-line">
                <dt>{t('raid.alert.k.loss')}</dt>
                <dd data-field="loss" data-loss={loss} className="loss">{t('raid.alert.v.loss', { n: loss })}</dd>
              </div>
            </dl>
            <p className="raid-left" data-field="left">{t('raid.alert.left', { time: left })}</p>
            {error && <p className="note" data-field="error">{error}</p>}
            {/* 단추 셋 — 위에서부터 [항복](붉은 판) · [전투 준비](금빛 두루마리) · [지금 전투](옥색 판).
                파수꾼이 없으면 싸울 수 없으니 마지막 자리가 [파수꾼 배치]다 */}
            <div className="frg-confirm-acts raid-acts">
              <button className="btn wide raid-btn-surrender" data-action="raidSurrender" disabled={busy} onClick={onSurrender}>
                <span className="lbl">{t('raid.surrender')}</span>
              </button>
              <button className="btn wide raid-btn-prepare" data-action="raidPrepare" disabled={busy} onClick={onPrepare}>
                <span className="lbl">{t('raid.prepare')}</span>
              </button>
              {guards.length > 0 ? (
                <button className="btn wide raid-btn-fight" data-action="raidFightNow" disabled={busy} onClick={onFight}>
                  <span className="lbl">{t('raid.fightNow')}</span>
                </button>
              ) : (
                <button className="btn wide raid-btn-fight" data-action="raidToFarm" disabled={busy} onClick={onToFarm}>
                  <span className="lbl">{t('raid.toFarm')}</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
