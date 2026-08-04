/**
 * 클라이언트 진입점 — 게임 프레임을 잡고 Phaser를 띄운다.
 *
 * URL 쿼리로 판을 바꿀 수 있다:
 *   ?seed=42&mode=5v5&side=P2   조작할 진영
 *   ?auto=1                     양쪽 다 AI (관전) — 전투가 끝까지 굴러가는지 볼 때
 *   ?sp=15                      시작 SP — 고유기술을 기다리지 않고 바로 확인할 때
 *
 * 시드가 같으면 완전히 같은 판이 나오므로 화면 회귀 확인에 쓴다.
 */

import Phaser from 'phaser';
import { STATUS_META } from '@samchess/rules';
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

/**
 * 글자 크기를 프레임 폭에 맞춘다.
 *
 * 프레임은 화면에 따라 320px(작은 폰)에서 700px(세로 모니터)까지 변하는데, 글자 크기가
 * 고정이면 좁은 화면에서 커맨드가 줄바꿈되고 넓은 화면에서는 허전해진다.
 * 스타일시트는 전부 `rem`으로 적혀 있고, 그 기준을 여기서 한 번에 준다.
 */
function fitFrame(): void {
  const frame = document.getElementById('frame')!;
  const width = frame.getBoundingClientRect().width;
  // 프레임 폭의 1/26 — 400px 프레임에서 15.4px. 너무 작아지지 않게 바닥을 둔다.
  document.documentElement.style.fontSize = `${Math.max(11, width / 26)}px`;
  // 체스판 가로 폭 = 프레임 폭. 하단 패널의 수묵화가 "판 가로의 절반"을 넘지 않도록
  // 재는 기준이라 CSS에 넘겨 준다 (rem은 글자 기준이라 이 제한을 표현할 수 없다).
  document.documentElement.style.setProperty('--board', `${width}px`);
}
fitFrame();
new ResizeObserver(fitFrame).observe(document.getElementById('frame')!);

const scene = new BattleScene((self) => new Playback(initial, humanSide, {
  onChange: (state, events) => self.onStateChanged(state, events),
  onTick: () => {},
}));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#15171b',
  // 판은 프레임 안의 정사각 칸을 그대로 채운다. 크기는 CSS가 정하고 여기서는 따라간다.
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene,
});
game.registry.set('officerIds', officerIdsOf(initial));

// 테스트 하네스(Playwright)가 상태를 들여다볼 수 있도록 노출한다.
// 화면 확인은 스크린샷만으로는 부족하다 — 클릭이 실제 Intent로 이어졌는지는 상태로 봐야 한다.
(window as unknown as Record<string, unknown>).__battle = {
  game,
  get scene() { return game.scene.getScene('battle') as BattleScene | null; },
  // 배지가 센 버프/디버프 개수를 검증하려면 테스트도 **같은 분류표**를 봐야 한다.
  // 목록을 테스트에 다시 적으면 둘이 어긋나도 통과해 버린다.
  statusMeta: STATUS_META,
};
