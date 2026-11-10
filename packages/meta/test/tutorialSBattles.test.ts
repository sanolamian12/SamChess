/**
 * S급 튜토리얼 판 — **대본 그대로 두면 이긴다** · 그 장수의 고유기술이 판의 고비에서 실제로 돈다 (`tutorialSBattles.ts`)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OFFICERS } from '@samchess/data';
import type { BattleState, UnitId } from '@samchess/rules';
import { ROUT_REASON, S_TUTORIAL_OFFICERS, finaleOfficers, isSay, sTutorialId, stageLines, tutorialReady, tutorialStages } from '../src/index.ts';
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

  it('대사(2026-10-26)는 판에 선 장수 · 끝 장면에 나타나는 적 · 목소리만 내는 아군이 한다 — 진영은 판이 정하고, 판에 없으면 적는다', () => {
    let said = 0;
    for (const officer of ready) {
      for (const st of tutorialStages(sTutorialId(officer))) {
        const onBoard = new Set([...st.config.rosters.P1, ...st.config.rosters.P2].map((r) => r.officer as string));
        const appear = new Set(finaleOfficers(st.finale).map((o) => o as string));
        const lines = stageLines(st);
        for (const line of lines) {
          if (!isSay(line)) continue;
          said++;
          assert.ok(OFFICERS.some((o) => o.id === line.by), `${officer}: 명단 밖 화자 ${line.by}`);
          if (onBoard.has(line.by)) assert.equal(line.foe, undefined, `${officer}: 판에 선 ${line.by}에 foe를 적었다 — 진영은 판이 정한다`);
          // 판에 없으면 진영을 적는다 — 적은 끝 장면에 나타나는 장수만, 아군은 목소리만(강유 판의 왕평, 2026-10-27)
          else assert.ok(line.foe === false || (line.foe === true && appear.has(line.by)), `${officer}: 판에 없는 화자 ${line.by}`);
        }
      }
    }
    assert.ok(said >= ready.length * 3, `대사 ${said}장 — 판마다 셋은 넘는다`);
  });

  // 판마다 — 대본대로 두면 이기고, 그 장수가 **자기 고유기술을 실제로 쓴다**(고유기술을 써 보는 판이다).
  // 판이 둘 이상이면(서서 — 팔문금쇄진 → 위조 편지, 2026-11-02) 고유기술은 그중 한 판에서 쓰면 된다
  for (const officer of ready) {
    it(`${officer} — 대본대로 두면 이기고 그 장수가 고유기술을 쓴다`, () => {
      let cast = 0;
      for (const st of tutorialStages(sTutorialId(officer))) {
        const end = play(st);
        assert.deepEqual([end.phase, end.winner], ['finished', 'P1'], `${officer} — ${end.outcome}`);
        const me = Object.values(end.units).find((u) => u.side === 'P1' && u.officer === officer)!;
        if (end.log.some((e) => e.e === 'uniqueSkillCast' && e.unit === me.id)) cast++;
      }
      assert.ok(cast > 0, `${officer}가 고유기술을 안 썼다`);
    });
  }

  it('판이 없는 S급은 「준비 중」이고 판을 부르면 던진다', () => {
    const notYet = S_TUTORIAL_OFFICERS.find((o) => !tutorialReady(sTutorialId(o)));
    if (!notYet) return;
    assert.throws(() => tutorialStages(sTutorialId(notYet)), /아직 판이 없다/);
  });
});

describe('서서 — 팔문금쇄진 → 위조 편지 (두 판, 2026-11-02)', () => {
  const [gate, letter] = tutorialStages(sTutorialId(U('seo-seo') as never));

  it('첫 판 — 조운이 생문에 서면 진이 무너져(불길 없이) 조인 · 이전이 반피가 되고, 한 대씩에 쓰러진다', () => {
    let routed = false;
    const end = play(gate!, (s, turn) => {
      if (turn !== 1) return;
      routed = s.log.some((e) => e.e === 'hpChanged' && e.reason === ROUT_REASON);
      for (const id of ['P2-Queen', 'P2-Rock']) assert.equal(s.units[U(id)]!.hp, s.units[U(id)]!.maxHp / 2, `${id} 반피`);
    });
    assert.ok(routed, '무너짐 장면이 돌았다');
    assert.deepEqual([end.winner, end.outcome], ['P1', 'wipeOut']);
    assert.equal(end.log.filter((e) => e.e === 'attacked').length, 2, '조운이 두 번 쳐서 끝난다');
    assert.ok(!end.log.some((e) => e.e === 'uniqueSkillCast'), '첫 판에서는 서서의 기술을 안 쓴다');
  });

  it('둘째 판 — 서서가 끌려간 뒤 기술을 쓰고, 그 전에 적이 책략을 걸 틈이 없다', () => {
    const end = play(letter!);
    assert.deepEqual([end.winner, end.outcome], ['P1', 'kingDown']);
    const cast = end.log.findIndex((e) => e.e === 'uniqueSkillCast' && e.unit === U('P1-Pawn'));
    const moved = end.log.findIndex((e) => e.e === 'moved' && e.unit === U('P1-Pawn'));
    assert.ok(moved >= 0 && moved < cast, '끌려간 뒤에 쓴다');
    assert.ok(!end.log.some((e) => e.e === 'tacticCast'), '책략은 한 번도 안 걸린다');
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
