#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""꼬마 장수 애니메이션 시트 굽기 — Gemini로 받은 사이 칸 + 지금 다섯 자세 → 장수마다 18칸 (2026-11-16).

    npm run anims [-- --only 가후 간옹] [--preview 대조.png]
    npm run anims -- --new --preview 대조.png    # 원본/에 새로 들어온 장수만
    npm run anims -- --archive                   # 원본/의 그림을 반영됨/으로 옮겨 원본/을 비운다(굽지 않는다)

**원본/은 받은 편지함이다**(2026-11-16 기획자) — 기획자가 새 그림을 넣고 「반영해 줘」 하면 `--new`로 굽고, 확인이 끝나면
`--archive`로 `반영됨/`에 옮겨 비운다. 굽기는 언제나 `원본/` → `반영됨/` 순으로 찾으므로 옮긴 뒤에도 전원 다시 굽기가 된다.
같은 이름이 이미 `반영됨/`에 있으면 옛 것은 `반영됨/_교체됨/{이름}_{동작}_{시각}`으로 비켜 둔다(지우지 않는다).

| 입력 | 쓰임 |
|---|---|
| `assets/CharsAnim/원본/{이름}_{평상|이동|공격|마법|피격}.jpg` | 기획자가 새로 받아 둔 사이 칸(검정 바탕). 한 장 안의 칸은 같은 쪽을 본다 |
| `assets/CharsAnim/반영됨/` (같은 이름) | 구워서 확인을 마친 원본 — `원본/`에 같은 것이 없을 때 읽는다 |
| `packages/client/public/actions-hd/{id}.webp` (`npm run actions`가 먼저) | 지금 다섯 자세(240² × 5) — 시트의 0 · 4 · 9 · 14칸, 크기 · 발 자리 · 방향의 기준 |

출력 `packages/client/public/anims/{id}.png` — 176 × 143 × 18칸(아래 가운데 110²가 지금 시트의 칸, 위 33px은 머리 위 여백, 양옆 33px씩은 옆 여백) — 전투 판.
     `packages/client/public/anims-hd/{id}.webp` — 384 × 312 × 18칸, 같은 그림의 큰 것 — 메뉴의 장수 그림(`OfficerActionArt`, 뽑기 · 오프닝 · 장수 카드).(`ANIM` 표가 칸 번호, `client/src/battle/poses.ts`의 `ANIM`과 같다).
**원본이 없는 동작은 지금 자세를 되풀이해 채운다(stub)** — 화면은 언제나 같은 18칸을 읽고, 원본이 오면 그 장수만 다시 굽는다.

굽기의 판단:
- 바탕: 가장자리에서 이어진 어두운 곳(`BLACK`)을 지운다. 안쪽에 갇힌 넓은 순검정(팔과 몸 사이 틈)도 지운다.
- 칸 가르기: 줄 · 열마다 「기대 자리 근처에서 그림이 가장 적은 세로(가로)줄」을 경계로 잡는다.
- 크기: 원본 한 장에 배율 하나 — **머리 크기**가 그 동작의 기준 자세(평상 · 이동 · 공격 · 마법 · 피격)와 같아지게(2026-11-25
  기획자 — 칼을 휘둘러 그림 면적이 커지는 장에서 사람이 작아졌다). 칸마다 다섯 자세의 머리를 SIFT 특징점으로 찾아 닮음 변환의
  배율을 재고, 믿을 칸(맞는 점 ≥ `HEAD_INLIERS`)들의 가운데값을 쓴다. 믿을 칸이 없는 장(웅크린 정면 · 쓰러지며 기운 머리)만
  몸 덩어리 키로 잰다(쓰러짐은 첫 칸만).
- 발 · 가운데: 몸 덩어리의 바닥을 **기준 자세의 몸 바닥**에, 무게 중심을 기준 자세의 무게 중심에. 지금 시트의 발은 장수마다
  그림자 위로 0~20px(240 해상도) 떠 있다 — 칸의 95%(`FOOT`)에 박으면 평상 동작 때 몸이 내려앉았다 올라왔다(감택 17px, 2026-11-16).
  그림자는 `FOOT`(지금 시트의 그림자 자리) 그대로.
- 머리 위 여백(`HEAD`): 치켜든 무기가 칸 위로 나가도 되게(2026-11-16 기획자 — 동작은 차례인 장수 하나가 잠깐 하므로
  윗칸 · 판 밖으로 삐져나가도 어색하지 않다). 판은 아래 정사각을 지금 자리에 맞추고 여백을 칸 위로 내밀어 그린다
  (`BattleScene`의 `FRAME_H` · 원점). 지금 다섯 자세는 여백을 안 쓴다.
