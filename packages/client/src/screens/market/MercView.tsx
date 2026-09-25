/**
 * 용병 시장 — 새 카드 뽑기 · 보유 카드 정리 (2026-09-24, pptx 77~81쪽).
 *
 * ```
 * [새 카드 뽑기] → 뽑기 방식 판(panel-busy)  단발 🪙×10 / 8연 🪙×72
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
import { playSfx } from '../../audio/sfx.ts';
import type { SfxId } from '../../audio/sfx.ts';
import { t } from '../../i18n/index.ts';
import { pickOfficerName } from '../../i18n/story.ts';
import { GradeBadge } from '../GradeBadge.tsx';
import { OfficerActionArt } from '../OfficerArt.tsx';
import { OfficerPickModal } from '../OfficerListScreen.tsx';
import { BurstStage, CardStat, DoneModal, GoldCost, Halo, Layer } from './parts.tsx';
import type { ServerCall } from './parts.tsx';

type Pulled = { kind: GachaPullKind; drawn: OfficerId[]; exhausted: boolean };

/**
 * 뽑기 효과음과 첫 섬광까지의 틈 (2026-09-24 지정). 단발은 소리가 먼저 차오르고 **1.5초 뒤**
 * 터지고, 8연은 소리와 **동시에** 터진다 — 두 소리의 짜임이 다르다(`cardx1`은 앞에 뜸이 있다).
 */
const PULL_SOUND: Record<GachaPullKind, { sfx: SfxId; lead: number }> = {
  single: { sfx: 'cardx1', lead: 1500 },
  multi: { sfx: 'cardx8', lead: 0 },
};

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

/**
 * 머리 판 (2026-09-24 지정) — 금화와 장수 카드를 **한 줄**에, 둘 다 「그림 + 수」로. 뽑기는 금화를 쓰고 정리는
 * 카드를 쓰므로 이 화면의 두 수에 드는 값 둘이다. 카드 셈은 장터 현황판과 같은 `cardTally()`.
 */
