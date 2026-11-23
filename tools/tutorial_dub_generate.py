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
     python tools/tutorial_dub_generate.py html                        # AI Studio에 붙여 넣는 작업판 (Design/튜토리얼더빙/더빙작업판.html)
                                                                       #   — API 대신 손으로 받을 때. 받은 원본은 4)의 raw 자리에 같은 이름으로 둔다
  3) python tools/tutorial_dub_generate.py run [KR EN ...] [--only 화자id ...]   # 호출
  4) 받은 원본: assets/Audio/voice/tutorial/raw/{더빙}/{화자}.{더빙}.wav
     같은 이름의 .txt가 「몇 번째 말 → 어느 파일 이름」 표다. 자른 것은
       assets/Audio/voice/tutorial/{더빙}/{판}.say{n}.wav   (예: KR/gwan-u.say3.wav)
     에 둔다.
  5) python tools/tutorial_dub_generate.py split [KR ...] [--only 화자id ...]
     AI Studio로 받은 원본 assets/Audio/new/New_{더빙}/{한글이름}_{더빙}.mp3 를 줄마다 자른다(쉼 + 글자 수로 맞춘다, ffmpeg 필요).
     끝에 「_skip focus」가 붙은 원본은 첫 줄(게임 차례 음성) 없이 받은 것 — 차례 음성은 기존 게임 음원 그대로.
     결과: assets/Audio/voice/tutorial/{더빙}/{이름}.wav + _듣기.html(들어 보기 판) + _cut.json(구간 · 해시 · 의심 표지)
  5') python tools/tutorial_dub_generate.py auto [KR ...] [--only 화자id ...]   # 4) · 5)를 뒤에서 자동으로 (2026-11-17)
     배역표 순서로 New_{더빙}에 원본이 없는 화자를 3분에 한 번씩 받아 저장하고 곧바로 자른다. 키는 ~/.samchess/gemini_keys.txt
     (한 줄에 하나, 하루 한도에 걸리면 다음 키). 상태는 assets/Audio/new/auto_status.json · auto_log.md, 들어 보기 판 머리에도.
     멈추기: assets/Audio/new/STOP 파일을 만든다. 다시 받기: New_{더빙}의 그 원본을 지우면 돌고 있는 동안 다시 받는다.
  6) python tools/tutorial_dub_generate.py stale                       # 대사를 고친 뒤 다시 받아야 할 화자 찾기

메아리: `Design/튜토리얼더빙/fx.json`(`{"잘린 이름": "echo"}`)에 적힌 줄은 split이 자르며 산울림을 얹는다.
  TTS는 목소리만 내고 공간은 못 낸다 — 지시문에 「메아리」를 적어도 안 생기니 자른 뒤에 덧입힌다(2026-11-16 장비).
  이미 잘린 파일에 얹으려면 split --force --only 화자.
손질한 조각: 같은 폴더의 `{이름}_edit.(wav|mp3)`가 있으면 split이 자른 것 대신 그것을 `{이름}.wav`로 쓴다(다시 잘라도 남는다).

설치: pip install google-genai · 키: PowerShell `$env:GEMINI_API_KEY="…"`
음원 앞뒤 무음은 0.4초까지 디지털 무음만 덧붙인다(목소리는 안 건드린다). 출력은 24kHz · 16-bit · 모노 PCM WAV.
"""

import json
import os
import re
import struct
import subprocess
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
API_VERSION = "v1beta"         # google-genai 3.x는 기본이 v1인데, 음성 생성(speechConfig)은 v1beta에서만 받는다 — v1이면 400 「Unknown name speechConfig」(2026-11-17)
PAD_SECONDS = 0.4
GAP_SECONDS = 2.0                # 프롬프트가 요구하는 줄 사이 쉼 — 자르는 자리
MAX_LINES = 16                   # 한 호출에 넣는 줄 수 상한 — 넘으면 두 번에 나눈다(길게 읽히면 뒤가 흐트러진다). 조조 = 튜토리얼 15 + 차례 음성 1
SLEEP_BETWEEN_CALLS = 7
SAMPLE_RATE, SAMPLE_WIDTH, CHANNELS = 24000, 2, 1

LANG_NAME = {
    "KR": "Korean",
    "EN": "English",
    "JP": "Japanese",
    "PT": "Brazilian Portuguese",
    "CA": "Mandarin Chinese",
}

# 더빙 언어마다의 말투 — 지시문은 영어 한 벌이고 이 한 줄만 언어를 따라 바뀐다
LANG_STYLE = {
    "KR": "Korean historical drama (sageuk) diction: dignified period speech with natural standard Korean pronunciation. Read names exactly as written.",
    "EN": "Period epic film delivery in neutral English. Pronounce Chinese names as written, evenly.",
    "JP": "Japanese period drama (jidaigeki) delivery in natural standard Japanese. Read names with the readings implied by the text.",
    "PT": "Brazilian Portuguese dubbing of a historical epic, natural Brazilian accent (not European Portuguese).",
    "CA": "Standard Mandarin Chinese (Putonghua) in the style of a Chinese historical drama. Not Cantonese.",
}

BASE_SCENE = (
    "Voice lines for a Three Kingdoms strategy game. Each line is spoken by the same historical character "
    "at a different moment of a short battle story, shown in a dialogue box beside their portrait."
)

COMMON_NOTES = """Style: Natural voice acting for a story-driven game, grounded and believable. Period drama, not modern casual speech.
Battlefield: These lines are said in the middle of a battle. Deliver them brisk, crisp and clipped like a soldier: hearty but disciplined. Never theatrical, melodramatic or stage-play acting; never slow or drawn-out.
Delivery: Each line is a separate utterance with its own emotion; reset between lines. Stress only the key word.
Pacing: A quick, natural battlefield pace; no lingering pauses inside a line. Leave a clear silence of about {gap:.0f} seconds between lines.
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
GAME_VOICE = DUB_DIR / "game_voice.json"   # ← tools/tutorial_dub_game_voice.py
TURN_LANGS = ("KR",)                        # 게임 차례 음성을 함께 받는 더빙 — 한국어만(2026-11-16 기획자)


def turn_lines() -> dict:
    """화자 → 게임 차례 음성 한 줄(대본 줄과 같은 모양). 같은 호출에 넣어 **튜토리얼과 게임이 같은 목소리**가 되게 한다.
    열쇠는 `turn.{장수}` — 잘린 파일은 `assets/Audio/voice/tutorial/KR/turn.{장수}.wav`, 게임의 자리는 `game` 칸."""
    import hashlib
    import unicodedata
    out = {}
    notes = load_json(NOTES, {})
    for r in load_json(GAME_VOICE, []):
        t = r["turn"]
        if not (t.get("text") and t.get("file") and r["tutorial"]["lines"]):
            continue
        text = t["text"].strip()
        h = hashlib.sha1(unicodedata.normalize("NFC", text).encode()).hexdigest()[:10]
        how = f" (Korean direction: {t['how']})" if t.get("how") else ""
        out[r["id"]] = {
            "key": f"turn.{r['id']}", "stage": None, "speaker": r["id"], "speakerName": r["name"],
            "text": {d: (text if d in TURN_LANGS else None) for d in LANG_NAME},
            "hash": {d: (h if d in TURN_LANGS else None) for d in LANG_NAME},
            # notes.json의 `turn.{장수}`가 있으면 그것이 이긴다(서서 — 함성이 아니라 비통한 다짐, 2026-11-16 기획자)
            "note": notes.get(f"turn.{r['id']}") or f"In-game turn bark: a short, signature battle cry when this character takes their turn. Punchy and iconic.{how}",
            "game": t["file"],
        }
    return out


