# S급 튜토리얼 전장 그림 — 이미지 생성 의뢰서 (2026-10-22)

S급 튜토리얼 30판([`튜토리얼_시나리오_초안.md`](튜토리얼_시나리오_초안.md) §4)마다 **그 무대의 전장 그림 한 장**이다.
판 아래에 깔리고 그 위에 게임이 격자 · 진영 색조 · 장수를 얹는다. 도적떼 방어전의 맵
(`assets/farmland-battle/map/city_battle.jpg`)과 **같은 화풍**이다 — 낡은 한지 위 먹선 + 옅은 수채, 비스듬히 내려다본 전장.

## 납품 규격

| | |
|---|---|
| 형식 | **JPG** (투명 불필요) |
| 비율 · 크기 | **4:3, 2400 × 1800 픽셀 이상** — S급 판은 **25열 × 15행**(도적떼 판과 같은 크기)으로 잡는다. 칸이 96 × 120이라 판 전체가 정확히 4:3이다 |
| 테두리 | **없음 — 그림이 가장자리까지 꽉 찬다.** 도적떼 맵은 구름무늬 액자째 받아 안쪽을 잘라 늘였는데(비율이 어긋나 살짝 눌렸다), 이번에는 처음부터 판 비율로 받는다 |
| 위 · 아래 | **위쪽 1/3 = 적 진영(북), 아래쪽 1/3 = 아군 진영(남)**. 가운데 1/3이 맞붙는 자리 |
| 비워 둘 것 | 사람 · 병사 · 말 · 깃발의 글자 · 지명 글씨 · 나침반 · 범례 상자 · 제목 칸 — **전부 그리지 않는다.** 장수는 게임이 얹고, 글자는 열 언어로 바뀌어야 한다 |
| 밀도 | 판 위에 격자와 장수가 얹히므로 **가운데 1/3은 비교적 트이게**(들판 · 길 · 물가). 산 · 숲 · 성 같은 큰 덩어리는 가장자리와 위아래 끝으로 |
| 파일 이름 | `tutorial-{장수 id}.jpg` (아래 표의 id) |
| 놓는 곳 | `assets/tutorial/map/` |

**그림이 먼저, 판 데이터가 나중이다.** 생성 도구는 칸 단위 위치를 지키지 못한다 — 그림을 받은 뒤 다리 · 성문 · 목표 칸 같은
판 위 요소를 **그림에 맞춰** 데이터에 놓는다. 그래서 프롬프트는 「대략 어디쯤」까지만 적었다.

## 고정 접두 (30장 모두 맨 앞에)

```
Hand-drawn antique battlefield map of ancient China, Three Kingdoms era, oblique bird's-eye view from the south,
ink line art with soft muted watercolor washes on aged parchment paper, sepia, ochre, sage green and slate blue palette,
in the style of an old illustrated Chinese military map, 4:3 landscape, full bleed edge to edge, no border, no frame,
the top third is the northern enemy side, the bottom third is the southern friendly side,
the middle third is relatively open ground for a game grid to be overlaid, large landmarks kept toward the edges,
no people, no soldiers, no horses, no text, no letters, no characters, no labels, no compass rose, no legend box, no title cartouche.
```

## 30장

| 장수 | id | 무대 |
|---|---|---|
| 가후 | `ga-hu` | 완성 (197) |
| 감녕 | `gam-nyeong` | 유수구 야습 (213) |
| 강유 | `gang-yu` | 철롱산 (253) |
| 곽가 | `gwak-ga` | 하북 평정 (204~) |
| 관우 | `gwan-u` | 사수관 (190) |
| 노숙 | `no-suk` | 익양 대치 (215) |
| 마초 | `ma-cho` | 가맹관 (214) |
| 방덕 | `bang-deok` | 번성 (219) |
| 방통 | `bang-tong` | 적벽 · 연환 (208) |
| 사마의 | `sa-ma-ui` | 오장원 (234) |
| 서서 | `seo-seo` | 신야 팔문금쇄 (201) |
| 서황 | `seo-hwang` | 번성 구원 (219) |
| 손견 | `son-gyeon` | 양인 (191) |
| 손권 | `son-gwon` | 유수구 수비 (213) |
| 순욱 | `sun-uk` | 서주 (196) |
| 여몽 | `yeo-mong` | 형주 기습 (219) |
| 여포 | `yeo-po` | 복양 (194) |
| 유비 | `yu-bi` | 면죽 (214) |
| 육손 | `yuk-son` | 이릉 (222) |
| 장료 | `jang-ryo` | 합비 · 소요진 (215) |
| 장비 | `jang-bi` | 장판교 (208) |
| 장합 | `jang-hap` | 가정 (228) |
| 제갈량 | `je-gal-ryang` | 적벽 · 동남풍 (208) |
| 조운 | `jo-un` | 장판 (208) |
| 조조 | `jo-jo` | 서주 · 하비 (200) |
| 주유 | `ju-yu` | 적벽 전야 (208) |
| 태사자 | `tae-sa-ja` | 북해 (193) |
| 하후돈 | `ha-hu-don` | 하비 (198) |
| 허저 | `heo-jeo` | 위수 도하 (211) |
| 황충 | `hwang-chung` | 정군산 (219) |

