/**
 * 병원 — 치료실 현황 · 입원 (트랙 11h, 2026-09-18).
 *
 * 위는 **운영 현황판**(병원 레벨 · 치료실 수 · 부상 장수 수, 그리고 치료실마다 한 줄),
 * 아래는 **명령 판**([입원시키기]·[뒤로 가기])이다 — 대장간 홈(`ForgeScreen`)과 같은 틀.
 *
 * ────────────────────────────────────────────────────────────────
 * 치료실 한 줄은 「치료 중 → 쿨타임 → 비었음」이다
 * ────────────────────────────────────────────────────────────────
 *
 * 치료는 **즉시가 아니라 1분**이고 방은 그 뒤 **5분 더 쉰다**(GDD §5.7). 그래서 환자
 * 이름이 보이는 것은 첫 1분뿐이고, 나머지 5분은 누가 쓰고 나갔는지 모르는 쿨타임이다 —
 * 나은 장수의 치료 기록은 `syncCity()`가 지운다. 줄은 `hospitalWards()`(meta)가 내고
 * **번호는 그릴 때 매긴다**(방에 정체성이 없다 — 그 함수의 주석 참조).
 *
 * ────────────────────────────────────────────────────────────────
 * 입원은 서버가 한다 — 못 닿으면 물러나지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * `roster`·`hospitalBusy`가 서버 소유라(A2) 로컬로 `applyHeal`을 부르고 `PUT`하면 되쓰인다 —
 * 화면에서만 입원한 유령이 된다. 그래서 `null`은 「아무것도 안 바뀌었다」(`server.offline`)다.
 * 시간 표기는 **분 단위**(올림)이고 1분이 안 남으면 「1분 이내」다(기획자 지정).
 */

