/**
 * 대장간 — 병기 연구 (2026-11-28 기획자 확정, `history/2026-11-28d_대장간연구개편_2_연구.md`).
 *
 * 태학(`AcademyScreen`)과 같은 틀이다 — 위는 **현황판**(대장간 레벨 · 연구한 병기 · 연구 중), 아래는 **명령 판**
 * ([연구하기] / 연구 중이면 붉은 [연구 취소]). 다른 것은 둘이다.
 *
 * 1. **한 번에 그 레벨의 몫을 고른다** — 대장간 Lv*L*이면 병기 *L*개(도시 증축의 건물 고르기처럼). 판의 후보는
 *    해금 레벨 ≤ *L*이고 아직 연구 안 한 것(`forgeCandidates`). 몫을 다 채워야 [연구 시작]이 켜진다.
 * 2. **축하는 대장간에서 한 번** — 끝나면 대장간에 들어왔을 때 축하 화면이 뜨고, [확인](`POST /forge/ack`) 뒤부터 장터에
 *    진열된다. 병기 1개는 가운데 · 2개는 좌우 · 3개 이상은 삼각형으로 서고, 아래에 붓선 줄이 병기마다 하나.
 *    대장간 밖에서는 대장장이가 부른다(`ForgeCall`, `forgeSeen.ts`).
 *
 * 판정은 meta(`nextForgeResearch` · `canStartForgeResearch`)가, 시각은 서버가 — `forge`가 서버 소유라 못 닿으면 아무것도
 * 안 바뀌었다고 말한다(`server.offline`). 옛 제조 · 지급 화면(2026-09-09 ~ 11-27)은 이 개편으로 걷었다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { equipmentById } from '@samchess/data';
import type { ItemData } from '@samchess/data';
import {
  FORGE_RESEARCH_MS, applyAckForge, canStartForgeResearch, forgeCandidates, forgeLevel, forgeOf, forgeQuota,
  forgeResearchMs, forgeResearchRemainingMs, nextForgeResearch, syncCity,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import {
  CityActionRejected, ackForgeOnServer, cancelForgeResearchOnServer, devFinishResearchOnServer, devGrantsEnabled,
  startForgeResearchOnServer,
} from '../meta/city.ts';
import { currentSession } from '../meta/auth.ts';
import { reasonText } from '../i18n/reason.ts';
import { Say } from './Steward.tsx';
import { buildingBackdrop } from './backdrop.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { Celebrate } from './Celebrate.tsx';
import { BlinkGlow, equipBlink } from './BlinkGlow.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { CityBonusMark, Sentence, Span } from './CityBonus.tsx';
import { GameIcon } from './GameIcon.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { buildingNameText } from './buildingText.ts';
import { BuildingLevel } from './LevelBadge.tsx';
import { itemLore, itemName, itemText } from './itemText.ts';

/** 다시 그리는 주기 — 표기가 분 단위라 초마다 그릴 까닭이 없다. 판정엔 안 쓴다 */
const REDRAW_MS = 5_000;
const MS_PER_MIN = 60_000;

/** 남은 시간 — 태학 · 병원과 같은 표기(분 단위 올림, 1분 미만은 「1분 이내」) */
function formatLeft(ms: number): string {
  if (ms < MS_PER_MIN) return t('hospital.time.underMin');
  return t('hospital.time.min', { m: Math.ceil(ms / MS_PER_MIN) });
}

type Modal = null | 'pick' | 'cancel';

/** 병기 그림 + 뒤의 섬광 — 레벨이 높을수록 자주 · 금(대장간 · 보관함과 같은 `equipBlink`) */
function WeaponArt({ item, className = 'frg-rs-art' }: { item: ItemData; className?: string }): React.JSX.Element {
  return (
    <span className={className}>
      <BlinkGlow tone={equipBlink(item.unlockLevel)} className="frg-rs-glow" />
      <img src={`blacksmith/${item.id}.png`} alt="" draggable={false} />
    </span>
  );
}

