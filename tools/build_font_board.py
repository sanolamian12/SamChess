"""
글자 크기 점검판 — 화면을 하나씩 손으로 보며 틱하는 진도판(HTML)을 만든다 (2026-11-18)

    python tools/build_font_board.py --audit ko=<dir>/font-audit.json --audit en=<dir>/font-audit.json

`tools/font_audit.ts`가 남긴 결과(장면별 작은 글자 · 잘림)를 로드맵의 각 화면 밑에 「자동 검사가 잡은 것」으로 끼워
`Design/글자크기점검/점검판.html` 하나로 쓴다. 틱 · 메모는 브라우저의 localStorage에 남는다(파일을 다시 만들어도 그대로 —
열쇠가 화면 id라서). 결과를 다시 재면 이 도구를 다시 돌린다.
"""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "Design" / "글자크기점검" / "점검판.html"
# 이 수 이상의 화면에서 잡히면 「공통」으로 모은다
COMMON_MIN = 5

# 로드맵 — (id, 화면, 가는 길, 볼 것, 순회 장면 이름들). 장면이 없으면 순회가 못 연 화면이다(손으로만 본다).
ROADMAP: list[tuple[str, str, list[tuple[str, str, str, str, list[str]]]]] = [
    ("main", "1. 메인 · 공용 팝업", [
        ("main", "메인 (성 안)", "로그인 뒤 첫 화면", "건물 밑 설명 글자 · 머리 통계", ["10-main"]),
        ("main-ext", "산 너머 전경", "메인 → 산 너머", "건물 밑 설명 글자(그림 위에 얹은 글)", ["11-main-ext"]),
        ("settings", "설정 팝업", "메인 → 설정", "계정 ID · 「음성 더빙」 · 음량 숫자", ["12-main-settings"]),
        ("mail", "우편함", "머리의 우편 아이콘", "보관함 칸 이름(0.45 → 0.8rem) · 받은 시각 · 선물 목록 · 오류 — 우편이 있어야 보인다", ["13-main-mail"]),
        ("info", "사용 안내", "머리의 안내 아이콘", "안내 줄 · 쪽 표시(0.55 → 0.8rem)", ["14-main-info"]),
        ("logout", "로그아웃 확인", "설정 → [로그아웃]", "확인 문구", ["15-main-logout"]),
        ("title", "간판 · 로그인", "로그아웃 상태", "간판 · 로그인 팝업", ["00-title", "01-login"]),
        ("newgame", "새 계정 — 도시 이름 · 오프닝", "새 계정 가입", "이름 입력 · 오프닝 대사", ["02-newgame", "03-opening-a", "03-opening-b"]),
        ("raid", "도적떼 알림 · 방어전 결과", "도적떼가 왔을 때 메인", "알림 · 결과 글자 — 순회가 못 여는 화면", []),
    ]),
    ("palace", "2. 궁궐", [
        ("palace-status", "궁궐 현황", "메인 → 궁궐", "도시 · 궁궐 레벨 · 황제 · 등용 장수 네 칸", ["20-palace"]),
        ("palace-rename", "도시 이름 변경 팝업", "궁궐 → [이름 변경]", "안내문 · 입력칸", ["20b-palace-rename"]),
        ("officers", "장수 목록", "궁궐 → [장수 관리]", "레벨 열이 없어지고 이름 오른쪽에 레벨 배지 · 표 머리 · 쪽 넘김 [처음]/[끝]", ["21-officers"]),
        ("officers-sort", "장수 목록 — 정렬 팝업", "장수 목록 → 정렬 단추", "정렬 기준 글자", ["22e-officer-sort"]),
        ("officer-card", "장수 상세", "장수 목록 → 아무 장수", "레벨 배지(능력치 줄 맨 앞) · 열전(0.7 → 0.8rem) · 책략 줄 · 병기 효과 · 부상 이유", ["22-officer-detail"]),
        ("officer-levelup", "장수 상세 — 레벨/스킬 관리", "장수 상세 → [레벨/스킬]", "제목의 레벨 배지 · 책략 조건문 · 능력 선택 줄", ["22b-officer-levels"]),
        ("officer-skill", "장수 상세 — 고유기술 팝업", "장수 상세 → 고유기술 배너", "기술 설명 · SP", ["22c-officer-skill"]),
        ("officer-records", "장수 상세 — 전적", "장수 상세 → [전적]", "제목의 레벨 배지 · 전적 표 머리 · 판 기록 줄", ["22d-officer-records"]),
        ("officer-injured", "장수 상세 — 부상 장수", "장수 목록 → 부상 표시가 있는 장수 → [부상]", "부상 · 남은 시간 · 막힌 이유(.64 → .8rem)", []),
        ("city", "도시 관리", "궁궐 → [도시 관리]", "자재 줄 · 건물 이름(자동 축소 하한) · 막힌 이유", ["23-city"]),
        ("buildings", "건물 관리", "도시 관리 → [건물 관리]", "건물 줄 · [증축] 단추(영어 Upgrade가 0.56rem까지 줄던 자리)", ["24-buildings"]),
        ("buildings-confirm", "건물 관리 — 짓기 확인 · 완료 팝업", "건물 관리 → [짓기]/[증축]", "확인 · 완료 팝업 글자", ["24b-buildings-build"]),
    ]),
    ("barracks", "3. 병영", [
        ("barracks", "병영", "메인 → 병영", "명령 단추 · 안내문", ["30-barracks"]),
        ("squads", "부대 관리", "병영 → [부대 관리]", "돌격대 · 수성군 줄 · 전적 칸", ["32-squads"]),
        ("squad-edit-def", "부대 편집 (수비대)", "부대 관리 → 수비대 칸", "레벨 열이 없어지고 이름 옆 배지 · 표 머리 · 「자리 없음」 획", ["35-squad-edit"]),
        ("squad-edit-atk", "부대 편집 (공격대)", "부대 관리 → 공격대 칸", "위와 같음", ["35b-squad-edit-atk"]),
        ("squad-pick", "부대 편집 — 장수 고르기", "부대 편집 → 빈 줄/장수 바꾸기", "고르기 표(레벨 배지)", ["35e-squad-pick"]),
        ("squad-swap", "부대 편집 — 기물 바꾸기", "부대 편집 → 기물 아이콘", "기물 이름 단추", ["35d-squad-swap"]),
        ("squad-deploy", "부대 배치 편집", "부대 편집 → [배치]", "판 좌표 눈금(0.54 → 0.8rem) · 장수 카드 띠 · 두루마리 안내(자동 축소 하한)", ["35c-squad-deploy"]),
        ("garrison-policy", "수비군 설정", "부대 편집(수비대) → [수비군 설정]", "방침 설명문(0.6 → 0.8rem) · 탭 · 선택지 보조문", ["36-garrison-policy"]),
        ("sortie", "출정", "병영 → [출정하기]", "표 머리 · 부대원 이름 · 군량 · 쪽 넘김", ["37-sortie"]),
        ("sortie-peek", "출정 — 부대 보기 팝업", "출정 → 부대 줄의 보기", "레벨 열이 없어지고 이름 옆 배지 · 표 머리", ["37b-sortie-peek"]),
        ("siege", "공성전 — 칠 도시 고르기", "출정 → 공성전", "도시 줄 · 자동 매칭 안내", ["38-siege"]),
        ("match", "매칭", "출정 → 야전/자동 매칭", "상대 표 머리 · 안내문", ["39-match"]),
        ("tutorials", "튜토리얼 목록", "병영 → [튜토리얼]", "목록 · 소개", ["31-tutorials"]),
    ]),
    ("market", "4. 장터", [
        ("market", "장터 첫 화면", "메인 → 장터", "명령 단추", ["40-market"]),
        ("market-shop", "상점", "장터 → [상점]", "상품 카드 글자", ["41-market-openShop"]),
        ("market-merc", "상점 — 용병(가챠)", "상점 → [용병]", "뽑기 안내 · 결과 카드", ["42-market-openMerc"]),
        ("market-items", "상점 — 아이템", "상점 → [아이템]", "효과 설명(0.64 → 0.8rem) · 표 머리 · 종류 · 쪽 넘김", ["42-market-openItems"]),
        ("market-goods", "상점 — 물자", "상점 → [물자]", "효과 · 「되돌릴 연구가 없다」 · 제조/보유 칸", ["42-market-openGoods"]),
        ("market-gold", "금화", "장터 → [금화]", "묶음 가격 · 안내문", ["41-market-openGold"]),
    ]),
    ("ext", "5. 산 너머 (확장 도시)", [
        ("academy", "태학", "산 너머 → 태학", "연구 줄 · 레벨 표기", ["60-academy"]),
        ("academy-pick", "태학 — 연구 고르기", "태학 → [연구]", "책략 엠블럼 「+」 · 개량 설명", ["60b-academy-pick"]),
        ("farm", "농지", "산 너머 → 농지", "보초병 표(레벨 열 → 이름 옆 배지) · 잠긴 줄 획", ["61-farm"]),
        ("hospital", "병원", "산 너머 → 병원", "부상 장수 줄(이름 옆 배지 · 페널티 줄)", ["62-hospital"]),
        ("hospital-admit", "병원 — 입원시킬 장수 고르기", "병원 → [입원]", "고르기 표", ["62b-hospital-admit"]),
        ("forge", "대장간", "산 너머 → 대장간", "병기 표 머리 · 제조/보유 칸 · 해설", ["63-forge"]),
        ("forge-craft", "대장간 — 제조", "대장간 → [제조]", "제조 팝업", ["63b-forge-craft"]),
    ]),
    ("board", "6. 대자보", [
        ("board", "대자보", "메인 → 대자보", "명령 단추", ["50-board"]),
        ("ranking", "랭킹 메뉴", "대자보 → [랭킹]", "요약 판", ["51-ranking"]),
        ("ranking-city", "도시 랭킹", "랭킹 → 도시", "표 머리 · 줄", ["52-ranking-city"]),
        ("ranking-squad", "부대 랭킹", "랭킹 → 부대 → 줄 펼치기", "[구성 보기](0.56 → 0.8rem) · 구성 표(레벨 열 → 이름 옆 배지)", ["53-ranking-squad"]),
        ("ranking-officer", "장수 랭킹", "랭킹 → 장수", "레벨 열 → 이름 옆 배지 · [구성 보기]", ["54-ranking-officer"]),
        ("collection", "컬렉션", "대자보 → [컬렉션]", "시대 띠(0.6 → 0.8rem) · 줄 설명 · [랭킹 보기] · 쪽 넘김", ["55-collection"]),
        ("collection-ranking", "컬렉션 랭킹 팝업", "컬렉션 → [랭킹 보기]", "순위 줄", ["55b-collection-ranking"]),
        ("defense", "방어 기록", "대자보 → [방어 기록]", "안내문 · 기록 줄(새 기록 · 낡음 표시)", ["56-defense"]),
    ]),
    ("battle", "7. 전투", [
        ("battle-deploy", "배치", "출정 → 매칭 → 전투 (데모: ?demo=1&deploy=1)", "「자동 포커싱」(0.6 → 0.8rem) · 배치 판 · 고유기술 목록", ["80-battle-deploy"]),
        ("battle-3v3", "전투 3v3", "데모: ?demo=1&sp=25", "게임 정보 · 대화창 [...] · 순서 판 · 명령 판", ["81-battle-3v3"]),
        ("battle-5v5", "전투 5v5", "데모: ?demo=1&mode=5v5&sp=25", "SP MAX 안내 · 맥락 판", ["82-battle-5v5"]),
        ("battle-popup", "전투 — 장수 팝업", "판의 장수를 누름", "레벨 배지(등급 배지 옆) · 능력치 · 책략 칩 — 순회가 못 여는 화면", []),
        ("battle-tip", "전투 — 툴팁 · 정찰 · 책략 확인", "아이콘에 손가락 · [책략 확인]", "툴팁 본문 · 정찰 표 — 순회가 못 여는 화면", []),
        ("battle-siege", "수성전", "데모: ?demo=1&siege=1&mode=3v3", "성채 · 게임 정보", ["83-battle-siege"]),
        ("battle-duel", "일기토 · 설전", "데모: ?demo=1&duel=1", "물음 · 합 · 받는 팝업", ["84-battle-duel"]),
        ("battle-tutorial", "튜토리얼 전투", "?tutorial=basic-1", "대사 판 · 목표 표", ["85-tutorial"]),
        ("result", "결과 (승 · 패)", "전투가 끝나면", "보상 칸 · 전적", ["70-result-win", "71-result-lose"]),
        ("replay", "방어 기록 리플레이", "방어 기록 → [다시 보기]", "관전 화면 — 순회가 못 여는 화면", []),
    ]),
]