def batches(dubs: list, only: set) -> list:
    """(화자, 더빙, 조각 번호, 줄들) — 줄은 판 차례(가나다) → 판 안 차례. 번역이 없는 줄은 뺀다.
    한국어는 맨 앞에 게임 차례 음성 한 줄을 더 넣는다(`turn_lines`)."""
    data = load_json(LINES)
    by = {sp: [ln] for sp, ln in turn_lines().items()}
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
        n = ln.get("note") or notes.get(ln["key"])
        if n:
            note_lines.append(f"Line {i}: {n}")
    per_line = ("\n" + "\n".join(note_lines)) if note_lines else ""
    transcript = "\n\n".join(ln["text"][dub].strip() for ln in lines)
    lang = LANG_NAME[dub]
    return f"""Synthesize only the TRANSCRIPT below in {lang}. Do not read any instructions aloud, including speaker names, line numbers or notes.
Read each transcript line exactly once, in order, then stop. Never repeat the transcript or any line of it.

# AUDIO PROFILE
{c.get(f'profile_{dub}', c['profile']).strip()}

## THE SCENE
{BASE_SCENE} The transcript has {len(lines)} lines.

### DIRECTOR'S NOTES
Language: {LANG_STYLE[dub]}
{COMMON_NOTES.format(gap=GAP_SECONDS)}{per_line}

#### TRANSCRIPT
{transcript}
"""


def build_style(speaker: str, dub: str, lines: list, cast: dict, notes: dict) -> str:
    """AI Studio의 Style instructions 칸 — 목소리 · 장면 · 연기 지시만. 읽을 글은 하나도 안 든다.
    한 칸에 지시와 대본을 함께 붙이면 모델이 지시를 대본 삼아 엉뚱한 말을 지어냈다(2026-11-16 기획자)."""
    c = cast[speaker]
    notes_txt = "\n".join(f"{i}. {ln.get('note') or notes[ln['key']]}" for i, ln in enumerate(lines, 1) if ln.get("note") or notes.get(ln["key"]))
    return f"""Read the text aloud exactly as written, in {LANG_NAME[dub]}, as a voice actor playing this character. Do not add, change or improvise any words.

Character: {c.get(f'profile_{dub}', c['profile']).strip()}

Scene: {BASE_SCENE}
Language: {LANG_STYLE[dub]}
{COMMON_NOTES.format(gap=GAP_SECONDS)}
""" + (f"\nEmotion of each line, in order (do not read these):\n{notes_txt}\n" if notes_txt else "")


def build_text(dub: str, lines: list) -> str:
    """AI Studio의 본문 칸 — 읽을 대사만, 빈 줄로 띄워서."""
    return "\n\n".join(ln["text"][dub].strip() for ln in lines)


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


FX = DUB_DIR / "fx.json"
CUT_FIX = DUB_DIR / "cut_fix.json"
"""손으로 맞춘 자른 자리 — `{"EN": {"je-gal-ryang.say9": {"end": 87.2}}}`(초, 원본 기준). 받아쓰기가 이웃 줄의 감탄사를 딸려 붙인 곳(2026-11-18 EN 제갈량 「Ah」).
원본이 바뀌면(sig가 다르면) 맞지 않으므로 `sig` 칸이 같을 때만 쓴다."""
# 산울림 — (지연 초, 크기). 멀리 갈수록 작고 뭉툭해진다(한 극 저역 통과). 전장 너머 골짜기에 되울리는 정도
ECHO_TAPS = ((0.17, 0.34), (0.35, 0.20), (0.55, 0.11), (0.78, 0.05))


def echo(pcm: bytes) -> bytes:
    import array
    dry = array.array("h", pcm)
    n = len(dry)
    tail = int(SAMPLE_RATE * (ECHO_TAPS[-1][0] + 0.15))
    out = [float(x) for x in dry] + [0.0] * tail
    for k, (sec, gain) in enumerate(ECHO_TAPS):
        d, lp, y = int(SAMPLE_RATE * sec), 0.55 - 0.1 * k, 0.0
        for i in range(n):
            y += lp * (dry[i] - y)
            out[i + d] += gain * y
    peak = max(1.0, max(abs(v) for v in out))
    scale = min(1.0, 32000.0 / peak)
    return array.array("h", (int(v * scale) for v in out)).tobytes()


def save_wav(path: Path, pcm: bytes) -> float:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm)
    return len(pcm) / SAMPLE_WIDTH / SAMPLE_RATE


def read_wav(path: Path) -> bytes:
    """24kHz · 16-bit · 모노가 아니면 멈춘다 — 자르는 창 · 쉼의 길이가 그 형식을 가정한다."""
    with wave.open(str(path), "rb") as wf:
        fmt = (wf.getframerate(), wf.getsampwidth(), wf.getnchannels())
        if fmt != (SAMPLE_RATE, SAMPLE_WIDTH, CHANNELS):
            raise ValueError(f"{path.name}: {fmt[0]}Hz · {fmt[1] * 8}-bit · {fmt[2]}ch — 24000Hz · 16-bit · 모노로 바꿔 다시 둔다")
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
    def __init__(self, msg: str = "", delay: float = 0.0):
        super().__init__(msg)
        self.delay = delay  # 구글이 알려 준 「다시 몇 초 뒤」


def retry_delay_seconds(err: Exception) -> float:
    m = re.search(r"retryDelay'?:\s*'(\d+(?:\.\d+)?)s'", str(err))
    return float(m.group(1)) if m else 0.0


def quota_reason(err: Exception, delay: float) -> str:
    """한도 오류를 한 줄로 — 어느 한도(quotaId)인지 · 기다리라는 시간. 못 찾으면 문구 앞부분."""
    s = str(err)
    ids = sorted(set(re.findall(r"quotaId'?:\s*'([^']+)'", s)))
    vals = sorted(set(re.findall(r"quotaValue'?:\s*'([^']+)'", s)))
    head = (" · ".join(ids) + (f" (한도 {'/'.join(vals)})" if vals else "")) if ids else s[:240].replace("\n", " ")
    return head + (f" · 다시 {delay:.0f}초 뒤" if delay else "")


def generate(client, types, voice: str, prompt: str, retries: int = 3) -> bytes:
    for attempt in range(1, retries + 1):
        try:
            r = hard_deadline(lambda: client.models.generate_content(
                model=MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))),
                ),
            ), TTS_TIMEOUT_MS / 1000 + 30)
            return r.candidates[0].content.parts[0].inline_data.data
        except Exception as e:
            delay = retry_delay_seconds(e)
            if "PerDay" in str(e) or delay > 300:
                raise DailyQuotaExceeded(quota_reason(e, delay), delay)
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


BOARD_TEMPLATE = Path(__file__).resolve().parent / "tutorial_dub_board.html"
BOARD = DUB_DIR / "더빙작업판.html"
LANG_LABEL = {"KR": "한국어", "EN": "영어", "JP": "일본어", "PT": "포르투갈어(브라질)", "CA": "중국어(만다린)"}


