/**
 * 평타 효과음 — 판 위 장수 그림(액션 시트 공격 칸)이 **무엇으로 때리는가**로 고른다 (2026-10-12, 기획자 지정).
 *
 * ```
 * 주먹 · 부채          → attack_fist
 * 칼 · 창 (도끼 · 극 포함) → attack_sword
 * 활                   → attack_arrow
 * 유성추(감녕)         → attack_chain
 * 그 밖(두루마리 · 붓 · 지팡이 · 몽둥이 · 채찍 · 방패 · 옥새 …) → battle_attack 그대로
 * ```
 *
 * **정본은 그림이다** — 사서(史書)의 무기가 아니다. 황충은 활을 등에 메고 있지만 공격 칸은 단검 둘이라
 * 칼 소리다. 표는 `public/actions-hd/*.webp`의 공격 칸(셋째)을 눈으로 하나씩 보고 적었다.
 * 그림을 새로 구우면 이 표도 다시 본다 — 회귀(`attackSfx.test.ts`)는 「표의 id가 실제 장수인가」만 지킨다.
 *
 * 열쇠는 장수 id가 아니라 **그림 열쇠(`artKey`)**다 — 도적 다섯이 `bandit` 한 벌을 함께 쓴다.
 */

import { artKey } from '../ui/art.ts';
import type { SfxId } from './sfx.ts';

export type AttackWeapon = 'fist' | 'sword' | 'arrow' | 'chain';

const FIST = [
  'ak-chwi', 'bang-tong', 'bi-gwan', 'bi-wi', 'bong-gi', 'cho-chok', 'dong-ryang', 'dong-tak',
  'du-seup', 'eom-gang', 'ga-hu', 'gam-taek', 'gan-ong', 'gim-seon', 'go-chang', 'go-ong', 'go-ram',
  'go-sun', 'goe-wol', 'gong-ji', 'gwak-do', 'gwak-ga', 'gwak-jeok', 'gwak-sa', 'gwan-sun',
  'ha-hu-deok', 'ha-hu-geol', 'ha-hu-sang', 'hak-so', 'han-ho', 'han-hyeon', 'han-maeng', 'han-seom',
  'heo-sa', 'heon-je', 'ho-jin', 'hu-ru', 'hwang-gwon', 'i-eom', 'i-gak', 'i-i', 'i-jeok', 'i-pung',
  'i-suk', 'i-yu', 'jang-gi', 'jang-heum', 'jang-mak', 'jang-nam', 'jang-ro', 'jang-so', 'jang-song',
  'jang-wan', 'jang-wi', 'jang-yeon', 'je-gal-geun', 'je-gal-ryang', 'jeo-su', 'jeon-pung',
  'jeong-bong', 'jeong-uk', 'jin-deung', 'jin-gung', 'jin-rim', 'jin-sik', 'jo-beom', 'jo-bi',
  'jo-sun', 'ma-ryang', 'ma-yeon', 'maeng-dal', 'neung-tong', 'no-so', 'o-ban', 'po-ryung', 'seo-seo',
  'seo-seong', 'seol-jong', 'sim-bae', 'son-geon', 'son-gwan', 'son-gwon', 'son-hwan', 'son-yu',
  'sun-sang', 'sun-uk', 'sun-yu', 'u-chik', 'wang-chan', 'wang-chung', 'wang-ru', 'wang-wi', 'wi-sok',
  'won-yun', 'yang-an', 'yang-hoe', 'yang-hyeon', 'yang-im', 'yang-ryeong', 'yeo-geon', 'yeom-po',
  'yu-bong', 'yu-do', 'yu-gi', 'yu-goe', 'yu-hyeon', 'yu-jang', 'yu-jong', 'yu-seon', 'yuk-jeok',
];

const SWORD = [
  'ak-jin', 'an-myeong', 'an-ryang', 'ban-jang', 'bandit', 'bang-deok', 'beon-gung', 'chae-mo',
  'chae-yang', 'chuk-yung', 'dong-so', 'eom-an', 'eom-jun', 'eom-ssang', 'gang-yu', 'gi-ryeong',
  'gong-son-chan', 'guk-ui', 'gwak-jun', 'gwan-hae', 'gwan-heung', 'gwan-u', 'gyeong-mu', 'ha-hu-don',
  'ha-hu-eun', 'ha-hu-ran', 'hak-maeng', 'han-dang', 'han-yeong', 'hu-seong', 'hwa-ung',
  'hwang-chung', 'hwang-gae', 'hyeong-do-yeong', 'i-gyu', 'i-hoe', 'i-jeon', 'i-myeong', 'i-ung',
  'jang-bi', 'jang-hap', 'jang-hoek', 'jang-im', 'jang-mu', 'jang-po', 'jang-ryo', 'jang-su',
  'jang-yun', 'jeong-bo', 'jeong-deok', 'jin-eung', 'jin-gi', 'jin-jang', 'jin-jin', 'jin-mu',
  'jin-son', 'jo-chang', 'jo-ha', 'jo-hong', 'jo-hyu', 'jo-in', 'jo-jam', 'jo-jin', 'jo-jo', 'jo-pyo',
  'jo-seong', 'jo-un', 'ju-chang', 'ju-ryeong', 'ju-tae', 'ju-yeon', 'ma-cho', 'ma-dae', 'ma-deung',
  'maeng-suk', 'mi-bang', 'mo-gae', 'mun-bing', 'mun-chu', 'naeng-po', 'noe-dong', 'o-ran', 'o-ui',
  'sa-jeong', 'sa-ma-ga', 'sa-ma-ui', 'seo-hwang', 'seo-yeong', 'son-gyeon', 'song-heon',
  'sun-u-gyeong', 'tae-sa-ja', 'u-geum', 'wang-cheol', 'wang-hae', 'wang-pyeong', 'wi-yeon', 'won-so',
  'yang-ang', 'yang-su', 'yeo-gwang', 'yeo-mong', 'yeo-po', 'yeo-sang', 'yo-hwa', 'yu-bi', 'yu-byeok',
  'yu-sun',
];

const ARROW = ['ha-hu-yeon', 'ju-yu', 'ma-chung'];

const CHAIN = ['gam-nyeong'];

export const ATTACK_WEAPON: ReadonlyMap<string, AttackWeapon> = new Map<string, AttackWeapon>([
  ...FIST.map((k) => [k, 'fist'] as const),
  ...SWORD.map((k) => [k, 'sword'] as const),
  ...ARROW.map((k) => [k, 'arrow'] as const),
  ...CHAIN.map((k) => [k, 'chain'] as const),
]);

/** 이 장수가 평타를 칠 때 낼 소리. 표에 없으면 예전 소리(`battle_attack`)다. */
export function attackSfxFor(officerId: string): SfxId {
  const w = ATTACK_WEAPON.get(artKey(officerId));
  return w ? `attack_${w}` : 'battle_attack';
}
