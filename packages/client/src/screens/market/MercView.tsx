/**
 * 용병 시장 — 새 카드 뽑기 · 보유 카드 정리 (2026-09-24, pptx 77~81쪽).
 *
 * ```
 * [새 카드 뽑기] → 뽑기 방식 판(panel-busy)  단발 10냥 / 8연 72냥
 *                  → 섬광(등급색) → 결과 판(panel-done)  [다시 뽑기] [닫기]
 * [보유 카드 정리] → 정리할 장수(3장 이상) → 받을 장수(같은 등급) → 수량(3장 단위 ±)
 *                  → 결과 판 — 섬광 없이 곧바로
 * ```
 *
 * **8연** — 10연이던 것을 줄였다(열 명은 결과 판이 좁다). 수와 값은 `economy.json`이
 * 정하고(`gachaPullCost`), 결과는 4×2로 편다.
 *
 * **판정은 전부 규칙과 서버가 한다** — 뽑기는 `POST /market/gacha`(시드도 서버가),
 * 정리는 `POST /market/recycle`(`canRecycle`). 화면은 고르게 하고 보여 줄 뿐이다.
 * 목록 두 개도 규칙이 낸다 — 정리할 장수는 `recycleSources()`, 받을 장수는
 * `recycleTargets()`. 화면이 「3장 이상」을 다시 세면 규칙이 바뀔 때 한쪽만 낡는다.
 */

import { useMemo, useState } from 'react';
import { officerById } from '@samchess/data';
import type { Grade, OfficerId } from '@samchess/rules';
import {
  RECYCLE_CARDS_IN, RECYCLE_CARDS_OUT, canAffordGacha, gachaPullCost, recyclableCards,
  recycleSources, recycleTargets,
} from '@samchess/meta';
import type { GachaPullKind, PlayerProfile } from '@samchess/meta';
import { pullGachaOnServer, recycleOnServer } from '../../meta/city.ts';
import { t } from '../../i18n/index.ts';
import { pickOfficerName } from '../../i18n/story.ts';
import { GradeBadge } from '../GradeBadge.tsx';
import { OfficerActionArt } from '../OfficerArt.tsx';
import { OfficerPickModal } from '../OfficerListScreen.tsx';
import { BurstStage, DoneModal, GoldCost, Halo, Layer } from './parts.tsx';
import type { ServerCall } from './parts.tsx';

type Pulled = { kind: GachaPullKind; drawn: OfficerId[]; exhausted: boolean };

/** 뽑기의 걸음 — 방식 고르기 → 섬광 → 결과 */
type PullStep = null | { at: 'choose' } | { at: 'burst'; got: Pulled } | { at: 'result'; got: Pulled };

/** 정리의 걸음 */
type CleanStep =
  | null
  | { at: 'source' }
  | { at: 'target'; source: OfficerId }
  | { at: 'qty'; source: OfficerId; target: OfficerId; n: number }
  | { at: 'done'; target: OfficerId; got: number };

const gradeOf = (id: OfficerId): Grade => officerById.get(id)?.grade ?? 'B';
const nameOf = (id: OfficerId): string => {
  const o = officerById.get(id);
  return o ? pickOfficerName(o) : id;
};

/** 이름 줄 — 등급 배지 + 이름 */
function Who({ officer }: { officer: OfficerId }): React.JSX.Element {
  return (
    <span className="mkt-who">
      <GradeBadge grade={gradeOf(officer)} />
      <span className="nm">{nameOf(officer)}</span>
    </span>
  );
}

/**
 * 장수 그림 + 등급 후광(A·S·E). 그림은 **액션 시트의 꼬마 장수**다(78쪽 목업) — 수묵
 * 초상화가 아니다. 가만히 서 있다가 가끔 자세를 바꾼다(장수 카드와 같은 `OfficerActionArt`).
 */
export function Portrait({ officer, size = 'lg' }: { officer: OfficerId; size?: 'lg' | 'sm' }): React.JSX.Element {
  return (
    <span className={`mkt-portrait ${size}`} data-grade={gradeOf(officer)}>
      <Halo grade={gradeOf(officer)} />
      <OfficerActionArt officer={officer} className="mkt-portrait-art" />
    </span>
  );
}

