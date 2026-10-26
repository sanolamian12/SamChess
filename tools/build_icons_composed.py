#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""있는 그림을 잘라 내고 겹쳐 아이콘을 만든다 (2026-10-24, `Design/아이콘_제작목록_이미지프롬프트.md`의 「합성」).

    python tools/build_icons_composed.py [--sheet 대조.png]

지금 화면에 걸린 그림과 생김새가 어긋나면 이질감이 나서(기획자), 있는 그림으로 될 아이콘은 생성 AI에 맡기지 않고 여기서 만든다.
출력은 `assets/icons/ui/{장}/{id}.png` 256² 투명 — 장은 의뢰서의 §2~§11 그대로다(`category()`). `build_ui.py`가 이어 굽는다.
생성 AI 결과도 같은 폴더에 같은 규칙으로 놓는다. 원본(검은 바탕 JPG, 이름 `{id}.png.jpg`)을 남겨 둘 때는 그 장의 `_src/`에.

재료는 **`public/`의 굽힌 그림**이다 — 화면에 실제로 보이는 바로 그 그림이라야 이질감이 없다(배경 · 기물 · 아이템 · 깃발).
메달 테만 원본(`assets/icons/ui/battle_system_badge_me.jpg`, 637×999)에서 따온다 — 굽힌 `ui/gi/me.png`는 128²라 256²로 키우면 흐리다.

────────────────────────────────────────────────────────────────
메달 — 「나」 표지의 금빛 고리 안에 바탕 원 + 그림
────────────────────────────────────────────────────────────────

고리 안쪽(반지름 `RING_INNER`)을 비우고, 바탕색 원(가운데가 밝고 가장자리가 어두운 원형 그러데이션)을 깐 뒤 그림을 얹는다.
그림은 안쪽 원으로 잘린다 — 배경 그림을 자른 건물 · 장면은 원을 꽉 채우고(`fill=1`), 물건 그림은 여백을 둔다.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
PUB = ROOT / "packages" / "client" / "public"
RING_SRC = ROOT / "assets" / "icons" / "ui" / "battle_system_badge_me.jpg"
ICONS = ROOT / "assets" / "icons" / "ui"


def category(icon_id: str) -> str:
    """아이콘이 사는 폴더 — 의뢰서(`Design/아이콘_제작목록_이미지프롬프트.md`)의 장과 1:1이다 (2026-10-26 기획자).
    stat §2 능력치 · record §3 전적 · outcome §4 결말 · 목표 · officer §5 장수 상태 · 모드 · 상대 · city §6 건물 · 도시 ·
    facility §7 농지 · 도적떼 · 병원 · 대장간 · shop §8 장터 · 보관함 · 우편 · seal §9 인장 · control §10 전투 · 설정 단추 · mark §11 공통 표식."""
    k = icon_id.removeprefix("ic_")
    rules = [
        ("stat", ("stat_", "battle_point")),
        ("record", ("rec_",)),
        ("outcome", ("out_", "goal_")),
        ("officer", ("st_", "mode_", "opp_", "grade_score", "emperor")),
        ("city", ("bld_", "build_credit", "city_upgrade", "grain_full")),
        ("facility", ("bandit", "guard", "raid_", "hosp_", "forge_", "equip_", "grain_rate")),
        ("shop", ("mail_", "item_", "mk_checkout", "mk_soldout", "mk_stock", "mk_storage", "mk_topup", "mk_shop")),
        ("seal", ("seal_",)),
        ("control", ("cmd_", "cam_", "skill_preview", "set_")),
        ("mark", ("mk_",)),
    ]
    for folder, heads in rules:
        if k.startswith(heads):
            return folder
    raise KeyError(f"{icon_id}: 장을 모른다 — category()에 줄을 더한다")


def icon_path(icon_id: str) -> Path:
    return ICONS / category(icon_id) / f"{icon_id}.png"


def raw_path(icon_id: str) -> Path:
    return ICONS / category(icon_id) / "_src" / f"{icon_id}.png.jpg"

N = 256
"""출력 한 변. 화면은 128² 이하로 쓴다 — 두 배로 낸다."""
RING_INNER = 0.80
"""고리 바깥 반지름에 대한 안쪽 반지름 — 이 안을 비운다."""


