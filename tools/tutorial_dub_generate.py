"""
S급 튜토리얼 대사 더빙 — Gemini TTS로 **화자 한 명 × 더빙 언어 하나 = 호출 한 번**.

Neo-Luddite 공모전 영상의 `generate_narration.py`를 고친 것이다. 달라진 점:
  - 테이크는 하나만 받는다(셋 받아 고르지 않는다).
  - 한 화자가 30판에 걸쳐 하는 대사를 **한 프롬프트에 몰아** 읽힌다 — 줄 사이는 긴 쉼으로 띄워 나중에 자르기 쉽게.
  - 대본은 손으로 적지 않고 `Design/튜토리얼더빙/lines.json`(← `tools/tutorial_dub_script.ts`)에서 읽는다.
    목소리 · 인물 프로필은 `cast.json`, 줄마다의 연기 지시는 `notes.json`(선택).

흐름
  1) node --experimental-strip-types tools/tutorial_dub_script.ts      # 대본 · 배역표 뼈대 갱신
  2) python tools/tutorial_dub_generate.py prompts                     # 호출 없이 프롬프트만 써서 검토 (Design/튜토리얼더빙/prompts/)
  3) python tools/tutorial_dub_generate.py run [KR EN ...] [--only 화자id ...]   # 호출
  4) 받은 원본: assets/Audio/voice/tutorial/raw/{더빙}/{화자}.{더빙}.wav
     같은 이름의 .txt가 「몇 번째 말 → 어느 파일 이름」 표다. 자른 것은
       assets/Audio/voice/tutorial/{더빙}/{판}.say{n}.wav   (예: KR/gwan-u.say3.wav)
     에 둔다.
  5) python tools/tutorial_dub_generate.py split [KR ...]              # (선택) 무음으로 잘라 보기 — 줄 수가 맞을 때만 쓴다
  6) python tools/tutorial_dub_generate.py stale                       # 대사를 고친 뒤 다시 받아야 할 화자 찾기

설치: pip install google-genai · 키: PowerShell `$env:GEMINI_API_KEY="…"`
음원 앞뒤 무음은 0.4초까지 디지털 무음만 덧붙인다(목소리는 안 건드린다). 출력은 24kHz · 16-bit · 모노 PCM WAV.
"""

import json
import os
import re
import struct
import sys
import time
import wave
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DUB_DIR = ROOT / "Design" / "튜토리얼더빙"
LINES = DUB_DIR / "lines.json"
CAST = DUB_DIR / "cast.json"
NOTES = DUB_DIR / "notes.json"
PROMPTS = DUB_DIR / "prompts"
AUDIO = ROOT / "assets" / "Audio" / "voice" / "tutorial"
RAW = AUDIO / "raw"

# ─────────────────────────── 설정 ───────────────────────────
MODEL = "gemini-3.8-flash-tts"   # 공모전 영상과 같은 모델
PAD_SECONDS = 0.4
GAP_SECONDS = 2.0                # 프롬프트가 요구하는 줄 사이 쉼 — 자르는 자리
MAX_LINES = 15                   # 한 호출에 넣는 줄 수 상한 — 넘으면 두 번에 나눈다(길게 읽히면 뒤가 흐트러진다)
SLEEP_BETWEEN_CALLS = 7
SAMPLE_RATE, SAMPLE_WIDTH, CHANNELS = 24000, 2, 1

LANG_NAME = {
    "KR": "Korean",
    "EN": "English",
    "JP": "Japanese",
    "PT": "Brazilian Portuguese",
    "CA": "Mandarin Chinese",
}

BASE_SCENE = (
    "Voice lines for a Three Kingdoms strategy game. Each line is spoken by the same historical character "
    "at a different moment of a short battle story, shown in a dialogue box beside their portrait."
)

COMMON_NOTES = """Style: Natural voice acting for a story-driven game, grounded and believable. Period drama, not modern casual speech.
Delivery: Each line is a separate utterance with its own emotion; reset between lines. Stress only the key word.
Pacing: Natural speed for the emotion of each line. Leave a clear silence of about {gap:.0f} seconds between lines.
Rules: Read every line exactly once, in order. Do not add, skip, merge or repeat lines. Do not read line numbers or notes.
Avoid: announcer cadence, narrator voice, exaggerated anime-style shouting, reading like a commercial."""


