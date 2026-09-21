#!/usr/bin/env python3
"""
에셋 → 웹용 축소본 (5종)

    python tools/build_portraits.py [--size 96x120] [--force]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/Chars/*.png` 440×540 **투명** | `public/portraits/{id}.png` 96×120 | 보드 타일 |
| `assets/CharsInBattle/*.jpg` ~808² | `public/battle/{id}.jpg` 200² | 하단 패널·정보 팝업의 수묵화 |
| `assets/SpecialSkills/label/*.jpg` ~813×168 | `public/skills/{id}.jpg` 폭 720 | 고유기술 라벨 (연출 3단 · 설명 팝업 · 랭킹) |
| `assets/SpecialSkills/scroll/scroll_anim.webp` 500×360 **투명** 16칸 | `public/skills/scroll.webp` 가로 띠 16칸, 공통 경계로 자름 | 연출 1·4단 — 두루마리 펴기/말기 |
| `assets/SpecialSkills/actionbook/{기술명}/{기술명}_{1..4}.png·jpg` 640×360 | `public/skills/action/{id}/{1..4}.jpg` | 연출 2단 — 기술 장면 넉 장 |

**두루마리는 움직이는 그림 한 장(`scroll_anim.webp`)에서 굽는다 (2026-09-18 기획자 지정).**
예전 원본 `scroll_{1..16}.png`와 **픽셀까지 같은** 16칸 × 0.1초다(같은 이름의 `.png`는
APNG로 같고, `.gif`는 알파가 1비트라 가장자리가 깨져 안 쓴다). 브라우저에 움직이는
그림을 그대로 틀지 않고 **가로 띠 한 장**으로 펴서 내보낸다 — 움직이는 그림은
①거꾸로(말기) 못 틀고 ②같은 주소로 다시 틀면 처음부터 안 돌며 ③안 보이는 동안
시계가 가는지가 브라우저마다 달라, 시간표(`skillFxFrame`)와 맞출 수 없다. 띠는
`background-position`만 옮기면 되고 한 번 받으면 칸 사이에 빈 프레임이 없다.

**16칸은 한 경계로 자른다.** 원본 좌우·위아래가 투명하고, 칸마다 따로 자르면 펴는 동안
크기가 흔들린다 — `build_status_fx.py`와 같은 이유. **자른 경계가 바뀌면 `style.css`의
`.fx-stage` 비율과 `.fx-paper` 자리(종이 안쪽)도 따라 바뀌어야 한다** — 도구가 찍어 준다.

**`assets/Chars/`는 배경이 없다 (2026-08-07 기획자 교체).** 원래 양피지 배경째 잘린
그림이었는데 `remove_char_background.py`로 배경을 지운 260장이 그 자리를 대신했다.
한동안 `Chars`(원본) / `Chars-noback`(배경 제거본) 둘로 나뉘어 있었으나 지금은 하나다 —
**타일 원본은 `Chars` 하나뿐이고 폴백할 곳이 없다.**

**파일명을 한글에서 로마자 id로 바꾼다.** URL 인코딩 문제를 없애고,
표시명이 바뀌어도 참조가 깨지지 않게 하기 위함이다 (officers.json의 id 규약과 같다).

**없으면 건너뛴다.** 에셋은 리포에 없다(기획자 방침). 폴더가 통째로 없으면 그 종류를
건너뛰고, 장수별로 빠진 것은 이름을 찍어 알린다. 여기서 빌드를 막지는 않는다.

의존성: Pillow. 원본은 읽기만 한다.
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
CHARS = ROOT / "assets" / "Chars"
BATTLE_CHARS = ROOT / "assets" / "CharsInBattle"
SKILL_ART = ROOT / "assets" / "SpecialSkills" / "label"
SKILL_SCROLL = ROOT / "assets" / "SpecialSkills" / "scroll"
SKILL_ACTION = ROOT / "assets" / "SpecialSkills" / "actionbook"
GENERATED = ROOT / "packages" / "data" / "generated"
OFFICERS = GENERATED / "officers.json"
SKILLS = GENERATED / "uniqueSkills.json"
PUBLIC = ROOT / "packages" / "client" / "public"
OUT = PUBLIC / "portraits"
OUT_BATTLE = PUBLIC / "battle"
OUT_SKILL = PUBLIC / "skills"
OUT_SCROLL = OUT_SKILL / "scroll.webp"
OUT_ACTION = OUT_SKILL / "action"
SCROLL_FRAMES = 16
"""두루마리 칸 수. `client/src/ui/skillFx.ts`의 `SCROLL_FRAMES`와 같아야 한다."""
SCROLL_FRAME_MS = 100
"""두루마리 한 칸. 원본에 적힌 칸 길이가 이와 다르면 알린다 — 재생 속도는 시간표가 정한다."""
SCROLL_ALPHA_MIN = 8
"""경계를 잴 때 이보다 옅은 알파는 없는 것으로 본다."""
SCROLL_SPECK = 5
"""경계를 잴 때 이 폭(px)보다 작은 점은 없는 것으로 본다. 2026-09-18 원본은 **모든 칸의 오른쪽
아래 (498~499, 299~300)에 2×2 회색 점**이 있어(생성 도구 흔적으로 보인다) 경계가 원본 오른쪽
끝까지 늘어났다 — 점은 자른 상자 밖이라 화면에도 안 나온다."""
SCROLL_ROLLER = 67
"""롤러 한 쪽의 폭(원본 px) — 다 편 칸에서 경계 8 → 종이 75, 종이 420 → 경계 487. 롤러는 펴는 동안
크기가 안 바뀌므로 칸마다 `경계 ± 롤러`가 펴진 종이다(`skillFx.ts`의 `SCROLL_OPEN`)."""
SCROLL_PAPER = (75, 45, 420, 315)
"""다 편 칸(16번)에서 종이 안쪽 — 원본 좌표 (왼 롤러 끝, 위, 오른 롤러 시작, 아래). 눈으로 잰 값이다."""
ACTION_FRAMES = 4
"""기술 장면 칸 수. `client/src/ui/skillFx.ts`의 `ACTION_MS` 길이와 같아야 한다."""
ACTION_SIZE = (640, 360)
"""기술 장면 크기. 원본 하나(`한천감우_3`)가 640×361이라 맞춰 놓는다."""
IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def build_npc_art(w: int, h: int, battle_size: int, force: bool) -> str | None:
    """
    전투에만 서는 장수(도적떼, GDD §5.11)의 타일 · 수묵화 — **한 벌을 여럿이 함께 쓴다.**

    원본 경로와 굽힐 이름(`art.id`)은 `raid.json`(← `tools/extract_data.py`의 `RAID`)이 정한다.
    260명과 같은 규격·같은 처리(타일은 알파를 곱해 축소, 수묵화는 가운데 정사각)라 화면이 따로 다루지
    않는다. 원본이 없으면 건너뛴다. 굽힌 이름을 돌려준다 — 「대응 장수가 없는 출력」에서 빼려고.
    """
    spec = GENERATED / "raid.json"
    if not spec.is_file():
        return None
    art = json.loads(spec.read_text(encoding="utf-8"))["art"]
    aid = art["id"]
    tile_src = ROOT / "assets" / art["chars"]
    tile_dst = OUT / f"{aid}.png"
    if tile_src.is_file() and (force or not tile_dst.is_file()):
        with Image.open(tile_src) as im:
            im.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA").save(tile_dst, optimize=True)
        print(f"  · 도적떼 타일 → {tile_dst.name}")
    ink_src = ROOT / "assets" / art["inBattle"]
    ink_dst = OUT_BATTLE / f"{aid}.jpg"
    if ink_src.is_file() and (force or not ink_dst.is_file()):
        OUT_BATTLE.mkdir(parents=True, exist_ok=True)
        with Image.open(ink_src) as im:
            im = im.convert("RGB")
            side = min(im.size)
            left, top = (im.width - side) // 2, (im.height - side) // 2
            im = im.crop((left, top, left + side, top + side)).resize((battle_size, battle_size), Image.LANCZOS)
            im.save(ink_dst, "JPEG", quality=88, optimize=True, subsampling=0)
        print(f"  · 도적떼 수묵화 → {ink_dst.name}")
    return aid


def build_battle_portraits(by_name: dict[str, str], size: int, force: bool) -> None:
    """
    수묵화 흉상 → 하단 제어 패널·정보 팝업용 정사각 축소본.

    원본이 807~810px로 제각각이라 가운데를 잘라 정사각으로 맞춘다.
    **`X`로 시작하는 파일은 기획자가 걸러 둔 것**이라 건너뛴다.

    **2026-08-07에 260명이 다 채워졌다.** 그전에는 일부만 있어서 없는 장수는 화면이
    보드 타일 그림으로 대신했다. 그 폴백(`ui/art.ts`의 `setOfficerArt`)은 그대로 둔다 —
    합계가 260/260이 아니면 아래 줄에 그렇게 찍히니 여기서 막지 않는다.
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
    고유기술 라벨 → 가로 배너. 연출 3단(라벨 + 효과 설명)과 설명 팝업·랭킹이 쓴다.

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


