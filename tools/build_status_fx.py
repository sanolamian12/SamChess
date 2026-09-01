#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SpecialStatus/ 의 시각 효과 그림을 웹용으로 굽는다.

    python tools/build_status_fx.py [--size 256] [--force] [--sheet 대조.png]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/SpecialStatus/{1..23}.png` 258² (`6`·`9`·`23`만 ~312²) | `public/vfx/{n}.png` 256² | **캐릭터 뒤에 깔리는 지속형 링** |
| `assets/SpecialStatus/{A..G}.png` 550² (2×2) | `public/vfx/{A}.png` 1024×256 (4칸) | **판 한가운데 일회성 애니메이션** |
| `assets/SpecialStatus/{n}-new.jpg` 2048² (2×2), 검정 배경 가산광 | `public/vfx/{n}.png` 1024×256 (4칸) | **캐릭터 뒤에서 도는 지속형 애니메이션** (2026-09-01 「불꽃」류 시범) |

「오라」라고 부르지 않는다 — 엔진의 `aurasOn()`(반경 효과)과 다른 것이라
기획자와 `visualEffect`로 부르기로 했다 (2026-08-13). 매핑표는
`tools/extract_data.py` 의 `STATUS_FX_*` 이고, 여기서는 **그림만** 굽는다.

────────────────────────────────────────────────────────────────
`{n}-new` — 지속형 링도 애니메이션이 될 수 있다
────────────────────────────────────────────────────────────────

기획자가 몇몇 링을 「정지 이미지 1장」 대신 「2×2를 시계방향으로 도는 4칸
애니메이션」으로 바꿔 보는 시범이다. 대상 상태 번호에 `-new` 접미사를 붙인
파일(`4-new.jpg`)을 놓으면, 같은 번호의 기존 `4.png`(정지 이미지) 대신 이
파일로 `public/vfx/4.png`를 **굽는다** — 원본 `4.png`는 지우지 않고 그대로
둬도 된다(대조용으로 남겨 두면 된다).

**알파 채널이 없다.** 원본이 검정 배경 위에 그려진 불꽃 같은 가산(additive)
그림이라 JPEG로 저장하면서 투명도가 아예 없다. `tools/strip_reveal_bg.py`의
`strip_black_bg`와 같은 공식으로 만든다 — `alpha = max(R,G,B)`로 밝기를
투명도로 삼고, 색은 그 알파로 나눠 되살린다(비-예비승산 복원). 그러지 않고
그대로 합성하면 검정이 우중충한 회색 테두리로 남는다.

그 뒤로는 알파벳과 같은 자르기(공통 경계상자·정사각·시계방향 4칸 펴기)를
그대로 탄다 — 검정이 알파 0이 되었으니 `bbox()`가 똑같이 통한다.

화면(`packages/client/src/battle/BattleScene.ts`)은 이 파일이 애니메이션인지
아닌지를 **따로 표로 두지 않는다** — 구운 그림의 폭이 높이의 4배인가로 스스로
판별한다. 그래서 이 도구가 굽는 순간 화면도 저절로 따라온다.

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

NEW_SUFFIX = "-new"
"""이 접미사가 붙은 숫자 파일은 같은 번호의 정지 이미지를 대신해 애니메이션으로
굽는다. `4-new.jpg` → `public/vfx/4.png`. 위 모듈 설명 참조."""


def load(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.array(im.convert("RGBA"))


def load_screen_alpha(path: Path) -> np.ndarray:
    """검정 배경 위 가산(additive) 그림에서 알파를 뽑는다 (`-new` 소스 전용).

    `tools/strip_reveal_bg.py`의 `strip_black_bg`와 같은 공식 — 원본에 알파
    채널이 없으므로(JPEG) 밝기를 투명도로 삼는다: `alpha = max(R,G,B)`.
    그 알파로 색을 나눠 되살리지 않으면(비-예비승산 복원) 가장자리가 검정과
    섞여 우중충한 회색 테로 남는다.
    """
    with Image.open(path) as im:
        arr = np.array(im.convert("RGB")).astype(np.float32)
    alpha = arr.max(axis=2)
    safe = np.clip(alpha, 1, 255)
    rgb = np.clip(arr / safe[..., None] * 255.0, 0, 255)
    rgb = np.where(alpha[..., None] > 0, rgb, 0)
    return np.dstack([rgb, alpha]).astype(np.uint8)


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


def build_strip(path: Path, size: int, screen_alpha: bool = False) -> Image.Image:
    """알파벳 파일, 또는 `-new` 숫자 파일 — 2×2를 가로 4칸으로 편다.

    `screen_alpha`는 `-new` 소스에서만 켠다 — 알파 채널이 없어
    `load_screen_alpha()`로 먼저 만들어야 한다.
    """
    rgba = load_screen_alpha(path) if screen_alpha else load(path)
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

    # `-new`(애니메이션 시범)는 원본이 JPEG라 `*.png`만 훑으면 빠진다.
    files = sorted((p for p in list(SRC.glob("*.png")) + list(SRC.glob("*.jpg"))),
                   key=lambda p: sort_key(unicodedata.normalize("NFC", p.stem)))
    if not files:
        print(f"{SRC} 가 비어 있다")
        return 0

    # 번호 하나에 원본이 둘일 수 있다(`4.png` 정지 + `4-new.jpg` 애니메이션) —
    # **`-new`가 이긴다.** 먼저 일반본으로 채우고 `-new`로 덮어써서, 어느 순서로
    # 훑히든 결과가 같게 한다.
    chosen: dict[str, Path] = {}
    for path in files:
        stem = unicodedata.normalize("NFC", path.stem)
        if not stem.endswith(NEW_SUFFIX):
            chosen[stem] = path
    for path in files:
        stem = unicodedata.normalize("NFC", path.stem)
        if stem.endswith(NEW_SUFFIX):
            chosen[stem[: -len(NEW_SUFFIX)]] = path

    OUT.mkdir(parents=True, exist_ok=True)
    made: list[Image.Image] = []
    names: list[str] = []
    skipped = 0

    for target in sorted(chosen, key=sort_key):
        path = chosen[target]
        if args.only and target != args.only:
            continue
        dst = OUT / f"{target}.png"
        if dst.exists() and not args.force and dst.stat().st_mtime >= path.stat().st_mtime:
            skipped += 1
            continue
        is_new = unicodedata.normalize("NFC", path.stem).endswith(NEW_SUFFIX)
        if target.isdigit() and not is_new:
            im = build_ring(path, args.size)
        else:
            im = build_strip(path, args.size, screen_alpha=is_new)
        im.save(dst)
        made.append(im)
        names.append(target)

    # 정지 이미지는 정사각, 띠는 가로가 4배다 — 이름의 숫자 여부로는 더 이상 안 갈린다
    # (`-new` 숫자 파일도 띠로 굽는다).
    rings = sum(1 for im in made if im.width == im.height)
    print(f"출력 → {OUT}")
    print(f"  정지 링 {rings}장 · 4칸 띠 {len(made) - rings}장"
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