def load_json(path: Path, default=None):
    if not path.exists():
        if default is not None:
            return default
        sys.exit(f"{path} 가 없다 — 먼저 node --experimental-strip-types tools/tutorial_dub_script.ts")
    return json.loads(path.read_text(encoding="utf-8"))


def voice_clashes(cast: dict) -> list:
    """한 판에 선 두 화자가 같은 목소리면 대사 패널에서 한 사람처럼 들린다 — 판마다 본다."""
    out = []
    for sc in load_json(LINES)["scenarios"]:
        seen = {}
        for ln in sc["lines"]:
            v = cast.get(ln["speaker"], {}).get("voice")
            if v and seen.setdefault(v, ln["speaker"]) != ln["speaker"]:
                out.append(f"{sc['stage']}: {seen[v]} · {ln['speaker']} 둘 다 {v}")
    return sorted(set(out))


# ─────────────────────────── 묶기 ───────────────────────────
def batches(dubs: list, only: set) -> list:
    """(화자, 더빙, 조각 번호, 줄들) — 줄은 판 차례(가나다) → 판 안 차례. 번역이 없는 줄은 뺀다."""
    data = load_json(LINES)
    by = {}
    for sc in data["scenarios"]:
        for ln in sc["lines"]:
            by.setdefault(ln["speaker"], []).append(ln)
    out = []
    for speaker, lines in by.items():
        if only and speaker not in only:
            continue
        for dub in dubs:
            ready = [ln for ln in lines if ln["text"].get(dub)]
            for i in range(0, len(ready), MAX_LINES):
                part = ready[i:i + MAX_LINES]
                n = i // MAX_LINES + 1 if len(ready) > MAX_LINES else 0
                out.append((speaker, dub, n, part))
    return out


def base_name(speaker: str, dub: str, part: int) -> str:
    return f"{speaker}.{dub}" + (f".part{part}" if part else "")


def build_prompt(speaker: str, dub: str, lines: list, cast: dict, notes: dict) -> str:
    c = cast[speaker]
    note_lines = []
    for i, ln in enumerate(lines, 1):
        n = notes.get(ln["key"])
        if n:
            note_lines.append(f"Line {i}: {n}")
    per_line = ("\n" + "\n".join(note_lines)) if note_lines else ""
    transcript = "\n\n".join(ln["text"][dub].strip() for ln in lines)
    lang = LANG_NAME[dub]
    return f"""Synthesize only the TRANSCRIPT below in {lang}. Do not read any instructions aloud, including speaker names, line numbers or notes.

# AUDIO PROFILE
{c['profile'].strip()}

## THE SCENE
{BASE_SCENE} The transcript has {len(lines)} lines.

### DIRECTOR'S NOTES
{COMMON_NOTES.format(gap=GAP_SECONDS)}{per_line}

#### TRANSCRIPT
{transcript}
"""


def manifest(lines: list, dub: str) -> str:
    rows = [f"# 자른 뒤 이름 — assets/Audio/voice/tutorial/{dub}/<이름>.wav", ""]
    for i, ln in enumerate(lines, 1):
        name = ln["key"].removeprefix("tut.s.")  # gwan-u.say3
        rows.append(f"{i:2d}\t{name}\t{ln['hash'][dub]}\t{ln['text'][dub]}")
    return "\n".join(rows) + "\n"


# ─────────────────────────── 오디오 ───────────────────────────
def samples_of(pcm: bytes):
    n = len(pcm) // SAMPLE_WIDTH
    return struct.unpack(f"<{n}h", pcm[: n * SAMPLE_WIDTH])


def edge_silence(s, from_start: bool, threshold: int = 300) -> int:
    rng = range(len(s)) if from_start else range(len(s) - 1, -1, -1)
    count = 0
    for i in rng:
        if abs(s[i]) > threshold:
            break
        count += 1
    return count


def pad(pcm: bytes) -> bytes:
    s = samples_of(pcm)
    target = int(SAMPLE_RATE * PAD_SECONDS)
    head = max(0, target - edge_silence(s, True))
    tail = max(0, target - edge_silence(s, False))
    return b"\x00\x00" * head + pcm + b"\x00\x00" * tail