export function MercView({ profile, onChange, run, busy, onBack }: {
  profile: PlayerProfile;
  onChange: (next: PlayerProfile) => void;
  run: ServerCall;
  busy: boolean;
  onBack: () => void;
}): React.JSX.Element {
  const [pull, setPull] = useState<PullStep>(null);
  const [clean, setClean] = useState<CleanStep>(null);
  // 한 번만 센다 — 목록의 줄마다 부르면 장수 수의 세제곱이 된다
  const sources = useMemo(() => new Set(recycleSources(profile)), [profile]);
  const cleanGrade = clean && 'source' in clean ? gradeOf(clean.source) : null;
  const targets = useMemo(
    () => new Set(cleanGrade ? recycleTargets(profile, cleanGrade) : []),
    [profile, cleanGrade],
  );

  const doPull = (kind: GachaPullKind): void => {
    if (busy || !canAffordGacha(profile, kind).ok) return;
    // 뽑기는 결과(뽑힌 장수)도 함께 온다 — `run`이 프로필만 넘기므로 여기서 한 번 감싼다
    let got: Pulled | null = null;
    run(async () => {
      const r = await pullGachaOnServer(kind);
      if (!r) return null;
      got = { kind, drawn: r.drawn, exhausted: r.exhausted };
      return r.profile;
    }, () => { if (got) setPull(got.drawn.length > 0 ? { at: 'burst', got } : { at: 'result', got }); });
  };

  return (
    <>
      <section className="place-panel mkt-cmds">
        <div className="frg-buttons">
          <button className="btn wide" data-action="openPull" onClick={() => setPull({ at: 'choose' })}>
            <span className="lbl">{t('market.merc.pull')}</span>
          </button>
          <button className="btn wide" data-action="openRecycle" onClick={() => setClean({ at: 'source' })}>
            <span className="lbl">{t('market.merc.recycle')}</span>
          </button>
          <button className="btn wide" data-action="backHome" onClick={onBack}>
            <span className="lbl">{t('market.backHome')}</span>
          </button>
        </div>
      </section>

      {/* ── 뽑기 방식 (77쪽 오른쪽) — 로딩 판(panel-busy)을 빌린다 ── */}
      {pull?.at === 'choose' && (
        <Layer>
        <div className="modal-back" data-modal="pullChoose" onClick={() => setPull(null)}>
          <div className="modal mkt-choose" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t('market.pull.choose')}</p>
            <div className="mkt-pulls">
              {(['single', 'multi'] as const).map((kind) => {
                const cost = gachaPullCost(kind);
                const can = canAffordGacha(profile, kind);
                return (
                  <button
                    key={kind}
                    className="mkt-pull"
                    data-action={`pull-${kind}`}
                    disabled={busy || !can.ok}
                    onClick={() => doPull(kind)}
                  >
                    <img src={`market/${kind === 'single' ? 'gacha-single' : 'gacha-ten'}.png`} alt="" />
                    <span className="lbl">{kind === 'single' ? t('market.pull.single') : t('market.pull.multi', { n: cost.count })}</span>
                    <span className="sub">{t('market.pull.cost', { gold: cost.gold })}</span>
                  </button>
                );
              })}
            </div>
            {/* 금화가 모자라면 **왜인지 적는다** — 눌리지 않는 단추만 두면 「고장인가」가 남는다 */}
            {!canAffordGacha(profile, 'single').ok && (
              <p className="note" data-field="pullWhy">
                {t('market.pull.notEnough', { have: profile.gold, need: gachaPullCost('single').gold })}
              </p>
            )}
            <button className="btn wide" data-action="pullBack" onClick={() => setPull(null)}>{t('market.backHome')}</button>
          </div>
        </div>
        </Layer>
      )}

      {pull?.at === 'burst' && (
        <BurstStage grades={pull.got.drawn.map(gradeOf)} onDone={() => setPull({ at: 'result', got: pull.got })} />
      )}

      {pull?.at === 'result' && (
        <PullResult
          got={pull.got}
          profile={profile}
          busy={busy}
          onAgain={() => doPull(pull.got.kind)}
          onClose={() => setPull(null)}
        />
      )}

      {/* ── 보유 카드 정리 (80·81쪽) ── */}
      {clean?.at === 'source' && (
        <Layer>
        <OfficerPickModal
          profile={profile}
          onChange={onChange}
          title={t('market.recycle.pickSource')}
          only={(id) => sources.has(id)}
          onPick={(source) => setClean({ at: 'target', source })}
          onClose={() => setClean(null)}
        />
        </Layer>
      )}
      {clean?.at === 'target' && (
        <Layer>
        <OfficerPickModal
          profile={profile}
          onChange={onChange}
          title={t('market.recycle.pickTarget')}
          only={(id) => id !== clean.source && targets.has(id)}
          onPick={(target) => setClean({ at: 'qty', source: clean.source, target, n: RECYCLE_CARDS_IN })}
          onClose={() => setClean({ at: 'source' })}
        />
        </Layer>
      )}
      {clean?.at === 'qty' && (
        <RecycleQty
          profile={profile}
          step={clean}
          busy={busy}
          onN={(n) => setClean({ ...clean, n })}
          onBack={() => setClean({ at: 'target', source: clean.source })}
          onConfirm={() => {
            const { source, target, n } = clean;
            const got = (n / RECYCLE_CARDS_IN) * RECYCLE_CARDS_OUT;
            run(() => recycleOnServer(target, { [source]: n }), () => setClean({ at: 'done', target, got }));
          }}
        />
      )}
      {clean?.at === 'done' && (
        <DoneModal
          title={t('market.recycle.doneTitle')}
          field="recycleDone"
          onClose={() => setClean(null)}
          actions={<button className="btn wide" data-action="recycleClose" onClick={() => setClean(null)}>{t('market.close')}</button>}
        >
          <Who officer={clean.target} />
          <Portrait officer={clean.target} />
          <p className="mkt-done-big" data-field="recycleGot">{t('market.recycle.got', { n: clean.got })}</p>
        </DoneModal>
      )}
    </>
  );
}

