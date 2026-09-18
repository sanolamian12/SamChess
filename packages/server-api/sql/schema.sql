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
