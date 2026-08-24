#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""market/ 의 상점 그림을 웹용으로 굽는다 (트랙 9 선작업, 2026-08-24).

    python tools/build_market.py [--force] [--sheet 대조.png]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `gold.png` · `grain.png` · `materials.png` 512² | `public/market/{id}.png` 160² | 재화 아이콘 — 화면 전체에서 공용 |
| `gacha-single.png` · `gacha-ten.png` · `recycle.png` · `respec-scroll.png` 512² | 〃 160² | 상점 버튼 아이콘 |
| `pack-small.png` · `pack-mid.png` · `pack-large.png` 512² | 〃 220² | 골드팩 구매 버튼 — 조금 더 크게 |
| `gacha-banner.jpg` 1600×588 | `public/market/gacha-banner.jpg` 폭 1200 | 가챠 화면 상단 배너 |
| `marget-sign.png`(원본 파일명 오타) 800×600 | `public/market/market-sign.png` 폭 480 | 장터 화면 소품(선택) |
| `reveal-{s,a,b,e}.png` 1024²(2×2) | `public/market/reveal-{s,a,b,e}.png` 1024×256(4칸) | 가챠 등급별 개봉 연출 |
| `frame-{s,a,b,c,d,e}.png` ~193×195 | `public/market/frame-{S,A,B,C,D,E}.png` 원본 그대로(< 240) | 개봉 카드의 등급별 액자 |

상점 화면(UI) 1차 초안이 붙었다(`MarketScreen.tsx`, 2026-08-24). 이 도구는 여전히
**에셋을 화면이 바로 쓸 수 있는 형태로만** 굽는다 — 골드 차감·카드 지급은
`@samchess/meta`의 `buyGacha()`가 한다.

────────────────────────────────────────────────────────────────
등급 액자 — `reveal-*`와 달리 그대로 리사이즈만 한다
────────────────────────────────────────────────────────────────

`frame-*.png`는 아이콘과 달리 그림이 이미 캔버스 가장자리까지 꽉 차 있고(테두리
자체가 그림이다) 가운데는 원래부터 투명이다 — 경계상자로 자르면 액자 테두리가
잘려 나간다. 그래서 `fit_resize`(비율 유지, 폭만 줄이기)만 적용한다. 파일명의
등급 글자를 **대문자**로 올리는 것은 `data-grade="S"`처럼 이미 대문자로 굳어
있는 코드의 관례(`style.css`의 `--grade-*`)를 따른 것 — 소문자로 두면 화면마다
새로 맞춰 줘야 한다.

────────────────────────────────────────────────────────────────
아이콘 — `build_terrain.py`와 같은 이유로 그대로 복사하지 않는다
────────────────────────────────────────────────────────────────

원본이 전부 512²이지만 그림이 캔버스 안에서 차지하는 비율이 저마다 달라
(동전은 작게, 자루는 크게) 그대로 축소하면 나란히 놓았을 때 크기가 들쭉날쭉하다.
`build_terrain.py`·`build_status_fx.py`와 같은 방식 — 알파 경계상자로 잘라
정사각으로 채운 뒤 한 크기로 줄인다.

────────────────────────────────────────────────────────────────
가챠 개봉 연출 — 칸 순서가 알파벳(`build_status_fx.py`)과 다르다 ★
────────────────────────────────────────────────────────────────

`assets/SpecialStatus/{A..G}.png`의 2×2는 **시계방향**(좌상→우상→우하→좌하)으로
편다. 이번 `reveal-*.png`는 이미지 생성 프롬프트가 "Frame 1: 옅은 빛 → Frame 2:
터짐 → Frame 3: 빛줄기 만개 → Frame 4: 흩날리며 소멸"을 **위→아래, 왼→오 순서
(reading order)**로 그렸다(육안 확인, 좌상=1 우상=2 좌하=3 우하=4) — 시계방향으로
읽으면 3·4번 칸이 뒤바뀐다. 그래서 이 파일만 `READING_ORDER`를 쓴다.

────────────────────────────────────────────────────────────────
`gacha-banner.jpg`·`market-sign.png`은 정사각으로 안 만든다
────────────────────────────────────────────────────────────────

배너·소품은 아이콘이 아니라 **원래 판형 그대로** 화면에 걸릴 그림이라, 비율을
유지한 채 폭만 줄인다(`fit_resize`) — 정사각으로 채우면 화면에 걸 때 다시 잘라야 한다.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
SRC = ROOT / "assets" / "market"
OUT = ROOT / "packages" / "client" / "public" / "market"

