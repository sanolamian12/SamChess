"""
게임 안의 고유 목소리 추적 — 튜토리얼 더빙(KR)을 **게임에서 들리는 목소리와 같은 목소리**로 받으려고,
고유 목소리가 있는 장수(S · E · A급 + 이름난 B~D급 아홉)의 지금 음성 · 대사를 한 표로 모은다.

    python tools/tutorial_dub_game_voice.py

모으는 것 (원본은 `assets/Audio/`, git 밖 — 없으면 그 칸을 비운다)
  차례 음성     voice/battle/{SE_class,A_class,BCD_speical}/KR/{이름}_KR.mp3   글: voice/1_…SE급.txt · voice/2_…A급.txt
  고유기술 음성 Specialskills/KR/{기술이름}_KR.mp3                               글: 없음 — 받아 적어 `game_voice_text.json`에 넣는다
  튜토리얼 대사 Design/튜토리얼더빙/lines.json · cast.json (목소리 배정)

글이 원본 txt에 없는 것(B~D급 아홉의 차례 음성 · 고유기술 음성 전부)은 `Design/튜토리얼더빙/game_voice_text.json`에
`{"turn": {"won-so": "…"}, "skill": {"yeong-ung-ron": "…"}}`로 적어 두면 표에 들어간다(이 도구가 뼈대를 만들고, 적은 값은 지우지 않는다).

쓰는 것: Design/튜토리얼더빙/game_voice.json (기계용) · 게임음성_추적.md (사람용)
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "assets" / "Audio"
TURN_DIR = AUDIO / "voice" / "battle"
SKILL_DIR = AUDIO / "Specialskills" / "KR"
DUB = ROOT / "Design" / "튜토리얼더빙"
DATA = ROOT / "packages" / "data" / "generated"
TEXT = DUB / "game_voice_text.json"

# build_audio.py와 같은 이름 바로잡기 · 안 쓰는 기술 · 이름난 B~D급(turnVoice.ts의 NAMED_VOICES)
SKILL_NAME_FIXES = {"가후지잭": "가후지책"}
NAMED_BCD = ["won-so", "won-sul", "gong-son-chan", "do-gyeom", "ma-sok", "yang-su", "chuk-yung", "i-myeong", "yu-seon"]
TURN_FOLDER = {"S": "SE_class", "E": "SE_class", "A": "A_class"}

nfc = lambda s: unicodedata.normalize("NFC", s)


def turn_texts() -> dict:
    """원본 대사 txt 둘 — `이름 - 대사` · `이름 - (지시) "대사",` 꼴. 이름 → (대사, 지시)."""
    out = {}
    for f in sorted((AUDIO / "voice").glob("*.txt")):
        for raw in f.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([가-힣]+)\s*-\s*(?:\(([^)]*)\)\s*)?(.+?)\s*,?\s*$", nfc(raw))
            if not m:
                continue
            name, how, line = m.groups()
            out[name] = (line.strip().strip('"').strip(), how or "")
    return out


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    officers = json.loads((DATA / "officers.json").read_text(encoding="utf-8"))
    skills = {s["id"]: s for s in json.loads((DATA / "uniqueSkills.json").read_text(encoding="utf-8"))}
    lines = json.loads((DUB / "lines.json").read_text(encoding="utf-8"))
    cast = json.loads((DUB / "cast.json").read_text(encoding="utf-8"))
    texts = turn_texts()
    filled = json.loads(TEXT.read_text(encoding="utf-8")) if TEXT.exists() else {}
    filled.setdefault("turn", {})
    filled.setdefault("skill", {})  # 받아 적어 둔 것이 있으면 표에만 싣는다

    tut = {}
    for sc in lines["scenarios"]:
        for ln in sc["lines"]:
            tut.setdefault(ln["speaker"], []).append(ln)

    skill_files = {}
    if SKILL_DIR.is_dir():
        for p in SKILL_DIR.iterdir():
            base = nfc(p.stem).removesuffix("_KR").replace(" ", "")
            skill_files[SKILL_NAME_FIXES.get(base, base)] = p

    order = {"S": 0, "E": 1, "A": 2}
    picked = [o for o in officers if o["grade"] in order or o["id"] in NAMED_BCD]
    picked.sort(key=lambda o: (order.get(o["grade"], 3), -len(tut.get(o["id"], [])), o["name"]))

    rows = []
    for o in picked:
        name = nfc(o["name"])
        folder = TURN_FOLDER.get(o["grade"], "BCD_speical")
        tf = TURN_DIR / folder / "KR" / f"{name}_KR.mp3"
        t_text, t_how = texts.get(name, (None, ""))
        if t_text is None and filled["turn"].get(o["id"]):
            t_text = filled["turn"][o["id"]]
        sk = skills.get(o.get("uniqueSkill") or "")
        sf = skill_files.get(nfc(sk["name"]).replace(" ", "")) if sk else None
        rows.append({
            "id": o["id"], "name": name, "grade": o["grade"],
            "turn": {"file": str(tf.relative_to(ROOT)).replace("\\", "/") if tf.exists() else None, "text": t_text, "how": t_how},
            "skill": None if not sk else {
                "id": sk["id"], "name": sk["name"], "tier": sk["tier"],
                # 가진 장수가 하나뿐인 기술만 그 장수의 목소리다 — A급 기술(용맹전진 · 일당백 …)은 여럿이 같은 음성을 쓴다
                "own": len(sk.get("holders") or []) == 1,
                "file": str(sf.relative_to(ROOT)).replace("\\", "/") if sf else None,
                "text": filled["skill"].get(sk["id"]) or None,
            },
            "tutorial": {"lines": len(tut.get(o["id"], [])), "voice": cast.get(o["id"], {}).get("voice", "")},
        })

    # 받아 적을 칸의 뼈대 — 파일은 있는데 글이 없는 것만 더하고, 적어 둔 값은 그대로
    for r in rows:
        if r["turn"]["file"] and not r["turn"]["text"]:
            filled["turn"].setdefault(r["id"], "")
        # 고유기술 음성은 다시 받지 않는다(2026-11-16 기획자 — 맞추는 것은 차례 음성) — 글 칸을 만들지 않는다
    TEXT.write_text(json.dumps(filled, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (DUB / "game_voice.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # ── 사람이 읽는 표 ──
    n = lambda f: sum(1 for r in rows if f(r))
    md = [
        "# 게임 안 고유 목소리 추적 (KR)",
        "",
        "`python tools/tutorial_dub_game_voice.py`가 `assets/Audio/` · 장수 데이터 · 튜토리얼 대본에서 뽑았다 — 손으로 고치지 않는다.",
        "글이 비어 있는 칸(—)은 원본 txt에 대사가 없는 것이다. 받아 적어 `game_voice_text.json`에 넣고 다시 돌린다.",
        "",
        f"- 장수 {len(rows)}명 (S {n(lambda r: r['grade'] == 'S')} · E {n(lambda r: r['grade'] == 'E')} · A {n(lambda r: r['grade'] == 'A')} · 이름난 B~D {n(lambda r: r['grade'] in 'BCD')})",
        f"- 차례 음성: 파일 {n(lambda r: r['turn']['file'])} · 글 {n(lambda r: r['turn']['text'])}",
        f"- 제 목소리의 고유기술 음성(KR, 가진 장수가 하나뿐인 기술): 파일 {n(lambda r: r['skill'] and r['skill']['own'] and r['skill']['file'])} · 글 {n(lambda r: r['skill'] and r['skill']['own'] and r['skill']['text'])}",
        "- 여럿이 함께 쓰는 기술(용맹전진 · 일당백 · 명경지수 · 신기묘산 · 십면매복 · 신속)의 음성은 그 장수의 목소리가 아니라 *공용*으로 적는다.",
        f"- 튜토리얼 대사가 있는 장수: {n(lambda r: r['tutorial']['lines'])}명 · {sum(r['tutorial']['lines'] for r in rows)}줄",
        "",
        "| 급 | 장수 | 차례 음성 (KR) | 고유기술 · 음성 (KR) | 튜토리얼 |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        t = r["turn"]
        turn = ("—" if not t["file"] else f"{t['text'] or '— (글 없음)'}" + (f" *({t['how']})*" if t["how"] else "")) if t["file"] else "파일 없음"
        s = r["skill"]
        skill = "—" if not s else (f"「{s['name']}」 *공용*" if not s["own"] else
                 f"「{s['name']}」 " + (("" if s["text"] else "(글 없음)") if s["file"] else "음성 없음") + (s["text"] or ""))
        tu = f"{r['tutorial']['lines']}줄 · {r['tutorial']['voice']}" if r["tutorial"]["lines"] else ""
        md.append(f"| {r['grade']} | {r['name']} `{r['id']}` | {turn} | {skill} | {tu} |")
    (DUB / "게임음성_추적.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md[4:8]))


if __name__ == "__main__":
    main()
