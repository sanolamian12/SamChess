/**
 * **열 머리를 눌러 정렬한다** (2026-11-19 기획자 — 장수 일람에서 시작, 「정렬 필터」 단추 · 지금 기준 나무판을 걷었다).
 *
 * - 열 머리(글자든 아이콘이든)를 누르면 그 열에 **초록 네온**이 들어오고, 한 번 더 누르면 **주홍 네온**으로 바뀐다(그 뒤로 번갈아).
 *   다른 열을 누르면 그 열이 초록으로 시작한다.
 * - **초록이 「그 열의 자연스러운 순서」**다 — 이름은 가나다(알파벳)순, 숫자는 큰 것이 위. 주홍은 그 반대.
 *   어느 쪽이 자연스러운지는 부르는 쪽이 비교 함수로 정한다(`flip`이면 뒤집어 쓴다).
 * - 지금 기준은 네온이 말한다 — 따로 「지금 정렬: 무력」 같은 글자를 두지 않는다.
 * - 검사는 `data-sort`(열) · `data-neon`(`green` | `orange`)로 건다.
 */

import { useState } from 'react';

export type Neon = 'green' | 'orange';

export interface ColumnSort<K extends string> {
  key: K;
  /** 주홍 — 자연스러운 순서를 뒤집는다 */
  flip: boolean;
  click: (key: K) => void;
}

export function useColumnSort<K extends string>(initial: K): ColumnSort<K> {
  const [state, setState] = useState<{ key: K; flip: boolean }>({ key: initial, flip: false });
  const click = (key: K): void => setState((s) => (s.key === key ? { key, flip: !s.flip } : { key, flip: false }));
  return { ...state, click };
}

export function SortHead<K extends string>({ col, sort, label, className, children }: {
  col: K;
  sort: ColumnSort<K>;
  /** 화면에 읽히는 이름 — 아이콘 머리의 `title` · `aria-label` */
  label: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const on = sort.key === col;
  const neon: Neon | undefined = on ? (sort.flip ? 'orange' : 'green') : undefined;
  return (
    <button
      type="button"
      className={`sort-head${className ? ` ${className}` : ''}`}
      data-sort={col}
      data-neon={neon}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => sort.click(col)}
    >
      {children}
    </button>
  );
}
