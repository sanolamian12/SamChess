/**
 * 다국어 — 한국어를 기준으로 열 언어 (2026-08-25 열 언어로 확장, 최초 지정은 2026-08-15 다섯)
 *
 * 텍스트 언어 열 가지는 `assets/Languages/`의 장수 이름 번역 열 파일과 정확히 맞춘다
 * (roster_en · roster_es_419 · roster_it · roster_ja · roster_kr · roster_mn ·
 * roster_pt_BR · roster_pt_PT · roster_zh_Hans · roster_zh_Hant) — 어느 언어를
 * 지원할지를 새로 정하지 않고 이미 기획자가 낸 답을 그대로 따른다.
 *
 * ────────────────────────────────────────────────────────────────
 * 문구는 JSON, 한 언어에 파일 하나 (2026-08-25)
 * ────────────────────────────────────────────────────────────────
 *
 * `strings/{lang}.json` 열 개다. `ko.json`만 전체(지금까지 화면에 적은 문구 전부)이고,
 * 나머지 아홉은 **번역이 채워진 키만** 담는다 — 없는 키는 `t()`가 한국어로 물러난다
 * (`STRINGS[lang][key] ?? STRINGS[BASE_LANG][key]`). 화면 하나를 다국어로 채울 때는
 * 그 화면이 쓰는 키만 아홉 파일에 보태면 되고, 코드(이 파일·화면 컴포넌트)는 안 건드린다.
 *
 * TS는 `keyof typeof ko`로 `StringKey`를 뽑는다 — 한국어 JSON에 없는 키를 쓰면
 * 타입 검사가 먼저 막는다(예전 `as const` 객체와 같은 안전장치).
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 라이브러리도, DB도 아닌가
 * ────────────────────────────────────────────────────────────────
 *
 * 번들 단계가 없고(`Node 22` 타입 스트리핑 — 단 이 파일은 클라이언트 소속이라 Vite가
 * 번들한다), 문구는 여전히 정적이라 배포 시점에 다 정해진다 — 계정처럼 사용자가
 * 바꾸는 데이터가 아니라서 DB에 둘 이유가 없다. `packages/data/generated/*.json`이
 * 이미 쓰는 것과 같은 `with { type: 'json' }` 가져오기를 그대로 따른다.
 */

import ko from './strings/ko.json' with { type: 'json' };
import en from './strings/en.json' with { type: 'json' };
import esLA from './strings/es_419.json' with { type: 'json' };
import it from './strings/it.json' with { type: 'json' };
import ja from './strings/ja.json' with { type: 'json' };
import mn from './strings/mn.json' with { type: 'json' };
import ptBR from './strings/pt_BR.json' with { type: 'json' };
import ptPT from './strings/pt_PT.json' with { type: 'json' };
import zhHans from './strings/zh_Hans.json' with { type: 'json' };
import zhHant from './strings/zh_Hant.json' with { type: 'json' };

export type Lang = 'ko' | 'en' | 'es_419' | 'it' | 'ja' | 'mn' | 'pt_BR' | 'pt_PT' | 'zh_Hans' | 'zh_Hant';

/** 고르는 차례와 표시 이름. **그 언어를 쓰는 사람이 읽을 이름**으로 적는다. */
export const LANGS: readonly { id: Lang; label: string; short: string }[] = [
  { id: 'ko', label: '한국어', short: 'KR' },
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'es_419', label: 'Español (Latinoamérica)', short: 'ES' },
  { id: 'it', label: 'Italiano', short: 'IT' },
  { id: 'ja', label: '日本語', short: 'JA' },
  { id: 'mn', label: 'Монгол', short: 'MN' },
  { id: 'pt_BR', label: 'Português (Brasil)', short: 'BR' },
  { id: 'pt_PT', label: 'Português (Portugal)', short: 'PT' },
  { id: 'zh_Hans', label: '简体中文', short: 'CN' },
  { id: 'zh_Hant', label: '繁體中文', short: 'TW' },
];

/** 기준 언어. 번역이 없으면 여기로 물러난다. */
export const BASE_LANG: Lang = 'ko';

export type StringKey = keyof typeof ko;

/**
 * 언어별 표. `ko`만 완전하고 나머지는 **화면을 다국어로 채울 때마다 느는 중**이다
 * (위 머리말 참조). `Partial`이라 문구가 오는 대로 하나씩 채워 넣을 수 있다.
 */
const STRINGS: Record<Lang, Partial<Record<StringKey, string>>> = {
  ko,
  en,
  es_419: esLA,
  it,
  ja,
  mn,
  pt_BR: ptBR,
  pt_PT: ptPT,
  zh_Hans: zhHans,
  zh_Hant: zhHant,
};

const LANG_KEY = 'samchess.lang';

let lang: Lang = BASE_LANG;
const listeners = new Set<() => void>();

/** 저장된 언어를 읽어 온다. 없거나 모르는 값이면 한국어다. */
export function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGS.some((l) => l.id === saved)) lang = saved as Lang;
  } catch { /* 저장소를 못 읽어도 한국어로 돈다 */ }
  return lang;
}

export const currentLang = (): Lang => lang;

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(LANG_KEY, next); } catch { /* 못 저장해도 이번 판은 바뀐다 */ }
  for (const fn of listeners) fn();
}

