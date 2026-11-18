/**
 * 병영 UX 확인 — 부대 관리 · 부대 편집(농지 틀, [저장] 한 번) · 배치 편집 · 아이템 (pptx 65~72쪽, 2026-09-17 · 2026-11-17)
 *
 *   VW=760 VH=1200 SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/squad_ux.ts
 *
 * 새 계정의 장수 다섯 명으로는 **안 그려지는 갈래**가 많다 — 부상 표시, 병기 칸,
 * 최근 부대 셋, 칸 넷(2026-11-14 부대 개편 — 셋을 채우고 5v5 공격대를 비워 둔다), 배치 물려주기(저장된 배치가 있어야 한다).
 * 그래서 계정을 서버 쪽에서 미리 채워 두고 한 바퀴를 돈다. 판정은 짧게만 하고
 * 요점은 **스크린샷**이다 — 스모크(`smoke_meta.ts`)가 흐름을 고정한다.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { EQUIPMENT, OFFICERS } from '@samchess/data';
import { defaultSquadCells, newInstance } from '@samchess/meta';
import type { RosterPick, Squad } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
/** 화면 언어 — 가장 긴 번역(몽골어 `mn`)으로 넘침을 본다. 없으면 한국어 */
const LANG = process.env['LANG_UI'] ?? '';

const fail = (m: string): never => { console.error(`✗ ${m}`); process.exit(1); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);

