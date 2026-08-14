#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""map/ 의 지형 그림을 웹용으로 굽는다.

    python tools/build_terrain.py [--size 128] [--force] [--sheet 대조.png]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/map/지형_불.png` 256² | `public/terrain/fire.png` 128² | **화계** 칸 |
| `assets/map/지형_물.png` 256² | `public/terrain/water.png` 128² | **수계** 칸 (진입 불가) |
| `assets/map/지형_성채.png` 256² | `public/terrain/holy.png` 128² | **성지** 칸 (손권 「수성지주」) |

────────────────────────────────────────────────────────────────
파일 이름이 여기서 한글에서 지형 id로 바뀐다
────────────────────────────────────────────────────────────────

원본은 기획자가 읽을 이름(`지형_물`)이고, 출력은 엔진의 `TerrainId`(`water`)다.
URL에 한글을 넣으면 서버·CDN마다 인코딩이 갈리기도 하고, 화면 쪽
(`client/src/battle/terrain.ts`)이 지형 id 하나로 경로를 만들 수 있어야 한다.

**그래서 이 표가 두 이름을 잇는 유일한 자리다.** 화면은 `terrain/{id}.png`라는
규약만 알고, 기획자는 한글 파일명만 알면 된다.

────────────────────────────────────────────────────────────────
왜 그냥 복사하지 않는가
────────────────────────────────────────────────────────────────

`build_status_fx.py`와 같은 이유다 — **화면에서 차지하는 크기를 맞춰야 한다.**
캔버스는 셋 다 256²인데 그림이 그 안에서 차지하는 넓이가 다르다(불 39% ·
성채 60%). 그대로 쓰면 같은 크기로 지정해도 불만 작아 보인다.
알파 경계상자로 잘라 정사각으로 채운 뒤 한 크기로 줄인다.

**키우지는 않는다.** 셀은 96×120이고 포커스 배율이 300%라 화면에서 최대
~110px가 된다. 128이면 그 언저리라 확대해도 뭉개지지 않는다.
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
SRC = ROOT / "assets" / "map"
OUT = ROOT / "packages" / "client" / "public" / "terrain"

TERRAIN = {
    "지형_불": "fire",
    "지형_물": "water",
    "지형_성채": "holy",
}
"""원본 파일명(한글) → 엔진의 `TerrainId`.

엔진에 있는 지형은 이 셋뿐이다(`rules/types.ts`의 `TerrainId`). `지형_돌`처럼
표에 없는 그림은 **이름을 찍어 알리고** 건너뛴다 — 조용히 빠지면 「붙인 줄
알았는데 안 나온다」가 된다.
"""

DEFAULT_SIZE = 128
"""출력 한 변(px). 위 「왜 그냥 복사하지 않는가」 참조."""

ALPHA_FLOOR = 8
"""경계상자를 잡을 때 무시할 알파. 그림자와 번짐이 1~2로 깔려 있다."""


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
    """경계상자로 자르고 가운데 정렬한 정사각형으로 채운다."""
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
    """줄이기만 한다. `RGBa`(프리멀티플라이)를 거치는 이유는 `build_status_fx.py`와 같다 —
    투명 픽셀의 검정이 반투명 가장자리로 번지면 그림에 검은 테가 생긴다."""
    if im.width <= size:
        return im
    return im.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")


def build(path: Path, size: int) -> Image.Image:
    rgba = load(path)
    return resize(square(rgba, bbox(rgba[:, :, 3])), size)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=DEFAULT_SIZE, help="출력 한 변(px)")
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
    ap.add_argument("--sheet", help="눈으로 볼 대조 시트를 이 경로에 쓴다")
    args = ap.parse_args()

    if not SRC.is_dir():
        # 에셋은 리포에 없다(기획자 방침). 없으면 조용히 넘어간다 — 초상화·시각효과와 같다.
        print(f"{SRC} 가 없어 건너뛴다 — 그림 없이도 빌드는 정상이다")
        return 0

    found = {unicodedata.normalize("NFC", p.stem): p for p in SRC.glob("*.png")}
    OUT.mkdir(parents=True, exist_ok=True)

    made: list[tuple[str, Image.Image]] = []
    skipped = 0
    missing: list[str] = []

    for stem, terrain in TERRAIN.items():
        path = found.get(stem)
        if path is None:
            missing.append(f"{stem}.png ({terrain})")
            continue
        dst = OUT / f"{terrain}.png"
        if dst.exists() and not args.force and dst.stat().st_mtime >= path.stat().st_mtime:
            skipped += 1
            continue
        im = build(path, args.size)
        im.save(dst)
        made.append((terrain, im))

    print(f"출력 → {OUT}")
    print(f"  지형 {len(made)}종" + (f" (그대로 둔 것 {skipped}종)" if skipped else ""))
    if made:
        print(f"  구운 것: {' '.join(t for t, _ in made)}")
    if missing:
        # 빠진 것은 실패가 아니다(에셋이 리포에 없다). 다만 **이름을 찍어** 알린다 —
        # 화면에서는 그 지형만 그림 없이 지나가고, 그것을 눈으로 알아채기 어렵다.
        print(f"  ! 못 찾은 원본: {' · '.join(missing)}")

    # 표에 없는 그림도 알린다. 「연결한 줄 알았는데 엔진에 그 지형이 없다」를 막는다.
    extra = sorted(set(found) - set(TERRAIN))
    if extra:
        print(f"  · 표에 없어 건너뛴 그림: {' '.join(extra)}"
              " — 엔진의 TerrainId 는 fire/water/holy 셋뿐이다")

    if args.sheet and made:
        cols = max(im.width for _, im in made)
        sheet = Image.new("RGBA", (cols, sum(im.height for _, im in made)), (24, 26, 30, 255))
        y = 0
        for _, im in made:
            sheet.alpha_composite(im, (0, y))
            y += im.height
        sheet.save(args.sheet)
        print(f"  대조 시트 → {args.sheet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
