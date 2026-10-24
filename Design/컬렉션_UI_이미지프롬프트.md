# 컬렉션 화면 UI 그림 — 이미지 생성 의뢰서 (2026-10-13)

컬렉션 목록 · 두루마리(상세)에 들어갈 **작은 UI 그림 7장**이다. 라벨 117장(`컬렉션_라벨_이미지프롬프트.md`)과는 따로 간다 —
그쪽은 수묵 풍경이고, 이쪽은 게임의 다른 UI(장수 등급 보석 · 장터 카드 · 나무 목판)와 같은 **채색 게임 아이콘** 화풍이다.

| 묶음 | 장수 | 어디에 |
|---|---|---|
| ① 등급 명패 | 5 (일반 · 희귀 · 영웅 · 전설 · 천하) | 목록 줄의 타이틀 앞 · 두루마리의 등급 줄 |
| ② 등록 칸(슬롯) | 2 (빈 칸 · 등록됨) | 상세 판 「컬렉션 등록」의 장수 · 병기 · 아이템 칸 |

**두 묶음 다 글자를 그리지 않는다.** 등급 이름(「영웅」 등)은 게임이 명패 위에 글꼴로 얹는다 — 열 개 언어로 바뀌어야 하고,
생성 도구는 글자를 틀리게 쓴다.

---

## ① 등급 명패 5장

> ⏸ **보류 (2026-10-13)** — 같은 날 기획자가 목록 · 상세에서 **등급 표시를 걷었다.** 화면에 등급이 다시 서면 그때 만든다.
> 지금 만들 것은 ② 등록 칸 2장뿐이다.

### 무엇인가

컬렉션의 등급(일반 < 희귀 < 영웅 < 전설 < 천하)을 나타내는 **가로로 긴 작은 명패**다. 목록 줄에서 타이틀 바로 앞에
한 줄 글자 높이로 놓이고, 그 위에 게임이 「영웅」 같은 두 글자를 흰 글씨로 얹는다.

- **장수 등급 아이콘(D · C · B · A · S · E)은 둥근 보석 메달이다.** 컬렉션 등급이 그것과 헷갈리면 안 된다 —
  그래서 **둥근 모양 · 큰 보석 · 알파벳은 쓰지 않고**, 옻칠한 **가로 나무 명패(현판)**로 간다.
- 등급이 오를수록 **재료 · 장식이 한 단계씩 화려해진다**. 색만 바뀌는 다섯 장이 아니다.

### 납품 규격

| | |
|---|---|
| 형식 | **PNG, 투명 배경** |
| 크기 | **600 × 200 픽셀** (3:1) — 명패가 그 안을 좌우로 거의 꽉 채운다(위아래 여백 조금) |
| 가운데 | **명패 가운데 60%는 무늬 없이 평평한 판**이어야 한다 — 글자가 그 위에 앉는다. 장식은 양 끝 · 테두리에만 |
| 파일 이름 | `tier-common.png` · `tier-rare.png` · `tier-epic.png` · `tier-legend.png` · `tier-realm.png` |
| 놓는 곳 | `assets/Collections/ui/` |

### 고정 접두 (다섯 장 모두 맨 앞에)

```
Game UI icon, a small horizontal Chinese plaque (signboard) badge for a Three Kingdoms era strategy game,
3:1 wide rectangle with softly rounded corners, front view, centered, isolated on a fully transparent background,
painterly semi-realistic game art matching polished mobile RPG icons, crisp edges, soft top-left lighting,
the central 60% of the plaque is a flat smooth lacquered surface with NO pattern and NO text,
decoration only on the two short ends and the rim, absolutely no letters, no characters, no numbers, no symbols on the face.
```

### 다섯 장

1. **일반 `tier-common.png`** — 접두 뒤에:
   `plain dark grey-brown weathered wood, simple iron end caps, no gems, matte, humble and modest.`
