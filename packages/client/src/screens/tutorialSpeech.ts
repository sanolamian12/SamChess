/**
 * 튜토리얼에서 **사람(무관 · 학사)이 말할 때의 장 나누기** (2026-11-13 기획자) — 사람의 말풍선은 옛 안내판보다 길어 한 번에 더 말할 수 있다.
 * 이어진 **평범한 문장 장**을 모아 **두 문장까지** 한 장으로 묶는다(너무 길지 않게). 문장 수는 지금 언어의 글로 센다 — 마침표 · 느낌표 · 물음표.
 *
 * 묶지 않는 장 — 등장인물의 대사(`GuideSay`), 판때기를 비추는 장(`GuideNote` — 장마다 비추는 자리가 다르다). 그 장들은 홀로 선다.
 * 묶은 장의 열쇠(`lineKey`)는 **마지막 문장의 열쇠**다 — 스모크가 판의 끝(`lastLine`)을 마지막 열쇠로 알아보고, 대본 순서도 그대로다.
 * 글은 `speechText()`로 — 묶은 문장들을 줄을 바꿔 잇는다.
 */
import type { GuideLine } from '@samchess/meta';

/** 묶은 장 → 그 안의 문장 열쇠들 */
const merged = new WeakMap<object, readonly string[]>();

/** 한 글의 문장 수 — 끝맺음 부호(. ! ? 。 ！ ？) 뒤가 공백 · 끝인 자리를 센다. 없어도 1 */
export const sentenceCount = (text: string): number =>
  Math.max(1, (text.match(/[.!?。！？](?=\s|$)/g) ?? []).length);

/** 이어진 평범한 문장 장을 두 문장까지 묶는다. `tr`은 열쇠 → 지금 언어의 글 */
export function speechPages(keys: readonly GuideLine[], tr: (key: string) => string, max = 2): GuideLine[] {
  const out: GuideLine[] = [];
  let group: string[] = [];
  let count = 0;
  const flush = (): void => {
    if (group.length === 0) return;
    if (group.length === 1) out.push(group[0]!);
    else {
      const page = { note: group[group.length - 1]! };
      merged.set(page, group);
      out.push(page);
    }
    group = []; count = 0;
  };
  for (const line of keys) {
    if (typeof line !== 'string') { flush(); out.push(line); continue; }
    const n = sentenceCount(tr(line));
    if (group.length > 0 && count + n > max) flush();
    group.push(line); count += n;
  }
  flush();
  return out;
}

/** 그 장을 사람이 말할 글 — 묶은 장이면 문장들을 줄을 바꿔 잇는다 */
export function speechText(line: GuideLine, tr: (key: string) => string): string {
  const keys = typeof line === 'object' ? merged.get(line) : undefined;
  if (keys) return keys.map(tr).join('\n');
  return tr(typeof line === 'string' ? line : 'say' in line ? line.say : line.note);
}
