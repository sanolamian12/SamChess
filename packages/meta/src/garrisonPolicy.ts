/**
 * 수비군 방침 — 공성전의 수비군 AI가 따르는 행동 · 책략 · 고유기술 방침 (GDD §8.8 「단계 6에서 정한 것」, 2026-10-30)
 *
 * **방침은 부대에 붙는다**(`Squad.policy`) — 수비군을 다른 부대로 바꾸면 그 부대의 방침이 선다. 모드마다
 * 수비군이 달라 두 벌이 된다. 엔진이 읽는 모양(`DefensePolicy`)과 규칙 표(고를 수 있는 것 · 기본값)는
 * `@samchess/rules`의 `policy.ts`가 쥐고, 여기는 **계정에서 그 값을 내는 자리**다.
 *
 * ────────────────────────────────────────────────────────────────
 * 손대기 전에는 기본을 그때그때 낸다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 칸마다(행동 · 책략 · 고유기술) 저장된 값이 없으면 기본이다 — 그래서 장수가 레벨업해 새 책략을 배우면
 * 기본 방침에 저절로 들어간다. 사람이 저장하면 그 칸은 굳는다. 그 뒤 새로 쓸 수 있게 된 책략은
 * `newPolicyTactics()`가 알려 주고(레벨업을 마친 순간의 팝업), 본 것으로 적으면(`acknowledgePolicyTactics`) 그친다.
 *
 * **판에 싣는 값은 `resolvePolicy()` 하나가 낸다** — 장수가 빠져 성립하지 않는 줄을 빼고, 비어 있는 칸은 기본으로
 * 채운다. 화면은 성립하지 않는 줄을 지우지 않고 「쓸 수 없음」으로 보인다(`tacticRuleUsable` · `skillRuleUsable`).
 *
 * meta는 시계 · 난수를 안 읽는다.
 */

import { TACTICS, combatantById } from '@samchess/data';
import {
  CHANCE_STEPS, EXCLUDED_TACTICS, MAX_TACTIC_RULES, SKILL_CONDITIONS, TACTIC_CONDITIONS,
  defaultSkillRules, defaultStances, defaultTacticRules, stancesFor,
} from '@samchess/rules';
import type {
  DefensePolicy, DefenseStance, OfficerId, PieceType, SkillCondition, SkillRule, TacticCondition, TacticId, TacticRule,
} from '@samchess/rules';
import { tacticsOf } from './profile.ts';
import { squadById } from './squads.ts';
import type { PlayerProfile, Squad, SquadPolicy } from './types.ts';

const PIECES: readonly PieceType[] = ['King', 'Queen', 'Rock', 'Bishop', 'Knight', 'Pawn'];
const tacticDef = new Map(TACTICS.map((t) => [t.id, t]));

/** 방침 줄에 적을 수 있는 원본 책략인가 — 레벨업으로 배우는 16종에서 진화를 뺀 것 */
const policyTactic = (id: string): boolean => tacticDef.has(id) && !EXCLUDED_TACTICS.has(id);

/** 이 장수가 방침에 쓸 수 있는 원본 책략(배운 차례) — 태학 개량형도 원본으로 센다(성장 스택은 원본 id다) */
export function officerPolicyTactics(profile: PlayerProfile, officer: OfficerId): TacticId[] {
  const inst = profile.roster[officer];
  return inst ? tacticsOf(inst).filter(policyTactic) : [];
}

/** 부대가 방침에 쓸 수 있는 원본 책략 전부 */
export function squadPolicyTactics(profile: PlayerProfile, squad: Squad): Set<TacticId> {
  return new Set(squad.picks.flatMap((p) => officerPolicyTactics(profile, p.officer)));
}

const hasSkill = (officer: OfficerId): boolean => !!combatantById.get(officer)?.uniqueSkill;

/** [책략] 탭이 열리는가 — 수비군에 Lv2 이상이 한 명이라도 있다 (pptx 120쪽) */
export const tacticsTabOpen = (profile: PlayerProfile, squad: Squad): boolean =>
  squad.picks.some((p) => (profile.roster[p.officer]?.level ?? 0) >= 2);

/** [고유기술] 탭이 열리는가 — 수비군에 고유기술을 가진 장수가 있다 (pptx 122쪽) */
export const skillsTabOpen = (squad: Squad): boolean => squad.picks.some((p) => hasSkill(p.officer));

