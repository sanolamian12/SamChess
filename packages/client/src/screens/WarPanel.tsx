/**
 * 선전포고의 화면 둘 (2026-10-28, GDD §8.8 단계 4 — 규칙은 `@samchess/meta`의 `war.ts`, 서버는 `server-api/src/war.ts`).
 *
 * ```
 * 건 쪽 (공성전 상세 안 · WarOutbox)          받은 쪽 (어느 화면에서든 · WarInbox, App이 띄운다)
 * 「전하는 중」 ─ [취소]                       ┌ 선전포고! ─────────────────┐
 * 「회신을 기다립니다 · 24초」 ─ [취소]         │ 낙양 Lv3 · 부대 초전박살    │
 * 상대 부대 · 예상 승률 · 「18초 안에 수락」     │ [부대 A] [부대 B(수비군)]   │
 *   [수락](참가비) [취소]                       │ 30초 · [응전] [거절]        │
 * 「전장으로 갑니다」 → 전투                    └ 「수락을 기다립니다」 → 전투 ┘
 * ```
 *
 * 남은 시간은 서버가 낸 **남은 ms**를 받은 순간부터 화면 시계로 센다(절대시각을 싣지 않는다 — 전투 전선과 같은 규약).
 * 걸려 있는 동안 `WAR_POLL_MS`마다 묻는다. 수락되면 두 화면이 각자 같은 id로 대전 방에 붙는다(`connectWarBattle`) —
 * 그다음은 온라인 대전 그대로다(App의 `enterOnline`). **참가비는 방이 열릴 때 서버가 낸다.**
 * 건 쪽이 상세를 닫으면(화면을 떠나면) 걸어 둔 선전포고는 취소된다 — 닫힌 화면에서 수락을 기다리는 사람이 없다.
 */

import { useEffect, useRef, useState } from 'react';
import {
  WAR_POLL_MS, garrisonOf, grainCost, isWarOpen, opponentMembers, rewardTier, squadsOf, winChance,
} from '@samchess/meta';
import type { MatchOpponent, PlayerProfile, Squad, WarSquadView, WarStatus, WarView } from '@samchess/meta';
import { connectWarBattle } from '../battle/online.ts';
import type { OnlineTransport } from '../battle/online.ts';
import { currentSession } from '../meta/auth.ts';
import { answerWar, fetchWar, replyWar } from '../meta/war.ts';
import { GameIcon } from './GameIcon.tsx';
import { GrainCost } from './GrainCost.tsx';
import { t } from '../i18n/index.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

/** 전투가 선다 — 붙은 판정 주체 · 상대(방이 낸 값) · 내 부대 */
export type WarBattle = (transport: OnlineTransport, opponent: MatchOpponent, squad: Squad) => void;

/** 끝난 까닭 — 화면에 남기는 한 줄 */
type WarEnd = 'declined' | 'expired' | 'cancelled' | 'noShow' | 'failed';

/** 선전포고 한 장을 들고 묻는다 — 열린 동안 `WAR_POLL_MS`마다. 남은 초는 화면 시계로 센다 */
function useWar(initial: WarView): { war: WarView; set: (w: WarView) => void; left: number | null } {
  const [war, setWar] = useState(initial);
  const [deadline, setDeadline] = useState(() => deadlineOf(initial));
  const [, tick] = useState(0);
  const set = (w: WarView): void => { setWar(w); setDeadline(deadlineOf(w)); };

  const polling = isWarOpen(war.status) && war.status !== 'accepted';
  useEffect(() => {
    if (!polling) return undefined;
    let live = true;
    const id = setInterval(() => {
      void fetchWar(war.id).then((r) => { if (live && r.ok) set(r.war); });
    }, WAR_POLL_MS);
    const clock = setInterval(() => tick((n) => n + 1), 250);
    return () => { live = false; clearInterval(id); clearInterval(clock); };
  }, [war.id, polling]);

  const left = deadline === null ? null : Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
  return { war, set, left };
}

const deadlineOf = (w: WarView): number | null => (w.remainingMs === null ? null : performance.now() + w.remainingMs);

/**
 * 수락된 선전포고의 방에 붙는다 — 한 번만(두 번 붙으면 같은 방에 같은 사람이 두 자리를 찾는다). **`started`에서도 붙는다** —
 * 먼저 붙은 쪽이 방을 만드는 순간 서버가 `started`로 옮기므로, 늦게 물은 쪽은 `accepted`를 못 보고 그것을 받는다(war_ux가 잡았다).
 */
