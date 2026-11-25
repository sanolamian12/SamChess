"""축하 화면의 도입부 그림 — `assets/icons/ui/celebrate_intro/<종류>/` → `packages/client/public/ui/intro-<종류>-*.{png,jpg}`.

도입부(`Celebrate`의 `intro`)는 축하음의 「쾅」(5초) 전까지 도는 5초짜리 장면이다(2026-11-21 기획자 — 대장간부터).

- 물건(모루 · 망치)은 **순수 초록 바탕**으로 받는다 — 달궈진 검의 붉은빛이 꼬마 그림의 자홍과 가까워 함께 깎이므로.
  초록이 얼마나 섞였나(`g − max(r, b)`)로 알파를 매기고 색을 되섞는다(`F = B + (P − B) / a`).
- 빛(섬광 · 불꽃)은 **순수 검정 바탕** 그대로 JPG로 굽는다 — 화면에서 `mix-blend-mode: screen`으로 더하므로 오릴 것이 없다.

물건 그림은 경계상자로 자르지 않는다 — 화면(`style.css`의 `.cin-forge`)이 망치가 칼날을 맞는 자리를 **원본 그림 안의 비율**로
적어 두었다. 같은 구도로 다시 받으면 그대로 맞고, 구도가 바뀌면 그 값을 다시 잰다.

    python tools/build_celebrate_intro.py [--force]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icons" / "ui" / "celebrate_intro"
OUT = ROOT / "packages" / "client" / "public" / "ui"

# (종류, 원본 이름) → (나갈 이름, 긴 변 최대 px, 바탕)
ITEMS: dict[tuple[str, str], tuple[str, int, str]] = {
    ("forge", "forge_anvil.png"): ("intro-forge-anvil.png", 1024, "green"),
    ("forge", "forge_hammer.png"): ("intro-forge-hammer.png", 1100, "green"),
    ("forge", "forge_flash_1.png"): ("intro-forge-flash-1.jpg", 900, "black"),
    ("forge", "forge_flash_2.png"): ("intro-forge-flash-2.jpg", 900, "black"),
    ("forge", "forge_flash_3.png"): ("intro-forge-flash-3.jpg", 900, "black"),
    ("forge", "forge_sparks.png"): ("intro-forge-sparks.jpg", 900, "black"),
    # 태학(2026-11-22) — 선비 · 누대는 오리고, 하늘은 그 자체가 바탕(JPG), 별 · 섬광은 검정 바탕 그대로
    ("academy", "academy_scholar.png"): ("intro-academy-scholar.png", 1100, "green"),
    ("academy", "academy_terrace.png"): ("intro-academy-terrace.png", 1600, "green"),
    ("academy", "academy_sky.png"): ("intro-academy-sky.jpg", 1672, "photo"),
    ("academy", "academy_star_1.png"): ("intro-academy-star-1.jpg", 400, "black"),
    ("academy", "academy_star_2.png"): ("intro-academy-star-2.jpg", 400, "black"),
    ("academy", "academy_flash.png"): ("intro-academy-flash.jpg", 900, "black"),
    # 도시 증축(2026-11-22) — 카메라가 거중기 기어에 바짝 다가가므로 거중기 · 기어는 원본 크기 그대로
    ("city", "city_bg.png"): ("intro-city-bg.jpg", 1672, "photo"),
    ("city", "city_crane.png"): ("intro-city-crane.png", 1536, "green"),
    ("city", "city_gear.png"): ("intro-city-gear.png", 900, "green"),
    ("city", "city_load.png"): ("intro-city-load.png", 700, "green"),
    ("city", "city_dragon.png"): ("intro-city-dragon.png", 900, "green"),
    ("city", "city_glint.png"): ("intro-city-glint.jpg", 500, "black"),
    ("city", "city_rays.png"): ("intro-city-rays.jpg", 900, "black"),
    # 장수 모집(2026-11-25 기획자, `Design/장수모집연출/시나리오.html`) — 석양 광장(4:3 창에 꽉, 해는 그림 안 50% · 41%) ·
    # 역광 실루엣 다섯(한 명씩, 발끝이 그림 높이 약 97%) · 해 · 번쩍 · 먼지 둘
    ("recruit", "recruit_bg.png"): ("intro-recruit-bg.jpg", 1448, "photo"),
    **{("recruit", f"recruit_walker_{i}.png"): (f"intro-recruit-walker-{i}.png", 900, "green") for i in range(1, 6)},
    ("recruit", "recruit_sun.png"): ("intro-recruit-sun.jpg", 900, "black"),
    ("recruit", "recruit_flash.png"): ("intro-recruit-flash.jpg", 900, "black"),
    ("recruit", "recruit_dust.png"): ("intro-recruit-dust-1.jpg", 1200, "black"),
    ("recruit", "recruit_dust2.png"): ("intro-recruit-dust-2.jpg", 1200, "black"),
}

# 초록이 이만큼 이하로 섞였으면 불투명, 이만큼 이상이면 투명(바탕 실측 g − max(r,b) ≈ 237)
SPILL_LO, SPILL_HI = 24.0, 200.0


def key_green(rgb: np.ndarray) -> np.ndarray:
    p = rgb.astype(np.float32)
    spill = p[:, :, 1] - np.maximum(p[:, :, 0], p[:, :, 2])
    # 바탕색은 **초록이 짙은 칸**에서 잰다 — 누대처럼 물건이 가장자리에 닿는 그림은 테두리 중앙값이 초록이 아니다
    bg = np.median(p[spill > SPILL_HI], axis=0)
    a = 1.0 - np.clip((spill - SPILL_LO) / (SPILL_HI - SPILL_LO), 0, 1)
    safe = np.maximum(a, 1e-3)[:, :, None]
    fg = np.clip(bg + (p - bg) / safe, 0, 255)
    # 남은 초록 기(가장자리 · 금속에 비친 것)를 걷는다 — 초록이 빨강 · 파랑 중 큰 쪽을 넘지 않게
    fg[:, :, 1] = np.minimum(fg[:, :, 1], np.maximum(fg[:, :, 0], fg[:, :, 2]) + 6)
    out = np.zeros((*rgb.shape[:2], 4), dtype=np.uint8)
    out[:, :, :3] = fg.astype(np.uint8)
    out[:, :, 3] = (a * 255).round().astype(np.uint8)
    out[out[:, :, 3] == 0, :3] = 0
    return out


def shrink(im: Image.Image, longest: int) -> Image.Image:
    scale = longest / max(im.size)
    if scale >= 1:
        return im
    size = (round(im.width * scale), round(im.height * scale))
    if im.mode == "RGBA":
        return im.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")
    return im.resize(size, Image.LANCZOS)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if not SRC.is_dir():
        print(f"{SRC} 가 없어 건너뛴다 — 도입부 그림이 없으면 화면은 기본 도입부(세 빛 나선)를 쓴다")
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    made = 0
    for (kind, name), (out_name, longest, bg) in ITEMS.items():
        src, dst = SRC / kind / name, OUT / out_name
        if not src.exists():
            print(f"  없음: {kind}/{name}")
            continue
        if dst.exists() and not args.force and dst.stat().st_mtime >= src.stat().st_mtime:
            continue
        with Image.open(src) as im:
            rgb = np.array(im.convert("RGB"))
        if bg == "green":
            shrink(Image.fromarray(key_green(rgb), "RGBA"), longest).save(dst, optimize=True)
        else:
            shrink(Image.fromarray(rgb, "RGB"), longest).save(dst, quality=86)
        made += 1
        print(f"  {out_name}")
    print(f"도입부 그림 {made}장 구움")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
