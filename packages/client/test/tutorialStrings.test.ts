/**
 * 튜토리얼 대본의 문구 열쇠가 전부 있는가 (2026-10-24) · 열 언어로 옮겨졌는가 (2026-11-11).
 *
 * 대본(`@samchess/meta`의 `tutorialStages`)은 열쇠를 **문자열로** 들고 있어 타입 검사가 못 본다 — 열쇠를 잘못 적으면
 * 화면에 열쇠 글자가 그대로 뜬다. 판이 선 튜토리얼 전부의 안내 · 끝맺음 열쇠가 한국어 문구에 있는지 본다.
 *
 * 번역(`tut.*` 598키)은 `battleStrings.test.ts`와 같은 결로 본다 — 빠짐 · 한국어 베끼기 · 자리표시자. 거기에 튜토리얼만의 셋:
 * - 장수 이름은 데이터의 `nameI18n`과 같게 — 카드 · 순서 판 · 대사 패널 머리가 그 이름을 쓴다.
 * - 「기술명」(고유기술 · 책략 · 아이템)도 데이터의 `nameI18n`과 같게.
 * - [단추 이름]은 그 언어의 화면 글자(`cmd.*` …)와 같게 — 안내가 「[Move]를 누르세요」인데 단추가 「Move」가 아니면 못 찾는다.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { MARKET_ITEMS, TACTICS, TACTIC_UPGRADES, UNIQUE_SKILLS, officerById } from '@samchess/data';
import { ALL_TUTORIALS, lineKey, stageLines, tutorialReady, tutorialStages, type TutorialId } from '@samchess/meta';
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

const base = ko as Record<string, string>;
const OTHERS: Record<string, Record<string, string>> = {
  en, es_419: esLA, it, ja, mn, pt_BR: ptBR, pt_PT: ptPT, zh_Hans: zhHans, zh_Hant: zhHant,
};

test('판이 선 튜토리얼의 안내 · 끝맺음 열쇠가 전부 한국어 문구에 있다', () => {
  const missing: string[] = [];
  let seen = 0;
  for (const id of ALL_TUTORIALS.filter(tutorialReady)) {
    for (const stage of tutorialStages(id)) {
      for (const k of stageLines(stage).map(lineKey)) {
        seen++;
        if (!(k in ko)) missing.push(`${id}: ${k}`);
      }
    }
  }
  assert.ok(seen > 50, `본 열쇠가 ${seen}개 — 대본을 제대로 훑었는가`);
  assert.deepEqual(missing, []);
});

test('안내 한 장은 짧다 — 한두 문장(2026-10-24 기획자: 「한 패널에 길게 담기지 않게」)', () => {
  const long = Object.entries(base)
    .filter(([k, v]) => k.startsWith('tut.') && v.length > 70)
    .map(([k, v]) => `${k} (${v.length}자)`);
  assert.deepEqual(long, []);
});

// ── 번역 ─────────────────────────────────────────────────────────

const keys = Object.keys(base).filter((k) => k.startsWith('tut.'));

test('아홉 언어에 튜토리얼 문구가 다 있다 — 없으면 한국어로 조용히 샌다', () => {
  assert.ok(keys.length > 500, `튜토리얼 키가 ${keys.length}개뿐이다 — 이름 공간이 바뀌었나?`);
  for (const [lang, table] of Object.entries(OTHERS)) {
    const missing = keys.filter((k) => !(k in table));
    assert.deepEqual(missing, [], `${lang}: ${missing.length}개가 빠졌다`);
  }
});

test('번역에 한글이 남지 않았다 — 베끼기 · 덜 옮긴 자리', () => {
  const hangul = /[가-힣]/;
  for (const [lang, table] of Object.entries(OTHERS)) {
    const left = keys.filter((k) => table[k] !== undefined && hangul.test(table[k]!));
    assert.deepEqual(left, [], `${lang}: 한글이 남은 키가 있다`);
  }
});

test('자리표시자가 언어마다 같다 — 다르면 화면에 {name}이 그대로 뜬다', () => {
  const slots = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort().join(',');
  for (const [lang, table] of Object.entries(OTHERS)) {
    for (const k of keys) {
      const got = table[k];
      if (got === undefined) continue;
      assert.equal(slots(got), slots(base[k]!), `${lang} / ${k}: 자리표시자가 다르다`);
    }
  }
});

/** 열쇠가 속한 튜토리얼 — `tut.s.{장수}.*` → `s-{장수}`, `tut.b1.*` · `tut.basic-1*` → `basic-1`. 공용 키는 없다 */
const tutorialOf = (k: string): TutorialId | null => {
  const s = /^tut\.s\.([a-z-]+)\./.exec(k);
  if (s && officerById.has(s[1]!)) return `s-${s[1]}` as TutorialId;
  const b = /^tut\.(?:b([123])\.|basic-([123])\b)/.exec(k);
  return b ? (`basic-${b[1] ?? b[2]}` as TutorialId) : null;
};