function MercStatus({ profile }: { profile: PlayerProfile }): React.JSX.Element {
  return (
    <section className="place-panel mkt-merc-status" data-field="mercStatus">
      <span className="mkt-cur" data-currency="gold">
        <img src="market/gold.png" alt={t('market.gold')} title={t('market.gold')} />
        <b className="v" data-field="gold">{profile.gold}</b>
      </span>
      <CardStat profile={profile} />
    </section>
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
    }, () => {
      if (!got) return;
      if (got.drawn.length === 0) { setPull({ at: 'result', got }); return; }
      // 소리는 무대가 뜨는 바로 그 순간에 — 섬광의 틈(`lead`)이 이 시각부터 잰다
      playSfx(PULL_SOUND[kind].sfx);
      setPull({ at: 'burst', got });
    });
  };

  return (
    <>
      <MercStatus profile={profile} />

      <section className="place-panel mkt-cmds">
        <div className="frg-buttons">
          <button className="btn wide" data-action="openPull" onClick={() => setPull({ at: 'choose' })}>
            <span className="lbl">{t('market.merc.pull')}</span>
            <span className="sub">{t('market.merc.pull.sub')}</span>
          </button>
          <button className="btn wide" data-action="openRecycle" onClick={() => setClean({ at: 'source' })}>
            <span className="lbl">{t('market.merc.recycle')}</span>
            <span className="sub">{t('market.merc.recycle.sub')}</span>
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
                    <img className="mkt-pull-art" src={`market/${kind === 'single' ? 'market_card' : 'market_carddeck'}.png`} alt="" />
                    <span className="lbl">{kind === 'single' ? t('market.pull.single') : t('market.pull.multi', { n: cost.count })}</span>
                    {/* 「🪙 × 10」 — [다시 뽑기]와 같은 표기(2026-09-25 지정) */}
                    <span className="sub" data-field="pullCost" data-gold={cost.gold}><GoldCost gold={cost.gold} times /></span>
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
        <BurstStage
          grades={pull.got.drawn.map(gradeOf)}
          lead={PULL_SOUND[pull.got.kind].lead}
          onDone={() => setPull({ at: 'result', got: pull.got })}
        />
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
      // 「뽑았다」는 보면 안다(2026-09-24 피드백) — 한 장이면 제목 자리에 **등급 표 + 이름**,
      // 여러 장은 이름이 칸마다 붙으므로 제목 줄이 아예 없다
      title={one ? <Who officer={got.drawn[0]!} /> : null}
      field="reveal"
      onClose={onClose}
      actions={(
        <>
          <button className="btn primary wide" data-action="pullAgain" disabled={busy || !can.ok} onClick={onAgain}>
            <span className="lbl">{t('market.pull.again')} (<GoldCost gold={cost.gold} times />)</span>
          </button>
          <button className="btn wide" data-action="revealClose" onClick={onClose}>{t('market.close')}</button>
        </>
      )}
    >
      {one ? (
        <div className="mkt-reveal-one" data-officer={got.drawn[0]}>
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
 * 「보유 카드 : 4 → 1」 — **바뀐 뒤 숫자만** 칠한다(줄면 빨강, 늘면 파랑, 2026-09-24 지정).
 * 문장은 언어마다 어순이 달라 번역문을 `{to}` 자리에서 갈라 그 숫자만 감싼다 —
 * 번역문을 조각으로 나눠 적으면 언어마다 조각이 어긋난다.
 */
function Held({ field, dir, from, to }: { field: string; dir: 'up' | 'down'; from: number; to: number }): React.JSX.Element {
  const MARK = '\u0000';
  const [head, tail = ''] = t('market.recycle.held', { from, to: MARK }).split(MARK);
  return (
    <span className="mkt-qty-n" data-field={field}>
      {head}<b className="mkt-qty-to" data-dir={dir}>{to}</b>{tail}
    </span>
  );
}

/**
 * 수량 판 (81쪽 가운데) — 정리할 장수는 **왼쪽 위**, 카드가 생길 장수는 **오른쪽 아래**,
 * 그 밑에 [−] 받을 장수 [+], 맨 밑에 [n장 정리하기] (기획자 지정 2026-09-24).
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
            <Held field="fromCards" dir="down" from={srcHeld} to={srcHeld - n} />
          </span>
        </div>
        <div className="mkt-qty-row to" data-officer={target}>
          <span className="mkt-qty-who">
            <Who officer={target} />
            <Held field="toCards" dir="up" from={dstHeld} to={dstHeld + got} />
          </span>
          <Portrait officer={target} size="sm" />
        </div>
        {/* 가운데 숫자는 **받는 쪽이 얻는 장수**다(2026-09-24 지정) — 3장을 내면 1. 내는 장수는
            아래 [n장 정리하기]가 말한다. `data-n`은 그대로 내는 장수다(검사가 그걸 본다) */}
        {/* [−]·[+]는 쪽 넘김 목판(`.pg-btn`, [이전]·[다음]과 같은 그림)에 기호만 얹는다 —
            `PagerButton`은 글자가 「이전/다음」으로 박혀 있어 그림만 빌린다. 숫자는 두루마리 위 */}
        <div className="mkt-stepper mkt-qty-stepper" data-field="qty" data-n={n} data-got={got}>
          <button className="btn pg-btn" data-dir="prev" data-action="less" aria-label="−" disabled={n <= RECYCLE_CARDS_IN} onClick={() => onN(n - RECYCLE_CARDS_IN)}>
            <span className="pg-lbl">−</span>
          </button>
          <span className="mkt-step-n">{got}</span>
          <button className="btn pg-btn" data-dir="next" data-action="more" aria-label="+" disabled={n + RECYCLE_CARDS_IN > max} onClick={() => onN(n + RECYCLE_CARDS_IN)}>
            <span className="pg-lbl">+</span>
          </button>
        </div>
        <button className="btn primary wide" data-action="recycleConfirm" disabled={busy || n < RECYCLE_CARDS_IN || n > max} onClick={onConfirm}>
          {t('market.recycle.confirm', { n })}
        </button>
        <button className="btn wide" data-action="recycleBack" onClick={onBack}>{t('market.backHome')}</button>
      </div>
    </div>
    </Layer>
  );
}
