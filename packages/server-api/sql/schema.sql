-- 계정 API의 스키마. `psql`이나 Supabase SQL Editor에서 한 번 돌리거나,
-- tools/migrate_db.ts (npm run db:migrate)로 적용한다. 몇 번을 다시 돌려도 안전하다
-- (모두 IF NOT EXISTS / OR REPLACE).
--
-- `profiles.uid`가 `auth.users(id)`를 참조한다 — Supabase Auth가 계정을 지우면
-- `on delete cascade`로 프로필도 함께 지워진다. 정리하는 자리를 둘로 안 만든다.
--
-- PlayerProfile 전체를 `data` 한 칼럼(JSONB)에 담는다 — localStorage.ts가
-- `JSON.stringify(profile)` 한 덩어리를 저장하던 것과 같은 모양이다. 되접기
-- (`migrateProfile`)가 이미 그 모양 위에서 "형식이 바뀌어도 채워 넣는다"를 보장하므로
-- 그대로 재사용된다. 이력(`matches`)을 별도 테이블로 떼는 건 행 크기가 실제로
-- 문제가 될 때 하는 것으로 미룬다.

create table if not exists profiles (
  uid uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- 도시 이름은 계정 사이에 고유하다 (2026-09-19). 랭킹에서 도시 이름이 유일한 공개
-- 식별자인데(이메일은 안 싣는다) 같은 이름이 여럿이면 누가 누군지 가릴 수 없다.
-- **대소문자는 무시한다**(`lower`). 앞뒤 공백·유니코드 꼴은 저장하기 전에 서버가
-- 편다(`normalizeCityName`) — 여기서 `normalize()`를 부르지 않는 것은 인덱스 식이
-- 불변(IMMUTABLE) 함수만 받기 때문이다. 동시에 같은 이름을 골라도 둘 중 하나는
-- 여기서 거절된다 — 서버는 그 오류(23505)를 「이미 있는 이름」(409)으로 돌린다.
-- 겹치는 행이 이미 있으면 이 줄이 실패한다 — 먼저 정리하고 돌린다.
create unique index if not exists profiles_city_name_key on profiles (lower(data->>'cityName'));

-- ★ RLS (2026-10-20). Supabase는 public 스키마의 표를 REST(PostgREST)로 내보내고, 처음 만든 표는
-- anon · authenticated 역할에 읽기 · 쓰기가 다 열려 있다. RLS가 꺼져 있던 동안 **클라이언트 번들에
-- 든 공개 키 하나로 모든 계정의 행을 읽고 고칠 수 있었다** — 서버 소유 필드(`guardServerOwned`)도
-- 금화 경로도 전부 건너뛰는 길이다. 켜고 정책을 두지 않으면 REST로는 한 줄도 안 닿는다.
-- 이 저장소는 REST를 쓰지 않는다 — server-api · 도구는 직접 연결(postgres 역할)이라 RLS를 거치지 않는다.
alter table profiles enable row level security;

-- ── 관리자 (2026-10-20, `packages/server-api/src/admin/`) ──────────────────
--
-- **감사 로그** — 관리자가 계정을 고친 일은 전부 여기 한 줄씩 남는다(누가 · 누구에게 ·
-- 무엇을 · 왜). 계정을 바꾸는 트랜잭션과 **같은 트랜잭션**에서 적는다 — 로그 없이 바뀐
-- 계정도, 바뀌지 않았는데 남은 로그도 없게 한다(`admin/store.ts`의 `mutateWithAudit`).
--
-- `target_uid`에 외래 키를 걸지 않는다 — 계정이 지워져도(`auth.users` cascade) 그 계정에
-- 무엇을 했는지는 남아야 한다. 고객 문의 · 분쟁의 근거가 이 표다.
--
-- `before`/`after`는 프로필 전체가 아니라 **바뀐 최상단 필드만** 담는다(행이 커지지 않게).

create table if not exists admin_audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  admin_uid uuid not null,
  admin_email text not null,
  target_uid uuid,
  action text not null,
  params jsonb not null default '{}'::jsonb,
  reason text not null check (length(btrim(reason)) > 0),
  before jsonb,
  after jsonb
);

-- 누가 **어떤 자격으로**(admin · cs, 2026-10-21c) — 옛 줄은 전부 관리자였다. CS 하루 합계도 이 칸으로 센다(`admin/store.ts`)
alter table admin_audit_log add column if not exists admin_role text not null default 'admin';

create index if not exists admin_audit_log_target_at on admin_audit_log (target_uid, at desc);
create index if not exists admin_audit_log_at on admin_audit_log (at desc);

-- Supabase는 public 스키마의 표를 REST(PostgREST)로 내보낸다. RLS를 켜고 정책을 두지 않으면
-- anon · authenticated 키로는 한 줄도 못 읽는다 — server-api는 직접 연결(postgres 역할)이라 그대로 쓴다
alter table admin_audit_log enable row level security;

-- ── 우편함 (2026-10-21, `packages/meta/src/mail.ts`) ──────────────────────
--
-- **우편 한 통 = 한 줄.** 운영(관리자)만 보낸다 — 유저끼리 글을 주고받는 우편은 없다. 보내는 것은 이 표에 한 줄 적기로
-- 끝나고(수천 계정을 하나씩 안 고친다), 받기는 플레이어가 [받기]를 누를 때 그 계정 행을 잠근 채 한다. 「한 번만」의 고리는
-- 계정의 `mailbox`(서버 소유)다 — 이 표에는 누가 받았는지를 적지 않는다.
--
-- `target_uid`가 비면 **전체**다 — 그때는 **보낸 시각보다 먼저 가입한 계정**(`auth.users.created_at <= sent_at`)에게만
-- 보인다(장애 보상을 나중에 가입한 사람이 못 받게). 외래 키를 걸지 않는다 — 감사 로그처럼, 계정이 지워져도 보낸 기록은 남는다.
-- `title` · `body`는 언어별 `{ko, en, …}`(ko는 꼭 있다), `rewards`는 관리자 지급과 같은 모양의 지급 쪽 배열(비면 공지 우편).
-- 기한은 보낸 시각 + 30일 고정(`MAIL_TTL_MS`) — 서버가 `expires_at`을 그 값으로 적는다. `revoked_at`이 있으면 회수된 것이다
-- (목록에서 빠지고 못 받는다. 이미 받은 것은 그대로).