def cmd_html(args):
    """AI Studio에 붙여 넣는 작업판 — 화자 × 언어마다 Style instructions(`build_style`)와 본문(`build_text`)을 따로,
    저장 이름 · 줄마다 「한 줄 다시」(그 줄의 Style + 대사 한 줄)."""
    dubs, only, _ = parse(args)
    cast, notes = load_json(CAST), load_json(NOTES, {})
    data = load_json(LINES)
    todo = check_cast(batches(dubs, only), cast)
    for c in voice_clashes(cast):
        print(f"⚠ 같은 목소리 — {c}")
    stage_name = {sc["stage"]: sc["officerName"] for sc in data["scenarios"]}
    stages_of = {}
    for sc in data["scenarios"]:
        for ln in sc["lines"]:
            names = stages_of.setdefault(ln["speaker"], [])
            if stage_name[sc["stage"]] not in names:
                names.append(stage_name[sc["stage"]])
    jobs = {}
    for sp, dub, part, lines in todo:
        jobs.setdefault(f"{sp}|{dub}", []).append({
            "part": part,
            "file": base_name(sp, dub, part) + ".wav",
            "style": build_style(sp, dub, lines, cast, notes).strip(),
            "text": build_text(dub, lines),
            "lines": [{
                "key": ln["key"],
                "out": ln["key"].removeprefix("tut.s."),
                "stageName": stage_name[ln["stage"]] if ln["stage"] else "게임 차례 음성",
                "game": ln.get("game"),
                "text": ln["text"][dub],
                "ko": ln["text"]["KR"],
                "note": ln.get("note") or notes.get(ln["key"], ""),
                "retakeStyle": build_style(sp, dub, [ln], cast, notes).strip(),
            } for ln in lines],
        })
    speakers = [{
        "id": sp, "name": c["name"], "lines": c["lines"], "voice": c["voice"], "profile": c["profile"],
        "ko": c.get("ko", ""), "stages": stages_of.get(sp, []),
    } for sp, c in cast.items() if any(k.startswith(f"{sp}|") for k in jobs)]
    payload = {
        "model": MODEL,
        "langs": [{"id": d, "name": LANG_LABEL[d]} for d in dubs],
        "speakers": speakers,
        "jobs": jobs,
        "total": sum(s["lines"] for s in speakers),
        "calls": len(todo),
        "got": sorted(k for k in jobs if have_source(*k.split("|"))),   # 「화자|언어」 — 원본이 이미 있는 것
    }
    blob = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    html = BOARD_TEMPLATE.read_text(encoding="utf-8").replace("/*DATA*/null", blob, 1)
    BOARD.write_text(html, encoding="utf-8")
    print(f"작업판 → {BOARD} (화자 {len(speakers)} · 호출 {len(todo)} · {BOARD.stat().st_size / 1024:.0f}KB)")


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
    client = genai.Client(http_options=types.HttpOptions(api_version=API_VERSION))
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
                pcm = generate(client, types, cast[sp].get(f"voice_{dub}", cast[sp]["voice"]), prompt)
            except DailyQuotaExceeded:
                log.write("- (하루 한도 초과로 중단)\n")
                print("\n하루 한도를 다 썼다. 같은 명령을 다시 돌리면 받은 것은 건너뛰고 이어 간다.")
                return
            pcm = unwrap_wav(pcm)
            sec = save_wav(wav, pad(pcm))
            (RAW / dub / f"{name}.txt").write_text(manifest(lines, dub), encoding="utf-8")
            found = len(voiced_spans(pcm, GAP_SECONDS * 0.6))
            flag = "" if found == len(lines) else f"  ⚠ 쉼으로 가른 덩어리 {found} ≠ 줄 {len(lines)}"
            print(f"    저장 {sec:.1f}초{flag}")
            log.write(f"### {name} — `{cast[sp]['voice']}` · {sec:.1f}초{flag}\n\n```\n{prompt.strip()}\n```\n\n")
            done += 1
            time.sleep(SLEEP_BETWEEN_CALLS)
    print(f"\n받음 {done}개 → {RAW}")


# ─────────────────────────── 자르기 ───────────────────────────
# 받은 원본은 줄 사이를 2초 쉬라 해도 실제로는 0.8~1.2초이고, 대사 안의 쉼(「주공…」)도 0.7~0.9초라
# 「긴 쉼에서 자른다」만으로는 17명 중 11명이 엉뚱한 자리에서 잘렸다(2026-11-17 실측). 그래서
# **쉼의 길이 + 대사 글자 수에 맞는 길이**를 함께 보고 줄 수만큼 나누는 동적 계획법으로 자른다(`align`).
NEW_DIR = ROOT / "assets" / "Audio" / "new"   # 기획자가 AI Studio에서 받아 두는 자리: New_{더빙}/{한글이름}_{더빙}[_skip focus].mp3
SKIP_FOCUS = "_skip focus"                    # 붙으면 첫 줄(게임 차례 음성) 없이 받은 것 — 차례 음성은 기존 게임 음원을 그대로 쓴다
REPORT = "_cut.json"                          # 자른 폴더에 남기는 표 — 줄마다 원본 · 구간 · 해시 · 의심 표지 (stale이 읽는다)
REVIEW = "_듣기.html"
SIM_OK = 0.75                                 # 받아쓴 글과 대사의 닮음이 이보다 낮으면 들어 볼 곳 · 0.6 아래면 auto가 다시 받는다
SIM_REDO = 0.6                         # 자른 폴더의 들어 보기 판


def decode(path: Path) -> bytes:
    """mp3든 wav든 24kHz · 16-bit · 모노 PCM으로 — ffmpeg(winget)로 푼다."""
    import subprocess
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"],
                       capture_output=True)
    if r.returncode or not r.stdout:
        raise ValueError(f"{path.name}: ffmpeg로 못 읽었다 — {r.stderr.decode(errors='replace')[:200]}")
    return r.stdout


def syllables(text: str) -> float:
    """읽는 길이의 눈대중 — 글자 수 + 문장부호마다 짧은 쉼."""
    return len(re.findall(r"[가-힣ぁ-んァ-ン一-龥A-Za-z0-9]", text)) + 0.45 * len(re.findall(r"…|\.\.+|[,.!?。、，！？]", text))


