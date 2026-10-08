#!/usr/bin/env python3
"""
수묵화 초상의 **눈높이**를 한 번 재서 표로 남긴다 — 순서 판의 얼굴 띠(pptx 102쪽)가 이 표로 잘린다.

    python tools/measure_faces.py        # assets/CharsInBattle 260장 + 도적 → tools/face_eyes.json

`build_portraits.py`(`npm run portraits`)는 **이 표만 읽는다** — 검출 모델 없이도 같은 띠가 나오게.
전투력 계수(`POWER_MODELS`)를 실측해 상수로 옮겨 두는 것과 같은 결이다: 굽기마다 다시 재면
모델 버전에 따라 띠가 조용히 흔들린다. 다시 재는 것은 **그림이 바뀌었을 때만**이다.

검출은 OpenCV의 YuNet(`cv2.FaceDetectorYN`) — 얼굴 상자와 함께 두 눈 좌표를 낸다. 이 환경의 OpenCV 5에는
옛 Haar 검출기(`CascadeClassifier`)가 없다. 모델(약 230KB)은 `assets/models/`에 받아 둔다(git 밖, 에셋 방침).
2026-10-08 실측: 261/261 검출(260명 + 도적), 눈높이 비율 중앙 0.445 · 최소 0.272 · 최대 0.582 — **고정 비율로 자르면
양 끝의 장수는 눈이 띠 밖으로 나간다.** 그래서 잰다.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BATTLE_CHARS = ROOT / "assets" / "CharsInBattle"
GENERATED = ROOT / "packages" / "data" / "generated"
MODEL = ROOT / "assets" / "models" / "face_detection_yunet_2023mar.onnx"
MODEL_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
OUT = ROOT / "tools" / "face_eyes.json"


def eye_ratio(path: Path, model: str) -> float | None:
    import cv2
    import numpy as np
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    det = cv2.FaceDetectorYN.create(model, "", (w, h), 0.6, 0.3, 5000)
    _, faces = det.detect(img)
    if faces is None or len(faces) == 0:
        return None
    f = max(faces, key=lambda f: f[2] * f[3])
    return round(float((f[5] + f[7]) / 2 / h), 4)     # 두 눈(4·5 · 6·7)의 세로 평균


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        import cv2  # noqa: F401
    except ImportError:
        print("opencv-python이 필요하다 — pip install opencv-python", file=sys.stderr)
        return 1
    if not MODEL.is_file():
        MODEL.parent.mkdir(parents=True, exist_ok=True)
        print(f"검출 모델을 받는다 → {MODEL}")
        urllib.request.urlretrieve(MODEL_URL, MODEL)

    officers = json.loads((GENERATED / "officers.json").read_text(encoding="utf-8"))
    by_name = {o["name"]: o["id"] for o in officers}
    # 파일 이름 → 장수는 굽는 도구와 **같은 함수**로 잇는다(옛 독음 8장의 정정표까지)
    sys.path.insert(0, str(ROOT / "tools"))
    from build_portraits import ink_sources
    sources, _ = ink_sources(by_name)
    # 도적 — 한 벌을 다섯이 함께 쓴다(`raid.json`의 art)
    raid = GENERATED / "raid.json"
    if raid.is_file():
        art = json.loads(raid.read_text(encoding="utf-8"))["art"]
        ink = ROOT / "assets" / art["inBattle"]
        if ink.is_file():
            sources.append((art["id"], ink))

    eyes: dict[str, float] = {}
    missed: list[str] = []
    for oid, src in sources:
        r = eye_ratio(src, str(MODEL))
        if r is None:
            missed.append(oid)
        else:
            eyes[oid] = r
    OUT.write_text(json.dumps(dict(sorted(eyes.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    vals = sorted(eyes.values())
    print(f"→ {OUT.relative_to(ROOT)} — {len(eyes)}/{len(sources)}장, 눈높이 중앙 {vals[len(vals) // 2]:.3f}"
          f" · 최소 {vals[0]:.3f} · 최대 {vals[-1]:.3f}")
    if missed:
        print(f"얼굴을 못 찾은 그림 {len(missed)}장(굽기는 중앙값으로 자른다): {', '.join(missed)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
