#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""꼬마 장수 애니메이션 시트 굽기 — Gemini로 받은 사이 칸 + 지금 다섯 자세 → 장수마다 18칸 (2026-11-16).

    npm run anims [-- --only 가후 간옹] [--preview 대조.png]

| 입력 | 쓰임 |
|---|---|
| `assets/CharsAnim/원본/{이름}_{평상|이동|공격|마법|피격}.jpg` | 기획자가 받아 둔 사이 칸(검정 바탕). 한 장 안의 칸은 같은 쪽을 본다 |
| `packages/client/public/actions-hd/{id}.webp` (`npm run actions`가 먼저) | 지금 다섯 자세(240² × 5) — 시트의 0 · 4 · 9 · 14칸, 크기 · 발 자리 · 방향의 기준 |

출력 `packages/client/public/anims/{id}.png` — 110 × 143 × 18칸(아래 110²가 지금 시트의 칸, 위 33px은 머리 위 여백) — 전투 판.
     `packages/client/public/anims-hd/{id}.webp` — 240 × 312 × 18칸, 같은 그림의 큰 것 — 메뉴의 장수 그림(`OfficerActionArt`, 뽑기 · 오프닝 · 장수 카드).(`ANIM` 표가 칸 번호, `client/src/battle/poses.ts`의 `ANIM`과 같다).
**원본이 없는 동작은 지금 자세를 되풀이해 채운다(stub)** — 화면은 언제나 같은 18칸을 읽고, 원본이 오면 그 장수만 다시 굽는다.

굽기의 판단:
- 바탕: 가장자리에서 이어진 어두운 곳(`BLACK`)을 지운다. 안쪽에 갇힌 넓은 순검정(팔과 몸 사이 틈)도 지운다.
- 칸 가르기: 줄 · 열마다 「기대 자리 근처에서 그림이 가장 적은 세로(가로)줄」을 경계로 잡는다.
- 크기: 원본 한 장에 배율 하나 — 그 동작의 기준 자세(평상 · 이동 · 공격 · 마법 · 피격)와 몸 덩어리 키가 같아지게. 쓰러짐은 첫 칸만 잰다.
- 발 · 가운데: 몸 덩어리의 바닥을 **기준 자세의 몸 바닥**에, 무게 중심을 기준 자세의 무게 중심에. 지금 시트의 발은 장수마다
  그림자 위로 0~20px(240 해상도) 떠 있다 — 칸의 95%(`FOOT`)에 박으면 평상 동작 때 몸이 내려앉았다 올라왔다(감택 17px, 2026-11-16).
  그림자는 `FOOT`(지금 시트의 그림자 자리) 그대로.
- 머리 위 여백(`HEAD`): 치켜든 무기가 칸 위로 나가도 되게(2026-11-16 기획자 — 동작은 차례인 장수 하나가 잠깐 하므로
  윗칸 · 판 밖으로 삐져나가도 어색하지 않다). 판은 아래 정사각을 지금 자리에 맞추고 여백을 칸 위로 내밀어 그린다
  (`BattleScene`의 `FRAME_H` · 원점). 지금 다섯 자세는 여백을 안 쓴다.
- 칸 넘침: 줄일 칸이 있으면 그 장 전체를 같은 비율로 줄인다(한 동작 안의 크기를 지킨다).
- 손 보정: `tools/anim_frames_fix.tsv`(이름 · 동작 · 배율 곱)가 원본 한 장의 배율에 곱해진다 — 기준 자세와 몸 생김이 달라
  키로 잰 배율이 어긋나는 장(감녕 평상: 0칸은 웅크린 정면, 사이 칸은 선 자세라 머리가 0.75배로 작게 구워졌다).
  눈으로 본 머리 크기로 맞춘다.
- 방향: 칸을 기준 자세 · 그 좌우 반전과 견줘 반전 쪽이 더 닮은 칸이 많으면 그 장 전체를 뒤집는다(한 장 안은 같은 쪽).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_action_sheets import shadow_layer  # noqa: E402 — 지금 시트와 같은 발밑 그림자