- 옆 여백(`SIDE`): 같은 까닭으로 양옆에도(2026-11-17 기획자 — 관우 · 기령처럼 창을 휘두르거나 뻗고 넘어지는 장수). 이것이
  없을 때는 옆으로 넘친 칸을 안쪽으로 밀어 넣어 **몸이 옆으로 튀거나**(관우 피격 52px) 장 전체를 줄였다(기령 피격 ×0.90).
- 칸 넘침: 여백까지 넘는 것(크게 휘두른 칼끝)은 **잘린다** — 줄이지 않는다(2026-11-25, 예전에는 장 전체를 줄여 사람이 작아졌다). 잘린 양은 굽기 기록에 남는다.
- 손 보정: 머리로 못 잰 장에만 — `tools/anim_frames_fix.tsv`(이름 · 동작 · 배율 곱)가 원본 한 장의 배율에 곱해진다 — 기준 자세와 몸 생김이 달라
  키로 잰 배율이 어긋나는 장(감녕 평상: 0칸은 웅크린 정면, 사이 칸은 선 자세라 머리가 0.75배로 작게 구워졌다).
  눈으로 본 머리 크기로 맞춘다.
- 방향: 칸을 기준 자세 · 그 좌우 반전과 견줘 반전 쪽이 더 닮은 칸이 많으면 그 장 전체를 뒤집는다(한 장 안은 같은 쪽).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_action_sheets import shadow_layer  # noqa: E402 — 지금 시트와 같은 발밑 그림자

ROOT = Path(__file__).resolve().parent.parent
OFFICERS = ROOT / "packages" / "data" / "generated" / "officers.json"
SRC = ROOT / "assets" / "CharsAnim" / "원본"
DONE = ROOT / "assets" / "CharsAnim" / "반영됨"
EXTS = ("jpg", "jpeg", "png", "webp")
HD = ROOT / "packages" / "client" / "public" / "actions-hd"
OUT = ROOT / "packages" / "client" / "public" / "anims"
OUT_HD = ROOT / "packages" / "client" / "public" / "anims-hd"
HD_QUALITY = 88     # build_action_sheets.py의 큰 시트와 같은 값

CELL = 240          # 굽는 해상도(지금 시트와 같은 칸) — 마지막에 110으로 줄인다
SIZE = 110
HEAD = 72           # 머리 위 여백(굽는 해상도) — 칸 높이 312 = 240 × 1.3, 줄이면 110 × 143. poses.ts의 FRAME_H와 짝
SIDE = 72           # 양옆 여백(굽는 해상도) — 칸 폭 384 = 240 × 1.6, 줄이면 176. 휘두른 창 · 넘어지며 뻗은 창이 칸 옆으로 나가도
                    # 몸이 밀리거나 장이 줄지 않게(2026-11-17 기획자 — 관우 · 기령). animSheet.ts의 FRAME_W와 짝
CELL_H = CELL + HEAD
CELL_W = CELL + 2 * SIDE
SIZE_H = round(SIZE * CELL_H / CELL)
SIZE_W = round(SIZE * CELL_W / CELL)
FOOT_SQ = round(CELL * 0.95)   # build_action_sheets.py의 「발끝 = 칸의 95%」(정사각 안에서)
FOOT = HEAD + FOOT_SQ          # 여백을 얹은 칸에서
BLACK = 26          # 바탕으로 볼 밝기(최댓값 채널) — JPEG 잡티를 넘는 만큼
HOLE_BLACK = 14     # 안쪽에 갇힌 틈은 더 어두워야 바탕으로 본다
HOLE_MIN = 250      # 갇힌 틈의 최소 넓이(원본 픽셀) — 머리카락 · 옷의 어두운 칸을 지키려고
LINE_HALF = 0.008   # 바탕 중 이 반지름(원본 높이에 대한 비, 약 12px)의 원이 안 들어가는 가는 곳은 몸으로 되돌린다 — 갑옷 ·
                    # 허리띠의 순검정 테두리 줄이 바깥 검정과 이어져 바탕으로 빠지면 몸이 가로로 끊긴다 (2026-11-16 고람 · 고순
                    # 이동: 가장 큰 덩어리(머리 · 어깨)를 몸으로 보고 발에 맞춰 다리가 칸 밖으로 나갔다. 줄 두께는 22px 이하,
                    # 진짜 틈은 40~53px — 감녕 평상 · 고순 이동)
SPECK_MIN = 24      # 이보다 작은 덩어리는 잡티
SPECK_THIN = 0.012  # 몸과 떨어진 가늘고 긴 덩어리의 두께 상한(원본 높이에 대한 비) — 붙은 창대 · 끈은 몸과 한 덩어리라 안 걸린다