각 줄은 **고정 접두 뒤에** 붙인다. 괄호 안 한국어는 의도 설명이라 프롬프트에 넣지 않는다.

1. **가후 `ga-hu`** — 완성 (적 조조가 북쪽 진영, 아군 장수 군이 남쪽 성 앞)
   `the walled town of Wancheng at the bottom edge with its north gate facing the field, a camp of enemy tents and palisades across the top edge, gentle farmland and a winding dirt road between them, late autumn.`
2. **감녕 `gam-nyeong`** — 유수구 야습 (적 진영이 목책 · 해자로 막혀 있다)
   `night scene, moonlit river mouth, a heavily fortified enemy camp along the top edge ringed by wooden palisades, a ditch and watchtowers with lit braziers, a riverbank and moored boats at the bottom edge, dark blue washes with warm firelight accents.`
3. **강유 `gang-yu`** — 철롱산 (사방이 산, 가운데 분지)
   `a high mountain basin surrounded by jagged rocky peaks on all sides, a dry stream bed crossing the middle, sparse pines, an enemy encampment on a ridge at the top, a narrow pass opening at the bottom, cold grey-green tones.`
4. **곽가 `gwak-ga`** — 하북 평정 (넓은 북방 평원)
   `wide northern plains of Hebei, a large fortified city wall along the top edge, open wheat fields and scattered villages, a frozen stream, a supply road coming up from the bottom, early winter, pale washes.`
5. **관우 `gwan-u`** — 사수관 (북쪽에 관문, 남쪽에 연합군 진채)
   `a massive mountain pass fortress gate (Sishui Pass) set in steep cliffs across the top edge, a wide trampled plain before it, allied coalition camp tents and palisades along the bottom edge, dramatic cliffs on both sides.`
6. **노숙 `no-suk`** — 익양 (강을 사이에 둔 대치)
   `two armies facing across a calm river that runs horizontally through the upper middle, a shallow ford in the center, reed beds, a small pavilion on the southern bank for a parley, gentle hills, early spring.`
7. **마초 `ma-cho`** — 가맹관 (좁은 관문 앞 일기토 터)
   `the mountain fortress gate of Jiameng Pass at the top edge flanked by steep rocky slopes, a flat dusty duelling ground in the middle, pine-covered ridges on both sides, the southern approach road at the bottom.`
8. **방덕 `bang-deok`** — 번성 (불어난 한수, 성 하나)
   `the city of Fancheng with thick walls at the bottom center, flooded farmland and the swollen Han River spreading across the top third, half-submerged trees and dikes, grey rainy sky, muddy brown water.`
9. **방통 `bang-tong`** — 적벽 · 연환 (쇠사슬로 묶인 배들)
   `the Yangtze river at Red Cliffs filling the top half, a large fleet of warships chained together in a dense block near the top, steep red cliffs on the lower right bank, a southern shore with small docks at the bottom, calm water before a storm.`
10. **사마의 `sa-ma-ui`** — 오장원 (고원 위 두 진채)
    `the Wuzhang Plains plateau, an enemy camp with tents and a central command tent on the high ground at the top, a fortified friendly camp with earthen ramparts at the bottom, the Wei River glimpsed along one side, quiet autumn evening.`
11. **서서 `seo-seo`** — 신야 팔문금쇄진 (적 진형이 그려진 들판)
    `open fields near Xinye, the enemy deployed in an eight-gated formation of palisade segments arranged in an octagon near the top, small earthen gates between them, the modest town of Xinye at the bottom edge, early summer greenery.`
12. **서황 `seo-hwang`** — 번성 구원 (포위된 성을 향해 북진)
    `the besieged city of Fancheng at the top edge encircled by enemy siege lines, trenches and stockades, a river crossing on one side, a relief army's approach road and fields at the bottom, smoke rising from the siege.`
13. **손견 `son-gyeon`** — 양인 (숲 · 들판의 야전)
    `the countryside near Yangren, a wooded hill and an enemy camp at the top, open grass fields and a small stream in the middle, a modest friendly camp with red banners (no text) at the bottom, dusk light.`
14. **손권 `son-gwon`** — 유수구 수비 (남쪽 강안의 성채)
    `a fortified river mouth fortress (Ruxu) with stone and timber walls at the bottom center, the river and its estuary curving across the right side, a broad approach plain at the top where the enemy advances, overcast sky.`
15. **순욱 `sun-uk`** — 서주 (두 세력의 진영이 나란히)
    `the plains of Xuzhou, two separate enemy camps side by side across the top edge divided by a small stream, a central crossroads, a friendly camp on a low hill at the bottom, golden late afternoon.`
