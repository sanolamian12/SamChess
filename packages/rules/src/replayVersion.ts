/**
 * 리플레이 버전 (2026-10-28, GDD §8.8 단계 5) — 「이 기록을 지금의 엔진으로 다시 두면 그때와 같은 판이 나오는가」.
 *
 * 방어 기록은 판의 사건이 아니라 **시드 · 명단 · 배치 · 공격자의 수**만 적는다(가볍다). 그 수를 지금의 엔진으로 다시 두므로
 * 규칙이 바뀌면 판이 갈린다 — 그래서 기록마다 이 값을 남기고, 지금 값과 다르면 화면은 결과만 보여 준다(기획자 확정).
 *
 * 두 몫이다.
 *  - **데이터 몫(`DATA_HASH`)은 저절로 바뀐다** — 판에 들어가는 JSON(장수 능력 · 기물 · 책략 · 고유기술 · 성장 · 장비 · 아이템 · 도적 · 컬렉션)을
 *    글자(이름 · 설명 · 번역 · 그림)를 빼고 해시한다. 엑셀 수치를 고치면 따라 바뀌고, 설명 문장만 고치면 안 바뀐다.
 *  - **엔진 몫(`ENGINE_REVISION`)은 손으로 올린다** — 코드가 결과를 바꾸는지는 해시로 못 본다. 잊히지 않게 `test/replayVersion.test.ts`의
 *    **황금 재생**(고정 판 몇 개를 끝까지 둔 끝 상태)이 깨지며 「올렸는가」를 묻는다.
 *
 * 시계 · 난수를 안 쓴다(룰 엔진의 규약 그대로).
 */

import {
  CITY_RULES, COLLECTIONS, EQUIPMENT, GROWTH, MARKET_ITEMS, OFFICERS, PIECES, RAID, TACTICS, TACTIC_UPGRADES, UNIQUE_SKILLS,
} from '@samchess/data';
import { FORMULA } from './types.ts';

/**
 * **엔진이 같은 수에서 다른 판을 내도록 바뀌면 하나 올린다** — 공식 · AI(`takeTurn`) · 판정 순서 · 효과 해석기 무엇이든.
 * 올리면 그 전 기록은 「이전 규칙의 판」이 된다(다시 보기가 꺼진다). 황금 재생이 깨지면 여기부터 본다.
 */
export const ENGINE_REVISION = 4;
// 2 (2026-10-31) — 수비군 방침 AI의 걸음을 「칠 수 있으면 공격 먼저」로 바꿨다(`policy.ts`). 수성전 방어 기록이 다른 판이 된다
// (2026-11-05) SP MAX 버프(GDD §3.11 R15)는 상한에 닿은 채 친 판의 피해를 바꾸지만 **안 올렸다** — 대결 수치를 `FORMULA`에 더해
// 데이터 몫(`DATA_HASH`)이 이미 바뀌어 옛 기록은 막혔고, 황금 재생의 네 판은 상한에서 친 적이 없어 지문이 그대로다
// 3 (2026-11-05) — 기본 AI가 SP MAX 버프를 셈에 넣는다(죽일 수 있는가 · 노릴 적) · 자동 대전(`autoBattle`)에 일기토 · 설전이 든다(GDD §3.11 단계 2)
// 4 (2026-11-05) — 사람과 두는 AI 대전에서 AI가 일기토 · 설전을 걸고 답하고 도망한다(재생 `replayLocalMatch` · 방어 기록, GDD §3.11 단계 3a). 황금 재생에 그 길(대본 사람)을 더했다
// (2026-11-09) 불 칸(화계)이 0.9일마다 1 → 1일마다 2 · 불이 꺼지는 시각(`expiresAt`)을 엔진이 정산한다(육손 「화소연영」의 새 불) — **안 올렸다**.
// 같은 날 화소연영 · 세한지송백 데이터를 바꿔 데이터 몫이 이미 바뀌었고(옛 기록은 막혔다), 황금 재생의 판들은 불을 안 써 지문이 그대로다.
// 같은 날 순욱 「구호탄랑」의 「책략까지」 조종(조종당한 적의 명상 · 책략 · 아이템, 효과는 조종하는 쪽의 눈)도 안 올렸다 — 데이터 몫이 같이 바뀌었고 기본 AI는 그 길을 안 쓴다
// (2026-11-10) 「삼고초려로 넘어간 King만 남으면 그 자리에서 진다」(`checkEnd`)도 **안 올렸다** — 황금 재생의 판들은 그 길을 안 지나 지문이
// 그대로다(올리면 시험이 「공연히 막는다」고 떨어진다). 그 길을 지난 옛 기록은 같은 편이 같은 군주 격파로 이기되 더 일찍 끝난다 — 승패는 안 갈린다

/** 판에 영향이 없는 글자 칸 — 해시에서 뺀다(번역 · 설명을 고쳐도 옛 기록을 살린다) */
const TEXT_KEYS = new Set([
  'name', 'hanja', 'text', 'nameI18n', 'textI18n', 'lore', 'loreI18n', 'imagePrompt', 'story', 'courtesyName', 'portrait', 'art',
  'faction', 'banditNames', 'title', 'titleI18n', 'desc', 'descI18n', 'detail', 'detailI18n', 'effectText',
]);

/** 키를 정렬해 적는다 — 같은 값이면 언제나 같은 글자 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>).filter((k) => !TEXT_KEYS.has(k)).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** FNV-1a 32비트 — 암호용이 아니라 「바뀌었나」를 보는 지문이다 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 판에 들어가는 데이터의 지문 */
export const DATA_HASH = fnv1a(stable({
  OFFICERS, UNIQUE_SKILLS, PIECES, TACTICS, TACTIC_UPGRADES, GROWTH, CITY_RULES, EQUIPMENT, MARKET_ITEMS, RAID, COLLECTIONS, FORMULA,
}));

/** 기록에 남기는 값 — 지금 값과 같아야 다시 볼 수 있다 */
export const REPLAY_VERSION = `${ENGINE_REVISION}.${DATA_HASH}`;

/** 그 기록을 지금 다시 둘 수 있는가 — 버전을 안 적은 옛 기록(`null`)은 못 둔다 */
export const replayable = (version: string | null | undefined): boolean => version === REPLAY_VERSION;
