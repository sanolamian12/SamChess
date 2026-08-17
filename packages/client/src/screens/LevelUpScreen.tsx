/**
 * 레벨/스킬 관리 — 한 장수의 레벨업 (GDD §4.2 · §4.3)
 *
 * 레벨업은 **능력 향상 택1 + 책략 택1**이다. 같은 장수라도 여기서 빌드가 갈린다.
 * **실패는 없다** — 2026-08-04에 확정했다(GDD §4.3). 카드만 채우면 반드시 오른다.
 *
 * ────────────────────────────────────────────────────────────────
 * 이 화면은 **B(pptx 39쪽)가 통째로 갈아 끼운다**
 * ────────────────────────────────────────────────────────────────
 *
 * 39쪽은 증분 미리보기(`HP 10 → +5 15`)·스탯 찍은 횟수·재설계(둔갑천서) 마법사를
 * 요구하고, 그러려면 저장 형식이 레벨별로 묶여야 한다(작업계획 B). A는 **여기까지
 * 오는 길만** 새로 놓고 화면 자체는 지금 것을 그대로 옮겼다 — 잠가 두면 지금 유일한
 * 성장 통로가 끊겨 오프라인 사이클이 A와 B 사이에서 멈춘다.
 *
 * > **「개발용 카드 지급」은 게임 규칙이 아니다.** AI 대전이 카드를 주지 않기로 확정되어
 * > 오프라인만으로는 성장을 시험할 수 없다. 온라인·상점이 붙으면 지운다.
 */

import { useState } from 'react';
import { GROWTH, officerById, tacticById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  addCard, applyLevelUp, atRange, canLevelUp, cardsToLevelUp, statsOf, tacticChoices,
} from '@samchess/meta';
import type { PlayerProfile, StatPick } from '@samchess/meta';
import { backdropStyle, placeBackdrop } from './backdrop.ts';
import { OfficerArt } from './OfficerArt.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

/**
 * 선택지 이름은 **데이터에서 만든다** — `AT`는 `+0.5`다(2026-08-12 확정, GDD §4.2).
 * 예전에는 `'AT +1'`이라고 손으로 적어 두어 화면만 낡은 값을 말하고 있었다.
 * 단일 출처는 `tools/extract_data.py`의 `statChoices`이고 여기는 그걸 읽는다.
 */
const statStep = (pick: StatPick): number =>
  (GROWTH.statChoices.find((c) => pick in c) as Record<string, number> | undefined)?.[pick] ?? 0;

const statLabel = (pick: StatPick): string => `${pick.toUpperCase()} +${statStep(pick)}`;

export function LevelUpScreen({ profile, officer, onChange, onBack }: {
  profile: PlayerProfile;
  officer: OfficerId;
  onChange: (p: PlayerProfile) => void;
  onBack: () => void;
}): React.JSX.Element {
  useLang();
  const [stat, setStat] = useState<StatPick>('hp');
  const [school, setSchool] = useState<'support' | 'illusion'>('support');

  const inst = profile.roster[officer];
  const data = officerById.get(officer);
  if (!inst || !data) return <div className="scr scr-levelup"><p className="hint" onClick={onBack}>{t('officer.toList')}</p></div>;

  const stats = statsOf(inst);
  const at = atRange(inst);
  const cards = profile.cards[officer] ?? 0;
  const need = cardsToLevelUp(inst.level);
  const check = canLevelUp(profile, officer);
  const choices = tacticChoices(inst.level + 1);

  return (
    <div
      className="scr scr-levelup scr-dim"
      data-screen="levelup"
      data-officer={officer}
      style={backdropStyle(placeBackdrop('palace', profile.cityLevel))}
    >
      <header className="bar">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('officer.toList')}</button>
        <span className="ttl">{t('levelup.title')}</span>
      </header>

      <section className="block ofc-detail">
        <div className="ofc-bio">
          <OfficerArt officer={data.id} className="ofc-art" />
          <div className="ofc-who">
            <h2 className="nm">
              <span className="gr" data-grade={data.grade}>[{data.grade}]</span>
              {' '}{data.name}{' '}
              <span className="lv">Lv{inst.level}</span>
            </h2>
            <p className="ofc-stats">HP: {stats.hp},  MP: {stats.mp},  AT: {at.min}-{at.max}</p>
            <p className="row dim">
              {t('officer.cards')} {need === null ? t('officer.cards.max') : t('officer.cards.have', { have: cards, need })}
            </p>
          </div>
        </div>

        <div className="ofc-tactics">
          <span className="k">{t('officer.tactics')}{inst.tactics.length > 0 ? ` ${inst.tactics.length}종` : ''}</span>
          {inst.tactics.length === 0 && <span className="dim">{t('officer.tactics.none')}</span>}
          {inst.tactics.map((id) => {
            const x = tacticById.get(id);
            return x ? <span key={id} className={`chip ${x.school}`} title={x.text}>{x.name}</span> : null;
          })}
        </div>
      </section>

      {need !== null && (
        <section className="block levelup">
          <div className="pick">
            <span className="k">능력</span>
            {(['hp', 'mp', 'at'] as StatPick[]).map((s) => (
              <button key={s} className={`opt${stat === s ? ' on' : ''}`} data-stat={s} onClick={() => setStat(s)}>
                {statLabel(s)}
              </button>
            ))}
          </div>
          <div className="pick">
            <span className="k">책략</span>
            {(['support', 'illusion'] as const).map((s) => (
              <button
                key={s}
                className={`opt${school === s ? ' on' : ''}`}
                data-school={s}
                disabled={choices[s].length === 0}
                onClick={() => setSchool(s)}
              >
                {t(s === 'support' ? 'officer.support' : 'officer.illusion')}
                {' — '}
                {choices[s].map((id) => tacticById.get(id)?.name).filter(Boolean).join(' + ') || '없음'}
              </button>
            ))}
          </div>
          <button
            className="btn primary wide"
            disabled={!check.ok}
            data-action="levelUp"
            onClick={() => onChange(applyLevelUp(profile, officer, stat, school))}
          >
            Lv{inst.level} → Lv{inst.level + 1}
          </button>
          {!check.ok && <p className="note">{check.reason}</p>}
        </section>
      )}

      {/* 게임 규칙이 아니다 — AI 대전이 카드를 주지 않아 성장 흐름을 시험할 길이 없어서 둔 문 */}
      <div className="devtools">
        <span className="cap">개발용</span>
        <button className="btn ghost sm" onClick={() => onChange(addCard(profile, officer, 5))}>
          카드 +5
        </button>
        <span className="dim">시험용 통로다. 온라인·상점이 붙으면 없앤다.</span>
      </div>
    </div>
  );
}
