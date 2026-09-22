# 다음 세션 프롬프트 — 군영(병영) 화면 디자인 개선

아래 「프롬프트」 절을 새 세션에 그대로 붙여넣는다. 그 아래 「참고」는 프롬프트가 가리키는
사실을 모아 둔 것이다(2026-09-16 기준. 세션에서는 코드를 직접 다시 확인할 것).

---

## 프롬프트

```
군영(병영) 화면의 디자인을 개선하려고 한다. 이미 화풍이 잡힌 궁궐·랭킹·대장간 화면을
참고해 군영을 같은 결로 다시 잡아 줘.

시작하기 전에 HANDOFF.md와 CLAUDE.md를 읽고, 아래를 코드에서 직접 확인해 줘.

■ 지금 상태
- 군영은 `PlaceScreen.tsx`의 `Barracks` 컴포넌트다. 단추 셋([부대 편성]·[출정하기]·
  [튜토리얼 시나리오](잠김))이 기본 `.place-panel` 안에 들어 있고, **화풍 리스킨이
  아직 안 됐다.** 2026-09-02에 궁궐만 `.scr-place-palace`로 좁혀 입혔고 병영·장터는
  일부러 남겨 뒀다(`PlaceScreen.tsx` 머리말).
- 뒤로 단추도 궁궐만 그림 화살표이고 병영은 글자 화살표(「← 」)를 그대로 쓴다
  (`stripBackArrow()`가 궁궐일 때만 뗀다).

■ 참고할 세 화면 (이미 구현돼 있다)
- 랭킹 — `RankingScreen.tsx` · `RankingCommon.tsx`, 접두사 `.rk-`. 목판·두루마리 화풍의
  출발점이다(2026-08-27).
- 궁궐 — `.scr-place-palace` + 장수 일람(`OfficerListScreen`, `.ofc-`) · 도시 관리
  (`CityScreen`, `.cty-`).
- 대장간 — `ForgeScreen.tsx`(`.scr-building-forge`), 홈·제조·지급 관리 셋으로 나뉜 화면.
  액자·9분할·페이지 넘김이 가장 최근 것이다.

■ 이번 세션에서 할 일
1. 세 화면에서 **공통된 규칙**(판때기·액자·제목 바·단추·안내문·페이지 넘김)을 먼저
   정리해서 보여 줘. 군영에 그대로 옮길 수 있는 것과 없는 것을 갈라서.
2. 군영 화면의 새 디자인을 제안해 줘. 단추 셋만 있는 화면이라 **무엇을 더 보여 줄지**가
   핵심이다(보유 부대 수·군량·최근 전적 같은 것). 후보를 두세 개 내고 추천을 말해 줘.
   내가 고르면 구현한다.
3. 범위를 확인해 줘 — 군영 안쪽 화면들(`SquadListScreen`·`SquadEditScreen`·
   `SquadNameScreen`·`SquadDeployScreen`·`SortieScreen`·`MatchScreen`)까지 함께
   손볼지, 바깥 화면 하나만 할지.

■ 함께 고쳐야 할 것 (2026-09-16 발견, 아직 남아 있다)
- 편성 화면(`SquadEditScreen`)의 [등록 완료]가 **보유 장수가 많으면 화면 밖으로 밀린다.**
  배치 편집기의 [저장]이 부대까지 확정하도록 우회는 해 뒀지만, 레이아웃 자체는 그대로다.
  군영 계열 화면을 손보는 김에 이것도 고쳐 줘.

■ 지켜야 할 것 (CLAUDE.md에 있는 것 중 이 작업에서 특히 밟기 쉬운 것)
- CSS 이름이 겹치면 오류 없이 **화면을 봐야만** 안다. 새 클래스는 접두사를 붙이고,
  같은 파일 안에서도 뜻이 다르면 가른다(`.ofc-head` → `.ofc-thead`/`.ofc-bio` 사례).
- `.scr .foot`처럼 선택자가 둘인 기존 규칙은 새 한 클래스를 이긴다. 배경 화면의 단추는
  판때기 안에 둔다(`.place-body`와 `margin-top: auto`가 서로를 밀어낸다).
- `border:` 단축 속성은 `border-image`(9분할)를 초기화한다. 같은 세기면 아래 것이 이긴다.
- 배경 위 팝업은 `.scr-bg > *`의 `position: relative`에서 빼야 한다 — 「있는가」와
  「제자리에 있는가」는 다른 검사다.
- 문구는 열 개 언어 전부 채운다(`i18n/strings/*.json`). 번역이 길어지면 단추 크기가
  달라지는 버그가 이 프로젝트에서 세 번 났다 — 가장 긴 번역으로 확인할 것.
- 스모크 검사는 화면 글자가 아니라 `data-*` 속성으로 건다.

■ 확인
- `npm run typecheck` · `npm test` · `npm run smoke:meta`
- **700px(프레임 최대 폭)에서 눈으로 확인**한다. 좁은 미리보기만 보고 판단하지 말 것.
- 서버는 이미 떠 있다(클라이언트 5173 · 계정 API 8787 · 대전 서버 2567).
  꺼져 있으면 `npm run dev` · `npm run server-api` · `npm run server`.

설계를 먼저 제안하고, 내가 확정하면 구현해 줘.
```

---

## 참고 (2026-09-16 확인)

### 군영의 현재 구조

`PlaceScreen.tsx` 한 파일이 궁궐·병영·장터 셋을 모두 그린다. 공통 틀은
`ScreenChrome`(배경 그림 + 제목·기어 헤더) → `.place-bar`(뒤로 + 자리 이름) →
`.place-body` → `.place-panel`이다. 병영만 `Barracks` 서브 컴포넌트로 빠져 있다.

| 단추 | `data-action` | 상태 |
|---|---|---|
| 부대 편성 | `squads` | 활성 |
| 출정하기 | `sortie` | 활성(`primary`) · 아래 안내문 `barracks.aiNote` |
| 튜토리얼 시나리오 | `tutorial` | **잠김** + 「아직」 안내(`place.soon`) |

### 화풍이 이미 잡힌 화면과 접두사

| 화면 | 파일 | CSS |
|---|---|---|
| 랭킹 | `RankingScreen.tsx` · `RankingCommon.tsx` | `.rk-` |
| 궁궐 — 장수 일람 | `OfficerListScreen.tsx` · `OfficerDetailScreen.tsx` | `.ofc-` |
| 궁궐 — 도시 관리 | `CityScreen.tsx` | `.cty-` |
| 대장간 | `ForgeScreen.tsx`(`BuildingScreen`이 위임) | `.scr-building-forge` |
| 부대 계열 | `SquadListScreen` 외 | `.sqd-` |

### 트랙 위치

HANDOFF §7의 **트랙 10(화면 화풍 리스킨)** 이 이 작업의 자리다 — 10a 간판·환경설정,
10b 도시 생성, 10c 메인이 끝났고 **병영은 아직 없다.** 랭킹·궁궐·대장간은 트랙 10이
아니라 각자의 작업에서 화풍이 함께 입혀졌다.

### 알려진 미결 (군영 계열)

- `SquadEditScreen`의 [등록 완료]가 화면 밖으로 밀린다 (2026-09-16).
- 저장 실패·세션 만료가 화면에 안 뜬다 — `saveProfile()`이 `console.warn`만 남기고
  `isOffline()`을 읽는 화면이 없다. 군영과 직접 관계는 없지만 부대 저장에서 드러난다.
