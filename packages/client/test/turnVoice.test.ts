/**
 * 차례 음성 회귀 — 표(`audio/turnVoice.ts`)는 성향을 보고 손으로 적은 것이라 「누가 어느 목소리인가」는 여기서 못 지킨다.
 * 지키는 것은 **빠진 장수가 없고 없는 장수가 없는가**다 — 표에서 빠진 B~D급은 오류 없이 말을 안 해 「그 장수만 조용하다」로만 보인다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { OFFICERS } from '@samchess/data';

import { TURN_VOICE_TYPE, UNIQUE_VOICE_GRADES, turnVoiceKey } from '../src/audio/turnVoice.ts';

test('B~D급은 전원 표에 있고, S · A급 · 황제는 표에 없다', () => {
  for (const o of OFFICERS) {
    const unique = UNIQUE_VOICE_GRADES.has(o.grade);
    assert.equal(TURN_VOICE_TYPE.has(o.id), !unique, `${o.name}(${o.grade})`);
  }
});

test('표의 id는 전부 실제 장수다 (한 장수가 두 목소리에 들어가지도 않는다)', () => {
  const ids = new Set(OFFICERS.map((o) => o.id));
  for (const id of TURN_VOICE_TYPE.keys()) assert.ok(ids.has(id), `없는 장수: ${id}`);
  const typed = OFFICERS.filter((o) => !UNIQUE_VOICE_GRADES.has(o.grade)).length;
  assert.equal(TURN_VOICE_TYPE.size, typed);
});

test('S · A급 · 황제는 제 이름으로, 나머지는 유형으로 튼다', () => {
  assert.equal(turnVoiceKey('jo-jo'), 'jo-jo');
  assert.equal(turnVoiceKey('heon-je'), 'heon-je');
  assert.equal(turnVoiceKey('mun-chu'), 'mun-chu');
  assert.equal(turnVoiceKey('u-geum'), 'strict');
  assert.equal(turnVoiceKey('jo-hong'), 'bold');
  assert.equal(turnVoiceKey('nobody'), null);
});
