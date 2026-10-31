# 데모 플레이 주소 모음

로그인 · 서버 없이 바로 열리는 판들이다. 링크를 누르면 브라우저에서 열린다.

## 먼저 — 개발 서버 띄우기

```bash
npm run dev          # 저장소 맨 위에서. 보통 http://localhost:5173
```

- 아래 링크는 전부 **5173** 기준이다. 터미널에 다른 포트(5174 · 5175 …)가 찍히면 주소의 숫자만 바꾼다.
- 5173이 다른 작업(튜토리얼 워크트리 등)에 잡혀 있으면 이 저장소를 따로 띄운다:
  `cd packages/client && npx vite --port 5175 --strictPort` → 주소의 `5173`을 `5175`로.
- 주소 끝의 `&seed=숫자`를 바꾸면 다른 장수 · 다른 판이 나온다.
- 판에서 `F` 키는 판 전체 보기, `M` 키는 배경음악 끄기.

---

## 1. 수성전 연습 (2026-10-31)

나는 **남군(공격)**, 북군은 **기본 방침 AI**로 수비한다. 양쪽 전투력은 매칭 구간 안으로 맞춰진다.
오른쪽 위 **[적 방침]** 단추를 누르면 수비군의 방침을 볼 수 있다(연습 판에만 있는 단추다).

| | 3v3 | 5v5 |
|---|---|---|
| **Lv1** (책략 없음) | http://localhost:5173/?demo=1&siege=1&mode=3v3&level=1 | http://localhost:5173/?demo=1&siege=1&mode=5v5&level=1 |
| **Lv2** (능력 하나 + Lv2 책략 하나) | http://localhost:5173/?demo=1&siege=1&mode=3v3&level=2 | http://localhost:5173/?demo=1&siege=1&mode=5v5&level=2 |

다른 명단 예: http://localhost:5173/?demo=1&siege=1&mode=3v3&level=1&seed=2

- 이기는 법: 적 King 격퇴, 또는 적 전멸. 수비군은 **성채(가운데 3×3)를 지키거나 60일을 버티면** 이긴다.
- 기록: 2026-10-31 Lv1 3v3 — 27일, 아군 전원 생존으로 전멸승.

---

## 2. 일반 대전 데모 (야전)

**데모 편성은 전원 Lv9**(능력은 전부 HP, 책략은 환술 8종)다. 기본은 3v3, 나는 남군.

| 무엇 | 주소 |
|---|---|
| 기본 3v3 | http://localhost:5173/?demo=1 |
| 5v5 | http://localhost:5173/?demo=1&mode=5v5 |
| 북군으로 두기 | http://localhost:5173/?demo=1&side=P2 |
| 양쪽 다 AI — 관전 | http://localhost:5173/?demo=1&auto=1 |
| 5v5 관전 | http://localhost:5173/?demo=1&auto=1&mode=5v5 |
| 배치 단계부터 | http://localhost:5173/?demo=1&deploy=1 |
| 시작 SP 15 — 고유기술을 바로 써 보기 | http://localhost:5173/?demo=1&sp=15 |

## 3. 장면 확인용 판

특정 장면을 보려고 만든 판이다. 엔진 규칙은 그대로이고, 시작 상태만 미리 깔아 둔다.

| 무엇 | 주소 |
|---|---|
| 지형 — 가운데에 화계 · 수계 · 성지 | http://localhost:5173/?demo=1&terrain=1 |
| 버프 · 디버프 배지 — 남군 군주가 하나씩 들고 시작 | http://localhost:5173/?demo=1&status=1 |
| 고유기술 시전 중 — 북군 등급별 장수가 전부 시전 중 | http://localhost:5173/?demo=1&cast=1 |
| 시전 중 (5v5, 등급 다섯) | http://localhost:5173/?demo=1&cast=1&mode=5v5 |
| 컬렉션 효과 — 유비 · 관우 · 장비 대 조조 · 안량 · 문추, 발동 장면 포함 | http://localhost:5173/?demo=1&collections=1&deploy=1 |
| 컬렉션 효과 (5v5 — 오호대장군) | http://localhost:5173/?demo=1&collections=1&deploy=1&mode=5v5 |
| 군량고 탈취 — 내 장수가 적 군량고 앞에서 시작 | http://localhost:5173/?demo=1&supply=1 |
| 군량고 탈취당하기 — 북군 AI가 내 군량고로 | http://localhost:5173/?demo=1&supply=2 |
| 상대가 늦게 준비 — 배치 대기 화면 | http://localhost:5173/?demo=1&deploy=1&late=1 |

### 아이템 들고 싸우기

남군 전원이 그 시장 아이템을 하나씩 들고 시작한다. 판에서 [아이템]으로 쓴다.

