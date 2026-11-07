#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""일기토 · 설전 그림을 굽는다 (2026-11-05, `Design/일기토_설전_이미지프롬프트.md`).

    python tools/build_duel.py [--force]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/icons/ui/control/_src/ic_*.png.jpg` 13장 | `assets/icons/ui/control/ic_*.png` 512² 투명 | 신청 · 게이지 · 공격권 · 버프 · 도망 · 손 셋 · 산가지 셋. **`npm run ui`가 이어** `public/icons/control/`에 굽는다 |
| `assets/duel/label/일기토.jpg` · `설전.jpg` | `public/duel/label-{duel,debate}.jpg` 폭 720 | 맥락 판의 물음 — 고유기술 라벨(`public/skills/`)과 같은 폭 |
| `assets/duel/bg/duel.jpg` · `debate.jpg` | `public/duel/bg-{duel,debate}.jpg` | 대결 화면 전체 |
| `assets/duel/fx/clash.jpg` · `ink.jpg` · `hit.jpg` | `public/duel/{clash,ink,hit}.png` 투명 | 패가 열리는 순간의 섬광 · 맞은 쪽 초상 위의 섬광 |
| `public/ui/panel-battle-officer.png`(장수 팝업 판) | `public/duel/panel-{p1,p2}.png` | 합 화면 양쪽 장수 판 — 테 안쪽 가죽을 남군 푸른빛 · 북군 붉은빛으로 물들인 것 (2026-11-06) |
| `assets/duel/bubble/말풍선1~4.jpg` | `public/duel/bubble-{hit,turn,end,tie}.png` 투명 · 폭 720 | 합의 결과 한 줄 · 끝 장면 (2026-11-06) — 1 공격 · 2 공격권 빼앗음 · 3 끝 · 4 비김 |
| `assets/duel/bg/duel/duel_{묶음}_{1~6}.png.jpg` 144장 | `public/duel/scene/{묶음}-{n}.jpg` 640² | 일기토 연출 그림 — 내 그림 반 + 상대 그림 뒤집은 반 (`ui/duelScene.ts`, 2026-11-06) |
| `assets/duel/bg/debate/debate_{묶음}_{1~6}.png.jpg` 138장 | `public/duel/scene/debate/{묶음}-{n}.jpg` 640² | 설전 연출 그림 — 같은 틀 (순욱 세트는 안 쓴다 — 노숙 세트가 책사 공용) |
| (없음 — 여기서 만든다) | `public/duel/scene/tear.png` · `tear-line.png` | 두 반쪽을 잇는 찢긴 종이 선 — 왼쪽 그림의 가리개 · 그 선의 그림자 |

**라벨에는 글자가 없다** — 고유기술 라벨 40장은 제목 · 한 줄이 그림에 박혀 있지만, 이 둘은 받은 그대로(오른쪽 40%가 빈 종이)다.
제목 · 한 줄은 화면이 얹는다 — 그래야 열 언어로 바뀐다(의뢰서는 「글자를 얹은 완성본」이라 적었는데 받은 뒤 이렇게 정했다).

**바탕 걷기는 셋으로 갈린다.**
- 아이콘 — `build_icons_composed.bake()` 그대로(가장자리와 이어진 어두운 덩어리만 밝기로 걷는다 → 칼의 불꽃 · 등불의 빛은 반투명으로 남는다).
  `ic_stat_morale`만 **흰 바탕**으로 왔다(`WHITE_BG`).
- 섬광 — 전부가 빛이라 **밝기가 곧 알파**다(`key_glow`). 가장자리와 이어진 곳만 걷으면 불티 사이의 검정이 남는다.
- 라벨 · 배경 — 걷지 않는다(JPG 그대로, 줄이기만).
- 말풍선 — 검은 바탕에 흰 모양이라 섬광과 같이 **밝기가 곧 알파**(`key_glow`). 둘레만 남기고 잘라 폭 720.

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
FX = {"clash": "clash", "ink": "ink", "hit": "hit"}
"""`hit` — 맞은 쪽 초상 위에 번지는 섬광(2026-11-06). 검은 바탕의 빛 그림으로 받는다 — 밝기가 곧 알파."""
BUBBLES = {"말풍선1": "bubble-hit", "말풍선2": "bubble-turn", "말풍선3": "bubble-end", "말풍선4": "bubble-tie"}
BUBBLE_WIDTH = 720

PANEL_SRC = ROOT / "packages" / "client" / "public" / "ui" / "panel-battle-officer.png"
PANEL_INSET = 58
"""나무 테의 안쪽 끝(960×714 그림에서 잰 값) — 그 안이 가죽이라 물들인다."""
PANEL_CORNER = 118
"""귀퉁이 쇠장식이 안쪽으로 내려오는 칸(CSS 슬라이스와 같은 수) — 그 안의 밝은 쇠는 안 물들인다."""
PANEL_COLORS = {"panel-p1": ((52, 92, 170), (16, 32, 72)), "panel-p2": ((168, 62, 46), (66, 20, 15))}
"""(위, 아래) — 남군 푸른빛 · 북군 붉은빛. 장수 카드 이름 색과 같은 결."""


def tint_panel(im: Image.Image, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    """테 안쪽 가죽을 진영 색으로 — 결(밝기의 오르내림)은 남기고 색만 바꾼다. 귀퉁이 쇠(밝은 곳)는 그대로."""
    a = np.array(im.convert("RGBA")).astype(np.float32)
    h, w = a.shape[:2]
    lum = a[..., :3] @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    inner = np.zeros((h, w), bool)
    inner[PANEL_INSET:h - PANEL_INSET, PANEL_INSET:w - PANEL_INSET] = True
    corner = np.zeros((h, w), bool)
    c = PANEL_CORNER
    for ys in (slice(0, c), slice(h - c, h)):
        for xs in (slice(0, c), slice(w - c, w)):
            corner[ys, xs] = True
    mask = inner & ~(corner & (lum > 62))
    ref = float(np.median(lum[mask]))
    t = (np.arange(h, dtype=np.float32) / (h - 1))[:, None, None]
    color = np.array(top, np.float32) * (1 - t) + np.array(bottom, np.float32) * t
    shade = np.clip(lum / max(ref, 1), 0.55, 1.6)[..., None]
    out = a.copy()
    out[..., :3] = np.where(mask[..., None], np.clip(color * shade, 0, 255), a[..., :3])
    return Image.fromarray(out.astype(np.uint8))
SCENE_SRC = DUEL_SRC / "bg" / "duel"
SCENE_OUT = OUT / "scene"
SCENE_KINDS = (("duel", SCENE_SRC, SCENE_OUT), ("debate", DUEL_SRC / "bg" / "debate", SCENE_OUT / "debate"))
"""(종류, 원본 폴더, 출력 폴더) — 설전은 2026-11-06에 붙었다. 파일 이름은 `{종류}_{묶음}_{n}.png.jpg`."""
SCENE_SIDE = 640
"""합 화면 가운데에 뜨는 크기 — 700px 판에서 가운데 칸보다 조금 크게. gwan-u_6은 540²로 와서 키운다."""
SCENE_FLIP = {("jo-un", 3), ("je-gal-ryang", 5)}
"""주인공이 **오른쪽에** 그려져 온 장 — 뒤집으면 장면 뜻까지 맞는다(조운 3: 상대가 내려치고 조운이 막는다 · 제갈량 5: 상대가 달아난다)."""
TEAR_SEED = 11
TEAR_AMP = 0.026
"""찢긴 선이 가운데에서 흔들리는 폭(그림 폭 대비) — 크면 한쪽 주인공을 베어 먹는다."""


def tear_masks(side: int) -> tuple[Image.Image, Image.Image]:
    """찢긴 종이 선 — (왼쪽 그림의 가리개: 선의 왼쪽이 불투명, 선의 그림자). 굵은 물결 + 잔 톱니, 가장자리만 살짝 흐린다."""
    from PIL import ImageFilter
    rng = np.random.default_rng(TEAR_SEED)
    y = np.arange(side, dtype=np.float32)
    def wave(step: int) -> np.ndarray:
        knots = rng.uniform(-1, 1, side // step + 3).astype(np.float32)
        t = y / step
        i = t.astype(int)
        return knots[i] + (knots[i + 1] - knots[i]) * (t - i)
    seam = side / 2 + side * TEAR_AMP * (wave(side // 16) + 0.3 * wave(max(2, side // 170)))
    x = np.arange(side, dtype=np.float32)[None, :]
    hard = (x < seam[:, None]).astype(np.float32) * 255
    alpha = Image.fromarray(hard.astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(side / 340))
    mask = Image.new("RGBA", (side, side), (255, 255, 255, 0))
    mask.putalpha(alpha)   # CSS `mask`는 알파를 본다(흑백 L이면 전부 불투명으로 읽힌다)
    edge = np.clip(1 - np.abs(x - seam[:, None]) / (side / 220), 0, 1)
    edge[:, :2] = 0
    line = np.zeros((side, side, 4), np.uint8)
    line[..., :3] = (96, 74, 52)
    line[..., 3] = (edge * 120).astype(np.uint8)
    return mask, Image.fromarray(line, "RGBA").filter(ImageFilter.GaussianBlur(side / 512))


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
            + [(DUEL_SRC / "fx" / f"{a}.jpg", OUT / f"{b}.png", "fx") for a, b in FX.items()]
            + [(DUEL_SRC / "bubble" / f"{a}.jpg", OUT / f"{b}.png", "bubble") for a, b in BUBBLES.items()])
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
        elif kind == "bubble":
            keyed = key_glow(im)
            box = keyed.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
            shrink(keyed.crop(box) if box else keyed, BUBBLE_WIDTH).save(dst)
        else:
            square_fit(key_glow(im), FX_SIDE).save(dst)
        made.append(dst.name)

    # 일기토 · 설전 연출 그림 — 장면마다 640² 한 장. 주인공이 오른쪽에 온 장은 뒤집어 왼쪽으로(일기토만 있었다)
    for kind, src_dir, out_dir in SCENE_KINDS:
        if not src_dir.exists():
            missing.append(str(src_dir.relative_to(ROOT)))
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        for src in sorted(src_dir.glob(f"{kind}_*_[1-6].png.jpg")):
            who, n = src.name[len(kind) + 1:-len(".png.jpg")].rsplit("_", 1)
            dst = out_dir / f"{who}-{n}.jpg"
            if not stale(dst, src, args.force) and not stale(dst, Path(__file__), False):
                skipped += 1
                continue
            im = Image.open(src).convert("RGB").resize((SCENE_SIDE, SCENE_SIDE), Image.LANCZOS)
            if kind == "duel" and (who, int(n)) in SCENE_FLIP:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            im.save(dst, quality=JPEG_QUALITY)
            made.append(f"{kind}/{dst.name}")
    if SCENE_OUT.exists():  # 찢긴 선은 두 종류가 함께 쓴다
        tear, line = SCENE_OUT / "tear.png", SCENE_OUT / "tear-line.png"
        if args.force or not tear.exists() or not line.exists() or stale(tear, Path(__file__), False):
            m, l = tear_masks(SCENE_SIDE)
            m.save(tear)
            l.save(line)
            made += [tear.name, line.name]

    # 합 화면 양쪽 판 — 장수 팝업 판을 진영 색으로 물들인다
    for name, (top, bottom) in PANEL_COLORS.items():
        dst = OUT / f"{name}.png"
        if not PANEL_SRC.exists():
            missing.append(str(PANEL_SRC.relative_to(ROOT)))
            continue
        if not stale(dst, PANEL_SRC, args.force) and not stale(dst, Path(__file__), False):
            skipped += 1
            continue
        tint_panel(Image.open(PANEL_SRC), top, bottom).save(dst)
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