2. **희귀 `tier-rare.png`** —
   `deep indigo-blue lacquered wood, polished bronze end caps with a simple cloud scroll motif, subtle sheen.`
3. **영웅 `tier-epic.png`** —
   `royal purple lacquered wood, gilded bronze rim, small engraved cloud patterns on both ends, a tiny round purple jade stud on each end.`
4. **전설 `tier-legend.png`** —
   `amber-orange lacquered wood glowing warmly, bright gold rim, ornate gold dragon-scale filigree on both ends, small amber gems on each end, faint golden glow.`
5. **천하 `tier-realm.png`** —
   `imperial crimson red lacquer, thick polished gold rim, golden coiling dragon heads curling around both ends, small pearls, a faint radiant golden aura around the plaque, the most majestic of the set.`

### 검수

- 다섯 장을 나란히 놓았을 때 **한 벌**로 보이는가(같은 모양 · 같은 크기 · 같은 시점) — 다르면 접두를 바꾸지 말고 다시 뽑는다
- 가운데가 **평평하고 비어** 있는가 — 흰 글씨 두 자가 올라가도 읽히는가
- 글자 · 숫자 · 기호가 **하나도 없는가**
- 장수 등급의 **둥근 보석과 헷갈리지 않는가**

---

## ② 등록 칸(슬롯) 2장

### 무엇인가

상세 판의 「컬렉션 등록」 아래, **장수 · 병기 · 아이템 하나가 들어가는 세로 칸**이다. 칸 안에 장수 그림(또는 물건 그림)과
이름이 놓인다. 게임이 상태를 이렇게 그린다:

| 상태 | 쓰는 그림 | 게임이 더하는 것 |
|---|---|---|
| 요건 안 됨 | `slot-empty.png` | 칸 전체를 **회색(흑백)**으로 |
| 등록 가능 | `slot-empty.png` | **노란 네온** 빛 테두리가 숨 쉬듯 깜박인다 |
| 등록됨 | `slot-done.png` | 그대로 + 오른쪽 아래 붉은 「完」 도장 |

그래서 **빈 칸은 차분하고 중립**이어야 하고(회색으로 바꿔도 · 노란 빛을 둘러도 어울리게), **등록됨은 한눈에 「채워졌다」**로 읽혀야 한다.
칸은 **죽간 위에 얹은 미색 종이**(상세 판, ④) 위에 놓인다 — 2026-10-14에 두루마리에서 바뀌었다. 칸 아래로 라벨 수묵화가 옅게 비친다.

### 납품 규격

| | |
|---|---|
| 형식 | **PNG, 투명 배경** |
| 크기 | **400 × 520 픽셀** (세로 패) |
| 안쪽 | **가운데 위쪽 70%는 비어 있는 밝은 바탕**(그 위에 장수 그림이 앉는다), 아래 20%는 이름이 앉는 **가로 띠** — 둘 다 무늬 없이 |
| 테두리 두께 | 짧은 변의 6~8% 안쪽 — 칸이 작게(약 100px 폭) 그려지므로 굵기는 얇게, 장식은 네 모서리에만 |
| 파일 이름 | `slot-empty.png` · `slot-done.png` |
| 놓는 곳 | `assets/Collections/ui/` |

### 고정 접두 (두 장 모두 맨 앞에)

```
Game UI frame, a vertical card holder slot for a Three Kingdoms era collection book, portrait 4:5.2 rectangle,
front view, centered, isolated on a fully transparent background, painterly semi-realistic mobile RPG UI art,
thin carved wooden border with small bronze corner fittings on the four corners only,
the upper 70% inside is an empty smooth surface, the bottom 20% is a separate plain horizontal name band,
NO characters, NO portraits, NO text, NO symbols anywhere.
```

1. **빈 칸 `slot-empty.png`** — 접두 뒤에:
   `light warm ivory rice paper inside, pale natural wood border, bronze corners, calm and neutral, slightly recessed as if waiting to be filled.`
