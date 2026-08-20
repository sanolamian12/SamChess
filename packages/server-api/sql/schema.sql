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
