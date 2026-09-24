#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""가챠 개봉 섬광 — 등급별 폭발 프레임을 **그려서** 굽는다 (2026-09-24, pptx 78·79쪽).

    python tools/build_burst.py [--preview 대조.png]

| 출력 | 쓰는 곳 |
|---|---|
| `public/market/burst-{b,a,s,e}.webp` 6×4칸 (칸당 `FRAME`px, 24프레임) | 단발 뽑기의 가운데 섬광 · 8연 뽑기의 여덟 섬광 |

────────────────────────────────────────────────────────────────
왜 그리는가 — 이미지 생성 AI의 4칸(`reveal-*.png`)을 대신한다
────────────────────────────────────────────────────────────────

옛 `reveal-*.png`는 2×2 네 칸이라 260ms마다 **뚝뚝 끊겨** 넘어갔고, 알파 가장자리에
생성 AI 특유의 점 잡음이 남아 있었다(기획자: 「너무 허접하다」). AI는 **같은 폭발의
연속된 순간**을 그리지 못한다 — 칸마다 다른 폭발이 된다. 그래서 파티클·빛줄기·충격파를
시간 함수로 직접 계산한다. **난수는 시드 고정**이라 몇 번을 돌려도 같은 그림이 나온다
(그림이 git에 없으므로 이 도구가 곧 원본이다 — `assets/`가 없어도 돈다).

────────────────────────────────────────────────────────────────
층 — 아래에서 위로 더한다 (가산 합성, 톤매핑은 마지막에 한 번)
────────────────────────────────────────────────────────────────

1. **모임** (t < 0.14) — 바깥에서 가운데로 빨려 드는 빛 알갱이. 터지기 전 「숨」이다.
2. **섬광** — 흰 핵 + 등급색 번짐. t≈0.16에 가장 밝고 빠르게 식는다.
3. **충격파** — 두 겹의 고리가 퍼지며 옅어진다(둘째는 늦고 가늘다).
4. **빛줄기** — 방사형 줄기가 뻗었다 사그라들며 천천히 돈다 + 가로 렌즈 플레어 한 줄.
5. **불티** — 바깥으로 튀어 나가 감속하는 알갱이(꼬리 있음), 흰색에서 등급색으로 식는다.
6. **반짝이** — 끝자락에 남아 깜빡이는 네 갈래 별.

색은 `흰 성분 × 흰색 + 등급 성분 × 등급색`을 더한 뒤 `1 − e^(−x)`로 부드럽게 눌러
하얗게 타 버리지 않게 한다. 알파는 **밝기 그 자체**다(rgb는 알파로 나눠 되돌린다) —
그래서 어떤 배경 위에서도 보통 합성으로 「빛」처럼 얹힌다.

등급이 높을수록 줄기·불티가 많고 고리가 한 겹 더 있다(E는 금가루가 오래 남는다).
**색은 기획자 지정** — B 파랑 · A 빨강 · S 보라 · E 황금(2026-09-24).
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "packages" / "client" / "public" / "market"

FRAME = 384          # 칸 한 변(px). 화면의 `BURST_FRAME_PX`와 같은 값이어야 한다
COLS, ROWS = 6, 4    # 24프레임. 화면의 `BURST_COLS`·`BURST_FRAMES`와 같은 값이어야 한다
FRAMES = COLS * ROWS

# 등급별 — 색(0~1) · 줄기 수 · 불티 수 · 고리 겹 · 반짝이 수 · 시드
GRADES = {
    "b": dict(color=(0.25, 0.55, 1.00), rays=12, sparks=70,  rings=1, glitter=10, seed=11),
    "a": dict(color=(1.00, 0.22, 0.18), rays=16, sparks=100, rings=2, glitter=16, seed=23),
    "s": dict(color=(0.72, 0.30, 1.00), rays=22, sparks=140, rings=2, glitter=24, seed=37),
    "e": dict(color=(1.00, 0.76, 0.22), rays=28, sparks=190, rings=3, glitter=44, seed=53),
}


def ease_out(x: float) -> float:
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3


def bump(t: float, start: float, peak: float, end: float) -> float:
    """start에서 0 → peak에서 1 → end에서 0 (앞은 빠르게, 뒤는 길게)"""
    if t <= start or t >= end:
        return 0.0
    if t < peak:
        return math.sin((t - start) / (peak - start) * math.pi / 2)
    return (1 - (t - peak) / (end - peak)) ** 1.6


