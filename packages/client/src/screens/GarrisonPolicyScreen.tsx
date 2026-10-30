/**
 * 수비군 설정 (2026-10-30, GDD §8.8 「단계 6에서 정한 것」 · pptx 119~123쪽) — 부대 현황의 [수비군 설정]
 *
 * ```
 * [← 부대 현황]        수비군 설정
 * ┌ 초전박살 (3vs3) ─────────────────────────┐
 * │ [ 행동 ]  [ 책략 ]  [ 고유기술 ]             │
 * │ 방침은 공격하는 쪽에 보이지 않는다.           │
 * └─────────────────────────────────────────┘
 * ┌ 탭의 판 ────────────────────────────────┐
 * │ 행동: 기물 · 장수 · [수성 ▾] (설명 한 줄)     │
 * │ 책략: 순위 · 장수 · 사용 조건 · 책략 · 대상 · 확률 (한 쪽 다섯, 최대 20줄)
 * │       [위로] [아래로] [삭제]  [방침 추가]  [방침 초기화]
 * │ 고유기술: 순위 · 고유기술(장수) · 사용 조건                │
 * └─────────────────────────────────────────┘
 * [ 저장 ]
 * ```
 *
 * **규칙은 meta · rules가 낸다** — 고를 수 있는 행동(`stancesFor`), 기본 방침(`effectivePolicy`), 쓸 수 없는 줄
 * (`tacticRuleUsable` · `skillRuleUsable`), 다듬기 · 저장(`setSquadPolicy`). 화면은 고친 것을 들고 있다가 [저장]에 넘긴다.
 * 손대지 않은 칸은 넘기지 않는다 — 그래야 기본이 그때그때 따라온다(레벨업으로 배운 책략이 저절로 든다).
 */

import { useMemo, useState } from 'react';
import { combatantById, officerById, skillById, tacticById } from '@samchess/data';
import {
  GARRISON_MODES, acknowledgePolicyTactics, defaultPolicy, effectivePolicy, garrisonOf, newPolicyTactics, officerPolicyTactics, setSquadPolicy, skillRuleUsable, skillsTabOpen, squadPolicyTactics,
  tacticRuleUsable, tacticsTabOpen,
} from '@samchess/meta';
import type { PlayerProfile, Squad, SquadPolicyDraft } from '@samchess/meta';
import { CHANCE_STEPS, MAX_TACTIC_RULES, SKILL_CONDITIONS, TACTIC_CONDITIONS, stancesFor } from '@samchess/rules';
import type {
  DefenseStance, OfficerId, PieceType, SkillCondition, SkillRule, TacticCondition, TacticId, TacticRule,
} from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { Pager } from './PagerButton.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { OfficerArt } from './OfficerArt.tsx';
import { modeText } from './SquadViewScreen.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById, pickSkillName, pickTacticNameById } from '../i18n/story.ts';

type Tab = 'stance' | 'tactic' | 'skill';
const TABS: readonly Tab[] = ['stance', 'tactic', 'skill'];
/** 책략 방침 한 쪽의 줄 수 (pptx 120쪽 — 판 하나에 다섯) */
export const POLICY_PAGE = 5;

const officerName = (id: OfficerId): string => pickOfficerNameById(id, officerById.get(id)?.name ?? id);
const tacticName = (id: TacticId): string => pickTacticNameById(id, tacticById.get(id)?.name ?? id);
const skillOf = (officer: OfficerId) => skillById.get(combatantById.get(officer)?.uniqueSkill ?? '');
const isIllusion = (id: TacticId): boolean => tacticById.get(id)?.school === 'illusion';

/** 고르는 판 하나 — 행동 · 조건 · 확률 · 추가 걸음이 같은 틀을 쓴다 */
type Picker =
  | { kind: 'stance'; piece: PieceType; officer: OfficerId }
  | { kind: 'tacticWhen'; index: number }
  | { kind: 'chance'; index: number }
  | { kind: 'skillWhen'; index: number }
  | { kind: 'addTactic'; step: 'caster' | 'tactic' | 'when' | 'chance'; caster?: OfficerId | null; tactic?: TacticId; when?: TacticCondition }
  | { kind: 'addSkill'; step: 'officer' | 'when'; officer?: OfficerId }
  | { kind: 'leave' };

