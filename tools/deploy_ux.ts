/**
 * 부대 배치 편집 UX 확인 (2026-11-17 · 2026-11-18 기획자 다시 짬) —
 * 머리 판: 왼쪽 위 제목 「장수 배치」 · 그 밑 안내 한 줄(왼쪽) · 장수 카드 다섯 칸(위 기물 + 꼬마 · 아래 띠 좌표, 3인팀은 남는 칸 자물쇠).
 * 본 판: 지도뿐(단추 없음) · 15 × 8 창 · 좌표 · 화살표 넷(제 쪽으로 둥실) · 미니맵은 창 귀퉁이 4 × 4칸 자리(남군 화면은 오른쪽 위 · 북군은 오른쪽 아래, 구석 창이면 위) · 위아래 여백 같음.
 * 조작 판: [기본 배치로] 위 · [배치 완료] 아래, [뒤로 가기] 없음 — 머리 막대의 [뒤로 가기]도 저장하고 돌아간다.
 * 카드 한 명씩(고른 카드 금빛 테 · 판의 기물 금빛 점멸)(구역 밖 경고 · 빈 칸 · 자리 바꾸기 · 좌표 갱신), 공격대(남군 고정 · 탭 없음 — 북군은 판에서 돌려 깐다, 2026-11-18) · 수비대(북군 고정 · 깃발 없음 · 수성전 판)
 *
 *   VW=760 VH=1200 SHOTS=<dir> [UI_LANG=mn] node --experimental-strip-types --env-file=.env tools/deploy_ux.ts
 *
 * 5173(Vite) · 8787(게임 API)가 떠 있어야 한다. 시험 계정을 만들고 칸 넷을 다 채운 뒤 각 칸의 배치 화면을 찍고,
 * 끝나면 계정을 지운다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { newInstance } from '@samchess/meta';
import type { RosterPick, Squad } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
/** 무엇만 찍을지 — `atk-3v3,def-5v5`처럼. 없으면 넷 다 */
const ONLY = (process.env['SLOTS'] ?? '').split(',').filter(Boolean);

const failures: string[] = [];
const fail = (m: string): void => { console.error(`  ✗ ${m}`); failures.push(m); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);