def align(pcm: bytes, lines: list, dub: str):
    """말소리 덩어리를 줄 수만큼 묶는다 — 점수 = 줄 사이 쉼의 길이 × 4 − 6 × (log(실제 길이 / 글자로 본 길이))².
    돌려주는 것: 줄마다 (시작 초, 끝 초, 앞 쉼, 길이비)."""
    import math
    spans = voiced_spans(pcm, 0.25)
    n, k = len(spans), len(lines)
    if n < k:
        raise ValueError(f"말소리 덩어리 {n} < 줄 {k} — 줄이 빠졌거나 붙어 읽혔다")
    S = [x / SAMPLE_RATE for x, _ in spans]
    E = [y / SAMPLE_RATE for _, y in spans]
    want = [syllables(ln["text"][dub]) for ln in lines]
    rate = (E[-1] - S[0]) / sum(want)
    # 부름말로 시작하는 줄(「주공,」 「군사,」 「청강검…」 — 문장부호 앞이 세 글자 이하)은 그 짧은 덩어리로 시작해야 한다.
    # 부름말 뒤의 쉼이 줄 사이 쉼보다 길게 읽혀, 쉼만 보면 부름말이 앞 줄 끝에 딸려 갔다(조운 여섯 줄, 2026-11-17).
    # 줄의 처음 · 끝 구절 전부에 벌점을 걸어 봤더니 손권 · 장수 · 주유의 맞던 자리가 틀어졌다 — 부름말에만 건다.
    call = [syllables(m.group(1)) if (m := re.match(r"^\s*([^,.!?…。、，！？—]{1,8}?)\s*(?:,|…|\.\.+)", ln["text"][dub])) and syllables(m.group(1)) <= 3 else 0
            for ln in lines]

    # 부름말 줄의 바로 앞 줄은 끝 구절보다 한참 짧은 덩어리로 끝나면 안 된다(그 덩어리가 부름말이다)
    tail = [syllables(([x for x in re.split(r"…|\.\.+|[,.!?。、，！？—]", ln["text"][dub]) if syllables(x) >= 1] or [ln["text"][dub]])[-1])
            for ln in lines]

    def seg(a, b, j):
        v = -6.0 * math.log(max(0.05, E[b - 1] - S[a]) / (want[j] * rate)) ** 2
        if call[j]:  # 첫 덩어리가 부름말보다 한참 길면 다음 말부터 잘못 시작한 것
            v -= 8.0 * max(0.0, math.log((E[a] - S[a]) / (2.5 * call[j] * rate))) ** 2
        if j + 1 < len(lines) and call[j + 1]:
            v -= 8.0 * min(0.0, math.log(max(0.05, E[b - 1] - S[b - 1]) / (0.5 * tail[j] * rate))) ** 2
        return v
    NEG = float("-inf")
    best = [[NEG] * (n + 1) for _ in range(k + 1)]
    back = [[0] * (n + 1) for _ in range(k + 1)]
    best[0][0] = 0.0
    for j in range(1, k + 1):
        for e in range(j, n - (k - j) + 1):
            for a in range(j - 1, e):
                if best[j - 1][a] == NEG:
                    continue
                v = best[j - 1][a] + seg(a, e, j - 1) + (4.0 * (S[a] - E[a - 1]) if a else 0.0)
                if v > best[j][e]:
                    best[j][e], back[j][e] = v, a
    cuts, e = [], n
    for j in range(k, 0, -1):
        a = back[j][e]
        cuts.append((a, e))
        e = a
    cuts.reverse()
    out = []
    for j, (a, e) in enumerate(cuts):
        before = S[a] - E[a - 1] if a else S[a]
        after = S[e] - E[e - 1] if e < n else len(pcm) / SAMPLE_WIDTH / SAMPLE_RATE - E[e - 1]
        # 앞은 숨소리 조금, 뒤는 꼬리(메아리 · 여운)를 쉼의 절반까지 — 다음 줄의 첫소리는 안 들어온다
        st = max(0.0, S[a] - min(0.12, before / 2))
        en = E[e - 1] + min(0.45, after / 2)
        out.append((st, en, round(before, 2) if a else 0.0, round((E[e - 1] - S[a]) / (want[j] * rate), 2)))
    return out


# 받아쓰기로 맞추기 — 길이 · 쉼만 보고 자르면 모델이 줄을 **한 번 더 읽거나** 붙여 읽었을 때 통째로 밀린다(곽가: 마지막 줄을
# 두 번 읽어 세 조각이 전부 한 줄씩 어긋났다, 2026-11-17). 그래서 말소리 덩어리마다 받아쓰게 하고(글 모델 한 번),
# 받아쓴 글이 대사와 가장 잘 맞도록 덩어리를 줄에 묶는다 — 남는 덩어리(되풀이 · 잡음 · 끝의 「치직」)는 버린다.
ASR_MODEL = "gemini-3.5-flash"
ASR_LANG = {"KR": "Korean", "EN": "English", "JP": "Japanese", "PT": "Brazilian Portuguese", "CA": "Mandarin Chinese"}


def norm(text: str) -> str:
    return re.sub(r"[\W_]+", "", text.lower())


def similar(a: str, b: str) -> float:
    import difflib
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def wav_bytes(pcm: bytes) -> bytes:
    import io
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm)
    return buf.getvalue()


# 덩어리를 **한 요청에 하나씩** 받아쓴다. 여러 덩어리를 한 요청에 넣으면 모델이 글을 덩어리에 제 마음대로 나눠 담아
# (정욱: 「인정은 / 쓸모없다」로 쪼개 적었지만 실제 두 번째 덩어리는 「영천의 서서입니다」였다) 자른 자리가 통째로 밀렸다(2026-11-17).
# 무료 등급은 모델마다 분당 5번이라 (키 × 모델)을 돌려 가며 쓰고, 앞에서부터 받아써 **대사 전체가 한 번 다 들리면 멈춘다**
# (모델이 대본을 되풀이해 읽어도 첫 번째 읽기까지만 듣는다).
ASR_MODELS = ("gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite")   # 2.5-flash는 404(내려감)
ASR_TIMEOUT_MS = 60_000      # 응답 없는 요청에서 영원히 멈추지 않게 (11-19: 받아쓰기 하나가 22분 멈춰 받기 전체가 섰다)
TTS_TIMEOUT_MS = 300_000     # 긴 원본(3분 넘는 판)도 들어오는 시간
ASR_GAP = 13.0                  # 같은 (키, 모델)을 다시 쓰기까지 — 분당 5번
_asr_last: dict = {}            # (키 번호, 모델) → 마지막으로 쓴 시각
_asr_dead: set = set()          # 하루 한도에 걸린 (키 번호, 모델)


def hard_deadline(fn, seconds: float):
    """fn을 딴 실에서 돌리고 seconds가 지나도 안 끝나면 TimeoutError — SDK의 timeout이 듣지 않고 연결이 열린 채 몇십 분 멈췄다(11-19).
    멈춘 실은 버린다(데몬 실이라 프로세스가 끝나면 함께 사라진다)."""
    import threading
    box = {}
    def run():
        try:
            box["v"] = fn()
        except BaseException as e:   # noqa: BLE001 — 그대로 다시 던진다
            box["e"] = e
    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(seconds)
    if t.is_alive():
        raise TimeoutError(f"{seconds:.0f}초 안에 응답이 없다")
    if "e" in box:
        raise box["e"]
    return box["v"]


def transcribe_one(clip_wav: bytes, dub: str):
    from google import genai
    from google.genai import types
    keys = api_keys()
    pairs = [(k, m) for m in ASR_MODELS for k in range(len(keys)) if (k, m) not in _asr_dead]
    for _ in range(len(pairs) + 3):
        pairs = [x for x in pairs if x not in _asr_dead]
        if not pairs:
            return None
        pair = min(pairs, key=lambda x: _asr_last.get(x, 0.0))
        wait = _asr_last.get(pair, 0.0) + ASR_GAP - time.time()
        if wait > 0:
            time.sleep(wait)
        _asr_last[pair] = time.time()
        try:
            client = genai.Client(api_key=keys[pair[0]], http_options=types.HttpOptions(api_version=API_VERSION, timeout=ASR_TIMEOUT_MS))
            r = hard_deadline(lambda: client.models.generate_content(model=pair[1], contents=[types.Content(role="user", parts=[
                types.Part.from_text(text=f"Transcribe this short {ASR_LANG[dub]} audio clip verbatim, in {ASR_LANG[dub]} script. "
                                          "Reply with only the spoken words. If there is no speech (noise, click, breath), reply with nothing."),
                types.Part.from_bytes(data=clip_wav, mime_type="audio/wav")])],
                config=types.GenerateContentConfig(temperature=0)), ASR_TIMEOUT_MS / 1000 + 15)
            return (r.text or "").strip()
        except Exception as e:
            msg = str(e)
            if "PerDay" in msg or "per day" in msg.lower():
                _asr_dead.add(pair)
            elif "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                _asr_last[pair] = time.time() + 45   # 1분 쉬게
            else:
                print(f"    받아쓰기 오류({pair[1]}): {msg[:100]}", flush=True)
    return None


