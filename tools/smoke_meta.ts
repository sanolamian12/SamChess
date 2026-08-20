/**
 * 메타 연동 스모크 — 오프라인 한 바퀴가 실제로 도는지 확인한다.
 *
 *   node --experimental-strip-types tools/smoke_meta.ts
 *
 * ```
 * 간판 → 새 계정 → 도시 → 병영 → 부대 편성 → 출정하기 → 구성 → 부대 → 매칭
 *                                              → 전투준비 → 배치 → 정찰 → 전투
 *                        └ 궁궐 → 장수 관리 → 레벨업 → 새로고침
 * ```
 *
 * `npm test`(순수 규칙)와 `smoke:ui`(전투 화면) 사이가 여기다. 규칙도 맞고 전투도 도는데
 * **화면이 그 둘을 잇지 못하는** 종류를 잡는다 — 편성이 엔진에 안 넘어가거나,
 * 저장이 안 되거나, 결과가 계정에 반영되지 않는 것.
 *
 * 개발 서버(`npm run dev`)가 떠 있어야 한다.
 */

import { chromium } from 'playwright';
import { Client } from 'colyseus.js';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { makeAiOpponent } from '@samchess/meta';
import { BattleRoom, QueueRoom, SERVER_PORT } from '@samchess/server';

const argv = process.argv.slice(2);
const i = argv.indexOf('--url');
const BASE = i >= 0 && argv[i + 1] ? argv[i + 1]! : 'http://localhost:5173';

const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

/*
 * **온라인 매칭(§8.7)을 실제로 지나려면 진짜 서버가 있어야 한다** — `?match=online`
 * 흉내는 대기열이 실제로 도는 지금은 지웠다(H2b, §5-52의 「도는 적 없는 검사」를
 * 다시 만들지 않으려는 것). 클라이언트 기본 주소(`ws://localhost:2567`)와 같은
 * 포트로 띄운다. **이미 `npm run server`가 떠 있어도 괜찮다** — 그 자리를 그대로 쓴다.
 */
let ownServer: Server | null = null;
try {
  ownServer = new Server({ transport: new WebSocketTransport() });
  ownServer.define('battle', BattleRoom);
  ownServer.define('queue', QueueRoom);
  await ownServer.listen(SERVER_PORT);
  console.log(`✓ 대전 서버(스모크 전용) — ws://localhost:${SERVER_PORT}`);
} catch {
  ownServer = null;
  console.log(`✓ 대전 서버 — 이미 떠 있는 것을 그대로 쓴다 (ws://localhost:${SERVER_PORT})`);
}

/**
 * **거절 흉내를 대신할 가짜 상대** — 대기열에 붙어 확인 없이 기다린다.
 *
 * 「군량이 딱 최소라 [다시 찾기]가 없다」·「거절하면 다른 상대로 바뀐다」를 보려면
 * **매번 다른, 아직 안 거절당한** 상대가 필요하다(§5-63의 거절 기억 때문에 같은
 * 봇과는 다시 안 붙는다). 매번 새 봇을 하나씩 띄운다 — 확인은 안 보낸다, 스모크가
 * 보는 것은 매칭 화면 상태이지 실제 전투가 아니다.
 */
async function queueBot(power: number, seed: number): Promise<{ close: () => Promise<void> }> {
  const ai = makeAiOpponent('3v3', power, seed);
  const client = new Client(`ws://localhost:${SERVER_PORT}`);
  const room = await client.joinOrCreate('queue', { playerId: `smokebot-${seed}` });
  room.send('search', {
    search: {
      mode: '3v3', power,
      enlist: { playerId: `smokebot-${seed}`, entries: ai.entries, squadName: `봇부대${seed}`, power, deploy: null },
    },
  });
  return { close: (): Promise<void> => room.leave() };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });

/**
 * 배경 그림이 **실제로 받아졌는지** 본다.
 *
 * `background-image` 가 붙어 있는 것만으로는 모자라다 — 에셋이 없으면 URL은 그대로
 * 있고 404만 난다(화면은 바탕색으로 물러난다). 그림이 화면의 뜻을 나르는 자리라
 * 「띄우기로 한 그림」과 「실제로 뜬 그림」을 둘 다 확인한다.
 *
 * **그림은 화면 div 자신이 아니라 `.scr-art` 층에 있다** (2026-08-15). 천천히
 * 움직이게 하면서 떼어 냈다 — 화면 div에 `transform`을 걸면 글자까지 흔들린다.
 * 층이 없는 화면(편성의 `.scr-dim`)도 있어 없으면 제 자신을 본다.
 */
const backdropOf = (sel: string) => page.evaluate((s) => {
  const scr = document.querySelector(s);
  if (!scr) return null;
  const el = scr.querySelector(':scope > .scr-art') ?? scr;
  const url = /url\(["']?(.+?)["']?\)/.exec(getComputedStyle(el).backgroundImage)?.[1] ?? null;
  return url ? { url, name: url.split('/').pop() ?? '' } : null;
}, sel);

const expectBackdrop = async (sel: string, want: string, where: string): Promise<void> => {
  const got = await backdropOf(sel);
  if (!got) fail(`${where} 배경 그림이 지정되지 않았다 (${sel})`);
  if (got!.name !== want) fail(`${where} 배경이 「${want}」여야 하는데 「${got!.name}」다`);
  const ok = await page.evaluate((u) => fetch(u).then((r) => r.ok, () => false), got!.url);
  if (!ok) fail(`${where} 배경 ${want} 을 받아오지 못한다 — npm run backgrounds 를 돌렸는가`);
  console.log(`✓ 배경 ${where} — ${want}`);
};

// ── 간판·로그인 화면 (pptx 33·34쪽) ────────────────────────────

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);

if (!await page.$('.scr-title')) fail('게임 URL로 들어왔는데 간판 화면이 뜨지 않는다');
if (await page.textContent('.scr-title .brand') !== '만민의 삼국지') fail('간판의 게임 이름이 「만민의 삼국지」가 아니다');
// 접속 시각의 시간대 그림. 셋 중 하나이기만 하면 된다 — 어느 것인지는 시계가 정한다
{
  const band = await page.evaluate(() => {
    const h = new Date().getHours();
    return h >= 7 && h < 16 ? 'day' : h >= 16 && h < 20 ? 'dusk' : 'night';
  });
  await expectBackdrop('.scr-title', `open-${band}.jpg`, `간판(${band})`);
}

// 배경이 천천히 움직인다 — **그림만** 움직이고 글자는 제자리다 (2026-08-15).
// 층을 도로 합치면(화면 div의 배경으로 되돌리면) 제목·단추가 함께 흔들리는데,
// 자세가 워낙 작아 스크린샷 한 장으로는 알아채기 어렵다. 좌표로 잡는다.
{
  const look = () => page.evaluate(() => {
    const art = document.querySelector('.scr-title > .scr-art') as HTMLElement | null;
    const brand = document.querySelector('.scr-title .brand') as HTMLElement | null;
    if (!art || !brand) return null;
    const b = brand.getBoundingClientRect();
    return { step: art.dataset.drift, tf: getComputedStyle(art).transform, x: b.left, y: b.top };
  });
  const a = await look();
  if (!a) fail('배경의 움직이는 층(.scr-art)이 없다 — 그림이 화면 div로 되돌아갔는가');
  await page.waitForTimeout(2900);          // 한 걸음(DRIFT_MS 2600ms)보다 조금 더
  const b = (await look())!;
  if (a!.step === b.step || a!.tf === b.tf) fail(`배경이 움직이지 않는다 (걸음 ${a!.step} → ${b.step})`);
  if (a!.x !== b.x || a!.y !== b.y) fail('배경이 움직일 때 글자까지 따라 움직인다 — 층이 합쳐졌다');
  console.log(`✓ 배경 움직임 — 걸음 ${a!.step} → ${b.step}, 글자는 제자리`);
}

// 환경설정 — 어느 화면에서든 기어로 연다 (33쪽 오른쪽)
await page.click('.scr-title [data-action="settings"]');
await page.waitForTimeout(150);
const settings = await page.evaluate(() => ({
  open: !!document.querySelector('[data-modal="settings"]'),
  langs: [...document.querySelectorAll('[data-modal="settings"] [data-lang]')].map((el) => (el as HTMLElement).dataset.lang),
}));
if (!settings.open) fail('기어를 눌렀는데 환경설정이 뜨지 않는다');
// 한국어 기본 + 영어·포르투갈어·일본어·중국어 (기획자 지정 2026-08-15)
if (settings.langs.join(',') !== 'ko,en,pt,ja,zh') fail(`지원 언어가 다르다: [${settings.langs.join(' ')}]`);
await page.click('[data-modal="settings"] .btn.ghost');
await page.waitForTimeout(150);
if (await page.$('[data-modal="settings"]')) fail('환경설정이 닫히지 않는다');
console.log(`✓ 간판 — 환경설정 · 언어 [${settings.langs.join(' ')}]`);

// ── 새 계정 (GDD §8) ───────────────────────────────────────────

await page.click('.scr-title [data-action="enter"]');
await page.waitForTimeout(300);
if (!await page.$('.scr-new')) fail('저장된 계정을 지웠는데도 새 계정 화면이 뜨지 않는다');
await page.fill('.field', '스모크성');
await page.click('.scr-new .btn.primary');
await page.waitForTimeout(300);

const main = await page.evaluate(() => ({
  city: document.querySelector('.scr-main .title')?.textContent ?? '',
  stats: [...document.querySelectorAll('.scr-main .stat')].map((el) => el.textContent ?? ''),
  places: [...document.querySelectorAll('.scr-main [data-place]')].map((el) => (el as HTMLElement).dataset.place),
}));
if (main.city !== '스모크성') fail(`도시 이름이 반영되지 않았다: "${main.city}"`);
// 초기 지급은 S·A·B·C·D 각 1명 (GDD §8)
if (!main.stats.some((s) => s.includes('5/10'))) fail(`초기 지급이 5명이 아니다: ${main.stats.join(' ')}`);
// 궁궐·병영·장터 (pptx 35쪽)
if (main.places.join(',') !== 'palace,barracks,market') fail(`도시의 자리가 다르다: [${main.places.join(' ')}]`);
console.log(`✓ 새 계정 — ${main.city}, ${main.stats.join(' · ')}, 자리 [${main.places.join(' ')}]`);

/*
 * 간판이 그림에 **가려지지 않아야** 한다. 좌표로 잡는 이유는 「화면에 칠했으면 누를 수
 * 있어야 한다」와 같다 — 그림 위에 얹은 것이라 배치가 어긋나면 화면 밖으로 나간다.
 */
const spots = await page.evaluate(() => {
  const frame = document.getElementById('frame')!.getBoundingClientRect();
  return [...document.querySelectorAll('.scr-main [data-place]')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      place: (el as HTMLElement).dataset.place!,
      inside: r.left >= frame.left - 1 && r.right <= frame.right + 1
        && r.top >= frame.top - 1 && r.bottom <= frame.bottom + 1,
      hit: document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)?.closest('[data-place]') === el,
    };
  });
});
for (const s of spots) {
  if (!s.inside) fail(`「${s.place}」 간판이 프레임 밖으로 나갔다`);
  if (!s.hit) fail(`「${s.place}」 간판이 무언가에 가려 눌리지 않는다`);
}
console.log(`✓ 도시 간판 — 셋 다 프레임 안에서 눌린다`);
{
  const band = await page.evaluate(() => {
    const h = new Date().getHours();
    return h >= 7 && h < 16 ? 'day' : h >= 16 && h < 20 ? 'dusk' : 'night';
  });
  await expectBackdrop('.scr-main', `main-${band}.jpg`, `도시(${band})`);
}

/*
 * 배경음악 — 화면마다 한 곡 (2026-08-14 기획자 지정).
 *
 * **소리가 실제로 났는지는 볼 수 없다.** 브라우저는 사용자가 화면을 건드리기 전에는
 * 재생을 막고, 헤드리스에는 출력 장치도 없다. 그래서 「지금 어느 곡을 틀기로 했는가」를
 * 본다 — 화면과 곡이 어긋나는 것은 그것으로 잡힌다.
 */
