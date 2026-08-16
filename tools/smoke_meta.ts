/**
 * 메타 연동 스모크 — 오프라인 한 바퀴가 실제로 도는지 확인한다.
 *
 *   node --experimental-strip-types tools/smoke_meta.ts
 *
 * ```
 * 간판 → 새 계정 → 도시 → 병영 → 편성 → 출전 → 배치 → 정찰 → 전투
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

const argv = process.argv.slice(2);
const i = argv.indexOf('--url');
const BASE = i >= 0 && argv[i + 1] ? argv[i + 1]! : 'http://localhost:5173';

const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

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

const modes = await page.evaluate(() =>
  [...document.querySelectorAll('.scr-place [data-mode]')].map((el) => (el as HTMLElement).dataset.mode));
// 1:1은 없앴다 (2026-08-04 확정)
if (modes.includes('1v1')) fail('1:1이 아직 남아 있다 — 영구 삭제로 확정했다');
if (!modes.includes('3v3') || !modes.includes('5v5')) fail(`대전 규모가 3v3·5v5가 아니다: ${modes.join(',')}`);
// 장수 5명뿐이라 5v5는 잠겨 있어야 한다 (기물 수만큼 장수가 필요하다)
if (await page.isEnabled('[data-mode="5v5"]') === false) {
  console.log('✓ 5v5는 장수가 모자라 잠겨 있다');
}
console.log(`✓ 병영 — 모드 [${modes.join(' ')}]`);

// ── 편성 (GDD §3.9) ────────────────────────────────────────────

await page.click('[data-mode="3v3"]');
await page.waitForTimeout(300);
await expectBgm('roster', '기물·장수 고르기');
// 편성도 병영 안에서 하는 일이다 — 그림은 눌러 깔린다(`.scr-dim`)
await expectBackdrop('.scr-roster', 'place-1-barracks.jpg', '편성');

// King은 처음부터 들어가 있고 뺄 수 없다
const kingLocked = await page.evaluate(() => {
  const king = document.querySelector('.piece[data-piece="King"]');
  return king?.classList.contains('on') ?? false;
});
if (!kingLocked) fail('King이 기본으로 들어가 있지 않다');

// 아직 자리가 비어 있으니 출전은 잠겨 있어야 한다
if (await page.isEnabled('[data-action="start"]')) fail('편성이 비었는데 출전이 열려 있다');

await page.click('.piece[data-piece="Rock"]');
await page.click('.piece[data-piece="Pawn"]');
await page.waitForTimeout(150);

for (let n = 0; n < 3; n++) {
  const card = await page.$('.pool .card:not(.used)');
  if (!card) fail(`보유 장수가 모자라 편성을 채울 수 없다 (${n}명까지)`);
  await card.click();
  await page.waitForTimeout(120);
}

const roster = await page.evaluate(() => ({
  note: document.querySelector('.scr-roster .note')?.textContent ?? '',
  slots: [...document.querySelectorAll('.slot')].map((el) => ({
    piece: (el as HTMLElement).dataset.piece,
    filled: el.classList.contains('filled'),
  })),
  canStart: !(document.querySelector('[data-action="start"]') as HTMLButtonElement)?.disabled,
}));
if (roster.slots.length !== 3) fail(`자리가 3개가 아니다: ${roster.slots.length}`);
if (roster.slots.some((s) => !s.filled)) fail('빈 자리가 남았는데 채워졌다고 나온다');
if (!roster.canStart) fail(`편성을 다 채웠는데 출전이 잠겨 있다 — "${roster.note}"`);
console.log(`✓ 편성 — [${roster.slots.map((s) => s.piece).join(' ')}] "${roster.note}"`);

// ── 출전 → 배치 → 정찰 → 전투 (GDD §3.9) ──────────────────────

await page.click('[data-action="start"]');
await page.waitForTimeout(2500);

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
console.log(`✓ 배치 단계 — 남은 ${stg.remain}초, 버튼 "${stg.button}", 내 기물 [${stg.mine.join(' ')}]`);
// 배치·정찰은 전투와 **다른 곡**이다. 화면은 그 경계를 모르고 단계만 안다
await expectBgm('prep', '배치·정탐');

// 내 기물을 골라 진영 안 다른 칸으로 옮긴다
const placedBefore = stg.mine.join(' ');
const spot = await page.evaluate(() => {
  const pb = (window as any).__battle.scene.debugPlayback;
  const u = Object.values(pb.state.units as Record<string, any>).find((x: any) => x.side === 'P1') as any;
  return { from: { x: u.pos.x, y: u.pos.y }, to: { x: u.pos.x + 1, y: u.pos.y - 2 } };
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

const grain = await page.evaluate(() => JSON.parse(localStorage.getItem('samchess.profile.v1') ?? '{}').grain);
if (grain !== 17) fail(`군량이 기물 수만큼 나가지 않았다 — 20 → ${grain} (기대 17)`);
console.log(`✓ 군량 소모 — 20 → ${grain} (기물 1개당 1)`);

// ── 장수 관리 · 레벨업 (GDD §4.2·§4.3) ─────────────────────────

// 새로고침하면 늘 간판부터다 — 「게임 URL로 들어오면 가장 먼저 보이는 화면」이 기획이다
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.click('.scr-title [data-action="enter"]');
await page.waitForTimeout(300);
await page.click('.scr-main [data-place="palace"]');
await page.waitForTimeout(300);
await expectBackdrop('.scr-place', 'place-1-palace.jpg', '궁궐');
await page.click('[data-action="officers"]');
await page.waitForTimeout(300);

const before = (await page.textContent('.detail .info .nm'))?.trim() ?? '';
// 개발용 카드 지급 — AI 대전이 카드를 주지 않아 성장을 시험할 길이 없어서 둔 문
await page.click('.devtools .btn');
await page.waitForTimeout(200);
if (!await page.isEnabled('[data-action="levelUp"]')) {
  fail('카드를 채웠는데 레벨업이 잠겨 있다 — 레벨업에 실패는 없다(2026-08-04 확정)');
}
await page.click('[data-action="levelUp"]');
await page.waitForTimeout(300);

const after = (await page.textContent('.detail .info .nm'))?.trim() ?? '';
if (before === after) fail(`레벨업했는데 표시가 그대로다: "${before}"`);
const tactics = await page.evaluate(() => document.querySelectorAll('.detail .tactics .chip').length);
if (tactics === 0) fail('레벨업했는데 책략을 배우지 않았다 (능력 택1 + 책략 택1)');
console.log(`✓ 레벨업 — ${before} → ${after}, 책략 ${tactics}종`);

// ── 저장 (온라인이 붙으면 이 자리가 서버 API가 된다) ───────────

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.click('.scr-title [data-action="enter"]');
await page.waitForTimeout(300);
if (await page.$('.scr-new')) fail('새로고침했더니 계정이 사라졌다');
await page.click('.scr-main [data-place="palace"]');
await page.waitForTimeout(300);
await page.click('[data-action="officers"]');
await page.waitForTimeout(300);
const kept = (await page.textContent('.detail .info .nm'))?.trim() ?? '';
if (kept !== after) fail(`새로고침 뒤 상태가 다르다: "${after}" → "${kept}"`);
console.log(`✓ 저장 유지 — ${kept}`);

if (errors.length) fail(`콘솔 오류 ${errors.length}건: ${errors[0]}`);
console.log('\n메타 연동 스모크 통과');
await browser.close();
