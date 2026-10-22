/**
 * 안내 내관 눈 확인 — 새 동선 전체(2026-10-23): 인사 → 둘러보기(궁궐 · 장터 · 대자보) → 병영 → 증축 → Lv2 궁궐 → 마을 · 건물 → 진급 · 황제 → 다시 보기
 *
 *   SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/guide_ux.ts
 *
 * 자동화 브라우저에서는 안내가 꺼져 있어(`guideScript.ts`의 `guidesEnabled`) `?guide=1`로 연다.
 * 필요한 것: `npm run dev`(5173) · `npm run server-api`(8787 — **안내 id를 더했으면 다시 띄운 것**). 시험 계정을 만들고 끝나면 지운다.
 * 보는 것: 내관이 들어오고(오른쪽 아래, 목소리) · 마디마다 가리킨 자리가 **빛나고 말풍선에 안 덮이며** · 물러나고 · **본 것이 서버에 남는가**,
 * 둘러보기의 가리킴 아이콘이 다음 곳 위에 서는가, 레벨이 오르면 다른 사람이 나오는가, 밀어서 건너뛰기, [사용 안내]의 화면별 묶음.
 * 계정 상태(튜토리얼 완료 · 장수 · 자재 · 레벨 · 건물 · 카드)는 서버 쪽에서 심는다. 검사는 화면 글자가 아니라 `data-*`로 건다.
 * **⑩ 첫 결과는 판을 끝까지 두지 않아 여기서 못 본다**(회귀만).
 */
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { COLLECTIONS, OFFICERS } from '@samchess/data';
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
// 폐하 목소리 · 가리킴 아이콘 그림은 아직 없다 — 그 404는 「말없이 들어온다」 · 「금빛 고리로 대신한다」로 정해 둔 것이다
page.on('response', (r) => {
  const path = new URL(r.url()).pathname;
  if (r.status() === 404 && path !== '/profile' && !path.startsWith('/cityvoice/emperor.') && path !== '/ui/guide-target.png') errors.push(`404 ${path}`);
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
  await page.waitForSelector('.scr-main');
};

/**
 * 안내가 `id`로 서는지 보고 끝까지 넘긴다 — 마디마다 가리킨 자리가 실제로 빛나고(`data-guide-glow`) 말풍선에 안 덮이는지,
 * 물러난 뒤 빛이 남지 않는지, 서버에 「들었다」가 남는지 본다. 돌려주는 것은 마디마다 가리킨 자리.
 */
async function guide(name: string, id: string): Promise<(string | null)[]> {
  await waitIn();
  const got = await page.getAttribute('.stw', 'data-guide');
  if (got !== id) fail(`${name}에서 ${id}가 아니라 ${got}`);
  const n = Number(await page.getAttribute('.stw', 'data-guide-lines'));
  const spots: (string | null)[] = [];
  for (let i = 0; i < n; i++) {
    await page.waitForTimeout(500);
    const spot = await page.evaluate(() => document.getElementById('frame')?.dataset.guideSpot ?? null);
    spots.push(spot);
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
    }
    await shot(`${name}-${i + 1}`);
    await page.click('[data-action="guideNext"]', { force: true }); // 단추가 두근거려(`stw-next-beat`) 「멈출 때까지」 기다리면 끝이 없다
  }
  await page.waitForSelector('.stw', { state: 'detached', timeout: 3_000 });
  if (await page.$('[data-guide-glow]')) fail(`${name} — 물러났는데 빛이 남았다`);
  if (!(await seenOnServer(id)).includes(id)) fail(`${name} — ${id}가 서버에 안 남았다`);
  ok(`${name} — ${id} ${n}마디 · 가리킨 자리 ${spots.map((s) => s ?? '-').join(' · ')}`);
  return spots;
}

/** 메인의 가리킴 아이콘이 서 있는 곳 — 없으면 `null` */
const tourTarget = (): Promise<string | null> => page.evaluate(() =>
  document.querySelector<SVGElement>('[data-guide-target]')?.dataset.guideTarget ?? null);