ROOT = Path(__file__).resolve().parent.parent
OFFICERS = ROOT / "packages" / "data" / "generated" / "officers.json"
SRC = ROOT / "assets" / "CharsAnim" / "원본"
HD = ROOT / "packages" / "client" / "public" / "actions-hd"
OUT = ROOT / "packages" / "client" / "public" / "anims"
OUT_HD = ROOT / "packages" / "client" / "public" / "anims-hd"
HD_QUALITY = 88     # build_action_sheets.py의 큰 시트와 같은 값

CELL = 240          # 굽는 해상도(지금 시트와 같은 칸) — 마지막에 110으로 줄인다
SIZE = 110
HEAD = 72           # 머리 위 여백(굽는 해상도) — 칸 높이 312 = 240 × 1.3, 줄이면 110 × 143. poses.ts의 FRAME_H와 짝
CELL_H = CELL + HEAD
SIZE_H = round(SIZE * CELL_H / CELL)
FOOT_SQ = round(CELL * 0.95)   # build_action_sheets.py의 「발끝 = 칸의 95%」(정사각 안에서)
FOOT = HEAD + FOOT_SQ          # 여백을 얹은 칸에서
BLACK = 26          # 바탕으로 볼 밝기(최댓값 채널) — JPEG 잡티를 넘는 만큼
HOLE_BLACK = 14     # 안쪽에 갇힌 틈은 더 어두워야 바탕으로 본다
HOLE_MIN = 250      # 갇힌 틈의 최소 넓이(원본 픽셀) — 머리카락 · 옷의 어두운 칸을 지키려고
SPECK_MIN = 24      # 이보다 작은 덩어리는 잡티

# 칸 번호 — 0 · 4 · 9 · 14는 지금 자세(actions-hd의 0~4칸), 나머지는 원본 이미지의 칸
# (이름, 원본 동작, 그 원본의 몇째 칸, 없을 때 채울 지금 자세)
ANIM = [
    ("idle", None, None, 0),
    ("idle1", "평상", 0, 0), ("idle2", "평상", 1, 0), ("idle3", "평상", 2, 0),
    ("walk", None, None, 1),
    ("walk1", "이동", 0, 1), ("walk2", "이동", 1, 1),
    ("atk1", "공격", 0, 2), ("atk2", "공격", 1, 2),
    ("attack", None, None, 2),
    ("cast1", "마법", 0, 3), ("cast2", "마법", 1, 3), ("cast3", "마법", 2, 3), ("cast4", "마법", 3, 3),
    ("hurt", None, None, 4),
    ("fall1", "피격", 0, 4), ("fall2", "피격", 1, 4), ("fall3", "피격", 2, 4),
]
GRID = {"평상": (1, 3), "이동": (1, 2), "공격": (1, 2), "마법": (2, 2), "피격": (1, 3)}
FIX = ROOT / "tools" / "anim_frames_fix.tsv"
BASE = {"평상": 0, "이동": 1, "공격": 2, "마법": 3, "피격": 4}   # 크기 · 방향의 기준 자세(지금 시트의 칸)


def load_fix() -> dict[tuple[str, str], float]:
    """(이름, 동작) → 배율 곱. 표가 없으면 비어 있다. 모르는 동작은 말한다(오타가 조용히 안 걸리지 않게)."""
    out: dict[tuple[str, str], float] = {}
    if not FIX.exists():
        return out
    for n, line in enumerate(FIX.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.startswith("#") or line.startswith("이름	"):
            continue
        name, motion, mul = (c.strip() for c in line.split("	")[:3])
        if motion not in GRID:
            raise SystemExit(f"{FIX.name}:{n}: 모르는 동작 「{motion}」 — {' · '.join(GRID)}")
        out[(name, motion)] = float(mul)
    return out


FIXES = load_fix()

# ───────────────────────────── 지금 자세 ─────────────────────────────

def body_of(alpha: np.ndarray) -> np.ndarray:
    """가장 큰 덩어리(몸 + 든 것) — 그림자 · 효과 조각을 뺀 몸."""
    lab, n = ndimage.label(alpha > 160)
    if n == 0:
        return alpha > 160
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))


BODY_ROW = 0.35     # 몸통 키는 「폭이 가장 넓은 줄의 이만큼 이상인 줄」만 센다 — 머리 위로 든 무기 · 부채를 빼려고


