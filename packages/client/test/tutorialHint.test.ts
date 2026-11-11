/**
 * 튜토리얼 금빛 깜빡임 회귀 (2026-11-11 기획자, `CommandFlow.hint`) — **깜빡이는 곳만 눌러도 기본 튜토리얼 세 판을 이긴다.**
 *
 * 화면(`TutorialBattleScreen`)이 대본의 단계마다 거는 잠금을 그대로 걸고, 흐름이 가리키는 곳(명령 단추 · 목록 줄 · 칸 ·
 * 장수 · [확인])만 눌러 판을 끝까지 민다. 가리키는 곳이 없거나 눌러도 걸음이 안 나아가면 떨어진다 — 「깜빡임이 엉뚱한 곳에
 * 붙었다」와 「깜빡임이 끊겼다」를 함께 잡는다. 켠 명령이 여럿인 차례(스스로 해 보는 차례)와 안내 창이 떠 있는 동안(빈 잠금)은
 * **깜빡이지 않는다**(기획자 확정) — 그 차례는 회귀의 손(칠 수 있으면 치고, 아니면 넘긴다)이 둔다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advanceTime, apply, controllingSide, createBattle, legalMovesFor, legalTargetsFor,
} from '@samchess/rules';
import type { BattleState, Intent, UnitId, Vec2 } from '@samchess/rules';
import { BASIC_TUTORIALS, TUTORIAL_HUMAN_SIDE, scenesOf, tutorialEnemyTurn, tutorialStages } from '@samchess/meta';
import type { GuidePhase, TutorialStage } from '@samchess/meta';
import { CommandFlow } from '../src/ui/commandFlow.ts';
import type { Hint } from '../src/ui/commandFlow.ts';

const ME = TUTORIAL_HUMAN_SIDE;
const act = (s: BattleState, intent: Intent): BattleState => apply(s, ME, intent).state;
const turnKey = (s: BattleState): string => `${s.activeUnit}|${s.time}`;

function untilHuman(s: BattleState, stage: TutorialStage): BattleState {
  for (let guard = 0; guard < 500; guard++) {
    if (s.phase === 'finished') return s;
    if (s.phase === 'running') { s = advanceTime(s).state; continue; }
    if (controllingSide(s, s.units[s.activeUnit!]!) === ME) return s;
    s = tutorialEnemyTurn(stage)(s).state;
  }
  throw new Error('사람 차례가 오지 않는다');
}

/** 깜빡이지 않는 차례 — 칠 수 있으면(필요하면 다가가서) HP가 가장 낮은 적을, 아니면 넘긴다 */
function freeTurn(s: BattleState): BattleState {
  const me = s.activeUnit!;
  const weakest = (st: BattleState, ts: readonly UnitId[]): UnitId => [...ts].sort((a, b) => st.units[a]!.hp - st.units[b]!.hp || a.localeCompare(b))[0]!;
  const direct = legalTargetsFor(s, me);
  if (direct.length) return act(s, { t: 'attack', targets: [weakest(s, direct)] });
  if (!s.activeTurn?.moved) {
    const to = legalMovesFor(s, me).find((p) => legalTargetsFor(act(s, { t: 'move', to: p }), me).length > 0);
    if (to) {
      const moved = act(s, { t: 'move', to });
      return act(moved, { t: 'attack', targets: [weakest(moved, legalTargetsFor(moved, me))] });
    }
  }
  return act(s, { t: 'endTurn' });
}

const unitAt = (s: BattleState, p: Vec2): UnitId | null =>
  (Object.values(s.units).find((u) => u.alive && u.pos.x === p.x && u.pos.y === p.y)?.id ?? null) as UnitId | null;

/** 깜빡이는 곳을 누른다 — 화면의 단추 · 판 클릭이 부르는 흐름의 함수 그대로. 의도가 나오면 돌려준다 */
function press(flow: CommandFlow, s: BattleState, h: Hint): Intent | null {
  switch (h.at) {
    case 'command': flow.press(h.cmd, s, ME); return null;
    case 'unique': return flow.useUnique(s, ME);
    case 'bitter': flow.answerBitter(h.yes); return null;
    case 'tactic': flow.pickTactic(s, ME, h.id); return null;
    case 'item': flow.pickItem(s, ME); return null;
    case 'cell': assert.ok(flow.pickCell(s, ME, h.cell, unitAt(s, h.cell)).handled, `칸 ${h.cell.x},${h.cell.y}이 안 눌린다`); return null;
    case 'unit': assert.ok(flow.pickCell(s, ME, s.units[h.unit]!.pos, h.unit).handled, `${h.unit}이 안 눌린다`); return null;
    case 'commit': return flow.commit();
  }
}

