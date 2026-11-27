#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CharsAction/ 의 5칸 액션 띠를 웹용 스프라이트시트로 굽는다.

    python tools/build_action_sheets.py [--size 110] [--force] [--only 관우] [--sheet 대조.png]

| 원본 | 출력 |
|---|---|
| `assets/CharsAction/{이름}.png|jpg` 1535×310 (307×310 × 5칸) | `public/actions/{장수id}.png` 550×110 (110² × 5칸) — **전투 판** |
| 〃 | `public/actions-hd/{장수id}.webp` 1200×240 (240² × 5칸) — **화면**(장수 카드·뽑기 결과) |

두 벌은 한 번의 처리에서 크기만 달리 뽑는다 — 칸 안 자리(몸통 90%·발끝 95%)가 같아서
화면이 어느 쪽을 그려도 같은 그림이다.

칸 순서는 **대기 · 이동 · 공격 · 책략/명상 · 피격** 이다(왼→오). 「명상」과 「책략」은
같은 칸을 쓴다(2026-08-07 기획자 확정) — 둘 다 제자리에서 기를 모으는 그림이다.

가로로 이어 붙인 채로 내보내는 이유는 **Phaser가 그대로 읽기 때문**이다.
`load.spritesheet(key, url, {frameWidth: 110, frameHeight: 110})` 한 줄이면 칸을
잘라 주고, 상태 전환은 `setFrame(n)` — 텍스처 교체가 없다. 5개 파일로 쪼개면
요청이 5배가 되고 애니메이션도 직접 짜야 한다.

────────────────────────────────────────────────────────────────
입력 두 갈래
────────────────────────────────────────────────────────────────

**마젠타 합성본(JPG)** — 생성기가 배경을 단색으로 깔아 준 것. 108장.
배경색을 정확히 아니까 `p = a·F + (1−a)·B` 를 풀어 알파를 **복원**한다.
배경색은 파일마다 다시 뽑는다 — 순수 마젠타가 아닌 것도 있다(이엄 `(212,68,212)`,
주강 `(252,132,252)`). 색이 캐릭터와 구분만 되면 된다.

**알파 PNG** — 기획자가 손으로 배경을 지운 것. 152장. 알파를 그대로 믿는다.

같은 장수가 양쪽에 있으면 PNG를 쓴다. 실측으로는 **JPG 직접이 낫다** — 배경제거를
먼저 돌리면 경계 픽셀이 "얼마나 배경이었는지"가 사라져 마젠타 테두리가 남는다
(같은 장수 8명 비교에서 잔여 마젠타 30,000px 대 100px).

────────────────────────────────────────────────────────────────
하는 일
────────────────────────────────────────────────────────────────

1. **가장자리 띠 제거.** 원본 위·아래 몇 줄이 어두운 띠다. 260장 거의 전부에 있다.
2. **배경 제거.** 위 두 갈래.
3. **칸 나누기.** `round(W*i/5)` — 크기를 상수로 박지 않는다.
4. **몸통 5개 찾기.** 균등분할은 무기·이펙트를 자른다(경계 608곳 중 178곳). 대신 큰
   덩어리 5개를 몸통으로 잡고, 작은 조각은 가장 가까운 몸통에 배정한다. 152장 전수 성공.
5. **잔디·자갈 제거 + 타원 그림자.** 잔디가 71%에만 있어 그대로 두면 제각각이다.
   그림자는 코드로 그리므로 **정의상 260명이 똑같다.**
6. **정렬·정규화.** 몸통 높이를 `TARGET_BODY` 로 맞추고(장수마다 239~305로 28% 차이),
   발끝과 몸통 중심을 칸 안 같은 자리에 놓는다. 축소는 RGBa 를 거친다.

의존성: Pillow · numpy · scipy. 원본은 읽기만 한다.
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "CharsAction"
OFFICERS = ROOT / "packages" / "data" / "generated" / "officers.json"
OUT = ROOT / "packages" / "client" / "public" / "actions"
# 화면(장수 카드·뽑기 결과·장수 상세)용 큰 시트. 110²는 전투 판 한 칸에 맞춘 크기라
# 화면에서 118px 남짓으로 그리면 2배 화면에서 두 배로 늘어나 번졌다(2026-09-24).
# 전투 판은 계속 110²를 쓴다 — Phaser의 `frameWidth`가 그 값이다
OUT_HD = ROOT / "packages" / "client" / "public" / "actions-hd"
HD_SIZE = 240        # 원본 몸통(239~305px)을 칸의 90%에 맞추면 거의 줄이지도 늘리지도 않는 크기
HD_QUALITY = 88

EXTS = (".png", ".jpg", ".jpeg", ".webp")      # 앞쪽 우선 (같은 장수면 PNG를 쓴다)
FRAMES = 5
ACTIONS = ("대기", "이동", "공격", "책략·명상", "피격")
EIGHT = np.ones((3, 3), bool)

# ── 가장자리 띠 ─────────────────────────────────────────────────
BAND_FILL = 0.9      # 가로폭의 이만큼이 차 있는 가장자리 줄은 지워지지 않은 띠로 본다.
                     # 0.5로 두면 안 된다 — 발치에서는 캐릭터 5명만으로 65%가 찬다
BAND_MAX = 8         # 띠가 이보다 두꺼우면 띠가 아니라 배경 제거 실패다. 안 지운다

# ── 마젠타 합성본 ───────────────────────────────────────────────
RING_IN, RING_OUT = 6, 14   # 배경 색 표본을 뽑을 띠. **맨 가장자리는 피한다** —
                            # 위·아래 몇 줄이 어두운 띠라 거기서 뽑으면 오판한다
BIN = 8                     # 표본을 뭉칠 격자
BG_TOL = 70                 # 테두리에서 번져 나갈 때 배경으로 볼 색차(채널별 최대)
ENCLOSED_TOL = 48           # 갇힌 배경까지 잡는 색차. 연결성을 안 보므로 더 좁게 잡는다
CHROMA_TOL = 0.035          # 그림자 씨앗의 색도 거리. 확실한 캐릭터 픽셀은 1%도 0.05 위다
CHROMA_GROW = 0.11          # 씨앗에서 번져 나갈 때의 느슨한 색도 거리
CORE_DIST = 110             # 배경색에서 이만큼 멀면 오염 안 된 속살로 본다
CORE_BAND = 3               # 배경에서 이만큼 떨어져 있어도 속살로 본다(색이 비슷해도)
SEED_MARGIN = 16            # 배경 플러드의 씨앗을 놓을 가장자리 폭
ALPHA_KILL = 0.06           # 이보다 옅으면 버린다

# ── 잔디 ────────────────────────────────────────────────────────
GRASS_ZONE = 0.78    # 프레임 세로의 이 아래쪽에서만 잔디를 찾는다
GRASS_GB = 42        # G−B 가 이 이상이면 노란 초록 = 잔디. 몸통 청록은 35 근처다
GRASS_GR = 4         # G−R 하한
GRASS_MIN_V = 70     # 너무 어두우면 그림자지 잔디가 아니다
GROUND_RIM = 5       # 잔디판 바깥으로 이만큼(px)까지를 판 테두리로 본다
GROUND_GREEN = 15    # 그늘진 풀 — 잡힌 잔디에 이어진 픽셀 가운데 G − B 가 이만큼,
GROUND_GREEN_R = 8   #   G − R 이 이만큼 이상이면 풀로 넓힌다
GROUND_THIN = 2      # 〃 그 안에서 이 열기(opening)로 사라지는 가는 것만 걷는다 — 두께 ≈ 4px 아래
GRASS_CORE_FRAC = 0.05  # 잔디판 윗선을 잴 덩어리 — 가장 큰 잔디 덩어리의 이만큼 이상(옷에 찍힌 연두 점을 뺀다)
GRASS_CORE_MIN = 60     # 〃 그리고 이만큼(px) 이상
GRASS_WIDE_FRAC = 0.5  # 판이 「넓게 펼쳐지는 줄」 — 잔디가 가장 넓은 줄의 이만큼 이상인 첫 줄
GRASS_BAND_SLACK = 6   # 〃 그 줄보다 이만큼(px) 위까지만 잔디로 본다
GRASS_MATCH = 30       # 옷 되돌리기 — 판의 색(중앙값)과 RGB 거리가 이만큼 넘게 떨어진 초록만 옷으로 본다(판 안 잔디는 25 안쪽)
CLOTH_CLOSE = 2         # 옷 되돌리기 — 되돌린 옷 사이 틈을 이만큼 닫아(closing) 메운다
GRASS_RUN = 5          # 판의 윗선 = 열마다 잔디가 세로로 이만큼 연달아 차는 첫 자리(옷단의 흩어진 연두 점은 안 걸린다)
GRASS_TOP_MARGIN = 2  # 윗선보다 이만큼 위까지는 판으로 본다(판 윗가장자리의 그늘 줄)
DEBRIS_MAX = 900    # 잔디를 지운 뒤 바닥에 떨어져 나오는 이만큼 작은 섬은 자갈