def splat(field: np.ndarray, x: float, y: float, radius: float, amount: float) -> None:
    """가우스 점 하나를 더한다 — 좌표는 픽셀"""
    if amount <= 0:
        return
    r = max(radius, 0.6)
    n = int(math.ceil(r * 3))
    x0, x1 = max(0, int(x) - n), min(FRAME, int(x) + n + 2)
    y0, y1 = max(0, int(y) - n), min(FRAME, int(y) + n + 2)
    if x0 >= x1 or y0 >= y1:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1]
    field[y0:y1, x0:x1] += amount * np.exp(-((xs - x) ** 2 + (ys - y) ** 2) / (2 * r * r))


def streak(field: np.ndarray, ax: float, ay: float, bx: float, by: float,
           radius: float, amount: float) -> None:
    """꼬리 — a에서 b로 점을 촘촘히 찍되 꼬리 쪽을 옅게"""
    steps = max(2, int(math.hypot(bx - ax, by - ay) / max(radius * 0.7, 0.7)))
    for i in range(steps + 1):
        k = i / steps
        splat(field, ax + (bx - ax) * k, ay + (by - ay) * k, radius * (0.45 + 0.55 * k), amount * k * k / steps * 4)


def render_frame(g: dict, t: float, rng_state: dict) -> np.ndarray:
    c = FRAME / 2
    ys, xs = np.mgrid[0:FRAME, 0:FRAME].astype(np.float32)
    dx, dy = (xs - c) / c, (ys - c) / c
    r = np.sqrt(dx * dx + dy * dy)
    ang = np.arctan2(dy, dx)

    white = np.zeros((FRAME, FRAME), np.float32)
    tint = np.zeros((FRAME, FRAME), np.float32)

    # 1. 모임 — 바깥에서 가운데로
    gather = bump(t, 0.0, 0.10, 0.16)
    if gather > 0:
        for (a0, d0) in rng_state["gather"]:
            k = ease_out(t / 0.14)
            d = d0 * (1 - k) * c
            x, y = c + math.cos(a0) * d, c + math.sin(a0) * d
            streak(tint, x + math.cos(a0) * 10, y + math.sin(a0) * 10, x, y, 1.6, 0.9 * gather)
        tint += 0.7 * gather * np.exp(-(r / (0.05 + 0.05 * t / 0.14)) ** 2)

    # 2. 섬광 — 흰 핵과 등급색 번짐
    flash = bump(t, 0.10, 0.16, 0.55)
    if flash > 0:
        white += 2.6 * flash * np.exp(-(r / (0.06 + 0.10 * flash)) ** 2)
        tint += 1.4 * flash * np.exp(-(r / (0.22 + 0.18 * flash)) ** 2)
        tint += 0.35 * flash * np.exp(-(r / 0.75) ** 2)          # 넓은 은은한 빛
    # 잔광 — 가운데가 한동안 은은히 남는다
    tint += 0.35 * bump(t, 0.14, 0.30, 1.0) * np.exp(-(r / 0.30) ** 2)

    # 3. 충격파
    for i in range(g["rings"]):
        start = 0.14 + 0.07 * i
        life = (t - start) / (0.42 - 0.04 * i)
        if 0 < life < 1:
            radius = 0.10 + 0.88 * ease_out(life)
            width = 0.022 + 0.04 * life - 0.006 * i
            amp = (1 - life) ** 2.2 * (1.2 - 0.3 * i)
            ring = np.exp(-((r - radius) / width) ** 2)
            tint += amp * ring
            white += 0.5 * amp * np.exp(-((r - radius) / (width * 0.35)) ** 2)

    # 4. 빛줄기 — 뻗었다 사그라들며 돈다
    rays = bump(t, 0.12, 0.20, 0.80)
    if rays > 0:
        spin = 0.35 * t
        acc = np.zeros_like(r)
        for (a0, length, thick) in rng_state["rays"]:
            d = np.angle(np.exp(1j * (ang - a0 - spin)))
            reach = length * (0.4 + 0.6 * ease_out((t - 0.12) / 0.25))
            along = np.clip(1 - r / reach, 0, 1)
            acc += np.exp(-(d / thick) ** 2) * along ** 1.4
        tint += 2.0 * rays * acc
        white += 1.1 * rays * acc * np.exp(-(r / 0.45) ** 2)
        # 가로 렌즈 플레어 — 「고급」의 대부분은 이 한 줄이 한다
        flare = np.exp(-(dy / 0.012) ** 2) * np.exp(-(np.abs(dx) / (0.35 + 0.45 * rays)) ** 1.2)
        white += 0.9 * rays * flare
        tint += 0.6 * rays * np.exp(-(dy / 0.03) ** 2) * np.exp(-(np.abs(dx) / 0.8) ** 1.2)

    # 5. 불티 — 튀어 나가 감속, 흰색 → 등급색
    if t > 0.14:
        tt = t - 0.14
        for (a0, speed, drag, size, life) in rng_state["sparks"]:
            if tt > life:
                continue
            travel = speed * (1 - math.exp(-drag * tt)) / drag
            prev = speed * (1 - math.exp(-drag * max(tt - 0.07, 0))) / drag
            fade = (1 - tt / life) ** 1.3
            x, y = c + math.cos(a0) * travel * c, c + math.sin(a0) * travel * c
            px, py = c + math.cos(a0) * prev * c, c + math.sin(a0) * prev * c
            hot = math.exp(-tt * 6)
            streak(tint, px, py, x, y, size, 1.6 * fade)
            streak(white, px, py, x, y, size * 0.55, 1.4 * fade * hot)

    # 6. 반짝이 — 끝자락의 네 갈래 별
    for (x0, y0, born, dur, size) in rng_state["glitter"]:
        k = (t - born) / dur
        if 0 < k < 1:
            tw = math.sin(k * math.pi) * (0.6 + 0.4 * math.sin(k * 18))
            x, y = c + x0 * c, c + y0 * c
            px, py = (xs - x) / size, (ys - y) / size
            star = (np.exp(-(py / 0.10) ** 2) * np.exp(-np.abs(px) / 0.9)
                    + np.exp(-(px / 0.10) ** 2) * np.exp(-np.abs(py) / 0.9))
            white += 0.9 * tw * star
            tint += 0.8 * tw * np.exp(-(px * px + py * py) / 0.5)

    col = np.array(g["color"], np.float32)
    rgb = white[..., None] * 1.0 + tint[..., None] * col[None, None, :]
    rgb = 1 - np.exp(-rgb * 1.35)                         # 부드럽게 눌러 하얗게 타지 않게
    # 가장자리 페이드 — 칸 경계에서 빛이 잘려 보이지 않게
    edge = np.clip((1 - r) / 0.12, 0, 1)
    rgb *= edge[..., None]
    alpha = np.clip(rgb.max(axis=2), 0, 1)
    safe = np.where(alpha > 1e-4, alpha, 1)[..., None]
    straight = np.clip(rgb / safe, 0, 1)
    out = np.concatenate([straight, alpha[..., None]], axis=2)
    return (out * 255 + 0.5).astype(np.uint8)


