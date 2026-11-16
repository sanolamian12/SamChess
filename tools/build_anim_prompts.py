#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""꼬마 장수 애니메이션 보완 — 장수 260명의 Gemini 프롬프트와 참고 그림을 만든다 (2판, 2026-11-16).

    python tools/build_anim_prompts.py [--only 관우] [--no-ref]

| 입력 | 쓰임 |
|---|---|
| `packages/data/generated/officers.json` | 이름 · 영문 이름 · 등급(쓰러짐 자세가 등급으로 갈린다) |
| `tools/anim_idle.tsv` | 장수마다 손에 든 것 · 평상 동작 — **사람이 고치는 표** |
| `packages/client/public/actions-hd/{id}.webp` | 지금 동작 띠(240² × 5칸) → 검정 바탕 참고 그림 |

출력은 `assets/CharsAnim/`(git 밖)이다:

    assets/CharsAnim/
      index.html  열기.bat  README.md
      ref/{이름}.png      요청 A에 붙이는 참고 그림(지금 다섯 자세, 검정 바탕 2배)
      ref/{이름}_walk · _attack · _magic.png   요청 C · D · E에 붙이는 그 동작의 자세
      raw/                생성 결과를 사람이 두는 곳 — {이름}_평상동작 · _쓰러짐 · _걸음 · _공격동작 · _마법

**1판(11-15)에서 바꾼 것** — 4명을 시켜 본 결과(raw/의 {이름}_{동작}.jpg):
- Gemini는 받은 자세를 그대로 베낀다 → 이미 있는 자세(평상 · 이동 · 공격 · 피격)는 **그리게 하지 않고 사이 칸만** 시킨다.
  평상 3칸 · 이동 2칸 · 공격 2칸 · 피격 3칸(피격 자세 뒤 → 쓰러짐) · 마법 4칸.
- 몸 방향이 칸마다 틀어졌다 → 줄마다 「어느 자세의 방향을 따르는가」를 못 박고, 뒤집기를 금한다.
- 마법 칸끼리 효과가 붙었다 → 2×2 격자 + 칸 사이 넓은 여백, 효과는 제 칸 밖으로 못 나간다.
- 무료 한도가 금방 찼다 → 장수 하나 = **새 대화 하나 · 그림 한 장 · 요청 넷**(A 평상 · B 쓰러짐 · C 이동+공격 · D 마법) → 다섯(아래).
  평상과 피격은 한 장에 묶었더니 평상 첫 칸이 평상을 베끼고 피격 줄이 무릎을 안 꿇어 다시 갈랐다(11-16 가후).
  이동과 공격도 묶음에서 이동이 평상 · 이동 자세를 베끼고 공격에 피격 표정이 섞여 갈랐고, 그 둘과 마법에는
  그 동작의 자세만 크게 한 장 더 붙인다 — 요청 다섯 · 그림 넷.
  둘째 · 셋째 요청은 글만 보낸다. 묶음이 망가지면 그 동작만 따로 다시 뽑는 프롬프트도 함께 낸다.