function phaseDone(s: BattleState, phase: GuidePhase, key: string): boolean {
  if (s.phase === 'finished' || turnKey(s) !== key) return true;
  if (phase.until === 'moved') return !!s.activeTurn?.moved;
  if (phase.until === 'skill') return !!s.activeTurn?.usedUniqueSkill;
  return false;
}

/** 판 하나를 깜빡임만 따라 끝까지. 깜빡임을 몇 번 눌렀는지도 센다 */
function followGlow(stage: TutorialStage): { end: BattleState; pressed: Hint['at'][] } {
  assert.equal(scenesOf(stage).length, 0, '기본 판에는 판 도중의 장면이 없다(있으면 이 회귀가 장면을 내야 한다)');
  const flow = new CommandFlow();
  const pressed: Hint['at'][] = [];
  let s = untilHuman(createBattle(stage.config), stage);
  for (let turn = 0; turn < 40 && s.phase !== 'finished'; turn++) {
    const script = stage.guide[turn];
    const key = turnKey(s);
    flow.sync(s);
    // 안내 창이 떠 있는 동안 — 빈 잠금, 깜빡이지 않는다
    flow.setLimit({ allow: new Set() });
    assert.equal(flow.hint(s, ME), null, '안내 창이 떠 있는 동안 깜빡였다');
    for (const phase of script?.phases ?? []) {
      if (phaseDone(s, phase, key)) break;
      flow.setLimit({ allow: new Set(phase.allow), moveTo: phase.moveTo, target: phase.target, bitter: phase.bitter });
      if (phase.allow.length > 1) {
        assert.equal(flow.hint(s, ME), null, '켠 명령이 여럿인 차례에 깜빡였다');
        s = freeTurn(s);
        break;
      }
      for (let click = 0; !phaseDone(s, phase, key); click++) {
        assert.ok(click < 12, `${stage.lesson} ${turn + 1}번째 차례 — 깜빡임을 따라도 단계가 안 끝난다`);
        flow.sync(s);
        flow.autoWait(s, ME);
        const h = flow.hint(s, ME);
        assert.ok(h, `${stage.lesson} ${turn + 1}번째 차례 [${phase.allow}] — 걸음 ${flow.step.k}에서 깜빡일 곳이 없다`);
        pressed.push(h.at);
        const intent = press(flow, s, h);
        if (intent) s = act(s, intent);
      }
    }
    // 대본이 끝난 차례 — 잠금이 풀린다, 깜빡이지 않는다
    if (s.phase === 'control' && turnKey(s) === key) {
      flow.sync(s);
      flow.setLimit(null);
      assert.equal(flow.hint(s, ME), null, '잠금이 없는데 깜빡였다');
      s = freeTurn(s);
    }
    s = untilHuman(s, stage);
  }
  return { end: s, pressed };
}

describe('기본 튜토리얼 — 깜빡이는 곳만 눌러도 이긴다', () => {
  for (const id of BASIC_TUTORIALS) {
    for (const stage of tutorialStages(id)) {
      it(stage.lesson, () => {
        const { end, pressed } = followGlow(stage);
        assert.equal(end.phase, 'finished');
        assert.equal(end.winner, 'P1');
        assert.ok(pressed.includes('commit'), '확인 단추를 가리킨 적이 있다');
      });
    }
  }

  it('기본 1 — [이동] → 칸 → [확정] → 적 → [확인] 순서로 가리킨다', () => {
    const { pressed } = followGlow(tutorialStages('basic-1')[0]!);
    // 이동한 뒤 칠 적이 닿으면 흐름이 [공격]을 미리 연다(`autoWait`) — 그래서 [공격] 단추는 안 가리킨다
    assert.deepEqual(pressed, ['command', 'cell', 'commit', 'unit', 'commit']);
  });

  it('기본 2 — 책략 줄 · 아이템 줄도 가리킨다', () => {
    const { pressed } = followGlow(tutorialStages('basic-2')[0]!);
    assert.ok(pressed.includes('tactic'));
    assert.ok(pressed.includes('item'));
  });

  it('기본 3 — 고유기술 물음의 [사용]을 가리킨다', () => {
    const { pressed } = followGlow(tutorialStages('basic-3')[0]!);
    assert.ok(pressed.includes('unique'));
  });
});
