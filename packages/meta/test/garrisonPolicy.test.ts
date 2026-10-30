/**
 * 수비군 방침 (2026-10-30, `garrisonPolicy.ts` · GDD §8.8 「단계 6에서 정한 것」).
 *
 * 여기서 고정하는 것.
 *  - **손대기 전에는 기본을 그때그때 낸다** — 장수가 책략을 배우면 기본 방침에 저절로 든다
 *  - 저장하면 굳고, 그 뒤 새로 배운 책략만 알린다(`newPolicyTactics`) — 본 것으로 적으면 그친다
 *  - **되접기를 지나도 남는다** — 부대의 방침, 그리고 진행 중인 공성전에 굳힌 방침(다듬지 않고 그대로)
 *  - 판에 싣는 값(`resolvePolicy`)은 성립하지 않는 줄을 뺀다 · 화면 값(`effectivePolicy`)은 남긴다
 *  - 다듬기 — 고를 수 없는 행동 · 진화 · 20줄 넘는 꼬리 · 겹친 고유기술 줄 · 보조 책략의 확률을 버린다
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DefensePolicy, OfficerId, TacticId, TacticRule } from '@samchess/rules';
import {
  BASIC_TUTORIALS, acknowledgePolicyTactics, createProfile, effectivePolicy, garrisonOf, garrisonSnapshot,
  migrateProfile, newPolicyTactics, normalizePolicy, resolvePolicy, setSquadPolicy, skillsTabOpen, tacticsTabOpen,
} from '../src/index.ts';
import type { AiBattleState, PlayerProfile } from '../src/index.ts';
import { withGarrisons } from './fixtures.ts';

const TID = (id: string): TacticId => id as TacticId;
const fresh = (): PlayerProfile => withGarrisons({ ...createProfile('방침성', 11), tutorial: { done: [...BASIC_TUTORIALS] } });

/** 부대의 둘째 장수에게 레벨과 책략을 준다(성장 스택을 직접 쌓는다 — 길이 = 레벨 − 1) */
function teach(p: PlayerProfile, officer: OfficerId, tactics: TacticId[]): PlayerProfile {
  const inst = p.roster[officer]!;
  const growth = tactics.map((t) => ({ stat: 'hp' as const, tactics: [t] }));
  return { ...p, roster: { ...p.roster, [officer]: { ...inst, level: growth.length + 1, growth } } };
}

const roundTrip = (p: PlayerProfile): PlayerProfile => migrateProfile(JSON.parse(JSON.stringify(p)))!;

describe('기본 — 손대기 전에는 그때그때 낸다', () => {
  it('King 수성 · 책략 없음 → 책략 탭은 Lv2 장수가 생겨야 열린다', () => {
    const p = fresh();
    const squad = garrisonOf(p, '3v3')!;
    const pol = effectivePolicy(p, squad);
    assert.equal(pol.stances.King, 'hold');
    assert.deepEqual(pol.tactics, []);
    assert.equal(tacticsTabOpen(p, squad), false);
    const second = squad.picks[1]!.officer;
    const taught = teach(p, second, [TID('jeung-pok')]);
    assert.equal(tacticsTabOpen(taught, garrisonOf(taught, '3v3')!), true);
    assert.deepEqual(effectivePolicy(taught, garrisonOf(taught, '3v3')!).tactics.map((r) => r.tactic), ['jeung-pok'],
      '배우면 기본 방침에 저절로 든다');
  });

  it('고유기술 탭은 고유기술을 가진 장수가 있어야 열린다', () => {
    const p = fresh();
    const squad = garrisonOf(p, '5v5')!;
    assert.equal(skillsTabOpen(squad), effectivePolicy(p, squad).skills.length > 0);
  });
});

describe('저장 — 굳고, 새로 배운 것만 알린다', () => {
  it('행동을 저장하면 그 기물만 바뀌고, 나머지는 기본', () => {
    const p = fresh();
    const squad = garrisonOf(p, '3v3')!;
    const second = squad.picks[1]!.piece;
    const saved = setSquadPolicy(p, squad.id, { stances: { [second]: 'escort' } });
    const pol = effectivePolicy(saved, garrisonOf(saved, '3v3')!);
    assert.equal(pol.stances[second], 'escort');
    assert.equal(pol.stances.King, 'hold');
  });

  it('책략 방침을 저장한 뒤 배운 책략은 알리고, 본 것으로 적으면 그친다', () => {
    let p = fresh();
    const squad = garrisonOf(p, '3v3')!;
    const second = squad.picks[1]!.officer;
    p = teach(p, second, [TID('jeung-pok')]);
    assert.deepEqual(newPolicyTactics(p, garrisonOf(p, '3v3')!), [], '손대지 않은 부대는 알릴 것이 없다');

    p = setSquadPolicy(p, squad.id, { tactics: [{ caster: null, tactic: TID('jeung-pok'), when: 'allyEngaged' }] });
    p = teach(p, second, [TID('jeung-pok'), TID('ban-gam')]);
    assert.deepEqual(newPolicyTactics(p, garrisonOf(p, '3v3')!), ['ban-gam']);
    assert.deepEqual(effectivePolicy(p, garrisonOf(p, '3v3')!).tactics.map((r) => r.tactic), ['jeung-pok'],
      '굳은 방침에는 저절로 안 든다');

    p = acknowledgePolicyTactics(p, squad.id);
    assert.deepEqual(newPolicyTactics(p, garrisonOf(p, '3v3')!), []);
  });

  it('[방침 초기화] — 칸을 지우면 다시 기본이 따라온다', () => {
    let p = fresh();
    const squad = garrisonOf(p, '3v3')!;
    p = setSquadPolicy(p, squad.id, { tactics: [] });
    p = teach(p, squad.picks[1]!.officer, [TID('jeung-pok')]);
    assert.deepEqual(effectivePolicy(p, garrisonOf(p, '3v3')!).tactics, []);
    p = setSquadPolicy(p, squad.id, { tactics: null });
    assert.deepEqual(effectivePolicy(p, garrisonOf(p, '3v3')!).tactics.map((r) => r.tactic), ['jeung-pok']);
  });
});