const email = `deploy-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const adminHeaders = { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST', headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? 760), height: Number(process.env['VH'] ?? 1200) },
});
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
page.on('response', (r) => { if (r.status() === 404 && new URL(r.url()).pathname !== '/profile') errors.push(`404 ${new URL(r.url()).pathname}`); });
/** 다른 언어로 돌면 한국어 글자를 보는 검사는 건너뛴다 — 긴 언어에서 단추 · 안내가 잘리는지는 사진으로 본다 */
const UI_LANG = process.env['UI_LANG'];
const KO = !UI_LANG || UI_LANG === 'ko';
if (UI_LANG) await page.addInitScript((l) => { try { localStorage.setItem('samchess.lang', l); } catch { /* 없다 */ } }, UI_LANG);
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
    await page.fill('.scr-new .newgame-form input', `배치실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);

  // 안내 무관은 Playwright(`navigator.webdriver`)에서 저절로 꺼진다(`guidesEnabled`)
  step('장수 20명 · 칸 넷을 다 채운다');
  const stored = await getProfile(uid);
  const roster = { ...stored!.roster } as Record<string, ReturnType<typeof newInstance>>;
  for (const o of OFFICERS.slice(0, 20)) if (!roster[o.id]) roster[o.id] = newInstance(o.id as OfficerId);
  const own = Object.keys(roster) as OfficerId[];
  const now = Date.now();
  const picks = (mode: '3v3' | '5v5', o: number): RosterPick[] => (mode === '3v3'
    ? (['King', 'Rock', 'Queen'] as const) : (['King', 'Rock', 'Bishop', 'Knight', 'Queen'] as const))
    .map((piece, i) => ({ piece, officer: own[o + i]! }));
  const squads: Squad[] = [
    { id: 'atk-3v3', role: 'attack', mode: '3v3', picks: picks('3v3', 0), deploy: { P1: null, P2: null }, record: {}, createdAt: now - 4e5 },
    { id: 'def-3v3', role: 'defense', mode: '3v3', picks: picks('3v3', 3), deploy: { P1: null, P2: null }, record: {}, createdAt: now - 3e5 },
    { id: 'atk-5v5', role: 'attack', mode: '5v5', picks: picks('5v5', 6), deploy: { P1: null, P2: null }, record: {}, createdAt: now - 2e5 },
    { id: 'def-5v5', role: 'defense', mode: '5v5', picks: picks('5v5', 11), deploy: { P1: null, P2: null }, record: {}, createdAt: now - 1e5 },
  ];
  await saveProfileTrusted(uid, {
    ...stored!, cityLevel: 11, buildings: { ...stored!.buildings, palace: 11 }, roster, squads,
  } as Parameters<typeof saveProfileTrusted>[1]);
  ok(`장수 ${own.length}명 · 칸 넷`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });

  for (const slot of ['atk-3v3', 'def-3v3', 'atk-5v5', 'def-5v5']) {
    if (ONLY.length && !ONLY.includes(slot)) continue;
    step(`${slot} — 배치 편집`);
    await page.click('.scr-main [data-place="barracks"]', { force: true });
    await page.waitForSelector('.scr-place-barracks');
    await page.click('[data-action="squads"]');
    await page.waitForSelector('[data-screen="squads"]');
    await page.click(`.sql-row[data-slot="${slot}"]`);
    await page.waitForSelector('[data-screen="squadEdit"]');
    await page.click('[data-action="toDeploy"]');
    await page.waitForSelector('[data-screen="squadDeploy"]');
    await page.waitForTimeout(900);
    await shot(`${slot}-1`);
    // 세 판이 화면(프레임) 안에 다 든다 — 조작 판 바닥이 프레임 바닥 위
    const fit = await page.evaluate(() => {
      const f = document.querySelector('#frame')!.getBoundingClientRect();
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      return { frame: Math.round(f.bottom), acts: Math.round(box('.sqb-acts').bottom), head: Math.round(box('.sqb-head').height),
        main: Math.round(box('.sqb-panel').height), ctl: Math.round(box('.sqb-acts').height) };
    });
    console.log(`  높이 ${JSON.stringify(fit)}`);
    if (fit.acts > fit.frame + 0.5) fail(`${slot}: 조작 판이 화면 밖으로 ${fit.acts - fit.frame}px 넘친다`);

    /** 미니맵 상자가 창의 어느 4 × 4칸 자리에 앉았나 — 오른쪽 · 위/아래에 붙었는지, 폭이 4칸 · 정사각인지 */
    const miniSpot = () => page.evaluate(() => {
      const v = document.querySelector('.sqb-view')!.getBoundingClientRect();
      const m = document.querySelector('.sqb-minibox')!.getBoundingClientRect();
      const cw = v.width / 15;
      return {
        at: (document.querySelector('.sqb-minibox') as HTMLElement).dataset.at ?? '',
        right: Math.abs(m.right - v.right) < 1.5, top: Math.abs(m.top - v.top) < 1.5, bottom: Math.abs(m.bottom - v.bottom) < 1.5,
        cols: Math.round((m.width / cw) * 10) / 10, square: Math.abs(m.width - m.height) < 1.5,
        // 6 — 지도가 판을 꽉 채운다(테만 얇게)
        fill: Math.round((document.querySelector('.sqb-mini')!.getBoundingClientRect().width / m.width) * 100) / 100,
      };
    });
    const look = await page.evaluate(() => {
      const bar = document.querySelector('[data-screen="squadDeploy"]') as HTMLElement;
      const cell = document.querySelector('.sqb-board .sqb-cell') as HTMLElement | null;
      const r = cell?.getBoundingClientRect();
      const top = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
      const head = document.querySelector('.sqb-head')!.getBoundingClientRect();
      const ttl = document.querySelector('.sqb-head-ttl');
      return {
        side: bar.dataset.side, view: (document.querySelector('.sqb-view') as HTMLElement | null)?.dataset.view ?? '',
        tabs: document.querySelectorAll('[data-action="deploySide"]').length,
        flag: !!document.querySelector('[data-field="sideFixed"]'),
        cells: document.querySelectorAll('.sqb-board .sqb-cell').length,
        castle: document.querySelectorAll('.sqb-board .sqb-cell[data-fort]').length,
        cell: r ? `${Math.round(r.width)}×${Math.round(r.height)}` : '-',
        mini: !!document.querySelector('.sqb-view .sqb-minibox [data-field="minimap"]'),
        miniText: !!document.querySelector('.sqb-mini-ttl, .sqb-mini-hint'),
        title: ttl?.textContent ?? '',
        titleLeft: !!ttl && ttl.getBoundingClientRect().left - head.left < head.width * 0.2,
        head: [...document.querySelectorAll('[data-field="deployHead"] [data-field="deployWho"]')].map((e) => e.querySelector('[data-field="at"]')?.textContent ?? '').join(','),
        // 카드 다섯 칸(남는 칸은 자물쇠) — 위에 기물 · 꼬마, 아래 띠에 좌표. 카드가 곧 단추(옛 [배치] · 단검 없음)
        cards: document.querySelectorAll('.sqb-roster > .sqb-card').length,
        locked: document.querySelectorAll('.sqb-roster > .sqb-card[data-locked] .sqb-card-lock').length,
        sets: [...document.querySelectorAll('[data-field="deployWho"]')].every((w) => {
          const card = w.getBoundingClientRect();
          const art = w.querySelector('.sqb-card-art')!.getBoundingClientRect();
          const at = w.querySelector('[data-field="at"]')!.getBoundingClientRect();
          const stand = w.querySelector('.ofc-stand')?.getBoundingClientRect();
          // 꼬마는 「있다」가 아니라 크기가 있어야 보인다 — 후광 상자에 넣자 인라인이 되어 0 × 0으로 사라졌다(2026-11-18)
          return w.matches('button[data-action="deployPlace"]') && !!w.querySelector('.sqb-card-piece') && !!stand && stand.width > 10 && stand.height > 10
            && at.top >= art.bottom - 1 && at.bottom <= card.bottom && at.bottom > card.bottom - card.height * 0.3;
        }),
        placeBtns: document.querySelectorAll('[data-field="deployWho"][data-action="deployPlace"]').length,
        // 꼬마 뒤 후광 — S 자주 · A 흰 별빛 · E 금, 나머지는 없다(부대 관리 · 부대원 · 농지와 같은 표)
        halo: [...document.querySelectorAll('[data-field="deployWho"]')].map((w) => `${(w as HTMLElement).dataset.grade}:${(w.querySelector('.sqb-stand-glow') as HTMLElement | null)?.dataset.blink ?? '-'}`),
        oldBits: document.querySelectorAll('.sqb-place, .sqb-who-turn, .sqb-who').length,
        // 3 — 안내 한 줄은 제목 밑 · 카드 위, 왼쪽 정렬
        msgPos: (() => {
          const m = document.querySelector('[data-field="deployMsg"]')!;
          const mr = m.getBoundingClientRect();
          return mr.top >= ttl!.getBoundingClientRect().bottom - 1 && mr.bottom <= document.querySelector('.sqb-roster')!.getBoundingClientRect().top + 1
            && getComputedStyle(m).textAlign === 'left';
        })(),
        // 7 — 본 판 위아래 여백(판때기 ↔ 지도)이 같다
        gaps: (() => {
          const p = document.querySelector('.sqb-panel')!.getBoundingClientRect();
          const v = document.querySelector('.sqb-view')!.getBoundingClientRect();
          return [Math.round(v.top - p.top), Math.round(p.bottom - v.bottom)];
        })(),
        headOld: !!document.querySelector('[data-field="deployHead"] .sql-row, [data-field="deployHead"] .sql-mark, [data-field="deployHead"] .sql-mode'),
        // 본 판에는 지도뿐 — 칸 · 화살표 밖의 단추가 없다
        panelBtns: [...document.querySelectorAll('.sqb-panel button')].filter((b) => !b.classList.contains('sqb-cell') && !b.classList.contains('sqb-pan')).map((b) => (b as HTMLElement).dataset.action ?? b.className),
        badge: !!document.querySelector('.sqb-pan-n'),
        cols: [...document.querySelectorAll('[data-field="colLabel"]')].map((e) => e.textContent).join(''),
        rows: [...document.querySelectorAll('[data-field="rowLabel"]')].map((e) => e.textContent).join(','),
        stands: document.querySelectorAll('.sqb-cell[data-team="ours"] img.sqb-piece').length,
        // 발밑 타원 없음 · 기물이 칸 경계를 살짝 문다 (2026-11-18 기획자)
        ellipse: [...document.querySelectorAll('.sqb-cell[data-team="ours"]')].some((c) => getComputedStyle(c, '::after').content !== 'none'),
        bigPiece: [...document.querySelectorAll('.sqb-cell[data-team="ours"] img.sqb-piece')].every((p) => p.getBoundingClientRect().width > p.parentElement!.getBoundingClientRect().width),
        // 8 — 두루마리 그림 비율 그대로(902 × 195)
        scroll: (() => {
          const m = document.querySelector('[data-field="deployMsg"]')!;
          const r = m.getBoundingClientRect();
          return getComputedStyle(m).backgroundImage.includes('field-frame') && Math.abs(r.width / r.height - 902 / 195) < 0.1;
        })(),
        standsOld: document.querySelectorAll('.sqb-cell .ofc-stand').length,
        mine: document.querySelectorAll('.sqb-cell[data-team="ours"]').length,
        arrows: [...document.querySelectorAll('[data-action="deployPan"]')].map((b) => (b as HTMLElement).dataset.dir).join(','),
        bob: [...document.querySelectorAll('[data-action="deployPan"]')].every((b) => getComputedStyle(b, '::before').animationName === 'sqb-pan-bob'),
        acts: [...document.querySelectorAll('.sqb-acts button')].map((b) => (b as HTMLElement).dataset.action).join(','),
        resetAbove: top('.sqb-acts [data-action="deployReset"]') < top('[data-action="deploySave"]'),
        help: !!document.querySelector('[data-action="deployHelp"]'),
      };
    });
    console.log(`  ${JSON.stringify(look)}`);
    const defense = slot.startsWith('def-');
    const want = slot.endsWith('3v3') ? 3 : 5;
    // 수비대는 북군 고정에 깃발도 없다 · 성채 아홉 칸. 공격대는 남군 고정 · 탭 없음(2026-11-18 — 북군은 남군 배치를 돌려 깐다)
    if (defense) {
      if (look.side !== 'P2' || look.tabs !== 0 || look.flag) fail(`${slot}: 북군 고정 · 깃발 없음이 아니다 — ${look.side} · 탭 ${look.tabs} · 깃발 ${look.flag}`);
      if (look.castle !== 9) fail(`${slot}: 성채 칸이 ${look.castle}개다`);
    } else {
      if (look.side !== 'P1' || look.tabs !== 0) fail(`${slot}: 공격대가 남군 고정 · 탭 없음이 아니다 — ${look.side} · 탭 ${look.tabs}`);
      if (look.castle !== 0) fail(`${slot}: 공격대 판에 성채가 있다`);
    }
    // 창은 15 × 8
    if (look.view !== 'near' || look.cells !== 120) fail(`${slot}: 창이 ${look.cells}칸이다(15 × 8 = 120)`);
    // 1 — 화살표가 제 쪽으로 둥실(처음은 좌 · 우 + 제 진영 반대쪽)
    const first = defense ? 'down,left,right' : 'up,left,right';
    if (look.arrows !== first) fail(`${slot}: 처음 화살표가 [${look.arrows}]다(${first})`);
    if (!look.bob) fail(`${slot}: 화살표가 둥실거리지 않는다`);
    // 2 · 4 — 미니맵은 판 위 오른쪽 아래 4 × 4칸 자리, 제목 · 안내 없음
    if (!look.mini || look.miniText) fail(`${slot}: 미니맵이 판 위에 없거나 제목 · 안내가 남았다`);
    // 남군 화면은 언제나 오른쪽 위(아래에 두면 우리 장수를 덮는다 — 2026-11-18 기획자), 북군은 오른쪽 아래
    const ms = await miniSpot();
    const homeAt = look.side === 'P1' ? 'top' : 'bottom';
    if (ms.at !== homeAt || !ms.right || !(homeAt === 'top' ? ms.top : ms.bottom) || Math.abs(ms.cols - 4) > 0.15 || !ms.square || ms.fill < 0.9) fail(`${slot}: 미니맵 자리 ${JSON.stringify(ms)}`);
    if (Math.abs(look.gaps[0]! - look.gaps[1]!) > 2) fail(`${slot}: 본 판 위아래 여백이 ${look.gaps.join(' · ')}px다`);
    // 5 · 6 — 본 판에는 단추가 없다([게임 안내] 포함)
    if (look.panelBtns.length || look.help) fail(`${slot}: 본 판에 단추 [${look.panelBtns.join(',')}] · 게임 안내 ${look.help}`);
    // 1 · 2 · 4 · 5 — 제목 왼쪽 · 카드 다섯 칸 · 장수마다 카드
    if (KO && look.title !== '장수 배치') fail(`${slot}: 머리 판 제목이 「${look.title}」다`);
    if (!look.titleLeft) fail(`${slot}: 머리 판 제목이 왼쪽에 없다`);
    if (look.cards !== 5 || look.locked !== 5 - want || !look.sets || look.placeBtns !== want || look.oldBits) fail(`${slot}: 장수 카드가 아니다 — 칸 ${look.cards} · 자물쇠 ${look.locked} · 카드 ${look.placeBtns} · 옛 조각 ${look.oldBits} · 모양 ${look.sets}`);
    if (look.ellipse || !look.bigPiece) fail(`${slot}: 판 위 기물 — 타원 ${look.ellipse} · 칸보다 큼 ${look.bigPiece}`);
    if (!look.scroll) fail(`${slot}: 안내 한 줄이 두루마리 위가 아니다`);
    const HALO: Record<string, string> = { S: 'purple', A: 'plain', E: 'gold' };
    const badHalo = look.halo.filter((h) => { const [g, tone] = h.split(':'); return (HALO[g!] ?? '-') !== tone; });
    if (badHalo.length) fail(`${slot}: 꼬마 후광이 등급과 안 맞는다 [${badHalo.join(',')}]`);
    if (!look.msgPos) fail(`${slot}: 안내 한 줄이 제목 밑 · 카드 위 왼쪽 정렬이 아니다`);
    if (look.head.split(',').length !== want || !look.head.split(',').every((a) => /^[A-Y]\d{1,2}$/.test(a))) fail(`${slot}: 머리 판 좌표가 [${look.head}]다`);
    if (look.headOld) fail(`${slot}: 머리 판에 옛 부대 줄(모드 · 준비 표지)이 남았다`);
    // 10 · 11 — 조작 판은 [기본 배치로] 위 · [배치 완료] 아래 둘뿐
    if (look.acts !== 'deployReset,deploySave' || !look.resetAbove) fail(`${slot}: 조작 판이 [${look.acts}]다`);
    // 화살표 숫자 없음 · 판 위 장수는 기물 그림 · 좌표(위 줄 열 15 · 왼 줄 행 8)
    if (look.badge) fail(`${slot}: 화살표에 숫자가 남았다`);
    if (look.stands !== look.mine || look.standsOld) fail(`${slot}: 판 위 장수 ${look.mine}명 중 기물 그림 ${look.stands}명 · 꼬마 ${look.standsOld}명`);
    if (look.cols.length !== 15 || look.rows.split(',').length !== 8) fail(`${slot}: 좌표가 열 「${look.cols}」 · 행 [${look.rows}]다`);
    // 화살표는 판 바깥 — 판 위에 얹으면 가장자리 칸을 덮어 못 누른다. 탭 · 카드와도 안 겹친다
    const overlap = await page.evaluate(() => {
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      const view = document.querySelector('.sqb-view')!.getBoundingClientRect();
      const others = [...document.querySelectorAll('.sqb-card')].map((e) => [e.className, e.getBoundingClientRect()] as const);
      return [...document.querySelectorAll('[data-action="deployPan"]')].flatMap((b) => {
        const r = b.getBoundingClientRect();
        const what = [...(hit(r, view) ? [`판 ${Math.round(r.bottom - view.top)}px`] : []), ...others.filter(([, o]) => hit(r, o)).map(([n]) => n)];
        return what.length ? [`${(b as HTMLElement).dataset.dir}: ${what.join(' · ')}`] : [];
      });
    });
    if (overlap.length) fail(`${slot}: 화살표 [${overlap.join(',')}]가 판 · 카드를 덮는다`);
    // 미니맵에 가린 우리 장수 — 그 칸은 못 누른다(기획자에게 알릴 값)
    const hidden = await page.evaluate(() => [...document.querySelectorAll('.sqb-cell[data-team="ours"]')].filter((c) => {
      const r = c.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.sqb-cell') !== c;
    }).map((c) => (c as HTMLElement).dataset.piece));
    if (hidden.length) console.log(`  · 미니맵에 가린 우리 장수 [${hidden.join(',')}]`);

    // 우리 편 — 창 안 + 화살표의 수 = 부대원
    const mine = await page.$$eval('.sqb-cell[data-team="ours"]', (e) => e.length);
    const offs = await page.$$eval('[data-action="deployPan"]', (e) => e.map((b) => Number((b as HTMLElement).dataset.off)));
    if (mine + offs.reduce((a, b) => a + b, 0) !== want) fail(`${slot}: 창 안 ${mine} + 화살표 [${offs.join(',')}] ≠ ${want}`);
    // 카드 한 명씩: 차례 표지 · [이동] 그림 + 「…를 배치합니다」 · 구역 밖 경고(차례 그대로) · 빈 칸이면 서고 차례가 꺼진다 · 다른 장수 칸 = 자리 바꾸기
    {
      const state = () => page.evaluate(() => ({
        turn: [...document.querySelectorAll('[data-field="deployWho"]')].findIndex((e) => (e as HTMLElement).dataset.turn === '1'),
        kind: (document.querySelector('[data-field="deployMsg"]') as HTMLElement).dataset.kind,
        msg: document.querySelector('[data-field="deployMsg"]')!.textContent ?? '',
        at: [...document.querySelectorAll('[data-field="deployWho"] [data-field="at"]')].map((e) => e.textContent ?? ''),
        icon: document.querySelector('[data-field="deployMsg"] img.sqb-msg-ico:not([hidden])')?.getAttribute('src') ?? '',
        // 카드 차례 — 그 장수의 기물 그림을 30° 기울여
        badge: (() => {
          const b = document.querySelector('[data-field="deployMsg"] .sqb-msg-badge') as HTMLElement | null;
          const img = b?.querySelector('img');
          if (!b || !img) return '';
          const m = new DOMMatrix(getComputedStyle(img).transform);
          return `${b.dataset.piece}:${Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI)}`;
        })(),
        // 틀 — 높이 · 글자 크기가 안내가 바뀌어도 같고, 글이 종이 안에 든다
        frame: (() => {
          const m = document.querySelector('[data-field="deployMsg"]')!;
          const room = m.querySelector('.sqb-msg-in')!;
          const tx = m.querySelector('.sqb-msg-t:not(.sqb-msg-probe)')!;
          return { h: Math.round(m.getBoundingClientRect().height * 10) / 10, font: getComputedStyle(m).fontSize, fits: tx.scrollHeight <= room.clientHeight + 1 };
        })(),
        // 고른 카드도 판의 그 기물도 금빛 점멸(창 밖이면 판에 없다) — 카드에 테두리 선은 없다
        glow: (() => {
          const c = document.querySelector('[data-field="deployWho"][data-turn]');
          if (!c || getComputedStyle(c).animationName !== 'sqb-card-neon') return false;
          const cell = document.querySelector('.sqb-cell[data-turn] > .sqb-piece');
          return !cell || getComputedStyle(cell).animationName === 'sqb-turn-neon';
        })(),
        neon: document.querySelectorAll('.sqb-cell[data-turn]').length,
      }));
      /** 미니맵에 가리지 않은 칸만 — 누르면 정말 그 칸이 받는다 */
      const openCell = (sel: string) => page.evaluate((q) => [...document.querySelectorAll(q)].map((c) => {
        const r = c.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.sqb-cell') === c
          ? `${(c as HTMLElement).dataset.x},${(c as HTMLElement).dataset.y}` : null;
      }).find(Boolean) ?? null, sel);
      const btn = (i: number) => page.click(`.sqb-roster > .sqb-card:nth-child(${i + 1})`);
      const before = await state();
      const frames = [before.frame];
      if (before.kind !== 'idle' || before.icon || (KO && !before.msg.includes('카드'))) fail(`${slot}: 처음 안내가 ${JSON.stringify(before)}`);
      // 우리 기물을 누르면 이동 범위가 부드럽게 깜빡이고 안내가 [이동] 그림 + 「…의 이동 범위를 봅니다」. 다시 누르면 끈다
      {
        const own = (await openCell('.sqb-cell[data-team="ours"]'))!.split(',');
        await page.click(`.sqb-cell[data-x="${own[0]}"][data-y="${own[1]}"]`);
        const rg = await state();
        const pulse = await page.evaluate(() => {
          const c = document.querySelector('.sqb-cell.range');
          return c ? getComputedStyle(c).animationName : 'none';
        });
        if (rg.kind !== 'range' || !rg.icon.endsWith('cmd/move.png') || (KO && !rg.msg.includes('이동 범위를 봅니다')) || pulse !== 'sqb-range-pulse') fail(`${slot}: 이동 범위 안내가 ${JSON.stringify(rg)} · 깜빡임 ${pulse}`);
        await shot(`${slot}-2b-range`);
        await page.click(`.sqb-cell[data-x="${own[0]}"][data-y="${own[1]}"]`);
        if ((await state()).kind !== 'idle') fail(`${slot}: 이동 범위를 껐는데 안내가 그대로다`);
        frames.push(rg.frame);
      }
      await btn(0);
      let st = await state();
      if (st.turn !== 0 || st.kind !== 'ask' || (KO && !st.msg.includes('배치합니다')) || st.icon || st.badge !== `${(await page.getAttribute('[data-field="deployWho"][data-turn]', 'data-piece'))}:30` || !st.glow || st.neon > 1) fail(`${slot}: 첫 장수 카드가 ${JSON.stringify(st)}`);
      frames.push(st.frame);
      await page.waitForTimeout(900);   // 점멸이 가장 밝은 순간(주기 .9초)
      await shot(`${slot}-3a-place`);
      // 구역 밖 — 창 안의 상대 구역 · 중립 칸
      const out = (await openCell('.sqb-cell:not([data-zone="ours"])[data-team=""]'))!.split(',');
      await page.click(`.sqb-cell[data-x="${out[0]}"][data-y="${out[1]}"]`);
      st = await state();
      if (st.kind !== 'warn' || (KO && !st.msg.includes('파란 영역')) || st.turn !== 0) fail(`${slot}: 구역 밖을 눌렀는데 ${JSON.stringify(st)}`);
      await shot(`${slot}-3b-out`);
      frames.push(st.frame);
      // 3 — 안내가 바뀌어도 틀(높이 · 글자 크기)이 같고 글이 종이 안에 든다
      if (new Set(frames.map((x) => `${x.h}/${x.font}`)).size !== 1 || !frames.every((x) => x.fits)) fail(`${slot}: 안내 틀이 출렁이거나 넘친다 ${JSON.stringify(frames)}`);
      console.log(`  · 안내 틀 ${frames[0]!.h}px · 글자 ${frames[0]!.font}`);
      // 첫 장수 → 빈 우리 칸 하나 → 서고 차례가 꺼진다
      const [ex, ey] = (await openCell('.sqb-cell[data-zone="ours"][data-team=""]:not([data-depot])'))!.split(',');
      await page.click(`.sqb-cell[data-x="${ex}"][data-y="${ey}"]`);
      st = await state();
      const name0 = `${String.fromCharCode(65 + Number(ex))}${Number(ey) + 1}`;
      if (st.at[0] !== name0 || st.turn !== -1 || st.kind !== 'idle') fail(`${slot}: 첫 장수를 ${name0}에 세웠는데 ${JSON.stringify(st)}`);
      // 둘째 장수 카드 → 첫 장수가 선 칸 = 자리를 바꾼다
      await btn(1);
      await page.click(`.sqb-cell[data-x="${ex}"][data-y="${ey}"]`);
      st = await state();
      if (st.at[1] !== name0 || st.at[0] !== before.at[1] || st.turn !== -1) fail(`${slot}: 자리 바꾸기가 안 됐다 — 전 [${before.at}] 후 [${st.at}]`);
      // 같은 카드를 두 번 누르면 꺼진다
      await btn(2); await btn(2);
      if ((await state()).turn !== -1) fail(`${slot}: 카드를 다시 눌렀는데 차례가 안 꺼졌다`);
      await shot(`${slot}-3c-placed`);
      ok(`${slot}: 카드 한 명씩 [${before.at}] → [${st.at}]`);
    }
    if (want === 5) {
      const colsBefore = await page.$$eval('[data-field="colLabel"]', (e) => e.map((x) => x.textContent).join(''));
      const rightPiece = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.sqb-mini .mpiece.ours')].map((r) => Number(r.getAttribute('x')) + 0.15)));
      await page.click('[data-action="deployPan"][data-dir="right"]');
      await page.waitForTimeout(120);
      if (!await page.$(`.sqb-cell[data-team="ours"][data-x="${rightPiece}"]`)) fail(`${slot}: 오른쪽으로 옮겼는데 x ${rightPiece}의 장수가 안 보인다`);
      const after = await page.$$eval('[data-action="deployPan"]', (e) => e.map((b) => (b as HTMLElement).dataset.dir).join(','));
      if (after.includes('right')) fail(`${slot}: 오른쪽 끝인데 오른쪽 화살표가 있다 [${after}]`);
      const colsAfter = await page.$$eval('[data-field="colLabel"]', (e) => e.map((x) => x.textContent).join(''));
      if (colsAfter === colsBefore || !colsAfter.endsWith('Y')) fail(`${slot}: 옮긴 뒤 열 좌표가 「${colsBefore}」 → 「${colsAfter}」`);
      // 3 — 오른쪽 아래 구석(K13 ~ Y20)만 미니맵이 오른쪽 위(V13 ~ Y16)로. 북군 창(위쪽 끝)은 그대로 아래
      const corner = await miniSpot();
      const rows = await page.$$eval('[data-field="rowLabel"]', (e) => e.map((x) => x.textContent).join(','));
      const isCorner = rows.endsWith('20');
      if (isCorner || look.side === 'P1' ? (corner.at !== 'top' || !corner.top || !corner.right) : (corner.at !== 'bottom' || !corner.bottom)) fail(`${slot}: 창 행 [${rows}] · 미니맵 ${JSON.stringify(corner)}`);
      await shot(`${slot}-1b-right`);
      ok(`${slot}: 오른쪽 끝 창 「${colsAfter}」 행 ${rows.split(',')[0]}~ — 미니맵 ${corner.at}`);
    }
    // 제 진영 반대쪽으로 한 번 → 되돌아올 화살표가 선다
    const away = defense ? 'down' : 'up';
    const back = defense ? 'up' : 'down';
    await page.click(`[data-action="deployPan"][data-dir="${away}"]`);
    await page.waitForTimeout(120);
    const turned = await page.$$eval('[data-action="deployPan"]', (e) => e.map((b) => (b as HTMLElement).dataset.dir));
    if (!turned.includes(back)) fail(`${slot}: ${away}로 옮겼는데 ${back} 화살표가 없다 [${turned.join(',')}]`);
    if ((await miniSpot()).at !== homeAt) fail(`${slot}: 옮긴 뒤 미니맵이 ${homeAt}가 아니다`);
    await shot(`${slot}-1c-${away}`);
    // 미니맵 — 판 반대편(상대 진영)을 누르면 창이 그리로 간다 → 상대가 보인다
    const mb = (await (await page.$('[data-field="minimap"]'))!.boundingBox())!;
    await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height * (defense ? 0.95 : 0.05));
    await page.waitForTimeout(150);
    const enemies = await page.$$eval('.sqb-cell[data-team="enemy"]', (e) => e.length);
    if (enemies === 0) fail(`${slot}: 미니맵으로 상대 진영을 눌렀는데 상대가 안 보인다`);
    const depots = await page.$$eval('.sqb-cell[data-depot]', (e) => e.map((x) => (x as HTMLElement).dataset.depot).join(','));
    if (depots !== 'enemy') fail(`${slot}: 상대 끝 창의 군량고가 [${depots}]다 — 상대 것 하나`);
    if (defense) {
      // 수성전 판 — 북군 끝(성채 쪽)에는 군량고가 없다
      const mb2 = (await (await page.$('[data-field="minimap"]'))!.boundingBox())!;
      await page.mouse.click(mb2.x + mb2.width / 2, mb2.y + 2);
      await page.waitForTimeout(120);
      if (await page.$('.sqb-cell[data-depot]')) fail(`${slot}: 북군 끝에 군량고가 있다`);
    }
    await shot(`${slot}-2-foe`);
    if (!errors.length) ok(`${slot}: 칸 ${look.cell} · 화살표 [${look.arrows}] 둥실 · 미니맵 ${ms.cols}칸 정사각 → 상대 ${enemies}`);

    // 11 — 머리 막대의 [뒤로 가기]도 배치를 저장하고 부대 편집으로 돌아간다(옮긴 것이 있으니 부대 편집이 「바뀜」)
    await page.click('[data-action="back"]');
    await page.waitForSelector('[data-screen="squadEdit"]');
    if (!await page.$('[data-screen="squadEdit"][data-dirty="1"]')) fail(`${slot}: [뒤로 가기]가 배치를 저장하지 않았다`);
    await page.click('[data-action="back"]');
    await page.click('[data-action="leaveYes"]');
    await page.waitForSelector('[data-screen="squads"]');
    await page.click('[data-action="back"]');
    await page.click('[data-action="back"]').catch(() => undefined);
    await page.waitForSelector('.scr-main', { timeout: 10_000 });
  }

  if (errors.length) fail(`콘솔 오류 — ${errors.slice(0, 5).join(' | ')}`);
} catch (e) {
  fail(String(e));
  await shot('zz-error').catch(() => undefined);
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: adminHeaders });
}
console.log(failures.length ? `\n✗ ${failures.length}건` : '\n✓ 끝');
process.exit(failures.length ? 1 : 0);
