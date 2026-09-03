# 삼국지 SD 캐릭터 카드 — Gemini 티칭(가이드) 프롬프트

원작 삼국지 인물 초상화 3장 → 귀여운 2등신 캐릭터 3명이 든 카드 1장(1376×768)으로 변환.

## 이 문서 사용법 (2단계 대화)

Gemini 새 채팅을 열고 **두 번에 나눠** 준다.

- **[1단계] 스타일 학습** — 아래 「티칭 프롬프트」를 붙이고, **정규형 예시 output 1장을 함께 첨부**한다.
  Gemini가 "이 스타일 이해했다"고 답하면 성공. (이 단계에서는 그림을 그리지 않는다.)
- **[2단계] 실제 생성** — 인물 초상화 3장을 첨부하고 이름을 알려준다. 그러면 그때 카드를 그린다.
  → 이 단계 문구는 맨 아래 「2단계 트리거 문장」 참고.

**예시로 첨부할 파일**: 반드시 **3인 완성본**을 원본 그대로(풀해상도) 준다.
가장 깔끔하고 귀여운 추천본 → `images/17/output` 또는 `images/20/output` 의 PNG.
(별점을 원치 않으면 `images/1/output`처럼 별점 없는 것을 고르거나, 티칭 프롬프트의 별점 줄을 지운다.)

---

## ★ 티칭 프롬프트 (1단계 — 예시 이미지와 함께 붙여넣기)

```
너는 지금부터 '삼국지 모바일 게임'의 캐릭터 셀렉트 화면을 그리는 픽셀아트 아티스트다.
방금 첨부한 이미지는 내가 원하는 결과물의 "정답 예시(레퍼런스)"다.
지금은 그림을 그리지 마라. 먼저 이 예시의 화풍을 아래 설명과 대조하며 완벽히 학습하고,
이해했다고만 답하라. 이후 내가 인물 초상화 3장과 이름을 주면, 그때 이 예시와
"똑같은 스타일"로 카드 1장을 그린다.

── 이 예시를 이렇게 읽어라 (다음에 그릴 때 반드시 지킬 규칙) ──

[1] 캔버스
- 크기: 가로 1376 × 세로 768 픽셀, 정확히 이 크기의 가로형 이미지 1장.
- 테두리: 화면 가장자리까지 꽉 채우는 직사각 금색 이중선 프레임(네 모서리에 작은 장식).
  둥근 모서리 카드나 여백 있는 카드가 아니다 — 프레임이 캔버스 끝에 붙는다.

[2] 화풍 (★★ 가장 중요)
- 16비트 레트로 게임풍 "도트 픽셀아트". 각진 픽셀 계단이 눈에 보이고, 굵은 검정 외곽선,
  면 단위 셀셰이딩, 제한된 색 팔레트, 따뜻한 채도.
- 매끈한 벡터·일러스트·카툰·에어브러시·3D 렌더 느낌은 절대 금지.
  반드시 픽셀이 도드라지는 도트 그림이어야 한다.

[3] 캐릭터 비율 (★★ 가장 중요)
- 머리 : 목 아래 몸 전체 = 1 : 1 ~ 1 : 1.5.
  즉 전체 키가 "머리 약 2~2.5개" 높이인 초귀여운 SD(등신) 캐릭터.
- 머리를 크고 몸을 작고 짧게. 절대 사실적인 3~4등신으로 키우지 마라.

[4] 얼굴 (★★ 가장 중요)
- 둥글둥글하고 귀여운 얼굴. 큰 머리, 부드럽고 통통한 볼, 단순화된 큰 눈, 작은 코/입.
- 사납거나 사실적인 성인 얼굴 비율 금지. 아기자기하고 순한 인상으로.

[5] 구도
- 캐릭터 3명을 세로 구분선 2개로 나뉜 3칸에 각각 1명씩, 정면 전신 입상으로.
- 각 캐릭터 발밑에 작은 잔디 더미와 회색 돌 1개.
- 세 명의 크기·눈높이·발 위치를 서로 맞춰 통일감 있게.

[6] 배경
- 낡은 양피지에 손으로 그린 고대 중국(후한) 지도. 베이지·세피아 종이색,
  강·바다는 흐린 청록. 은은하게 — 캐릭터보다 튀지 않게.

[7] 로고
- 좌상단 구석에 작은 게임 로고: 붉은 한자 "三國志" 아래 작은 영문 "MOBILE GAME".

[8] 이름표 / 별점
- 각 캐릭터 아래 나무·양피지 명패에 한글 이름. (예시에 상단 명패도 있으면 상단에도 동일하게.)
- 이름표·별점의 위치와 형태는 "첨부한 예시에 있는 그대로" 따른다.
  ※ 별점을 넣지 않으려면: 명패에는 이름 글자만 넣고 별·등급 표시는 그리지 마라.
- 이름 자리에는 실제 한글 이름만. 대괄호 [ ]·꺾쇠 < > 같은 기호는 절대 그리지 마라.

── 초상화를 캐릭터로 바꾸는 방법 ──
- 내가 줄 초상화는 원작 삼국지의 사실적 인물 얼굴이다. 이걸 위 예시 화풍의
  귀여운 2등신 캐릭터로 "재해석"해라(그대로 붙여넣기가 아니라 새로 그리기).
- 각 인물의 얼굴·수염·투구/관모·복색을 알아보게 유지하되, 그 인물의 정체성에 맞는
  시대 복식과 시그니처 무기/지물을 들려라
  (무장 = 갑옷 + 무기, 책사 = 도포 + 부채/죽간, 궁수 = 활 등).
- 첨부 초상화 3장의 왼→오 순서를 카드 3칸의 왼→오 순서에 그대로 매핑.

── 그리기 직전 자가 점검 ──
출력 전 스스로 확인하고, 하나라도 아니면 고쳐서 다시 그려라:
(a) 이미지 사이즈가 1376×768 픽셀 인가  
(b) 도트 픽셀 질감인가  
(c) 머리:몸 비율은 1:1~1.2 로 귀여운가
(d) 얼굴이 둥글고 귀여운가  
(e) 프레임이 가장자리까지 꽉 찼는가.

지금은 위 스타일을 이해했는지만 답하고, 내가 초상화 3장을 줄 때까지 대기하라.
```

