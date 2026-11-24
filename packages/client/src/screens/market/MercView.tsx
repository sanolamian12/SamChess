/**
 * 용병 시장 — 장수 모집 · 잉여 카드로 모집 (2026-11-24 기획자 — 카드 뽑기 팝업 · 카드 정리를 걷고 한 판으로).
 *
 * ```
 * 현황판   [금화] n   [장수] 풀/상한   [잉여 카드] n
 * 첫 줄    [1명 모집 🪙10] [3명 모집 🪙25] [5명 모집 🪙40]   ← 꼬마 1 · V자 3 · W자 5. 궁궐 빈자리가 모자라면 자물쇠 + 「궁궐 증축 필요」
 * 둘째 줄  [A급 확정 🂠10] [S급 확정 🂠20] [E급 확정 🂠30]   ← 잉여 카드로. E급은 헌제를 거느릴 때만(아니면 잿빛)
 * 바닥     [뒤로 가기]
 * ```
 *
 * - 꾸밈은 금화 충전 판과 같다(`.mkt-packs` · `.mkt-pack` — 대자보 종이 카드 + 붓 획 가격 띠).
 * - **궁궐의 빈자리보다 많이는 모집하지 못한다**(`canPullGacha`, 2026-11-24 기획자) — 빈자리 4면 5명이, 2면 3명도 막힌다.
 *   막힌 칸은 자물쇠가 덮고 「궁궐 증축 필요」라고 적는다. 그래서 모집에서는 새 장수가 언제나 풀에 든다.
 * - 모집 결과는 섬광 → 결과 판이고, 칸마다 「새 장수」 · 「잉여 카드」(Lv9 장수의 카드) 표가 붙는다(서버가 준 `fates`).
 *
 * **판정은 전부 규칙과 서버가 한다** — 모집은 `POST /market/gacha`(시드도 서버가), 잉여 카드 모집은
 * `POST /market/surplus`(받는 장수도 서버가 고른다). 화면은 누르게 하고 보여 줄 뿐이다.
 */

import { useState } from 'react';
import { officerById } from '@samchess/data';
import type { Grade, OfficerId } from '@samchess/rules';
import {
  GACHA_PULL_KINDS, SURPLUS_GRADES, canPullGacha, canExchangeSurplus, gachaPullCost, hasEmperor, poolCap,
  poolSeatsFree, poolUsed, surplusCost, surplusOf,
} from '@samchess/meta';
import type { GachaFate, GachaPullKind, MetaResult, PlayerProfile, SurplusGrade } from '@samchess/meta';
import { Say } from '../Steward.tsx';
import { exchangeSurplusOnServer, pullGachaOnServer } from '../../meta/city.ts';
import { playSfx } from '../../audio/sfx.ts';
import type { SfxId } from '../../audio/sfx.ts';
import { t } from '../../i18n/index.ts';
import { pickOfficerName } from '../../i18n/story.ts';
import { reasonText } from '../../i18n/reason.ts';
import { GradeBadge } from '../GradeBadge.tsx';
import { OfficerActionArt, OfficerStand } from '../OfficerArt.tsx';
import { BurstStage, DoneModal, GoldCost, Halo, Layer } from './parts.tsx';
import type { ServerCall } from './parts.tsx';
import { GameIcon } from '../GameIcon.tsx';
import { CelebrateCharge } from '../Celebrate.tsx';

type Pulled = { kind: GachaPullKind; drawn: OfficerId[]; fates: GachaFate[]; exhausted: boolean };

/**
 * 모집 효과음과 첫 섬광까지의 틈 (2026-09-24 지정). 1명은 소리가 먼저 차오르고 터지고(작은 급, 2초),
 * 여럿은 축하 화면의 모음(`CelebrateCharge`)을 먼저 돌리고 그 「쾅」에 섬광이 터진다(큰 급) — 옛 단발 · 8연의 짜임 그대로.
 */
const PULL_SOUND: Record<GachaPullKind, { sfx: SfxId; lead: number; from: number }> = {
  one: { sfx: 'cardx1', lead: 900, from: 0.6 },
  three: { sfx: 'cardx8', lead: 0, from: 0 },
  five: { sfx: 'cardx8', lead: 0, from: 0 },
};

