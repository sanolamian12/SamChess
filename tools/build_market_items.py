#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""assets/icons/market_items.png 의 4×4 시트를 시장 아이템 16장으로 자른다 (2026-09-23).

    python tools/build_market_items.py [--force]

| 원본 | 출력 |
|---|---|
| `assets/icons/market_items.png` (681², 4행 4열 · 투명 배경) | `public/market-items/{id}.png` 16장 |

행이 부류(약·책·말·도구), 열이 해금 레벨(Lv2~Lv5)이다. 어느 칸이 어느 품목인지는
**`packages/data/generated/marketItems.json`(정본)의 `no`가 정한다** — 매핑표를
손으로 한 벌 더 적지 않는다. 추출기가 이미 「번호와 (부류, 레벨)이 맞는가」를
검사하므로(`extract_market_items()`), 여기서는 `no`를 믿고 `(no-1)//4`행
`(no-1)%4`열을 집는다.

★ 등분해 자르지 않는다
-----------------------
681은 4로 나누면 **170.25**다. 등분하면 경계가 칸마다 0.25px씩 밀려 **옆 칸이
딸려 오거나 제 그림이 잘린다** — 배경 띠(`build_backgrounds.py`의 `cut_points()`)가
이미 밟은 자리이고, 화면에서는 「끝에 이상한 줄이 있네」로만 보인다.

대신 **알파가 통째로 비어 있는 홈(gutter)을 찾아** 그 한가운데서 자른다. 실측한
홈은 열 `164~176 · 333~342 · 506~508`, 행 `151~179 · 327~347 · 504~519`로 **등분한
자리(170.25 · 340.5 · 510.75)와 최대 6px 어긋나** 있다.

홈이 정확히 셋이 아니면 **자르지 않고 실패한다** — 그림이 4×4가 아니게 바뀌었거나
두 칸이 붙어 버린 것이고, 조용히 엉뚱하게 자르는 것보다 멈추는 편이 낫다.

★ 키우지 않는다
----------------
한 칸이 잘라 놓고 보면 150px 안팎이라 대장간 품목 사진(693×378 → 폭 480)보다
**훨씬 작다.** `build_sprite()`가 원본보다 키워서 그림이 칸 구석에 붙었던 사고
(2026-09-05)와 같은 자리이므로, 여기서는 **자른 크기 그대로** 내보내고 너무 작으면
경고만 찍는다. 크게 쓰려면 원본 시트를 더 큰 해상도로 다시 받아야 한다.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
SRC = ROOT / "assets" / "icons" / "market_items.png"
OUT = ROOT / "packages" / "client" / "public" / "market-items"
ITEMS_JSON = ROOT / "packages" / "data" / "generated" / "marketItems.json"

COLS = ROWS = 4
# 이보다 얇은 투명 띠는 홈으로 안 본다 — 그림 안의 우연한 빈 줄을 홈으로 세면
# 칸이 다섯 개가 되어 버린다.
MIN_GUTTER = 2
# 알파가 이보다 크면 「그림이 있다」로 본다. 0으로 두면 눈에 안 보이는 1~2 알파가
# 홈을 메워 경계를 못 찾는다.
ALPHA_FLOOR = 8
# 이보다 작은 칸이면 경고 — 대장간 품목 사진(폭 480)과 나란히 서는 그림이다.
SMALL_WARN = 240


def empty_runs(counts: list[int]) -> list[tuple[int, int]]:
    """`counts`가 0인 구간을 [시작, 끝]으로 모은다."""
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for i, n in enumerate(counts):
        if n == 0 and start is None:
            start = i
        elif n != 0 and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(counts) - 1))
    return runs


def cut_points(counts: list[int], want: int, axis: str) -> list[int] | None:
    """
    칸 `want`개로 가르는 자리. **가장자리 여백은 빼고 안쪽 홈만** 센다.

    실패하면 `None`을 돌려주고 왜인지 찍는다 — 등분으로 물러나지 않는다.
    """
    inner = [(a, b) for a, b in empty_runs(counts)
             if a > 0 and b < len(counts) - 1 and b - a + 1 >= MIN_GUTTER]
    if len(inner) != want - 1:
        print(f"  ✗ {axis}: 안쪽 홈이 {len(inner)}개다 (칸 {want}개면 {want - 1}개라야 한다)"
              f" — {inner}")
        return None
    return [(a + b) // 2 + 1 for a, b in inner]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
    args = ap.parse_args()

    if not SRC.exists():
        print(f"{SRC} 가 없어 건너뛴다 — 그림 없이도 빌드는 정상이다")
        return 0
    if not ITEMS_JSON.exists():
        print(f"{ITEMS_JSON} 가 없다 — 먼저 `npm run extract`")
        return 1

    items = json.loads(ITEMS_JSON.read_text(encoding="utf-8"))
    if len(items) != COLS * ROWS:
        print(f"✗ 품목이 {len(items)}종이라 {ROWS}×{COLS} 시트와 안 맞는다")
        return 1

    with Image.open(SRC) as im:
        sheet = im.convert("RGBA")
    alpha = sheet.getchannel("A")
    w, h = sheet.size
    px = alpha.load()
    col_counts = [sum(1 for y in range(h) if px[x, y] > ALPHA_FLOOR) for x in range(w)]
    row_counts = [sum(1 for x in range(w) if px[x, y] > ALPHA_FLOOR) for y in range(h)]

    print(f"원본 {w}×{h} — 등분하면 {w / COLS:g}×{h / ROWS:g}")
    xs = cut_points(col_counts, COLS, "열")
    ys = cut_points(row_counts, ROWS, "행")
    if xs is None or ys is None:
        return 1
    print(f"  자르는 자리 — 열 {xs} · 행 {ys} (등분: "
          f"{[round(w * i / COLS) for i in range(1, COLS)]})")

    bounds_x = [0, *xs, w]
    bounds_y = [0, *ys, h]

    OUT.mkdir(parents=True, exist_ok=True)
    made, skipped, small = [], 0, []
    for item in items:
        idx = item["no"] - 1
        r, c = idx // COLS, idx % COLS
        dst = OUT / f"{item['id']}.png"
        if dst.exists() and not args.force and dst.stat().st_mtime >= SRC.stat().st_mtime:
            skipped += 1
            continue
        cell = sheet.crop((bounds_x[c], bounds_y[r], bounds_x[c + 1], bounds_y[r + 1]))
        # 칸 안의 여백을 마저 턴다 — 칸마다 그림 크기가 달라 여백을 남기면
        # 화면에서 아이콘이 저마다 다른 크기로 보인다.
        if box := cell.getbbox():
            cell = cell.crop(box)
        if not cell.width or not cell.height:
            print(f"  ✗ {item['name']}: 칸이 비었다 ({r}행 {c}열)")
            return 1
        cell.save(dst, optimize=True)
        made.append(f"{item['id']}.png ({cell.width}×{cell.height}, {r}행 {c}열 ← {item['name']})")
        if max(cell.width, cell.height) < SMALL_WARN:
            small.append(f"{item['name']} {cell.width}×{cell.height}")

    for line in made:
        print(f"  · {line}")
    print(f"{len(made)}장 저장 · {skipped}장 건너뜀 → {OUT}")
    if small:
        print(f"\n⚠ 한 변이 {SMALL_WARN}px 미만인 칸 {len(small)}개 — 대장간 품목 사진은 폭 480이다.")
        print("  키우면 흐려지므로 이 도구는 자른 크기 그대로 내보낸다.")
        print("  크게 쓰려면 원본 시트를 더 큰 해상도로 다시 받아야 한다:")
        print("    " + " · ".join(small))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