---

## 2단계 트리거 문장 (초상화 3장 첨부하며 보낼 말)

```
앞서 학습한 예시 스타일 그대로, 첨부한 이 초상화 3장을 카드 1장으로 그려줘.
왼→오 순서 그대로. 명패 이름은 왼쪽부터: 마속 / 우금 / 악진.
(1376×768, 도트 픽셀아트, 머리:몸 1:1~1.5 둥근 귀여운 얼굴 — 예시와 똑같이.)
```

- `마속 / 우금 / 악진` 자리에 실제 이름을 **괄호 없이** 적는다.
- 결과가 예시와 어긋나면: 어긋난 항목만 콕 집어 재지시한다
  (예: "머리를 더 크게, 2등신으로", "매끈해졌어 — 각진 도트 픽셀로", "프레임을 가장자리까지").

---

## English 버전 (모델이 영어에서 더 안정적일 때)

### Teaching prompt (Step 1 — send WITH the example image)
```
From now on you are a pixel-art artist drawing the character-select screen of a
"Three Kingdoms mobile game". The image I just attached is the REFERENCE — the exact
result style I want. Do NOT draw yet. First study its art style against the notes below
and confirm you understand. Later I will send 3 character portraits + names, and THEN you
draw one card in this EXACT same style.

── Read the reference like this (rules you MUST follow when drawing) ──

[1] CANVAS
- Exactly 1376 x 768 px, one landscape image.
- A rectangular gold double-line border filling the canvas EDGE-TO-EDGE (small corner ornaments).
  NOT a rounded card, NOT a card with margins — the frame touches the canvas edges.

[2] ART STYLE (MOST IMPORTANT)
- 16-bit retro-game DOT PIXEL ART: visible blocky/stair-stepped pixels, thick black outlines,
  flat cel-shading, limited palette, warm saturation.
- Absolutely NO smooth vector / illustration / cartoon / airbrush / 3D look. It MUST read as pixel art.

[3] PROPORTIONS (MOST IMPORTANT)
- Head : body-below-neck = 1 : 1 to 1 : 1.5  (total height ≈ 2 to 2.5 heads).
- Big head, small short body. NEVER a realistic 3–4-head-tall figure.

[4] FACE (MOST IMPORTANT)
- Round, cute face: big head, soft chubby cheeks, simplified big eyes, small nose/mouth.
- No fierce or realistic adult proportions — keep it adorable and gentle.

[5] COMPOSITION
- 3 characters, one per panel, split by two vertical dividers; front-facing full-body standing.
- A small grass tuft with one grey rock under each. Match size, eye level and foot line across all three.

[6] BACKGROUND
- Hand-drawn ancient-China (Later Han) map on aged parchment; beige/sepia, faint teal water. Keep it subtle.

[7] LOGO
- Top-left: red "三國志" with small "MOBILE GAME" beneath.

[8] NAME PLATES / STARS
- Korean name on a wooden/parchment plate under each character (and on top too if the reference has it).
- Copy the plate/stars layout EXACTLY from the attached reference.
  (To omit stars: put only the name text, draw no stars.)
- Put ONLY the real Korean name — never draw brackets [ ] or < >.

── How to convert portraits ──
- The portraits I give are realistic Three-Kingdoms faces. REDRAW each as a cute 2-head chibi in the
  style above (not a paste-in). Keep face/beard/helmet/cap/colors recognizable, dress them in period
  costume with their signature weapon/prop (warrior = armor+weapon, strategist = robe+fan/scroll, archer = bow).
- Map the 3 portraits left→right onto the 3 panels left→right.

── Self-check before drawing ──
(a) 1376×768?  (b) dot-pixel texture?  (c) head:body 1:1–1.5 and cute?  (d) round cute face?
(e) frame edge-to-edge?  Fix and redraw if any is "no".

For now, only confirm you understand. Wait until I send the 3 portraits.
```

