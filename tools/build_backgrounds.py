#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Backgrounds/ 의 배경 띠를 화면별 그림으로 잘라 굽는다 (pptx 33~36쪽).

    python tools/build_backgrounds.py [--force] [--sheet 대조.png]

| 원본 | 칸 | 출력 | 쓰는 곳 |
|---|---|---|---|
| `openBackground` | 3 | `public/backgrounds/open-{day,dusk,night}.jpg` | **간판·로그인 화면** (33·34쪽) |
| `mainBackground` | 3 | `public/backgrounds/main-{day,dusk,night}.jpg` | **메인 화면** (35쪽) |
| `eachBackground` | 4 | `public/backgrounds/place-1-{palace,barracks,market,ranking}.jpg` | 궁궐·병영·장터·랭킹 — **도시 Lv1~4** (36쪽) |
| `eachBackground2` | 4 | `public/backgrounds/place-2-…jpg` | 〃 — **도시 Lv5 이상** |

────────────────────────────────────────────────────────────────
칸의 뜻이 정해지는 자리는 여기 하나뿐이다
────────────────────────────────────────────────────────────────

원본은 기획자가 한 장에 이어 그린 띠고, 화면은 「지금 시간대의 그림」·「병영 그림」만
알면 된다. `build_terrain.py`가 한글 파일명을 `TerrainId`로 바꾸는 것과 같은 자리다 —
**칸 순서(왼쪽부터)를 id로 바꾸는 표는 아래 `STRIPS` 하나뿐이고**, 화면은
`backgrounds/{id}.jpg`라는 규약만 안다.

시간대의 경계(7시·16시·20시)는 화면 쪽(`screens/backdrop.ts`)에 있다. 그림을 굽는
일과 「지금 몇 시인가」는 다른 층이라, 여기서는 **칸이 셋이라는 것만** 안다.

────────────────────────────────────────────────────────────────
`_big` 이 있으면 그쪽을 쓴다 ★ (2026-08-15)
────────────────────────────────────────────────────────────────

처음 받은 PNG는 폭이 804~900px이었다. 칸으로 자르면 한 장이 **225~300px**이라
프레임(320~700px)에 늘려 깔면 **눈에 띄게 깨진다.** 기획자가 같은 그림의 고해상도
`{이름}_big.jpg`(2062~2912px)를 더해 줬다.

그래서 원본을 고르는 순서가 `_big.jpg → _big.png → .png`다. **한쪽만 있어도 돌아야
한다** — 고해상도를 아직 못 받은 사람은 예전 PNG로 굽고 화면은 그대로 뜬다.
어느 쪽으로 구웠는지는 실행할 때마다 찍어 준다.

**출력은 JPG다.** 칸 하나가 687×1536이라 PNG로 두면 한 장에 2MB 안팎, 열넉 장이면
25MB가 넘는다. 수채화풍 그림이라 JPG로 눌러도 눈에 띄는 손실이 없다 —
**단, 다시 굽는 원본은 언제나 `assets/`쪽이다.** JPG를 다시 JPG로 굽는 일은 없다.

────────────────────────────────────────────────────────────────
왜 그냥 통째로 쓰지 않는가
────────────────────────────────────────────────────────────────

CSS `background-position`으로 한 장에서 잘라 쓸 수도 있다. 그렇게 하지 않은 이유 둘.

1. **칸 수가 원본마다 다르다** (3칸·4칸). 화면이 그것까지 알면 「몇 칸짜리인가」가
   CSS와 코드 두 곳에 적히고, 원본이 바뀔 때 한쪽만 고치게 된다.
2. 밤 그림 하나를 띄우려고 낮·황혼까지 받게 된다. 고해상도는 한 장이 4MB에 이른다.

────────────────────────────────────────────────────────────────
다시 구울지는 「시각」이 아니라 「내용」으로 정한다 ★
────────────────────────────────────────────────────────────────