/** 모집의 걸음 — (여럿은 모음) → 섬광 → 결과 */
type PullStep =
  | null
  | { at: 'charge'; got: Pulled }
  | { at: 'burst'; got: Pulled }
  | { at: 'result'; got: Pulled };

const gradeOf = (id: OfficerId): Grade => officerById.get(id)?.grade ?? 'B';
const nameOf = (id: OfficerId): string => {
  const o = officerById.get(id);
  return o ? pickOfficerName(o) : id;
};

/** 이름 줄 — 등급 배지 + 이름 */
export function Who({ officer }: { officer: OfficerId }): React.JSX.Element {
  return (
    <span className="mkt-who">
      <GradeBadge grade={gradeOf(officer)} />
      <span className="nm">{nameOf(officer)}</span>
    </span>
  );
}

/**
 * 장수 그림 + 등급 후광(A·S·E). 그림은 **액션 시트의 꼬마 장수**다(78쪽 목업) — 수묵
 * 초상화가 아니다. 평상 자세로 5초 서 있다가 평상 동작 · 공격 · 마법 중 하나를 한다(장수 카드와 같은 `OfficerActionArt`).
 */
export function Portrait({ officer, size = 'lg' }: { officer: OfficerId; size?: 'lg' | 'sm' }): React.JSX.Element {
  return (
    <span className={`mkt-portrait ${size}`} data-grade={gradeOf(officer)}>
      <Halo grade={gradeOf(officer)} burst />
      <OfficerActionArt officer={officer} className="mkt-portrait-art" />
    </span>
  );
}

/**
 * 머리 판 — 금화 · 거느린 장수(풀/상한) · 잉여 카드 (2026-11-24 기획자). 잉여 카드의 그림은 장수 카드다(화로 그림은 걷었다).
 * 장터 홈 현황판과 **같은 자리 · 같은 높이**라 `.place-body` 밖, `MarketScreen`이 그린다.
 */
export function MercStatus({ profile }: { profile: PlayerProfile }): React.JSX.Element {
  return (
    <section className="place-panel mkt-status mkt-merc-status" data-field="mercStatus">
      <span className="mkt-cur" data-currency="gold" data-field="gold" data-gold={profile.gold}>
        <img src="market/gold.png" alt={t('market.gold')} title={t('market.gold')} />
        <b className="v">{profile.gold.toLocaleString('en-US')}</b>
      </span>
      <span className="mkt-cur" data-field="pool" data-used={poolUsed(profile)} data-cap={poolCap(profile)}>
        <GameIcon name="tab-officer" label={t('market.status.pool')} />
        <b className="v">{poolUsed(profile)}/{poolCap(profile)}</b>
      </span>
      <span className="mkt-cur" data-field="surplus" data-surplus={surplusOf(profile)}>
        <img src="market/market_card.png" alt={t('market.status.surplus')} title={t('market.status.surplus')} />
        <b className="v">{surplusOf(profile)}</b>
      </span>
    </section>
  );
}

/** 모집 칸의 꼬마 — 1명은 하나, 3명은 V자, 5명은 W자(가입 오프닝의 W 대형과 같은 결). 일부러 이름 없는 하급 장수들 */
const RECRUIT_STANDS: readonly OfficerId[] = ['gyeong-mu', 'go-sun', 'gwak-jeok', 'go-chang', 'gwan-hae'] as OfficerId[];
/** 칸 안 자리 — `x`는 가로 %(가운데), `top`이면 뒷줄(위로 조금, 조금 작게) */
const RECRUIT_LAYOUT: Record<number, readonly { x: number; top: boolean }[]> = {
  1: [{ x: 50, top: false }],
  3: [{ x: 22, top: true }, { x: 50, top: false }, { x: 78, top: true }],
  5: [{ x: 12, top: false }, { x: 31, top: true }, { x: 50, top: false }, { x: 69, top: true }, { x: 88, top: false }],
};

