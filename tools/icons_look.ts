/**
 * 아이콘 눈 확인 (2026-10-26, `Design/아이콘_제작목록_이미지프롬프트.md`) — 아이콘을 붙인 화면을 묶음마다 찍는다.
 *
 *   VW=760 VH=1200 SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/icons_look.ts
 *
 * 병영 · 부대 화면은 `squad_ux.ts`가 찍는다 — 여기는 그 도구가 안 지나는 자리(궁궐 장수 일람 · 장수 카드 · 레벨업 판 · 출정).
 * 계정을 심는 부분은 `squad_ux.ts`와 같다(부상 하나 · 병기 하나 · 부대 여섯) + 기본 튜토리얼 완료(출정이 열리게).
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { defaultSquadCells, newInstance } from '@samchess/meta';
import type { RosterPick, Squad } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
/** 화면 언어 — 가장 긴 번역(몽골어 `mn`)으로 넘침을 본다. 없으면 한국어 */
const LANG = process.env['LANG_UI'] ?? '';

const fail = (m: string): never => { console.error(`✗ ${m}`); process.exit(1); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);

const email = `icons-look-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? 760), height: Number(process.env['VH'] ?? 1200) },
});
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
// 404는 **어느 파일인지** 적는다 — 콘솔 문구만으로는 경로가 안 나온다
// 새 계정의 첫 `GET /profile`은 도시가 아직 없어 404가 정상이다(새 게임 화면으로 간다)
page.on('response', (r) => { if (r.status() === 404 && new URL(r.url()).pathname !== '/profile') errors.push(`404 ${new URL(r.url()).pathname}`); });
const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', `아이콘-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    // 가입 오프닝(대사 · 장수 W 대형, 약 14초)을 지나야 메인이다 — 끝의 [성 안으로 들어가기]
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 }); // 메인이 자리 잡는 1초 연출이 끝난 뒤
  }
  // 메인이 서며 내는 저장(`PUT /profile`, 군량 정산 등)이 아래에서 심는 값보다 늦게 닿으면
  // 부대를 덮는다 — 그 저장이 다 끝난 뒤에 심는다. 경주라서 빼고 돌려도 대개 통과한다(2026-10-19)
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);

  step('장수 20명 · 부대 여섯(최근 셋이 갈리게) · 부상 하나 · 병기 하나를 심는다');
  const stored = await getProfile(uid);
  const roster = { ...stored!.roster } as Record<string, ReturnType<typeof newInstance>>;
  const ids = OFFICERS.map((o) => o.id as OfficerId);
  for (const id of ids.slice(0, 20)) if (!roster[id]) roster[id] = newInstance(id);
  // 튜토리얼 소개 패널을 볼 S급 — 목표가 여러 꼴인 판(장비: 버티기 + 패배 조건 · 가후: 지정 적 · 조운: 도달)
  for (const id of ['jang-bi', 'ga-hu', 'jo-un'] as OfficerId[]) if (!roster[id]) roster[id] = newInstance(id);
  const own = Object.keys(roster) as OfficerId[];
  const now = Date.now();
  roster[own[1]!] = { ...roster[own[1]!]!, injuredAt: now };
  const picks3 = (o: number): RosterPick[] => [
    { piece: 'King', officer: own[o]! }, { piece: 'Rock', officer: own[o + 1]! }, { piece: 'Queen', officer: own[o + 2]! },
  ];
  const squads: Squad[] = Array.from({ length: 6 }, (_, i) => {
    const picks = picks3(i);
    return {
      id: `sq${i + 1}`, name: `시험부대${i + 1}`, mode: '3v3', picks,
      deploy: { P1: defaultSquadCells('3v3', 'P1', picks).map((c) => ({ ...c, y: c.y - 1 })), P2: null },
      record: i === 0 ? { 'ai/3v3': { plays: 9, wins: 3, draws: 2, losses: 4, kills: 12, points: 150 } } : {},
      createdAt: now - (6 - i) * 60_000,
    };
  });
  await saveProfileTrusted(uid, {
    ...stored!, cityLevel: 11, buildings: { ...stored!.buildings, palace: 11 },
    // 5v5 부대도 하나 — 두 모드 모두 수비군이 서야 [출정하기]가 열린다(2026-10-27)
    roster, squads: [...squads, {
      id: 'sq7', name: '시험오대', mode: '5v5',
      picks: (['King', 'Rock', 'Bishop', 'Knight', 'Queen'] as const).map((piece, i) => ({ piece, officer: own[10 + i]! })),
      deploy: { P1: null, P2: null }, record: {}, createdAt: now - 7 * 60_000,
    }], squadSeq: 8,
    // 출정 화면은 기본 튜토리얼 셋을 끝내야 열린다
    tutorial: { done: ['basic-1', 'basic-2', 'basic-3'] },
    forgeOwned: { 'dae-gam-do#1': own[0]! },
    // 「시험부대1」이 가장 최근에 싸웠다 — 가장 먼저 만든 부대가 맨 위로 올라와야 한다
    matches: [{ seq: 1, at: now, mode: '3v3', opponent: 'siege', opponentId: null, mySquad: '시험부대1', theirSquad: null, myPower: 0, theirPower: 0, chance: 0.5, result: 'win', picks: [] }],
    matchSeq: 2,
  } as Parameters<typeof saveProfileTrusted>[1]);
  ok(`장수 ${own.length}명 · 부대 6 · 부상 ${own[1]} · 대감도 ${own[0]}`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });

  step('궁궐 — 장수 일람 · 장수 카드 · 레벨업 판');
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.click('[data-action="officers"]');
  await page.waitForSelector('[data-screen="officer-list"]');
  await shot('a1-officer-list');
  // 다친 장수(own[1])의 카드 — 목록 차례가 판마다 달라 이름으로 찾는다
  const hurtName = OFFICERS.find((o) => o.id === own[1])!.name;
  await page.fill('input[data-field="search"]', hurtName);
  await page.waitForTimeout(300);
  await page.click(`[data-officer="${own[1]}"]`);
  await page.waitForTimeout(600);
  await shot('a2-officer-card');
  const lv = await page.$('[data-action="levels"]');
  if (lv) {
    await lv.click();
    await page.waitForSelector('[data-screen="levelup-panel"]');
    await page.waitForTimeout(400);
    await shot('a3-levelup');
  } else console.log('  · 장수 카드에 [레벨/스킬 관리]가 없다');
  // 전적 판 — 장수 카드의 [전적 보기]
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.click('[data-action="officers"]');
  await page.waitForSelector('[data-screen="officer-list"]');
  await page.click('.ofc-rows [data-officer]');
  await page.waitForTimeout(500);
  await shot('a2b-officer-card-first');
  const rec = await page.$('[data-action="records"]');
  if (rec) { await rec.click(); await page.waitForTimeout(600); await shot('a4-records'); }
  ok('궁궐');

  step('대자보 — 랭킹 셋');
  // 랭킹마다 메인에서 다시 들어간다 — 랭킹 화면의 「뒤로」가 어디로 가는지는 들어온 길이 가른다
  for (const [act, name] of [['rankingCity', 'c1-rank-city'], ['rankingSquad', 'c2-rank-squad'], ['rankingOfficer', 'c3-rank-officer']] as const) {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    await page.click('.scr-main [data-place="ranking"]', { force: true });
    await page.click('[data-action="ranking"]');
    await page.waitForSelector('[data-screen="ranking"]');
    await page.click(`[data-action="${act}"]`);
    // 「불러오는 중」 가리개가 걷히고 줄이 선 뒤에 찍는다
    await page.waitForSelector('.rk-row:not(.rk-thead)', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(800);
    await shot(name);
  }
  ok('랭킹');

  step('병영 — 튜토리얼 소개 패널');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.scr-main [data-place="barracks"]', { force: true });
  await page.waitForSelector('.scr-place-barracks');
  await page.click('[data-action="tutorial"]');
  await page.waitForSelector('[data-tutorial="basic-1"]');
  await shot('t0-tutorial-list');
  for (const id of ['basic-1', 's-jang-bi', 's-ga-hu', 's-jo-un']) {
    const btn = await page.$(`[data-tutorial="${id}"]:not([disabled])`);
    if (!btn) { console.log(`  · ${id} 단추가 없거나 잠겼다`); continue; }
    await btn.click();
    await page.waitForSelector('[data-modal="tutorialIntro"]');
    // 목표 메달이 다 받아진 뒤에 찍는다 — 처음 여는 그림은 한 박자 늦다
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[data-modal="tutorialIntro"] img')].every((i) => i.complete), null, { timeout: 5_000 }).catch(() => {});
    await shot(`t-intro-${id}`);
    await page.click('[data-action="introBack"]');
  }
  ok('튜토리얼 소개');

  step('병영 — 출정 (모드 고르기)');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.scr-main [data-place="barracks"]', { force: true });
  await page.waitForSelector('.scr-place-barracks');
  await page.click('[data-action="sortie"]');
  await page.waitForSelector('[data-screen="sortie"]');
  await shot('b1-sortie-mode');
  // 매칭 — 3v3 · 첫 부대 · [대전상대 찾기] → 찾는 중 → [AI 대전하기](5초 뒤) → 찾았다
  await page.click('[data-mode="3v3"]');
  await page.click('[data-action="pickSquad"]');
  await page.click('[data-action="seek"]');
  // 공성전 도시 목록(GDD §8.8 단계 2)을 지나 지금까지의 매칭으로 — [자동 매칭]
  await page.click('[data-action="autoMatch"]');
  await page.waitForTimeout(1_500);
  await shot('b2-match-search');
  await page.waitForSelector('[data-action="aiNow"]:not([disabled])', { timeout: 15_000 }).catch(() => {});
  await shot('b3-match-ai-btn');
  const ai = await page.$('[data-action="aiNow"]:not([disabled])');
  if (ai) { await ai.click(); await page.waitForSelector('.mtc-foe', { timeout: 15_000 }).catch(() => {}); await page.waitForTimeout(500); await shot('b4-match-found'); }
  ok('출정 · 매칭');

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' | ')}`);
  console.log('\n✓ 아이콘 눈 확인 한 바퀴');
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