/** 사용(액티브) / 지속(패시브) 표지 — 장터 카드의 타입 칩과 같은 그림 */
function KindMark({ item }: { item: ItemData }): React.JSX.Element {
  return (
    <span className="frg-rs-kind" data-kind={item.kind}>
      <GameIcon name={item.kind === 'active' ? 'item-active' : 'item-passive'}
        label={t(item.kind === 'active' ? 'market.items.active' : 'market.items.passive')} />
    </span>
  );
}

/** 병기 한 줄의 글 — `Lv2 유성추 [사용]` / 효과 한 줄. 고르기 판 · 연구한 병기 한 장이 같은 글을 쓴다 */
function WeaponText({ item, check }: { item: ItemData; check?: React.ReactNode }): React.JSX.Element {
  return (
    <span className="frg-rs-text">
      <span className="frg-rs-head">
        <span className="frg-rs-label">
          <span className="acd-lv">Lv{item.unlockLevel}</span>
          <span className="frg-rs-name">{itemName(item)}</span>
          <KindMark item={item} />
        </span>
        {check}
      </span>
      <span className="frg-rs-fx" data-field="effect">{itemText(item)}</span>
    </span>
  );
}

/**
 * 축하 화면의 병기 배치 — 1개 가운데 · 2개 좌우 · 3개 이상 삼각형(위 줄이 적다: 3 = 1/2 · 4 = 1/3 · 5 = 2/3) (2026-11-28 기획자).
 * 모루 그림(`ui/cel-forge.png`) 한가운데에 내려찍힌다(`Celebrate`의 `badge`)
 */
function CelebrateSet({ items }: { items: readonly ItemData[] }): React.JSX.Element {
  const n = items.length;
  const top = n <= 2 ? n : n === 3 || n === 4 ? 1 : 2;
  const rows = n <= 2 ? [items] : [items.slice(0, top), items.slice(top)];
  return (
    <span className="frg-cel-set" data-n={n}>
      {rows.map((row, i) => (
        <span key={i} className="frg-cel-setrow">
          {row.map((item) => <img key={item.id} className="frg-cel-weapon" src={`blacksmith/${item.id}.png`} alt="" data-item={item.id} />)}
        </span>
      ))}
    </span>
  );
}