def particles(g: dict) -> dict:
    rng = np.random.default_rng(g["seed"])
    return {
        "gather": [(rng.uniform(0, 2 * math.pi), rng.uniform(0.35, 0.8)) for _ in range(18)],
        "rays": [(rng.uniform(0, 2 * math.pi), rng.uniform(0.6, 1.05), rng.uniform(0.010, 0.030))
                 for _ in range(g["rays"])],
        "sparks": [(rng.uniform(0, 2 * math.pi), rng.uniform(1.6, 4.2), rng.uniform(3.5, 7.0),
                    rng.uniform(1.2, 2.8), rng.uniform(0.35, 0.8)) for _ in range(g["sparks"])],
        "glitter": [(*(lambda a, d: (math.cos(a) * d, math.sin(a) * d))(rng.uniform(0, 2 * math.pi), rng.uniform(0.15, 0.8)),
                     rng.uniform(0.30, 0.75), rng.uniform(0.18, 0.30), rng.uniform(7, 15))
                    for _ in range(g["glitter"])],
    }


def build(key: str) -> Image.Image:
    g = GRADES[key]
    state = particles(g)
    sheet = Image.new("RGBA", (FRAME * COLS, FRAME * ROWS), (0, 0, 0, 0))
    for i in range(FRAMES):
        # 마지막 칸이 완전히 사라진 상태가 되도록 t는 0..1을 끝까지 쓴다
        t = i / (FRAMES - 1)
        frame = Image.fromarray(render_frame(g, t, state), "RGBA")
        sheet.paste(frame, ((i % COLS) * FRAME, (i // COLS) * FRAME))
    return sheet


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", type=Path, help="어두운 배경에 합성한 대조 그림을 여기 쓴다")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    sheets = {}
    for key in GRADES:
        sheet = build(key)
        path = OUT / f"burst-{key}.webp"
        sheet.save(path, "WEBP", quality=88, method=6)
        sheets[key] = sheet
        print(f"  {path.relative_to(ROOT)}  {sheet.size[0]}×{sheet.size[1]}  {path.stat().st_size // 1024} KB")
    if args.preview:
        bg = Image.new("RGBA", (FRAME * COLS, FRAME * ROWS * len(sheets)), (34, 28, 24, 255))
        for i, s in enumerate(sheets.values()):
            layer = Image.new("RGBA", bg.size, (0, 0, 0, 0))
            layer.paste(s, (0, i * FRAME * ROWS))
            bg = Image.alpha_composite(bg, layer)
        bg.convert("RGB").resize((bg.width // 3, bg.height // 3)).save(args.preview)
        print(f"  대조 → {args.preview}")


if __name__ == "__main__":
    main()