ICON_SIZE = 160
"""재화·버튼 아이콘 한 변(px). 인라인 텍스트 옆에 놓일 크기라 96×120 보드 셀보다 작게 잡았다."""

PACK_SIZE = 220
"""골드팩 3종은 구매 버튼 자체라 아이콘보다 조금 크게 잡았다."""

REVEAL_FRAME_SIZE = 256
"""개봉 연출 한 칸(px). `build_status_fx.py`의 일회성 애니메이션과 같은 크기 —
판 한가운데 뜨는 것이라 같은 눈금을 쓴다."""

BANNER_MAX_WIDTH = 1200
SIGN_MAX_WIDTH = 480
FRAME_MAX_WIDTH = 240
"""등급 액자 한 변의 상한(px, 폭 기준). 원본이 이미 ~193px로 이 상한보다 작아서
`fit_resize`(키우지 않는다)를 거쳐도 지금은 원본 크기 그대로 나간다 — 더 큰
원본이 오면 그때부터 실제로 줄어든다."""

ALPHA_FLOOR = 8
"""경계상자를 잡을 때 무시할 알파. 그림자·번짐이 1~2로 깔려 있다."""

# 이름(원본 stem, 확장자 없이) → 출력 크기. 확장자는 전부 .png 그대로.
ICONS: dict[str, int] = {
    "gold": ICON_SIZE,
    "grain": ICON_SIZE,
    "materials": ICON_SIZE,
    "gacha-single": ICON_SIZE,
    "gacha-ten": ICON_SIZE,
    "recycle": ICON_SIZE,
    "respec-scroll": ICON_SIZE,
    "pack-small": PACK_SIZE,
    "pack-mid": PACK_SIZE,
    "pack-large": PACK_SIZE,
}

# 원본 파일명(있는 그대로, 오타 포함) → 출력 파일명. 오타를 여기서만 바로잡는다 —
# 원본을 리네임하면 다음에 같은 폴더에 그림을 보낼 때 또 헷갈린다.
RENAMES: dict[str, str] = {
    "marget-sign": "market-sign",
}

# 2×2에서 칸을 꺼내는 순서 — reading order(좌상→우상→좌하→우하).
# `build_status_fx.py`의 CLOCKWISE와 다르다는 것을 위 docstring이 설명한다.
READING_ORDER = [(0, 0), (0, 1), (1, 0), (1, 1)]

REVEAL_GRADES = ["s", "a", "b", "e"]

# 원본 소문자 → 출력 대문자. 6등급 전부(가챠는 S·A·B·E만 뽑지만, 액자 자체는
# 나중에 다른 화면이 C·D를 쓸 수도 있어 소재를 그대로 다 굽는다).
FRAME_GRADES = ["s", "a", "b", "c", "d", "e"]


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


def resize_square(im: Image.Image, size: int) -> Image.Image:
    """줄이기만 한다. `RGBa`(프리멀티플라이)를 거쳐 반투명 가장자리에 검은 테가
    안 생기게 한다 — `build_terrain.py`·`build_status_fx.py`와 같은 이유."""
    if im.width <= size:
        return im
    return im.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")


def build_icon(path: Path, size: int) -> Image.Image:
    rgba = load(path)
    return resize_square(square(rgba, bbox(rgba[:, :, 3])), size)


def build_reveal_strip(path: Path, size: int) -> Image.Image:
    """2×2를 reading order로 가로 4칸으로 편다. 공통 경계상자를 쓴다 —
    칸마다 따로 자르면 빛이 번지는 동안 크기가 흔들린다(`build_status_fx.py`와 같은 이유)."""
    rgba = load(path)
    h, w = rgba.shape[:2]
    my, mx = h // 2, w // 2
    tiles = [rgba[r * my:(r + 1) * my, c * mx:(c + 1) * mx] for r, c in READING_ORDER]

    boxes = [bbox(t[:, :, 3]) for t in tiles]
    box = (min(b[0] for b in boxes), min(b[1] for b in boxes),
           max(b[2] for b in boxes), max(b[3] for b in boxes))

    strip = Image.new("RGBA", (size * 4, size))
    for i, tile in enumerate(tiles):
        strip.paste(resize_square(square(tile, box), size), (i * size, 0))
    return strip


