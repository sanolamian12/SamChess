"""병영 · 대장간 호칭 녹음 하나를 25개 파일로 자른다 (2026-11-13).

    python tools/split_cityvoice.py                      # 기본 원본
    python tools/split_cityvoice.py <원본.mp3>

원본은 Google AI Studio로 받은 한 덩어리 — **KR · EN · PT · JP · CA 순서로, 언어마다 주공 · 장군 · 대장군 · 승상 · 전하**,
마디 사이 약 1~2초 무음(프롬프트는 `Design/시설인물_호칭더빙.md`). 무음 검출(−40dB, 0.25초)로 **정확히 25구간**이 나와야 자른다 —
개수가 다르면 순서를 믿을 수 없으니 멈춘다. 마디마다 앞 0.06초 · 뒤 0.25초 여유(이웃과의 가운데를 넘지 않게), 페이드 20/80ms.

나온 것은 `assets/Audio/voice/city/{army,blacksmith}/{LANG}/{호칭}_{LANG}.mp3` — 두 인물이 같은 녹음을 쓴다.
그 뒤 `python tools/build_audio.py`가 `public/cityvoice/{인물}-{단}.{LANG}.mp3`로 옮긴다.
ffmpeg가 PATH에 있어야 한다.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT / "assets" / "Audio" / "new" / "대장간_병영_음원.mp3"
OUT = ROOT / "assets" / "Audio" / "voice" / "city"
SPEAKERS = ("army", "blacksmith")
LANGS = ("KR", "EN", "PT", "JP", "CA")
HONORS = ("주공", "장군", "대장군", "승상", "전하")
NOISE_DB = 40
MIN_SILENCE = 0.25
LEAD = 0.06
TAIL = 0.25


def segments(src: Path) -> tuple[list[tuple[float, float]], float]:
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(src), "-af", f"silencedetect=noise=-{NOISE_DB}dB:d={MIN_SILENCE}", "-f", "null", "-"],
        capture_output=True, encoding="utf-8", errors="replace",
    ).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", out)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", out)]
    dur = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    total = int(dur[1]) * 3600 + int(dur[2]) * 60 + float(dur[3]) if dur else (ends[-1] if ends else 0.0)
    # 소리 = 무음이 끝난 때 ~ 다음 무음이 시작하는 때 (녹음은 무음으로 시작하고 끝난다)
    return [(ends[i], starts[i + 1]) for i in range(min(len(ends), len(starts) - 1))], total


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.exists():
        sys.exit(f"원본이 없다: {src}")
    segs, total = segments(src)
    want = len(LANGS) * len(HONORS)
    if len(segs) != want:
        sys.exit(f"소리 구간이 {len(segs)}개다 — {want}개여야 순서대로 이름을 붙일 수 있다(무음 기준 −{NOISE_DB}dB · {MIN_SILENCE}초를 보라)")
    for k, (a, b) in enumerate(segs):
        prev_end = segs[k - 1][1] if k else 0.0
        nxt = segs[k + 1][0] if k < want - 1 else total
        s = max(a - LEAD, (prev_end + a) / 2)
        e = min(b + TAIL, (b + nxt) / 2)
        d = e - s
        lang, honor = LANGS[k // len(HONORS)], HONORS[k % len(HONORS)]
        for who in SPEAKERS:
            out_dir = OUT / who / lang
            out_dir.mkdir(parents=True, exist_ok=True)
            subprocess.run([
                "ffmpeg", "-y", "-v", "error", "-ss", f"{s:.3f}", "-t", f"{d:.3f}", "-i", str(src),
                "-af", f"afade=t=in:d=0.02,afade=t=out:st={max(0.0, d - 0.08):.3f}:d=0.08",
                "-ar", "48000", "-ac", "2", "-b:a", "192k", str(out_dir / f"{honor}_{lang}.mp3"),
            ], check=True)
        print(f"  {lang} {honor}  {s:6.2f}–{e:6.2f}  ({d:.2f}초)")
    print(f"→ {OUT}/{{{','.join(SPEAKERS)}}}/ 에 {want}개씩")


if __name__ == "__main__":
    main()
