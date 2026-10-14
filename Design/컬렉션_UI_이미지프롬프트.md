# 컬렉션 화면 UI 그림 — 이미지 생성 의뢰서 (2026-10-13)

컬렉션 목록 · 두루마리(상세)에 들어갈 **작은 UI 그림 7장**이다. 라벨 117장(`컬렉션_라벨_이미지프롬프트.md`)과는 따로 간다 —
그쪽은 수묵 풍경이고, 이쪽은 게임의 다른 UI(장수 등급 보석 · 장터 카드 · 나무 목판)와 같은 **채색 게임 아이콘** 화풍이다.

| 묶음 | 장수 | 어디에 |
|---|---|---|
| ① 등급 명패 | 5 (일반 · 희귀 · 영웅 · 전설 · 천하) | 목록 줄의 타이틀 앞 · 두루마리의 등급 줄 |
| ② 등록 칸(슬롯) | 2 (빈 칸 · 등록됨) | 두루마리 「컬렉션 등록」의 장수 · 병기 · 아이템 칸 |

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

두루마리의 「컬렉션 등록」 아래, **장수 · 병기 · 아이템 하나가 들어가는 세로 칸**이다. 칸 안에 장수 그림(또는 물건 그림)과
이름이 놓인다. 게임이 상태를 이렇게 그린다:

| 상태 | 쓰는 그림 | 게임이 더하는 것 |
|---|---|---|
| 요건 안 됨 | `slot-empty.png` | 칸 전체를 **회색(흑백)**으로 |
| 등록 가능 | `slot-empty.png` | **노란 네온** 빛 테두리가 숨 쉬듯 깜박인다 |
| 등록됨 | `slot-done.png` | 그대로 + 오른쪽 아래 붉은 「完」 도장 |

그래서 **빈 칸은 차분하고 중립**이어야 하고(회색으로 바꿔도 · 노란 빛을 둘러도 어울리게), **등록됨은 한눈에 「채워졌다」**로 읽혀야 한다.
칸은 흰 종이(두루마리) 위에 놓인다.

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
