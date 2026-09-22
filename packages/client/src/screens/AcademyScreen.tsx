/**
 * 태학 — 책략 개량 연구 (트랙 11h, 2026-09-22 · GDD §5.12).
 *
 * 위는 **현황판**(태학 레벨 · 연구된 책략 · 지금 연구 중인 책략), 아래는 **명령 판**
 * ([완료된 연구] [연구하기])이다 — 병원(`HospitalScreen`)·대장간 홈과 같은 틀. 기획자 지정.
 *
 * ────────────────────────────────────────────────────────────────
 * 판정은 meta가, 시각은 서버가 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 무엇을 고를 수 있는지는 `academySlots()`·`canStartResearch()`가 정한다 — 화면은
 * 그 결과를 그릴 뿐이다. `academy`가 **서버 소유**라 연구 시작·취소를 로컬로 계산해
 * `PUT`하면 되쓰인다(화면에서만 연구 중인 유령). 그래서 `null`은 「아무것도 안
 * 바뀌었다」(`server.offline`)다 — 병원 입원과 같은 결.
 *
 * **끝난 연구의 축하 팝업은 여기 없다** — `App.tsx`가 전투가 아닌 모든 화면에서 띄운다
 * (`AcademyNotice`). 1시간 뒤 사람이 어디 있을지 모르기 때문이다.
 */

