/**
 * 태학 — 책략 개량 연구 (트랙 11h, 2026-09-22 · GDD §5.12).
 *
 * 위는 **현황판**(태학 레벨 · 연구된 책략 · 지금 연구 중인 책략), 아래는 **명령 판**
 * ([완료된 연구] [연구하기])이다 — 병원(`HospitalScreen`)·대장간 홈과 같은 틀. 기획자 지정.
 *
 * ────────────────────────────────────────────────────────────────
 * [연구하기]는 한 레벨만 보여 준다 (2026-09-22 둘째 지정)
 * ────────────────────────────────────────────────────────────────
 *
 * 제목이 「연구하기 (Lv1)」이고 판 안에는 **그 레벨의 주제 셋뿐**이다 — 연구는 Lv1부터
 * 차례로다(`nextResearch()`가 어느 레벨인지 정한다). 판은 대장간의 **지급할 장수 고르기**
 * (`OfficerPickModal`)를 그대로 빌린다: 가리개 `.ofcpick-back` · 장부 판(`.scr-officers
 * .place-panel`) · 첫 줄 제목과 [X] · 맨 아래 옥색 [확정] · 그 밑 따로 선 [닫기] 판.
 * 한 줄은 레벨업 책략 택1의 두루마리(`.lv-tactic-row`)와 **체크 나무판**(`.lv-check`)이다 —
 * 같은 뜻(「셋 중 하나를 고른다」)에 새 그림을 만들지 않는다.
 *
 * 한 줄의 글: `[지원책] 증폭+ (MP 1 → 2)` / 설명은 원본에서 **바뀐 곳만** 취소선 + 빨간 글자
 * (`tacticDiff.ts`).
 *
 * ────────────────────────────────────────────────────────────────
 * 판정은 meta가, 시각은 서버가 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 무엇을 고를 수 있는지는 `nextResearch()`·`canStartResearch()`가 정한다 — 화면은 그 결과를
 * 그릴 뿐이다. `academy`가 **서버 소유**라 연구 시작·취소를 로컬로 계산해 `PUT`하면 되쓰인다
 * (화면에서만 연구 중인 유령). 그래서 `null`은 「아무것도 안 바뀌었다」(`server.offline`)다.
 *
 * **끝난 연구의 축하 팝업은 여기 없다** — `App.tsx`가 전투가 아닌 모든 화면에서 띄운다
 * (`AcademyNotice`). 되돌린 뒤의 즉시 연구도 그 팝업으로 알린다.
 */