16. **여몽 `yeo-mong`** — 형주 기습 (강을 건너 성까지)
    `the Yangtze river running across the bottom third with merchant boats near the southern bank, beacon towers along the northern shore, the walled city of Jiangling at the top edge, riverside paths and farmland in between, misty morning.`
17. **여포 `yeo-po`** — 복양 (적 진영 한가운데)
    `the city of Puyang with walls along the bottom edge, a large enemy camp with many tents and corrals filling the top third, open ground in the middle scarred by fire, smoke drifting, dramatic red-orange evening sky.`
18. **유비 `yu-bi`** — 면죽 (촉 땅 산길과 관문)
    `the Mianzhu pass in Shu, a walled pass-town at the top edge, terraced fields and bamboo groves on the slopes, a mountain road climbing from the bottom, misty green mountains, humid atmosphere.`
19. **육손 `yuk-son`** — 이릉 (숲을 따라 늘어선 진채)
    `a long line of enemy camps stretched through dense forest along the top third, the river gorge of Yiling on one side, dry grass and summer heat, a small friendly camp at the bottom, some forest edges already smoldering.`
20. **장료 `jang-ryo`** — 합비 · 소요진 (다리 하나와 성)
    `the city of Hefei with walls at the bottom edge, the Xiaoyao ford and a single wooden bridge over a stream in the upper middle, an enemy camp beyond the stream at the top, early winter fields.`
21. **장비 `jang-bi`** — 장판교 (다리 하나가 전부)
    `a single narrow wooden bridge over a river at the exact center of the map, the river running horizontally across the middle, the northern bank at the top open and dusty with distant woods, the southern bank at the bottom with a dirt road leading away, dust clouds in the north.`
22. **장합 `jang-hap`** — 가정 (외딴 산 위 진채)
    `the pass of Jieting, an isolated hill with an enemy camp perched on top near the upper center, a dry riverbed and a road junction below it, the friendly side's road and fields at the bottom, arid brown hills.`
23. **제갈량 `je-gal-ryang`** — 적벽 · 동남풍 (바람과 불)
    `Red Cliffs at night, the enemy fleet anchored along the northern shore at the top, the wide river in the middle with wind-blown waves, a tall altar platform for summoning wind on a hill at the bottom left, strong southeast wind shown by swirling clouds.`
24. **조운 `jo-un`** — 장판 (적 무리 사이를 뚫는 길)
    `the plains of Changban, a long road running from the top edge down to the bottom edge, scattered abandoned carts and ruined villages along it, small woods and a dry well, smoke and dust, the bottom edge leading to a river crossing.`
25. **조조 `jo-jo`** — 서주 · 하비 (적 성과 들판)
    `the walled city of Xiapi at the top edge surrounded by rivers on two sides, open farmland in the middle, a friendly army camp on the southern hills at the bottom, early spring.`
26. **주유 `ju-yu`** — 적벽 전야 (강 양안의 진영)
    `the Yangtze at Red Cliffs by day, the enemy fleet and riverside camp along the top, the river across the upper middle, a southern riverbank camp with docks and a punishment yard (empty) at the bottom, red cliffs to one side.`
27. **태사자 `tae-sa-ja`** — 북해 (포위된 성 앞)
    `the walled city of Beihai at the bottom edge besieged by a loose rebel camp of ragged tents and yellow cloth scraps (no text) across the top, trampled fields between, a narrow road to the city gate.`
28. **하후돈 `ha-hu-don`** — 하비 (사방에서 몰려오는 포위)
    `a flat battlefield near Xiapi, a small earthen fort at the bottom center, enemy camps at the top left and top right, crisscrossing roads and ditches, a grey sky with arrows of rain.`
29. **허저 `heo-jeo`** — 위수 도하 (북쪽 강 건너가 목표)
    `the Wei River running horizontally across the top third, a few boats moored at the southern bank, sandbanks and reeds, an enemy camp on the southern plain at the bottom left, the northern far bank at the top edge, cold wind.`
30. **황충 `hwang-chung`** — 정군산 (산 위의 적장)
    `Dingjun Mountain, a steep mountain with an enemy command camp on its summit near the top center, switchback paths and rocky outcrops on the slopes, a valley and stream at the bottom where the friendly army gathers.`

## 받은 뒤

1. 700px 화면 크기로 판 위에 깔아 **격자 · 장수가 읽히는지** 본다(밝은 들판 위에서 사라지는 장수 그림이 있었다).
2. 다리 · 성문 · 목표 칸 · 막힌 칸을 **그림에 맞춰** 튜토리얼 데이터에 놓는다.
3. 굽는 도구는 도적떼 맵을 굽는 자리(`build_frames.py`)를 본떠 판 비율 · 해상도를 맞춘다.
