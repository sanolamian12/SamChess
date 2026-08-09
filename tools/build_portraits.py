#!/usr/bin/env python3
"""
에셋 → 웹용 축소본 (3종)

    python tools/build_portraits.py [--size 96x120] [--force]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/Chars-noback/*.png` 440×540 | `public/portraits/{id}.png` 96×120 | 보드 타일 |
| `assets/CharsInBattle/*.jpg` ~808² | `public/battle/{id}.jpg` 200² | 하단 패널·정보 팝업의 수묵화 |
| `assets/SpecialSkills/*.jpg` ~813×168 | `public/skills/{id}.jpg` 폭 720 | 고유기술 발동 연출 배너 |

**보드 타일은 배경을 뺀 `Chars-noback`을 쓴다 (2026-08-07 확정).** 양피지 배경째 잘린
`Chars`를 쓰면 타일마다 밝은 사각형이 생겨 판 위에서 유닛이 "붙은 종이"처럼 보인다.
`Chars`는 원본 보관용으로 남기고, `Chars-noback`에 없는 장수만 거기서 가져온다
(`remove_char_background.py`를 아직 안 돌린 신규 장수). 어느 쪽에서 몇 장이 왔는지 출력한다.

**파일명을 한글에서 로마자 id로 바꾼다.** URL 인코딩 문제를 없애고,
표시명이 바뀌어도 참조가 깨지지 않게 하기 위함이다 (officers.json의 id 규약과 같다).

**없으면 건너뛴다.** 에셋은 리포에 없다(기획자 방침 — PNG 233MB). 수묵화는 260명 중
일부만 있고, 없는 장수는 화면이 `Chars` 초상화로 대신한다. 여기서 막지 않는다.

의존성: Pillow. 원본은 읽기만 한다.
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CHARS = ROOT / "assets" / "Chars"
CHARS_NOBACK = ROOT / "assets" / "Chars-noback"
# 보드 타일이 볼 순서. 배경 뺀 쪽이 먼저고, 없는 장수만 원본에서 가져온다.
TILE_SOURCES = (CHARS_NOBACK, CHARS)
BATTLE_CHARS = ROOT / "assets" / "CharsInBattle"
SKILL_ART = ROOT / "assets" / "SpecialSkills"
GENERATED = ROOT / "packages" / "data" / "generated"
OFFICERS = GENERATED / "officers.json"
SKILLS = GENERATED / "uniqueSkills.json"
PUBLIC = ROOT / "packages" / "client" / "public"
OUT = PUBLIC / "portraits"
OUT_BATTLE = PUBLIC / "battle"
OUT_SKILL = PUBLIC / "skills"


def build_battle_portraits(by_name: dict[str, str], size: int, force: bool) -> None:
    """
    수묵화 흉상 → 하단 제어 패널·정보 팝업용 정사각 축소본.

    원본이 807~810px로 제각각이라 가운데를 잘라 정사각으로 맞춘다.
    **`X`로 시작하는 파일은 기획자가 걸러 둔 것**이라 건너뛴다.
    """
    if not BATTLE_CHARS.is_dir():
        print(f"  · 수묵화 — {BATTLE_CHARS.name} 없음, 건너뛴다")
        return

    OUT_BATTLE.mkdir(parents=True, exist_ok=True)
    made = skipped = 0
    unknown: list[str] = []

    for src in sorted(BATTLE_CHARS.iterdir()):
        if src.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        name = unicodedata.normalize("NFC", src.stem)
        if name.startswith("X"):          # 기획자가 걸러 둔 것
            continue
        oid = by_name.get(name)
        if oid is None:
            unknown.append(name)
            continue
        dst = OUT_BATTLE / f"{oid}.jpg"
        if dst.is_file() and not force:
            skipped += 1
            continue
        with Image.open(src) as im:
            im = im.convert("RGB")
            side = min(im.size)
            left, top = (im.width - side) // 2, (im.height - side) // 2
            im = im.crop((left, top, left + side, top + side))
            im.resize((size, size), Image.LANCZOS).save(
                dst, "JPEG", quality=88, optimize=True, subsampling=0)
        made += 1

    total = len(list(OUT_BATTLE.glob("*.jpg")))
    print(f"  · 수묵화 {size}² — 생성 {made}장, 기존 {skipped}장, 합계 {total}/{len(by_name)}명")
    if unknown:
        print(f"    대응 장수가 없는 파일 {len(unknown)}건: {', '.join(unknown[:8])}", file=sys.stderr)


def build_skill_art(width: int, force: bool) -> None:
    """
    고유기술 연출 배너 → 발동 시 2초 띄우는 가로 배너.

    파일명 규약은 `장수이름 기술이름.jpg`이고 기술명 자체에 공백이 있는 3종이 있어
    **양쪽 다 공백을 지우고** 비교한다 (`extract_data.py`의 `check_skill_art`와 같은 규칙).
    출력 이름은 보유자가 아니라 **기술 id**다 — A·B급은 여러 장수가 한 장을 공유한다.
    """
    if not SKILL_ART.is_dir():
        print(f"  · 연출 — {SKILL_ART.name} 없음, 건너뛴다")
        return
    if not SKILLS.is_file():
        print(f"  · 연출 — {SKILLS.name} 없음, 건너뛴다")
        return

    skills = json.loads(SKILLS.read_text(encoding="utf-8"))
    squash = lambda s: s.replace(" ", "")                       # noqa: E731
    by_squashed = {squash(s["name"]): s["id"] for s in skills}

    OUT_SKILL.mkdir(parents=True, exist_ok=True)
    made = skipped = 0
    unmatched: list[str] = []

    for src in sorted(SKILL_ART.iterdir()):
        if src.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        stem = unicodedata.normalize("NFC", src.stem)
        sid = by_squashed.get(squash(stem.rsplit(" ", 1)[-1])) if " " in stem else None
        if sid is None:
            unmatched.append(src.name)
            continue
        dst = OUT_SKILL / f"{sid}.jpg"
        if dst.is_file() and not force:
            skipped += 1
            continue
        with Image.open(src) as im:
            im = im.convert("RGB")
            height = max(1, round(im.height * width / im.width))
            im.resize((width, height), Image.LANCZOS).save(
                dst, "JPEG", quality=86, optimize=True)
        made += 1

    total = len(list(OUT_SKILL.glob("*.jpg")))
    print(f"  · 연출 폭 {width} — 생성 {made}장, 기존 {skipped}장, 합계 {total}/{len(skills)}종")
    if unmatched:
        print(f"    기술을 못 찾은 파일 {len(unmatched)}건: {', '.join(unmatched[:5])}", file=sys.stderr)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", default="96x120", help="가로x세로 (기본 96x120 — 원본 440×540의 세로비)")
    ap.add_argument("--battle-size", type=int, default=200, help="수묵화 한 변 (기본 200)")
    ap.add_argument("--skill-width", type=int, default=720, help="연출 배너 가로 (기본 720)")
    ap.add_argument("--force", action="store_true", help="이미 있어도 다시 만든다")
    args = ap.parse_args()

    w, h = (int(v) for v in args.size.lower().split("x"))

    if not any(d.is_dir() for d in TILE_SOURCES):
        print(f"원본을 찾을 수 없다: {' 도 ' .join(str(d) for d in TILE_SOURCES)}", file=sys.stderr)
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
    from_source = {d.name: 0 for d in TILE_SOURCES}
    fell_back: list[str] = []

    for name, oid in sorted(by_name.items()):
        src = next((d / f"{name}.png" for d in TILE_SOURCES if (d / f"{name}.png").is_file()), None)
        if src is None:
            missing.append(name)
            continue
        from_source[src.parent.name] += 1
        if src.parent != TILE_SOURCES[0]:
            fell_back.append(name)
        dst = OUT / f"{oid}.png"
        if dst.is_file() and not args.force:
            skipped += 1
            continue
        with Image.open(src) as im:
            # LANCZOS — 축소 품질이 가장 낫다. 초상화는 선이 가늘어 차이가 크다.
            #
            # RGBa(소문자 a = 알파를 곱해 둔 형식)를 거친다. 440×540 → 96×120은 4.5배
            # 축소라 한 픽셀이 20여 픽셀의 평균이 되는데, **투명한 픽셀의 RGB가 그 평균에
            # 섞이면 실루엣 가장자리에 배경색이 번진다.** Chars-noback은 배경을 알파로만
            # 지웠고 그 밑의 색이 파일마다 다르다 — 도구가 만든 255장은 검정(0,0,0),
            # 손으로 만든 5장은 양피지색(222,181,114)이 그대로 남아 있다.
            #
            # 실측하니 Pillow 12는 RGBA를 그냥 resize해도 같은 결과가 나온다(내부에서
            # 이미 알파를 고려한다 — 합성 이미지로 확인). 그래도 명시해 두는 편이 낫다:
            # 이 성질은 Pillow 버전에 딸린 것이고, 여기 원본에는 실제로 지울 색이 남아 있다.
            im.convert("RGBa").resize((w, h), Image.LANCZOS) \
              .convert("RGBA").save(dst, optimize=True)
        made += 1

    # 대응되지 않는 파일이 남아 있으면 알린다 (이름 정규화가 어긋난 신호)
    orphans = sorted({p.stem for p in OUT.glob("*.png")} - set(by_name.values()))

    total = sum(p.stat().st_size for p in OUT.glob("*.png"))
    where = ", ".join(f"{d}/{n}장" for d, n in from_source.items() if n)
    print(f"출력 → {PUBLIC}")
    print(f"  · 타일 {w}×{h} — 생성 {made}장, 기존 {skipped}장, 합계 {len(list(OUT.glob('*.png')))}장"
          f" ({total / 1024 / 1024:.1f}MB)")
    print(f"    원본: {where}")

    build_battle_portraits(by_name, args.battle_size, args.force)
    build_skill_art(args.skill_width, args.force)

    if fell_back:
        print(f"\n배경 제거본이 없어 {CHARS.name}에서 가져온 장수 {len(fell_back)}명: "
              f"{', '.join(fell_back[:10])}", file=sys.stderr)
        print(f"  → `python tools/remove_char_background.py --only <이름>` 로 만들 수 있다.",
              file=sys.stderr)
    if missing:
        print(f"\n원본이 없는 장수 {len(missing)}명: {', '.join(missing[:10])}", file=sys.stderr)
    if orphans:
        print(f"대응 장수가 없는 출력 {len(orphans)}건: {', '.join(orphans[:10])}", file=sys.stderr)
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
