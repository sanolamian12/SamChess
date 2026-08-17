/**
 * 다국어 — 한국어를 기준으로 다섯 언어 (기획자 지정 2026-08-15)
 *
 * `한국어 · English · Português · 日本語 · 中文`. 고르는 자리는 환경설정 팝업이다.
 *
 * ────────────────────────────────────────────────────────────────
 * 지금은 **틀만** 있다
 * ────────────────────────────────────────────────────────────────
 *
 * 번역 문구는 기획자가 **별도 세션에서** 주기로 했다. 그래서 `ko`만 채우고 나머지는
 * 비워 뒀는데, 비어 있어도 화면은 한국어로 정상 동작한다 — `t()`가 한국어로 물러난다.
 * 문구가 오면 `STRINGS`의 언어별 표만 채우면 되고 화면은 손대지 않는다.
 *
 * **키를 `ko` 표에서 뽑는다.** `Record<StringKey, string>`이라 한국어에 없는 키를 쓰면
 * 타입 검사가 먼저 막는다 — 화면에 키 이름이 그대로 뜨는 일이 없다.
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 라이브러리를 쓰지 않는가
 * ────────────────────────────────────────────────────────────────
 *
 * 이 프로젝트는 번들 단계가 없고(`Node 22` 타입 스트리핑), 화면 문구가 아직 수십 개다.
 * 복수형·성·날짜 서식이 필요해지면 그때 바꾼다 — 지금 넣으면 그 무게만 남는다.
 */

export type Lang = 'ko' | 'en' | 'pt' | 'ja' | 'zh';

/** 고르는 차례와 표시 이름. **그 언어를 쓰는 사람이 읽을 이름**으로 적는다. */
export const LANGS: readonly { id: Lang; label: string; short: string }[] = [
  { id: 'ko', label: '한국어', short: 'KR' },
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'pt', label: 'Português', short: 'PT' },
  { id: 'ja', label: '日本語', short: 'JA' },
  { id: 'zh', label: '中文', short: 'ZH' },
];

/** 기준 언어. 번역이 없으면 여기로 물러난다. */
export const BASE_LANG: Lang = 'ko';

const KO = {
  // 간판·로그인 (pptx 33·34쪽)
  'game.title': '만민의 삼국지',
  'title.id': 'ID',
  'title.enter': '입장',
  'title.signup': '계정 생성',
  'title.later': '계정 생성과 로그인은 다음에 붙인다. 지금은 「입장」이 바로 들어간다.',

  // 환경설정 (pptx 33쪽 오른쪽)
  'settings.title': '환 경 설 정',
  'settings.account': 'ID',
  'settings.signedIn': '로그인 됨',
  'settings.signedOut': '로그인 안 함',
  'settings.remember': 'ID 기억',
  'settings.language': 'Language',
  'settings.orientation': '화면 모드',
  'settings.portrait': '세로',
  'settings.sound': '배경음악',
  'settings.soundOn': '켬',
  'settings.soundOff': '끔',
  'settings.close': '닫기',

  // 메인·도시 (pptx 35쪽)
  'main.cityInfo': '도시 정보',
  'main.cityLevel': '도시',
  'main.grain': '군량',
  'main.officers': '장수',
  'main.gradeScore': '등급 점수',
  'main.reset': '계정 초기화',

  // 도시 안의 자리 (pptx 35·36쪽)
  'place.palace': '궁궐',
  'place.barracks': '병영',
  'place.market': '장터',
  'place.palace.sub': '장수와 정사를 살핀다',
  'place.barracks.sub': '군을 편성해 싸운다',
  'place.market.sub': '사고판다',
  'place.back': '← 도시로',
  'place.soon': '아직 열리지 않았다.',

  // 병영 (지금까지 만든 전투 길의 입구)
  'barracks.aiTitle': 'AI 대전',
  'barracks.aiNote': 'AI 대전은 이겨도 군량만 받는다. 장수 카드는 나오지 않는다.',
  'barracks.needGrain': '군량 {n}',
  'barracks.needOfficers': '장수가 {n}명 필요하다',
  'barracks.shortGrain': '군량 {n} — {have}밖에 없다',

  // 궁궐 — 두 갈래 (pptx 37쪽). 「도시 관리」는 아직 잠겨 있다
  'palace.officers': '장수 일람',
  'palace.officers.sub': '정보 · 레벨업 · 전적',
  'palace.city': '도시 관리',
  'palace.city.sub': '도시 정보 · 증축 · 도시 전적',

  // 장수 일람 (pptx 37·38쪽)
  'officers.title': '장수 일람',
  'officers.back': '← 궁궐로',
  'officers.search': '장수 검색',
  'officers.sort': '정렬',
  'officers.sort.name': '가나다',
  'officers.sort.might': '무력',
  'officers.sort.intellect': '지력',
  'officers.sort.leadership': '통솔',
  'officers.col.grade': '등급',
  'officers.col.name': '이름',
  'officers.col.level': '레벨',
  'officers.flag': '레벨업',
  'officers.flagFull': '레벨업 가능',
  'officers.count': '장수 : {cur} / {max} 명',
  'officers.empty': '「{q}」로 찾은 장수가 없다.',

  // 장수 상세 (pptx 38쪽)
  'officer.toList': '장수 일람으로',
  'officer.levels': '레벨/스킬 관리',
  'officer.records': '전적 보기',
  'officer.might': '무   력',
  'officer.intellect': '지   력',
  'officer.leadership': '통솔력',
  'officer.skill': '고유기술',
  'officer.skill.none': '고유기술 없음',
  'officer.story': '인물 소개',
  'officer.tactics': '습득 책략',
  'officer.tactics.none': '아직 없다 — 레벨업으로 배운다',
  'officer.support': '지원책',
  'officer.illusion': '환술',
  'officer.cards': '보유 카드',
  'officer.cards.have': '{have} / {need}장',
  'officer.cards.max': '최대 레벨',
  'officer.record': '{w}승 {l}패 · {k}처치',

  // 고유기술 팝업 (pptx 38쪽 아래)
  'skill.name': '기술 명',
  'skill.origin': '기술 유래',
  'skill.effect': '기술 효과',
  'skill.close': '뒤로',

  // 레벨/스킬 관리 — B(39쪽)가 갈아엎을 자리다
  'levelup.title': '레벨/스킬 관리',
} as const;

export type StringKey = keyof typeof KO;

/**
 * 언어별 표. `ko`만 완전하고 나머지는 **아직 비어 있다**(위 「지금은 틀만 있다」).
 * `Partial`이라 문구가 오는 대로 하나씩 채워 넣을 수 있다.
 */
const STRINGS: Record<Lang, Partial<Record<StringKey, string>>> = {
  ko: KO,
  en: {},
  pt: {},
  ja: {},
  zh: {},
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
