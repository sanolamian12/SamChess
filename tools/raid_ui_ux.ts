/**
 * 도적떼 알림 · 메인 [토벌] · 농지 [도적단 퇴치] 눈 확인 (2026-11-20 기획자 개편).
 *
 *   npm run server-api · npm run dev 가 떠 있어야 한다
 *   node --experimental-strip-types --env-file=.env tools/raid_ui_ux.ts
 *
 * 시험 계정에 농지 Lv3 · 보초병 셋 · 도적 셋을 심고, 언어 열 개로 알림을 찍으며 판 안의 글자가
 * 넘치는지(`scrollWidth > clientWidth`) 잰다. 보초병이 없는 알림(「미편성」) · 메인 · 농지도 찍는다.
 * [자동 전투](2026-11-27)도 — 예측 판을 언어마다 찍고, 판이 화면 안에 드는지 재고, 승 · 패를 하나씩 실행한다.
 * 사진은 OS 임시 폴더(`SHOTS`로 바꾼다).
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { SORTIE_TUTORIALS, addSquad, garrisonOf, newInstance, officerDuty, raidDay, setGuards, squadAt } from '../packages/meta/src/index.ts';
import type { OfficerId, PieceType } from '@samchess/rules';
import type { PlayerProfile } from '../packages/meta/src/index.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { pool } from '../packages/server-api/src/db.ts';
import { shotDir } from './shotDir.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? shotDir('raid_ui');
const LANGS = ['ko', 'en', 'es_419', 'it', 'ja', 'mn', 'pt_BR', 'pt_PT', 'zh_Hans', 'zh_Hant'];

const ok = (m: string) => console.log(`  ✓ ${m}`);
let failed = 0;
const bad = (m: string) => { failed++; console.error(`  ✗ ${m}`); };

const email = `raid-ui-${randomUUID()}@samchess.test`;
const password = randomUUID();
const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
if (!createRes.ok) throw new Error(`계정 생성 실패 — ${createRes.status}`);
const uid = (await createRes.json() as { id: string }).id;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const shot = async (name: string) => { await page.screenshot({ path: `${SHOTS}/${name}.png` }); ok(`📷 ${SHOTS}/${name}.png`); };

function withGarrisons(p: PlayerProfile): PlayerProfile {
  if (garrisonOf(p, '3v3') && garrisonOf(p, '5v5')) return p;
  const pieces: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen'];
  const ids = (Object.keys(p.roster) as OfficerId[]).filter((id) => id !== 'heon-je').slice(0, 5);
  let next: PlayerProfile = p;
  for (const size of [3, 5]) {
    const picks = ids.slice(0, size).map((officer, i) => ({ piece: pieces[i]!, officer }));
    const mode = size === 3 ? '3v3' : '5v5';
    if (!squadAt(next, mode, 'defense')) next = addSquad(next, { mode, role: 'defense', picks }).profile;
  }
  return next;
}

/** 보초병 `guards`명 · 도적 `bandits`명 — 농지 레벨은 둘 중 큰 쪽(보초병 칸 = 농지 레벨) */
async function seed(guards: number, bandits = guards || 3): Promise<void> {
  const stored = (await getProfile(uid))!;
  const farm = Math.max(3, guards, bandits);
  let p = withGarrisons({ ...stored, cityLevel: Math.max(3, farm), grain: 60, buildings: { ...stored.buildings, barracks: 2, farm } });
  const roster = { ...p.roster };
  const extra = ['yu-bi', 'gwan-u', 'jang-bi', 'jo-un', 'ma-cho', 'hwang-chung', 'jo-jo', 'jang-ryo', 'ju-yu'] as OfficerId[];
  for (const id of extra) if (!roster[id]) roster[id] = newInstance(id);
  p = { ...p, roster, farmGuards: [] };
  const pieces: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Pawn'];
  // 부대(수비대)에 든 장수는 보초병이 못 된다 — 비어 있는 장수만 고른다
  const free = extra.filter((id) => officerDuty(p, id) !== 'squad');
  if (guards) p = setGuards(p, free.slice(0, guards).map((officer, i) => ({ piece: pieces[i]!, officer })));
  p = { ...p, raid: { day: raidDay(Date.now()), bandits, spawnedAt: Date.now(), grainAtSpawn: p.grain, status: 'pending' } };
  await saveProfileTrusted(uid, { ...p, tutorial: { done: [...SORTIE_TUTORIALS] } });
}