create table if not exists mail (
  id bigserial primary key,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  target_uid uuid,
  title jsonb not null,
  body jsonb not null,
  rewards jsonb not null default '[]'::jsonb,
  sent_by text not null,
  revoked_at timestamptz,
  check (expires_at > sent_at),
  check (title ? 'ko' and body ? 'ko')
);

create index if not exists mail_target_sent on mail (target_uid, sent_at desc);
create index if not exists mail_expires on mail (expires_at);

-- public 스키마의 새 표는 REST로 열린다 — RLS를 켜고 정책을 두지 않는다(위 두 표와 같다)
alter table mail enable row level security;

-- ── 일별 접속 (2026-10-22) ───────────────────────────────────────────────
--
-- **계정마다 하루(KST)에 한 줄.** 게임 API가 계정을 읽을 때(`GET /profile`) 그날 첫 번만 넣는다(`src/activity.ts`) — 관리자
-- 대시보드의 「일별 접속자」가 센다. Supabase는 계정마다 마지막 로그인 하나만 남겨 그것만으로는 날마다 셀 수 없었다.
-- 하루 경계는 `raidDay()`(KST 자정, CS 하루 상한과 같은 날)이고 서버가 적는다. 계정이 지워지면 줄도 함께 지워진다.
-- 보관 기한은 두지 않는다 — 한 줄이 작고(날짜 + uid) 하루에 접속자 수만큼만 는다.

create table if not exists daily_active (
  day date not null,
  uid uuid not null references auth.users(id) on delete cascade,
  primary key (day, uid)
);

create index if not exists daily_active_uid on daily_active (uid);

alter table daily_active enable row level security;

-- ── 수비군 (2026-10-27, `packages/meta/src/garrison.ts` · GDD §8.8) ──────────────────
--
-- **계정마다 모드(3v3 · 5v5)당 한 줄** — 공성전에서 다른 플레이어가 공격해 올 때 성을 지키는 부대의 스냅샷이다.
-- 도시 목록(GDD §8.8 단계 2)이 사람을 가로질러 **도시 레벨 · 전투력으로** 찾아야 해서 `profiles.data` 안이 아니라 표다.
-- 계정을 쓸 때마다 **같은 트랜잭션에서** 다시 낸다(`src/defenses.ts`의 `syncDefenses`, `profileStore.ts`의 `transact`) —
-- 부대는 장수의 「소속」이라 레벨업 · 재설계가 곧바로 수비군을 바꾸기 때문이다. 바뀐 것이 없으면 쓰지 않는다.
-- 「최근에 들어왔는가」는 따로 적지 않는다 — `profiles.updated_at`과 잇는다(쓸 때마다 한 줄 더 쓰지 않게).
-- `snapshot`은 `{ entries, deploy, policy }` — 명단(시각 없는, 매칭과 같은 눈금) · 북군 배치 프리셋(없으면 null) · 방어 AI 방침.

create table if not exists defenses (
  uid uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('3v3', '5v5')),
  squad_id text not null,
  squad_name text not null,
  power integer not null,
  city_level integer not null,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (uid, mode)
);

create index if not exists defenses_mode_level_power on defenses (mode, city_level, power);

alter table defenses enable row level security;

-- ─────────────────────────────────────────────────────────────────────
-- 방어 기록 (2026-10-27, GDD §8.8 단계 2)
-- ─────────────────────────────────────────────────────────────────────
--
-- 공성전 한 판이 끝날 때마다 **한 줄을 덧붙이기만** 한다 — 방어자의 계정 행을 잡지 않는다(인기 있는 수비군에
-- 정산이 몰려도 행 잠금이 줄 서지 않는다). 방어자에게는 약탈도 보상도 없고, 화면은 이 표로 방어 히스토리와
-- 방어 승률만 보여 준다(단계 5). 랭킹 점수에는 안 들어간다.
-- `winner`는 엔진의 진영이다 — 공격한 쪽이 'P1', 수비군이 'P2', 무승부는 null.
-- `replay`는 `{ entries: {P1, P2}, deploy: {P1, P2}, intents }` — 시드와 함께 그 판을 처음부터 다시 돌릴 수 있다(리플레이, 단계 5).
-- `reason`은 'settled'(끝까지 둔 판) · 'abandoned'(60분 방치 · 관리자 정리 — 공격한 쪽의 패배).
-- 공격한 계정이 지워져도 방어자의 기록은 남는다(`on delete set null`, 도시 이름은 그때의 값을 적어 둔다).

create table if not exists defense_log (
  id bigserial primary key,
  defender_id uuid not null references auth.users(id) on delete cascade,
  attacker_id uuid references auth.users(id) on delete set null,
  attacker_city text not null,
  mode text not null check (mode in ('3v3', '5v5')),
  seed bigint not null,
  winner text check (winner in ('P1', 'P2')),
  reason text not null check (reason in ('settled', 'abandoned')),
  attacker_power integer not null,
  defender_power integer not null,
  defender_squad text not null,
  replay jsonb not null,
  at timestamptz not null default now()
);

create index if not exists defense_log_defender_at on defense_log (defender_id, at desc);

alter table defense_log enable row level security;