`build_audio.py`가 밟은 지뢰와 같은 자리다 — 기획자가 그림 **내용만 맞바꿔** 저장하면
파일 시각은 그대로일 수 있고, 시각만 보는 도구는 「이미 최신」이라며 조용히 건너뛴다.
원본의 해시를 `.sources.json`에 남겨 두고 **내용이 달라졌을 때** 다시 굽는다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import unicodedata
from pathlib import Path

from PIL import Image

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
SRC = ROOT / "assets" / "Backgrounds"
OUT = ROOT / "packages" / "client" / "public" / "backgrounds"

STAMP = ".sources.json"
"""원본 해시를 적어 두는 자리. 위 「내용으로 정한다」 참조."""

TIME_BANDS = ("day", "dusk", "night")
"""시간대 — 왼쪽부터 낮 · 황혼 · 밤. 경계는 `screens/backdrop.ts`가 정한다."""

PLACES = ("palace", "barracks", "market", "ranking")
"""도시 안의 자리 — 왼쪽부터 궁궐 · 병영 · 장터 · 랭킹.

넷째 칸은 처음엔 연결점이 안 정해져 `extra`로 자리만 잡아 뒀었다(2026-08-15).
2026-08-25에 「도시 전적 보기」 화면의 배경으로 정해지며 `ranking`으로 이름을
얻었다 — `screens/backdrop.ts`의 `rankingBackdrop()` 참조.
"""

STRIPS: dict[str, tuple[str, tuple[str, ...]]] = {
    "openBackground": ("open", TIME_BANDS),
    "mainBackground": ("main", TIME_BANDS),
    "eachBackground": ("place-1", PLACES),
    "eachBackground2": ("place-2", PLACES),
}
"""원본 파일명(확장자 없이) → (출력 앞머리, 왼쪽부터의 칸 id).

칸 수는 id 개수가 곧 답이다 — 따로 적으면 둘이 갈린다.
"""

COL_RATIO = 0.46
"""칸 한 장의 가로÷세로. 원본들이 0.447~0.506이다(프레임이 1:2라 그렇다).

**칸 수를 잘못 알면 그림이 조용히 어긋난다** — 3칸짜리를 4로 자르면 낮 그림 안에
황혼 조각이 섞여 들어오는데, 화면에서는 「그림이 좀 이상한데」로만 보인다.
그래서 잘린 칸의 비율이 이 값에서 멀면 **몇 칸이 맞아 보이는지까지 찍어** 알린다.
"""

RATIO_TOL = 0.1
"""허용 오차. 0.46 ± 0.1이면 3칸과 4칸을 확실히 가른다(한 칸 적으면 0.61, 많으면 0.37).

`eachBackground2_big`은 칸마다 액자 여백이 있어 0.506까지 간다 — 정상이다.
"""

SOURCE_ORDER = ("_big.jpg", "_big.png", ".png", ".jpg")
"""원본을 고르는 순서. **고해상도(`_big`)가 있으면 그쪽이다** (2026-08-15).

처음 받은 PNG는 칸 하나가 225~300px이라 프레임에 늘려 깔면 눈에 띄게 깨졌다.
한쪽만 있어도 돌아야 하므로 순서만 정해 두고, 어느 것으로 구웠는지 찍어 준다.
"""

JPEG_QUALITY = 88
"""출력 JPG 화질. 수채화풍이라 88이면 눈으로 손실을 찾기 어렵고 크기는 1/8이 된다."""


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_stamp() -> dict[str, str]:
    path = OUT / STAMP
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}       # 읽을 수 없으면 전부 다시 굽는다 — 조용히 건너뛰는 것보다 낫다


SNAP_WINDOW = 0.01
"""경계를 찾아볼 범위(폭 대비). 등분한 자리에서 이만큼 좌우를 살핀다."""

INSET = 1
"""칸 안쪽 가장자리에서 깎아 낼 픽셀. 경계선(금색 줄)과 ±1 오차를 함께 지운다."""