def transcribe(pcm: bytes, spans: list, dub: str, lines: list):
    """덩어리마다 받아쓴 글 — 대사 전체가 한 번 다 들리면 나머지는 ""(되풀이 · 잡음). 키가 없거나 실패하면 None."""
    if not api_keys():
        return None
    whole = "".join(ln["text"][dub] for ln in lines)
    heard = []
    for n, (a, b) in enumerate(spans):
        h = transcribe_one(wav_bytes(pcm[a * SAMPLE_WIDTH:b * SAMPLE_WIDTH]), dub)
        if h is None:
            return None
        heard.append(h)
        if (n + 1) % 10 == 0:
            print(f"    받아쓰기 {n + 1}/{len(spans)}덩어리", flush=True)
        if similar("".join(heard), whole) >= 0.92:
            return heard + [""] * (len(spans) - n - 1)
    return heard


def align_by_text(pcm: bytes, spans: list, heard: list, lines: list, dub: str):
    """줄마다 이어진 덩어리 한 묶음 — 받아쓴 글과 대사의 닮음 합이 가장 크게. 줄 사이 · 끝의 덩어리는 버릴 수 있다.
    돌려주는 것: 줄마다 (시작 초, 끝 초, 닮음, 들린 글), 버린 덩어리의 글."""
    n, k = len(spans), len(lines)
    NEG = float("-inf")
    best = [[NEG] * (n + 1) for _ in range(k + 1)]
    back = [[None] * (n + 1) for _ in range(k + 1)]
    best[0][0] = 0.0
    sims = {}
    for j in range(k + 1):
        for i in range(n + 1):
            v = best[j][i]
            if v == NEG:
                continue
            if i < n:  # 덩어리 i를 버린다 — 말이 든 덩어리는 조금 벌점
                w = v - (0.05 if norm(heard[i]) and j < k else 0.0)   # 다 읽은 뒤(되풀이)는 버려도 벌점 없음 — 첫 번째 읽기를 고른다(장간)
                if w > best[j][i + 1]:
                    best[j][i + 1], back[j][i + 1] = w, ("skip", i)
            if j < k:
                for e in range(i + 1, min(n, i + 12) + 1):
                    key = (j, i, e)
                    if key not in sims:
                        sims[key] = similar("".join(heard[i:e]), lines[j]["text"][dub])
                    w = v + sims[key]
                    if w > best[j + 1][e]:
                        best[j + 1][e], back[j + 1][e] = w, ("take", i)
    if best[k][n] == NEG:
        raise ValueError("받아쓴 덩어리를 줄에 묶지 못했다")
    runs, dropped, j, e = [], [], k, n
    while j > 0 or e > 0:
        kind, i = back[j][e]
        if kind == "skip":
            if norm(heard[i]):
                dropped.append(heard[i])
            e = i
        else:
            runs.append((i, e))
            j, e = j - 1, i
    runs.reverse()
    dropped.reverse()
    # 말이 안 든 덩어리(받아쓰기 "")는 줄의 앞뒤에 붙이지 않는다 — 닮음에 안 닿아 뒤의 되풀이 · 잡음까지 끌고 갔다(정욱 26초)
    trimmed = []
    for a, e in runs:
        while e - a > 1 and not norm(heard[e - 1]):
            e -= 1
        while e - a > 1 and not norm(heard[a]):
            a += 1
        trimmed.append((a, e))
    runs = trimmed
    total = len(pcm) / SAMPLE_WIDTH / SAMPLE_RATE
    S = [a / SAMPLE_RATE for a, _ in spans]
    E = [b / SAMPLE_RATE for _, b in spans]
    out = []
    for j, (a, e) in enumerate(runs):
        before = S[a] - E[a - 1] if a else S[a]
        after = (S[e] - E[e - 1]) if e < n else total - E[e - 1]
        st = max(0.0, S[a] - min(0.12, before / 2))
        en = E[e - 1] + min(0.45, after / 2)
        out.append((st, en, round(similar("".join(heard[a:e]), lines[j]["text"][dub]), 2), " ".join(h for h in heard[a:e] if h.strip())))
    return out, dropped


def unwrap_wav(data: bytes) -> bytes:
    """API가 WAV 파일째(RIFF 머리글) 돌려주면 PCM만 — 그대로 PCM으로 싸면 머리글 44바이트가 「틱」 소리가 된다(2026-11-17)."""
    import io
    if data[:4] != b"RIFF":
        return data
    with wave.open(io.BytesIO(data)) as w:
        if (w.getframerate(), w.getsampwidth(), w.getnchannels()) != (SAMPLE_RATE, SAMPLE_WIDTH, CHANNELS):
            raise ValueError(f"API 소리 형식이 다르다: {w.getframerate()}Hz · {w.getsampwidth() * 8}bit · {w.getnchannels()}ch")
        return w.readframes(w.getnframes())



def sources(dub: str) -> list:
    """(원본 경로, 화자 id, 차례 음성 없음?) — New_{더빙}/{한글이름}_{더빙}[_skip focus].mp3|wav."""
    import unicodedata
    cast = load_json(CAST, {})
    by_name = {unicodedata.normalize("NFC", v["name"]): k for k, v in cast.items()}
    out, folder = [], NEW_DIR / f"New_{dub}"
    for f in sorted(folder.glob("*")) if folder.is_dir() else []:
        if f.suffix.lower() not in (".mp3", ".wav"):
            continue
        stem = unicodedata.normalize("NFC", f.stem)
        skip = SKIP_FOCUS in stem
        name = stem.replace(SKIP_FOCUS, "").strip().removesuffix(f"_{dub}")
        sp = by_name.get(name)
        if not sp:
            print(f"[{dub}] {f.name}: 배역표에 없는 이름 「{name}」 — 「{{한글이름}}_{dub}.mp3」 꼴인지 본다")
            continue
        out.append((f, sp, skip))
    return out


def use_edit(out_dir: Path, name: str) -> str | None:
    """기획자가 손으로 고친 조각 `{이름}_edit.(wav|mp3)`가 곁에 있으면 자른 것 대신 그것을 `{이름}.wav`로 (2026-11-18 EN 장비 메아리).
    고친 파일은 원본으로 두고 매번 다시 옮긴다 — 다시 받거나 다시 잘라도 손질이 안 사라진다."""
    for ext in (".wav", ".mp3"):
        src = out_dir / f"{name}_edit{ext}"
        if src.exists():
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ar", str(SAMPLE_RATE), "-ac", "1",
                            "-sample_fmt", "s16", str(out_dir / f"{name}.wav")], check=True)
            return src.name
    return None


