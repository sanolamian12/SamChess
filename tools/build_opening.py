#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""입장 영상 · 가입 오프닝 그림(`assets/opening/`)을 웹용으로 굽는다.

    python tools/build_opening.py [--force]

| 원본 | 출력 | 언제 |
|---|---|---|
| `입장동영상_1_2_낮_황혼.mp4` 프레임 0~235 | `public/opening/enter-day.mp4` · `.jpg` | 간판 [입장] → 메인, 낮(7~16시) |
| `입장동영상_1_2_낮_황혼.mp4` 프레임 236~ | `public/opening/enter-dusk.mp4` · `.jpg` | 〃 황혼(16~20시) |
| `입장동영상_3_밤.mp4` | `public/opening/enter-night.mp4` · `.jpg` | 〃 밤 |

**낮 · 황혼은 20초 한 파일에 이어 붙어 있다** (기획자 지정, 2026-10-19). 9.833초(24fps의
236번째 프레임)에서 장면이 바뀐다 — `ffmpeg … select='gt(scene,0.25)'`로 잰 값이다. 따로 있는
`입장동영상_2_황혼.mp4`는 **다른 황혼 영상**이고 쓰지 않는다(`_1_낮.mp4`는 앞 절반과 같은 영상이다).
원본을 다시 받아 경계가 바뀌면 `CUT` 하나만 고친다 — 잘못 자르면 한쪽 끝에 다른 시간대가 한 프레임 번쩍인다.

시간대 경계는 `client/src/screens/backdrop.ts`의 `bandForHour()` 하나가 정한다 — 이 표의
괄호는 따라 적은 것이다. 트는 자리는 `client/src/screens/EnterCine.tsx`.

────────────────────────────────────────────────────────────────
소리와 달리 다시 인코딩한다
────────────────────────────────────────────────────────────────

`build_audio.py`는 소리를 손대지 않고 옮기지만, 영상은 원본이 10초에 4~7MB라 휴대폰에서
[입장]마다 받기에 무겁다. 해상도(720×1280)는 그대로 두고 H.264 품질 값만 올려 줄인다.
`+faststart`는 파일 머리에 색인을 옮겨 **다 받기 전에 재생이 시작되게** 한다.

**포스터(`.jpg`)는 첫 프레임이다.** `<video>`는 첫 프레임을 풀기 전까지 검게 비는데,
그 사이 화면이 번쩍 검어지면 「영상이 깨졌다」로 읽힌다. 영상의 첫 장면은 간판 그림과
같은 성문 앞이라 포스터가 깔리면 끊김 없이 이어진다.

다시 구울지는 시각이 아니라 **원본의 내용(sha1)**으로 정한다 — `build_audio.py`의 그 교훈
(내용만 바뀌고 시각은 그대로인 파일). 원본 표는 `public/opening/sources.json`에 남는다.
원본 폴더나 ffmpeg가 없으면 **건너뛴다고 알리고** 통과한다(에셋 방침).

────────────────────────────────────────────────────────────────
가입 오프닝 — 영상이 아니라 그림 일곱 장이다
────────────────────────────────────────────────────────────────

| 원본 | 출력 |
|---|---|
| `opening_video/opening_2.png` ~ `opening_8.png` | `public/opening/signup-2.jpg` ~ `signup-8.jpg` |

도시 이름을 지은 뒤 석양 위에 대사가 뜨는 동안 0.5초마다 한 장씩 겹쳐 넘어가 8에서 멈춘다
(`client/src/screens/NewGameScreen.tsx`). **1은 굽지 않는다** — 도시 이름 짓기 화면의 배경
(`backgrounds/new-city.jpg`, `npm run ui`가 `assets/icons/create_city.png`에서 굽는다)이 같은
장면이라 그 위에서 2부터 겹친다. 원본이 360×640이라 크기는 그대로 두고 JPEG로만 바꾼다
(기획자 확정 — 같은 장면을 `opening video.mp4`에서 720p로 뽑는 안은 택하지 않았다).
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'opening'
OUT = ROOT / 'packages' / 'client' / 'public' / 'opening'

# 낮 → 황혼이 바뀌는 프레임 (24fps, 위 머리말)
CUT = 236
FPS = 24

# 한글 원본 이름 → 화면 id. 잇는 자리는 이 표 하나다. (원본, 첫 프레임, 끝 프레임(안 넣음) | None)
ENTER: dict[str, tuple[str, int, int | None]] = {
    'day': ('입장동영상_1_2_낮_황혼.mp4', 0, CUT),
    'dusk': ('입장동영상_1_2_낮_황혼.mp4', CUT, None),
    'night': ('입장동영상_3_밤.mp4', 0, None),
}

# 가입 오프닝 그림 번호 (1은 도시 이름 짓기의 배경이다 — 위 머리말)
SIGNUP = range(2, 9)

# H.264 품질 값 — 23이 기본. 수묵 그림은 평면이 넓어 26에서도 번짐이 눈에 안 띈다.
CRF = '26'


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def run(args: list[str]) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def build_signup(force: bool) -> None:
    """가입 오프닝 그림 — PNG → JPEG. 크기는 그대로다"""
    from PIL import Image
    built = skipped = 0
    for n in SIGNUP:
        src = SRC / 'opening_video' / f'opening_{n}.png'
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


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    force = '--force' in sys.argv
    if not SRC.is_dir():
        print(f'· {SRC.relative_to(ROOT)} 이 없다 — 입장 영상 · 가입 오프닝을 건너뛴다')
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    build_signup(force)
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        print('· ffmpeg가 없다 — 입장 영상을 건너뛴다 (winget install ffmpeg)')
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    table_path = OUT / 'sources.json'
    try:
        table: dict[str, str] = json.loads(table_path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        table = {}

    built = skipped = 0
    for band, (name, first, end) in ENTER.items():
        src = SRC / name
        if not src.is_file():
            print(f'· {name} 이 없다 — {band}를 건너뛴다')
            continue
        mp4 = OUT / f'enter-{band}.mp4'
        jpg = OUT / f'enter-{band}.jpg'
        digest = f'{sha1(src)}:{first}:{end}'
        if not force and table.get(band) == digest and mp4.is_file() and jpg.is_file():
            skipped += 1
            continue
        # 프레임 단위로 자른다 — 시각(-ss)으로 자르면 키프레임에 붙어 경계가 몇 프레임 밀린다
        vtrim = f'trim=start_frame={first}' + (f':end_frame={end}' if end is not None else '') + ',setpts=PTS-STARTPTS'
        atrim = f'atrim=start={first / FPS:.6f}' + (f':end={end / FPS:.6f}' if end is not None else '') + ',asetpts=PTS-STARTPTS'
        run([ffmpeg, '-y', '-v', 'error', '-i', str(src), '-vf', vtrim, '-af', atrim,
             '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-pix_fmt', 'yuv420p',
             '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', str(mp4)])
        run([ffmpeg, '-y', '-v', 'error', '-i', str(mp4), '-frames:v', '1', '-q:v', '3', str(jpg)])
        table[band] = digest
        built += 1
        span = f' [{first}~{"" if end is None else end - 1}]' if first or end is not None else ''
        print(f'  ✓ {name}{span} → opening/{mp4.name} ({mp4.stat().st_size / 1e6:.1f} MB)')

    table_path.write_text(json.dumps(table, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'입장 영상: 구움 {built} · 그대로 {skipped}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