function useJoin(war: WarView, squad: Squad | null, onBattle: WarBattle, onFail: (why: WarEnd) => void): void {
  const joined = useRef(false);
  useEffect(() => {
    if ((war.status !== 'accepted' && war.status !== 'started') || !squad || joined.current) return;
    joined.current = true;
    connectWarBattle(war.id, {
      playerId: currentSession()?.uid ?? '', entries: [], squadName: squad.name, power: 0, deploy: null, mode: war.mode,
    }).then(
      ({ transport, opponent }) => onBattle(transport, opponent, squad),
      (e: unknown) => { console.warn('[war] 방에 못 붙었다', e); onFail(e instanceof Error && e.message === 'war.noShow' ? 'noShow' : 'failed'); },
    );
  }, [war.status]);
}

const endOf = (w: WarView): WarEnd | null =>
  w.status === 'declined' || w.status === 'expired' || w.status === 'cancelled' ? w.status : null;

/** 부대 한 줄 — 이름 · 장수 · 전투력 */
function SquadBrief({ squad, field }: { squad: WarSquadView; field: string }): React.JSX.Element {
  const members = opponentMembers({ kind: 'online', id: '', squadName: squad.squadName, entries: squad.entries, power: squad.power });
  return (
    <div className="war-squad" data-field={field} data-squad={squad.squadId} data-power={squad.power}>
      <p className="row">{t('war.squad', { squad: squad.squadName, power: squad.power.toLocaleString() })}</p>
      <ul className="sge-members">
        {members.map((m) => <li key={m.piece} data-officer={m.officer}>{pickOfficerNameById(m.officer, m.name)} Lv{m.level}</li>)}
      </ul>
    </div>
  );
}

/**
 * 건 쪽 — 공성전 상세 안에서 걸어 둔 선전포고를 지켜본다. 끝나면(거절 · 만료 · 취소 · 상대가 안 옴) `onEnd`로 까닭을 넘기고
 * 상세가 원래 모양으로 돌아간다(쿨다운은 서버가 센다).
 */
