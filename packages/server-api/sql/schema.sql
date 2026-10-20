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

create index if not exists admin_audit_log_target_at on admin_audit_log (target_uid, at desc);
create index if not exists admin_audit_log_at on admin_audit_log (at desc);

-- Supabase는 public 스키마의 표를 REST(PostgREST)로 내보낸다. RLS를 켜고 정책을 두지 않으면
-- anon · authenticated 키로는 한 줄도 못 읽는다 — server-api는 직접 연결(postgres 역할)이라 그대로 쓴다
alter table admin_audit_log enable row level security;
