/**
 * 클라이언트 진입점 — Phaser를 띄우고 전투 씬을 건다.
 *
 * URL 쿼리로 판을 바꿀 수 있다:
 *   ?seed=42&mode=5v5&side=P2   조작할 진영
 *   ?auto=1                     양쪽 다 AI (관전) — 전투가 끝까지 굴러가는지 볼 때
 *   ?sp=15                      시작 SP — 고유기술을 기다리지 않고 바로 확인할 때
 *
 * 시드가 같으면 완전히 같은 판이 나오므로 화면 회귀 확인에 쓴다.
 */

import Phaser from 'phaser';
import type { Side } from '@samchess/rules';
import { BattleScene } from './battle/BattleScene.ts';
import { Playback } from './battle/playback.ts';
import { createDemoBattle, officerIdsOf } from './battle/setup.ts';
import './style.css';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1);
const mode = (params.get('mode') ?? '3v3') as '1v1' | '3v3' | '5v5';
const humanSide = params.get('auto') ? null : ((params.get('side') ?? 'P1') as Side);

const sp = params.get('sp');
const initial = createDemoBattle(seed, mode, sp === null ? {} : { sp: Number(sp) });

const scene = new BattleScene((self) => new Playback(initial, humanSide, {
  onChange: (state) => self.onStateChanged(state),
  onTick: () => {},
}));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#15171b',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene,
});
game.registry.set('officerIds', officerIdsOf(initial));

// 테스트 하네스(Playwright)가 상태를 들여다볼 수 있도록 노출한다.
// 화면 확인은 스크린샷만으로는 부족하다 — 클릭이 실제 Intent로 이어졌는지는 상태로 봐야 한다.
(window as unknown as Record<string, unknown>).__battle = {
  game,
  get scene() { return game.scene.getScene('battle') as BattleScene | null; },
};
