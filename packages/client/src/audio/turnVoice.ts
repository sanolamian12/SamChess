/**
 * 차례 음성 — 전투에서 **내 장수가 차례를 받아 포커스를 받았을 때** 한 번 튼다 (2026-10-20 기획자 지정).
 *
 * 원본은 `assets/Audio/voice/battle/`이고 `tools/build_audio.py`(`npm run audio`)가 `public/turnvoice/`로 옮긴다.
 * - **S급 · A급 · 황제(E급)** — 저마다 고유 목소리 `turnvoice/{장수id}.{더빙}.mp3` (A급은 2026-10-26부터)
 * - **B~D급** — 목소리 다섯 중 하나 `turnvoice/{유형}.{더빙}.mp3`. 누가 어느 목소리인지는 아래 `CAST` 표가 정한다.
 *
 * **표는 장수의 역사적 성향을 보고 손으로 적었다** — 능력치로 자동 배정하면 「무력이 높은 책사」나
 * 「지력이 높은 무장」이 어긋난다. 회귀(`turnVoice.test.ts`)는 「B~D급 전원이 표에 있고, 표의 id가 실제 장수이며,
 * S · A급 · 황제는 표에 없다」만 지킨다 — 성향 판단은 못 지킨다.
 *
 * 더빙은 `currentDubLang()`, 크기는 효과음(음성) 칸(`volume.ts`) — `skillVoice.ts`와 같다.
 * 파일이 없으면(에셋 없이 빌드) 조용히 넘어간다.
 */

import { officerById } from '@samchess/data';

import { volumeScale } from './volume.ts';
import { currentDubLang } from '../i18n/index.ts';

/**
 * B~D급 목소리 다섯 — 원본 이름은 `build_audio.py`의 `TURNVOICE_TYPES`가 잇는다.
 * bold 호탕장군 · strict 군기바짝 · noble 점잔장군 · sage 점잔책사 · schemer 간사책사
 */
export type TurnVoiceType = 'bold' | 'strict' | 'noble' | 'sage' | 'schemer';