def build_skill_scroll(force: bool) -> None:
    """
    움직이는 두루마리 한 장 → 16칸을 공통 알파 경계로 잘라 **가로 띠** WebP(무손실)로.
    연출 1단(펴기)·4단(말기)이 `background-position`으로 한 칸씩 넘긴다.

    **경계는 16칸의 합집합이다** — 칸마다 자르면 화면에서 크기가 흔들린다.
    """
    src = SKILL_SCROLL / "scroll_anim.webp"
    if not src.is_file():
        print(f"  · 두루마리 — {src.relative_to(ROOT)} 없음, 건너뛴다")
        return
    frames: list[Image.Image] = []
    slow: list[str] = []
    with Image.open(src) as im:
        count = getattr(im, "n_frames", 1)
        if count != SCROLL_FRAMES:
            print(f"  · 두루마리 — 칸이 {count}개다({SCROLL_FRAMES}개여야 한다), 건너뛴다", file=sys.stderr)
            return
        for i in range(count):
            im.seek(i)
            ms = im.info.get("duration")
            if ms and round(ms) != SCROLL_FRAME_MS:
                slow.append(f"{i + 1}번 {ms}ms")
            frames.append(im.convert("RGBA"))
    if slow:
        # 칸 길이는 원본이 아니라 `skillFx.ts`의 시간표가 정한다 — 원본을 바꾼 뜻이면 거기도 고친다
        print(f"    원본 칸 길이가 {SCROLL_FRAME_MS}ms가 아니다: {', '.join(slow)}", file=sys.stderr)

    box: tuple[int, int, int, int] | None = None
    spans: list[tuple[int, int]] = []    # 칸마다 좌우 경계 — 펴진 종이 폭을 찍는다
    for fr in frames:
        mask = fr.getchannel("A").point(lambda a: 255 if a >= SCROLL_ALPHA_MIN else 0)
        b = mask.filter(ImageFilter.MinFilter(SCROLL_SPECK)).getbbox()
        if b is None:
            spans.append((fr.width // 2, fr.width // 2))
            continue
        r = SCROLL_SPECK // 2    # 침식으로 깎인 만큼 되돌린다
        b = (max(0, b[0] - r), max(0, b[1] - r), min(fr.width, b[2] + r), min(fr.height, b[3] + r))
        spans.append((b[0], b[2]))
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]),
                                     max(box[2], b[2]), max(box[3], b[3]))
    if box is None:
        print("  · 두루마리 — 16칸이 전부 투명하다, 건너뛴다", file=sys.stderr)
        return

    w, h = box[2] - box[0], box[3] - box[1]
    # `style.css`에 옮겨 적을 값 — 비율과 종이 안쪽(자른 상자 기준 %)
    px0, py0, px1, py1 = SCROLL_PAPER
    paper = (f"left: {(px0 - box[0]) / w:.1%}; right: {(box[2] - px1) / w:.1%}; "
             f"top: {(py0 - box[1]) / h:.1%}; bottom: {(box[3] - py1) / h:.1%}")
    note = f"{w}×{h} (원본 경계 {box}) — CSS .fx-stage aspect-ratio: {w} / {h} · .fx-paper {{ {paper} }}"
    # `skillFx.ts`의 `SCROLL_OPEN`에 옮겨 적을 값 — 칸마다 펴진 종이(롤러 안쪽), 자른 상자 폭 비율
    opened = ", ".join(f"[{(l + SCROLL_ROLLER - box[0]) / w:.4f}, {(r - SCROLL_ROLLER - box[0]) / w:.4f}]"
                       for l, r in spans)
    print(f"    SCROLL_OPEN = [{opened}]")
    if OUT_SCROLL.is_file() and not force:
        print(f"  · 두루마리 {note} — 기존 파일 유지")
        return
    sheet = Image.new("RGBA", (w * SCROLL_FRAMES, h), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        sheet.paste(fr.crop(box), (i * w, 0))
    OUT_SKILL.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_SCROLL, "WEBP", lossless=True, quality=100, method=6)
    print(f"  · 두루마리 {note} — 띠 {OUT_SCROLL.stat().st_size // 1024}KB")


