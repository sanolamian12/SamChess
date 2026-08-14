#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""map/ 의 화면 장식 그림을 웹용으로 굽는다 — 체스판 배경과 캐릭터 카드 액자.

    python tools/build_frames.py [--force] [--sheet 대조.png]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/map/chessmap.png` 750² | `public/ui/chessmap.png` | **체스판 아래에 깔리는 지도** |
| `assets/map/person.png` 1440×2912 | `public/ui/card-frame.png` 480×1040 | **캐릭터 카드 액자**(9분할) |
| 〃 | `public/ui/backdrop.png` | 카드 스트립 뒤 산수 배경 |

────────────────────────────────────────────────────────────────
카드 액자는 「9분할(9-slice)」로 굽는다
────────────────────────────────────────────────────────────────

카드는 3:3이면 세 장, 5:5면 다섯 장이 한 줄에 들어가서 **칸의 가로세로비가 판마다
다르다.** 액자를 통째로 늘이면 3:3에서 지붕이 옆으로 퍼지고 5:5에서는 홀쭉해진다.

그래서 CSS `border-image`가 쓰는 9분할로 만든다 — 네 귀퉁이는 그대로 두고 변만
늘이는 방식이라, 지붕 두께와 기둥 굵기는 **화면에서 언제나 같다.**

그러려면 자를 자리가 **정해진 비율**이어야 한다. 그림에서 잰 값
(왼쪽 14.4% · 위 21.7% · 오른쪽 14.7% · 아래 12.0%)을 아래 `SLICE`의
반올림한 값에 맞도록 각 조각을 따로 줄여 굽는다. **CSS 는 이 상수를 그대로 적는다** —
`style.css` 의 `.uc-frame` 참조. 한쪽만 고치면 종이 자리가 어긋나므로 서로를 가리키는
주석을 양쪽에 뒀고, 이 도구는 돌 때마다 CSS 한 줄을 찍어 준다.

**지붕은 기둥보다 넓다.** 처마가 기둥 바깥으로 나와 있어서 몸통 폭으로 자르면 처마
끝이 잘린다. 그래서 지붕 띠만 **가로로 눌러** 몸통 폭에 맞춘다 — 20% 눌러도
기와 무늬라 눈에 띄지 않는다. 처마를 자르면 곧바로 티가 난다.

**나무 바깥은 투명하게 판다.** 카드가 다섯 장 나란히 서므로 배경(크림색)이 남아
있으면 카드마다 크림 테두리가 생겨 뒤의 산수 배경이 끊긴다.
────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
SRC = ROOT / "assets" / "map"
OUT = ROOT / "packages" / "client" / "public" / "ui"

# ── 원본에서 잰 자리 (person.png 1440×2912) ────────────────────
# `tools/`의 측정 스크립트로 뽑았다. 그림을 갈아 끼우면 이 값부터 다시 잰다.
PAPER = (358, 668, 1080, 2154)      # 흰 종이 (left, top, right, bottom)
BODY_X = (211, 1230)                # 기둥 바깥선 — 액자 몸통의 좌우 끝
FRAME_Y = (181, 2423)               # 지붕 꼭대기 ~ 아래 가로대 끝
ROOF_X = (76, 1364)                 # 처마 끝까지. 몸통보다 넓다
ROOF_BOTTOM = 405                   # 지붕과 몸통을 가르는 줄(처마 아래 그늘)

BG = (244, 239, 233)                # 크림색 배경. 지붕 띠에서 이 색을 판다
BG_TOL = 14

# ── 판 지도를 얼마나 눌러 구울 것인가 (2026-08-14 기획자 지적) ──
#
# **지도는 배경이다.** 원본은 채색이 또렷해서 그대로 깔면 격자와 기물보다 눈에 먼저
# 들어온다 — 「배경 컬러가 세게 느껴진다」가 그 뜻이었다. 그래서 굽는 단계에서
# 채도를 빼고 종이색 쪽으로 밀어 둔다. **화면 쪽에서 반투명으로 덮지 않는다** —
# 덮으면 그 위에 그리는 것(하이라이트·기물)까지 같이 뿌옇게 만들 자리가 생긴다.
MAP_DESATURATE = 0.45
"""채도를 이만큼 뺀다 (0 = 원본, 1 = 흑백)."""
MAP_FADE = 0.42
"""종이색으로 이만큼 밀어 올린다 (0 = 원본, 1 = 백지)."""
MAP_PAPER = (247, 242, 232)
"""밀어 올릴 종이색. 지도 여백의 색이라 테두리 장식과 이어진다."""

# ── 출력 규격 ─────────────────────────────────────────────────
CARD_W, CARD_H = 480, 1040
"""액자 그림의 크기. 원본 비율(1019×2242 = 0.455)에 맞춰 두면 조각마다
줄이는 배율이 고르다 — 어느 한 조각만 뭉개지지 않는다."""

SLICE = {"top": 0.22, "right": 0.15, "bottom": 0.12, "left": 0.15}
"""9분할 자리. **`style.css`의 `border-image-slice`와 같은 값이어야 한다.**

그림에서 잰 값은 14.4 / 21.7 / 14.7 / 12.0% 이고, 여기 반올림한 값에 맞도록
조각을 따로 줄여 굽는다 — 1% 안쪽의 차이라 그림에는 표가 나지 않는다.
"""

BACKDROP_W, BACKDROP_H = 960, 420
"""카드 스트립 뒤에 까는 산수 배경. 원본에서 액자 **바깥의 산수만** 오려
흩어 놓는다 — 벽보가 산과 누각을 등지고 서 있는 그림이 된다."""

SCENERY = [
    (0, 907, 205, 1519),        # 왼쪽 산봉우리
    (1236, 740, 1440, 1548),    # 오른쪽 산 (가장 크다)
    (0, 1732, 205, 2326),       # 왼쪽 누각과 바위
    (1236, 1714, 1440, 2185),   # 오른쪽 누각
]
"""액자 바깥에서 오려 낼 산수 조각 (left, top, right, bottom).

먹 밀도로 훑어 「산이 있는 구간」을 찾아 정했다. 액자(기둥 바깥선 211~1230)를
건드리지 않는 좌우 여백만 쓴다.
"""

LAYOUT = [(1, 0.10, 1.00, False), (2, 0.30, 0.78, False), (0, 0.50, 0.92, True),
          (3, 0.70, 0.74, True), (1, 0.90, 0.95, True)]
"""(조각 번호, 가로 중심 비율, 높이 비율, 좌우반전).

**같은 조각을 그대로 이어 붙이지 않는다.** 처음에는 좌우 띠를 통째로 반복했는데
이음매가 줄줄이 보이고 벽보 다리·항아리까지 따라 들어왔다. 봉우리를 **떨어뜨려
놓고 가장자리를 깃털처럼 지우면** 이음매가 사라지고 먼 산으로 읽힌다.
"""


def load(path: Path) -> Image.Image:
    with Image.open(path) as im:
        return im.convert("RGBA")


def key_cream(im: Image.Image, rows: tuple[int, int] | None = None) -> Image.Image:
    """크림색 배경을 투명하게 판다. **종이가 없는 줄에만** 쓴다.

    처음에는 가장자리에서 이어진 것만 지웠는데(물 붓듯 퍼뜨리기), 처마 아래
    **그늘 틈**이 좌우 까치발에 막혀 갇혀 있어 크림색으로 남았다 — 카드마다
    흰 줄이 하나씩 그어졌다. 그 틈은 원래 배경이 비쳐 보이는 자리라 뚫려야 맞다.

    ★ **흰 종이(248,247,245)가 크림색(244,239,233)과 차이가 12뿐이다.**
    색만 보고 지우면 종이가 통째로 뚫린다. 그래서 `rows`로 **종이가 없는 줄만**
    골라 지운다 — 종이 좌우는 대나무(황갈)라 잃을 것이 없다.
    """
    a = np.array(im)
    near = (np.abs(a[:, :, :3].astype(int) - np.array(BG)).max(axis=2) <= BG_TOL)
    if rows is not None:
        mask = np.zeros(a.shape[0], dtype=bool)
        mask[rows[0]:rows[1]] = True
        near &= mask[:, None]
    a[:, :, 3] = np.where(near, 0, a[:, :, 3])
    return Image.fromarray(a, "RGBA")


def build_card_frame(person: Image.Image) -> Image.Image:
    """벽보를 9분할용 액자로 굽는다."""
    px0, py0, px1, py1 = PAPER
    bx0, bx1 = BODY_X
    fy0, fy1 = FRAME_Y

    # 1. 지붕 띠 — 처마까지 잘라 몸통 폭으로 가로만 누른다
    roof = person.crop((ROOF_X[0], fy0, ROOF_X[1], ROOF_BOTTOM))
    roof = roof.resize((bx1 - bx0, ROOF_BOTTOM - fy0), Image.LANCZOS)

    # 2. 몸통 — 기둥 바깥선 그대로
    body = person.crop((bx0, ROOF_BOTTOM, bx1, fy1))

    board = Image.new("RGBA", (bx1 - bx0, fy1 - fy0))
    board.alpha_composite(roof, (0, 0))
    board.alpha_composite(body, (0, ROOF_BOTTOM - fy0))

    # 3. 배경을 판다 — 종이 위쪽(지붕·처마 아래 틈)과 아래쪽(가로대 둘레)만.
    #    종이 줄을 건드리면 종이가 통째로 뚫린다 (`key_cream` 참조).
    board = key_cream(board, (0, py0 - fy0 - 2))
    board = key_cream(board, (py1 - fy0 + 2, board.height))

    # 4. 아홉 조각을 목표 비율에 맞춰 따로 줄인다
    L = px0 - bx0
    R = bx1 - px1
    T = py0 - fy0
    B = fy1 - py1
    src = {
        "left": L, "right": R, "top": T, "bottom": B,
        "midw": (bx1 - bx0) - L - R, "midh": (fy1 - fy0) - T - B,
    }
    dst = {
        "left": round(CARD_W * SLICE["left"]), "right": round(CARD_W * SLICE["right"]),
        "top": round(CARD_H * SLICE["top"]), "bottom": round(CARD_H * SLICE["bottom"]),
    }
    dst["midw"] = CARD_W - dst["left"] - dst["right"]
    dst["midh"] = CARD_H - dst["top"] - dst["bottom"]

    xs_src = [0, src["left"], src["left"] + src["midw"], board.width]
    ys_src = [0, src["top"], src["top"] + src["midh"], board.height]
    xs_dst = [0, dst["left"], dst["left"] + dst["midw"], CARD_W]
    ys_dst = [0, dst["top"], dst["top"] + dst["midh"], CARD_H]

    out = Image.new("RGBA", (CARD_W, CARD_H))
    for r in range(3):
        for c in range(3):
            piece = board.crop((xs_src[c], ys_src[r], xs_src[c + 1], ys_src[r + 1]))
            size = (xs_dst[c + 1] - xs_dst[c], ys_dst[r + 1] - ys_dst[r])
            out.paste(piece.resize(size, Image.LANCZOS), (xs_dst[c], ys_dst[r]))
    return out


def fade_map(im: Image.Image, desat: float, fade: float) -> Image.Image:
    """지도를 배경으로 눌러 굽는다 — 채도를 빼고 종이색으로 밀어 올린다."""
    rgb = np.array(im.convert("RGB")).astype(float)
    gray = rgb @ np.array([0.299, 0.587, 0.114])          # 눈이 느끼는 밝기
    out = rgb * (1 - desat) + gray[:, :, None] * desat
    out = out * (1 - fade) + np.array(MAP_PAPER, dtype=float) * fade
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def feather(im: Image.Image, pad: float = 0.22) -> Image.Image:
    """좌우 가장자리를 부드럽게 지운다 — 이어 붙인 자리가 보이지 않도록."""
    a = np.array(im.convert("RGBA"))
    w = a.shape[1]
    ramp = np.ones(w)
    n = max(1, int(w * pad))
    ramp[:n] = np.linspace(0, 1, n) ** 1.5
    ramp[-n:] = np.linspace(1, 0, n) ** 1.5
    a[:, :, 3] = (a[:, :, 3] * ramp[None, :]).astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def build_backdrop(person: Image.Image) -> Image.Image:
    """액자 바깥의 산수를 오려 먼 산처럼 흩어 놓는다."""
    out = Image.new("RGBA", (BACKDROP_W, BACKDROP_H), BG + (255,))
    for idx, cx, hs, flip in LAYOUT:
        part = person.crop(SCENERY[idx])
        if flip:
            part = part.transpose(Image.FLIP_LEFT_RIGHT)
        h = int(BACKDROP_H * hs)
        part = part.resize((max(1, round(part.width * h / part.height)), h), Image.LANCZOS)
        part = feather(part).filter(ImageFilter.GaussianBlur(0.6))
        # 뒤로 물러나 있어야 한다 — 카드가 그 앞에 서는 그림이라 진하면 글자와 다툰다
        a = np.array(part)
        a[:, :, 3] = (a[:, :, 3] * 0.62).astype(np.uint8)
        out.alpha_composite(Image.fromarray(a, "RGBA"),
                            (int(BACKDROP_W * cx) - part.width // 2, BACKDROP_H - part.height))
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
    ap.add_argument("--sheet", help="눈으로 볼 대조 시트를 이 경로에 쓴다")
    # 지도의 세기는 눈으로 정하는 값이라 손잡이를 밖으로 뺀다 (`--force`와 함께 쓴다)
    ap.add_argument("--map-desat", type=float, default=MAP_DESATURATE, dest="map_desat",
                    help="지도 채도를 빼는 정도 (0~1)")
    ap.add_argument("--map-fade", type=float, default=MAP_FADE, dest="map_fade",
                    help="지도를 종이색으로 미는 정도 (0~1)")
    args = ap.parse_args()

    if not SRC.is_dir():
        print(f"{SRC} 가 없어 건너뛴다 — 그림 없이도 빌드는 정상이다")
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    made: list[str] = []

    chessmap = SRC / "chessmap.png"
    if chessmap.is_file():
        dst = OUT / "chessmap.png"
        if args.force or not dst.exists() or dst.stat().st_mtime < chessmap.st_mtime:
            # 자르거나 맞출 것은 없다 — 판 전체를 덮는 한 장이다. **눌러서** 굽는 것만 한다.
            fade_map(load(chessmap), args.map_desat, args.map_fade).save(dst)
            made.append(f"chessmap(채도 −{args.map_desat:.0%} · 종이 +{args.map_fade:.0%})")
    else:
        print(f"  ! {chessmap.name} 이 없다")

    person = SRC / "person.png"
    if person.is_file():
        im = load(person)
        frame_dst = OUT / "card-frame.png"
        if args.force or not frame_dst.exists() or frame_dst.stat().st_mtime < person.stat().st_mtime:
            build_card_frame(im).save(frame_dst)
            made.append("card-frame")
        back_dst = OUT / "backdrop.png"
        if args.force or not back_dst.exists() or back_dst.stat().st_mtime < person.stat().st_mtime:
            build_backdrop(im).convert("RGB").save(back_dst)
            made.append("backdrop")
    else:
        print(f"  ! {person.name} 이 없다")

    print(f"출력 → {OUT}")
    print(f"  구운 것: {' '.join(made) if made else '없음 (이미 최신)'}")
    pct = lambda k: f"{SLICE[k] * 100:g}%"                     # noqa: E731
    print("  9분할 — style.css 의 .uc-frame 이 이 값을 그대로 적는다:")
    print(f"    border-image-slice: {pct('top')} {pct('right')} {pct('bottom')} {pct('left')} fill;")

    if args.sheet:
        frame = load(OUT / "card-frame.png")
        sheet = Image.new("RGBA", (frame.width * 2, frame.height), (30, 32, 36, 255))
        sheet.alpha_composite(frame, (0, 0))
        # 종이 자리에 색을 칠해 9분할이 맞는지 눈으로 본다
        mark = Image.new("RGBA", (
            round(frame.width * (1 - SLICE["left"] - SLICE["right"])),
            round(frame.height * (1 - SLICE["top"] - SLICE["bottom"]))), (255, 0, 0, 90))
        shifted = frame.copy()
        shifted.alpha_composite(mark, (round(frame.width * SLICE["left"]), round(frame.height * SLICE["top"])))
        sheet.alpha_composite(shifted, (frame.width, 0))
        sheet.save(args.sheet)
        print(f"  대조 시트 → {args.sheet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
