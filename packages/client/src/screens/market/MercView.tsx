/**
 * 용병 시장 — 장수 모집 · 잉여 카드로 모집 (2026-11-24 기획자 — 카드 뽑기 팝업 · 카드 정리를 걷고 한 판으로).
 *
 * ```
 * 현황판   [금화] n   [장수] 풀/상한   [잉여 카드] n
 * 장수 모집 / 신규 또는 기존 장수
 *          [🪙10] [🪙25] [🪙40]   ← 검은 꼬마 1 · V자 3 · W자 5(글자 없음), 뒤 후광이 금 → 자주 → 붉은 → 푸른(E · S · A · B). 궁궐 빈자리가 모자라면 자물쇠 + 「궁궐 증축 필요」
 * 장수 레벨업 카드 / 기존 장수 중 랜덤 한 명
 *          [🂠10] [🂠20] [🂠30]   ← 잉여 카드로. 카드 가운데 위 등급 표(A · S · E, 글자 없음) + 표 뒤 후광. E급은 헌제를 거느릴 때만(아니면 잿빛)
 * 바닥     [뒤로 가기]
 * ```
 *
 * - 꾸밈은 금화 충전 판과 같다(`.mkt-packs` · `.mkt-pack` — 대자보 종이 카드 + 붓 획 가격 띠).
 * - **궁궐의 빈자리보다 많이는 모집하지 못한다**(`canPullGacha`, 2026-11-24 기획자) — 빈자리 4면 5명이, 2면 3명도 막힌다.
 *   막힌 칸은 자물쇠가 덮고 「궁궐 증축 필요」라고 적는다. 그래서 모집에서는 새 장수가 언제나 풀에 든다.
 * - 모집 결과는 **걷는 장면 → 번쩍 → 무대**(2026-11-25 기획자, `Design/장수모집연출/시나리오.html`) — `Celebrate`의 `recruit` 도입부.
 *   뽑은 수만큼 실루엣이 걸어오고(높은 등급이 가운데, 등 뒤에 A 흰 · S 자주 · E 금 섬광), 걷는 중에 누르면 곧장 번쩍.
 *   무대는 계정 문장 앞에 장수들이 걸어온 자리 그대로 서고 「새 장수」 · 「잉여 카드」(Lv9 장수의 카드) 표가 붙는다(서버가 준 `fates`).
 *   단추 없이 아무 데나 누르면 닫힌다 — 옛 결과 판의 [다시 뽑기]는 걷었다.
 *
 * **판정은 전부 규칙과 서버가 한다** — 모집은 `POST /market/gacha`(시드도 서버가), 잉여 카드 모집은
 * `POST /market/surplus`(받는 장수도 서버가 고른다). 화면은 누르게 하고 보여 줄 뿐이다.
 */

import { useState } from 'react';
import { officerById } from '@samchess/data';
import type { Grade, OfficerId } from '@samchess/rules';
import {
  GACHA_GRADES, GACHA_PULL_KINDS, SURPLUS_GRADES, canPullGacha, canExchangeSurplus, gachaPullCost, poolCap,
  poolSeatsFree, poolUsed, surplusCost, surplusOf,
} from '@samchess/meta';
import type { GachaFate, GachaPullKind, MetaResult, PlayerProfile, SurplusGrade } from '@samchess/meta';
import { Say } from '../Steward.tsx';
import { exchangeSurplusOnServer, pullGachaOnServer } from '../../meta/city.ts';
import { t } from '../../i18n/index.ts';
import { pickOfficerName } from '../../i18n/story.ts';
import { reasonText } from '../../i18n/reason.ts';
import { GradeBadge } from '../GradeBadge.tsx';
import { OfficerActionArt, OfficerStand } from '../OfficerArt.tsx';
import { ConfirmModal, GoldCost, Halo, Layer } from './parts.tsx';
import type { ServerCall } from './parts.tsx';
import { GameIcon } from '../GameIcon.tsx';
import { Celebrate } from '../Celebrate.tsx';
import { recruitSeats, recruitWalkers } from './recruitSeats.ts';
import { BlinkGlow, STAND_GLOW, officerBlink } from '../BlinkGlow.tsx';
import { walkerArtOf } from './walkerArt.ts';
import type { BlinkTone } from '../BlinkGlow.tsx';