# 칸 번호 — 0 · 4 · 9 · 14는 지금 자세(actions-hd의 0~4칸), 나머지는 원본 이미지의 칸
# (이름, 원본 동작, 그 원본의 몇째 칸, 없을 때 채울 지금 자세)
ANIM = [
    ("idle", None, None, 0),
    ("idle1", "평상", 0, 0), ("idle2", "평상", 1, 0), ("idle3", "평상", 2, 0),
    ("walk", None, None, 1),
    ("walk1", "이동", 0, 1), ("walk2", "이동", 1, 1),
    ("atk1", "공격", 0, 2), ("atk2", "공격", 1, 2),
    ("attack", None, None, 2),
    ("cast1", "마법", 0, 3), ("cast2", "마법", 1, 3), ("cast3", "마법", 2, 3), ("cast4", "마법", 3, 3),
    ("hurt", None, None, 4),
    ("fall1", "피격", 0, 4), ("fall2", "피격", 1, 4), ("fall3", "피격", 2, 4),
]
GRID = {"평상": (1, 3), "이동": (1, 2), "공격": (1, 2), "마법": (2, 2), "피격": (1, 3)}
FIX = ROOT / "tools" / "anim_frames_fix.tsv"
BASE = {"평상": 0, "이동": 1, "공격": 2, "마법": 3, "피격": 4}   # 크기 · 방향의 기준 자세(지금 시트의 칸)


def load_fix() -> dict[tuple[str, str], float]:
    """(이름, 동작) → 배율 곱. 표가 없으면 비어 있다. 모르는 동작은 말한다(오타가 조용히 안 걸리지 않게)."""
    out: dict[tuple[str, str], float] = {}
    if not FIX.exists():
        return out
    for n, line in enumerate(FIX.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.startswith("#") or line.startswith("이름	"):
            continue
        name, motion, mul = (c.strip() for c in line.split("	")[:3])
        if motion not in GRID:
            raise SystemExit(f"{FIX.name}:{n}: 모르는 동작 「{motion}」 — {' · '.join(GRID)}")
        out[(name, motion)] = float(mul)
    return out


FIXES = load_fix()

# 받은 원본의 칸 순서를 바꿔 싣는 장(이름, 동작) → 원본 칸 번호를 실을 순서로. 원본 그림은 그대로 두고 굽기에서만 바꾼다
# (가후 평상: 평상 → 원본 1 → 원본 3 → 원본 2 → 평상이 자연스럽다 — 2026-11-17 기획자)
ORDER: dict[tuple[str, str], tuple[int, ...]] = {
    ("가후", "평상"): (0, 2, 1),
}

# 방향 자동 판정이 틀리는 장 — 뒤집지 않는다(동탁 평상: 받은 칸이 기준 자세와 같은 쪽인데 반전 쪽이 더 닮게 재여
# 세 칸이 반대쪽을 봤다 — 2026-11-17 기획자)
NO_FLIP: set[tuple[str, str]] = {("동탁", "평상")}

# ───────────────────────────── 지금 자세 ─────────────────────────────

def body_of(alpha: np.ndarray) -> np.ndarray:
    """가장 큰 덩어리(몸 + 든 것) — 그림자 · 효과 조각을 뺀 몸."""
    lab, n = ndimage.label(alpha > 160)
    if n == 0:
        return alpha > 160
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))


BODY_ROW = 0.35     # 몸통 키는 「폭이 가장 넓은 줄의 이만큼 이상인 줄」만 센다 — 머리 위로 든 무기 · 부채를 빼려고


def measure(mask: np.ndarray, trunk: bool = False) -> tuple[float, float, float]:
    """(몸통 키, 무게 중심 x, 바닥 y). 키는 가는 것(치켜든 무기 · 사슬)을 뺀 몸통의 위아래다 — 첫 시험에서
    무기를 치켜든 평상 칸이 그만큼 작게 구워졌다(감녕 · 간옹)."""
    ys, xs = np.nonzero(mask)
    w = mask.sum(1)
    rows = np.nonzero(w >= w.max() * BODY_ROW)[0] if trunk else np.nonzero(w)[0]
    return float(rows.max() - rows.min() + 1), float(xs.mean()), float(ys.max())


