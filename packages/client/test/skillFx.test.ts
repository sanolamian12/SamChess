/**
 * 고유기술 두루마리 연출의 시간표 회귀 (2026-09-15, 2026-09-18 11.7초로).
 *
 * 11.7초짜리 연출은 스크린샷으로 순서를 확인할 수 없고, 스모크는 단이 **바뀌는지**만
 * 본다(길이를 다시 적으면 낡는다 — `smoke_ui.ts`의 2026-09-07 사고). 길이·칸 순서·
 * 겹침·소리를 트는 경계는 여기서 못 박는다. `skillFxFrame()`은 DOM을 모른다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_MS, CAPTION_FADE_MS, CAPTION_MS, CROSSFADE_MS, SCROLL_FRAMES, SCROLL_FRAME_MS, SCROLL_OPEN,
  SKILL_FX_MS, skillFxFrame,
} from '../src/ui/skillFx.ts';

/**
 * 단이 시작하는 시각 — 펴기 1.6(1번이 함께 떠오름) · 장면 4.5(1 · ⤫.5 · .5 · ⤫.5 · .5 · ⤫.5 · 1)
 * · 설명 4(4번과 겹쳐 떠오르는 1 + 온전히 3) · 말기 1.6
 */
const ACTION_AT = 1600;
const CAPTION_AT = ACTION_AT + 4500;
const ROLL_AT = CAPTION_AT + 4000;
const at = (ms: number) => skillFxFrame(ms)!;
/** 0보다 큰 장면 번호(1부터) */
const shown = (ms: number) => at(ms).actions.flatMap((op, i) => (op > 0 ? [i + 1] : []));

test('전체 11.7초 — 펴기 1.6 + 장면 4.5 + 설명 4 + 말기 1.6 (기획자 지정)', () => {
  assert.equal(SCROLL_FRAMES * SCROLL_FRAME_MS, 1600);
  assert.deepEqual([...ACTION_MS], [1000, 500, 500, 1000]);
  assert.equal(CROSSFADE_MS, 500);
  assert.equal(CAPTION_FADE_MS, 1000);
  assert.equal(CAPTION_MS, 3000);
  assert.equal(SKILL_FX_MS, 11700);
  assert.notEqual(skillFxFrame(SKILL_FX_MS - 1), null);
  assert.equal(skillFxFrame(SKILL_FX_MS), null, '11.7초에 걷힌다');
});

