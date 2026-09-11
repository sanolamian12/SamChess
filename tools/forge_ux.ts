/**
 * 대장간 지급 관리 UX 확인 — **장수가 많은 계정**에서 표가 견디는지, 그리고
 * 「이미 낀 장수를 고르면 교체된다」가 실제로 눈에 띄는지 본다 (2026-09-10).
 *
 *   VW=760 VH=1200 SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/forge_ux.ts
 *
 * `forge_play.ts`가 「한 바퀴가 도는가」라면 이쪽은 「많을 때도 읽히는가」다 —
 * 장수 다섯 명짜리 새 계정으로는 스크롤도 페이지도 교체 안내도 한 번도 안 그려진다
 * (「안 도는 갈래」의 사촌 — 상태에 도달을 못 해 검사가 헛돈다).
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { newInstance } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
const HOW_MANY = Number(process.env['OFFICERS'] ?? 120);

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);

const email = `forge-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? 760), height: Number(process.env['VH'] ?? 1200) },
});
// 확인창은 **받되 문구를 적어 둔다** — 「교체를 알려 주는가」가 이 검사의 요점이라
// 조용히 accept만 하면 뜬 적이 없어도 통과한다
const dialogs: string[] = [];
page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });

/* 「완성!」 팝업은 **미지급 품목 하나에 하나씩** 뜬다(`justDone`) — 일곱을
   심었으니 여섯 번 닫아야 지급 목록에 닿는다. 한 번만 닫으면 다음 팝업이
   [지급 관리] 클릭을 가로채 30초를 기다리다 죽는다(실제로 그랬다). */
