/**
 * S급 튜토리얼 판 — 그 장수의 고유기술을 써 보는 판 (`Design/튜토리얼_시나리오_초안.md` §4, 2026-10-24~).
 *
 * 판 하나는 `tutorialS/{장수 id}.ts` 하나다 — 공통 손은 `tutorialS/common.ts`. 여기는 **모으기만** 한다.
 * 기본 튜토리얼과 같은 틀이다: 장수 · 자리 · 시작 값은 데이터에 고정, 시드 고정, 대본(`guide`)을 그대로 두면 이기는지
 * 회귀(`tutorialSBattles.test.ts`)가 판마다 본다. 대본이 끝난 차례는 모든 명령이 켜진다.
 * 여기 없는 장수의 판은 목록에서 「준비 중」이다(`tutorialReady`).
 */

import type { TutorialStage } from './tutorialBattles.ts';
import { bangDeok } from './tutorialS/bang-deok.ts';
import { bangTong } from './tutorialS/bang-tong.ts';
import { gaHu } from './tutorialS/ga-hu.ts';
import { gamNyeong } from './tutorialS/gam-nyeong.ts';
import { gangYu } from './tutorialS/gang-yu.ts';
import { gwakGa } from './tutorialS/gwak-ga.ts';
import { gwanU } from './tutorialS/gwan-u.ts';
import { haHuDon } from './tutorialS/ha-hu-don.ts';
import { heoJeo } from './tutorialS/heo-jeo.ts';
import { hwangChung } from './tutorialS/hwang-chung.ts';
import { jangBi } from './tutorialS/jang-bi.ts';
import { jangHap } from './tutorialS/jang-hap.ts';
import { jangRyo } from './tutorialS/jang-ryo.ts';
import { jeGalRyang } from './tutorialS/je-gal-ryang.ts';
import { joJo } from './tutorialS/jo-jo.ts';
import { joUn } from './tutorialS/jo-un.ts';
import { juYu } from './tutorialS/ju-yu.ts';
import { maCho } from './tutorialS/ma-cho.ts';
import { noSuk } from './tutorialS/no-suk.ts';
import { saMaUi } from './tutorialS/sa-ma-ui.ts';
import { seoHwang } from './tutorialS/seo-hwang.ts';
import { seoSeo } from './tutorialS/seo-seo.ts';
import { sonGwon } from './tutorialS/son-gwon.ts';
import { sonGyeon } from './tutorialS/son-gyeon.ts';
import { sunUk } from './tutorialS/sun-uk.ts';
import { taeSaJa } from './tutorialS/tae-sa-ja.ts';
import { yeoMong } from './tutorialS/yeo-mong.ts';
import { yeoPo } from './tutorialS/yeo-po.ts';
import { yuBi } from './tutorialS/yu-bi.ts';
import { yukSon } from './tutorialS/yuk-son.ts';

/** 판이 선 S급 — 장수 id → 판. 여기 없으면 「준비 중」 */
export const S_STAGES: Readonly<Record<string, () => TutorialStage[]>> = {
  'bang-deok': bangDeok,
  'bang-tong': bangTong,
  'ga-hu': gaHu,
  'gam-nyeong': gamNyeong,
  'gang-yu': gangYu,
  'gwak-ga': gwakGa,
  'gwan-u': gwanU,
  'ha-hu-don': haHuDon,
  'heo-jeo': heoJeo,
  'hwang-chung': hwangChung,
  'jang-bi': jangBi,
  'jang-hap': jangHap,
  'jang-ryo': jangRyo,
  'je-gal-ryang': jeGalRyang,
  'jo-jo': joJo,
  'jo-un': joUn,
  'ju-yu': juYu,
  'ma-cho': maCho,
  'no-suk': noSuk,
  'sa-ma-ui': saMaUi,
  'seo-hwang': seoHwang,
  'seo-seo': seoSeo,
  'son-gwon': sonGwon,
  'son-gyeon': sonGyeon,
  'sun-uk': sunUk,
  'tae-sa-ja': taeSaJa,
  'yeo-mong': yeoMong,
  'yeo-po': yeoPo,
  'yu-bi': yuBi,
  'yuk-son': yukSon,
};
