"""
고유기술 유래 줄이기 비교표 (2026-11-20 기획자) — 줄이기 전 · 뒤를 언어 글과 한국어로 나란히 본다.

    python tools/build_origin_trim_board.py <줄이기 전 uniqueSkills.json>

줄이기 전 값은 인자로 받은 옛 생성물(예: `git show <커밋>:packages/data/generated/uniqueSkills.json`)에서,
뒤 값은 지금의 `packages/data/generated/uniqueSkills.json`에서 읽는다. 한국어 칸은 — 전: 그 번역들의 바탕인 한국어 원문,
뒤: `SKILL_ORIGIN_TRIMS`의 `_ko`(원문에서 같은 구절을 덜어 낸 것). 결과는 `Design/고유기술유래_줄이기.html`.
"""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from extract_data import SKILL_ORIGIN_TRIMS  # noqa: E402

LANG_NAMES = {"en": "영어", "es_419": "스페인어(중남미)", "it": "이탈리아어", "mn": "몽골어",
              "pt_BR": "포르투갈어(브라질)", "pt_PT": "포르투갈어(포르투갈)"}
# 언어 글이 `_ko`와 조금 다르게 덜어진 자리 — 한국어 칸에 그대로 적는다
KO_OVERRIDE = {
    ("on-ju-cham-hwa-ung", "pt_PT"): "[연의 창작, 정사에서는 손견의 공적] 동탁의 부장 화웅에게 제후들의 장수가 잇달아 쓰러지자 관우가 나서겠다 청했다. 조조는 뜨거운 술 한 잔을 따라 주었다. 관우가 돌아왔을 때 술은 아직 따뜻했고, 화웅의 목은 이미 그의 손에 들려 있었다.",
}


def main() -> None:
    before = {s["id"]: s for s in json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))}
    after = {s["id"]: s for s in json.loads((ROOT / "packages/data/generated/uniqueSkills.json").read_text(encoding="utf-8"))}
    officers = json.loads((ROOT / "packages/data/generated/officers.json").read_text(encoding="utf-8"))
    owner = {o["uniqueSkill"]: o["name"] for o in officers if o.get("uniqueSkill")}

    rows: list[str] = []
    total_b = total_a = 0
    for sid, langs in SKILL_ORIGIN_TRIMS.items():
        b, a = before[sid], after[sid]
        ko_before = b["origin"]["ko"]
        ko_after = str(langs["_ko"])
        codes = [l for l in LANG_NAMES if l in langs]
        for i, lang in enumerate(codes):
            ob, oa = b["origin"][lang], a["origin"][lang]
            total_b += len(ob); total_a += len(oa)
            head = ""
            if i == 0:
                head = (f'<th class="skill" rowspan="{len(codes)}">{html.escape(owner.get(sid, ""))}<br>'
                        f'<b>{html.escape(a["name"])}</b><br><span class="hanja">{html.escape(a["hanja"])}</span></th>')
            rows.append(
                f"<tr>{head}<td class=\"lang\">{LANG_NAMES[lang]}<br><span class=\"len\">{len(ob)} → {len(oa)}자 "
                f"(−{round(100 * (1 - len(oa) / len(ob)))}%)</span></td>"
                f"<td class=\"b\">{html.escape(ob)}</td><td class=\"b ko\">{html.escape(ko_before)}</td>"
                f"<td class=\"a\">{html.escape(oa)}</td><td class=\"a ko\">{html.escape(KO_OVERRIDE.get((sid, lang), ko_after))}</td></tr>"
            )
    page = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>고유기술 유래 줄이기</title>
<style>
:root {{ --bg:#faf7f0; --fg:#2b241b; --line:#d8cdb8; --b:#fdf1ee; --a:#eef7ef; --head:#efe6d4; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#1b1916; --fg:#e9e1d2; --line:#3d362c; --b:#2c201e; --a:#1d2a20; --head:#2a251e; }} }}
body {{ margin:0; padding:16px; background:var(--bg); color:var(--fg); font:14px/1.6 "Noto Sans KR",system-ui,sans-serif; }}
h1 {{ font-size:20px; margin:0 0 4px; }}
p.note {{ margin:4px 0 14px; max-width:70rem; }}
table {{ border-collapse:collapse; width:100%; table-layout:fixed; }}
th, td {{ border:1px solid var(--line); padding:8px 10px; vertical-align:top; text-align:left; }}
thead th {{ background:var(--head); position:sticky; top:0; }}
col.c-skill {{ width:7rem; }} col.c-lang {{ width:8rem; }}
th.skill {{ background:var(--head); font-weight:400; }}
.hanja {{ opacity:.7; }}
.len {{ font-size:12px; opacity:.75; }}
td.b {{ background:var(--b); }} td.a {{ background:var(--a); }}
td.ko {{ font-size:13px; }}
</style></head><body>
<h1>고유기술 유래 줄이기 — 전 · 뒤</h1>
<p class="note">고유기술 팝업에서 넘치던 7종을, 넘치던 언어(영어 · 스페인어 · 이탈리아어 · 몽골어 · 포르투갈어 둘)에서만 줄였습니다. 한국어 · 일본어 · 중국어는 원문 그대로입니다.
한국어 칸 — <b>전</b>은 그 언어 글이 번역한 한국어 원문, <b>뒤</b>는 원문에서 같은 구절을 덜어 낸 한국어(언어 글이 그 뜻대로 줄었습니다).
글자 수 합 {total_b:,} → {total_a:,}자.</p>
<table><colgroup><col class="c-skill"><col class="c-lang"><col><col><col><col></colgroup>
<thead><tr><th>장수 · 기술</th><th>언어</th><th>전 — 그 언어</th><th>전 — 한국어</th><th>뒤 — 그 언어</th><th>뒤 — 한국어</th></tr></thead>
<tbody>
{chr(10).join(rows)}
</tbody></table>
</body></html>
"""
    out = ROOT / "Design" / "고유기술유래_줄이기.html"
    out.write_text(page, encoding="utf-8")
    print(f"{out} — {len(rows)}줄")


if __name__ == "__main__":
    main()
