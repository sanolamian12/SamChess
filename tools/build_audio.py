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
| `CreateCity.mp3` | `public/bgm/createCity.mp3` | 도시 이름 짓기 · 가입 오프닝 (2026-10-20) |

효과음 (`effects/`) — 파일명이 이미 영문이라 이름표가 따로 없다. 한 번 재생하고 끝나는
짧은 소리이고, 트는 자리는 `client/src/audio/sfx.ts`·`buttonSfx.ts`를 부르는 화면·전투
코드 쪽에 있다(이 도구는 옮기기만 한다).

고유기술 성우 (`skillvoice/`) — `assets/Audio/Specialskills/{KR,EN,JP,CA,PT}/이름_LANG.mp3`를
`packages/data/generated/uniqueSkills.json`의 `name`과 대조해 `기술id.LANG.확장자`로 옮긴다.
지금 18종만 녹음돼 있다 — 나머지는 대조에 안 걸려 그대로 건너뛴다.

차례 음성 (`turnvoice/`, 2026-10-20) — 전투에서 **내 장수가 차례를 받았을 때** 한 번 튼다.
| 원본 | 출력 |
|---|---|
| `voice/battle/SE_class/{LANG}/이름_LANG.mp3` (S급 30 + 황제 1) | `turnvoice/{장수id}.{LANG}.mp3` |
| `voice/battle/A_class/{LANG}/이름_LANG.mp3` (A급 40, 2026-10-26) | `turnvoice/{장수id}.{LANG}.mp3` |
| `voice/battle/BCD_speical/{LANG}/이름_LANG.mp3` (이름난 B~D급 9, 2026-10-27) | `turnvoice/{장수id}.{LANG}.mp3` |
| `voice/battle/BCD_class/{LANG}/imready_유형(LANG).mp3` (다섯 목소리) | `turnvoice/{유형id}.{LANG}.mp3` |
이름난 B~D급 명단은 `turnVoice.ts`의 `NAMED_VOICES`가 정한다(폴더 이름 `speical`은 원본 그대로). 나머지 B~D급 장수가 어느 유형을 쓰는지는 이 도구가 아니라 `client/src/audio/turnVoice.ts`의 표가 정한다 —
이 도구는 유형 다섯의 한글 이름을 화면 id로 옮기기만 한다(`TURNVOICE_TYPES`).

안내 내관 음성 (`cityvoice/`, 2026-10-22) — 내관이 화면에 **들어올 때** 군주를 부르는 한마디.
| 원본 | 출력 |
|---|---|
| `voice/city/{LANG}/호칭_LANG.mp3` (주공 · 장군 · 대장군 · 승상 · 전하) | `cityvoice/{1..5}.{LANG}.mp3` |
호칭 → 단(`meta/guide.ts`의 `guideHonor`)을 잇는 자리는 `CITYVOICE_HONORS` 하나다.

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
    # 도시 이름 짓기 · 가입 오프닝(2026-10-20 기획자 지정) — 원본이 영문 이름으로 왔다
    "CreateCity": "createCity",
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
    # (`assets/icons/skills/` 초상화 40장의 NAME_FIXES와 같은 결).
    "가후지잭": "가후지책",
}

# **더는 안 쓰는 기술의 성우** — 기술이 바뀌어 데이터에 없다. 원본(`assets/`)은 그대로 두고 대조에서만 뺀다 — 안 빼면
# 「매칭 못한 성우」 경고가 빌드마다 거짓으로 떠서 진짜 어긋남(이름 오타 등)까지 아무도 안 읽게 된다.
# 데이터에 그 이름이 다시 생기면 스스로 알린다.
SKILLVOICE_RETIRED = {
    "화용도의석조조": "조조의 고유기술이 바뀌어 안 쓴다 (2026-10-16 기획자)",
}


TURNVOICE_SRC = SRC / "voice" / "battle"
TURNVOICE_OUT = CLIENT_PUBLIC / "turnvoice"
OFFICER_DATA = ROOT / "packages" / "data" / "generated" / "officers.json"