def measure(mask: np.ndarray, trunk: bool = False) -> tuple[float, float, float]:
    """(몸통 키, 무게 중심 x, 바닥 y). 키는 가는 것(치켜든 무기 · 사슬)을 뺀 몸통의 위아래다 — 첫 시험에서
    무기를 치켜든 평상 칸이 그만큼 작게 구워졌다(감녕 · 간옹)."""
    ys, xs = np.nonzero(mask)
    w = mask.sum(1)
    rows = np.nonzero(w >= w.max() * BODY_ROW)[0] if trunk else np.nonzero(w)[0]
    return float(rows.max() - rows.min() + 1), float(xs.mean()), float(ys.max())


def signature(rgba: np.ndarray) -> np.ndarray:
    """방향을 견주는 지문 — 몸 둘레 상자를 32×32 회색으로."""
    m = body_of(rgba[..., 3])
    ys, xs = np.nonzero(m)
    crop = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype(np.float32)
    g = (crop[..., :3].mean(-1) * (crop[..., 3] / 255.0)).astype(np.uint8)
    v = np.asarray(Image.fromarray(g).resize((32, 32), Image.BILINEAR), np.float32)
    return (v - v.mean()) / (v.std() + 1e-6)

# ───────────────────────────── 원본 자르기 ─────────────────────────────

def foreground(rgb: np.ndarray) -> np.ndarray:
    mx = rgb.max(-1)
    dark = mx <= BLACK
    lab, _ = ndimage.label(dark)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, edge[edge > 0])
    # 안쪽에 갇힌 넓은 순검정(팔과 몸 사이의 틈)
    hole_lab, hn = ndimage.label((mx <= HOLE_BLACK) & ~bg)
    if hn:
        sizes = ndimage.sum(np.ones_like(hole_lab), hole_lab, range(1, hn + 1))
        big = np.nonzero(sizes >= HOLE_MIN)[0] + 1
        bg |= np.isin(hole_lab, big)
    fg = ~bg
    lab, n = ndimage.label(fg)
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        fg &= np.isin(lab, np.nonzero(sizes >= SPECK_MIN)[0] + 1)
    return fg


