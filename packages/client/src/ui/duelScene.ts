/**
 * 일기토 · 설전 연출 그림 — 어느 장면을 · 어느 장수 그림으로 (2026-11-06 기획자)
 *
 * 그림은 장면마다 1024² 한 장이고 **언제나 왼쪽이 주인공**이다(`assets/duel/bg/{종류}/{종류}_{묶음}_{1~6}.png.jpg` →
 * `npm run duel` → `public/duel/scene/{묶음}-{n}.jpg` · 설전은 `public/duel/scene/debate/{묶음}-{n}.jpg`). 화면은 **내 그림의 왼쪽 반 + 상대 그림을 뒤집은 오른쪽 반**을
 * 찢긴 종이 선으로 잇는다 — 두 장수가 다 제 얼굴로 선다. 뒤집으면 뜻이 맞바뀌므로 상대 쪽은 `MIRROR`로 짝을 고른다.
 *
 * | n | 장면 (왼쪽 = 나) | 상대 그림 |
 * |---|---|---|
 * | 1 | 첫 격돌 · 비김 | 1 |
 * | 2 | 내가 공격권 | 3 |
 * | 3 | 상대가 공격권 | 2 |
 * | 4 | 내 패배 · 도망 | 5 |
 * | 5 | 내 승리 | 4 |
 * | 6 | 10합 결판 없음 | 6 |
 *
 * 1 · 2 · 3은 이음매 가운데서 섬광이 터진다(1은 크게, 2 · 3은 작게 — 기획자). 일기토는 칼 섬광, 설전은 먹 튐.
 * 묶음은 종류마다 따로다 — 일기토에 제 그림이 있어도 설전에는 없을 수 있고(허저 · 서황 …), 그 반대도 있다(육손 · 곽가 …).
 */

import type { DuelKind, DuelRoundResult } from '@samchess/rules';

export type DuelScene = 1 | 2 | 3 | 4 | 5 | 6;

/** 뒤집은 상대 그림의 장면 — 뒤집으면 「주인공이 공격」이 「상대가 공격」으로 읽힌다 */
export const MIRROR: Readonly<Record<DuelScene, DuelScene>> = { 1: 1, 2: 3, 3: 2, 4: 5, 5: 4, 6: 6 };

/** 이음매 섬광 — 장면마다 그림 폭에 대한 크기. 없으면 안 터진다 */
export const SCENE_FLASH: Readonly<Partial<Record<DuelScene, number>>> = { 1: 0.42, 2: 0.28, 3: 0.28 };

/** 제 그림이 있는 장수 — 겹쳐 쓰지 않는다(기획자). 화웅 · 사마의는 뽑아 보고 접었다 */
const OWN = new Set([
  'yeo-po', 'gwan-u', 'jang-bi', 'jo-un', 'ma-cho', 'hwang-chung', 'ha-hu-don', 'chuk-yung', 'jo-jo', 'je-gal-ryang', 'ju-yu',
  'heo-jeo', 'seo-hwang', 'i-myeong', 'mun-chu', 'jang-hap', 'bang-deok', 'yu-bi', 'son-gwon', 'gam-nyeong', 'jang-ryo',
]);

/** 노장 공용 — 흰 수염이 가장 큰 특징인 장수(문관 노인도 여기) */
const VETERAN = new Set(['hwang-gae', 'eom-an', 'do-gyeom', 'yu-pyo', 'song-chung', 'go-ong', 'chae-jung']);

/**
 * 책사 공용 — 말 탄 책사. **생김새로 골랐다**(초상이 도포 · 관 차림, 갑옷이 없다). 지력 > 무력으로는 못 가른다 —
 * 강유 · 여몽 · 육손 · 정보 · 손권은 지력이 높아도 갑옷을 입었다.
 */
