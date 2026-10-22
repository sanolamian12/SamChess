# 개발 / 운영 Supabase — 운영 프로젝트를 만드는 절차

**읽는 사람: 배포를 준비하는 사람(기획자 · 본체 세션).** 2026-10-22에 정했다 — **지금 쓰는 프로젝트가 개발**이고, **운영은 배포 직전에
새로 만든다.** 저장소의 `.env`는 계속 개발을 가리키므로 스모크 · 도구 · 다른 세션은 아무것도 바뀌지 않는다.

## 0. 왜 「배포 직전」인가 · 돈

- 무료 플랜은 **활성 프로젝트 2개까지 $0**(개발 + 운영). 3개째는 청구가 아니라 **안 만들어진다**. 결제 수단이 없어 청구될 길이 없다.
- 무료 프로젝트는 **1주일 동안 활동이 없으면 잠든다**(데이터는 남고 대시보드에서 깨운다). 출시 전에 운영을 만들어 두면 잠들어 의미가 없다.
- 관리자 로그인의 **TOTP MFA는 모든 플랜에서 무료**다(유료는 문자 · 왓츠앱 MFA — 안 쓴다).
- 실제 서비스로 굴리면 운영만 **Pro($25/월, 잠들지 않음)**를 검토한다 — 결제(금화 판매)를 붙이는 때가 자연스럽다.

## 1. 값이 어디에 사는가

| 파일 | 가리키는 것 | git | 누가 읽나 |
|---|---|---|---|
| `SamChess/.env` | **개발** | ✗ | 서버 셋(게임 API · 관리자 API · 대전 서버), `npm run` 도구 전부, 게임 화면 `vite`(개발 서버) |
| `SamChess/.env.production` | **운영** | ✗ (`.env.*`) | `:prod` 명령(`db:migrate:prod` · `db:check:prod` · `admin:role:prod`), 게임 화면 **`vite build`**(VITE_ 값만) |
| `SamChessAdmin/.env.local` | 개발 | ✗ | 관리자 화면 `vite`(개발 서버) |
| `SamChessAdmin/.env.production` | 운영 | ✗ (`.env.*`, 2026-10-22에 막음) | 관리자 화면 **`npm run build`** |
| 배포 서버의 환경 변수 | 운영 | — | 운영에서 도는 서버 셋. `.env.production`과 같은 값 |

⚠ **`vite build`는 `.env.production`이 있으면 그것을 `.env`보다 앞세운다**(Vite 규칙). 운영 파일을 만든 뒤 로컬에서 `vite build`를 하면
그 빌드는 **운영 프로젝트로 로그인한다.** 개발 서버(`vite`, `npm run dev`)는 그대로 개발이다.

### 키 목록 — `.env.example`과 같고 운영에서 값이 다른 것

| 키 | 운영에서 |
|---|---|
| `SAMCHESS_ENV` | **`production`** — 게임 API가 아래 셋을 확인하고, 틀리면 뜨지 않는다(`server-api/src/environment.ts`) · `smoke:admin`이 멈춘다 |
| `SUPABASE_URL` · `VITE_SUPABASE_URL` | 운영 프로젝트의 주소(둘이 같아야 한다 — `db:check`가 본다) |
| `SUPABASE_ANON_KEY` · `VITE_SUPABASE_ANON_KEY` | 운영 프로젝트의 publishable 키 |
| `SUPABASE_SECRET_KEY` | 운영 프로젝트의 secret 키 — **서버에만** |
| `SUPABASE_DB_URL` | 운영 프로젝트의 **Transaction Pooler**(`…pooler.supabase.com:6543`) — Direct는 IPv6 전용이라 막힌다(CLAUDE.md) |
| `INTERNAL_API_SECRET` | **새로 만든다**, 32자 이상(`openssl rand -hex 32`) — 짧으면 게임 API가 안 뜬다 |
| `SAMCHESS_DEV_GRANTS` | **비운다** — `1`이면 게임 API가 안 뜬다 |
| `SAMCHESS_WEB_ORIGIN` | 게임 화면의 배포 주소 — 없으면 게임 API가 안 뜬다(비우면 CORS가 모든 곳에 열린다) |
| `SERVER_API_URL` | 운영 게임 API의 주소(대전 서버가 부른다) |
| `SAMCHESS_ADMIN_ORIGIN` · `SAMCHESS_ADMIN_HOST` | 관리자 화면의 주소 · 관리자 API를 밖에 열지(기본 127.0.0.1) — 관리자 화면을 어디에 둘지 정할 때 함께 |
| 관리자 화면 `VITE_ADMIN_API_URL` | 운영 관리자 API의 주소 |

