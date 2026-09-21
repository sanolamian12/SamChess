/**
 * 농지 — 파수꾼 · 오늘의 도적떼 (GDD §5.11, 2026-09-21)
 *
 * ```
 * [←] 농지
 * ┌ 현황 ─────────────────────────────────────────┐
 * │ 농지 Lv3 · 시간당 군량 6 · 파수꾼 2/3             │
 * │ 오늘의 도적떼 — 도적 3명이 농지를 노린다 · 8:12   [전투하기] │
 * └──────────────────────────────────────────────┘
 * ┌ 파수꾼 ────────────────────────────────────────┐
 * │ [King ] [사진] 가후  S  Lv5            [빼기]    │
 * │ [Rock ] [사진] 서황  A  Lv3            [빼기]    │
 * │  빈 자리                                        │
 * │ [ 파수꾼 세우기 ]                                │
 * └──────────────────────────────────────────────┘
 * ```
 *
 * 병원과 같은 틀이다 — 위가 현황판, 아래가 명령 판.
 *
 * **성립하는지는 규칙이 말한다** — 칸 수 · King 필수 · 부대 장수 불가는 `validateGuards()`가
 * 정하고, 화면은 그 규칙을 목록에서 미리 보여 줄 뿐이다(첫 파수꾼은 King만 고를 수 있고,
 * 부대에 든 장수는 흐리게 「부대 편성 중」). 파수꾼은 클라이언트 소유라 `PUT`으로 저장된다 —
 * 서버는 전투를 시작할 때 `guardsOf()`로 다시 거른다.
 */

import { useEffect, useMemo, useState } from 'react';
import { officerById } from '@samchess/data';
import {
  INJURY_PENALTY, PIECE_TYPES, buildingLevel, grainPerHour, guardSlots, guardsOf, isInjured,
  officerDuty, raidActive, setGuards, validateGuards,
} from '@samchess/meta';
import type { PlayerProfile, RosterPick } from '@samchess/meta';
import type { OfficerId, PieceType } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { pickOfficerName } from '../i18n/story.ts';
import { reasonText } from '../i18n/reason.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { buildingBackdrop } from './backdrop.ts';
import { OfficerArt } from './OfficerArt.tsx';
import { raidStatusText } from './raidText.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';

/** 고르기 목록의 차례 — 레벨이 같으면 높은 등급이 위. 헌제(E)는 맨 뒤다 */
const GRADE_ORDER = ['S', 'A', 'B', 'C', 'D', 'E'];

/** 카운트다운이 초 단위라 1초마다 다시 그린다. 판정엔 안 쓴다 — 마감은 서버가 정한다 */
const REDRAW_MS = 1_000;

