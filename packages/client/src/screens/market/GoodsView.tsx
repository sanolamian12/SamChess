/**
 * 도시 물자 — 건축 자재 · 군량 · 연구 초기화 · 초심의 서(옛 장수 재설계) (2026-09-24, pptx 86~88쪽).
 *
 * ```
 * 머리 판   [금화] n   [자재] n   [군량] n/최대      ← `GoodsStatus` — 줄마다 붙던 「(현재 : n)」을 걷었다
 *          [건축 자재 🪙] [군량 🪙]                  ← 두 칸
 *          [연구 초기화 ............ 🪙]             ← 한 줄
 *          [초심의 서 .............. 🪙]             ← 한 줄
 * 바닥     [뒤로 가기]
 * ```
 * 꼴은 용병 시장 그대로다(대자보 종이 카드 + 붓 획 가격 띠, 2026-11-25 기획자). 못 사는 칸 — 군량 창고가 참 · 태학이 없거나
 * 되돌릴 연구가 없음 · Lv2 이상 장수가 없음 · 금화 모자람 — 은 잿빛이고, **눌러도 판이 안 뜨고 내관이 까닭을 말한다**.
 *
 * ────────────────────────────────────────────────────────────────
 * 초기화 둘은 **여기서 사고 여기서 쓴다** ★ (2026-09-24 기획자 확정 — 옛 기획을 엎었다)
 * ────────────────────────────────────────────────────────────────
 *
 * 전에는 「사는 곳은 장터, 쓰는 곳은 원래 자리(궁궐·태학)」였고, 실제로는 궁궐·태학에서
 * 금화를 바로 냈다. 이제 **장터에서 고르고 확정하면 그 자리에서 끝나고**, 완료 판에
 * [태학으로 이동]·[궁궐로 이동]이 있어 다시 올리러 곧장 간다. 궁궐의 [재설계] 단추는
 * 지웠다 — 두 곳에 두면 값과 설명이 한쪽만 낡는다.
 *
 * 판정·계산은 전부 규칙과 서버다 — `canResetAcademy`/`POST /academy/reset`,
 * `canRespec`/`POST /officer/respec`. 금화가 서버 소유라 못 닿으면 물러나지 않는다.
 */

import { useRef, useState } from 'react';
import { officerById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  ACADEMY_RESET_GOLD, GRAIN_PACK, MATERIAL_PACK, RESPEC_GOLD, academyOf, canBuyGrain, canBuyMaterials,
  canResetAcademy, canRespec, cardsSpentOn, grainCap, grainPackCost, materialPackCost,
} from '@samchess/meta';
import type { MetaResult, PlayerProfile } from '@samchess/meta';
import {
  buyGrainOnServer, buyMaterialsOnServer, resetAcademyOnServer, respecOnServer,
} from '../../meta/city.ts';
import { Say } from '../Steward.tsx';
import { t } from '../../i18n/index.ts';
import { reasonText } from '../../i18n/reason.ts';
import { pickOfficerName } from '../../i18n/story.ts';
import { CityBonusMark } from '../CityBonus.tsx';
import { OfficerPickModal } from '../OfficerListScreen.tsx';
import { ConfirmModal, DoneModal, GoldCost, Layer } from './parts.tsx';
import { Portrait } from './MercView.tsx';
import { RespecDone } from './RespecDone.tsx';
import type { ServerCall } from './parts.tsx';
import { GameIcon } from '../GameIcon.tsx';
import { useAllLangLayout } from '../useAllLangLayout.ts';

type Good = 'materials' | 'grain' | 'academyReset' | 'respec';

/** 사고 난 뒤의 판 */
type Step =
  | null
  | { at: 'goodAsk'; good: 'materials' | 'grain' }
  | { at: 'academyAsk' }
  | { at: 'respecPick' }
  | { at: 'respecAsk'; officer: OfficerId }
  | { at: 'done'; good: 'materials' | 'grain'; n: number }
  | { at: 'academyDone' }
  | { at: 'respecDone'; officer: OfficerId; refund: number; fromLevel: number };