/** 기본 방침 — 행동은 편성 순서, 책략은 표에서 수비군이 가진 줄, 고유기술은 등급 순 */
export function defaultPolicy(profile: PlayerProfile, squad: Squad): DefensePolicy {
  return {
    stances: defaultStances(squad.picks.map((p) => p.piece)),
    tactics: defaultTacticRules(squadPolicyTactics(profile, squad)),
    skills: defaultSkillRules(squad.picks.map((p) => p.officer)),
  };
}

/**
 * 화면이 그리는 방침 — 칸마다 저장된 것, 없으면 기본. **성립하지 않는 줄도 그대로 둔다**(화면이 「쓸 수 없음」으로 보인다).
 */
export function effectivePolicy(profile: PlayerProfile, squad: Squad): DefensePolicy {
  const base = defaultPolicy(profile, squad);
  const own = squad.policy;
  return {
    stances: { ...base.stances, ...pickStances(squad, own?.stances) },
    tactics: own?.tactics ? own.tactics.map((r) => ({ ...r })) : base.tactics,
    skills: own?.skills ? own.skills.map((r) => ({ ...r })) : base.skills,
  };
}

/** 이 부대의 기물이 고를 수 있는 행동만 남긴다 */
function pickStances(
  squad: Squad, raw: Partial<Record<PieceType, DefenseStance>> | undefined,
): Partial<Record<PieceType, DefenseStance>> {
  const out: Partial<Record<PieceType, DefenseStance>> = {};
  for (const p of squad.picks) {
    const st = raw?.[p.piece];
    if (st && stancesFor(p.piece).includes(st)) out[p.piece] = st;
  }
  return out;
}

/** 책략 줄이 지금 판에 실릴 수 있는가 — 특정 장수면 그 장수가 부대에 있고 그 책략을 안다, 「누구든지」면 누군가 안다 */
export function tacticRuleUsable(profile: PlayerProfile, squad: Squad, rule: TacticRule): boolean {
  const casters = rule.caster ? squad.picks.filter((p) => p.officer === rule.caster) : squad.picks;
  return casters.some((p) => officerPolicyTactics(profile, p.officer).includes(rule.tactic));
}

/** 고유기술 줄이 지금 판에 실릴 수 있는가 — 그 장수가 부대에 있다 */
export const skillRuleUsable = (squad: Squad, rule: SkillRule): boolean =>
  squad.picks.some((p) => p.officer === rule.officer) && hasSkill(rule.officer);

/** **판에 싣는 값** — 성립하지 않는 줄을 뺀다. 수비군 스냅샷(`garrisonSnapshot`)이 부른다 */
export function resolvePolicy(profile: PlayerProfile, squad: Squad): DefensePolicy {
  const p = effectivePolicy(profile, squad);
  return {
    stances: p.stances,
    tactics: p.tactics.filter((r) => tacticRuleUsable(profile, squad, r)),
    skills: p.skills.filter((r) => skillRuleUsable(squad, r)),
  };
}

// ── 저장 ──────────────────────────────────────────────────────

/**
 * 저장할 모양으로 다듬는다 — 모르는 값 · 고를 수 없는 행동 · 20줄 넘는 꼬리 · 겹친 고유기술 줄을 버린다.
 * 되접기(`migrateProfile`)와 저장(`setSquadPolicy`)이 함께 부른다. 남는 것이 없으면 `undefined`.
 */
