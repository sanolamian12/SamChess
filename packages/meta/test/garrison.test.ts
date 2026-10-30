/**
 * 수비군 (2026-10-27, `garrison.ts` · GDD §8.8 단계 1).
 *
 * 여기서 고정하는 것 다섯.
 *  - **고르지 않았으면 그 모드의 첫 부대**이고, 고른 부대가 사라지거나 성립하지 않으면 다음 부대로 물러난다
 *  - **두 모드 모두 서야 출정**한다 — 모자란 모드의 인원이 이유에 실린다
 *  - **고른 것은 되접기를 지나도 남는다** — 없는 부대 · 모드가 다른 부대는 버린다
 *  - **스냅샷**은 시각 없는 전투력 · 북군 배치 프리셋 · 기본 방침
 *  - **보초병은 수비군에 들 수 없다** — 부대에 넣는 순간 농지에서 빠진다
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OfficerId } from '@samchess/rules';
import {
  BASIC_TUTORIALS, GARRISON_SIDE, addSquad, battlePower, createProfile, defaultSquadCells, garrisonGate, garrisonOf,
  garrisonSnapshot, guardsOf, initialBuildings, isGarrison, migrateProfile, removeSquad, setGarrison, setGuards,
  resolvePolicy, sortieGate, squadsOf, toRosterEntries, withDeployment, updateSquad,
} from '../src/index.ts';
import type { PlayerProfile, RosterPick } from '../src/index.ts';
import { withGarrisons } from './fixtures.ts';

const O = (id: string): OfficerId => id as OfficerId;

/** 기본 셋을 끝냈고 부대는 없는 계정 */
const fresh = (): PlayerProfile => ({ ...createProfile('수비성', 11), tutorial: { done: [...BASIC_TUTORIALS] } });

/** 3v3 부대 둘 · 5v5 부대 하나 */
function twoThrees(): { p: PlayerProfile; a: string; b: string; five: string } {
  let p = withGarrisons(fresh());
  const a = squadsOf(p, '3v3')[0]!.id;
  const five = squadsOf(p, '5v5')[0]!.id;
  const picks = squadsOf(p, '3v3')[0]!.picks;
  const r = addSquad(p, { name: '둘째', mode: '3v3', picks });
  p = r.profile;
  return { p, a, b: r.squad.id, five };
}

describe('수비군 — 고르지 않았으면 그 모드의 첫 부대', () => {
  it('부대가 없으면 없다', () => {
    assert.equal(garrisonOf(fresh(), '3v3'), null);
    assert.equal(garrisonOf(fresh(), '5v5'), null);
  });

  it('첫 부대가 기본이고, 고르면 그 부대다 — 모드마다 따로', () => {
    const { p, a, b, five } = twoThrees();
    assert.equal(garrisonOf(p, '3v3')?.id, a);
    assert.equal(p.garrison, undefined, '기본은 저장하지 않는다 — 읽을 때 낸다');
    const picked = setGarrison(p, b);
    assert.equal(garrisonOf(picked, '3v3')?.id, b);
    assert.equal(garrisonOf(picked, '5v5')?.id, five, '다른 모드는 그대로');
    assert.ok(isGarrison(picked, squadsOf(picked, '3v3').find((s) => s.id === b)!));
    assert.ok(!isGarrison(picked, squadsOf(picked, '3v3').find((s) => s.id === a)!));
  });

  it('고른 부대를 지우면 다음 부대로 물러난다 — 수비군이 비지 않는다', () => {
    const { p, a, b } = twoThrees();
    const gone = removeSquad(setGarrison(p, b), b);
    assert.equal(garrisonOf(gone, '3v3')?.id, a);
  });

  it('고른 부대가 성립하지 않게 되면(장수가 계정에서 빠졌다) 다음 부대로', () => {
    const { p, a, b } = twoThrees();
    const picked = setGarrison(p, a);
    const lost = squadsOf(picked, '3v3').find((s) => s.id === a)!.picks[1]!.officer;
    const { [lost]: _gone, ...roster } = picked.roster;
    // 둘째 부대는 같은 장수를 쓰므로 바꿔 끼운다 — 남은 장수로 성립하게
    const broken = { ...picked, roster };
    const usable = Object.keys(roster).filter((id) => id !== lost) as OfficerId[];
    const fixed = updateSquad(broken, b, {
      name: '둘째', mode: '3v3',
      picks: [{ piece: 'King', officer: usable[0]! }, { piece: 'Rock', officer: usable[1]! }, { piece: 'Bishop', officer: usable[2]! }],
    });
    assert.equal(garrisonOf(fixed, '3v3')?.id, b);
  });

  it('없는 부대는 고를 수 없다', () => {
    assert.throws(() => setGarrison(fresh(), 'sq99'), /없는 부대/);
  });
});