export function WarOutbox({ initial, squad, myPower, grain, onBattle, onEnd, onStatus }: {
  initial: WarView; squad: Squad; myPower: number; grain: number;
  onBattle: WarBattle; onEnd: (why: WarEnd) => void;
  /** 걸음이 바뀌었다 — 상세가 회신을 받은 뒤 수비군 칸을 접는다(상대가 고른 부대가 그 자리를 대신한다) */
  onStatus?: (s: WarStatus) => void;
}): React.JSX.Element {
  const { war, set, left } = useWar(initial);
  useEffect(() => { onStatus?.(war.status); }, [war.status]);
  const [busy, setBusy] = useState(false);
  const live = useRef(war);
  live.current = war;

  useEffect(() => { const why = endOf(war); if (why) onEnd(why); }, [war.status]);
  useJoin(war, squad, onBattle, onEnd);
  // 화면을 떠나면 걸어 둔 것을 거둔다 — 수락된 뒤라면 방이 사람을 기다리다 접힌다(참가비 없음)
  useEffect(() => () => {
    const w = live.current;
    if (isWarOpen(w.status) && w.status !== 'accepted') void answerWar(w.id, false);
  }, []);

  const answer = async (accept: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const r = await answerWar(war.id, accept);
    setBusy(false);
    if (r.ok) set(r.war);
    else { const again = await fetchWar(war.id); if (again.ok) set(again.war); }
  };

  const city = war.defender.cityName;
  const foe = war.defenderSquad;
  return (
    <div className="war-box" data-war={war.id} data-war-role="attacker" data-war-status={war.status}>
      {war.status === 'sent' && <p className="row" data-field="warState">{t('war.sending', { city })}</p>}
      {war.status === 'delivered' && (
        <p className="row" data-field="warState">{t('war.waitReply', { city })} <b data-field="warLeft">{t('war.left', { n: left ?? 0 })}</b></p>
      )}
      {war.status === 'replied' && foe && (
        <>
          <p className="row" data-field="warState">{t('war.replied', { city })}</p>
          <SquadBrief squad={foe} field="foeSquad" />
          <p className="row" data-field="odds">
            {t('match.odds', { mine: myPower.toLocaleString(), theirs: foe.power.toLocaleString(), pct: Math.round(winChance(myPower, foe.power) * 100) })}
          </p>
          {rewardTier({ mine: myPower, theirs: foe.power }) === 'weak' && (
            <p className="note" data-field="weak"><GameIcon name="mk-warn" label={t('siege.weak')} text /></p>
          )}
          <p className="hint" data-field="warLeft">{t('war.acceptLeft', { n: left ?? 0 })}</p>
        </>
      )}
      {(war.status === 'accepted' || war.status === 'started') && <p className="row" data-field="warState">{t('war.joining')}</p>}
      <div className="srt-modal-acts">
        {war.status === 'replied' && (
          <button className="btn primary wide" data-action="warAccept" disabled={busy} onClick={() => { void answer(true); }}>
            <span className="lbl">{t('war.accept')}</span>
            <GrainCost n={grainCost(war.mode)} have={grain} />
          </button>
        )}
        {isWarOpen(war.status) && war.status !== 'accepted' && (
          <button className="btn wide" data-action="warCancel" disabled={busy} onClick={() => { void answer(false); }}>
            {t('war.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 받은 쪽 — 어느 화면에서든 뜨는 팝업(App). 그 모드의 내 부대 하나를 골라(수비군이 먼저 골라져 있다) [응전], 또는 [거절].
 * 응전하면 건 쪽의 수락을 기다리고, 수락되면 전투로 간다. 끝나면 까닭을 한 줄 남기고 [확인]으로 닫는다.
 */
export function WarInbox({ initial, profile, onBattle, onClose }: {
  initial: WarView; profile: PlayerProfile; onBattle: WarBattle; onClose: () => void;
}): React.JSX.Element {
  const { war, set, left } = useWar(initial);
  const squads = squadsOf(profile, war.mode);
  const [pick, setPick] = useState<string | null>(() => garrisonOf(profile, war.mode)?.id ?? squads[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [end, setEnd] = useState<WarEnd | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mine = squads.find((s) => s.id === (war.defenderSquad?.squadId ?? pick)) ?? null;

  useEffect(() => { const why = endOf(war); if (why) setEnd(why); }, [war.status]);
  useJoin(war, mine, onBattle, setEnd);

  const reply = async (squadId: string | null): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const r = await replyWar(war.id, squadId);
    setBusy(false);
    if (r.ok) { set(r.war); return; }
    if (r.code === 'war.stale') { const again = await fetchWar(war.id); if (again.ok) set(again.war); return; }
    setErr(t(r.code === 'war.noGrain' ? 'war.err.noGrain' : 'war.err.reply'));
  };

  const { attacker } = war;
  return (
    <div className="modal-back" data-modal="warInbox" data-war={war.id} data-war-status={end ?? war.status}>
      <div className="modal mod-plank srt-modal war-inbox" onClick={(e) => e.stopPropagation()}>
        <h3 data-field="warTitle">{t('war.in.title')}</h3>
        <p className="row sge-target-head" data-field="city"><b>{attacker.cityName}</b> Lv{attacker.cityLevel}</p>
        <SquadBrief squad={war.attackerSquad} field="foeSquad" />
        {end ? (
          <p className="note" data-field="warEnd" data-end={end}>{t(`war.end.${end}`)}</p>
        ) : war.status === 'delivered' ? (
          <>
            <p className="hint" data-field="warPick">{t('war.in.pick', { mode: war.mode })}</p>
            {squads.length === 0 ? (
              <p className="note" data-field="warNone">{t('war.in.none')}</p>
            ) : (
              <div className="war-squads">
                {squads.map((s) => (
                  <button key={s.id} className="btn wide" data-squad={s.id} data-on={pick === s.id ? '1' : '0'} aria-pressed={pick === s.id}
                    disabled={busy} onClick={() => setPick(s.id)}>
                    <span className="lbl">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="hint" data-field="warLeft">{t('war.replyLeft', { n: left ?? 0 })}</p>
          </>
        ) : war.status === 'replied' ? (
          <p className="row" data-field="warState">{t('war.in.waitAccept')}</p>
        ) : war.status === 'accepted' || war.status === 'started' ? (
          <p className="row" data-field="warState">{t('war.joining')}</p>
        ) : null}
        {err && <p className="note" data-field="error">{err}</p>}
        <div className="srt-modal-acts">
          {end ? (
            <button className="btn wide" data-action="warOk" onClick={onClose}>{t('war.ok')}</button>
          ) : war.status === 'delivered' ? (
            <>
              <button className="btn primary wide" data-action="warFight" disabled={busy || !pick} onClick={() => { void reply(pick); }}>
                <span className="lbl">{t('war.in.fight')}</span>
                <GrainCost n={grainCost(war.mode)} have={profile.grain} />
              </button>
              <button className="btn wide" data-action="warDecline" disabled={busy} onClick={() => { void reply(null); }}>
                {t('war.in.decline')}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
