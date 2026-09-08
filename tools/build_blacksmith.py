#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""assets/blacksmith/ 의 장비 그림을 웹용으로 굽는다 (2026-09-09).

    python tools/build_blacksmith.py [--force]

| 원본 | 출력 |
|---|---|
| `LV{해금레벨}_{무기\|방어구}_{이름}.png` (693×378, 물건 하나를 중앙에 놓은 사진) | `public/blacksmith/{id}.png` 폭 480 |

원본 파일명은 엑셀에서 온 한글 이름이라 화면 코드가 그대로 쓰기 번거롭다 —
`packages/data/generated/equipment.json`(정본)의 로마자 `id`로 옮겨 적는다.
그래서 이 도구는 **레벨·종류·이름 세 값으로 원본을 찾고 `id`로 저장**한다 —
매핑표를 손으로 한 벌 더 적지 않고 정본을 그대로 읽는다.

원본이 알파 채널은 있어도 물건 하나를 평평한 배경 위에 놓은 사진이라
(`imagePrompt`가 "isolated on a plain neutral background") 알파 경계상자로
잘라 봐야 캔버스 전체가 나온다 — `build_market.py`의 아이콘과 달리 **비율만
유지한 채 폭을 줄인다**(`market-sign.png`·배너와 같은 결).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
SRC = ROOT / "assets" / "blacksmith"
OUT = ROOT / "packages" / "client" / "public" / "blacksmith"
EQUIPMENT_JSON = ROOT / "packages" / "data" / "generated" / "equipment.json"

MAX_WIDTH = 480
KIND_KO = {"weapon": "무기", "armor": "방어구"}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
    args = ap.parse_args()

    if not SRC.is_dir():
        print(f"{SRC} 가 없어 건너뛴다 — 그림 없이도 빌드는 정상이다")
        return 0

    equipment = json.loads(EQUIPMENT_JSON.read_text(encoding="utf-8"))

    OUT.mkdir(parents=True, exist_ok=True)
    made: list[str] = []
    skipped = 0
    missing: list[str] = []

    for item in equipment:
        stem = f"LV{item['unlockLevel']}_{KIND_KO[item['kind']]}_{item['name']}"
        src = SRC / f"{stem}.png"
        if not src.exists():
            missing.append(f"{stem}.png (← {item['id']})")
            continue
        dst = OUT / f"{item['id']}.png"
        if dst.exists() and not args.force and dst.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue
        with Image.open(src) as im:
            rgb = im.convert("RGB")
            if rgb.width > MAX_WIDTH:
                ratio = MAX_WIDTH / rgb.width
                rgb = rgb.resize((MAX_WIDTH, round(rgb.height * ratio)), Image.LANCZOS)
            rgb.save(dst, quality=90)
        made.append(f"{item['id']}.png (← {stem}.png)")

    print(f"출력 → {OUT}")
    print(f"  구운 것 {len(made)}종" + (f" (그대로 둔 것 {skipped}개)" if skipped else ""))
    if made:
        print(f"  {' · '.join(made)}")
    if missing:
        print(f"  ! 못 찾은 원본: {' · '.join(missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
