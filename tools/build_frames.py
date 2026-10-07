#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""map/ 의 화면 장식 그림을 웹용으로 굽는다 — 체스판 · 도적떼 판 지도와 판 위아래 칸의 산수 배경.

    python tools/build_frames.py [--force]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/map/chessmap.png` 750² | `public/ui/chessmap.png` | **체스판 아래에 깔리는 지도** |
| `raid.json`의 `art.map` | `public/ui/raidmap.jpg` | 도적떼 판 지도 |
| `assets/map/person.png` 1440×2912 | `public/ui/backdrop.png` | 판 위아래 칸(`#top` · `#bottom`) 뒤 산수 배경 |

**카드 액자(`card-frame.png`, 9분할)는 2026-10-07에 걷었다** (전투 UI 개편 8단계, 기획자 확정).
판 위아래의 카드 줄이 순서 판 · 명령 판으로 바뀌면서 쓰는 곳이 없어졌다. 되살릴 때는
그 커밋의 부모에서 `build_card_frame()` · `SLICE` · `key_cream()`과 `style.css`의 `.uc-frame`을
함께 꺼낸다 — 9분할 자리는 그 둘이 같은 값이어야 했다.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
SRC = ROOT / "assets" / "map"
OUT = ROOT / "packages" / "client" / "public" / "ui"

BG = (244, 239, 233)                # 크림색 배경 — 산수 배경의 바탕색

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
BACKDROP_W, BACKDROP_H = 960, 420
"""판 위아래 칸 뒤에 까는 산수 배경. 원본에서 액자 **바깥의 산수만** 오려
흩어 놓는다."""

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


RAID_MAP_SIZE = (1600, 1200)
"""도적떼 판 지도 — 판(25×15칸, 셀 96×120 = 2400×1800)과 같은 4:3. 대전 지도(750²)보다 촘촘하게 둔다."""


def build_raid_map(args: argparse.Namespace) -> list[str]:
    """
    도적떼 전용 판 지도 (GDD §5.11) → `public/ui/raidmap.jpg`.

    원본은 장식 테두리가 둘린 2656×1600(1.66:1)이고 판은 4:3이라, **테두리 안쪽을 판 비율로
    가운데를 잘라** 쓴다 — 늘이면 산과 성이 찌그러진다(대전 지도를 판에 붙일 때와 같은 규칙).
    그다음은 `chessmap`과 똑같이 눌러 굽는다 — 두 판이 같은 종이 위에 있어야 한다.
    원본 경로와 안쪽 상자는 `raid.json`(← `extract_data.py`의 `RAID.art`)이 정한다.
    """
    spec = ROOT / "packages" / "data" / "generated" / "raid.json"
    if not spec.is_file():
        return []
    art = json.loads(spec.read_text(encoding="utf-8"))["art"]
    src = ROOT / "assets" / art["map"]
    dst = OUT / "raidmap.jpg"
    if not src.is_file():
        print(f"  ! {art['map']} 이 없다")
        return []
    if not (args.force or not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime):
        return []
    inner = load(src).convert("RGB").crop(tuple(art["mapInner"]))
    ratio = RAID_MAP_SIZE[0] / RAID_MAP_SIZE[1]
    if inner.width / inner.height > ratio:          # 가로가 남는다 — 좌우를 똑같이 덜어 낸다
        w = round(inner.height * ratio)
        x0 = (inner.width - w) // 2
        inner = inner.crop((x0, 0, x0 + w, inner.height))
    else:                                           # 세로가 남는다 — 위아래를 똑같이 덜어 낸다
        h = round(inner.width / ratio)
        y0 = (inner.height - h) // 2
        inner = inner.crop((0, y0, inner.width, y0 + h))
    out = fade_map(inner.resize(RAID_MAP_SIZE, Image.LANCZOS), args.map_desat, args.map_fade)
    out.save(dst, "JPEG", quality=86, optimize=True)
    return [f"raidmap {RAID_MAP_SIZE[0]}×{RAID_MAP_SIZE[1]}(테두리 안쪽 가운데 4:3)"]


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
        # 뒤로 물러나 있어야 한다 — 순서 판 · 명령 판이 그 앞에 서는 그림이라 진하면 글자와 다툰다
        a = np.array(part)
        a[:, :, 3] = (a[:, :, 3] * 0.62).astype(np.uint8)
        out.alpha_composite(Image.fromarray(a, "RGBA"),
                            (int(BACKDROP_W * cx) - part.width // 2, BACKDROP_H - part.height))
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
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
        if args.force or not dst.exists() or dst.stat().st_mtime < chessmap.stat().st_mtime:
            # 자르거나 맞출 것은 없다 — 판 전체를 덮는 한 장이다. **눌러서** 굽는 것만 한다.
            fade_map(load(chessmap), args.map_desat, args.map_fade).save(dst)
            made.append(f"chessmap(채도 −{args.map_desat:.0%} · 종이 +{args.map_fade:.0%})")
    else:
        print(f"  ! {chessmap.name} 이 없다")

    made.extend(build_raid_map(args))

    person = SRC / "person.png"
    if person.is_file():
        im = load(person)
        back_dst = OUT / "backdrop.png"
        if args.force or not back_dst.exists() or back_dst.stat().st_mtime < person.stat().st_mtime:
            build_backdrop(im).convert("RGB").save(back_dst)
            made.append("backdrop")
    else:
        print(f"  ! {person.name} 이 없다")

    print(f"출력 → {OUT}")
    print(f"  구운 것: {' '.join(made) if made else '없음 (이미 최신)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