import { useEffect, useState } from 'react';
import { tacticById } from '@samchess/data';
import type { TacticData } from '@samchess/data';
import {
  ACADEMY_MAX_LEVEL, ACADEMY_RESEARCH_MS, academyLevel, academyOf, academySlots, academyTopics,
  canStartResearch, researchRemainingMs, upgradeDef,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import {
  CityActionRejected, cancelResearchOnServer, devFinishResearchOnServer, devGrantsEnabled,
  startResearchOnServer,
} from '../meta/city.ts';
import { currentSession } from '../meta/auth.ts';
import { pickTacticName, pickTacticText } from '../i18n/story.ts';
import { reasonText } from '../i18n/reason.ts';
import { buildingBackdrop } from './backdrop.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

/** 다시 그리는 주기 — 표기가 분 단위라 초마다 그릴 까닭이 없다. 판정엔 안 쓴다 */
const REDRAW_MS = 5_000;
const MS_PER_MIN = 60_000;

/** 남은 시간 — 병원과 같은 표기(분 단위 올림, 1분 미만은 「1분 이내」)라 같은 문구를 쓴다 */
function formatLeft(ms: number): string {
  if (ms < MS_PER_MIN) return t('hospital.time.underMin');
  return t('hospital.time.min', { m: Math.ceil(ms / MS_PER_MIN) });
}

/** 개량형의 원본 — 「원본 · …」 줄과 「회복 보유 장수」의 이름 */
const baseOf = (up: TacticData): TacticData | undefined => (up.base ? tacticById.get(up.base) : undefined);

type Modal = null | 'done' | 'pick' | 'cancel' | { confirm: string };

export function AcademyScreen({ profile, onBack, onChange }: {
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
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void devGrantsEnabled().then((on) => { if (alive) setDevOpen(on); });
    return () => { alive = false; };
  }, []);

  const level = academyLevel(profile);
  const state = academyOf(profile);
  const slots = academySlots(profile);
  const research = state.research;
  const researchDef = research ? upgradeDef(research.tactic) : undefined;
  // 레벨 차례로 — 끝낸 순서가 아니라 주제의 자리대로 읽혀야 「몇 레벨이 비었나」가 보인다
  const done = [...state.done].sort((a, b) => a.level - b.level)
    .map((d) => upgradeDef(d.tactic)).filter((x): x is TacticData => !!x);

  /** 서버에 시키고 받은 프로필로 갈아 끼운다 — 못 닿았으면 아무것도 안 바뀌었다고 말한다 */
  const run = (call: () => Promise<PlayerProfile | null>, after?: () => void): void => {
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const next = await call();
        if (next) { onChange(next); after?.(); } else setError(t('server.offline'));
      } catch (e) {
        setError(e instanceof CityActionRejected ? e.message : String(e));
      } finally {
        setBusy(false);
        setNow(Date.now());
      }
    })();
  };

  const confirmDef = modal && typeof modal === 'object' ? upgradeDef(modal.confirm) : undefined;
  const confirmBase = confirmDef ? baseOf(confirmDef) : undefined;

  return (
    <ScreenChrome
      backdrop={buildingBackdrop('academy')}
      className="scr-place scr-building-academy"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('place.back'))}
        </button>
        <span className="place-nm">{t('place.academy')}</span>
      </div>

      {/* 현황판 — 태학 레벨 · 연구된 책략 · 연구 중 (기획자 지정 세 줄) */}
      <div className="place-panel acd-status" data-field="status">
        <div className="acd-summary">
          <span data-field="level">{t('academy.summary.level', { level })}</span>
          <span data-field="doneCount">{t('academy.summary.done', { done: done.length, max: ACADEMY_MAX_LEVEL })}</span>
        </div>
        {level <= 0 ? (
          <p className="hint" data-field="notBuilt">{t('academy.notBuilt')}</p>
        ) : (
          <dl className="acd-rows">
            <dt>{t('academy.researched')}</dt>
            <dd data-field="researched">
              {done.length === 0 ? <span className="acd-none">{t('academy.researched.none')}</span> : (
                <span className="acd-chips">
                  {done.map((d) => (
                    <span key={d.id} className="acd-chip" data-tactic={d.id} title={pickTacticText(d)}>{pickTacticName(d)}</span>
                  ))}
                </span>
              )}
            </dd>
            <dt>{t('academy.current')}</dt>
            <dd data-field="current" data-state={research ? 'researching' : 'idle'}>
              {research && researchDef ? (
                <span className="acd-current">
                  <span data-tactic={researchDef.id}>
                    {t('academy.current.left', {
                      name: pickTacticName(researchDef), time: formatLeft(researchRemainingMs(profile, now)),
                    })}
                  </span>
                  <button className="btn ghost sm acd-cancel" data-action="cancelResearch" disabled={busy}
                    onClick={() => { setError(null); setModal('cancel'); }}>
                    {t('academy.current.cancel')}
                  </button>
                </span>
              ) : <span className="acd-none">{t('academy.current.none')}</span>}
            </dd>
          </dl>
        )}
      </div>

      {/* 명령 판 — 화면 바닥 */}
      <div className="place-body">
        <section className="place-panel acd-home">
          <div className="frg-buttons">
            <button className="btn wide" data-action="openDone" onClick={() => { setError(null); setModal('done'); }}>
              <span className="lbl">{t('academy.btn.done')}</span>
            </button>
            <button
              className={`btn wide${level > 0 ? ' primary' : ''}`}
              data-action="openResearch"
              disabled={level <= 0}
              onClick={() => { setError(null); setModal('pick'); }}
            >
              <span className="lbl">{t('academy.btn.research')}</span>
            </button>
          </div>
          {error && modal === null && <p className="note" data-field="error">{error}</p>}
        </section>

        {/* 1시간을 기다릴 수 없어 시험용으로 민다 — 병원의 강제 부상과 같은 스위치(`SAMCHESS_DEV_GRANTS=1`) */}
        {devOpen && <div className="devtools">
          <span className="cap">개발용</span>
          <button className="btn ghost sm" data-dev="finishResearch" disabled={busy || !research}
            onClick={() => run(devFinishResearchOnServer)}>
            연구 즉시 완료
          </button>
          <span className="dim">진행 중인 연구의 시작 시각을 1시간 당긴다.</span>
        </div>}
      </div>

      {/* [완료된 연구] — 개량형마다 「지금 효과」와 원본을 나란히 */}
      {modal === 'done' && (
        <div className="modal-back" data-modal="academyDone" onClick={() => setModal(null)}>
          <div className="modal frg-confirm acd-modal" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t('academy.done.title')}</p>
            {done.length === 0 ? <p className="frg-confirm-body">{t('academy.done.empty')}</p> : (
              <ul className="acd-list">
                {done.map((d) => {
                  const base = baseOf(d);
                  return (
                    <li key={d.id} className="acd-card" data-tactic={d.id} data-state="done">
                      <span className="acd-card-hd">
                        <b>{pickTacticName(d)}</b>
                        <span className="acd-tag">{t('academy.pick.level', { level: d.academyLevel ?? 0 })}</span>
                        <span className="acd-mp">{t('academy.pick.mp', { n: d.mpCost })}</span>
                      </span>
                      <span className="acd-card-tx">{pickTacticText(d)}</span>
                      {base && <span className="acd-card-base">{t('academy.done.base', { text: `MP ${base.mpCost} · ${pickTacticText(base)}` })}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="frg-confirm-acts">
              <button className="btn wide" data-action="closeDone" onClick={() => setModal(null)}>{t('academy.close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* [연구하기] — 태학 레벨마다 3중 택1. 칸의 형편은 `academySlots()`가 정한다 */}
      {modal === 'pick' && (
        <div className="modal-back" data-modal="academyPick" onClick={() => setModal(null)}>
          <div className="modal frg-confirm acd-modal acd-pick" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t('academy.pick.title')}</p>
            <p className="frg-confirm-body">{t('academy.pick.hint')}</p>
            {research && <p className="frg-confirm-body acd-busy" data-field="busy">{t('academy.pick.busy')}</p>}
            <div className="acd-levels">
              {slots.map((slot) => (
                <section key={slot.level} className="acd-level" data-level={slot.level} data-state={slot.state}>
                  <p className="acd-level-hd">
                    <b>{t('academy.pick.level', { level: slot.level })}</b>
                    {slot.state === 'locked' && <span className="acd-tag">{t('academy.pick.locked', { level: slot.level })}</span>}
                    {slot.state === 'done' && <span className="acd-tag on">{t('academy.pick.state.done')}</span>}
                    {slot.state === 'researching' && <span className="acd-tag on">{t('academy.pick.state.researching')}</span>}
                  </p>
                  <ul className="acd-list">
                    {academyTopics(slot.level).map((topic) => {
                      const chosen = 'tactic' in slot && slot.tactic === topic.id;
                      const check = canStartResearch(profile, topic.id);
                      const base = baseOf(topic);
                      return (
                        <li key={topic.id} className="acd-card" data-tactic={topic.id}
                          data-chosen={chosen ? 'true' : 'false'} data-open={check.ok ? 'true' : 'false'}>
                          <span className="acd-card-hd">
                            <b>{pickTacticName(topic)}</b>
                            <span className="acd-mp">{t('academy.pick.mp', { n: topic.mpCost })}</span>
                          </span>
                          <span className="acd-card-tx">{pickTacticText(topic)}</span>
                          {base && <span className="acd-card-base">{t('academy.done.base', { text: `MP ${base.mpCost} · ${pickTacticText(base)}` })}</span>}
                          {slot.state === 'open' && (
                            <button className={`btn sm${check.ok ? ' primary' : ''}`} data-action="pickTopic"
                              disabled={!check.ok || busy} title={check.ok ? undefined : reasonText(check)}
                              onClick={() => setModal({ confirm: topic.id })}>
                              {t('academy.pick.go')}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
            {error && <p className="note" data-field="error">{error}</p>}
            <div className="frg-confirm-acts">
              <button className="btn wide" data-action="closePick" onClick={() => setModal(null)}>{t('academy.close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* 연구 시작 확인 — 조사를 짓지 않으려고 「주제 · 이름」을 제 줄에 놓는다(`BuildDoneModal`과 같은 이유) */}
      {confirmDef && (
        <div className="modal-back" data-modal="academyConfirm" onClick={() => setModal('pick')}>
          <div className="modal frg-confirm" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t('academy.confirm.title')}</p>
            <p className="frg-confirm-body">
              <b>{t('academy.confirm.target', { name: pickTacticName(confirmDef) })}</b><br />
              {t('academy.confirm.cost', { min: ACADEMY_RESEARCH_MS / MS_PER_MIN })}<br />
              {confirmBase && t('academy.confirm.apply', { base: pickTacticName(confirmBase) })}
            </p>
            {error && <p className="note" data-field="error">{error}</p>}
            <div className="frg-confirm-acts">
              <button className="btn wide primary" data-action="confirmResearch" disabled={busy}
                onClick={() => run(() => startResearchOnServer(confirmDef.id), () => setModal(null))}>
                {t('academy.confirm.ok')}
              </button>
              <button className="btn wide" data-action="cancelConfirm" onClick={() => setModal('pick')}>
                {t('academy.confirm.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 연구 취소 확인 — 무료라 잃는 것이 없다는 것을 먼저 말한다 */}
      {modal === 'cancel' && (
        <div className="modal-back" data-modal="academyCancel" onClick={() => setModal(null)}>
          <div className="modal frg-confirm" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t('academy.cancel.title')}</p>
            <p className="frg-confirm-body">{t('academy.cancel.body')}</p>
            {error && <p className="note" data-field="error">{error}</p>}
            <div className="frg-confirm-acts">
              <button className="btn wide" data-action="confirmCancel" disabled={busy || !research}
                onClick={() => run(cancelResearchOnServer, () => setModal(null))}>
                {t('academy.cancel.ok')}
              </button>
              <button className="btn wide primary" data-action="keepResearch" onClick={() => setModal(null)}>
                {t('academy.cancel.keep')}
              </button>
            </div>
          </div>
        </div>
      )}

      {busy && <BusyVeil />}
    </ScreenChrome>
  );
}