def build_skill_action(force: bool) -> None:
    """
    기술 장면 → `action/{기술id}/{1..4}.jpg`. 연출 2단이 1초·0.5초·0.5초·1초로 넘긴다.

    폴더 이름이 기술명이고(공백 없이) 그 안에 `{기술명}_{n}` 넉 장이 있다.
    원본에 png·jpg가 섞여 있어 확장자를 가리지 않고, 출력은 jpg 하나로 모은다 —
    불투명한 그림이라 png로 두면 49MB가 그대로 받아진다. 그림이 아닌 파일은 조용히 넘긴다.
    """
    if not SKILL_ACTION.is_dir():
        print(f"  · 기술 장면 — {SKILL_ACTION.name} 없음, 건너뛴다")
        return
    if not SKILLS.is_file():
        print(f"  · 기술 장면 — {SKILLS.name} 없음, 건너뛴다")
        return

    skills = json.loads(SKILLS.read_text(encoding="utf-8"))
    squash = lambda s: s.replace(" ", "")                       # noqa: E731
    by_squashed = {squash(s["name"]): s["id"] for s in skills}

    made = skipped = 0
    unmatched: list[str] = []
    short: list[str] = []
    seen: set[str] = set()
    for folder in sorted(p for p in SKILL_ACTION.iterdir() if p.is_dir()):
        name = unicodedata.normalize("NFC", folder.name)
        sid = by_squashed.get(squash(name))
        if sid is None:
            unmatched.append(name)
            continue
        seen.add(sid)
        frames: dict[int, Path] = {}
        for src in folder.iterdir():
            stem = unicodedata.normalize("NFC", src.stem)
            if src.suffix.lower() not in IMAGE_EXTS or "_" not in stem:
                continue
            n = stem.rsplit("_", 1)[-1]
            if n.isdigit() and 1 <= int(n) <= ACTION_FRAMES:
                frames[int(n)] = src
        if len(frames) < ACTION_FRAMES:
            short.append(f"{name}({len(frames)}/{ACTION_FRAMES})")
        out = OUT_ACTION / sid
        out.mkdir(parents=True, exist_ok=True)
        for n, src in sorted(frames.items()):
            dst = out / f"{n}.jpg"
            if dst.is_file() and not force:
                skipped += 1
                continue
            with Image.open(src) as im:
                im = im.convert("RGB")
                if im.size != ACTION_SIZE:
                    im = im.resize(ACTION_SIZE, Image.LANCZOS)
                im.save(dst, "JPEG", quality=85, optimize=True)
            made += 1

    print(f"  · 기술 장면 — 생성 {made}장, 기존 {skipped}장, 기술 {len(seen)}/{len(skills)}종")
    if unmatched:
        print(f"    기술을 못 찾은 폴더 {len(unmatched)}건: {', '.join(unmatched[:5])}", file=sys.stderr)
    if short:
        print(f"    칸이 모자란 기술 {len(short)}건: {', '.join(short[:5])}", file=sys.stderr)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", default="96x120", help="가로x세로 (기본 96x120 — 원본 440×540의 세로비)")
    ap.add_argument("--battle-size", type=int, default=200, help="수묵화 한 변 (기본 200)")
    ap.add_argument("--skill-width", type=int, default=720, help="연출 배너 가로 (기본 720)")
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
            #
            # RGBa(소문자 a = 알파를 곱해 둔 형식)를 거친다. 440×540 → 96×120은 4.5배
            # 축소라 한 픽셀이 20여 픽셀의 평균이 되는데, **투명한 픽셀의 RGB가 그 평균에
            # 섞이면 실루엣 가장자리에 배경색이 번진다.** 원본은 배경을 알파로만 지웠고
            # 그 밑의 색이 파일마다 다르다 — 도구가 만든 255장은 검정(0,0,0),
            # 손으로 만든 5장은 양피지색(222,181,114)이 그대로 남아 있다.
            #
            # 실측하니 Pillow 12는 RGBA를 그냥 resize해도 같은 결과가 나온다(내부에서
            # 이미 알파를 고려한다 — 합성 이미지로 확인). 그래도 명시해 두는 편이 낫다:
            # 이 성질은 Pillow 버전에 딸린 것이고, 여기 원본에는 실제로 지울 색이 남아 있다.
            im.convert("RGBa").resize((w, h), Image.LANCZOS) \
              .convert("RGBA").save(dst, optimize=True)
        made += 1

    npc = build_npc_art(w, h, args.battle_size, args.force)

    # 대응되지 않는 파일이 남아 있으면 알린다 (이름 정규화가 어긋난 신호)
    orphans = sorted({p.stem for p in OUT.glob("*.png")} - set(by_name.values()) - ({npc} if npc else set()))

    total = sum(p.stat().st_size for p in OUT.glob("*.png"))
    print(f"출력 → {PUBLIC}")
    print(f"  · 타일 {w}×{h} — 생성 {made}장, 기존 {skipped}장, 합계 {len(list(OUT.glob('*.png')))}장"
          f" ({total / 1024 / 1024:.1f}MB)")

    build_battle_portraits(by_name, args.battle_size, args.force)
    build_skill_art(args.skill_width, args.force)
    build_skill_scroll(args.force)
    build_skill_action(args.force)

    if missing:
        print(f"\n원본이 없는 장수 {len(missing)}명: {', '.join(missing[:10])}", file=sys.stderr)
    if orphans:
        print(f"대응 장수가 없는 출력 {len(orphans)}건: {', '.join(orphans[:10])}", file=sys.stderr)
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
