#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""market/ 의 상점 그림을 웹용으로 굽는다 (트랙 9 선작업, 2026-08-24).

    python tools/build_market.py [--force] [--sheet 대조.png]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `gold.png` · `grain.png` · `materials.png` 512² | `public/market/{id}.png` 160² | 재화 아이콘 — 화면 전체에서 공용 |
| `gacha-single.png` · `recycle.png` · `respec-scroll.png` 512² | 〃 160² | 상점 버튼 아이콘 (`gacha-single`은 초심의 서) |
| `market_card.png` · `market_carddeck.png` 720² | 〃 160² | 용병 시장 뽑기 방식 판의 단발 · 8연 (2026-09-25, `gacha-*`를 대신한다) |
| `pack-small.png` · `pack-mid.png` · `pack-large.png` 512² | 〃 220² | 골드팩 구매 버튼 — 조금 더 크게 |
| `gacha-banner.jpg` 1600×588 | `public/market/gacha-banner.jpg` 폭 1200 | 옛 가챠 배너 — 아래 셋이 없을 때 물러나는 자리 |
| `market_cards` · `market_items` · `market_materials` (`.jpg`/`.png`) ~1700×624 | `public/market/banner-{merc,items,goods}.jpg` 폭 1200 | 상품 구매의 [용병 시장] · [전투 아이템] · [도시 물자] 배너 (2026-09-24) — **없으면 건너뛴다** |
| `marget-sign.png`(원본 파일명 오타) 800×600 | `public/market/market-sign.png` 폭 480 | 장터 화면 소품(선택) |
| 〃 | `public/market/market-sign-icon.png` 160² | 장터 현황판의 「보유 아이템」 아이콘 (2026-09-25) |

상점 화면(UI) 1차 초안이 붙었다(`MarketScreen.tsx`, 2026-08-24). 이 도구는 여전히
**에셋을 화면이 바로 쓸 수 있는 형태로만** 굽는다 — 골드 차감·카드 지급은
`@samchess/meta`의 `buyGacha()`가 한다.

**걷은 것 (2026-10-24)** — 가챠 개봉 연출 `reveal-*`(2026-09-24부터 `build_burst.py`의 섬광이 대신한다) ·
등급 액자 `frame-*`(장수 카드가 액자를 걷었다) · `gacha-ten`(8연 뽑기는 `market_carddeck`이 대신한다)은
화면이 안 써서 굽기 목록과 `public/market/`에서 뺐다. 원본은 `assets/icons/unused/market/`. 되살릴 때는 그 전 커밋의 이 파일을 본다.

────────────────────────────────────────────────────────────────
아이콘 — `build_terrain.py`와 같은 이유로 그대로 복사하지 않는다
────────────────────────────────────────────────────────────────

원본이 전부 512²이지만 그림이 캔버스 안에서 차지하는 비율이 저마다 달라
(동전은 작게, 자루는 크게) 그대로 축소하면 나란히 놓았을 때 크기가 들쭉날쭉하다.
`build_terrain.py`·`build_status_fx.py`와 같은 방식 — 알파 경계상자로 잘라
정사각으로 채운 뒤 한 크기로 줄인다.

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
SRC = ROOT / "assets" / "icons" / "market"
OUT = ROOT / "packages" / "client" / "public" / "market"

ICON_SIZE = 160
"""재화·버튼 아이콘 한 변(px). 인라인 텍스트 옆에 놓일 크기라 96×120 보드 셀보다 작게 잡았다."""

PACK_SIZE = 220
"""골드팩 3종은 구매 버튼 자체라 아이콘보다 조금 크게 잡았다."""

BANNER_MAX_WIDTH = 1200
SIGN_MAX_WIDTH = 480
ALPHA_FLOOR = 8
"""경계상자를 잡을 때 무시할 알파. 그림자·번짐이 1~2로 깔려 있다."""

# 이름(원본 stem, 확장자 없이) → 출력 크기. 확장자는 전부 .png 그대로.
ICONS: dict[str, int] = {
    "gold": ICON_SIZE,
    "grain": ICON_SIZE,
    "materials": ICON_SIZE,
    "gacha-single": ICON_SIZE,
    "market_card": ICON_SIZE,
    "market_carddeck": ICON_SIZE,
    "recycle": ICON_SIZE,
    "respec-scroll": ICON_SIZE,
    "pack-small": PACK_SIZE,
    "pack-mid": PACK_SIZE,
    "pack-large": PACK_SIZE,
}

# 출력 이름 → (원본 stem, 크기). 같은 원본을 소품(아래 RENAMES)과 아이콘으로 **두 번** 굽는 것 —
# 장터 간판은 현황판의 「보유 아이템」 아이콘으로도 쓴다(2026-09-25 지정). 소품 쪽은 여백째
# 폭만 줄여 글자 옆에 두면 작아 보이므로, 아이콘은 경계상자로 잘라 따로 굽는다.
ICON_ALIASES: dict[str, tuple[str, int]] = {
    "market-sign-icon": ("marget-sign", ICON_SIZE),
}

# 원본 파일명(있는 그대로, 오타 포함) → 출력 파일명. 오타를 여기서만 바로잡는다 —
# 원본을 리네임하면 다음에 같은 폴더에 그림을 보낼 때 또 헷갈린다.
RENAMES: dict[str, str] = {
    "marget-sign": "market-sign",
}

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

    # ── 원본 이름과 다른 이름으로 나가는 아이콘 ──
    for out_stem, (src_stem, size) in ICON_ALIASES.items():
        src = SRC / f"{src_stem}.png"
        if not src.exists():
            missing.append(f"{src_stem}.png ({out_stem})")
            continue
        dst = OUT / f"{out_stem}.png"
        if up_to_date(dst, src):
            skipped += 1
            continue
        im = build_icon(src, size)
        im.save(dst)
        made_icons.append((out_stem, im))

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

    # ── 상품 구매의 배너 셋 (2026-09-24, pptx 76쪽) — 용병 시장 · 전투 아이템 · 도시 물자 ──
    # 세 장을 **같은 화풍으로 한 번에** 받았다(원본 이름 → 화면 이름). 없으면 건너뛰고
    # 화면이 옛 가챠 배너(`gacha-banner.jpg`)로 물러난다(`MarketScreen.tsx`의 `Banner`).
    # 원본은 `.jpg`·`.png` 어느 쪽이든 받고, 판형은 1600×588(≈ 2.72:1) 언저리라야 칸에
    # 맞는다(받은 원본은 1696~1712×624, 2.72~2.74 — `object-fit: cover`가 양끝을 몇 px 자른다).
    for stem, out in (("market_cards", "banner-merc"), ("market_items", "banner-items"),
                      ("market_materials", "banner-goods")):
        src = next((SRC / f"{stem}{ext}" for ext in (".jpg", ".png") if (SRC / f"{stem}{ext}").exists()), None)
        if src is None:
            continue
        dst = OUT / f"{out}.jpg"
        if up_to_date(dst, src):
            skipped += 1
            continue
        with Image.open(src) as im:
            fit_resize(im.convert("RGB"), BANNER_MAX_WIDTH).save(dst, quality=90)
        made_other.append(f"{out}.jpg")

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
