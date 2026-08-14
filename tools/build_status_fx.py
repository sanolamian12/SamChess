#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SpecialStatus/ 의 시각 효과 그림을 웹용으로 굽는다.

    python tools/build_status_fx.py [--size 256] [--force] [--sheet 대조.png]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/SpecialStatus/{1..23}.png` 258² (`6`·`9`·`23`만 ~312²) | `public/vfx/{n}.png` 256² | **캐릭터 뒤에 깔리는 지속형 링** |
| `assets/SpecialStatus/{A..G}.png` 550² (2×2) | `public/vfx/{A}.png` 1024×256 (4칸) | **판 한가운데 일회성 애니메이션** |

「오라」라고 부르지 않는다 — 엔진의 `aurasOn()`(반경 효과)과 다른 것이라
기획자와 `visualEffect`로 부르기로 했다 (2026-08-13). 매핑표는
`tools/extract_data.py` 의 `STATUS_FX_*` 이고, 여기서는 **그림만** 굽는다.

────────────────────────────────────────────────────────────────
왜 그냥 복사하지 않는가
────────────────────────────────────────────────────────────────

**크기를 맞춰야 한다.** 원본이 258²과 ~312²로 섞여 있어서 그대로 쓰면 같은
자리에 뜨는 링인데 어떤 것은 크고 어떤 것은 작다. 게다가 링마다 여백이 달라
캔버스 크기만 맞춰서는 화면에서의 크기가 여전히 어긋난다.

그래서 **알파 경계상자로 잘라 내고 정사각으로 채운 뒤 한 크기로 줄인다.**
잘라 낸 뒤에 맞추므로 「그림이 실제로 차지하는 지름」이 30장 모두 같아진다.

**알파벳은 2×2를 가로 4칸으로 편다.** 순서는 기획자 지정 —
좌상 → 우상 → 우하 → 좌하(시계방향)이다. 가로로 이어 붙이는 이유는 액션
시트와 같다: 요청이 하나로 끝나고, 화면은 `background-position`만 옮기면 된다.

4칸은 **공통 경계상자**로 자른다. 칸마다 따로 자르면 밝기가 차오르는 동안
링이 커졌다 작아졌다 하며 흔들린다 — 실제로 `A.png`가 프레임마다 번지는
범위가 달라 그렇게 된다.

────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import argparse
import sys
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
SRC = ROOT / "assets" / "SpecialStatus"
OUT = ROOT / "packages" / "client" / "public" / "vfx"

DEFAULT_SIZE = 256
"""출력 한 칸의 한 변(px).

보드 셀은 96×120이고 포커스 배율이 300%라 화면에서 최대 ~290px가 된다.
256이면 그 언저리라 확대해도 뭉개지지 않고, 원본(258²·275²)을 **키우지 않는다** —
없는 해상도를 만들어 내면 가장자리만 흐려진다.
"""

FRAMES = 4
"""알파벳 한 장이 품은 칸 수. 2×2를 시계방향으로 편다."""

# 2×2에서 칸을 꺼내는 순서 — (행, 열). 좌상 → 우상 → 우하 → 좌하
CLOCKWISE = [(0, 0), (0, 1), (1, 1), (1, 0)]

ALPHA_FLOOR = 8
"""경계상자를 잡을 때 무시할 알파. 그림자와 번짐이 1~2로 깔려 있어
0 초과로 잡으면 경계상자가 캔버스 전체가 되어 자르는 의미가 없다."""


def load(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.array(im.convert("RGBA"))


def bbox(alpha: np.ndarray) -> tuple[int, int, int, int]:
    """`(top, left, bottom, right)` — 알파가 있는 최소 사각형. 끝은 배타적이다."""
    rows = np.where(alpha.max(axis=1) > ALPHA_FLOOR)[0]
    cols = np.where(alpha.max(axis=0) > ALPHA_FLOOR)[0]
    if rows.size == 0 or cols.size == 0:
        return 0, 0, alpha.shape[0], alpha.shape[1]
    return int(rows[0]), int(cols[0]), int(rows[-1]) + 1, int(cols[-1]) + 1


def square(rgba: np.ndarray, box: tuple[int, int, int, int]) -> Image.Image:
    """경계상자로 자르고 **가운데 정렬한 정사각형**으로 채운다.

    링이 완전한 원이 아니라 세로·가로가 조금 다른 것들이 있다. 정사각으로
    맞춰 두면 화면에서 한 변만 지정해도 30장이 같은 크기로 뜬다.
    """
    top, left, bottom, right = box
    crop = rgba[top:bottom, left:right]
    h, w = crop.shape[:2]
    side = max(h, w)
    canvas = np.zeros((side, side, 4), dtype=np.uint8)
    y = (side - h) // 2
    x = (side - w) // 2
    canvas[y:y + h, x:x + w] = crop
    return Image.fromarray(canvas, "RGBA")


def resize(im: Image.Image, size: int) -> Image.Image:
    """줄이기만 한다. 원본이 이미 작으면 그대로 둔다.

    `RGBa`(프리멀티플라이)를 거치는 이유 — 투명한 픽셀의 RGB는 보통 검정인데,
    곧바로 줄이면 그 검정이 반투명 가장자리로 번져 링에 검은 테가 생긴다.
    """
    if im.width <= size:
        return im
    return im.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")


def build_ring(path: Path, size: int) -> Image.Image:
    """숫자 파일 — 지속형 링 한 장."""
    rgba = load(path)
    return resize(square(rgba, bbox(rgba[:, :, 3])), size)


def build_strip(path: Path, size: int) -> Image.Image:
    """알파벳 파일 — 2×2를 가로 4칸으로 편다."""
    rgba = load(path)
    h, w = rgba.shape[:2]
    # 크기를 상수로 박지 않는다. 550²이 아닌 것이 들어와도 반으로 나뉜다.
    my, mx = h // 2, w // 2
    tiles = [rgba[r * my:(r + 1) * my, c * mx:(c + 1) * mx] for r, c in CLOCKWISE]

    # **공통 경계상자.** 칸마다 따로 자르면 밝기가 차오르는 동안 링이 흔들린다.
    boxes = [bbox(t[:, :, 3]) for t in tiles]
    box = (min(b[0] for b in boxes), min(b[1] for b in boxes),
           max(b[2] for b in boxes), max(b[3] for b in boxes))

    strip = Image.new("RGBA", (size * FRAMES, size))
    for i, tile in enumerate(tiles):
        strip.paste(resize(square(tile, box), size), (i * size, 0))
    return strip


def sort_key(stem: str) -> tuple[int, int, str]:
    """숫자가 먼저, 그 안에서는 수의 크기 순. 그다음 알파벳."""
    return (0, int(stem), "") if stem.isdigit() else (1, 0, stem)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=DEFAULT_SIZE, help="출력 한 칸의 한 변(px)")
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
    ap.add_argument("--only", help="이 파일 하나만 (예: A, 14)")
    ap.add_argument("--sheet", help="눈으로 볼 대조 시트를 이 경로에 쓴다")
    args = ap.parse_args()

    if not SRC.is_dir():
        # 에셋은 리포에 없다(기획자 방침). 없으면 조용히 넘어간다 — 초상화와 같다.
        print(f"{SRC} 가 없어 건너뛴다 — 그림 없이도 빌드는 정상이다")
        return 0

    files = sorted((p for p in SRC.glob("*.png")),
                   key=lambda p: sort_key(unicodedata.normalize("NFC", p.stem)))
    if not files:
        print(f"{SRC} 가 비어 있다")
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    made: list[Image.Image] = []
    names: list[str] = []
    skipped = 0

    for path in files:
        stem = unicodedata.normalize("NFC", path.stem)
        if args.only and stem != args.only:
            continue
        dst = OUT / f"{stem}.png"
        if dst.exists() and not args.force and dst.stat().st_mtime >= path.stat().st_mtime:
            skipped += 1
            continue
        im = build_ring(path, args.size) if stem.isdigit() else build_strip(path, args.size)
        im.save(dst)
        made.append(im)
        names.append(stem)

    rings = sum(1 for n in names if n.isdigit())
    print(f"출력 → {OUT}")
    print(f"  지속형 링 {rings}장 · 일회성 4칸 시트 {len(names) - rings}장"
          + (f" (그대로 둔 것 {skipped}장)" if skipped else ""))
    if names:
        print(f"  구운 것: {' '.join(names)}")

    if args.sheet and made:
        # 눈으로 볼 대조 시트 — 링은 한 칸, 시트는 네 칸을 차지한다
        cols = max(im.width for im in made)
        sheet = Image.new("RGBA", (cols, sum(im.height for im in made)), (24, 26, 30, 255))
        y = 0
        for im in made:
            sheet.alpha_composite(im, (0, y))
            y += im.height
        sheet.save(args.sheet)
        print(f"  대조 시트 → {args.sheet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
