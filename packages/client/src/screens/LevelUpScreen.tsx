/**
 * 레벨/스킬 관리 · 재설계 (pptx 39쪽 · GDD §4.2 · §4.3)
 *
 * ```
 * [관리]                          [고르기]
 * [S] 가후 Lv1                     [S] 가후 Lv2
 * 보유 카드 / 다음 레벨까지         HP: 10,  +5  → 15      ← 물리 성장
 * HP: 10, MP: 5, AT: 2-4           MP: 5,   +0  → 5
 * ×0  ×0  ×0  (스탯 찍은 횟수)      AT: 2-4, +0  → 2-4
 * 보유 지원책 / 보유 환술            Lv2 책략(택1)  [증폭] [공포]   ← 책략 성장
 * [레벨 업 (3장 소모)]              책략 설명
 * [재설계 (둔갑천서 10냥)]          [확정]  [뒤로]
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 「고르기」는 레벨업과 재설계가 **같은 컴포넌트**다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 39쪽의 「초기화했을 때 레벨 업그레이드 하는 UI 제공 필요」가 재설계 마법사다 —
 * Lv2부터 순서대로 다시 고르는 것이라 **화면이 레벨업과 완전히 같다.** 두 벌로
 * 그리면 「레벨업에서는 +0.5인데 재설계에서는 +1」 같은 어긋남이 조용히 생긴다.
 *
 * ────────────────────────────────────────────────────────────────
 * 숫자는 화면이 만들지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * 증분 미리보기(`+5 → 15`)는 `growthPreview()`가, 공격력 범위는 그 안의
 * `FORMULA.damage`가 낸다. 「화면이 미리 보여 주는 숫자는 엔진이 낸다」 —
 * 공격 확인창이 `forecastAttack()`, 책략이 `illusionChance()`에 묻는 것과 같은
 * 자리다. 실제로 `AT +1`이 화면 글자에만 남아 있던 적이 있다(2026-08-12에 0.5로
 * 내렸는데 데이터·엔진만 따라가고 화면은 낡아 있었다).
 *
 * ────────────────────────────────────────────────────────────────
 * 재설계는 [확정] 전까지 프로필을 건드리지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * 고른 것은 **여기 화면 상태(`draft`)에만** 쌓이고, 다 채워야 `applyRespec()`이
 * 한 번에 갈아 끼운다. 그래서 중간에 나가면 원래대로이고, 무엇보다 저장된
 * 프로필이 `growth.length === level - 1`을 **한순간도** 어기지 않는다
 * (`meta/src/types.ts` 참조).
 *
 * > **「개발용」은 게임 규칙이 아니다.** AI 대전이 카드를 주지 않고 상점도 아직
 * > 없어서, 오프라인에서는 성장도 재설계도 시험할 길이 없다. 온라인·상점이 붙으면 지운다.
 */

import { useState } from 'react';
import { officerById, tacticById } from '@samchess/data';
import type { OfficerId, TacticId } from '@samchess/rules';
import {
  RESPEC_GOLD, addCard, applyLevelUp, applyRespec, atRange, canLevelUp, canRespec,
  cardsToLevelUp, growthPreview, statPicksOf, statsOf, tacticChoices, tacticsOf,
} from '@samchess/meta';
import type { GrowthStep, OfficerInstance, PlayerProfile, StatPick, StatPreview } from '@samchess/meta';
import { backdropStyle, placeBackdrop } from './backdrop.ts';
import { OfficerArt } from './OfficerArt.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

type School = 'support' | 'illusion';
type Step = 'manage' | 'levelup' | 'respec';

/** `2.5` → `2.5`, `2` → `2`. 소수점 뒤 0을 남기면 「+2.0」처럼 어수선하다 */
const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * 「지금까지 고른 것만 반영한 인스턴스」. 재설계 마법사가 한 걸음 나아갈 때마다
 * 이걸로 미리보기를 다시 낸다 — `growthPreview()`가 완성된 스택을 요구하지 않도록
 * **레벨도 함께** 맞춘다(불변식은 화면 안에서도 지킨다).
 */
const draftOf = (inst: OfficerInstance, growth: GrowthStep[]): OfficerInstance =>
  ({ ...inst, level: growth.length + 1, growth });

