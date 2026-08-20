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

  // 병영 — 42·45쪽의 셋 (문이 [출정하기] 하나로 합쳐졌다 · §5-32)
  'barracks.sortie': '출정하기',
  'barracks.sortie.sub': '상대를 찾아 싸운다',
  'barracks.tutorial': '튜토리얼 시나리오',
  'barracks.tutorial.sub': '역사적 전투를 재현한다',
  // 2026-08-18에 뒤집혔다 — 상대가 사람인지 AI인지는 고르는 것이 아니라 그때의 운이다
  'barracks.aiNote': '상대가 사람인지 AI인지는 고를 수 없다. 보상과 전적은 똑같다.',
  'barracks.needGrain': '군량 {n}',
  'barracks.needOfficers': '장수가 {n}명 필요하다',

  // 출전 · 매칭 (pptx 45쪽). **판정도 안내문도 `@samchess/meta`가 낸다**
  'sortie.back': '← 병영으로',
  'sortie.pickMode': '구성을 선택해주세요.',
  'sortie.pickSquad': '부대를 선택해주세요.',
  'sortie.noSquad': '{mode} 부대가 아직 없다. 먼저 부대를 만든다.',
  'sortie.seek': '대전상대 찾기',
  'sortie.newSquad': '새 편성 만들기',
  'sortie.confirm': '확인',
  'sortie.cancel': '취소',
  'match.back': '← 뒤로 가기',
  'match.searching': '대전 상대를 찾고 있습니다..',
  'match.creating': '대전 상대를 생성중입니다..',
  'match.found': '찾았습니다!',
  'match.waitingReady': '상대의 확인을 기다리는 중..',
  'match.declined': '상대가 거절했습니다..',
  'match.left': '{s}초',
  // 참가비는 **여기서** 나간다 (§5-16). 얼마인지 단추에 적어 둔다
  'match.ready': '전투준비 (군량 {n})',
  'match.decline': '다시 찾기 (군량 {n}소모)',
  'match.aiNoDecline': 'AI 상대는 다시 찾을 수 없다 — 거절당할 상대가 없다.',
  'match.aiSquad': 'AI 부대',
  'match.odds': '내 {mine} 대 상대 {theirs} — 예상 승률 {pct}%',

  // 부대 편성 (pptx 42·43쪽). 숫자·판정은 전부 `@samchess/meta`가 낸다
  'barracks.squads': '부대 편성',
  'barracks.squads.sub': '부대를 만들고 배치를 저장한다',
  'squads.title': '편성 부대 목록',
  'squads.back': '← 병영으로',
  'squads.new': '새 편성 만들기',
  'squads.count': '부대 {have} / {max}',
  'squads.col.size': '참여인원',
  'squads.col.name': '편성 명',
  'squads.col.power': '전투력',
  'squads.col.members': '구성',
  'squads.empty': '아직 만든 부대가 없다. 「새 편성 만들기」로 시작한다.',
  'squads.emptyMode': '{mode} 부대가 아직 없다.',
  'squads.edit': '수정',
  'squads.delete': '부대 편성 삭제',
  // 줄 안의 단추는 짧게 — 표의 열과 나란히 서야 한다
  'squads.delete.short': '삭제',
  'squads.delete.title': '부 대 삭 제',
  'squads.delete.what': '「{name}」을 지운다. 되돌릴 수 없다.',
  'squads.delete.ok': '삭제한다',
  'squads.delete.cancel': '그만둔다',
  'squads.broken': '고쳐야 한다 — {why}',
  // 43쪽 첫 걸음 — 이름과 참여 인원
  'squad.new.title': '새 편성 만들기',
  'squad.new.name': '부대 이름',
  'squad.new.namePlaceholder': '부대 이름을 입력해주세요.',
  'squad.new.mode': '구성을 선택해주세요.',
  'squad.new.next': '다음',
  'squad.new.limit': '{max}자까지',
  // 42·43쪽 편성 화면
  'squad.power': '전투력',
  'squad.power.unit': '점',
  'squad.power.note': '멤버 구성 클래스, 레벨 조합에 따라 전투력이 계산됨.',
  'squad.slots': '구성',
  'squad.pool': '보유 장수',
  'squad.level': '레벨',
  'squad.levelNote': '캐릭터별 최대 레벨에서 1 사이로 조절 가능',
  'squad.deploy': '배치',
  'squad.deploy.p1': '남군',
  'squad.deploy.p2': '북군',
  'squad.deploy.saved': '저장됨',
  'squad.deploy.none': '기본',
  'squad.save.new': '등록 완료',
  'squad.save.edit': '수정 완료',
  'squad.cancel': '← 목록으로',
  'squad.empty': '비어 있음',
  'squad.here': '이 자리',
  'squad.used': '편성됨',
  'squad.assign': '「{piece}」 자리에 넣는다',
  // 배치 프리셋 편집 (42쪽의 [배치])
  'deploy.title': '{side} 배치',
  'deploy.note': '진영 안에서 자리를 잡는다. 전투가 시작될 때 이대로 깔리고, 30초 동안 고칠 수 있다.',
  'deploy.reset': '기본 배치로',
  'deploy.save': '저장',
  'deploy.cancel': '취소',
  'deploy.pick': '옮길 기물을 고른다',

  // 궁궐 — 두 갈래 (pptx 37쪽)
  'palace.officers': '장수 일람',
  'palace.officers.sub': '정보 · 레벨업 · 전적',
  'palace.city': '도시 관리',
  'palace.city.sub': '도시 정보 · 증축 · 도시 전적',

  // 도시 관리 (pptx 41쪽). 숫자는 전부 `@samchess/meta`가 낸다 — 여기는 틀만 적는다
  'city.back': '← 궁궐로',
  'city.level': '도시 레벨',
  'city.emperor': '황제',
  'city.emperor.yes': '옹립',
  'city.emperor.no': '부재',
  'city.pool': '등용 장수',
  'city.pool.n': '현원 {have} / 최대 {max} 명',
  'city.spareCards': '잉여 장수 카드',
  'city.spareCards.n': '{n} 장',
  'city.grain': '군량',
  'city.grain.n': '시간당 {per} · 현재 {have} / 최대 {max}',
  'city.materials': '업그레이드 재료',
  'city.materials.n': '{have} (다음 레벨 : {need})',
  'city.materials.max': '{have} (더 올릴 곳이 없다)',
  'city.upgrade': '증축 (재료 {need} 소모)',
  'city.upgrade.max': '이미 최대 레벨이다',
  'city.upgrade.title': '증 축',
  'city.upgrade.what': 'Lv{from} → Lv{to}. 건축 자재 {cost}을 낸다.',
  'city.upgrade.gain': '캐릭터 풀 +{pool} · 군량 상한 +{cap} · 시간당 생산 +{per}',
  'city.upgrade.ok': '증축한다',
  'city.upgrade.cancel': '그만둔다',
  'city.records': '도시 전적 보기',
  'city.records.back': '← 도시 관리로',
  'city.records.note': '도시 전적은 판수로 센다 — 한 판에 여럿이 뛰므로 장수 전적을 더한 것과는 다르다.',

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
  'officer.detail': '장수 정보',
  'officer.record': '{p}전 {w}승 {d}무 {l}패 · {k}처치',

  // 전적 관리 (pptx 40쪽). **AI 대전도 센다** — 세지 않는 대신 필터로 가른다
  'records.note': 'AI 대전도 함께 센다. 아래에서 갈라 볼 수 있다.',
  'records.filter.all': '전체',
  'records.filter.online': '온라인',
  'records.filter.ai': 'AI',
  'records.col.piece': '기물',
  'records.col.plays': '출전 수',
  'records.col.wins': '승리',
  'records.col.kills': '적격파',
  'records.total': '총 출전',
  // 앞의 「총 출전」·「3v3」이 이미 이름이라 여기서 「출전」을 되풀이하지 않는다
  'records.sum': '{plays}전 · {w}승 {d}무 {l}패 · 적격파 {k}',
  'records.recent': '최근 대전',
  'records.col.mode': '구성',
  'records.col.squad': '부대',
  'records.col.power': '전투력',
  'records.col.vs': '상대',
  'records.col.chance': '예상',
  'records.col.result': '결과',
  'records.empty': '아직 치른 대전이 없다.',
  'records.ai': 'AI',
  'records.noSquad': '—',
  'records.chance': '{p}%',
  'records.result.win': '승',
  'records.result.draw': '무',
  'records.result.lose': '패',

  // 전투 결과 (pptx 45쪽 보상표)
  'result.win': '승리',
  'result.draw': '무승부',
  'result.lose': '패배',
  'result.rewards': '보상',
  'result.grain': '군량',
  'result.materials': '재료',
  'result.card': '장수 카드',
  'result.cardGrade': '{g}급 카드',
  'result.none': '없음',
  'result.drawPick': '무승부 — 보상 하나를 고른다',
  'result.pick.card': '장수 카드 1장',
  'result.pick.material': '재료 {m}',
  'result.pick.grain': '군량 {n}',
  'result.pickNote': '고르기 전까지 계정에 반영되지 않는다.',
  'result.expected': '예상 승률 {p}% (내 전투력 {mine} · 상대 {theirs})',
  // **성립하지 않은 판** (GDD §3.9 이탈 표 · H2) — 전적도 보상도 없고 환불만 있다
  'result.void': '대전이 성립하지 않았습니다',
  'result.void.left': '상대가 돌아오지 않았습니다.',
  'result.void.idle': '양쪽 모두 오래 두지 않아 대전이 종료되었습니다.',
  'result.void.refunded': '참가비 군량 {n}을(를) 돌려받았습니다. 전적은 남지 않습니다.',
  'result.void.kept': '참가비는 돌아오지 않습니다 — 자리를 비운 쪽이 냅니다.',
  'result.again': '다시 편성',
  'result.home': '도시로',

  // 고유기술 팝업 (pptx 38쪽 아래)
  'skill.name': '기술 명',
  'skill.origin': '기술 유래',
  'skill.effect': '기술 효과',
  'skill.close': '뒤로',

  // 레벨/스킬 관리 (pptx 39쪽)
  'levelup.title': '레벨/스킬 관리',
  'levelup.cards': '보유 카드 / 다음 레벨까지',
  'levelup.taps': '스탯 찍은 횟수',
  'levelup.support': '보유 지원책',
  'levelup.illusion': '보유 환술',
  'levelup.none': '없음',
  'levelup.go': '레벨 업 ({need}장 소모)',
  'levelup.max': '최대 레벨이다',
  'levelup.physical': '물리 성장',
  'levelup.tactic': 'Lv{level} 책략 (택1)',
  'levelup.tacticDesc': '책략 설명',
  'levelup.confirm': '확정',
  'levelup.back': '뒤로',
  // 재설계 — 둔갑천서 (GDD §4.3 · §6.2). **되감기이지 다시 고르기가 아니다**
  'respec.open': '재설계 (둔갑천서 {gold}냥)',
  'respec.title': '재설계 — 둔갑천서',
  'respec.what': 'Lv{level} → Lv1로 되돌리고, 레벨업에 쓴 장수 카드 {refund}장을 전부 돌려받는다. 능력과 책략은 처음부터 다시 고른다.',
  'respec.cost': '금화 {gold}냥이 나간다. 전적은 그대로 남는다.',
  'respec.cancel': '그만두기',
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