const toMain = async (): Promise<void> => {
  while (!(await page.$('.scr-main'))) { await page.click('[data-action="back"]'); await page.waitForTimeout(300); }
};
const hot = async (place: string, wait: string): Promise<void> => {
  await page.click(`.city-hot[data-place="${place}"]`, { force: true }); // 배경과 함께 흔들려(드리프트) 멈추지 않는다
  await page.waitForSelector(wait);
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

  console.log('▶ [가] 둘러보기 — 인사 → 궁궐 → 장터 → 대자보 → 병영');
  await waitIn();
  if (!(await stewardSrc())?.endsWith('steward-1.png')) fail(`Lv1인데 내관 그림이 ${await stewardSrc()}`);
  if (await lastVoice() !== '1.KR') fail(`Lv1 내관이 「주공」(1.KR)이 아니라 ${voices.join(',')}로 불렀다`);
  const [mb, fb] = [(await (await page.$('.stw-man'))!.boundingBox())!, (await (await page.$('#frame'))!.boundingBox())!];
  if (Math.abs(mb.y + mb.height - (fb.y + fb.height)) > 2 || mb.x + mb.width > fb.x + fb.width) fail('내관이 프레임 오른쪽 아래에 붙어 있지 않다');
  ok(`내관 Lv1 그림 · 목소리 1.KR(주공) · 오른쪽 아래 (${Math.round(mb.width)}×${Math.round(mb.height)})`);
  const intro = await guide('intro', 'main.intro');
  if (intro[intro.length - 1] !== 'palace') fail(`인사의 끝이 궁궐을 가리키지 않는다 — ${intro.join(',')}`);
  if (await tourTarget() !== 'palace') fail(`인사 뒤 가리킴 아이콘이 궁궐이 아니라 ${await tourTarget()}`);
  await shot('tour-palace');
  ok('가리킴 아이콘 — 궁궐');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main');
  await page.waitForTimeout(2_000);
  if (await page.$('.stw')) fail('새로고침했더니 인사가 다시 나왔다');
  ok('본 것이 서버에 남고, 새로고침해도 다시 안 나온다');

  await hot('palace', '[data-action="officers"]');
  await guide('palace', 'palace.intro');
  await toMain();
  await guide('tour-market', 'tour.market');
  if (await tourTarget() !== 'market') fail(`가리킴 아이콘이 장터가 아니라 ${await tourTarget()}`);
  await page.click('.city-hot[data-place="market"]', { force: true });
  await page.waitForSelector('[data-action="openShop"]');
  await guide('market', 'market.intro');
  await toMain();
  await guide('tour-board', 'tour.board');
  if (await tourTarget() !== 'board') fail(`가리킴 아이콘이 대자보가 아니라 ${await tourTarget()}`);
  await hot('ranking', '[data-action="collection"]');
  await guide('board', 'board.intro');
  await toMain();
  await guide('tour-barracks', 'tour.barracks');
  if (await tourTarget() !== 'barracks') fail(`가리킴 아이콘이 병영이 아니라 ${await tourTarget()}`);
  await shot('tour-barracks');

  console.log('▶ [나] 병영 — 병영 · 튜토리얼 목록 · 부대 · 출정 열림 · 출정');
  await hot('barracks', '[data-action="squads"]');
  await guide('barracks', 'barracks.intro');
  await page.click('[data-action="tutorial"]');
  await page.waitForSelector('[data-tutorial="basic-1"]');
  await guide('tutorials', 'tutorial.list');
  await page.click('[data-action="back"]');
  await page.click('[data-action="squads"]');
  await guide('squads', 'squads.intro');
  await toMain();
  if (await tourTarget() !== null) fail(`둘러보기를 다 돌았는데 가리킴 아이콘이 ${await tourTarget()}에 남았다`);
  ok('둘러보기를 다 돌면 가리킴 아이콘이 사라진다');
  // 기본 셋을 끝냈다 — 서버 소유라 서버 쪽에서 적는다
  await patch((p) => ({ ...p, tutorial: { done: ['basic-1', 'basic-2', 'basic-3'] } }));
  await hot('barracks', '[data-action="squads"]');
  await guide('barracks-open', 'barracks.sortieOpen');
  await page.click('[data-action="sortie"]');
  await guide('sortie', 'sortie.intro');
  await toMain();

  console.log('▶ [다] 도시 키우기 — 증축할 채비 → Lv2 → 궁궐 → 장수 레벨업');
  // 증축 조건을 채운다 — 장수 20명 더 · 자재
  await patch((p) => {
    const any = Object.values(p.roster)[0]!;
    const extra = OFFICERS.filter((o) => o.grade !== 'E' && !p.roster[o.id as keyof typeof p.roster]).slice(0, 20);
    return { ...p, materials: 99, roster: { ...p.roster, ...Object.fromEntries(extra.map((o) => [o.id, { ...any, officer: o.id, level: 1, growth: [] }])) } } as PlayerProfile;
  });
  await guide('city-ready', 'city.ready');
  await patch((p) => ({ ...p, cityLevel: 2, materials: 0 }));
  await guide('lv2', 'city.lv2');
  await hot('palace', '[data-action="officers"]');
  await guide('palace-grow', 'palace.grow');
  await patch((p) => {
    const id = Object.keys(p.roster)[0]!;
    return { ...p, cards: { ...p.cards, [id]: 99 } };
  });
  await hot('palace', '[data-action="officers"]');
  await page.click('[data-action="officers"]');
  await guide('officers', 'officer.levelup');
  await toMain();

  console.log('▶ 마을 — [마을로] · 지은 건물 · 처음 들어갈 때');
  await patch((p) => ({ ...p, buildings: { ...p.buildings, academy: 1 } }));
  await waitIn();
  if (await page.getAttribute('.stw', 'data-guide') !== 'town.open') fail(`건물을 지었는데 ${await page.getAttribute('.stw', 'data-guide')}`);
  await shot('town-open');
  // 말풍선을 닫지 않고 바로 [마을로]를 누른다 — 판을 막지 않는다
  await page.click('.city-gate', { force: true });
  await page.waitForSelector('.city-hots[data-view="ext"]');
  const enter = await guide('town-enter', 'town.enter');
  if (enter[0] !== 'built') fail(`산 너머 첫 마디가 지은 건물을 가리키지 않는다 — ${enter.join(',')}`);
  await page.click('.city-hot[data-place="farm"]', { force: true });
  await page.waitForTimeout(2_000);
  if (await page.$('.stw')) fail('안 지은 농지에 들어갔는데 안내가 섰다');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.city-hots[data-view="ext"]');
  await page.click('.city-hot[data-place="academy"]', { force: true });
  await guide('academy', 'building.academy');
  ok('안 지은 건물에서는 안 나오고, 지은 건물에 처음 들어가면 나온다');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.city-hots[data-view="ext"]');
  await page.click('.city-gate', { force: true });
  await page.waitForSelector('.city-hots[data-view="core"]');

  console.log('▶ 대자보 — 컬렉션을 채울 수 있게 됐을 때');
  const cardSlot = COLLECTIONS.flatMap((c) => c.slots).find((s) => s.kind === 'card')!;
  await patch((p) => ({ ...p, cards: { ...p.cards, [cardSlot.id]: 3 } }));
  await hot('ranking', '[data-action="collection"]');
  await guide('board-collection', 'board.collection');
  await toMain();

  console.log('▶ 진급 · 황제 등극 · 밀어서 건너뛰기');
  await patch((p) => ({ ...p, cityLevel: 3 }));
  await waitIn();
  if (!(await stewardSrc())?.endsWith('steward-2.png')) fail(`Lv3인데 내관 그림이 ${await stewardSrc()}`);
  if (await lastVoice() !== '2.KR') fail(`Lv3 내관이 「장군」(2.KR)이 아니라 ${voices.join(',')}로 불렀다`);
  await guide('lv3', 'city.lv3');
  await patch((p) => {
    const any = Object.values(p.roster)[0]!;
    return { ...p, roster: { ...p.roster, 'heon-je': { ...any, officer: 'heon-je', level: 1, growth: [] } } } as PlayerProfile;
  });
  await waitIn();
  if (await page.getAttribute('.stw', 'data-guide') !== 'emperor') fail(`헌제를 들였는데 ${await page.getAttribute('.stw', 'data-guide')}`);
  if (!(await page.textContent('[data-field="guideText"]'))?.includes('폐하')) fail('황제 등극인데 호칭이 폐하가 아니다');
  if (await lastVoice() !== 'emperor.KR') fail(`황제 계정의 내관이 ${voices.join(',')}로 불렀다 — 폐하(emperor.KR)를 찾아야 한다`);
  const drag = async (dist: number): Promise<void> => {
    const b = (await (await page.$('.stw-man'))!.boundingBox())!;
    const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(x + (dist * i) / 8, y); await page.waitForTimeout(30); }
    if (dist > 100) await shot('emperor-dragging');
    await page.mouse.up();
  };
  await drag(40);
  await page.waitForTimeout(400);
  if (await page.getAttribute('.stw', 'data-phase') !== 'in' || await page.getAttribute('.stw', 'data-guide-line') !== '0') fail('조금 끌었는데 안내가 넘어갔다');
  await drag(260);
  await page.waitForSelector('.stw', { state: 'detached', timeout: 3_000 });
  if (!(await seenOnServer('emperor')).includes('emperor')) fail('밀어서 건너뛰었는데 「들었다」로 안 남았다');
  ok('Lv3 steward-2 · 2.KR · 황제 폐하 · 조금 끌면 제자리 · 멀리 밀면 건너뛰고 들은 것으로 남는다');

  console.log('▶ [사용 안내] — 화면별 묶음 · 다시 듣기 · 등장 · 퇴장 연출');
  await page.click('[data-action="info"]');
  await page.waitForSelector('[data-modal="guideReplay"]');
  const listed = await page.$$eval('[data-modal="guideReplay"] [data-guide]', (els) => els.map((e) => (e as HTMLElement).dataset.guide));
  await shot('replay-list');
  const seenAll = await seenOnServer();
  const order = GUIDE_SCREENS.flatMap((sc) => GUIDE_IDS.filter((id) => GUIDE_SCREEN_OF[id] === sc && seenAll.includes(id)));
  if (listed.join(',') !== order.join(',')) fail(`목록 ${listed.join(',')} ≠ 화면별 대본 차례 ${order.join(',')}`);
  const groups = await page.$$eval('[data-modal="guideReplay"] [data-guide-group]', (els) => els.map((e) => (e as HTMLElement).dataset.guideGroup));
  await page.click('[data-modal="guideReplay"] [data-guide="main.intro"]');
  // 들어오는 연출 — 내관의 가로 자리 · 투명도. 오른쪽 바깥에서 왼쪽으로, 흐렸다 진해져야 한다(기다리는 동안은 숨어 있다)
  const xs: { x: number; o: number }[] = [];
  for (let i = 0; i < 9; i++) {
    xs.push(await page.evaluate(() => {
      const m = document.querySelector<HTMLElement>('.stw-man');
      return m && getComputedStyle(m).visibility !== 'hidden' ? { x: Math.round(m.getBoundingClientRect().x), o: Number(getComputedStyle(m).opacity) } : { x: -1, o: 0 };
    }));
    await page.waitForTimeout(90);
  }
  const moving = xs.filter((s) => s.x > 0);
  if (!(moving.length > 2 && moving[0]!.x > moving[moving.length - 1]!.x && moving[0]!.o < 1)) fail(`들어오는 연출이 안 보인다 — ${JSON.stringify(xs)}`);
  await waitIn();
  if (Number(await page.getAttribute('.stw', 'data-guide-lines')) !== intro.length) fail('다시 듣기가 인사 전체가 아니다');
  for (let i = 0; i < intro.length; i++) { await page.click('[data-action="guideNext"]', { force: true }); await page.waitForTimeout(120); }
  const outs: number[] = [];
  for (let i = 0; i < 4; i++) {
    outs.push(await page.evaluate(() => Math.round(document.querySelector('.stw-man')?.getBoundingClientRect().x ?? -1)));
    await page.waitForTimeout(90);
  }
  const outMoving = outs.filter((x) => x > 0);
  if (outMoving.length > 1 && outMoving[0]! >= outMoving[outMoving.length - 1]!) fail(`물러나는 연출이 오른쪽이 아니다 — ${outs.join(',')}`);
  await page.waitForSelector('.stw', { state: 'detached', timeout: 3_000 });
  ok(`목록 ${listed.length}개 · 묶음 ${groups.join(' · ')} · 들어온다 x ${moving.map((s) => s.x).join('→')} · 물러난다 x ${outs.join('→')}`);

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