const SAGE = new Set([
  'ga-hu', 'gwak-ga', 'sun-uk', 'sun-yu', 'seo-seo', 'bang-tong', 'sa-ma-ui', 'sa-ma-sa', 'sa-ma-so', 'no-suk', 'jang-so', 'jang-song',
  'jang-wan', 'bi-wi', 'ma-ryang', 'ma-sok', 'beop-jeong', 'jin-gung', 'jeon-pung', 'jeo-su', 'jeong-uk', 'je-gal-geun', 'yu-yeop', 'i-yu',
  'man-chong', 'gam-taek', 'gan-ong', 'gong-yung', 'gong-ji', 'gwak-do', 'gwak-jeok', 'gwan-sun', 'goe-wol', 'no-so', 'deung-hyeon',
  'mi-chuk', 'bo-jeul', 'bong-gi', 'seo-sang', 'seol-jong', 'son-geon', 'son-gwan', 'son-yu', 'sin-myeong', 'sim-bae', 'yang-song',
  'yang-su', 'yang-an', 'eom-ssang', 'yeo-beom', 'o-ban', 'wang-hae', 'wang-ru', 'wang-bo', 'wang-wi', 'wang-chan', 'wang-chung',
  'u-beon', 'u-chik', 'won-sul', 'won-yun', 'yu-goe', 'yu-gi', 'yu-dae', 'yu-do', 'yu-seon', 'yuk-jeok', 'i-suk', 'i-jeok', 'i-pung',
  'i-hoe', 'jang-ro', 'jo-ru', 'jo-beom', 'jo-sik', 'jo-ha', 'ju-gang', 'ju-bi', 'jin-gyo', 'jin-gi', 'jin-deung', 'jin-rim', 'jin-jin',
  'cha-ju', 'po-ryung', 'hak-so', 'han-seom', 'han-ho', 'han-hyeon', 'heo-sa', 'heo-yu', 'hwang-gwon', 'hu-ru', 'heon-je', 'gong-son-wol',
]);

/**
 * 설전에서 제 그림이 있는 장수 (2026-11-06 기획자). 갑옷 차림 무인은 디폴트가 맡는다.
 * 순욱은 뽑아 보니 노숙과 비슷비슷해 접었다 → 책사 공용(= 노숙 그림).
 */
const DEBATE_OWN = new Set([
  'yeo-po', 'gwan-u', 'jang-bi', 'jo-un', 'ma-cho', 'hwang-chung', 'ha-hu-don', 'chuk-yung', 'jo-jo', 'je-gal-ryang', 'ju-yu',
  'i-myeong', 'yu-bi', 'son-gwon', 'jang-ryo', 'yuk-son', 'sa-ma-ui', 'ga-hu', 'gwak-ga', 'bang-tong', 'no-suk',
]);

/** 설전의 책사 공용은 따로 그리지 않고 노숙 그림을 함께 쓴다 (기획자) */
const DEBATE_SAGE = 'no-suk';

/** 장수의 그림 묶음 — 제 그림 · 노장 · 책사 · 디폴트(나머지 무장 전부, 도적 포함) */
export function sceneSet(officer: string, kind: DuelKind = 'duel'): string {
  if (kind === 'debate') {
    if (DEBATE_OWN.has(officer)) return officer;
    if (VETERAN.has(officer)) return 'veteran';
    if (SAGE.has(officer)) return DEBATE_SAGE;
    return 'default';
  }
  if (OWN.has(officer)) return officer;
  if (VETERAN.has(officer)) return 'veteran';
  if (SAGE.has(officer)) return 'sage';
  return 'default';
}

/** 묶음 전부 — 굽기 · 미리 받기 · 회귀가 같은 목록을 본다 */
export const SCENE_SETS: Readonly<Record<DuelKind, readonly string[]>> = {
  duel: ['default', 'sage', 'veteran', ...OWN],
  debate: ['default', 'veteran', ...DEBATE_OWN],
};

/**
 * 합 하나의 장면 — `holder`는 **그 합 전**의 공격권자다(엔진의 `duelRound` 그대로). 맞히면 그쪽이 몰아붙인 것이고,
 * 공격권이 넘어가면 반대쪽이 기세를 잡은 것이다.
 */
export function sceneOfRound(result: DuelRoundResult, holderIsLeft: boolean): DuelScene {
  if (result === 'tie') return 1;
  const leftPushes = result === 'hit' ? holderIsLeft : !holderIsLeft;
  return leftPushes ? 2 : 3;
}

/** 끝 장면 — 이긴 쪽이 없으면(10합) 6 */
export function sceneOfEnd(leftWon: boolean | null): DuelScene {
  return leftWon === null ? 6 : leftWon ? 5 : 4;
}

/** 그림 주소 — 왼쪽은 내 묶음의 n, 오른쪽은 상대 묶음의 `MIRROR[n]`(화면이 뒤집는다) */
export function sceneUrls(kind: DuelKind, n: DuelScene, leftOfficer: string, rightOfficer: string): { left: string; right: string } {
  const dir = kind === 'duel' ? 'duel/scene' : 'duel/scene/debate';
  return { left: `${dir}/${sceneSet(leftOfficer, kind)}-${n}.jpg`, right: `${dir}/${sceneSet(rightOfficer, kind)}-${MIRROR[n]}.jpg` };
}