def cmd_split(args):
    """New_{더빙}의 원본을 줄마다 잘라 assets/Audio/voice/tutorial/{더빙}/{이름}.wav로 — 들어 보기 판(_듣기.html)과 표(_cut.json)를 함께 쓴다.
    이름: 튜토리얼 대사 = `{판}.say{n}` (예: gwan-u.say3), 게임 차례 음성 = `turn.{장수}` (KR만, `_skip focus`면 안 만든다)."""
    use_asr = "--no-asr" not in args
    dubs, only, _ = parse([x for x in args if x != "--no-asr"])
    fx = load_json(FX, {})
    for dub in dubs:
        plan = {}
        for sp, d, part, lines in batches([dub], set()):
            plan.setdefault(sp, []).extend(lines)
        srcs = [x for x in sources(dub) if not only or x[1] in only]
        if not srcs:
            continue
        out_dir = AUDIO / dub
        report = load_json(out_dir / REPORT, {})
        for f, sp, skip in srcs:
            lines = list(plan.get(sp, []))
            if skip and lines and lines[0]["key"].startswith("turn."):
                lines = lines[1:]
            if not lines:
                print(f"[{dub}] {f.name}: 이 화자의 {dub} 대사가 없다")
                continue
            try:
                pcm = decode(f)
            except ValueError as e:
                print(f"[{dub}] {f.name}: {e}")
                continue
            sig = f"{f.stat().st_size}:{int(f.stat().st_mtime)}"
            old = report.get(f.name, {})
            if not only and old.get("lines") and old.get("sig") in (sig, None):   # None = 손으로 받아 자른 17명(서명 전)
                continue   # 이미 자른 원본은 --only로 짚어야 다시 자른다 — 들어 보고 확인한 조각이 자르는 법을 고칠 때마다 바뀌지 않게
            # 0.15초보다 짧은 덩어리(딸깍 · 숨)는 뺀다 — 받아쓰기에 넣으면 그 칸에 다음 말을 적어 글이 한 칸씩 밀렸다(곽가 0.04초, 11-17)
            spans = [x for x in voiced_spans(pcm, 0.25) if x[1] - x[0] >= 0.15 * SAMPLE_RATE]
            heard = old.get("heard") if old.get("sig") == sig and len(old.get("heard") or []) == len(spans) else None
            if heard is None and use_asr:
                heard = transcribe(pcm, spans, dub, lines)
            rows, dropped = [], []
            try:
                if heard is not None:
                    cuts, dropped = align_by_text(pcm, spans, heard, lines, dub)
                    cuts = [(st, en, None, None, sim, said) for st, en, sim, said in cuts]
                else:
                    cuts = [(st, en, gap, ratio, None, None) for st, en, gap, ratio in align(pcm, lines, dub)]
            except ValueError as e:
                print(f"[{dub}] {f.name}: {e}")
                continue
            fixes = load_json(CUT_FIX, {}).get(dub, {})
            for (st, en, gap, ratio, sim, said), ln in zip(cuts, lines):
                name = ln["key"].removeprefix("tut.s.")
                fix = fixes.get(name)
                if fix and fix.get("sig") == sig:
                    st, en = fix.get("start", st), fix.get("end", en)
                clip = pad(pcm[int(st * SAMPLE_RATE) * SAMPLE_WIDTH:int(en * SAMPLE_RATE) * SAMPLE_WIDTH])
                save_wav(out_dir / f"{name}.wav", echo(clip) if fx.get(name) == "echo" else clip)
                edited = use_edit(out_dir, name)
                why = []
                if sim is not None and sim < SIM_OK:
                    why.append(f"들린 말이 대사와 다르다(닮음 {sim}) — «{said}»")
                if ratio is not None and not 0.55 <= ratio <= 1.7:
                    why.append(f"길이가 글자 수에 비해 {'길다' if ratio > 1 else '짧다'}({ratio})")
                # 「줄 사이 쉼 < 줄 안의 쉼」은 표지로 안 쓴다 — 말줄임표(「주공…」)마다 떠서 22줄이 다 정상이었다(11-17)
                rows.append({"name": name, "text": ln["text"][dub], "hash": ln["hash"][dub],
                             "start": round(st, 2), "end": round(en, 2), "gap": gap, "ratio": ratio, "sim": sim, "heard": said,
                             "check": why, "game": ln.get("game"), **({"edit": edited} if edited else {})})
            # 같은 화자의 옛 표는 지운다(_skip focus 이름이 바뀌어도 하나만)
            report = {k: v for k, v in report.items() if v.get("speaker") != sp}
            report[f.name] = {"speaker": sp, "name": load_json(CAST, {})[sp]["name"], "skipFocus": skip, "lines": rows,
                              "sig": sig, "heard": heard, "dropped": dropped}
            flags = sum(1 for r in rows if r["check"])
            print(f"[{dub}] {f.name}: {len(rows)}줄" + (" (받아쓰기)" if heard is not None else " (길이로만)")
                  + (f" · 들어 볼 곳 {flags}" if flags else "") + (f" · 버린 말 {len(dropped)}" if dropped else ""))
        (out_dir / REPORT).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        write_review(out_dir, dub, report)
        print(f"[{dub}] 결과 → {out_dir}\n      들어 보기 → {out_dir / REVIEW}")


def auto_banner() -> str:
    """자동 받기가 돌고 있으면 그 상태 한 줄 — 판은 받을 때마다 다시 써지므로 새로고침하면 따라온다."""
    import html as H
    st = load_json(NEW_DIR / "auto_status.json", {})
    if not st:
        return ""
    word = {"calling": "받는 중", "waiting": "기다리는 중", "done": "목록을 다 받음", "quota": "모든 키가 막힘 — 기다렸다 다시", "stopped": "멈춤"}
    nxt = f" · 다음 시도 {st['next']}" if st.get("state") == "waiting" and st.get("next") else (f" · {st['next']}" if st.get("next") else "")
    return (f"<p class=a>자동 받기: <b>{H.escape(word.get(st['state'], st['state']))}</b>{H.escape(nxt)} · 이번 실행 {st.get('got', 0)}개 · "
            f"남은 {st.get('left', 0)}개 · 키 {st.get('keys', 0)}개 중 막힘 {st.get('keysBlocked', 0)} <small>({H.escape(st['at'])} 기준, 기록 assets/Audio/new/auto_log.md)</small></p>")