/**
 * 그 판에 선 장수 — 장수 이름은 판에 선 사람만 본다. 260명 이름을 문장 전체에서 훑으면 「장수」(張繡) · 「정보」(丁奉 아님) ·
 * 「이유」(李儒)처럼 흔한 낱말과 겹친다. 판 정의에 나오는 장수 id를 전부 줍는다(명단 · 끝 장면 · 숨긴 장수).
 */
const officersIn = (id: TutorialId): Set<string> => {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') { if (officerById.has(v)) found.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(tutorialStages(id));
  return found;
};

/**
 * 원문이 그 장수를 **사람으로** 부르는가 — 이름만 겹치는 자리는 뺀다 (2026-11-11, 번역 첫 판에서 오탐이 난 셋):
 * 「온주참화웅」처럼 기술명 안의 이름(기술명은 따로 본다) · 「조조군」 「조조의 군사」(「曹军」 「Cao's army」가 자연스럽다) ·
 * 흔한 낱말과 같은 이름(「장수」 = 武將 / 張繡 — 가후 판에 張繡가 선다).
 */
const COMMON_WORD_NAMES = new Set(['장수']);
const namesPerson = (src: string, name: string): boolean => {
  if (COMMON_WORD_NAMES.has(name)) return false;
  const plain = src.replace(/「[^」]*」/g, '');
  return [...plain.matchAll(new RegExp(name, 'g'))].some((m) => !/^(군|의 군)/.test(plain.slice(m.index! + name.length)));
};

test('판에 선 장수의 이름은 데이터의 다국어 이름 그대로다', () => {
  const cache = new Map<TutorialId, Set<string>>();
  const bad: string[] = [];
  for (const k of keys) {
    const tid = tutorialOf(k);
    if (!tid || !ALL_TUTORIALS.includes(tid)) continue;
    if (!cache.has(tid)) cache.set(tid, officersIn(tid));
    for (const oid of cache.get(tid)!) {
      const o = officerById.get(oid)!;
      if (!namesPerson(base[k]!, o.name)) continue;
      for (const [lang, table] of Object.entries(OTHERS)) {
        const got = table[k];
        if (got === undefined) continue;
        const want = (o.nameI18n as Record<string, string>)[lang]!;
        if (!got.includes(want)) bad.push(`${lang} / ${k}: 「${want}」가 없다 — ${got}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

/** 「」 안에 적히는 이름 — 고유기술 · 책략(개량형 포함) · 아이템 */
const NAMED: { name: string; nameI18n: Record<string, string> }[] = [
  ...UNIQUE_SKILLS, ...TACTICS, ...TACTIC_UPGRADES, ...MARKET_ITEMS,
].filter((x) => x.nameI18n) as never;

test('「기술명」은 데이터의 다국어 이름 그대로다', () => {
  const byName = new Map(NAMED.map((x) => [x.name, x]));
  const bad: string[] = [];
  for (const k of keys) {
    for (const m of base[k]!.matchAll(/「([^」]+)」/g)) {
      const item = byName.get(m[1]!);
      if (!item) continue;   // 기술명이 아닌 「」 — 인용 · 강조
      for (const [lang, table] of Object.entries(OTHERS)) {
        const got = table[k];
        if (got === undefined) continue;
        const want = item.nameI18n[lang]!;
        if (!got.includes(want)) bad.push(`${lang} / ${k}: 「${want}」가 없다 — ${got}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

/** 안내가 부르는 단추 — 그 언어의 화면 글자 열쇠. 새 단추가 대본에 나오면 여기 없어서 실패한다 */
const BUTTONS: Record<string, string> = {
  '이동': 'cmd.move', '공격': 'cmd.attack', '명상': 'cmd.meditate', '책략': 'cmd.castTactic', '아이템': 'cmd.useItem',
  '대기': 'cmd.endTurn', '고유기술': 'sk.title', '준비완료': 'prep.ready', '출정하기': 'barracks.sortie',
};

test('[단추 이름]은 그 언어의 화면 글자 그대로다', () => {
  const unknown = new Set<string>();
  const bad: string[] = [];
  for (const k of keys) {
    for (const m of base[k]!.matchAll(/\[([^\]]+)\]/g)) {
      const key = BUTTONS[m[1]!];
      if (!key) { unknown.add(`${m[1]} (${k})`); continue; }
      for (const [lang, table] of Object.entries(OTHERS)) {
        const got = table[k];
        if (got === undefined) continue;
        const want = `[${table[key]}]`;
        if (!got.includes(want)) bad.push(`${lang} / ${k}: ${want}가 없다 — ${got}`);
      }
    }
  }
  assert.deepEqual([...unknown], [], '대본이 부르는데 BUTTONS에 없는 단추');
  assert.deepEqual(bad, []);
});

