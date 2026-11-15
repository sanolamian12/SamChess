#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""꼬마 장수 애니메이션 보완 — 동작 다섯 × 장수 260명의 폴더와 Gemini 프롬프트를 만든다.

    python tools/build_anim_prompts.py [--only 관우] [--no-ref]

| 입력 | 쓰임 |
|---|---|
| `packages/data/generated/officers.json` | 이름 · 영문 이름 · 등급(쓰러짐 자세가 등급으로 갈린다) |
| `tools/anim_idle.tsv` | 장수마다 손에 든 것 · 평상 동작 — **사람이 고치는 표** |
| `packages/client/public/actions-hd/{id}.webp` | 지금 동작 띠(240² × 5칸) → 검정 바탕 참고 그림 |

출력은 `assets/CharsAnim/`(git 밖)이다:

    assets/CharsAnim/
      README.md
      1_평상/{이름}/  prompt.txt  ref_sheet.png  ref_idle.png
      2_이동/{이름}/  prompt.txt  ref_sheet.png  ref_walk.png
      3_공격/{이름}/  prompt.txt  ref_sheet.png  ref_idle.png  ref_attack.png
      4_마법/{이름}/  prompt.txt  ref_sheet.png  ref_magic.png
      5_피격/{이름}/  prompt.txt  ref_sheet.png  ref_idle.png  ref_hit.png

생성한 그림은 같은 폴더에 `{이름}.png`로 둔다.
다시 돌려도 그 파일은 건드리지 않는다 — prompt.txt · ref_*.png만 다시 쓴다.

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
PAGE = ROOT / "tools" / "anim_prompts_page.html"   # → OUT/index.html (프롬프트 복사 · 참고 그림 끌어 놓기)

CELL = 240          # actions-hd 한 칸
REF_SCALE = 2       # 참고 그림은 두 배로 키워 준다(Gemini가 작은 그림의 무늬를 뭉갠다)
FRAME = {"idle": 0, "walk": 1, "attack": 2, "magic": 3, "hit": 4}

MOTIONS = ("1_평상", "2_이동", "3_공격", "4_마법", "5_피격")

# ───────────────────────────── 공통 문장 ─────────────────────────────

BG = (
    "Background: solid flat pure black (#000000) filling the whole image, completely uniform. "
    "No gradient, no vignette, no floor, no ground shadow under the feet, no scenery, no frame borders, "
    "no grid lines, no panel separators, no text, no numbers, no labels, no watermark. "
    "Keep the character's outline clean and crisp against the black background, with no glow or haze around the "
    "body (magic particles excepted)."
)

def style(o: dict, row: dict) -> str:
    holds = row["holds"]
    if holds.startswith("nothing"):
        inner = holds[holds.find("(") + 1 : holds.rfind(")")] if "(" in holds else ""
        gear = f"The character is empty-handed{f' ({inner})' if inner else ''}."
    else:
        gear = f"Key props and features: {holds}."
    return (
        f"Pixel-art chibi sprite animation strip of the SAME character shown in the attached reference sheet: "
        f"{o['nameI18n']['en']}, a Three Kingdoms era officer. {gear} "
        "Keep exactly the same character design as the reference: same face, hairstyle, headwear, outfit, armor, "
        "colors and palette, same weapon, same outline thickness, same pixel-art rendering, same big-head chibi "
        "proportions and the same on-screen size. Same facing direction as the reference poses."
    )

def layout(n: int) -> str:
    return (
        f"Layout: exactly {n} frames in ONE single horizontal row, like the reference sheet, each frame the same width, "
        "evenly spaced, nothing overlapping between frames. Every frame shows the full body from head to feet, "
        "the character at the same scale in every frame, centered horizontally in its frame, and the feet resting on "
        "the same ground line in every frame (unless the motion itself lowers the body). "
        "Change only a little between neighboring frames so the frames play back as smooth animation. "
        "Do not draw the character any bigger or wider than in the reference: the head, body, weapon, cape and limbs "
        "keep the same size and stay within about the same footprint as the reference poses."
    )

# ───────────────────────────── 동작별 프롬프트 ─────────────────────────────

def p_idle(o, row):
    s, act = style(o, row), row["idle_en"]
    t = (
        f"{s}\n\n"
        f"Animation: a short idle flourish played once when it becomes this character's turn — {act}.\n"
        "The idle pose (ref_idle.png, the 1st pose in the reference sheet) plays just before frame 1 and again right "
        "after frame 5, so the whole motion goes out of the idle pose and comes back to it within these 5 frames. "
        "Frame 1: only a slight change from the idle pose, the action starting. "
        "Frames 2–3: the action itself, frame 3 being its peak. "
        "Frame 4: winding down. "
        "Frame 5: almost identical to ref_idle.png (only one tiny step away), so that cutting back to the idle pose "
        "afterwards looks seamless. The character stays on the spot (no walking, no jumping away).\n\n"
        f"{layout(5)}\n\n{BG}"
    )
    return [("", "ref_sheet.png, ref_idle.png", f"{o['name']}.png", t)]