# ── 몸통 · 정규화 ───────────────────────────────────────────────
BODY_ALPHA = 0.35    # 이 이상 불투명해야 몸통 후보. 반투명 이펙트를 뺀다
TARGET_BODY = 0.90   # 출력 칸 세로 대비 몸통 높이. 260명을 여기에 맞춘다
FOOT_LINE = 0.95     # 발끝이 놓일 칸 안 세로 위치. 아래 여백은 그림자 몫이다

# ── 그림자 ──────────────────────────────────────────────────────
SHADOW_RX = 0.21     # 몸통 폭 대비 타원 가로 반지름
SHADOW_RY = 0.052    # 〃 세로
SHADOW_A = 0.45      # 한가운데 알파
SHADOW_LIFT = 0.010  # 발끝보다 살짝 위 (칸 세로 대비)


def note(msg: str) -> None:
    print(f"    {msg}", file=sys.stderr)


# ────────────────────────────────────────────────────────────────
# 1. 가장자리 띠
# ────────────────────────────────────────────────────────────────

def strip_bands(alpha: np.ndarray) -> np.ndarray:
    """가로폭의 절반 이상이 차 있는 가장자리 줄을 지운다.

    캐릭터는 띠 전체를 가로지를 수 없으니 그런 줄은 배경 제거가 놓친 잔여물이다.
    260장 거의 전부에 위 1~4px · 아래 1~2px 로 남아 있다.
    """
    a = alpha.copy()

    def lead(fill: np.ndarray) -> int:
        """가장자리부터 연속으로 꽉 찬 줄 수. **BAND_MAX 를 넘으면 띠가 아니다** —
        배경 제거가 통째로 실패한 것이므로 여기서 그림을 다 지워 버리면 안 된다."""
        k = 0
        while k < len(fill) and fill[k] >= BAND_FILL:
            k += 1
        return k if k <= BAND_MAX else 0

    fill = (a > 8).mean(1)
    top, bot = lead(fill), len(fill) - lead(fill[::-1])
    a[:top] = 0
    a[bot:] = 0

    fill = (a > 8).mean(0)
    left, right = lead(fill), len(fill) - lead(fill[::-1])
    a[:, :left] = 0
    a[:, right:] = 0
    return a


# ────────────────────────────────────────────────────────────────
# 2. 배경 제거
# ────────────────────────────────────────────────────────────────