def findings(audits: dict[str, dict], scenes: list[str]) -> list[dict]:
    """장면들에서 잡힌 것 — 같은 선택자(끝 두 마디) · 같은 종류는 하나로 묶고 어디서 잡혔는지(언어/방향)를 단다."""
    out: dict[tuple[str, str], dict] = {}
    for lang, data in audits.items():
        for kind, table in (("small", data.get("results", {})), ("clip", data.get("clips", {}))):
            for key, hits in table.items():
                orient, _, scene = key.partition("/")
                if scene not in scenes:
                    continue
                for h in hits:
                    # 조상의 살짝 줄인 변형(0.95배 이상)은 CSS 크기로 판정한다(`font_audit.ts`와 같은 규칙 — 옛 결과도 걸러지게)
                    if kind == "small" and h.get("scale", 1) >= 0.95 and h["rem"] / h["scale"] >= 0.795:
                        continue
                    leaf = " > ".join(h["sel"].split(" > ")[-2:])
                    cur = out.setdefault((kind, leaf), {"kind": kind, "sel": leaf, "text": h["text"], "rem": h["rem"], "px": h["px"], "where": set()})
                    cur["rem"] = min(cur["rem"], h["rem"])
                    cur["px"] = max(cur["px"], h["px"])
                    cur["where"].add(f"{lang}·{'세로' if orient == 'portrait' else '가로'}")
    rows = sorted(out.values(), key=lambda r: (r["kind"] != "small", -r["px"] if r["kind"] == "clip" else r["rem"]))
    for r in rows:
        r["where"] = sorted(r["where"])
    return rows


