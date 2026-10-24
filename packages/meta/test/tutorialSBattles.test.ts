/**
 * S급 튜토리얼 판 — **대본 그대로 두면 이긴다** · 그 장수의 고유기술이 판의 고비에서 실제로 돈다 (`tutorialSBattles.ts`)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OFFICERS } from '@samchess/data';
import type { BattleState, UnitId } from '@samchess/rules';
import { S_TUTORIAL_OFFICERS, sTutorialId, tutorialReady, tutorialStages } from '../src/index.ts';
import { play } from './tutorialPlay.ts';

const U = (id: string): UnitId => id as UnitId;
const events = (s: BattleState, e: string): number => s.log.filter((x) => x.e === e).length;

describe('S급 판 — 공통', () => {
  const ready = S_TUTORIAL_OFFICERS.filter((o) => tutorialReady(sTutorialId(o)));

  it('선 판은 전부 25 × 15 · 제 지도 · 그 S급이 사람 진영에 선다', () => {
    assert.ok(ready.length >= 2);
    for (const officer of ready) {
      const [st] = tutorialStages(sTutorialId(officer));
      assert.deepEqual(st!.config.setup!.board, { x: 25, y: 15 }, officer);
      assert.equal(st!.map, officer);
      assert.ok(st!.config.rosters.P1.some((r) => r.officer === officer), `${officer}가 아군에 없다`);
      for (const side of ['P1', 'P2'] as const) {
        for (const r of st!.config.rosters[side]) assert.ok(OFFICERS.some((o) => o.id === r.officer), `명단 밖 장수 ${r.officer}`);
      }
    }
  });

  it('판이 없는 S급은 「준비 중」이고 판을 부르면 던진다', () => {
    const notYet = S_TUTORIAL_OFFICERS.find((o) => !tutorialReady(sTutorialId(o)));
    if (!notYet) return;
    assert.throws(() => tutorialStages(sTutorialId(notYet)), /아직 판이 없다/);
  });
});

describe('조조 — 청매자주 영웅론 (유비 1:1)', () => {
  const [stage] = tutorialStages(sTutorialId(U('jo-jo') as never));

  it('유비가 먼저 삼고초려를 건다 → 조조의 영웅론이 시전을 무산시키고 봉인한다 → 유비를 쓰러뜨린다', () => {
    let castingSeen = false;
    const end = play(stage!, (s, turn) => {
      if (turn === 0) castingSeen = s.units[U('P2-King')]!.casting === 'sam-go-cho-ryeo';
    });
    assert.ok(castingSeen, '조조의 첫 차례에 유비가 삼고초려를 시전 중이다');
    assert.equal(events(end, 'uniqueSkillFizzled'), 1, '영웅론이 시전을 무산시켰다');
    assert.ok(end.units[U('P2-King')]!.statuses.some((x) => x.status === 'skillSealed') || !end.units[U('P2-King')]!.alive);
    assert.deepEqual([end.phase, end.winner], ['finished', 'P1']);
    assert.ok(!end.units[U('P1-King')]!.control, '조조는 끝까지 제 손에 있다');
  });
});

describe('여포 — 호로관', () => {
  const [stage] = tutorialStages(sTutorialId(U('yeo-po') as never));

  it('기술 → 연합군 진영 한복판으로 뛰어들어 친다 → 장비가 절반 닳는 순간 끝난다(쓰러뜨리지 않는다)', () => {
    const end = play(stage!);
    const leap = end.log.find((x) => x.e === 'moved' && x.unit === U('P1-King'));
    assert.deepEqual(leap && leap.e === 'moved' ? leap.to : null, { x: 12, y: 4 }, '첫 이동이 연합군 진영 한복판');
    assert.deepEqual([end.phase, end.winner, end.outcome], ['finished', 'P1', 'objective']);
    const jb = end.units[U('P2-Queen')]!;
    assert.ok(jb.alive && jb.hp * 2 <= jb.maxHp, `장비는 살아 있고 절반 이하 (HP ${jb.hp}/${jb.maxHp})`);
    const me = end.units[U('P1-King')]!;
    assert.ok(me.alive && me.hp * 4 >= me.maxHp, `여포는 넉넉히 산다 (HP ${me.hp}/${me.maxHp})`);
    assert.deepEqual(['P2-Rock', 'P2-Bishop', 'P2-Knight'].filter((u) => end.units[U(u)]!.alive), [], '연합군 장수 셋을 다 물리쳤다');
    assert.ok(stage!.finale?.appear.some((a) => a.officer === 'yu-bi') && stage!.finale.appear.some((a) => a.officer === 'gwan-u'));
  });
});