def write_review(out_dir: Path, dub: str, report: dict) -> None:
    """자른 조각을 화자별로 들어 보는 판 — 같은 폴더의 wav를 상대 경로로 튼다."""
    import html as H
    rank = {sp: i for i, sp in enumerate(load_json(CAST, {}))}
    order = sorted(report.values(), key=lambda v: rank.get(v["speaker"], 999))
    total = sum(len(v["lines"]) for v in order)
    flagged = sum(1 for v in order for r in v["lines"] if r["check"])
    parts = []
    for v in order:
        rows = []
        for i, r in enumerate(v["lines"], 1):
            tag = "<span class=t>게임 차례 음성</span>" if r["name"].startswith("turn.") else ""
            chk = "".join(f"<div class=w>⚠ {H.escape(c)}</div>" for c in r["check"])
            how = f"닮음 {r['sim']}" if r.get("sim") is not None else f"앞 쉼 {r['gap']}s · 길이비 {r['ratio']}"
            rows.append(f"<tr{' class=f' if r['check'] else ''}><td>{i}</td><td><audio controls preload=none src=\"{H.escape(r['name'])}.wav\"></audio></td>"
                        f"<td><div class=x>{H.escape(r['text'])} {tag}</div>{chk}<div class=m>{H.escape(r['name'])}.wav · 원본 {r['start']}~{r['end']}s · {how}</div></td></tr>")
        skip = " <span class=s>_skip focus — 차례 음성은 기존 것</span>" if v["skipFocus"] else ""
        if v.get("dropped"):
            skip += f"<div class=s>잘라 낸 말(되풀이 · 덧말): {H.escape(' / '.join(v['dropped']))}</div>"
        # 확인 완료 — 브라우저에 「화자 = 원본 서명」으로 적는다. 다시 받으면 서명이 바뀌어 저절로 풀린다.
        # 손으로 받은 mp3(2026-11-16~17, 기획자가 다 들은 것)는 처음부터 체크
        src = next((k for k, x in report.items() if x is v), "")
        sig = H.escape(v.get("sig") or src)
        pre = " data-pre=1" if src.lower().endswith(".mp3") else ""
        parts.append(f"<section data-sp=\"{H.escape(v['speaker'])}\" data-sig=\"{sig}\"{pre}><h2>{H.escape(v['name'])} <small>{H.escape(v['speaker'])} · {len(v['lines'])}줄</small>"
                     f" <label class=ok><input type=checkbox> 확인 완료</label>{skip}</h2><table>{''.join(rows)}</table></section>")
    page = f"""<!doctype html><html lang=ko><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>{dub} 더빙 조각 듣기</title><style>
:root{{--bg:#faf8f4;--fg:#222;--mut:#777;--line:#e4dfd6;--warn:#b5520f;--warnbg:#fff3e6;--tag:#2f6f5e}}
@media (prefers-color-scheme:dark){{:root{{--bg:#1b1a18;--fg:#eee;--mut:#999;--line:#3a3733;--warn:#f0a060;--warnbg:#3a2a1c;--tag:#7fd1b8}}}}
body{{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,"Malgun Gothic",sans-serif;margin:0;padding:16px;max-width:980px;margin:auto}}
h1{{font-size:20px}} h2{{font-size:17px;margin:28px 0 8px}} small{{color:var(--mut);font-weight:400}}
table{{width:100%;border-collapse:collapse}} td{{border-top:1px solid var(--line);padding:6px 4px;vertical-align:top}}
td:first-child{{color:var(--mut);width:24px}} audio{{width:260px;max-width:42vw;height:34px}}
.m{{color:var(--mut);font-size:12px}} .w{{color:var(--warn);font-size:13px}} tr.f{{background:var(--warnbg)}}
.t{{color:var(--tag);font-size:12px;border:1px solid currentColor;border-radius:4px;padding:0 4px}} .s{{color:var(--mut);font-size:13px}} .a{{border:1px solid var(--line);border-radius:6px;padding:8px 10px}}
.ok{{font-size:13px;font-weight:400;margin-left:8px;cursor:pointer;white-space:nowrap}} section.done h2{{color:var(--tag)}} section.done table{{opacity:.55}}
.bar{{position:sticky;top:0;background:var(--bg);padding:6px 0;border-bottom:1px solid var(--line);z-index:1}}
</style><h1>{dub} 더빙 조각 듣기</h1>
{auto_banner()}<p>화자 {len(order)}명 · {total}줄 · 들어 볼 곳 {flagged}줄. 잘못 잘린 줄이 있으면 화자와 줄 번호를 알려 주면 다시 자른다.
다시 만들기: <code>python tools/tutorial_dub_generate.py split {dub}</code></p>
<div class=bar>확인 완료 <b id=cnt></b> · <label><input type=checkbox id=hide> 확인한 장수 숨기기</label></div>
{''.join(parts)}
<script>
const K = "samchess.dubReview.{dub}";
let saved = {{}};
try {{ saved = JSON.parse(localStorage.getItem(K) || "{{}}"); }} catch (e) {{}}
const secs = [...document.querySelectorAll("section[data-sp]")];
const done = (s) => s.dataset.sp in saved ? saved[s.dataset.sp] === s.dataset.sig : !!s.dataset.pre;
function paint() {{
  let n = 0;
  for (const s of secs) {{
    const d = done(s); n += d;
    s.classList.toggle("done", d);
    s.querySelector(".ok input").checked = d;
    s.hidden = d && document.getElementById("hide").checked;
  }}
  document.getElementById("cnt").textContent = n + " / " + secs.length;
}}
for (const s of secs) s.querySelector(".ok input").addEventListener("change", (e) => {{
  saved[s.dataset.sp] = e.target.checked ? s.dataset.sig : "";
  try {{ localStorage.setItem(K, JSON.stringify(saved)); }} catch (err) {{}}
  paint();
}});
const hide = document.getElementById("hide");
try {{ hide.checked = localStorage.getItem(K + ".hide") === "1"; }} catch (e) {{}}
hide.addEventListener("change", () => {{ try {{ localStorage.setItem(K + ".hide", hide.checked ? "1" : "0"); }} catch (e) {{}} paint(); }});
paint();
</script></html>"""
    (out_dir / REVIEW).write_text(page, encoding="utf-8")


def cmd_stale(args):
    """자른 표(_cut.json)에 적힌 해시와 지금 대사의 해시를 견준다 — 대사를 고쳤으면 그 화자를 다시 받는다."""
    dubs, _, _ = parse(args)
    every = [ln for sc in load_json(LINES)["scenarios"] for ln in sc["lines"]] + list(turn_lines().values())
    stale = 0
    for dub in dubs:
        now = {ln["key"].removeprefix("tut.s."): ln["hash"].get(dub) for ln in every}
        for src, v in load_json(AUDIO / dub / REPORT, {}).items():
            bad = [r["name"] for r in v["lines"] if now.get(r["name"]) != r["hash"]]
            if bad:
                stale += 1
                print(f"[{dub}] {src} — 대사가 바뀌었다: {', '.join(bad)}")
    print(f"낡은 원본 {stale}개")


# ─────────────────────────── 자동 받기 ───────────────────────────
# AI Studio에 손으로 붙여 넣고 받고 자르던 일을 API로 — 뒤에서 몇 시간씩 돈다(2026-11-17 기획자).
#   - 한 번 시도한 뒤 AUTO_INTERVAL초를 쉰다(성공이든 실패든). 몰아 보내면 서버가 오류를 낸다.
#   - 테이크는 하나. 마음에 안 들면 New_{더빙}의 그 파일을 지우면 돌고 있는 동안 다시 받는다.
#   - 키는 여럿 — 하루 한도에 걸린 키는 그날 쉬고 다음 키로. 모든 키가 막히면 멈춘다.
#   - 받는 순서는 배역표(cast.json) 순서 = 작업판 순서. New_{더빙}에 이미 있는 화자는 건너뛴다(손으로 받은 것 · _skip focus 포함).
#   - 받으면 바로 그 화자를 잘라(`split`) 들어 보기 판을 갱신한다.
AUTO_INTERVAL = 180
AUTO_REDO = 2                     # 대사가 안 맞는 줄(닮음 < SIM_REDO)이 있으면 이만큼까지 다시 받는다
AUTO_QUOTA_RETRY = 1800    # 막힌 키는 30분 뒤 다시 찔러 본다 — 구글이 알려 주는 「몇 만 초 뒤」는 실제와 안 맞았다(11-18: 곧 다시 받히기도) · 모두 막혀도 끝내지 않고 기다린다
KEYS_FILE = Path.home() / ".samchess" / "gemini_keys.txt"   # 한 줄에 키 하나 — 저장소 밖(git에 안 들어간다)
STOP_FILE = NEW_DIR / "STOP"                                 # 만들면 지금 시도를 마치고 멈춘다
AUTO_LOG = NEW_DIR / "auto_log.md"
AUTO_STATUS = NEW_DIR / "auto_status.json"


def api_keys() -> list:
    keys = []
    if KEYS_FILE.exists():
        keys += [k.strip() for k in KEYS_FILE.read_text(encoding="utf-8").splitlines() if k.strip() and not k.startswith("#")]
    for v in ("GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3"):
        if os.environ.get(v) and os.environ[v] not in keys:
            keys.append(os.environ[v])
    return keys


def have_source(sp: str, dub: str) -> bool:
    return any(x[1] == sp for x in sources(dub))


def auto_queue(dubs: list, only: set) -> list:
    """(화자, 더빙, 줄들) — 배역표 순서, 아직 원본이 없는 것만."""
    cast = load_json(CAST)
    order = {sp: i for i, sp in enumerate(cast)}
    jobs = [(sp, d, lines) for sp, d, part, lines in check_cast(batches(dubs, only), cast)]
    jobs.sort(key=lambda j: (dubs.index(j[1]), order.get(j[0], 999)))
    return [j for j in jobs if not have_source(j[0], j[1])]


