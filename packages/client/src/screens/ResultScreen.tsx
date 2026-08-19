/**
 * 전투 결과 — 세 결말과 보상 (GDD §6.4, 2026-08-18 개편)
 *
 * ────────────────────────────────────────────────────────────────
 * 무승부는 **고른 뒤에** 반영된다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 승리·패배는 전투가 끝나는 순간 이미 계정에 들어가 있고, 이 화면은 그것을 보여
 * 주기만 한다. 무승부만 여기서 **묻고 나서** `applyBattleResult()`를 부른다 —
 * 「고르는 도중」이라는 상태를 저장하지 않는 것이 규칙이고(재설계와 같은 결),
 * 그래서 고르기 전에 나가면 전적도 보상도 남지 않는다.
 *
 * 판정을 화면이 하지 않는다는 규약은 그대로다 — 무엇을 주는지는 meta가 정하고
 * 여기서는 **고른 것을 넘길 뿐**이다.
 */

import { useState } from 'react';
import { officerById } from '@samchess/data';
import {
  DRAW_REWARDS, GRAIN_REWARD, MATERIAL_REWARD, applyBattleResult, grainCost, winChance,
} from '@samchess/meta';
import type {
  BattleOutcome, BattleResult, BattleRewards, DrawReward, PlayerProfile,
} from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { OfficerArt } from './OfficerArt.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

const TITLE: Record<BattleResult, 'result.win' | 'result.draw' | 'result.lose'> = {
  win: 'result.win', draw: 'result.draw', lose: 'result.lose',
};

const PICK_LABEL: Record<DrawReward, 'result.pick.card' | 'result.pick.material' | 'result.pick.grain'> = {
  card: 'result.pick.card', material: 'result.pick.material', grain: 'result.pick.grain',
};

export function ResultScreen({
  profile, mode, result, outcome, rewards, pending, power, seed, voided, onChange, onAgain, onHome,
}: {
  profile: PlayerProfile;
  /** 이 판의 규모 — 환불액(참가비)이 여기서 나온다 */
  mode: BattleMode;
  result: BattleResult;
  outcome: string;
  /** 이미 반영된 보상. 무승부는 고르기 전이라 `null`이다 */
  rewards: BattleRewards | null;
  pending: BattleOutcome | null;
  power: { mine: number; theirs: number };
  seed: number;
  /**
   * **성립하지 않은 판**이다 (GDD §3.9) — 결말도 보상도 전적도 없고 정산만 있다.
   *
   * 화면을 따로 만들지 않고 이 화면을 재사용한다: 나가는 길([다시 편성]·[도시로])이
   * 이미 여기 있고, 「무슨 일이 있었는지」를 팝업 하나에만 남기면 되짚을 수 없다.
   */
  voided?: { reason: 'left' | 'idle'; refunded: boolean } | null;
  onChange: (profile: PlayerProfile) => void;
  onAgain: () => void;
  onHome: () => void;
}): React.JSX.Element {
  useLang();
  const [given, setGiven] = useState<BattleRewards | null>(rewards);

  const card = given?.card ? officerById.get(given.card) : undefined;
  const waiting = given === null && pending !== null;

  const pick = (choice: DrawReward): void => {
    const applied = applyBattleResult(profile, { ...pending!, drawPick: choice }, seed);
    setGiven(applied.rewards);
    onChange(applied.profile);
  };

  // 예상 승률은 **엔진이 낸다** — 화면이 로지스틱을 다시 적지 않는다 (D · GDD §7.1)
  const chance = winChance(power.mine, power.theirs);

  /*
   * **성립하지 않은 판은 결말이 아니다** — 승/무/패 제목도, 보상 칸도, 예상 승률도
   * 뜨지 않는다. 뜨면 「무승부를 당했다」로 읽히고, 그건 §5-68이 일부러 안 준 것이다.
   */
  if (voided) {
    return (
      <div className="scr scr-result draw" data-screen="result" data-result="void"
        data-void={voided.reason}>
        <h1 className="title">{t('result.void')}</h1>
        <p className="lede" data-field="voidWhy">{t(`result.void.${voided.reason}`)}</p>
        <section className="rewards" data-field="voidSettle">
          <p className="hint" data-field="refund">
            {voided.refunded
              ? t('result.void.refunded', { n: grainCost(mode) })
              : t('result.void.kept')}
          </p>
        </section>
        <footer className="foot">
          <button className="btn wide" data-action="again" onClick={onAgain}>{t('result.again')}</button>
          <button className="btn primary wide" data-action="home" onClick={onHome}>{t('result.home')}</button>
        </footer>
      </div>
    );
  }

  return (
    <div className={`scr scr-result ${result}`} data-screen="result" data-result={result}>
      <h1 className="title">{t(TITLE[result])}</h1>
      <p className="lede">{outcome}</p>

      {waiting ? (
        /* 무승부 택1 — 양쪽 다 고른다 (§5-10). 고르기 전까지 계정은 그대로다 */
        <section className="rewards" data-field="drawPick">
          <h2 className="cap">{t('result.drawPick')}</h2>
          {DRAW_REWARDS.map((choice) => (
            <button
              key={choice}
              className="btn wide"
              data-pick={choice}
              onClick={() => pick(choice)}
            >
              {t(PICK_LABEL[choice], { n: GRAIN_REWARD[pending!.mode], m: MATERIAL_REWARD })}
            </button>
          ))}
          <p className="hint">{t('result.pickNote')}</p>
        </section>
      ) : (
        <section className="rewards" data-field="rewards">
          <h2 className="cap">{t('result.rewards')}</h2>
          <div className="row">
            <span className="k">{t('result.grain')}</span>
            <span className="v" data-field="grain">{given && given.grain > 0 ? `+${given.grain}` : t('result.none')}</span>
          </div>
          <div className="row">
            <span className="k">{t('result.materials')}</span>
            <span className="v" data-field="materials">{given && given.materials > 0 ? `+${given.materials}` : t('result.none')}</span>
          </div>
          {card ? (
            <div className="row card">
              <OfficerArt officer={card.id} className="thumb" />
              <span className="k">{card.name}</span>
              <span className="v">{t('result.cardGrade', { g: given!.cardGrade ?? '' })}</span>
            </div>
          ) : (
            <div className="row">
              <span className="k">{t('result.card')}</span>
              <span className="v" data-field="card">{t('result.none')}</span>
            </div>
          )}
        </section>
      )}

      {/* 「예상 승률 12%를 뒤집은 승리」 — 보상이 아니라 기록이다 (§5-23) */}
      <p className="hint rst-chance" data-field="chance" data-chance={chance.toFixed(4)}>
        {t('result.expected', { p: Math.round(chance * 100), mine: power.mine, theirs: power.theirs })}
      </p>

      <footer className="foot">
        <button className="btn wide" data-action="again" onClick={onAgain}>{t('result.again')}</button>
        <button className="btn primary wide" data-action="home" onClick={onHome}>{t('result.home')}</button>
      </footer>
    </div>
  );
}