type Pulled = { kind: GachaPullKind; drawn: OfficerId[]; fates: GachaFate[]; exhausted: boolean };


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
        <img src="market/gold.png" alt={t('market.gold')} title={t('market.gold')} data-tip={t('market.gold')} />
        <b className="v">{profile.gold.toLocaleString('en-US')}</b>
      </span>
      <span className="mkt-cur" data-field="pool" data-used={poolUsed(profile)} data-cap={poolCap(profile)}>
        <GameIcon name="tab-officer" label={t('market.status.pool')} />
        <b className="v">{poolUsed(profile)}/{poolCap(profile)}</b>
      </span>
      <span className="mkt-cur" data-field="surplus" data-surplus={surplusOf(profile)}>
        <img src="market/market_card.png" alt={t('market.status.surplus')} title={t('market.status.surplus')} data-tip={t('market.status.surplus')} />
        <b className="v">{surplusOf(profile)}</b>
      </span>
    </section>
  );
}

/**
 * 모집 칸의 꼬마 — 1명은 하나, 3명은 V자, 5명은 W자(가입 오프닝의 W 대형과 같은 결).
 * **검은 그림자**라 누군지 모른다 — 후광이 나올 수 있는 등급의 빛(금 · 자주 · 붉은 · 푸른)으로 2초마다 부드럽게 바뀌고, 꼬마마다 2초씩 어긋나 한 칸에 여러 빛이 섞인다 (2026-11-25 기획자)
 */
const RECRUIT_STANDS: readonly OfficerId[] = ['gyeong-mu', 'go-sun', 'gwak-jeok', 'go-chang', 'gwan-hae'] as OfficerId[];
/** 칸 안 자리 — `x`는 가로 %(가운데), `top`이면 뒷줄(위로 조금, 조금 작게). 서로 엉겨 붙을 만큼 촘촘하게 */
const RECRUIT_LAYOUT: Record<number, readonly { x: number; top: boolean }[]> = {
  1: [{ x: 50, top: false }],
  3: [{ x: 33, top: true }, { x: 50, top: false }, { x: 67, top: true }],
  5: [{ x: 22, top: false }, { x: 36, top: true }, { x: 50, top: false }, { x: 64, top: true }, { x: 78, top: false }],
};

/**
 * 꼬마 뒤 후광 — 이 모집에서 나올 수 있는 등급(E · S · A · B)의 빛이 2초마다 부드럽게 넘어간다: 금 → 자주 → 붉은 → 푸른
 * (2026-11-25 기획자 — 등급마다 한 색). 넷을 겹쳐 두고 투명도만 돌린다. 등급이 바뀌면 `GACHA_GRADES`를 따른다
 */
const RECRUIT_TONES: readonly BlinkTone[] = GACHA_GRADES.map(officerBlink);

/**
 * 후광 자리 — 꼬마마다 다 달면 정신없다(2026-11-25 기획자): 1명은 그 하나, 3명은 양 끝 둘, 5명은 양 끝 둘 + 가운데 조금 위(`lift`) 하나.
 * 자리 번호는 `RECRUIT_LAYOUT`의 꼬마 차례다
 */
const RECRUIT_GLOWS: Record<number, readonly { spot: number; lift?: boolean }[]> = {
  1: [{ spot: 0 }],
  3: [{ spot: 0 }, { spot: 2 }],
  5: [{ spot: 0 }, { spot: 4 }, { spot: 2, lift: true }],
};

