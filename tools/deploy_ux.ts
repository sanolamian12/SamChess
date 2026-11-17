/**
 * 부대 배치 편집 UX 확인 — 머리 판(장수 + 좌표 · 안내 한 줄) · 본 판(단추 셋 왼쪽 · 미니맵 오른쪽 · 15 × 8 창 · 좌표 · 화살표 넷) ·
 * 조작 판([배치 완료] 위), [장수 배치] 한 바퀴(구역 밖 경고 · 자리 바꾸기 · 좌표 갱신),
 * 공격대(남군 · 북군) · 수비대(북군 고정 · 깃발 없음 · 수성전 판) (2026-11-17)
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
        main: Math.round(box('.sqb-panel').height), ctl: Math.round(box('.sqb-acts').height), tool: Math.round(box('.sqb-toolbar').height) };
    });
    console.log(`  높이 ${JSON.stringify(fit)}`);
    if (fit.acts > fit.frame + 0.5) fail(`${slot}: 조작 판이 화면 밖으로 ${fit.acts - fit.frame}px 넘친다`);

    const look = await page.evaluate(() => {
      const bar = document.querySelector('[data-screen="squadDeploy"]') as HTMLElement;
      const cell = document.querySelector('.sqb-board .sqb-cell') as HTMLElement | null;
      const r = cell?.getBoundingClientRect();
      const top = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
      return {
        side: bar.dataset.side, view: (document.querySelector('.sqb-view') as HTMLElement | null)?.dataset.view ?? '',
        tabs: document.querySelectorAll('[data-action="deploySide"]').length,
        flag: !!document.querySelector('[data-field="sideFixed"]'),
        cells: document.querySelectorAll('.sqb-board .sqb-cell').length,
        castle: document.querySelectorAll('.sqb-board .sqb-cell[data-fort]').length,
        cell: r ? `${Math.round(r.width)}×${Math.round(r.height)}` : '-',
        mini: !!document.querySelector('[data-field="minimap"]'),
        miniTitle: document.querySelector('.sqb-mini-ttl')?.textContent ?? '',
        miniHint: document.querySelector('.sqb-mini-hint')?.textContent ?? '',
        fullBtn: !!document.querySelector('[data-action="deployView"]'),
        head: [...document.querySelectorAll('[data-field="deployHead"] [data-field="deployWho"]')].map((e) => e.querySelector('[data-field="at"]')?.textContent ?? '').join(','),
        headOld: !!document.querySelector('[data-field="deployHead"] .sql-row, [data-field="deployHead"] .sql-mark, [data-field="deployHead"] .sql-mode'),
        badge: !!document.querySelector('.sqb-pan-n'),
        cols: [...document.querySelectorAll('[data-field="colLabel"]')].map((e) => e.textContent).join(''),
        rows: [...document.querySelectorAll('[data-field="rowLabel"]')].map((e) => e.textContent).join(','),
        stands: document.querySelectorAll('.sqb-cell[data-team="ours"] .sqb-stand').length,
        mine: document.querySelectorAll('.sqb-cell[data-team="ours"]').length,
        // 세로 화면은 단추 오른쪽, 가로 화면은 판 왼쪽 기둥이라 단추 아래
        miniRight: (() => {
          const m = document.querySelector('.sqb-mini')!.getBoundingClientRect();
          const c = [...document.querySelectorAll('.sqb-chip')].map((e) => e.getBoundingClientRect());
          return m.left > Math.max(...c.map((r) => r.right)) || (document.documentElement.dataset.orient === 'landscape' && m.top > Math.max(...c.map((r) => r.bottom)));
        })(),
        buttons: [...document.querySelectorAll('.sqb-tools > .sqb-chip')].map((e) => (e as HTMLElement).dataset.action).join(','),
        stacked: (() => { const r = [...document.querySelectorAll('.sqb-tools > .sqb-chip')].map((e) => e.getBoundingClientRect()); return r.every((b, i) => i === 0 || (b.top >= r[i - 1]!.bottom - 0.5 && Math.abs(b.left - r[0]!.left) < 1)); })(),
        arrows: [...document.querySelectorAll('[data-action="deployPan"]')].map((b) => (b as HTMLElement).dataset.dir).join(','),
        saveAbove: top('[data-action="deploySave"]') < top('[data-action="deployBackBottom"]'),
        helpIcon: !!document.querySelector('[data-action="deployHelp"] img'),
      };
    });
    console.log(`  ${JSON.stringify(look)}`);
    const defense = slot.startsWith('def-');
    // 1 · A — 수비대는 북군 고정에 깃발도 없다 · 성채 아홉 칸. 공격대는 진영 탭 둘
    if (defense) {
      if (look.side !== 'P2' || look.tabs !== 0 || look.flag) fail(`${slot}: 북군 고정 · 깃발 없음이 아니다 — ${look.side} · 탭 ${look.tabs} · 깃발 ${look.flag}`);
      if (look.castle !== 9) fail(`${slot}: 성채 칸이 ${look.castle}개다`);
    } else {
      if (look.side !== 'P1' || look.tabs !== 2) fail(`${slot}: 공격대 진영 탭이 아니다 — ${look.side} · ${look.tabs}`);
      if (look.castle !== 0) fail(`${slot}: 공격대 판에 성채가 있다`);
    }
    // 2 — 미니맵 제목 · 안내
    if (KO && (!look.mini || look.miniTitle !== '미니 맵' || look.miniHint !== '보시고 싶은 부분을 눌러주세요.')) fail(`${slot}: 미니맵 제목 · 안내가 「${look.miniTitle}」 · 「${look.miniHint}」다`);
    // 4 · 5 — 창은 15 × 8, [판 전체] 단추 없음
    if (look.view !== 'near' || look.cells !== 120) fail(`${slot}: 창이 ${look.cells}칸이다(15 × 8 = 120)`);
    if (look.fullBtn) fail(`${slot}: [판 전체] 단추가 남아 있다`);
    // 3 — 처음 화살표는 좌 · 우 + 제 진영 반대쪽 하나(수비대 아래, 공격대 위)
    const first = defense ? 'down,left,right' : 'up,left,right';
    if (look.arrows !== first) fail(`${slot}: 처음 화살표가 [${look.arrows}]다(${first})`);
    // 화살표는 판 바깥 — 판 위에 얹으면 가장자리 칸을 덮어 못 누른다(squad_ux가 잡았다). 미니맵 · 도구 칩과도 안 겹친다
    const overlap = await page.evaluate(() => {
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      const view = document.querySelector('.sqb-view')!.getBoundingClientRect();
      const others = [...document.querySelectorAll('.sqb-mini, .sqb-chip, .sqb-sides')].map((e) => [e.className, e.getBoundingClientRect()] as const);
      return [...document.querySelectorAll('[data-action="deployPan"]')].flatMap((b) => {
        const r = b.getBoundingClientRect();
        const what = [...(hit(r, view) ? [`판 ${Math.round(r.bottom - view.top)}px`] : []), ...others.filter(([, o]) => hit(r, o)).map(([n]) => n)];
        return what.length ? [`${(b as HTMLElement).dataset.dir}: ${what.join(' · ')}`] : [];
      });
    });
    if (overlap.length) fail(`${slot}: 화살표 [${overlap.join(',')}]가 판 · 미니맵 · 칩을 덮는다`);
    // [게임 안내]에 그림 · 조작 판 두 줄([배치 완료]가 위)
    if (!look.helpIcon) fail(`${slot}: [게임 안내]에 그림이 없다`);
    const want = slot.endsWith('3v3') ? 3 : 5;
    // 2(머리 판) — 장수 + 좌표 쌍이 부대원 수만큼, 옛 줄(모드 · 준비 표지)은 없다
    if (look.head.split(',').length !== want || !look.head.split(',').every((a) => /^[A-Y]\d{1,2}$/.test(a))) fail(`${slot}: 머리 판 좌표가 [${look.head}]다`);
    if (look.headOld) fail(`${slot}: 머리 판에 옛 부대 줄(모드 · 준비 표지)이 남았다`);
    // 3 — 화살표 숫자 없음 · 4 — 판 위 장수는 꼬마 · 5 — 좌표(위 줄 열 15 · 왼 줄 행 8)
    if (look.badge) fail(`${slot}: 화살표에 숫자가 남았다`);
    if (look.stands !== look.mine) fail(`${slot}: 판 위 장수 ${look.mine}명 중 꼬마 ${look.stands}명`);
    if (look.cols.length !== 15 || look.rows.split(',').length !== 8) fail(`${slot}: 좌표가 열 「${look.cols}」 · 행 [${look.rows}]다`);
    // 6 · 8 — 단추 셋이 왼쪽에 쌓이고 미니맵은 오른쪽
    if (look.buttons !== 'deployPlace,deployReset,deployHelp' || !look.stacked) fail(`${slot}: 단추가 [${look.buttons}] · 쌓임 ${look.stacked}`);
    if (!look.miniRight) fail(`${slot}: 미니맵이 단추 오른쪽(가로 화면은 아래)이 아니다`);
    if (!look.saveAbove) fail(`${slot}: [배치 완료]가 [뒤로 가기] 위가 아니다`);

    // 우리 편 — 창 안 + 화살표의 수 = 부대원
    const mine = await page.$$eval('.sqb-cell[data-team="ours"]', (e) => e.length);
    const offs = await page.$$eval('[data-action="deployPan"]', (e) => e.map((b) => Number((b as HTMLElement).dataset.off)));
    if (mine + offs.reduce((a, b) => a + b, 0) !== want) fail(`${slot}: 창 안 ${mine} + 화살표 [${offs.join(',')}] ≠ ${want}`);
    // 7 — [장수 배치] 한 바퀴: 차례 표지 · 「…를 배치해주세요」 · 구역 밖 경고(차례 그대로) · 다른 장수 칸 = 자리 바꾸기 · 좌표 갱신 · 끝
    {
      const state = () => page.evaluate(() => ({
        turn: [...document.querySelectorAll('[data-field="deployWho"]')].findIndex((e) => (e as HTMLElement).dataset.turn === '1'),
        kind: (document.querySelector('[data-field="deployMsg"]') as HTMLElement).dataset.kind,
        msg: document.querySelector('[data-field="deployMsg"]')!.textContent ?? '',
        at: [...document.querySelectorAll('[data-field="deployWho"] [data-field="at"]')].map((e) => e.textContent ?? ''),
        dagger: !!document.querySelector('[data-field="deployWho"][data-turn] .sqb-who-turn'),
      }));
      const before = await state();
      await page.click('[data-action="deployPlace"]');
      let st = await state();
      if (st.turn !== 0 || st.kind !== 'ask' || (KO && !st.msg.includes('배치해주세요')) || !st.dagger) fail(`${slot}: [장수 배치] 첫 차례가 ${JSON.stringify(st)}`);
      await page.waitForTimeout(300);   // 단검 그림이 처음 뜨는 순간
      await shot(`${slot}-3a-place`);
      // 구역 밖 — 창 안의 상대 구역 · 중립 칸
      await page.click('.sqb-cell:not([data-zone="ours"])[data-team=""]');
      st = await state();
      if (st.kind !== 'warn' || (KO && !st.msg.includes('파란 영역')) || st.turn !== 0) fail(`${slot}: 구역 밖을 눌렀는데 ${JSON.stringify(st)}`);
      await shot(`${slot}-3b-out`);
      // 첫 장수 → 빈 우리 칸 하나
      const empty = await page.$$eval('.sqb-cell[data-zone="ours"][data-team=""]:not([data-depot])', (e) => e.slice(0, 1).map((c) => `${(c as HTMLElement).dataset.x},${(c as HTMLElement).dataset.y}`));
      const [ex, ey] = empty[0]!.split(',');
      await page.click(`.sqb-cell[data-x="${ex}"][data-y="${ey}"]`);
      st = await state();
      const name0 = `${String.fromCharCode(65 + Number(ex))}${Number(ey) + 1}`;
      if (st.at[0] !== name0 || st.turn !== 1) fail(`${slot}: 첫 장수를 ${name0}에 세웠는데 ${JSON.stringify(st)}`);
      // 둘째 장수 → 첫 장수가 선 칸 = 자리를 바꾼다
      await page.click(`.sqb-cell[data-x="${ex}"][data-y="${ey}"]`);
      st = await state();
      if (st.at[1] !== name0 || st.at[0] !== before.at[1]) fail(`${slot}: 자리 바꾸기가 안 됐다 — 전 [${before.at}] 후 [${st.at}]`);
      // 나머지는 제자리(제 칸)를 다시 눌러 끝까지
      for (let k = 2; k < want; k++) {
        const cur = await page.$$eval('[data-field="deployWho"] [data-field="at"]', (e, i) => e[i]!.textContent ?? '', k);
        const x = cur.charCodeAt(0) - 65, y = Number(cur.slice(1)) - 1;
        const vis = await page.$(`.sqb-cell[data-x="${x}"][data-y="${y}"]`);
        if (vis) await vis.click(); else await page.click('.sqb-cell[data-zone="ours"][data-team=""]:not([data-depot])');
      }
      st = await state();
      if (st.kind !== 'done' || st.turn !== -1) fail(`${slot}: 한 바퀴 뒤 ${JSON.stringify(st)}`);
      await shot(`${slot}-3c-placed`);
      ok(`${slot}: 장수 배치 한 바퀴 [${before.at}] → [${st.at}]`);
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
      await shot(`${slot}-1b-right`);
    }
    // 제 진영 반대쪽으로 한 번 → 되돌아올 화살표가 선다
    const away = defense ? 'down' : 'up';
    const back = defense ? 'up' : 'down';
    await page.click(`[data-action="deployPan"][data-dir="${away}"]`);
    await page.waitForTimeout(120);
    const turned = await page.$$eval('[data-action="deployPan"]', (e) => e.map((b) => (b as HTMLElement).dataset.dir));
    if (!turned.includes(back)) fail(`${slot}: ${away}로 옮겼는데 ${back} 화살표가 없다 [${turned.join(',')}]`);
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
      await page.mouse.click(mb.x + mb.width / 2, mb.y + 2);
      await page.waitForTimeout(120);
      if (await page.$('.sqb-cell[data-depot]')) fail(`${slot}: 북군 끝에 군량고가 있다`);
    }
    await shot(`${slot}-2-foe`);
    // 도움말 팝업에 안내 여섯 줄, 수비대는 성채 줄
    await page.click('[data-action="deployHelp"]');
    await page.waitForSelector('[data-modal="deployHelp"]');
    const lines = await page.$$eval('[data-modal="deployHelp"] li', (e) => e.map((x) => x.textContent ?? ''));
    if (lines.length !== 6 || (KO && (!lines[0]!.includes('장수 배치') || !lines[5]!.includes(defense ? '성채' : '군량고')))) fail(`${slot}: 도움말이 [${lines.join(' / ')}]다`);
    await shot(`${slot}-4-help`);
    await page.click('[data-action="deployHelpOk"]');
    if (!errors.length) ok(`${slot}: 칸 ${look.cell} · 화살표 [${look.arrows}] · 미니맵 → 상대 ${enemies} · 도움말 ${lines.length}줄`);

    await page.click('[data-action="deployBackBottom"]');
    await page.waitForSelector('[data-screen="squadEdit"]');
    await page.click('[data-action="back"]');
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
