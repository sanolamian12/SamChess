/**
 * 개발용 — **내 계정에 대장간과 금화를 심는다** (2026-09-10).
 *
 *   npm run seed:forge -- --email me@example.com
 *   npm run seed:forge -- --email me@example.com --forge 5 --gold 500 --materials 100
 *   npm run seed:forge -- --email me@example.com --owned dae-gam-do,su-geuk
 *
 * 대장간을 정식으로 지으려면 도시 Lv2(자재 10) → 건설 기회 → 건설이고, 자재는
 * 장터에서 금화로 사고 금화는 전투로 번다 — **눈으로 화면을 확인하려는데 그
 * 앞길이 너무 길다.** 그래서 서버가 가진 프로필을 직접 그 상태로 만든다.
 *
 * ★ **`?forgeLevel=`과는 다른 것이다.** 그쪽은 **화면만** 속이므로 제작을 누르면
 * 서버가 거절한다(`ForgeScreen`의 그 블록 주석 참조). 이쪽은 계정을 **진짜로**
 * 그 상태로 만들기 때문에 제조·지급이 실제로 돈다.
 *
 * ★ **로컬 개발 전용.** `SUPABASE_SECRET_KEY`로 관리자 API를 부르므로 `.env`가
 * 있는 개발 기계에서만 돈다. 게임 안에는 이런 통로가 없다.
 */
import { equipmentById } from '@samchess/data';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY'];
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('✗ .env의 SUPABASE_URL / SUPABASE_SECRET_KEY가 없다');
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const email = arg('email');
if (!email) {
  console.error('✗ 쓰는 법: npm run seed:forge -- --email <로그인 이메일> [--forge 5] [--gold 500] [--materials 100] [--owned id,id]');
  process.exit(1);
}
const forge = Number(arg('forge') ?? 5);
const gold = Number(arg('gold') ?? 500);
const materials = Number(arg('materials') ?? 100);
const owned = (arg('owned') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

for (const id of owned) {
  if (!equipmentById.get(id)) {
    console.error(`✗ '${id}'는 장비 id가 아니다 — packages/data/generated/equipment.json 참고`);
    process.exit(1);
  }
}

/** 이메일로 uid를 찾는다 — 관리자 목록 API에 이메일 필터가 있다 */
const res = await fetch(
  `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
  { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } },
);
if (!res.ok) {
  console.error(`✗ 계정 조회 실패 — ${res.status} ${await res.text()}`);
  process.exit(1);
}
const found = (await res.json() as { users?: { id: string; email?: string }[] }).users ?? [];
const user = found.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`✗ '${email}' 계정이 없다 — 게임에서 먼저 가입한다 (찾은 것: ${found.length}개)`);
  process.exit(1);
}

const profile = await getProfile(user.id);
if (!profile) {
  console.error('✗ 이 계정에 아직 도시가 없다 — 게임에 로그인해 도시 이름부터 짓는다');
  process.exit(1);
}

/*
 * **도시 레벨도 함께 올린다** — 대장간은 추가 건물이라 도시가 Lv2 미만이면
 * 도시 관리 화면에서 아예 안 보인다(레벨을 안 올리면 「심었는데 산 너머에
 * 대장간이 잠겨 있다」로 보인다).
 */
const next = {
  ...profile,
  gold, materials,
  cityLevel: Math.max(profile.cityLevel, 5),
  buildings: { ...profile.buildings, forge },
  forgeOwned: { ...profile.forgeOwned, ...Object.fromEntries(owned.map((id) => [id, null])) },
};
await saveProfileTrusted(user.id, next as Parameters<typeof saveProfileTrusted>[1]);

console.log(`✓ ${email}`);
console.log(`  도시 Lv${next.cityLevel} · 대장간 Lv${forge} · 금화 ${gold} · 자재 ${materials}`);
if (owned.length) console.log(`  보유 병기(미지급) — ${owned.join(', ')}`);
console.log('  브라우저에서 **새로고침**하면 반영된다 (화면이 서버 값을 다시 읽는다)');
process.exit(0);