/** 뒷줄 꼬마가 판 천장(위 테 안쪽)에 닿는가 · 「미편성」 획이 한 줄에 드는가 */
const vsCheck = () => page.evaluate(() => {
  const out: string[] = [];
  const vs = document.querySelector<HTMLElement>('.raid-vs');
  if (!vs) return ['(대치 판 없음)'];
  const top = vs.getBoundingClientRect().top + parseFloat(getComputedStyle(vs).borderTopWidth);
  for (const el of vs.querySelectorAll<HTMLElement>('.raid-vs-slot[data-row="back"]')) {
    const t = el.getBoundingClientRect().top;
    if (t < top) out.push(`뒷줄이 천장에 닿음 (${Math.round(top - t)}px)`);
  }
  const u = vs.querySelector<HTMLElement>('.raid-vs-unassigned');
  if (u) {
    if (u.scrollWidth > u.clientWidth + 1) out.push(`미편성 획 넘침 ${u.scrollWidth}>${u.clientWidth}`);
    if (u.getBoundingClientRect().height > 30) out.push('미편성 두 줄');
  }
  return out;
});

/** 판이 화면(프레임) 안에 다 드는가 — 스크롤이 없으므로 넘치면 잘린다 */
const fits = () => page.evaluate(() => {
  const box = document.querySelector('.raid-alert-box')!.getBoundingClientRect();
  const frame = document.querySelector('#frame')!.getBoundingClientRect();
  return box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1 ? [] : [`판이 화면 밖 (판 ${Math.round(box.top)}~${Math.round(box.bottom)}, 화면 ${Math.round(frame.top)}~${Math.round(frame.bottom)})`];
});