def p_walk(o, row):
    s = style(o, row)
    t = (
        f"{s}\n\n"
        "Animation: a 4-frame looping WALK cycle, walking in place (the character does not travel across the strip; "
        "the game moves the sprite). Frame 1 is the current walking pose (ref_walk.png, the 2nd pose in the reference "
        "sheet). Frame 1: contact, front foot forward. Frame 2: passing pose, body slightly lower, legs crossing. "
        "Frame 3: contact with the other foot forward. Frame 4: passing pose again. Frame 4 must lead seamlessly back "
        "into frame 1 when looped. Arms swing naturally opposite to the legs; the weapon or held item is carried "
        "steadily the same way as in ref_walk.png; cape, sleeves, plumes and hair sway slightly with each step. "
        "Light, brisk marching rhythm, small head bob.\n\n"
        f"{layout(4)}\n\n{BG}"
    )
    return [("", "ref_sheet.png, ref_walk.png", f"{o['name']}.png", t)]

def p_attack(o, row):
    s = style(o, row)
    w = row["holds"]
    weapon = "fists" if w.startswith("nothing") else w
    t = (
        f"{s}\n\n"
        f"Animation: 4 frames that connect the idle pose to the attack pose, using {weapon}. "
        "Attached are ref_idle.png (start, the 1st pose in the sheet) and ref_attack.png (end, the 3rd pose in the "
        "sheet). The idle pose itself is NOT part of this strip — it plays just before frame 1.\n"
        "Frame 1: starting to move out of the idle pose, shifting weight, eyes locking on the target. "
        "Frame 2: wind-up / anticipation — pulling the weapon (or arm) back, body coiled. "
        "Frame 3: the strike begins — lunging forward, fast motion, a short motion-blur arc. "
        "Frame 4: exactly the attack pose of ref_attack.png, including its slash arc or impact effect.\n\n"
        f"{layout(4)}\n\n{BG}"
    )
    return [("", "ref_sheet.png, ref_idle.png, ref_attack.png", f"{o['name']}.png", t)]

def p_magic(o, row):
    s = style(o, row)
    t = (
        f"{s}\n\n"
        "Animation: a 4-frame looping SPELL-CASTING loop. Frame 1 is the current casting pose (ref_magic.png, the "
        "4th pose in the reference sheet), with the same magic effect (same colors, same kind of glyphs, sparks, orbs "
        "or swirls). Across frames 1–4 the character murmurs an incantation: mouth opening and closing, eyes "
        "half-closed in concentration, hands/fingers shifting slightly, sleeves and hair lifted by a faint magical "
        "breeze. The magic particles and symbols around the character drift, rotate and twinkle — each frame they "
        "move a little along a circular path and some sparkle brighter while others fade, so the effect looks alive. "
        "Frame 4 must loop seamlessly back into frame 1. The body pose stays basically the same (no walking).\n\n"
        f"{layout(4)}\n\n{BG}"
    )
    return [("", "ref_sheet.png, ref_magic.png", f"{o['name']}.png", t)]

FALL = {
    "kneel": (
        "Frame 5 (final pose): defeated but dignified — the character drops down onto ONE KNEE, head bowed, one hand "
        "or the weapon planted on the ground for support. The character does NOT lie down."
    ),
    "fall": (
        "Frame 5 (final pose): the character COLLAPSES and falls to the ground, lying on the ground (on the side or "
        "back), the weapon or held item dropped beside the body. The whole body must stay fully inside its frame."
    ),
    "bow": (
        "Frame 5 (final pose): the character does NOT kneel and does NOT fall — they stay standing but bend forward "
        "deeply at the waist, head hanging down, arms hanging limp, utterly defeated."
    ),
}

def fall_kind(grade: str) -> str:
    if grade in ("S", "A"):
        return "kneel"
    if grade == "E":
        return "bow"
    return "fall"

def p_hit(o, row):
    s = style(o, row)
    k = fall_kind(o["grade"])
    mid = {
        "kneel": "Frame 3–4: staggering, legs buckling, sinking lower toward one knee.",
        "fall": "Frame 3–4: staggering backward, losing balance, toppling toward the ground.",
        "bow": "Frame 3–4: staggering, the upper body slowly folding forward.",
    }[k]
    t = (
        f"{s}\n\n"
        "Animation: 5 frames — getting hit, then going down. Attached are ref_idle.png (start, the 1st pose in the "
        "sheet) and ref_hit.png (the hit pose, the 5th pose in the sheet). The idle pose itself is NOT part of this "
        "strip — it plays just before frame 1.\n"
        "Frame 1: the moment of impact — the body jolts, flinching away from the blow. "
        "Frame 2: exactly the hit pose of ref_hit.png, including its red impact sparks. "
        f"{mid} "
        f"{FALL[k]}\n"
        "(The game plays frames 1–2 for a normal hit, and frames 1–5 when the character is defeated.)\n\n"
        f"{layout(5)}\n\n{BG}"
    )
    return [("", "ref_sheet.png, ref_idle.png, ref_hit.png", f"{o['name']}.png", t)]

