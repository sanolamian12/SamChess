#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""동점 추첨 주사위 — 생성 영상에서 배경을 걷어 스프라이트로 굽는다 (2026-09-27, pptx 90쪽).

    python tools/build_dice.py [--preview 대조.png]

| 입력 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/icons/dice.mp4` (1280×720 · 24fps · 55프레임 · 소리 있음) | `public/battle/dice.webp` `COLS`×`ROWS`칸 (칸당 `CELL_W`×`CELL_H`) | 배치 화면이 열릴 때 동점이 있으면 굴린다(`ui/diceFx.ts`) |
| 〃 의 소리 | `public/effects/dice.mp3` | 같은 때 한 번 (`playSfx('dice')`) |

────────────────────────────────────────────────────────────────
왜 스프라이트인가 — 투명 동영상은 iOS에서 안 돈다
────────────────────────────────────────────────────────────────

알파가 있는 WebM(VP9)은 사파리가 못 튼다. 이 게임은 iOS도 과녁이라 **알파 WebP 한 장을
CSS `steps()`로 넘긴다** — 가챠 섬광(`build_burst.py`)과 같은 길이다. 마지막 칸에서
멈추므로(`forwards`) 「굴러서 멈췄다」가 그대로 남는다.

────────────────────────────────────────────────────────────────
배경 걷기 — 영상의 배경은 「검정」이 아니라 짙은 회색(≈15/255)이다
────────────────────────────────────────────────────────────────

1. **주사위** — 밝기 55 넘는 곳을 잡고, 닫기(9px)로 먹선 테두리·글자 틈을 메우고,
   **구멍을 채운다.** 구멍 채우기는 **판 둘레에 빈 테를 한 겹 두르고** 그 테에서
   범람시킨다 — 주사위가 화면 가장자리에 걸린 첫 프레임에서, 모서리와 주사위 사이에
   갇힌 배경을 「구멍」으로 오인해 검은 조각이 붙었다. 작은 조각(600px 미만)은 버리고
   1px 넓힌 뒤 가장자리를 1.2px 흐린다 — 이것이 주사위의 알파다. 색은 원본 그대로다.
2. **그림자** — 원본 그림자는 배경보다 **밝은 회색**이다(검정 위에 그려서). 그대로 알파를
   주면 양피지 위에서 뿌옇게 뜬다. 그래서 **밝기를 짙기로 뒤집어 검정 그림자**로 쓴다 —
   어떤 바탕에 얹어도 「바닥이 어두워진 곳」으로 읽힌다. 최대 0.55.
3. **워터마크** — 오른쪽 아래의 ✦(생성 도구의 표식)는 주사위가 지나지 않는 자리라 통째로 비운다.
4. **들어오는 모서리** — 주사위가 화면 왼쪽 위 **밖에서** 날아든다. 자른 틀의 왼쪽·위
   가장자리에서 알파를 `EDGE_FADE`px에 걸쳐 0으로 눕혀, 틀에 잘려 보이지 않고 **스며
   나오게** 한다.

원본이 없으면 알리고 건너뛴다(에셋 방침 — `assets/`는 git에 없다).
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icons" / "dice.mp4"
OUT_SHEET = ROOT / "packages" / "client" / "public" / "battle" / "dice.webp"
OUT_SOUND = ROOT / "packages" / "client" / "public" / "effects" / "dice.mp3"

# 자르는 틀(원본 좌표) — 55프레임의 알파 합집합이 (0..1010, 0..599)다. 비율 5:3
CROP = (0, 0, 1024, 614)
# 칸 한 변. 화면의 `DICE_CELL_W`·`DICE_CELL_H`·`DICE_COLS`·`DICE_FRAMES`와 같은 값이어야 한다
CELL_W, CELL_H = 480, 288
COLS = 8
EDGE_FADE = 70          # 들어오는 모서리(왼쪽·위)를 눕히는 폭, 원본 px
WATERMARK = (1080, 540)  # 이 점의 오른쪽 아래는 비운다(원본 px)

DICE_LUMA = 55          # 이 밝기를 넘으면 주사위
MIN_BLOB = 600          # 이보다 작은 조각은 버린다(px)
SHADOW_FLOOR = 19       # 배경(≈15)의 잡음 위부터 그림자로 센다
SHADOW_SPAN = 22
SHADOW_MAX = 0.55


def read_frames(path: Path) -> list[np.ndarray]:
    cap = cv2.VideoCapture(str(path))
    frames: list[np.ndarray] = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()
    return frames


def fill_holes(mask: np.ndarray) -> np.ndarray:
    """둘레에 빈 테를 두르고 거기서 범람시킨다 — 테에 닿지 않은 빈 곳이 구멍이다."""
    padded = cv2.copyMakeBorder(mask, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    flood = padded.copy()
    h, w = flood.shape
    cv2.floodFill(flood, np.zeros((h + 2, w + 2), np.uint8), (0, 0), 1)
    holes = (flood == 0)[1:-1, 1:-1]
    return mask | holes.astype(np.uint8)


def matte(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(rgb 0~255 float, 알파 0~1). rgb는 알파로 나누기 **전**(= 곱해진) 값이 아니라 본래 색이다."""
    wx, wy = WATERMARK
    luma = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32)

    mask = (luma > DICE_LUMA).astype(np.uint8)
    mask[wy:, wx:] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    mask = fill_holes(mask)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    keep = np.zeros_like(mask)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_BLOB:
            keep[labels == i] = 1
    keep = cv2.dilate(keep, np.ones((3, 3), np.uint8))
    dice = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 1.2)

    soft = cv2.GaussianBlur(luma, (0, 0), 2.5)
    shadow = np.clip((soft - SHADOW_FLOOR) / SHADOW_SPAN, 0, 1) * SHADOW_MAX
    shadow[wy:, wx:] = 0

    alpha = dice + (1 - dice) * shadow
    # 색 = 주사위 몫은 원본, 그림자 몫은 검정. 곱해진 값을 알파로 나눠 되돌린다
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB).astype(np.float32) * dice[..., None]
    rgb = np.where(alpha[..., None] > 1e-4, rgb / np.maximum(alpha[..., None], 1e-4), 0)
    return rgb, alpha


def edge_ramp(h: int, w: int) -> np.ndarray:
    """왼쪽·위 가장자리에서 0 → 1로 눕는 곱. 오른쪽·아래는 주사위가 안 닿는다."""
    ramp_x = np.clip(np.arange(w, dtype=np.float32) / EDGE_FADE, 0, 1)
    ramp_y = np.clip(np.arange(h, dtype=np.float32) / EDGE_FADE, 0, 1)
    smooth = lambda r: r * r * (3 - 2 * r)  # noqa: E731 — 끝이 딱딱하게 꺾이지 않게
    return smooth(ramp_y)[:, None] * smooth(ramp_x)[None, :]


def build_sheet(frames: list[np.ndarray]) -> Image.Image:
    x0, y0, cw, ch = CROP
    rows = -(-len(frames) // COLS)
    sheet = Image.new("RGBA", (COLS * CELL_W, rows * CELL_H), (0, 0, 0, 0))
    ramp = edge_ramp(ch, cw)
    for i, frame in enumerate(frames):
        rgb, alpha = matte(frame)
        rgb = rgb[y0:y0 + ch, x0:x0 + cw]
        alpha = alpha[y0:y0 + ch, x0:x0 + cw] * ramp
        rgba = np.dstack([np.clip(rgb, 0, 255), np.clip(alpha * 255, 0, 255)]).astype(np.uint8)
        cell = Image.fromarray(rgba, "RGBA").resize((CELL_W, CELL_H), Image.LANCZOS)
        sheet.paste(cell, ((i % COLS) * CELL_W, (i // COLS) * CELL_H))
    return sheet


def ffmpeg_exe() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


def build_sound() -> None:
    exe = ffmpeg_exe()
    if not exe:
        print("  · ffmpeg가 없어 소리는 건너뛴다")
        return
    OUT_SOUND.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [exe, "-v", "error", "-y", "-i", str(SRC), "-vn", "-c:a", "libmp3lame", "-q:a", "4", str(OUT_SOUND)],
        check=True,
    )
    print(f"  ✓ {OUT_SOUND.relative_to(ROOT)} ({OUT_SOUND.stat().st_size // 1024} KB)")


def preview(sheet: Image.Image, count: int, path: Path) -> None:
    """양피지 · 체크무늬 · 먹색 세 바탕 위에 다섯 순간을 얹어 본다."""
    picks = [0, count // 6, count // 3, count // 2, count - 1]
    bgs = [(235, 215, 170, 255), (60, 60, 60, 255), (30, 24, 18, 255)]
    out = Image.new("RGBA", (len(picks) * CELL_W, len(bgs) * CELL_H))
    for r, bg in enumerate(bgs):
        for c, i in enumerate(picks):
            cell = sheet.crop(((i % COLS) * CELL_W, (i // COLS) * CELL_H,
                               (i % COLS + 1) * CELL_W, (i // COLS + 1) * CELL_H))
            base = Image.new("RGBA", (CELL_W, CELL_H), bg)
            out.paste(Image.alpha_composite(base, cell), (c * CELL_W, r * CELL_H))
    out.save(path)
    print(f"  ✓ 대조 {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", type=Path)
    args = ap.parse_args()

    if not SRC.exists():
        print(f"· {SRC.relative_to(ROOT)} 없음 — 주사위는 건너뛴다 (화면은 그림 없이 순번만 보인다)")
        return
    frames = read_frames(SRC)
    if not frames:
        sys.exit(f"✗ {SRC} 에서 프레임을 못 읽었다")

    sheet = build_sheet(frames)
    OUT_SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_SHEET, "WEBP", quality=82, alpha_quality=90, method=6)
    rows = -(-len(frames) // COLS)
    print(f"  ✓ {OUT_SHEET.relative_to(ROOT)} — {len(frames)}프레임, {COLS}×{rows}칸 "
          f"({CELL_W}×{CELL_H}), {OUT_SHEET.stat().st_size // 1024} KB")
    print(f"    화면 상수: DICE_FRAMES = {len(frames)}, DICE_COLS = {COLS}, "
          f"DICE_CELL = {CELL_W}×{CELL_H}")
    build_sound()
    if args.preview:
        preview(sheet, len(frames), args.preview)


if __name__ == "__main__":
    main()