def _bg_color(rgb: np.ndarray) -> np.ndarray:
    """배경색을 파일에서 직접 뽑는다. 순수 마젠타를 가정하지 않는다."""
    h, w, _ = rgb.shape
    ring = np.concatenate([
        rgb[RING_IN:RING_OUT].reshape(-1, 3), rgb[h - RING_OUT:h - RING_IN].reshape(-1, 3),
        rgb[:, RING_IN:RING_OUT].reshape(-1, 3), rgb[:, w - RING_OUT:w - RING_IN].reshape(-1, 3),
    ]).astype(int)
    keys, counts = np.unique(ring // BIN * BIN, axis=0, return_counts=True)
    return (keys[int(np.argmax(counts))] + BIN // 2).astype(np.float32)


def unmix(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """단색 배경 위에 합성된 그림에서 알파와 원래 색을 푼다.

    `p = a·F + (1−a)·B` 에서 B 를 정확히 알고, F 는 가까운 「오염 안 된 속살」의
    색으로 놓으면 a 가 최소자승으로 떨어진다. 배경을 먼저 지우고 받으면 이 식을
    세울 수 없어서 테두리가 남는다 — 그래서 합성본을 그대로 받는 편이 낫다.
    """
    p = rgb.astype(np.float32)
    B = _bg_color(rgb)
    dist = np.abs(p - B).max(2)

    lab, n = ndimage.label(dist < BG_TOL, structure=EIGHT)
    if n:
        # **씨앗은 맨 가장자리가 아니라 안쪽 띠에서 놓는다.** 원본 위·아래 몇 줄이
        # 어두운 띠인데, 그게 배경을 완전히 둘러싸면 캐릭터 사이의 빈 곳이 테두리와
        # 이어지지 않아 통째로 살아남는다(정덕: 배경 15조각 중 2개만 테두리에 닿았다).
        seed = np.zeros(dist.shape, bool)
        seed[:SEED_MARGIN] = seed[-SEED_MARGIN:] = True
        seed[:, :SEED_MARGIN] = seed[:, -SEED_MARGIN:] = True
        edge = set(np.unique(lab[seed]).tolist())
        edge.discard(0)
        bg = np.isin(lab, list(edge))

        # **갇힌 배경도 지운다.** 팔과 몸 사이, 들어올린 무기 아래, 마법진 안쪽처럼
        # 캐릭터가 둘러싼 공간은 테두리와 이어지지 않아 연결성만으로는 안 잡힌다.
        # 배경색에 아주 가까우면(ENCLOSED_TOL) 위치를 따지지 않고 배경으로 본다 —
        # **이렇게 진한 마젠타를 캐릭터에 칠하는 일은 없다**(기획자 확인, 2026-08-11).
        bg |= dist < ENCLOSED_TOL

        # **배경 위에 깔린 그림자도 배경이다.** 생성기가 발밑 그림자를 배경색째 어둡게
        # 칠해 놓은 파일이 있다(장합의 발밑은 (183,9,177) — 마젠타의 72% 밝기).
        # 색차로는 77이라 위 문턱을 넘지만 **색조는 배경과 같다.** 밝기를 나눈
        # 색도로 재고, 배경보다 어두운 것만 잡는다.
        s = np.maximum(p.sum(2, keepdims=True), 1.0)
        chroma = np.abs(p / s - B / max(B.sum(), 1.0)).sum(2)
        darker = p.mean(2) <= B.mean()
        # 좁은 조건으로 씨앗을 놓고 느슨한 조건 안에서만 번진다. 그림자 가장자리는
        # 캐릭터 색과 섞여 색조가 흐려지는데, 씨앗 없이 느슨하게만 잡으면 멀쩡한
        # 어두운 옷까지 먹는다.
        bg |= ndimage.binary_propagation((chroma < CHROMA_TOL) & darker,
                                         mask=(chroma < CHROMA_GROW) & darker,
                                         structure=EIGHT)
    else:
        bg = np.zeros(dist.shape, bool)

    # **안쪽 판정은 색과 위치를 둘 다 본다.**
    #   · 색이 배경과 충분히 다르거나
    #   · 배경에서 CORE_BAND px 넘게 떨어져 있거나
    # 둘 중 하나면 안쪽이다. 색만 보면 배경색과 밝기가 비슷한 회색 갑옷이 안쪽에서
    # 빠지고, 거기에 배경 빼기가 적용되면 **캐릭터가 통째로 물든다**(이엄의 배경은
    # (212,68,212)라 회색 갑옷과의 색차가 92밖에 안 됐다).
    deep = ~ndimage.binary_dilation(bg, EIGHT, iterations=CORE_BAND)
    core = ndimage.binary_erosion(~bg & ((dist > CORE_DIST) | deep), EIGHT)
    if not core.any():
        core = ~bg

    idx = ndimage.distance_transform_edt(~core, return_distances=False, return_indices=True)
    F = p[tuple(idx)]
    v = F - B
    a = np.clip(((p - B) * v).sum(2) / np.maximum((v * v).sum(2), 1e-3), 0.0, 1.0)
    a = np.where(core, 1.0, np.where(bg, 0.0, a))
    a = np.where(a < ALPHA_KILL, 0.0, a)

    # 색 복원. 알파가 낮을수록 추정이 불안해서 이웃 색 쪽으로 섞는다.
    est = (p - (1.0 - a)[..., None] * B) / np.maximum(a, 1e-3)[..., None]
    w = np.clip((a - 0.15) / 0.45, 0, 1)[..., None]
    out = np.where(core[..., None], p, np.clip(w * est + (1 - w) * F, 0, 255))
    return out.astype(np.float32), (a * 255).astype(np.float32), B


BLACK_BG = 26        # 검정 바탕으로 볼 밝기(최댓값 채널) — JPEG 잡티를 넘는 만큼 (`build_anim_frames.py`와 같은 값)
BLACK_HOLE = 14      # 몸 안에 갇힌 틈은 더 어두워야 바탕으로 본다
BLACK_HOLE_MIN = 250 # 갇힌 틈의 최소 넓이 — 머리카락 · 옷의 어두운 칸을 지키려고


def black_backed(rgb: np.ndarray) -> bool:
    """불투명한데 테두리가 거의 다 검정이면 검정 바탕 원본이다.

    원본을 Gemini로 다시 그려 오면(2026-11-16 고창 — 고리 안이 비어 있던 것을 기획자가 고쳐 왔다) 투명도 마젠타도 아닌
    **검정 바탕 · 불투명**으로 온다. 이 갈래가 없을 때는 바탕째 몸으로 읽어 칸이 무너졌다(이동 칸이 머리만 크게)."""
    edge = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    return float((edge.max(-1) <= BLACK_BG).mean()) > 0.9


def black_alpha(rgb: np.ndarray) -> np.ndarray:
    """가장자리에서 이어진 어두운 곳 + 안쪽에 갇힌 넓은 순검정을 지운 알파(0 · 255)."""
    mx = rgb.max(-1)
    lab, _ = ndimage.label(mx <= BLACK_BG)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, edge[edge > 0])
    hole, hn = ndimage.label((mx <= BLACK_HOLE) & ~bg)
    if hn:
        sizes = ndimage.sum(np.ones_like(hole), hole, range(1, hn + 1))
        bg |= np.isin(hole, np.nonzero(sizes >= BLACK_HOLE_MIN * (rgb.shape[0] / 310) ** 2)[0] + 1)
    # 바탕의 잡티(가장자리의 한두 픽셀 점) — 원본 크기에 맞춰 잰 작은 섬은 버린다
    fg, n = ndimage.label(~bg)
    if n:
        sizes = ndimage.sum(np.ones_like(fg), fg, range(1, n + 1))
        bg |= np.isin(fg, np.nonzero(sizes < 24 * (rgb.shape[0] / 310) ** 2)[0] + 1)
    return np.where(bg, 0.0, 255.0).astype(np.float32)


def load(path: Path) -> tuple[np.ndarray, np.ndarray, bool]:
    """RGB(float) · 알파(0~255 float) · 합성본이었는지."""
    with Image.open(path) as im:
        im.load()
        arr = np.array(im.convert("RGBA"))
    alpha = arr[..., 3].astype(np.float32)
    if (alpha == 0).mean() > 0.05:                 # 이미 지워져 있다
        return arr[..., :3].astype(np.float32), strip_bands(alpha), False
    if black_backed(arr[..., :3]):                 # 검정 바탕(Gemini로 다시 그린 원본, 2026-11-16 고창)
        return arr[..., :3].astype(np.float32), strip_bands(black_alpha(arr[..., :3])), False
    rgb, a, _ = unmix(arr[..., :3])
    return rgb, strip_bands(a), True


# ────────────────────────────────────────────────────────────────
# 3~4. 칸 나누기 · 몸통 찾기
# ────────────────────────────────────────────────────────────────

FRINGE_EDGE = 3       # 투명에서 이만큼(px) 안의 픽셀만 테두리 후보
FRINGE_REACH = 3      # 마젠타가 아닌 몸 픽셀이 이만큼 안에 있어야 고친다 — 넓은 분홍 이펙트 · 홀로 선 분홍 획은 안 건드린다
FRINGE_MAG = 40       # min(R, B) − G 가 이 이상이면 마젠타 기운
FRINGE_PURE = 150     # 〃 이 이상이면 거의 순 마젠타 — 반투명(알파 < `FRINGE_PURE_A`)이면 바탕이 번진 것이라
FRINGE_PURE_A = 160   #   몸에서 조금 더 멀어도(`FRINGE_PURE_REACH`) 고친다
FRINGE_PURE_REACH = 6


# 테두리가 두꺼운 원본 — 투명 곁 · 몸까지 거리를 이만큼 넓혀 고치고, 몸 곁(`reach`)의 옅은 순 마젠타 안개는 지운다
# 여상(2026-11-20) · 왕보~왕충(11-21, 기획자): 어두운 윤곽 밖에 마젠타 줄이 4~6px 두께로 남아 몸 둘레가 분홍으로 떴다.
# 왕평 · 요화 · 우금~유현은 받기 전에 훑어 넣었다 — 참고 그림 몸 가장자리의 마젠타 비율이 2% 넘는 24명(나머지는 1% 아래)
FRINGE_WIDE = {n: 7 for n in (
    "여상", "왕보", "왕위", "왕찬", "왕철", "왕충", "왕평", "우금", "우번", "우칙", "원소", "원술", "원윤", "위속", "위연",
    "유괴", "유기", "유대", "유도", "유벽", "유봉", "유비", "유선", "유순", "유엽", "유장", "유종", "유표", "유현", "요화",
)}
FRINGE_HAZE_A = 110   # 〃 이보다 옅은 순 마젠타(`FRINGE_PURE`)는 바탕이 번진 안개다
FRINGE_FEET = 0.85    # 〃 그림 세로의 이 아래(발치)에서는 투명 곁이 아니어도 고친다 —
FRINGE_FEET_TINT = 100  #   마젠타 기운(min(R, B) − G)이 이만큼 짙은 것만(어두운 보라 그늘은 남긴다)
FRINGE_POCKET_TINT = 130  # 〃 어디서든 이만큼 짙은 마젠타는 투명 곁이 아니어도 고친다(몸 안에 갇힌 바탕)


def defringe_wide(rgb: np.ndarray, alpha: np.ndarray, reach: int) -> tuple[np.ndarray, np.ndarray]:
    """`FRINGE_WIDE`의 장수 — 넓게 고치고 안개를 지운다. 고친 색과 알파를 돌려준다."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    visible = alpha > 8
    tint = np.minimum(r, b) - g
    mag = visible & (tint >= FRINGE_MAG)
    body = visible & ~mag & (alpha > 128)
    if not mag.any() or not body.any():
        return rgb, alpha
    d, (iy, ix) = ndimage.distance_transform_edt(~body, return_indices=True)
    near_clear = ndimage.binary_dilation(~visible, iterations=reach)
    haze = mag & (tint >= FRINGE_PURE) & (alpha < FRINGE_HAZE_A) & (d <= reach * 4)
    # 발치의 신발 사이 — 바탕이 불투명하게 갇혀 투명 곁이 아니다(왕위). 책략 칸의 분홍 글자가 내려오지 않는 맨 아래 띠에서만
    feet = np.zeros_like(mag)
    feet[int(alpha.shape[0] * FRINGE_FEET):] = True
    # 몸 안에 갇힌 바탕 주머니(왕찬 — 손과 죽간 사이) — 순 마젠타에 가까울 만큼 짙은 것만. 꽃잎 · 글자 효과는 이보다 옅은 분홍이다
    fix = mag & (d <= reach) & ~haze & (near_clear | (feet & (tint >= FRINGE_FEET_TINT)) | (tint >= FRINGE_POCKET_TINT))
    out = rgb.copy()
    out[fix] = rgb[iy[fix], ix[fix]]
    return out, np.where(haze, 0.0, alpha)


# 바닥 안개 — 몸에서 떨어진 작고 옅은 섬(넓이 < `HAZE_MAX` · 평균 알파 < `HAZE_A`)을 지운다. 잔디 지우기가 대신 걷던 것을
# `GRASS_FREE`로 빼면 그대로 남는 장수만 — 오란(2026-11-20, 기획자): 초록 갑옷 하체를 잔디로 깎아 빼자 피격 칸 발치에 회색 얼룩이 남았다
HAZE_DROP = {"오란"}
HAZE_MAX = 500
HAZE_A = 60


def drop_haze(alpha: np.ndarray) -> np.ndarray:
    lab, n = ndimage.label(alpha > 8, EIGHT)
    if n == 0:
        return alpha
    idx = np.arange(1, n + 1)
    size = ndimage.sum(np.ones_like(alpha), lab, idx)
    mean_a = ndimage.mean(alpha, lab, idx)
    drop = idx[(size < HAZE_MAX) & (mean_a < HAZE_A)]
    return np.where(np.isin(lab, drop), 0.0, alpha)


def defringe(rgb: np.ndarray, alpha: np.ndarray) -> tuple[np.ndarray, int]:
    """마젠타 바탕을 손으로 지운 PNG에 남은 **분홍 테두리**를 몸의 색으로 칠한다 (2026-11-13).

    PNG와 JPG 원본이 둘 다 있는 30명(우금 · 유비 · 위연 …)은 PNG를 쓰는데, 그 PNG의 바깥 1~3px에 마젠타가 섞여 남아 있었다
    (화면에서 몸 둘레가 분홍으로 번졌다 — 기획자가 우금에서 찾았다). JPG로 바꾸면 깨끗하지만 그림이 조금 달라(책략 칸 이펙트 등)
    고른 그림을 지키고 테두리만 고친다. 고치는 것은 **마젠타 기운 · 투명 곁(`FRINGE_EDGE`) · 마젠타 아닌 몸 픽셀이
    `FRINGE_REACH` 안**인 픽셀뿐이고, 색은 그 가장 가까운 몸 픽셀의 것이다(대개 검은 윤곽선). 분홍 칼 궤적 · 소용돌이처럼
    넓은 분홍은 곁에 몸이 없어 그대로 남는다. 고친 픽셀 수를 함께 돌려준다."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    visible = alpha > 8
    mag = visible & (np.minimum(r, b) - g >= FRINGE_MAG)
    if not mag.any():
        return rgb, 0
    near_clear = ndimage.binary_dilation(~visible, iterations=FRINGE_EDGE)
    body = visible & ~mag & (alpha > 128)
    if not body.any():
        return rgb, 0
    d, (iy, ix) = ndimage.distance_transform_edt(~body, return_indices=True)
    pure = mag & (np.minimum(r, b) - g >= FRINGE_PURE) & (alpha < FRINGE_PURE_A)
    fix = mag & near_clear & ((d <= FRINGE_REACH) | (pure & (d <= FRINGE_PURE_REACH)))
    if not fix.any():
        return rgb, 0
    out = rgb.copy()
    out[fix] = rgb[iy[fix], ix[fix]]
    return out, int(fix.sum())


DIVIDER_MAX_W = 4     # 칸 나눔 세로줄 — 이보다 가늘고
DIVIDER_MIN_H = 0.30   # 그림 높이의 이만큼보다 긴 조각은 줄이다(장수 그림에 이런 꼴은 없다)
DIVIDER_NEAR = 20      # 붙어 있는 줄은 칸 경계에서 이만큼 안쪽에서만 찾는다(원본 px)
DIVIDER_RUN = 6        # 〃 가로로 이보다 가는 줄기
DIVIDER_SEG = 0.15     # 〃 세로로 그림 높이의 이만큼보다 긴 것
DIVIDER_DARK = 110     # 줄은 어둡다 — 평균 밝기(채널 최댓값)가 이 아래인 것만


def strip_dividers(alpha: np.ndarray, rgb: np.ndarray) -> tuple[np.ndarray, int]:
    """원본에 그어진 **칸 나눔 세로줄**을 지운다 (2026-11-13). 몇몇 원본(정덕 등)은 다섯 칸 사이에 가는 검은 세로줄이 있어
    배경 제거를 지나도 남고, 구운 칸 가장자리에 「다른 그림의 꼬다리」처럼 선다. 가늘고(≤ `DIVIDER_MAX_W`px) 긴(≥ 그림 높이의
    `DIVIDER_MIN_H`) 덩어리만 — 창 · 깃대는 몸통에 붙어 있거나 이렇게 길고 곧게 홀로 서지 않는다. 지운 줄 수를 함께 돌려준다.
    **줄은 어둡다**(밝기 ≤ `DIVIDER_DARK`) — 책략 칸의 밝은 마법진이 경계 곁에서 곧게 서면 줄로 잘못 잡혔다(진장)."""
    lab, n = ndimage.label(alpha > 8, structure=EIGHT)
    h = alpha.shape[0]
    bright = rgb.max(axis=2)
    out = alpha
    cut = 0
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None:
            continue
        sy, sx = sl
        if (sx.stop - sx.start <= DIVIDER_MAX_W and sy.stop - sy.start >= h * DIVIDER_MIN_H
                and bright[lab == i].mean() <= DIVIDER_DARK):
            if cut == 0:
                out = alpha.copy()
            out[lab == i] = 0
            cut += 1
    # 붙어 있는 줄 — 줄 몇 가닥이 나란히 서서 한 덩어리가 되거나(폭이 `DIVIDER_MAX_W`를 넘는다) 발치 · 몸에 닿아 있으면 위 규칙이
    # 못 잡는다(정덕의 셋째 · 넷째 경계). **칸 경계 둘레(±`DIVIDER_NEAR`)에서만** 가로로 가늘고(≤ `DIVIDER_RUN`px) 세로로 긴
    # (≥ 그림 높이의 `DIVIDER_SEG`) 줄기를 지운다 — 몸통 · 세운 창은 칸 가운데에 서고, 경계를 넘는 창은 가로로 넓다
    w = alpha.shape[1]
    m = out > 8
    horiz = np.zeros((3, 3), bool)
    horiz[1] = True
    hl, hn = ndimage.label(m, structure=horiz)
    if hn:
        width = ndimage.sum_labels(np.ones_like(hl), hl, range(1, hn + 1))
        thin = m & (np.concatenate([[0], width])[hl] <= DIVIDER_RUN)
        near = np.zeros(w, bool)
        for k in range(1, FRAMES):
            c = round(w * k / FRAMES)
            near[max(0, c - DIVIDER_NEAR):c + DIVIDER_NEAR + 1] = True
        thin &= near[None, :]
        vert = np.zeros((3, 3), bool)
        vert[:, 1] = True
        # 줄이 군데군데 끊겨 있다(JPG 배경을 걷으며 몇 px씩 빈다) — 세로로 이어 붙인 뒤 길이를 잰다
        joined = ndimage.binary_closing(thin, structure=vert, iterations=4) | thin
        vl, vn = ndimage.label(joined, structure=vert)
        if vn:
            heights = [sl[0].stop - sl[0].start for sl in ndimage.find_objects(vl)]
            tall = [i + 1 for i, hh in enumerate(heights)
                    if hh >= h * DIVIDER_SEG and bright[(vl == i + 1) & thin].mean() <= DIVIDER_DARK]
            if tall:
                kill = np.isin(vl, tall) & thin
                kill = ndimage.binary_dilation(kill, structure=horiz) & m & near[None, :]   # 곁의 옅은 테두리까지
                if cut == 0:
                    out = alpha.copy()
                out[kill] = 0
                cut += len(tall)
    return out, cut


def find_bodies(alpha: np.ndarray) -> list[dict] | None:
    """큰 덩어리 5개를 각 칸의 몸통으로 잡는다. 칸마다 하나씩이 아니면 None."""
    lab, n = ndimage.label(alpha > BODY_ALPHA * 255, structure=EIGHT)
    if n < FRAMES:
        return None
    sizes = ndimage.sum_labels(np.ones_like(lab), lab, range(1, n + 1))
    objs = ndimage.find_objects(lab)
    w = alpha.shape[1]

    picked = []
    for i in np.argsort(-sizes)[:FRAMES] + 1:
        sy, sx = objs[i - 1]
        picked.append(dict(cx=(sx.start + sx.stop) / 2, foot=sy.stop,
                           top=sy.start, height=sy.stop - sy.start, label=int(i)))
    picked.sort(key=lambda b: b["cx"])
    if sorted({min(FRAMES - 1, int(b["cx"] // (w / FRAMES))) for b in picked}) == list(range(FRAMES)):
        return picked

    # 큰 덩어리 5개가 칸마다 하나씩이 아니다 — 무언가가 칸을 가로질러 붙어 있다.
    # 균등분할로 물러난다. 칸을 넘는 무기는 잘리지만 그림이 통째로 사라지는 것보다 낫다.
    fallback = []
    for k in range(FRAMES):
        lo, hi = round(w * k / FRAMES), round(w * (k + 1) / FRAMES)
        sub, m = ndimage.label(alpha[:, lo:hi] > BODY_ALPHA * 255, structure=EIGHT)
        if m == 0:
            return None
        sz = ndimage.sum_labels(np.ones_like(sub), sub, range(1, m + 1))
        sy, sx = ndimage.find_objects(sub)[int(np.argmax(sz))]
        fallback.append(dict(cx=lo + (sx.start + sx.stop) / 2, foot=sy.stop,
                             top=sy.start, height=sy.stop - sy.start, label=-1))
    return fallback


def assign(alpha: np.ndarray, bodies: list[dict]) -> np.ndarray:
    """열마다 가장 가까운 몸통 가운데의 칸 — **덩어리로 못 가를 때만 쓰는 물러섬**(`assign_pixels`)."""
    xs = np.arange(alpha.shape[1], dtype=np.float32)
    centers = np.array([b["cx"] for b in bodies], np.float32)
    return np.abs(xs[:, None] - centers[None, :]).argmin(1)      # 열마다 소속 칸


def assign_pixels(alpha: np.ndarray, bodies: list[dict]) -> np.ndarray:
    """픽셀마다 소속 칸(0~4) — **진한 조각은 덩어리로, 옅은 것은 예전처럼 열로** 가른다 (2026-11-13).

    예전엔 열마다 가장 가까운 몸통 가운데에 붙였다(`assign`). 그러면 옆 칸 장수의 창끝 · 이펙트가 두 몸통 사이 한가운데를
    넘어오는 순간 **이쪽 칸에 붙어** 칸 가장자리에 「다른 동작에서 잘려 나온 꼬다리」로 남았다(조홍 — 공격 칸의 창끝이 책략 칸
    왼쪽 끝에, 기획자가 화면에서 찾았다). 그래서:
      · 진한 덩어리(알파 > `BODY_ALPHA`) — 몸통 덩어리는 그 칸, 몸통이 아닌 떠 있는 조각(떨어져 그려진 창끝 · 번쩍임)은
        **몸통까지의 거리**가 가장 가까운 칸,
      · 옅은 픽셀 — 진한 조각 바로 곁(3px 안)이면 그 조각을 따라가고(안티앨리어싱 테두리), 아니면 예전처럼 열로.
    옅은 것까지 덩어리로 묶으면 안 된다 — 발치의 옅은 안개 · 띠가 몸통 하나에 이어져 **통째로 한 칸에 붙어** 칸 아래에
    어두운 네모로 떴다(첫 시도, 양수 · 감택 · 오의). 몸통을 못 찾아 균등분할로 물러난 경우는 전부 열로.
    """
    h, w = alpha.shape
    by_column = np.broadcast_to(assign(alpha, bodies)[None, :], (h, w)).copy()
    if any(b["label"] < 0 for b in bodies):
        return by_column

    solid = alpha > BODY_ALPHA * 255
    strong, n = ndimage.label(solid, structure=EIGHT)
    comp_owner = np.full(n + 1, -1, np.int64)
    for k, b in enumerate(bodies):
        comp_owner[b["label"]] = k
    rest = np.array([i for i in range(1, n + 1) if comp_owner[i] < 0], np.int64)
    if rest.size:
        dists = [np.asarray(ndimage.minimum(ndimage.distance_transform_edt(strong != b["label"]), strong, rest))
                 for b in bodies]
        comp_owner[rest] = np.argmin(np.stack(dists), axis=0)

    owner = by_column
    owner[solid] = comp_owner[strong[solid]]
    # 옅은 테두리 — 가장 가까운 진한 픽셀이 3px 안이면 그 조각을 따라간다
    faint = (alpha > 8) & ~solid
    if faint.any() and solid.any():
        d, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
        near = faint & (d <= 3)
        owner[near] = comp_owner[strong[iy[near], ix[near]]]
    return owner


# ────────────────────────────────────────────────────────────────
# 5. 잔디 · 자갈 · 그림자
# ────────────────────────────────────────────────────────────────

def strip_ground(rgb: np.ndarray, fg: np.ndarray, foot: float, top: int | None = None, gr: int | None = None,
                 gb: int | None = None) -> np.ndarray:
    """발밑 잔디와 자갈을 전경에서 뺀다. `top`이 있으면 발에서 그만큼(px) 위보다 높은 곳은 잔디로 안 본다(`GRASS_TOP`).
    `gr` · `gb`가 있으면 G − R · G − B 문턱을 그 값으로 올린다(`GRASS_GR_FOR` · `GRASS_GB_FOR`)."""
    h = rgb.shape[0]
    a = rgb.astype(int)
    zone = np.zeros(fg.shape, bool)
    zone[max(int(h * GRASS_ZONE), int(foot) - top if top else 0):] = True

    grass = ((a[..., 1] - a[..., 2] >= max(GRASS_GB, gb or 0)) & (a[..., 1] - a[..., 0] >= (gr or GRASS_GR))
             & (a[..., 1] >= GRASS_MIN_V) & zone & fg)
    core = grass.copy()
    loose = (a[..., 1] - a[..., 0] >= max(GROUND_GREEN_R, gr or 0)) & (a[..., 1] - a[..., 2] >= max(GROUND_GREEN, gb or 0)) & zone & fg
    if grass.any():
        # 그늘진 풀 — 문턱(`GRASS_GB`)에 못 미치는 칙칙한 초록이 잔디판 아래쪽에 띠로 남았다(2026-11-13, 왕충). 잡힌 잔디에서
        # **이어진** 초록 기운만 따라 넓힌다 — 잔디에 닿지 않은 초록 옷(관우 · 장비)은 그대로다
        grass = ndimage.binary_propagation(grass, mask=grass | loose, structure=EIGHT)
        grass = ndimage.binary_dilation(grass, EIGHT) & zone & fg
    out = fg & ~grass

    # 잔디판의 테두리 — 초록을 걷어도 판을 두른 가는 윤곽선(어두운 줄 · 분홍)이 발에 붙어 남아 「발밑 얼룩」이 됐다
    # (2026-11-13, 우금 · 왕충 · 왕보 — 기획자). 잔디를 판 모양으로 메운 바깥 고리(`GROUND_RIM`)에서 **가는 것만** 걷는다 —
    # 발 · 신 · 몸은 두꺼워 열기(opening)를 지나 남는다. 고리 안에 갇혀 있던 자갈은 아래 부스러기 걸러 내기가 치운다
    if grass.any():
        patch = ndimage.binary_fill_holes(ndimage.binary_closing(grass, EIGHT, iterations=3))
        ring = ndimage.binary_dilation(patch, EIGHT, iterations=GROUND_RIM) & zone
        thick = ndimage.binary_opening(out, EIGHT, iterations=GROUND_THIN)
        out &= ~(ring & ~thick)
        out |= keep_clothes(a, fg, out, core, loose, zone)

    lab, n = ndimage.label(out, structure=EIGHT)
    if n > 1:
        sizes = ndimage.sum_labels(np.ones_like(lab), lab, range(1, n + 1))
        main = int(np.argmax(sizes)) + 1
        for i in np.where(sizes <= DEBRIS_MAX)[0] + 1:
            if i != main and zone[lab == i].mean() > 0.6:
                out &= lab != i
    return out


def keep_clothes(a: np.ndarray, fg: np.ndarray, out: np.ndarray, core: np.ndarray,
                 loose: np.ndarray, zone: np.ndarray) -> np.ndarray:
    """잔디로 잘못 지운 **초록 옷**을 되돌릴 픽셀(2026-11-15, 간옹 — 기획자).

    잔디에 맞닿은 초록 · 연두 옷자락이 「잔디에 이어진 초록」으로 따라 지워져 하반신이 갉아먹혔다(초록 옷 장수 다수).
    색 문턱만으로는 옷과 잔디를 못 가른다(관우 앞자락 ≈ 잔디 초록) — 대신 **그 그림의 잔디판 색**과 비교한다.
    되돌리는 것은 셋을 다 만족하는 것뿐이다:
      ① 지워진 초록 기운(`loose`) — 자갈 · 판 테두리의 어두운 줄은 초록이 아니라 안 돌아온다
      ② 판의 색(큰 잔디 덩어리의 중앙값)과 RGB 거리 `GRASS_MATCH` 넘게 떨어진 것 — 다리 사이로 보이는 잔디(기령)는 판과 같은 색이다
      ③ 판의 윗선보다 위 — 판 아래쪽의 그늘진 풀(왕충)은 판 안이라 안 돌아온다
    그리고 남은 몸에 이어진 것만 — 판 끝의 따로 떨어진 풀은 안 붙는다.
    """
    h = a.shape[0]
    removed = fg & ~out & loose
    if not removed.any():
        return np.zeros_like(fg)
    lab, n = ndimage.label(core, structure=EIGHT)
    sizes = ndimage.sum_labels(np.ones_like(lab), lab, range(1, n + 1))
    big = np.isin(lab, np.where(sizes >= max(GRASS_CORE_MIN, sizes.max() * GRASS_CORE_FRAC))[0] + 1)
    if big.sum() < GRASS_CORE_MIN:
        return np.zeros_like(fg)
    ref = np.median(a[big], axis=0)
    far = np.sqrt(((a - ref) ** 2).sum(-1)) > GRASS_MATCH

    # 판의 윗선 — 열마다 잔디가 세로로 `GRASS_RUN`칸 연달아 차는 첫 자리(옷의 흩어진 연두 점은 안 걸린다), 그리고 판이 넓게
    # 펼쳐지는 줄에서 `GRASS_BAND_SLACK` 위보다 높지 않게(옷단 일부가 꽉 찬 연두라도 윗선이 옷 안으로 못 올라간다)
    rows = np.arange(h)[:, None]
    solid = ndimage.binary_erosion(big, np.ones((GRASS_RUN, 1), bool), border_value=0)
    top = np.where(solid.any(0), np.argmax(solid, 0) - GRASS_RUN // 2, np.where(big.any(0), np.argmax(big, 0), h))
    width = big.sum(1)
    band = int(np.where(width >= width.max() * GRASS_WIDE_FRAC)[0].min())
    line = np.maximum(top, band - GRASS_BAND_SLACK) - GRASS_TOP_MARGIN
    up = rows < line[None, :]

    back = removed & far & up
    lab2, n2 = ndimage.label(out, structure=EIGHT)
    if not n2:
        return np.zeros_like(fg)
    main = lab2 == (int(np.argmax(ndimage.sum_labels(np.ones_like(lab2), lab2, range(1, n2 + 1)))) + 1)
    got = ndimage.binary_propagation(main, mask=main | back, structure=EIGHT) & back
    # 옷단의 일부는 판과 색이 가까워 ②에 못 걸려 점점이 구멍으로 남는다 — 되돌린 옷과 몸 사이의 작은 틈(판 윗선 위)만 메운다
    body = main | got
    filled = ndimage.binary_fill_holes(ndimage.binary_closing(body, EIGHT, iterations=CLOTH_CLOSE))
    return got | (filled & fg & ~out & up)


def shadow_layer(shape: tuple[int, int], cx: float, foot: float, body_w: float) -> np.ndarray:
    """발밑 타원. 원본에 잔디가 있었든 없었든 같은 것이 그려진다."""
    h, w = shape
    rx = max(6.0, body_w * SHADOW_RX)
    ry = max(2.0, body_w * SHADOW_RY)
    cy = foot - h * SHADOW_LIFT
    yy, xx = np.mgrid[0:h, 0:w]
    r2 = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    return (SHADOW_A * np.clip(1.0 - r2, 0.0, 1.0) ** 1.2).astype(np.float32)


# ────────────────────────────────────────────────────────────────
# 6. 정렬 · 출력
# ────────────────────────────────────────────────────────────────

def render_frame(rgb: np.ndarray, alpha: np.ndarray, body: dict, size: int) -> Image.Image:
    """몸통 높이와 발 위치를 맞춰 size² 칸 하나를 만든다."""
    scale = (size * TARGET_BODY) / max(body["height"], 1)
    half = (size / 2) / scale
    up = (size * FOOT_LINE) / scale
    down = (size * (1 - FOOT_LINE)) / scale

    # 창이 원본 밖으로 나갈 수 있다 — 몸통이 왼쪽 끝에 있거나 발끝이 아래 끝에 닿는 경우.
    # 투명 여백을 두르고 그만큼 좌표를 민다. Pillow 의 crop-box 는 음수를 못 받는다.
    pad = int(max(half, up, down)) + 8
    buf = np.dstack([np.clip(rgb, 0, 255), np.clip(alpha, 0, 255)]).astype(np.uint8)
    buf = np.pad(buf, ((pad, pad), (pad, pad), (0, 0)))
    box = (body["cx"] - half + pad, body["foot"] - up + pad,
           body["cx"] + half + pad, body["foot"] + down + pad)
    im = Image.fromarray(buf, "RGBA")
    # RGBa(알파를 곱해 둔 형식)를 거친다 — 투명 픽셀의 색이 가장자리에 번지지 않게
    return im.convert("RGBa").resize((size, size), Image.LANCZOS, box=box).convert("RGBA")


# 기획자가 원본에서 잔디판을 손으로 지운 장수(2026-11-15) — 옷단이 잔디와 색 · 높이가 같아
# 잔디 지우기가 옷단을 깎았다. 원본이 이미 깨끗하므로 잔디 지우기를 건너뛴다.
GRASS_FREE = {"간옹", "노숙", "민순", "뇌동", "순상", "오란", "조잠", "주령", "진응", "진장", "채모", "하후덕"}  # 순상 · 오란 · 조잠 · 주령 · 진응 · 진장 · 채모: 원본에 잔디판이 없고 연녹색 바지 · 초록 갑옷 · 초록 바지 · 연두 갑옷 · 옅은 쑥색 갑옷 · 초록 옷자락 · 청록 갑옷 하체 · 청록 옷자락(하후덕 마법)을 잔디로 깎았다(2026-11-19 · 20 · 25 · 26 · 27)

# 초록 옷단이 잔디판 바로 위까지 내려와 잔디로 함께 지워지는 장수(2026-11-16, 관우 책략 칸의 앞자락 — 기획자) — 발에서
# 이만큼(원본 px) 위까지만 잔디를 찾는다. 관우: 잔디판 윗선은 발 위 18~27px, 앞자락 아래끝은 발 위 40px
GRASS_TOP = {"관우": 32, "동량": 36}  # 동량: 걸음 칸 앞다리 · 평상 · 공격 칸 옷단(2026-11-17)

# 연두(노란 초록) 도포가 잔디판까지 내려오는 장수(2026-11-22, 유도 — 기획자): 도포의 그늘이 G − R 문턱(`GRASS_GR`)을 넘어 잔디로 잡히고
# 도포 아랫단이 통째로 따라 지워졌다. 도포는 R ≈ G, 잔디판은 G − R ≈ 20이라 이 장수만 문턱을 올린다
GRASS_GR_FOR = {"유도": 12, "유봉": 20, "육손": 18}
# 〃 G − R로는 못 가르는 초록 갑옷(2026-11-23, 장막 — 갑옷 G − R 15~24 · 잔디판 27~31로 겹친다): 갑옷은 G − B ≈ 40, 잔디판은 ≈ 73이라 G − B 문턱을 올린다
GRASS_GB_FOR = {"장막": 60, "장비": 50, "장료": 50, "장임": 40}
# (장임 40 — 청록 바지 G−B ≤ 22가 잔디 G−B 59~80 옆에서 번져 지워졌다, 11-24)
# 〃 다리 사이로 비치는 모래 언덕(베이지 삼각형) — 이 줄(원본 px)부터 아래의 모래 색만 뺀다(장막 — 두건 띠의 같은 색은 위에 있다)
SAND_DROP = {"장막": 260}
# 잔디판이 일부 칸에만 있는 장수(2026-11-24, 장료 — 평상 칸에만 판이 있고, 다른 칸의 금빛 · 올리브 갑옷이 잔디와 색이 겹쳐
# 문턱을 올려도 점점이 지워졌다) — 잔디 지우기를 이 칸들에만 건다
GRASS_CELLS = {"장료": {0}}


def drop_sand(rgb: np.ndarray, fg: np.ndarray, row: int) -> np.ndarray:
    a = rgb.astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    sand = (r > 190) & (g > 165) & (b > 100) & (b < 205) & (r - b > 35)
    sand[:row] = False
    # JPG 가장자리의 덜 밝은 테두리까지 — 모래에 닿은 밝은 픽셀만 한 겹 넓힌다
    sand |= ndimage.binary_dilation(sand, EIGHT) & (a.mean(-1) > 150) & (r - b > 25)
    return fg & ~sand

# 원본에 **처음부터 구멍이 난** 칸(2026-11-17, 뇌동 공격 칸의 왼쪽 허벅지 갑옷판 — 기획자): 생성 때 흰 바탕으로 잘려 투명이다.
# 원본은 두고, 그 칸에서 몸에 갇힌 구멍 가운데 이 넓이(원본 px) 이하만 바로 아래 몸을 끌어올려 메운다 —
# 창 궤적과 몸 사이처럼 원래 비어 있는 넓은 자리(뇌동 2,051px)는 안 메운다. {이름: {칸: 넓이 상한}}
HOLE_FILL = {"뇌동": {2: 600}}
# 〃 투구처럼 매끈한 면에 난 구멍(2026-11-18, 비관 — 흰 반사광이 바탕으로 빠졌다): 아래를 끌어올리면 얼굴이 올라오므로
# 가장 가까운 둘레 색으로 메운다. 그림 위쪽 절반의 구멍만 — 다리 사이 같은 아래쪽 틈은 안 건드린다
HOLE_FILL_NEAR = {"비관": {0: 900, 2: 900, 3: 900, 4: 900}}
# 〃 그림 아래쪽 절반에서(2026-11-20, 양회 — 회색 바지의 밝은 자리가 바탕으로 빠졌다. 공격 칸 두 다리 · 책략 칸 왼다리 — 기획자)
HOLE_FILL_LOW = {"양회": {2: 900}}
# 〃 바깥으로 트여 있어 「갇힌 구멍」으로 안 잡히는 자리(양회 책략 칸 왼다리 — 바짓가랑이 바깥 윤곽까지 빠졌다): 이 네모(원본 px,
# x0 · y0 · x1 · y1 — 끝 포함) 안의 빈 픽셀을 둘레 색으로 메우고, 바깥 투명에 닿는 가장자리는 윤곽선 색으로 다시 긋는다
HOLE_BOX = {"양회": {3: [(1066, 255, 1098, 275)]},
            "여몽": {1: [(478, 226, 494, 241)], 2: [(735, 229, 752, 259)],
                     3: [(1031, 153, 1057, 170), (1126, 157, 1140, 166)], 4: [(1352, 212, 1398, 248)]}}
# 여몽(2026-11-20, 기획자): 이동 · 공격 · 피격 칸 아랫자락, 책략 칸 두 어깨판
HOLE_OUTLINE = (38, 30, 36)   # 〃 다시 긋는 윤곽선 색(이 그림체의 검은 테)
HOLE_RIM = 2   # 〃 구멍 둘레의 번진 테두리(px)
HOLE_PINK = 20       # 〃 둘레 색으로 메울 때(`HOLE_FILL_NEAR`) min(R, B) − G 가 이만큼 넘는 분홍 기운도 메운다
HOLE_SMOOTH = 40     # 〃 메운 자리를 고르게 펴는 횟수
HOLE_PINK_REACH = 4  # 〃 구멍에서 이만큼(px) 안쪽만

# 발 곁에 돌맹이 · 연황색 덩이가 몸에 붙어 그려진 원본(2026-11-17, 마량 — 기획자): 잔디를 걷어도 발에 이어져 남고,
# Gemini가 그것을 두루마리로 읽어 사이 칸에 들고 나왔다. 원본은 두고 그 칸의 이 네모(원본 px, x0 · y0 · x1 · y1 — 끝 포함)를
# 전경에서 뺀다. 남은 부스러기는 뒤의 잔디 지우기가 섬으로 치운다. {이름: {칸: [네모, …]}}
GROUND_CUT = {"마량": {0: [(20, 262, 72, 300)], 1: [(335, 258, 384, 300)], 2: [(630, 258, 677, 300)],
                       4: [(1285, 258, 1346, 300)]},
              "유도": {0: [(195, 280, 232, 296)]}, "유봉": {2: [(772, 283, 790, 300)]},
              "육손": {0: [(41, 268, 78, 298)], 1: [(344, 267, 378, 294)], 3: [(968, 266, 1000, 295), (1139, 282, 1166, 302)]},
              "장막": {1: [(528, 272, 572, 302)]}, "장비": {0: [(60, 262, 80, 292)]},
              "장료": {0: [(42, 264, 61, 290), (188, 284, 200, 294)]},
              "장임": {0: [(44, 264, 72, 290)], 3: [(966, 264, 995, 290)]},
              "조루": {1: [(340, 258, 382, 300), (380, 282, 560, 305), (432, 274, 454, 282)]}}  # 유도 · 유봉(2026-11-22) · 육손 · 장막 · 장비(11-23) · 장료 · 장임 · 조루(11-24): 발 옆 자갈 · 발밑 돌판
# 〃 바닥 연출(책략 칸의 물웅덩이) 위에 앉은 것은 빼면 구멍이 난다 — 그 네모는 웅덩이로 다시 칠한다(`patch_boxes`)
GROUND_PATCH = {"마량": {3: [(970, 260, 1016, 294)]}}
PATCH_TEAL = 28   # 〃 바닥 색 = G − R 이 이만큼 넘는 것(물웅덩이는 청록, 돌은 푸른 회색이라 G − R이 작다)
PATCH_REACH = 60  # 〃 바닥 껍질을 잴 이웃 — 네모 둘레 이만큼(px)의 바닥만
PATCH_R_MAX = 130 # 〃 그리고 R이 이만큼 아래 — 돌의 밝은 청록 반사(191, 255, 255)는 웅덩이보다 훨씬 밝다


def cut_boxes(fg: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> np.ndarray:
    out = fg.copy()
    for x0, y0, x1, y1 in boxes:
        out[y0:y1 + 1, x0:x1 + 1] = False
    return out


def patch_boxes(rgb: np.ndarray, fg: np.ndarray, boxes: list[tuple[int, int, int, int]]
                ) -> tuple[np.ndarray, np.ndarray]:
    """네모 안을 바닥으로 다시 칠한다 — 웅덩이의 볼록 껍질 안은 가장 가까운 바닥 색, 그 밖(돌이 웅덩이 위로 솟은 자리)은 뺀다.
    돌의 푸른 윤곽은 바닥 색과 겹쳐 색으로는 못 가른다(마량) — 그래서 네모 안은 색을 안 보고 통째로 다시 칠한다."""
    from scipy.spatial import ConvexHull
    a = rgb.astype(int)
    h, w = fg.shape
    floor = fg & (a[..., 1] - a[..., 0] >= PATCH_TEAL) & (a[..., 0] <= PATCH_R_MAX)
    rgb, fg = rgb.copy(), fg.copy()
    for x0, y0, x1, y1 in boxes:
        box = np.zeros(fg.shape, bool)
        box[y0:y1 + 1, x0:x1 + 1] = True
        near = np.zeros(fg.shape, bool)
        near[y0:min(h, y1 + PATCH_REACH), max(0, x0 - PATCH_REACH):x1 + PATCH_REACH] = True
        src = floor & near & ~box
        ys, xs = np.nonzero(src)
        if len(ys) < 3:
            continue
        hull = ConvexHull(np.c_[xs, ys])
        poly = Image.new("L", (w, h))
        ImageDraw.Draw(poly).polygon([(float(xs[v]), float(ys[v])) for v in hull.vertices], fill=1)
        inside = np.asarray(poly).astype(bool)
        _, (iy, ix) = ndimage.distance_transform_edt(~src, return_indices=True)
        paint = box & inside
        rgb[paint] = rgb[iy[paint], ix[paint]]
        fg = (fg & ~box) | paint
    return rgb, fg


def fill_holes(rgb: np.ndarray, fg: np.ndarray, alpha: np.ndarray, max_area: int, near: bool = False,
               low: bool = False) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    holes = ndimage.binary_fill_holes(fg) & ~fg
    if near:
        # 반쯤 빠진 픽셀(반투명)도 구멍이다 — 짙은 판 위에서 투구에 회색 얼룩, 밝은 판 위에서 분홍 줄로 비친다
        solid_fg = fg & (alpha > 200)
        holes |= ndimage.binary_fill_holes(solid_fg) & ~solid_fg
        if low:
            holes[:holes.shape[0] // 2] = False   # 다리 구멍(`HOLE_FILL_LOW`) — 아래쪽 절반만
        else:
            holes[holes.shape[0] // 2:] = False
    lab, n = ndimage.label(holes)
    if not n:
        return rgb, fg, alpha
    sizes = ndimage.sum_labels(np.ones_like(lab), lab, range(1, n + 1))
    fill = np.isin(lab, np.nonzero(sizes <= max_area)[0] + 1)
    # 구멍 둘레에는 흰 바탕이 번진 회색 테두리가 남아 있다 — 그것까지 메울 자리로 넣고, 색은 그 바깥의 몸에서 가져온다
    fill = ndimage.binary_dilation(fill, EIGHT, iterations=HOLE_RIM) & (fill | fg)
    if near:
        # 투구 구멍 둘레에는 바탕(마젠타)이 번진 분홍 줄이 더 넓게 남아 있다 — 구멍 곁의 분홍 기운도 메울 자리로
        c = rgb.astype(int)
        pink = np.minimum(c[..., 0], c[..., 2]) - c[..., 1] >= HOLE_PINK
        fill |= ndimage.binary_dilation(fill, EIGHT, iterations=HOLE_PINK_REACH) & pink & fg
    solid = fg & (alpha > 200) & ~fill
    # 가장 가까운 색으로 메우면 둘레의 회색 사슬갑옷이 방사 줄무늬로 번진다 — 대신 구멍 **바로 아래** 갑옷판을
    # 구멍 높이만큼 끌어올린다(갑옷판은 가로 줄무늬라 그대로 이어진다). 아래가 몸이 아닌 자리만 가장 가까운 색
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    rgb = rgb.copy()
    parts, m = ndimage.label(fill, EIGHT)
    for i in range(1, m + 1):                    # 구멍마다 제 높이로
        ys, xs = np.nonzero(parts == i)
        src_y = np.minimum(ys + int(ys.max() - ys.min() + 1), fill.shape[0] - 1)
        ok = solid[src_y, xs] & (not near)
        rgb[ys, xs] = np.where(ok[:, None], rgb[src_y, xs], rgb[iy[ys, xs], ix[ys, xs]])
    if near:
        # 가장 가까운 색만 쓰면 둘레에서 방사 줄무늬가 진다 — 메운 자리 안을 둘레에서 번져 들어오게 고르게 편다(확산)
        for _ in range(HOLE_SMOOTH):
            blur = ndimage.uniform_filter(rgb.astype(np.float32), size=(3, 3, 1))
            rgb[fill] = blur[fill]
    return rgb, fg | fill, np.where(fill, 255.0, alpha)


def fill_box_holes(rgb: np.ndarray, fg: np.ndarray, alpha: np.ndarray, boxes
                   ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """`HOLE_BOX` — 네모 안의 빈(반쯤 빈) 픽셀을 메운다. 색은 가장 가까운 불투명 몸 색에서 번져 들어오게 펴고,
    네모 밖 투명에 닿는 가장자리는 윤곽선을 다시 긋는다(바짓가랑이 바깥 테까지 빠진 자리라서)."""
    fill = np.zeros_like(fg)
    for x0, y0, x1, y1 in boxes:
        fill[y0:y1 + 1, x0:x1 + 1] = True
    fill &= ~(fg & (alpha > 200))
    if not fill.any():
        return rgb, fg, alpha
    solid = fg & (alpha > 200) & ~fill
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    rgb = rgb.copy()
    rgb[fill] = rgb[iy[fill], ix[fill]]
    for _ in range(HOLE_SMOOTH):
        blur = ndimage.uniform_filter(rgb.astype(np.float32), size=(3, 3, 1))
        rgb[fill] = blur[fill]
    body = solid | fill
    edge = fill & ndimage.binary_dilation(~body, EIGHT)
    rgb[edge] = HOLE_OUTLINE
    return rgb, fg | fill, np.where(fill, 255.0, alpha)


def build_one(path: Path, sizes: tuple[int, ...]) -> tuple[list[Image.Image], bool, str | None]:
    """칸 크기마다 한 장씩. 배경 제거·몸통 찾기·잔디 제거는 **한 번만** 한다 —
    크기별로 따로 돌리면 시간이 배로 들고, 판단이 같으니 결과도 같다."""
    rgb, alpha, from_jpg = load(path)
    alpha, _ = strip_dividers(alpha, rgb)
    if path.stem in HAZE_DROP:
        alpha = drop_haze(alpha)
    if path.stem in FRINGE_WIDE:
        rgb, alpha = defringe_wide(rgb, alpha, FRINGE_WIDE[path.stem])
    rgb, _ = defringe(rgb, alpha)
    h, w = alpha.shape
    bodies = find_bodies(alpha)
    if bodies is None:
        return [Image.new("RGBA", (s * FRAMES, s)) for s in sizes], from_jpg, "몸통 5개를 못 찾았다"

    owner = assign_pixels(alpha, bodies)                # 픽셀 → 소속 칸(덩어리로 가른다)
    sheets = [Image.new("RGBA", (s * FRAMES, s), (0, 0, 0, 0)) for s in sizes]

    for k, body in enumerate(bodies):
        mine = owner == k
        fg = (alpha > 8) & mine
        cell_rgb, cell_alpha = rgb, alpha
        if k in GROUND_CUT.get(path.stem, {}):
            fg = cut_boxes(fg, GROUND_CUT[path.stem][k])
        if k in GROUND_PATCH.get(path.stem, {}):
            cell_rgb, fg = patch_boxes(rgb, fg, GROUND_PATCH[path.stem][k])
        if path.stem not in GRASS_FREE and k in GRASS_CELLS.get(path.stem, range(FRAMES)):
            fg = strip_ground(cell_rgb, fg, body["foot"], GRASS_TOP.get(path.stem), GRASS_GR_FOR.get(path.stem),
                                 GRASS_GB_FOR.get(path.stem))
        if path.stem in SAND_DROP:
            fg = drop_sand(cell_rgb, fg, SAND_DROP[path.stem])
        if k in HOLE_FILL.get(path.stem, {}):
            cell_rgb, fg, cell_alpha = fill_holes(cell_rgb, fg, alpha, HOLE_FILL[path.stem][k])
        if k in HOLE_FILL_NEAR.get(path.stem, {}):
            cell_rgb, fg, cell_alpha = fill_holes(cell_rgb, fg, cell_alpha, HOLE_FILL_NEAR[path.stem][k], near=True)
        if k in HOLE_FILL_LOW.get(path.stem, {}):
            cell_rgb, fg, cell_alpha = fill_holes(cell_rgb, fg, cell_alpha, HOLE_FILL_LOW[path.stem][k], near=True, low=True)
        if k in HOLE_BOX.get(path.stem, {}):
            cell_rgb, fg, cell_alpha = fill_box_holes(cell_rgb, fg, cell_alpha, HOLE_BOX[path.stem][k])
        # 잔디를 걷으면 거기 맞닿아 있던 몸 가장자리가 투명 곁이 된다 — 그 자리의 분홍 테두리를 한 번 더 고친다
        frame_rgb, _ = defringe(cell_rgb, np.where(fg, cell_alpha, 0.0))

        a = np.where(fg, cell_alpha, 0.0)
        body_w = float((np.where(fg.any(0))[0].max() - np.where(fg.any(0))[0].min() + 1)
                       if fg.any() else body["height"] * 0.7)
        sh = shadow_layer(alpha.shape, body["cx"], body["foot"], body_w) * mine

        # 그림자를 아래, 캐릭터를 위에
        af = a / 255.0
        out_a = af + sh * (1.0 - af)
        out_rgb = frame_rgb * af[..., None] / np.maximum(out_a, 1e-5)[..., None]
        for sheet, s in zip(sheets, sizes):
            sheet.paste(render_frame(out_rgb, out_a * 255.0, body, s), (k * s, 0))

    return sheets, from_jpg, None


def save_hd(sheet: Image.Image, dst: Path) -> None:
    """화면용 큰 시트 — WebP. 알파는 무손실, 색만 손실 압축(PNG의 1/3 안팎)."""
    sheet.save(dst, "WEBP", quality=HD_QUALITY, alpha_quality=100, method=6)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="액션 띠 → 웹용 스프라이트시트")
    ap.add_argument("--size", type=int, default=110, help="칸 한 변 (기본 110)")
    ap.add_argument("--only", nargs="+", metavar="이름", help="이 이름이 들어간 것만")
    ap.add_argument("--force", action="store_true", help="이미 있어도 다시 만든다")
    ap.add_argument("--dry-run", action="store_true", help="저장하지 않고 진단만")
    ap.add_argument("--sheet", type=Path, help="대조용 큰 시트를 이 경로에 저장한다")
    ap.add_argument("--sheet-max", type=int, default=30, help="대조 시트에 넣을 장수")
    args = ap.parse_args()

    if not SRC.is_dir():
        print(f"원본을 찾을 수 없다: {SRC}", file=sys.stderr)
        return 1
    if not OFFICERS.is_file():
        print(f"먼저 `npm run extract`를 돌려라: {OFFICERS} 없음", file=sys.stderr)
        return 1

    by_name = {o["name"]: o["id"] for o in json.loads(OFFICERS.read_text(encoding="utf-8"))}

    best: dict[str, Path] = {}
    for p in sorted(SRC.iterdir()):
        if p.suffix.lower() not in EXTS:
            continue
        stem = unicodedata.normalize("NFC", p.stem)
        cur = best.get(stem)
        if cur is None or EXTS.index(p.suffix.lower()) < EXTS.index(cur.suffix.lower()):
            best[stem] = p
    files = [best[k] for k in sorted(best)]
    if args.only:
        files = [p for p in files if any(s in p.stem for s in args.only)]
    if not files:
        print(f"{SRC} 에 처리할 이미지가 없다.", file=sys.stderr)
        return 1
    if not args.dry_run:
        OUT.mkdir(parents=True, exist_ok=True)
        OUT_HD.mkdir(parents=True, exist_ok=True)
    sizes = (args.size, HD_SIZE)

    def done(oid: str) -> bool:
        """둘 다 있어야 건너뛴다 — 큰 시트가 나중에 생겨 110²만 있는 사람이 흔하다"""
        return (OUT / f"{oid}.png").is_file() and (OUT_HD / f"{oid}.webp").is_file()

    def write(oid: str, pair: list[Image.Image]) -> None:
        pair[0].save(OUT / f"{oid}.png", optimize=True)
        save_hd(pair[1], OUT_HD / f"{oid}.webp")

    made = skipped = 0
    kinds = {True: 0, False: 0}
    unknown: list[str] = []
    failed: list[tuple[str, str]] = []
    previews: list[Image.Image] = []

    for path in files:
        name = unicodedata.normalize("NFC", path.stem)
        oid = by_name.get(name)
        if oid is None:
            unknown.append(name)
            continue
        if done(oid) and not args.force and not args.dry_run:
            skipped += 1
            continue

        pair, from_jpg, err = build_one(path, sizes)
        kinds[from_jpg] += 1
        if err:
            failed.append((name, err))
            continue
        if args.sheet and len(previews) < args.sheet_max:
            previews.append(pair[0])
        if not args.dry_run:
            write(oid, pair)
        made += 1

    # 도적떼(GDD §5.11) — 한 벌을 다섯이 함께 쓴다. 원본과 이름은 `raid.json`이 정한다
    spec = OFFICERS.parent / "raid.json"
    if spec.is_file() and not args.only:
        art = json.loads(spec.read_text(encoding="utf-8"))["art"]
        src = ROOT / "assets" / art["action"]
        if src.is_file() and (args.force or args.dry_run or not done(art["id"])):
            pair, _, err = build_one(src, sizes)
            if err:
                failed.append((src.stem, err))
            elif not args.dry_run:
                write(art["id"], pair)
                print(f"  · 도적떼 액션 시트 → {art['id']}.png · .webp")

    total = sum(p.stat().st_size for p in OUT.glob("*.png")) if OUT.is_dir() else 0
    total_hd = sum(p.stat().st_size for p in OUT_HD.glob("*.webp")) if OUT_HD.is_dir() else 0
    # 합계는 **장수 몫만** 센다 — 도적떼 한 벌이 섞이면 「260/260」이 거짓이 된다
    have = len([p for p in OUT.glob("*.png") if p.stem in set(by_name.values())]) if OUT.is_dir() else 0
    print(f"출력 → {OUT}")
    print(f"  · 액션 시트 {args.size}²×{FRAMES} — 생성 {made}장, 기존 {skipped}장, "
          f"합계 {have}/{len(by_name)}명 ({total / 1024 / 1024:.1f}MB)")
    print(f"  · 화면용 {HD_SIZE}²×{FRAMES} WebP → {OUT_HD.name}/ ({total_hd / 1024 / 1024:.1f}MB)")
    print(f"  · 칸 순서: {' · '.join(f'{i}={a}' for i, a in enumerate(ACTIONS))}")
    print(f"  · 입력: 마젠타 합성본 {kinds[True]}장 · 알파 PNG {kinds[False]}장")
    print(f"  · 정규화: 몸통 높이 = 칸의 {TARGET_BODY:.0%}, 발끝 = 칸의 {FOOT_LINE:.0%}")

    if args.sheet and previews:
        w = max(s.width for s in previews)
        big = Image.new("RGBA", (w, sum(s.height for s in previews)), (0x1e, 0x3a, 0x2f, 255))
        y = 0
        for s in previews:
            big.alpha_composite(s, (0, y))
            y += s.height
        args.sheet.parent.mkdir(parents=True, exist_ok=True)
        big.convert("RGB").save(args.sheet)
        print(f"  · 대조 시트 {len(previews)}명 → {args.sheet}")

    if unknown:
        note(f"대응 장수가 없는 파일 {len(unknown)}건: {', '.join(unknown[:8])}")
    if failed:
        note(f"실패 {len(failed)}장:")
        for n, why in failed[:12]:
            note(f"  {n} — {why}")
    missing = len(by_name) - have
    if missing > 0:
        note(f"아직 원본이 없는 장수 {missing}명")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