# ── 재료 ──────────────────────────────────────────────────────────

def pub(rel: str) -> Image.Image:
    return Image.open(PUB / rel).convert("RGBA")


def knock_black(im: Image.Image, level: int = 24) -> Image.Image:
    """가장자리에 닿은 검정을 걷는다(검은 바탕으로 온 생성 그림). 경계는 1px 반투명."""
    from scipy import ndimage

    a = np.array(im.convert("RGBA"))
    dark = a[:, :, :3].max(axis=2) <= level
    labels, _ = ndimage.label(dark)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    bg = np.isin(labels, edge[edge > 0])
    a[bg, 3] = 0
    a[ndimage.binary_dilation(bg) & ~bg, 3] = 128
    return Image.fromarray(a)


def key_black_soft(im: Image.Image, lo: int = 14, hi: int = 64) -> Image.Image:
    """검은 바탕 생성 그림의 바탕을 걷되 **빛 · 안개는 반투명으로** 남긴다 (기획자가 보낸 HP · MP · AT · 전투력).
    가장자리와 이어진 어두운 덩어리(밝기 `hi` 이하) 안에서만 밝기로 알파를 매기고(`lo` → 0, `hi` → 1) 색을 그 알파로 편다.
    그림 안쪽의 어두운 곳(술 · 그림자)은 가장자리와 안 이어져 그대로 불투명하다."""
    from scipy import ndimage

    a = np.array(im.convert("RGB")).astype(np.float32)
    m = a.max(axis=2)
    labels, _ = ndimage.label(m <= hi)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    zone = np.isin(labels, edge[edge > 0])
    alpha = np.ones_like(m)
    alpha[zone] = np.clip((m[zone] - lo) / (hi - lo), 0, 1)
    rgb = np.where(zone[..., None], a / np.maximum(alpha[..., None], 1e-3) * (alpha[..., None] > 0), a)
    rgb = np.clip(np.where(zone[..., None], np.minimum(rgb, 255), rgb), 0, 255)
    return Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8))


def key_white(im: Image.Image, level: int = 232, hole_min: float = .004) -> Image.Image:
    """흰 바탕으로 온 그림(`ic_mk_replay`)의 바탕을 걷는다 — 가장자리와 이어진 흰 덩어리와 **갇힌 큰 흰 덩어리**(고리 안)."""
    from scipy import ndimage

    a = np.array(im.convert("RGBA"))
    light = a[:, :, :3].min(axis=2) >= level
    labels, n = ndimage.label(light)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    sizes = ndimage.sum(light, labels, range(1, n + 1))
    big = np.flatnonzero(sizes >= hole_min * light.size) + 1
    bg = np.isin(labels, np.union1d(edge[edge > 0], big))
    a[bg, 3] = 0
    a[ndimage.binary_dilation(bg) & ~bg, 3] = 128
    return Image.fromarray(a)


def open_holes(im: Image.Image, level: int = 16, hole_min: float = .004) -> Image.Image:
    """테 안에 갇힌 검정(`ic_mk_swap`의 고리 안)도 걷는다 — 가장자리와 안 이어져 `key_black_soft`가 남긴 큰 순흑 덩어리."""
    from scipy import ndimage

    a = np.array(im)
    dark = (a[:, :, :3].max(axis=2) <= level) & (a[:, :, 3] > 0)
    labels, n = ndimage.label(dark)
    sizes = ndimage.sum(dark, labels, range(1, n + 1))
    big = np.isin(labels, np.flatnonzero(sizes >= hole_min * dark.size) + 1)
    a[big, 3] = 0
    a[ndimage.binary_dilation(big) & ~big, 3] = np.minimum(a[ndimage.binary_dilation(big) & ~big, 3], 128)
    return Image.fromarray(a)


