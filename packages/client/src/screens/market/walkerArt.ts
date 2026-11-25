/**
 * 장수 레벨업 카드(잉여 카드 모집) 연출의 실루엣 — 받는 장수가 **무엇을 드는가**로 고른다 (2026-11-25 기획자).
 *
 * ```
 * 창 · 극 · 언월도 · 삼지창 (긴 자루)   → recruit_walker_1
 * 부채                                 → recruit_walker_2
 * 그 밖(주먹 · 두루마리 · 붓 · 지팡이 · 채찍 · 몽둥이 · 방패 · 유성추 …) → recruit_walker_3
 * 칼 · 도끼 · 쌍구                      → recruit_walker_4
 * 활                                   → recruit_walker_5
 * ```
 *
 * **정본은 꼬마 그림이다** — 평상 칸과 공격 칸(`public/actions-hd/*.webp`의 첫째 · 셋째)을 함께 놓고 눈으로 하나씩 보고 적었다
 * (평타 소리 표 `audio/attackSfx.ts`와 같은 방식. 그쪽은 부채를 주먹과, 창을 칼과 한 묶음으로 둬서 따로 적었다).
 * 황충은 공격 칸이 단검이지만 활을 메고 서 있어 활이다 — 실루엣은 「서 있는 모습」이다.
 * 그림을 새로 구우면 이 표도 다시 본다. 열쇠는 그림 열쇠(`artKey`)다.
 *
 * **장수 모집(1 · 3 · 5명)에는 쓰지 않는다** — 그쪽은 누가 올지 모르는 연출이라 실루엣이 자리에 붙는다(`recruitSeats.ts`).
 */

import { artKey } from '../../ui/art.ts';

const SPEAR = [
  'ak-jin', 'an-myeong', 'an-ryang', 'bang-deok', 'beon-gung', 'chae-mo', 'chuk-yung', 'dong-so', 'eom-an', 'gang-yu',
  'gi-ryeong', 'gong-son-chan', 'guk-ui', 'gwan-hae', 'gwan-heung', 'gwan-u', 'ha-hu-don', 'han-dang', 'hwang-gae',
  'hyeong-do-yeong', 'i-hoe', 'i-jeon', 'jang-bi', 'jang-hap', 'jang-im', 'jang-po', 'jang-ryo', 'jo-hong', 'jo-hyu',
  'jo-jin', 'jo-seong', 'jo-un', 'ju-chang', 'ju-yeon', 'ma-cho', 'ma-dae', 'ma-deung', 'mi-bang', 'mo-gae', 'mun-bing',
  'naeng-po', 'noe-dong', 'o-ran', 'seo-yeong', 'son-gyeon', 'song-heon', 'tae-sa-ja', 'wi-yeon', 'yeo-mong', 'yeo-po',
  'yu-sun', 'yuk-son',
];

const FAN = [
  'bang-tong', 'ga-hu', 'gan-ong', 'gwan-sun', 'heo-sa', 'i-pung', 'jang-so', 'je-gal-ryang', 'jeong-uk', 'jin-deung',
  'jin-rim', 'ma-ryang', 'man-chong', 'sin-myeong', 'son-gwon', 'sun-sang', 'sun-uk', 'wang-wi', 'yu-goe', 'yuk-jeok',
];

const SWORD = [
  'ban-jang', 'bandit', 'chae-yang', 'eom-jun', 'eom-ssang', 'gwak-jun', 'gyeong-mu', 'ha-hu-eun', 'ha-hu-ran',
  'hak-maeng', 'han-yeong', 'hu-seong', 'hwa-ung', 'i-gyu', 'i-myeong', 'i-ung', 'jang-hoek', 'jang-mu', 'jang-su',
  'jang-yun', 'jeong-bo', 'jeong-deok', 'jin-eung', 'jin-gi', 'jin-jang', 'jin-jin', 'jin-mu', 'jin-son', 'jo-chang',
  'jo-ha', 'jo-in', 'jo-jam', 'jo-jo', 'jo-pyo', 'ju-ryeong', 'ju-tae', 'maeng-suk', 'mun-chu', 'o-ui', 'sa-jeong',
  'sa-ma-ga', 'sa-ma-ui', 'seo-hwang', 'sun-u-gyeong', 'u-geum', 'wang-cheol', 'wang-hae', 'wang-pyeong', 'won-so',
  'yang-ang', 'yang-su', 'yeo-gwang', 'yeo-sang', 'yo-hwa', 'yu-bi', 'yu-byeok',
];

const BOW = ['ha-hu-yeon', 'hwang-chung', 'ju-yu', 'ma-chung'];

/** 실루엣 그림 번호(`ui/intro-recruit-walker-{n}.png`) — 창 1 · 부채 2 · 그 밖 3 · 칼 4 · 활 5 */
export const WALKER_BY_WEAPON: ReadonlyMap<string, number> = new Map([
  ...SPEAR.map((id) => [id, 1] as const),
  ...FAN.map((id) => [id, 2] as const),
  ...SWORD.map((id) => [id, 4] as const),
  ...BOW.map((id) => [id, 5] as const),
]);

/** 이 장수의 실루엣 — 표에 없으면 그 밖(3) */
export const walkerArtOf = (officer: string): number => WALKER_BY_WEAPON.get(artKey(officer)) ?? 3;
