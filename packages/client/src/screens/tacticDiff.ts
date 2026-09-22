/**
 * 원본 → 개량형 설명의 **바뀐 곳만** 가른다 — 태학 카드의 「~~1회~~ 2회」 (2026-09-22 기획자 지정).
 *
 * 개량은 거의 늘 숫자 하나(「1회 → 2회」 · 「20% → 30%」 · 「2일 → 3일」)라 문장 전체를 두 번
 * 적으면 어디가 바뀌었는지 눈으로 찾아야 한다. 그래서 둘을 토막 내 **최장 공통 부분열(LCS)**로
 * 맞추고, 원본에만 있는 토막은 `del`(취소선), 개량형에만 있는 토막은 `ins`(빨간 글자)로 낸다.
 *
 * **토막은 언어를 가리지 않게 자른다** — 숫자(소수·%까지 한 덩이) · 라틴 낱말 · 공백 · 그 밖의
 * 글자 하나. 한국어·일본어·중국어는 글자 단위라 「攻撃1回」→「攻撃2回」가 「~~1~~2」로 나오고,
 * 영어는 낱말 단위라 「attack」→「2 attacks」가 통째로 갈린다. 번역마다 규칙을 따로 두지 않는다.
 *
 * 화면(React)을 모르는 순수 함수라 `client/test/`가 그대로 부른다.
 */

export type DiffPart = { kind: 'same' | 'del' | 'ins'; text: string };

const TOKEN = /\d+(?:\.\d+)?%?|[A-Za-zÀ-ÿ']+|\s+|[^\s]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/**
 * `before` → `after`의 차이. 같은 종류가 이어지면 하나로 붙인다. 둘이 같으면 `same` 하나다.
 *
 * 바뀐 자리 하나에서 **지운 것이 먼저, 넣은 것이 뒤**다 — 「~~1회~~ 2회」로 읽히게.
 */
export function diffText(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  // lcs[i][j] = a[i..]와 b[j..]의 공통 부분열 길이 — 설명은 한두 문장이라 표가 작다
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string): void => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { push('same', a[i]!); i++; j++; }
    else if (j >= b.length || (i < a.length && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) { push('del', a[i]!); i++; }
    else { push('ins', b[j]!); j++; }
  }
  return reorder(out);
}

/** 붙어 있는 `ins`·`del`은 **지운 것을 앞으로** — LCS의 걷는 순서에 따라 뒤집혀 나올 수 있다 */
function reorder(parts: DiffPart[]): DiffPart[] {
  for (let k = 0; k + 1 < parts.length; k++) {
    if (parts[k]!.kind === 'ins' && parts[k + 1]!.kind === 'del') {
      [parts[k], parts[k + 1]] = [parts[k + 1]!, parts[k]!];
    }
  }
  return parts;
}