export function LevelUpScreen({ profile, officer, onChange, onBack }: {
  profile: PlayerProfile;
  officer: OfficerId;
  onChange: (p: PlayerProfile) => void;
  onBack: () => void;
}): React.JSX.Element {
  useLang();
  const [step, setStep] = useState<Step>('manage');
  /** 재설계로 지금까지 고른 것. **[확정] 전까지 프로필에 안 들어간다** */
  const [draft, setDraft] = useState<GrowthStep[]>([]);

  const inst = profile.roster[officer];
  const data = officerById.get(officer);
  if (!inst || !data) {
    return <div className="scr scr-levelup"><p className="hint" onClick={onBack}>{t('officer.toList')}</p></div>;
  }

  const need = cardsToLevelUp(inst.level);
  const respecOk = canRespec(profile, officer);

  /** 지금 고르는 중인 바탕 — 레벨업이면 본인, 재설계면 여기까지 다시 고른 것 */
  const base = step === 'respec' ? draftOf(inst, draft) : inst;
  const total = inst.level - 1;

  const leave = (): void => { setDraft([]); setStep('manage'); };

  /** 한 걸음 확정. 레벨업은 곧바로, 재설계는 마지막 걸음에서만 프로필에 닿는다 */
  const commit = (stat: StatPick, school: School): void => {
    if (step === 'levelup') {
      onChange(applyLevelUp(profile, officer, stat, school));
      setStep('manage');
      return;
    }
    const next = [...draft, { stat, tactics: tacticChoices(draft.length + 2)[school] }];
    if (next.length < total) { setDraft(next); return; }
    onChange(applyRespec(profile, officer, next));   // ← 여기서 처음 프로필이 바뀐다
    leave();
  };

  return (
    <div
      className="scr scr-levelup scr-dim"
      data-screen="levelup"
      data-officer={officer}
      data-step={step}
      data-growth={inst.growth.length}
      style={backdropStyle(placeBackdrop('palace', profile.cityLevel))}
    >
      {/* 39쪽 목업의 상단 두 갈래. [전적 보기]는 C1(40쪽)이 열 때까지 잠겨 있다 */}
      <header className="ofc-nav">
        <button className="btn ghost sm" data-action="back" onClick={step === 'manage' ? onBack : leave}>
          {step === 'manage' ? t('officer.toList') : t('respec.cancel')}
        </button>
        <button className="btn sm" data-action="records" disabled title={t('place.soon')}>{t('officer.records')}</button>
      </header>

      <section className="block ofc-detail">
        <div className="ofc-bio">
          <OfficerArt officer={data.id} className="ofc-art" />
          <div className="ofc-who">
            <h2 className="nm">
              <span className="gr" data-grade={data.grade}>[{data.grade}]</span>
              {' '}{data.name}{' '}
              {/* 고르는 중에는 **올라갈 레벨**을 보여준다 — 39쪽 목업이 Lv2로 적혀 있다 */}
              <span className="lv" data-level={base.level + (step === 'manage' ? 0 : 1)}>
                Lv{base.level + (step === 'manage' ? 0 : 1)}
              </span>
            </h2>
            {step === 'manage' && <ManageHead profile={profile} inst={inst} need={need} />}
            {/* 걸음 표시는 **재설계에만** 있다 — 레벨업은 한 걸음이라 「1/1」이 뜻이 없다 */}
            {step === 'respec' && (
              <p className="row dim" data-field="respecStep">
                {t('respec.step', { level: base.level + 1, done: draft.length + 1, total })}
              </p>
            )}
          </div>
        </div>

        {step === 'manage'
          ? <Manage inst={inst} />
          /* `key`가 걸음마다 갈려야 한 걸음 나아갈 때 고른 것이 초기화된다 —
             안 걸면 Lv2에서 고른 「환술」이 Lv3에도 눌린 채로 남는다 */
          : <Picker
              key={`${step}-${base.level}`}
              base={base}
              onCommit={commit}
              onBack={step === 'respec' && draft.length > 0 ? () => setDraft(draft.slice(0, -1)) : leave}
              last={step === 'respec' && draft.length + 1 === total}
            />}
      </section>

      {step === 'manage' && (
        <section className="block lv-acts">
          <button
            className="btn primary wide"
            data-action="levelUp"
            disabled={!canLevelUp(profile, officer).ok}
            onClick={() => setStep('levelup')}
          >
            {need === null ? t('levelup.max') : t('levelup.go', { need })}
          </button>
          <button
            className="btn wide"
            data-action="respec"
            disabled={!respecOk.ok}
            title={respecOk.ok ? undefined : respecOk.reason}
            onClick={() => { setDraft([]); setStep('respec'); }}
          >
            {t('respec.open', { gold: RESPEC_GOLD })}
          </button>
          {/* 「단추는 눌리지 않게 두고 **왜인지 적는다**」 — 이유를 감추면 「고장인가」가 남는다 */}
          {!respecOk.ok && <p className="note">{respecOk.reason}</p>}
        </section>
      )}

      {/* 게임 규칙이 아니다 — AI 대전이 카드를 주지 않고 상점도 없어 시험할 길이 없다 */}
      {step === 'manage' && (
        <div className="devtools">
          <span className="cap">개발용</span>
          <button className="btn ghost sm" data-dev="cards" onClick={() => onChange(addCard(profile, officer, 5))}>
            카드 +5
          </button>
          <button
            className="btn ghost sm"
            data-dev="gold"
            onClick={() => onChange({ ...profile, gold: profile.gold + RESPEC_GOLD })}
          >
            금화 +{RESPEC_GOLD}
          </button>
          <span className="dim">시험용 통로다. 온라인·상점이 붙으면 없앤다.</span>
        </div>
      )}
    </div>
  );
}

