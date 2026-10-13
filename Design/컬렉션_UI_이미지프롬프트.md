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