def fit_resize(im: Image.Image, max_width: int) -> Image.Image:
    """비율을 유지한 채 폭만 줄인다. 키우지는 않는다."""
    if im.width <= max_width:
        return im
    ratio = max_width / im.width
    return im.resize((max_width, round(im.height * ratio)), Image.LANCZOS)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
    ap.add_argument("--sheet", help="눈으로 볼 대조 시트를 이 경로에 쓴다(아이콘류만)")
    args = ap.parse_args()

    if not SRC.is_dir():
        print(f"{SRC} 가 없어 건너뛴다 — 그림 없이도 빌드는 정상이다")
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    made_icons: list[tuple[str, Image.Image]] = []
    made_other: list[str] = []
    skipped = 0
    missing: list[str] = []

    def up_to_date(dst: Path, src: Path) -> bool:
        return dst.exists() and not args.force and dst.stat().st_mtime >= src.stat().st_mtime

    # ── 아이콘류 ──
    for stem, size in ICONS.items():
        src = SRC / f"{stem}.png"
        if not src.exists():
            missing.append(f"{stem}.png")
            continue
        dst = OUT / f"{stem}.png"
        if up_to_date(dst, src):
            skipped += 1
            continue
        im = build_icon(src, size)
        im.save(dst)
        made_icons.append((stem, im))

    # ── 배너 ──
    banner_src = SRC / "gacha-banner.jpg"
    if banner_src.exists():
        dst = OUT / "gacha-banner.jpg"
        if not up_to_date(dst, banner_src):
            with Image.open(banner_src) as im:
                fit_resize(im.convert("RGB"), BANNER_MAX_WIDTH).save(dst, quality=90)
            made_other.append("gacha-banner.jpg")
        else:
            skipped += 1
    else:
        missing.append("gacha-banner.jpg")

    # ── 장터 소품 (파일명 오타를 여기서 바로잡는다) ──
    sign_src = None
    for stem, renamed in RENAMES.items():
        cand = SRC / f"{stem}.png"
        if cand.exists():
            sign_src = cand
            sign_name = renamed
            break
    if sign_src is not None:
        dst = OUT / f"{sign_name}.png"
        if not up_to_date(dst, sign_src):
            rgba = load(sign_src)
            im = Image.fromarray(rgba, "RGBA")
            fit_resize(im, SIGN_MAX_WIDTH).save(dst)
            made_other.append(f"{sign_name}.png (← {sign_src.name})")
        else:
            skipped += 1
    else:
        missing.append("marget-sign.png (market-sign)")

    # ── 가챠 개봉 연출 4종 ──
    for grade in REVEAL_GRADES:
        src = SRC / f"reveal-{grade}.png"
        if not src.exists():
            missing.append(f"reveal-{grade}.png")
            continue
        dst = OUT / f"reveal-{grade}.png"
        if up_to_date(dst, src):
            skipped += 1
            continue
        strip = build_reveal_strip(src, REVEAL_FRAME_SIZE)
        strip.save(dst)
        made_other.append(f"reveal-{grade}.png (4칸 스트립)")

    # ── 등급 액자 6종 ──
    for grade in FRAME_GRADES:
        src = SRC / f"frame-{grade}.png"
        if not src.exists():
            missing.append(f"frame-{grade}.png")
            continue
        out_name = f"frame-{grade.upper()}.png"
        dst = OUT / out_name
        if up_to_date(dst, src):
            skipped += 1
            continue
        with Image.open(src) as im:
            fit_resize(im.convert("RGBA"), FRAME_MAX_WIDTH).save(dst)
        made_other.append(f"{out_name} (← {src.name})")

    print(f"출력 → {OUT}")
    print(f"  아이콘 {len(made_icons)}종 · 그 외 {len(made_other)}종"
          + (f" (그대로 둔 것 {skipped}개)" if skipped else ""))
    if made_icons:
        print(f"  구운 아이콘: {' '.join(n for n, _ in made_icons)}")
    if made_other:
        print(f"  구운 것: {' · '.join(made_other)}")
    if missing:
        print(f"  ! 못 찾은 원본: {' · '.join(missing)}")

    if args.sheet and made_icons:
        cols = max(im.width for _, im in made_icons)
        sheet = Image.new("RGBA", (cols, sum(im.height for _, im in made_icons)), (24, 26, 30, 255))
        y = 0
        for _, im in made_icons:
            sheet.alpha_composite(im, (0, y))
            y += im.height
        sheet.save(args.sheet)
        print(f"  대조 시트 → {args.sheet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
