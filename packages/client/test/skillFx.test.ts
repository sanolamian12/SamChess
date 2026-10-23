/**
 * 고유기술 두루마리 연출의 시간표 회귀 (2026-09-15, 2026-09-18 11.7초로, 2026-10-23 8초로).
 *
 * 8초짜리 연출은 스크린샷으로 순서를 확인할 수 없고, 스모크는 단이 **바뀌는지**만
 * 본다(길이를 다시 적으면 낡는다 — `smoke_ui.ts`의 2026-09-07 사고). 길이·겹침·
 * 떠오르고 가라앉는 모양·소리를 트는 경계는 여기서 못 박는다. `skillFxFrame()`은 DOM을 모른다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_MS, AFTER_SEAL_MS, CAPTION_FADE_MS, CAPTION_MS, CROSSFADE_MS, DRIFT, RISE_MS, SEAL_AT_MS, SEAL_MS,
  SINK_MS, SKILL_FX_MS, skillFxFrame,
} from '../src/ui/skillFx.ts';

/**
 * 단이 시작하는 시각 — 떠오르기 0.5 · 장면 4.5(1 · ⤫.5 · .5 · ⤫.5 · .5 · ⤫.5 · 1)
 * · 설명 2.5(4번과 겹쳐 떠오르는 1 + 도장이 다 찍히는 1.5초 + 1) · 가라앉기 0.5
 */
const ACTION_AT = 500;
const CAPTION_AT = ACTION_AT + 4500;
const SINK_AT = CAPTION_AT + 2500;
const at = (ms: number) => skillFxFrame(ms)!;
/** 0보다 큰 장면 번호(1부터) */
const shown = (ms: number) => at(ms).actions.flatMap((op, i) => (op > 0 ? [i + 1] : []));

test('전체 8초 — 떠오르기 0.5 + 장면 4.5 + 설명 2.5 + 가라앉기 0.5 (2026-10-23 기획자 지정)', () => {
  assert.equal(RISE_MS, 500);
  assert.equal(SINK_MS, 500);
  assert.deepEqual([...ACTION_MS], [1000, 500, 500, 1000]);
  assert.equal(CROSSFADE_MS, 500);
  assert.equal(CAPTION_FADE_MS, 1000);
  assert.equal(SKILL_FX_MS, 8000);
  assert.notEqual(skillFxFrame(SKILL_FX_MS - 1), null);
  assert.equal(skillFxFrame(SKILL_FX_MS), null, '8초에 걷힌다');
});

test('설명은 도장이 다 찍히고 1초 뒤에 가라앉기 시작한다', () => {
  assert.equal(AFTER_SEAL_MS, 1000);
  assert.equal(CAPTION_FADE_MS + CAPTION_MS, SEAL_AT_MS + SEAL_MS + AFTER_SEAL_MS);
  assert.ok(SEAL_AT_MS >= CAPTION_FADE_MS, '도장은 설명이 다 떠오른 뒤에 찍힌다');
  assert.equal(at(CAPTION_AT + SEAL_AT_MS + SEAL_MS + AFTER_SEAL_MS - 1).stage, 'caption');
  assert.equal(at(CAPTION_AT + SEAL_AT_MS + SEAL_MS + AFTER_SEAL_MS).stage, 'sink');
});

test('떠오르기 — 다 펴진 두루마리가 1번 장면을 얹은 채 0.5초 동안 투명 → 불투명, 아래 → 제자리', () => {
  assert.equal(at(0).stage, 'rise');
  assert.equal(at(0).opacity, 0, '시작 프레임엔 아직 투명');
  assert.equal(at(0).lift, DRIFT, '시작은 조금 아래');
  for (let ms = 50; ms < RISE_MS; ms += 50) {
    assert.equal(at(ms).stage, 'rise', `${ms}ms`);
    assert.deepEqual(shown(ms), [1], `${ms}ms — 1번 장면이 이미 얹혀 있다`);
    assert.ok(at(ms).opacity > at(ms - 50).opacity, `${ms}ms에서 안 짙어졌다`);
    assert.ok(at(ms).lift < at(ms - 50).lift, `${ms}ms에서 안 올라왔다`);
  }
  assert.equal(at(ACTION_AT).stage, 'action', '성우가 나는 경계 — 다 떠오른 바로 그 프레임');
  assert.equal(at(ACTION_AT).opacity, 1);
  assert.equal(at(ACTION_AT).lift, 0, '제자리에 닿았다');
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
    assert.equal(at(ACTION_AT + ms).lift, 0, '장면 동안 두루마리는 제자리');
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

test('4번이 사라지는 1초와 설명·라벨이 떠오르는 1초가 겹친다 — 그 뒤 1.5초 온전히', () => {
  assert.equal(at(CAPTION_AT - 1).stage, 'action');
  assert.equal(at(CAPTION_AT).stage, 'caption');
  for (let ms = 0; ms <= 1000; ms += 100) {
    const f = at(CAPTION_AT + ms);
    assert.ok(Math.abs(f.actions[3] + f.caption - 1) < 1e-9, `+${ms}ms — 4번과 설명이 맞바뀐다`);
    assert.equal(f.label, f.caption, '라벨은 설명과 함께');
  }
  assert.equal(at(CAPTION_AT + 500).caption, 0.5);
  for (const ms of [1000, 1500, 2499]) {
    assert.deepEqual(shown(CAPTION_AT + ms), [], `+${ms}ms — 장면은 다 걷혔다`);
    assert.equal(at(CAPTION_AT + ms).caption, 1, `+${ms}ms`);
  }
  assert.equal(at(SINK_AT - 1).stage, 'caption');
  assert.equal(at(SINK_AT).stage, 'sink');
});

test('가라앉기 — 설명 · 라벨이 그대로 남은 채 0.5초 동안 아래로 가며 투명해진다', () => {
  const fs = Array.from({ length: 10 }, (_, i) => at(SINK_AT + i * 50));
  assert.equal(fs[0]!.opacity, 1);
  assert.equal(fs[0]!.lift, 0);
  for (let i = 1; i < fs.length; i++) {
    assert.ok(fs[i]!.opacity < fs[i - 1]!.opacity, `${i}번째에서 안 옅어졌다`);
    assert.ok(fs[i]!.lift > fs[i - 1]!.lift, `${i}번째에서 안 내려갔다`);
  }
  assert.ok(at(SKILL_FX_MS - 1).opacity < 0.01);
  assert.ok(at(SKILL_FX_MS - 1).lift <= DRIFT && at(SKILL_FX_MS - 1).lift > DRIFT * 0.9);
  assert.equal(at(SINK_AT + 250).label, 1, '라벨은 제 불투명도를 유지하고 전체와 함께 옅어진다');
  assert.equal(at(SINK_AT + 250).caption, 1, '설명 · 도장도 그대로 함께 가라앉는다');
});

test('성우 대사가 연출 안에서 끝난다 — 가장 긴 6.5초도', () => {
  // 대사는 `action` 단 첫 프레임(0.5초)에 튼다. 원본 최장 6.49초(KR 기준 실측).
  assert.ok(ACTION_AT + 6500 <= SKILL_FX_MS);
});