def cuts(profile: np.ndarray, n: int) -> list[int]:
    """기대 자리(등분) 근처에서 그림이 가장 적은 줄 — 그런 줄이 여럿이면 빈 띠의 가운데."""
    L = len(profile)
    out = [0]
    for i in range(1, n):
        c = round(i * L / n)
        w = round(L / n * 0.35)
        seg = profile[c - w:c + w]
        lo = seg.min()
        idx = np.nonzero(seg <= lo)[0]
        # 가장 긴 연속 구간의 가운데
        runs = np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1)
        best = max(runs, key=len)
        out.append(c - w + int(best[len(best) // 2]))
    out.append(L)
    return out


def split_cells(path: Path, rows: int, cols: int) -> list[np.ndarray]:
    rgb = np.asarray(Image.open(path).convert("RGB"))
    fg = foreground(rgb)
    ys = cuts(fg.sum(1), rows)
    cells = []
    for r in range(rows):
        band = fg[ys[r]:ys[r + 1]]
        xs = cuts(band.sum(0), cols)
        for c in range(cols):
            m = fg[ys[r]:ys[r + 1], xs[c]:xs[c + 1]]
            im = rgb[ys[r]:ys[r + 1], xs[c]:xs[c + 1]]
            rgba = np.dstack([im, (m * 255).astype(np.uint8)])
            yy, xx = np.nonzero(m)
            cells.append(rgba[yy.min():yy.max() + 1, xx.min():xx.max() + 1])
    return cells

# ───────────────────────────── 맞추기 ─────────────────────────────

def fit_of(cell: np.ndarray, scale: float, foot: float) -> float:
    """이 칸을 이 배율로 놓으면 칸에 들어가려고 더 줄여야 하는 비율(1이면 그대로) — 폭, 그리고 발 위 높이."""
    h, w = cell.shape[:2]
    nw = max(1, round(w * scale))
    ys = np.nonzero(body_of(cell[..., 3]).any(1))[0]
    above = (ys.max() + 1) * scale   # 몸 바닥이 기준 자세의 발에 오므로, 칸 꼭대기(여백 위끝)까지 남는 높이는 foot
    return min(1.0, CELL / nw, foot / above if above > foot else 1.0)


def place(cell: np.ndarray, scale: float, base: tuple[float, float, float], note: list[str], tag: str,
          shadow_w: float) -> np.ndarray:
    """원본 칸을 배율대로 줄여 240² 칸에 — 몸 바닥은 발 자리, 무게 중심은 기준 자세의 것."""
    h, w = cell.shape[:2]
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    im = Image.fromarray(cell, "RGBA").convert("RGBa").resize((nw, nh), Image.LANCZOS).convert("RGBA")
    a = np.asarray(im)
    _, cx, bottom = measure(body_of(a[..., 3]))
    ox = round(base[1] - cx)
    foot = base[2]   # 기준 자세의 몸 바닥 — 발이 그림자 위에 뜬 만큼까지 같게
    oy = round(foot - bottom)
    # 그래도 칸을 넘으면 그 칸만 줄인다(앞에서 장 전체를 맞추므로 대개 안 온다 — 안전장치)
    fit = min(1.0, CELL / nw, (foot + (nh - bottom)) / nh if oy < 0 else 1.0)
    if fit < 0.999:
        note.append(f"{tag} 칸에 맞춰 ×{fit:.2f}")
        return place(cell, scale * fit, base, note, tag + "'", shadow_w) if fit > 0.3 else np.zeros((CELL_H, CELL, 4), np.uint8)
    ox = min(max(ox, 0), CELL - nw)
    canvas = Image.new("RGBA", (CELL, CELL_H))
    canvas.alpha_composite(im, (ox, max(oy, 0)))
    # 발밑 그림자 — 지금 자세에는 있고 Gemini 칸에는 없다(프롬프트가 막는다). 크기는 장수의 평상 자세 폭으로 하나
    c = np.asarray(canvas).astype(np.float32)
    a = c[..., 3] / 255.0
    # 그림자는 정사각 칸에서 낸다(높이에 비례해 띄우므로) — 지금 시트와 같은 자리
    sh = np.pad(shadow_layer((CELL, CELL), base[1], FOOT_SQ, shadow_w), ((HEAD, 0), (0, 0)))
    out_a = a + sh * (1.0 - a)
    rgb = c[..., :3] * a[..., None] / np.maximum(out_a, 1e-5)[..., None]
    return np.dstack([rgb, out_a * 255.0]).round().clip(0, 255).astype(np.uint8)


def motion_frames(name: str, motion: str, base_rgba: np.ndarray, note: list[str], shadow_w: float) -> list[np.ndarray] | None:
    path = next((p for p in (SRC / f"{name}_{motion}.{e}" for e in ("jpg", "jpeg", "png", "webp")) if p.exists()), None)
    if path is None:
        return None
    rows, cols = GRID[motion]
    cells = split_cells(path, rows, cols)
    base_m = body_of(base_rgba[..., 3])
    # 평상만 몸통 키로 잰다 — 무기 · 부채를 치켜드는 동작이라. 옆모습(이동 · 공격)은 몸이 좁아 몸통 키가 몸을 자른다
    trunk = motion == "평상"
    base = measure(base_m, trunk)
    hs = [measure(body_of(c[..., 3]), trunk)[0] for c in cells]
    src_h = hs[0] if motion == "피격" else float(np.median(hs))
    scale = base[0] / src_h
    mul = FIXES.get((name, motion))
    if mul:
        scale *= mul
    # 방향 — 기준 자세와 견줘 반전이 더 닮은 칸이 많으면 그 장 전체를 뒤집는다
    sig = signature(base_rgba)
    flips = sum(float((signature(c) * sig).mean()) < float((signature(c[:, ::-1]) * sig).mean()) for c in cells)
    flip = flips * 2 > len(cells)
    if flip:
        cells = [np.ascontiguousarray(c[:, ::-1]) for c in cells]
    # 칸을 넘는 칸이 있으면 그 장 전체를 같은 비율로 — 칸마다 따로 줄이면 한 동작 안에서 몸이 커졌다 작아졌다 한다
    # (감녕 평상: 손 보정 뒤 치켜든 철퇴 칸만 줄어 머리가 1.0 · 0.88 · 0.78 · 0.97로 출렁였다)
    fit = min(fit_of(c, scale, base[2]) for c in cells)
    if fit < 0.999:
        scale *= fit
        note.append(f"{motion}: 칸을 넘는 칸이 있어 장 전체 ×{fit:.2f}")
    note.append(f"{motion}: {len(cells)}칸 · 배율 {scale:.3f}{f' (손 보정 ×{mul})' if mul else ''}{' · 좌우 뒤집음' if flip else ''}")
    return [place(c, scale, base, note, f"{motion}{i + 1}", shadow_w) for i, c in enumerate(cells)]

# ───────────────────────────── 장수 하나 ─────────────────────────────

def build(o: dict) -> tuple[np.ndarray, list[str], list[str]]:
    sheet = np.asarray(Image.open(HD / f"{o['id']}.webp").convert("RGBA"))
    # 지금 다섯 자세(240²) 위에 여백을 얹는다 — 크기 · 발 · 무게 중심을 재는 기준도 이 칸
    poses = [np.pad(sheet[:, i * CELL:(i + 1) * CELL], ((HEAD, 0), (0, 0), (0, 0))) for i in range(5)]
    note: list[str] = []
    # 그림자 폭의 기준 — 평상 자세 몸 폭(240² 칸). 지금 시트는 원본 몸 폭으로 쟀으니 닮은 크기가 된다
    xs = np.nonzero(body_of(poses[0][..., 3]).any(0))[0]
    shadow_w = float(xs.max() - xs.min() + 1)
    got: dict[str, list[np.ndarray] | None] = {}
    for m in GRID:
        try:
            got[m] = motion_frames(o["name"], m, poses[BASE[m]], note, shadow_w)
        except Exception as e:   # 한 장이 망가져도 나머지는 굽는다 — 그 동작은 stub
            note.append(f"{m}: 실패 — {e}")
            got[m] = None
    frames, real = [], []
    for key, m, i, fallback in ANIM:
        if m and got.get(m):
            frames.append(got[m][i])
            real.append(m)
        else:
            frames.append(poses[fallback])
    return np.concatenate(frames, axis=1), note, sorted(set(real), key=list(GRID).index)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="+", metavar="이름")
    ap.add_argument("--preview", type=Path, help="원본이 있는 장수의 240² 대조 시트를 여기에")
    a = ap.parse_args()
    by_id = {o["id"]: o for o in json.loads(OFFICERS.read_text(encoding="utf-8"))}
    OUT.mkdir(parents=True, exist_ok=True)
    OUT_HD.mkdir(parents=True, exist_ok=True)
    previews, done = [], []
    # 지금 시트가 있는 것 전부 — 장수 260명 + 명단 밖의 그림(도적 `bandit`)도 stub으로 채운다(화면이 18칸만 읽게)
    sheets = sorted(p.stem for p in HD.glob("*.webp"))
    todo = [by_id.get(k, {"id": k, "name": k}) for k in sheets]
    for o in todo:
        if a.only and o["name"] not in a.only:
            continue
        big, note, real = build(o)
        im = Image.fromarray(big, "RGBA").convert("RGBa")
        im.resize((SIZE * len(ANIM), SIZE_H), Image.LANCZOS).convert("RGBA").save(OUT / f"{o['id']}.png", optimize=True)
        Image.fromarray(big, "RGBA").save(OUT_HD / f"{o['id']}.webp", "WEBP", quality=HD_QUALITY, alpha_quality=100, method=6)
        if real:
            done.append(o["name"])
            print(f"{o['name']}: {' · '.join(real)}  ({'; '.join(note)})")
            previews.append(Image.fromarray(big, "RGBA"))
    stub = sum(1 for o in todo if not a.only or o["name"] in a.only) - len(done)
    print(f"원본이 있는 장수 {len(done)}명 · stub {stub}명 → {OUT}")
    if a.preview and previews:
        W = previews[0].width
        out = Image.new("RGBA", (W, CELL_H * len(previews)), (60, 60, 70, 255))
        for i, p in enumerate(previews):
            out.alpha_composite(p, (0, i * CELL_H))
        out.save(a.preview)
    return 0


if __name__ == "__main__":
    sys.exit(main())