def cut_points(im: Image.Image, count: int) -> list[int]:
    """칸 경계를 **그림에서 찾아서** 돌려준다 (`0 … w`).

    ────────────────────────────────────────────────────────────
    등분만 하면 옆 칸이 몇 픽셀 딸려 온다 ★
    ────────────────────────────────────────────────────────────

    `openBackground.png`는 804px인데 진짜 경계는 268·536이 아니라 **266·535**다.
    등분해서 자르면 낮 그림 오른쪽에 황혼의 주황색 띠가 2px 남는다 — 화면에서는
    「오른쪽 끝에 이상한 줄이 있네」로만 보이고, 원인이 코드에 없어 한참 헤맨다.

    그래서 등분한 자리 언저리에서 **세로로 색이 가장 크게 튀는 열**을 찾아 거기서
    자른다. 위아래 장식 띠는 칸마다 같은 무늬라 도움이 안 되므로 가운데 절반만 본다.
    이미 딱 맞는 그림(`eachBackground.png`)은 등분한 자리가 곧 peak라 그대로 남는다.
    """
    w, h = im.size
    px = im.load()
    # 가운데 절반의 열 사이 색 차이 합. numpy 없이도 되지만 900×336이라 넉넉히 빠르다.
    top, bottom = h // 4, h - h // 4
    diff = [0] * w
    for x in range(1, w):
        total = 0
        for y in range(top, bottom, 2):        # 두 줄에 하나만 봐도 봉우리는 그대로다
            a, b = px[x - 1, y], px[x, y]
            total += abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
        diff[x] = total

    win = max(3, round(w * SNAP_WINDOW))
    cuts = [0]
    for i in range(1, count):
        even = round(w * i / count)
        lo, hi = max(1, even - win), min(w - 1, even + win)
        best = max(range(lo, hi + 1), key=lambda x: diff[x])
        cuts.append(best)
    cuts.append(w)
    return cuts


def slice_strip(im: Image.Image, count: int) -> tuple[list[Image.Image], list[int]]:
    """왼쪽부터 `count`칸으로 자른다. 경계는 `cut_points()`가 그림에서 찾는다."""
    w, h = im.size
    cuts = cut_points(im, count)
    tiles = []
    for i in range(count):
        left = cuts[i] + (INSET if i > 0 else 0)
        right = cuts[i + 1] - (INSET if i + 1 < count else 0)
        tiles.append(im.crop((left, 0, right, h)))
    return tiles, cuts[1:-1]


def check_ratio(name: str, tile: Image.Image, count: int, width: int) -> str | None:
    """칸 비율이 엉뚱하면 「몇 칸이 맞아 보이는지」를 담은 경고를 돌려준다."""
    ratio = tile.width / tile.height
    if abs(ratio - COL_RATIO) <= RATIO_TOL:
        return None
    best = max(1, round(width / (tile.height * COL_RATIO)))
    return (f"{name} — {count}칸으로 자르면 칸 비율이 {ratio:.2f}다"
            f" (여느 그림은 {COL_RATIO:.2f}). {best}칸짜리 그림은 아닌가?")


