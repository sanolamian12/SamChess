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

// 37쪽의 두 갈래. 「도시 관리」는 C2가 열 때까지 잠겨 있어야 한다
const palace = await page.evaluate(() => ({
  officers: !!document.querySelector('.scr-place [data-action="officers"]'),
  city: !!document.querySelector('.scr-place [data-action="city"]'),
  cityLocked: (document.querySelector('.scr-place [data-action="city"]') as HTMLButtonElement | null)?.disabled ?? false,
}));
if (!palace.officers) fail('궁궐에 [장수 일람]이 없다');
if (!palace.city) fail('궁궐에 [도시 관리] 자리가 없다 (37쪽)');
if (!palace.cityLocked) fail('[도시 관리]가 눌린다 — 아직 C2가 열지 않은 화면이다');
console.log('✓ 궁궐 — [장수 일람] · [도시 관리](잠김)');

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
    // 「전적 보기」는 C1이 열 때까지 잠겨 있다
    recordsLocked: (scr.querySelector('[data-action="records"]') as HTMLButtonElement).disabled,
    // 인물 서사는 G1이 채운다 — 지금은 **줄째로 없어야** 한다
    story: !!scr.querySelector('[data-field="story"]'),
  };
});
if (!detail) fail('일람에서 줄을 눌렀는데 상세가 뜨지 않는다');
if (detail!.officer !== target.officer) fail(`다른 장수의 상세가 떴다: ${detail!.officer}`);
// 「HP, MP, 공격력(최소-최대)」 — AT는 매 타격 내림이라 범위여야 한다 (GDD §4.2)
if (!/AT:\s*\d+-\d+/.test(detail!.stats)) fail(`AT가 범위 표기가 아니다: "${detail!.stats}"`);
if (!detail!.recordsLocked) fail('[전적 보기]가 눌린다 — 아직 C1이 열지 않은 화면이다');
if (detail!.story) fail('인물 서사가 비었는데 줄이 남아 있다 — 없으면 줄째로 물러나야 한다');
console.log(`✓ 상세 — ${detail!.name} / ${detail!.stats} / 전적·서사 자리만`);

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

// ── 재설계(둔갑천서) — **[확정] 전까지 프로필이 안 바뀐다** ──────
{
  if (await page.isEnabled('[data-action="respec"]')) fail('금화가 0인데 재설계가 열린다');
  await page.click('[data-dev="gold"]');
  await page.waitForTimeout(200);
  if (!await page.isEnabled('[data-action="respec"]')) fail('둔갑천서를 샀는데 재설계가 잠겨 있다');

  // 한 걸음 고르다 **중간에 나간다** — 원래대로여야 한다
  await page.click('[data-action="respec"]');
  await page.waitForTimeout(200);
  if ((await lvState())!.step !== 'respec') fail('[재설계]를 눌렀는데 마법사가 안 열린다');
  await page.click('[data-stat="mp"]');
  await page.waitForTimeout(120);
  await page.click('[data-action="back"]');           // 「그만두기」
  await page.waitForTimeout(250);
  const bailed = await lvState();
  if (bailed!.step !== 'manage') fail('그만두기를 눌렀는데 관리 화면으로 안 온다');
  if (bailed!.taps !== '1/0/0') fail(`중간에 나갔는데 성장이 바뀌었다: ${bailed!.taps}`);

  // 이번엔 끝까지 — Lv2 하나뿐이라 한 걸음이면 끝난다. MP로 갈아탄다
  await page.click('[data-action="respec"]');
  await page.waitForTimeout(200);
  await page.click('[data-stat="mp"]');
  await page.waitForTimeout(120);
  await page.click('[data-action="confirm"]');
  await page.waitForTimeout(300);
  const done = await lvState();
  if (done!.step !== 'manage') fail('재설계를 확정했는데 관리 화면으로 안 온다');
  if (done!.name !== after) fail(`재설계했는데 레벨이 바뀌었다: "${after}" → "${done!.name}"`);
  if (done!.taps !== '0/1/0') fail(`재설계가 반영되지 않았다: ${done!.taps} (기대 0/1/0)`);
  if (done!.growth !== grown!.growth) fail('재설계로 성장 스택 길이가 달라졌다 — 레벨은 유지다');
  console.log(`✓ 재설계 — 레벨 ${done!.name} 유지, 찍은 횟수 ${grown!.taps} → ${done!.taps}`);

  // 되돌려 둔다 — 아래 「저장 유지」가 HP 성장을 기준으로 본다
  await page.click('[data-dev="gold"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="respec"]');
  await page.waitForTimeout(200);
  await page.click('[data-stat="hp"]');
  await page.waitForTimeout(120);
  await page.click('[data-action="confirm"]');
  await page.waitForTimeout(300);
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
  if (kind !== 2) fail(`되접은 뒤에도 version이 ${kind}다 — 저장까지 올라와야 한다`);
  console.log(`✓ v1 되접기 — ${v1.cityName} · 장수 ${rebuilt.length}명 · ${folded} (Lv${v1.level} 유지) · version 1 → ${kind}`);
}

if (errors.length) fail(`콘솔 오류 ${errors.length}건: ${errors[0]}`);
console.log('\n메타 연동 스모크 통과');
await browser.close();
