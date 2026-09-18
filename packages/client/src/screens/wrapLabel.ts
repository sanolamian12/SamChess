/**
 * 도시 지도의 이름표 밑줄을 줄로 나눈다 (2026-09-18 기획자 지정).
 *
 * SVG `<text>`는 스스로 줄바꿈을 안 한다 — 한국어로는 한 줄에 들어가던 소개가
 * 몽골어·유럽어로는 두세 배 길어져 이웃 건물 위로 넘치거나 화면 밖으로 잘렸다.
 *
 * **단어 단위로** 끊는다 — 한 줄이 `max`자를 넘게 되면 그 단어부터 다음 줄로.
 * 띄어쓰기가 없는 말(일본어·중국어)은 한 단어가 `max`보다 길 때만 글자 수로 자른다
 * (그 말에서는 글자가 곧 끊을 수 있는 단위다).
 */
import type { Lang } from '../i18n/index.ts';

/**
 * 언어별 한 줄 글자 수 (2026-09-18 기획자 지정). 로마자 언어는 단어가 길어
 * 15자로는 대개 세 줄이 돼서 20자로 넓혔다. 몽골어는 15자로 확정이고,
 * 한국어·일본어·중국어는 글자가 넓어 15자 그대로다.
 */
const WIDE: ReadonlySet<Lang> = new Set(['en', 'es_419', 'it', 'pt_BR', 'pt_PT']);
export const labelWrapWidth = (lang: Lang): number => (WIDE.has(lang) ? 20 : 15);

export function wrapLabel(text: string, max = 15): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const chars = [...word];
    if (chars.length > max) {
      if (line) { lines.push(line); line = ''; }
      for (let i = 0; i < chars.length; i += max) {
        const chunk = chars.slice(i, i + max).join('');
        // 마지막 조각은 뒤따르는 단어와 한 줄을 나눠 쓸 수 있다
        if (i + max < chars.length) lines.push(chunk);
        else line = chunk;
      }
      continue;
    }
    const next = line ? `${line} ${word}` : word;
    if (line && [...next].length > max) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