BUILD = {
    "1_평상": (p_idle, ("idle",)),
    "2_이동": (p_walk, ("walk",)),
    "3_공격": (p_attack, ("idle", "attack")),
    "4_마법": (p_magic, ("magic",)),
    "5_피격": (p_hit, ("idle", "hit")),
}
FALL_KO = {"kneel": "무릎 꿇음(A급 이상)", "fall": "넘어짐(B급 이하)", "bow": "허리 굽힘(E급)"}

# ───────────────────────────── 참고 그림 ─────────────────────────────

def on_black(img: Image.Image) -> Image.Image:
    bg = Image.new("RGBA", img.size, (0, 0, 0, 255))
    bg.alpha_composite(img)
    out = bg.convert("RGB")
    return out.resize((out.width * REF_SCALE, out.height * REF_SCALE), Image.LANCZOS)

def refs(oid: str) -> dict[str, Image.Image]:
    sheet = Image.open(HD / f"{oid}.webp").convert("RGBA")
    out = {"sheet": on_black(sheet)}
    for k, i in FRAME.items():
        out[k] = on_black(sheet.crop((i * CELL, 0, (i + 1) * CELL, CELL)))
    return out

# ───────────────────────────── 쓰기 ─────────────────────────────

def stand_scale() -> dict[str, float]:
    """OfficerArt.tsx의 `STAND_SCALE` 표 — 면적이 큰 장수를 메뉴에서 줄이는 배율. 표가 없으면 빈 것."""
    if not STAND_SCALE_SRC.exists():
        return {}
    src = STAND_SCALE_SRC.read_text(encoding="utf-8")
    m = re.search(r"STAND_SCALE[^=]*=\s*\{(.*?)\};", src, re.S)
    return {k: float(v) for k, v in re.findall(r"'([a-z-]+)':\s*([0-9.]+)", m.group(1))} if m else {}

SCALE: dict[str, float] = {}

# 붙여 넣으면 파일 이름이 사라진다 — 프롬프트는 첨부를 「몇 번째 그림」으로 가리킨다(작업판이 그 순서로 번호를 단다)
REF_EN = {
    "sheet": "the reference sheet (the character's current 5 poses: idle, walk, attack, casting, hit)",
    "idle": "the idle pose", "walk": "the walking pose", "attack": "the attack pose",
    "magic": "the casting pose", "hit": "the hit pose",
}

def by_order(text: str, refs: list[str]) -> str:
    head = "Attached images, in this order: " + "; ".join(
        f"image {i} = {REF_EN[k]}" for i, k in enumerate(refs, 1)) + "."
    for i, k in enumerate(refs, 1):
        text = text.replace(f"ref_{k}.png", f"image {i}")
    return f"{head}\n\n{text}"

def attach_list(refs: list[str]) -> str:
    return "  ".join(f"{i}) ref_{k}.png" for i, k in enumerate(refs, 1))