export function GarrisonPolicyScreen({ profile, squad, onBack, onChange }: {
  profile: PlayerProfile;
  squad: Squad;
  onBack: () => void;
  /** 저장한 계정 — 저장은 계정 큐가 보낸다(부대는 클라이언트 소유) */
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  const base = useMemo(() => effectivePolicy(profile, squad), [profile, squad]);
  const [tab, setTab] = useState<Tab>('stance');
  const [stances, setStances] = useState(base.stances);
  const [tactics, setTactics] = useState<TacticRule[]>(base.tactics);
  const [skills, setSkills] = useState<SkillRule[]>(base.skills);
  /** 칸마다 무엇을 넘길지 — 손대지 않음 · 고침 · 초기화(기본으로) */
  const [dirty, setDirty] = useState<Record<Tab, 'clean' | 'edit' | 'reset'>>({ stance: 'clean', tactic: 'clean', skill: 'clean' });
  const [sel, setSel] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [saved, setSaved] = useState(false);

  const tacticOpen = tacticsTabOpen(profile, squad);
  const skillOpen = skillsTabOpen(squad);
  const open: Record<Tab, boolean> = { stance: true, tactic: tacticOpen, skill: skillOpen };
  const anyDirty = TABS.some((k) => dirty[k] !== 'clean');
  const touch = (k: Tab, how: 'edit' | 'reset' = 'edit'): void => { setDirty((d) => ({ ...d, [k]: how })); setSaved(false); };

  const goTab = (k: Tab): void => { setTab(k); setSel(null); setPage(0); };

  const save = (): void => {
    const draft: SquadPolicyDraft = {};
    if (dirty.stance !== 'clean') draft.stances = dirty.stance === 'reset' ? null : stances;
    if (dirty.tactic !== 'clean') draft.tactics = dirty.tactic === 'reset' ? null : tactics;
    if (dirty.skill !== 'clean') draft.skills = dirty.skill === 'reset' ? null : skills;
    onChange(setSquadPolicy(profile, squad.id, draft));
    setDirty({ stance: 'clean', tactic: 'clean', skill: 'clean' });
    setSaved(true);
  };

  // ── 줄 옮기기 · 지우기 (책략 · 고유기술 공통) ─────────────────
  const list: (TacticRule | SkillRule)[] = tab === 'tactic' ? tactics : tab === 'skill' ? skills : [];
  const setList = (next: (TacticRule | SkillRule)[]): void => {
    if (tab === 'tactic') setTactics(next as TacticRule[]);
    else setSkills(next as SkillRule[]);
    touch(tab);
  };
  const moveSel = (delta: -1 | 1): void => {
    if (sel === null) return;
    const to = sel + delta;
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    [next[sel], next[to]] = [next[to]!, next[sel]!];
    setList(next);
    setSel(to);
    setPage(Math.floor(to / POLICY_PAGE));
  };
  const removeSel = (): void => {
    if (sel === null) return;
    setList(list.filter((_, i) => i !== sel));
    setSel(null);
  };
  const reset = (): void => {
    const fresh = defaultPolicy(profile, squad);
    if (tab === 'tactic') setTactics(fresh.tactics); else setSkills(fresh.skills);
    touch(tab, 'reset');
    setSel(null);
    setPage(0);
  };

  const pageCount = Math.max(1, Math.ceil(list.length / POLICY_PAGE));
  const current = Math.min(page, pageCount - 1);
  const custom = (k: 'tactic' | 'skill'): boolean =>
    dirty[k] === 'edit' || (dirty[k] === 'clean' && !!(k === 'tactic' ? squad.policy?.tactics : squad.policy?.skills));

  const tryLeave = (): void => { if (anyDirty) setPicker({ kind: 'leave' }); else onBack(); };

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squad-edit scr-garrison-policy"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="garrisonPolicy" data-squad={squad.id} data-tab={tab} data-dirty={anyDirty ? '1' : '0'}>
        <button className="btn ghost sm" data-action="back" onClick={tryLeave}>
          {stripBackArrow(t('gp.back'))}
        </button>
        <span className="place-nm">{t('gp.title')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel gpl-head">
          <h2 className="cap" data-field="head">{t('gp.head', { name: squad.name, mode: modeText(squad.mode) })}</h2>
          <div className="srt-moderow gpl-tabs">
            {TABS.map((k) => (
              <button key={k} className="btn wide" data-tab={k} data-on={tab === k ? '1' : '0'} aria-pressed={tab === k}
                disabled={!open[k]} onClick={() => goTab(k)}>
                <span className="lbl">{t(`gp.tab.${k}`)}</span>
              </button>
            ))}
          </div>
          {!tacticOpen && <p className="hint" data-field="tacticOff">{t('gp.tab.tactic.off')}</p>}
          {!skillOpen && <p className="hint" data-field="skillOff">{t('gp.tab.skill.off')}</p>}
          <p className="hint" data-field="hidden">{t('gp.hidden')}</p>
        </section>

        <section className="place-panel gpl-body" data-tab={tab}>
          {tab === 'stance' && (
            <div className="gpl-rows">
              {squad.picks.map((p) => {
                const st = stances[p.piece] ?? 'advance';
                return (
                  <div key={p.piece} className="gpl-srow" data-piece={p.piece} data-stance={st}>
                    <span className="pc">{p.piece}</span>
                    <span className="who"><OfficerArt officer={p.officer} className="thumb" /><span className="nm">{officerName(p.officer)}</span></span>
                    <div className="gpl-stance">
                      <button className="btn sm" data-action="stance" onClick={() => setPicker({ kind: 'stance', piece: p.piece, officer: p.officer })}>
                        <span className="lbl">{t(`gp.stance.${st}`)} ▾</span>
                      </button>
                      <p className="gpl-desc">{t(`gp.stance.${st}.d`)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab !== 'stance' && (
            <>
              <p className="hint gpl-mode" data-field="policyMode" data-custom={custom(tab) ? '1' : '0'}>
                {custom(tab) ? t('gp.isCustom') : t(tab === 'tactic' ? 'gp.isDefault.tactic' : 'gp.isDefault.skill')}
              </p>
              <div className={`gpl-row gpl-thead gpl-${tab}`} aria-hidden="true">
                <span className="rk">{t('gp.col.rank')}</span>
                {tab === 'tactic' ? (
                  <>
                    <span className="gpl-main">{t('gp.col.tactic')} · {t('gp.col.target')} / {t('gp.col.caster')} · {t('gp.col.when')}</span>
                    <span className="ch">{t('gp.col.chance')}</span>
                  </>
                ) : (
                  <span className="gpl-main">{t('gp.col.skill')} / {t('gp.col.when')}</span>
                )}
              </div>
              <div className="gpl-rows" data-field="rules" data-count={list.length}>
                {list.length === 0 && <p className="hint gpl-none" data-field="empty">{t('gp.empty')}</p>}
                {list.slice(current * POLICY_PAGE, (current + 1) * POLICY_PAGE).map((rule, k) => {
                  const i = current * POLICY_PAGE + k;
                  return tab === 'tactic'
                    ? <TacticRow key={i} rank={i} rule={rule as TacticRule} usable={tacticRuleUsable(profile, squad, rule as TacticRule)}
                        selected={sel === i} onSelect={() => setSel(i)}
                        onWhen={() => setPicker({ kind: 'tacticWhen', index: i })}
                        onChance={() => setPicker({ kind: 'chance', index: i })} />
                    : <SkillRow key={i} rank={i} rule={rule as SkillRule} usable={skillRuleUsable(squad, rule as SkillRule)}
                        selected={sel === i} onSelect={() => setSel(i)}
                        onWhen={() => setPicker({ kind: 'skillWhen', index: i })} />;
                })}
              </div>
              <Pager page={current} pageCount={pageCount} onPage={(n) => { setPage(n); setSel(null); }} field="policyPage" />
              <div className="gpl-tools">
                <button className="btn sm" data-action="ruleUp" disabled={sel === null || sel === 0} onClick={() => moveSel(-1)}>{t('gp.up')}</button>
                <button className="btn sm" data-action="ruleDown" disabled={sel === null || sel >= list.length - 1} onClick={() => moveSel(1)}>{t('gp.down')}</button>
                <button className="btn sm" data-action="ruleRemove" disabled={sel === null} onClick={removeSel}>{t('gp.remove')}</button>
                <button className="btn sm" data-action="ruleAdd"
                  disabled={tab === 'tactic' && tactics.length >= MAX_TACTIC_RULES}
                  onClick={() => setPicker(tab === 'tactic' ? { kind: 'addTactic', step: 'caster' } : { kind: 'addSkill', step: 'officer' })}>
                  {t('gp.add')}
                </button>
                <button className="btn sm" data-action="ruleReset" onClick={reset}>{t('gp.reset')}</button>
              </div>
              {tab === 'tactic' && tactics.length >= MAX_TACTIC_RULES && (
                <p className="hint" data-field="full">{t('gp.full', { n: MAX_TACTIC_RULES })}</p>
              )}
            </>
          )}
        </section>

        <section className="place-panel sqd-acts gpl-acts">
          <button className="btn primary wide" data-action="savePolicy" disabled={!anyDirty} onClick={save}>
            <span className="lbl">{t('gp.save')}</span>
          </button>
          {saved && <p className="hint" data-field="saved">{t('gp.saved')}</p>}
        </section>
      </div>

      {picker && (
        <div className="modal-back" data-modal="policyPicker" data-kind={picker.kind} onClick={() => setPicker(null)}>
          <div className="modal gpl-modal" onClick={(e) => e.stopPropagation()}>
            <PickerBody
              picker={picker}
              profile={profile}
              squad={squad}
              tactics={tactics}
              skills={skills}
              stance={(piece) => stances[piece] ?? 'advance'}
              onClose={() => setPicker(null)}
              onStance={(piece, st) => { setStances({ ...stances, [piece]: st }); touch('stance'); setPicker(null); }}
              onTacticWhen={(i, when) => { setTactics(tactics.map((r, j) => (j === i ? { ...r, when } : r))); touch('tactic'); setPicker(null); }}
              onChance={(i, n) => {
                setTactics(tactics.map((r, j) => {
                  if (j !== i) return r;
                  const { minChance: _drop, ...rest } = r;
                  return n === null ? rest : { ...rest, minChance: n };
                }));
                touch('tactic');
                setPicker(null);
              }}
              onSkillWhen={(i, when) => { setSkills(skills.map((r, j) => (j === i ? { ...r, when } : r))); touch('skill'); setPicker(null); }}
              onStep={setPicker}
              onAddTactic={(rule) => {
                const next = [...tactics, rule];
                setTactics(next); touch('tactic'); setPicker(null);
                setSel(next.length - 1); setPage(Math.floor((next.length - 1) / POLICY_PAGE));
              }}
              onAddSkill={(rule) => {
                const next = [...skills, rule];
                setSkills(next); touch('skill'); setPicker(null);
                setSel(next.length - 1); setPage(Math.floor((next.length - 1) / POLICY_PAGE));
              }}
              onLeave={onBack}
            />
          </div>
        </div>
      )}
    </ScreenChrome>
  );
}

function TacticRow({ rank, rule, usable, selected, onSelect, onWhen, onChance }: {
  rank: number; rule: TacticRule; usable: boolean; selected: boolean;
  onSelect: () => void; onWhen: () => void; onChance: () => void;
}): React.JSX.Element {
  const illusion = isIllusion(rule.tactic);
  return (
    <div className="gpl-row gpl-tactic" data-rule={rank} data-tactic={rule.tactic} data-when={rule.when}
      data-sel={selected ? '1' : '0'} data-usable={usable ? '1' : '0'} onClick={onSelect}>
      <span className="rk">{rank + 1}</span>
      {/* 두 줄 — 무엇을 누구에게 / 누가 언제. 조건 · 확률은 글자 단추다(좁은 칸에 두루마리 단추를 넣으면 글자가 잘렸다) */}
      <div className="gpl-main">
        <p className="gpl-l1">
          <b className="what">{tacticName(rule.tactic)}</b>
          <span className="tg">→ {t(illusion ? 'gp.target.enemy' : 'gp.target.ally')}</span>
          {!usable && <i className="gpl-off" data-field="unusable">{t('gp.unusable')}</i>}
        </p>
        <p className="gpl-l2">
          <span className="who">{rule.caster ? officerName(rule.caster) : t('gp.anyone')}</span>
          <span className="sep">·</span>
          <button className="gpl-link when" data-action="ruleWhen" onClick={(e) => { e.stopPropagation(); onSelect(); onWhen(); }}>
            {t(`gp.when.${rule.when}`)} ▾
          </button>
        </p>
      </div>
      {illusion ? (
        <button className="gpl-link ch" data-action="ruleChance" onClick={(e) => { e.stopPropagation(); onSelect(); onChance(); }}>
          {rule.minChance === undefined ? t('gp.chance.any') : t('gp.chance.min', { n: rule.minChance })} ▾
        </button>
      ) : <span className="ch">—</span>}
    </div>
  );
}

function SkillRow({ rank, rule, usable, selected, onSelect, onWhen }: {
  rank: number; rule: SkillRule; usable: boolean; selected: boolean; onSelect: () => void; onWhen: () => void;
}): React.JSX.Element {
  const skill = skillOf(rule.officer);
  return (
    <div className="gpl-row gpl-skill" data-rule={rank} data-officer={rule.officer} data-when={rule.when}
      data-sel={selected ? '1' : '0'} data-usable={usable ? '1' : '0'} onClick={onSelect}>
      <span className="rk">{rank + 1}</span>
      <div className="gpl-main">
        <p className="gpl-l1">
          <b className="what">{skill ? pickSkillName(skill) : '—'}</b>
          <small>{officerName(rule.officer)}{skill ? ` · ${skill.tier}` : ''}</small>
          {!usable && <i className="gpl-off" data-field="unusable">{t('gp.unusable')}</i>}
        </p>
        <p className="gpl-l2">
          <button className="gpl-link when" data-action="ruleWhen" onClick={(e) => { e.stopPropagation(); onSelect(); onWhen(); }}>
            {t(`gp.when.${rule.when}`)} ▾
          </button>
        </p>
      </div>
    </div>
  );
}

/** 고르는 판의 속 — 무엇을 고르는지(`picker.kind`)에 따라 단추 목록이 바뀐다 */
function PickerBody(props: {
  picker: Picker; profile: PlayerProfile; squad: Squad; tactics: TacticRule[]; skills: SkillRule[];
  stance: (piece: PieceType) => DefenseStance;
  onClose: () => void;
  onStance: (piece: PieceType, st: DefenseStance) => void;
  onTacticWhen: (i: number, when: TacticCondition) => void;
  onChance: (i: number, n: number | null) => void;
  onSkillWhen: (i: number, when: SkillCondition) => void;
  onStep: (p: Picker) => void;
  onAddTactic: (rule: TacticRule) => void;
  onAddSkill: (rule: SkillRule) => void;
  onLeave: () => void;
}): React.JSX.Element {
  const { picker: p, profile, squad } = props;
  const choice = (key: string, label: string, onClick: () => void, on = false, sub?: string): React.JSX.Element => (
    <button key={key} className="btn wide gpl-choice" data-choice={key} data-on={on ? '1' : '0'} onClick={onClick}>
      <span className="lbl">{label}</span>
      {sub && <small className="gpl-choice-sub">{sub}</small>}
    </button>
  );
  const cancel = <button className="btn wide" data-action="pickCancel" onClick={props.onClose}>{t('gp.cancel')}</button>;

  switch (p.kind) {
    case 'stance': {
      const now = props.stance(p.piece);
      return (
        <>
          <p className="modal-ttl">{t('gp.pick.stance', { piece: p.piece, name: officerName(p.officer) })}</p>
          <div className="gpl-choices">
            {stancesFor(p.piece).map((st) => choice(st, t(`gp.stance.${st}`), () => props.onStance(p.piece, st), st === now, t(`gp.stance.${st}.d`)))}
          </div>
          {cancel}
        </>
      );
    }
    case 'tacticWhen':
    case 'skillWhen': {
      const conds: readonly (TacticCondition | SkillCondition)[] = p.kind === 'tacticWhen' ? TACTIC_CONDITIONS : SKILL_CONDITIONS;
      const now = p.kind === 'tacticWhen' ? props.tactics[p.index]?.when : props.skills[p.index]?.when;
      return (
        <>
          <p className="modal-ttl">{t('gp.add.when')}</p>
          <div className="gpl-choices">
            {conds.map((c) => choice(c, t(`gp.when.${c}`), () => (p.kind === 'tacticWhen'
              ? props.onTacticWhen(p.index, c as TacticCondition)
              : props.onSkillWhen(p.index, c as SkillCondition)), c === now))}
          </div>
          {cancel}
        </>
      );
    }
    case 'chance': {
      const now = props.tactics[p.index]?.minChance;
      return (
        <>
          <p className="modal-ttl">{t('gp.add.chance')}</p>
          <div className="gpl-choices gpl-grid">
            {choice('any', t('gp.chance.any'), () => props.onChance(p.index, null), now === undefined)}
            {CHANCE_STEPS.map((n) => choice(String(n), t('gp.chance.min', { n }), () => props.onChance(p.index, n), now === n))}
          </div>
          {cancel}
        </>
      );
    }
    case 'addTactic': {
      if (p.step === 'caster') {
        const casters = squad.picks.filter((x) => officerPolicyTactics(profile, x.officer).length > 0);
        return (
          <>
            <p className="modal-ttl">{t('gp.add.caster')}</p>
            <div className="gpl-choices">
              {choice('anyone', t('gp.anyone'), () => props.onStep({ ...p, step: 'tactic', caster: null }))}
              {casters.map((x) => choice(x.officer, officerName(x.officer), () => props.onStep({ ...p, step: 'tactic', caster: x.officer })))}
            </div>
            {cancel}
          </>
        );
      }
      if (p.step === 'tactic') {
        const list = p.caster ? officerPolicyTactics(profile, p.caster) : [...squadPolicyTactics(profile, squad)];
        return (
          <>
            <p className="modal-ttl">{t('gp.add.tactic')}</p>
            <div className="gpl-choices gpl-grid">
              {[...new Set(list)].map((id) => choice(id, tacticName(id), () => props.onStep({ ...p, step: 'when', tactic: id })))}
            </div>
            <button className="btn wide" data-action="pickBack" onClick={() => props.onStep({ kind: 'addTactic', step: 'caster' })}>{t('gp.prev')}</button>
          </>
        );
      }
      if (p.step === 'when') {
        const finish = (when: TacticCondition): void => {
          if (isIllusion(p.tactic!)) props.onStep({ ...p, step: 'chance', when });
          else props.onAddTactic({ caster: p.caster ?? null, tactic: p.tactic!, when });
        };
        return (
          <>
            <p className="modal-ttl">{t('gp.add.when')}</p>
            <div className="gpl-choices">
              {TACTIC_CONDITIONS.map((c) => choice(c, t(`gp.when.${c}`), () => finish(c)))}
            </div>
            <button className="btn wide" data-action="pickBack" onClick={() => props.onStep({ ...p, step: 'tactic' })}>{t('gp.prev')}</button>
          </>
        );
      }
      const add = (n: number | null): void => props.onAddTactic({
        caster: p.caster ?? null, tactic: p.tactic!, when: p.when!, ...(n === null ? {} : { minChance: n }),
      });
      return (
        <>
          <p className="modal-ttl">{t('gp.add.chance')}</p>
          <div className="gpl-choices gpl-grid">
            {choice('any', t('gp.chance.any'), () => add(null))}
            {CHANCE_STEPS.map((n) => choice(String(n), t('gp.chance.min', { n }), () => add(n)))}
          </div>
          <button className="btn wide" data-action="pickBack" onClick={() => props.onStep({ ...p, step: 'when' })}>{t('gp.prev')}</button>
        </>
      );
    }
    case 'addSkill': {
      if (p.step === 'officer') {
        const listed = new Set(props.skills.map((r) => r.officer));
        const left = squad.picks.filter((x) => skillOf(x.officer) && !listed.has(x.officer));
        return (
          <>
            <p className="modal-ttl">{t('gp.add.skill')}</p>
            {left.length === 0 && <p className="hint" data-field="noSkill">{t('gp.add.none')}</p>}
            <div className="gpl-choices">
              {left.map((x) => {
                const s = skillOf(x.officer)!;
                return choice(x.officer, pickSkillName(s), () => props.onStep({ ...p, step: 'when', officer: x.officer }), false, officerName(x.officer));
              })}
            </div>
            {cancel}
          </>
        );
      }
      return (
        <>
          <p className="modal-ttl">{t('gp.add.when')}</p>
          <div className="gpl-choices">
            {SKILL_CONDITIONS.map((c) => choice(c, t(`gp.when.${c}`), () => props.onAddSkill({ officer: p.officer!, when: c })))}
          </div>
          <button className="btn wide" data-action="pickBack" onClick={() => props.onStep({ kind: 'addSkill', step: 'officer' })}>{t('gp.prev')}</button>
        </>
      );
    }
    case 'leave':
      return (
        <>
          <p className="modal-ttl">{t('gp.leave.ttl')}</p>
          <div className="gpl-choices">
            <button className="btn primary wide" data-action="leaveConfirm" onClick={props.onLeave}>{t('gp.leave.ok')}</button>
            {cancel}
          </div>
        </>
      );
  }
}

/**
 * 새 책략 알림 — 책략 방침을 저장해 둔 수비군의 장수가 **새 책략을 쓸 수 있게 되면** 한 번 뜬다(pptx 121쪽).
 * 레벨업이 어느 화면에서 끝나든 알 수 있게 `App.tsx`가 그린다(태학 알림과 같은 자리). [방침 설정하기] · [닫기] 둘 다
 * 본 것으로 적는다(`acknowledgePolicyTactics`) — 방침 줄은 안 바뀐다.
 */
export function PolicyNotice({ profile, onGo, onClose }: {
  profile: PlayerProfile;
  onGo: (next: PlayerProfile, squadId: string) => void;
  onClose: (next: PlayerProfile) => void;
}): React.JSX.Element | null {
  useLang();
  const squad = GARRISON_MODES.map((m) => garrisonOf(profile, m)).find((q): q is Squad => !!q && newPolicyTactics(profile, q).length > 0);
  if (!squad) return null;
  const names = newPolicyTactics(profile, squad).map(tacticName).join(', ');
  const ack = (): PlayerProfile => acknowledgePolicyTactics(profile, squad.id);
  return (
    <div className="modal-back" data-modal="policyNotice" data-squad={squad.id}>
      <div className="modal frg-confirm gpl-notice">
        <p className="modal-ttl">{t('gp.new.ttl')}</p>
        <p className="frg-confirm-body" data-field="tactics">{t('gp.new.body', { squad: squad.name, tactics: names })}</p>
        <div className="frg-confirm-acts">
          <button className="btn primary wide" data-action="policyGo" onClick={() => onGo(ack(), squad.id)}>{t('gp.new.go')}</button>
          <button className="btn wide" data-action="policyClose" onClick={() => onClose(ack())}>{t('gp.new.close')}</button>
        </div>
      </div>
    </div>
  );
}