/** 알림 판 안에서 글자가 넘친 요소 */
const overflow = () => page.evaluate(() => {
  const box = document.querySelector('.raid-alert-box');
  if (!box) return ['(알림 없음)'];
  const out: string[] = [];
  const br = box.getBoundingClientRect();
  for (const el of box.querySelectorAll<HTMLElement>('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') out.push(`잘림 ${el.className} «${el.textContent?.trim().slice(0, 30)}»`);
    if (el.matches('.lbl, .raid-vs-cap, dd, dt, .raid-left > span') && (r.right > br.right + 1 || r.left < br.left - 1)) out.push(`판 밖 ${el.className} «${el.textContent?.trim().slice(0, 30)}»`);
  }
  for (const b of box.querySelectorAll<HTMLElement>('.btn .lbl')) {
    if (b.getBoundingClientRect().height > 30) out.push(`단추 두 줄 «${b.textContent}»`);
  }
  return out;
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', `토벌-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });
  }
  ok('도시가 섰다');

  // 5 대 5 · 보초병 없음 — 언어 열 개씩
  for (const [tag, g, bn] of [['5v5', 5, 5], ['none', 0, 5]] as const) {
    await seed(g, bn);
    for (const lang of LANGS) {
      await page.evaluate((l) => localStorage.setItem('samchess.lang', l), lang);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('[data-modal="raidAlert"][data-kind="first"]', { timeout: 20_000 });
      await page.waitForTimeout(600);
      const o = [...await overflow(), ...await vsCheck(), ...await fits()];
      if (o.length) bad(`${tag} ${lang} — ${o.join(' / ')}`); else ok(`${tag} ${lang} — 넘침 없음`);
      await shot(`alert-${tag}-${lang}`);
      // [자동 전투] → 예측 판 → [취소]로 돌아온다
      await page.click('[data-action="raidAuto"]');
      await page.waitForSelector('[data-modal="raidAlert"][data-kind="auto"]');
      await page.waitForTimeout(300);
      const a = [...await overflow(), ...await vsCheck(), ...await fits()];
      const pw = await page.evaluate(() => [document.querySelector('[data-field="minePower"]')?.getAttribute('data-power'), document.querySelector('[data-field="theirPower"]')?.getAttribute('data-power')]);
      if (a.length) bad(`자동 ${tag} ${lang} — ${a.join(' / ')}`); else ok(`자동 ${tag} ${lang} — 넘침 없음 · 전투력 ${pw.join(' vs ')}`);
      await shot(`auto-${tag}-${lang}`);
      await page.click('[data-action="raidAutoCancel"]');
      await page.waitForSelector('[data-modal="raidAlert"][data-kind="first"]');
    }
  }
  await page.evaluate(() => localStorage.setItem('samchess.lang', 'ko'));
  if (!await page.$('[data-action="raidFightNow"][data-lead="1"]')) bad('보초병이 없는데 [지금 전투]가 이끌지 않는다');

  // 셋 · 넷 — 한 줄 · 뒷줄 하나
  for (const n of [3, 4]) {
    await seed(n, n);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-modal="raidAlert"][data-kind="first"]', { timeout: 20_000 });
    await page.waitForTimeout(600);
    await shot(`alert-${n}v${n}-ko`);
  }

  // 자동 전투 실행 — 보초병 없음(패배 → 약탈) · 보초병 셋 대 도적 하나(승리 → 약탈도 보상도 없음)
  for (const [tag, g, bn] of [['lose', 0, 3], ['win', 3, 1]] as const) {
    await seed(g, bn);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-modal="raidAlert"][data-kind="first"]', { timeout: 20_000 });
    await page.click('[data-action="raidAuto"]');
    await page.waitForSelector('[data-modal="raidAlert"][data-kind="auto"]');
    const expect = await page.$eval('[data-field="verdict"]', (e) => e.getAttribute('data-win'));
    const shown = Number(await page.$eval('[data-field="loot"]', (e) => e.getAttribute('data-loot')).catch(() => '0'));
    if (expect !== (tag === 'win' ? '1' : '0')) bad(`${tag} 예측이 ${expect}`);
    await shot(`auto-run-${tag}-before`);
    await page.click('[data-action="raidAutoRun"]');
    await page.waitForSelector('[data-modal="raidAlert"][data-kind="autoDone"]', { timeout: 10_000 });
    await page.waitForTimeout(800);
    await shot(`auto-run-${tag}-done`);
    const stored = (await getProfile(uid))!;
    const want = tag === 'win' ? 'won' : 'lost';
    if (stored.raid?.status !== want || stored.raid.auto !== true) bad(`${tag} 저장 상태 ${stored.raid?.status} auto=${stored.raid?.auto}`);
    else if ((stored.raid.loot ?? 0) !== shown) bad(`${tag} 약탈 ${stored.raid.loot} ≠ 예측 판 ${shown}`);
    else if (tag === 'win' && stored.raid.rewards) bad('승리인데 보상이 붙었다');
    else ok(`${tag} 실행 — ${want} · 약탈 ${stored.raid.loot ?? 0} (예측 판 ${shown})`);
    await page.click('[data-action="raidOk"]');
    await page.waitForSelector('[data-modal="raidAlert"]', { state: 'detached' });
  }
  await seed(3);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-action="raidClose"]', { timeout: 20_000 });

  await page.click('[data-action="raidClose"]');
  await page.waitForSelector('[data-modal="raidAlert"]', { state: 'detached' });
  await page.waitForTimeout(400);
  await shot('main');
  const align = await page.evaluate(() => {
    const lv = document.querySelector('.scr-main [data-field="cityLevel"]')!.getBoundingClientRect();
    const btn = document.querySelector('.scr-main .city-raid-btn')!.getBoundingClientRect();
    return { lvTop: Math.round(lv.top), lvBottom: Math.round(lv.bottom), btnTop: Math.round(btn.top), btnBottom: Math.round(btn.bottom), label: document.querySelector('.scr-main .city-raid-btn .lbl')!.textContent };
  });
  ok(`메인 정렬 ${JSON.stringify(align)}`);

  await seed(3);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-action="raidClose"]', { timeout: 20_000 });
  await page.click('[data-action="raidClose"]');
  await page.waitForSelector('[data-modal="raidAlert"]', { state: 'detached' });
  // 농지는 성 밖이다 — [마을로] 문을 지나 논밭을 누른다
  await page.click('.city-gate', { timeout: 10_000, force: true });
  await page.waitForTimeout(1500);
  await page.click('[data-place="farm"]', { timeout: 10_000, force: true });
  await page.waitForSelector('.scr-building-farm', { timeout: 10_000 });
  await page.waitForTimeout(600);
  await shot('farm');
  const sizes = await page.evaluate(() => {
    const a = document.querySelector('.frm-cmd [data-action="raidFight"]')!.getBoundingClientRect();
    const b = document.querySelector('.frm-cmd [data-action="toTown"]')!.getBoundingClientRect();
    return { fight: [Math.round(a.width), Math.round(a.height), Math.round(a.top)], town: [Math.round(b.width), Math.round(b.height), Math.round(b.top)] };
  });
  ok(`농지 단추 ${JSON.stringify(sizes)}`);
} catch (e) {
  bad(String(e));
  await page.screenshot({ path: `${SHOTS}/fail.png` }).catch(() => {});
} finally {
  await browser.close().catch(() => {});
  await pool.query('delete from profiles where uid = $1', [uid]).catch(() => {});
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  await pool.end().catch(() => {});
  console.log(failed ? `\n✗ ${failed}건` : '\n✓ 끝');
  process.exit(failed ? 1 : 0);
}