export function FarmScreen({ profile, onBack, onChange, onFight }: {
  profile: PlayerProfile;
  onBack: () => void;
  /** 파수꾼을 바꾼 계정 — 부르는 쪽이 저장한다 */
  onChange: (next: PlayerProfile) => void;
  /** [전투하기] — 서버에 시작을 시키고 전투로 가는 일은 App이 한다(메인의 단추와 같은 길) */
  onFight: () => void;
}): React.JSX.Element {
  useLang();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), REDRAW_MS);
    return () => window.clearInterval(id);
  }, []);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const level = buildingLevel(profile, 'farm');
  const slots = guardSlots(profile);
  const guards = guardsOf(profile);
  const raid = profile.raid;
  const hasKing = guards.some((g) => g.piece === 'King');

  /** 규칙을 지나서만 저장한다 — 거부되면 그 이유를 그대로 보여 준다 */
  const save = (next: RosterPick[]): boolean => {
    const check = validateGuards(profile, next);
    if (!check.ok) { setError(reasonText(check)); return false; }
    setError(null);
    onChange(setGuards(profile, next));
    return true;
  };

  const remove = (officer: OfficerId): void => { save(guards.filter((g) => g.officer !== officer)); };

  return (
    <ScreenChrome
      backdrop={buildingBackdrop('farm')}
      className="scr-place scr-building-farm"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('place.back'))}
        </button>
        <span className="place-nm">{t('place.farm')}</span>
      </div>

      <div className="place-panel hsp-status frm-status" data-field="status">
        <div className="hsp-summary">
          <span data-field="level">{t('farm.summary.level', { level })}</span>
          <span data-field="grainPerHour">{t('farm.summary.grain', { n: grainPerHour(profile) })}</span>
          <span data-field="guards">{t('farm.summary.guards', { n: guards.length, max: slots })}</span>
        </div>
        {level <= 0 ? (
          <p className="hint" data-field="notBuilt">{t('farm.notBuilt')}</p>
        ) : (
          <div className="frm-raid" data-field="raid" data-raid={raid?.status ?? 'none'}>
            <span className="k">{t('raid.today')}</span>
            <span className="v">{raidStatusText(raid, now)}</span>
            {raid?.status === 'pending' && (
              <button className="btn primary sm" data-action="raidFight" onClick={onFight}>
                {t('raid.fight')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="place-body">
        {level > 0 && (
          <section className="place-panel sqv-panel frm-guards" data-field="guardList">
            <h2 className="cap sqv-head">{t('farm.guards.title')}</h2>
            <div className="sqv-rows">
              {Array.from({ length: slots }, (_, i) => {
                const g = guards[i];
                const data = g ? officerById.get(g.officer) : undefined;
                const inst = g ? profile.roster[g.officer] : undefined;
                if (!g || !data || !inst) {
                  return (
                    <div key={i} className="sqv-row sqm-row frm-row" data-row={i} data-empty="1">
                      <span className="who empty">{t('farm.guard.empty')}</span>
                    </div>
                  );
                }
                // King은 혼자일 때만 뺄 수 있다 — 다른 파수꾼이 남으면 King 없는 편성이 된다
                const locked = g.piece === 'King' && guards.length > 1;
                return (
                  <div key={i} className="sqv-row sqm-row frm-row" data-row={i} data-piece={g.piece} data-officer={g.officer}>
                    <div className="rk-dropdown">
                      <button type="button" className="btn sm rk-select sqm-pos" data-locked="1" disabled>{g.piece}</button>
                    </div>
                    <span className="art"><OfficerArt officer={data.id} className="thumb" /></span>
                    <span className="who">{pickOfficerName(data)}</span>
                    <span className="gr-cell"><span className="gr" data-grade={data.grade}>{data.grade}</span></span>
                    <span className="lv">Lv{inst.level}</span>
                    <button
                      className="sqm-pick"
                      data-action="removeGuard"
                      data-officer={g.officer}
                      disabled={locked}
                      onClick={() => remove(g.officer)}
                    >
                      {t('farm.guard.remove')}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="hint" data-field="guardHint">
              {slots === 1 ? t('farm.guards.kingOnly') : t('farm.guards.hint')}
            </p>
            <button
              className={`btn wide${guards.length < slots ? ' primary' : ''}`}
              data-action="addGuard"
              disabled={guards.length >= slots}
              onClick={() => { setError(null); setPicking(true); }}
            >
              <span className="lbl">{t('farm.guard.add')}</span>
            </button>
            {error && <p className="note" data-field="error">{error}</p>}
          </section>
        )}
      </div>

      {picking && (
        <GuardPickModal
          profile={profile}
          guards={guards}
          // 첫 파수꾼은 King이다 — King 없는 편성은 성립하지 않는다(`validateGuards`)
          pieces={hasKing ? PIECE_TYPES.filter((p) => p !== 'King' && !guards.some((g) => g.piece === p)) : ['King']}
          nowMs={now}
          fighting={raidActive(raid) && raid?.status === 'fighting'}
          onPick={(pick) => { if (save([...guards, pick])) setPicking(false); }}
          onClose={() => setPicking(false)}
        />
      )}
    </ScreenChrome>
  );
}

/**
 * 파수꾼 고르기 — 기물 하나를 고르고 장수 하나를 세운다.
 *
 * 부대에 든 장수는 **빼지 않고 흐리게** 둔다 — 목록에서 사라지면 「그 장수가 어디 갔지」가
 * 남는다. 이미 파수꾼인 장수는 뺀다(자리에서 보인다).
 */
function GuardPickModal({ profile, guards, pieces, nowMs, fighting, onPick, onClose }: {
  profile: PlayerProfile;
  guards: readonly RosterPick[];
  pieces: readonly PieceType[];
  nowMs: number;
  /** 전투 중이면 바꿔도 이번 판은 시작할 때의 편성이다 — 알려만 준다 */
  fighting: boolean;
  onPick: (pick: RosterPick) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [piece, setPiece] = useState<PieceType>(pieces[0] ?? 'King');
  const rows = useMemo(() => Object.values(profile.roster)
    .filter((inst) => !guards.some((g) => g.officer === inst.officer))
    .map((inst) => ({ inst, data: officerById.get(inst.officer)! }))
    .filter((r) => r.data)
    .sort((a, b) => b.inst.level - a.inst.level
      || GRADE_ORDER.indexOf(a.data.grade) - GRADE_ORDER.indexOf(b.data.grade)),
  [profile.roster, guards]);
  const any = rows.some((r) => officerDuty(profile, r.inst.officer) !== 'squad');

  return (
    <div className="modal-back" data-modal="guardPick" onClick={onClose}>
      <div className="modal frg-confirm hsp-pick frm-pick" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('farm.pick.title')}</p>
        <p className="frg-confirm-body">{t('farm.pick.piece')}</p>
        <div className="frm-pieces" data-field="pieces">
          {pieces.map((p) => (
            <button
              key={p}
              className={`btn sm${p === piece ? ' primary' : ''}`}
              data-action="pickPiece"
              data-piece={p}
              onClick={() => setPiece(p)}
            >{p}</button>
          ))}
        </div>
        {fighting && <p className="hint">{t('raid.status.fighting', { n: profile.raid?.bandits ?? 0 })}</p>}
        {!any && <p className="note" data-field="none">{t('farm.pick.none')}</p>}
        <ul className="hsp-list">
          {rows.map(({ inst, data }) => {
            const inSquad = officerDuty(profile, inst.officer) === 'squad';
            return (
              <li key={inst.officer} className="hsp-row" data-officer={inst.officer} data-duty={inSquad ? 'squad' : ''}>
                <span className="hsp-row-nm">
                  <b>{pickOfficerName(data)}</b>
                  <span className="hsp-row-sub">
                    {data.grade} · Lv{inst.level}{isInjured(inst, nowMs) ? ` · ${t('hospital.penalty', { n: INJURY_PENALTY })}` : ''}
                  </span>
                  {inSquad && <span className="hsp-row-left">{t('farm.pick.inSquad')}</span>}
                </span>
                <button
                  className="btn primary sm"
                  data-action="pickGuard"
                  disabled={inSquad}
                  onClick={() => onPick({ piece, officer: inst.officer })}
                >
                  {t('farm.pick.ok')}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="frg-confirm-acts">
          <button className="btn wide" data-action="closeGuardPick" onClick={onClose}>
            {t('farm.pick.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