def bake(path: Path, halo_x: bool = False, white: bool = False, holes: bool = False) -> Image.Image:
    """받은 아이콘을 굽는다 — 바탕을 걷고 · 경계상자로 자르고 · 정사각 가운데에 · `N`².
    경계상자는 **거의 불투명한 곳**으로 잡는다 — 전투력 그림의 뒤 후광이 넓게 번져 있어, 옅은 빛까지 넣으면 병사가 작아진다.
    `halo_x`면 **가로만** 옅은 빛(알파 > 24)까지 넣는다 — 세로로 잡으면 병사가 작아지고, 가로를 안 넣으면 후광이 좌우에서 잘려 보였다(기획자).
    `white`는 흰 바탕으로 온 그림, `holes`는 고리 안에 갇힌 검정까지 걷는다."""
    src = Image.open(path)
    full = key_white(src) if white else key_black_soft(src)
    if holes:
        full = open_holes(full)
    al = full.getchannel("A")
    x0, y0, x1, y1 = al.point(lambda v: 255 if v > 200 else 0).getbbox()
    if halo_x:
        hx0, _, hx1, _ = al.point(lambda v: 255 if v > 24 else 0).getbbox()
        x0, x1 = hx0, hx1
    im = full.crop((x0, y0, x1, y1))
    # **잘린 변만** 흐린다 — 후광을 가로로 자른 전투력 그림, 원본 테두리에 걸친 그림(`ic_equip_give`의 팔).
    # 모든 변을 흐리면 물체 끝(칼끝 · 깃발 꼭대기)이 반투명해진다(2026-10-26에 바로잡았다 — 그 전 30장은 원본이 지워져 다시 못 굽는다)
    W, H = full.size
    A = np.array(full.getchannel("A"))
    cut = {"L": halo_x or (A[:, 0] > 128).sum() > 3, "R": halo_x or (A[:, -1] > 128).sum() > 3,
           "T": (A[0] > 128).sum() > 3, "B": (A[-1] > 128).sum() > 3}
    al = np.array(im.getchannel("A")).astype(np.float32)
    h, w = al.shape
    f = max(4, round(min(h, w) * .06))
    i, j = np.arange(h), np.arange(w)
    ry = np.minimum(np.clip(i / f, 0, 1) if cut["T"] else 1, np.clip((h - 1 - i) / f, 0, 1) if cut["B"] else 1)
    rx = np.minimum(np.clip(j / f, 0, 1) if cut["L"] else 1, np.clip((w - 1 - j) / f, 0, 1) if cut["R"] else 1)
    ry = np.broadcast_to(ry, (h,)) if np.ndim(ry) else np.ones(h)
    rx = np.broadcast_to(rx, (w,)) if np.ndim(rx) else np.ones(w)
    im.putalpha(Image.fromarray((al * ry[:, None] * rx[None, :]).astype(np.uint8)))
    side = max(im.size)
    sq = Image.new("RGBA", (side, side))
    sq.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
    return sq.resize((N, N), Image.LANCZOS)


def trim(im: Image.Image, floor: int = 8) -> Image.Image:
    box = im.getchannel("A").point(lambda v: 255 if v > floor else 0).getbbox()
    return im.crop(box) if box else im


def gray(im: Image.Image) -> Image.Image:
    a = im.getchannel("A")
    g = im.convert("L").convert("RGBA")
    g.putalpha(a)
    return g


def fit(im: Image.Image, side: int) -> Image.Image:
    k = side / max(im.size)
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)


def scene(rel: str, x: int, y: int, s: int) -> Image.Image:
    """배경 그림에서 정사각 한 칸을 잘라 낸다 — 건물 · 결과 장면."""
    return pub(rel).crop((x, y, x + s, y + s))


# ── 메달 ──────────────────────────────────────────────────────────

