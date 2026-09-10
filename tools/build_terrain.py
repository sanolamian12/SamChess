#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""map/ 의 지형 그림을 웹용으로 굽는다.

    python tools/build_terrain.py [--size 128] [--force] [--sheet 대조.png]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/map/지형_불.png` 256² | `public/terrain/fire.png` 128² | **화계** 칸 |
| `assets/map/지형_물.png` 256² | `public/terrain/water.png` 128² | **수계** 칸 (진입 불가) |
| `assets/map/지형_성채.png` 256² | `public/terrain/holy.png` 128² | **성지** 홑칸 (옛 판·개발용 통로) |
| `assets/icons/성채_*.png` 234² | `public/terrain/fort/*.png` 234² | **성채** 3×3 아홉 조각 (손권 「수성지주」) |

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

# ────────────────────────────────────────────────────────────────
# 성채 — 성지 아홉 칸을 한 채로 그린다 (2026-09-10)
# ────────────────────────────────────────────────────────────────
#
# 손권 「수성지주」가 3×3으로 커지면서 성지 한 칸짜리 그림(`지형_성채.png`)만으로는
# 성이 아홉 채가 된다. 기획자가 **조각 세 종**을 그렸다 — 가운데 성 · 성벽 · 모서리.
# 나머지 여섯 칸은 그 셋을 90°씩 돌린 것이라, **여기서 미리 돌려 굽는다.**
#
# 왜 화면에서 안 돌리는가 — 칸이 96×120(정사각이 아니다)이라, 스프라이트를 돌린
# 채로 크기를 잡으면 가로·세로가 뒤바뀌어 성벽 두께가 방위마다 달라진다. 미리
# 돌려 두면 화면은 어느 조각이든 똑같이 「칸에 꽉 채워라」 하나만 알면 된다.
#
# **원본은 `assets/map/`이 아니라 `assets/icons/`에 있다** — 기획자가 거기 두었고,
# `build_blacksmith.py`의 명패와 같은 전례다. 옮기지 않고 여기서 가리킨다.
#
# **키우지도 줄이지도 않는다.** 원본 234²는 셀(96×120)을 300% 포커스로 본
# ~360px에 못 미치지만 있는 것보다 크게 만들 수는 없다.
FORT_SRC = ROOT / "assets" / "icons"
FORT_OUT = OUT / "fort"

FORT_BASE = {
    "keep-p1": "성채_남군_1",
    "keep-p2": "성채_북군_1",
    "e-p1": "성채_남군_2",
    "e-p2": "성채_북군_2",
    "se": "성채_3",
}
"""**돌리지 않은** 조각 → 원본 파일명(한글).

기울기의 기준을 여기서 못 박는다: 성벽 원본(`_2`)은 **동쪽**(중심의 오른쪽 칸),
모서리 원본(`성채_3`)은 **남동쪽**(오른쪽 아래 칸)이다.

모서리가 남동쪽이라는 것은 **그림에서 잰 값**이다 — 알파를 사분면으로 나누면
왼쪽 위가 **정확히 0픽셀**이고 아래·오른쪽 변이 꽉 차 있다. 즉 성벽이 아래와
오른쪽 바깥을 두르는 조각이라 오른쪽 아래 칸의 것이다. 기획자가 준 배치도와
조립해 대조한 결과도 같다.

모서리는 회색 돌뿐이라 **진영 색이 없다** — 한 벌만 굽는다.
"""

FORT_TURNS = {
    "e-p1": [("s-p1", 90), ("w-p1", 180), ("n-p1", 270)],
    "e-p2": [("s-p2", 90), ("w-p2", 180), ("n-p2", 270)],
    "se": [("sw", 90), ("nw", 180), ("ne", 270)],
}
"""기준 조각 → 그것을 **시계 방향으로** 돌려 얻는 조각들. 각도는 90의 배수뿐이다.

기획자가 말하는 순서 그대로다 — 성벽은 `우 0 · 하 90 · 좌 180 · 상 270`,
모서리는 `우하 0 · 좌하 90 · 좌상 180 · 우상 270`. 시계·반시계를 헷갈리면
모서리 두 개가 서로 바뀌어 **성벽이 안 이어진다**(그래도 아홉 칸은 다 그려져서
「빠진 것은 없는데 어딘가 이상한」 그림이 된다).

방위 이름은 화면 쪽(`client/src/battle/terrain.ts`의 `FortPiece`)과 같은 말이다 —
`n`은 중심의 북쪽 칸, 즉 판에서 한 칸 위다.
"""

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


def build_fort(force: bool) -> tuple[list[str], int, list[str]]:
    """성채 조각을 굽는다. `(구운 것, 그대로 둔 것, 못 찾은 원본)`.

    자르지도 늘리지도 않는다 — 조각들이 **서로 맞물려야** 하는데 조각마다
    제 알파 경계상자로 자르면 그 맞물림이 깨진다(성벽 원본은 캔버스 오른쪽에
    치우쳐 있고 모서리 원본은 왼쪽 위에 치우쳐 있다). 기획자가 같은 234²
    캔버스 위에 자리까지 맞춰 그린 것이라 **캔버스째** 쓴다.
    """
    if not FORT_SRC.is_dir():
        return [], 0, []

    found = {unicodedata.normalize("NFC", p.stem): p for p in FORT_SRC.glob("*.png")}
    made: list[str] = []
    skipped = 0
    missing: list[str] = []
    FORT_OUT.mkdir(parents=True, exist_ok=True)

    for name, stem in FORT_BASE.items():
        path = found.get(stem)
        if path is None:
            missing.append(f"{stem}.png ({name})")
            continue
        wanted = [(name, 0), *FORT_TURNS.get(name, [])]
        stale = [w for w in wanted
                 if force or not (FORT_OUT / f"{w[0]}.png").exists()
                 or (FORT_OUT / f"{w[0]}.png").stat().st_mtime < path.stat().st_mtime]
        skipped += len(wanted) - len(stale)
        if not stale:
            continue
        with Image.open(path) as im:
            base = im.convert("RGBA")
        for out_name, deg in stale:
            # `deg`는 **시계 방향**이고 PIL의 `rotate()`는 반시계라 부호를 뒤집는다.
            turned = base if deg == 0 else base.rotate(-deg, expand=True)
            turned.save(FORT_OUT / f"{out_name}.png")
            made.append(out_name)
    return made, skipped, missing


def report_fort(made: list[str], skipped: int, missing: list[str]) -> None:
    if not (made or skipped or missing):
        print(f"  성채 조각 — {FORT_SRC} 가 없어 건너뛴다")
        return
    print(f"  성채 조각 {len(made)}장" + (f" (그대로 둔 것 {skipped}장)" if skipped else ""))
    if made:
        print(f"  구운 것: {' '.join(sorted(made))}")
    if missing:
        # 빠진 것은 실패가 아니다 — 다만 **이름을 찍어** 알린다. 조각 하나가
        # 빠지면 성채에 구멍이 뚫린 채로 뜬다.
        print(f"  ! 못 찾은 성채 원본: {' · '.join(missing)}")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=DEFAULT_SIZE, help="출력 한 변(px)")
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
    ap.add_argument("--sheet", help="눈으로 볼 대조 시트를 이 경로에 쓴다")
    args = ap.parse_args()

    # 성채 조각을 **먼저** 굽는다 — 원본이 `assets/icons/`라 `assets/map/`이
    # 없어도 나올 수 있다. 아래 조기 반환 뒤에 두면 그 갈래가 통째로 안 돈다.
    fort_made, fort_skipped, fort_missing = build_fort(args.force)

    if not SRC.is_dir():
        # 에셋은 리포에 없다(기획자 방침). 없으면 조용히 넘어간다 — 초상화·시각효과와 같다.
        print(f"{SRC} 가 없어 건너뛴다 — 그림 없이도 빌드는 정상이다")
        report_fort(fort_made, fort_skipped, fort_missing)
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

    report_fort(fort_made, fort_skipped, fort_missing)

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
