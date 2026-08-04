#!/usr/bin/env python3
"""
초상화 → 전투 씬용 수묵화 흉상

    python tools/build_battle_portraits.py --resize-only  # ← 손으로 받은 PNG를 일괄 축소
    set GEMINI_API_KEY=...
    python tools/build_battle_portraits.py --limit 3      # API로 3장만 시험
    python tools/build_battle_portraits.py                # API로 남은 전부

**쓰는 길이 둘이다.**

1. 구독(Gemini 웹)으로 계속 생성한다 — API 비용이 들지 않는다.
   웹에서 나온 이미지를 *캡처하지 말고 다운로드*해서 `assets/CharsInBattleRaw/`에
   `관우.png`처럼 장수 이름으로 저장한 뒤 `--resize-only`. 화면 배율에 휘둘리지 않고,
   원본 2048px가 남으니 나중에 크기를 바꿔도 다시 받을 일이 없다.
2. API로 전부 자동 생성한다 — `GEMINI_API_KEY`가 필요하고 장당 과금된다.
   구독료와는 별도 청구다. 1번과 출력 폴더·규격은 완전히 같고, 캐시도 공유한다.

`assets/Chars/*.png`(440×540 컬러)를 Gemini 이미지 모델에 넣어 흑백 수묵화 흉상으로
다시 그리게 하고, 결과를 200×200 JPEG로 줄여 `assets/CharsInBattleNew/`에 넣는다.

손으로 만든 `assets/CharsInBattle/` 24장은 건드리지 않는다. 화면 캡처라 807~810px로
크기가 제각각이고 화풍도 이 배치와 섞이므로, 260장을 새 폴더에 처음부터 다시 뽑는다.
비교가 끝나면 옛 폴더를 지우고 `--out`으로 이름을 넘기거나 폴더째 바꿔 끼우면 된다.

**모델 출력 크기는 프롬프트로 못 줄인다.** 1K~2K 정사각으로 나오는 게 정상이고,
축소는 여기서 LANCZOS로 한다. 화면 캡처를 대신하는 부분이 이것이다.

원본 응답 PNG는 `assets/CharsInBattleRaw/`에 그대로 남긴다. 호출은 유료라
재실행할 때 같은 그림을 다시 사겠다고 나서지 않게 하기 위함이다. 크기·품질 기준을
바꾸고 싶으면 `--resize-only`로 이 캐시에서만 다시 만든다.

의존성: Pillow + 표준 라이브러리(urllib). `assets/Chars/`는 읽기만 한다.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CHARS = ROOT / "assets" / "Chars"
RAW = ROOT / "assets" / "CharsInBattleRaw"   # 모델 응답 원본 캐시 (재축소용)
OUT = ROOT / "assets" / "CharsInBattleNew"

MODEL = "gemini-2.5-flash-image"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# 지금까지 손으로 넣던 프롬프트 그대로. 해상도 요구는 뺐다 — 모델이 못 지키고,
# 지켜봐야 여기서 어차피 다시 줄인다.
PROMPT = """이 인물 초상을 다음 스타일로 다시 그려라.
스타일: 순수 흑백 수묵화(Shuimo) 풍. 모든 색상을 제거하고 오직 검은색 잉크와 회색 그라데이션으로만 표현.
구성: 얼굴부터 가슴까지의 클로즈업 초상화. 정면에 가까운 흉상.
배경: 없음. 흰 여백만 남기고 최소한으로. 가능하면 제거.
인물의 생김새·수염·관모·복장의 특징은 원본을 따른다."""


def call_gemini(api_key: str, png: bytes, timeout: int) -> bytes:
    """이미지 1장을 보내고 생성된 이미지 1장을 받는다. 실패는 예외로 올린다."""
    body = {
        "contents": [{
            "role": "user",
            "parts": [
                {"text": PROMPT},
                {"inline_data": {"mime_type": "image/png",
                                 "data": base64.b64encode(png).decode("ascii")}},
            ],
        }],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": "1:1"},
        },
    }
    req = urllib.request.Request(
        ENDPOINT.format(model=MODEL),
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        payload = json.load(res)

    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            blob = part.get("inlineData") or part.get("inline_data")
            if blob and blob.get("data"):
                return base64.b64decode(blob["data"])

    # 안전 필터에 걸리면 이미지 없이 finishReason만 온다 — 어느 쪽인지 알려준다
    reason = (payload.get("candidates") or [{}])[0].get("finishReason", "?")
    raise RuntimeError(f"이미지가 오지 않았다 (finishReason={reason})")


def to_jpeg(raw: bytes | Path, size: int, quality: int) -> bytes:
    """받은 PNG를 size×size JPEG로. 정사각이 아니면 가운데를 잘라 맞춘다."""
    with Image.open(BytesIO(raw) if isinstance(raw, bytes) else raw) as im:
        im = im.convert("RGB")
        side = min(im.size)
        left, top = (im.width - side) // 2, (im.height - side) // 2
        im = im.crop((left, top, left + side, top + side))
        # LANCZOS — 수묵화는 선이 가늘어 축소 필터 차이가 그대로 드러난다
        im = im.resize((size, size), Image.LANCZOS)
        buf = BytesIO()
        im.save(buf, "JPEG", quality=quality, optimize=True, subsampling=0)
        return buf.getvalue()


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT, help=f"출력 폴더 (기본 {OUT.name})")
    ap.add_argument("--raw", type=Path, default=RAW, help=f"응답 원본 캐시 폴더 (기본 {RAW.name})")
    ap.add_argument("--size", type=int, default=200, help="출력 한 변 픽셀 (기본 200)")
    ap.add_argument("--quality", type=int, default=92, help="JPEG 품질 (기본 92)")
    ap.add_argument("--limit", type=int, help="이번에 생성할 최대 장수 (시험용)")
    ap.add_argument("--only", nargs="+", metavar="이름", help="이 장수만 처리")
    ap.add_argument("--force", action="store_true", help="이미 있어도 다시 생성한다(과금)")
    ap.add_argument("--resize-only", action="store_true",
                    help="API를 부르지 않고 CharsInBattleRaw/의 캐시만 다시 축소한다")
    ap.add_argument("--sleep", type=float, default=1.0, help="호출 간 대기 초 (기본 1.0)")
    ap.add_argument("--retries", type=int, default=3, help="실패 시 재시도 횟수 (기본 3)")
    ap.add_argument("--timeout", type=int, default=180, help="응답 대기 초 (기본 180)")
    ap.add_argument("--dry-run", action="store_true", help="무엇을 할지만 출력한다")
    args = ap.parse_args()
    out_dir, raw_dir = args.out, args.raw

    if not CHARS.is_dir():
        print(f"원본을 찾을 수 없다: {CHARS}", file=sys.stderr)
        print("초상화는 git에 없다(.gitignore). 로컬 사본이 필요하다.", file=sys.stderr)
        return 1

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key and not args.resize_only and not args.dry_run:
        print("GEMINI_API_KEY 환경변수가 없다. https://aistudio.google.com/apikey 에서 발급한다.",
              file=sys.stderr)
        return 1

    names = sorted(p.stem for p in CHARS.glob("*.png"))
    if args.only:
        wanted = set(args.only)
        names = [n for n in names if n in wanted]
        if missing := wanted - set(names):
            print(f"원본이 없는 이름: {', '.join(sorted(missing))}", file=sys.stderr)

    # 손으로 받아 넣은 PNG는 파일명이 틀리기 쉽다 — 대응되는 장수가 없으면 알린다
    if args.resize_only and raw_dir.is_dir():
        orphans = sorted({p.stem for p in raw_dir.glob("*.png")} - set(names))
        if orphans:
            print(f"대응 장수가 없는 원본 {len(orphans)}건 (이름 확인): "
                  f"{', '.join(orphans[:10])}", file=sys.stderr)

    todo: list[str] = []
    for name in names:
        if (out_dir / f"{name}.jpg").is_file() and not args.force and not args.resize_only:
            continue
        if args.resize_only and not (raw_dir / f"{name}.png").is_file():
            continue
        todo.append(name)
    if args.limit:
        todo = todo[: args.limit]

    done = len(list(out_dir.glob("*.jpg"))) if out_dir.is_dir() else 0
    mode = "캐시 재축소" if args.resize_only else "생성"
    print(f"장수 {len(names)}명 · 완료 {done}장 · 이번 {mode} 대상 {len(todo)}장 "
          f"→ {out_dir.name}/ · {args.size}×{args.size} JPEG q{args.quality}")
    if args.dry_run:
        print("  " + ", ".join(todo[:20]) + (" …" if len(todo) > 20 else ""))
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

    made = 0
    failed: list[str] = []

    for i, name in enumerate(todo, 1):
        raw_path = raw_dir / f"{name}.png"
        try:
            if args.resize_only or (raw_path.is_file() and not args.force):
                data: bytes | Path = raw_path
                src_note = "캐시"
            else:
                png = (CHARS / f"{name}.png").read_bytes()
                for attempt in range(1, args.retries + 1):
                    try:
                        got = call_gemini(api_key, png, args.timeout)
                        break
                    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
                        if attempt == args.retries:
                            raise
                        # 429/5xx는 잠시 뒤 대개 풀린다 — 지수 백오프
                        wait = args.sleep * (2 ** attempt)
                        print(f"  재시도 {attempt}/{args.retries} ({e}) — {wait:.0f}초 대기")
                        time.sleep(wait)
                raw_path.write_bytes(got)
                data = got
                src_note = "생성"
                time.sleep(args.sleep)

            jpg = to_jpeg(data, args.size, args.quality)
            (out_dir / f"{name}.jpg").write_bytes(jpg)
            made += 1
            print(f"[{i}/{len(todo)}] {name}  {src_note} → {len(jpg) / 1024:.0f}KB")
        except Exception as e:  # 한 명이 막혀도 나머지는 계속 간다
            failed.append(f"{name}: {e}")
            print(f"[{i}/{len(todo)}] {name}  실패 — {e}", file=sys.stderr)

    total = len(list(out_dir.glob("*.jpg")))
    print(f"\n{made}장 처리, 합계 {total}/{len(names)}장 → {out_dir}")
    if failed:
        print(f"\n실패 {len(failed)}건 (이름만 --only로 다시 돌리면 된다):", file=sys.stderr)
        for f in failed:
            print(" -", f, file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