/** 뽑기 결과 — 한 장이면 크게(78쪽), 여럿이면 4×2(79쪽) */
function PullResult({ got, profile, busy, onAgain, onClose }: {
  got: Pulled;
  profile: PlayerProfile;
  busy: boolean;
  onAgain: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const cost = gachaPullCost(got.kind);
  const can = canAffordGacha(profile, got.kind);
  const one = got.drawn.length === 1;
  return (
    <DoneModal
      title={t('market.reveal.title')}
      field="reveal"
      onClose={onClose}
      actions={(
        <>
          <button className="btn wide" data-action="pullAgain" disabled={busy || !can.ok} onClick={onAgain}>
            <span className="lbl">{t('market.pull.again')} (<GoldCost gold={cost.gold} />)</span>
          </button>
          <button className="btn wide" data-action="revealClose" onClick={onClose}>{t('market.close')}</button>
        </>
      )}
    >
      {one ? (
        <div className="mkt-reveal-one" data-officer={got.drawn[0]}>
          <Who officer={got.drawn[0]!} />
          <Portrait officer={got.drawn[0]!} />
        </div>
      ) : (
        <div className="mkt-reveal-grid" data-count={got.drawn.length}>
          {got.drawn.map((id, i) => (
            <div key={`${id}-${i}`} className="mkt-reveal-cell" data-officer={id} data-grade={gradeOf(id)}>
              <Portrait officer={id} size="sm" />
              <Who officer={id} />
            </div>
          ))}
        </div>
      )}
      {got.exhausted && <p className="note">{t('market.reveal.exhausted')}</p>}
    </DoneModal>
  );
}

/**
 * 수량 판 (81쪽 가운데) — 정리할 장수는 **왼쪽 위**, 카드가 생길 장수는 **오른쪽 아래**,
 * 그 밑에 [−] n장 정리 [+], 맨 밑에 [확정하기] (기획자 지정 2026-09-24).
 *
 * 한 번에 **3장씩** 움직인다 — 규칙의 단위(`RECYCLE_CARDS_IN`)다. 끝은 쓸 수 있는 카드
 * (`recyclableCards`)를 단위로 내린 값이다. 끝을 넘겨도 규칙(`canRecycle`)이 거절한다 —
 * 여기 막는 것은 편의다.
 */
function RecycleQty({ profile, step, busy, onN, onBack, onConfirm }: {
  profile: PlayerProfile;
  step: { source: OfficerId; target: OfficerId; n: number };
  busy: boolean;
  onN: (n: number) => void;
  onBack: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const { source, target, n } = step;
  const max = Math.floor(recyclableCards(profile, source) / RECYCLE_CARDS_IN) * RECYCLE_CARDS_IN;
  const srcHeld = profile.cards[source] ?? 0;
  const dstHeld = profile.cards[target] ?? 0;
  const got = (n / RECYCLE_CARDS_IN) * RECYCLE_CARDS_OUT;
  return (
    <Layer>
    <div className="modal-back" data-modal="recycleQty" onClick={onBack}>
      <div className="place-panel mkt-qty" onClick={(e) => e.stopPropagation()}>
        <p className="mkt-qty-ttl">{t('market.recycle.qtyTitle')}</p>
        <div className="mkt-qty-row from" data-officer={source}>
          <Portrait officer={source} size="sm" />
          <span className="mkt-qty-who">
            <Who officer={source} />
            <span className="mkt-qty-n" data-field="fromCards">
              {t('market.recycle.held', { from: srcHeld, to: srcHeld - n })}
            </span>
          </span>
        </div>
        <div className="mkt-qty-row to" data-officer={target}>
          <span className="mkt-qty-who">
            <Who officer={target} />
            <span className="mkt-qty-n" data-field="toCards">
              {t('market.recycle.held', { from: dstHeld, to: dstHeld + got })}
            </span>
          </span>
          <Portrait officer={target} size="sm" />
        </div>
        <div className="mkt-stepper" data-field="qty" data-n={n}>
          <button className="btn ghost sm mkt-step" data-action="less" disabled={n <= RECYCLE_CARDS_IN} onClick={() => onN(n - RECYCLE_CARDS_IN)}>−</button>
          <span className="mkt-step-n">{t('market.recycle.use', { n })}</span>
          <button className="btn ghost sm mkt-step" data-action="more" disabled={n + RECYCLE_CARDS_IN > max} onClick={() => onN(n + RECYCLE_CARDS_IN)}>+</button>
        </div>
        <button className="btn primary wide" data-action="recycleConfirm" disabled={busy || n < RECYCLE_CARDS_IN || n > max} onClick={onConfirm}>
          {t('market.recycle.confirm')}
        </button>
        <button className="btn wide" data-action="recycleBack" onClick={onBack}>{t('market.backHome')}</button>
      </div>
    </div>
    </Layer>
  );
}
