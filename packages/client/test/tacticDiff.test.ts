/**
 * 태학 카드의 「원본 → 개량」 표시 (2026-09-22) — 바뀐 곳만 취소선/빨간 글자로 갈라지는가.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { TACTIC_UPGRADES, tacticById } from '@samchess/data';
import { diffText } from '../src/screens/tacticDiff.ts';

const show = (a: string, b: string): string =>
  diffText(a, b).map((p) => (p.kind === 'same' ? p.text : p.kind === 'del' ? `[-${p.text}]` : `[+${p.text}]`)).join('');

test('숫자 하나만 바뀌면 그 숫자만 갈린다 — 한국어', () => {
  assert.equal(show('아군 1명의 1회 공격을 Critical 100%로 만든다', '아군 1명의 2회 공격을 Critical 100%로 만든다'),
    '아군 1명의 [-1][+2]회 공격을 Critical 100%로 만든다');
  assert.equal(show('HP를 최대 체력의 20% 회복', 'HP를 최대 체력의 30% 회복'), 'HP를 최대 체력의 [-20%][+30%] 회복');
  assert.equal(show('적군 1명의 WT +0.5일, HP 1 감소', '적군 1명의 WT +0.7일, HP 2 감소'),
    '적군 1명의 WT +[-0.5][+0.7]일, HP [-1][+2] 감소');
});

test('같은 문장이면 바뀐 곳이 없다 — MP만 내린 개량(화계+ 등)', () => {
  assert.deepEqual(diffText('적군 1명의 WT +1일', '적군 1명의 WT +1일'), [{ kind: 'same', text: '적군 1명의 WT +1일' }]);
});

test('일본어·중국어는 글자 단위, 영어는 낱말 단위로 갈린다', () => {
  assert.equal(show('味方1体の攻撃1回をCritical 100%にする。', '味方1体の攻撃2回をCritical 100%にする。'),
    '味方1体の攻撃[-1][+2]回をCritical 100%にする。');
  assert.equal(show('For 2 days, one enemy', 'For 3 days, one enemy'), 'For [-2][+3] days, one enemy');
});

test('개량형 15종 × 원본 — 차이를 이어 붙이면 양쪽 문장이 그대로 돌아온다 (열 언어)', () => {
  for (const up of TACTIC_UPGRADES) {
    const base = tacticById.get(up.base!)!;
    const pairs: [string, string][] = [[base.text, up.text]];
    for (const [lang, text] of Object.entries(up.textI18n ?? {})) {
      const b = base.textI18n?.[lang as keyof typeof base.textI18n];
      if (b) pairs.push([b, text]);
    }
    for (const [a, b] of pairs) {
      const parts = diffText(a, b);
      assert.equal(parts.filter((p) => p.kind !== 'ins').map((p) => p.text).join(''), a, `${up.id} 원본`);
      assert.equal(parts.filter((p) => p.kind !== 'del').map((p) => p.text).join(''), b, `${up.id} 개량`);
    }
  }
});