2. **등록됨 `slot-done.png`** —
   `the same frame, but the inside is a rich deep vermilion-red silk brocade with a faint gold cloud pattern, the border lacquered dark red with polished gold corners, a subtle inner shadow and soft warm glow, clearly looks filled and honoured.`

### 검수

- 두 장이 **같은 틀**(같은 크기 · 같은 테두리 위치)인가 — 다르면 상태가 바뀔 때 칸이 출렁인다
- 빈 칸을 **흑백으로 바꿔도** 탁하지 않은가, 노란 빛을 둘렀을 때 어울리는가
- 등록됨 위에 **붉은 「完」 도장**(게임이 얹는다)이 묻히지 않는가 — 묻히면 바탕을 한 단계 어둡게

---

## ③ 목록 종이 1장 (2026-10-14 추가)

### 무엇인가

컬렉션 화면의 **목록 판**(한 쪽 5줄 · 쪽 넘김)을 감싸는 그림이다. 지금은 장수 일람과 같은 「나무 테두리 + 누런 양피지」
(`ui/panel-ledger.png`)인데, 기획자 지정으로 **테두리까지 한 장의 종이**로 바꾼다 — 대자보 게시판(`place-1-ranking.jpg`)에
핀으로 꽂혀 있던 방문(榜文) **한 장을 떼어 들고 보는 느낌**이다. 나무 · 금속 테두리는 없다. 종이의 끝 자체가 테두리다.

- 게시판 그림의 종이와 **같은 종이**로 보여야 한다 — 따뜻한 미색 한지(누런 양피지보다 밝게), 얇은 먹선 삽화풍 배경과 어울리는 결.
- 줄마다 컬렉션 라벨 그림(미색 종이 위 수묵, 1200×396)이 **곱하기(multiply)로 옅게** 깔린다 — 종이 바탕이 라벨 바탕보다
  너무 짙거나 채도가 높으면 라벨이 네모난 얼룩으로 뜬다. **바탕은 밝고 고르게.**
- 판 크기는 화면마다 다르므로(폭 320~700px, 높이는 폭의 약 1.4~1.6배) 게임이 **9분할로 늘려** 쓴다.
  그래서 **가운데는 무늬 없이 고른 종이결**이어야 하고, 특징(찢긴 끝 · 핀 구멍)은 **바깥 6% 띠 안에만** 둔다.

### 납품 규격

| | |
|---|---|
| 형식 | **PNG, 투명 배경** (종이 바깥 · 찢긴 틈은 투명) |
| 크기 | **1000 × 1440 픽셀** (세로) — 종이가 그 안을 거의 꽉 채운다(바깥 여백 1~2%) |
| 가장자리 | 찢기거나 보풀이 인 끝(deckle) · 위 두 모서리의 **핀 구멍 자국과 작게 찢긴 자리**는 **바깥 6%(짧은 변 기준 60px) 안에만** |
| 가운데 | 바깥 6%를 뺀 안쪽은 **고른 종이결뿐** — 얼룩 · 접힌 금 · 글씨 · 도장 · 그림자 그라데이션 없음 (늘리면 그대로 늘어난다) |
| 파일 이름 | `list-paper.png` |
| 놓는 곳 | `assets/Collections/ui/` |

### 프롬프트

```
Game UI background, a single sheet of old Chinese rice paper notice (bangwen) that has just been pulled off a public
notice board, portrait 1000x1440, front view, flat, isolated on a fully transparent background,
warm light ivory-cream paper with subtle fine fibers, evenly lit, matching a soft hand-drawn ink illustration style,
the paper fills almost the whole canvas, its four edges are irregular hand-torn deckle edges with soft frayed fibers,
two small pin holes with tiny torn notches near the two top corners where it was pinned to the board,
a faint trace of dried paste along the very top edge,
all edge details stay within the outer 6% of the sheet,
the entire inner area is a perfectly even, uniform paper texture with NO stains, NO folds, NO creases, NO vignette,
NO shadow gradient, NO text, NO characters, NO seals, NO illustrations, NO border frame, NO wood, NO metal.
```