test('펴기는 1 → 16을 0.1초씩, 말기는 16 → 1을 0.1초씩', () => {
  const unroll = Array.from({ length: 16 }, (_, i) => at(i * 100 + 50));
  assert.deepEqual(unroll.map((f) => f.scroll), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.ok(unroll.every((f) => f.stage === 'unroll' && f.opacity === 1));

  const roll = Array.from({ length: 16 }, (_, i) => at(ROLL_AT + i * 100 + 50));
  assert.deepEqual(roll.map((f) => f.scroll), Array.from({ length: 16 }, (_, i) => 16 - i));
  assert.ok(roll.every((f) => f.stage === 'roll'));
});

test('1번 장면은 펴기와 함께 떠올라 다 펴진 순간 온전히 떠 있다 — 펴진 종이 폭으로 잘린다', () => {
  assert.deepEqual(shown(0), [], '시작 프레임엔 아직 투명');
  for (let ms = 100; ms < 1600; ms += 100) {
    assert.deepEqual(shown(ms), [1], `${ms}ms`);
    assert.ok(at(ms).actions[0] > at(ms - 100).actions[0], `${ms}ms에서 안 짙어졌다`);
    assert.deepEqual(at(ms).clip, SCROLL_OPEN[at(ms).scroll - 1], '그 칸의 펴진 폭으로 자른다');
  }
  assert.equal(at(ACTION_AT).stage, 'action', '성우가 나는 경계 — 16칸이 다 펴진 바로 그 프레임');
  assert.deepEqual(at(ACTION_AT).actions, [1, 0, 0, 0], '다 펴졌을 때 이미 온전히 떠 있다');
  assert.equal(at(ACTION_AT).clip, null, '다 펴졌으면 자르지 않는다');
});

test('펴진 폭은 칸마다 넓어지기만 하고 가운데를 품는다', () => {
  assert.equal(SCROLL_OPEN.length, SCROLL_FRAMES);
  for (let i = 0; i < SCROLL_OPEN.length; i++) {
    const [l, r] = SCROLL_OPEN[i]!;
    assert.ok(l < 0.5 && r > 0.5, `${i + 1}칸`);
    if (i) {
      assert.ok(l <= SCROLL_OPEN[i - 1]![0] && r >= SCROLL_OPEN[i - 1]![1], `${i + 1}칸이 좁아졌다`);
    }
  }
});

test('장면은 1 · 0.5 · 0.5 · 1초 온전히, 사이사이 0.5초 겹쳐 바뀐다', () => {
  const seq: [number, number[]][] = [
    [0, [1]], [999, [1]],                // 1번 온전히 1초
    [1000, [1]], [1250, [1, 2]], [1499, [1, 2]],   // 1→2 (1000ms 프레임은 2번이 아직 0)
    [1500, [2]], [1999, [2]],            // 2번 0.5초
    [2250, [2, 3]],                      // 2→3
    [2500, [3]], [2999, [3]],            // 3번 0.5초
    [3250, [3, 4]],                      // 3→4
    [3500, [4]], [4499, [4]],            // 4번 온전히 1초
  ];
  for (const [ms, want] of seq) {
    assert.deepEqual(shown(ACTION_AT + ms), want, `장면 +${ms}ms`);
    assert.equal(at(ACTION_AT + ms).scroll, 16, '장면 밑의 두루마리는 다 펴진 채');
  }
  // 겹치는 동안 나가는 장은 줄고 들어오는 장은 늘며, 둘의 합은 1이다
  for (const [from, start] of [[0, 1000], [1, 2000], [2, 3000]] as const) {
    for (let ms = start + 50; ms < start + CROSSFADE_MS; ms += 50) {
      const a = at(ACTION_AT + ms).actions;
      const b = at(ACTION_AT + ms - 50).actions;
      assert.ok(a[from] < b[from] && a[from + 1] > b[from + 1], `+${ms}ms`);
      assert.ok(Math.abs(a[from] + a[from + 1] - 1) < 1e-9, `+${ms}ms 합`);
    }
  }
});

test('4번이 사라지는 1초와 설명·라벨이 떠오르는 1초가 겹친다 — 그 뒤 3초 온전히', () => {
  assert.equal(at(CAPTION_AT - 1).stage, 'action');
  assert.equal(at(CAPTION_AT).stage, 'caption');
  for (let ms = 0; ms <= 1000; ms += 100) {
    const f = at(CAPTION_AT + ms);
    assert.ok(Math.abs(f.actions[3] + f.caption - 1) < 1e-9, `+${ms}ms — 4번과 설명이 맞바뀐다`);
    assert.equal(f.label, f.caption, '라벨은 설명과 함께');
  }
  assert.equal(at(CAPTION_AT + 500).caption, 0.5);
  for (const ms of [1000, 2000, 3999]) {
    assert.deepEqual(shown(CAPTION_AT + ms), [], `+${ms}ms — 장면은 다 걷혔다`);
    assert.equal(at(CAPTION_AT + ms).caption, 1, `+${ms}ms`);
  }
  assert.equal(at(ROLL_AT - 1).stage, 'caption');
  assert.equal(at(ROLL_AT).stage, 'roll');
});

test('말리는 동안 라벨은 남고 전체가 점점 투명해진다 — 끝에서 0에 닿는다', () => {
  const ops = Array.from({ length: 33 }, (_, i) => skillFxFrame(ROLL_AT + i * 50)?.opacity ?? 0);
  for (let i = 1; i < ops.length; i++) assert.ok(ops[i]! < ops[i - 1]!, `${i}번째에서 안 줄었다`);
  assert.equal(ops[0], 1);
  assert.ok(at(SKILL_FX_MS - 1).opacity < 0.01);
  assert.equal(at(ROLL_AT + 800).label, 1, '라벨은 제 불투명도를 유지하고 전체와 함께 옅어진다');
  assert.equal(at(ROLL_AT + 800).caption, 0, '설명·도장은 말기 전에 걷힌다');
});

test('성우 대사가 연출 안에서 끝난다 — 가장 긴 6.5초도', () => {
  // 대사는 `action` 단 첫 프레임(1.6초)에 튼다. 원본 최장 6.49초(KR 기준 실측).
  assert.ok(ACTION_AT + 6500 <= SKILL_FX_MS);
});
