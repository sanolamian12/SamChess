#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CharsAction/ 의 5칸 액션 띠를 웹용 스프라이트시트로 굽는다.

    python tools/build_action_sheets.py [--size 110] [--force] [--only 관우] [--sheet 대조.png]

| 원본 | 출력 |
|---|---|
| `assets/CharsAction/{이름}.png|jpg` 1535×310 (307×310 × 5칸) | `public/actions/{장수id}.png` 550×110 (110² × 5칸) |

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
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "CharsAction"
OFFICERS = ROOT / "packages" / "data" / "generated" / "officers.json"
OUT = ROOT / "packages" / "client" / "public" / "actions"

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
DEBRIS_MAX = 900     # 잔디를 지운 뒤 바닥에 떨어져 나오는 이만큼 작은 섬은 자갈

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


def load(path: Path) -> tuple[np.ndarray, np.ndarray, bool]:
    """RGB(float) · 알파(0~255 float) · 합성본이었는지."""
    with Image.open(path) as im:
        im.load()
        arr = np.array(im.convert("RGBA"))
    alpha = arr[..., 3].astype(np.float32)
    if (alpha == 0).mean() > 0.05:                 # 이미 지워져 있다
        return arr[..., :3].astype(np.float32), strip_bands(alpha), False
    rgb, a, _ = unmix(arr[..., :3])
    return rgb, strip_bands(a), True


# ────────────────────────────────────────────────────────────────
# 3~4. 칸 나누기 · 몸통 찾기
# ────────────────────────────────────────────────────────────────

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
    """모든 픽셀을 가장 가까운 몸통에 배정한다. 칸 경계를 넘는 무기·이펙트를 살린다."""
    xs = np.arange(alpha.shape[1], dtype=np.float32)
    centers = np.array([b["cx"] for b in bodies], np.float32)
    return np.abs(xs[:, None] - centers[None, :]).argmin(1)      # 열마다 소속 칸


# ────────────────────────────────────────────────────────────────
# 5. 잔디 · 자갈 · 그림자
# ────────────────────────────────────────────────────────────────

def strip_ground(rgb: np.ndarray, fg: np.ndarray, foot: float) -> np.ndarray:
    """발밑 잔디와 자갈을 전경에서 뺀다."""
    h = rgb.shape[0]
    a = rgb.astype(int)
    zone = np.zeros(fg.shape, bool)
    zone[int(h * GRASS_ZONE):] = True

    grass = ((a[..., 1] - a[..., 2] >= GRASS_GB) & (a[..., 1] - a[..., 0] >= GRASS_GR)
             & (a[..., 1] >= GRASS_MIN_V) & zone & fg)
    if grass.any():
        grass = ndimage.binary_dilation(grass, EIGHT) & zone & fg
    out = fg & ~grass

    lab, n = ndimage.label(out, structure=EIGHT)
    if n > 1:
        sizes = ndimage.sum_labels(np.ones_like(lab), lab, range(1, n + 1))
        main = int(np.argmax(sizes)) + 1
        for i in np.where(sizes <= DEBRIS_MAX)[0] + 1:
            if i != main and zone[lab == i].mean() > 0.6:
                out &= lab != i
    return out


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


def build_one(path: Path, size: int) -> tuple[Image.Image, bool, str | None]:
    rgb, alpha, from_jpg = load(path)
    h, w = alpha.shape
    bodies = find_bodies(alpha)
    if bodies is None:
        return Image.new("RGBA", (size * FRAMES, size)), from_jpg, "몸통 5개를 못 찾았다"

    owner = assign(alpha, bodies)                       # 열 → 소속 칸
    sheet = Image.new("RGBA", (size * FRAMES, size), (0, 0, 0, 0))

    for k, body in enumerate(bodies):
        mine = np.zeros(alpha.shape, bool)
        mine[:, owner == k] = True
        fg = strip_ground(rgb, (alpha > 8) & mine, body["foot"])

        a = np.where(fg, alpha, 0.0)
        body_w = float((np.where(fg.any(0))[0].max() - np.where(fg.any(0))[0].min() + 1)
                       if fg.any() else body["height"] * 0.7)
        sh = shadow_layer(alpha.shape, body["cx"], body["foot"], body_w) * mine

        # 그림자를 아래, 캐릭터를 위에
        af = a / 255.0
        out_a = af + sh * (1.0 - af)
        out_rgb = rgb * af[..., None] / np.maximum(out_a, 1e-5)[..., None]
        sheet.paste(render_frame(out_rgb, out_a * 255.0, body, size), (k * size, 0))

    return sheet, from_jpg, None


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
        dst = OUT / f"{oid}.png"
        if dst.is_file() and not args.force and not args.dry_run:
            skipped += 1
            continue

        sheet, from_jpg, err = build_one(path, args.size)
        kinds[from_jpg] += 1
        if err:
            failed.append((name, err))
            continue
        if args.sheet and len(previews) < args.sheet_max:
            previews.append(sheet)
        if not args.dry_run:
            sheet.save(dst, optimize=True)
        made += 1

    total = sum(p.stat().st_size for p in OUT.glob("*.png")) if OUT.is_dir() else 0
    have = len(list(OUT.glob("*.png"))) if OUT.is_dir() else 0
    print(f"출력 → {OUT}")
    print(f"  · 액션 시트 {args.size}²×{FRAMES} — 생성 {made}장, 기존 {skipped}장, "
          f"합계 {have}/{len(by_name)}명 ({total / 1024 / 1024:.1f}MB)")
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