| 아이템 | 주소 |
|---|---|
| 탕약 | http://localhost:5173/?demo=1&items=tang-yak |
| 차 | http://localhost:5173/?demo=1&items=cha |
| 목우유마 | http://localhost:5173/?demo=1&items=mok-u-yu-ma |
| 마비산 | http://localhost:5173/?demo=1&items=ma-bi-san |
| 청낭서 | http://localhost:5173/?demo=1&items=cheong-nang-seo |
| 태평요술 | http://localhost:5173/?demo=1&items=tae-pyeong-yo-sul |
| 육도삼략 | http://localhost:5173/?demo=1&items=yuk-do-sam-ryak |
| 손자병법서 | http://localhost:5173/?demo=1&items=son-ja-byeong-beop-seo |
| 대완마 | http://localhost:5173/?demo=1&items=dae-wan-ma |
| 적로 | http://localhost:5173/?demo=1&items=jeok-ro |
| 절영 | http://localhost:5173/?demo=1&items=jeol-yeong |
| 적토마 | http://localhost:5173/?demo=1&items=jeok-to-ma |
| 척후기 | http://localhost:5173/?demo=1&items=cheok-hu-gi |
| 폭약 | http://localhost:5173/?demo=1&items=pok-yak |
| 우선 | http://localhost:5173/?demo=1&items=u-seon |
| 영기 | http://localhost:5173/?demo=1&items=yeong-gi |

---

## 4. 튜토리얼 판

끝나면 같은 판이 처음부터 다시 열린다(완료 기록은 남지 않는다).

| 기본 | 주소 |
|---|---|
| 기본 1 | http://localhost:5173/?tutorial=basic-1 |
| 기본 2 | http://localhost:5173/?tutorial=basic-2 |
| 기본 3 | http://localhost:5173/?tutorial=basic-3 |

**S급 30판**

| 장수 | 주소 | 장수 | 주소 |
|---|---|---|---|
| 가후 | http://localhost:5173/?tutorial=s-ga-hu | 서서 | http://localhost:5173/?tutorial=s-seo-seo |
| 감녕 | http://localhost:5173/?tutorial=s-gam-nyeong | 서황 | http://localhost:5173/?tutorial=s-seo-hwang |
| 강유 | http://localhost:5173/?tutorial=s-gang-yu | 손견 | http://localhost:5173/?tutorial=s-son-gyeon |
| 곽가 | http://localhost:5173/?tutorial=s-gwak-ga | 손권 | http://localhost:5173/?tutorial=s-son-gwon |
| 관우 | http://localhost:5173/?tutorial=s-gwan-u | 순욱 | http://localhost:5173/?tutorial=s-sun-uk |
| 노숙 | http://localhost:5173/?tutorial=s-no-suk | 여몽 | http://localhost:5173/?tutorial=s-yeo-mong |
| 방덕 | http://localhost:5173/?tutorial=s-bang-deok | 여포 | http://localhost:5173/?tutorial=s-yeo-po |
| 방통 | http://localhost:5173/?tutorial=s-bang-tong | 유비 | http://localhost:5173/?tutorial=s-yu-bi |
| 사마의 | http://localhost:5173/?tutorial=s-sa-ma-ui | 육손 | http://localhost:5173/?tutorial=s-yuk-son |
| 장료 | http://localhost:5173/?tutorial=s-jang-ryo | 제갈량 | http://localhost:5173/?tutorial=s-je-gal-ryang |
| 장비 | http://localhost:5173/?tutorial=s-jang-bi | 조운 | http://localhost:5173/?tutorial=s-jo-un |
| 장합 | http://localhost:5173/?tutorial=s-jang-hap | 조조 | http://localhost:5173/?tutorial=s-jo-jo |
| 주유 | http://localhost:5173/?tutorial=s-ju-yu | 태사자 | http://localhost:5173/?tutorial=s-tae-sa-ja |
| 하후돈 | http://localhost:5173/?tutorial=s-ha-hu-don | 허저 | http://localhost:5173/?tutorial=s-heo-jeo |
| 황충 | http://localhost:5173/?tutorial=s-hwang-chung | 마초 | http://localhost:5173/?tutorial=s-ma-cho |

---

## 5. 진짜 게임 · 온라인

| 무엇 | 방법 |
|---|---|
| 진짜 게임(로그인 · 도시 · 출정) | http://localhost:5173/ — `npm run server-api`(계정)도 함께 떠 있어야 한다 |
| 온라인 대전을 둘이서 | 일반 창 + 시크릿 창에서 **계정 둘**로 각각 로그인 → 병영 [출정하기]. `npm run server`도 필요 |
| 온라인을 자동으로 찍어 보기 | `npm run look:online` (dev · server-api · server가 떠 있어야 한다) |

> 새 데모 통로가 생기면 `packages/client/src/main.tsx` 머리말과 HANDOFF 「화면 확인용 통로」에 적히고, 이 파일에도 한 줄 더한다.