import { useEffect, useMemo, useState } from 'react';
import { officerById } from '@samchess/data';
import {
  HEAL_MS, INJURY_PENALTY, ROOM_CYCLE_MS, freeRooms, hospitalRooms, hospitalWards,
  injuryHealsAt, isHealing, isInjured, nextRoomFreeAt, buildingLevel,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { CityActionRejected, devGrantOnServer, healOnServer } from '../meta/city.ts';
import { currentSession } from '../meta/auth.ts';
import { pickOfficerNameById } from '../i18n/story.ts';
import { buildingBackdrop } from './backdrop.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

/** 다시 그리는 주기 — 표기가 분 단위라 초마다 그릴 까닭이 없다. 판정엔 안 쓴다 */
const REDRAW_MS = 5_000;
const MS_PER_MIN = 60_000;

/** 남은 시간 — 분 단위 올림(「0분」이 안 나온다), 1분이 안 남으면 「1분 이내」 */
function formatLeft(ms: number): string {
  if (ms < MS_PER_MIN) return t('hospital.time.underMin');
  return t('hospital.time.min', { m: Math.ceil(ms / MS_PER_MIN) });
}

const nameOf = (id: OfficerId): string => pickOfficerNameById(id, officerById.get(id)?.name ?? id);

export function HospitalScreen({ profile, onBack, onChange }: {
  profile: PlayerProfile;
  onBack: () => void;
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), REDRAW_MS);
    return () => window.clearInterval(id);
  }, []);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rooms = hospitalRooms(profile);
  const wards = hospitalWards(profile, now);
  const free = freeRooms(profile, now);

  /** 부상 장수 — 기다리는 사람이 먼저, 그 안에서 자연 회복이 먼 사람이 위(병원이 가장 아끼는 사람) */
  const injured = useMemo(() => Object.entries(profile.roster)
    .filter(([, inst]) => isInjured(inst, now))
    .map(([id, inst]) => ({
      id: id as OfficerId,
      level: inst.level,
      healing: isHealing(inst, now),
      left: (injuryHealsAt(inst) ?? now) - now,
    }))
    .sort((a, b) => Number(a.healing) - Number(b.healing) || b.left - a.left),
  [profile.roster, now]);
  const waiting = injured.filter((o) => !o.healing).length;

  /** [입원시키기]가 안 되는 이유 — 되면 `null` */
  const admitBlocked = rooms <= 0 ? t('hospital.notBuilt')
    : waiting === 0 ? t('hospital.admit.none')
    : free <= 0 ? t('hospital.admit.full', { time: formatLeft((nextRoomFreeAt(profile, now) ?? now) - now) })
    : null;

  /** 서버에 시키고 받은 프로필로 갈아 끼운다 — 못 닿았으면 아무것도 안 바뀌었다고 말한다 */
  const run = (call: () => Promise<PlayerProfile | null>, after?: (next: PlayerProfile) => void): void => {
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const next = await call();
        if (next) { onChange(next); after?.(next); } else setError(t('server.offline'));
      } catch (e) {
        setError(e instanceof CityActionRejected ? e.message : String(e));
      } finally {
        setBusy(false);
        setNow(Date.now());
      }
    })();
  };

  // 빈 방이나 기다리는 사람이 다 떨어지면 고르기 팝업을 닫는다 — 더 누를 것이 없다
  const admit = (id: OfficerId): void => run(() => healOnServer(id), (next) => {
    const t2 = Date.now();
    const more = freeRooms(next, t2) > 0
      && Object.values(next.roster).some((inst) => isInjured(inst, t2) && !isHealing(inst, t2));
    if (!more) setPicking(false);
  });

  /** 개발용 — 건강한 장수 셋을 서버 시계로 다치게 한다(헌제는 규칙이 건너뛴다) */
  const devInjure = (): void => {
    const healthy = Object.entries(profile.roster)
      .filter(([id, inst]) => !isInjured(inst, now) && officerById.get(id as OfficerId)?.grade !== 'E')
      .slice(0, 3)
      .map(([id]) => id as OfficerId);
    if (healthy.length === 0) { setError('다치게 할 건강한 장수가 없다'); return; }
    run(() => devGrantOnServer({ injure: healthy }));
  };

  return (
    <ScreenChrome
      backdrop={buildingBackdrop('hospital')}
      className="scr-place scr-building-hospital"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('place.back'))}
        </button>
        <span className="place-nm">{t('place.hospital')}</span>
      </div>

      {/* 운영 현황판 — 제목 바 바로 밑(대장간의 `.frg-status`와 같은 자리) */}
      <div className="place-panel hsp-status" data-field="status">
        <div className="hsp-summary">
          <span data-field="level">{t('hospital.summary.level', { level: buildingLevel(profile, 'hospital') })}</span>
          <span data-field="rooms">{t('hospital.summary.rooms', { n: rooms })}</span>
          <span data-field="injured">{t('hospital.summary.injured', { n: injured.length })}</span>
        </div>
        {rooms <= 0 ? (
          <p className="hint" data-field="notBuilt">{t('hospital.notBuilt')}</p>
        ) : (
          <ol className="hsp-wards">
            {wards.map((w, i) => (
              <li key={i} className="hsp-ward" data-ward={i + 1} data-state={w.state}>
                <span className="hsp-ward-nm">{t('hospital.ward', { n: i + 1 })}</span>
                <span className="hsp-ward-st">
                  {w.state === 'healing'
                    ? t('hospital.ward.healing', { name: nameOf(w.officer), time: formatLeft(w.healedAt - now) })
                    : w.state === 'cooldown'
                      ? t('hospital.ward.cooldown', { time: formatLeft(w.freeAt - now) })
                      : t('hospital.ward.empty')}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* 명령 판 — 화면 바닥(`.place-body`의 `margin-top: auto`) */}
      <div className="place-body">
        <section className="place-panel hsp-home">
          <div className="frg-buttons">
            <button
              className="btn wide"
              data-action="admit"
              disabled={admitBlocked !== null || busy}
              onClick={() => { setError(null); setPicking(true); }}
            >
              <span className="lbl">{t('hospital.admit')}</span>
            </button>
            {/* 안 되는 이유는 제 단추 바로 밑에 — 끝에 몰면 어느 단추 이야기인지 모른다 */}
            {admitBlocked && rooms > 0 && <p className="hint" data-field="admitBlocked">{admitBlocked}</p>}
            <button className="btn wide" data-action="backBottom" onClick={onBack}>
              <span className="lbl">{stripBackArrow(t('match.back'))}</span>
            </button>
          </div>
          {error && !picking && <p className="note" data-field="error">{error}</p>}
        </section>

        {/* 부상을 만드는 길이 전투에서 지는 것뿐이라 병원을 시험하려면 판을 져야 했다.
            장터의 개발용 지급과 같은 자리·같은 스위치(`SAMCHESS_DEV_GRANTS=1`)다 */}
        <div className="devtools">
          <span className="cap">개발용</span>
          <button className="btn ghost sm" data-dev="injure" disabled={busy} onClick={devInjure}>
            장수 3명 부상시키기
          </button>
          <span className="dim">서버 시계로 부상을 찍는다. 헌제는 빠진다.</span>
        </div>
      </div>

      {picking && (
        <div className="modal-back" data-modal="hospitalPick" onClick={() => setPicking(false)}>
          <div className="modal frg-confirm hsp-pick" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t('hospital.pick.title')}</p>
            <p className="frg-confirm-body" data-field="free">
              {t('hospital.pick.free', {
                n: free, heal: HEAL_MS / MS_PER_MIN, cool: (ROOM_CYCLE_MS - HEAL_MS) / MS_PER_MIN,
              })}
            </p>
            <ul className="hsp-list">
              {injured.map((o) => (
                <li key={o.id} className="hsp-row" data-officer={o.id} data-healing={o.healing ? 'true' : 'false'}>
                  {/* 이름 · 부상 · 남은 시간을 **한 칸에 세 줄**로 — 옆 칸에 두었더니 긴 번역(몽골어)의
                      「자연 회복까지」가 폭을 다 가져가 이름이 0폭으로 사라졌다 */}
                  <span className="hsp-row-nm">
                    <b>{nameOf(o.id)}</b>
                    <span className="hsp-row-sub">Lv{o.level} · {t('hospital.penalty', { n: INJURY_PENALTY })}</span>
                    <span className="hsp-row-left" data-field="left">
                      {o.healing
                        ? t('hospital.ward.healing.short', { time: formatLeft(o.left) })
                        : t('hospital.pick.natural', { time: formatLeft(o.left) })}
                    </span>
                  </span>
                  {!o.healing && (
                    <button
                      className="btn primary sm"
                      data-action="admitOfficer"
                      disabled={busy || free <= 0}
                      onClick={() => admit(o.id)}
                    >
                      {t('hospital.pick.ok')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {error && <p className="note" data-field="error">{error}</p>}
            <div className="frg-confirm-acts">
              <button className="btn wide" data-action="closePick" onClick={() => setPicking(false)}>
                {t('hospital.pick.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {busy && <BusyVeil />}
    </ScreenChrome>
  );
}