/**
 * 확인 창의 [확정 (🪙 × 10)] — 값은 본문이 아니라 **누르는 단추 안에** 둔다(2026-09-25 지정).
 * [다시 뽑기 (🪙 × n)]와 같은 짜임이다.
 */
function OkFor({ gold }: { gold: number }): React.JSX.Element {
  return <span className="mkt-buy-lbl">{t('market.confirm.ok')} (<GoldCost gold={gold} times />)</span>;
}

/**
 * 머리 판 — 금화 · 건축 자재 · 군량(보유/최대) (2026-11-25 기획자 — 용병 시장 머리 판과 같은 꼴).
 * 줄마다 붙던 「(현재 : n)」을 여기로 올렸다. `MarketScreen`이 `.place-body` 밖에 그린다
 */
export function GoodsStatus({ profile }: { profile: PlayerProfile }): React.JSX.Element {
  const cap = grainCap(profile);
  const can = canBuyGrain(profile, Date.now());
  /** 창고에 한 묶음이 안 들어가 막혔는가 — 판정은 규칙(`canBuyGrain`)의 것을 그대로 읽는다 */
  const full = !can.ok && can.code === 'market.grainFull';
  return (
    <section className="place-panel mkt-status mkt-merc-status" data-field="goodsStatus">
      <span className="mkt-cur" data-currency="gold" data-field="gold" data-gold={profile.gold}>
        <img src="market/gold.png" alt={t('market.gold')} title={t('market.gold')} data-tip={t('market.gold')} />
        <b className="v">{profile.gold.toLocaleString('en-US')}</b>
      </span>
      <span className="mkt-cur" data-field="materialsNow" data-materials={profile.materials}>
        <GameIcon name="res-materials" label={t('market.goods.materials')} />
        <b className="v">{profile.materials.toLocaleString('en-US')}</b>
      </span>
      <span className="mkt-cur" data-field="grainNow" data-full={full ? '1' : '0'} data-grain={profile.grain} data-cap={cap}>
        <GameIcon name={full ? 'grain-full' : 'res-grain'} label={t('market.goods.grain')} />
        <b className="v">{profile.grain}/{cap}</b>
        {/* 최대 군량 인장 — 눌러도 아무것도 안 산다(인장이 전파를 막는다, 2026-10-15) */}
        <CityBonusMark profile={profile} keys={['grainCap']} />
      </span>
    </section>
  );
}

/** 가격 띠의 붓 획 색 — 용병 시장과 같은 그림(`.mkt-pack-price[data-stroke]`) */
const GOOD_STROKE: Record<Good, number> = { materials: 2, grain: 5, academyReset: 7, respec: 6 };

