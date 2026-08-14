#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Audio/ 의 배경음악을 웹용으로 옮긴다.

    python tools/build_audio.py [--force]

| 원본 | 출력 | 언제 |
|---|---|---|
| `배경곡_1_메인.mp3` | `public/bgm/main.mp3` | 첫 화면·메인·장수 관리 — **아래 넷이 아닌 모든 화면** |
| `배경곡_2_장군선택.mp3` | `public/bgm/roster.mp3` | 3:3/5:5 고른 뒤 기물·장수를 고르는 화면 |
| `배경곡_3_배치정탐.mp3` | `public/bgm/prep.mp3` | 전투 화면의 배치·정찰 단계 |
| `배경곡_4_전투.mp3` | `public/bgm/battle.mp3` | 전투 |
| `배경곡_5_전투종료.mp3` | `public/bgm/result.mp3` | 전투 종료 후 보상 화면 |
| `배경곡_6_크레딧.mp3` | `public/bgm/credits.mp3` | **아직 화면이 없다** — 굽기만 해 둔다 |

────────────────────────────────────────────────────────────────
그림 도구들과 같은 결이다
────────────────────────────────────────────────────────────────

**한글 이름 → 화면 id 를 잇는 자리는 아래 `BGM` 표 하나뿐이다.** 원본은 기획자가 읽을
이름이고, 화면은 `bgm/{id}.mp3` 라는 규약만 안다(`client/src/audio/bgm.ts`).
URL 에 한글이 남으면 서버·CDN 마다 인코딩이 갈린다 — `build_terrain.py` 와 같은 이유다.

**소리는 손대지 않는다.** mp3 를 그대로 옮긴다. 다시 인코딩하면 음질만 잃고,
길이·루프 지점은 기획자가 정한 그대로여야 한다. 그래서 이 도구는 **옮기고 재는 일**만
한다 — 파일이 크면(> 4MB) 이름을 찍어 알린다. 첫 재생 때 받아야 하는 값이라
그대로 두면 소리가 늦게 나온다.

★ **다시 옮길지는 「시각」이 아니라 「내용」으로 정한다** (2026-08-14).
기획자가 곡 순서를 바로잡느라 3번과 4번의 **내용을 맞바꿔** 저장했는데 파일 시각은
예전 그대로였다 — 시각만 보는 도구는 「이미 최신」이라며 **조용히 건너뛰고** 화면에서는
여전히 옛 곡이 나온다. 소리는 눈으로 확인할 수도 없어서 더 위험하다. 1:1 복사라
내용을 그대로 비교할 수 있으므로 그렇게 한다.
────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import unicodedata
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
SRC = ROOT / "assets" / "Audio"
OUT = ROOT / "packages" / "client" / "public" / "bgm"

BGM = {
    "배경곡_1_메인": "main",
    "배경곡_2_장군선택": "roster",
    "배경곡_3_배치정탐": "prep",
    "배경곡_4_전투": "battle",
    "배경곡_5_전투종료": "result",
    "배경곡_6_크레딧": "credits",
}
"""원본 파일명(한글) → 화면 id. **이 표가 두 이름을 잇는 유일한 자리다.**"""

UNWIRED = {"credits"}
"""구워는 두지만 아직 어느 화면도 틀지 않는 곡. 크레딧 화면이 생기면 여기서 뺀다."""

BIG_MB = 4.0
"""이보다 크면 이름을 찍어 알린다 — 첫 재생이 그만큼 늦어진다."""


def digest(path: Path) -> str:
    """파일 내용의 지문. 17MB 여섯 곡을 다 훑어도 눈 깜짝할 사이다."""
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 옮긴다")
    args = ap.parse_args()

    bgm_dir = SRC / "bgm"
    if not bgm_dir.is_dir():
        # 에셋은 리포에 없다(기획자 방침). 없으면 조용히 넘어간다 — 그림 도구들과 같다.
        print(f"{bgm_dir} 가 없어 건너뛴다 — 소리 없이도 빌드는 정상이다")
        return 0

    found = {unicodedata.normalize("NFC", p.stem): p for p in bgm_dir.glob("*.mp3")}
    OUT.mkdir(parents=True, exist_ok=True)

    copied: list[str] = []
    skipped = 0
    missing: list[str] = []
    big: list[str] = []

    for stem, track in BGM.items():
        path = found.get(stem)
        if path is None:
            missing.append(f"{stem}.mp3 ({track})")
            continue
        mb = path.stat().st_size / 1_000_000
        if mb > BIG_MB:
            big.append(f"{track} {mb:.1f}MB")
        dst = OUT / f"{track}.mp3"
        # **내용으로 비교한다.** 시각으로 보면 「곡을 맞바꿔 저장했는데 시각은 그대로」인
        # 경우를 놓친다 (위 ★ 참조). 크기가 다르면 읽어 볼 것도 없다.
        had = dst.exists()
        same = (had
                and dst.stat().st_size == path.stat().st_size
                and digest(dst) == digest(path))
        if same and not args.force:
            skipped += 1
            continue
        shutil.copyfile(path, dst)
        # 이미 있던 것을 바꾼 것인지 새로 놓은 것인지 구분해 찍는다 — 곡이 바뀌는 일은
        # 소리로만 확인되므로, 무엇이 갈렸는지 로그에 남아야 한다
        copied.append(f"{track}(갈아끼움)" if had else track)

    print(f"출력 → {OUT}")
    print(f"  배경곡 {len(copied)}곡" + (f" (그대로 둔 것 {skipped}곡)" if skipped else ""))
    if copied:
        print(f"  옮긴 것: {' '.join(copied)}")
    if missing:
        print(f"  ! 못 찾은 원본: {' · '.join(missing)}")
    if big:
        print(f"  · 큰 파일: {' · '.join(big)} — 첫 재생이 그만큼 늦다")
    if UNWIRED:
        print(f"  · 아직 어느 화면도 틀지 않는 곡: {' '.join(sorted(UNWIRED))}")

    extra = sorted(set(found) - set(BGM))
    if extra:
        print(f"  · 표에 없어 건너뛴 곡: {' '.join(extra)}")

    # 소리는 배경곡만 붙었다. 나머지 두 폴더는 **세어서 알리기만** 한다 —
    # 조용히 지나가면 「붙인 줄 알았는데 안 난다」가 된다.
    fx = SRC / "effects"
    if fx.is_dir():
        n = len(list(fx.glob("*.*")))
        print(f"  · effects/ {n}개 — 아직 연결하지 않았다"
              + (" (폴더가 비어 있다)" if n == 0 else ""))
    voice = SRC / "Specialskills"
    if voice.is_dir():
        langs = sorted(d.name for d in voice.iterdir() if d.is_dir())
        counts = {lang: len(list((voice / lang).glob("*.mp3"))) for lang in langs}
        print(f"  · Specialskills/ {counts} — 고유기술 음성, 아직 연결하지 않았다")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
