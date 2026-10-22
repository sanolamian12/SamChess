/**
 * 안내 내관 눈 확인 — 메인 첫 진입 · 도시 레벨 · 마을 · [사용 안내] 다시 듣기 (2026-10-22, pptx 113~116쪽)
 *
 *   SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/guide_ux.ts
 *
 * 자동화 브라우저에서는 안내가 꺼져 있어(`guideScript.ts`의 `guidesEnabled`) `?guide=1`로 연다.
 * 필요한 것: `npm run dev`(5173) · `npm run server-api`(8787). 시험 계정을 만들고 끝나면 지운다.
 * 보는 것: 내관이 들어오고(오른쪽 아래) · 마디마다 가리키는 자리가 반짝이고 · 마지막에 물러나며 · **본 것이 서버 계정에 남고**
 * (새로고침해도 다시 안 나온다) · 레벨이 오르면 **다른 사람**이 나오고 · [사용 안내]로 다시 들을 수 있는가.
 * 검사는 화면 글자가 아니라 `data-*`로 건다.
 */
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { GUIDE_IDS, GUIDE_SCREEN_OF, GUIDE_SCREENS } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? tmpdir();

const fail = (m: string): never => { throw new Error(m); };
const ok = (m: string): void => console.log(`  ✓ ${m}`);