/** 「보유 카드 / 다음 레벨까지」 — 39쪽의 머리 한 줄 */
function ManageHead({ profile, inst, need }: {
  profile: PlayerProfile; inst: OfficerInstance; need: number | null;
}): React.JSX.Element {
  const have = profile.cards[inst.officer] ?? 0;
  return (
    <p className="row dim" data-field="cards">
      <span className="k">{t('levelup.cards')}</span>
      {' : '}
      {need === null ? t('officer.cards.max') : t('officer.cards.have', { have, need })}
    </p>
  );
}

/** 관리 화면의 몸통 — 능력치 · 스탯 찍은 횟수 · 보유 책략 두 줄 */
function Manage({ inst }: { inst: OfficerInstance }): React.JSX.Element {
  const stats = statsOf(inst);
  const at = atRange(inst);
  const picks = statPicksOf(inst);
  const taps: Record<StatPick, number> = {
    hp: picks.filter((p) => p === 'hp').length,
    mp: picks.filter((p) => p === 'mp').length,
    at: picks.filter((p) => p === 'at').length,
  };
  const owned = tacticsOf(inst).map((id) => tacticById.get(id)).filter((x) => !!x);

  return (
    <>
      <p className="ofc-stats" data-field="stats">
        HP: {stats.hp},  MP: {stats.mp},  AT: {at.min}-{at.max}
      </p>

      {/* 「값, 스탯 찍은 횟수」(39쪽). **어디에 몇 번 썼는지**가 재설계의 판단 근거다 */}
      <div className="lv-taps" data-taps={`${taps.hp}/${taps.mp}/${taps.at}`}>
        <span className="k">{t('levelup.taps')}</span>
        {(['hp', 'mp', 'at'] as StatPick[]).map((key) => (
          <span key={key} className="lv-tap" data-tap={key}>
            {key.toUpperCase()} <b>×{taps[key]}</b>
          </span>
        ))}
      </div>

      {/* 「보유 지원책 / 보유 환술」 — 두 줄로 갈라 적는다(39쪽) */}
      {(['support', 'illusion'] as School[]).map((school) => (
        <div key={school} className="ofc-tactics lv-owned" data-owned={school}>
          <span className="k">{t(school === 'support' ? 'levelup.support' : 'levelup.illusion')}</span>
          {owned.filter((x) => x.school === school).length === 0
            ? <span className="dim">{t('levelup.none')}</span>
            : owned.filter((x) => x.school === school).map((x) => (
              <span key={x.id} className={`chip ${school}`} title={x.text}>{x.name}</span>
            ))}
        </div>
      ))}
    </>
  );
}