def signature(rgba: np.ndarray) -> np.ndarray:
    """방향을 견주는 지문 — 몸 둘레 상자를 32×32 회색으로."""
    m = body_of(rgba[..., 3])
    ys, xs = np.nonzero(m)
    crop = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype(np.float32)
    g = (crop[..., :3].mean(-1) * (crop[..., 3] / 255.0)).astype(np.uint8)
    v = np.asarray(Image.fromarray(g).resize((32, 32), Image.BILINEAR), np.float32)
    return (v - v.mean()) / (v.std() + 1e-6)

# ───────────────────────────── 원본 자르기 ─────────────────────────────

def foreground(rgb: np.ndarray) -> np.ndarray:
    mx = rgb.max(-1)
    # 바탕이 순검정이 아닌 장 — 가장자리의 밝기만큼 문턱을 올린다(2026-11-25, 왕평 피격: 바탕이 38~39의 짙은 회색이라
    # 네모 판째 몸으로 잡혔다). 무채색 바탕일 때만(가장자리까지 그린 장은 안 건드린다)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(int)
    lift = 0
    bmx = np.median(border.max(-1))
    if BLACK - 8 < bmx < 70 and np.median(border.max(-1) - border.min(-1)) <= 6:
        lift = int(bmx) + 12 - BLACK
    dark = mx <= BLACK + lift
    lab, _ = ndimage.label(dark)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, edge[edge > 0])
    # 안쪽에 갇힌 넓은 순검정(팔과 몸 사이의 틈)
    hole_lab, hn = ndimage.label((mx <= HOLE_BLACK + lift) & ~bg)
    if hn:
        sizes = ndimage.sum(np.ones_like(hole_lab), hole_lab, range(1, hn + 1))
        big = np.nonzero(sizes >= HOLE_MIN)[0] + 1
        bg |= np.isin(hole_lab, big)
    # 열기(opening) — 바탕을 r만큼 깎았다 다시 r만큼 불리면 원이 안 들어가는 가는 줄만 사라진다
    r = rgb.shape[0] * LINE_HALF
    core = ndimage.distance_transform_edt(bg) > r
    bg = ndimage.distance_transform_edt(~core) <= r
    fg = ~bg
    lab, n = ndimage.label(fg)
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        # 몸과 떨어진 가늘고 긴 덩어리(두께 < 원본 높이 × SPECK_THIN, 길이 ≥ 두께 × 15)도 잡티 — 투명 PNG 아래에 그어진
        # 4px 흰 줄(관평 피격). 반짝이 점 같은 효과는 길쭉하지 않아 남는다
        thick = np.asarray(ndimage.maximum(ndimage.distance_transform_edt(lab > 0), lab, range(1, n + 1))) * 2
        span = np.array([max(s[0].stop - s[0].start, s[1].stop - s[1].start) for s in ndimage.find_objects(lab)])
        line = (thick < rgb.shape[0] * SPECK_THIN) & (span >= thick * 15)
        keep = (sizes >= SPECK_MIN) & ~line
        fg &= np.isin(lab, np.nonzero(keep)[0] + 1)
    return fg


