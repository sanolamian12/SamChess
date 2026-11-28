/**
 * 규칙의 이유 코드마다 **열 언어 전부에** 문구가 있는가 (2026-09-18).
 *
 * `reasonText()`는 문구가 없으면 기본 언어(한국어)로 물러나므로, 빠져도 화면은 아무 말 없이
 * 한국어를 띄운다 — 도시 증축 이유가 실제로 그렇게 열 언어에서 한국어로 떴다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACADEMY_REASONS, CITY_UPGRADE_REASONS, SORTIE_REASONS } from '@samchess/meta';
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

test('출정을 막는 이유 코드마다 열 언어 문구가 있다 (2026-10-27 — 수비군)', () => {
  for (const code of SORTIE_REASONS) {
    for (const [lang, strings] of Object.entries(LANGS)) {
      assert.ok(strings[`reason.${code}`], `${lang}에 reason.${code}가 없다`);
    }
  }
});

// 2026-11-14 부대 개편 — [수비군으로 지정](`squad.garrison.set` · `.hint`)이 없어져 표지 하나가 남고, 칸 이름(`squad.role.*`)이 더해졌다
test('수비군 · 부대 칸 문구(squad.garrison · squad.role.*)가 열 언어 전부에 있다 (2026-10-27 · 11-14)', () => {
  const keys = Object.keys(ko).filter((k) => k.startsWith('squad.garrison') || k.startsWith('squad.role.'));
  assert.deepEqual(keys.sort(), ['squad.garrison', 'squad.role.attack', 'squad.role.defense']);
  for (const [lang, strings] of Object.entries(LANGS)) {
    for (const k of keys) assert.ok(strings[k], `${lang}에 ${k}가 없다`);
  }
});

const holesOf = (s: string) => [...new Set(s.match(/\{[a-zA-Z0-9_]+\}/g) ?? [])].sort().join(',');

// 2026-11-20 — 서버가 거절을 코드째로 돌려주게 되면서 거절 문구(reason.*)가 크게 늘었다. 하나라도 빠지면 그 언어에서 한국어가 뜬다
test('거절 문구(reason.*)가 열 언어 전부에 있고 자리표시자가 한국어와 같다 (2026-11-20)', () => {
  const keys = Object.keys(ko).filter((k) => k.startsWith('reason.'));
  for (const [lang, strings] of Object.entries(LANGS)) {
    for (const k of keys) {
      assert.ok(strings[k], `${lang}에 ${k}가 없다`);
      assert.equal(holesOf(strings[k]), holesOf((ko as Record<string, string>)[k]), `${lang}의 ${k} 자리표시자가 한국어와 다르다`);
    }
  }
});

// 규칙이 싣는 코드마다 문구가 있는가 — 없으면 `t()`가 키 이름(`reason.raid.intentsGap`)을 그대로 띄운다(실제로 그랬다)
test('meta가 거절에 싣는 코드마다 reason.{code} 문구가 있다 (2026-11-20)', () => {
  const dir = fileURLToPath(new URL('../../meta/src/', import.meta.url));
  // 제 문구 체계가 따로 있는 갈래 — 우편(mail.err.*) · 공성 · 선전포고(siege.err.* · war.err.*) · AI 대전(화면에 안 뜬다)
  const OWN = ['mail.', 'siege.', 'war.', 'ai.'];
  const codes = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.startsWith('admin'))) {
    for (const line of readFileSync(dir + f, 'utf8').split('\n')) {
      if (!/code|no\(|fail\(/.test(line)) continue;
      for (const m of line.matchAll(/'([a-z]+\.[a-zA-Z]+)'/g)) codes.add(m[1]!);
    }
  }
  // 컬렉션은 막힌 까닭을 그대로 잇는다(`collection.${reason}`)
  for (const b of ['noSpare', 'notOwned', 'carried']) codes.add(`collection.${b}`);
  const missing = [...codes].filter((c) => !OWN.some((p) => c.startsWith(p)) && !(ko as Record<string, string>)[`reason.${c}`]);
  assert.deepEqual(missing, []);
});

// 2026-11-20 — 내관 · 무관 안내(`guideScript.ts`)가 한국어에만 있어 아홉 언어 화면에서 한국어로 떴다
test('안내 대본(guide.*)이 열 언어 전부에 있고 자리표시자가 한국어와 같다 (2026-11-20)', () => {
  const keys = Object.keys(ko).filter((k) => k.startsWith('guide.'));
  assert.ok(keys.length > 200);
  for (const [lang, strings] of Object.entries(LANGS)) {
    for (const k of keys) {
      assert.ok(strings[k], `${lang}에 ${k}가 없다`);
      assert.equal(holesOf(strings[k]), holesOf((ko as Record<string, string>)[k]), `${lang}의 ${k} 자리표시자가 한국어와 다르다`);
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