## 2. 운영 프로젝트를 만드는 순서

1. **Supabase 대시보드 → New project** — 리전은 개발과 같게(지금 개발은 `ap-northeast-1`, 도쿄). DB 비밀번호를 새로 정해 둔다.
2. **Auth 설정을 개발과 같게** — 코드 밖이라 손으로 맞춘다. 개발에서 `npm run db:check`가 찍는 줄이 기준이다(2026-10-22: 이메일 가입 열림 · 다른 로그인 없음 · **확인 메일 켜짐**).
   - Authentication → Sign In / Providers: Email 켬, 「Confirm email」 개발과 같게, 익명 로그인 끔
   - Authentication → URL Configuration: Site URL · Redirect URLs = 게임 화면의 배포 주소(확인 메일의 링크가 여기로 온다)
   - 확인 메일을 켜 두면 운영은 **메일 발송 설정(SMTP)**을 따로 본다 — 기본 메일은 시간당 보내는 수가 작다
3. **`SamChess/.env.production`을 만든다** — `.env.example`을 복사해 위 표대로. **운영 값을 `.env`에 넣지 않는다.**
4. `npm run db:migrate:prod` — `schema.sql`을 그대로(여러 번 돌려도 안전).
5. **관리자 계정** — 운영에서 가입(게임 화면이든 Supabase 대시보드든) → `npm run admin:role:prod -- <이메일>` → 관리자 화면에서 첫 로그인 때 TOTP 등록.
6. `npm run db:check:prod` — **✓로 끝나야 한다.** 운영에서는 관리자 0명 · 시험 계정(@samchess.test)이 있으면 ✗다.
7. `SamChessAdmin/.env.production` — `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY`(운영) · `VITE_ADMIN_API_URL`.
8. 배포 서버에 `.env.production`과 같은 값을 넣고 서버 셋을 띄운다 — 게임 API가 「띄우지 않는다」를 찍으면 그 이유대로 고친다.

## 3. 운영에서 하지 않는 것

- **스모크 · `*_ux` · `look:online` 도구를 돌리지 않는다** — 시험 계정을 만들고 지우고, `smoke:admin`은 **전체 공지**를 보냈다 거둔다
  (실계정에 몇 초 보인다). 전부 `--env-file=.env`(개발)를 읽으므로 평소에는 닿지 않는다. `smoke:admin`은 `SAMCHESS_ENV=production`이면
  시작하지 않는다(`tools/devOnly.ts`) — 운영 값을 `.env`에 붙여 넣었을 때의 두 번째 문이다. 운영의 확인은 `db:check:prod`와 사람의 실제 플레이로 한다.
- 개발용 지급(`SAMCHESS_DEV_GRANTS`)을 켜지 않는다 — 켜면 게임 API가 안 뜬다.
- 감사 로그 · 계정을 SQL로 직접 고치지 않는다 — 관리자 화면(사유 · 감사 로그)으로. 개발에서 했던 시험 기록 정리(2026-10-22)는 개발 DB의 일이었다.

## 4. 아직 정하지 않은 것

- 서버 셋(게임 API 8787 · 관리자 API 8788 · 대전 서버 2567)과 두 화면을 **어디에 배포할지** — 정해지면 1의 「배포 서버」 줄과 2-8을 구체적으로.
- 운영의 백업 · Pro 전환 시점 · 확인 메일의 SMTP.