배경은 **순검정(#000000)** 이다(2026-11-15 기획자 — 마젠타는 걸러 내는 데 손이 많이 갔다).
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OFFICERS = ROOT / "packages" / "data" / "generated" / "officers.json"
TABLE = ROOT / "tools" / "anim_idle.tsv"
HD = ROOT / "packages" / "client" / "public" / "actions-hd"
OUT = ROOT / "assets" / "CharsAnim"
# 메뉴 꼬마의 장수별 크기 보정표(Design/꼬마그림_크기보정_전달.md) — 정본은 화면 코드, 여기서는 읽기만 한다
STAND_SCALE_SRC = ROOT / "packages" / "client" / "src" / "screens" / "OfficerArt.tsx"
PAGE = ROOT / "tools" / "anim_prompts_page.html"   # → OUT/index.html

REF_SCALE = 2       # 참고 그림은 두 배로 키워 준다(Gemini가 작은 그림의 무늬를 뭉갠다)

# ───────────────────────────── 공통 문장 ─────────────────────────────

POSES = ("this character's 5 existing poses, left to right: pose 1 = idle, pose 2 = walk, pose 3 = attack, "
         "pose 4 = spell casting, pose 5 = hit")

BG = (
    "Background: solid flat pure black (#000000) filling the whole image, completely uniform. "
    "No gradient, no vignette, no floor, no ground shadow under the feet, no scenery, no frame borders, "
    "no grid lines, no panel separators, no text, no numbers, no labels, no watermark. "
    "Keep the character's outline clean and crisp against the black background, with no glow or haze around the "
    "body (magic particles excepted)."
)

FACING = (
    "Facing: the 5 reference poses do not all face the same way. In each row, copy the facing of the pose named "
    "for that row exactly — the same body angle, the head turned the same way, the same hand holding the weapon. "
    "Never mirror or flip the character horizontally, and never let the character turn around between frames."
)

NEW_ONLY = (
    "Do NOT redraw the reference poses themselves — they already exist and will be placed before/after these "
    "frames by the game. Draw only the NEW in-between frames described below. Every new frame must be clearly "
    "different from the reference poses and from the other new frames."
)


def style(o: dict, row: dict) -> str:
    holds = row["holds"]
    if holds.startswith("nothing"):
        inner = holds[holds.find("(") + 1 : holds.rfind(")")] if "(" in holds else ""
        gear = f"The character is empty-handed{f' ({inner})' if inner else ''}."
    else:
        gear = f"Key props and features: {holds}."
    return (
        "Pixel-art chibi sprite frames of the SAME character as in the reference sheet: "
        f"{o['nameI18n']['en']}, a Three Kingdoms era officer. {gear} "
        "Keep exactly the same character design: same face, hairstyle, headwear, outfit, armor, colors and palette, "
        "same weapon, same outline thickness, same pixel-art rendering and the same big-head chibi proportions. "
        "The attached reference picture is the only source of how this character looks: if anything written here "
        "(props, weapon, clothing) disagrees with the picture, follow the picture."
    )


def grid(rows: int, cols: int) -> str:
    shape = (f"ONE single horizontal row of {cols} frames" if rows == 1 else
             f"a grid of {rows} rows × {cols} columns, read left to right, top to bottom")
    return (
        f"Layout: {shape}. Every frame sits in its own cell of equal size, with a wide empty black gap between "
        "cells (at least a quarter of a cell) — nothing, not even an effect or a dropped weapon, crosses into another "
        "cell. Every frame shows the full body from head to feet, centered in its cell. Scale: exactly the same "
        "size as the reference sheet in every frame — same head size, same body height; never bigger, smaller or "
        "wider. Within a row the feet rest on the same ground line (unless the motion itself lowers the body)."
    )

# ───────────────────────────── 동작(줄) ─────────────────────────────
# 줄 하나 = 동작 하나. 묶음 요청은 줄 둘을 한 장에, 따로 요청은 줄 하나만.

FALL = {
    "kneel": ("drops down onto ONE KNEE, head bowed, one hand or the weapon planted on the ground for support — "
              "defeated but dignified; the character does NOT lie down"),
    "fall": ("has collapsed and lies on the ground on the side or back, the weapon or held item dropped beside "
             "the body; the whole lying body fits inside its cell"),
    "bow": ("stays standing but bends forward deeply at the waist, head hanging down, arms hanging limp — utterly "
            "defeated; does NOT kneel and does NOT fall"),
}
FALL_MID = {
    "kneel": ("staggering back from the blow, knees bending — the head already a little lower than standing height",
              "sinking down, one knee almost touching the ground — the head clearly lower, about at three quarters of "
              "standing height"),
    "fall": ("staggering backward from the blow, losing balance, the body tilting backward",
             "toppling backward toward the ground, mid-fall, the body tilted far back at a steep angle"),
    "bow": ("staggering back from the blow, shoulders slumping",
            "the upper body folding forward, the head lower than in frame 1"),
}
# 2판 첫 시험(가후, 11-16): 피격 줄이 서 있는 채 고개만 숙였다 — 「얼마나 낮아지는가」를 숫자로 적는다
FALL_HEIGHT = {
    "kneel": " In frame 3 one knee is ON the ground and the head is at about two thirds of standing height — "
             "the three frames get visibly lower step by step.",
    "fall": " In frame 3 the body is horizontal on the ground — the three frames get visibly lower step by step.",
    "bow": " In frame 3 the head is far below the shoulders, at about chest height of the standing pose.",
}
FALL_KO = {"kneel": "무릎 꿇음(A급 이상)", "fall": "넘어짐(B급 이하)", "bow": "허리 굽힘(E급)"}


def fall_kind(grade: str) -> str:
    if grade in ("S", "A"):
        return "kneel"
    if grade == "E":
        return "bow"
    return "fall"


def s_idle(o, row):
    return 3, (
        f"IDLE FLOURISH (3 frames) — played once when it becomes this character's turn: {row['idle_en']}. "
        "Pose 1 (idle) plays right before frame 1 and again right after frame 3, so the motion leaves the idle pose "
        "and comes back to it — so do NOT draw the idle pose: frame 1 must not look like pose 1 (if it does, it is "
        "wrong). Frame 1: already a good way into the action, the held item or arms clearly moved away from where "
        "they are in pose 1. "
        "Frame 2: the peak of the action. Frame 3: winding down, halfway back to the idle pose. "
        "Make the movement big and easy to read at small sprite size (exaggerated like game animation): the "
        "held item, arms or head travel a clearly visible distance between frames, not a subtle shift. "
        "The character stays on the spot. Facing: exactly as pose 1 (idle) in all 3 frames."
    )


def s_hit(o, row):
    k = fall_kind(o["grade"])
    a, b = FALL_MID[k]
    return 3, (
        "GOING DOWN (3 frames) — what happens right AFTER pose 5 (hit), which plays just before frame 1 (do not "
        f"draw pose 5 itself, and do not draw the idle pose). Frame 1: {a}. Frame 2: {b}. "
        f"Frame 3 (final pose): the character {FALL[k]}.{FALL_HEIGHT[k]} "
        "Facing: exactly as pose 5 (hit) in all 3 frames; the character falls back away from the blow without "
        "turning around."
    )


def s_walk(o, row):
    return 2, (
        "WALK (2 frames) — the newly attached image is pose 2 (walk): a SIDE VIEW of one step. These 2 new frames "
        "complete its walk cycle (the game plays pose 2 → frame 1 → frame 2 → frame 1 → pose 2…). Both frames are a "
        "side view exactly like the attached walk pose — NOT a front view, NOT the idle pose. Walking in place, not "
        "travelling. "
        "Frame 1: PASSING pose — the standing leg straight under the body, the other leg lifted and swinging past "
        "it, knees close together, body slightly raised. "
        "Frame 2: CONTACT with the OTHER foot forward — the leg that is behind in pose 2 is now stepping in front, "
        "and the arm swing is reversed. The legs must be visibly different from pose 2 in both frames. "
        "The weapon or held item is carried the same way as in pose 2. Facing: exactly as pose 2 (walk)."
    )


def s_attack(o, row):
    w = row["holds"]
    weapon = "bare fists" if w.startswith("nothing") else w
    return 2, (
        f"ATTACK (2 frames) using {weapon} — the newly attached image shows pose 1 (idle, left) and pose 3 (attack, "
        "right). These 2 new frames connect them: idle plays before frame 1, the attack pose plays after frame 2. "
        "Frame 1: WIND-UP — weight shifted back, the weapon (or fist) pulled back, body coiled, eyes on the target. "
        "Frame 2: the STRIKE starting — lunging forward, halfway between the wind-up and pose 3, a short motion-blur "
        "arc. The weapon is held in the SAME hand with the SAME grip as in pose 3, the same arm swings in both frames, "
        "and both arms keep natural, anatomically consistent shapes (one elbow each, no extra or missing hands). "
        "Facial expression: fierce and focused like pose 3 — NOT the pained expression of pose 5 (hit), and no hit "
        "sparks; nothing from pose 5 belongs in these frames. Facing: exactly as pose 3 (attack)."
    )


def s_magic(o, row):
    return 4, (
        "SPELL-CASTING LOOP (4 frames, a 2 × 2 grid) — the newly attached image is pose 4 (casting). Frame 1 is like "
        "pose 4 with the same magic effect (same colors, same kind of glyphs, sparks, orbs or swirls). Across the 4 "
        "frames the character murmurs an incantation: mouth opening and closing, eyes half-closed in concentration, "
        "hands shifting slightly, sleeves and hair lifted by a faint magical breeze. The particles and symbols drift, "
        "rotate and twinkle — each frame they move a little along a circular path, some sparkle brighter while "
        "others fade. Frame 4 loops back into frame 1. The body pose stays basically the same. Keep the whole effect "
        "compact around the character: every particle of a frame stays inside that frame's own cell. "
        "Facing: exactly as pose 4."
    )


SECTIONS = {"평상": s_idle, "피격": s_hit, "이동": s_walk, "공격": s_attack, "마법": s_magic}

# 요청 = 생성 한 번. 장수 하나 = 새 대화 하나에서 A → E.
# 그림: A에 다섯 자세 띠 전체, C · D · E에 그 동작의 자세만 크게 한 장 더(11-16 가후 — 이동 · 공격을 한 장에 묶었더니
# 이동 줄이 평상 · 이동 자세를 베꼈고 공격 칸에 피격 표정이 섞였다. 띠가 대화 앞쪽에 멀어지면 자세 번호를 헷갈린다).
REQUESTS = [
    ("A", "평상동작", "평상", "sheet"),
    ("B", "쓰러짐", "피격", None),
    ("C", "걸음", "이동", "walk"),
    ("D", "공격동작", "공격", "attack"),
    ("E", "마법", "마법", "magic"),
]
IMG_EN = {
    "walk": "pose 2 (walk), enlarged",
    "attack": "pose 1 (idle, left) and pose 3 (attack, right) side by side",
    "magic": "pose 4 (spell casting), enlarged",
}
IMG_KO = {"sheet": "다섯 자세 띠", "walk": "이동 자세", "attack": "평상 · 공격 자세", "magic": "마법 자세"}


def request_text(o, row, part: str, img: str | None) -> str:
    n, body = SECTIONS[part](o, row)
    rows, cols = (2, 2) if part == "마법" else (1, n)
    if img == "sheet":
        head = f"Attached image: the reference sheet — {POSES}.\n\n"
    else:
        head = f"Same character and the same reference sheet as before in this conversation — {POSES}. "
        head += (f"Newly attached image: {IMG_EN[img]}.\n\n" if img else
                 "(If the sheet is not in this conversation, it is attached again.)\n\n")
    head += ("IMPORTANT: the background must be solid pure BLACK (#000000) — never white, never grey, never "
             "transparent.\n\n")
    return (f"{head}{style(o, row)}\n\n{NEW_ONLY}\n\n{body}\n\n{FACING}\n\n{grid(rows, cols)}\n\n{BG}")

# ───────────────────────────── 참고 그림 ─────────────────────────────

CELL = 240      # actions-hd 한 칸
CROPS = {"walk": (1,), "attack": (0, 2), "magic": (3,)}


def on_black(img: Image.Image) -> Image.Image:
    bg = Image.new("RGBA", img.size, (0, 0, 0, 255))
    bg.alpha_composite(img)
    out = bg.convert("RGB")
    return out.resize((out.width * REF_SCALE, out.height * REF_SCALE), Image.LANCZOS)


def ref_images(oid: str) -> dict[str, Image.Image]:
    sheet = Image.open(HD / f"{oid}.webp").convert("RGBA")
    out = {"sheet": on_black(sheet)}
    for k, cells in CROPS.items():
        strip = Image.new("RGBA", (CELL * len(cells), CELL))
        for j, c in enumerate(cells):
            strip.paste(sheet.crop((c * CELL, 0, (c + 1) * CELL, CELL)), (j * CELL, 0))
        out[k] = on_black(strip)
    return out

# ───────────────────────────── 쓰기 ─────────────────────────────

def stand_scale() -> dict[str, float]:
    """OfficerArt.tsx의 `STAND_SCALE` 표 — 면적이 큰 장수를 메뉴에서 줄이는 배율. 표가 없으면 빈 것."""
    if not STAND_SCALE_SRC.exists():
        return {}
    src = STAND_SCALE_SRC.read_text(encoding="utf-8")
    m = re.search(r"STAND_SCALE[^=]*=\s*\{(.*?)\};", src, re.S)
    return {k: float(v) for k, v in re.findall(r"'([a-z-]+)':\s*([0-9.]+)", m.group(1))} if m else {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="이 장수 이름만 참고 그림을 다시 굽는다")
    ap.add_argument("--no-ref", action="store_true", help="참고 그림을 다시 굽지 않는다")
    a = ap.parse_args()

    officers = json.loads(OFFICERS.read_text(encoding="utf-8"))
    scale = stand_scale()
    with TABLE.open(encoding="utf-8", newline="") as f:
        rd = csv.reader(f, delimiter="\t")
        next(rd)
        table = {r[0]: {"holds": r[1], "idle_ko": r[2], "idle_en": r[3]} for r in rd if r}
    missing = [o["name"] for o in officers if o["name"] not in table]
    extra = sorted(set(table) - {o["name"] for o in officers})
    if missing or extra:
        print(f"표와 장수 명단이 어긋난다 — 표에 없음 {missing} · 명단에 없음 {extra}", file=sys.stderr)
        return 1

    (OUT / "ref").mkdir(parents=True, exist_ok=True)
    (OUT / "raw").mkdir(parents=True, exist_ok=True)
    n = 0
    data = []
    for o in officers:
        row = table[o["name"]]
        reqs = [{"key": k, "save": f"{o['name']}_{tag}", "parts": [part], "img": img,
                 "imgLabel": IMG_KO.get(img or ""), "text": request_text(o, row, part, img), "single": []}
                for k, tag, part, img in REQUESTS]
        data.append({"name": o["name"], "en": o["nameI18n"]["en"], "grade": o["grade"], "scale": scale.get(o["id"]),
                     "idle": row["idle_ko"], "fall": FALL_KO[fall_kind(o["grade"])], "req": reqs})
        if a.no_ref or (a.only and o["name"] != a.only):
            continue
        for k, im in ref_images(o["id"]).items():
            im.save(OUT / "ref" / (f"{o['name']}.png" if k == "sheet" else f"{o['name']}_{k}.png"))
        n += 1
    (OUT / "README.md").write_text(README, encoding="utf-8")
    page = PAGE.read_text(encoding="utf-8").replace(
        "/*DATA*/null", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    (OUT / "index.html").write_text(page, encoding="utf-8")
    # 더블클릭으로 작업판을 띄우는 단추(그림 복사는 http에서만 된다 — tools/serve_anim_page.py)
    (OUT / "열기.bat").write_bytes("@echo off\r\ncd /d %~dp0..\\..\r\npython tools\\serve_anim_page.py\r\npause\r\n".encode())
    print(f"참고 그림 {n}장 · 프롬프트 {len(data)}명 × {len(REQUESTS)}요청 → {OUT}")
    return 0


README = """# 꼬마 장수 애니메이션 원본 (Gemini 생성) — 2판

`python tools/build_anim_prompts.py`가 만든 폴더다. 작업판: `열기.bat` 더블클릭(또는 `npm run anim:page`).

장수 하나 = **Gemini 새 대화 하나 · 요청 다섯**:

| 요청 | 붙이는 그림 | 칸 | 저장(raw/) |
|---|---|---|---|
| A | `ref/{이름}.png`(다섯 자세 띠) | 평상 중간 3칸(평상 자체는 안 그린다) | `{이름}_평상동작` |
| B | 없음(글만) | 피격 다음 3칸(피격 자체는 안 그린다, 마지막 = 쓰러짐) | `{이름}_쓰러짐` |
| C | `ref/{이름}_walk.png` | 이동 2칸 | `{이름}_걸음` |
| D | `ref/{이름}_attack.png`(평상 · 공격) | 공격 2칸 | `{이름}_공격동작` |
| E | `ref/{이름}_magic.png` | 마법 4칸(2×2) | `{이름}_마법` |

이미 있는 자세(평상 · 이동 · 공격 · 피격)는 그리게 하지 않는다 — 잘라 쓸 때 지금 띠의 칸을 앞뒤에 붙인다:
평상 = 평상 · 새1 · 새2 · 새3 · 평상 / 이동 = 이동 · 새1 · 새2 · 새1 / 공격 = 평상 · 새1 · 새2 · 공격 /
피격 = 피격 · 새1 · 새2 · 새3(쓰러짐) / 마법 = 새 4칸 반복.

쓰러짐: S · A급 무릎 꿇음 · B · C · D급 넘어짐 · E급(헌제) 허리 굽힘. 배경은 순검정(#000000).
raw/는 다시 돌려도 건드리지 않는다. 1판의 동작별 폴더(1_평상 … 5_피격)는 더 안 쓴다.
"""

if __name__ == "__main__":
    sys.exit(main())
