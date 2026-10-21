/**
 * 우편 글의 언어(`@samchess/meta`의 `MAIL_LANGS`)가 게임 화면의 언어(`LANGS`)와 같은가 (2026-10-21).
 *
 * 두 목록은 다른 패키지에 산다 — meta는 화면의 i18n을 모른다. 화면에 언어가 늘었는데 우편이 안 따라가면
 * 그 언어의 플레이어는 늘 한국어 우편을 받고, 관리자 화면에는 그 언어를 쓸 칸이 없다. 아무 오류도 안 난다.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MAIL_LANGS } from '@samchess/meta';
import { LANGS } from '../src/i18n/index.ts';

it('우편 언어 = 화면 언어', () => {
  assert.deepEqual([...MAIL_LANGS].sort(), LANGS.map((l) => l.id).sort());
});