const bgm = (): Promise<string | null> =>
  page.evaluate(() => ((window as any).__bgm?.track ?? null) as string | null);
const expectBgm = async (want: string, where: string): Promise<void> => {
  const got = await bgm();
  if (got !== want) fail(`${where} 배경음악이 「${want}」여야 하는데 「${got}」다`);
  console.log(`✓ 배경음악 ${where} — ${want}`);
};
await expectBgm('main', '메인');

// ── 병영 — 지금까지 만든 전투 길의 입구 (pptx 35·36쪽) ─────────

await page.click('.scr-main [data-place="barracks"]');
await page.waitForTimeout(300);
if (!await page.$('.scr-place-barracks')) fail('병영을 눌렀는데 병영 화면이 아니다');
// 도시 Lv1이므로 첫째 그림이다 (Lv5부터 place-2)
await expectBackdrop('.scr-place', 'place-1-barracks.jpg', '병영');

/*
 * **문이 하나로 합쳐졌다** (F · 45쪽 · §5-32). 예전에는 병영에 `3:3`·`5:5` 두 단추가
 * 있었고 그것이 곧 AI 대전이었다. 지금은 셋이다 — `[부대 편성]`·`[출정하기]`·
 * `[튜토리얼 시나리오]`(잠김). 참여 인원은 [출정하기] 안의 첫 걸음으로 내려갔다.
 */
{
  const doors = await page.evaluate(() =>
    [...document.querySelectorAll('.scr-place-barracks .place-panel > .btn')].map((el) => ({
      action: (el as HTMLElement).dataset.action ?? '',
      locked: (el as HTMLButtonElement).disabled,
    })));
  const has = (a: string) => doors.some((d) => d.action === a);
  if (!has('squads')) fail('병영에 [부대 편성]이 없다 (42쪽)');
  if (!has('sortie')) fail('병영에 [출정하기]가 없다 — 문 통합이 안 됐다 (§5-32)');
  if (!has('tutorial')) fail('병영에 [튜토리얼 시나리오]가 없다 (45쪽)');
  // 옛 문이 남아 있으면 안 된다 — 상대를 고를 수 있으면 보상이 갈리는 근거가 되살아난다
  if (await page.$('.scr-place-barracks [data-mode]')) {
    fail('병영에 3:3 / 5:5 단추가 아직 있다 — [출정하기]로 합쳐졌어야 한다');
  }
  if (!doors.find((d) => d.action === 'tutorial')?.locked) fail('튜토리얼이 잠겨 있지 않다 (G3)');
  if (!await page.$('[data-field="tutorialWhy"]')) fail('튜토리얼이 잠겼는데 왜인지 안 적혀 있다');
  console.log(`✓ 병영 — 문 셋 [${doors.map((d) => d.action + (d.locked ? '(잠김)' : '')).join(' ')}]`);
}

// ── 부대 편성 · 배치 프리셋 (E · pptx 42·43쪽) ─────────────────
//
// **단위 테스트는 「화면이 그 함수를 부르는가」를 모른다.** 부대를 저장했는데
// 전투에 안 실리거나, 배치 프리셋이 깔리지 않거나, 이력의 부대 이름이 비는 것은
// 전부 여기서만 잡힌다 (B의 되접기·C2의 군량 충전과 같은 자리다).

await page.click('[data-action="squads"]');
await page.waitForTimeout(300);
if (!await page.$('[data-screen="squads"]')) fail('[부대 편성]을 눌렀는데 목록이 뜨지 않는다');
{
  // 상한은 **도시 레벨**이 정한다 — Lv1은 10개 (§5-7)
  const cap = await page.textContent('[data-field="cap"]');
  if (!cap?.includes('0 / 10')) fail(`부대 상한이 도시 Lv1의 10이 아니다 — "${cap}"`);
  if (!await page.$('[data-field="empty"]')) fail('부대가 없는데 안내가 없다');
}

/** 부대 하나를 만든다 — 이름·모드 → 구성 → (배치) → 등록 완료 */
const makeSquad = async (name: string, pieces: string[], deploy: boolean): Promise<void> => {
  await page.click('[data-action="new"]');
  await page.waitForTimeout(250);
  if (!await page.$('[data-screen="squadNew"]')) fail('[새 편성 만들기]가 이름 화면으로 가지 않는다');
  // 이름 없이·모드 없이 넘어갈 수 없다 (43쪽 「부대 이름을 입력해주세요.」)
  if (await page.isEnabled('[data-action="next"]')) fail('이름도 모드도 없는데 [다음]이 열려 있다');
  await page.fill('[data-field="name"]', name);
  await page.click('[data-mode="3v3"]');
  await page.waitForTimeout(120);
  await page.click('[data-action="next"]');
  await page.waitForTimeout(250);

  for (const piece of pieces) {
    if (piece !== 'King') await page.click(`.sqd-piece[data-piece="${piece}"]`);
    await page.waitForTimeout(80);
    const row = await page.$('.sqd-prow:not(.used)');
    if (!row) fail(`보유 장수가 모자라 부대를 채울 수 없다 (${piece})`);
    await row!.click();
    await page.waitForTimeout(80);
  }
  if (deploy) {
    await page.click('[data-action="deploy"][data-side="P1"]');
    await page.waitForTimeout(250);
    if (!await page.$('[data-screen="squadDeploy"]')) fail('[배치]가 편집기로 가지 않는다');
    /*
     * **기본 배치에서 한 칸 옮겨 둔다.** 기본 그대로 저장하면 아래의 「프리셋이
     * 깔렸는가」가 **깔리지 않아도 통과한다** — 판이 어차피 같은 자리에 세우기
     * 때문이다. 방어를 넣었으면 그것이 발동하는 입력을 만들어 본다(B의 교훈).
     */
    await page.click('[data-hold="King"]');
    await page.click('.sqd-cell[data-cell="F16"]');
    await page.waitForTimeout(120);
    if (!await page.$('.sqd-cell[data-cell="F16"][data-piece="King"]')) fail('배치 편집기에서 기물이 안 옮겨진다');
    await page.click('[data-action="deploySave"]');
    await page.waitForTimeout(200);
  }
  await page.click('[data-action="save"]');
  await page.waitForTimeout(300);
};

await makeSquad('버릴부대', ['King', 'Rock', 'Pawn'], false);
{
  const row = await page.evaluate(() => {
    const el = document.querySelector('[data-mode="3v3"] .sqd-row');
    const q = (f: string) => el?.querySelector(`[data-field="${f}"]`)?.textContent ?? '';
    return { name: q('name'), power: q('power'), members: q('members'), count: document.querySelectorAll('.sqd-row').length };
  });
  if (row.name !== '버릴부대') fail(`목록에 부대가 안 뜬다 — "${row.name}"`);
  // **전투력은 규칙이 낸다** — 화면이 공식을 다시 적으면 여기가 아니라 표시만 어긋난다
  if (!/^[0-9,]+$/.test(row.power)) fail(`전투력이 숫자가 아니다 — "${row.power}"`);
  if (row.members.split(',').length !== 3) fail(`구성이 세 명이 아니다 — "${row.members}"`);
  console.log(`✓ 부대 만들기 — 3v3 「${row.name}」 전투력 ${row.power} · ${row.members}`);
}

// 같은 이름은 못 만든다 (§5-7 「중복 불허」)
await page.click('[data-action="new"]');
await page.waitForTimeout(250);
await page.fill('[data-field="name"]', '버릴부대');
await page.click('[data-mode="3v3"]');
await page.waitForTimeout(120);
if (await page.isEnabled('[data-action="next"]')) fail('이름이 겹치는데 [다음]이 열려 있다');
{
  const why = await page.textContent('[data-field="nameNote"]');
  if (!why?.includes('이미 있다')) fail(`이름 중복을 말하지 않는다 — "${why}"`);
}
await page.click('[data-action="back"]');
await page.waitForTimeout(250);

// 삭제는 한 번 묻는다 (증축·재설계와 같은 결)
await page.click('.sqd-row [data-action="delete"]');
await page.waitForTimeout(200);
{
  const modal = await page.$('[data-modal="squadDelete"]');
  if (!modal) fail('[삭제]를 눌렀는데 확인 팝업이 없다');
  // 「있는가」와 「제자리에 있는가」는 다른 검사다 (2026-08-17에 밟은 자리)
  const spot = await page.evaluate(() => {
    const back = document.querySelector('[data-modal="squadDelete"]') as HTMLElement;
    const frame = document.getElementById('frame')!.getBoundingClientRect();
    const r = back.getBoundingClientRect();
    return { cx: Math.round(r.left + r.width / 2 - (frame.left + frame.width / 2)), pos: getComputedStyle(back).position };
  });
  if (spot.pos !== 'absolute' || Math.abs(spot.cx) > 2) {
    fail(`삭제 팝업이 화면 한가운데가 아니다 (${spot.pos}, 중심 어긋남 ${spot.cx}px)`);
  }
}
await page.click('[data-action="deleteConfirm"]');
await page.waitForTimeout(250);
if (await page.$('.sqd-row')) fail('삭제했는데 목록에 남아 있다');
console.log('✓ 부대 삭제 — 확인 팝업(화면 한가운데) 뒤에 사라진다');

// 실제로 출전할 부대. **배치 프리셋을 저장해 둔다** — 아래 배치 단계에서 확인한다
await makeSquad('스모크부대', ['King', 'Rock', 'Pawn'], true);
const squadPlan = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('samchess.profile.v1')!);
  const sq = p.squads[0];
  return {
    name: sq.name as string, cap: p.squads.length as number,
    picks: (sq.picks as { piece: string; officer: string; level?: number }[]),
    deploy: (sq.deploy.P1 as { piece: string; x: number; y: number }[]),
  };
});
if (!squadPlan.deploy || squadPlan.deploy.length !== 3) fail('배치 프리셋이 저장되지 않았다');
// 기본 배치와 **달라야** 아래 검사가 뜻을 갖는다 (King을 F16 = 5,15 로 옮겨 뒀다)
if (!squadPlan.deploy.some((c) => c.piece === 'King' && c.x === 5 && c.y === 15)) {
  fail(`옮긴 자리가 저장되지 않았다 — ${JSON.stringify(squadPlan.deploy)}`);
}
console.log(`✓ 배치 프리셋 저장 — 남군 ${squadPlan.deploy.map((c) => `${c.piece}@${c.x},${c.y}`).join(' ')}`);

// 수정으로 다시 열면 **레벨 눈금**이 있다 (42쪽 「최대 레벨에서 1 사이로 조절 가능」)
await page.click('.sqd-row [data-action="open"]');
await page.waitForTimeout(300);
{
  const edit = await page.evaluate(() => ({
    screen: document.querySelector('[data-screen="squadEdit"]') !== null,
    save: document.querySelector('[data-action="save"]')?.textContent ?? '',
    levels: [...document.querySelectorAll('.sqd-slot')].map((el) => ({
      piece: (el as HTMLElement).dataset.piece,
      steps: el.querySelectorAll('.sqd-lv').length,
    })),
    power: document.querySelector('[data-field="power"] .v')?.textContent ?? '',
  }));
  if (!edit.screen) fail('부대 줄을 눌렀는데 수정 화면이 아니다');
  // 신규는 「등록 완료」, 수정은 「수정 완료」 (42·43쪽이 단추 글자만 다르다)
  if (edit.save !== '수정 완료') fail(`수정 화면인데 단추가 「${edit.save}」다`);
  if (edit.levels.length !== 3) fail(`자리가 3개가 아니다 — ${edit.levels.length}`);
  // 새 계정의 장수는 전부 Lv1이라 눈금이 한 칸이다. 칸 수 = 보유 레벨이 규약이다
  if (edit.levels.some((l) => l.steps !== 1)) fail(`레벨 눈금이 보유 레벨을 따르지 않는다: ${JSON.stringify(edit.levels)}`);
  console.log(`✓ 부대 수정 — [${edit.levels.map((l) => l.piece).join(' ')}] 전투력 ${edit.power} · 눈금 1칸(전원 Lv1)`);
}
await page.click('[data-action="back"]');
await page.waitForTimeout(250);
await page.click('[data-action="back"]');
await page.waitForTimeout(300);
if (!await page.$('.scr-place-barracks')) fail('부대 목록에서 병영으로 돌아오지 못한다');

