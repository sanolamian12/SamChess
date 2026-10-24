/**
 * S급 튜토리얼 판 하나를 **대본대로 두어 보고** 흐름을 찍는다 — 판을 짜고 자리 · 레벨을 맞출 때 쓴다 (2026-10-24).
 *
 *   node --experimental-strip-types tools/tutorial_probe.ts gwan-u
 *
 * `packages/meta/src/tutorialS/{장수 id}.ts`가 내보내는 판 함수(이름은 무엇이든 — 처음 나오는 함수)를 부른다.
 * 판 목록(`tutorialSBattles.ts`)에 등록하지 않아도 된다. 문구는 `tutorialS/{장수 id}.ko.json`이 있으면 거기서,
 * 없으면 클라이언트 `ko.json`에서 찾는다.
 *
 * 확인하는 것(전부 통과해야 판이 선다 — 회귀 `tutorialSBattles.test.ts`도 같은 것을 본다):
 *  - 대본대로 두면 **P1이 이긴다**
 *  - 그 장수(P1)가 **자기 고유기술을 실제로 쓴다**
 *  - 대본의 문구 열쇠가 전부 있고, 한 장이 **70자 이하**다
 *  - 판은 25 × 15 · 지도는 그 장수 · 그 장수가 P1에 있다 · 모든 장수가 260명 명단 안에 있다
 */

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { OFFICERS } from '../packages/data/src/index.ts';
import { play } from '../packages/meta/test/tutorialPlay.ts';
import type { TutorialStage } from '../packages/meta/src/index.ts';

const id = process.argv[2];
if (!id) { console.error('장수 id를 주세요 — 예: gwan-u'); process.exit(2); }
const file = `packages/meta/src/tutorialS/${id}.ts`;
if (!existsSync(file)) { console.error(`${file} 이 없다`); process.exit(2); }

const mod = await import(pathToFileURL(file).href) as Record<string, unknown>;
const make = Object.values(mod).find((v): v is () => TutorialStage[] => typeof v === 'function');
if (!make) { console.error(`${file}에 판 함수가 없다`); process.exit(2); }
const stages = make();

const own = `packages/meta/src/tutorialS/${id}.ko.json`;
const strings: Record<string, string> = {
  ...JSON.parse(readFileSync('packages/client/src/i18n/strings/ko.json', 'utf-8').replace(/^﻿/, '')),
  ...(existsSync(own) ? JSON.parse(readFileSync(own, 'utf-8')) : {}),
};

const officer = OFFICERS.find((o) => o.id === id)!;
let failed = 0;
const check = (ok: boolean, msg: string): void => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++; };

for (const [n, st] of stages.entries()) {
  console.log(`\n── ${id} 판 ${n + 1}/${stages.length} (${st.lesson})`);
  const setup = st.config.setup!;
  check(setup.board.x === 25 && setup.board.y === 15, '판 25 × 15');
  check(st.map === id, `지도 ${st.map}`);
  check(st.config.rosters.P1.some((r) => r.officer === id), `${officer.name}이(가) 사람 진영(P1)에 있다`);
  for (const side of ['P1', 'P2'] as const) {
    for (const r of st.config.rosters[side]) check(OFFICERS.some((o) => o.id === r.officer), `명단 안 ${r.officer}`);
  }
  const keys = [...st.guide.flatMap((t) => t.phases.flatMap((p) => p.lines)), ...st.outro];
  for (const k of keys) {
    if (!(k in strings)) check(false, `문구 열쇠 ${k}가 없다`);
    else if (strings[k]!.length > 70) check(false, `${k} ${strings[k]!.length}자 — 70자 이하로`);
  }

  let end;
  try { end = play(st); } catch (e) { check(false, `대본대로 두다 막혔다 — ${(e as Error).message}`); continue; }
  const p1 = Object.values(end.units).find((u) => u.side === 'P1' && u.officer === id);
  const cast = end.log.some((e) => e.e === 'uniqueSkillCast' && p1 && e.unit === p1.id);
  check(end.phase === 'finished' && end.winner === 'P1', `P1이 이긴다 (${end.winner ?? '무'} · ${end.outcome} · 시각 ${end.time})`);
  check(cast, `${officer.name}이(가) 고유기술을 썼다`);

  // 흐름 — 누가 누구를 · 고유기술 · 이동 · 끝
  const trace = end.log
    .filter((e) => ['attacked', 'uniqueSkillCast', 'uniqueSkillFizzled', 'moved', 'battleEnded', 'unitDied', 'controlChanged'].includes(e.e))
    .map((e: any) => e.e === 'attacked' ? `${e.unit}→${e.target} −${e.damage}${e.critical ? '!' : ''}`
      : e.e === 'moved' ? `${e.unit} ${e.from.x},${e.from.y}→${e.to.x},${e.to.y}`
      : e.e === 'battleEnded' ? `끝 ${e.winner ?? '무'} ${e.outcome}`
      : `${e.e} ${e.unit ?? ''}`);
  console.log(`  흐름: ${trace.join(' | ')}`);
  console.log(`  HP: ${Object.values(end.units).map((u) => `${u.id}(${u.officer}) ${u.hp}/${u.maxHp}${u.alive ? '' : '✝'}`).join(' · ')}`);
}

process.exit(failed ? 1 : 0);
