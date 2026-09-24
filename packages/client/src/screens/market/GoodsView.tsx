/**
 * 도시 물자 — 건축 자재 · 군량 · 태학 연구 초기화 · 장수 재설계 (2026-09-24, pptx 86~88쪽).
 *
 * 한 판에 넷을 세로로 놓고 오른쪽 나무판으로 **하나를 고른 뒤** [구매하기]를 누른다
 * (전투 아이템·보관함과 같은 몸짓).
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

import { useState } from 'react';
import { officerById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  ACADEMY_RESET_GOLD, GRAIN_PACK, MATERIAL_PACK, RESPEC_GOLD, academyOf, canBuyGrain, canBuyMaterials,
  canResetAcademy, canRespec, cardsSpentOn, grainPackCost, materialPackCost,
} from '@samchess/meta';
import type { MetaResult, PlayerProfile } from '@samchess/meta';
import {
  buyGrainOnServer, buyMaterialsOnServer, resetAcademyOnServer, respecOnServer,
} from '../../meta/city.ts';
import { t } from '../../i18n/index.ts';
import { reasonText } from '../../i18n/reason.ts';
import { pickOfficerName } from '../../i18n/story.ts';
import { GradeBadge } from '../GradeBadge.tsx';
import { OfficerPickModal } from '../OfficerListScreen.tsx';
import { ConfirmModal, DoneModal, GoldCost, Layer } from './parts.tsx';
import { Portrait } from './MercView.tsx';
import type { ServerCall } from './parts.tsx';

type Good = 'materials' | 'grain' | 'academyReset' | 'respec';

/** 사고 난 뒤의 판 */
type Step =
  | null
  | { at: 'academyAsk' }
  | { at: 'respecPick' }
  | { at: 'respecAsk'; officer: OfficerId }
  | { at: 'done'; good: 'materials' | 'grain'; n: number }
  | { at: 'academyDone' }
  | { at: 'respecDone'; officer: OfficerId; refund: number };

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
  const [picked, setPicked] = useState<Good | null>(null);
  const [step, setStep] = useState<Step>(null);
  const now = Date.now();

  /** 재설계는 **장수마다** 되는지가 갈려 여기서는 「되감을 장수가 있는가 + 금화」만 본다 */
  const respecAny: MetaResult = (() => {
    if (!Object.values(profile.roster).some((i) => i.level >= 2)) return { ok: false, reason: t('market.goods.respecNone') };
    if (profile.gold < RESPEC_GOLD) return { ok: false, reason: t('market.pull.notEnough', { have: profile.gold, need: RESPEC_GOLD }) };
    return { ok: true };
  })();

  const goods: { id: Good; icon: string; gold: number; can: MetaResult; desc: string }[] = [
    {
      id: 'materials', icon: 'materials', gold: materialPackCost(), can: canBuyMaterials(profile),
      desc: t('market.goods.materials.desc', { n: MATERIAL_PACK }),
    },
    {
      id: 'grain', icon: 'grain', gold: grainPackCost(), can: canBuyGrain(profile, now),
      desc: t('market.goods.grain.desc', { n: GRAIN_PACK }),
    },
    {
      id: 'academyReset', icon: 'respec-scroll', gold: ACADEMY_RESET_GOLD, can: canResetAcademy(profile),
      desc: t('market.goods.academyReset.desc'),
    },
    { id: 'respec', icon: 'respec-scroll', gold: RESPEC_GOLD, can: respecAny, desc: t('market.goods.respec.desc') },
  ];
  const sel = goods.find((g) => g.id === picked);

  const buy = (): void => {
    if (!sel || !sel.can.ok || busy) return;
    if (sel.id === 'materials') {
      const before = profile.materials;
      run(buyMaterialsOnServer, (next) => setStep({ at: 'done', good: 'materials', n: next.materials - before }));
    } else if (sel.id === 'grain') {
      const before = profile.grain;
      run(buyGrainOnServer, (next) => setStep({ at: 'done', good: 'grain', n: next.grain - before }));
    } else if (sel.id === 'academyReset') {
      setStep({ at: 'academyAsk' });
    } else {
      setStep({ at: 'respecPick' });
    }
  };

  const nameOf = (id: OfficerId): string => {
    const o = officerById.get(id);
    return o ? pickOfficerName(o) : id;
  };
  const instantUntil = academyOf(profile).done.length;

  return (
    <>
      <section className="place-panel mkt-list" data-field="goods">
        <h2 className="cap">{t('market.items.buyable')}</h2>
        <div className="mkt-grows">
          {goods.map((g) => (
            <div
              key={g.id}
              className="mkt-grow"
              data-good={g.id}
              data-picked={picked === g.id ? '1' : '0'}
              data-can={g.can.ok ? '1' : '0'}
              onClick={() => setPicked(g.id)}
            >
              <img className="c-art" src={`market/${g.icon}.png`} alt="" />
              <span className="c-body">
                <span className="c-nm">{t(`market.goods.${g.id}`)}</span>
                <span className="c-price"><GoldCost gold={g.gold} /></span>
                <span className="c-fx">{g.desc}</span>
                {/* 안 되는 이유는 **제 줄 안에** — 끝에 몰면 어느 줄 이야기인지 모른다 */}
                {!g.can.ok && <span className="c-why" data-field="why">{reasonText(g.can)}</span>}
              </span>
              <span className="c-q">
                <button
                  className="lv-check mkt-check"
                  data-action="pickGood"
                  aria-pressed={picked === g.id}
                  onClick={(e) => { e.stopPropagation(); setPicked(g.id); }}
                >
                  <img className="lv-check-icon" src="icons/confirm.png" alt="" />
                </button>
              </span>
            </div>
          ))}
        </div>
        <button className="btn primary wide" data-action="buyGood" disabled={busy || !sel || !sel.can.ok} onClick={buy}>
          {t('market.goods.buy')}
        </button>
      </section>

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

      {/* ── 태학 연구 초기화 (87쪽) ── */}
      {step?.at === 'academyAsk' && (
        <ConfirmModal
          title={t('market.goods.academyReset')}
          field="academyAsk"
          okLabel={t('market.confirm.ok')}
          disabled={busy}
          onConfirm={() => run(resetAcademyOnServer, () => setStep({ at: 'academyDone' }))}
          onClose={() => setStep(null)}
        >
          <p className="mkt-confirm-lead">{t('market.academyReset.what')}</p>
          <p>{instantUntil > 0 ? t('market.academyReset.instant', { level: instantUntil }) : t('market.academyReset.noInstant')}</p>
          <p className="mkt-confirm-cost"><GoldCost gold={ACADEMY_RESET_GOLD} /></p>
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
          onPick={(officer) => setStep({ at: 'respecAsk', officer })}
          onClose={() => setStep(null)}
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
            disabled={busy || !can.ok}
            onConfirm={() => run(() => respecOnServer(officer), () => setStep({ at: 'respecDone', officer, refund }))}
            onClose={() => setStep({ at: 'respecPick' })}
          >
            <p className="mkt-confirm-lead">{t('market.respec.what', { name: nameOf(officer), level })}</p>
            <Portrait officer={officer} size="sm" />
            <p>{t('market.respec.refund', { n: refund })}</p>
            <p className="mkt-confirm-cost"><GoldCost gold={RESPEC_GOLD} /></p>
            {!can.ok && <p className="note">{can.reason}</p>}
            <p className="mkt-confirm-ask">{t('market.confirm.ask')}</p>
          </ConfirmModal>
        );
      })()}
      {step?.at === 'respecDone' && (
        <DoneModal
          title={t('market.respec.done')}
          field="respecDone"
          onClose={() => setStep(null)}
          actions={(
            <>
              <button className="btn wide" data-action="toPalace" onClick={() => onLevelUp(step.officer)}>{t('market.respec.go')}</button>
              <button className="btn wide" data-action="goodsClose" onClick={() => setStep(null)}>{t('market.close')}</button>
            </>
          )}
        >
          <span className="mkt-who">
            <GradeBadge grade={officerById.get(step.officer)?.grade ?? 'B'} />
            <span className="nm">{nameOf(step.officer)}</span>
          </span>
          <span className="mkt-respec-done">
            <Portrait officer={step.officer} />
            <span className="mkt-done-big" data-field="refund">×{step.refund}</span>
          </span>
          <p className="hint">{t('market.respec.refunded')}</p>
        </DoneModal>
      )}
    </>
  );
}