const CAST: Record<TurnVoiceType, readonly string[]> = {
  // 호탕장군 — 거칠고 기세등등한 맹장 · 호걸 · 산적 · 남만
  bold: [
    'jo-hong', 'gong-son-chan', 'ban-jang', 'won-sul', 'sun-u-gyeong', 'i-gak', 'gwak-sa', 'chuk-yung', 'hyeong-do-yeong', 'gwan-hae', 'gim-seon', 'maeng-suk', 'song-bi',
    'eom-ssang', 'wang-cheol', 'i-ung', 'jang-mu', 'jang-yeon', 'jo-jam', 'jo-pyo', 'jin-son', 'jin-eung',
    'han-seom', 'ho-jin',
  ],
  // 군기바짝 — 군율 · 충직 · 수비형의 무장, 이름이 덜 알려진 무관 대부분
  strict: [
    'u-geum', 'go-sun', 'ak-jin', 'i-jeon', 'seo-seong', 'jeong-bong', 'mun-bing',
    'wang-pyeong', 'ma-dae', 'go-ram', 'guk-ui', 'sim-bae', 'man-chong', 'jang-su', 'cha-ju',
    'ju-yeon', 'ju-ryeong', 'han-dang', 'jang-heum', 'jin-mu', 'seo-sang', 'yang-hoe', 'naeng-po',
    'go-pae', 'deung-hyeon', 'yo-hwa', 'gi-ryeong', 'gyeong-mu', 'go-chang', 'gong-son-wol', 'dong-ryang',
    'du-seup', 'ma-yeon', 'ma-chung', 'no-so', 'beon-gung', 'bi-gwan', 'sa-jeong', 'seo-yeong', 'son-gwan',
    'song-heon', 'sin-myeong', 'ak-chwi', 'an-myeong', 'yang-ryeong', 'yang-an', 'yang-ang', 'yang-im',
    'eom-gang', 'yeo-geon', 'yeo-gwang', 'yeo-sang', 'o-ban', 'wang-chung', 'wi-sok', 'yu-goe', 'yu-dae',
    'yu-byeok', 'yu-bong', 'yu-hyeon', 'i-myeong', 'i-i', 'i-pung', 'jang-gi', 'jang-nam', 'jang-wi', 'jang-yun',
    'jang-hoek', 'jeong-deok', 'jo-ru', 'jo-seong', 'jo-sun', 'jo-ha', 'ju-bi', 'jin-gi', 'jin-sik', 'jin-jang',
    'chae-yang', 'chae-hun', 'cho-chok', 'ha-hu-geol', 'ha-hu-deok', 'ha-hu-ran', 'ha-hu-sang', 'ha-hu-eun',
    'han-maeng', 'han-yeong', 'han-ho', 'hu-ru', 'hu-seong',
  ],
  // 점잔장군 — 군주 · 명문가 · 노장처럼 위엄 있는 무장
  noble: [
    'gwak-jun', 'jo-hyu',
    'o-ui', 'son-yu', 'son-hwan', 'won-so', 'yu-pyo', 'yu-jang', 'yu-seon', 'yu-gi', 'yu-jong', 'yu-do', 'yu-sun',
    'do-gyeom', 'jang-mak',
  ],
  // 점잔책사 — 충직하고 품위 있는 문관 · 책사 · 학자
  sage: [
    'jin-gung', 'ma-sok', 'go-ong', 'bi-wi', 'i-jeok', 'son-geon', 'mi-chuk', 'hwang-gwon', 'wang-ru', 'gong-yung',
    'u-beon', 'bo-jeul', 'eom-jun', 'seol-jong', 'yuk-jeok', 'yeo-beom', 'wang-chan', 'i-gyu', 'sun-sang', 'jin-rim',
    'jo-sik', 'jin-gyo', 'yeom-po', 'wang-bo', 'wang-wi', 'mo-gae', 'yang-mang', 'yang-hyeon', 'jin-jin', 'gong-ji',
    'ju-gang', 'gwan-sun', 'song-chung', 'o-jo', 'wang-hae', 'po-ryung', 'u-chik',
  ],
  // 간사책사 — 꾀 · 배신 · 모략으로 기억되는 인물
  schemer: [
    'gwak-do', 'bong-gi', 'heo-yu', 'yu-yeop', 'yang-su', 'jang-song',
    'gam-taek', 'goe-wol', 'jin-deung', 'dong-so', 'i-suk', 'heo-sa', 'chae-mo', 'chae-jung', 'yang-song',
    'mi-bang', 'jo-bi', 'gan-ong', 'gwak-jeok', 'won-yun', 'jo-beom',
    'hak-maeng', 'han-hyeon',
  ],
};

/** 장수 id → 목소리 유형. B~D급만 든다. */
export const TURN_VOICE_TYPE: ReadonlyMap<string, TurnVoiceType> = new Map(
  (Object.entries(CAST) as [TurnVoiceType, readonly string[]][]).flatMap(([type, ids]) => ids.map((id) => [id, type] as const)),
);

/** 고유 목소리를 쓰는 급 — `build_audio.py`의 `sync_turnvoice`와 같은 셋이다 */
export const UNIQUE_VOICE_GRADES: ReadonlySet<string> = new Set(['S', 'A', 'E']);

/** 이 장수가 트는 파일의 이름 부분 — S · A급 · 황제는 장수 id, 나머지는 유형. 모르는 장수(도적 등)는 `null`. */
export function turnVoiceKey(officerId: string): string | null {
  const grade = officerById.get(officerId)?.grade;
  if (grade && UNIQUE_VOICE_GRADES.has(grade)) return officerId;
  return TURN_VOICE_TYPE.get(officerId) ?? null;
}

/** 지금 나오는 차례 음성 — 다음 차례가 오면 앞의 것을 끊는다(겹쳐 들리지 않게) */
let playing: HTMLAudioElement | null = null;

/** 내 장수 `officerId`가 차례를 받았을 때 부른다. */
export function playTurnVoice(officerId: string): void {
  if (volumeScale('fx') === 0) return;
  const key = turnVoiceKey(officerId);
  if (!key) return;
  playing?.pause();
  const el = new Audio(`turnvoice/${key}.${currentDubLang()}.mp3`);
  el.volume = volumeScale('fx');
  playing = el;
  void el.play().catch(() => { /* 자동재생이 막혔거나 파일이 없다 */ });
}