def covered(audits: dict[str, dict], scenes: list[str]) -> bool:
    """순회가 이 화면을 실제로 열었나 — 장면이 결과에 하나라도 있어야 한다(못 연 장면은 결과에 없다. 「잡힌 것 없음」과 다르다)"""
    return any(key.partition("/")[2] in scenes for data in audits.values() for key in data.get("results", {}))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audit", action="append", default=[], help="언어=font-audit.json 경로")
    args = ap.parse_args()
    audits: dict[str, dict] = {}
    for a in args.audit:
        lang, _, path = a.partition("=")
        audits[lang] = json.loads(Path(path).read_text(encoding="utf-8"))
    sections = []
    for sid, title, items in ROADMAP:
        sections.append({"id": sid, "title": title, "items": [
            {"id": iid, "title": name, "path": path, "focus": focus, "scenes": scenes,
             "auto": findings(audits, scenes), "covered": covered(audits, scenes)}
            for iid, name, path, focus, scenes in items
        ]})
    # 여러 화면에 함께 뜨는 것(머리 제목 · 뒤로 단추 · 쪽 넘김) — 화면마다 되풀이하면 그 화면의 것이 묻힌다.
    # `COMMON_MIN` 화면 이상에서 잡힌 것은 맨 앞 「공통」 항목으로 모으고 화면별 목록에서 뺀다
    seen: dict[tuple[str, str], list[dict]] = {}
    for sec in sections:
        for it in sec["items"]:
            for a in it["auto"]:
                seen.setdefault((a["kind"], a["sel"]), []).append({**a, "screen": it["title"]})
    common_keys = {k for k, v in seen.items() if len(v) >= COMMON_MIN}
    common = []
    for k in sorted(common_keys, key=lambda k: -len(seen[k])):
        v = seen[k]
        first = v[0]
        common.append({**first, "rem": min(x["rem"] for x in v), "px": max(x["px"] for x in v),
                       "where": [f"{len(v)}개 화면"] + sorted({w for x in v for w in x["where"]})})
    for sec in sections:
        for it in sec["items"]:
            it["auto"] = [a for a in it["auto"] if (a["kind"], a["sel"]) not in common_keys]
    if common:
        sections[0]["items"].insert(0, {
            "id": "common", "title": "공통 — 여러 화면에 함께 뜨는 것", "path": "어느 화면이든",
            "focus": f"머리 제목 · [뒤로] 단추 · 쪽 넘김처럼 {COMMON_MIN}개 화면 이상에서 잡힌 것. 한 번 고치면 전부 고쳐진다",
            "scenes": [], "auto": common, "covered": True,
        })
    data = {"made": date.today().isoformat(), "langs": sorted(audits), "sections": sections}
    html = TEMPLATE.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8", newline="\n")
    n = sum(len(s["items"]) for s in sections)
    print(f"→ {OUT.relative_to(ROOT)} — 화면 {n}개, 자동 검사 언어 {', '.join(sorted(audits)) or '없음'}")
    return 0