TURNVOICE_TYPES = {
    "호탕장군": "bold",
    "군기바짝": "strict",
    "점잔장군": "noble",
    "점잔책사": "sage",
    "간사책사": "schemer",
}
"""B~D급 목소리 다섯 — 원본의 한글 유형 이름 → 화면 id. `turnVoice.ts`의 `TurnVoiceType`과 같은 다섯이다."""

TURNVOICE_NAME_FIXES = {
    # 원본 파일명이 장수 이름이 아니라 칭호로 온 것 — 파일은 그대로 두고 대조에서만 바로잡는다
    "황제": "헌제",  # PT 더빙만 `황제_PT.mp3`
}


CITYVOICE_SRC = SRC / "voice" / "city"
CITYVOICE_OUT = CLIENT_PUBLIC / "cityvoice"
CITYVOICE_HONORS = {
    "주공": "1",
    "장군": "2",
    "대장군": "3",
    "승상": "4",
    "전하": "5",
}
"""호칭 → 화면이 부르는 이름(`meta/guide.ts`의 `GuideHonor` — 도시 레벨 단 1~5).
헌제를 거느려도 군주는 폐하가 아니다(2026-10-23 기획자 — 황제를 도시에 모시는 것이다). 그래서 폐하 녹음은 쓰지 않는다."""


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
    sync_turnvoice(args.force)
    sync_cityvoice(args.force)
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
    retired = 0

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
            if base in SKILLVOICE_RETIRED and base not in name_to_id:
                retired += 1
                continue
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

    print(f"  · skillvoice/ {len(copied)}개" + (f" (그대로 둔 것 {skipped}개)" if skipped else "")
          + (f" · 안 쓰는 기술 {retired}개 건너뜀" if retired else ""))
    for name in SKILLVOICE_RETIRED:
        if name in name_to_id:
            print(f"  ! 「{name}」이 데이터에 다시 있다 — SKILLVOICE_RETIRED에서 빼야 성우가 붙는다")
    if unmatched:
        print(f"  ! 매칭 못한 고유기술 성우: {' · '.join(unmatched)}")


def copy_if_changed(src: Path, dst: Path, force: bool) -> str | None:
    """내용이 같으면 `None`, 옮겼으면 찍을 이름(갈아끼움 표시 포함). 위 ★의 규칙 그대로다."""
    had = dst.exists()
    same = (had
            and dst.stat().st_size == src.stat().st_size
            and digest(dst) == digest(src))
    if same and not force:
        return None
    shutil.copyfile(src, dst)
    return f"{dst.stem}(갈아끼움)" if had else dst.stem