### Trigger (Step 2 — send with the 3 portraits)
```
Now draw ONE card from these 3 attached portraits in the EXACT style you just learned.
Same left→right order. Name plates left→right: 마속 / 우금 / 악진.
(1376×768, dot pixel art, head:body 1:1–1.5, round cute faces — identical to the reference.)
```

---

---

# 궁궐 UI 패널 배경 — 두루마리/목판 프레임 (고유기술 팝업 등)

**용도**: `.modal[data-modal="settings"]`가 이미 쓰는 것과 같은 9분할
`border-image` 프레임(`panel_settings.png`)을, 고유기술 팝업
(`.ofc-skill-modal`, `assets/icons/panel_skill.png`)에도 새로 입힌다.
이런 팝업/패널 배경 그림을 새로 하나 더 받아야 할 때는 이 절을 그대로
재사용하고 **자리 이름(파일명)만** 바꾼다.

## 이 문서 사용법

이미지 생성 AI(Gemini 등)에 아래 프롬프트를 그대로 준다. 예시 이미지가
있으면(예: 이미 만든 `panel_settings.png`) 함께 첨부해 "이 화풍 그대로,
다만 아래 조건에 맞는 새 패널로"라고 덧붙이면 더 안정적이다.

## ★ 프롬프트

```
삼국지 배경의 모바일 게임에서 쓸 UI 팝업 패널 배경 그림을 그려줘.

[1] 캔버스
- 세로로 긴 직사각형 1장 (예: 900×1400px 안팎, 정확한 비율은 자유— 어차피
  CSS가 9분할로 늘려 쓴다).
- 그림이 캔버스 가장자리까지 꽉 찬다. 여백이나 둥근 모서리, 그림자 없이
  네모 반듯한 판 하나가 캔버스를 통째로 채운다.

[2] 화풍 (★ 가장 중요)
- 낡은 두루마리(양피지/종이)이거나 옻칠한 고급 목판 — 고대 중국 후한~삼국
  시대 궁궐에서 쓸 법한 재질. 손으로 그린 수채화 느낌의 질감(매끈한
  벡터·3D 렌더 금지).
- 색은 짙은 밤색·세피아·고동색 계열 바탕에 금색·청동색 장식선. 전체적으로
  어둡고 차분한 톤 — 그 위에 크림색·금색 글자를 얹을 것이므로 **바탕이
  너무 밝거나 알록달록하면 안 된다.**

[3] 테두리 (★ 가장 중요 — 9분할로 늘어난다)
- 네 변에 골고루 두꺼운 테두리 장식(금박 무늬, 옻칠 나뭇결, 못대가리 등
  반복 가능한 문양)을 두른다. 위·아래 테두리가 특히 두껍게(그림 전체 세로
  길이의 약 15%), 좌우는 그보다 살짝 얇게(약 16%의 폭 — 즉 세로가 가로보다
  비율상 더 큰 테두리).
- **테두리 문양은 이어 붙였을 때(반복/늘림) 자연스러워야 한다** — 특정
  위치에만 있는 독특한 장식(용 조각 하나, 글자 낙관 등)을 테두리 중간에
  넣지 마라. 네 귀퉁이에만 작은 장식(구름무늬·매듭 등)을 넣는 것은 괜찮다.

[4] 가운데 (★ 가장 중요 — 늘려서 배경으로 그대로 쓴다)
- 테두리 안쪽 가운데 영역은 인물·글자·큰 무늬 없이 **낡은 종이/목판의
  결·얼룩·은은한 구름무늬 정도의 잔잔한 질감**만 있어야 한다. 세로·가로로
  늘어나도 어색하지 않은, 패턴이 없는 균일한 질감이어야 한다 —
  가운데에 그림(용·봉황·인물 등)을 크게 그려 넣으면 늘어나면서 심하게
  일그러진다.

[5] 참고
- 이미 있는 환경설정 팝업 배경(`panel_settings.png`, 세로 두루마리
  9분할 프레임)과 같은 세트로 보여야 한다 — 재질·색감·장식 밀도를
  맞춰라.

── 그리기 직전 자가 점검 ──
(a) 세로로 긴 사각형이 캔버스 가장자리까지 꽉 찼는가
(b) 두루마리/목판 질감이고 벡터·3D가 아닌가
(c) 바탕이 어두운 세피아·밤색 계열이라 크림·금색 글자가 잘 보이겠는가
(d) 테두리 문양이 반복해도 자연스러운가, 중간에 독특한 장식이 끼어있지 않은가
(e) 가운데 영역이 패턴 없이 잔잔한 질감뿐인가
```