### 검수

- 바깥 6%를 가렸을 때 남는 가운데가 **어디를 잘라도 같은 종이**인가 — 위아래 · 좌우로 밝기가 흐르면 늘렸을 때 줄무늬가 된다
- 게시판 그림의 방문과 **나란히 놓아** 같은 종이로 보이는가(누렇게 뜨면 한 단계 밝게)
- 라벨 그림 하나(`collections/baek-ma-ui-jong.jpg`)를 위에 곱하기로 30%쯤 얹어 봤을 때 **라벨의 네모 테두리가 안 보이는가**
- 찢긴 끝 · 핀 구멍이 **네 변에 고르게** 있는가 — 한 변에만 몰리면 9분할 때 그 변만 늘어나 보인다(핀 구멍은 위 두 모서리 그대로)
- 글자 · 도장 · 테두리 장식이 **하나도 없는가**

> 같은 그림을 위 요약 판(`clx-head`) · [랭킹 보기] 팝업에도 쓸 수 있다 — 지금 둘 다 목록과 같은 양피지(`.scr-collection .place-panel`)라서다.
> 셋을 함께 바꿀지는 그림이 들어온 뒤 화면에서 정한다.

---

## ④ 상세 판 1장 — 죽간 위의 종이 (2026-10-14 추가 · 같은 날 죽간으로 바꿈)

### 무엇인가

목록 줄을 누르면 뜨는 **상세 팝업의 바탕**이다. 지금은 두루마리를 펴는 연출(1.6초)인데, 기획자 지정으로 연출 없이 **바로 뜨는 판**으로 바꾼다.
목록이 「대자보에서 떼어 온 찢긴 방문」이라면 상세는 **대나무 죽간(竹簡)을 엮은 판 위에 종이 한 장을 얹어 둔** 꼴이다 —
종이 둘레로 죽간이 고르게 내비친다. 판 위에는 큰 한자 제목 · 우리말 제목 · 상세 설명 · 효과 · 등록 칸(장수 · 병기 · 아이템, 최대 5개) ·
붉은 낙관 도장이 놓이고, 라벨 그림(수묵 풍경)이 종이 아래쪽에 곱하기로 옅게 깔린다.

- **높이가 컬렉션마다 다르다**(설명 길이 · 칸 수). 그래서 게임이 **9분할로 늘려** 쓴다.
  죽간은 **대쪽이 세로로 서 있어** 위아래로 늘려도 대쪽이 길어질 뿐 티가 안 난다 — 이 꼴이 9분할에 잘 맞는 이유다.
- **대쪽을 묶는 끈은 위 · 아래 띠 안에만**(가로 끈 두 줄) — 가운데로 내려오면 늘릴 때 끈이 두꺼워진다.
- 종이는 **가운데에 반듯하게** 얹혀 있고, 사방으로 죽간이 **같은 폭**만큼 보인다. 종이 끝은 곧게(찢기지 않게) — 목록 종이와 겹치지 않게.
- 붉은 낙관 · 「完」 도장이 올라가므로 **붉은색을 크게 쓰지 않는다**. 두루마리 축 · 손잡이는 없다.

### 납품 규격