def prompt_file(o, row, motion, parts) -> str:
    sc = SCALE.get(o["id"])
    lines = [
        f"# {o['name']} ({o['nameI18n']['en']}) · {o['grade']}급 · {motion[2:]}",
        f"# 평상 동작: {row['idle_ko']}" if motion == "1_평상" else None,
        f"# 쓰러짐: {FALL_KO[fall_kind(o['grade'])]}" if motion == "5_피격" else None,
        f"# 크기 보정: 메뉴에서 {sc}배로 줄여 세우는 장수(그림 면적이 큼) — 그림은 참고와 같은 크기로 받고, 굽기에서 맞춘다" if sc else None,
        "",
    ]
    for title, attach, save, text in parts:
        if title:
            lines += [f"======== {title} ========"]
        lines += [f"[첨부] {attach}", f"[저장] {save}", "", text, ""]
    return "\n".join(l for l in lines if l is not None)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="이 장수 이름만")
    ap.add_argument("--no-ref", action="store_true", help="참고 그림을 다시 굽지 않는다")
    a = ap.parse_args()

    officers = json.loads(OFFICERS.read_text(encoding="utf-8"))
    SCALE.update(stand_scale())
    with TABLE.open(encoding="utf-8", newline="") as f:
        rd = csv.reader(f, delimiter="\t")
        next(rd)
        table = {r[0]: {"holds": r[1], "idle_ko": r[2], "idle_en": r[3]} for r in rd if r}
    missing = [o["name"] for o in officers if o["name"] not in table]
    extra = sorted(set(table) - {o["name"] for o in officers})
    if missing or extra:
        print(f"표와 장수 명단이 어긋난다 — 표에 없음 {missing} · 명단에 없음 {extra}", file=sys.stderr)
        return 1

    n = 0
    data = []
    for o in officers:
        row = table[o["name"]]
        entry = {"name": o["name"], "en": o["nameI18n"]["en"], "grade": o["grade"], "scale": SCALE.get(o["id"]),
                 "idle": row["idle_ko"], "fall": FALL_KO[fall_kind(o["grade"])], "m": {}}
        data.append(entry)
        todo = not (a.only and o["name"] != a.only)
        imgs = refs(o["id"]) if todo and not a.no_ref else None
        for motion in MOTIONS:
            fn, need = BUILD[motion]
            order = ["sheet", *need]
            parts = [(t, attach_list(order), sv, by_order(tx, order)) for t, _, sv, tx in fn(o, row)]
            title, attach, save, text = parts[0]
            entry["m"][motion] = {"refs": order, "save": save, "text": text}
            if not todo:
                continue
            d = OUT / motion / o["name"]
            d.mkdir(parents=True, exist_ok=True)
            (d / "prompt.txt").write_text(prompt_file(o, row, motion, parts), encoding="utf-8")
            if imgs:
                imgs["sheet"].save(d / "ref_sheet.png")
                for k in need:
                    imgs[k].save(d / f"ref_{k}.png")
        n += todo
    (OUT / "README.md").write_text(README, encoding="utf-8")
    page = PAGE.read_text(encoding="utf-8").replace(
        "/*DATA*/null", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    (OUT / "index.html").write_text(page, encoding="utf-8")
    # 더블클릭으로 작업판을 띄우는 단추(그림 복사는 http에서만 된다 — tools/serve_anim_page.py)
    (OUT / "열기.bat").write_bytes("@echo off\r\ncd /d %~dp0..\\..\r\npython tools\\serve_anim_page.py\r\npause\r\n".encode())
    print(f"{n}명 × {len(MOTIONS)}동작 → {OUT}")
    return 0

README = """# 꼬마 장수 애니메이션 원본 (Gemini 생성)

`python tools/build_anim_prompts.py`가 만든 폴더다. 장수마다 폴더 하나, 그 안에
`prompt.txt`(붙여 넣을 프롬프트) · `ref_*.png`(Gemini에 함께 올릴 참고 그림, 검정 바탕)가 있다.
프롬프트는 첨부를 **순서**(image 1 · 2 · 3)로 가리킨다 — prompt.txt의 [첨부] 번호 순서대로 올린다.

**작업판:** `열기.bat`을 더블클릭(또는 `npm run anim:page`) → 브라우저에 `http://127.0.0.1:5180/`이 뜬다.
[복사]를 누르면 그림이 클립보드에 들어가 Gemini 입력창에 Ctrl+V로 붙는다(`index.html`을 파일로 바로 열면 그림 복사는 브라우저가 막는다).
프롬프트의 정본은 `tools/anim_idle.tsv`(장수별 평상 동작 · 든 것)와 그 도구이고, 이 폴더는 다시 만들 수 있다.

| 폴더 | 칸 | 첫 칸 / 끝 칸 | 저장 이름 |
|---|---|---|---|
| 1_평상 | 5 | 평상에서 나가 5번째에 평상 한 걸음 앞으로 돌아온다 | `{이름}.png` |
| 2_이동 | 4 (반복) | 1번 = 지금 이동 자세 | `{이름}.png` |
| 3_공격 | 4 | 평상은 빼고 시작 → 4번 = 지금 공격 자세 | `{이름}.png` |
| 4_마법 | 4 (반복) | 1번 = 지금 마법 자세 | `{이름}.png` |
| 5_피격 | 5 | 평상은 빼고 시작 → 2번 = 지금 피격 자세, 5번 = 쓰러짐 | `{이름}.png` |

쓰러짐: S · A급 무릎 꿇음 · B · C · D급 넘어짐 · E급(헌제) 허리 굽힘.
크기: 면적이 큰 장수(문추 · 주유 · 마연 · 조조 · 송비 · 조휴 · 장포 — `OfficerArt.tsx`의 `STAND_SCALE`)는 프롬프트 머리에 표시만 한다.
그림은 참고와 같은 크기로 받고, 줄이는 것은 굽는 도구가 한다(`Design/꼬마그림_크기보정_전달.md`).
브라우저 작업판: `index.html`을 연다(프롬프트 복사 · 참고 그림 끌어 놓기 · 완료 표시).
배경은 순검정(#000000). 다시 돌려도 생성한 `{이름}*.png`는 지우지 않는다.
"""

if __name__ == "__main__":
    sys.exit(main())
