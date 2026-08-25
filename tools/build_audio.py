#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Audio/ 의 소리 셋(배경음악·효과음·고유기술 성우)을 웹용으로 옮긴다.

    python tools/build_audio.py [--force]

배경음악 (`bgm/`)
| 원본 | 출력 | 언제 |
|---|---|---|
| `배경곡_1_메인.mp3` | `public/bgm/main.mp3` | 첫 화면·메인·장수 관리 — **아래가 아닌 모든 화면** |
| `배경곡_2_장군선택.mp3` | `public/bgm/roster.mp3` | 3:3/5:5 고른 뒤 기물·장수를 고르는 화면 |
| `배경곡_3_배치정탐.mp3` | `public/bgm/prep.mp3` | 전투 화면의 배치·정찰 단계 |
| `배경곡_4_전투.mp3` | `public/bgm/battle.mp3` | 전투 |
| `배경곡_상점.mp3` | `public/bgm/shop.mp3` | 장터(상점) 화면 |
| `배경곡_5_전투종료.mp3` | `public/bgm/result.mp3` | 전투 종료 후 보상 화면 — 승리 |
| `배경곡_전투_비김.mp3` | `public/bgm/resultDraw.mp3` | 〃 — 무승부 |
| `배경곡_전투_패배.mp3` | `public/bgm/resultLose.mp3` | 〃 — 패배 |
| `배경곡_6_크레딧.mp3` | `public/bgm/credits.mp3` | **아직 화면이 없다** — 굽기만 해 둔다 |

효과음 (`effects/`) — 파일명이 이미 영문이라 이름표가 따로 없다. 한 번 재생하고 끝나는
짧은 소리이고, 트는 자리는 `client/src/audio/sfx.ts`·`buttonSfx.ts`를 부르는 화면·전투
코드 쪽에 있다(이 도구는 옮기기만 한다).

고유기술 성우 (`skillvoice/`) — `assets/Audio/Specialskills/{KR,EN,JP,CA,PT}/이름_LANG.mp3`를
`packages/data/generated/uniqueSkills.json`의 `name`과 대조해 `기술id.LANG.확장자`로 옮긴다.
지금 18종만 녹음돼 있다 — 나머지는 대조에 안 걸려 그대로 건너뛴다.

────────────────────────────────────────────────────────────────
그림 도구들과 같은 결이다
────────────────────────────────────────────────────────────────

**한글 이름 → 화면 id 를 잇는 자리는 아래 `BGM` 표 하나뿐이다.** 원본은 기획자가 읽을
이름이고, 화면은 `bgm/{id}.mp3` 라는 규약만 안다(`client/src/audio/bgm.ts`).
URL 에 한글이 남으면 서버·CDN 마다 인코딩이 갈린다 — `build_terrain.py` 와 같은 이유다.

**소리는 손대지 않는다.** 그대로 옮긴다. 다시 인코딩하면 음질만 잃고, 길이·루프 지점은
기획자가 정한 그대로여야 한다. 그래서 이 도구는 **옮기고 재는 일**만 한다 — 파일이
크면(> 4MB) 이름을 찍어 알린다. 첫 재생 때 받아야 하는 값이라 그대로 두면 소리가 늦게
나온다. 확장자도 안 바꾼다 — 고유기술 성우 중 `용호상박`의 JP·PT 더빙만 원본이 `.wav`다,
그걸 `.mp3`로 다시 인코딩하지 않고 확장자째 옮기는 이유다(`skillVoice.ts`가 `.mp3`를
먼저 시도하고 실패하면 `.wav`로 한 번 더 시도한다).

★ **다시 옮길지는 「시각」이 아니라 「내용」으로 정한다** (2026-08-14).
기획자가 곡 순서를 바로잡느라 3번과 4번의 **내용을 맞바꿔** 저장했는데 파일 시각은
예전 그대로였다 — 시각만 보는 도구는 「이미 최신」이라며 **조용히 건너뛰고** 화면에서는
여전히 옛 곡이 나온다. 소리는 눈으로 확인할 수도 없어서 더 위험하다. 1:1 복사라
내용을 그대로 비교할 수 있으므로 그렇게 한다. 효과음·성우도 같은 규칙을 따른다.
────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import unicodedata
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
SRC = ROOT / "assets" / "Audio"
CLIENT_PUBLIC = ROOT / "packages" / "client" / "public"
OUT = CLIENT_PUBLIC / "bgm"

BGM = {
    "배경곡_1_메인": "main",
    "배경곡_2_장군선택": "roster",
    "배경곡_3_배치정탐": "prep",
    "배경곡_4_전투": "battle",
    "배경곡_상점": "shop",
    "배경곡_5_전투종료": "result",
    "배경곡_전투_비김": "resultDraw",
    "배경곡_전투_패배": "resultLose",
    "배경곡_6_크레딧": "credits",
}
"""원본 파일명(한글) → 화면 id. **이 표가 두 이름을 잇는 유일한 자리다.**"""