| | |
|---|---|
| 형식 | **PNG, 투명 배경**(검은 바탕 JPG도 된다 — 목록 종이처럼 굽는 도구가 걷는다. 단 판 안에 검정을 쓰지 않는다) |
| 크기 | **1000 × 1400 픽셀** (세로) — 죽간 판이 캔버스를 거의 꽉 채운다(바깥 여백 1~2%) |
| 죽간 띠 | 종이 둘레로 보이는 죽간의 폭 = 짧은 변의 **6~8%(60~80px)**, **네 변이 같은 폭** |
| 끈 | 가로 끈 두 줄 — 위 끈은 **위 12% 안**, 아래 끈은 **아래 12% 안**. 가운데 구간엔 끈이 없다 |
| 대쪽 | 세로 대쪽이 **고른 폭으로 나란히**(한두 쪽만 유난히 넓거나 색이 튀지 않게) |
| 종이 | 죽간 띠 안쪽 전부 — **고른 미색 종이결뿐**, 얼룩 · 접힌 금 · 글씨 · 도장 · 그림 · 밝기 그라데이션 없음. 종이 아래 아주 옅은 그림자는 된다 |
| 파일 이름 | `detail-paper.png` (또는 `.jpg`) |
| 놓는 곳 | `assets/Collections/ui/` |

### 프롬프트

```
Game UI panel background, a sheet of paper laid flat on top of an ancient Chinese bamboo slip board (zhujian),
portrait 1000x1400, top-down front view, perfectly flat, centered, isolated on a fully transparent background,
the board is made of many narrow vertical bamboo slips of equal width lined up side by side, warm honey-brown aged bamboo
with subtle natural grain and small node marks, evenly lit,
the slips are tied together by two thin horizontal hemp cords, one near the top edge and one near the bottom edge only,
no cords in the middle,
a single rectangle of smooth ivory-white mulberry paper with clean straight edges lies centered on the bamboo,
leaving an even margin of bamboo visible on all four sides, the same width on every side,
a very faint soft shadow under the paper edge,
the paper surface is perfectly even and plain with NO stains, NO folds, NO vignette, NO brightness gradient,
NO text, NO characters, NO seals, NO illustrations, no torn edges, no pin holes, no scroll rods, not a scroll,
no red color.
```

### 검수

- 판을 **위아래로 늘려도**(가운데 구간) 대쪽 · 종이가 어색하지 않은가 — 가운데 구간에 끈 · 매듭 · 튀는 대쪽이 없어야 한다
- 종이 둘레의 죽간이 **네 변 같은 폭**인가
- 종이 가운데의 **밝기가 고른가**
- 붉은 낙관(게임이 얹는다)을 종이 오른쪽 아래에 올려 봤을 때 **묻히지 않는가**
- 목록의 찢긴 방문과 **나란히 놓아** 같은 세계의 다른 판으로 보이는가

> 바꾸기 전 안(쪽빛 비단 표구 띠)은 git 이력에 있다(`dbec494`). 죽간이 화면에서 무거우면 그쪽과 비교한다.

---

## ⑤ 전투 배지 2장 + 발동 알림 띠 1장 (2026-10-14 추가)

> **2026-10-14 받은 것** — `전투-컬렉션.jpg`(붉은 인장) → `ui/badge-active.png`, `전투-책략 개량.jpg`(옥색 마름모) → `ui/badge-upgrade.png`.
> 기획자 지정으로 **붉은 인장이 컬렉션 효과 전부**(능력치 · 진영 SP · 고유기술 SP)를 맡고, **옥색 마름모는 태학 개량 책략**의 표지가 됐다
> (전투의 책략 목록 · 적 책략 팝업). 아래 표의 「기술 변형」 자리는 그래서 쓰지 않는다 — SP 칸은 「SP ~~6~~ 5」 글자만 남는다.
> 발동 알림 띠(`banner-collection.png`)는 아직 안 왔다 — CSS 띠로 돈다.
>
> **2026-10-16 바뀜** — 붉은 인장은 **진영 덱 둘**(`전투-컬렉션 (북군).jpg` 붉은 함 · `(남군).jpg` 푸른 함 → `ui/gi/collection-{north,south}.png`)로
> 갈렸고 장수 카드의 인장도 그 장수 진영의 것을 쓴다. 발동 알림 띠는 **만들지 않는다** — 덱에서 라벨이 나오는 발동 장면(pptx 106~112쪽,
> `Design/컬렉션_기획.md` §4)이 대신한다.


