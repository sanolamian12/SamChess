/**
 * 관리자 계정 상세의 진행 상태 회귀 (2026-10-31, `src/admin.ts`의 `adminPlayStatus`).
 *
 * 여기서 고정하는 것.
 *  - **출정 막힘은 게임과 같은 순서로** — 튜토리얼 → 수비군 → 도적떼(`sortieGate`), 열리면 `null`
 *  - **기본 셋은 차례대로 한 줄씩** — 끝낸 순서와 상관없이
 *  - **수비군은 「고른 부대」와 「저절로 선 첫 부대」를 가른다** · 부대가 없으면 `squad: null`
 *  - **방침은 고친 탭만** — 손대지 않은 부대는 빈 배열(기본을 그때그때 낸다)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addSquad, adminPlayStatus, createProfile, squadsOf } from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';
import type { OfficerId, PieceType } from '@samchess/rules';
import { withGarrisons } from './fixtures.ts';

const fresh = (): PlayerProfile => createProfile('진행시험', 7);
const basicsDone = (p: PlayerProfile): PlayerProfile => ({ ...p, tutorial: { done: ['basic-3', 'basic-1', 'basic-2'] } });

describe('adminPlayStatus', () => {
  it('새 계정 — 튜토리얼이 먼저 막고, 수비군은 없다', () => {
    const s = adminPlayStatus(fresh());
    assert.equal(s.sortie?.code, 'tutorial.required');
    assert.deepEqual(s.tutorial.basics, [
      { id: 'basic-1', done: false }, { id: 'basic-2', done: false }, { id: 'basic-3', done: false },
    ]);
    assert.equal(s.tutorial.sDone, 0);
    assert.equal(s.tutorial.sTotal, 30);
    assert.deepEqual(s.garrisons.map((g) => [g.mode, g.squad]), [['3v3', null], ['5v5', null]]);
  });

  it('기본 셋을 끝내면 다음은 수비군 — 5v5만 없으면 그 모드로 막힌다', () => {
    let p = withGarrisons(basicsDone(fresh()));
    const five = squadsOf(p, '5v5')[0]!;
    p = { ...p, squads: p.squads.filter((s) => s.id !== five.id) };
    const s = adminPlayStatus(p);
    assert.ok(s.tutorial.basics.every((b) => b.done), '끝낸 순서가 달라도 차례대로 다 끝남');
    assert.equal(s.sortie?.code, 'sortie.noGarrison');
    assert.equal(s.garrisons[1]!.squad, null);
  });

  it('두 모드 수비군이 서면 열린다 — 고르지 않은 부대는 저절로 선 것', () => {
    const s = adminPlayStatus(withGarrisons(basicsDone(fresh())));
    assert.equal(s.sortie, null);
    for (const g of s.garrisons) {
      assert.ok(g.squad);
      assert.equal(g.picked, false);
      assert.deepEqual(g.customPolicy, []);
    }
  });

  it('고른 부대 · 고친 방침 탭', () => {
    let p = withGarrisons(basicsDone(fresh()));
    const ids = Object.keys(p.roster) as OfficerId[];
    const pieces: PieceType[] = ['King', 'Rock', 'Bishop'];
    const made = addSquad(p, { name: '둘째', mode: '3v3', picks: pieces.map((piece, i) => ({ piece, officer: ids[i]! })) });
    p = made.profile;
    const second = p.squads.find((s) => s.name === '둘째')!;
    p = {
      ...p,
      garrison: { '3v3': second.id },
      squads: p.squads.map((s) => (s.id === second.id ? { ...s, policy: { stances: { Rock: 'escort' }, skills: [] } } : s)),
    };
    const g = adminPlayStatus(p).garrisons[0]!;
    assert.deepEqual(g.squad, { id: second.id, name: '둘째' });
    assert.equal(g.picked, true);
    assert.deepEqual(g.customPolicy, ['stances', 'skills'], '빈 배열도 「사람이 비웠다」 — 기본이 아니다');
  });
});
