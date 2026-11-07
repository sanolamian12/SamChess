/**
 * 일기토 연출 그림 회귀 (2026-11-06, `src/ui/duelScene.ts`)
 *
 * 고정하는 것:
 * - **상대 그림은 뒤집으면 뜻이 맞바뀐다** — 2 ↔ 3, 4 ↔ 5, 1 · 6은 그대로. 짝이 틀리면 「내가 몰아붙이는데 상대도 몰아붙이는」 그림이 된다
 * - 합의 장면은 엔진의 `holder`(그 합 **전**의 공격권자)로 읽는다 — 맞히면 그쪽이, 공격권이 넘어가면 반대쪽이 몰아붙인다
 * - 묶음 — 제 그림은 그 장수만, 노장 · 책사 공용, 나머지(도적 포함)는 디폴트. 화웅 · 원소는 디폴트, 사마의는 책사 (기획자)
 * - 설전 묶음은 따로다 — 책사 공용은 노숙 그림, 순욱도 그것(뽑아 보니 비슷비슷했다), 일기토 전용이어도 설전 그림이 없으면 디폴트 (기획자)
 * - 굽는 원본(`assets/duel/bg/{종류}/`)이 있으면 묶음마다 여섯 장이 다 있다 — 하나만 빠져도 그 장수의 그 장면만 조용히 404다
 */
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { OFFICERS } from '@samchess/data';
import { MIRROR, SCENE_FLASH, SCENE_SETS, sceneOfEnd, sceneOfRound, sceneSet, sceneUrls, type DuelScene } from '../src/ui/duelScene.ts';

const ALL: DuelScene[] = [1, 2, 3, 4, 5, 6];

test('뒤집은 상대 그림의 짝 — 2↔3 · 4↔5 · 1 · 6 그대로, 두 번 뒤집으면 제자리', () => {
  assert.deepEqual(ALL.map((n) => MIRROR[n]), [1, 3, 2, 5, 4, 6]);
  for (const n of ALL) assert.equal(MIRROR[MIRROR[n]], n);
});

test('합의 장면 — 맞히면 공격권자가, 공격권이 넘어가면 반대쪽이 몰아붙인다', () => {
  assert.equal(sceneOfRound('tie', true), 1);
  assert.equal(sceneOfRound('tie', false), 1);
  assert.equal(sceneOfRound('hit', true), 2, '내가 공격권을 쥐고 맞혔다');
  assert.equal(sceneOfRound('hit', false), 3, '상대가 공격권을 쥐고 맞혔다');
  assert.equal(sceneOfRound('turnover', false), 2, '상대에게서 공격권을 빼앗았다');
  assert.equal(sceneOfRound('turnover', true), 3, '내 공격권을 빼앗겼다');
});

test('끝 장면 — 이기면 5, 지면 4, 10합이면 6 · 섬광은 1 · 2 · 3만(1이 가장 크다)', () => {
  assert.equal(sceneOfEnd(true), 5);
  assert.equal(sceneOfEnd(false), 4);
  assert.equal(sceneOfEnd(null), 6);
  assert.deepEqual(Object.keys(SCENE_FLASH).map(Number).sort(), [1, 2, 3]);
  assert.ok(SCENE_FLASH[1]! > SCENE_FLASH[2]! && SCENE_FLASH[2] === SCENE_FLASH[3]);
});

test('묶음 — 제 그림 · 노장 · 책사 · 디폴트', () => {
  assert.equal(sceneSet('gwan-u'), 'gwan-u');
  assert.equal(sceneSet('jang-ryo'), 'jang-ryo');
  assert.equal(sceneSet('hwang-gae'), 'veteran');
  assert.equal(sceneSet('sa-ma-ui'), 'sage', '사마의는 접었다 → 책사');
  assert.equal(sceneSet('hwa-ung'), 'default', '화웅은 접었다 → 디폴트');
  assert.equal(sceneSet('won-so'), 'default', '원소는 디폴트(기획자)');
  assert.equal(sceneSet('bandit-1'), 'default', '명단 밖(도적)도 디폴트');
  // 묶음에 적은 id가 전부 진짜 장수다 — 철자가 틀리면 그 장수만 조용히 디폴트로 떨어진다
  const ids = new Set(OFFICERS.map((o) => o.id as string));
  for (const set of [...SCENE_SETS.duel, ...SCENE_SETS.debate]) if (!['default', 'sage', 'veteran'].includes(set)) assert.ok(ids.has(set), set);
  const shared = OFFICERS.filter((o) => ['sage', 'veteran'].includes(sceneSet(o.id))).length;
  assert.ok(shared > 90, `공용 묶음의 장수 ${shared}`);
});

test('설전 묶음 — 책사 공용 = 노숙 그림, 순욱도 노숙, 일기토 전용이어도 설전 그림이 없으면 디폴트', () => {
  assert.equal(sceneSet('no-suk', 'debate'), 'no-suk');
  assert.equal(sceneSet('sun-uk', 'debate'), 'no-suk', '순욱은 노숙 그림');
  assert.equal(sceneSet('seo-seo', 'debate'), 'no-suk', '책사 공용 → 노숙 그림');
  assert.equal(sceneSet('sa-ma-ui', 'debate'), 'sa-ma-ui', '사마의는 설전에서는 제 그림');
  assert.equal(sceneSet('yuk-son', 'debate'), 'yuk-son');
  assert.equal(sceneSet('yuk-son', 'duel'), 'default', '육손은 일기토에서는 디폴트');
  assert.equal(sceneSet('heo-jeo', 'debate'), 'default', '허저는 설전 그림이 없다');
  assert.equal(sceneSet('hwang-gae', 'debate'), 'veteran');
  assert.ok(!SCENE_SETS.debate.includes('sage') && !SCENE_SETS.debate.includes('sun-uk'));
});

test('그림 주소 — 왼쪽은 내 묶음의 n, 오른쪽은 상대 묶음의 짝 · 설전은 제 폴더', () => {
  assert.deepEqual(sceneUrls('duel', 2, 'gwan-u', 'yeo-po'), { left: 'duel/scene/gwan-u-2.jpg', right: 'duel/scene/yeo-po-3.jpg' });
  assert.deepEqual(sceneUrls('duel', 5, 'hwang-gae', 'u-geum'), { left: 'duel/scene/veteran-5.jpg', right: 'duel/scene/default-4.jpg' });
  assert.deepEqual(sceneUrls('debate', 4, 'sun-uk', 'heo-jeo'), { left: 'duel/scene/debate/no-suk-4.jpg', right: 'duel/scene/debate/default-5.jpg' });
});

for (const kind of ['duel', 'debate'] as const) {
  test(`원본이 있으면 묶음마다 여섯 장 — ${kind} (assets/는 git에 없다 — 없으면 건너뛴다)`, (t) => {
    const dir = new URL(`../../../assets/duel/bg/${kind}/`, import.meta.url);
    if (!existsSync(dir)) { t.skip(`assets/duel/bg/${kind} 없음`); return; }
    const missing = SCENE_SETS[kind].flatMap((s) => ALL.map((n) => `${kind}_${s}_${n}.png.jpg`)).filter((f) => !existsSync(new URL(f, dir)));
    assert.deepEqual(missing, []);
  });
}