def load_ring() -> tuple[Image.Image, float, Image.Image]:
    """원본은 짙은 회색 바탕(42,43,47) 가운데에 메달이 작게 있다 — 바탕을 걷지 않고 **금빛 고리를 색으로 찾는다.**
    반지름마다 둘레의 금빛 비율을 재서 그 비율이 높은 띠가 고리다(투구의 금장식은 둘레를 다 돌지 않아 안 걸린다).
    돌려주는 것: 고리(안팎 투명), 안쪽 반지름, 고리 안의 투구 그림(퇴각 · 아군 표지에 쓴다)."""
    src = np.array(Image.open(RING_SRC).convert("RGB")).astype(np.int32)
    R_, G_, B_ = src[:, :, 0], src[:, :, 1], src[:, :, 2]
    gold = (R_ > 140) & (G_ > 95) & (B_ < 120) & (R_ - B_ > 60)
    ys, xs = np.nonzero(gold)
    cy, cx = (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2
    rr = np.hypot(np.arange(src.shape[1])[None, :] - cx, np.arange(src.shape[0])[:, None] - cy)
    bins = np.arange(0, int(rr[gold].max()) + 2)
    tot = np.bincount(rr.astype(int).ravel(), minlength=len(bins))[:len(bins)]
    hit = np.bincount(rr[gold].astype(int), minlength=len(bins))[:len(bins)]
    frac = hit / np.maximum(tot, 1)
    band = np.nonzero(frac > .55)[0]
    r_in, r_out = band.min() - 1.5, band.max() + 3
    side = int(r_out * 2 + 8)
    x0, y0 = int(cx - side / 2), int(cy - side / 2)
    crop = Image.fromarray(src[y0:y0 + side, x0:x0 + side].astype(np.uint8)).convert("RGBA")
    k = N / side
    crop = crop.resize((N, N), Image.LANCZOS)
    a = np.array(crop).astype(np.float32)
    yy, xx = np.mgrid[:N, :N]
    r = np.hypot(xx - N / 2 + .5, yy - N / 2 + .5)
    inner, outer = r_in * k, r_out * k
    ring = a.copy()
    ring[:, :, 3] = 255 * np.clip(outer - r, 0, 1) * np.clip(r - inner, 0, 1)
    helmet = a.copy()
    helmet[:, :, 3] = 255 * np.clip(inner - r, 0, 1)
    helmet_im = trim(Image.fromarray(helmet.astype(np.uint8)))
    return Image.fromarray(ring.astype(np.uint8)), inner + 1, helmet_im


RING, INNER, HELMET = None, 0.0, None


def disc_mask(pad: float = 0) -> Image.Image:
    m = Image.new("L", (N, N), 0)
    r = INNER + pad
    ImageDraw.Draw(m).ellipse([N / 2 - r, N / 2 - r, N / 2 + r, N / 2 + r], fill=255)
    return m


def backdrop(rgb: tuple[int, int, int]) -> Image.Image:
    """바탕 원 — 가운데 밝고 가장자리 어둡게(메달이 평평한 색판으로 안 보이게)."""
    yy, xx = np.mgrid[:N, :N]
    t = np.clip(np.hypot(xx - N / 2, yy - N / 2 - N * .06) / INNER, 0, 1)
    k = (1.18 - .45 * t ** 1.6)[..., None]
    rgbA = np.clip(np.array(rgb, np.float32)[None, None, :] * k, 0, 255)
    im = Image.fromarray(np.dstack([rgbA, np.full((N, N), 255, np.float32)]).astype(np.uint8))
    im.putalpha(disc_mask(2))
    return im


def medal(content: Image.Image | None, *, bg: tuple[int, int, int] | None = None, fill: float = .82,
          dy: int = 0, shadow: bool = True) -> Image.Image:
    out = Image.new("RGBA", (N, N))
    if bg:
        out.alpha_composite(backdrop(bg))
    if content is not None:
        c = fit(content, round(INNER * 2 * fill))
        pos = ((N - c.width) // 2, (N - c.height) // 2 + dy)
        if shadow and bg:
            sh = Image.new("RGBA", c.size, (0, 0, 0, 0))
            sh.putalpha(c.getchannel("A").point(lambda v: v * .45))
            sh = sh.filter(ImageFilter.GaussianBlur(4))
            out.alpha_composite(sh, (pos[0] + 3, pos[1] + 5))
        out.alpha_composite(c, pos)
    a = np.minimum(np.array(out.getchannel("A")), np.array(disc_mask()))
    out.putalpha(Image.fromarray(a))
    out.alpha_composite(RING)
    return out


def on_canvas(*parts: tuple[Image.Image, tuple[int, int]]) -> Image.Image:
    c = Image.new("RGBA", (N, N))
    for im, pos in parts:
        c.alpha_composite(im, pos)
    return c


# ── 바탕색 (같은 뜻은 같은 색) ─────────────────────────────────────
RED = (150, 44, 36)
BLUE = (58, 84, 112)
GOLD = (156, 116, 52)
ASH = (70, 68, 66)          # 패 · 항복 — 기획자 지정(2026-10-24: 「항복은 패의 바탕색」)
NIGHT = (44, 58, 92)
DARK = (52, 48, 46)
PAPER = (160, 132, 92)


# ── 더하기 표 ────────────────────────────────────────────────────

def plus_mark(side: int) -> Image.Image:
    """금빛 「+」 — 짙은 테 · 위가 밝은 금 · 아래 그림자. 군량 자루 같은 그림 옆에 「늘어난다」로 붙인다."""
    S4 = side * 4
    bar, rad = S4 * .30, S4 * .07
    shape = Image.new("L", (S4, S4), 0)
    d = ImageDraw.Draw(shape)
    c = S4 / 2
    d.rounded_rectangle([c - bar / 2, S4 * .06, c + bar / 2, S4 * .94], rad, fill=255)
    d.rounded_rectangle([S4 * .06, c - bar / 2, S4 * .94, c + bar / 2], rad, fill=255)
    rim = shape.filter(ImageFilter.MaxFilter(13))
    yy = np.linspace(0, 1, S4)[:, None]
    gold = np.dstack([255 - 40 * yy + 0 * yy.T, 214 - 90 * yy + 0 * yy.T, 110 - 70 * yy + 0 * yy.T])
    gold = np.broadcast_to(gold, (S4, S4, 3))
    out = Image.new("RGBA", (S4, S4))
    sh = Image.new("RGBA", (S4, S4), (0, 0, 0, 0))
    sh.putalpha(rim.point(lambda v: v * .5).filter(ImageFilter.GaussianBlur(10)))
    out.alpha_composite(sh, (6, 14))
    dark = Image.new("RGBA", (S4, S4), (70, 38, 14, 0))
    dark.putalpha(rim)
    out.alpha_composite(dark)
    g = Image.fromarray(np.dstack([gold, np.array(shape)]).astype(np.uint8))
    out.alpha_composite(g)
    return out.resize((side, side), Image.LANCZOS)


# ── 기물 줄 (3 vs 3 · 5 vs 5) ─────────────────────────────────────

def pieces_row(order: list[str], lift: list[float], h: float, step: float) -> Image.Image:
    """`order` 왼→오, `lift`는 칸마다 위로 올리는 몫(키에 대한 비율) — 5 vs 5의 W자."""
    ims = [trim(pub(f"ui/pieces/{p}-mine.png")) for p in order]
    # 키(`h`)로 잡되 줄 폭이 칸의 94%를 넘으면 줄인다
    ratio = max(im.width / im.height for im in ims)
    h = min(h, .94 / (ratio * (step * (len(ims) - 1) + 1)), .9 / (1 + max(lift)))
    hh = round(N * h)
    ims = [im.resize((round(im.width * hh / im.height), hh), Image.LANCZOS) for im in ims]
    w = max(im.width for im in ims)
    dx = w * step
    total = dx * (len(ims) - 1) + w
    x0 = (N - total) / 2
    base = (N + hh * (1 + max(lift))) / 2
    c = Image.new("RGBA", (N, N))
    # 가운데(King)가 맨 앞에 서게 — 바깥부터 그린다
    idx = sorted(range(len(ims)), key=lambda i: -abs(i - (len(ims) - 1) / 2))
    for i in idx:
        im = ims[i]
        x = x0 + dx * i + (w - im.width) / 2
        y = base - im.height - hh * lift[i]
        c.alpha_composite(im, (round(x), round(y)))
    return c


def pieces_w(back: list[str], front: list[str], h: float = .5, gap: float = .80, drop: float = .42) -> Image.Image:
    """5 vs 5 — **정사각에 가깝게** 두 줄로 세운 W자 (기획자 지정 2026-10-26: 한 줄이면 가로로 비좁다).
    뒷줄(`back`, 왼 · 가운데 · 오른쪽 — 높다)과 앞줄(`front`, 그 사이 — 낮다)이 위아래로 W를 그린다. 앞줄을 나중에 그려 앞에 선다."""
    load = lambda p: trim(pub(f"ui/pieces/{p}-mine.png"))
    hh = round(N * h)
    fit_h = lambda im: im.resize((round(im.width * hh / im.height), hh), Image.LANCZOS)
    bk, fr = [fit_h(load(p)) for p in back], [fit_h(load(p)) for p in front]
    w = max(im.width for im in bk + fr)
    dx = w * gap
    total = dx * (len(bk) - 1) + w
    x0 = (N - total) / 2
    y_back = (N - hh * (1 + drop)) / 2
    c = Image.new("RGBA", (N, N))
    for i, im in enumerate(bk):
        c.alpha_composite(im, (round(x0 + dx * i + (w - im.width) / 2), round(y_back)))
    for i, im in enumerate(fr):
        c.alpha_composite(im, (round(x0 + dx * (i + .5) + (w - im.width) / 2), round(y_back + hh * drop)))
    return c


# ── 인장 (컬렉션 도시 효과) ────────────────────────────────────────

SEAL_PANEL = (55, 85, 178, 223)
"""인장 앞면 **안쪽 판**(금 테 안의 사각형)의 `N`² 좌표 — 그림은 이 판의 가운데에, 판의 `SEAL_FILL`만큼 (기획자 지정 2026-10-24).
상자를 비스듬히 본 그림이라 앞면은 캔버스 가운데보다 **왼쪽 아래**에 있다(가운데 (116, 154)) — 캔버스 가운데로 놓으면 위로 뜨고 넘친다.
원본 인장 그림이나 `seal()`의 크기(`N * .92`)를 바꾸면 다시 잰다."""
SEAL_FILL = .80


def seal(*glyphs: str) -> Image.Image:
    """지금 인장(`ui/gi/collection-north.png`) 위에 그림을 흰 음각으로. 둘이면 겹쳐 놓는다."""
    base = trim(pub("ui/gi/collection-north.png"))
    base = fit(base, round(N * .92))
    c = Image.new("RGBA", (N, N))
    c.alpha_composite(base, ((N - base.width) // 2, (N - base.height) // 2))
    px0, py0, px1, py1 = SEAL_PANEL
    pcx, pcy = (px0 + px1) / 2, (py0 + py1) / 2
    side = round(min(px1 - px0, py1 - py0) * SEAL_FILL * (1 if len(glyphs) == 1 else .78))
    for k, g in enumerate(glyphs):
        im = fit(trim(pub(g)), side)
        # 단색 실루엣은 모양이 뭉개진다(군량고 · 탕약이 덩어리로 보였다) — **밝기를 남겨** 크림색 ↔ 짙은 주홍으로 칠한다
        a = im.getchannel("A").point(lambda v: 255 if v > 90 else 0).filter(ImageFilter.GaussianBlur(.6))
        lum = np.array(im.convert("L")).astype(np.float32) / 255
        lo, hi = np.percentile(lum[np.array(a) > 0], [5, 95]) if (np.array(a) > 0).any() else (0, 1)
        t = np.clip((lum - lo) / max(hi - lo, 1e-3), 0, 1)[..., None] ** .8
        col = np.array([120, 22, 16], np.float32) * (1 - t) + np.array([252, 238, 212], np.float32) * t
        cream = Image.fromarray(np.dstack([col, np.array(a, np.float32)]).astype(np.uint8))
        groove = Image.new("RGBA", im.size, (60, 8, 6, 0))
        groove.putalpha(a.point(lambda v: v * .6))
        dx, dy = (0, 0) if len(glyphs) == 1 else ((-22, -14) if k == 0 else (22, 16))
        x = round(pcx - im.width / 2 + dx)
        y = round(pcy - im.height / 2 + dy)
        c.alpha_composite(groove, (x + 2, y + 3))
        c.alpha_composite(cream, (x, y))
    return c


# ── 목록 ─────────────────────────────────────────────────────────

def build() -> dict[str, Image.Image]:
    # 기획자가 보낸 넷 (검은 바탕 JPG, 이름은 `.png.jpg`) — 원본이 `_src/`에 있으면 다시 굽는다.
    # **원본이 없으면 건너뛰고 그렇다고 말한다** — 조용히 건너뛰어 「다시 구웠다」고 잘못 보고한 적이 있다(2026-10-26: HP · MP · AT 원본이 없었다)
    received = {}
    for k in ("ic_stat_hp", "ic_stat_mp", "ic_stat_at", "ic_battle_point"):
        if raw_path(k).exists():
            received[k] = bake(raw_path(k), halo_x=k == "ic_battle_point")
        else:
            print(f"  · {k}: 원본({raw_path(k).relative_to(ROOT)})이 없어 다시 굽지 않는다 — 구워 둔 그림을 그대로 둔다")
    # HP 기준 아래로는 HP 그림으로 만든다 — 원본이 없으면 구워 둔 HP를 쓴다
    hp_im = received.get("ic_stat_hp") or (Image.open(icon_path("ic_stat_hp")).convert("RGBA") if icon_path("ic_stat_hp").exists() else None)
    hp = trim(hp_im) if hp_im is not None else None
    me = HELMET          # 「나」 표지의 투구 — 고리 안쪽만
    shield, hourglass = trim(pub("blacksmith/shield.png")), trim(pub("ui/cmd/endTurn.png"))
    icons = {
        **received,
        # 건물 — 메인 · 마을 배경에서 지금 보이는 그 건물 (기획자 확인 2026-10-24)
        "ic_bld_palace": medal(scene("backgrounds/main-day.jpg", 270, 450, 330), fill=1),
        "ic_bld_barracks": medal(scene("backgrounds/main-day.jpg", 0, 780, 230), fill=1),
        "ic_bld_market": medal(scene("backgrounds/main-day.jpg", 120, 1030, 280), fill=1),
        "ic_bld_academy": medal(scene("backgrounds/ext-day.jpg", 360, 470, 290), fill=1),
        "ic_bld_farm": medal(scene("backgrounds/ext-day.jpg", 0, 780, 260), fill=1),
        "ic_bld_hospital": medal(scene("backgrounds/ext-day.jpg", 420, 840, 260), fill=1),
        "ic_bld_forge": medal(scene("backgrounds/ext-day.jpg", 262, 1250, 216), fill=1),   # 모루 앞 대장장이 (기획자 선택 — 갑옷 진열대 판은 버렸다)
        # 승 · 무 · 패 — 결과 화면 배경의 병사들
        "ic_rec_win": medal(scene("backgrounds/result-win.jpg", 52, 1040, 260), fill=1),
        "ic_rec_draw": medal(scene("backgrounds/result-draw.jpg", 0, 380, 230), fill=1),
        "ic_rec_lose": medal(scene("backgrounds/result-lose.jpg", 400, 1240, 286), fill=1),
        "ic_rec_fallen": medal(gray(me), bg=DARK, fill=1.0, shadow=False),
        # 결말
        "ic_out_king": medal(trim(pub("ui/pieces/king-foe.png")).rotate(-62, expand=True, resample=Image.BICUBIC), bg=ASH, fill=.86, dy=8),          # 붉은 기물이 붉은 바탕에 묻혀 잿빛으로
        "ic_out_supply": medal(trim(pub("terrain/supply.png")), bg=GOLD, fill=.84),
        "ic_out_surrender": medal(trim(pub("icons/raid-surrender.png")), bg=ASH, fill=.8),
        "ic_out_timelimit": medal(trim(pub("ui/gi/timer.png")), bg=GOLD, fill=.78),     # 부정의 뜻이 아니라 군량고 탈취와 같은 밀빛
        "ic_out_objective": medal(on_canvas((fit(trim(pub("icons/records.png")), 200), (28, 28)),
                                            (fit(trim(pub("icons/seal-mine.png")), 96), (138, 132))), bg=PAPER, fill=.86),
        # 목표
        "ic_goal_survive": medal(on_canvas((fit(shield, 190), (33, 20)), (fit(hourglass, 120), (120, 120))), bg=BLUE, fill=.86),
        "ic_goal_unitlost": medal(gray(me), bg=(78, 34, 30), fill=1.0, shadow=False),
        "ic_goal_timeup": medal(hourglass, bg=BLUE, fill=.74),
        "ic_goal_protect": medal(on_canvas((fit(me, 160), (14, 26)), (fit(shield, 170), (92, 72))), bg=BLUE, fill=.9),
        # 대전 모드 — 기획자 지정: 3 vs 3은 Rock · King · Bishop 한 줄, 5 vs 5는 Pawn · Rock · King · Bishop · Knight W자
        "ic_mode_3v3": pieces_row(["rock", "king", "bishop"], [0, .06, 0], .62, .78),
        "ic_mode_5v5": pieces_w(["pawn", "king", "knight"], ["rock", "bishop"]),
        # 그 밖
        "ic_grade_score": on_canvas(*[(fit(trim(pub(f"icons/grade-{g}.png")), 120), (8 + i * 32, 68 - (2 - abs(i - 2)) * 14))
                                      for i, g in enumerate(["d", "c", "b", "a", "s"])]),
        # 가득 찼다 — 군량고 앞에 자루 셋을 겹겹이 (기획자 지정: 둘을 더 놓아 꽉 차 보이게)
        "ic_grain_full": on_canvas((fit(trim(pub("terrain/supply.png")), 200), (0, 2)),
                                   (fit(trim(pub("market/grain.png")), 100), (150, 104)),
                                   (fit(trim(pub("market/grain.png")), 112), (68, 140)),
                                   (fit(trim(pub("market/grain.png")), 116), (138, 138))),
        "ic_grain_rate": on_canvas((fit(trim(pub("market/grain.png")), 200), (14, 34)), (plus_mark(104), (140, 140))),   # 시간당 충전 = 「+」
        "ic_bandit": medal(Image.open(PUB / "battle/bandit.jpg").convert("RGBA"), fill=1.02),
        "ic_forge_assign": on_canvas((fit(trim(pub("blacksmith/weapon.png")), 200), (14, 20)),
                                     (fit(shield, 150), (104, 98))),
        # 컬렉션 도시 효과 인장
        "ic_seal_forge": seal("blacksmith/weapon.png"),
        "ic_seal_graincap": seal("terrain/supply.png"),
        "ic_seal_grainrate": seal("market/grain.png"),
        "ic_seal_heal": seal("market-items/tang-yak.png"),
        "ic_seal_raidloot": seal("market/grain.png", "blacksmith/shield.png"),
        "ic_seal_raidresp": seal("icons/raid-prepare.png"),
        "ic_seal_research": seal("icons/records.png"),
    }
    if hp is not None:
        # HP 기준 아래로 — HP 아이콘의 위 절반을 어둡게 (기획자의 HP 그림과 짝)
        h = fit(hp, round(INNER * 2 * .8))
        a = np.array(h).astype(np.float32)
        cut = a.shape[0] // 2
        a[:cut, :, :3] *= .28
        h = Image.fromarray(a.astype(np.uint8))
        icons["ic_goal_hpbelow"] = medal(h, bg=BLUE, fill=.8)
    return icons


def main() -> int:
    global RING, INNER, HELMET
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", help="눈으로 볼 대조 시트를 이 경로에 쓴다")
    args = ap.parse_args()
    if not PUB.is_dir() or not RING_SRC.exists():
        print("재료(public/ · 메달 테 원본)가 없어 건너뛴다")
        return 0
    RING, INNER, HELMET = load_ring()
    icons = build()
    for k, im in icons.items():
        icon_path(k).parent.mkdir(parents=True, exist_ok=True)
        im.save(icon_path(k), optimize=True)
    print(f"{len(icons)}장 → {ICONS.relative_to(ROOT)}/{{장}}/")
    if args.sheet:
        from PIL import ImageFont
        try:
            font = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 15)
        except OSError:
            font = None
        cols, W, H = 8, 170, 190
        rows = (len(icons) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * W, rows * H), (62, 48, 36))
        d = ImageDraw.Draw(sheet)
        for i, (k, im) in enumerate(icons.items()):
            x, y = (i % cols) * W, (i // cols) * H
            t = im.resize((160, 160), Image.LANCZOS)
            sheet.paste(t, (x + 5, y + 2), t)
            d.text((x + W / 2, y + 172), k[3:], fill=(240, 230, 210), font=font, anchor="mm")
        sheet.save(args.sheet)
        print(f"대조 시트 → {args.sheet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