def pick_source(stem: str) -> Path | None:
    """이 띠의 원본. **고해상도(`_big`)가 있으면 그쪽이다** (`SOURCE_ORDER` 참조)."""
    for suffix in SOURCE_ORDER:
        path = SRC / f"{stem}{suffix}"
        if path.is_file():
            return path
    return None


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="내용이 그대로여도 다시 굽는다")
    ap.add_argument("--sheet", help="눈으로 볼 대조 시트를 이 경로에 쓴다")
    args = ap.parse_args()

    if not SRC.is_dir():
        # 에셋은 리포에 없다(기획자 방침). 없으면 건너뛴다 — 초상화·지형과 같다.
        print(f"{SRC} 가 없어 건너뛴다 — 그림 없이도 빌드는 정상이다")
        return 0

    found = {unicodedata.normalize("NFC", p.name) for p in SRC.iterdir() if p.is_file()}
    OUT.mkdir(parents=True, exist_ok=True)
    stamp = load_stamp()

    made: list[tuple[str, Image.Image]] = []
    fresh: list[str] = []           # 내용이 바뀌어 다시 구운 것
    skipped = 0
    missing: list[str] = []
    warnings: list[str] = []
    used: list[str] = []            # 어느 원본으로 구웠는지 (고해상도인가 아닌가)
    planned: set[str] = set()       # 이번에 있어야 할 출력 — 나머지는 묵은 것이다

    for stem, (prefix, ids) in STRIPS.items():
        outputs = [OUT / f"{prefix}-{i}.jpg" for i in ids]
        planned.update(p.name for p in outputs)

        path = pick_source(stem)
        if path is None:
            missing.append(f"{stem} ({prefix})")
            continue
        used.append(f"{path.name}{'' if '_big' in path.stem else ' (저해상도)'}")

        digest = sha256(path)
        unchanged = stamp.get(stem) == digest and all(p.exists() for p in outputs)
        if unchanged and not args.force:
            skipped += 1
            continue
        if stamp.get(stem) not in (None, digest):
            fresh.append(stem)

        with Image.open(path) as im:
            strip = im.convert("RGB")
            tiles, cuts = slice_strip(strip, len(ids))
            warn = check_ratio(path.name, tiles[0], len(ids), strip.width)
            if warn:
                warnings.append(warn)
            even = [round(strip.width * i / len(ids)) for i in range(1, len(ids))]
            if cuts != even:
                # 등분한 자리와 다르면 알린다 — 조용히 옮기면 「왜 몇 px 잘렸지」가 된다
                print(f"  · {stem}: 경계를 그림에서 찾았다 {even} → {cuts}")
            for tile, dst in zip(tiles, outputs):
                # JPG로 굽는다 — 칸 하나가 687×1536이라 PNG면 열넉 장에 25MB가 넘는다
                tile.save(dst, quality=JPEG_QUALITY, optimize=True, progressive=True)
                made.append((dst.stem, tile))

        stamp[stem] = digest

    (OUT / STAMP).write_text(json.dumps(stamp, indent=2, sort_keys=True), encoding="utf-8")

    # 계획에 없는 출력은 지운다. PNG → JPG 처럼 **확장자가 바뀌면 옛 파일이 남고**,
    # 화면은 새 것을 보는데 폴더에는 둘이 섞여 나중에 눈으로 못 가른다.
    stale = sorted(p for p in OUT.iterdir()
                   if p.is_file() and p.name != STAMP and p.name not in planned)
    for p in stale:
        p.unlink()

    print(f"출력 → {OUT}")
    print(f"  배경 {len(made)}장" + (f" (그대로 둔 띠 {skipped}종)" if skipped else ""))
    if used:
        print(f"  원본: {' · '.join(used)}")
    if made:
        total = sum((OUT / f"{n}.jpg").stat().st_size for n, _ in made)
        print(f"  구운 것: {' '.join(n for n, _ in made)}  ({total / 1024 / 1024:.1f}MB)")
    if fresh:
        # 「이미 최신」이라며 건너뛴 탓에 옛 그림이 남는 일을 막는다 (`build_audio.py` 교훈)
        print(f"  ↻ 내용이 바뀌어 다시 구운 원본: {' · '.join(fresh)}")
    if stale:
        print(f"  − 묵은 출력 {len(stale)}장을 지웠다: {' '.join(p.name for p in stale[:6])}"
              + (" …" if len(stale) > 6 else ""))
    if missing:
        print(f"  ! 못 찾은 원본: {' · '.join(missing)}")
    for w in warnings:
        print(f"  ! {w}")

    known = {f"{stem}{suffix}" for stem in STRIPS for suffix in SOURCE_ORDER}
    extra = sorted(found - known)
    if extra:
        print(f"  · 표에 없어 건너뛴 그림: {' '.join(extra)}"
              " — 화면에 붙이려면 STRIPS 에 칸 id 를 적는다")

    if args.sheet and made:
        cols = max(im.width for _, im in made)
        sheet = Image.new("RGB", (cols * len(made), max(im.height for _, im in made)), (24, 26, 30))
        x = 0
        for _, im in made:
            sheet.paste(im, (x, 0))
            x += cols
        sheet.save(args.sheet)
        print(f"  대조 시트 → {args.sheet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
