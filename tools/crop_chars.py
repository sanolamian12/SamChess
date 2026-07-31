# -*- coding: utf-8 -*-
"""Images/ 의 3인 합성 이미지를 케릭터별로 잘라 Chars/ 에 저장한다.

파일명 규칙: <왼쪽>_<가운데>_<오른쪽>.png
크롭 영역  : 세로 111~650 (540px), 가로 26~465 / 466~905 / 906~1345 (각 440px)
             ※ 위 좌표는 양끝 포함(inclusive) 기준.

사용법:
    python crop_chars.py                # Images -> Chars
    python crop_chars.py --dry-run      # 저장 없이 계획만 출력
    python crop_chars.py --overwrite    # 기존 Chars 파일 덮어쓰기
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

# --- 크롭 규격 (양끝 포함 좌표) -------------------------------------------
TOP, BOTTOM = 111, 650                      # 세로: 540px
SLOTS = [(26, 465), (466, 905), (906, 1345)]  # 가로: 각 440px, 왼쪽->오른쪽 순
EXPECTED_SIZE = (1376, 768)                 # 원본 기대 크기
NAME_SEP = "_"
EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


OUT_SIZE = (SLOTS[0][1] - SLOTS[0][0] + 1, BOTTOM - TOP + 1)  # 440 x 540


def crop_boxes(size=EXPECTED_SIZE):
    """PIL crop() 용 박스 목록 (right/bottom 은 exclusive 이므로 +1).

    원본이 기대 크기와 다르면 좌표를 비율대로 환산한다. 이미지 생성기가 캔버스만
    다르게 뽑은 경우에도 같은 구도로 잘리도록 하기 위함.
    """
    sx, sy = size[0] / EXPECTED_SIZE[0], size[1] / EXPECTED_SIZE[1]
    top, bottom = round(TOP * sy), round((BOTTOM + 1) * sy)
    return [(round(x0 * sx), top, round((x1 + 1) * sx), bottom) for x0, x1 in SLOTS]


def unique_path(out_dir: Path, stem: str, ext: str, taken: set[str]) -> Path:
    """동명이인(중복 이름) 대비: 이미 쓰인 이름이면 _2, _3 … 을 붙인다."""
    candidate = stem
    n = 1
    while candidate.lower() in taken:
        n += 1
        candidate = f"{stem}_{n}"
    taken.add(candidate.lower())
    return out_dir / f"{candidate}{ext}"


def main() -> int:
    root = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="3인 이미지를 케릭터별로 크롭")
    ap.add_argument("--src", type=Path, default=root / "Images", help="원본 폴더")
    ap.add_argument("--dst", type=Path, default=root / "Chars", help="출력 폴더")
    ap.add_argument("--ext", default=".png", help="출력 확장자 (기본 .png)")
    ap.add_argument("--overwrite", action="store_true",
                    help="Chars 에 이미 있는 파일도 덮어쓴다")
    ap.add_argument("--dry-run", action="store_true", help="저장하지 않고 계획만 출력")
    ap.add_argument("--only", nargs="+", metavar="PATTERN",
                    help="원본 파일명에 이 문자열이 들어간 것만 처리 "
                         "(Chars 에서 직접 바꾼 이름을 지키면서 일부만 다시 뽑을 때)")
    args = ap.parse_args()

    # Windows 콘솔에서 한글 파일명이 깨지지 않도록
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    src, dst = args.src, args.dst
    if not src.is_dir():
        print(f"[오류] 원본 폴더가 없습니다: {src}")
        return 1
    if not args.dry_run:
        dst.mkdir(parents=True, exist_ok=True)

    # 하위 폴더(template 등)는 건드리지 않고 최상위 이미지만 처리
    files = sorted(p for p in src.iterdir()
                   if p.is_file() and p.suffix.lower() in EXTS)
    if args.only:
        files = [p for p in files if any(pat in p.stem for pat in args.only)]
        print(f"[--only] {len(files)}개 원본만 처리: {[p.name for p in files]}")
    if not files:
        print(f"[오류] {src} 에 처리할 이미지가 없습니다.")
        return 1

    taken: set[str] = set()
    if not args.overwrite:
        # 기존 Chars 파일과도 이름이 겹치지 않게
        taken |= {p.stem.lower() for p in dst.glob("*") if p.is_file()}

    made = skipped = 0
    warnings: list[str] = []

    for path in files:
        names = [n.strip() for n in path.stem.split(NAME_SEP)]
        if len(names) != len(SLOTS) or not all(names):
            warnings.append(f"이름 규칙 불일치 → 건너뜀: {path.name}")
            skipped += 1
            continue

        with Image.open(path) as im:
            im.load()
            boxes = crop_boxes(im.size)
            if im.size != EXPECTED_SIZE:
                warnings.append(
                    f"크기 다름 {im.size} (기대 {EXPECTED_SIZE}) → 좌표를 비율 환산해 크롭함: {path.name}")

            for name, box in zip(names, boxes):
                out = unique_path(dst, name, args.ext, taken)
                if args.dry_run:
                    print(f"[예정] {path.name} {box} -> {out.name}")
                else:
                    piece = im.crop(box)
                    if piece.size != OUT_SIZE:
                        piece = piece.resize(OUT_SIZE, Image.LANCZOS)
                    piece.save(out)
                    print(f"[저장] {out.name}  ({piece.width}x{piece.height})")
                made += 1

    print(f"\n원본 {len(files)}개 / 생성 {made}개 / 건너뜀 {skipped}개 → {dst}")
    if warnings:
        print("\n[확인 필요]")
        for w in warnings:
            print(" -", w)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
