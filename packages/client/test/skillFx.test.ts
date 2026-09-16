/**
 * 고유기술 두루마리 연출의 시간표 회귀 (2026-09-15).
 *
 * 8.2초짜리 연출은 스크린샷으로 순서를 확인할 수 없고, 스모크는 단이 **바뀌는지**만
 * 본다(길이를 다시 적으면 낡는다 — `smoke_ui.ts`의 2026-09-07 사고). 길이·칸 순서·
 * 소리를 트는 경계는 여기서 못 박는다. `skillFxFrame()`은 DOM을 모른다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_MS, CAPTION_MS, SCROLL_FRAMES, SCROLL_FRAME_MS, SKILL_FX_MS, skillFxFrame,
} from '../src/ui/skillFx.ts';

test('전체 8.2초 — 펴기 1.6 + 장면 3 + 라벨 2 + 말기 1.6 (기획자 지정)', () => {
  assert.equal(SCROLL_FRAMES * SCROLL_FRAME_MS, 1600);
  assert.deepEqual([...ACTION_MS], [1000, 500, 500, 1000]);
  assert.equal(CAPTION_MS, 2000);
  assert.equal(SKILL_FX_MS, 8200);
  assert.notEqual(skillFxFrame(SKILL_FX_MS - 1), null);
  assert.equal(skillFxFrame(SKILL_FX_MS), null, '8.2초에 걷힌다');
});

test('펴기는 1 → 16을 0.1초씩, 말기는 16 → 1을 0.1초씩', () => {
  const unroll = Array.from({ length: 16 }, (_, i) => skillFxFrame(i * 100 + 50)!);
  assert.deepEqual(unroll.map((f) => f.scroll), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.ok(unroll.every((f) => f.stage === 'unroll' && f.opacity === 1 && f.action === 0));

  const rollStart = 1600 + 3000 + 2000;
  const roll = Array.from({ length: 16 }, (_, i) => skillFxFrame(rollStart + i * 100 + 50)!);
  assert.deepEqual(roll.map((f) => f.scroll), Array.from({ length: 16 }, (_, i) => 16 - i));
  assert.ok(roll.every((f) => f.stage === 'roll'));
});

test('말리는 동안 점점 투명해진다 — 줄기만 하고 끝에서 0에 닿는다', () => {
  const rollStart = 1600 + 3000 + 2000;
  const ops = Array.from({ length: 33 }, (_, i) => skillFxFrame(rollStart + i * 50)?.opacity ?? 0);
  for (let i = 1; i < ops.length; i++) assert.ok(ops[i]! < ops[i - 1]!, `${i}번째에서 안 줄었다`);
  assert.equal(ops[0], 1);
  assert.ok(skillFxFrame(SKILL_FX_MS - 1)!.opacity < 0.01);
});

test('기술 장면은 두루마리가 다 펴진 뒤 1초·0.5초·0.5초·1초', () => {
  const at = (ms: number) => skillFxFrame(ms)!;
  assert.equal(at(1599).stage, 'unroll');
  assert.equal(at(1600).stage, 'action', '성우가 나는 경계 — 16칸이 다 펴진 바로 그 프레임');
  const seq: [number, number][] = [[1600, 1], [2599, 1], [2600, 2], [3099, 2], [3100, 3], [3599, 3], [3600, 4], [4599, 4]];
  for (const [ms, n] of seq) {
    assert.equal(at(ms).action, n, `${ms}ms`);
    assert.equal(at(ms).scroll, 16, '장면 밑의 두루마리는 다 펴진 채');
  }
  assert.equal(at(4600).stage, 'caption');
  assert.equal(at(4600).action, 0, '라벨 단에서는 장면을 걷는다');
  assert.equal(at(6599).stage, 'caption');
  assert.equal(at(6600).stage, 'roll');
});

test('성우 대사가 연출 안에서 끝난다 — 가장 긴 6.5초도', () => {
  // 대사는 `action` 단 첫 프레임(1.6초)에 튼다. 원본 최장 6.49초(KR 기준 실측).
  const voiceStart = 1600;
  assert.ok(voiceStart + 6500 <= SKILL_FX_MS);
});