TEMPLATE = r"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>글자 크기 점검판</title>
<!-- 만드는 도구: tools/build_font_board.py — 이 파일을 손으로 고치지 않는다(다시 만들면 덮인다). 틱 · 메모는 localStorage에 남는다 -->
<style>
:root {
  --bg: #f6f3ec; --panel: #fffdf8; --ink: #2a241c; --mute: #7a6f60; --line: #e2d9c8;
  --accent: #8a3b1f; --accent-ink: #fff; --chip: #efe6d4; --done: #2f7a46; --done-bg: #e3f1e6;
  --small: #a3401f; --clip: #8a6a12;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #17140f; --panel: #211c16; --ink: #ece4d6; --mute: #a39784; --line: #3a3229;
    --accent: #d0774f; --accent-ink: #1a120c; --chip: #2e271f; --done: #7fcf95; --done-bg: #1f3325;
    --small: #f08a63; --clip: #e3c15a;
  }
}
:root[data-theme="dark"] {
  --bg: #17140f; --panel: #211c16; --ink: #ece4d6; --mute: #a39784; --line: #3a3229;
  --accent: #d0774f; --accent-ink: #1a120c; --chip: #2e271f; --done: #7fcf95; --done-bg: #1f3325;
  --small: #f08a63; --clip: #e3c15a;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.55 "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); padding: 12px 16px; }
h1 { margin: 0 0 6px; font-size: 18px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.bar { flex: 1 1 200px; height: 10px; background: var(--chip); border-radius: 999px; overflow: hidden; min-width: 120px; }
.bar > i { display: block; height: 100%; background: var(--done); width: 0; transition: width .2s; }
.count { color: var(--mute); font-variant-numeric: tabular-nums; }
button, .btn { font: inherit; border: 1px solid var(--line); background: var(--panel); color: var(--ink); padding: 5px 11px; border-radius: 8px; cursor: pointer; }
button.on { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
details.how { margin-top: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; }
details.how summary { cursor: pointer; font-weight: 600; }
details.how ul { margin: 6px 0 2px; padding-left: 20px; }
code { background: var(--chip); padding: 1px 5px; border-radius: 4px; font-size: 13px; word-break: break-all; }
main { max-width: 980px; margin: 0 auto; padding: 16px; }
section { margin: 0 0 22px; }
section > h2 { display: flex; gap: 10px; align-items: baseline; margin: 0 0 8px; font-size: 17px; }
section > h2 .count { font-size: 14px; font-weight: 400; }
.item { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; margin: 0 0 8px; }
.item[data-done="1"] { background: var(--done-bg); border-color: var(--done); }
.item-head { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: start; padding: 10px 12px; }
.item-head input[type="checkbox"] { width: 22px; height: 22px; margin: 2px 0 0; accent-color: var(--done); cursor: pointer; }
.item-title { font-weight: 700; }
.item-path { color: var(--mute); font-size: 14px; }
.item-focus { font-size: 14px; margin-top: 2px; }
.tag { font-size: 12px; padding: 1px 7px; border-radius: 999px; background: var(--chip); color: var(--mute); white-space: nowrap; }
.tag.small { color: var(--small); }
.tag.clip { color: var(--clip); }
.item-body { padding: 0 12px 10px 44px; }
.item-body summary { cursor: pointer; color: var(--mute); font-size: 14px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
th, td { text-align: left; padding: 4px 6px; border-top: 1px solid var(--line); vertical-align: top; }
th { color: var(--mute); font-weight: 600; }
td.k-small { color: var(--small); white-space: nowrap; }
td.k-clip { color: var(--clip); white-space: nowrap; }
td code { font-size: 12px; }
textarea { width: 100%; min-height: 2.6em; margin-top: 8px; font: inherit; font-size: 14px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); resize: vertical; }
.hide-done .item[data-done="1"] { display: none; }
.none { color: var(--mute); font-size: 14px; }
@media (max-width: 560px) { .item-body { padding-left: 12px; } header { padding: 10px 12px; } main { padding: 12px; } }
</style>
</head>
<body>
<header>
  <h1>글자 크기 점검판 <span class="count" id="made"></span></h1>
  <div class="row">
    <div class="bar"><i id="all-bar"></i></div>
    <span class="count" id="all-count"></span>
    <button id="hide-done" type="button">끝난 것 숨기기</button>
    <button id="export" type="button">진도 복사</button>
    <button id="import" type="button">진도 붙여넣기</button>
  </div>
  <details class="how">
    <summary>보는 법</summary>
    <ul>
      <li><b>기준</b> — 화면 글자는 <b>0.8rem 이상</b>(휴대폰 폭 390px에서 약 12px). 그림 안의 글자는 제외. 스타일시트는 일괄로 올려 두었다.</li>
      <li><b>볼 것</b> — 잘리거나 말줄임(…)된 글 · 두 줄로 접혀 칸이 커진 곳 · 겹친 글 · 장수 레벨 배지 자리(레벨 열을 없애고 이름 오른쪽에).</li>
      <li><b>자동 검사</b> — <code>tools/font_audit.ts</code>가 화면을 돌며 잰 것. <span class="tag small">작음</span> 0.8rem 미만 · <span class="tag clip">잘림</span> 칸보다 넓은 글(넘친 px). 순회가 못 여는 화면은 손으로만 본다.</li>
      <li><b>열기</b> — 개발 서버 <code>http://localhost:5173</code>. 전투 데모는 주소 뒤에 <code>?demo=1…</code>. 가로 화면은 <code>?orient=landscape</code>, 언어는 설정에서.</li>
      <li><b>틱 · 메모</b>는 이 브라우저에 남는다(파일을 다시 만들어도 그대로). 다른 기기로 옮길 때는 [진도 복사] → [진도 붙여넣기].</li>
    </ul>
  </details>
</header>
<main id="board"></main>
<script>
const DATA = /*DATA*/null;
const KEY = 'samchess.fontcheck.v1';
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { state = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 저장이 막혀도 화면은 돈다 */ } };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

document.getElementById('made').textContent = `· 자동 검사 ${DATA.made} (${DATA.langs.join(', ') || '없음'})`;
const board = document.getElementById('board');
const counters = [];

for (const sec of DATA.sections) {
  const s = el('section'); s.id = sec.id;
  const h = el('h2'); h.append(el('span', null, sec.title));
  const c = el('span', 'count'); h.append(c);
  s.append(h);
  counters.push(() => { const d = sec.items.filter((i) => state[i.id]?.done).length; c.textContent = `${d} / ${sec.items.length}`; });
  for (const it of sec.items) {
    const st = state[it.id] ?? (state[it.id] = {});
    const box = el('div', 'item'); box.dataset.done = st.done ? '1' : '0';
    const head = el('div', 'item-head');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!st.done; cb.setAttribute('aria-label', `${it.title} 완료`);
    cb.addEventListener('change', () => { st.done = cb.checked; st.at = cb.checked ? new Date().toISOString().slice(0, 16).replace('T', ' ') : undefined; box.dataset.done = cb.checked ? '1' : '0'; save(); refresh(); });
    const mid = el('div');
    mid.append(el('div', 'item-title', it.title), el('div', 'item-path', it.path), el('div', 'item-focus', it.focus));
    const tags = el('div', 'row');
    const nSmall = it.auto.filter((a) => a.kind === 'small').length;
    const nClip = it.auto.filter((a) => a.kind === 'clip').length;
    if (!it.covered) tags.append(el('span', 'tag', '손으로만'));
    if (nSmall) tags.append(el('span', 'tag small', `작음 ${nSmall}`));
    if (nClip) tags.append(el('span', 'tag clip', `잘림 ${nClip}`));
    head.append(cb, mid, tags);
    box.append(head);
    const body = el('div', 'item-body');
    if (it.auto.length) {
      const det = el('details'); det.append(el('summary', null, `자동 검사가 잡은 것 ${it.auto.length}곳`));
      const tb = el('table'); const tr0 = el('tr');
      for (const t of ['종류', '글', '요소', '어디서']) tr0.append(el('th', null, t));
      tb.append(tr0);
      for (const a of it.auto) {
        const tr = el('tr');
        tr.append(el('td', a.kind === 'small' ? 'k-small' : 'k-clip', a.kind === 'small' ? `작음 ${a.rem}rem` : `잘림 +${a.px}px`));
        tr.append(el('td', null, a.text));
        const td = el('td'); td.append(el('code', null, a.sel)); tr.append(td);
        tr.append(el('td', null, a.where.join(' ')));
        tb.append(tr);
      }
      det.append(tb); body.append(det);
    } else if (it.covered) {
      body.append(el('div', 'none', '자동 검사가 잡은 것 없음'));
    }
    const memo = el('textarea'); memo.placeholder = '고칠 것 · 메모'; memo.value = st.memo ?? '';
    memo.addEventListener('input', () => { st.memo = memo.value || undefined; save(); });
    body.append(memo);
    box.append(body);
    s.append(box);
  }
  board.append(s);
}

function refresh() {
  const all = DATA.sections.flatMap((s) => s.items);
  const done = all.filter((i) => state[i.id]?.done).length;
  document.getElementById('all-count').textContent = `${done} / ${all.length} 화면`;
  document.getElementById('all-bar').style.width = `${(done / all.length) * 100}%`;
  counters.forEach((f) => f());
}
refresh();

const hideBtn = document.getElementById('hide-done');
let hide = false;
try { hide = localStorage.getItem(KEY + '.hide') === '1'; } catch { /* */ }
const applyHide = () => { document.body.classList.toggle('hide-done', hide); hideBtn.classList.toggle('on', hide); };
applyHide();
hideBtn.addEventListener('click', () => { hide = !hide; try { localStorage.setItem(KEY + '.hide', hide ? '1' : '0'); } catch { /* */ } applyHide(); });

document.getElementById('export').addEventListener('click', async () => {
  const text = JSON.stringify(state);
  try { await navigator.clipboard.writeText(text); alert('진도를 복사했습니다.'); } catch { prompt('아래 글을 복사하세요', text); }
});
document.getElementById('import').addEventListener('click', () => {
  const text = prompt('복사해 둔 진도를 붙여넣으세요');
  if (!text) return;
  try { state = JSON.parse(text); save(); location.reload(); } catch { alert('진도 글이 올바르지 않습니다.'); }
});
</script>
</body>
</html>
"""

if __name__ == "__main__":
    raise SystemExit(main())
