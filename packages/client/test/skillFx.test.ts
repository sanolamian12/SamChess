/**
 * 고유기술 두루마리 연출의 시간표 회귀 (2026-09-15, 2026-09-18 11.2초로).
 *
 * 11.2초짜리 연출은 스크린샷으로 순서를 확인할 수 없고, 스모크는 단이 **바뀌는지**만
 * 본다(길이를 다시 적으면 낡는다 — `smoke_ui.ts`의 2026-09-07 사고). 길이·칸 순서·
 * 소리를 트는 경계는 여기서 못 박는다. `skillFxFrame()`은 DOM을 모른다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_FADE_MS, ACTION_MS, CAPTION_MS, SCROLL_FRAMES, SCROLL_FRAME_MS, SKILL_FX_MS, skillFxFrame,
} from '../src/ui/skillFx.ts';

/** 단이 시작하는 시각 — 펴기 1.6 · 장면 5(페이드 1 + 3 + 페이드 1) · 라벨 3 · 말기 1.6 */
const ACTION_AT = 1600;
const CAPTION_AT = ACTION_AT + 5000;
const ROLL_AT = CAPTION_AT + 3000;

test('전체 11.2초 — 펴기 1.6 + 장면 5 + 라벨 3 + 말기 1.6 (기획자 지정)', () => {
  assert.equal(SCROLL_FRAMES * SCROLL_FRAME_MS, 1600);
  assert.deepEqual([...ACTION_MS], [1000, 500, 500, 1000]);
  assert.equal(ACTION_FADE_MS, 1000);
  assert.equal(CAPTION_MS, 3000);
  assert.equal(SKILL_FX_MS, 11200);
  assert.notEqual(skillFxFrame(SKILL_FX_MS - 1), null);
  assert.equal(skillFxFrame(SKILL_FX_MS), null, '11.2초에 걷힌다');
});

test('펴기는 1 → 16을 0.1초씩, 말기는 16 → 1을 0.1초씩', () => {
  const unroll = Array.from({ length: 16 }, (_, i) => skillFxFrame(i * 100 + 50)!);
  assert.deepEqual(unroll.map((f) => f.scroll), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.ok(unroll.every((f) => f.stage === 'unroll' && f.opacity === 1 && f.action === 0));

  const roll = Array.from({ length: 16 }, (_, i) => skillFxFrame(ROLL_AT + i * 100 + 50)!);
  assert.deepEqual(roll.map((f) => f.scroll), Array.from({ length: 16 }, (_, i) => 16 - i));
  assert.ok(roll.every((f) => f.stage === 'roll'));
});

test('말리는 동안 점점 투명해진다 — 줄기만 하고 끝에서 0에 닿는다', () => {
  const ops = Array.from({ length: 33 }, (_, i) => skillFxFrame(ROLL_AT + i * 50)?.opacity ?? 0);
  for (let i = 1; i < ops.length; i++) assert.ok(ops[i]! < ops[i - 1]!, `${i}번째에서 안 줄었다`);
  assert.equal(ops[0], 1);
  assert.ok(skillFxFrame(SKILL_FX_MS - 1)!.opacity < 0.01);
});

test('기술 장면은 두루마리가 다 펴진 뒤 — 페이드인 1초 · 1초·0.5초·0.5초·1초 · 페이드아웃 1초', () => {
  const at = (ms: number) => skillFxFrame(ms)!;
  assert.equal(at(ACTION_AT - 1).stage, 'unroll');
  assert.equal(at(ACTION_AT).stage, 'action', '성우가 나는 경계 — 16칸이 다 펴진 바로 그 프레임');
  const seq: [number, number][] = [
    [0, 1], [999, 1], [1000, 1], [1999, 1], [2000, 2], [2499, 2], [2500, 3], [2999, 3],
    [3000, 4], [3999, 4], [4000, 4], [4999, 4],
  ];
  for (const [ms, n] of seq) {
    assert.equal(at(ACTION_AT + ms).action, n, `장면 +${ms}ms`);
    assert.equal(at(ACTION_AT + ms).scroll, 16, '장면 밑의 두루마리는 다 펴진 채');
  }
  assert.equal(at(CAPTION_AT).stage, 'caption');
  assert.equal(at(CAPTION_AT).action, 0, '라벨 단에서는 장면을 걷는다');
  assert.equal(at(ROLL_AT - 1).stage, 'caption');
  assert.equal(at(ROLL_AT).stage, 'roll');
});

test('첫 장은 1초에 걸쳐 떠오르고 마지막 장은 1초에 걸쳐 사라진다 — 가운데는 온전히 보인다', () => {
  const op = (ms: number) => skillFxFrame(ACTION_AT + ms)!.actionOpacity;
  assert.equal(op(0), 0);
  assert.equal(op(500), 0.5);
  for (let ms = 50; ms < 1000; ms += 50) assert.ok(op(ms) > op(ms - 50), `${ms}ms에서 안 늘었다`);
  for (const ms of [1000, 1500, 2200, 2700, 3500, 3999]) assert.equal(op(ms), 1, `${ms}ms`);
  assert.equal(op(4000), 1);
  for (let ms = 4050; ms < 5000; ms += 50) assert.ok(op(ms) < op(ms - 50), `${ms}ms에서 안 줄었다`);
  assert.ok(op(4999) < 0.01);
});

test('성우 대사가 연출 안에서 끝난다 — 가장 긴 6.5초도', () => {
  // 대사는 `action` 단 첫 프레임(1.6초)에 튼다. 원본 최장 6.49초(KR 기준 실측).
  assert.ok(ACTION_AT + 6500 <= SKILL_FX_MS);
});
