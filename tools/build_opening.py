#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""가입 오프닝 그림(`assets/opening/opening_video/`)을 웹용으로 굽는다.

    python tools/build_opening.py [--force]

| 원본 | 출력 |
|---|---|
| `opening_video/opening_2.png` ~ `opening_8.png` | `public/opening/signup-2.jpg` ~ `signup-8.jpg` |

도시 이름을 지은 뒤 석양 위에 대사가 뜨는 동안 0.5초마다 한 장씩 겹쳐 넘어가 8에서 멈춘다
(`client/src/screens/NewGameScreen.tsx`). **1은 굽지 않는다** — 도시 이름 짓기 화면의 배경
(`backgrounds/new-city.jpg`, `npm run ui`가 `assets/icons/create_city.png`에서 굽는다)이 같은
장면이라 그 위에서 2부터 겹친다. 원본이 360×640이라 크기는 그대로 두고 JPEG로만 바꾼다
(기획자 확정 — 같은 장면을 `opening video.mp4`에서 720p로 뽑는 안은 택하지 않았다).

────────────────────────────────────────────────────────────────
입장 영상은 걷어 냈다 (2026-10-19)
────────────────────────────────────────────────────────────────

같은 날 오전에는 이 도구가 시간대별 입장 영상(`입장동영상_*.mp4`)도 구웠다. 영상의 첫 · 끝 장면이
간판 · 메인 그림과 달라 이질감이 커서, 화면의 그림을 그대로 움직이는 **입장 하늘**(`EnterSky.tsx`,
하늘 그림은 `build_backgrounds.py`의 `SINGLES`)로 바꿨다. 영상 굽기(ffmpeg · 프레임 자르기)는 그 커밋의
부모에 있다.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'opening' / 'opening_video'
OUT = ROOT / 'packages' / 'client' / 'public' / 'opening'

# 가입 오프닝 그림 번호 (1은 도시 이름 짓기의 배경이다 — 위 머리말)
SIGNUP = range(2, 9)


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    force = '--force' in sys.argv
    if not SRC.is_dir():
        print(f'· {SRC.relative_to(ROOT)} 이 없다 — 가입 오프닝 그림을 건너뛴다')
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    built = skipped = 0
    for n in SIGNUP:
        src = SRC / f'opening_{n}.png'
        out = OUT / f'signup-{n}.jpg'
        if not src.is_file():
            print(f'· opening_video/{src.name} 이 없다 — 건너뛴다')
            continue
        if not force and out.is_file() and out.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue
        Image.open(src).convert('RGB').save(out, 'JPEG', quality=90, optimize=True)
        built += 1
    print(f'가입 오프닝 그림: 구움 {built} · 그대로 {skipped}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