완성한 컬렉션이 전투에서 켜졌음을 알리는 그림이다. **전투 화면의 장수 카드**(장수 팝업 · 좌우 판 — 초상 · 이름 · 무지통 · HP/MP ·
고유기술 라벨이 있는 짙은 나무 카드)에 붙는다. 상태 엠블럼(카드 위 테에 박힌 둥근 그림)과 **자리도 모양도 겹치면 안 된다** —
엠블럼은 둥근 메달이므로 이쪽은 **네모난 인장 · 마름모 표지**로 간다. 상대 장수 카드에도 똑같이 뜬다.

| 파일 | 어디에 | 뜻 |
|---|---|---|
| `badge-active.png` | 초상 액자의 **왼쪽 아래 모서리**에 걸친다(카드에서 약 26px) | 「이 장수에게 컬렉션 효과가 켜져 있다」(능력치 · 진영 SP) |
| `badge-skill.png` | 고유기술 줄의 **SP 숫자 앞**(약 22px) | 「컬렉션이 이 고유기술을 바꿨다」(SP −1) — 옆에 게임이 「~~6~~ 5」를 글꼴로 쓴다 |
| `banner-collection.png` | 배치가 끝나고 전투가 시작될 때 **판 가운데에 한 번** 뜨는 가로 띠 | 그 위에 게임이 「도원결의 발동」을 글꼴로 얹는다 |

**셋 다 글자를 그리지 않는다** — 한자 「集」 같은 것도 넣지 않는다(열 개 언어 · 생성 도구가 획을 틀린다). 뜻은 모양과 색이 말한다.

### 납품 규격

| | `badge-active.png` | `badge-skill.png` | `banner-collection.png` |
|---|---|---|---|
| 형식 | PNG, 투명 배경 | PNG, 투명 배경 | PNG, 투명 배경 |
| 크기 | **256 × 256** — 인장이 가운데 80%를 채운다 | **256 × 256** — 표지가 가운데 80% | **1600 × 320** (5:1) |
| 작게 보일 때 | 26px로 줄어도 **윤곽 하나로** 읽혀야 한다 — 잔무늬 금지 | 22px — 같다 | 가운데 70%는 글자가 앉는 **평평한 띠**, 장식은 양 끝에만 |
| 놓는 곳 | **`assets/icons/ui/`** (등록 칸 · 상세 판과 같은 곳 — `npm run ui`가 거기서 읽는다) | 같다 | 같다 |

### 고정 접두 (배지 두 장에)

```
Game UI icon for a Three Kingdoms era strategy game, front view, centered, isolated on a fully transparent background,
painterly semi-realistic mobile RPG icon art, bold simple silhouette that stays readable at 24 pixels,
thick clean outline, soft top-left lighting, no fine detail, NO letters, NO characters, NO numbers, NO symbols, NO text.
```

1. **발동 효과 `badge-active.png`** — 접두 뒤에:
   `a small square Chinese carved seal stamp seen from the front, vermilion red lacquered body with a thin polished gold rim,
   the face is a plain slightly raised red square with a soft inner glow, a tiny gold tassel knot at the top corner,
   warm and honourable, like a medal of an accomplished collection.`
2. **기술 변형 `badge-skill.png`** — 접두 뒤에:
   `a small diamond-shaped (rotated square) jade tablet charm, deep teal-green jade with a thin gold rim,
   the face is plain and smooth with a faint upward pointing chevron carved lightly in the middle to suggest "reduced cost",
   a soft cool cyan glow around the edge, clearly different in colour and shape from a red square seal.`

### 발동 알림 띠 `banner-collection.png`