// ── 출전 · 매칭 (pptx 45쪽 · F · H2b) ───────────────────────────
//
// **단위 테스트는 「화면이 그 판정을 그리는가」를 모른다.** 「딱 최소면 [다시 찾기]가
// 아예 안 나오는가」·「거절을 반복해 바닥에 닿으면 사라지는가」는 여기서만 잡힌다.
//
// 온라인은 **진짜 대기열**을 지난다(H2b) — 흉내 통로(`?match=online`)는 지웠다
// (§5-52의 「도는 적 없는 검사」를 다시 만들지 않으려는 것). 온라인 상대가 필요한
// 자리마다 `queueBot()`으로 진짜 상대 하나를 대기열에 세워 둔다 — 거절 기억
// (§5-63) 때문에 같은 봇과는 다시 안 붙으므로 **거절할 때마다 새 봇**이 필요하다.

/** 군량을 갈아 끼우고 새로고침해 병영까지 온다 — 20/20에서 17번 거절할 수는 없다 */
const setGrain = async (grain: number, query: string): Promise<void> => {
  await page.evaluate((g) => {
    const saved = JSON.parse(localStorage.getItem('samchess.profile.v1')!);
    saved.grain = g;
    // **정산 시각도 함께 찍는다** — 안 찍으면 1분 tick이 흘러간 만큼 되채워 경계가 흐트러진다
    saved.grainAt = Date.now();
    localStorage.setItem('samchess.profile.v1', JSON.stringify(saved));
  }, grain);
  await page.goto(`${BASE}/${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.click('.scr-title [data-action="enter"]');
  await page.waitForTimeout(300);
  await page.click('.scr-main [data-place="barracks"]');
  await page.waitForTimeout(300);
};

/** 병영 → [출정하기] → 구성 → 부대 고르기까지 */
const toSquadStep = async (): Promise<void> => {
  await page.click('[data-action="sortie"]');
  await page.waitForTimeout(300);
  if (!await page.$('[data-screen="sortie"][data-step="mode"]')) fail('[출정하기]가 구성 고르기로 가지 않는다');
  await page.click('[data-mode="3v3"]');
  await page.waitForTimeout(250);
  if (!await page.$('[data-screen="sortie"][data-step="squad"]')) fail('구성을 골랐는데 부대 고르기가 아니다');
};

/** 매칭 화면이 지금 무엇을 그리고 있나 */
const matchView = () => page.evaluate(() => {
  const bar = document.querySelector('[data-screen="match"]') as HTMLElement | null;
  const q = (f: string) => document.querySelector(`[data-field="${f}"]`)?.textContent ?? '';
  return {
    state: bar?.dataset.state ?? '', kind: bar?.dataset.kind ?? '',
    name: q('foeName'), members: q('foeMembers'), odds: q('odds'), why: q('noDecline'),
    power: Number(document.querySelector('.mtc-foe')?.getAttribute('data-power') ?? '0'),
    decline: document.querySelector('[data-action="decline"]') !== null,
  };
});

const savedGrain = () => page.evaluate(() =>
  JSON.parse(localStorage.getItem('samchess.profile.v1')!).grain as number);

// ── ① 군량이 넉넉할 때 — 안내문 없이 곧바로 매칭으로 (AI 갈래) ──

await setGrain(10, '?match=fast');
await toSquadStep();
await expectBgm('roster', '출전·부대 고르기');
await expectBackdrop('.scr-sortie', 'place-1-barracks.jpg', '출전');

// 45쪽의 「부대명 | 멤버 | 전투력」
const myPower = await page.evaluate(() => {
  const el = document.querySelector('.srt-row');
  const q = (f: string) => el?.querySelector(`[data-field="${f}"]`);
  return {
    name: q('name')?.textContent ?? '', members: q('members')?.textContent ?? '',
    power: Number(q('power')?.getAttribute('data-power') ?? '0'),
  };
});
if (myPower.name !== '스모크부대') fail(`부대 목록에 안 뜬다 — "${myPower.name}"`);
if (!(myPower.power > 0)) fail(`전투력이 안 나온다 — ${myPower.power}`);
if (myPower.members.split(',').length !== 3) fail(`구성이 세 명이 아니다 — "${myPower.members}"`);
console.log(`✓ 부대 고르기 — 「${myPower.name}」 ${myPower.power} 점 · ${myPower.members}`);

// 고르기 전에는 [대전상대 찾기]가 잠겨 있다
if (await page.isEnabled('[data-action="seek"]')) fail('부대를 고르지도 않았는데 [대전상대 찾기]가 열려 있다');
await page.click('.srt-row [data-action="pickSquad"]');
await page.waitForTimeout(150);

const grainBefore = await savedGrain();
await page.click('[data-action="seek"]');
await page.waitForTimeout(200);
// 군량이 넉넉하면 안내문 없이 지나간다 (§5-16의 표에서 `> cost` 줄)
if (await page.$('[data-modal="minGrain"]')) fail('군량이 넉넉한데 최소군량 안내가 떴다');
if (!await page.$('[data-screen="match"]')) fail('[대전상대 찾기]가 매칭 화면으로 가지 않는다');
{
  // 세 상태 중 첫째 — 「대전 상대를 찾고 있습니다..」
  const now = await matchView();
  if (now.state !== 'searching') fail(`매칭 첫 상태가 「찾는 중」이 아니다 — ${now.state}`);
  if (!await page.$('[data-field="left"]')) fail('찾는 중인데 남은 시간이 안 보인다');
}
await page.waitForTimeout(2500);
{
  const found = await matchView();
  if (found.state !== 'found') fail(`상대를 못 찾았다 — 상태 ${found.state}`);
  // 온라인은 아직 아무도 없으므로 AI로 떨어진다
  if (found.kind !== 'ai') fail(`온라인이 안 붙었는데 상대가 ${found.kind}다`);
  if (found.name !== 'AI 부대') fail(`AI 상대의 이름이 이상하다 — "${found.name}"`);
  if (found.members.split(',').length !== 3) fail(`상대가 세 명이 아니다 — "${found.members}"`);
  /*
   * **AI 상대의 전투력이 내 부대와 가깝다** (§5-32). 등급 점수로 뽑던 시절에는
   * Lv9 S급 셋이 Lv1 S급 셋을 만났다 — 온라인이 `MATCH_BAND`로 고르는 것과 같은
   * 눈금이라야 「상대가 바뀐 것뿐」이 성립한다.
   */
  const gap = Math.abs(found.power - myPower.power);
  if (gap > 20) fail(`AI 상대가 내 부대와 멀다 — 내 ${myPower.power} 대 상대 ${found.power} (차 ${gap}, 구간 ±20)`);
  if (!found.odds.includes('예상 승률')) fail(`예상 승률이 안 보인다 — "${found.odds}"`);
  // AI에게는 거절할 상대가 없다 (§5-15 — 문이 하나가 되어도 이 경계는 남는다)
  if (found.decline) fail('AI 상대인데 [다시 찾기]가 떠 있다');
  if (!await page.$('[data-field="aiNote"]')) fail('AI라 다시 찾을 수 없다는 말이 없다');
  console.log(`✓ 매칭(AI) — 내 ${myPower.power} 대 상대 ${found.power} (차 ${gap}) · [다시 찾기] 없음`);
}

// **참가비는 아직 안 나갔다** — [뒤로 가기]로 나가도 한 톨도 안 준다 (§5-16)
await page.click('[data-screen="match"] [data-action="back"]');
await page.waitForTimeout(300);
if (!await page.$('[data-screen="sortie"]')) fail('매칭에서 뒤로 가기가 안 산다');
{
  const now = await savedGrain();
  if (now !== grainBefore) fail(`매칭만 하고 나왔는데 군량이 줄었다 — ${grainBefore} → ${now}`);
  console.log(`✓ 참가비 — 매칭만 하고 나오면 안 나간다 (군량 ${now} 그대로)`);
}

// ── ② 딱 최소 군량 — 안내문이 뜨고 [다시 찾기]가 아예 없다 (§5-16) ──

const bot2 = await queueBot(myPower.power, 2002);
await setGrain(3, '?match=fast');
await toSquadStep();
await page.click('.srt-row [data-action="pickSquad"]');
await page.waitForTimeout(150);
await page.click('[data-action="seek"]');
await page.waitForTimeout(250);
{
  if (!await page.$('[data-modal="minGrain"]')) fail('딱 최소 군량(3)인데 안내문이 안 뜬다 — 들어간 뒤에 알면 늦다');
  const warn = await page.textContent('[data-modal="minGrain"] [data-field="warn"]');
  if (!warn?.includes('거절을 할 수 없습니다')) fail(`안내문이 45쪽 문구가 아니다 — "${warn}"`);
  // 「있는가」와 「제자리에 있는가」는 다른 검사다 (2026-08-15에 밟은 자리)
  const spot = await page.evaluate(() => {
    const back = document.querySelector('[data-modal="minGrain"]') as HTMLElement;
    const frame = document.getElementById('frame')!.getBoundingClientRect();
    const r = back.getBoundingClientRect();
    return { cx: Math.round(r.left + r.width / 2 - (frame.left + frame.width / 2)), pos: getComputedStyle(back).position };
  });
  if (spot.pos !== 'absolute' || Math.abs(spot.cx) > 2) {
    fail(`최소군량 안내가 화면 한가운데가 아니다 (${spot.pos}, 중심 어긋남 ${spot.cx}px)`);
  }
}
await page.click('[data-action="minGrainOk"]');
await page.waitForTimeout(2500);
{
  const found = await matchView();
  if (found.state !== 'found') fail(`대기열의 상대를 못 찾았다 — ${found.state}`);
  if (found.kind !== 'online') fail(`대기열에 봇이 있는데 상대가 ${found.kind}다`);
  if (found.decline) fail('군량이 딱 최소(3)인데 [다시 찾기]가 떠 있다 — 매칭된 상대와 반드시 싸운다');
  if (!found.why.includes('거절을 할 수 없습니다')) fail(`[다시 찾기]가 없는 이유를 안 적는다 — "${found.why}"`);
  console.log('✓ 매칭(온라인) — 군량 3이면 [다시 찾기]가 아예 없다');
}
await bot2.close();
// **정리하고 나간다** — 열린 소켓을 안고 그대로 `page.goto()`로 넘어가면 브라우저가
// 강제로 끊으며 콘솔에 「WebSocket is already in CLOSING…」이 남는다
await page.click('[data-screen="match"] [data-action="back"]');
await page.waitForTimeout(300);

// ── ③ 거절을 반복하면 바닥에서 단추가 사라진다 ──

// 거절 기억(§5-63) 때문에 **거절 전용 봇**과 **재매칭용 봇**을 따로, **시차를 두고**
// 세운다 — 둘을 한꺼번에 대기열에 넣으면 봇끼리 먼저 매칭돼 버린다(둘 다 전투력이
// 같다). 재매칭용 봇은 **거절한 뒤에** 세워야 브라우저와 만난다.
const bot3 = await queueBot(myPower.power, 3003);
let bot4: { close: () => Promise<void> } | null = null;
await setGrain(4, '?match=fast');
await toSquadStep();
await page.click('.srt-row [data-action="pickSquad"]');
await page.waitForTimeout(150);
await page.click('[data-action="seek"]');
await page.waitForTimeout(2500);
{
  const before = await matchView();
  if (!before.decline) fail('군량 4면 한 번은 거절할 수 있어야 한다');
  if (before.kind !== 'online') fail(`대기열의 상대를 못 찾았다 — ${before.kind}`);
  await page.click('[data-action="decline"]');
  /*
   * **거절당한 쪽(bot3)이 먼저 빠져야 한다.** `decline()`은 거절당한 쪽에게
   * 「대기열 앞자리」를 준다(§5-63) — bot3가 그대로 남아 있으면 bot4가 들어왔을 때
   * **bot3부터 집어간다**(bot3은 잘못한 게 없으니 우선이다). 표본을 하나로
   * 좁히려고 여기서 내보낸다 — 실제 대기열에선 그냥 조금 더 기다릴 뿐이다.
   */
  await bot3.close();
  bot4 = await queueBot(myPower.power, 3004);   // 거절한 뒤에야 세운다 — 위 참조
  await page.waitForTimeout(2500);
  const after = await matchView();
  const grain = await savedGrain();
  if (grain !== 3) fail(`거절이 군량 −1이 아니다 — 4 → ${grain}`);
  if (after.state !== 'found') fail(`거절 뒤 다시 찾지 않는다 — ${after.state}`);
  if (after.kind !== 'online') fail(`거절 뒤 대기열의 다른 상대를 못 찾았다 — ${after.kind}`);
  // 「다시 찾기」는 **다른 상대**를 물어 와야 한다 — 거절한 상대와는 다시 안 붙는다(§5-63)
  if (after.members === before.members) fail(`거절했는데 같은 상대다 — "${after.members}"`);
  // **바닥에 닿으면 화면 안에서 사라진다** — 진입 전 안내문만으로는 못 막는 자리다
  if (after.decline) fail('군량이 참가비(3)에 닿았는데 [다시 찾기]가 남아 있다');
  console.log('✓ 거절 — 군량 4 → 3, 상대가 바뀌고, 바닥에서 단추가 사라진다');
}
await bot4?.close();
await page.click('[data-screen="match"] [data-action="back"]');   // 위 참조 — 정리하고 나간다
await page.waitForTimeout(300);

// ── ④ 전투준비 — **여기서** 참가비가 나간다 ──

await setGrain(10, '?match=fast');
await toSquadStep();
await page.click('.srt-row [data-action="pickSquad"]');
await page.waitForTimeout(150);
await page.click('[data-action="seek"]');
await page.waitForTimeout(2500);
if (!await page.$('[data-action="ready"]')) fail('상대를 찾았는데 [전투준비]가 없다');
const grainAtReady = await savedGrain();

// ── 전투준비 → 배치 → 정찰 → 전투 (GDD §3.9) ──────────────────

await page.click('[data-action="ready"]');
await page.waitForTimeout(2500);

// **참가비는 [전투준비]에서만 나간다** (§5-16 · GDD §6.1). 3v3이므로 −3
{
  const now = await savedGrain();
  if (now !== grainAtReady - 3) fail(`참가비가 [전투준비]에서 안 나갔다 — ${grainAtReady} → ${now}`);
  console.log(`✓ 참가비 — [전투준비]에서 ${grainAtReady} → ${now} (3v3 −3)`);
}

/** 씬에서 지금 단계를 뽑아 온다 */
const stage = () => page.evaluate(() => {
  const pb = (window as any).__battle?.scene?.debugPlayback;
  return pb ? {
    phase: pb.phase as string,
    engine: pb.state.phase as string,
    ready: pb.state.ready as Record<string, boolean>,
    remain: pb.remainingSec as number | null,
    button: document.querySelector('.prep-go')?.textContent ?? '',
    hidden: document.getElementById('prep')?.classList.contains('hidden') ?? true,
    mine: Object.values(pb.state.units as Record<string, any>)
      .filter((u: any) => u.side === 'P1').map((u: any) => `${u.pos.x},${u.pos.y}`) as string[],
  } : null;
});

let stg = await stage();
if (stg?.phase !== 'deploying') fail(`출전 뒤 배치 단계가 아니다 (${stg?.phase} / ${stg?.engine})`);
if (stg.hidden) fail('배치 단계인데 배치 패널이 숨겨져 있다');
// 상대(AI)는 기다릴 것이 없으므로 곧바로 준비를 마친다 — 「매칭 대기」가 눈에 안 보인다
if (!stg.ready['P2']) fail('AI가 준비를 마치지 않았다 — 배치에서 멈춘다');
if (stg.ready['P1']) fail('내가 준비를 누르지도 않았는데 준비 상태다');
// 배치 30초 · 정찰 30초 (2026-08-04 조정) — 배치가 길면 판이 늘어진다
if (!stg.remain || stg.remain > 30) fail(`배치 제한시간이 이상하다: ${stg.remain} (30초여야 한다)`);

/*
 * **배치 프리셋이 실제로 깔렸는가** (E · §5-14). 저장은 됐는데 전투에 안 실리면
 * 화면에는 「어라, 기본 배치네」로만 보인다 — 규칙 테스트로는 잡히지 않는 자리다.
 * 프리셋은 「초기값」이지 「확정」이 아니라, 아래에서 그대로 한 칸 옮겨 본다.
 */
{
  const want = [...squadPlan.deploy].map((c) => `${c.x},${c.y}`).sort().join(' ');
  const got = [...stg.mine].sort().join(' ');
  if (want !== got) fail(`저장한 배치가 안 깔렸다 — 저장 [${want}] / 판 [${got}]`);
  console.log(`✓ 배치 프리셋 적용 — [${got}] (전투 시작 때 이대로 깔린다)`);
}
console.log(`✓ 배치 단계 — 남은 ${stg.remain}초, 버튼 "${stg.button}", 내 기물 [${stg.mine.join(' ')}]`);
// 배치·정찰은 전투와 **다른 곡**이다. 화면은 그 경계를 모르고 단계만 안다
await expectBgm('prep', '배치·정탐');

// 내 기물을 골라 진영 안 다른 칸으로 옮긴다
const placedBefore = stg.mine.join(' ');
const spot = await page.evaluate(() => {
  const pb = (window as any).__battle.scene.debugPlayback;
  const u = Object.values(pb.state.units as Record<string, any>).find((x: any) => x.side === 'P1') as any;
  /*
   * **옮길 자리는 배치 구역 안이어야 한다.** 예전에는 `y - 2`였는데, E의 배치
   * 프리셋이 기물을 구역 맨 윗줄로 옮겨 두자 목적지가 **구역 밖**이 되어 엔진이
   * 거부했다 — 화면에서는 「안 옮겨진다」로만 보인다. 한 칸씩만 움직인다.
   */
  return {
    from: { x: u.pos.x, y: u.pos.y },
    to: { x: u.pos.x + 1, y: u.pos.y < 19 ? u.pos.y + 1 : u.pos.y - 1 },
  };
});
const cell = (x: number, y: number) => page.evaluate(([px, py]) => {
  const sc = (window as any).__battle.scene;
  const r = (sc.game.canvas as HTMLCanvasElement).getBoundingClientRect();
  const v = sc.cameras.main.worldView;
  return {
    x: r.left + ((px * 96 + 48 - v.x) / v.width) * r.width,
    y: r.top + ((py * 120 + 60 - v.y) / v.height) * r.height,
  };
}, [x, y]);

let at = await cell(spot.from.x, spot.from.y);
await page.mouse.click(at.x, at.y);
await page.waitForTimeout(200);
// 고르면 진영 안 빈 칸이 칠해진다 (엔진의 배치 구역과 같은 자리)
if (await page.evaluate(() => (window as any).__battle.scene.debugMarkCommands()) === 0) {
  fail('기물을 골라도 배치 가능한 칸이 표시되지 않는다');
}
at = await cell(spot.to.x, spot.to.y);
await page.mouse.click(at.x, at.y);
await page.waitForTimeout(300);

stg = await stage();
if (stg!.mine.join(' ') === placedBefore) fail(`배치에서 기물이 옮겨지지 않았다: ${placedBefore}`);
console.log(`✓ 배치 이동 — [${placedBefore}] → [${stg!.mine.join(' ')}]`);

// 준비완료 → 정찰
await page.click('.prep-go');
await page.waitForTimeout(400);
stg = await stage();
if (stg?.phase !== 'scouting') fail(`준비완료 뒤 정찰이 아니다 (${stg?.phase} / ${stg?.engine})`);
if (!stg.ready['P1']) fail('준비완료를 눌렀는데 ready가 서지 않았다');
if (!stg.remain || stg.remain > 30) fail(`정찰 제한시간이 이상하다: ${stg.remain} (30초여야 한다)`);
// 정찰은 끝까지 세되 마지막 5초만 숫자를 보여준다 (GDD §3.9)
const clockShown = await page.evaluate(() => document.querySelector('.prep-clock')?.textContent ?? '');
if (clockShown !== '') fail(`정찰 초반에는 카운트다운을 숨겨야 한다: "${clockShown}"`);
console.log(`✓ 정찰 단계 — 남은 ${stg.remain}초, 버튼 "${stg.button}" (카운트다운은 마지막 5초부터)`);

// 전투 시작
await page.click('.prep-go');
await page.waitForTimeout(1500);
stg = await stage();
if (stg?.engine === 'scout' || stg?.engine === 'deploy') fail(`전투가 시작되지 않았다 (${stg?.engine})`);
if (!stg!.hidden) fail('전투가 시작됐는데 배치 패널이 남아 있다');
console.log(`✓ 전투 시작 — ${stg!.phase} / ${stg!.engine}`);
await expectBgm('battle', '전투');

const battle = await page.evaluate(() => {
  const scene = (window as any).__battle?.scene;
  const state = scene?.debugPlayback?.state;
  return state ? {
    mode: state.mode as string,
    units: Object.keys(state.units).length,
    mine: Object.values(state.units as Record<string, any>).filter((u: any) => u.side === 'P1').map((u: any) => u.officer),
    board: !!document.getElementById('board'),
  } : null;
});
if (!battle) fail('출전했는데 전투가 뜨지 않는다');
if (battle.units !== 6) fail(`3v3인데 유닛이 ${battle.units}개다`);
if (!battle.board) fail('전투 화면의 판 자리가 없다');
console.log(`✓ 전투 진입 — ${battle.mode}, 유닛 ${battle.units} (내 편성 ${battle.mine.join(', ')})`);

/*
 * 참가비가 **얼마 나갔는지는 위에서 이미 봤다** ([전투준비] 앞뒤로 10 → 7).
 * 여기서는 아래 「결과가 계정에 반영되는가」의 기준값으로만 들고 간다 —
 * 예전에는 `20 → 17`을 여기서 못박고 있었는데, 그것은 **새 계정의 상한(20)에서
 * 시작한다**는 말없는 전제였다. 군량을 갈아 끼우는 검사가 생기자 곧바로 깨졌다.
 */
const grain = await page.evaluate(() => JSON.parse(localStorage.getItem('samchess.profile.v1') ?? '{}').grain);
if (grain !== grainAtReady - 3) fail(`참가비가 어긋난다 — ${grainAtReady} → ${grain}`);

// ── 항복 → 결과 화면 → 계정 반영 (pptx 45쪽 보상표 · C1) ────────
//
// 전투를 끝까지 두면 몇 분이 걸리므로 **항복으로 끊는다.** 여기서 보는 것은 승패가
// 아니라 **잇는 자리**다 — 엔진이 낸 결말이 보상표를 지나 계정에 남는가. 규칙 자체는
// `npm test`가 열두 조합으로 보고, 화면이 그 둘을 잇지 못하는 것은 여기서만 잡힌다.
{
  page.on('dialog', (d) => { void d.accept(); });    // 「항복하시겠습니까?」

  // **내 차례가 아니면 항복도 못 낸다** — `Playback.submit()`이 `awaitingInput`이
  // 아닌 의도를 조용히 버린다(연출 중에도 마찬가지다). 화면의 [항복]은 그때도
  // 눌리는데 아무 일이 없어, 고정 대기로 눌렀다가 「결과가 안 뜬다」로 보였다.
  await page.waitForFunction(() => {
    const pb = (window as any).__battle?.scene?.debugPlayback;
    return pb?.phase === 'awaitingInput';
  }, undefined, { timeout: 30_000 }).catch(() => fail('30초를 기다려도 내 차례가 오지 않는다'));

  await page.click('.hud-more');
  await page.waitForTimeout(250);
  await page.click('[data-action="surrender"]');
  // **곧바로 끝나지 않는다** — 판은 자기가 설명하는 것을 기다린다(`systemLog.timeToDrain()`).
  // 밀린 말풍선이 많을수록 길어지므로 고정 대기는 어쩌다 한 번 실패한다
  await page.waitForSelector('[data-screen="result"]', { timeout: 20_000 })
    .catch(() => fail('항복했는데 결과 화면이 안 뜬다 (20초)'));
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const scr = document.querySelector('[data-screen="result"]') as HTMLElement | null;
    if (!scr) return null;
    const p = JSON.parse(localStorage.getItem('samchess.profile.v1')!);
    const cells = Object.values(p.roster as Record<string, { record: Record<string, {
      plays: number; losses: number;
    }> }>).flatMap((inst) => Object.entries(inst.record));
    return {
      kind: scr.dataset.result,
      grain: scr.querySelector('[data-field="grain"]')?.textContent?.trim() ?? '',
      card: scr.querySelector('[data-field="card"]')?.textContent?.trim() ?? '',
      chance: scr.querySelector('[data-field="chance"]')?.getAttribute('data-chance') ?? '',
      cells,
      matches: (p.matches as {
        opponent: string; result: string; myPower: number; chance: number;
        mySquad: string | null; theirSquad: string | null;
      }[]),
      seq: p.matchSeq as number,
      grainSaved: p.grain as number,
    };
  });
  if (!result) fail(`항복했는데 결과 화면이 뜨지 않는다 — 콘솔 [${errors.join(' | ')}]`);
  if (result!.kind !== 'lose') fail(`항복은 패배다 — 결과가 「${result!.kind}」다`);
  // 패배도 승리와 같은 양의 군량을 받는다 (2026-08-18 보상표). 3v3이므로 +1
  if (result!.grain !== '+1') fail(`패배 군량이 「${result!.grain}」다 (3v3은 +1)`);
  if (result!.card !== '없음') fail(`패배에 카드가 나왔다: "${result!.card}"`);
  if (!(Number(result!.chance) > 0)) fail('예상 승률이 결과 화면에 없다 (§5-23)');
  if (result!.grainSaved !== grain + 1) fail(`군량이 계정에 안 들어갔다 — ${grain} → ${result!.grainSaved}`);

  // 전적은 **기물별 × 모드별 × 상대별**로 남는다 (저장 형식 v3). 3v3 AI 세 자리
  if (result!.cells.length !== 3) fail(`전적 칸이 셋이 아니다: ${JSON.stringify(result!.cells)}`);
  for (const [key, cell] of result!.cells) {
    if (!/^ai\/3v3\/(King|Rock|Bishop|Knight|Queen|Pawn)$/.test(key)) fail(`전적 키가 이상하다: ${key}`);
    if (cell.plays !== 1 || cell.losses !== 1) fail(`${key} 칸이 다르다: ${JSON.stringify(cell)}`);
  }
  // 이력 한 줄 — AI도 남긴다(2026-08-18). 「세지 않는다」로 되돌아가면 여기서 깨진다
  if (result!.matches.length !== 1) fail(`이력이 한 줄이 아니다 — ${result!.matches.length}줄`);
  const row = result!.matches[0]!;
  if (row.opponent !== 'ai' || row.result !== 'lose') fail(`이력 줄이 다르다: ${JSON.stringify(row)}`);
  // C1이 열만 열어 둔 칸을 E가 채운다. **상대 부대는 여전히 비어 있다** — AI에게는 부대가 없다
  if (row.mySquad !== squadPlan.name) fail(`이력의 내 부대 이름이 비었다 — ${JSON.stringify(row.mySquad)}`);
  if (row.theirSquad !== null) fail(`AI 상대인데 부대 이름이 있다 — ${JSON.stringify(row.theirSquad)}`);
  if (!(row.myPower > 0) || !(row.chance > 0)) fail(`전투력·예상 승률이 안 남았다: ${JSON.stringify(row)}`);
  if (result!.seq !== 2) fail(`줄 번호가 안 올랐다: ${result!.seq}`);
  console.log(`✓ 결과 반영 — 패배 · 군량 ${grain} → ${result!.grainSaved} · 전적 ${result!.cells.length}칸(${result!.cells[0]![0]}) · 이력 1줄(예상 ${Math.round(row.chance * 100)}%)`);
}

// ── 궁궐 → 장수 일람 → 상세 → 레벨업 (pptx 37·38쪽 · GDD §4.2·§4.3) ──

/*
 * **검사는 글자가 아니라 `data-*`로 건다.** 「적 책략은 가린다」를 「적군」이라는
 * 글자로 골라내고 있다가 그 글자를 빼자 검사가 조용히 통과하게 됐던 자리다
 * (2026-08-13). 여기서도 열 이름·정렬 이름은 다국어로 바뀔 수 있다.
 */

/** 새로고침하면 늘 간판부터다 — 「게임 URL로 들어오면 가장 먼저 보이는 화면」이 기획이다 */
const reenter = async (): Promise<void> => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.click('.scr-title [data-action="enter"]');
  await page.waitForTimeout(300);
};
const toPalace = async (): Promise<void> => {
  await page.click('.scr-main [data-place="palace"]');
  await page.waitForTimeout(300);
};

await reenter();
await toPalace();
await expectBackdrop('.scr-place', 'place-1-palace.jpg', '궁궐');

// 37쪽의 두 갈래. **[도시 관리]는 C2(41쪽)가 열었다** — 잠겨 있으면 그게 회귀다
const palace = await page.evaluate(() => ({
  officers: !!document.querySelector('.scr-place [data-action="officers"]'),
  city: !!document.querySelector('.scr-place [data-action="city"]'),
  cityLocked: (document.querySelector('.scr-place [data-action="city"]') as HTMLButtonElement | null)?.disabled ?? false,
}));
if (!palace.officers) fail('궁궐에 [장수 일람]이 없다');
if (!palace.city) fail('궁궐에 [도시 관리] 자리가 없다 (37쪽)');
if (palace.cityLocked) fail('[도시 관리]가 안 눌린다 — C2가 연 화면이다 (41쪽)');
console.log('✓ 궁궐 — [장수 일람] · [도시 관리]');

await page.click('[data-action="officers"]');
await page.waitForTimeout(300);
if (!await page.$('[data-screen="officer-list"]')) fail('장수 일람이 뜨지 않는다');

/** 지금 표에 보이는 줄들 — 이름과 능력치 셋 */
const listRows = () => page.evaluate(() =>
  [...document.querySelectorAll('.ofc-rows .ofc-row')].map((el) => ({
    officer: (el as HTMLElement).dataset.officer!,
    name: el.querySelector('.c-nm')?.textContent ?? '',
    stats: [...el.querySelectorAll('.c-st')].map((s) => Number(s.textContent)),
    flag: (el as HTMLElement).dataset.levelup === '1',
  })));

let rows = await listRows();
// 초기 지급은 S·A·B·C·D 각 1명 (GDD §8)
if (rows.length !== 5) fail(`일람에 다섯 줄이 있어야 한다 — 지금 ${rows.length}줄`);
const tally = await page.getAttribute('.ofc-tally', 'data-tally');
if (tally !== 'N/1/1/1/1/1') fail(`요약 줄이 「[E]:N [S]:1 [A]:1 [B]:1 [C]:1 [D]:1」이 아니다: ${tally}`);
if (rows.some((r) => r.flag)) fail('카드가 없는데 레벨업 Flag가 켜져 있다');
console.log(`✓ 장수 일람 — ${rows.length}줄, 요약 ${tally}, Flag 전부 꺼짐`);

// 정렬 — 무력순은 높은 쪽이 위다 (37쪽 「무력/지력/통솔력 sorting」)
await page.click('[data-sort="might"]');
await page.waitForTimeout(150);
rows = await listRows();
for (let n = 1; n < rows.length; n++) {
  if (rows[n - 1]!.stats[0]! < rows[n]!.stats[0]!) {
    fail(`무력 정렬이 어긋난다: ${rows.map((r) => `${r.name}(${r.stats[0]})`).join(' ')}`);
  }
}
console.log(`✓ 정렬(무력) — ${rows.map((r) => `${r.name} ${r.stats[0]}`).join(' · ')}`);

// 검색 — 이름 부분일치. 어느 장수가 지급됐는지는 시드가 정하므로 **한 줄에서 뽑아** 쓴다
await page.click('[data-sort="name"]');
await page.waitForTimeout(100);
const target = (await listRows())[0]!;
await page.fill('[data-field="search"]', target.name);
await page.waitForTimeout(150);
rows = await listRows();
if (!rows.some((r) => r.officer === target.officer)) fail(`「${target.name}」를 검색했는데 안 나온다`);
if (rows.length !== 1) fail(`「${target.name}」 검색에 ${rows.length}줄이 나왔다`);
await page.fill('[data-field="search"]', '없는이름');
await page.waitForTimeout(150);
if ((await listRows()).length !== 0) fail('없는 이름을 검색했는데 줄이 남는다');
await page.fill('[data-field="search"]', '');
await page.waitForTimeout(150);
console.log(`✓ 검색 — 「${target.name}」 1줄, 없는 이름 0줄`);

// 상세 (38쪽)
await page.click(`.ofc-row[data-officer="${target.officer}"]`);
await page.waitForTimeout(250);
const detail = await page.evaluate(() => {
  const scr = document.querySelector('[data-screen="officer-detail"]');
  if (!scr) return null;
  return {
    officer: (scr as HTMLElement).dataset.officer!,
    name: scr.querySelector('.ofc-who .nm')?.textContent?.trim() ?? '',
    stats: scr.querySelector('[data-field="stats"]')?.textContent?.trim() ?? '',
    skill: !!scr.querySelector('[data-action="skill"]'),
    // 「전적 보기」는 C1(40쪽)이 열었다 — 잠겨 있으면 안 된다
    recordsLocked: (scr.querySelector('[data-action="records"]') as HTMLButtonElement).disabled,
    record: scr.querySelector('[data-field="record"]')?.textContent?.trim() ?? '',
    // 인물 서사는 G1이 채운다 — 지금은 **줄째로 없어야** 한다
    story: !!scr.querySelector('[data-field="story"]'),
  };
});
if (!detail) fail('일람에서 줄을 눌렀는데 상세가 뜨지 않는다');
if (detail!.officer !== target.officer) fail(`다른 장수의 상세가 떴다: ${detail!.officer}`);
// 「HP, MP, 공격력(최소-최대)」 — AT는 매 타격 내림이라 범위여야 한다 (GDD §4.2)
if (!/AT:\s*\d+-\d+/.test(detail!.stats)) fail(`AT가 범위 표기가 아니다: "${detail!.stats}"`);
if (detail!.recordsLocked) fail('[전적 보기]가 잠겨 있다 — C1(40쪽)이 열었어야 한다');
if (detail!.story) fail('인물 서사가 비었는데 줄이 남아 있다 — 없으면 줄째로 물러나야 한다');
// 무승부가 생겼으므로 「무」 자리가 있어야 한다 (v3). 어느 장수가 열릴지는 시드가
// 정하므로 **숫자를 못 박지 않는다** — 앞의 항복 한 판이 누구에게 붙었는지에 달렸다
if (!/\d+전 \d+승 \d+무 \d+패 · \d+처치/.test(detail!.record)) fail(`전적 요약이 v3 모양이 아니다: "${detail!.record}"`);
console.log(`✓ 상세 — ${detail!.name} / ${detail!.stats} / ${detail!.record}`);

// 고유기술 팝업 (38쪽 아래). 지급이 S·A·B급을 포함하므로 기술이 있는 장수가 반드시 있다
{
  let holder = detail!.skill ? target : null;
  if (!holder) {
    // 지금 열린 장수에 기술이 없으면 일람으로 돌아가 하나씩 열어 본다 (C·D급 134명)
    await page.click('[data-action="list"]');
    await page.waitForTimeout(200);
    for (const r of await listRows()) {
      await page.click(`.ofc-row[data-officer="${r.officer}"]`);
      await page.waitForTimeout(200);
      if (await page.$('[data-action="skill"]')) { holder = r; break; }
      await page.click('[data-action="list"]');
      await page.waitForTimeout(150);
    }
  }
  if (!holder) fail('고유기술을 가진 장수가 하나도 없다 — 초기 지급에 S·A·B가 들어간다');
  await page.click('[data-action="skill"]');
  await page.waitForTimeout(200);
  const popup = await page.evaluate(() => {
    const m = document.querySelector('[data-modal="skill"]');
    return m ? {
      effect: m.querySelector('[data-field="effect"]')?.textContent?.trim() ?? '',
      origin: !!m.querySelector('[data-field="origin"]'),
    } : null;
  });
  if (!popup) fail('고유기술을 눌렀는데 팝업이 뜨지 않는다');
  if (!popup!.effect) fail('기술 효과가 비어 있다');
  if (popup!.origin) fail('기술 유래가 비었는데 줄이 남아 있다 — G1이 채울 자리다');
  await page.click('[data-modal="skill"] [data-action="close"]');
  await page.waitForTimeout(150);
  if (await page.$('[data-modal="skill"]')) fail('기술 팝업이 닫히지 않는다');
  console.log(`✓ 고유기술 팝업 — ${holder!.name} · 효과 있음 · 유래 자리만`);
}

// ── 레벨/스킬 관리 · 재설계 (pptx 39쪽 · GDD §4.2·§4.3) ──────────
//
// 39쪽부터 레벨업이 **두 걸음**이다 — [레벨 업]이 「고르기」를 열고 거기서 [확정]을
// 눌러야 오른다. 화면 골격이 바뀌면 스모크의 경로도 함께 고친다(2026-08-15에
// 간판 화면을 넣고 이 파일이 통째로 막혔던 자리다).

await page.click('[data-action="levels"]');
await page.waitForTimeout(250);
if (!await page.$('[data-screen="levelup"]')) fail('[레벨/스킬 관리]를 눌렀는데 화면이 안 바뀐다');
const who = await page.getAttribute('[data-screen="levelup"]', 'data-officer');
const before = (await page.textContent('[data-screen="levelup"] .ofc-who .nm'))?.trim() ?? '';

/** 관리 화면이 내보내는 것 — 걸음 · 성장 스택 길이 · 스탯 찍은 횟수 */
const lvState = async () => await page.evaluate(() => {
  const scr = document.querySelector('[data-screen="levelup"]') as HTMLElement | null;
  return scr ? {
    step: scr.dataset.step ?? '',
    growth: Number(scr.dataset.growth ?? -1),
    taps: scr.querySelector('.lv-taps')?.getAttribute('data-taps') ?? '',
    name: scr.querySelector('.ofc-who .nm')?.textContent?.trim() ?? '',
  } : null;
});

// 개발용 카드 지급 — AI 대전이 카드를 주지 않아 성장을 시험할 길이 없어서 둔 문.
// **두 번 누른다** — Lv1→Lv2가 3장이라 5장이면 올린 뒤 2장만 남아 Flag가 다시 꺼진다.
// 10장이면 7장이 남아 Lv2→Lv3(5장)이 되므로, 아래에서 Flag가 켜지는 것까지 볼 수 있다.
await page.click('[data-dev="cards"]');
await page.waitForTimeout(150);
await page.click('[data-dev="cards"]');
await page.waitForTimeout(200);
if (!await page.isEnabled('[data-action="levelUp"]')) {
  fail('카드를 채웠는데 레벨업이 잠겨 있다 — 레벨업에 실패는 없다(2026-08-04 확정)');
}

const start = await lvState();
if (start!.taps !== '0/0/0') fail(`Lv1인데 스탯 찍은 횟수가 0이 아니다: ${start!.taps}`);

// [레벨 업] → 「고르기」. **아직 오르지 않았다** — 확정 전에 프로필이 바뀌면 안 된다
await page.click('[data-action="levelUp"]');
await page.waitForTimeout(250);
const picking = await lvState();
if (picking!.step !== 'levelup') fail(`[레벨 업]을 눌렀는데 고르기로 안 간다: ${picking!.step}`);
if (picking!.growth !== start!.growth) fail('고르기를 열었을 뿐인데 성장 스택이 늘었다');

// 39쪽의 증분 미리보기 — **고른 줄만 증분이 붙는다.** `+5`를 화면이 손으로 적으면
// 엑셀의 statChoices가 바뀌었을 때 표시만 어긋난다(`AT +1`이 실제로 그랬다)
const preview = await page.evaluate(() =>
  [...document.querySelectorAll('.lv-stat')].map((el) => ({
    stat: (el as HTMLElement).dataset.stat!,
    add: (el as HTMLElement).dataset.add!,
    on: el.classList.contains('on'),
    now: el.querySelector('.c-now')?.textContent ?? '',
    next: el.querySelector('.c-next')?.textContent ?? '',
  })));
if (preview.length !== 3) fail(`물리 성장이 세 줄이 아니다 — ${preview.length}줄`);
const hpRow = preview.find((r) => r.stat === 'hp')!;
if (!hpRow.on || hpRow.add === '0') fail(`고른 줄에 증분이 없다: ${JSON.stringify(hpRow)}`);
if (preview.filter((r) => r.add !== '0').length !== 1) fail('고르지 않은 줄에도 증분이 붙었다');
// AT는 언제나 범위다 (GDD §4.2 — 매 타격 내림이라 `2.5`는 평타 2 · 크리티컬 5)
const atRow = preview.find((r) => r.stat === 'at')!;
if (!/^\d+-\d+$/.test(atRow.now)) fail(`AT가 범위 표기가 아니다: "${atRow.now}"`);

// 책략 설명이 **비어 있지 않다** — 둘 중 하나를 고르는 판단 근거다
await page.click('[data-school="illusion"]');
await page.waitForTimeout(150);
const desc = (await page.textContent('[data-field="tacticDesc"]'))?.trim() ?? '';
if (desc.length < 10) fail(`책략 설명이 비어 있다: "${desc}"`);

await page.click('[data-action="confirm"]');
await page.waitForTimeout(300);

const grown = await lvState();
if (grown!.step !== 'manage') fail('확정했는데 관리 화면으로 안 돌아온다');
if (grown!.growth !== start!.growth + 1) fail(`성장 스택이 한 걸음 늘지 않았다: ${grown!.growth}`);
if (grown!.taps !== '1/0/0') fail(`HP를 찍었는데 횟수가 안 맞는다: ${grown!.taps}`);
const after = grown!.name;
if (before === after) fail(`레벨업했는데 표시가 그대로다: "${before}"`);
const tactics = await page.evaluate(() => document.querySelectorAll('[data-screen="levelup"] .lv-owned .chip').length);
if (tactics === 0) fail('레벨업했는데 책략을 배우지 않았다 (능력 택1 + 책략 택1)');
console.log(`✓ 레벨업 — ${before} → ${after}, 책략 ${tactics}종, 찍은 횟수 ${grown!.taps}`);

// ── 재설계(둔갑천서) — **쓴 카드를 돌려주고 Lv1로 되감는다** ─────
//
// 「레벨 유지 + 다시 고르기」에서 「되감기」로 바뀌었다(2026-08-17 기획자 확정).
// 되돌려주는 양이 정확히 누적 필요분이라 **다시 올리면 카드가 딱 떨어진다** —
// 그게 이 규칙의 핵심이고, 화면까지 그렇게 도는지는 여기서만 볼 수 있다.
{
  /** 저장된 그 장수의 카드 수 — 화면 글자가 아니라 저장분에서 읽는다 */
  const cardsOf = async () => await page.evaluate((id: string) =>
    JSON.parse(localStorage.getItem('samchess.profile.v1') ?? '{}').cards?.[id] ?? 0, who!);

  if (await page.isEnabled('[data-action="respec"]')) fail('금화가 0인데 재설계가 열린다');
  await page.click('[data-dev="gold"]');
  await page.waitForTimeout(200);
  if (!await page.isEnabled('[data-action="respec"]')) fail('둔갑천서를 샀는데 재설계가 잠겨 있다');

  const heldBefore = await cardsOf();

  // 확인 팝업 — **되돌릴 수 없고 값이 나가는 한 수**라 한 번 묻는다.
  // 「있는가」가 아니라 「제자리에 있는가」를 본다 — 배경 위의 팝업이 내용 맨 아래에
  // 흘러 붙었던 자리다(2026-08-17, A). `.scr-dim > *`가 absolute를 덮는다.
  await page.click('[data-action="respec"]');
  await page.waitForTimeout(250);
  const modal = await page.evaluate(() => {
    const m = document.querySelector('[data-modal="respec"]') as HTMLElement | null;
    const frame = document.querySelector('#frame') as HTMLElement | null;
    if (!m || !frame) return null;
    const a = m.getBoundingClientRect(), b = frame.getBoundingClientRect();
    return {
      what: m.querySelector('[data-field="respecWhat"]')?.textContent?.trim() ?? '',
      // 팝업이 프레임을 덮고 있는가 (흐름대로 맨 아래에 붙으면 훨씬 작고 아래에 있다)
      covers: Math.abs(a.top - b.top) < 4 && Math.abs(a.height - b.height) < 4,
    };
  });
  if (!modal) fail('[재설계]를 눌렀는데 확인 팝업이 안 뜬다');
  if (!modal!.covers) fail('재설계 확인 팝업이 화면을 덮지 않는다 — 내용 맨 아래에 흘러 붙었다');
  if (!/카드\s*3장/.test(modal!.what)) fail(`돌려받을 카드 수가 안 적혀 있다: "${modal!.what}"`);

  // 「그만두기」로 나가면 아무 일도 없어야 한다
  await page.click('[data-modal="respec"] [data-action="close"]');
  await page.waitForTimeout(200);
  if (await page.$('[data-modal="respec"]')) fail('그만두기를 눌렀는데 팝업이 안 닫힌다');
  if ((await lvState())!.taps !== '1/0/0') fail('그만두기를 눌렀는데 성장이 바뀌었다');
  if (await cardsOf() !== heldBefore) fail('그만두기를 눌렀는데 카드가 바뀌었다');

  // 이번엔 확정
  await page.click('[data-action="respec"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="respecConfirm"]');
  await page.waitForTimeout(350);
  const reset = await lvState();
  if (reset!.step !== 'manage') fail('재설계했는데 관리 화면이 아니다');
  if (reset!.growth !== 0) fail(`재설계했는데 성장 스택이 남았다: ${reset!.growth}`);
  if (reset!.taps !== '0/0/0') fail(`재설계했는데 찍은 횟수가 남았다: ${reset!.taps}`);
  if (reset!.name !== before) fail(`Lv1로 안 돌아갔다: "${before}" 기대, "${reset!.name}"`);
  // Lv1→Lv2에 3장이 들었으니 정확히 3장이 돌아와야 한다 (GDD §4.3)
  const heldAfter = await cardsOf();
  if (heldAfter !== heldBefore + 3) fail(`카드를 3장 돌려받지 않았다 — ${heldBefore} → ${heldAfter}`);
  console.log(`✓ 재설계 — ${after} → ${reset!.name}, 카드 ${heldBefore} → ${heldAfter}장 (쓴 만큼 돌아왔다)`);

  // **되감은 뒤에는 정상 레벨업 절차 그대로다** — 재설계 전용 절차가 없다는 것이 요점이다
  if (!await page.isEnabled('[data-action="levelUp"]')) fail('돌려받은 카드로 다시 올릴 수 없다');
  await page.click('[data-action="levelUp"]');
  await page.waitForTimeout(250);
  await page.click('[data-stat="hp"]');
  await page.waitForTimeout(120);
  await page.click('[data-action="confirm"]');
  await page.waitForTimeout(300);
  const again = await lvState();
  if (again!.name !== after) fail(`다시 올렸는데 레벨이 다르다: "${after}" 기대, "${again!.name}"`);
  if (again!.taps !== '1/0/0') fail(`다시 올린 성장이 안 맞는다: ${again!.taps}`);
  console.log(`✓ 되감은 뒤 재성장 — ${again!.name}, 찍은 횟수 ${again!.taps} (절차는 레벨업 하나뿐)`);
}

// 레벨업 Flag가 일람까지 돌아오는가 — 카드가 남아 있으면 ON이다 (37쪽)
await page.click('[data-screen="levelup"] [data-action="back"]');
await page.waitForTimeout(200);
await page.click('[data-action="list"]');
await page.waitForTimeout(250);
const back = await listRows();
const flagged = back.find((r) => r.officer === who);
if (!flagged) fail(`일람으로 돌아왔는데 ${who}가 없다`);
// 카드가 다음 레벨분만큼 남아 있으므로 켜져야 한다 (37쪽 「보유하고 있다면 ON」)
if (!flagged!.flag) fail(`${flagged!.name}는 카드가 남았는데 레벨업 Flag가 꺼져 있다`);
if (back.filter((r) => r.flag).length !== 1) fail('카드를 준 장수 말고도 Flag가 켜져 있다');
console.log(`✓ 일람 복귀 — ${flagged!.name} 레벨업 Flag ON (다른 넷은 OFF)`);

// ── 저장 (온라인이 붙으면 이 자리가 서버 API가 된다) ───────────

await reenter();
if (await page.$('.scr-new')) fail('새로고침했더니 계정이 사라졌다');
await toPalace();
await page.click('[data-action="officers"]');
await page.waitForTimeout(300);
await page.click(`.ofc-row[data-officer="${who}"]`);
await page.waitForTimeout(250);
const kept = (await page.textContent('[data-screen="officer-detail"] .ofc-who .nm'))?.trim() ?? '';
if (kept !== after) fail(`새로고침 뒤 상태가 다르다: "${after}" → "${kept}"`);
console.log(`✓ 저장 유지 — ${kept}`);

// ── 옛 저장분(v1)을 실제로 되접는가 ★ (2026-08-17, 저장 형식 v2) ──
//
// `migrateProfile()` 자체는 `npm test`가 조목조목 본다. **여기서 보는 것은 다른 것이다** —
// `loadProfile()`이 그 함수를 실제로 부르는가. 예전에는 버전이 다르면 곧바로 `null`이라
// 계정을 통째로 버렸는데, 그 줄이 되살아나도 단위 테스트는 아무 말도 하지 않는다.
{
  const v1 = await page.evaluate((lv2: string) => {
    const KEY = 'samchess.profile.v1';
    const now = JSON.parse(localStorage.getItem(KEY)!);
    // 지금 프로필을 **v1 모양으로 되돌려** 넣는다 — 평면 배열 둘 + version 1
    const roster: Record<string, unknown> = {};
    for (const [id, inst] of Object.entries(now.roster as Record<string, {
      level: number; growth: { stat: string; tactics: string[] }[]; record: unknown;
    }>)) {
      roster[id] = {
        officer: id,
        level: inst.level,
        statPicks: inst.growth.map((s) => s.stat),
        tactics: inst.growth.flatMap((s) => s.tactics),
        record: inst.record,
      };
    }
    const old = { ...now, version: 1, roster };
    localStorage.setItem(KEY, JSON.stringify(old));
    return { level: old.roster[lv2] ? (old.roster[lv2] as { level: number }).level : 0, cityName: old.cityName };
  }, who!);

  await reenter();
  if (await page.$('.scr-new')) fail('v1 저장분을 만나자 계정을 버렸다 — 되접어야 한다');
  await toPalace();
  await page.click('[data-action="officers"]');
  await page.waitForTimeout(300);
  const rebuilt = await listRows();
  if (rebuilt.length !== 5) fail(`되접은 뒤 장수가 ${rebuilt.length}명이다 (기대 5명)`);
  await page.click(`.ofc-row[data-officer="${who}"]`);
  await page.waitForTimeout(250);
  const folded = (await page.textContent('[data-screen="officer-detail"] .ofc-who .nm'))?.trim() ?? '';
  if (folded !== after) fail(`v1을 되접었더니 레벨이 달라졌다: "${after}" → "${folded}"`);
  const kind = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('samchess.profile.v1')!).version);
  if (kind !== 3) fail(`되접은 뒤에도 version이 ${kind}다 — 저장까지 올라와야 한다`);
  console.log(`✓ v1 되접기 — ${v1.cityName} · 장수 ${rebuilt.length}명 · ${folded} (Lv${v1.level} 유지) · version 1 → ${kind}`);
}

// ── 옛 저장분(v2)을 실제로 되접는가 ★ (2026-08-18, 저장 형식 v3) ──
//
// v1 때와 **같은 이유로** 여기에 있다 — 단위 테스트는 `migrateProfile()`이 옳은지만
// 알고 `loadProfile()`이 그걸 부르는지는 모른다. v3는 전적의 **뜻이** 바뀐 판이라
// (평평한 `{wins,losses,kills}` → 기물 × 모드 × 상대 교차) 옛 값은 버리는데,
// **계정까지 버리면 안 된다.**
{
  await page.evaluate(() => {
    const KEY = 'samchess.profile.v1';
    const now = JSON.parse(localStorage.getItem(KEY)!);
    const roster: Record<string, unknown> = {};
    for (const [id, inst] of Object.entries(now.roster as Record<string, object>)) {
      roster[id] = { ...inst, record: { wins: 5, losses: 2, kills: 9 } };   // v2의 평평한 전적
    }
    const old = { ...now, version: 2, roster };
    delete old.record; delete old.matches; delete old.matchSeq;
    localStorage.setItem(KEY, JSON.stringify(old));
  });

  await reenter();
  if (await page.$('.scr-new')) fail('v2 저장분을 만나자 계정을 버렸다 — 되접어야 한다');
  await toPalace();
  await page.click('[data-action="officers"]');
  await page.waitForTimeout(300);
  const kept = await listRows();
  if (kept.length !== 5) fail(`v2를 되접은 뒤 장수가 ${kept.length}명이다 (기대 5명)`);
  const folded = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('samchess.profile.v1')!);
    const insts = Object.values(p.roster) as { record: Record<string, unknown> }[];
    return {
      version: p.version as number,
      cells: insts.reduce((n, i) => n + Object.keys(i.record).length, 0),
      matches: Array.isArray(p.matches) ? p.matches.length : -1,
      seq: p.matchSeq as number,
    };
  });
  if (folded.version !== 3) fail(`v2를 되접었는데 version이 ${folded.version}다`);
  if (folded.cells !== 0) fail(`기물도 모드도 모르는 옛 전적이 칸에 들어갔다 (${folded.cells}칸)`);
  if (folded.matches !== 0 || folded.seq !== 1) fail(`이력 자리가 초기화되지 않았다: ${JSON.stringify(folded)}`);
  console.log(`✓ v2 되접기 — 장수 ${kept.length}명 유지 · version 2 → 3 · 옛 평평한 전적은 0에서 시작`);
}

// ── 전적 관리 화면 (pptx 40쪽) ★ C1이 연 자리 ────────────────────
//
// 전투를 끝까지 돌리려면 몇 분이 걸리므로, **저장분에 전적을 심어 놓고** 화면이
// 그것을 옳게 펴는지만 본다. 여기서 보는 것은 규칙이 아니라 **화면의 산수**다 —
// 「기물별 합 = 총합」은 `npm test`가 이미 보지만, 화면이 필터를 한쪽에만 걸어
// 표와 요약이 어긋나는 것은 여기서만 잡힌다.
{
  await page.evaluate((id: string) => {
    const KEY = 'samchess.profile.v1';
    const p = JSON.parse(localStorage.getItem(KEY)!);
    p.roster[id].record = {
      'online/3v3/King': { plays: 3, wins: 2, draws: 0, losses: 1, kills: 5 },
      'ai/5v5/Queen': { plays: 1, wins: 0, draws: 1, losses: 0, kills: 1 },
    };
    const pick = (piece: string) => [{ piece, officer: id, kills: 1 }];
    p.matches = [
      {
        seq: 1, at: 1, mode: '3v3', opponent: 'online', opponentId: '공명', mySquad: null,
        theirSquad: null, myPower: 742, theirPower: 1043, chance: 0.0479, result: 'win',
        picks: pick('King'),
      },
      {
        seq: 2, at: 2, mode: '5v5', opponent: 'ai', opponentId: null, mySquad: null,
        theirSquad: null, myPower: 900, theirPower: 900, chance: 0.5, result: 'draw',
        picks: pick('Queen'),
      },
    ];
    p.matchSeq = 3;
    localStorage.setItem(KEY, JSON.stringify(p));
  }, who!);

  await reenter();
  await toPalace();
  await page.click('[data-action="officers"]');
  await page.waitForTimeout(300);
  await page.click(`.ofc-row[data-officer="${who}"]`);
  await page.waitForTimeout(250);
  await page.click('[data-action="records"]');
  await page.waitForTimeout(300);
  if (!await page.$('[data-screen="records"]')) fail('[전적 보기]를 눌렀는데 40쪽 화면이 안 뜬다');

  /** 화면이 내보내는 표 — 기물 여섯 줄 · 요약 세 줄 · 이력 줄들 */
  const board = () => page.evaluate(() => {
    const scr = document.querySelector('[data-screen="records"]')!;
    const num = (el: Element, n: number) => Number(el.querySelectorAll('.c-n')[n]!.textContent);
    return {
      filter: (scr as HTMLElement).dataset.filter,
      pieces: [...scr.querySelectorAll('.rec-row:not(.rec-thead)')].map((el) => ({
        piece: (el as HTMLElement).dataset.piece!,
        plays: num(el, 0), wins: num(el, 1), kills: num(el, 2),
      })),
      sums: Object.fromEntries([...scr.querySelectorAll('[data-sum]')].map((el) =>
        [(el as HTMLElement).dataset.sum!, el.textContent!.trim()])),
      // 표 머리(`.rec-loghead`)에는 `data-seq`가 없다 — 줄만 센다
      log: [...scr.querySelectorAll('.rec-log-row[data-seq]')].map((el) => ({
        seq: (el as HTMLElement).dataset.seq!,
        opponent: (el as HTMLElement).dataset.opponent!,
        vs: el.querySelector('.c-vs')!.textContent!.trim(),
        text: el.textContent!.trim(),
      })),
    };
  });

  const all = await board();
  if (all.pieces.length !== 6) fail(`기물 표가 여섯 줄이 아니다 — ${all.pieces.length}줄 (40쪽 목업 고정)`);
  const king = all.pieces.find((r) => r.piece === 'King')!;
  const queen = all.pieces.find((r) => r.piece === 'Queen')!;
  if (king.plays !== 3 || king.wins !== 2 || king.kills !== 5) fail(`King 줄이 다르다: ${JSON.stringify(king)}`);
  if (queen.plays !== 1) fail(`Queen 줄이 다르다: ${JSON.stringify(queen)}`);
  // **기물별 합 = 총합** — 화면이 필터를 한쪽에만 걸면 여기서 갈린다
  const sumPlays = all.pieces.reduce((n, r) => n + r.plays, 0);
  if (!all.sums['total']!.includes(`${sumPlays}전`)) {
    fail(`총합이 기물별 합(${sumPlays})과 다르다: "${all.sums['total']}"`);
  }
  if (!all.sums['3v3']!.includes('3전') || !all.sums['5v5']!.includes('1전')) {
    fail(`모드별 요약이 다르다: ${JSON.stringify(all.sums)}`);
  }
  if (all.log.length !== 2) fail(`이력이 두 줄이 아니다 — ${all.log.length}줄`);
  if (all.log[0]!.seq !== '2') fail('이력의 최근 것이 위가 아니다');
  if (all.log[1]!.vs !== '공명') fail(`온라인 상대 id가 안 보인다: "${all.log[1]!.vs}"`);
  if (all.log[0]!.vs !== 'AI') fail(`AI 판에 라벨이 없다: "${all.log[0]!.vs}"`);
  if (!all.log[1]!.text.includes('5%')) fail(`예상 승률이 안 보인다: "${all.log[1]!.text}"`);
  console.log(`✓ 전적 관리 — 기물 6줄(King ${king.plays}전 ${king.wins}승 ${king.kills}격파) · ${all.sums['total']}`);

  // 필터 — 세지 않는 대신 갈라 본다 (2026-08-18 기획자 확정)
  await page.click('[data-record-filter="ai"]');
  await page.waitForTimeout(200);
  const ai = await board();
  if (ai.filter !== 'ai') fail('필터를 눌렀는데 화면이 안 바뀐다');
  if (!ai.sums['total']!.includes('1전')) fail(`AI만 걸렀는데 총합이 다르다: "${ai.sums['total']}"`);
  if (ai.pieces.find((r) => r.piece === 'King')!.plays !== 0) fail('AI 필터에 온라인 판이 섞여 있다');
  if (ai.log.length !== 1 || ai.log[0]!.opponent !== 'ai') fail('이력에 필터가 안 걸린다');

  await page.click('[data-record-filter="online"]');
  await page.waitForTimeout(200);
  const online = await board();
  if (!online.sums['total']!.includes('3전')) fail(`온라인만 걸렀는데 총합이 다르다: "${online.sums['total']}"`);
  if (online.log.length !== 1 || online.log[0]!.opponent !== 'online') fail('온라인 필터가 AI 판을 남긴다');
  console.log(`✓ 전적 필터 — 전체 ${sumPlays}전 · AI 1전 · 온라인 3전 (표·요약·이력이 함께 걸린다)`);
}

// ── 도시 관리 (pptx 41쪽) ★ C2가 연 자리 ────────────────────────
//
// 여기서만 잡히는 것이 둘이다.
//  ① **`App.tsx`가 `syncGrain()`을 실제로 부르는가** — 단위 테스트는 함수가 옳은지만
//     알고 「누가 그걸 부르는가」는 모른다. v1 되접기와 똑같은 종류의 구멍이라
//     저장분의 `grainAt`을 과거로 밀어 놓고 **새로고침**해서 확인한다.
//  ② **증축 뒤 풀·상한·요율이 화면에서 함께 따라오는가** — 셋이 `cityLevel` 하나를
//     보고 있어 규칙에서는 갈릴 수 없지만, 화면이 옛 값을 들고 있으면 여기서 드러난다.
{
  /** 저장분을 손보고 새로고침 — 화면이 다시 읽게 한다 */
  const reload = async (patch: Record<string, unknown>): Promise<void> => {
    await page.evaluate((over: Record<string, unknown>) => {
      const KEY = 'samchess.profile.v1';
      const p = JSON.parse(localStorage.getItem(KEY)!);
      localStorage.setItem(KEY, JSON.stringify({ ...p, ...over }));
    }, patch);
    await reenter();
    await toPalace();
    await page.click('[data-action="city"]');
    await page.waitForTimeout(300);
  };

  /** 화면이 내보내는 41쪽 여섯 줄 */
  const info = () => page.evaluate(() => {
    const scr = document.querySelector('[data-screen="city"]') as HTMLElement | null;
    if (!scr) return null;
    const at = (f: string) => document.querySelector(`[data-field="${f}"]`);
    const txt = (f: string) => at(f)?.querySelector('.v')?.textContent?.trim() ?? '';
    return {
      level: Number(scr.dataset.cityLevel),
      emperor: (at('emperor') as HTMLElement | null)?.dataset.emperor,
      pool: txt('pool'), cards: txt('cards'), grain: txt('grain'), materials: txt('materials'),
      upgradeOn: !((document.querySelector('[data-action="upgrade"]') as HTMLButtonElement).disabled),
      why: document.querySelector('[data-field="why"]')?.textContent ?? '',
      // 저장분의 실제 값 — 화면 글자와 어긋나면 그것도 잡힌다
      saved: JSON.parse(localStorage.getItem('samchess.profile.v1')!) as { grain: number; grainAt: number },
    };
  });

  const HOUR = 3_600_000;
  const now = await page.evaluate(() => Date.now());

  // ① 세 시간을 놀았다 — Lv1은 시간당 1이므로 셋이 들어온다
  await reload({ grain: 5, grainAt: now - 3 * HOUR, materials: 0 });
  let it = await info();
  if (!it) fail('궁궐의 [도시 관리]를 눌렀는데 41쪽 화면이 안 뜬다');
  if (it!.saved.grain !== 8) fail(`세 시간에 군량이 셋 안 찼다 — ${it!.saved.grain} (App이 syncGrain을 부르는가)`);
  if (!it!.grain.includes('시간당 1')) fail(`시간당 생산량이 안 보인다: "${it!.grain}"`);
  if (!it!.grain.includes('8 / 최대 20')) fail(`군량 줄이 다르다: "${it!.grain}"`);
  // 41쪽의 나머지 줄들이 다 있는가
  if (it!.emperor !== '0') fail('헌제가 없는데 황제가 「옹립」이다');
  if (!it!.pool.includes('5 / 최대 10')) fail(`등용 장수 줄이 다르다: "${it!.pool}"`);
  if (!it!.materials.includes('다음 레벨')) fail(`업그레이드 재료 줄이 다르다: "${it!.materials}"`);
  if (it!.upgradeOn) fail('재료가 0인데 [증축]이 눌린다');
  if (!it!.why.includes('자재')) fail(`잠긴 이유가 안 적혀 있다: "${it!.why}"`);
  console.log(`✓ 도시 관리 — 3시간에 군량 5 → ${it!.saved.grain} · ${it!.pool} · ${it!.materials}`);

  // ② 상한을 넘지 않는다 — 백 시간을 놀아도 20이다
  await reload({ grain: 19, grainAt: now - 100 * HOUR });
  it = await info();
  if (it!.saved.grain !== 20) fail(`상한을 넘었다 — ${it!.saved.grain}/20`);
  // ③ 시계가 앞서 있어도(= 뒤로 갔어도) 줄지 않는다
  await reload({ grain: 7, grainAt: now + 5 * HOUR });
  it = await info();
  if (it!.saved.grain !== 7) fail(`시계가 뒤로 갔는데 군량이 ${it!.saved.grain}이 됐다 (7이어야 한다)`);
  console.log('✓ 군량 충전 — 상한 20에서 멈추고, 시계가 뒤로 가도 7 그대로');

  // ④ 증축 — 개발용 통로로 재료를 넣고 확인 팝업을 지나 실제로 올린다
  await page.click('[data-dev="materials"]');
  await page.waitForTimeout(200);
  it = await info();
  if (!it!.upgradeOn) fail(`재료를 넣었는데 [증축]이 안 눌린다: "${it!.materials}"`);
  await page.click('[data-action="upgrade"]');
  await page.waitForTimeout(250);

  // **「있는가」와 「제자리에 있는가」는 다른 검사다** — `.scr-bg > *`의 일괄 규칙이
  // 팝업의 `absolute`를 덮으면 화면 한가운데가 아니라 내용 맨 아래에 흘러 붙는다
  const modal = await page.evaluate(() => {
    const back = document.querySelector('[data-modal="upgrade"]') as HTMLElement | null;
    if (!back) return null;
    const f = document.getElementById('frame')!.getBoundingClientRect();
    const r = back.getBoundingClientRect();
    return {
      pos: getComputedStyle(back).position,
      dy: Math.abs((r.top + r.bottom) / 2 - (f.top + f.bottom) / 2),
      what: document.querySelector('[data-field="what"]')?.textContent ?? '',
    };
  });
  if (!modal) fail('[증축]을 눌렀는데 확인 팝업이 안 뜬다');
  if (modal!.pos !== 'absolute' || modal!.dy > 2) fail(`증축 팝업이 제자리에 없다 (${modal!.pos}, 중앙에서 ${modal!.dy}px)`);
  if (!modal!.what.includes('Lv1 → Lv2')) fail(`팝업이 무엇을 사는지 안 적는다: "${modal!.what}"`);

  await page.click('[data-action="upgradeConfirm"]');
  await page.waitForTimeout(300);
  it = await info();
  // 셋이 함께 따라와야 한다 — 풀 10→30 · 상한 20→40 · 시간당 1→2 (city.json)
  if (it!.level !== 2) fail(`증축했는데 레벨이 ${it!.level}이다`);
  if (!it!.pool.includes('최대 30')) fail(`증축 후 풀이 안 따라온다: "${it!.pool}"`);
  if (!it!.grain.includes('최대 40') || !it!.grain.includes('시간당 2')) {
    fail(`증축 후 군량 상한·생산량이 안 따라온다: "${it!.grain}"`);
  }
  if (!it!.materials.includes('다음 레벨 : 15')) fail(`다음 레벨 재료가 안 바뀌었다: "${it!.materials}"`);
  console.log(`✓ 증축 — Lv2 · ${it!.pool} · ${it!.grain}`);

  // ⑤ 도시 전적 — **장수 전적의 합이 아니다.** 한 판에 셋이 뛰면 도시 1전 · 장수 합 3전
  await page.evaluate((id: string) => {
    const KEY = 'samchess.profile.v1';
    const p = JSON.parse(localStorage.getItem(KEY)!);
    p.record = {
      'online/3v3': { plays: 4, wins: 3, draws: 0, losses: 1, kills: 9 },
      'ai/5v5': { plays: 2, wins: 1, draws: 1, losses: 0, kills: 3 },
    };
    // 같은 판을 장수 쪽에서 보면 사람 수만큼 부푼다 (3v3 네 판에 셋씩 뛰었다)
    p.roster[id].record = { 'online/3v3/King': { plays: 4, wins: 3, draws: 0, losses: 1, kills: 4 } };
    localStorage.setItem(KEY, JSON.stringify(p));
  }, who!);
  await reenter();
  await toPalace();
  await page.click('[data-action="city"]');
  await page.waitForTimeout(250);
  await page.click('[data-action="records"]');
  await page.waitForTimeout(300);
  if (!await page.$('[data-screen="cityRecords"]')) fail('[도시 전적 보기]를 눌렀는데 화면이 안 뜬다');

  const sums = () => page.evaluate(() => {
    const scr = document.querySelector('[data-screen="cityRecords"]')!.closest('.scr')!;
    return {
      filter: (document.querySelector('[data-screen="cityRecords"]') as HTMLElement).dataset.filter,
      rows: Object.fromEntries([...scr.querySelectorAll('[data-sum]')].map((el) =>
        [(el as HTMLElement).dataset.sum!, el.textContent!.trim()])),
    };
  });
  const city = await sums();
  if (!city.rows['3v3']!.includes('4전') || !city.rows['5v5']!.includes('2전')) {
    fail(`모드별 줄이 다르다: ${JSON.stringify(city.rows)}`);
  }
  // 총합은 모드별의 합이다 — 따로 세면 여기서 갈린다
  if (!city.rows['total']!.includes('6전')) fail(`총합이 모드별 합(6전)과 다르다: "${city.rows['total']}"`);
  console.log(`✓ 도시 전적 — 3v3 ${city.rows['3v3']} / 총 ${city.rows['total']}`);

  // 필터도 40쪽과 같이 걸린다 — 41쪽 목업 글자는 「온라인 대전」뿐이지만 AI도 센다
  await page.click('[data-record-filter="ai"]');
  await page.waitForTimeout(200);
  const ai = await sums();
  if (ai.filter !== 'ai' || !ai.rows['total']!.includes('2전')) {
    fail(`AI만 걸렀는데 총합이 다르다: "${ai.rows['total']}"`);
  }

  // ★ 완료 조건 — **도시 전적 합 ≠ 장수 전적 합** (판수 대 인원수)
  await page.click('[data-record-filter="all"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="back"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="back"]');
  await page.waitForTimeout(250);
  await page.click('[data-action="officers"]');
  await page.waitForTimeout(300);
  await page.click(`.ofc-row[data-officer="${who}"]`);
  await page.waitForTimeout(250);
  await page.click('[data-action="records"]');
  await page.waitForTimeout(300);
  const mine = await page.evaluate(() =>
    document.querySelector('[data-screen="records"] [data-sum="total"]')!.textContent!.trim());
  if (!mine.includes('4전')) fail(`장수 전적이 다르다: "${mine}"`);
  if (mine === city.rows['total']) {
    fail('도시 전적과 장수 전적이 같다 — 계정 칸을 장수 합으로 만들고 있는가 (한 판에 여럿이 뛴다)');
  }
  console.log(`✓ 판수 대 인원수 — 도시 총 6전 · 장수 총 4전 (같으면 계정 칸을 합으로 만든 것이다)`);
}

if (errors.length) fail(`콘솔 오류 ${errors.length}건: ${errors[0]}`);
console.log('\n메타 연동 스모크 통과');
await browser.close();
if (ownServer) await ownServer.gracefullyShutdown(false);
process.exit(0);