const dismissDonePopups = async (): Promise<void> => {
  for (let i = 0; i < 12; i += 1) {
    const ack = await page.$('[data-action="ackDone"]');
    if (!ack) break;
    await ack.click();
    await page.waitForTimeout(150);
  }
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  // 입력칸은 이제 [입장] 팝업 안이다(2026-09-11, `LoginModal`) — 먼저 팝업을 연다
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', '지급실험');
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  /*
   * 장수를 많이 심고, **병기 일곱을 이미 보유**시킨다 — 하나는 어느 장수에게
   * 이미 지급된 상태로. 그래야 지급 화면의 「병기」 칸에 빈칸 아닌 값이 뜨고,
   * 다른 병기를 그 장수에게 주려 할 때 **교체**가 실제로 그려진다.
   *
   * **일곱인 것은 한 쪽이 다섯이기 때문이다**(2026-09-11, `ASSIGN_PAGE_SIZE`) —
   * 둘만 심으면 쪽 넘김 단추가 **아예 안 그려져** 그 갈래가 한 번도 안 돈다.
   * 정렬이 해금 레벨 오름차순이라 Lv1 셋(대감도·수극·엄심경)은 1쪽에 남는다 —
   * 아래 「수극을 고른다」·「이미 대감도를 낀 장수」 두 걸음이 그대로 선다.
   */
  step(`장수 ${HOW_MANY}명 · 병기 7개(하나는 이미 지급)를 심는다`);
  const stored = await getProfile(uid);
  const roster = { ...stored!.roster } as Record<string, unknown>;
  const ids = OFFICERS.map((o) => o.id as OfficerId);
  for (const id of ids.slice(0, HOW_MANY)) if (!roster[id]) roster[id] = newInstance(id);
  const worn = Object.keys(roster)[3]!;
  await saveProfileTrusted(uid, {
    ...stored!,
    gold: 500,
    cityLevel: 11,
    buildings: { ...stored!.buildings, forge: 5, palace: 11 },
    roster,
    forgeOwned: {
      'dae-gam-do': worn, 'su-geuk': null, 'eom-sim-gyeong': null,
      'yu-seong-chu': null, 'du-mu': null, 'su-myeon-tan-du-yeon-hwan-gae': null, 'cheong-gang-geom': null,
    },
  } as Parameters<typeof saveProfileTrusted>[1]);
  ok(`장수 ${Object.keys(roster).length}명, 대감도는 ${worn}가 이미 낀 상태`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.city-gate rect');
  await page.waitForSelector('[data-place="forge"]');
  await page.click('[data-place="forge"]');
  await page.waitForSelector('[data-action="assign"]');
  await dismissDonePopups();

  step('지급 관리 목록 — 보유 7개, 하나는 지급됨, 한 쪽에 다섯 줄');
  await page.click('[data-action="assign"]');
  await page.waitForSelector('.frg-row');
  await page.screenshot({ path: `${SHOTS}/ux-01-assign-list.png` });
  // 머리줄(`.frg-thead`)은 빼고 센다 — 「다섯 줄인가」를 보는 검사다
  /* 대장간 쪽 단추도 **같은 목판인가** — 팝업에서만 고치고 여기를 잊기 쉽다
     (실제로 잊었다, 2026-09-11). 「있는가」가 아니라 깔린 그림 이름을 본다. */
  const assignPlates = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[data-field="assignPager"] .btn')] as HTMLElement[];
    return btns
      .filter((b) => !/pager-(next|end)\.png/.test(getComputedStyle(b, '::before').backgroundImage))
      .map((b) => b.getAttribute('data-action') ?? '');
  });
  /* [장수 선택]과 [장비 회수]가 **같은 크기인가**(2026-09-11 지정). 목판
     그림이 달라 9분할 테두리 값도 따로 적기 쉬운데, 다르면 줄마다 단추가
     커졌다 작아졌다 한다 — 눈으로는 「살짝 다른가?」로만 보인다. */
  const btnBoxes = await page.evaluate(() => {
    const box = (sel: string): string | null => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)}`;
    };
    return { give: box('[data-action="give"]'), revoke: box('[data-action="revoke"]') };
  });
  console.log(btnBoxes.give && btnBoxes.give === btnBoxes.revoke
    ? `  ✓ [장수 선택]·[장비 회수]가 같은 크기 (${btnBoxes.give})`
    : `  ✗ 두 단추 크기가 다르다 — ${JSON.stringify(btnBoxes)}`);
  const assignRows = await page.$$('.frg-row:not(.frg-thead)');
  const pager = await page.$eval('[data-field="assignPager"]', (el) => ({
    page: el.getAttribute('data-page'), pages: el.getAttribute('data-pages'),
  })).catch(() => null);
  console.log(assignRows.length === 5 && pager?.pages === '2' && assignPlates.length === 0
    ? `  ✓ 📷 ux-01-assign-list.png — 5줄 · ${pager.page}/${pager.pages} 쪽 · 쪽 단추도 화살표 목판`
    : `  ✗ 지급 목록 — ${assignRows.length}줄, 쪽 ${JSON.stringify(pager)}, 목판 아닌 단추 ${JSON.stringify(assignPlates)}`);

  step('둘째 쪽으로 넘긴다 — 남은 둘');
  await page.click('[data-action="assignNextPage"]');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/ux-01b-assign-page2.png` });
  ok(`둘째 쪽 ${(await page.$$('.frg-row:not(.frg-thead)')).length}줄`);
  await page.click('[data-action="assignPrevPage"]');
  await page.waitForTimeout(250);

  step('미지급 병기(수극)를 줄 장수를 고른다 — 장수가 많은 표');
  await page.click('.frg-row[data-item="su-geuk"] [data-action="give"]');
  await page.waitForSelector('[data-action="equipPick"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/ux-02-pick-many.png` });

  const table = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ofc-row-equip:not(.ofc-thead)')] as HTMLElement[];
    const box = document.querySelector('.ofc-rows') as HTMLElement;
    const withEquip = rows.filter((r) => {
      const eq = r.querySelector('.c-eq') as HTMLElement | null;
      return eq && !!eq.textContent && eq.textContent.trim() !== '없음';
    }).map((r) => (r.querySelector('.c-nm-text')?.textContent ?? '') + ' / ' + (r.querySelector('.c-eq')?.textContent ?? ''));
    return {
      rowsOnPage: rows.length,
      scrollable: box ? box.scrollHeight > box.clientHeight + 1 : null,
      scrollH: box?.scrollHeight, clientH: box?.clientHeight,
      pager: document.querySelector('.ofc-pager, [data-field="pager"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      alreadyEquipped: withEquip,
      /* [선택하기] 단추가 **글자를 자르지 않는가** — 목판 그림이 좌우
         테두리로 폭을 먹어 글자가 잘려 나간 적이 있다(2026-09-11, 그때는
         줄마다 있던 [선택]이었다). 눈으로만 보면 「글꼴이 좀 큰가」로
         넘어간다. 상자 크기도 함께 적어 둔다 — 「지금의 1.3배」 같은 지정이
         올 때 잴 자리가 여기 하나다. */
      pickBtn: (() => {
        const b = document.querySelector('[data-action="equipConfirm"]') as HTMLElement | null;
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return {
          w: Math.round(r.width), h: Math.round(r.height),
          clipped: b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1,
        };
      })(),
    };
  });
  console.log(`  표 — ${JSON.stringify(table, null, 2).replace(/\n/g, '\n  ')}`);

  /*
   * 팝업 **안에서** 다시 뜨는 장수 카드가 팝업 위로 올라오는가 (2026-09-11).
   *
   * 이 화면은 이제 전면 화면이 아니라 대장간 위에 겹친 팝업(`.ofcpick-back`,
   * z-index 45)이다. 카드(`.modal-back`, 50)·레벨/스킬 관리 판(`.lvp-back`, 55)이
   * 그 **안쪽** 쌓임 맥락에서 논다 — 셋 중 하나만 건드려도 카드가 팝업 **밑에**
   * 깔리는데, 「떴는가」만 보면 통과한다(요소는 있고 안 보일 뿐이다). 그래서
   * **가운데 점에 실제로 무엇이 놓여 있는지**를 본다.
   */
  /*
   * **쪽을 넘겨도 표 높이가 그대로인가** (2026-09-11). 마지막 쪽은 줄이
   * 모자라 판이 쪼그라들었다 — 눈으로는 「살짝 들썩인다」로만 보여 놓치기
   * 쉽다. 꽉 찬 1쪽과 모자란 마지막 쪽의 높이를 **재서** 견준다.
   */
  step('쪽을 넘겨도 표 높이가 그대로인가');
  const rowsH = async (): Promise<number> => page.evaluate(() => {
    const el = document.querySelector('.ofcpick-modal .ofc-rows') as HTMLElement | null;
    return el ? Math.round(el.getBoundingClientRect().height) : -1;
  });
  const h1 = await rowsH();
  await page.click('[data-action="lastPage"]');
  await page.waitForTimeout(250);
  const hLast = await rowsH();
  await page.screenshot({ path: `${SHOTS}/ux-02c-lastpage.png` });
  console.log(h1 === hLast
    ? `  ✓ 1쪽과 마지막 쪽이 같은 높이 (${h1}px)`
    : `  ✗ 쪽마다 높이가 다르다 — 1쪽 ${h1}px, 마지막 쪽 ${hLast}px`);
  /* 쪽 단추 다섯([처음]·[이전]·쪽·[다음]·[마지막])이 **한 줄에 드는가** —
     목판 테두리가 넓어 [마지막]이 둘째 줄로 떨어진 적이 있다(2026-09-11).
     「있는가」로는 안 잡힌다(있긴 있다) — 줄 높이로 본다. */
  const pagerBox = await page.evaluate(() => {
    const box = document.querySelector('.ofcpick-modal .ofc-pager') as HTMLElement | null;
    const btns = [...(box?.querySelectorAll('.btn') ?? [])] as HTMLElement[];
    if (!box || btns.length === 0) return null;
    return {
      lines: Math.round(box.getBoundingClientRect().height / btns[0]!.getBoundingClientRect().height),
      /* 화살표 목판이 **실제로 깔렸는가**. 그림은 `<img>`가 아니라 바탕
         (`background-image`)이라 「있는가」로는 안 보인다 — 게다가 화면마다
         있는 목판 규칙이 셀렉터가 더 세서 **조용히 덮어쓴 적이 있다**
         (2026-09-11). 그래서 계산된 바탕 그림의 이름을 직접 본다. */
      /* 판 그림은 **`::before`에 깔린다**(글자까지 거울로 뒤집히지 않게,
         2026-09-11) — 요소 자신의 `background`를 보면 늘 `none`이라 통과한다.
         의사 요소를 집어서 본다. 글자가 비었는지도 함께 본다. */
      wrongPlate: btns.filter((b) => (
        !/pager-(next|end)\.png/.test(getComputedStyle(b, '::before').backgroundImage)
        || !(b.textContent ?? '').trim()
      )).map((b) => `${b.getAttribute('data-action')}=${getComputedStyle(b, '::before').backgroundImage.slice(0, 40)}/"${b.textContent}"`),
    };
  });
  console.log(pagerBox?.lines === 1 && pagerBox.wrongPlate.length === 0
    ? '  ✓ 쪽 단추 다섯이 한 줄에 들고 화살표 목판·글자가 제대로 붙었다'
    : `  ✗ 쪽 단추 — ${JSON.stringify(pagerBox)}`);
  await page.click('[data-action="firstPage"]');
  await page.waitForTimeout(250);

  step('팝업 안에서 줄을 눌러 장수 카드를 연다 — 카드가 팝업 위로 오는가');
  await page.click('.ofc-row-equip:not(.ofc-thead) .c-nm');
  await page.waitForSelector('.ofcard-modal', { timeout: 5_000 });
  await page.waitForTimeout(300);
  const onTop = await page.evaluate(() => {
    const card = document.querySelector('.ofcard-modal') as HTMLElement | null;
    if (!card) return null;
    const b = card.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { inCard: !!hit && card.contains(hit), tag: hit?.className ?? null };
  });
  console.log(onTop?.inCard
    ? `  ✓ 카드가 팝업 위에 있다 — 가운데 점이 카드 안(${onTop.tag})`
    : `  ✗ 카드가 팝업에 가려진다 — 가운데 점이 ${JSON.stringify(onTop)}`);
  await page.screenshot({ path: `${SHOTS}/ux-02b-card-over-popup.png` });
  await page.click('[data-action="closeCard"]');
  await page.waitForTimeout(200);

  step('이미 대감도를 낀 장수의 줄을 찾는다 — 한 쪽에 10명이라 넘겨 가며 본다');
  for (let i = 0; i < 20; i += 1) {
    if (await page.$(`.ofc-row-equip[data-officer="${worn}"]`)) break;
    const next = await page.$('.ofc-pager [data-action="next"], [data-action="nextPage"]');
    if (!next) break;
    await next.click();
    await page.waitForTimeout(250);
  }
  const wornRow = await page.evaluate((id) => {
    const row = document.querySelector(`.ofc-row-equip[data-officer="${id}"]`) as HTMLElement | null;
    if (!row) return null;
    return {
      name: row.querySelector('.c-nm-text')?.textContent ?? '',
      equip: row.querySelector('.c-eq')?.textContent ?? '',
      pick: row.querySelector('[data-action="equipPick"]')?.textContent ?? '',
    };
  }, worn);
  console.log(`  이미 낀 장수 줄 — ${JSON.stringify(wornRow)}`);
  await page.screenshot({ path: `${SHOTS}/ux-03-worn-row.png` });

  if (wornRow) {
    step('그 장수를 골라 본다 — 교체가 조용히 일어나는가, 알려 주는가');
    await page.click(`.ofc-row-equip[data-officer="${worn}"] [data-action="equipPick"]`);
    /* 이제 줄의 나무판은 **표시만** 한다 — 실제 지급은 맨 아래 [선택하기]다
       (2026-09-11). 체크가 실제로 켜졌는지 먼저 본다: 안 켜져도 [선택하기]는
       눌리므로 「눌렀더니 됐다」만 보면 체크가 죽어도 통과한다. */
    const checked = await page.$(`.ofc-row-equip[data-officer="${worn}"][data-picked="1"]`);
    console.log(checked ? '  ✓ 나무판에 체크가 켜졌다' : '  ✗ 눌렀는데 체크가 안 켜진다');
    await page.screenshot({ path: `${SHOTS}/ux-03b-checked.png` });
    await page.click('[data-action="equipConfirm"]');
    /* 교체 확인은 **화면 안 팝업**이다(2026-09-11) — 예전엔 브라우저
       `confirm()`이라 `page.on('dialog')`가 받아 넘겼고, 그래서 팝업이 죽어도
       통과했다. 이제 실제로 떠 있는 판을 보고 [확인]을 누른다. */
    const swapPopup = await page.waitForSelector('[data-modal="forgeConfirm"]', { timeout: 5_000 }).catch(() => null);
    const swapText = swapPopup
      ? (await page.textContent('[data-modal="forgeConfirm"] [data-field="what"]'))?.replace(/\s+/g, ' ').trim()
      : null;
    if (swapPopup) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/ux-03c-swap-confirm.png` });
      await page.click('[data-action="confirmOk"]');
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/ux-04-after-swap.png` });
    const after = await page.evaluate(() => [...document.querySelectorAll('.frg-row')].map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim()));
    console.log(`  교체 뒤 지급 목록 — ${JSON.stringify(after)}`);
    console.log(swapText
      ? `  ✓ 교체 확인 팝업 — ${JSON.stringify(swapText)}`
      : '  ✗ 교체 확인 팝업이 안 떴다 — 병기가 조용히 벗겨진다');
    // 브라우저 대화창은 **한 번도 안 떠야 한다** — 남아 있으면 디자인 밖 상자다
    console.log(dialogs.length === 0 ? '  ✓ 브라우저 대화창은 안 뜬다' : `  ✗ 브라우저 대화창이 아직 있다 — ${JSON.stringify(dialogs)}`);
  }

  /*
   * 장수 카드에 낀 병기가 뜨는가 (2026-09-10에 새로 넣은 줄). 대장간이 아니라
   * **궁궐 → 장수 관리**로 들어가 그 장수를 직접 연다 — 지급 화면에서 보이는
   * 것과 **다른 자리**라는 게 이 검사의 요점이다.
   */
  step('궁궐 → 장수 관리에서 그 장수를 직접 열어 본다');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('[data-place="palace"]');
  await page.waitForSelector('[data-action="officers"], .ofc-row', { timeout: 10_000 });
  if (await page.$('[data-action="officers"]')) await page.click('[data-action="officers"]');
  await page.waitForSelector('.ofc-row', { timeout: 10_000 });
  await page.fill('.scr-officers input', '');
  for (let i = 0; i < 20; i += 1) {
    if (await page.$(`.ofc-row[data-officer="${worn}"]`)) break;
    const next = await page.$('[data-action="nextPage"]');
    if (!next) break;
    await next.click();
    await page.waitForTimeout(200);
  }
  await page.click(`.ofc-row[data-officer="${worn}"]`);
  // **장수 카드는 팝업이다**(`OfficerCardModal`, `.ofcard`) — 전면 화면
  // (`OfficerDetailScreen`)이 아니다. 처음에 그쪽을 기다렸다가 10초를 헛보냈다.
  await page.waitForSelector('.ofcard', { timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/ux-05-officer-card.png` });
  const card = await page.evaluate(() => {
    const el = document.querySelector('[data-field="equip"]') as HTMLElement | null;
    if (!el) return null;
    const img = el.querySelector('img') as HTMLImageElement | null;
    return {
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      item: (el.querySelector('.ofc-equip-item') as HTMLElement | null)?.dataset['item'] ?? null,
      imgOk: img ? img.naturalWidth > 0 : null,
      h: +el.getBoundingClientRect().height.toFixed(1),
    };
  });
  console.log(card ? `  ✓ 장수 카드 병기 줄 — ${JSON.stringify(card)}` : '  ✗ 장수 카드에 병기 줄이 없다');
  /* 병기 그림이 **아래 블록들과 같은 세로선에서 시작하는가** (2026-09-11).
     가운데 정렬을 왼쪽으로 바꾼 자리라, 여백 한 값만 어긋나도 층이 진다 —
     눈으로는 「살짝 밀렸나」로만 보인다. 왼쪽 x를 재서 견준다. */
  const lefts = await page.evaluate(() => {
    const x = (sel: string): number | null => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el ? Math.round(el.getBoundingClientRect().left) : null;
    };
    return { equip: x('[data-field="equip"] .frg-thumb'), story: x('.ofcard-story'), skill: x('.ofcard-skill, .ofcard-skill-art') };
  });
  const same = lefts.equip !== null && [lefts.story, lefts.skill]
    .filter((v): v is number => v !== null)
    .every((v) => Math.abs(v - lefts.equip!) <= 2);
  console.log(same
    ? `  ✓ 병기 그림이 아래 블록과 같은 세로선 (x=${lefts.equip})`
    : `  ✗ 시작 x가 어긋난다 — ${JSON.stringify(lefts)}`);

  /*
   * 해설이 UI 언어를 따라가는가 (2026-09-10에 아홉 언어를 붙였다). 화면은
   * `item.loreI18n?.[lang] ?? item.lore` 한 줄이라 **번역이 실제로 실렸는지**만
   * 보면 된다 — 언어를 바꾸고 상세 패널을 열어 한국어 원문과 다른지 본다.
   * 「있는가」가 아니라 「한국어가 아닌가」를 봐야 물러남과 구별된다.
   */
  /*
   * **장비 명 칸이 두 줄 안에 드는가** (2026-09-11). 줄 높이가 그림 높이에
   * 묶여 있어(`--frg-thumb-h`) 이름이 세 줄로 접히면 그 자리에서 잘린다 —
   * **한국어로는 절대 안 나는 일**이라(두 글자에서 일곱 글자) 다른 언어로
   * 바꿔 보지 않으면 한 번도 안 도는 갈래다. 「보이는가」가 아니라
   * `scrollHeight > clientHeight`로 **넘쳤는지**를 본다.
   */
  step('장비 명·상태 칸이 제 칸 안에 드는가 — 긴 번역으로 확인한다');
  const namesFit = async (lang: string): Promise<void> => {
    /* **기어를 누르기 전에 메인으로 되돌아간다** — 앞 걸음이 장수 카드를
       열어 둔 채 끝나면 `.modal-back`이 클릭을 가로채 30초를 기다린다
       (실제로 그랬다). 새로 고치면 열린 팝업이 전부 사라진다. */
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    await page.click('[data-action="settings"]');
    await page.waitForSelector(`[data-modal="settings"] [data-lang="${lang}"]`, { timeout: 5_000 });
    await page.click(`[data-modal="settings"] [data-lang="${lang}"]`);
    await page.waitForTimeout(250);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    await page.click('.city-gate rect');
    await page.waitForSelector('[data-place="forge"]');
    await page.click('[data-place="forge"]');
    await page.waitForSelector('[data-action="assign"]');
    await dismissDonePopups();
    await page.click('[data-action="assign"]');
    await page.waitForSelector('.frg-row:not(.frg-thead)');
    const over: string[] = [];
    for (let pageNo = 0; pageNo < 2; pageNo += 1) {
      await page.waitForTimeout(200);
      over.push(...await page.evaluate(() => {
        /* 이름 칸만 보면 안 된다 — 「지급」 칸도 번역이 길면(pt_BR "Não
           atribuída") 넘쳐서 옆 단추 위에 겹쳐 찍힌다(실제로 그랬다).
           **넘치는 칸을 전부** 훑는다. */
        const cells = [...document.querySelectorAll(
          '.frg-row:not(.frg-thead) .c-nm, .frg-row:not(.frg-thead) .c-hold',
        )] as HTMLElement[];
        return cells
          .filter((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
          .map((el) => `${el.className}:${el.textContent ?? ''} (${el.scrollHeight}>${el.clientHeight}, ${el.scrollWidth}>${el.clientWidth})`);
      }));
      const next = await page.$('[data-action="assignNextPage"]:not([disabled])');
      if (!next) break;
      await next.click();
    }
    await page.screenshot({ path: `${SHOTS}/ux-05-names-${lang}.png` });
    console.log(over.length === 0
      ? `  ✓ ${lang} — 모든 칸이 제 칸 안`
      : `  ✗ ${lang} — 넘치는 칸 ${over.length}건: ${over.join(' / ')}`);
  };
  await namesFit('pt_BR');
  await namesFit('mn');
  await namesFit('ko');

  step('언어를 바꿔 병기 해설이 따라오는지 본다');
  const loreOf = async (): Promise<string> => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    await page.click('.city-gate rect');
    await page.waitForSelector('[data-place="forge"]');
    await page.click('[data-place="forge"]');
    await page.waitForSelector('[data-action="craft"]');
    await dismissDonePopups();
    await page.click('[data-action="craft"]');
    await page.waitForSelector('.frg-tile');
    await page.click('.frg-tile');
    await page.waitForSelector('[data-action="startOrder"]');
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const lore = (document.querySelector('.frg-item-lore')?.textContent ?? '').trim();
      const eff = (document.querySelector('.frg-item-effect')?.textContent ?? '').trim();
      return `${lore}
      효과: ${eff}`;
    });
  };
  const ko = await loreOf();
  for (const lang of ['ja', 'en', 'mn']) {
    // 상세 패널을 닫고 나서 기어를 누른다 — 열린 채로는 `.modal-back`이 클릭을 가로챈다
    if (await page.$('[data-action="closeDetail"]')) await page.click('[data-action="closeDetail"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="settings"]');
    await page.waitForSelector(`[data-modal="settings"] [data-lang="${lang}"]`, { timeout: 5_000 });
    await page.click(`[data-modal="settings"] [data-lang="${lang}"]`);
    await page.waitForTimeout(250);
    const got = await loreOf();
    const same = got === ko;
    console.log(`  ${same ? '✗' : '✓'} ${lang} — ${same ? '한국어 그대로다(번역이 안 실렸다)' : got.slice(0, 120)}`);
    if (lang === 'ja') await page.screenshot({ path: `${SHOTS}/ux-06-lore-ja.png` });
  }
} catch (e) {
  console.error('✗', e);
  await page.screenshot({ path: `${SHOTS}/ux-fail.png` });
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  process.exit(0);
}
