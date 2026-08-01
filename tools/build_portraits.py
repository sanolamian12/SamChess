#!/usr/bin/env python3
"""
초상화 → 웹용 축소본

    python tools/build_portraits.py [--size 96x120] [--force]

원본 `assets/Chars/*.png`는 440×540 · 평균 334KB로 260장이면 86MB다.
웹에 그대로 올릴 수 없으므로 보드 타일 크기로 줄여 `packages/client/public/portraits/`에 넣는다.

**파일명을 한글에서 로마자 id로 바꾼다.** URL 인코딩 문제를 없애고,
표시명이 바뀌어도 참조가 깨지지 않게 하기 위함이다 (officers.json의 id 규약과 같다).

의존성: Pillow. 원본은 읽기만 한다.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CHARS = ROOT / "assets" / "Chars"
OFFICERS = ROOT / "packages" / "data" / "generated" / "officers.json"
OUT = ROOT / "packages" / "client" / "public" / "portraits"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", default="96x120", help="가로x세로 (기본 96x120 — 원본 440×540의 세로비)")
    ap.add_argument("--force", action="store_true", help="이미 있어도 다시 만든다")
    args = ap.parse_args()

    w, h = (int(v) for v in args.size.lower().split("x"))

    if not CHARS.is_dir():
        print(f"원본을 찾을 수 없다: {CHARS}", file=sys.stderr)
        print("초상화는 git에 없다(.gitignore). 로컬 사본이 필요하다.", file=sys.stderr)
        return 1
    if not OFFICERS.is_file():
        print(f"먼저 `npm run extract`를 돌려라: {OFFICERS} 없음", file=sys.stderr)
        return 1

    officers = json.loads(OFFICERS.read_text(encoding="utf-8"))
    by_name = {o["name"]: o["id"] for o in officers}

    OUT.mkdir(parents=True, exist_ok=True)
    made = skipped = 0
    missing: list[str] = []

    for name, oid in sorted(by_name.items()):
        src = CHARS / f"{name}.png"
        if not src.is_file():
            missing.append(name)
            continue
        dst = OUT / f"{oid}.png"
        if dst.is_file() and not args.force:
            skipped += 1
            continue
        with Image.open(src) as im:
            # LANCZOS — 축소 품질이 가장 낫다. 초상화는 선이 가늘어 차이가 크다.
            im.convert("RGBA").resize((w, h), Image.LANCZOS).save(dst, optimize=True)
        made += 1

    # 대응되지 않는 파일이 남아 있으면 알린다 (이름 정규화가 어긋난 신호)
    orphans = sorted({p.stem for p in OUT.glob("*.png")} - set(by_name.values()))

    total = sum(p.stat().st_size for p in OUT.glob("*.png"))
    print(f"출력 → {OUT}")
    print(f"  {w}×{h}  생성 {made}장, 기존 유지 {skipped}장, 합계 {len(list(OUT.glob('*.png')))}장")
    print(f"  용량 {total / 1024 / 1024:.1f}MB (평균 {total / max(1, len(list(OUT.glob('*.png')))) / 1024:.0f}KB)")

    if missing:
        print(f"\n원본이 없는 장수 {len(missing)}명: {', '.join(missing[:10])}", file=sys.stderr)
    if orphans:
        print(f"대응 장수가 없는 출력 {len(orphans)}건: {', '.join(orphans[:10])}", file=sys.stderr)
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