```
Game UI banner for a Three Kingdoms era strategy game, a wide horizontal ceremonial ribbon banner, 5:1, front view,
centered, isolated on a fully transparent background, painterly semi-realistic mobile RPG UI art,
deep vermilion red silk band with a faint gold cloud brocade pattern, thin gold trim along the top and bottom edges,
both short ends fold back like a hanging ribbon with small gold tassels, a small red square seal ornament on each end,
the central 70% is a flat smooth band with NO pattern contrast so white text can sit on it,
NO letters, NO characters, NO numbers, NO symbols, NO text anywhere.
```

### 검수

- 배지 둘을 **26px · 22px로 줄여** 짙은 나무 위에 놓아 본다 — 네모 인장(빨강)과 마름모(옥색)가 한눈에 갈리는가, 상태 엠블럼(둥근 메달)과 헷갈리지 않는가
- 금테가 줄였을 때 **뭉개져 갈색 얼룩**이 되지 않는가 — 그러면 테를 더 굵게 다시 뽑는다
- 띠 가운데에 흰 글씨(「인중여포 마중적토 발동」 정도의 긴 글)가 올라가도 읽히는가 · 판(짙은 바둑판) 위에서 떠 보이는가
- 셋 다 글자 · 숫자 · 기호가 **하나도 없는가**

그림이 오기 전까지 게임은 **CSS로 그린 임시 표지**(빨간 네모 · 옥색 마름모 · 붉은 띠)로 돈다 — 파일을 넣고 `npm run ui`로 굽으면 바뀐다.

---

## ⑥ 시대 칩 — 굵은 붓 「一」 획 (2026-10-14 추가)

> **2026-10-14 받은 것** — 방법 A(`era-stroke.jpg`, 흰 바탕) · 방법 B(`era-stroke-{색 이름}.jpg` 여덟 장, 검은 바탕)를 둘 다 받았다.
> `npm run ui`가 B는 획 색에 대어 검정을 걷고(`unmix_on_black`), A는 먹의 진하기를 알파로 여덟 색을 입혀(`tint_on_white`)
> `ui/era-stroke-{a,b}-{1~8}.png`로 굽는다. 화면은 **B가 기본**(획이 장마다 조금씩 달라 덜 심심하다 — 기획자), `?stroke=a`로 A를 본다.

### 무엇인가

목록 줄 맨 위의 시대 표시(「황건 · 반동탁 (184~192)」)는 지금 **둥근 상자**다. 이것을 **굵은 붓으로 한 번 그은 가로 획(一)** 위에
글자를 얹는 모양으로 바꾼다. 획 색은 시대마다 다르다(아래 표 — 2026-10-14 「이야기의 색」 안 A를 그대로, 글자를 얹을 수 있게 한 단계 진하게).
글자는 게임이 미색(`#fff3d6`)으로 얹는다 — 열전(금)만 짙은 갈색.

- 칩 하나가 화면에서 **폭 약 120~230px · 높이 약 30px**다. 글자 길이가 시대마다 달라(「열전」 ↔ 「형주 · 적벽 (201~209)」) **획이 가로로 늘어난다**.
  그래서 게임은 획을 **양 끝은 그대로, 가운데만 늘려** 쓴다(9분할). 획의 **가운데 60%는 가로 결만 있는 고른 띠**여야 늘려도 티가 안 난다.
- 붓의 시작(왼쪽)은 **눌러 시작한 둥근 머리**, 끝(오른쪽)은 **갈필로 흩어지는 꼬리** — 「一」을 쓰는 붓의 흐름 그대로.

### 납품 규격

| | |
|---|---|
| 형식 | **PNG, 투명 배경** |
| 크기 | **1200 × 240 픽셀** (5:1) — 획이 좌우를 거의 꽉 채우고, 위아래는 획 두께가 캔버스 높이의 60~70% |
| 가운데 | 가로 60%는 **가로 붓결만** — 덩어리 · 번짐 · 튄 먹방울 없이 두께가 고르게. 장식(번짐 · 갈필 · 먹방울)은 양 끝에만 |
| 파일 이름 | 아래 두 방법 중 하나 |
| 놓는 곳 | `assets/icons/ui/` |