const email = `guide-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 1400 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
// 폐하 목소리는 아직 녹음이 없다 — 그 404는 「말없이 들어온다」로 정해 둔 것이다
page.on('response', (r) => {
  const path = new URL(r.url()).pathname;
  if (r.status() === 404 && path !== '/profile' && !path.startsWith('/cityvoice/emperor.')) errors.push(`404 ${path}`);
});
/** 내관이 들어올 때 부른 목소리 — 파일 이름(호칭 단 · 더빙)만 모은다 */
const voices: string[] = [];
page.on('request', (r) => { const m = /\/cityvoice\/(.+)\.mp3$/.exec(new URL(r.url()).pathname); if (m) voices.push(m[1]!); });
const lastVoice = async (): Promise<string | undefined> => { await page.waitForTimeout(200); return voices[voices.length - 1]; };
const shot = (name: string): Promise<Buffer> => page.screenshot({ path: `${SHOTS}/guide-${name}.png` });

/** 내관이 들어와 말풍선이 펴질 때까지 */
const waitIn = async (): Promise<void> => {
  await page.waitForSelector('.stw[data-phase="in"]', { timeout: 15_000 });
  await page.waitForTimeout(800);
};
/** 안내 하나를 끝까지 넘기며 마디마다 찍는다 — 돌려주는 것은 마디마다 가리킨 자리 */
async function readThrough(name: string): Promise<(string | null)[]> {
  await waitIn();
  const n = Number(await page.getAttribute('.stw', 'data-guide-lines'));
  const spots: (string | null)[] = [];
  for (let i = 0; i < n; i++) {
    await page.waitForTimeout(350);
    spots.push(await page.evaluate(() => document.getElementById('frame')?.dataset.guideSpot ?? null));
    await shot(`${name}-${i + 1}`);
    await page.click('[data-action="guideNext"]', { force: true }); // 단추가 두근거려(`stw-next-beat`) 「멈출 때까지」 기다리면 끝이 없다
  }
  await page.waitForSelector('.stw', { state: 'detached', timeout: 3_000 });
  if (await page.evaluate(() => document.getElementById('frame')?.dataset.guideSpot)) fail('물러났는데 반짝임이 남았다');
  return spots;
}
const stewardSrc = (): Promise<string | null> => page.getAttribute('.stw-man', 'src');
/** 서버 계정의 본 안내 — 저장은 화면을 막지 않고 뒤에서 나가므로(쓰기 큐) `want`가 보일 때까지 잠깐 기다린다 */
const seenOnServer = async (want?: string): Promise<string[]> => {
  const until = Date.now() + 5_000;
  for (;;) {
    const seen = (await getProfile(uid))?.guide?.seen ?? [];
    if (!want || seen.includes(want) || Date.now() > until) return seen;
    await new Promise((r) => setTimeout(r, 200));
  }
};
const patch = async (fn: (p: PlayerProfile) => PlayerProfile): Promise<void> => {
  await saveProfileTrusted(uid, fn((await getProfile(uid))!));
  await page.reload({ waitUntil: 'networkidle' });
};

try {
  console.log('▶ 계정 · 도시 · 가입 오프닝');
  // 자동화 브라우저에서는 안내가 꺼진다(`guidesEnabled`) — `?guide=1`로 켠다. 새로고침도 이 주소를 지킨다
  await page.goto(`${BASE}/?guide=1`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new', { timeout: 20_000 });
  await page.fill('.scr-new .newgame-form input', `안내성${Math.floor(Math.random() * 9000 + 1000)}`);
  await page.click('.scr-new .newgame-form .btn.primary');
  await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
  await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 10_000 });

  console.log('▶ 메인 첫 진입 — 인사');
  await page.waitForSelector('.stw', { timeout: 5_000 });
  await page.waitForTimeout(250);
  // 들어오는 도중을 한 장 — 오른쪽 바깥에서 미끄러져 들어온다
  await shot('intro-0-entering');
  await waitIn();
  if (!(await stewardSrc())?.endsWith('steward-1.png')) fail(`Lv1인데 내관 그림이 ${await stewardSrc()}`);
  const man = (await page.$('.stw-man'))!; const frame = (await page.$('#frame'))!;
  const [mb, fb] = [(await man.boundingBox())!, (await frame.boundingBox())!];
  if (Math.abs(mb.y + mb.height - (fb.y + fb.height)) > 2 || mb.x + mb.width > fb.x + fb.width) fail('내관이 프레임 오른쪽 아래에 붙어 있지 않다');
  const bub = (await (await page.$('.stw-bubble'))!.boundingBox())!;
  if (bub.y + bub.height > mb.y + 4) fail('말풍선이 내관을 덮는다');
  if (await lastVoice() !== '1.KR') fail(`Lv1 내관이 「주공」(1.KR)이 아니라 ${voices.join(',')}로 불렀다`);
  ok(`내관 Lv1 그림 · 목소리 1.KR(주공) · 오른쪽 아래 (${Math.round(mb.width)}×${Math.round(mb.height)}) · 말풍선은 그 위`);
  const spots = await readThrough('intro');
  if (spots[spots.length - 1] !== 'info') fail(`마지막 마디가 [사용 안내]를 가리키지 않는다 — ${spots.join(',')}`);
  ok(`인사 ${spots.length}마디 — 가리킨 자리 ${spots.map((s) => s ?? '-').join(' · ')}`);
  if (!(await seenOnServer('main.intro')).includes('main.intro')) fail('본 것이 서버 계정에 안 남았다');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main');
  await page.waitForTimeout(2_000);
  if (await page.$('.stw')) fail('새로고침했더니 인사가 다시 나왔다');
  ok('본 것이 서버에 남고, 새로고침해도 다시 안 나온다');

  console.log('▶ 도시 Lv3 — 다른 사람이 나온다');
  await patch((p) => ({ ...p, cityLevel: 3 }));
  await waitIn();
  if (!(await stewardSrc())?.endsWith('steward-2.png')) fail(`Lv3인데 내관 그림이 ${await stewardSrc()}`);
  if (await lastVoice() !== '2.KR') fail(`Lv3 내관이 「장군」(2.KR)이 아니라 ${voices.join(',')}로 불렀다`);
  const lv3 = await readThrough('lv3');
  const seen3 = await seenOnServer('city.lv3');
  if (!seen3.includes('city.lv3') || !seen3.includes('city.lv2')) fail(`Lv3 안내를 봤는데 ${seen3.join(',')}`);
  ok(`Lv3 ${lv3.length}마디 · steward-2 · 목소리 2.KR(장군) · Lv2 안내는 함께 지나갔다`);

  console.log('▶ 황제 등극 — 헌제가 들어오면 · 내관을 밀어 건너뛰기');
  await patch((p) => {
    const any = Object.values(p.roster)[0]!;
    return { ...p, roster: { ...p.roster, 'heon-je': { ...any, officer: 'heon-je', level: 1, growth: [] } } } as PlayerProfile;
  });
  await waitIn();
  if (await page.getAttribute('.stw', 'data-guide') !== 'emperor') fail(`헌제를 들였는데 ${await page.getAttribute('.stw', 'data-guide')}`);
  if (!(await page.textContent('[data-field="guideText"]'))?.includes('폐하')) fail('황제 등극인데 호칭이 폐하가 아니다');
  if (await lastVoice() !== 'emperor.KR') fail(`황제 계정의 내관이 ${voices.join(',')}로 불렀다 — 폐하(emperor.KR)를 찾아야 한다`);
  await shot('emperor-1');
  const drag = async (dist: number): Promise<void> => {
    const b = (await (await page.$('.stw-man'))!.boundingBox())!;
    const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(x + (dist * i) / 8, y); await page.waitForTimeout(30); }
    if (dist > 100) await shot('emperor-dragging');
    await page.mouse.up();
  };
  // 조금만 끌면 제자리로 돌아오고 안내는 그대로다
  await drag(40);
  await page.waitForTimeout(400);
  if (await page.getAttribute('.stw', 'data-phase') !== 'in' || await page.getAttribute('.stw', 'data-guide-line') !== '0') fail('조금 끌었는데 안내가 넘어갔다');
  ok('조금 끌면 제자리로 돌아온다');
  // 멀리 밀면 첫 마디에서 바로 물러나고 「들었다」로 적힌다
  await drag(260);
  await page.waitForSelector('.stw', { state: 'detached', timeout: 3_000 });
  if (!(await seenOnServer('emperor')).includes('emperor')) fail('밀어서 건너뛰었는데 「들었다」로 안 남았다');
  ok('내관을 오른쪽으로 밀면 첫 마디에서 건너뛰고, 들은 것으로 남는다 · 호칭 폐하');

  console.log('▶ 마을 — [마을로] · [궁성으로]');
  await patch((p) => ({ ...p, buildings: { ...p.buildings, academy: 1 } }));
  await waitIn();
  if (await page.evaluate(() => document.getElementById('frame')?.dataset.guideSpot) !== 'gate') fail('[마을로]를 가리키지 않는다');
  await shot('town-open');
  // 말풍선을 닫지 않고 바로 [마을로]를 누른다 — 판을 막지 않는다
  await page.click('.city-gate', { force: true }); // 배경과 함께 흔들려(드리프트) 멈추지 않는다
  await page.waitForSelector('.city-hots[data-view="ext"]');
  await waitIn();
  await shot('town-enter');
  await page.click('[data-action="guideNext"]', { force: true }); // 단추가 두근거려(`stw-next-beat`) 「멈출 때까지」 기다리면 끝이 없다
  await page.waitForSelector('.stw', { state: 'detached', timeout: 3_000 });
  const seenT = await seenOnServer('town.enter');
  if (!seenT.includes('town.open') || !seenT.includes('town.enter')) fail(`마을 안내가 안 남았다 — ${seenT.join(',')}`);
  ok('안내를 띄운 채로 [마을로]가 눌린다 · 산 너머에서 돌아오는 길을 말한다');

  console.log('▶ 1차 묶음 — 병영 · 튜토리얼 목록 · 출정 열림 · 부대 · 출정 · 궁궐 · 장수 일람');
  await page.click('.city-gate', { force: true }); // 배경과 함께 흔들려(드리프트) 멈추지 않는다
  await page.waitForSelector('.city-hots[data-view="core"]');
  /** 그 화면의 안내가 `id`로 서는지 보고 끝까지 넘긴다 — 가리킨 자리가 실제로 빛났는지(`data-guide-glow`)도 센다 */
  const screenGuide = async (name: string, id: string): Promise<void> => {
    await waitIn();
    const got = await page.getAttribute('.stw', 'data-guide');
    if (got !== id) fail(`${name}에서 ${id}가 아니라 ${got}`);
    const n = Number(await page.getAttribute('.stw', 'data-guide-lines'));
    const glows: string[] = [];
    for (let i = 0; i < n; i++) {
      await page.waitForTimeout(500);
      const spot = await page.evaluate(() => document.getElementById('frame')?.dataset.guideSpot ?? null);
      if (spot) {
        const lit = await page.$$eval('[data-guide-glow]', (els) => els.length);
        if (lit === 0) fail(`${name} ${i + 1}마디가 ${spot}를 가리키는데 빛나는 것이 없다`);
        // 「있는가」와 「보이는가」는 다른 검사다 — 빛나는 단추가 말풍선 밑에 깔리면 안 된다(`Steward.tsx`의 `dodge`)
        const covered = await page.evaluate(() => {
          const b = document.querySelector('.stw-bubble')!.getBoundingClientRect();
          const g = document.querySelector('[data-guide-glow]')!.getBoundingClientRect();
          return Math.min(b.bottom, g.bottom) - Math.max(b.top, g.top) > 4 && Math.min(b.right, g.right) - Math.max(b.left, g.left) > 4;
        });
        if (covered) fail(`${name} ${i + 1}마디 — 빛나는 ${spot}를 말풍선이 덮는다`);
        glows.push(`${spot}×${lit}`);
      }
      await shot(`${name}-${i + 1}`);
      await page.click('[data-action="guideNext"]', { force: true });
    }
    await page.waitForSelector('.stw', { state: 'detached', timeout: 3_000 });
    if (await page.$('[data-guide-glow]')) fail(`${name} — 물러났는데 빛이 남았다`);
    if (!(await seenOnServer(id)).includes(id)) fail(`${name} — ${id}가 서버에 안 남았다`);
    ok(`${name} — ${id} ${n}마디 · 빛난 자리 ${glows.join(' · ') || '-'}`);
  };
  const back = async (): Promise<void> => { await page.click('[data-action="back"]'); await page.waitForSelector('.scr-main'); };
  const toPlace = async (place: 'barracks' | 'palace'): Promise<void> => {
    await page.click(`.city-hot[data-place="${place}"]`, { force: true });
    await page.waitForSelector(`[data-action="${place === 'barracks' ? 'squads' : 'officers'}"]`);
  };

  await toPlace('barracks');
  await screenGuide('barracks', 'barracks.intro');
  await page.click('[data-action="tutorial"]');
  await page.waitForSelector('[data-tutorial="basic-1"]');
  await screenGuide('tutorials', 'tutorial.list');
  await page.click('[data-action="back"]');
  await page.click('[data-action="squads"]');
  await screenGuide('squads', 'squads.intro');
  await page.click('[data-action="back"]');
  await page.waitForSelector('[data-action="squads"]');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main');

  // 기본 셋을 끝냈다 — 서버 소유라 서버 쪽에서 적는다. 병영이 「출정 길이 열렸다」로 갈린다
  await patch((p) => ({ ...p, tutorial: { done: ['basic-1', 'basic-2', 'basic-3'] } }));
  await toPlace('barracks');
  await screenGuide('barracks-open', 'barracks.sortieOpen');
  await page.click('[data-action="sortie"]');
  await screenGuide('sortie', 'sortie.intro');
  await page.click('[data-action="back"]');
  await page.waitForSelector('[data-action="squads"]');
  await back();

  await toPlace('palace');
  await screenGuide('palace', 'palace.intro');
  await page.click('[data-action="officers"]');
  await page.waitForTimeout(1_500);
  if (await page.$('.stw')) fail('레벨업할 장수가 없는데 장수 일람 안내가 섰다');
  // 카드를 채워 레벨업을 켠다 — 서버 소유(`cards`)라 서버 쪽에서
  await patch((p) => {
    const id = Object.keys(p.roster).find((o) => o !== 'heon-je')!;
    return { ...p, cards: { ...p.cards, [id]: 99 } };
  });
  await toPlace('palace');
  await page.click('[data-action="officers"]');
  await screenGuide('officers', 'officer.levelup');
  await page.click('[data-action="back"]');
  await page.waitForSelector('[data-action="officers"]');
  await back();

  console.log('▶ [사용 안내] — 지난 설명 다시 듣기 · 화면별 묶음');
  await page.click('[data-action="info"]');
  await page.waitForSelector('[data-modal="guideReplay"]');
  const listed = await page.$$eval('[data-modal="guideReplay"] [data-guide]', (els) => els.map((e) => (e as HTMLElement).dataset.guide));
  await shot('replay-list');
  const seenAll = await seenOnServer();
  const order = GUIDE_SCREENS.flatMap((sc) => GUIDE_IDS.filter((id) => GUIDE_SCREEN_OF[id] === sc && seenAll.includes(id)));
  if (listed.join(',') !== order.join(',')) fail(`목록 ${listed.join(',')} ≠ 화면별 대본 차례 ${order.join(',')}`);
  const groups = await page.$$eval('[data-modal="guideReplay"] [data-guide-group]', (els) => els.map((e) => (e as HTMLElement).dataset.guideGroup));
  if (groups.length < 6) fail(`화면별 묶음이 ${groups.length}개뿐 — ${groups.join(',')}`);
  await page.click('[data-modal="guideReplay"] [data-guide="main.intro"]');
  // 들어오는 연출 — 프레임 사진(90ms 간격)과 내관의 가로 자리 · 투명도. 오른쪽 바깥에서 왼쪽으로, 흐렸다 진해져야 한다
  const xs: { x: number; o: number }[] = [];
  for (let i = 0; i < 9; i++) {
    xs.push(await page.evaluate(() => {
      const m = document.querySelector<HTMLElement>('.stw-man');
      return m && getComputedStyle(m).visibility !== 'hidden' ? { x: Math.round(m.getBoundingClientRect().x), o: Number(getComputedStyle(m).opacity) } : { x: -1, o: 0 };
    }));
    await page.screenshot({ path: `${SHOTS}/guide-enter-${i}.png`, clip: { x: 300, y: 700, width: 400, height: 700 } });
    await page.waitForTimeout(90);
  }
  const moving = xs.filter((s) => s.x > 0);
  if (!(moving.length > 2 && moving[0]!.x > moving[moving.length - 1]!.x && moving[0]!.o < 1)) fail(`들어오는 연출이 안 보인다 — ${JSON.stringify(xs)}`);
  ok(`들어온다 — x ${moving.map((s) => s.x).join('→')}`);
  await waitIn();
  if (Number(await page.getAttribute('.stw', 'data-guide-lines')) !== spots.length) fail('다시 듣기가 인사 전체가 아니다');
  await shot('replay-intro');
  ok(`목록 ${listed.length}개 · 묶음 ${groups.join(' · ')} — 인사를 다시 듣는다`);
  // 물러나는 연출 — 마지막 마디까지 넘기고 오른쪽으로 사라지는가
  for (let i = 0; i < spots.length; i++) { await page.click('[data-action="guideNext"]', { force: true }); await page.waitForTimeout(120); }
  const outs: number[] = [];
  for (let i = 0; i < 4; i++) {
    outs.push(await page.evaluate(() => Math.round(document.querySelector('.stw-man')?.getBoundingClientRect().x ?? -1)));
    await page.waitForTimeout(90);
  }
  const outMoving = outs.filter((x) => x > 0);
  if (outMoving.length > 1 && outMoving[0]! >= outMoving[outMoving.length - 1]!) fail(`물러나는 연출이 오른쪽이 아니다 — ${outs.join(',')}`);
  await page.waitForSelector('.stw', { state: 'detached', timeout: 3_000 });
  ok(`물러난다 — x ${outs.join('→')}`);

  if (errors.length) fail(`콘솔 · 404 — ${errors.join(' | ')}`);
  console.log(`\n✓ 안내 내관 UX 끝 — 그림 ${SHOTS}/guide-*.png`);
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  await shot('fail').catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
  await pool.query('delete from profiles where uid = $1', [uid]).catch(() => undefined);
  await pool.end();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