/**
 * 「고르기」 — 레벨업과 재설계가 함께 쓴다.
 *
 * `base`는 **이 걸음 직전까지의 인스턴스**다. 레벨업이면 본인이고, 재설계면
 * 지금까지 다시 고른 것만 반영된 임시 인스턴스다. 어느 쪽이든 여기서는 구별하지
 * 않는다 — 그게 「재설계 결과가 정상 성장과 구별되지 않는다」의 화면 쪽 얼굴이다.
 */
function Picker({ base, onCommit, onBack, last }: {
  base: OfficerInstance;
  onCommit: (stat: StatPick, school: School) => void;
  onBack: () => void;
  last: boolean;
}): React.JSX.Element {
  const [stat, setStat] = useState<StatPick>('hp');
  const [school, setSchool] = useState<School>('support');

  const level = base.level + 1;
  const rows = growthPreview(base, stat);
  const choices = tacticChoices(level);
  // 그 레벨에 지원이 없으면(지금 데이터에는 없지만) 고를 수 있는 쪽으로 물러난다
  const pickedSchool: School = choices[school].length > 0 ? school : (school === 'support' ? 'illusion' : 'support');
  const picked = choices[pickedSchool].map((id: TacticId) => tacticById.get(id)).filter((x) => !!x);

  return (
    <>
      <div className="lv-pick" data-picker={level}>
        <span className="k">{t('levelup.physical')}</span>
        <div className="lv-stats">
          {rows.map((row) => (
            <button
              key={row.key}
              className={`opt lv-stat${stat === row.key ? ' on' : ''}`}
              data-stat={row.key}
              data-add={fmt(row.add)}
              onClick={() => setStat(row.key)}
            >
              <span className="c-k">{row.key.toUpperCase()}</span>
              <span className="c-now">{show(row, 'now')}</span>
              <span className="c-add">+{fmt(row.add)}</span>
              <span className="c-arrow">→</span>
              <span className="c-next">{show(row, 'next')}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="lv-pick">
        <span className="k">{t('levelup.tactic', { level })}</span>
        <div className="lv-tactics">
          {(['support', 'illusion'] as School[]).map((s) => (
            <button
              key={s}
              className={`opt${pickedSchool === s ? ' on' : ''}`}
              data-school={s}
              disabled={choices[s].length === 0}
              onClick={() => setSchool(s)}
            >
              {/* Lv6·7의 지원은 「화계 + 진화」처럼 **한 쌍이 한 선택지**다 */}
              {choices[s].map((id: TacticId) => tacticById.get(id)?.name).filter(Boolean).join(' + ') || t('levelup.none')}
            </button>
          ))}
        </div>
      </div>

      {/*
        「책략 설명」(39쪽). **팝업이 아니라 그 자리에 편다** — 둘 중 하나를 고르는
        중이라 설명이 계속 보여야 하고, 배경 화면 위의 팝업은 자리를 따로 붙들어야
        해서 값에 비해 위험하다(`.scr-dim > *`가 `absolute`를 덮는다).
      */}
      <div className="lv-desc" data-field="tacticDesc">
        <span className="k">{t('levelup.tacticDesc')}</span>
        {picked.map((x) => (
          <p key={x.id} className="row">
            <b className={`chip ${x.school}`}>{x.name}</b> {x.text}
          </p>
        ))}
      </div>

      <div className="lv-acts">
        <button className="btn primary wide" data-action="confirm" onClick={() => onCommit(stat, pickedSchool)}>
          {last ? t('respec.done', { gold: RESPEC_GOLD }) : t('levelup.confirm')}
        </button>
        <button className="btn ghost wide" data-action="stepBack" onClick={onBack}>{t('levelup.back')}</button>
      </div>
    </>
  );
}

/** 한 칸의 표시. **`AT`만 범위다** — 데미지가 매 타격 내림이라 `2.5`는 평타 2 · 크리티컬 5 */
function show(row: StatPreview, when: 'now' | 'next'): string {
  if (!row.range) return fmt(row[when]);
  const r = row.range[when];
  return `${r.min}-${r.max}`;
}
