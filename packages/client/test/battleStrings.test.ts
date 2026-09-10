/**
 * 전투 화면 문구가 **열 언어에 다 있는가** (2026-09-11 전투 UI 다국어)
 *
 * `t()`는 번역이 없으면 **한국어로 조용히 물러난다** — 오류가 없어, 아홉 파일 중
 * 하나에서 키를 빠뜨려도 그 언어로 놀아 보기 전까지 아무도 모른다. `ko.json`만
 * `StringKey` 타입으로 보호되고 나머지 아홉은 그 보호가 없다.
 * `castDelay.test.ts`가 키 셋에 대해 하던 일을 **전투 화면 전체**로 넓힌 것이다.
 *
 * 로그(`log.*`)는 `eventText.test.ts`가 「영어 출력에 한글이 없다」로 이미 실물을
 * 지나며 확인한다. 여기서 잡는 것은 **화면을 실제로 안 그려도 알 수 있는 빠뜨림**,
 * 그리고 로그 밖의 자리(HUD·배지·카드·살펴보기)다 — 그쪽은 도는 검사가 없다.
 *
 * ⚠ **메타 화면(도시·부대·전적·장터)의 기존 구멍은 여기서 세지 않는다.** 다른 언어
 * 파일에는 그 화면들의 키가 아직 없고(2026-09-10 기준 222개), 그건 이 작업과 무관한
 * 예전 구멍이다. 섞어 세면 이 검사가 늘 빨개서 아무도 안 본다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { STATUS_META, TERRAIN_META } from '@samchess/rules';
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

/**
 * 전투 화면이 쓰는 이름 공간. 메타 화면(`city.`·`squad.` …)은 일부러 뺐다 — 위 머리말 참조.
 *
 * `cmd.`·`focus.`·`prep.`·`hist.`·`fx.`·`board.`는 2차(2026-09-11 같은 날)에 보탰다 —
 * **전투 화면 전체가 이 정규식 안에 든다.**
 */
const BATTLE = /^(battle\.|status\.|terrain\.|log\.|hud\.|chip\.|card\.|ins\.|cmd\.|focus\.|prep\.|hist\.|fx\.|board\.)/;

const OTHERS: Record<string, Record<string, string>> = {
  en, es_419: esLA, it, ja, mn, pt_BR: ptBR, pt_PT: ptPT, zh_Hans: zhHans, zh_Hant: zhHant,
};

const base = ko as Record<string, string>;
const keys = Object.keys(base).filter((k) => BATTLE.test(k));

test('전투 화면 키가 하나도 안 빠졌다 — 상태·지형은 엔진의 표가 정본이다', () => {
  // 엔진에 상태나 지형이 늘면 여기서 먼저 걸린다. `engineLabel.ts`는 타입으로
  // 막지만 **아홉 언어 쪽은 타입이 없어** 이 줄이 유일한 방어다.
  for (const id of Object.keys(STATUS_META)) {
    for (const part of ['label', 'desc']) {
      assert.ok(`status.${id}.${part}` in base, `ko.json에 status.${id}.${part}가 없다`);
    }
  }
  for (const id of Object.keys(TERRAIN_META)) {
    for (const part of ['label', 'desc']) {
      assert.ok(`terrain.${id}.${part}` in base, `ko.json에 terrain.${id}.${part}가 없다`);
    }
  }
  assert.ok(keys.length > 100, `전투 키가 ${keys.length}개뿐이다 — 이름 공간이 바뀌었나?`);
});

test('아홉 언어에 전투 화면 키가 다 있다 — 없으면 한국어로 조용히 샌다', () => {
  for (const [lang, table] of Object.entries(OTHERS)) {
    const missing = keys.filter((k) => !(k in table));
    assert.deepEqual(missing, [], `${lang}: ${missing.length}개가 빠졌다`);
  }
});

test('번역이 한국어를 그대로 베끼지 않았다 — 붙여넣기만 한 자리를 잡는다', () => {
  // 값이 같아도 되는 자리가 있다(「∞」·「{who} HP {delta}」처럼 낱말이 없는 것).
  // 그래서 **한글이 들어 있는데 한국어와 똑같은 것**만 센다.
  const hangul = /[가-힣]/;
  for (const [lang, table] of Object.entries(OTHERS)) {
    const copied = keys.filter((k) => hangul.test(base[k]!) && table[k] === base[k]);
    assert.deepEqual(copied, [], `${lang}: 한국어를 그대로 둔 키가 있다`);
  }
});

test('자리표시자가 언어마다 같다 — 다르면 화면에 {who}가 그대로 뜬다', () => {
  const slots = (s: string): string =>
    [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [lang, table] of Object.entries(OTHERS)) {
    for (const k of keys) {
      const got = table[k];
      if (got === undefined) continue;   // 빠진 것은 위 검사가 이미 말했다
      assert.equal(slots(got), slots(base[k]!), `${lang} / ${k}: 자리표시자가 다르다`);
    }
  }
});