def cmd_auto(args):
    """뒤에서 계속 받는다 — python tools/tutorial_dub_generate.py auto [KR ...] [--only 화자 ...]"""
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        sys.exit("pip install google-genai")
    keys = api_keys()
    if not keys:
        sys.exit(f"API 키가 없다 — {KEYS_FILE}에 한 줄에 하나씩 적는다")
    dubs, only, _ = parse(args)
    if not [a for a in args if a in LANG_NAME]:
        dubs = ["KR"]   # 언어를 안 적으면 한국어만 — 다른 언어는 적어서 연다
    cast, notes = load_json(CAST), load_json(NOTES, {})
    NEW_DIR.mkdir(parents=True, exist_ok=True)
    STOP_FILE.unlink(missing_ok=True)
    dead = {}            # 키 번호 → 막힌 시각
    k = 0
    tries = {}           # 화자|더빙 → 연속 실패 수
    redos = {}           # 화자|더빙 → 대사가 안 맞아 다시 받은 수
    got = 0

    def log(msg: str) -> None:
        line = f"- {datetime.now():%m-%d %H:%M:%S} {msg}"
        print(line, flush=True)
        with open(AUTO_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")

    def status(state: str, nxt=None, left=0) -> None:
        AUTO_STATUS.write_text(json.dumps({
            "state": state, "at": f"{datetime.now():%Y-%m-%d %H:%M:%S}", "next": nxt, "left": left, "got": got,
            "keys": len(keys), "keysBlocked": len(dead), "pid": os.getpid(), "interval": AUTO_INTERVAL,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        for d in dubs:   # 판 머리의 상태 줄도 따라오게
            if (AUDIO / d / REPORT).exists():
                rep = load_json(AUDIO / d / REPORT)
                write_review(AUDIO / d, d, rep)

    log(f"시작 — 키 {len(keys)}개 · {AUTO_INTERVAL}초 간격 · 언어 {' '.join(dubs)}")
    # 받아 놓고 못 자른 원본(자르는 도중 멈춘 실행)부터 자른다 — split은 이미 자른 원본을 건너뛰므로 싸다 (11-19: 화웅 EN이 받힌 채 안 잘려 옛 조각이 남았다)
    for d in dubs:
        if (NEW_DIR / f"New_{d}").is_dir():
            try:
                cmd_split([d])
            except Exception as e:   # noqa: BLE001 — 자르기가 실패해도 받기는 이어 간다
                log(f"{d} 못 자른 원본 자르기 실패 — {e}")
    while True:
        if STOP_FILE.exists():
            log("STOP 파일 — 멈춘다")
            status("stopped")
            return
        # 막힌 키는 구글이 알려 준 시각(없으면 30분)까지 쉬게 한다 — 모두 막혀도 끝내지 않고 기다린다
        dead = {i: wake for i, wake in dead.items() if time.time() < wake}   # 키 → 다시 써 볼 시각
        queue = auto_queue(dubs, only)
        if not queue:
            log(f"목록을 다 받았다 — 이번 실행 {got}개")
            status("done")
            return
        live = [i for i in range(len(keys)) if i not in dead]
        if not live:
            wake = min(dead.values())
            log(f"키 {len(keys)}개가 모두 막혔다 — {datetime.fromtimestamp(wake):%H:%M}에 다시 써 본다. 이번 실행 {got}개, 남은 {len(queue)}개")
            status("quota", f"{datetime.fromtimestamp(wake):%H:%M:%S}", len(queue))
            while time.time() < wake and not STOP_FILE.exists():
                time.sleep(5)
            continue
        if k not in live:
            k = live[0]
        sp, dub, lines = queue[0]
        cast, notes = load_json(CAST), load_json(NOTES, {})   # 도는 동안 배역 · 지시를 고쳐도 다음 장수부터 따라온다
        name = cast[sp]["name"]
        status("calling", f"{name} {dub}", len(queue))
        t0 = time.time()
        try:
            client = genai.Client(api_key=keys[k], http_options=types.HttpOptions(api_version=API_VERSION, timeout=TTS_TIMEOUT_MS))
            pcm = generate(client, types, cast[sp].get(f"voice_{dub}", cast[sp]["voice"]), build_prompt(sp, dub, lines, cast, notes), retries=1)
            if not pcm:
                raise RuntimeError("소리 없이 돌아왔다")
        except DailyQuotaExceeded as e:
            dead[k] = time.time() + min(e.delay + 60 if e.delay else AUTO_QUOTA_RETRY, AUTO_QUOTA_RETRY)   # 알려 준 시각이 더 짧을 때만 따른다
            log(f"키 {k + 1} 한도 — 다음 키로 ({e})")
            continue   # 다른 키로 바로 — 같은 키를 몰아 치는 것이 아니다
        except Exception as e:
            n = tries[f"{sp}|{dub}"] = tries.get(f"{sp}|{dub}", 0) + 1
            log(f"{name} {dub} 실패 ({n}번째, 키 {k + 1}): {str(e)[:160]}")
        else:
            tries.pop(f"{sp}|{dub}", None)
            src = NEW_DIR / f"New_{dub}" / f"{name}_{dub}.wav"
            sec = save_wav(src, unwrap_wav(pcm))
            got += 1
            cmd_split([dub, "--only", sp])
            try:
                cmd_html([])   # 작업판의 「받음」도 따라오게
            except Exception as e:
                print(f"    작업판 굽기 실패: {e}")
            rep =load_json(AUDIO / dub / REPORT, {}).get(src.name)
            worst = min((r["sim"] for r in rep["lines"] if r.get("sim") is not None), default=1.0) if rep else 0.0
            redo = redos.get(f"{sp}|{dub}", 0)
            if worst < SIM_REDO and redo < AUTO_REDO:
                # 대사가 안 맞는 줄이 있으면 버리고 다시 받는다 — 버린 원본은 _다시받음/에 남긴다(들어 볼 수 있게)
                redos[f"{sp}|{dub}"] = redo + 1
                bad = src.parent / "_다시받음" / f"{src.stem}.1{src.suffix}"
                bad.parent.mkdir(exist_ok=True)
                n = 1
                while bad.exists():   # 손으로 옮겨 둔 것 · 앞서 버린 것을 덮지 않는다
                    n += 1
                    bad = bad.with_name(f"{src.stem}.{n}{src.suffix}")
                src.replace(bad)
                log(f"{name} {dub} 받음 {sec:.1f}초 — 대사가 안 맞는 줄이 있어(닮음 {worst}) 다시 받는다 ({redo + 1}/{AUTO_REDO})")
            elif not rep:
                log(f"{name} {dub} 받음 {sec:.1f}초 — ⚠ 줄 수만큼 못 잘랐다. 다시 받으려면 {src.name}을 지운다")
            else:
                flags = sum(1 for r in rep["lines"] if r["check"])
                drop = len(rep.get("dropped") or [])
                log(f"{name} {dub} 받음 {sec:.1f}초 · {len(rep['lines'])}줄 잘림" + (f" · 들어 볼 곳 {flags}" if flags else "")
                    + (f" · 되풀이 · 덧말 {drop}덩어리 잘라 냄" if drop else "") + f" (키 {k + 1})")
        left = len(auto_queue(dubs, only))
        if not left:
            continue
        nxt = datetime.fromtimestamp(t0 + AUTO_INTERVAL)
        status("waiting", f"{nxt:%H:%M:%S}", left)
        while time.time() < t0 + AUTO_INTERVAL and not STOP_FILE.exists():
            time.sleep(2)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    a = sys.argv[1:]
    cmds = {"prompts": cmd_prompts, "html": cmd_html, "run": cmd_run, "split": cmd_split, "stale": cmd_stale, "auto": cmd_auto}
    if not a or a[0] not in cmds:
        sys.exit(__doc__)
    cmds[a[0]](a[1:])
