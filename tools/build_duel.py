#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""일기토 · 설전 그림을 굽는다 (2026-11-05, `Design/일기토_설전_이미지프롬프트.md`).

    python tools/build_duel.py [--force]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/icons/ui/control/_src/ic_*.png.jpg` 13장 | `assets/icons/ui/control/ic_*.png` 512² 투명 | 신청 · 게이지 · 공격권 · 버프 · 도망 · 손 셋 · 산가지 셋. **`npm run ui`가 이어** `public/icons/control/`에 굽는다 |
| `assets/duel/label/일기토.jpg` · `설전.jpg` | `public/duel/label-{duel,debate}.jpg` 폭 720 | 맥락 판의 물음 — 고유기술 라벨(`public/skills/`)과 같은 폭 |
| `assets/duel/bg/duel.jpg` · `debate.jpg` | `public/duel/bg-{duel,debate}.jpg` | 대결 화면 전체 |
| `assets/duel/fx/clash.jpg` · `ink.jpg` | `public/duel/{clash,ink}.png` 투명 | 패가 열리는 순간의 섬광 |

**라벨에는 글자가 없다** — 고유기술 라벨 40장은 제목 · 한 줄이 그림에 박혀 있지만, 이 둘은 받은 그대로(오른쪽 40%가 빈 종이)다.
제목 · 한 줄은 화면이 얹는다 — 그래야 열 언어로 바뀐다(의뢰서는 「글자를 얹은 완성본」이라 적었는데 받은 뒤 이렇게 정했다).

**바탕 걷기는 셋으로 갈린다.**
- 아이콘 — `build_icons_composed.bake()` 그대로(가장자리와 이어진 어두운 덩어리만 밝기로 걷는다 → 칼의 불꽃 · 등불의 빛은 반투명으로 남는다).
  `ic_stat_morale`만 **흰 바탕**으로 왔다(`WHITE_BG`).
- 섬광 — 전부가 빛이라 **밝기가 곧 알파**다(`key_glow`). 가장자리와 이어진 곳만 걷으면 불티 사이의 검정이 남는다.
- 라벨 · 배경 — 걷지 않는다(JPG 그대로, 줄이기만).

원본이 없으면 건너뛰고 그렇다고 말한다 — `assets/`는 git에 없다.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import build_icons_composed as bic

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
ICON_SRC = ROOT / "assets" / "icons" / "ui" / "control" / "_src"
ICON_OUT = ROOT / "assets" / "icons" / "ui" / "control"
DUEL_SRC = ROOT / "assets" / "duel"
OUT = ROOT / "packages" / "client" / "public" / "duel"

ICONS = [
    "ic_cmd_duel", "ic_cmd_debate", "ic_stat_morale", "ic_stat_mental", "ic_duel_initiative", "ic_buff_spmax", "ic_duel_fled",
    "ic_rps_rock", "ic_rps_scissors", "ic_rps_paper", "ic_debate_1", "ic_debate_2", "ic_debate_3",
]
WHITE_BG = {"ic_stat_morale"}
ICON_SIDE = 512
"""`control/`의 다른 아이콘(10-26 굽기)과 같은 크기."""

DARK_EDGE = 28
"""손 셋은 **어두운 덩어리의 문턱을 낮춘다**(기본 64). 검은 가죽 손목이 바탕과 이어져, 기본값이면 「보」의 손목이 반투명 은빛이 됐다."""
HALO_HI = 160
"""정신력 등불의 푸른 빛 — 푸른 곳에만 이 문턱을 쓴다. 기본 64면 밝은 바탕 위에서 짙은 남색 얼룩이고,
그림 전체에 160을 쓰면 놋쇠 몸통까지 옅어진다."""


def key_hands(im: Image.Image) -> Image.Image:
    return bic.key_black_soft(im, hi=DARK_EDGE)


def key_blue_halo(im: Image.Image) -> Image.Image:
    base = np.array(bic.key_black_soft(im)).astype(np.float32)
    soft = np.array(bic.key_black_soft(im, hi=HALO_HI)).astype(np.float32)
    rgb = np.array(im.convert("RGB")).astype(np.int16)
    blue = rgb[..., 2] > rgb[..., 0] + 8
    return Image.fromarray(np.where(blue[..., None], soft, base).astype(np.uint8))


KEYS = {"ic_rps_rock": key_hands, "ic_rps_scissors": key_hands, "ic_rps_paper": key_hands, "ic_stat_mental": key_blue_halo}

LABELS = {"일기토": "label-duel", "설전": "label-debate"}
LABEL_WIDTH = 720
"""`build_portraits.py`가 고유기술 라벨을 굽는 폭과 같다."""

BGS = {"duel": "bg-duel", "debate": "bg-debate"}
BG_MAX_WIDTH = 1080
FX = {"clash": "clash", "ink": "ink"}
FX_SIDE = 768
JPEG_QUALITY = 88

GLOW_LO, GLOW_HI = 10, 90
"""섬광의 밝기 → 알파. `GLOW_LO` 이하는 투명, `GLOW_HI` 이상은 불투명."""


def stale(dst: Path, src: Path, force: bool) -> bool:
    return force or not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime


def key_glow(im: Image.Image) -> Image.Image:
    """검은 바탕의 빛 그림 — 밝기로 알파를 매기고 색을 그 알파로 편다(검게 탁해지지 않게)."""
    rgb = np.array(im.convert("RGB")).astype(np.float32)
    m = rgb.max(axis=2)
    a = np.clip((m - GLOW_LO) / (GLOW_HI - GLOW_LO), 0, 1)
    scale = np.where(a > 0, np.minimum(1 / np.maximum(a, 1e-3), 255 / np.maximum(m, 1)), 1)
    out = np.clip(rgb * scale[..., None], 0, 255)
    return Image.fromarray(np.dstack([out, a * 255]).astype(np.uint8))


def square_fit(im: Image.Image, side: int) -> Image.Image:
    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    im = im.crop(box) if box else im
    s = max(im.size)
    sq = Image.new("RGBA", (s, s))
    sq.alpha_composite(im, ((s - im.width) // 2, (s - im.height) // 2))
    return sq.resize((side, side), Image.LANCZOS) if s > side else sq


def shrink(im: Image.Image, width: int) -> Image.Image:
    return im if im.width <= width else im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
    args = ap.parse_args()

    made: list[str] = []
    missing: list[str] = []
    skipped = 0

    bic.N = ICON_SIDE
    for k in ICONS:
        src, dst = ICON_SRC / f"{k}.png.jpg", ICON_OUT / f"{k}.png"
        if not src.exists():
            missing.append(str(src.relative_to(ROOT)))
            continue
        if not stale(dst, src, args.force):
            skipped += 1
            continue
        bic.bake(src, white=k in WHITE_BG, key=KEYS.get(k)).save(dst)
        made.append(k)

    OUT.mkdir(parents=True, exist_ok=True)
    jobs = ([(DUEL_SRC / "label" / f"{a}.jpg", OUT / f"{b}.jpg", "label") for a, b in LABELS.items()]
            + [(DUEL_SRC / "bg" / f"{a}.jpg", OUT / f"{b}.jpg", "bg") for a, b in BGS.items()]
            + [(DUEL_SRC / "fx" / f"{a}.jpg", OUT / f"{b}.png", "fx") for a, b in FX.items()])
    for src, dst, kind in jobs:
        if not src.exists():
            missing.append(str(src.relative_to(ROOT)))
            continue
        if not stale(dst, src, args.force):
            skipped += 1
            continue
        im = Image.open(src)
        if kind == "label":
            shrink(im.convert("RGB"), LABEL_WIDTH).save(dst, quality=JPEG_QUALITY)
        elif kind == "bg":
            shrink(im.convert("RGB"), BG_MAX_WIDTH).save(dst, quality=JPEG_QUALITY)
        else:
            square_fit(key_glow(im), FX_SIDE).save(dst)
        made.append(dst.name)

    print(f"출력 → {ICON_OUT.relative_to(ROOT)} · {OUT.relative_to(ROOT)}")
    print(f"  구운 것 {len(made)}" + (f" (그대로 둔 것 {skipped})" if skipped else ""))
    if made:
        print(f"  {' '.join(made)}")
    if missing:
        print(f"  ! 못 찾은 원본: {' · '.join(missing)}")
    if any(k in made for k in ICONS):
        print("  → 아이콘은 `npm run ui`가 public/icons/control/로 이어 굽는다")
    return 0


if __name__ == "__main__":
    sys.exit(main())
