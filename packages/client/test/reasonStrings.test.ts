/**
 * 규칙의 이유 코드마다 **열 언어 전부에** 문구가 있는가 (2026-09-18).
 *
 * `reasonText()`는 문구가 없으면 기본 언어(한국어)로 물러나므로, 빠져도 화면은 아무 말 없이
 * 한국어를 띄운다 — 도시 증축 이유가 실제로 그렇게 열 언어에서 한국어로 떴다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ACADEMY_REASONS, CITY_UPGRADE_REASONS } from '@samchess/meta';
import ko from '../src/i18n/strings/ko.json' with { type: 'json' };
import en from '../src/i18n/strings/en.json' with { type: 'json' };
import esLA from '../src/i18n/strings/es_419.json' with { type: 'json' };
import it from '../src/i18n/strings/it.json' with { type: 'json' };
import ja from '../src/i18n/strings/ja.json' with { type: 'json' };
import mn from '../src/i18n/strings/mn.json' with { type: 'json' };
import ptBR from '../src/i18n/strings/pt_BR.json' with { type: 'json' };
import ptPT from '../src/i18n/strings/pt_PT.json' with { type: 'json' };
import zhHans from '../src/i18n/strings/zh_Hans.json' with { type: 'json' };
import zhHant from '../src/i18n/strings/zh_Hant.json' with { type: 'json' };

const LANGS: Record<string, Record<string, string>> = {
  ko, en, es_419: esLA, it, ja, mn, pt_BR: ptBR, pt_PT: ptPT, zh_Hans: zhHans, zh_Hant: zhHant,
};

test('도시 증축 이유 코드마다 열 언어 문구가 있다', () => {
  for (const code of CITY_UPGRADE_REASONS) {
    for (const [lang, strings] of Object.entries(LANGS)) {
      assert.ok(strings[`reason.${code}`], `${lang}에 reason.${code}가 없다`);
    }
  }
});

test('태학 연구 이유 코드마다 열 언어 문구가 있다 (2026-09-22)', () => {
  for (const code of ACADEMY_REASONS) {
    for (const [lang, strings] of Object.entries(LANGS)) {
      assert.ok(strings[`reason.${code}`], `${lang}에 reason.${code}가 없다`);
    }
  }
});

test('태학 화면 문구(academy.*)가 열 언어 전부에 있다 (2026-09-22)', () => {
  const keys = Object.keys(ko).filter((k) => k.startsWith('academy.'));
  assert.ok(keys.length > 0);
  for (const [lang, strings] of Object.entries(LANGS)) {
    for (const k of keys) assert.ok(strings[k], `${lang}에 ${k}가 없다`);
  }
});