export function GoodsView({ profile, onChange, busy, run, onBack, onAcademy, onLevelUp }: {
  profile: PlayerProfile;
  onChange: (next: PlayerProfile) => void;
  busy: boolean;
  run: ServerCall;
  onBack: () => void;
  /** [태학으로 이동] */
  onAcademy: () => void;
  /** [궁궐로 이동] — 방금 되감은 그 장수의 레벨/스킬 관리로 곧장 */
  onLevelUp: (officer: OfficerId) => void;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>(null);
  /** 막힌 칸을 눌렀을 때 내관이 하는 말 — 누를 때마다 다시 선다(용병 시장과 같은 몸짓) */
  const [why, setWhy] = useState<{ text: string; code: string } | null>(null);
  const now = Date.now();

  /** 재설계는 **장수마다** 되는지가 갈려 여기서는 「되감을 장수가 있는가 + 금화」만 본다 */
  const respecAny: MetaResult = (() => {
    if (!Object.values(profile.roster).some((i) => i.level >= 2)) return { ok: false, reason: t('market.goods.respecNone'), code: 'respecNone' };
    if (profile.gold < RESPEC_GOLD) {
      return { ok: false, reason: '', code: 'market.notEnoughGold', params: { have: profile.gold, need: RESPEC_GOLD } };
    }
    return { ok: true };
  })();

  const goods: { id: Good; icon: string; gold: number; can: MetaResult; amount?: number; desc: string }[] = [
    {
      id: 'materials', icon: 'materials', gold: materialPackCost(), can: canBuyMaterials(profile), amount: MATERIAL_PACK,
      desc: t('market.goods.materials.desc', { n: MATERIAL_PACK }),
    },
    {
      id: 'grain', icon: 'grain', gold: grainPackCost(), can: canBuyGrain(profile, now), amount: GRAIN_PACK,
      desc: t('market.goods.grain.desc', { n: GRAIN_PACK }),
    },
    {
      id: 'academyReset', icon: 'respec-scroll', gold: ACADEMY_RESET_GOLD, can: canResetAcademy(profile),
      desc: t('market.goods.academyReset.desc'),
    },
    // 「초심의 서」 (2026-09-25 개명) — 그림도 두루마리에서 책 한 권으로
    { id: 'respec', icon: 'gacha-single', gold: RESPEC_GOLD, can: respecAny, desc: t('market.goods.respec.desc') },
  ];
  /* 긴 칸 둘(연구 초기화 · 초심의 서)의 높이는 열 언어 가운데 가장 큰 것에 맞춘다 — 어느 언어로 봐도 판이 같은 크기다
     (`useAllLangLayout`, 2026-11-13 기획자). `sig`는 언어와 무관한 값만 */
  const listRef = useRef<HTMLElement>(null);
  useAllLangLayout(
    [{ box: listRef, rows: ':scope .mkt-good-wide' }],
    JSON.stringify([goods.map((g) => [g.id, g.gold, g.can.ok]), profile.materials, profile.grain, profile.gold]),
  );

  /** 못 사는 까닭 — 규칙이 코드를 실었으면 그 언어 문구로, 아니면 화면이 지은 문장(`respecNone`) 그대로 */
  const whyText = (r: MetaResult): string =>
    r.ok ? '' : r.code === 'respecNone' ? r.reason : reasonText(r);

  /**
   * 칸을 누르면 다음 판이 곧장 뜬다. 자재 · 군량은 「구매할까요?」 확인 판, 연구 초기화는 제 확인 판, 초심의 서는 장수 고르기 판.
   * **막힌 칸도 눌린다** — 누르면 내관이 까닭을 말한다(판에 이유 줄을 띄우지 않는다, 2026-11-25 기획자 — 용병 시장과 같은 몸짓).
   */
  const buy = (id: Good): void => {
    const g = goods.find((x) => x.id === id);
    if (!g || busy) return;
    if (!g.can.ok) { setWhy({ text: whyText(g.can), code: g.can.code ?? id }); return; }
    setWhy(null);
    if (id === 'materials' || id === 'grain') {
      setStep({ at: 'goodAsk', good: id });
    } else if (id === 'academyReset') {
      setStep({ at: 'academyAsk' });
    } else {
      setStep({ at: 'respecPick' });
    }
  };

  /** 확인 판의 [확정] — 서버가 사고, 늘어난 만큼을 완료 판이 말한다 */
  const purchase = (good: 'materials' | 'grain'): void => {
    if (good === 'materials') {
      const before = profile.materials;
      run(buyMaterialsOnServer, (next) => setStep({ at: 'done', good: 'materials', n: next.materials - before }));
    } else {
      const before = profile.grain;
      run(buyGrainOnServer, (next) => setStep({ at: 'done', good: 'grain', n: next.grain - before }));
    }
  };

  const nameOf = (id: OfficerId): string => {
    const o = officerById.get(id);
    return o ? pickOfficerName(o) : id;
  };
  const instantUntil = academyOf(profile).done.length;

  /** 칸 하나 — 용병 시장과 같은 종이 카드. 막힌 칸은 잿빛이지만 눌린다(`data-locked`) */
  const card = (g: (typeof goods)[number], wide: boolean): React.JSX.Element => (
    <button key={g.id} type="button" className={`mkt-pack mkt-good${wide ? ' mkt-good-wide' : ''}`}
      data-action="buyGood" data-good={g.id} data-can={g.can.ok ? '1' : '0'} data-locked={g.can.ok ? undefined : true}
      aria-label={t(`market.goods.${g.id}`)} disabled={busy} onClick={() => buy(g.id)}>
      <span className="mkt-good-art"><img src={`market/${g.icon}.png`} alt="" /></span>
      {/* 받는 양 — 그림에서 떨어져 가격 띠(붓 획)의 오른쪽 끝에 맞춘다 (2026-11-25 기획자) */}
      {g.amount !== undefined && <span className="mkt-good-qty" data-field="goodQty">+{g.amount}</span>}
      <span className="mkt-good-body">
        <span className="mkt-good-nm">{t(`market.goods.${g.id}`)}</span>
        {wide && <span className="mkt-good-fx">{g.desc}</span>}
      </span>
      <span className="mkt-pack-price" data-stroke={GOOD_STROKE[g.id]} data-field="goodCost"><GoldCost gold={g.gold} times /></span>
    </button>
  );
  const byId = (id: Good): (typeof goods)[number] => goods.find((g) => g.id === id)!;

  return (
    <>
      {/* 용병 시장의 꼴 (2026-11-25 기획자) — 첫 줄 건축 자재 · 군량 두 칸, 그 밑 연구 초기화 한 줄, 초심의 서 한 줄 */}
      <section ref={listRef} className="place-panel mkt-list mkt-charge mkt-merc-shop mkt-goods" data-field="goods">
        <div className="mkt-packs mkt-goods-pair">
          {card(byId('materials'), false)}
          {card(byId('grain'), false)}
        </div>
        <div className="mkt-goods-wides">
          {card(byId('academyReset'), true)}
          {card(byId('respec'), true)}
        </div>
      </section>
      <Say text={why?.text ?? null} level={profile.cityLevel} name="goodsWhy" code={why?.code} repeat />

      <section className="place-panel mkt-cmds">
        <div className="frg-buttons">
          <button className="btn wide" data-action="backHome" onClick={onBack}>
            <span className="lbl">{t('market.backHome')}</span>
          </button>
        </div>
      </section>

      {step?.at === 'done' && (
        <DoneModal
          title={t(step.good === 'materials' ? 'market.goods.materials.done' : 'market.goods.grain.done')}
          field="goodsDone"
          onClose={() => setStep(null)}
          actions={<button className="btn wide" data-action="goodsClose" onClick={() => setStep(null)}>{t('market.close')}</button>}
        >
          <img className="mkt-done-art" src={`market/${step.good}.png`} alt="" />
          <p className="mkt-done-big" data-field="goodsGot">
            {t(step.good === 'materials' ? 'market.goods.materials.got' : 'market.goods.grain.got', { n: step.n })}
          </p>
        </DoneModal>
      )}

      {/* ── 건축 자재 · 군량 — 「구매할까요?」 (2026-11-13 기획자) ── */}
      {step?.at === 'goodAsk' && (() => {
        const g = goods.find((x) => x.id === step.good)!;
        return (
          <ConfirmModal
            title={t(`market.goods.${step.good}`)}
            field="goodAsk"
            okLabel={<OkFor gold={g.gold} />}
            disabled={busy || !g.can.ok}
            onConfirm={() => purchase(step.good)}
            onClose={() => setStep(null)}
          >
            <img className="mkt-done-art" src={`market/${g.icon}.png`} alt="" />
            <p className="mkt-confirm-lead" data-field="goodAskWhat">{g.desc}</p>
            <p className="mkt-confirm-ask">{t('market.confirm.ask')}</p>
          </ConfirmModal>
        );
      })()}

      {/* ── 태학 연구 초기화 (87쪽) ── */}
      {step?.at === 'academyAsk' && (
        <ConfirmModal
          title={t('market.goods.academyReset')}
          field="academyAsk"
          okLabel={<OkFor gold={ACADEMY_RESET_GOLD} />}
          disabled={busy}
          onConfirm={() => run(resetAcademyOnServer, () => setStep({ at: 'academyDone' }))}
          onClose={() => setStep(null)}
        >
          <p className="mkt-confirm-lead">{t('market.academyReset.what')}</p>
          <p>{instantUntil > 0 ? t('market.academyReset.instant', { level: instantUntil }) : t('market.academyReset.noInstant')}</p>
          <p className="mkt-confirm-ask">{t('market.confirm.ask')}</p>
        </ConfirmModal>
      )}
      {step?.at === 'academyDone' && (
        <DoneModal
          title={t('market.academyReset.done')}
          field="academyDone"
          onClose={() => setStep(null)}
          actions={(
            <>
              <button className="btn wide" data-action="toAcademy" onClick={onAcademy}>{t('market.academyReset.go')}</button>
              <button className="btn wide" data-action="goodsClose" onClick={() => setStep(null)}>{t('market.close')}</button>
            </>
          )}
        >
          <img className="mkt-done-art" src="market/respec-scroll.png" alt="" />
        </DoneModal>
      )}

      {/* ── 장수 재설계 (88쪽) — Lv2 이상만 ── */}
      {step?.at === 'respecPick' && (
        <Layer>
        <OfficerPickModal
          profile={profile}
          onChange={onChange}
          title={t('market.respec.pickTitle')}
          only={(id) => (profile.roster[id]?.level ?? 1) >= 2}
          // 열은 카드 수 · HP · MP · AT, 줄을 누르면 곧장 「확정하시겠습니까?」 (2026-11-25 기획자)
          growth
          onPick={(officer) => setStep({ at: 'respecAsk', officer })}
          onClose={() => setStep(null)}
          // 판은 「도시 물자」 제목 바 바로 아래, [뒤로 가기]는 판 안 맨 아래 (2026-11-25 기획자)
          className="mkt-pick-back"
        />
        </Layer>
      )}
      {step?.at === 'respecAsk' && (() => {
        const officer = step.officer;
        const level = profile.roster[officer]?.level ?? 1;
        const refund = cardsSpentOn(level);
        const can = canRespec(profile, officer);
        return (
          <ConfirmModal
            title={t('market.goods.respec')}
            field="respecAsk"
            okLabel={<OkFor gold={RESPEC_GOLD} />}
            disabled={busy || !can.ok}
            onConfirm={() => run(() => respecOnServer(officer), () => setStep({ at: 'respecDone', officer, refund, fromLevel: level }))}
            onClose={() => setStep({ at: 'respecPick' })}
          >
            <p className="mkt-confirm-lead">{t('market.respec.what', { name: nameOf(officer), level })}</p>
            <Portrait officer={officer} size="sm" />
            <p>{t('market.respec.refund', { n: refund })}</p>
            <Say text={can.ok ? null : reasonText(can)} level={profile.cityLevel} name="respecWhy" />
            <p className="mkt-confirm-ask">{t('market.confirm.ask')}</p>
          </ConfirmModal>
        );
      })()}
      {/* 명상하는 선비 → 기의 구슬 → 어두운 무대의 장수 · 돌려받은 카드 (2026-11-26 기획자, `RespecDone`) */}
      {step?.at === 'respecDone' && (
        <RespecDone officer={step.officer} fromLevel={step.fromLevel} refund={step.refund}
          onPalace={() => onLevelUp(step.officer)} onClose={() => setStep(null)} />
      )}
    </>
  );
}
