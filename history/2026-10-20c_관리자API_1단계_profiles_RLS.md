# 2026-10-20c — 관리자 API 1단계 · profiles RLS

운영용 관리자 페이지를 시작했다. **화면은 별도 저장소 `../SamChessAdmin`**(React + Vite, 5174), **API는 여기
`packages/server-api/src/admin/`**(따로 도는 프로세스, 8788). 1단계 범위는 조회 + 지급·회수 + 감사 로그이고,
게임 데이터(장수·아이템 등)는 **읽기 전용**으로 시작했다(기획자 결정 — 실행 중 수정은 2단계 검토).

## 끝난 모습

| 자리 | 내용 |
|---|---|
| `server-api/src/admin/auth.ts` | `verifyAdmin()` — `/auth/v1/user` 응답의 `app_metadata.role === 'admin'`. 매 요청 DB 값을 보므로 역할을 거두면 바로 막힌다 |
| `server-api/src/admin/store.ts` | 검색(`auth.users` 기준 — 도시 없는 계정도) · 상세(**저장하지 않는** 정산) · `mutateWithAudit` · 감사 로그 · 집계 |
| `server-api/src/admin/routes.ts` | `/admin/me` · `stats` · `users` · `users/:uid` · `users/:uid/adjust`(사유 필수) · `audit` · `gamedata` |
| `meta/src/admin.ts` | 지급·회수 규칙(순수). 0 밑으로 안 내려감 · 군량 창고 상한 · 장수가 낀 병기 · 들려 보낼 아이템은 못 거둠 |
| `profileStore.ts` | `syncAtServer()`로 정산 순서를 한 함수로 뺐다 · `mutateProfile`에 `onWrite` 훅(쓴 직후 · 커밋 전 · 같은 연결) |
| `sql/schema.sql` | `profiles` RLS · `admin_audit_log`(+RLS) |
| 도구 | `npm run admin-api` · `admin:role -- <이메일>` · `smoke:admin` |

## ★ profiles가 공개 키로 읽히고 있었다

관리자 작업 중에 확인했다 — `profiles`에 RLS가 꺼져 있었고 anon · authenticated에 SELECT · UPDATE · DELETE까지
열려 있었다. 클라이언트 번들에 든 공개 키로 `GET /rest/v1/profiles`가 **200과 실제 행**을 돌려줬다. 서버 소유 필드
경계(`guardServerOwned`)도 금화 경로도 전부 건너뛰는 길이다. 이 저장소는 REST를 안 쓰고(클라이언트의 Supabase
호출은 `/auth/v1/*`뿐 — grep으로 확인) server-api는 직접 연결이라, **정책 없이 RLS만 켜면** 아무것도 안 깨진다.
적용 뒤 같은 요청은 `200 []`. CLAUDE.md에 「표를 새로 만들 때마다 RLS를 함께 적는다」를 넣었다.

## 결정과 이유

- **관리자 API를 별도 프로세스로** — 운영에서 이 포트만 사내망 뒤로 숨길 수 있고 CORS 허용 주소가 다르다. 같은 행을
  같은 `for update`로 고치므로 게임 API와 서로 덮어쓰지 않는다. HOST 기본값은 127.0.0.1.
- **감사 로그는 같은 트랜잭션** — 처음엔 `mutateProfile` 사본을 admin에 뒀다(본체에서 다른 세션이 디버깅 중이라
  기존 파일을 못 고쳤다). 본체가 비자 `onWrite` 훅으로 합치고 사본을 지웠다. 거절된 조정은 쓰기도 로그도 없다.
- **들여다보기는 저장하지 않는다** — 게임의 `getProfile()`은 읽으며 정산을 되쓰지만, 관리자가 본 것만으로 계정이
  바뀌면 안 된다. 같은 `syncAtServer`를 메모리에서만 돌린다(도적떼는 출몰시키지 않는다).
- **역할은 화면에서 안 준다** — 관리자 하나가 털리면 관리자를 늘릴 수 있게 된다. 서비스 키를 쥔 도구(`admin:role`)만.
- **`before`/`after`는 바뀐 최상단 필드만** — 행이 커지지 않게. 정산으로 바뀐 몫(군량 충전)도 섞여 들어간다.

## 검증

- `npm test` 939 통과(관리자 규칙 12건 포함) · `npm run typecheck`
- `smoke:admin` — 401/403/200 · 검색(시험 계정 가림, 도시 없는 계정) · 404/400 · 사유 없으면 400 · 금화 DB 반영 ·
  과회수 400 · 감사 로그는 성공한 것만 · 집계 · 게임 데이터. `smoke:account`도 RLS 뒤 그대로 통과
- 관리자 화면은 Edge(Playwright)로 로그인 → 검색 → 상세 → 지급 → 거절 문구 → 감사 로그 → 400px까지 눌러 봤다

## 남은 것

- 2단계 후보: 계정 정지·해제 · 멈춘 상태 강제 정리(AI 대전 · 도적떼 · 제작 주문) · 부상 해제 · 도시 이름 강제 변경
- 운영 데이터 실행 중 수정(2단계 (b)) — 서버와 클라이언트가 같은 값을 읽어야 재생 검증이 안 갈린다. 설계 먼저
- 결제가 붙으면 `gold_ledger`와 주문 조회 · 수동 확정(`2026-09-25_현금결제연동_1차검토.md` §5.6)
- 개발 DB의 시험 계정(`@samchess.test`)이 150개 넘게 쌓여 있다 — 지난 스모크들이 남긴 것