def save_wav(path: Path, pcm: bytes) -> float:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm)
    return len(pcm) / SAMPLE_WIDTH / SAMPLE_RATE


def read_wav(path: Path) -> bytes:
    with wave.open(str(path), "rb") as wf:
        return wf.readframes(wf.getnframes())


def voiced_spans(pcm: bytes, min_gap: float, threshold: int = 500, win_ms: int = 20):
    """20ms 창의 최대 진폭으로 말소리 구간을 찾는다 — min_gap초 넘는 쉼에서만 끊는다."""
    s = samples_of(pcm)
    win = SAMPLE_RATE * win_ms // 1000
    loud = [max((abs(x) for x in s[i:i + win]), default=0) > threshold for i in range(0, len(s), win)]
    gap_w = int(min_gap * 1000 / win_ms)
    spans, start, quiet = [], None, 0
    for w, on in enumerate(loud):
        if on:
            if start is None:
                start = w
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet >= gap_w:
                spans.append((start * win, (w - quiet + 1) * win))
                start, quiet = None, 0
    if start is not None:
        spans.append((start * win, len(s)))
    return spans


# ─────────────────────────── 호출 ───────────────────────────
class DailyQuotaExceeded(Exception):
    pass


def retry_delay_seconds(err: Exception) -> float:
    m = re.search(r"retryDelay'?:\s*'(\d+(?:\.\d+)?)s'", str(err))
    return float(m.group(1)) if m else 0.0


def generate(client, types, voice: str, prompt: str, retries: int = 3) -> bytes:
    for attempt in range(1, retries + 1):
        try:
            r = client.models.generate_content(
                model=MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))),
                ),
            )
            return r.candidates[0].content.parts[0].inline_data.data
        except Exception as e:
            delay = retry_delay_seconds(e)
            if "PerDay" in str(e) or delay > 300:
                raise DailyQuotaExceeded(delay)
            if attempt == retries:
                raise
            wait = max(delay, 30 * attempt) + 2
            print(f"    일시 오류 또는 분당 한도. {wait:.0f}초 뒤 다시 ({attempt}/{retries})")
            time.sleep(wait)


# ─────────────────────────── 명령 ───────────────────────────
def parse(args):
    only = set()
    if "--only" in args:
        i = args.index("--only")
        only = set(args[i + 1:])
        args = args[:i]
    force = "--force" in args
    args = [a for a in args if a != "--force"]
    dubs = [a for a in args if a in LANG_NAME] or list(LANG_NAME)
    return dubs, only, force


def check_cast(todo, cast) -> list:
    bad = sorted({sp for sp, *_ in todo if not cast.get(sp, {}).get("voice") or not cast.get(sp, {}).get("profile")})
    if bad:
        print(f"배역표(cast.json)에 목소리 · 프로필이 빈 화자 {len(bad)}명은 건너뛴다: {', '.join(bad)}")
    return [b for b in todo if b[0] not in bad]


def cmd_prompts(args):
    dubs, only, _ = parse(args)
    cast, notes = load_json(CAST), load_json(NOTES, {})
    todo = check_cast(batches(dubs, only), cast)
    for c in voice_clashes(cast):
        print(f"⚠ 같은 목소리 — {c}")
    for sp, dub, part, lines in todo:
        name = base_name(sp, dub, part)
        out = PROMPTS / dub / f"{name}.md"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(f"목소리: `{cast[sp]['voice']}` · 줄 {len(lines)}\n\n```\n{build_prompt(sp, dub, lines, cast, notes).strip()}\n```\n\n"
                       f"```\n{manifest(lines, dub).strip()}\n```\n", encoding="utf-8")
    print(f"프롬프트 {len(todo)}개 → {PROMPTS} (호출 {len(todo)}번 분량)")