UNWIRED = {"credits"}
"""구워는 두지만 아직 어느 화면도 틀지 않는 곡. 크레딧 화면이 생기면 여기서 뺀다."""

BIG_MB = 4.0
"""이보다 크면 이름을 찍어 알린다 — 첫 재생이 그만큼 늦어진다."""

EFFECTS_SRC = SRC / "effects"
EFFECTS_OUT = CLIENT_PUBLIC / "effects"

SKILLVOICE_SRC = SRC / "Specialskills"
SKILLVOICE_OUT = CLIENT_PUBLIC / "skillvoice"
SKILLVOICE_LANGS = ("KR", "EN", "JP", "CA", "PT")
SKILLVOICE_EXTS = (".mp3", ".wav")
SKILL_DATA = ROOT / "packages" / "data" / "generated" / "uniqueSkills.json"

SKILLVOICE_NAME_FIXES = {
    # 파일명 자체의 오타 — 실제 파일은 그대로 두고 매칭에서만 바로잡는다
    # (`assets/SpecialSkills/` 초상화 40장의 NAME_FIXES와 같은 결).
    "가후지잭": "가후지책",
}


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

    sync_effects(args.force)
    sync_skillvoice(args.force)
    return 0


def sync_effects(force: bool) -> None:
    """`effects/*.mp3`를 그대로 옮긴다 — 파일명이 이미 id라 표가 필요 없다."""
    if not EFFECTS_SRC.is_dir():
        print(f"{EFFECTS_SRC} 가 없어 건너뛴다 — 효과음 없이도 빌드는 정상이다")
        return

    EFFECTS_OUT.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    skipped = 0
    for path in sorted(EFFECTS_SRC.glob("*.mp3")):
        dst = EFFECTS_OUT / path.name
        had = dst.exists()
        same = (had
                and dst.stat().st_size == path.stat().st_size
                and digest(dst) == digest(path))
        if same and not force:
            skipped += 1
            continue
        shutil.copyfile(path, dst)
        copied.append(f"{path.stem}(갈아끼움)" if had else path.stem)

    print(f"  · effects/ {len(copied)}개" + (f" (그대로 둔 것 {skipped}개)" if skipped else ""))
    if copied:
        print(f"    옮긴 것: {' '.join(copied)}")


def load_skill_names() -> dict[str, str]:
    """정규화한 기술 이름(공백 제거) → 기술 id. `uniqueSkills.json`이 없으면 빈 표."""
    if not SKILL_DATA.exists():
        return {}
    data = json.loads(SKILL_DATA.read_text(encoding="utf-8"))
    return {
        unicodedata.normalize("NFC", s["name"]).replace(" ", ""): s["id"]
        for s in data
    }


def sync_skillvoice(force: bool) -> None:
    """`Specialskills/{LANG}/이름_LANG.{mp3,wav}`를 기술 id로 대조해 옮긴다."""
    if not SKILLVOICE_SRC.is_dir():
        print(f"{SKILLVOICE_SRC} 가 없어 건너뛴다 — 고유기술 성우 없이도 빌드는 정상이다")
        return

    name_to_id = load_skill_names()
    if not name_to_id:
        print(f"  ! {SKILL_DATA} 가 없어 고유기술 성우를 건너뛴다 — npm run extract 먼저")
        return

    SKILLVOICE_OUT.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    skipped = 0
    unmatched: list[str] = []

    for lang in SKILLVOICE_LANGS:
        lang_dir = SKILLVOICE_SRC / lang
        if not lang_dir.is_dir():
            continue
        suffix = f"_{lang}"
        for path in sorted(lang_dir.iterdir()):
            if path.suffix.lower() not in SKILLVOICE_EXTS:
                continue
            stem = unicodedata.normalize("NFC", path.stem)
            if not stem.endswith(suffix):
                unmatched.append(str(path.relative_to(SRC)))
                continue
            base = stem[: -len(suffix)].replace(" ", "")
            base = SKILLVOICE_NAME_FIXES.get(base, base)
            skill_id = name_to_id.get(base)
            if skill_id is None:
                unmatched.append(str(path.relative_to(SRC)))
                continue
            dst = SKILLVOICE_OUT / f"{skill_id}.{lang}{path.suffix.lower()}"
            had = dst.exists()
            same = (had
                    and dst.stat().st_size == path.stat().st_size
                    and digest(dst) == digest(path))
            if same and not force:
                skipped += 1
                continue
            shutil.copyfile(path, dst)
            copied.append(f"{skill_id}.{lang}(갈아끼움)" if had else f"{skill_id}.{lang}")

    print(f"  · skillvoice/ {len(copied)}개" + (f" (그대로 둔 것 {skipped}개)" if skipped else ""))
    if unmatched:
        print(f"  ! 매칭 못한 고유기술 성우: {' · '.join(unmatched)}")


if __name__ == "__main__":
    raise SystemExit(main())
