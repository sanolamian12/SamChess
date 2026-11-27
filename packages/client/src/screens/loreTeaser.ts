/**
 * 장수 열전의 첫머리 — 장수 상세의 접힌 판(`.ofcard-lore`)에 「첫 문장 (더보기)」로 싣는다 (2026-11-27 기획자).
 *
 * 첫 문장(마침표 · 。 · ！ · ？까지)이 짧으면 그대로, 길면 첫 쉼표까지, 그래도 길면 낱말 경계에서 잘라 「…」를 붙인다.
 * 상한은 글자 폭으로 가른다 — 한자 · 한글 · 가나는 한 글자가 넓다(`WIDE`). 판은 두 줄 자리라 이 상한이 두 줄에 든다
 * (가장 긴 언어 · 가장 긴 첫 문장으로 잰 값 — `tools/lore_popup_fit.ts`).
 */

/** 넓은 글자(한글 · 가나 · 한자) 하나 = 좁은 글자 둘로 센다 */
const WIDE = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-鿿가-힯＀-￯]/;
/** 접힌 판에 싣는 첫머리의 상한 — 좁은 글자 기준 */
export const TEASER_MAX = 28;   // 두 번째 판(납작한 4.4 : 1)에서 「첫머리 + (더보기)」가 두 줄에 들게 — 44는 라틴 문자에서 세 줄, 28에서 몽골어는 꼬리 「(дэлгэрэнгүй)」가 길어 「(цааш)」로 줄였다(`tools/lore_popup_fit.ts`)

function width(s: string): number {
  let n = 0;
  for (const ch of s) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

/** 폭 상한 안에서 자른다 — 띄어쓰기가 있으면 낱말 경계에서 */
function clip(s: string, max: number): string {
  let out = '';
  for (const ch of s) {
    if (width(out + ch) > max) break;
    out += ch;
  }
  const sp = out.lastIndexOf(' ');
  if (sp > out.length * 0.5) out = out.slice(0, sp);
  return out.replace(/[\s,，、·:;]+$/u, '') + '…';
}

export function loreTeaser(story: string, max = TEASER_MAX): string {
  const text = story.trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const m = /^.+?[.。．!?！？](?=\s|$|[^\d])/u.exec(text);
  const first = (m ? m[0] : text).trim();
  if (width(first) <= max) return first;
  const comma = /^.+?[,，、](?=\s|[^\d])/u.exec(first);
  if (comma && width(comma[0]) <= max) return comma[0].replace(/[,，、]$/u, '') + '…';
  return clip(first, max);
}