def sync_turnvoice(force: bool) -> None:
    """차례 음성 — S · A급 · 황제는 장수 id로, B~D급 다섯 유형은 유형 id로 옮긴다."""
    if not TURNVOICE_SRC.is_dir():
        print(f"{TURNVOICE_SRC} 가 없어 건너뛴다 — 차례 음성 없이도 빌드는 정상이다")
        return
    if not OFFICER_DATA.exists():
        print(f"  ! {OFFICER_DATA} 가 없어 차례 음성을 건너뛴다 — npm run extract 먼저")
        return
    officers = json.loads(OFFICER_DATA.read_text(encoding="utf-8"))
    by_name = {unicodedata.normalize("NFC", o["name"]): o for o in officers}
    # 고유 목소리 — 폴더마다 받는 급. `turnVoice.ts`의 `UNIQUE_VOICE_GRADES`와 같은 셋이다
    # `BCD_speical`은 급이 아니라 이름으로 고른 B~D급 — 화면이 부르는 명단은 `turnVoice.ts`의 `NAMED_VOICES`다
    folders = {"SE_class": ("S", "E"), "A_class": ("A",), "BCD_speical": ("B", "C", "D")}
    unique = {o["id"] for o in officers if o["grade"] in ("S", "A", "E")}

    TURNVOICE_OUT.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    skipped = 0
    unmatched: list[str] = []
    voiced: dict[str, set[str]] = {lang: set() for lang in SKILLVOICE_LANGS}
    typed: dict[str, set[str]] = {lang: set() for lang in SKILLVOICE_LANGS}

    for lang in SKILLVOICE_LANGS:
        for folder, grades in folders.items():
            se_dir = TURNVOICE_SRC / folder / lang
            for path in sorted(se_dir.glob("*.mp3")) if se_dir.is_dir() else []:
                stem = unicodedata.normalize("NFC", path.stem)
                base = stem.removesuffix(f"_{lang}")
                officer = by_name.get(TURNVOICE_NAME_FIXES.get(base, base))
                # 폴더가 받는 급만 — 다른 급의 이름이 오면 화면이 유형 목소리를 부르므로 알린다
                if officer is None or officer["grade"] not in grades or not stem.endswith(f"_{lang}"):
                    unmatched.append(str(path.relative_to(SRC)))
                    continue
                voiced[lang].add(officer["id"])
                name = copy_if_changed(path, TURNVOICE_OUT / f"{officer['id']}.{lang}.mp3", force)
                if name: copied.append(name)
                else: skipped += 1

        abcd_dir = TURNVOICE_SRC / "BCD_class" / lang
        for path in sorted(abcd_dir.glob("*.mp3")) if abcd_dir.is_dir() else []:
            stem = unicodedata.normalize("NFC", path.stem)
            kind = stem.removeprefix("imready_").removesuffix(f"({lang})")
            type_id = TURNVOICE_TYPES.get(kind)
            if type_id is None:
                unmatched.append(str(path.relative_to(SRC)))
                continue
            typed[lang].add(type_id)
            name = copy_if_changed(path, TURNVOICE_OUT / f"{type_id}.{lang}.mp3", force)
            if name: copied.append(name)
            else: skipped += 1

    print(f"  · turnvoice/ {len(copied)}개" + (f" (그대로 둔 것 {skipped}개)" if skipped else ""))
    if copied:
        print(f"    옮긴 것: {' '.join(copied)}")
    for lang in SKILLVOICE_LANGS:
        lack = sorted(unique - voiced[lang])
        if lack:
            print(f"  ! {lang}: 고유 목소리가 없는 S · A급 · 황제 — {' '.join(lack)}")
        lack_t = sorted(set(TURNVOICE_TYPES.values()) - typed[lang])
        if lack_t:
            print(f"  ! {lang}: 없는 B~D급 목소리 — {' '.join(lack_t)}")
    if unmatched:
        print(f"  ! 매칭 못한 차례 음성: {' · '.join(unmatched)}")


def sync_cityvoice(force: bool) -> None:
    """안내 내관 음성 — `호칭_LANG.mp3`를 단 id로 옮긴다."""
    if not CITYVOICE_SRC.is_dir():
        print(f"{CITYVOICE_SRC} 가 없어 건너뛴다 — 내관 음성 없이도 빌드는 정상이다")
        return
    CITYVOICE_OUT.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    skipped = 0
    unmatched: list[str] = []
    have: dict[str, set[str]] = {lang: set() for lang in SKILLVOICE_LANGS}
    for lang in SKILLVOICE_LANGS:
        lang_dir = CITYVOICE_SRC / lang
        for path in sorted(lang_dir.glob("*.mp3")) if lang_dir.is_dir() else []:
            stem = unicodedata.normalize("NFC", path.stem)
            honor = CITYVOICE_HONORS.get(stem.removesuffix(f"_{lang}"))
            if honor is None or not stem.endswith(f"_{lang}"):
                unmatched.append(str(path.relative_to(SRC)))
                continue
            have[lang].add(honor)
            name = copy_if_changed(path, CITYVOICE_OUT / f"{honor}.{lang}.mp3", force)
            if name: copied.append(name)
            else: skipped += 1

    print(f"  · cityvoice/ {len(copied)}개" + (f" (그대로 둔 것 {skipped}개)" if skipped else ""))
    if copied:
        print(f"    옮긴 것: {' '.join(copied)}")
    by_id = {v: k for k, v in CITYVOICE_HONORS.items()}
    for lang in SKILLVOICE_LANGS:
        lack = [by_id[h] for h in CITYVOICE_HONORS.values() if h not in have[lang]]
        if lack:
            print(f"  ! {lang}: 녹음이 없는 호칭 — {' '.join(lack)} (그 호칭에서는 내관이 말없이 들어온다)")
    if unmatched:
        print(f"  ! 매칭 못한 내관 음성: {' · '.join(unmatched)}")


if __name__ == "__main__":
    raise SystemExit(main())