describe('되접기를 지나도 남는다', () => {
  it('부대의 방침 — 행동 · 책략 · 고유기술 · 본 책략', () => {
    let p = fresh();
    const squad = garrisonOf(p, '3v3')!;
    p = teach(p, squad.picks[1]!.officer, [TID('gong-po')]);
    p = setSquadPolicy(p, squad.id, {
      stances: { King: 'advance' },
      tactics: [{ caster: squad.picks[1]!.officer, tactic: TID('gong-po'), when: 'enemyHalfHp', minChance: 50 }],
      skills: [],
    });
    const back = roundTrip(p);
    assert.deepEqual(garrisonOf(back, '3v3')!.policy, garrisonOf(p, '3v3')!.policy);
    assert.ok(garrisonOf(back, '3v3')!.policy!.seenTactics!.includes(TID('gong-po')));
  });

  it('진행 중인 공성전에 굳힌 방침 — 다듬지 않고 그대로(서버 재생이 같은 값을 받아야 한다)', () => {
    const p = fresh();
    const policy: DefensePolicy = { stances: { King: 'hold' }, tactics: [], skills: [] };
    const ai: AiBattleState = {
      status: 'matched', mode: '3v3', seed: 7, picks: garrisonOf(p, '3v3')!.picks, squadId: null,
      foe: { entries: [], power: 0 },
      defender: { uid: 'd', cityName: '성', cityLevel: 1, squadName: '수비', deploy: null, policy },
    };
    const back = roundTrip({ ...p, aiBattle: ai });
    assert.deepEqual(back.aiBattle?.defender?.policy, policy);
  });
});

describe('판에 싣는 값 · 화면 값', () => {
  it('부대에 없는 장수의 줄 · 아무도 모르는 책략의 줄은 판에서 빠지고 화면에는 남는다', () => {
    let p = fresh();
    const squad = garrisonOf(p, '3v3')!;
    p = teach(p, squad.picks[1]!.officer, [TID('jeung-pok')]);
    const rules: TacticRule[] = [
      { caster: 'nobody' as OfficerId, tactic: TID('jeung-pok'), when: 'allyEngaged' },
      { caster: null, tactic: TID('cho-seon'), when: 'allyEngaged' },
      { caster: null, tactic: TID('jeung-pok'), when: 'allyEngaged' },
    ];
    p = setSquadPolicy(p, squad.id, { tactics: rules });
    const s = garrisonOf(p, '3v3')!;
    assert.equal(effectivePolicy(p, s).tactics.length, 3);
    assert.deepEqual(resolvePolicy(p, s).tactics.map((r) => r.tactic), ['jeung-pok']);
    assert.deepEqual(garrisonSnapshot(p, '3v3')!.policy, resolvePolicy(p, s), '수비군 스냅샷이 그 값을 싣는다');
  });
});

describe('다듬기', () => {
  it('고를 수 없는 행동 · 진화 · 보조의 확률 · 겹친 고유기술 · 20줄 넘는 꼬리를 버린다', () => {
    const many = Array.from({ length: 25 }, () => ({ caster: null, tactic: 'jeung-pok', when: 'allyEngaged' }));
    const n = normalizePolicy({
      stances: { King: 'escort', Queen: 'hold', Rock: 'occupy' },
      tactics: [
        { caster: null, tactic: 'jin-hwa', when: 'allyEngaged' },
        { caster: null, tactic: 'jeung-pok', when: 'allyEngaged', minChance: 50 },
        { caster: null, tactic: 'gong-po', when: 'allyEngaged', minChance: 55 },
        ...many,
      ],
      skills: [{ officer: 'jo-jo', when: 'spReady' }, { officer: 'jo-jo', when: 'selfEngaged' }, { officer: 'jo-jo', when: 'nope' }],
    })!;
    assert.deepEqual(n.stances, { Rock: 'occupy' }, 'King 호위 · Queen 수성은 고를 수 없다');
    assert.equal(n.tactics!.length, 20);
    assert.equal(n.tactics![0]!.tactic, 'jeung-pok', '진화는 버린다');
    assert.equal(n.tactics![0]!.minChance, undefined, '보조 책략에는 확률이 없다');
    assert.equal(n.tactics![1]!.minChance, undefined, '10 단위가 아닌 확률은 버린다');
    assert.deepEqual(n.skills, [{ officer: 'jo-jo', when: 'spReady' }]);
  });
});