describe('출정 조건 — 두 모드 모두 수비군이 서야 한다', () => {
  it('3v3이 먼저, 그다음 5v5 — 모자란 모드의 인원이 실린다', () => {
    const none = garrisonGate(fresh());
    assert.deepEqual(!none.ok && [none.code, none.params], ['sortie.noGarrison', { size: 3 }]);
    const p = fresh();
    const three = addSquad(p, { name: '셋', mode: '3v3', picks: withGarrisons(p).squads[0]!.picks }).profile;
    const onlyThree = garrisonGate(three);
    assert.deepEqual(!onlyThree.ok && [onlyThree.code, onlyThree.params], ['sortie.noGarrison', { size: 5 }]);
    assert.deepEqual(garrisonGate(withGarrisons(fresh())), { ok: true });
    assert.deepEqual(sortieGate(withGarrisons(fresh())), { ok: true });
  });
});

describe('저장 — 되접기를 지나도 남는다', () => {
  it('고른 부대는 남고, 없는 부대 · 모드가 다른 부대는 버린다', () => {
    const { p, b, five } = twoThrees();
    const picked = setGarrison(p, b);
    const back = migrateProfile(JSON.parse(JSON.stringify(picked)))!;
    assert.deepEqual(back.garrison, { '3v3': b });

    const wrong = migrateProfile(JSON.parse(JSON.stringify({ ...picked, garrison: { '3v3': five, '5v5': 'sq99' } })))!;
    assert.equal(wrong.garrison, undefined, '5v5 부대를 3v3에 · 없는 부대를 5v5에 적은 줄은 버린다');
  });
});

describe('스냅샷 — 공성전의 상대가 이 값으로 선다', () => {
  it('시각 없는 명단 · 전투력, 기본 방침', () => {
    const p = withGarrisons(fresh());
    const squad = garrisonOf(p, '5v5')!;
    const snap = garrisonSnapshot(p, '5v5')!;
    const entries = toRosterEntries(p, squad.picks);
    assert.equal(snap.squadId, squad.id);
    assert.equal(snap.squadName, squad.name);
    assert.deepEqual(snap.entries, entries);
    assert.equal(snap.power, battlePower('5v5', entries));
    assert.deepEqual(snap.policy, resolvePolicy(p, squad), '방침은 판에 싣는 값(풀린 것)이다 — 단계 6');
    assert.equal(snap.policy.stances.King, 'hold', '손대지 않은 부대는 기본 — King 수성');
    assert.equal(snap.deploy, null, '북군 배치 프리셋이 없으면 null(기본 배치)');
  });

  it('북군 배치 프리셋을 싣는다 — 남군 것이 아니라', () => {
    const p = withGarrisons(fresh());
    const squad = garrisonOf(p, '3v3')!;
    assert.equal(GARRISON_SIDE, 'P2');
    const cells = defaultSquadCells('3v3', 'P2', squad.picks);
    const placed = { ...p, squads: p.squads.map((s) => (s.id === squad.id ? withDeployment(s, 'P2', cells) : s)) };
    const snap = garrisonSnapshot(placed, '3v3')!;
    assert.deepEqual(snap.deploy?.map((d) => d.unit).sort(), squad.picks.map((x) => `P2-${x.piece}`).sort());
    const southOnly = { ...p, squads: p.squads.map((s) => (s.id === squad.id ? withDeployment(s, 'P1', defaultSquadCells('3v3', 'P1', squad.picks)) : s)) };
    assert.equal(garrisonSnapshot(southOnly, '3v3')!.deploy, null);
  });
});

describe('보초병은 수비군에 들 수 없다', () => {
  it('보초병을 부대에 넣으면 농지에서 빠진다 — 그 부대가 수비군이 되어도 겹치지 않는다', () => {
    let p: PlayerProfile = { ...fresh(), buildings: { ...initialBuildings(), farm: 3 } };
    const king = Object.keys(p.roster).find((id) => id !== 'heon-je') as OfficerId;
    p = setGuards(p, [{ piece: 'King', officer: king }]);
    assert.deepEqual(guardsOf(p).map((g) => g.officer), [O(king)]);
    p = withGarrisons(p);
    const inGarrison = new Set<string>(['3v3', '5v5'].flatMap((m) => garrisonOf(p, m as '3v3')!.picks.map((x: RosterPick) => x.officer)));
    assert.ok(inGarrison.has(king), '보초병이던 장수가 수비군 부대에 들었다 — 아니면 이 검사는 아무것도 안 본다');
    // **저장된 칸**을 본다 — `guardsOf()`는 부대 장수를 어차피 걸러 내서 빼 가지 않아도 통과한다(CLAUDE.md 「농지」 교훈)
    assert.ok((p.farmGuards ?? []).every((g) => !inGarrison.has(g.officer)), '보초병 칸에 수비군 장수가 남았다');
  });
});
