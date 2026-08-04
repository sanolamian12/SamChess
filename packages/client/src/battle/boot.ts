/**
 * 전투 부팅 — Phaser 게임을 띄우고 내린다.
 *
 * 예전에는 진입점(`main.ts`)이 직접 했지만, 이제 메타 화면에서 전투로 들어왔다가
 * 결과 화면으로 빠져나가야 하므로 **켜고 끌 수 있는 형태**가 필요하다.
 *
 * 전투가 끝나면 `onFinish`로 마지막 상태를 넘긴다. 보상 계산에 필요한 것
 * (누가 이겼나 · 누가 몇을 잡았나)은 전부 그 상태와 로그에서 나온다 —
 * 화면이 따로 세지 않는다.
 */

import Phaser from 'phaser';
import { STATUS_META } from '@samchess/rules';
import type { BattleState, Side, UnitId } from '@samchess/rules';
import { BattleScene } from './BattleScene.ts';
import { Playback } from './playback.ts';

export interface BattleHandle {
  game: Phaser.Game;
  destroy(): void;
}

export function bootBattle(opts: {
  initial: BattleState;
  humanSide: Side | null;
  onFinish?: (state: BattleState) => void;
}): BattleHandle {
  const scene = new BattleScene(
    (self) => new Playback(opts.initial, opts.humanSide, {
      onChange: (state, events) => self.onStateChanged(state, events),
      onTick: () => {},
    }),
    opts.onFinish,
  );

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'app',
    backgroundColor: '#15171b',
    // 판은 프레임 안의 정사각 칸을 그대로 채운다. 크기는 CSS가 정하고 여기서는 따라간다.
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene,
  });
  game.registry.set('officerIds', [...new Set(Object.values(opts.initial.units).map((u) => u.officer as string))]);

  // 테스트 하네스(Playwright)가 상태를 들여다볼 통로. 스크린샷만으로는
  // "클릭이 실제 Intent로 이어졌는가"를 볼 수 없다.
  (window as unknown as Record<string, unknown>).__battle = {
    game,
    get scene() { return game.scene.getScene('battle') as BattleScene | null; },
    // 배지가 센 버프/디버프 개수를 검증하려면 테스트도 **같은 분류표**를 봐야 한다.
    // 목록을 테스트에 다시 적으면 둘이 어긋나도 통과해 버린다.
    statusMeta: STATUS_META,
  };

  return {
    game,
    destroy: () => {
      delete (window as unknown as Record<string, unknown>).__battle;
      game.destroy(true);
    },
  };
}

/**
 * 로그에서 장수별 처치 수를 센다 (GDD §7 랭킹 지표).
 *
 * `unitDied`에는 누가 잡았는지가 없다. 대신 **그 유닛을 겨눈 가장 최근 `attacked`**를
 * 가해자로 본다 — 도트·지형으로 죽으면 아무에게도 세지 않는다. 이벤트에 없는 것을
 * 억지로 만들어 내기보다, 셀 수 있는 것만 세는 편이 낫다.
 */
export function countKills(state: BattleState, side: Side): Record<string, number> {
  const lastAttacker = new Map<string, string>();
  const kills: Record<string, number> = {};

  for (const ev of state.log) {
    if (ev.e === 'attacked') lastAttacker.set(ev.target, ev.unit);
    else if (ev.e === 'unitDied') {
      const killer = lastAttacker.get(ev.unit) as UnitId | undefined;
      const unit = killer ? state.units[killer] : undefined;
      const victim = state.units[ev.unit];
      // 같은 편을 친 경우(조종당한 유닛 등)는 세지 않는다
      if (!unit || !victim || unit.side !== side || victim.side === side) continue;
      const officer = unit.officer as string;
      kills[officer] = (kills[officer] ?? 0) + 1;
    }
  }
  return kills;
}