export function ForgeScreen({ profile, onBack, onChange }: {
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
  /** 고르기 판에서 체크한 병기 — 판을 열 때마다 비운다 */
  const [picked, setPicked] = useState<string[]>([]);
  /** 현황판의 병기 그림을 눌러 띄운 한 장 — `top`은 현황판 바로 아래(태학과 같은 자리) */
  const [peek, setPeek] = useState<{ id: string; top: number } | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void devGrantsEnabled().then((on) => { if (alive) setDevOpen(on); });
    return () => { alive = false; };
  }, []);

  const level = forgeLevel(profile);
  const state = forgeOf(profile);
  const next = nextForgeResearch(profile);
  const research = state.research;
  const researching = (research?.items ?? []).map((id) => equipmentById.get(id)).filter((x): x is ItemData => !!x);
  // 레벨 차례 · 진열 순서로 — 끝낸 순서가 아니라 병기의 자리대로
  const done = useMemo(() => state.done.flatMap((d) => d.items).map((id) => equipmentById.get(id)).filter((x): x is ItemData => !!x)
    .sort((a, b) => a.unlockLevel - b.unlockLevel || a.order - b.order), [state.done]);
  const total = equipmentById.size;

  /*
   * **남은 시간이 0이 되는 순간에 정산한다** — `App.tsx`도 그 순간에 한 번 더 정산하지만, 화면이 대장간에 있으면 축하가 바로 떠야 한다.
   * 정산의 자리는 여전히 `syncCity()` 하나다(이 화면은 「지금 몇 시인지」만 넣는다).
   */
  useEffect(() => {
    if (!research || forgeResearchRemainingMs(profile, Date.now()) > 0) return;
    const settled = syncCity(profile, Date.now());
    if (settled !== profile) onChange(settled);
  }, [research, now, profile, onChange]);

  /** 축하를 기다리는 병기 — 서버가 거둘 때 적은 `notice` */
  const notice = (state.notice ?? []).map((id) => equipmentById.get(id)).filter((x): x is ItemData => !!x)
    .sort((a, b) => a.unlockLevel - b.unlockLevel || a.order - b.order);

  /** 연구 중이 아닐 때 [연구하기]가 안 되는 이유 — 되면 `null`. 대장장이가 말한다 */
  const researchBlocked = next.state === 'open' || next.state === 'researching' ? null
    : next.state === 'locked' ? t('forge.research.locked', { level: next.level })
    : next.state === 'allDone' ? t('forge.research.allDone')
    : t('forge.notBuilt');
  const pickLevel = next.state === 'open' ? next.level : null;
  const quota = pickLevel !== null ? forgeQuota(pickLevel) : 0;
  const candidates = pickLevel !== null ? forgeCandidates(profile, pickLevel) : [];

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

  /** 축하를 봤다 — 서버의 `notice`를 비운다. 못 닿으면 **화면에서만** 비운다(진열은 서버가 정하므로 다음 접속에 한 번 더 뜬다) */
  const ack = (): void => {
    void ackForgeOnServer().then((p) => onChange(p ?? applyAckForge(profile)), () => onChange(applyAckForge(profile)));
  };

  const openPick = (): void => { setError(null); setPicked([]); setModal('pick'); };
  const toggle = (id: string): void => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id)
    : cur.length >= quota ? cur : [...cur, id]));
  const pickedCheck = picked.length === quota ? canStartForgeResearch(profile, picked) : null;
  const openPeek = (id: string): void => {
    const el = statusRef.current;
    setError(null);
    setPeek({ id, top: el ? el.offsetTop + el.offsetHeight + 6 : 0 });
  };

  return (
    <ScreenChrome
      backdrop={buildingBackdrop('forge')}
      className="scr-place scr-building-forge"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('place.back'))}
        </button>
        <span className="place-nm">{t('place.forge')}</span>
      </div>

      {/* 현황판 — 대장간 레벨 · 연구한 병기 · 연구 중 (태학과 같은 세 줄) */}
      <div className="place-panel frg-status frg-rs-status" data-field="status" ref={statusRef}>
        <div className="frg-summary">
          <span data-field="level"><BuildingLevel id="forge" name={buildingNameText('forge')} level={level} /></span>
          <span data-field="doneCount">{t('forge.summary.done', { done: done.length, max: total })}</span>
        </div>
        {level <= 0 ? (
          <p className="hint" data-field="notBuilt">{t('forge.notBuilt')}</p>
        ) : (
          <dl className="acd-rows">
            <dt>{t('forge.researched')}</dt>
            <dd data-field="researched">
              {done.length === 0 ? <span className="acd-none">{t('forge.researched.none')}</span> : (
                <span className="acd-chips frg-rs-chips">
                  {done.map((d) => (
                    <button key={d.id} type="button" className="frg-rs-chip" data-action="peekDone" data-item={d.id}
                      aria-label={itemName(d)} aria-expanded={peek?.id === d.id} onClick={() => openPeek(d.id)}>
                      <img src={`blacksmith/${d.id}.png`} alt="" draggable={false} />
                    </button>
                  ))}
                </span>
              )}
            </dd>
            <dt>{t('forge.current')}</dt>
            <dd data-field="current" data-state={research ? 'researching' : 'idle'}>
              {research ? (
                <span className="acd-current" data-level={research.level}>
                  {t('forge.current.left', {
                    names: researching.map(itemName).join(' · '), time: formatLeft(forgeResearchRemainingMs(profile, now)),
                  })}
                </span>
              ) : <span className="acd-none">{t('forge.current.none')}</span>}
            </dd>
          </dl>
        )}
      </div>

      {/* 명령 판 — 화면 바닥 */}
      <div className="place-body">
        <section className="place-panel cmd-panel frg-home">
          <div className="frg-buttons">
            {/* 연구 중이면 [연구하기] 자리에 붉은 [연구 취소] — 태학과 같은 그림 · 같은 자리 */}
            {research ? (
              <button className="btn wide ghost acd-cancel-research" data-action="cancelResearch" disabled={busy}
                onClick={() => { setError(null); setModal('cancel'); }}>
                <span className="lbl">{t('forge.cancel.ok')}</span>
              </button>
            ) : (
              <button className={`btn wide${researchBlocked === null ? ' primary' : ''}`} data-action="openResearch"
                disabled={researchBlocked !== null} onClick={openPick}>
                <span className="lbl">{t('forge.btn.research')}</span>
              </button>
            )}
            {/* 축하가 떠 있는 동안은 말하지 않는다 — 마지막 연구의 「모두 마쳤다」가 축하 위에 겹쳤다 */}
            <Say text={researchBlocked && level > 0 && notice.length === 0 ? researchBlocked : null} who="blacksmith" level={profile.cityLevel} name="researchBlocked" />
          </div>
          <Say text={error} who="blacksmith" level={profile.cityLevel} name="error" repeat />
        </section>

        {/* 1시간을 기다릴 수 없어 시험용으로 민다 — 태학과 같은 스위치(`SAMCHESS_DEV_GRANTS=1`) */}
        {devOpen && <div className="devtools">
          <span className="cap">개발용</span>
          <button className="btn ghost sm" data-dev="finishResearch" disabled={busy || !research}
            onClick={() => run(devFinishResearchOnServer)}>
            연구 즉시 완료
          </button>
          <span className="dim">진행 중인 연구의 시작 시각을 1시간 당긴다.</span>
        </div>}
      </div>

      {/* [연구하기] — 그 레벨의 후보에서 몫만큼. 판은 태학 [연구하기]와 같은 틀 */}
      {modal === 'pick' && pickLevel !== null && (
        <div className="ofcpick-back scr-officers acd-pick-back frg-rs-pick-back" data-modal="forgePick" data-level={pickLevel} data-quota={quota}
          onClick={() => setModal(null)}>
          <div className="ofcpick-modal" onClick={(e) => e.stopPropagation()}>
            <section className="place-panel acd-pick-panel frg-rs-pick">
              <div className="ofcpick-titlerow acd-titlerow">
                <span className="ofcpick-title">{t('forge.pick.title', { level: pickLevel })}</span>
                <button className="ofcard-close" data-action="closePickX" onClick={() => setModal(null)} aria-label={t('forge.detail.close')}>
                  <img className="ofcard-close-icon" src="icons/close.png" alt="" />
                </button>
              </div>
              <p className="acd-pick-hint" data-field="hint" data-picked={picked.length}>
                {t('forge.pick.hint', { n: quota, k: picked.length })}
              </p>
              <div className="frg-rs-list">
                {candidates.map((item) => {
                  const on = picked.includes(item.id);
                  const full = !on && picked.length >= quota;
                  return (
                    <button key={item.id} className={`opt lv-tactic-row frg-rs-row${on ? ' on' : ''}`} data-item={item.id}
                      data-picked={on ? '1' : '0'} disabled={full} onClick={() => toggle(item.id)}>
                      <WeaponArt item={item} />
                      <WeaponText item={item} check={(
                        <span className="lv-check" aria-hidden="true">
                          <img className="lv-check-icon" src="icons/confirm.png" alt="" />
                        </span>
                      )} />
                    </button>
                  );
                })}
              </div>
              <div className="ofc-pickacts">
                <button className="btn primary wide acd-start" data-action="startResearch"
                  disabled={picked.length !== quota || busy || (pickedCheck !== null && !pickedCheck.ok)}
                  title={pickedCheck && !pickedCheck.ok ? reasonText(pickedCheck) : undefined}
                  onClick={() => run(() => startForgeResearchOnServer(picked), () => setModal(null))}>
                  {/* 「연구 시작 ( ⏳ 1시간 )」 — 태학과 같은 모래시계 · 같은 글 */}
                  <>{t('forge.pick.start')} ( <img className="acd-timer" src="blacksmith/timer.png" alt="" /> <Sentence k="academy.pick.hours" vars={{ time: <Span base={FORGE_RESEARCH_MS} now={forgeResearchMs(profile, now)} /> }} /> )</>
                </button>
                {/* 연구 시간을 줄인 컬렉션의 인장 — 단추 안에는 단추를 못 넣어 옆에 선다 */}
                <CityBonusMark profile={profile} keys={['forge']} atMs={now} />
              </div>
            </section>
            <section className="place-panel cmd-panel frg-back">
              <div className="frg-buttons">
                <button className="btn wide" data-action="closePick" onClick={() => setModal(null)}>
                  <span className="lbl">{t('forge.detail.close')}</span>
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* 연구한 병기 한 장 — 현황판의 그림을 누르면 바로 아래에(태학의 끝낸 연구 한 장과 같은 꼴) */}
      {peek && (() => {
        const d = done.find((x) => x.id === peek.id);
        if (!d) return null;
        return (
          <div className="modal-back acd-peek-back" data-modal="forgeDone" style={{ paddingTop: peek.top }} onClick={() => setPeek(null)}>
            <div className="tac-modal acd-peek lv-tactic-row frg-rs-row frg-rs-peek" data-item={d.id} onClick={(e) => e.stopPropagation()}>
              <WeaponArt item={d} />
              <span className="frg-rs-text">
                <WeaponText item={d} />
                <span className="frg-rs-lore" data-field="lore">{itemLore(d)}</span>
              </span>
              <button className="tac-close" data-action="closeDone" onClick={() => setPeek(null)} aria-label={t('forge.detail.close')}>
                <img src="icons/confirm.png" alt="" />
              </button>
            </div>
          </div>
        );
      })()}

      {/* 연구 취소 확인 — 무료라 잃는 것이 없다는 것을 먼저 말한다 */}
      {modal === 'cancel' && (
        <div className="modal-back" data-modal="forgeCancel" onClick={() => setModal(null)}>
          <div className="modal frg-confirm" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t('forge.cancel.title')}</p>
            <p className="frg-confirm-body">{t('forge.cancel.body')}</p>
            <div className="frg-confirm-acts">
              <button className="btn wide" data-action="confirmCancel" disabled={busy || !research}
                onClick={() => run(cancelForgeResearchOnServer, () => setModal(null))}>
                {t('forge.cancel.ok')}
              </button>
              <button className="btn wide primary" data-action="keepResearch" onClick={() => setModal(null)}>
                {t('forge.cancel.keep')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 연구 완료 — 대장간에서 한 번(2026-11-28 기획자). 모루 위에 병기가 내려찍히고(1 가운데 · 2 좌우 · 3+ 삼각형),
          아래는 병기마다 붓선 줄 하나(획의 색은 병기 레벨 — `data-level`). [확인] 뒤부터 장터에 진열된다 */}
      {notice.length > 0 && (
        <Celebrate key={notice.map((d) => d.id).join('+')} modal="forgeNotice" intro="forge" className="frg-done" title={t('forge.done.title')}
          art={<img className="cel-art-img" src="ui/cel-forge.png" alt="" />}
          badge={<CelebrateSet items={notice} />}
          tone={equipBlink(Math.max(...notice.map((d) => d.unlockLevel)))}
          okAction="ackDone" onClose={ack}>
          {notice.map((d) => (
            <p key={d.id} className="lvd-row frg-done-row" data-field="doneItem" data-item={d.id} data-level={d.unlockLevel}>
              <img className="frg-done-medal" src={`blacksmith/medal-${d.id}.png`} alt="" />
              <b>{itemName(d)}</b>
            </p>
          ))}
          <p className="row dim">{t('forge.done.hint')}</p>
        </Celebrate>
      )}

      {busy && <BusyVeil />}
    </ScreenChrome>
  );
}
