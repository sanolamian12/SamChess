/**
 * S급 튜토리얼 판이 **다르게 두어도 이기는가** — 판마다 여러 손으로 두어 이긴 수를 센다 (2026-10-24).
 *
 *   node --experimental-strip-types tools/tutorial_robust.ts            # 판이 선 S급 전부
 *   node --experimental-strip-types tools/tutorial_robust.ts gwak-ga    # 하나만
 *
 * 회귀(`tutorialSBattles.test.ts`)는 한 손(HP가 가장 낮은 적부터)으로만 둔다 — 그 손으로만 이기는 판은 사람이 대본 밖 차례를
 * 조금만 다르게 두어도 진다(브라우저 확인 도구가 다르게 두다 열 판에서 졌다). 대본이 정한 수는 그대로 두고, 대본이 끝난 차례 ·
 * 「공격」 단계의 대상 고르기 · 다가가기만 손마다 다르게 둔다. 무작위 손은 시드를 고정한다(같은 결과가 다시 나온다).
 *
 * 손: 약한 적부터 · 첫 적 · 가장 센 적 · 약한 적 + 다가가기 · 무작위 8(시드 1~8, 반은 다가간다)
 */

import { S_TUTORIAL_OFFICERS, sTutorialId, tutorialReady, tutorialStages } from '../packages/meta/src/index.ts';
import { WEAKEST, play } from '../packages/meta/test/tutorialPlay.ts';
import type { Hand } from '../packages/meta/test/tutorialPlay.ts';

/** 시드 난수 (mulberry32) — 손의 무작위만, 판정은 엔진의 시드가 한다 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hands: { name: string; hand: Hand }[] = [
  { name: '약한 적', hand: WEAKEST },
  { name: '첫 적', hand: { pick: (_s, t) => t[0]! } },
  { name: '센 적', hand: { pick: (s, t) => [...t].sort((a, b) => s.units[b]!.hp - s.units[a]!.hp)[0]! } },
  { name: '약한 적+다가감', hand: { ...WEAKEST, approach: true } },
  ...Array.from({ length: 8 }, (_, i) => {
    const r = rng(i + 1);
    return {
      name: `무작위${i + 1}`,
      hand: {
        pick: (_s, t) => t[Math.floor(r() * t.length)]!,
        tile: (_s, ts) => ts[Math.floor(r() * ts.length)]!,
        approach: i % 2 === 0,
      } satisfies Hand,
    };
  }),
];

const asked = process.argv.slice(2);
const ids = (asked.length ? asked : S_TUTORIAL_OFFICERS.filter((o) => tutorialReady(sTutorialId(o))));
const rows: string[] = [];
for (const id of ids) {
  const stages = tutorialStages(sTutorialId(id as never));
  const lost: string[] = [];
  for (const { name, hand } of hands) {
    let won = true;
    for (const st of stages) {
      try {
        const end = play(st, undefined, hand);
        if (end.winner !== 'P1') { won = false; break; }
      } catch {
        won = false;
        break;
      }
    }
    if (!won) lost.push(name);
  }
  const wins = hands.length - lost.length;
  rows.push(`${wins === hands.length ? '✓' : wins >= hands.length * 0.75 ? '△' : '✗'} ${id.padEnd(13)} ${wins}/${hands.length}${lost.length ? `  진 손: ${lost.join(' · ')}` : ''}`);
}
console.log(rows.join('\n'));