## 적용하는 법

1. 위 프롬프트로 받은 그림을 `panel_skill.png`로 `assets/icons/`에 넣는다
   (레포에 커밋되는 폴더가 아니다 — 로컬에만 있으면 된다).
2. `npm run ui` (`tools/build_ui.py`)를 돌리면 `packages/client/public/ui/panel-skill.png`로
   구워진다.
3. 고유기술 팝업(`.ofc-skill-modal`, `style.css`)이 이미 그 파일을 참조하도록
   배선돼 있다 — 그림만 넣으면 바로 반영된다. 잘려 보이면 `style.css`의
   `.modal.ofc-skill-modal`의 `border-image` 슬라이스 값(`15% 16%`)을
   실제 그림 테두리 두께에 맞춰 눈대중으로 조정한다(`.modal[data-modal="settings"]`와
   같은 방식 — 자·표가 따로 있는 게 아니다).

---

## 팁 / 자주 나는 실패

- **가장 흔한 실패 3종**
  ① 매끈한 일러스트로 나옴 → "각진 도트 픽셀아트, 매끈한 일러스트 금지"를 다시 강조.
  ② 키가 커지고 안 귀여움 → "머리:몸 1:1~1.5, 머리 크게, 둥근 얼굴"을 다시 강조.
  ③ 둥근 카드/여백 → "프레임을 캔버스 가장자리까지 꽉 채워"라고 재지시.
- **참조가 있을 땐 긴 설명이 이미지와 경쟁**해 모델이 자기 스타일로 회귀한다. 그래서 2단계 트리거는
  짧게 유지하고, 화풍은 예시 이미지에 맡긴다.
- 이름은 오식별 방지를 위해 직접 알려주는 게 안전하다(초상화만으로 인물 추정에 맡기지 말 것).
- 한 메시지에 예시 1장 + 초상화 3장을 같이 주면 예시까지 변환하려 든다 → 반드시 1·2단계를 나눠라.
- Gemini 이미지 모델은 생성마다 편차가 남는다. 픽셀 단위 완전 동일이 필요하면, 새로 생성하는 대신
  기존 output 1장을 열어 얼굴/이름만 부분 편집(인페인팅)하는 방식이 가장 확실하다.