### 방법 A (추천) — 검은 획 한 장, 색은 굽는 도구가 입힌다

**한 장만** 받는다: `era-stroke.png`. `npm run ui`가 이 한 장을 여덟 색으로 물들여 `ui/era-stroke-{1~8}.png`를 굽는다.
여덟 장이 **모양이 완전히 같고**, 색이 표의 값과 **정확히** 맞으며, 색을 바꾸고 싶을 때 다시 뽑지 않고 숫자만 고치면 된다.
생성 도구로 여덟 번 뽑으면 획 모양 · 두께 · 끝 처리가 장마다 달라져 목록에서 줄마다 칩이 들쭉날쭉해진다.

```
A single thick horizontal calligraphy brush stroke, the Chinese character "one" (一) written with a large wet ink brush,
pure black sumi ink on a fully transparent background, front view, centered, 5:1 wide composition,
the stroke fills almost the full width and about 65% of the height,
left end: a firm rounded pressed start where the brush touches down,
right end: a dry-brush tail breaking into streaks of bristle texture (飛白), slightly lifting,
the middle 60% is an even band of the same thickness with only fine horizontal bristle grain, no blobs, no ink splatter, no bleeding in the middle,
subtle natural variation of ink density inside the stroke, crisp alpha edges,
NO paper texture, NO background, NO seal, NO letters, NO other strokes.
```

### 방법 B — 시대마다 한 장씩 (여덟 장)

같은 생김새가 필요하므로 **방법 A의 프롬프트 뒤에** 색 한 줄만 바꿔 붙인다. 파일 이름은 `era-stroke-1.png` ~ `era-stroke-8.png`.
`pure black sumi ink`를 지우고 아래 문장으로 바꾼다:

| 파일 | 시대 | 획 색 | 프롬프트 색 문장 |
|---|---|---|---|
| `era-stroke-1` | 황건 · 반동탁 | 누런 황토 `#a8792e` | `ochre yellow-brown mineral pigment (#a8792e), like yellow earth` |
| `era-stroke-2` | 군웅할거 | 녹슨 갈색 `#8a4a2a` | `rusty red-brown pigment (#8a4a2a), like old rust` |
| `era-stroke-3` | 관도 | 청회색 `#4f6478` | `cold slate blue-grey pigment (#4f6478)` |
| `era-stroke-4` | 형주 · 적벽 | 주홍 `#c0461c` | `vermilion orange-red cinnabar pigment (#c0461c), like fire` |
| `era-stroke-5` | 삼국 정립 | 옥색 `#2f7f6e` | `deep jade green pigment (#2f7f6e)` |
| `era-stroke-6` | 이릉 · 남정 | 짙은 자주 `#6a2f6a` | `dark plum purple pigment (#6a2f6a)` |
| `era-stroke-7` | 북벌 | 쪽빛 `#2d4a8a` | `indigo blue pigment (#2d4a8a), like indigo dye` |
| `era-stroke-8` | 열전 | 금 `#c99a24` | `gold leaf pigment (#c99a24) with a soft metallic sheen` |

### 검수

- **30px 높이로 줄여** 미색 글씨 「형주 · 적벽 (201~209)」를 얹어 본다 — 글자가 획 위에서 읽히는가(획이 너무 밝으면 방법 A의 색을 진하게 고친다)
- 가로로 **두 배 늘려도** 가운데 결이 늘어진 티가 안 나는가 — 덩어리가 가운데에 있으면 늘렸을 때 길게 번진다
- 양 끝이 투명으로 깨끗하게 풀리는가(종이 바탕 위에 놓이므로 회색 테가 남으면 보인다)
- 방법 B면 여덟 장을 나란히 놓고 **한 벌**인지 — 다르면 그 장만 다시 뽑는다