/** 모집 칸의 그림 — 꼬마 1 · V자 3 · W자 5. 후광을 먼저 다 깔고 꼬마를 그 위에 세운다(앞 꼬마의 후광이 뒷 꼬마를 덮지 않게) */
function RecruitArt({ count }: { count: number }): React.JSX.Element {
  const spots = RECRUIT_LAYOUT[count] ?? RECRUIT_LAYOUT[1]!;
  const glows = RECRUIT_GLOWS[count] ?? RECRUIT_GLOWS[1]!;
  const at = (s: { x: number }, i: number): React.CSSProperties =>
    ({ left: `${s.x}%`, ['--halo-delay' as string]: `${-2 * (i % 3)}s` });
  return (
    <span className="mkt-recruit-art" data-count={count}>
      {glows.map((g, i) => (
        <span key={`g${i}`} className="mkt-recruit-spot mkt-recruit-glow" data-top={spots[g.spot]!.top || undefined}
          data-lift={g.lift || undefined} style={at(spots[g.spot]!, i)}>
          {RECRUIT_TONES.map((tone) => <BlinkGlow key={tone} tone={tone} className="mkt-recruit-halo" />)}
        </span>
      ))}
      {spots.map((s, i) => (
        <span key={i} className="mkt-recruit-spot" data-top={s.top || undefined} style={at(s, i)}>
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
  /** 모집 결과 — 서버가 준 뒤 곧장 걷는 장면(`Celebrate` `recruit`)이 열리고, 닫으면 비운다 */
  const [pull, setPull] = useState<Pulled | null>(null);
  const [got, setGot] = useState<OfficerId | null>(null);
  /** 막힌 칸을 눌렀을 때 내관이 하는 말 — 누를 때마다 다시 선다 */
  const [why, setWhy] = useState<{ text: string; code: string } | null>(null);
  /** 사기 전에 묻는 판 — 모집(몇 명) · 레벨업 카드(어느 등급) */
  const [ask, setAsk] = useState<{ at: 'pull'; kind: GachaPullKind } | { at: 'surplus'; grade: SurplusGrade } | null>(null);
  const seats = poolSeatsFree(profile);

  const refuse = (r: MetaResult): void => {
    if (!r.ok) setWhy({ text: reasonText(r), code: r.code ?? 'refused' });
  };

  // 누르면 먼저 묻는다(확정 · 뒤로 가기, 2026-11-25 기획자 — 금화 · 잉여 카드가 되돌릴 수 없이 나간다). 막힌 칸은 묻지 않고 내관이 까닭만
  const askPull = (kind: GachaPullKind): void => {
    if (busy) return;
    const can = canPullGacha(profile, kind);
    if (!can.ok) { refuse(can); return; }
    setWhy(null);
    setAsk({ at: 'pull', kind });
  };
  const askExchange = (grade: SurplusGrade): void => {
    if (busy) return;
    const can = canExchangeSurplus(profile, grade);
    if (!can.ok) { refuse(can); return; }
    setWhy(null);
    setAsk({ at: 'surplus', grade });
  };

  const doPull = (kind: GachaPullKind): void => {
    setAsk(null);
    if (busy) return;
    const can = canPullGacha(profile, kind);
    if (!can.ok) { refuse(can); return; }
    // 모집은 결과(뽑힌 장수)도 함께 온다 — `run`이 프로필만 넘기므로 여기서 한 번 감싼다
    let pulled: Pulled | null = null;
    run(async () => {
      const r = await pullGachaOnServer(kind);
      if (!r) return null;
      pulled = { kind, drawn: r.drawn, fates: r.fates, exhausted: r.exhausted };
      return r.profile;
    }, () => {
      if (!pulled) return;
      const g: Pulled = pulled;
      // 다 떨어져 아무도 안 왔으면 걷는 장면 없이 내관이 말한다
      if (g.drawn.length === 0) { setWhy({ text: t('market.reveal.exhausted'), code: 'exhausted' }); return; }
      setPull(g);
    });
  };


  const doExchange = (grade: SurplusGrade): void => {
    setAsk(null);
    if (busy) return;
    const can = canExchangeSurplus(profile, grade);
    if (!can.ok) { refuse(can); return; }
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
        <div className="mkt-merc-head" data-field="recruitHead">
          <h3>{t('market.recruit.title')}</h3>
          <p>{t('market.recruit.desc')}</p>
        </div>
        <div className="mkt-packs">
          {GACHA_PULL_KINDS.map((kind) => {
            const cost = gachaPullCost(kind);
            // 궁궐 빈자리가 모자라면 막는다 — 자물쇠가 덮고 「궁궐 증축 필요」 (2026-11-24 기획자)
            const noSeat = seats < cost.count;
            return (
              <button key={kind} type="button" className="mkt-pack mkt-recruit" data-action={`pull-${kind}`} data-kind={kind}
                aria-label={t('market.recruit.n', { n: cost.count })}
                data-count={cost.count} data-gold={cost.gold} data-locked={noSeat || undefined} disabled={busy}
                // 막혀도 누를 수 있다 — 누르면 내관이 까닭을 말한다(판에 글을 띄우지 않는다, 2026-11-25 기획자)
                onClick={() => askPull(kind)}>
                {noSeat && (
                  <span className="mkt-pack-lock" data-field="noSeat">
                    <GameIcon name="mk-lock" label="" />
                    <span>{t('market.recruit.locked')}</span>
                  </span>
                )}
                {/* 종이 왼쪽 위 — 몇 명인지 숫자만 (2026-11-25 기획자) */}
                <span className="mkt-pack-no" data-field="recruitCount">{cost.count}</span>
                {/* 종이 위쪽 — 이 모집에서 나올 수 있는 등급 표(E · S · A · B, 2026-11-25 기획자) */}
                <span className="mkt-pack-grades" data-field="recruitGrades">
                  {GACHA_GRADES.map((g) => <GradeBadge key={g} grade={g} />)}
                </span>
                <RecruitArt count={cost.count} />
                <span className="mkt-pack-price" data-stroke={PULL_STROKE[kind]} data-field="pullCost"><GoldCost gold={cost.gold} times /></span>
              </button>
            );
          })}
        </div>
        <div className="mkt-merc-head" data-field="surplusHead">
          <h3>{t('market.surplus.title')}</h3>
          <p>{t('market.surplus.desc')}</p>
        </div>
        <div className="mkt-packs">
          {SURPLUS_GRADES.map((grade) => {
            // 못 사는 칸은 잿빛 — 헌제가 없음 · 받을 장수가 없음 · 잉여 카드가 모자람. **막지는 않는다**: 누르면 내관이 그 까닭을 말한다(2026-11-25 기획자)
            const locked = !canExchangeSurplus(profile, grade).ok;
            return (
              <button key={grade} type="button" className="mkt-pack mkt-surplus" data-action={`surplus-${grade}`} data-grade={grade}
                aria-label={t('market.surplus.pick', { grade })}
                data-cost={surplusCost(grade)} data-locked={locked || undefined} disabled={busy} onClick={() => askExchange(grade)}>
                {/* 등급 표는 카드 한가운데 위에, 1.5배 — 후광은 카드가 아니라 등급 표 뒤에(A 흰 별빛 · S 자주 · E 금) (2026-11-25 기획자) */}
                <span className="mkt-surplus-art">
                  <img src="market/market_card.png" alt="" />
                  {/* 카드 오른쪽 아래 — 받는 장 수 (2026-11-25 기획자) */}
                  <span className="mkt-surplus-qty" data-field="surplusQty">×1</span>
                  <span className="mkt-surplus-mark">
                    <BlinkGlow tone={officerBlink(grade)} className="mkt-surplus-halo" />
                    <GradeBadge grade={grade} />
                  </span>
                </span>
                <span className="mkt-pack-price" data-stroke={SURPLUS_STROKE[grade]} data-field="surplusCost">
                  <span className="mkt-gold"><img src="market/market_card.png" alt={t('market.status.surplus')} /> × {surplusCost(grade)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <Say text={why?.text ?? null} level={profile.cityLevel} name="mercWhy" code={why?.code} repeat />

      {/* ── 사기 전에 묻는다 (2026-11-25 기획자) — 도시 물자의 확인 판과 같은 꼴: 그림 · 한 줄 · 「확정하시겠습니까?」 · [확정 (값)] [뒤로 가기] ── */}
      {ask?.at === 'pull' && (() => {
        const cost = gachaPullCost(ask.kind);
        return (
          <ConfirmModal title={t('market.recruit.title')} field="recruitAsk" disabled={busy}
            okLabel={<span className="mkt-buy-lbl">{t('market.confirm.ok')} (<GoldCost gold={cost.gold} times />)</span>}
            onConfirm={() => doPull(ask.kind)} onClose={() => setAsk(null)}>
            <span className="mkt-ask-art"><RecruitArt count={cost.count} /></span>
            <p className="mkt-confirm-lead" data-field="recruitAskWhat">{t('market.recruit.ask', { n: cost.count })}</p>
            <p className="mkt-confirm-ask">{t('market.confirm.ask')}</p>
          </ConfirmModal>
        );
      })()}
      {ask?.at === 'surplus' && (
        <ConfirmModal title={t('market.surplus.title')} field="surplusAsk" disabled={busy}
          okLabel={<span className="mkt-buy-lbl">{t('market.confirm.ok')} (<span className="mkt-gold"><img src="market/market_card.png" alt={t('market.status.surplus')} /> × {surplusCost(ask.grade)}</span>)</span>}
          onConfirm={() => doExchange(ask.grade)} onClose={() => setAsk(null)}>
          <span className="mkt-surplus-art mkt-ask-card">
            <img src="market/market_card.png" alt="" />
            <span className="mkt-surplus-mark">
              <BlinkGlow tone={officerBlink(ask.grade)} className="mkt-surplus-halo" />
              <GradeBadge grade={ask.grade} />
            </span>
          </span>
          <p className="mkt-confirm-lead" data-field="surplusAskWhat">{t('market.surplus.ask', { grade: ask.grade })}</p>
          <p className="mkt-confirm-ask">{t('market.confirm.ask')}</p>
        </ConfirmModal>
      )}

      <section className="place-panel mkt-cmds">
        <div className="frg-buttons">
          <button className="btn wide" data-action="backHome" onClick={onBack}>
            <span className="lbl">{t('market.backHome')}</span>
          </button>
        </div>
      </section>

      {/* 모집 결과 (2026-11-25 기획자 — `Design/장수모집연출/시나리오.html`) — 석양을 등진 실루엣이 뽑은 수만큼 걸어오다(높은 등급이 가운데, 등 뒤에 등급 섬광)
          해가 번쩍 → 어둠 위 계정 문장(모루처럼 흐리게) 앞에 장수들이 하나씩 선다. 단추 없이 아무 데나 누르면 닫힌다([다시 뽑기]는 걷었다) */}
      {pull && (
        <Layer>
          <Celebrate key={pull.drawn.join()} modal="reveal" okAction="revealClose" intro="recruit" className="rcr-done" title=""
            walkers={recruitWalkers(pull.drawn.map(gradeOf))}
            tone={officerBlink(topGrade(pull.drawn))}
            art={<img className="cel-art-img" src="ui/cel-recruit.png" alt="" />}
            cast={<RecruitCast got={pull} />}
            onClose={() => setPull(null)}>
            {pull.exhausted && <p className="row dim">{t('market.reveal.exhausted')}</p>}
          </Celebrate>
        </Layer>
      )}

      {/* ── 잉여 카드로 모집한 결과 (2026-11-25 기획자 — 장수 모집 1명과 같은 연출) — 실루엣 하나가 걸어와 번쩍 → 문장 앞에 그 장수.
          실루엣은 **받는 장수가 드는 무기**로 고른다(`walkerArtOf` — 창 · 부채 · 칼 · 활 · 그 밖). 등 뒤 섬광은 등급(A 흰 · S 자주 · E 금) ── */}
      {got && (
        <Layer>
          <Celebrate key={got} modal="surplusDone" okAction="surplusClose" intro="recruit" className="rcr-done" title=""
            walkers={[{ art: walkerArtOf(got), glow: STAND_GLOW[gradeOf(got)] ?? null }]}
            tone={officerBlink(gradeOf(got))}
            art={<img className="cel-art-img" src="ui/cel-recruit.png" alt="" />}
            cast={<RecruitCast got={{ kind: 'one', drawn: [got], fates: ['card'], exhausted: false }} />}
            onClose={() => setGot(null)}>
            <p className="row" data-field="surplusGot">{t('market.surplus.got')}</p>
          </Celebrate>
        </Layer>
      )}
    </>
  );
}

/** 가장 높은 등급 — 무대 빛줄기 색 */
const topGrade = (drawn: readonly OfficerId[]): Grade =>
  drawn.map(gradeOf).sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b))[0] ?? 'B';
const GRADE_ORDER: readonly Grade[] = ['E', 'S', 'A', 'B', 'C', 'D'];

/**
 * 무대 위 장수들 — 걸어온 자리(`recruitSeats`) 그대로 선다. 꼬마 크기는 몇 명이든 같다. 1명은 문장 한가운데, 3명은 V자(가운데가 앞),
 * 5명은 두 줄 — 뒷줄 둘(둘째 · 넷째 자리) · 앞줄 셋(가운데가 가장 센 장수). 「NEW」 말풍선은 1명이면 머리 오른쪽 위, 여럿이면 제 머리 바로 위(옆 장수 말풍선과 안 부딪히게). 낮은 등급부터 하나씩 「팡」(등급 후광이 번쩍 뒤 돈다), 발밑에 [등급] 이름과 「새 장수」 · 「잉여 카드」 표
 */
const CAST_SPOTS: Record<number, readonly { x: number; y: number; s: number }[]> = {
  // 1명 — 꼬마 그림의 한가운데가 문장의 한가운데에 오게(2026-11-25 기획자). y는 이름 줄까지 포함한 맨 아래라, 그림(46%) + 이름 줄만큼 내려 잡는다
  1: [{ x: 50, y: 82, s: 1 }],
  // 3 · 5명도 꼬마 크기는 1명과 같다(2026-11-25 기획자 — 「작아질 필요가 없다」) — 겹치는 만큼 앞뒤 줄의 높이를 더 벌린다
  3: [{ x: 21, y: 70, s: 1 }, { x: 50, y: 100, s: 1 }, { x: 79, y: 70, s: 1 }],
  // 5명은 같은 크기로 한 줄 W자에 안 든다(이름이 앞 꼬마에 가렸다) — 뒷줄 둘 · 앞줄 셋, 앞줄은 무대 아래로 조금 내려선다(`.rcr-done`의 아래 여백)
  5: [{ x: 16, y: 118, s: 1 }, { x: 31, y: 54, s: 1 }, { x: 50, y: 118, s: 1 }, { x: 69, y: 54, s: 1 }, { x: 84, y: 118, s: 1 }],
};
/** 장수 하나가 튀어나오는 간격 · 첫 장수까지(무대가 열리고 번쩍이 걷힌 뒤) */
const CAST_STEP_MS = 180;
const CAST_FROM_MS = 380;

function RecruitCast({ got }: { got: Pulled }): React.JSX.Element {
  const n = got.drawn.length >= 5 ? 5 : got.drawn.length >= 3 ? 3 : 1;
  const grades = got.drawn.map(gradeOf);
  const seats = recruitSeats(grades);
  // 낮은 등급부터 — 가장 센 장수가 마지막에
  const popOrder = grades.map((g, i) => ({ i, r: GRADE_ORDER.indexOf(g) })).sort((a, b) => b.r - a.r || a.i - b.i).map((x) => x.i);
  return (
    <div className="rcr-cast" data-count={n} data-field="recruitCast">
      {got.drawn.map((id, i) => {
        const seat = seats[i]!;
        if (seat < 0) return null;
        const spot = CAST_SPOTS[n]![seat]!;
        const delay = CAST_FROM_MS + popOrder.indexOf(i) * CAST_STEP_MS;
        return (
          <div key={`${id}-${i}`} className="rcr-member" data-officer={id} data-grade={grades[i]} data-fate={got.fates[i]} data-seat={seat}
            style={{ left: `${spot.x}%`, top: `${spot.y}%`, zIndex: Math.round(spot.y), '--s': spot.s, animationDelay: `${delay}ms` } as React.CSSProperties}>
            <span className="rcr-fig">
              <Halo grade={grades[i]!} burst />
              <OfficerActionArt officer={id} className="rcr-art" />
              {/* 새 장수 — 노란 말풍선(일기토 「비김」 말풍선 꼴)에 검은 「NEW」, 머리 오른쪽 위에서 톡 (2026-11-25 기획자). 글은 언어마다 짧게 */}
              {got.fates[i] === 'new' && (
                <span className="rcr-new" data-fate="new" style={{ animationDelay: `${delay + 260}ms` }}>
                  <i className="rcr-new-bg" />
                  <b>{t('market.reveal.new')}</b>
                </span>
              )}
            </span>
            <span className="rcr-name"><Who officer={id} /></span>
            {got.fates[i] === 'surplus' && <span className="mkt-fate" data-fate="surplus">{t('market.reveal.surplus')}</span>}
          </div>
        );
      })}
    </div>
  );
}