/** 언어가 바뀌면 화면을 다시 그리게 알린다. 돌려주는 함수를 부르면 그만둔다. */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * 문구 하나. 번역이 없으면 **한국어**로, 그것도 없으면 키를 그대로 돌려준다.
 *
 * `{n}` 같은 자리는 `vars`로 채운다 — 「군량 3」처럼 숫자가 문장 가운데 오는 것이
 * 언어마다 자리가 달라서, 이어 붙이지 않고 통째로 번역할 수 있게 한다.
 */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const raw = STRINGS[lang][key] ?? STRINGS[BASE_LANG][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    (name in vars ? String(vars[name]) : whole));
}

/**
 * 더빙(성우) 언어 — `assets/Audio/Specialskills/{CA,EN,JP,KR,PT}`의 다섯 폴더가
 * 그대로 코드다. **텍스트 열 언어보다 적어서** 문화권이 가장 가까운 더빙을
 * 기본값으로 잡는다(기획자 지정, 2026-08-25) — 화면 문구는 스페인어인데 목소리는
 * 포르투갈어가 나오는 식이다. `CA`는 이 프로젝트의 중국어권 더빙 코드다(폴더명
 * 그대로 — 어느 로마자 표기인지는 자산 쪽 기록에 없어 그대로 옮겼다).
 *
 * **자동 매칭은 기본값일 뿐, 사람이 골라 덮어쓸 수 있다**(2026-08-26) — 문화권
 * 매핑은 기획자의 판단이지 모두가 동의하는 결정이 아니다(위 `DUB_FOR`의 몽골·
 * 이탈리아·스페인어 자리는 특히 근거가 약하다고 주석에도 적혀 있다). 텍스트
 * 언어처럼 `localStorage`에 따로 저장하고, 값이 없을 때만 `DUB_FOR`로 물러난다 —
 * `setLang()`이 `dubOverride`를 건드리지 않으므로 한 번 고른 더빙은 화면 언어를
 * 바꿔도 그대로 남는다.
 *
 * 재생 자리는 `audio/skillVoice.ts`의 `playSkillVoice()`다 — 고유기술 시전 순간
 * `currentDubLang()`으로 지금 골라 둔 더빙 폴더를 읽어 튼다.
 */
export type DubLang = 'KR' | 'EN' | 'JP' | 'PT' | 'CA';

/** 고르는 차례와 표시 이름. **그 언어를 쓰는 사람이 읽을 이름**으로 적는다. */
export const DUB_LANGS: readonly { id: DubLang; label: string; short: string }[] = [
  { id: 'KR', label: '한국어', short: 'KR' },
  { id: 'EN', label: 'English', short: 'EN' },
  { id: 'PT', label: 'Português', short: 'BR' },
  { id: 'JP', label: '日本語', short: 'JA' },
  { id: 'CA', label: '中文', short: 'CN' },
];

const DUB_FOR: Record<Lang, DubLang> = {
  ko: 'KR',
  en: 'EN',
  ja: 'JP',
  // 포르투갈어 두 갈래는 당연히 PT다.
  pt_BR: 'PT',
  pt_PT: 'PT',
  // 로망스어권 — 라틴 문화권으로 묶어 포르투갈어 더빙에 붙인다. 이탈리아어는
  // 영어보다 포르투갈어와 같은 어족·문화권이 더 가깝다고 봤다.
  it: 'PT',
  es_419: 'PT',
  // 중화문화권 — 간체·번체 모두 중국어 더빙 하나다.
  zh_Hans: 'CA',
  zh_Hant: 'CA',
  // 몽골 — 역사적으로 가장 깊이 얽힌 쪽(원·명대 이후 교류)이 중국어권이라 그쪽에 붙였다.
  // 다섯 갈래 중 가장 근거가 약한 판단이라, 기획자가 다르게 보면 여기 하나만 바꾸면 된다.
  mn: 'CA',
};

const DUB_LANG_KEY = 'samchess.dubLang';

/** 사람이 직접 고른 값. 없으면(`null`) `DUB_FOR`의 자동 매칭을 그대로 쓴다. */
let dubOverride: DubLang | null = null;

/** 저장된 더빙 선택을 읽어 온다. 없거나 모르는 값이면 자동 매칭으로 돈다. */
export function loadDubLang(): void {
  try {
    const saved = localStorage.getItem(DUB_LANG_KEY);
    if (saved && DUB_LANGS.some((d) => d.id === saved)) dubOverride = saved as DubLang;
  } catch { /* 저장소를 못 읽어도 자동 매칭으로 돈다 */ }
}

/** 지금 골라 둔 더빙(사람이 고른 값 우선, 없으면 텍스트 언어의 자동 매칭). */
export function currentDubLang(): DubLang {
  return dubOverride ?? DUB_FOR[lang];
}

/** 사람이 더빙을 직접 고른다 — 이후로는 화면 언어를 바꿔도 이 값이 남는다. */
export function setDubLang(next: DubLang): void {
  if (next === currentDubLang()) return;
  dubOverride = next;
  try { localStorage.setItem(DUB_LANG_KEY, next); } catch { /* 못 저장해도 이번 판은 바뀐다 */ }
  for (const fn of listeners) fn();
}

/**
 * 지정한 텍스트 언어의 **자동** 매칭(사람이 고른 값은 안 본다) — `DUB_FOR` 하나를
 * 그대로 들여다보는 순수 함수라 테스트에서 언어별 기본 매핑만 따로 확인할 수 있다.
 * 실제 재생에 쓸 값은 `currentDubLang()`이다.
 */
export function dubLangFor(l: Lang = lang): DubLang {
  return DUB_FOR[l];
}
