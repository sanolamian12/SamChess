/**
 * 개발 / 운영 구분 회귀 (`src/environment.ts`, 2026-10-22).
 *
 * 고정하는 것 — 개발(비움 · `development`)은 아무것도 막지 않는다 · 오타는 개발로 물러나지 않는다 ·
 * 운영은 개발용 지급 · 열린 CORS · 짧은 내부 비밀을 각각 따로 잡는다(하나만 틀려도).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { INTERNAL_SECRET_MIN, gameApiProblems, samchessEnv } from '../src/environment.ts';

const PROD_OK = {
  SAMCHESS_ENV: 'production', SAMCHESS_WEB_ORIGIN: 'https://play.example', INTERNAL_API_SECRET: 'x'.repeat(INTERNAL_SECRET_MIN),
};

test('개발은 막지 않는다 — 비움 · development, 개발용 지급이 켜져 있어도', () => {
  assert.equal(samchessEnv({}), 'development');
  assert.equal(samchessEnv({ SAMCHESS_ENV: '' }), 'development');
  assert.deepEqual(gameApiProblems({ SAMCHESS_DEV_GRANTS: '1' }), []);
  assert.deepEqual(gameApiProblems({ SAMCHESS_ENV: 'development', SAMCHESS_DEV_GRANTS: '1' }), []);
});

test('오타는 개발로 물러나지 않는다', () => {
  for (const v of ['prod', 'Production', 'dev']) {
    assert.equal(samchessEnv({ SAMCHESS_ENV: v }), null, v);
    assert.equal(gameApiProblems({ SAMCHESS_ENV: v }).length, 1, v);
  }
});

test('운영 — 다 갖추면 통과, 하나씩 틀리면 그것만 잡는다', () => {
  assert.deepEqual(gameApiProblems(PROD_OK), []);
  const one = (over: Record<string, string | undefined>, word: RegExp) => {
    const p = gameApiProblems({ ...PROD_OK, ...over });
    assert.equal(p.length, 1, JSON.stringify(p));
    assert.match(p[0]!, word);
  };
  one({ SAMCHESS_DEV_GRANTS: '1' }, /DEV_GRANTS/);
  one({ SAMCHESS_WEB_ORIGIN: undefined }, /CORS/);
  one({ INTERNAL_API_SECRET: 'x'.repeat(INTERNAL_SECRET_MIN - 1) }, /INTERNAL_API_SECRET/);
  assert.equal(gameApiProblems({ SAMCHESS_ENV: 'production', SAMCHESS_DEV_GRANTS: '1' }).length, 3, '셋 다 틀리면 셋 다 적는다');
});
