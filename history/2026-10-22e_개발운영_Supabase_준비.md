# 2026-10-22e — 개발 / 운영 Supabase 분리 준비 · 운영에서의 smoke:admin

인수인계서 §5 순서의 넷째 · 다섯째(2026-10-22c의 표). 다른 세션의 튜토리얼 작업(`6fcfd0c`~`e34c136`)이 커밋된 뒤 이어서 했다 —
시작할 때 두 저장소 모두 원격과 같고 작업 트리가 깨끗했으며, 합쳐진 상태에서 `npm test` 1055 · `typecheck` · `typecheck:admin` · 관리자 `build` 통과.

## 결정 (기획자)

- **지금 프로젝트 = 개발, 운영은 새로 만든다** — 저장소의 `.env`가 그대로라 다른 세션 · 스모크 · 도구에 영향이 없고, 운영은 시험 흔적 없이 시작한다.
- **운영 프로젝트는 배포 직전에** — 지금은 준비만.
- 「프로젝트가 둘이면 과금되나」를 확인했다 — **무료 플랜은 활성 2개까지 $0**(3개째는 청구가 아니라 생성이 막힌다), TOTP MFA는 모든 플랜 무료.
  대신 **무료 프로젝트는 1주일 활동이 없으면 잠든다** — 출시 전에 운영을 만들어 두면 잠들어서, 「배포 직전」이 맞다. 실제 서비스는 Pro($25/월) 검토.
- **운영에서는 `smoke:admin`을 돌리지 않는다**(§5의 다섯째가 이것으로 닫혔다) — 개발 DB에서만, 운영 확인은 `db:check:prod`와 실제 플레이로.

## 만든 것

| 자리 | 내용 |
|---|---|
| `server-api/src/environment.ts` (새) | `SAMCHESS_ENV`(`development` · 비움 · `production`, **오타는 개발로 물러나지 않는다**). 운영이면 게임 API가 **개발용 지급 켜짐 · `SAMCHESS_WEB_ORIGIN` 없음(CORS 전부 열림) · 내부 비밀 32자 미만**을 하나하나 적고 뜨지 않는다. 순수 함수 + 회귀 3건 |
| `server-api/src/main.ts` | 부팅 때 그 검사. 그리고 CORS `?? true` → `\|\| true` — `.env.example`을 그대로 복사한 빈 칸이 CORS 주소(빈 글자)가 되어 모든 요청이 막히는 것을 막았다 |
| `tools/db_check.ts` (새) · `npm run db:check` / `:prod` | **읽기만** — 프로젝트 ref · `SAMCHESS_ENV`, `schema.sql`이 만드는 표 · 인덱스(목록을 그 파일에서 읽어 스키마가 늘면 검사도 는다), public 표 **전부**의 RLS, Auth 설정(`/auth/v1/settings` — 이메일 가입 · 익명 로그인 · 확인 메일), 서비스 키로 Admin API, 계정 · 관리자 수. 운영이면 관리자 0명 · 시험 계정이 ✗ |
| `tools/devOnly.ts` (새) | `refuseProduction()` — `smoke:admin`이 운영 표시에서 시작하지 않는다 |
| `package.json` | `db:migrate:prod` · `db:check` · `db:check:prod` · `admin:role:prod` — 운영은 **이름으로 골라야만** 간다(`--env-file=.env.production`) |
| `.env.example` | `SAMCHESS_ENV` · `SAMCHESS_WEB_ORIGIN`과 개발 / 운영 설명 |
| `docs/운영_Supabase.md` (새) | 운영 프로젝트를 만드는 순서 · 키 목록 · 값이 사는 파일 · 운영에서 하지 않는 것. 공개 저장소라 실제 ref · 키는 안 적었다 |
| `SamChessAdmin/.gitignore` | `.env.*` + `!.env.example` — 전에는 `.env` · `.env.local`만 막아 Vite의 `.env.production`이 커밋에 섞일 수 있었다 |
| CLAUDE.md | 명령 목록에 `db:check`, 규칙 「`.env`는 개발, 운영은 `.env.production`」 |

## 알게 된 것

- **코드에 프로젝트 주소가 하나도 박혀 있지 않았다** — 전부 환경 변수. 표도 넷뿐이고 전부 `schema.sql`에 있어 `db:migrate` 한 번이면 선다.
  손으로 맞출 것은 **대시보드 설정**(확인 메일 · Site URL · 리디렉트 · SMTP)과 관리자 역할뿐이다.
- 개발 프로젝트는 **「확인 메일」이 켜져 있다**(`mailer_autoconfirm: false`) — 운영도 같게 둔다(CLAUDE.md의 `signUp` 응답 모양 이야기).
- **`vite build`는 `.env.production`을 `.env`보다 앞세운다** — 운영 파일이 생기면 로컬 빌드도 운영으로 로그인한다. 개발 서버는 그대로다. 문서에 적었다.
- 스모크 · `*_ux` 도구 20여 개에는 운영 거절을 넣지 않았다 — 다른 세션들이 고치는 파일이고, 전부 `--env-file=.env`만 읽어 구조로 이미 개발에 묶여 있다.
  `smoke:admin`(전체 공지를 보내는 유일한 것)에만 두 번째 문을 달았다.

## 검사

- 실패를 먼저 —
  - 게임 API를 `SAMCHESS_ENV=production SAMCHESS_DEV_GRANTS=1`로 띄우자 「계정 API을(를) 띄우지 않는다」 + 두 줄(지급 · CORS)로 exit 1.
  - `schema.sql`에 없는 표 한 줄을 잠깐 적자(마이그레이트 없이) `db:check`가 ✗ · exit 1, 되돌리자 ✓.
  - `SAMCHESS_ENV=production npm run db:check` — 개발 DB의 시험 계정 1개를 ✗로 잡았다.
  - `SAMCHESS_ENV=production npm run smoke:admin` — 시작하지 않고 exit 1.
- 개발 `db:check` ✓(스키마 표 4 · 인덱스 6 · RLS 4/4 · Auth · 서비스 키).
- `npm test` 1058 · `typecheck` · `typecheck:admin` 통과 · `smoke:admin`(개발) 27건 통과(exit 0).

## 남은 것

- 운영 프로젝트 만들기(배포 직전, 기획자) → `docs/운영_Supabase.md` §2 순서대로.
- 서버 셋 · 두 화면을 어디에 배포할지 — 정해지면 그 문서의 「배포 서버」 줄과 관리자 API를 밖에 열지(`SAMCHESS_ADMIN_HOST`).

## 커밋

| 저장소 | 커밋 | 내용 |
|---|---|---|
| SamChess | `7602ea3` | `environment.ts` · 회귀 · `main.ts` · `db_check.ts` · `devOnly.ts` · `smoke_admin.ts` · `package.json` · `.env.example` · `docs/운영_Supabase.md` · CLAUDE.md · 이 기록 |
| SamChessAdmin | `4f26da2` | `.gitignore` · 인수인계서 §5 |