def cmd_run(args):
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        sys.exit("pip install google-genai")
    if not os.environ.get("GEMINI_API_KEY"):
        sys.exit("GEMINI_API_KEY 환경 변수를 먼저 설정하세요.")
    dubs, only, force = parse(args)
    cast, notes = load_json(CAST), load_json(NOTES, {})
    todo = check_cast(batches(dubs, only), cast)
    client = genai.Client()
    RAW.mkdir(parents=True, exist_ok=True)
    log_path = RAW / "generation_log.md"
    with open(log_path, "a", encoding="utf-8") as log:
        log.write(f"\n## 실행 {datetime.now():%Y-%m-%d %H:%M} — `{MODEL}`\n\n")
        done = 0
        for sp, dub, part, lines in todo:
            name = base_name(sp, dub, part)
            wav = RAW / dub / f"{name}.wav"
            if wav.exists() and not force:
                continue
            prompt = build_prompt(sp, dub, lines, cast, notes)
            print(f"[{dub}] {name} ({cast[sp]['voice']}, {len(lines)}줄)")
            try:
                pcm = generate(client, types, cast[sp]["voice"], prompt)
            except DailyQuotaExceeded:
                log.write("- (하루 한도 초과로 중단)\n")
                print("\n하루 한도를 다 썼다. 같은 명령을 다시 돌리면 받은 것은 건너뛰고 이어 간다.")
                return
            sec = save_wav(wav, pad(pcm))
            (RAW / dub / f"{name}.txt").write_text(manifest(lines, dub), encoding="utf-8")
            found = len(voiced_spans(pcm, GAP_SECONDS * 0.6))
            flag = "" if found == len(lines) else f"  ⚠ 쉼으로 가른 덩어리 {found} ≠ 줄 {len(lines)}"
            print(f"    저장 {sec:.1f}초{flag}")
            log.write(f"### {name} — `{cast[sp]['voice']}` · {sec:.1f}초{flag}\n\n```\n{prompt.strip()}\n```\n\n")
            done += 1
            time.sleep(SLEEP_BETWEEN_CALLS)
    print(f"\n받음 {done}개 → {RAW}")


def cmd_split(args):
    """줄 수와 덩어리 수가 같은 원본만 잘라 이름까지 붙인다. 다르면 손으로 자를 것으로 남긴다."""
    dubs, only, force = parse(args)
    for dub in dubs:
        for wav in sorted((RAW / dub).glob("*.wav")):
            spk = wav.stem.split(".")[0]
            if only and spk not in only:
                continue
            rows = [r.split("\t") for r in (wav.with_suffix(".txt")).read_text(encoding="utf-8").splitlines() if "\t" in r]
            pcm = read_wav(wav)
            spans = voiced_spans(pcm, GAP_SECONDS * 0.6)
            if len(spans) != len(rows):
                print(f"[{dub}] {wav.name}: 덩어리 {len(spans)} ≠ 줄 {len(rows)} — 손으로 자른다")
                continue
            for (a, b), row in zip(spans, rows):
                out = AUDIO / dub / f"{row[1]}.wav"
                if out.exists() and not force:
                    continue
                save_wav(out, pad(pcm[a * SAMPLE_WIDTH:b * SAMPLE_WIDTH]))
            print(f"[{dub}] {wav.name}: {len(rows)}줄 잘랐다")


def cmd_stale(args):
    """받은 원본의 표(.txt)에 적힌 해시와 지금 대사의 해시를 견준다 — 대사를 고쳤으면 그 화자를 다시 받는다."""
    dubs, _, _ = parse(args)
    now = {}
    for sc in load_json(LINES)["scenarios"]:
        for ln in sc["lines"]:
            for d in dubs:
                now[(ln["key"].removeprefix("tut.s."), d)] = ln["hash"].get(d)
    stale = set()
    for dub in dubs:
        for txt in sorted((RAW / dub).glob("*.txt")):
            for r in txt.read_text(encoding="utf-8").splitlines():
                p = r.split("\t")
                if len(p) >= 3 and now.get((p[1], dub)) != p[2]:
                    stale.add((dub, txt.stem))
    for dub, name in sorted(stale):
        print(f"[{dub}] {name} — 대사가 바뀌었다 (--force --only {name.split('.')[0]})")
    print(f"낡은 원본 {len(stale)}개")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    a = sys.argv[1:]
    cmds = {"prompts": cmd_prompts, "run": cmd_run, "split": cmd_split, "stale": cmd_stale}
    if not a or a[0] not in cmds:
        sys.exit(__doc__)
    cmds[a[0]](a[1:])
