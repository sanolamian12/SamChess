/**
 * 수비군 (2026-10-27, `garrison.ts` · GDD §8.8 단계 1 · 2026-11-14 부대 개편).
 *
 * 여기서 고정하는 것 다섯.
 *  - **수비대 칸이 곧 수비군**이다 — 공격대는 수비군이 아니고, 수비대가 성립하지 않으면(장수가 빠졌다) 수비군이 없다
 *  - **두 모드 모두 서야 출정**한다 — 모자란 모드의 인원이 이유에 실린다. 수비대를 비우면 다시 잠긴다
 *  - **스냅샷**은 시각 없는 전투력 · 북군 배치 프리셋 · 기본 방침 · 부대 이름은 도시 이름
 *  - **보초병은 수비군에 들 수 없다** — 부대에 넣는 순간 농지에서 빠진다
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OfficerId } from '@samchess/rules';
import {
  SORTIE_TUTORIALS, GARRISON_SIDE, addSquad, battlePower, clearSquad, createProfile, defaultSquadCells, garrisonGate, garrisonOf,
  garrisonSnapshot, guardsOf, initialBuildings, isGarrison, setGuards, squadAt, squadSlot,
  resolvePolicy, sortieGate, toRosterEntries, withDeployment,
} from '../src/index.ts';
import type { PlayerProfile, RosterPick } from '../src/index.ts';
import { withGarrisons } from './fixtures.ts';

const O = (id: string): OfficerId => id as OfficerId;

/** 기본 셋을 끝냈고 부대는 없는 계정 */
const fresh = (): PlayerProfile => ({ ...createProfile('수비성', 11), tutorial: { done: [...SORTIE_TUTORIALS] } });

describe('수비군 — 수비대 칸이 곧 수비군', () => {
  it('부대가 없으면 없다', () => {
    assert.equal(garrisonOf(fresh(), '3v3'), null);
    assert.equal(garrisonOf(fresh(), '5v5'), null);
  });

  it('수비대가 수비군이고 공격대는 아니다 — 모드마다 따로', () => {
    const p = withGarrisons(fresh());
    assert.equal(garrisonOf(p, '3v3')?.id, squadSlot('3v3', 'defense'));
    assert.equal(garrisonOf(p, '5v5')?.id, 'def-5v5');
    assert.ok(isGarrison(p, squadAt(p, '3v3', 'defense')!));
    assert.ok(!isGarrison(p, squadAt(p, '3v3', 'attack')!));
  });

  it('공격대만 있으면 수비군이 없다 — 공격대로 물러나지 않는다', () => {
    const p = withGarrisons(fresh());
    const onlyAttack = clearSquad(p, 'def-3v3');
    assert.equal(garrisonOf(onlyAttack, '3v3'), null);
    assert.equal(garrisonOf(onlyAttack, '5v5')?.id, 'def-5v5', '다른 모드는 그대로');
  });

  it('수비대가 성립하지 않게 되면(장수가 계정에서 빠졌다) 수비군이 없다', () => {
    const p = withGarrisons(fresh());
    const lost = squadAt(p, '3v3', 'defense')!.picks[1]!.officer;
    const { [lost]: _gone, ...roster } = p.roster;
    assert.equal(garrisonOf({ ...p, roster }, '3v3'), null);
  });
});

describe('출정 조건 — 두 모드 모두 수비군이 서야 한다', () => {
  it('3v3이 먼저, 그다음 5v5 — 모자란 모드의 인원이 실린다', () => {
    const none = garrisonGate(fresh());
    assert.deepEqual(!none.ok && [none.code, none.params], ['sortie.noGarrison', { size: 3 }]);
    const p = fresh();
    const picks = squadAt(withGarrisons(p), '3v3', 'defense')!.picks;
    const three = addSquad(p, { mode: '3v3', role: 'defense', picks }).profile;
    const onlyThree = garrisonGate(three);
    assert.deepEqual(!onlyThree.ok && [onlyThree.code, onlyThree.params], ['sortie.noGarrison', { size: 5 }]);
    assert.deepEqual(garrisonGate(withGarrisons(fresh())), { ok: true });
    assert.deepEqual(sortieGate(withGarrisons(fresh())), { ok: true });
  });

  it('공격대만 채우면 잠겨 있다 · 수비대를 비우면 다시 잠긴다', () => {
    const p = fresh();
    const picks = squadAt(withGarrisons(p), '3v3', 'attack')!.picks;
    const attackOnly = addSquad(p, { mode: '3v3', role: 'attack', picks }).profile;
    assert.equal(garrisonGate(attackOnly).ok, false);
    const cleared = garrisonGate(clearSquad(withGarrisons(fresh()), 'def-5v5'));
    assert.deepEqual(!cleared.ok && cleared.params, { size: 5 });
  });
});

describe('스냅샷 — 공성전의 상대가 이 값으로 선다', () => {
  it('시각 없는 명단 · 전투력, 기본 방침', () => {
    const p = withGarrisons(fresh());
    const squad = garrisonOf(p, '5v5')!;
    const snap = garrisonSnapshot(p, '5v5')!;
    const entries = toRosterEntries(p, squad.picks);
    assert.equal(snap.squadId, squad.id);
    assert.equal(snap.squadName, p.cityName, '남에게 보이는 부대 이름은 도시 이름이다(아이디가 곧 부대명, 2026-11-14)');
    assert.deepEqual(snap.entries, entries);
    assert.equal(snap.power, battlePower('5v5', entries));
    assert.deepEqual(snap.policy, resolvePolicy(p, squad), '방침은 판에 싣는 값(풀린 것)이다 — 단계 6');
    assert.equal(snap.policy.stances.King, 'hold', '손대지 않은 부대는 기본 — King 수성');
    // 북군 배치 프리셋이 없으면 부대의 기본 배치(King 가운데, 2026-11-18) — 엔진의 기본 배치가 아니다
    assert.deepEqual(snap.deploy, defaultSquadCells('5v5', 'P2', squad.picks).map((c) => ({ unit: `P2-${c.piece}`, pos: { x: c.x, y: c.y } })));
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
    assert.deepEqual(garrisonSnapshot(southOnly, '3v3')!.deploy?.map((d) => d.pos.y), [2, 2, 2], '남군 것만 있으면 북군은 기본 배치');
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