export function normalizePolicy(raw: unknown): SquadPolicy | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: SquadPolicy = {};

  if (r.stances && typeof r.stances === 'object') {
    const st: Partial<Record<PieceType, DefenseStance>> = {};
    for (const piece of PIECES) {
      const v = (r.stances as Record<string, unknown>)[piece];
      if (typeof v === 'string' && stancesFor(piece).includes(v as DefenseStance)) st[piece] = v as DefenseStance;
    }
    if (Object.keys(st).length > 0) out.stances = st;
  }

  if (Array.isArray(r.tactics)) {
    const rules: TacticRule[] = [];
    for (const v of r.tactics) {
      if (!v || typeof v !== 'object') continue;
      const x = v as Record<string, unknown>;
      if (typeof x.tactic !== 'string' || !policyTactic(x.tactic)) continue;
      if (!TACTIC_CONDITIONS.includes(x.when as TacticCondition)) continue;
      const caster = typeof x.caster === 'string' && x.caster ? (x.caster as OfficerId) : null;
      const illusion = tacticDef.get(x.tactic)!.school === 'illusion';
      const chance = illusion && typeof x.minChance === 'number' && CHANCE_STEPS.includes(x.minChance) ? x.minChance : undefined;
      rules.push({
        caster, tactic: x.tactic as TacticId, when: x.when as TacticCondition,
        ...(chance !== undefined ? { minChance: chance } : {}),
      });
      if (rules.length >= MAX_TACTIC_RULES) break;
    }
    out.tactics = rules;
  }

  if (Array.isArray(r.skills)) {
    const rules: SkillRule[] = [];
    const seen = new Set<string>();
    for (const v of r.skills) {
      if (!v || typeof v !== 'object') continue;
      const x = v as Record<string, unknown>;
      if (typeof x.officer !== 'string' || seen.has(x.officer) || !hasSkill(x.officer as OfficerId)) continue;
      if (!SKILL_CONDITIONS.includes(x.when as SkillCondition)) continue;
      seen.add(x.officer);
      rules.push({ officer: x.officer as OfficerId, when: x.when as SkillCondition });
    }
    out.skills = rules;
  }

  if (Array.isArray(r.seenTactics)) {
    out.seenTactics = [...new Set(r.seenTactics.filter((t): t is string => typeof t === 'string' && policyTactic(t)))] as TacticId[];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 저장할 칸들 — 없는 칸은 건드리지 않고, `null`이면 그 칸을 지운다(= 기본으로 되돌린다, [방침 초기화]) */
export interface SquadPolicyDraft {
  stances?: Partial<Record<PieceType, DefenseStance>> | null;
  tactics?: TacticRule[] | null;
  skills?: SkillRule[] | null;
}

/**
 * 부대의 방침을 고친다. 책략 칸을 저장하면 **지금 쓸 수 있는 책략을 본 것으로 적는다**(`seenTactics`) —
 * 그 뒤 새로 배운 것만 팝업이 알린다. 없는 부대는 던진다(화면이 단추를 안 띄운다).
 */
export function setSquadPolicy(profile: PlayerProfile, squadId: string, draft: SquadPolicyDraft): PlayerProfile {
  const squad = squadById(profile, squadId);
  if (!squad) throw new Error(`없는 부대다: ${squadId}`);
  const merged: Record<string, unknown> = { ...squad.policy };
  for (const k of ['stances', 'tactics', 'skills'] as const) {
    if (draft[k] === null) delete merged[k];
    else if (draft[k] !== undefined) merged[k] = draft[k];
  }
  if (draft.tactics !== undefined) merged.seenTactics = [...squadPolicyTactics(profile, squad)];
  const policy = normalizePolicy(merged);
  const next: Squad = { ...squad };
  if (policy) next.policy = policy;
  else delete next.policy;
  return { ...profile, squads: profile.squads.map((s) => (s.id === squadId ? next : s)) };
}

/**
 * 책략 방침을 저장해 둔 뒤 **새로 쓸 수 있게 된 책략** — 레벨업을 마친 순간의 팝업이 묻는다.
 * 손대지 않은 부대(기본이 그때그때 따라온다)는 언제나 빈 목록이다.
 */
export function newPolicyTactics(profile: PlayerProfile, squad: Squad): TacticId[] {
  if (!squad.policy?.tactics) return [];
  const seen = new Set(squad.policy.seenTactics ?? []);
  return [...squadPolicyTactics(profile, squad)].filter((t) => !seen.has(t));
}

/** 팝업을 닫으면 지금 쓸 수 있는 책략을 본 것으로 적는다 — 방침 줄은 안 바뀐다 */
export function acknowledgePolicyTactics(profile: PlayerProfile, squadId: string): PlayerProfile {
  const squad = squadById(profile, squadId);
  if (!squad?.policy?.tactics) return profile;
  const policy = normalizePolicy({ ...squad.policy, seenTactics: [...squadPolicyTactics(profile, squad)] })!;
  return { ...profile, squads: profile.squads.map((s) => (s.id === squadId ? { ...s, policy } : s)) };
}
