/**
 * S급 튜토리얼 더빙 대본 뽑기 — 판 파일의 대사(`say()`)를 **판에서 나오는 차례대로** 모아
 * `Design/튜토리얼더빙/lines.json`(더빙 도구가 읽는 정본)과 `대본.md`(사람이 읽는 표)를 쓴다.
 *
 *   node --experimental-strip-types tools/tutorial_dub_script.ts
 *
 * 대사 문구는 `client/src/i18n/strings/{언어}.json`의 `tut.s.{판}.say{n}`이다 — 더빙 다섯(`DubLang`)이 읽는 텍스트 언어는
 * `DUB_TEXT` 표 하나가 정한다. 번역이 아직 없는 칸은 `null`로 두고 `대본.md`에 「번역 없음」을 센다(생성 도구는 그 칸을 건너뛴다).
 * 줄마다 문구의 해시(`hash`)를 싣는다 — 받은 음원이 **어느 글자로 녹음됐는지** 기억해, 대사를 고친 뒤 낡은 음원을 찾아낸다.
 * 앞뒤 안내 문장(`before` · `after`, 한국어)은 연기 지시를 쓸 때 보는 맥락이다.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICERS } from '../packages/data/src/index.ts';
import { S_TUTORIAL_OFFICERS, lineKey, sTutorialId, tutorialReady, tutorialStages } from '../packages/meta/src/index.ts';
import type { GuideLine, GuideSay } from '../packages/meta/src/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRINGS = join(ROOT, 'packages/client/src/i18n/strings');
const OUT = join(ROOT, 'Design/튜토리얼더빙');

/** 더빙 다섯이 읽는 텍스트 언어 — `client/src/i18n/index.ts`의 `DubLang`과 같은 다섯 */
const DUB_TEXT = { KR: 'ko', EN: 'en', JP: 'ja', PT: 'pt_BR', CA: 'zh_Hans' } as const;
type Dub = keyof typeof DUB_TEXT;
const DUBS = Object.keys(DUB_TEXT) as Dub[];

const strings = Object.fromEntries(DUBS.map((d) =>
  [d, JSON.parse(readFileSync(join(STRINGS, `${DUB_TEXT[d]}.json`), 'utf8')) as Record<string, string>]));

const officer = (id: string) => OFFICERS.find((o) => o.id === id);
const hash = (s: string): string => createHash('sha1').update(s.normalize('NFC')).digest('hex').slice(0, 10);

export interface DubLine {
  /** 판 안의 차례 (1부터) — 음원 파일 이름의 번호 */
  order: number;
  /** 문구 열쇠 `tut.s.{판}.say{n}` — 화면이 음원을 찾는 열쇠 */
  key: string;
  stage: string;
  speaker: string;
  speakerName: string;
  text: Record<Dub, string | null>;
  hash: Record<Dub, string | null>;
  before: string | null;
  after: string | null;
}

const isSay = (l: GuideLine): l is GuideSay => typeof l !== 'string';

const scenarios: { stage: string; officer: string; officerName: string; ready: boolean; lines: DubLine[] }[] = [];

for (const id of S_TUTORIAL_OFFICERS) {
  const tid = sTutorialId(id);
  const ready = tutorialReady(tid);
  const lines: DubLine[] = [];
  if (ready) {
    // 판에서 나오는 차례: 판마다 차례 → 단계 → 장, 그리고 이긴 뒤의 outro
    const flat: GuideLine[] = tutorialStages(tid).flatMap((s) => [
      ...s.guide.flatMap((t) => t.phases.flatMap((p) => p.lines)),
      ...s.outro,
    ]);
    flat.forEach((l, i) => {
      if (!isSay(l)) return;
      const ko = (k: GuideLine | undefined) => (k === undefined ? null : strings.KR[lineKey(k)] ?? null);
      const text = Object.fromEntries(DUBS.map((d) => [d, strings[d][l.say] ?? null])) as Record<Dub, string | null>;
      lines.push({
        order: lines.length + 1,
        key: l.say,
        stage: id,
        speaker: l.by,
        speakerName: officer(l.by)?.name ?? l.by,
        text,
        hash: Object.fromEntries(DUBS.map((d) => [d, text[d] === null ? null : hash(text[d]!)])) as Record<Dub, string | null>,
        before: ko(flat[i - 1]),
        after: ko(flat[i + 1]),
      });
    });
  }
  scenarios.push({ stage: id, officer: id, officerName: officer(id)?.name ?? id, ready, lines });
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'lines.json'), JSON.stringify({ dubText: DUB_TEXT, scenarios }, null, 2) + '\n');

// ── 사람이 읽는 표 ──
const all = scenarios.flatMap((s) => s.lines);
const missing = Object.fromEntries(DUBS.map((d) => [d, all.filter((l) => l.text[d] === null).length]));
const speakers = new Map<string, number>();
for (const l of all) speakers.set(l.speaker, (speakers.get(l.speaker) ?? 0) + 1);

const md: string[] = [
  '# S급 튜토리얼 더빙 대본',
  '',
  '`node --experimental-strip-types tools/tutorial_dub_script.ts`가 판 파일 · 문구 파일에서 뽑았다 — **손으로 고치지 않는다.**',
  '',
  `- 판 ${scenarios.filter((s) => s.ready).length}/${scenarios.length} · 대사 ${all.length}줄 · 화자 ${speakers.size}명`,
  `- 번역 없음: ${DUBS.map((d) => `${d} ${missing[d]}`).join(' · ')}`,
  '',
];
scenarios.forEach((s, i) => {
  md.push(`## ${i + 1}. ${s.officerName} (\`${s.stage}\`)`, '');
  if (!s.ready) { md.push('판 없음', ''); return; }
  md.push('| # | 화자 | 대사 (KR) | 열쇠 |', '|---|---|---|---|');
  for (const l of s.lines) md.push(`| ${l.order} | ${l.speakerName} | ${l.text.KR ?? '—'} | \`${l.key}\` |`);
  md.push('');
});
md.push('## 화자별 줄 수', '', '| 화자 | id | 줄 |', '|---|---|---|');
for (const [id, n] of [...speakers].sort((a, b) => b[1] - a[1])) md.push(`| ${officer(id)?.name ?? id} | \`${id}\` | ${n} |`);
writeFileSync(join(OUT, '대본.md'), md.join('\n') + '\n');

// ── 배역표 뼈대 — 새 화자만 더하고, 사람이 채운 목소리 · 프로필은 그대로 둔다 ──
const castPath = join(OUT, 'cast.json');
let cast: Record<string, { name: string; lines: number; voice: string; profile: string }> = {};
try { cast = JSON.parse(readFileSync(castPath, 'utf8')); } catch { /* 처음 */ }
for (const [id, n] of [...speakers].sort((a, b) => b[1] - a[1])) {
  cast[id] = { name: officer(id)?.name ?? id, lines: n, voice: cast[id]?.voice ?? '', profile: cast[id]?.profile ?? '' };
}
writeFileSync(castPath, JSON.stringify(cast, null, 2) + '\n');

console.log(`판 ${scenarios.filter((s) => s.ready).length} · 대사 ${all.length}줄 · 화자 ${speakers.size}명 → ${OUT}`);
console.log(`번역 없음: ${DUBS.map((d) => `${d} ${missing[d]}`).join(' · ')}`);