import { Fragment, useEffect, useState } from 'react';
import { tacticById } from '@samchess/data';
import type { TacticData } from '@samchess/data';
import {
  ACADEMY_MAX_LEVEL, ACADEMY_RESEARCH_MS, academyLevel, academyOf, academyTopics, canStartResearch,
  isInstantResearch, nextResearch, researchRemainingMs, upgradeDef,
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
import { diffText } from './tacticDiff.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

/** 다시 그리는 주기 — 표기가 분 단위라 초마다 그릴 까닭이 없다. 판정엔 안 쓴다 */
const REDRAW_MS = 5_000;
const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

/** 남은 시간 — 병원과 같은 표기(분 단위 올림, 1분 미만은 「1분 이내」)라 같은 문구를 쓴다 */
function formatLeft(ms: number): string {
  if (ms < MS_PER_MIN) return t('hospital.time.underMin');
  return t('hospital.time.min', { m: Math.ceil(ms / MS_PER_MIN) });
}

/** 개량형의 원본 */
const baseOf = (up: TacticData): TacticData | undefined => (up.base ? tacticById.get(up.base) : undefined);

type Modal = null | 'done' | 'pick' | 'cancel';

/**
 * 개량형 한 장의 글 — `[지원책] 증폭+ (MP 1 → 2)` 한 줄과 바뀐 곳을 가른 설명 한 줄.
 * [연구하기]의 고르는 줄과 [완료된 연구]의 목록이 **같은 글**을 쓴다.
 */
function UpgradeText({ up, lead, check }: {
  up: TacticData;
  /** 이름 앞에 붙는 것 — [완료된 연구]의 「Lv1」 */
  lead?: React.ReactNode;
  /** 머리줄 오른쪽 끝 — [연구하기]의 체크 나무판 */
  check?: React.ReactNode;
}): React.JSX.Element {
  const base = baseOf(up);
  const mp = base && base.mpCost !== up.mpCost
    ? t('academy.mp.change', { from: base.mpCost, to: up.mpCost })
    : t('academy.pick.mp', { n: up.mpCost });
  const parts = base ? diffText(pickTacticText(base), pickTacticText(up)) : [{ kind: 'same' as const, text: pickTacticText(up) }];
  return (
    <>
      <span className="lv-tactic-head">
        <span className="lv-tactic-label">
          {lead}
          <span className={`acd-school ${up.school}`} data-school={up.school}>
            {t(up.school === 'support' ? 'academy.school.support' : 'academy.school.illusion')}
          </span>
          <span className="acd-name">{pickTacticName(up)}</span>
          <span className="lv-tactic-mp acd-mp">({mp})</span>
        </span>
        {check}
      </span>
      <span className="lv-tactic-text acd-diff" data-field="diff">
        {parts.map((p, i) => (
          <Fragment key={i}>
            {p.kind === 'same' ? p.text
              : p.kind === 'del' ? <s className="acd-old">{p.text}</s>
              : <span className="acd-new">{p.text}</span>}
          </Fragment>
        ))}
      </span>
    </>
  );
}

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
  /** [연구하기] 판에서 체크한 주제 — 판을 열 때마다 비운다 */
  const [picked, setPicked] = useState<string | null>(null);
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
  const next = nextResearch(profile);
  const research = state.research;
  const researchDef = research ? upgradeDef(research.tactic) : undefined;
  // 레벨 차례로 — 끝낸 순서가 아니라 주제의 자리대로
  const done = [...state.done].sort((a, b) => a.level - b.level)
    .map((d) => upgradeDef(d.tactic)).filter((x): x is TacticData => !!x);

  /**
   * [연구하기]가 안 되는 이유 — 되면 `null`. 이유는 제 단추 바로 밑에.
   * **연구 중에는 이유가 아니라 단추가 바뀐다** — 그 자리가 [연구 취소]다(2026-09-22 기획자 지정)
   */
  const researchBlocked = next.state === 'open' || next.state === 'researching' ? null
    : next.state === 'locked' ? t('academy.research.locked', { level: next.level })
    : next.state === 'allDone' ? t('academy.research.allDone')
    : t('academy.notBuilt');
  const pickLevel = next.state === 'open' ? next.level : null;
  const instant = pickLevel !== null && isInstantResearch(profile, pickLevel);

  /** 서버에 시키고 받은 프로필로 갈아 끼운다 — 못 닿았으면 아무것도 안 바뀌었다고 말한다 */
  const run = (call: () => Promise<PlayerProfile | null>, after?: () => void): void => {
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const nextProfile = await call();
        if (nextProfile) { onChange(nextProfile); after?.(); } else setError(t('server.offline'));
      } catch (e) {
        setError(e instanceof CityActionRejected ? e.message : String(e));
      } finally {
        setBusy(false);
        setNow(Date.now());
      }
    })();
  };

  const openPick = (): void => { setError(null); setPicked(null); setModal('pick'); };
  const pickedCheck = picked ? canStartResearch(profile, picked) : null;

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
                <span className="acd-current" data-tactic={researchDef.id}>
                  {t('academy.current.left', {
                    name: pickTacticName(researchDef), time: formatLeft(researchRemainingMs(profile, now)),
                  })}
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
            {/* 끝낸 연구가 없으면 눌러도 「아직 없다」 한 줄뿐이라 꺼 둔다(2026-09-22 기획자 지정) —
                현황판의 「연구된 책략 · 아직 없음」이 이미 같은 말을 한다 */}
            <button className="btn wide" data-action="openDone" disabled={done.length === 0}
              onClick={() => { setError(null); setModal('done'); }}>
              <span className="lbl">{t('academy.btn.done')}</span>
            </button>
            {/* 연구 중이면 [연구하기] 자리에 **붉은 [연구 취소]**(`button_forcedcancel.png`) — 대장간 [제작 취소]와
                같은 그림이다. 현황판에 붙어 있던 작은 [취소]는 이리로 옮겨 왔다(2026-09-22 기획자 지정) */}
            {research ? (
              <button className="btn wide ghost acd-cancel-research" data-action="cancelResearch" disabled={busy}
                onClick={() => { setError(null); setModal('cancel'); }}>
                <span className="lbl">{t('academy.cancel.ok')}</span>
              </button>
            ) : (
              <button
                className={`btn wide${researchBlocked === null ? ' primary' : ''}`}
                data-action="openResearch"
                disabled={researchBlocked !== null}
                onClick={openPick}
              >
                <span className="lbl">{t('academy.btn.research')}</span>
              </button>
            )}
            {/* 안 되는 이유는 제 단추 바로 밑에 — 끝에 몰면 어느 단추 이야기인지 모른다 */}
            {researchBlocked && level > 0 && <p className="hint" data-field="researchBlocked">{researchBlocked}</p>}
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

      {/* [연구하기] — 한 레벨의 주제 셋. 판은 대장간 「지급할 장수 고르기」 그대로 */}
      {modal === 'pick' && pickLevel !== null && (
        <div className="ofcpick-back scr-officers acd-pick-back" data-modal="academyPick" data-level={pickLevel} onClick={() => setModal(null)}>
          <div className="ofcpick-modal" onClick={(e) => e.stopPropagation()}>
            <section className="place-panel acd-pick-panel">
              <div className="ofcpick-titlerow acd-titlerow">
                <span className="ofcpick-title">{t('academy.pick.title', { level: pickLevel })}</span>
                <button className="ofcard-close" data-action="closePickX" onClick={() => setModal(null)} aria-label={t('academy.close')}>
                  <img className="ofcard-close-icon" src="icons/close.png" alt="" />
                </button>
              </div>
              {/* 「택 1」 — 판 왼쪽에 붙는다(2026-09-22 기획자 지정). 무료·즉시는 [연구 시작]이 말한다 */}
              <p className="acd-pick-hint" data-field="hint">{t('academy.pick.one')}</p>
              <div className="lv-tactics">
                {academyTopics(pickLevel).map((topic) => (
                  <button
                    key={topic.id}
                    className={`opt lv-tactic-row acd-topic${picked === topic.id ? ' on' : ''}`}
                    data-tactic={topic.id}
                    data-picked={picked === topic.id ? '1' : '0'}
                    onClick={() => setPicked(topic.id)}
                  >
                    <UpgradeText up={topic} check={(
                      <span className="lv-check" aria-hidden="true">
                        <img className="lv-check-icon" src="icons/confirm.png" alt="" />
                      </span>
                    )} />
                  </button>
                ))}
              </div>
              {error && <p className="note" data-field="error">{error}</p>}
              {/* [연구 시작] — 목록 맨 아래 한 곳. 아무것도 안 골랐으면 눌리지 않는다 */}
              <div className="ofc-pickacts">
                <button
                  className="btn primary wide acd-start"
                  data-action="startResearch"
                  disabled={!picked || busy || (pickedCheck !== null && !pickedCheck.ok)}
                  title={pickedCheck && !pickedCheck.ok ? reasonText(pickedCheck) : undefined}
                  onClick={() => { if (picked) run(() => startResearchOnServer(picked), () => setModal(null)); }}
                >
                  {instant
                    ? t('academy.pick.startInstant')
                    /* 「연구 시작 ( ⏳ 1시간 )」 — 그림은 대장간 제작 시간 줄과 같은 모래시계(2026-09-22 기획자 지정) */
                    : <>{t('academy.pick.start')} ( <img className="acd-timer" src="blacksmith/timer.png" alt="" /> {t('academy.pick.hours', { h: ACADEMY_RESEARCH_MS / MS_PER_HOUR })} )</>}
                </button>
              </div>
            </section>
            <section className="place-panel frg-back">
              <div className="frg-buttons">
                <button className="btn wide" data-action="closePick" onClick={() => setModal(null)}>
                  <span className="lbl">{t('academy.close')}</span>
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* [완료된 연구] — 같은 판에 같은 글. 고르는 것이 아니라 체크 나무판이 없다 */}
      {modal === 'done' && (
        <div className="ofcpick-back scr-officers acd-pick-back" data-modal="academyDone" onClick={() => setModal(null)}>
          <div className="ofcpick-modal" onClick={(e) => e.stopPropagation()}>
            <section className="place-panel acd-pick-panel">
              <div className="ofcpick-titlerow acd-titlerow">
                <span className="ofcpick-title">{t('academy.done.title')}</span>
                <button className="ofcard-close" data-action="closeDoneX" onClick={() => setModal(null)} aria-label={t('academy.close')}>
                  <img className="ofcard-close-icon" src="icons/close.png" alt="" />
                </button>
              </div>
              {/* 비어 있을 때는 이 판이 안 열린다 — [완료된 연구]가 꺼져 있다 */}
              <div className="lv-tactics">
                {done.map((d) => (
                  <div key={d.id} className="lv-tactic-row acd-topic acd-done-row" data-tactic={d.id}>
                    <UpgradeText up={d} lead={<span className="acd-lv">Lv{d.academyLevel}</span>} />
                  </div>
                ))}
              </div>
            </section>
            <section className="place-panel frg-back">
              <div className="frg-buttons">
                <button className="btn wide" data-action="closeDone" onClick={() => setModal(null)}>
                  <span className="lbl">{t('academy.close')}</span>
                </button>
              </div>
            </section>
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