def cuts(profile: np.ndarray, n: int) -> list[int]:
    """기대 자리(등분) 근처에서 그림이 가장 적은 줄 — 그런 줄이 여럿이면 빈 띠의 가운데."""
    L = len(profile)
    out = [0]
    for i in range(1, n):
        c = round(i * L / n)
        w = round(L / n * 0.35)
        seg = profile[c - w:c + w]
        lo = seg.min()
        idx = np.nonzero(seg <= lo)[0]
        # 가장 긴 연속 구간의 가운데
        runs = np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1)
        best = max(runs, key=len)
        out.append(c - w + int(best[len(best) // 2]))
    out.append(L)
    return out


def split_cells(path: Path, rows: int, cols: int) -> list[np.ndarray]:
    src = Image.open(path)
    if "A" in src.getbands() or "transparency" in src.info:
        # 투명 바탕 PNG — 검정 위에 합성해 다른 장(검정 바탕 jpg)과 같은 조건으로 읽는다. RGB만 읽으면 거의 투명한
        # 얼룩 · 줄이 제 색으로 살아난다 (2026-11-17 관평 피격: 발밑에 흰 가로줄)
        a = np.asarray(src.convert("RGBA")).astype(np.float32)
        rgb = (a[..., :3] * (a[..., 3:] / 255.0)).round().astype(np.uint8)
    else:
        rgb = np.asarray(src.convert("RGB"))
    fg = foreground(rgb)
    ys = cuts(fg.sum(1), rows)
    cells = []
    for r in range(rows):
        band = fg[ys[r]:ys[r + 1]]
        xs = cuts(band.sum(0), cols)
        for c in range(cols):
            m = fg[ys[r]:ys[r + 1], xs[c]:xs[c + 1]]
            im = rgb[ys[r]:ys[r + 1], xs[c]:xs[c + 1]]
            rgba = np.dstack([im, (m * 255).astype(np.uint8)])
            yy, xx = np.nonzero(m)
            cells.append(rgba[yy.min():yy.max() + 1, xx.min():xx.max() + 1])
    return cells

# ───────────────────────────── 맞추기 ─────────────────────────────

# ───────────────────────────── 머리 크기 ─────────────────────────────
# 크기의 기준은 머리다(2026-11-25 기획자 — 칼을 휘둘러 그림 면적이 커지는 장에서 사람이 작아졌다). 몸 덩어리 키는
# 치켜든 칼 · 뻗은 창까지 키로 재서(이동 · 공격) 그만큼 사람을 줄였고, 칸 밖으로 나간 칼은 장 전체를 또 줄였다
# (관우 · 기령 · 조조 공격 머리 0.85배 안팎). 기준 자세의 머리를 SIFT 특징점으로 원본 칸에서 찾아 닮음 변환의 배율을 잰다 —
# Gemini가 다시 그린 머리라도 투구 · 얼굴 무늬가 같아 맞는 점이 수십~수백 개 잡힌다. 맞는 점이 적은 칸(쓰러지며 기운 머리,
# 웅크린 정면)은 안 믿고, 믿을 칸이 하나도 없는 장은 예전처럼 몸 키(+ 손 보정)로 잰다.
HEAD_UP = 3          # 특징점을 잡기 전에 키우는 배 — 240 해상도의 머리는 100px 안팎이라 그대로는 점이 적다
HEAD_INLIERS = 12    # 이만큼 이상 맞아야 그 칸의 머리 배율을 믿는다(실측: 맞는 칸 19~280 · 틀린 칸 2~11)
_SIFT = None


def _gray8(rgba: np.ndarray) -> np.ndarray:
    import cv2
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    g = (rgba[..., :3].astype(np.float32) * a).mean(-1) + (1.0 - a[..., 0]) * 128.0   # 바탕은 중간 회색
    g = np.clip(g, 0, 255).astype(np.uint8)
    return cv2.resize(g, None, fx=HEAD_UP, fy=HEAD_UP, interpolation=cv2.INTER_CUBIC)


def head_crop(base_rgba: np.ndarray) -> np.ndarray:
    """기준 자세의 머리 — 몸통 줄(가는 무기를 뺀 줄)의 위 45%."""
    m = body_of(base_rgba[..., 3])
    w = m.sum(1)
    rows = np.nonzero(w >= w.max() * BODY_ROW)[0]
    top, bot = int(rows.min()), int(rows.max())
    hb = top + int((bot - top) * 0.45)
    xs = np.nonzero(m[top:hb].any(0))[0]
    return base_rgba[max(0, top - 6):hb, max(0, xs.min() - 6):xs.max() + 7]


def head_ratio(head: np.ndarray, frame: np.ndarray) -> tuple[float | None, int]:
    """frame 속 머리가 head의 몇 배인지(같은 해상도로 놓인 둘) — (배율, 맞는 점 수). 못 재면 (None, 점 수)."""
    import cv2
    global _SIFT
    if _SIFT is None:
        _SIFT = cv2.SIFT_create()
    ka, da = _SIFT.detectAndCompute(_gray8(head), None)
    kb, db = _SIFT.detectAndCompute(_gray8(frame), None)
    if da is None or db is None or len(ka) < 4 or len(kb) < 4:
        return None, 0
    pairs = cv2.BFMatcher().knnMatch(da, db, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.8 * p[1].distance]
    if len(good) < 4:
        return None, len(good)
    pa = np.float32([ka[g.queryIdx].pt for g in good])
    pb = np.float32([kb[g.trainIdx].pt for g in good])
    M, inl = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=6)
    if M is None:
        return None, 0
    n = int(inl.sum())
    return (float(np.hypot(M[0, 0], M[1, 0])) if n >= HEAD_INLIERS else None), n


def resized(cell: np.ndarray, scale: float) -> Image.Image:
    h, w = cell.shape[:2]
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    return Image.fromarray(cell, "RGBA").convert("RGBa").resize((nw, nh), Image.LANCZOS).convert("RGBA")


def place(cell: np.ndarray, scale: float, base: tuple[float, float, float], note: list[str], tag: str,
          shadow_w: float) -> np.ndarray:
    """원본 칸을 배율대로 줄여 240² 칸에 — 몸 바닥은 발 자리, 무게 중심은 기준 자세의 것.
    칸(여백 포함) 밖으로 나가는 것은 잘린다 — 줄이지 않는다(머리 크기를 지킨다, 2026-11-25)."""
    im = resized(cell, scale)
    a = np.asarray(im)
    _, cx, bottom = measure(body_of(a[..., 3]))
    # 바닥은 큰 덩어리 전부에서 — 쓰러져 누운 칸은 몸이 여러 덩어리로 나뉘어, 가장 큰 덩어리(머리 · 어깨)의 바닥을 발에
    # 맞추면 나머지가 칸 아래로 빠져 잘렸다(2026-11-25, 공융 · 만총 피격 마지막 칸)
    lab, n = ndimage.label(a[..., 3] > 160)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        big = np.isin(lab, np.nonzero(sizes >= sizes.max() * 0.08)[0] + 1)
        bottom = max(bottom, float(np.nonzero(big.any(1))[0].max()))
    ox = round(base[1] - cx)
    foot = base[2]   # 기준 자세의 몸 바닥 — 발이 그림자 위에 뜬 만큼까지 같게
    oy = round(foot - bottom)
    total = float(a[..., 3].sum())
    x0, y0 = max(0, -ox), max(0, -oy)
    x1, y1 = min(im.width, CELL_W - ox), min(im.height, CELL_H - oy)
    kept = float(a[y0:y1, x0:x1, 3].sum()) if x1 > x0 and y1 > y0 else 0.0
    lost = 1.0 - kept / max(total, 1.0)
    if lost > 0.002:
        note.append(f"{tag} 칸 밖 {lost * 100:.1f}% 잘림")
    if lost > 0.002 and im.width <= CELL_W:
        # 칸 폭 안에 드는데 옆으로 넘친 칸(쓰러져 누운 마지막 칸)은 자르지 않고 안쪽으로 민다
        ox = min(max(ox, 0), CELL_W - im.width)
        x0, x1 = 0, im.width
        kept = float(a[y0:y1, x0:x1, 3].sum()) if y1 > y0 else 0.0
        lost = 1.0 - kept / max(total, 1.0)
        note[-1] = f"{tag} 칸 안으로 밀어 넣음{f' · {lost * 100:.1f}% 잘림' if lost > 0.002 else ''}"
    canvas = Image.new("RGBA", (CELL_W, CELL_H))
    if x1 > x0 and y1 > y0:
        canvas.alpha_composite(im.crop((x0, y0, x1, y1)), (ox + x0, oy + y0))
    # 발밑 그림자 — 지금 자세에는 있고 Gemini 칸에는 없다(프롬프트가 막는다). 크기는 장수의 평상 자세 폭으로 하나
    c = np.asarray(canvas).astype(np.float32)
    a = c[..., 3] / 255.0
    # 그림자는 정사각 칸에서 낸다(높이에 비례해 띄우므로) — 지금 시트와 같은 자리
    sh = np.pad(shadow_layer((CELL, CELL_W), base[1], FOOT_SQ, shadow_w), ((HEAD, 0), (0, 0)))
    out_a = a + sh * (1.0 - a)
    rgb = c[..., :3] * a[..., None] / np.maximum(out_a, 1e-5)[..., None]
    return np.dstack([rgb, out_a * 255.0]).round().clip(0, 255).astype(np.uint8)


def motion_frames(name: str, motion: str, base_rgba: np.ndarray, note: list[str], shadow_w: float,
                  refs: list[tuple[np.ndarray, float]] | None = None) -> list[np.ndarray] | None:
    """refs — 머리를 찾을 기준 머리들(머리 그림, 이 동작 기준 자세 머리에 대한 크기 비). 없으면 기준 자세의 머리 하나."""
    path = next((p for d in (SRC, DONE) for p in (d / f"{name}_{motion}.{e}" for e in EXTS) if p.exists()), None)
    if path is None:
        return None
    rows, cols = GRID[motion]
    cells = split_cells(path, rows, cols)
    base_m = body_of(base_rgba[..., 3])
    # 평상만 몸통 키로 잰다 — 무기 · 부채를 치켜드는 동작이라. 옆모습(이동 · 공격)은 몸이 좁아 몸통 키가 몸을 자른다
    trunk = motion == "평상"
    base = measure(base_m, trunk)
    hs = [measure(body_of(c[..., 3]), trunk)[0] for c in cells]
    src_h = hs[0] if motion == "피격" else float(np.median(hs))
    scale = base[0] / src_h
    # 방향 — 기준 자세와 견줘 반전이 더 닮은 칸이 많으면 그 장 전체를 뒤집는다
    sig = signature(base_rgba)
    flips = sum(float((signature(c) * sig).mean()) < float((signature(c[:, ::-1]) * sig).mean()) for c in cells)
    flip = flips * 2 > len(cells) and (name, motion) not in NO_FLIP
    if flip:
        cells = [np.ascontiguousarray(c[:, ::-1]) for c in cells]
    # 머리 크기 — 몸 키로 잡은 배율로 놓아 본 칸에서 머리가 기준 자세의 몇 배인지 재고, 믿을 칸들의 가운데값으로 고친다.
    # 한 장에 배율 하나(칸마다 따로 맞추면 잰 값의 흔들림이 그대로 몸의 출렁임이 된다)
    # 칸마다 다섯 자세의 머리 중 가장 잘 맞는 것으로 잰다 — Gemini 칸이 기준 자세와 다른 쪽 얼굴(옆모습 공격 자세 · 정면
    # 사이 칸)이면 그 자세의 머리로는 점이 안 잡힌다(기령 · 조조 공격). 다른 자세의 머리로 잰 값은 그 자세와 기준 자세의
    # 머리 크기 비로 바꾼다
    refs = refs or [(head_crop(base_rgba), 1.0)]
    ratios = []
    for c in cells:
        f = np.asarray(resized(c, scale))
        tries = [(head_ratio(h, f), k) for h, k in refs]
        (r, _), k = max(tries, key=lambda t: t[0][1])
        ratios.append(r * k if r is not None else None)
    sure = [r for r in ratios if r is not None and 0.5 < r < 2.0]
    mul = FIXES.get((name, motion))
    if sure:
        scale /= float(np.median(sure))
        how = f"머리 {len(sure)}/{len(cells)}칸 ×{1 / float(np.median(sure)):.2f}"
        if mul:
            how += f" (손 보정 ×{mul}은 안 씀)"
    else:
        if mul:
            scale *= mul
        how = f"몸 키{f' · 손 보정 ×{mul}' if mul else ''}"
    note.append(f"{motion}: {len(cells)}칸 · 배율 {scale:.3f} · {how}{' · 좌우 뒤집음' if flip else ''}")
    return [place(c, scale, base, note, f"{motion}{i + 1}", shadow_w) for i, c in enumerate(cells)]

# ───────────────────────────── 장수 하나 ─────────────────────────────

def build(o: dict) -> tuple[np.ndarray, list[str], list[str]]:
    sheet = np.asarray(Image.open(HD / f"{o['id']}.webp").convert("RGBA"))
    # 지금 다섯 자세(240²) 위 · 양옆에 여백을 얹는다 — 크기 · 발 · 무게 중심을 재는 기준도 이 칸
    poses = [np.pad(sheet[:, i * CELL:(i + 1) * CELL], ((HEAD, 0), (SIDE, SIDE), (0, 0))) for i in range(5)]
    note: list[str] = []
    # 그림자 폭의 기준 — 평상 자세 몸 폭(240² 칸). 지금 시트는 원본 몸 폭으로 쟀으니 닮은 크기가 된다
    xs = np.nonzero(body_of(poses[0][..., 3]).any(0))[0]
    shadow_w = float(xs.max() - xs.min() + 1)
    got: dict[str, list[np.ndarray] | None] = {}
    heads = [head_crop(p) for p in poses]
    for m in GRID:
        try:
            # 기준 머리들 — 이 동작의 기준 자세 머리(비 1)와, 그 자세에서 크기 비를 잴 수 있는 다른 자세의 머리
            b = BASE[m]
            refs = [(heads[b], 1.0)]
            for k in range(5):
                if k != b:
                    r, _ = head_ratio(heads[b], poses[k])   # 자세 k 속 머리 ÷ 기준 자세 머리
                    if r is not None and 0.6 < r < 1.6:
                        refs.append((heads[k], r))
            got[m] = motion_frames(o["name"], m, poses[b], note, shadow_w, refs)
            order = ORDER.get((o["name"], m))
            if got[m] and order:
                got[m] = [got[m][j] for j in order]
                note.append(f"{m}: 칸 순서 {'-'.join(str(j + 1) for j in order)}")
        except Exception as e:   # 한 장이 망가져도 나머지는 굽는다 — 그 동작은 stub
            note.append(f"{m}: 실패 — {e}")
            got[m] = None
    frames, real = [], []
    for key, m, i, fallback in ANIM:
        if m and got.get(m):
            frames.append(got[m][i])
            real.append(m)
        else:
            frames.append(poses[fallback])
    return np.concatenate(frames, axis=1), note, sorted(set(real), key=list(GRID).index)


def inbox() -> tuple[dict[str, list[Path]], list[Path]]:
    """원본/의 그림 — (장수 이름 → 파일들, 이름 꼴이 안 맞는 파일들). 꼴은 `{이름}_{동작}.{확장자}`."""
    names = {o["name"] for o in json.loads(OFFICERS.read_text(encoding="utf-8"))}
    found: dict[str, list[Path]] = {}
    odd: list[Path] = []
    for p in sorted(SRC.glob("*")) if SRC.exists() else []:
        if not p.is_file():
            continue
        name, _, motion = p.stem.rpartition("_")
        if p.suffix.lower().lstrip(".") in EXTS and motion in GRID and name in names:
            found.setdefault(name, []).append(p)
        else:
            odd.append(p)
    return found, odd


def archive() -> int:
    """원본/ → 반영됨/. 같은 이름이 있으면 옛 것을 _교체됨/으로 비켜 둔다. 꼴이 안 맞는 파일은 그대로 두고 말한다."""
    import datetime
    found, odd = inbox()
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    moved = 0
    for files in found.values():
        for p in files:
            DONE.mkdir(parents=True, exist_ok=True)
            for e in EXTS:   # 확장자가 달라도 같은 그림이다 — 옛 것은 비켜 둔다
                old = DONE / f"{p.stem}.{e}"
                if old.exists():
                    (DONE / "_교체됨").mkdir(exist_ok=True)
                    old.rename(DONE / "_교체됨" / f"{p.stem}_{stamp}{old.suffix}")
                    print(f"  옛 것 비켜 둠: {old.name} → _교체됨/")
            p.rename(DONE / p.name)
            moved += 1
    print(f"반영됨/으로 옮김 {moved}장 ({' · '.join(found) or '없음'})")
    for p in odd:
        print(f"  ⚠ 이름 꼴이 안 맞아 그대로 둠: {p.name} — {{장수 이름}}_{{{'|'.join(GRID)}}}.jpg")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="+", metavar="이름")
    ap.add_argument("--preview", type=Path, help="원본이 있는 장수의 240² 대조 시트를 여기에")
    ap.add_argument("--new", action="store_true", help="원본/에 들어 있는 장수만 굽는다")
    ap.add_argument("--archive", action="store_true", help="원본/의 그림을 반영됨/으로 옮긴다(굽지 않는다)")
    a = ap.parse_args()
    if a.archive:
        return archive()
    if a.new:
        found, odd = inbox()
        for p in odd:
            print(f"⚠ 이름 꼴이 안 맞아 건너뜀: {p.name} — {{장수 이름}}_{{{'|'.join(GRID)}}}.jpg")
        if not found:
            print("원본/에 새 그림이 없다")
            return 0
        a.only = sorted(set(a.only or []) | set(found))
        print(f"새로 들어온 장수: {' · '.join(f'{n}({len(f)}장)' for n, f in sorted(found.items()))}")
    by_id = {o["id"]: o for o in json.loads(OFFICERS.read_text(encoding="utf-8"))}
    OUT.mkdir(parents=True, exist_ok=True)
    OUT_HD.mkdir(parents=True, exist_ok=True)
    previews, done = [], []
    # 지금 시트가 있는 것 전부 — 장수 260명 + 명단 밖의 그림(도적 `bandit`)도 stub으로 채운다(화면이 18칸만 읽게)
    sheets = sorted(p.stem for p in HD.glob("*.webp"))
    todo = [by_id.get(k, {"id": k, "name": k}) for k in sheets]
    for o in todo:
        if a.only and o["name"] not in a.only:
            continue
        big, note, real = build(o)
        im = Image.fromarray(big, "RGBA").convert("RGBa")
        im.resize((SIZE_W * len(ANIM), SIZE_H), Image.LANCZOS).convert("RGBA").save(OUT / f"{o['id']}.png", optimize=True)
        Image.fromarray(big, "RGBA").save(OUT_HD / f"{o['id']}.webp", "WEBP", quality=HD_QUALITY, alpha_quality=100, method=6)
        if real:
            done.append(o["name"])
            print(f"{o['name']}: {' · '.join(real)}  ({'; '.join(note)})")
            previews.append(Image.fromarray(big, "RGBA"))
    stub = sum(1 for o in todo if not a.only or o["name"] in a.only) - len(done)
    print(f"원본이 있는 장수 {len(done)}명 · stub {stub}명 → {OUT}")
    if a.preview and previews:
        W = previews[0].width
        out = Image.new("RGBA", (W, CELL_H * len(previews)), (60, 60, 70, 255))
        for i, p in enumerate(previews):
            out.alpha_composite(p, (0, i * CELL_H))
        out.save(a.preview)
    return 0


if __name__ == "__main__":
    sys.exit(main())