/** 모집 칸의 그림 — 꼬마 1 · V자 3 · W자 5 */
function RecruitArt({ count }: { count: number }): React.JSX.Element {
  const spots = RECRUIT_LAYOUT[count] ?? RECRUIT_LAYOUT[1]!;
  return (
    <span className="mkt-recruit-art" data-count={count}>
      {spots.map((s, i) => (
        <span key={i} className="mkt-recruit-spot" data-top={s.top || undefined} style={{ left: `${s.x}%` }}>
          <OfficerStand officer={RECRUIT_STANDS[i]!} className="mkt-recruit-stand" />
        </span>
      ))}
    </span>
  );
}

/** 가격 띠의 붓 획 색 — 첫 줄은 금화 충전과 같은 옥색 · 쪽빛 · 짙은 자주, 둘째 줄은 녹슨 갈색 · 주홍 · 금 */
const PULL_STROKE: Record<GachaPullKind, number> = { one: 5, three: 7, five: 6 };
const SURPLUS_STROKE: Record<SurplusGrade, number> = { A: 2, S: 4, E: 8 };

export function MercView({ profile, run, busy, onBack }: {
  profile: PlayerProfile;
  onChange: (next: PlayerProfile) => void;
  run: ServerCall;
  busy: boolean;
  onBack: () => void;
}): React.JSX.Element {
  const [pull, setPull] = useState<PullStep>(null);
  const [got, setGot] = useState<OfficerId | null>(null);
  /** 막힌 칸을 눌렀을 때 내관이 하는 말 — 누를 때마다 다시 선다 */
  const [why, setWhy] = useState<{ text: string; code: string } | null>(null);
  const seats = poolSeatsFree(profile);
  const emperor = hasEmperor(profile);

  const refuse = (r: MetaResult): void => {
    if (!r.ok) setWhy({ text: reasonText(r), code: r.code ?? 'refused' });
  };

  const doPull = (kind: GachaPullKind): void => {
    if (busy) return;
    const can = canPullGacha(profile, kind);
    if (!can.ok) { refuse(can); return; }
    setWhy(null);
    // 모집은 결과(뽑힌 장수)도 함께 온다 — `run`이 프로필만 넘기므로 여기서 한 번 감싼다
    let pulled: Pulled | null = null;
    run(async () => {
      const r = await pullGachaOnServer(kind);
      if (!r) return null;
      pulled = { kind, drawn: r.drawn, fates: r.fates, exhausted: r.exhausted };
      return r.profile;
    }, () => {
      if (!pulled) { setPull(null); return; }
      const g: Pulled = pulled;
      if (g.drawn.length === 0) { setPull({ at: 'result', got: g }); return; }
      if (g.drawn.length > 1) { setPull({ at: 'charge', got: g }); return; }
      // 소리는 무대가 뜨는 바로 그 순간에 — 섬광의 틈(`lead`)이 이 시각부터 잰다
      playSfx(PULL_SOUND[kind].sfx, { from: PULL_SOUND[kind].from });
      setPull({ at: 'burst', got: g });
    });
  };


  const doExchange = (grade: SurplusGrade): void => {
    if (busy) return;
    const can = canExchangeSurplus(profile, grade);
    if (!can.ok) { refuse(can); return; }
    setWhy(null);
    let officer: OfficerId | null = null;
    run(async () => {
      const r = await exchangeSurplusOnServer(grade);
      if (!r) return null;
      officer = r.officer;
      return r.profile;
    }, () => { if (officer) setGot(officer); });
  };

  return (
    <>
      <section className="place-panel mkt-list mkt-charge mkt-merc-shop" data-field="mercShop" data-seats={seats}>
        <div className="mkt-packs">
          {GACHA_PULL_KINDS.map((kind) => {
            const cost = gachaPullCost(kind);
            // 궁궐 빈자리가 모자라면 막는다 — 자물쇠가 덮고 「궁궐 증축 필요」 (2026-11-24 기획자)
            const noSeat = seats < cost.count;
            return (
              <button key={kind} type="button" className="mkt-pack mkt-recruit" data-action={`pull-${kind}`} data-kind={kind}
                data-count={cost.count} data-gold={cost.gold} data-locked={noSeat || undefined} disabled={busy || noSeat} onClick={() => doPull(kind)}>
                {noSeat && (
                  <span className="mkt-pack-lock" data-field="noSeat">
                    <GameIcon name="mk-lock" label="" />
                    <span>{t('market.recruit.locked')}</span>
                  </span>
                )}
                <RecruitArt count={cost.count} />
                <span className="mkt-pack-name">{t('market.recruit.n', { n: cost.count })}</span>
                <span className="mkt-pack-price" data-stroke={PULL_STROKE[kind]} data-field="pullCost"><GoldCost gold={cost.gold} times /></span>
              </button>
            );
          })}
          {SURPLUS_GRADES.map((grade) => {
            const locked = grade === 'E' && !emperor;
            return (
              <button key={grade} type="button" className="mkt-pack mkt-surplus" data-action={`surplus-${grade}`} data-grade={grade}
                data-cost={surplusCost(grade)} data-locked={locked || undefined} disabled={busy || locked} onClick={() => doExchange(grade)}>
                <span className="mkt-surplus-art">
                  <Halo grade={grade} />
                  <img src="market/market_card.png" alt="" />
                  <GradeBadge grade={grade} />
                </span>
                <span className="mkt-pack-name">{t('market.surplus.pick', { grade })}</span>
                <span className="mkt-pack-price" data-stroke={SURPLUS_STROKE[grade]} data-field="surplusCost">
                  <span className="mkt-gold"><img src="market/market_card.png" alt={t('market.status.surplus')} /> × {surplusCost(grade)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <Say text={why?.text ?? null} level={profile.cityLevel} name="mercWhy" code={why?.code} repeat />

      <section className="place-panel mkt-cmds">
        <div className="frg-buttons">
          <button className="btn wide" data-action="backHome" onClick={onBack}>
            <span className="lbl">{t('market.backHome')}</span>
          </button>
        </div>
      </section>

      {pull?.at === 'charge' && (
        <Layer>
          <CelebrateCharge tier="big" onDone={() => {
            playSfx(PULL_SOUND[pull.got.kind].sfx, { from: PULL_SOUND[pull.got.kind].from });
            setPull({ at: 'burst', got: pull.got });
          }} />
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

      {/* ── 잉여 카드로 모집한 결과 — 섬광 없이 곧바로 ── */}
      {got && (
        <DoneModal
          title={<Who officer={got} />}
          field="surplusDone"
          onClose={() => setGot(null)}
          actions={<button className="btn wide" data-action="surplusClose" onClick={() => setGot(null)}>{t('market.close')}</button>}
        >
          <div className="mkt-reveal-one" data-officer={got}>
            <Portrait officer={got} />
          </div>
          <p className="mkt-done-big" data-field="surplusGot">{t('market.surplus.got')}</p>
        </DoneModal>
      )}
    </>
  );
}

/** 모집 결과 — 한 장이면 크게(78쪽), 여럿이면 칸으로. 잉여 카드가 된 장에는 표가 붙는다 */
function PullResult({ got, profile, busy, onAgain, onClose }: {
  got: Pulled;
  profile: PlayerProfile;
  busy: boolean;
  onAgain: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const cost = gachaPullCost(got.kind);
  const can = canPullGacha(profile, got.kind);
  const one = got.drawn.length === 1;
  const tag = (i: number): React.ReactNode => got.fates[i] === 'surplus'
    ? <span className="mkt-fate" data-fate="surplus">{t('market.reveal.surplus')}</span>
    : got.fates[i] === 'new' ? <span className="mkt-fate" data-fate="new">{t('market.reveal.new')}</span> : null;
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
        <div className="mkt-reveal-one" data-officer={got.drawn[0]} data-fate={got.fates[0]}>
          <Portrait officer={got.drawn[0]!} />
          {tag(0)}
        </div>
      ) : (
        <div className="mkt-reveal-grid" data-count={got.drawn.length}>
          {got.drawn.map((id, i) => (
            <div key={`${id}-${i}`} className="mkt-reveal-cell" data-officer={id} data-grade={gradeOf(id)} data-fate={got.fates[i]}>
              <Portrait officer={id} size="sm" />
              <Who officer={id} />
              {tag(i)}
            </div>
          ))}
        </div>
      )}
      {got.exhausted && <p className="note">{t('market.reveal.exhausted')}</p>}
    </DoneModal>
  );
}