const email = `squad-ux-${randomUUID()}@samchess.test`;
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
    await page.fill('.scr-new .newgame-form input', `병영실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    // 가입 오프닝(대사 · 장수 W 대형, 약 14초)을 지나야 메인이다 — 끝의 [성 안으로 들어가기]
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 }); // 메인이 자리 잡는 1초 연출이 끝난 뒤
  }
  // 메인이 서며 내는 저장(`PUT /profile`, 군량 정산 등)이 아래에서 심는 값보다 늦게 닿으면
  // 부대를 덮는다 — 그 저장이 다 끝난 뒤에 심는다. 경주라서 빼고 돌려도 대개 통과한다(2026-10-19)
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);

  step('장수 20명 · 부대 셋(3v3 공격 · 수비, 5v5 수비 — 5v5 공격은 비운다) · 부상 하나 · 병기 하나를 심는다');
  const stored = await getProfile(uid);
  const roster = { ...stored!.roster } as Record<string, ReturnType<typeof newInstance>>;
  const ids = OFFICERS.map((o) => o.id as OfficerId);
  for (const id of ids.slice(0, 20)) if (!roster[id]) roster[id] = newInstance(id);
  const own = Object.keys(roster) as OfficerId[];
  const now = Date.now();
  roster[own[1]!] = { ...roster[own[1]!]!, injuredAt: now };
  const picks3 = (o: number): RosterPick[] => [
    { piece: 'King', officer: own[o]! }, { piece: 'Rock', officer: own[o + 1]! }, { piece: 'Queen', officer: own[o + 2]! },
  ];
  const squads: Squad[] = (['attack', 'defense'] as const).map((role, i) => {
    const picks = picks3(i);
    return {
      id: role === 'attack' ? 'atk-3v3' : 'def-3v3', role, mode: '3v3', picks,
      deploy: { P1: defaultSquadCells('3v3', 'P1', picks).map((c) => ({ ...c, y: c.y - 1 })), P2: null },
      record: i === 0 ? { 'field/3v3': { plays: 9, wins: 3, draws: 2, losses: 4, kills: 12, points: 0 } } : {},
      createdAt: now - (6 - i) * 60_000,
    };
  });
  squads.push({
    id: 'def-5v5', role: 'defense', mode: '5v5',
    picks: (['King', 'Rock', 'Bishop', 'Knight', 'Queen'] as const).map((piece, i) => ({ piece, officer: own[10 + i]! })),
    deploy: { P1: null, P2: null }, record: {}, createdAt: now - 2 * 60_000,
  });
  await saveProfileTrusted(uid, {
    ...stored!, cityLevel: 11, buildings: { ...stored!.buildings, palace: 11 },
    roster, squads,
    // 병기 15종 전부(2026-11-17) — 고르기 팝업에 다섯 칸 × 세 줄이 굴리지 않고 드는지 잰다. 대감도는 둘째 자루(안 낌)까지
    forgeOwned: { ...Object.fromEntries(EQUIPMENT.map((e) => [`${e.id}#1`, null])), 'dae-gam-do#1': own[0]!, 'dae-gam-do#2': null },
    // 아이템 들리기(2026-11-17) — 보관함에 탕약 둘
    marketOwned: { 'tang-yak': 2 },
    // 3v3 공격대가 가장 최근에 싸웠다 — 가장 먼저 만든 부대가 맨 위로 올라와야 한다
    matches: [{ seq: 1, at: now, mode: '3v3', opponent: 'siege', opponentId: null, mySquad: 'atk-3v3', theirSquad: null, myPower: 0, theirPower: 0, chance: 0.5, result: 'win', picks: [] }],
    matchSeq: 2,
  } as Parameters<typeof saveProfileTrusted>[1]);
  ok(`장수 ${own.length}명 · 부대 3 · 부상 ${own[1]} · 대감도 ${own[0]}`);

  if (LANG) await page.evaluate((l) => localStorage.setItem('samchess.lang', l), LANG);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });

  step('병영 — 현황판 (2026-11-16): 전적 총합 + 3vs3 · 5vs5 · 막은 판 총합 + 모드 · 튜토리얼 · 편성 여부 넷');
  await page.click('.scr-main [data-place="barracks"]', { force: true });
  await page.waitForSelector('.scr-place-barracks');
  await page.waitForTimeout(800);
  await shot('01-barracks');
  const rec = await page.$eval('[data-field="record"]', (el) => ['plays', 'w', 'd', 'l', 'k'].map((k) => (el as HTMLElement).dataset[k]).join(' / '));
  // 심은 전적은 3v3 공격대의 9전 3승 2무 4패 12격파 — 수비대 · 5v5 수비대는 안 센다
  if (rec !== '9 / 3 / 2 / 4 / 12') fail(`병영 전적이 공격대 합이 아니다 — "${rec}"`);
  const byMode = await page.$$eval('[data-field="recordMode"]', (els) => els.map((e) => `${(e as HTMLElement).dataset.sub}:${(e as HTMLElement).dataset.w}/${(e as HTMLElement).dataset.k}`).join(','));
  if (byMode !== '3v3:3/12,5v5:0/0') fail(`병영 모드별 전적이 [${byMode}]다`);
  // 막은 판은 모드 줄 맨 끝 다섯째 칸 — 따로 서던 「수비」 줄은 없다 (2026-11-16 기획자)
  const fives = await page.$$eval('[data-field="recordMode"]', (els) => els.map((e) => e.querySelectorAll('.bar-rec').length).join(''));
  if (fives !== '55') fail(`병영 모드 줄의 칸 수가 「${fives}」다 — 승 · 무 · 패 · 적격파 · 막은 판 다섯이라야 한다`);
  if (await page.$('[data-field="defense"], [data-field="record"] .bar-rec')) fail('병영에 총합 전적 · 「수비」 줄이 남아 있다');
  const board = await page.evaluate(() => [...document.querySelectorAll('.scr-place-barracks .bar-sq[data-slot]')].map((e) => `${(e as HTMLElement).dataset.slot}:${(e as HTMLElement).dataset.filled}`).sort());
  if (board.join(',') !== 'atk-3v3:1,atk-5v5:0,def-3v3:1,def-5v5:1') fail(`병영 편성 여부가 [${board.join(' ')}]다`);
  if (await page.$('.scr-place-barracks .ofc-stand')) fail('병영 현황판에 꼬마가 남아 있다 — 부대 관리 화면으로 옮겼다');
  const spillB = await page.evaluate(() => [...document.querySelectorAll('.bar-sq, .bar-line, .bar-sq-mark')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  if (spillB) fail(`병영 현황 줄 ${spillB}개가 가로로 넘친다`);
  const barIcons = await page.$$eval('.scr-place-barracks .bar-sq[data-slot] img', (els) => els.map((e) => (e as HTMLImageElement).src.split('/').pop()).join(','));
  if (barIcons !== 'mode-3v3.png,mode-5v5.png,mode-3v3-foe.png,mode-5v5-foe.png') fail(`병영 현황판 모드 아이콘이 [${barIcons}]다 — 수성군 줄은 북군 색`);
  ok(`전적 ${rec} · 모드 [${byMode}] · 편성 [${board.join(' ')}] · 넘침 없음`);

  step('부대 목록 — 편성판 (2026-11-16)');
  await page.click('[data-action="squads"]');
  await page.waitForSelector('[data-screen="squads"]');
  await page.waitForTimeout(1_000);
  await shot('02-list');
  const cells = await page.$$eval('.sql-row', (els) => els.map((e) => `${(e as HTMLElement).dataset.slot}:${(e as HTMLElement).dataset.filled}:${e.querySelectorAll('.ofc-stand').length}`));
  if (cells.join(',') !== 'atk-3v3:1:3,atk-5v5:0:0,def-3v3:1:3,def-5v5:1:5') fail(`줄이 [${cells.join(' ')}]다`);
  // 오른쪽 벽 표지 — 완성 셋은 파란 도장, 빈 칸은 표지 없이 「미편성」 획 (2026-11-17)
  const marks = await page.$$eval('.sql-row', (els) => els.map((e) => e.querySelector('[data-field="mark"]')?.getAttribute('data-state') ?? '-').join(','));
  if (marks !== 'done,-,done,done') fail(`표지가 [${marks}]다`);
  // 꼬마는 기물 차례대로 왼쪽부터, 왼쪽 앞에 제 기물 아이콘 — 심은 5v5는 Pawn이 없다 (2026-11-17)
  const placed = await page.$$eval('.sql-row[data-slot="def-5v5"] .sql-cell', (els) => els.map((e) => (e.querySelector('.ofc-stand') && e.querySelector('.sql-piece') ? (e as HTMLElement).dataset.piece : '-')).join(','));
  if (placed !== 'King,Rock,Bishop,Knight,Queen') fail(`5v5 수비대 꼬마 차례가 「${placed}」다`);
  const front = await page.$eval('.sql-row[data-slot="def-5v5"] .sql-cell', (c) => {
    const st = c.querySelector('.ofc-stand')!.getBoundingClientRect(); const pc = c.querySelector('.sql-piece')!.getBoundingClientRect();
    return { left: pc.left < st.left + st.width / 2, half: Math.abs(pc.width - st.width / 2) < 1 && Math.abs(pc.height - st.height / 2) < 1,
      z: Number(getComputedStyle(c.querySelector('.sql-piece')!).zIndex) > Number(getComputedStyle(c.querySelector('.ofc-stand')!).zIndex) };
  });
  if (!front.left || !front.half || !front.z) fail(`기물 아이콘이 꼬마 왼쪽 앞 반 크기가 아니다 — ${JSON.stringify(front)}`);
  if (await page.$$eval('.sql-row[data-filled="0"] .sql-unformed', (els) => els.length) !== 1) fail('빈 줄(5v5 공격대)에 「미편성」 획이 없다');
  if (!await page.$('.sql-cell .sqd-stand-glow')) fail('부대 관리 칸에 후광이 하나도 없다 — 심은 장수에 S · A급이 있다');
  const spill = await page.$$eval('.sql-row', (els) => els.filter((e) => {
    const c = e.getBoundingClientRect();
    return [...e.querySelectorAll('.sql-cell, .sql-fill, .sql-piece')].some((x) => { const r = x.getBoundingClientRect(); return r.left < c.left - 0.5 || r.right > c.right + 0.5; });
  }).map((e) => (e as HTMLElement).dataset.slot));
  if (spill.length) fail(`칸 안이 넘친다 — ${spill.join(', ')}`);
  if (await page.$('.sql-forms, [data-action="formAttack"], [data-action="formDefense"]')) fail('명령 패널에 [공격대 편성] · [수비대 편성]이 남아 있다');
  const look = await page.evaluate(() => ({
    hint: document.querySelector('.sqd-list [data-field="hint"]')?.textContent?.trim(),
    first: document.querySelector('.sqd-list .place-panel, .sqd-list')?.querySelector('[data-field="hint"], .sql-rows') === document.querySelector('.sqd-list [data-field="hint"]'),
    heads: [...document.querySelectorAll('.sql-head [data-field="squadHead"]')].map((e) => e.textContent?.trim()),
    atk: [...document.querySelectorAll('.sql-group[data-role="attack"] .sql-piece')].every((i) => (i as HTMLImageElement).src.includes('-mine.')),
    def: [...document.querySelectorAll('.sql-group[data-role="defense"] .sql-piece')].every((i) => (i as HTMLImageElement).src.includes('-foe.')),
  }));
  if (look.hint !== '클릭해서 세부정보를 봅니다.' || !look.first) fail(`판 맨 윗줄 안내가 아니다 — ${JSON.stringify(look)}`);
  if (look.heads.join(',') !== '돌격대,수성군') fail(`단 머리가 [${look.heads.join(' ')}]다`);
  // 「준비」 열 제목이 단마다 표지 바로 위에 — 가로 가운데가 표지와 같다
  const readyOff = await page.evaluate(() => [...document.querySelectorAll('.sqd-list .sql-group')].map((g) => {
    const h = g.querySelector('[data-field="readyHead"]')!.getBoundingClientRect();
    const m = g.querySelector('[data-field="mark"]')!.getBoundingClientRect();
    return Math.round(Math.abs((h.left + h.width / 2) - (m.left + m.width / 2)));
  }));
  if (readyOff.some((d) => d > 2)) fail(`「준비」가 표지 위에 안 선다 — 어긋남 ${readyOff.join(', ')}px`);
  if (!look.atk || !look.def) fail('기물 색이 돌격대 남군 · 수성군 북군이 아니다');
  // 모드 아이콘도 수성군 줄은 북군 색 (2026-11-17) — 병영 현황판과 부대 관리 둘 다
  const modeIcons = await page.$$eval('.sql-row .sql-mode img', (els) => els.map((e) => (e as HTMLImageElement).src.split('/').pop()).join(','));
  if (modeIcons !== 'mode-3v3.png,mode-5v5.png,mode-3v3-foe.png,mode-5v5-foe.png') fail(`부대 관리 모드 아이콘이 [${modeIcons}]다`);
  ok(`칸 넷 [${cells.join(' ')}] · 넘침 없음`);

  step('부대 편집 — 농지 틀 (2026-11-17): 맨 위 그 줄 · 구성원 변경 (3/3 명) · 자리 없음 둘 · 명령 2×2');
  await page.click('.sql-row[data-slot="atk-3v3"]');
  await page.waitForSelector('[data-screen="squadEdit"][data-new="0"]');
  await page.waitForTimeout(600);
  await shot('04-edit');
  // 명령 판 글자 — 부대 관리 [뒤로 가기]와 같은 크기(.9rem), 한 줄에 안 드는 언어만 그 단추를 줄인다 · 상태 아이콘 1.3배 (2026-11-18 기획자)
  const fitByLang = await page.evaluate(async () => {
    const i18n = await import('/src/i18n/index.ts' as string);
    const before = i18n.currentLang();
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const out: { lang: string; px: number[]; cut: string[]; base: number }[] = [];
    for (const { id } of i18n.LANGS) {
      i18n.setLang(id);
      await new Promise((r) => setTimeout(r, 250));
      const lbls = [...document.querySelectorAll<HTMLElement>('.sqe-grid .lbl')];
      out.push({
        lang: id, base: Math.round(root * 0.9 * 10) / 10,
        px: lbls.map((l) => Math.round(parseFloat(getComputedStyle(l).fontSize) * 10) / 10),
        cut: lbls.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent ?? ''),
      });
    }
    i18n.setLang(before);
    await new Promise((r) => setTimeout(r, 250));
    return out;
  });
  for (const f of fitByLang) {
    if (f.cut.length) fail(`부대 편집 명령 글자가 ${f.lang}에서 잘린다: ${f.cut.join(' / ')}`);
    if (f.px.some((px) => px > f.base + 0.1)) fail(`부대 편집 명령 글자가 ${f.lang}에서 [뒤로 가기](${f.base}px)보다 크다: ${f.px.join(', ')}`);
  }
  ok(`명령 글자 — 기준 ${fitByLang[0]!.base}px · ${fitByLang.map((f) => `${f.lang} ${f.px.join('/')}`).join(' · ')}`);
  const stH = await page.evaluate(() => {
    const img = document.querySelector<HTMLElement>('.sqe-row .st .gic img');
    const st = img?.closest('.st') as HTMLElement | null;
    return img && st ? img.getBoundingClientRect().height / parseFloat(getComputedStyle(st).fontSize) : 0;
  });
  if (Math.abs(stH - 2.45) > 0.05) fail(`부대 편집 상태 아이콘이 ${stH.toFixed(2)}em이다(2.45em)`);
  const ed = await page.evaluate(() => ({
    head: document.querySelector('.sqe-top [data-field="squadHead"]')?.textContent?.trim(),
    line: (document.querySelector('.sqe-top .sql-row') as HTMLElement | null)?.dataset.state,
    title: document.querySelector('[data-field="count"]')?.textContent?.trim(),
    rows: [...document.querySelectorAll('.sqe-members .sqe-row')].map((e) => ((e as HTMLElement).dataset.locked ? 'x' : (e as HTMLElement).dataset.officer ? 'o' : '_')).join(''),
    none: [...document.querySelectorAll('.sqe-row[data-locked] .frm-stroke')].map((e) => e.textContent?.trim()),
    acts: [...document.querySelectorAll('.sqe-grid > .btn')].map((b) => `${(b as HTMLElement).dataset.action}:${(b as HTMLButtonElement).disabled ? 0 : 1}`).join(','),
    old: !!document.querySelector('[data-field="compare"], [data-field="formula"], .rk-dropdown'),
  }));
  if (ed.head !== '돌격대' || ed.line !== 'done') fail(`맨 위 판이 그 줄이 아니다 — ${JSON.stringify(ed)}`);
  if (ed.title !== '구성원 변경 (3/3 명)') fail(`제목이 「${ed.title}」다`);
  if (ed.rows !== 'oooxx' || ed.none.join(',') !== '자리 없음,자리 없음') fail(`줄이 「${ed.rows}」 · ${ed.none.join(',')}다 — 3v3은 셋 찬 줄 + 「자리 없음」 둘`);
  if (ed.acts !== 'toDeploy:1,garrisonPolicy:0,saveSquad:1') fail(`명령이 [${ed.acts}]다 — 한 줄씩 셋, 돌격대는 AI 수비 방침만 꺼진다`);
  if (ed.old) fail('옛 「변경 전 / 후」 판 · 포지션 드롭다운이 남아 있다');
  {
    // 명령 2×2의 이름이 어느 언어에서도 「…」로 잘리지 않는다 (2026-11-17 — 「배치」 · 「아이템」 · 「AI 방침」 · 「저장」으로 줄였다)
    const dir = 'packages/client/src/i18n/strings/';
    const names = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
      const j = JSON.parse(readFileSync(dir + f, 'utf8')) as Record<string, string>;
      return { lang: f.replace('.json', ''), labels: ['squad.cmd.deploy', 'squad.cmd.policy', 'squad.cmd.save'].map((k) => j[k]!) };
    });
    const cut = await page.evaluate((all) => {
      const lbls = [...document.querySelectorAll('.sqe-grid > .btn .lbl')] as HTMLElement[];
      const keep = lbls.map((l) => l.textContent);
      const out = all.flatMap((n) => n.labels.map((text, i) => {
        lbls[i]!.textContent = text;
        return lbls[i]!.scrollWidth > lbls[i]!.clientWidth + 0.5 ? `${n.lang}:${text}` : null;
      }).filter((x): x is string => x !== null));
      lbls.forEach((l, i) => { l.textContent = keep[i]!; });
      return out;
    }, names);
    if (cut.length) fail(`명령 이름이 잘린다 — ${cut.join(', ')}`);
  }
  ok(`${ed.title} · 줄 ${ed.rows} · [${ed.acts}]`);

  step('기물 바꾸기 — Rock 줄을 Knight로 (농지와 같은 팝업)');
  await page.click('[data-field="piece-1"]');
  await page.waitForSelector('[data-modal="swapPiece"]');
  await page.waitForTimeout(600);   // 목판 · 금테 그림이 처음 읽히는 동안
  await shot('05-edit-swap');
  await page.click('[data-modal="swapPiece"] [data-piece="Knight"]');
  if (await page.getAttribute('.sqe-row[data-row="1"]', 'data-piece') !== 'Knight') fail('Rock 줄이 Knight가 되지 않았다');
  ok('Rock → Knight');

  step('배치 편집 (69쪽) — 옛 Rock 자리에 Knight, [배치 완료]는 저장하지 않고 편집으로 돌아온다');
  const before = await page.evaluate(() => (window as any).__profile.current.squads.find((s: any) => s.id === 'atk-3v3').deploy.P1);
  await page.click('[data-action="toDeploy"]');
  await page.waitForSelector('[data-screen="squadDeploy"]');
  await shot('08-deploy');
  const rockAt = before.find((c: any) => c.piece === 'Rock');
  const knight = await page.$(`.sqb-cell[data-x="${rockAt.x}"][data-y="${rockAt.y}"][data-piece="Knight"][data-team="ours"]`);
  if (!knight) fail(`옛 Rock 자리(${rockAt.x},${rockAt.y})에 Knight가 없다`);
  // Knight 카드(2026-11-18 — 장수 카드) → 빈 우리 칸 하나
  await page.click('[data-action="deployPlace"][data-piece="Knight"]');
  const target = await page.$('.sqb-cell[data-zone="ours"][data-team=""]:not([data-depot])');
  const tx = await target!.getAttribute('data-x'); const ty = await target!.getAttribute('data-y');
  await page.click(`.sqb-cell[data-x="${tx}"][data-y="${ty}"]`);
  await page.waitForTimeout(60);
  if (!await page.$(`.sqb-cell[data-x="${tx}"][data-y="${ty}"][data-piece="Knight"]`)) fail('칸을 눌렀는데 옮겨지지 않았다');
  if ((await page.textContent('[data-action="deploySave"]'))?.trim() !== '배치 완료') fail('배치 마지막 단추가 「배치 완료」가 아니다');
  await page.click('[data-action="deploySave"]');
  await page.waitForSelector('[data-screen="squadEdit"][data-dirty="1"]');
  const untouched = await page.evaluate(() => (window as any).__profile.current.squads.find((s: any) => s.id === 'atk-3v3').picks[1].piece);
  if (untouched !== 'Rock') fail('[배치 완료]만으로 계정이 바뀌었다 — 저장은 [저장]에서');
  ok(`Knight가 옛 Rock 자리에 섰고 (${tx},${ty})로 옮겼다 · 계정은 아직 그대로`);

  step('아이템 — 장수 카드의 [아이템] → 병기 · 아이템 고르기: King에게 탕약 (병기는 대장간으로)');
  await page.click('.sqe-row[data-piece="King"][data-officer]');
  await page.waitForSelector('.ofcard [data-action="heldOpen"]');
  // 병기 줄(그림 아래 · 책략 위)은 없다 — 지닌 것은 [아이템] 단추 오른쪽에만 (2026-11-17 기획자)
  if (await page.$('.ofcard [data-field="equip"]')) fail('장수 카드에 병기 줄이 남아 있다');
  // 카드 단추 차례 — [아이템] · [뒤로 가기] · [해제하기](맨 아래) (2026-11-17 기획자)
  const cardActs = await page.$$eval('.ofcard .btn[data-action]', (els) => els.map((e) => (e as HTMLElement).dataset.action).join(','));
  if (!cardActs.endsWith('heldOpen,cardBack,cardRelease')) fail(`카드 단추 차례가 [${cardActs}]다`);
  // [아이템] 단추에는 그림이 없다 — 이름만 (2026-11-17 기획자)
  if (await page.$('.ofcard [data-action="heldOpen"] img, .ofcard [data-action="heldOpen"] .ofcard-lead-icon')) fail('[아이템] 단추에 그림이 남아 있다');
  await page.waitForTimeout(500);
  await shot('09-card');
  await page.click('.ofcard [data-action="heldOpen"]');
  await page.waitForSelector('[data-modal="heldPick"]');
  // 처음 탭은 병기(아이템을 안 들었다) — 낀 자루가 금빛 네온
  if (await page.getAttribute('[data-modal="heldPick"] .sqh-cell[data-equip="dae-gam-do"]', 'data-on') !== '1') fail('고르기 팝업의 병기 탭에서 낀 병기가 안 빛난다');
  // 한 쪽에 넷 × 두 줄 = 8, 병기 15종은 두 쪽(2026-11-17 기획자). 「n개」 — 대감도는 두 자루 중 안 낀 한 자루, 나머지는 한 자루씩
  const cellsOf = () => page.$$eval('[data-modal="heldPick"] .sqh-cell', (els) => els.map((e) => (e.querySelector('.sqh-cap') as HTMLElement).textContent ?? ''));
  const pg = await page.$eval('[data-modal="heldPick"] [data-field="heldPager"]', (e) => `${(e as HTMLElement).dataset.page}/${(e as HTMLElement).dataset.pages}`);
  if (pg === '2/2') await page.click('[data-modal="heldPick"] [data-action="heldPrevPage"]');   // 낀 병기가 둘째 쪽이면 거기서 열린다
  const p1 = await cellsOf();
  const grid1 = await page.$eval('[data-modal="heldPick"] .sqh-grid', (g) => ({ cols: getComputedStyle(g).gridTemplateColumns.split(' ').length, h: g.getBoundingClientRect().height }));
  const box1 = await page.$eval('[data-modal="heldPick"] .modal', (m) => m.getBoundingClientRect().height);
  await page.click('[data-modal="heldPick"] [data-action="heldNextPage"]');
  const p2 = await cellsOf();
  const box2 = await page.$eval('[data-modal="heldPick"] .modal', (m) => m.getBoundingClientRect().height);
  await page.click('[data-modal="heldPick"] [data-action="heldPrevPage"]');
  if (!pg.endsWith('/2') || p1.length !== 8 || p2.length !== 7 || grid1.cols !== 4) fail(`쪽 ${pg} · 칸 ${p1.length}+${p2.length} · 열 ${grid1.cols} — 넷 × 두 줄, 두 쪽이어야`);
  if ([...p1, ...p2].some((c) => c !== '1개')) fail(`병기 칸 글자가 [${[...p1, ...p2].join(',')}]다 — 전부 「1개」여야`);
  if (Math.abs(box1 - box2) > 1) fail(`쪽을 넘기자 팝업 높이가 ${box1} → ${box2}로 바뀐다`);
  {
    // 탭 — 동전은 왼쪽 끝 · 이름은 열 언어 어디서도 한 줄, 「…」로 안 잘린다 · 금테 둘째 (2026-11-17 기획자)
    const dir = 'packages/client/src/i18n/strings/';
    const names = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
      const j = JSON.parse(readFileSync(dir + f, 'utf8')) as Record<string, string>;
      return { lang: f.replace('.json', ''), labels: ['squad.held.tab.weapon', 'squad.held.tab.item'].map((k) => j[k]!) };
    });
    const tabs = await page.evaluate((all) => {
      const tabEls = [...document.querySelectorAll('[data-modal="heldPick"] .sqh-tab')] as HTMLElement[];
      const lbls = tabEls.map((e) => e.querySelector('.sqh-tab-lbl') as HTMLElement);
      const keep = lbls.map((l) => l.textContent);
      const cut = all.flatMap((n) => n.labels.map((text, i) => {
        lbls[i]!.textContent = text;
        return lbls[i]!.scrollWidth > lbls[i]!.clientWidth + 0.5 || lbls[i]!.getClientRects().length > 1 ? `${n.lang}:${text}` : null;
      }).filter((x): x is string => x !== null));
      lbls.forEach((l, i) => { l.textContent = keep[i]!; });
      const left = tabEls.every((e) => (e.querySelector('.gic') as HTMLElement).getBoundingClientRect().left - e.getBoundingClientRect().left < 12);
      const frame = tabEls.every((e) => getComputedStyle(e).borderImageSource.includes('frame-gold-2'));
      // [이전] · [다음] — 화살표 목판(`pager-next.png`, ::before) 한 장만. 단추 자체의 배경 · 테 그림은 없다
      const pg = [...document.querySelectorAll('[data-modal="heldPick"] .pg-btn')].map((b) => {
        const cs = getComputedStyle(b);
        return `${cs.backgroundImage}|${cs.borderImageSource}|${getComputedStyle(b, '::before').backgroundImage.includes('pager-next') ? 'arrow' : '-'}`;
      });
      return { cut, left, frame, pg };
    }, names);
    if (tabs.cut.length) fail(`탭 이름이 잘린다 — ${tabs.cut.join(', ')}`);
    if (!tabs.left || !tabs.frame) fail(`탭 — 동전 왼쪽 ${tabs.left} · 금테 ${tabs.frame}`);
    if (tabs.pg.some((x) => x !== 'none|none|arrow')) fail(`쪽 넘김 단추에 그림이 겹친다 — ${tabs.pg.join(' / ')}`);
  }
  {
    // 칸마다 후광(대장간 · 장터와 같은 섬광) · 머리 「보유」는 지닌 것 칸 위, 「회수」는 회수 칸 위 (2026-11-17 기획자)
    const look = await page.evaluate(() => {
      const m = document.querySelector('[data-modal="heldPick"]')!;
      const cells = [...m.querySelectorAll('.sqh-cell')];
      const cx = (e: Element) => { const r = e.getBoundingClientRect(); return r.left + r.width / 2; };
      const [own, rev] = [...m.querySelectorAll('.sqh-now-head > span')];
      return {
        glow: cells.filter((c) => c.querySelector('.blink-box')).length, cells: cells.length,
        head: `${own?.textContent}/${rev?.textContent}`,
        dOwn: Math.abs(cx(own!) - cx(m.querySelector('.sqh-now > .sqh-tile')!)),
        dRev: Math.abs(cx(rev!) - cx(m.querySelector('[data-action="heldRevoke"]')!)),
      };
    });
    if (look.glow !== look.cells) fail(`후광이 ${look.glow}/${look.cells}칸에만 있다`);
    if (look.head !== '보유/회수' || look.dOwn > 2 || look.dRev > 2) fail(`머리 줄 ${JSON.stringify(look)}`);
  }
  // 지닌 것 밑 줄은 효과 설명(「병기」 · 「아이템」이 아니다)
  const heldTxt = await page.textContent('[data-modal="heldPick"] [data-field="heldText"]');
  // 이름 줄은 설명 길이와 상관없이 같은 높이 — 설명 칸은 언제나 두 줄 자리
  const nameTop = () => page.$eval('[data-modal="heldPick"] [data-field="heldName"]', (e) => e.getBoundingClientRect().top);
  const top1 = await nameTop();
  await page.$eval('[data-modal="heldPick"] [data-field="heldText"]', (e) => { (e as HTMLElement).dataset.keep = e.textContent ?? ''; e.textContent = 'x'; });
  const top2 = await nameTop();
  await page.$eval('[data-modal="heldPick"] [data-field="heldText"]', (e) => { e.textContent = 'x '.repeat(200); });
  const top3 = await nameTop();
  await page.$eval('[data-modal="heldPick"] [data-field="heldText"]', (e) => { e.textContent = (e as HTMLElement).dataset.keep ?? ''; });
  if (Math.abs(top1 - top2) > 0.5 || Math.abs(top1 - top3) > 0.5) fail(`설명 길이에 따라 이름 줄이 움직인다 — ${top1} / ${top2} / ${top3}`);
  if (!heldTxt || heldTxt === '병기' || heldTxt === '아이템') fail(`지닌 것 밑 줄이 「${heldTxt}」다 — 효과 설명이어야`);
  await page.waitForTimeout(500);
  await shot('10-held-weapon');
  await page.click('[data-modal="heldPick"] .sqh-tab[data-tab="item"]');
  await page.click('[data-modal="heldPick"] .sqh-cell[data-item="tang-yak"]');
  await page.waitForTimeout(150);
  if (await page.getAttribute('[data-modal="heldPick"] .sqh-now [data-field="heldTile"]', 'data-held') !== 'tang-yak') fail('탕약을 골랐는데 고정 칸이 안 바뀐다');
  // 오른쪽 회수 — 누르면 비었음 · 「아이템을 선택하세요.」, 빈손이어도 눌린다(아무 일 없음)
  await page.click('[data-modal="heldPick"] [data-action="heldRevoke"]');
  if (await page.getAttribute('[data-modal="heldPick"] .sqh-now [data-field="heldTile"]', 'data-held') !== '') fail('회수했는데 고정 칸이 안 빈다');
  if (await page.textContent('[data-modal="heldPick"] [data-field="heldName"]') !== '비었음') fail('회수한 뒤 이름 칸이 「비었음」이 아니다');
  if (!await page.isEnabled('[data-modal="heldPick"] [data-action="heldRevoke"]')) fail('빈손인데 회수 단추가 꺼졌다');
  await page.waitForTimeout(300);
  await shot('11-held-empty');
  await page.click('[data-modal="heldPick"] .sqh-cell[data-item="tang-yak"]');
  await page.waitForTimeout(150);
  await shot('11-held-item');
  // [설정 완료] — 바뀌었으면 「저장되었습니다」 미니 팝업 → [확인]으로 카드에 (2026-11-17 기획자)
  if (await page.textContent('[data-action="heldClose"] .lbl') !== '설정 완료') fail('고르기 팝업의 아래 단추가 [설정 완료]가 아니다');
  await page.click('[data-action="heldClose"]');
  await page.waitForSelector('[data-modal="heldSaved"]');
  if (await page.textContent('[data-modal="heldSaved"] .sqh-saved-msg') !== '아이템 설정이 적용되었습니다.') fail('적용 알림 글이 다르다');
  if (await page.textContent('[data-modal="heldSaved"] [data-field="heldSavedName"]') !== '탕약') fail('적용 알림 밑 줄에 탕약이 안 보인다');
  await page.waitForTimeout(400);
  await shot('12-held-saved');
  await page.click('[data-action="heldSavedOk"]');
  await page.waitForSelector('[data-modal="heldPick"]', { state: 'detached' });
  await page.waitForSelector('.ofcard [data-action="heldOpen"]');
  // 아무것도 안 바꾸고 [설정 완료] — 알림 없이 곧장 카드로
  await page.click('.ofcard [data-action="heldOpen"]');
  await page.waitForSelector('[data-modal="heldPick"]');
  await page.click('[data-action="heldClose"]');
  await page.waitForSelector('[data-modal="heldPick"]', { state: 'detached' });
  if (await page.$('[data-modal="heldSaved"]')) fail('안 바꿨는데 저장 알림이 떴다');
  await page.click('.ofcard [data-action="cardBack"]');
  await page.waitForTimeout(150);
  if (await page.getAttribute('.sqe-row[data-piece="King"] [data-field="held"] .sqe-item', 'data-item') !== 'tang-yak') fail('King 줄 병기구 칸에 탕약이 안 보인다');
  // 줄의 병기구 칸 — 병기도 아이템도 정사각 칸 + 후광, 대장간의 3:1 목록 그림(.frg-thumb)은 없다
  const rowArt = await page.$$eval('.sqe-row [data-field="held"]', (els) => els.map((e) => e.querySelector('.frg-thumb') ? 'frg' : e.querySelector('.sqe-item') ? (e.querySelector('.sqe-item .blink-box') ? 'glow' : 'bare') : '-'));
  if (rowArt.some((x) => x === 'frg' || x === 'bare') || !rowArt.includes('glow')) fail(`줄의 병기구 칸이 [${rowArt.join(',')}]다`);
  ok(`카드 단추 [${cardActs}] · 병기 탭에 낀 자루 · 아이템 탭에서 탕약 → 고정 칸 · 줄에 탕약`);

  step('부대원 빼기 — 카드의 [해제하기] → (2/3 명) · 맨 위 줄이 경고 표지');
  await page.click('.sqe-row[data-row="2"][data-officer]');
  await page.click('.ofcard [data-action="cardRelease"]');
  await page.waitForTimeout(150);
  if ((await page.textContent('[data-field="count"]'))?.trim() !== '구성원 변경 (2/3 명)') fail('빼고 나서 제목이 (2/3 명)이 아니다');
  if (await page.getAttribute('.sqe-top .sql-row', 'data-state') !== 'partial') fail('덜 찬 부대의 맨 위 줄이 경고가 아니다');
  if (await page.isEnabled('[data-action="toDeploy"]')) fail('덜 찼는데 [부대 배치]가 열려 있다');
  await shot('11-edit-partial');
  ok('(2/3 명) · 경고 표지 · 배치 잠김');

  step('[저장] — 한 번에 저장하고 목록으로, 덜 찬 부대도 남는다');
  await page.click('[data-action="saveSquad"]');
  await page.waitForSelector('[data-screen="squads"]');
  const saved = await page.evaluate(() => {
    const p = (window as any).__profile.current;
    return { sq: p.squads.find((s: any) => s.id === 'atk-3v3'), carry: p.marketCarry, forge: p.forgeOwned };
  });
  if (saved.sq.picks.length !== 2 || saved.sq.picks[1].piece !== 'Knight') fail(`저장된 부대가 ${JSON.stringify(saved.sq.picks)}다`);
  if (saved.carry?.[own[0]!] !== 'tang-yak') fail('탕약이 저장되지 않았다');
  if (saved.forge['dae-gam-do#1'] !== null) fail('탕약을 든 장수의 병기가 대장간으로 돌아가지 않았다');
  if (await page.getAttribute('.sql-row[data-slot="atk-3v3"] [data-field="mark"]', 'data-state') !== 'partial') fail('목록의 덜 찬 줄이 경고 표지가 아니다');
  // 서버도 덜 찬 부대를 버리지 않는다 — 되접기(`migrateProfile`)가 읽을 때마다 지난다.
  // 저장 큐가 PUT을 보내는 동안을 고정 시간으로 기다리면 흔들린다(1.5초로 한 번 떨어졌다) — 올 때까지 본다
  await page.evaluate(() => (window as any).__profile.flush());
  let server: { picks: unknown[] } | undefined;
  for (let i = 0; i < 16 && server?.picks.length !== 2; i += 1) {
    server = (await getProfile(uid))!.squads.find((s) => s.id === 'atk-3v3');
    if (server?.picks.length !== 2) await page.waitForTimeout(500);
  }
  if (server?.picks.length !== 2) fail(`서버의 덜 찬 부대가 ${JSON.stringify(server?.picks)}다 — 되접기가 버렸다`);
  await shot('12-list-partial');
  ok('덜 찬 부대 · 아이템 · 병기 회수가 한 번에 저장됐다 · 목록은 경고 표지');

  step('저장하지 않고 나가기 — 묻고, 계정은 그대로');
  await page.click('.sql-row[data-slot="def-3v3"]');
  await page.waitForSelector('[data-screen="squadEdit"]');
  if (!await page.isEnabled('[data-action="garrisonPolicy"]')) fail('완성된 수성군인데 [AI 수비 방침]이 꺼져 있다');
  await page.click('.sqe-row[data-row="1"][data-officer]');
  await page.click('.ofcard [data-action="cardRelease"]');
  await page.click('.place-bar [data-action="back"]');
  await page.waitForSelector('[data-modal="leaveSquad"]');
  await page.waitForTimeout(700);   // 목판 그림이 처음 읽히는 동안
  await shot('13-leave');
  {
    // 팝업 크기는 가장 긴 언어로 못 박았다 — 열 언어의 문구를 끼워 넣어 제목 · 단추가 한 줄에 들고 본문이 정한 높이 안인지 잰다 (2026-11-17)
    const dir = 'packages/client/src/i18n/strings/';
    const langs = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
      const j = JSON.parse(readFileSync(dir + f, 'utf8')) as Record<string, string>;
      return { lang: f.replace('.json', ''), title: j['squad.leave.title']!, body: j['squad.leave.body']!, save: `[${j['squad.cmd.save']!}]`, no: j['squad.leave.no']!, yes: j['squad.leave.yes']! };
    });
    // 단추 이름 앞의 띄어쓰기가 살아 있다 — 본문 칸이 flex라 글 조각이 따로 서면 「내용은[저장]을」로 붙었다
    const gap = await page.evaluate(() => {
      // 앞 글 조각에서 끝의 띄어쓰기를 뺀 「마지막 보이는 글자」의 오른쪽 끝과 「[저장]」 왼쪽 끝 사이 — 띄어쓰기가 지워졌으면 0
      const nameEl = document.querySelector('[data-field="leaveBtnName"]')!;
      const text = nameEl.previousSibling as Text;
      const r = document.createRange();
      r.setStart(text, 0); r.setEnd(text, text.length - 1);
      const rects = [...r.getClientRects()];
      const last = rects[rects.length - 1]!;
      const name = nameEl.getBoundingClientRect();
      return Math.abs(last.top - name.top) < 4 ? Math.round(name.left - last.right) : 99;   // 줄이 갈리면 띄어쓰기가 줄 끝에 있다
    });
    if (gap < 2) fail(`「[저장]」 앞 띄어쓰기가 없다 — 간격 ${gap}px`);
    const fit = await page.evaluate((all) => {
      const m = document.querySelector('[data-modal="leaveSquad"] .modal') as HTMLElement;
      const title = m.querySelector('[data-field="leaveTitle"]') as HTMLElement;
      const body = m.querySelector('[data-field="leaveBody"]') as HTMLElement;
      const no = m.querySelector('[data-action="leaveStay"] .lbl') as HTMLElement;
      const yes = m.querySelector('[data-action="leaveYes"] .lbl') as HTMLElement;
      const keep = [body.innerHTML, title.textContent, no.textContent, yes.textContent] as const;
      const out = all.map((l) => {
        title.textContent = l.title; no.textContent = l.no; yes.textContent = l.yes;
        const [b1, b2 = ''] = l.body.split('{btn}');
        body.textContent = '';
        const name = document.createElement('span');
        name.className = 'nobr'; name.textContent = l.save;
        const wrap = document.createElement('span');   // 화면과 같은 한 덩어리(`LeaveBody`)
        wrap.append(b1!, name, b2);
        body.append(wrap);
        const over = (e: HTMLElement) => Math.max(0, Math.ceil(e.scrollWidth - e.clientWidth));
        const lh = parseFloat(getComputedStyle(body).lineHeight);
        return { lang: l.lang, title: over(title), no: over(no.parentElement as HTMLElement) + over(no), yes: over(yes.parentElement as HTMLElement) + over(yes),
          lines: Math.round(body.scrollHeight / lh), h: Math.round(m.getBoundingClientRect().height), split: name.getClientRects().length };
      });
      body.innerHTML = keep[0]; title.textContent = keep[1]; no.textContent = keep[2]; yes.textContent = keep[3];
      return out;
    }, langs);
    console.log(`    언어별 — ${fit.map((f) => `${f.lang} 제목+${f.title} 단추+${f.no}/${f.yes} 본문${f.lines}줄 높이${f.h} 이름${f.split}줄`).join(' · ')}`);
    // 「[저장]」이 줄바꿈으로 갈리면 줄 상자가 둘이 된다
    const bad = fit.filter((f) => f.title > 0 || f.no > 0 || f.yes > 0 || f.lines > 2 || f.split !== 1);
    if (bad.length) fail(`나가기 팝업이 언어에 따라 넘친다 — ${bad.map((f) => f.lang).join(', ')}`);
    if (new Set(fit.map((f) => f.h)).size !== 1) fail(`나가기 팝업 높이가 언어마다 다르다 — ${fit.map((f) => `${f.lang}:${f.h}`).join(' ')}`);
  }
  await page.click('[data-action="leaveYes"]');
  await page.waitForSelector('[data-screen="squads"]');
  const def3 = await page.evaluate(() => (window as any).__profile.current.squads.find((s: any) => s.id === 'def-3v3').picks.length);
  if (def3 !== 3) fail('저장하지 않고 나갔는데 수성군이 바뀌었다');
  ok('[행동 방침] 켜짐 · 나가기 확인 · 계정 그대로');

  step('빈 칸 채우기 — 5v5 공격대: 다섯 자리 · 카드로 고르기 · 기본 배치 팝업 · [저장]');
  await page.click('.sql-row[data-slot="atk-5v5"]');
  await page.waitForSelector('[data-screen="squadEdit"][data-new="1"]');
  const start = await page.$$eval('.sqe-row[data-piece]', (els) => els.map((e) => (e as HTMLElement).dataset.piece));
  if (start.join(',') !== 'King,Rock,Queen,Bishop,Knight') fail(`5v5 처음 포지션이 [${start.join(' ')}]다`);
  await shot('14-new-members-empty');
  for (let row = 0; row < 5; row += 1) {
    await page.click(`[data-action="pickOfficer"][data-row="${row}"]`);
    await page.waitForSelector('[data-modal="officerPick"]');
    await page.click(`[data-modal="officerPick"] .ofc-row[data-officer] >> nth=${row + 3}`);
    await page.click('.ofcard [data-action="cardSelect"]');
    await page.waitForSelector('[data-modal="officerPick"]', { state: 'detached' });
  }
  await shot('15-new-members-full');
  if ((await page.textContent('[data-field="count"]'))?.trim() !== '구성원 변경 (5/5 명)') fail('다 채웠는데 (5/5 명)이 아니다');
  await page.click('[data-action="toDeploy"]');
  await page.waitForSelector('[data-screen="squadDeploy"]');
  await page.click('[data-action="deploySave"]');
  await page.waitForSelector('[data-modal="deployDefault"]');
  await page.click('[data-action="deployDefaultOk"]');
  await page.waitForSelector('[data-screen="squadEdit"]');
  await page.click('[data-action="saveSquad"]');
  await page.waitForSelector('[data-screen="squads"]');
  const five = await page.$$eval('.sql-row[data-slot="atk-5v5"] .sql-cell .ofc-stand', (els) => els.length);
  if (five !== 5) fail(`채운 5v5 공격대 줄에 꼬마가 ${five}명이다`);
  if (await page.getAttribute('.sql-row[data-slot="atk-5v5"] [data-field="mark"]', 'data-state') !== 'done') fail('채운 5v5 공격대가 완성 표지가 아니다');
  await page.waitForTimeout(1_200);   // 방금 고른 장수의 꼬마 그림이 읽히는 동안
  await shot('19-list-full');
  ok('5v5 공격대 — 처음 포지션 · 카드 고르기 · 기본 배치 팝업 · 저장 후 목록 완성 표지');

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' | ')}`);
  console.log('\n✓ 병영 UX 한 바퀴 완주');
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
