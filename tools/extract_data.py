#!/usr/bin/env python3
"""
삼국 약식 체스 — 엑셀 → JSON 추출 파이프라인

원본 `삼국지 약식체스.xlsx`는 **읽기만 한다**. 절대 수정하지 않는다.
정규화(이름 통일, 중복 제거)는 전부 이 스크립트에서 처리하므로,
엑셀을 다시 고쳐도 재실행만 하면 된다.

의존성 없음 (Python 표준 라이브러리만). `python tools/extract_data.py`

출력: packages/data/generated/*.json
종료 코드: 검증 실패 시 1
"""

from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

# ────────────────────────────────────────────────────────────────
# 경로
# ────────────────────────────────────────────────────────────────

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent                          # 프로젝트 루트
XLSX = ROOT / "docs" / "삼국지 약식체스.xlsx"
CHARS = ROOT / "assets" / "Chars"
SKILL_ART = ROOT / "assets" / "SpecialSkills"
STATUS_FX = ROOT / "assets" / "SpecialStatus"
LANGUAGES = ROOT / "assets" / "Languages"
BIO_CSV = LANGUAGES / "sam_people.csv"
OUT = ROOT / "packages" / "data" / "generated"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

# ────────────────────────────────────────────────────────────────
# 정규화 규칙 (GDD §9) — 표준은 Chars/ 폴더 파일명
# ────────────────────────────────────────────────────────────────

NAME_FIXES = {
    "관훙": "관흥",
    # 李傕는 '이각'이 바른 독음이다. 초상화가 '이곽.png'였던 탓에 "Chars 폴더 기준"
    # 규칙이 오탈자를 표준으로 삼았는데, 2026-08-07에 **이각으로 되돌렸다**
    # (초상화 파일명도 함께 바꿨다). 엑셀 장수 시트가 원래부터 '이각'이라 매핑이 필요 없다.
    "장노": "장로",
    # 張遼의 바른 독음은 '장료'다. 엑셀 장수 시트와 초상화가 '장요'였는데
    # 2026-08-04에 **장료로 통일**하기로 확정했다 (초상화 파일명도 함께 바꿨다).
    # 스킬 시트는 원래부터 '장료'라 이제 양쪽이 같다 — 스킬명 「장료지제」와도 맞는다.
    "장요": "장료",
    # 2026-08-31, G1 장수 열전(`sam_people.csv`) 작성 중 8명의 독음이 엑셀·초상화
    # 파일명과 어긋난 것을 발견 — CSV 쪽(기획자 상식 기준 독음)을 표준으로 확정하고
    # `assets/Chars/`의 초상화 파일명도 함께 리네임했다.
    "주영": "주령",
    "한조": "한호",
    "장흥": "장흠",
    "송겸": "송헌",
    "왕개": "왕해",
    "왕누": "왕루",
    "금선": "김선",
    "포용": "포륭",
}
FACTION_FIXES = {"장노군": "장로군"}

# 스킬 이름 정정 — (바른 이름, 바른 한자 또는 None).
# 한자까지 바꾸는 것과 한글만 바꾸는 것은 성격이 다르므로 둘을 구분해 적는다.
SKILL_NAME_FIXES = {
    # 한자가 맞고 한글 표기만 틀린 경우 (2026-07-31 확정)
    "구류지책": ("구호탄랑", None),      # 한자 驅虎吞狼 기준. 엑셀의 '구류지책'이 오기
    # 한글·한자가 서로 맞지만 **다른 고사를 가리키던** 경우 (기획자 결정 2026-08-03).
    # 엑셀의 拔其睛啖之("그 눈알을 뽑아 삼키다")는 연의 서술문이고,
    # 하후돈의 고사는 관용구 拔矢啖睛(발시담정)이다. 이쪽을 표준으로 삼는다.
    "발기정담지": ("발시담정", "拔矢啖睛"),
}

# 고유기술 SP 코스트 (GDD §3.6)
SP_COST = {"S": 6, "A": 5, "B": 4, "E": 7}

# 등급 환산 점수 (GDD §7)
GRADE_SCORE = {"S": 10, "A": 8, "B": 6, "C": 4, "D": 2, "E": 0}


def fix_name(n: str) -> str:
    return NAME_FIXES.get(n, n)


# ────────────────────────────────────────────────────────────────
# 설명문의 시간 표기 (GDD §2·§3.3) — 2026-08-07 확정
# ────────────────────────────────────────────────────────────────
#
# `time`은 엔진의 내부 단위다. 엑셀 스킬 시트와 아래 TACTICS는 원문 그대로
# "time 190 동안"이라고 적혀 있는데, **플레이어에게는 일(日)로만 보여준다.**
# time 100 = 게임 내 1일이므로 100으로 나누면 된다.
#
# 원문을 고치지 않고 출력 직전에 바꾸는 이유:
#   · 엑셀은 읽기 전용이라 애초에 손댈 수 없다
#   · TACTICS는 PPT 원문을 그대로 옮긴 것이라 대조할 때 원문형이 편하다
# 그래서 `time` 표기는 데이터 소스에만 남고, 생성물과 화면에는 나오지 않는다.

TIME_PER_DAY = 100

# 뒤의 「마다」는 붙여 쓰므로 같이 먹는다 ("time 200 마다" → "2일마다").
# 「동안」·「안에」·「후」는 띄어 쓰는 자리라 공백을 남긴 채 놔둔다.
_TIME_RE = re.compile(r"\btime\s*(\d+)(\s*마다)?")

# 대기시간 증감. WT는 절대시간과 **같은 단위**라 100 = 1일로 똑같이 나눈다.
# 영문 "waiting time"이 설명문에만 남아 있어 `WT`로 통일한다 — GDD §2 용어표,
# §3.7 책략표, 유닛 타일의 세 번째 바가 전부 `WT`다. 플레이어가 설명에서 읽은 말과
# 화면에서 보는 바의 이름이 같아야 한다.
_WT_RE = re.compile(r"\bwaiting\s+time\s*([+\-])\s*(\d+)")

MINUS = "−"      # − (U+2212). GDD 표기와 맞춘다. ASCII 하이픈은 폭이 달라 섞이면 눈에 띈다


def _days(n: int) -> str:
    """100 → "1", 190 → "1.9", 50 → "0.5". 소수점은 필요할 때만 남긴다."""
    return f"{n / TIME_PER_DAY:g}"


def to_days(text: str) -> str:
    """설명문의 `time N` · `waiting time ±N`을 일(日) 표기로 바꾼다."""
    text = _WT_RE.sub(
        lambda m: f"WT {MINUS if m.group(1) == '-' else '+'}{_days(int(m.group(2)))}일",
        text,
    )
    return _TIME_RE.sub(
        lambda m: f"{_days(int(m.group(1)))}일" + ("마다" if m.group(2) else ""),
        text,
    )


# ────────────────────────────────────────────────────────────────
# 한글 → 로마자 슬러그 (표시명이 바뀌어도 id는 유지되도록 분리)
# ────────────────────────────────────────────────────────────────

CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "",
       "j", "jj", "ch", "k", "t", "p", "h"]
JUNG = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae",
        "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"]
JONG = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "p", "l", "l",
        "l", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"]


def romanize(text: str) -> str:
    """음절 단위 개정 로마자 표기. 결정적이며 표음 동화는 적용하지 않는다."""
    parts: list[str] = []
    for ch in text:
        code = ord(ch)
        if 0xAC00 <= code <= 0xD7A3:
            idx = code - 0xAC00
            parts.append(CHO[idx // 588] + JUNG[(idx % 588) // 28] + JONG[idx % 28])
        elif ch.isalnum():
            parts.append(ch.lower())
    slug = "-".join(p for p in parts if p)
    return re.sub(r"-{2,}", "-", slug).strip("-")


# ────────────────────────────────────────────────────────────────
# 최소 xlsx 리더
# ────────────────────────────────────────────────────────────────

def col_index(ref: str) -> int:
    n = 0
    for ch in re.match(r"([A-Z]+)", ref).group(1):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


class Workbook:
    def __init__(self, path: Path):
        self.z = zipfile.ZipFile(path)
        self.shared = [
            "".join(t.text or "" for t in si.iter(NS + "t"))
            for si in ET.fromstring(self.z.read("xl/sharedStrings.xml")).findall(NS + "si")
        ]
        rels = {
            r.get("Id"): r.get("Target")
            for r in ET.fromstring(self.z.read("xl/_rels/workbook.xml.rels"))
        }
        self.sheets: dict[str, str] = {}
        for sh in ET.fromstring(self.z.read("xl/workbook.xml")).iter(NS + "sheet"):
            target = rels[sh.get(REL + "id")].lstrip("/")
            self.sheets[sh.get("name")] = target if target.startswith("xl/") else "xl/" + target

    def cells(self, sheet_name: str) -> dict[str, str]:
        """{'A1': '값'} 형태. 빈 셀은 포함하지 않는다."""
        root = ET.fromstring(self.z.read(self.sheets[sheet_name]))
        out: dict[str, str] = {}
        for c in root.iter(NS + "c"):
            v = c.find(NS + "v")
            if c.get("t") == "s":
                val = self.shared[int(v.text)] if v is not None else ""
            elif c.get("t") == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(NS + "t"))
            else:
                val = v.text if v is not None else ""
            val = unicodedata.normalize("NFC", (val or "")).strip()
            if val:
                out[c.get("r")] = val
        return out

    def rows(self, sheet_name: str) -> list[list[str]]:
        root = ET.fromstring(self.z.read(self.sheets[sheet_name]))
        out: list[list[str]] = []
        for row in root.iter(NS + "row"):
            cells: dict[int, str] = {}
            for c in row.findall(NS + "c"):
                v = c.find(NS + "v")
                if c.get("t") == "s":
                    val = self.shared[int(v.text)] if v is not None else ""
                elif c.get("t") == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(NS + "t"))
                else:
                    val = v.text if v is not None else ""
                val = unicodedata.normalize("NFC", (val or "")).strip()
                if val:
                    cells[col_index(c.get("r"))] = val
            out.append([cells.get(i, "") for i in range(max(cells) + 1)] if cells else [])
        return out


# ────────────────────────────────────────────────────────────────
# 기물 마스크 (GDD §3.2, 2026-07-31 확정)
# ────────────────────────────────────────────────────────────────

ORTH = [(1, 0), (-1, 0), (0, 1), (0, -1)]
DIAG = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
ALL8 = ORTH + DIAG
KNIGHT = [(1, 2), (-1, 2), (1, -2), (-1, -2), (2, 1), (2, -1), (-2, 1), (-2, -1)]


def ray(dirs, n):
    return [(dx * k, dy * k) for dx, dy in dirs for k in range(1, n + 1)]


PIECES = {
    "King":   dict(move=ALL8,         blocked=False, attack=ALL8,         targets=1, threat=25),
    "Rock":   dict(move=ray(ORTH, 4), blocked=True,  attack=DIAG,         targets=1, threat=41),
    "Bishop": dict(move=ray(DIAG, 4), blocked=True,  attack=ORTH,         targets=1, threat=37),
    "Knight": dict(move=KNIGHT,       blocked=False, attack=ORTH,         targets=1, threat=25),
    "Queen":  dict(move=ray(ALL8, 3), blocked=True,  attack=[(0, 1), (0, -1)], targets=1, threat=39),
    "Pawn":   dict(move=ALL8,         blocked=False, attack=ray(ORTH, 2), targets=2, threat=33),
}


def check_skill_art(skills: list[dict], by_name: dict) -> None:
    """
    `assets/SpecialSkills/` 고유기술 연출 이미지를 스킬 데이터와 대조한다 (2026-08-03 추가).

    파일명 규약(기획자 지정): `장수이름 기술이름.jpg`.
    마지막 띄어쓰기 앞이 보유자, 뒤가 기술명이다. 여러 장수가 공유하는 A·B급 기술은
    이름을 쉼표로 잇고 마지막 이름 뒤에 띄어쓰기 + 기술명.

    **기술명에 공백이 있는 3종**(신재조영 심재촉 · 인중여포 마중적토 · 화용도 의석조조)은
    이 규약과 충돌한다. 실제 파일은 공백을 지워 붙여 쓰므로 **양쪽 다 공백을 지우고** 비교한다.

    **화면이 이 이미지를 쓰기 시작했으므로(2026-08-04, 전투 씬 3차) 어긋나면 빌드를 막는다.**
    이름이 어긋난 기술은 발동 연출에서 배너가 빠져 글자만 뜬다. 어긋난 항목은 하나씩
    안내로 남기고, 하나라도 있으면 마지막에 검증 실패로 올린다 — 초상화 대조와 같은 강도다.
    폴더 자체가 없으면(에셋은 리포에 없다) 예전처럼 조용히 건너뛴다.
    """
    if not SKILL_ART.is_dir():
        note(f"[연출] {SKILL_ART} 를 찾을 수 없어 대조를 건너뛴다")
        return

    files = sorted(p for p in SKILL_ART.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if not files:
        note(f"[연출] {SKILL_ART} 가 비어 있어 대조를 건너뛴다")
        return

    squash = lambda s: s.replace(" ", "")                       # noqa: E731
    by_squashed = {squash(s["name"]): s for s in skills}
    id_to_name = {o["id"]: o["name"] for o in by_name.values()}
    seen: set[str] = set()
    problems = 0

    for path in files:
        stem = unicodedata.normalize("NFC", path.stem)
        if " " not in stem:
            note(f"[연출] '{path.name}' — 띄어쓰기가 없어 보유자/기술명을 나눌 수 없다")
            problems += 1
            continue

        who, skill_name = stem.rsplit(" ", 1)
        skill = by_squashed.get(squash(skill_name))
        if skill is None:
            note(f"[연출] '{path.name}' — '{skill_name}' 이라는 고유기술이 없다")
            problems += 1
            continue
        seen.add(skill["id"])

        if "." in who:
            note(f"[연출] '{path.name}' — 이름 구분자가 쉼표가 아닌 곳이 있다")
            problems += 1
        listed = {n.strip() for n in who.replace(".", ",").split(",") if n.strip()}
        actual = {id_to_name[h] for h in skill["holders"] if h in id_to_name}
        for extra in sorted(listed - actual):
            hint = f" ('{NAME_FIXES[extra]}' 인가?)" if extra in NAME_FIXES else ""
            note(f"[연출] 「{skill['name']}」 — 파일에만 있는 이름 '{extra}'{hint}")
            problems += 1
        for miss in sorted(actual - listed):
            note(f"[연출] 「{skill['name']}」 — 파일명에 빠진 이름 '{miss}'")
            problems += 1

    for orphan in sorted(s["name"] for s in skills if s["id"] not in seen):
        note(f"[연출] 「{orphan}」 의 이미지가 없다")
        problems += 1

    note(f"[연출] 이미지 {len(files)}장 / 고유기술 {len(skills)}종 — "
         + ("어긋남 없음" if problems == 0 else f"확인할 것 {problems}건"))
    if problems:
        fail(f"[연출] 연출 이미지가 {problems}건 어긋난다 — 위 안내 참조 "
             f"(화면이 이 이미지를 쓰므로 어긋나면 배너가 빠진다)")


def threat_range(move, attack) -> int:
    """이동 후 공격까지의 합집합 (원점 포함)."""
    positions = [(0, 0)] + list(move)
    cells = {(px + dx, py + dy) for px, py in positions for dx, dy in attack}
    cells.add((0, 0))
    return len(cells)


# ────────────────────────────────────────────────────────────────
# 책략 (GDD §3.7) — PPT 출처, 엑셀에 없음
# ────────────────────────────────────────────────────────────────

TACTICS = [
    # (레벨, 계열, 이름, MP, 설명)
    (2, "support",  "증폭",   1, "아군 1명의 1회 공격을 Critical 100%로 만든다"),
    (3, "support",  "반감",   1, "아군 1명이 1번 받는 데미지가 절반이 된다"),
    (4, "support",  "회복",   2, "8방향 내 아군 1명의 HP를 최대 체력의 20% 회복"),
    (5, "support",  "결계",   2, "time 200 동안 아군 1명이 환술에 걸리지 않는다. 모든 환술 무효"),
    # Lv6·7은 「화계 하나 / 진화 하나」다 (2026-09-03 재정리, GDD §12). 예전에는
    # 「화계+진화」가 Lv6에 한 쌍, 「수계+매립」이 Lv7에 한 쌍이었다 — 수계가
    # **진입 불가 지형**이라 판을 막아 결착이 안 나는 판이 생길 수 있어 수계·매립을
    # 통째로 지웠고, 남은 진화를 Lv7로 올려 레벨마다 지원 하나가 됐다. MP는 둘 다
    # 그대로(화계 2 · 진화 1).
    (6, "support",  "화계",   2, "1×1 영역에 time 100마다 HP 1씩 감소하는 지형 생성"),
    (7, "support",  "진화",   1, "화계 지형 제거"),
    (8, "support",  "선공",   3, "아군 1명의 waiting time -100"),
    (9, "support",  "대회복", 3, "8방향 내 아군 전원의 HP를 최대 체력의 20% 회복"),
    (2, "illusion", "공포",   1, "time 200 동안 적군 1명의 공격력이 절반이 된다"),
    (3, "illusion", "침묵",   1, "time 200 동안 적군 1명이 버프/환술을 사용할 수 없다"),
    (4, "illusion", "함정",   2, "적군 1명의 waiting time +50, HP 1 감소"),
    (5, "illusion", "탈진",   2, "time 200마다 HP 1 감소 (결계로만 해제)"),
    (6, "illusion", "유인",   2, "적군 1명을 컨트롤: 이동만 가능"),
    (7, "illusion", "경직",   3, "적군 1명의 waiting time +100"),
    (8, "illusion", "질병",   3, "time 100마다 HP 1 감소 (결계로만 해제)"),
    (9, "illusion", "초선",   3, "적군 1명을 컨트롤: 이동+공격"),
]

# Effect DSL (packages/rules/src/types.ts의 Effect 유니온) — 룰 엔진이 그대로 해석한다.
# 여기가 책략 사양의 단일 출처다. 엔진에 하드코딩하지 않는다.
#
#   duration 없음 = 해제 전까지 영구  |  charges = N회 소모형  |  period = DoT 정산 주기
#
# 판단이 들어간 곳 (원문에 명시가 없어 정한 것):
#   · "8방향 내" = 체비쇼프 거리 1
#   · 회복량 20%는 내림 (데미지 규약과 동일). Lv1 최대 HP 10 → 2
#   · 대회복은 시전자 자신도 포함한다
#   · 화계는 유닛이 선 칸에도 깔 수 있다
#   · 화계·성지(수성지주) 둘 다 이미 지형이 있는 칸은 덮어쓰지 못한다 (한쪽 지형으로
#     다른 쪽을 지우는 것 방지 — 성지↔화계 양방향)
#   · 진입 불가 지형(`water`)을 만드는 책략은 없다 — 「수계」를 지운 뒤로 엔진의
#     `water`는 남아 있지만(손대면 이동·경로 판정 전부가 흔들린다) 아무도 안 만든다
TACTIC_EFFECTS = {
    "증폭":   [{"t": "applyStatus", "target": {"kind": "allyOne"},
                "status": "critical100", "charges": 1}],
    "반감":   [{"t": "applyStatus", "target": {"kind": "allyOne"},
                "status": "incomingDamageHalf", "charges": 1}],
    "회복":   [{"t": "heal", "target": {"kind": "allyOne", "withinRadius": 1}, "pctMaxHp": 0.2}],
    "결계":   [{"t": "applyStatus", "target": {"kind": "allyOne"},
                "status": "illusionImmune", "duration": 200},
               # 「탈진·질병은 결계로만 해제」 (GDD §3.7)
               {"t": "removeStatus", "target": {"kind": "allyOne"}, "status": "dot"}],
    "화계":   [{"t": "createTerrain", "target": {"kind": "tile", "filter": "noTerrain"}, "terrain": "fire"}],
    "진화":   [{"t": "removeTerrain", "target": {"kind": "tile"}, "terrain": "fire"}],
    "선공":   [{"t": "modifyWt", "target": {"kind": "allyOne"}, "delta": -100}],
    "대회복": [{"t": "heal", "target": {"kind": "alliesInRadius", "radius": 1, "includeSelf": True},
                "pctMaxHp": 0.2}],

    "공포":   [{"t": "applyStatus", "target": {"kind": "enemyOne"},
                "status": "outgoingDamageHalf", "duration": 200}],
    "침묵":   [{"t": "applyStatus", "target": {"kind": "enemyOne"},
                "status": "silence", "duration": 200}],
    "함정":   [{"t": "modifyWt", "target": {"kind": "enemyOne"}, "delta": 50},
               {"t": "damage", "target": {"kind": "enemyOne"}, "flat": 1}],
    "탈진":   [{"t": "applyStatus", "target": {"kind": "enemyOne"},
                "status": "dot", "magnitude": 1, "period": 200}],
    "유인":   [{"t": "controlEnemy", "target": {"kind": "enemyOne"}, "mode": "moveOnly", "uses": 1}],
    "경직":   [{"t": "modifyWt", "target": {"kind": "enemyOne"}, "delta": 100}],
    "질병":   [{"t": "applyStatus", "target": {"kind": "enemyOne"},
                "status": "dot", "magnitude": 1, "period": 100}],
    "초선":   [{"t": "controlEnemy", "target": {"kind": "enemyOne"}, "mode": "moveAndAttack", "uses": 1}],
}

# ────────────────────────────────────────────────────────────────
# 고유기술 효과 (GDD §4.4) — 책략과 같은 Effect DSL
# ────────────────────────────────────────────────────────────────
#
# A/B/E급 10종은 원문이 기계적이라 전부 데이터로 접힌다.
# S급 30종 중 정형인 것도 여기에 적고, 서사형(부활·아군화 등)만 SKILL_SCRIPTS로 뺀다.
# 스킬 이름을 키로 쓴다 — id는 로마자 슬러그라 눈으로 대조하기 어렵다.

SKILL_EFFECTS = {
    # ── A급 4종 ──────────────────────────────────────────────
    "용맹전진": [{"t": "applyStatus", "target": {"kind": "self"},
                  "status": "incomingDamageHalf", "duration": 190}],
    "일당백":   [{"t": "applyStatus", "target": {"kind": "self"},
                  "status": "critical100", "duration": 190}],
    "명경지수": [{"t": "applyStatus", "target": {"kind": "self"},
                  "status": "zeroMpCost", "duration": 190}],
    "신기묘산": [{"t": "applyStatus", "target": {"kind": "self"},
                  "status": "illusionAlways", "duration": 90}],

    # ── B급 5종 ──────────────────────────────────────────────
    # 부저추신: SP 4를 써서 적 SP를 1 깎는다. 교환비가 불리하다 — GDD §11-1 관찰 대상
    "부저추신": [{"t": "modifySp", "side": "enemy", "delta": -1}],
    "한천감우": [{"t": "heal", "target": {"kind": "alliesInRadius", "radius": 1, "includeSelf": True},
                  "flat": 1}],
    "십면매복": [{"t": "modifyWt", "target": {"kind": "enemyOne", "anywhere": True}, "delta": 90}],
    "일격필살": [{"t": "applyStatus", "target": {"kind": "self"},
                  "status": "critical100", "duration": 90}],
    "신속":     [{"t": "modifyWt", "target": {"kind": "self"}, "delta": -50, "turns": 1}],

    # ── E급 1종 ──────────────────────────────────────────────
    # 헌제. 능력치 1/1/1에 SP 7로 time 990 무적 — GDD §11-6 관찰 대상
    "황제옹립": [{"t": "applyStatus", "target": {"kind": "self"},
                  "status": "untargetable", "duration": 990}],

    # ── S급 (정형) ───────────────────────────────────────────
    # 자기 강화형 — A급과 구조는 같고 지속시간·조합이 다르다
    "백기겁위영": [{"t": "applyStatus", "target": {"kind": "self"},
                    "status": "freeMove", "duration": 190}],
    "백의도강":   [{"t": "applyStatus", "target": {"kind": "self"},
                    "status": "untargetable", "duration": 190}],
    "발시담정":   [{"t": "applyStatus", "target": {"kind": "self"},
                    "status": "incomingDamageHalf", "duration": 490}],
    "용호상박":   [{"t": "applyStatus", "target": {"kind": "self"},
                    "status": "critical100", "duration": 490}],
    "간뇌도지":   [{"t": "applyStatus", "target": {"kind": "self"},
                    "status": "critical100", "duration": 290},
                   {"t": "applyStatus", "target": {"kind": "self"},
                    "status": "incomingDamageHalf", "duration": 290}],
    # 서황 — 시전 턴의 WT는 그대로, 이후 3턴의 기준값이 −50 (GDD §12 B2)
    "병귀신속":   [{"t": "modifyWt", "target": {"kind": "self"}, "delta": -50, "turns": 3}],

    # 아군 전체 강화형
    "가후지책":   [{"t": "applyStatus", "target": {"kind": "allAllies"},
                    "status": "illusionAlways", "duration": 190}],
    "강동지호":   [{"t": "applyStatus", "target": {"kind": "allAllies"},
                    "status": "critical100", "duration": 190}],
    "지곤상증":   [{"t": "heal", "target": {"kind": "allAllies"}, "pctMaxHp": 0.3}],
    "세한지송백": [{"t": "multiplyMaxHp", "target": {"kind": "allyOne"}, "factor": 2}],

    # 적 전체 제어형
    "장판하뢰":   [{"t": "modifyWt", "target": {"kind": "allEnemies"}, "delta": 150}],
    "신재조영 심재촉": [{"t": "setMp", "target": {"kind": "allEnemies"}, "value": 0}],
    "연환계":     [{"t": "controlEnemy", "target": {"kind": "allEnemies"},
                    "mode": "moveOnly", "uses": 1}],
    "구호탄랑":   [{"t": "controlEnemy", "target": {"kind": "nextEnemiesInTurnOrder", "count": 2},
                    "mode": "moveAndAttack", "uses": 1}],
    # 육손 — 최대 HP의 30%를 3번에 나눠 깎는다: 시전 직후 / +100 / +200 (GDD §12 A3-2).
    # 지속시간을 290으로 두면 정산 시점이 +100, +200 두 번이라 즉시분과 합쳐 정확히 3회.
    "화소연영":   [{"t": "damage", "target": {"kind": "allEnemies"}, "pctMaxHp": 0.1},
                   {"t": "applyStatus", "target": {"kind": "allEnemies"}, "status": "dot",
                    "magnitudePct": 0.1, "period": 100, "duration": 290, "cleansable": False}],
    # 사마의 — 게임 끝까지. 「결계」로 못 지운다 (GDD §12 A3)
    "식소사번":   [{"t": "applyStatus", "target": {"kind": "enemyOne"}, "status": "dot",
                    "magnitude": 1, "period": 110, "cleansable": False}],

    # 지형
    "수성지주":   [{"t": "createTerrain", "target": {"kind": "tile", "filter": "noTerrain"}, "terrain": "holy"}],

    # ── S급 (엔진 배선이 붙는 것) ────────────────────────────
    # 황충 — 190 동안 매 턴 원거리 저격 + 확정 크리티컬 (GDD §12 B1)
    "백보천양":   [{"t": "applyStatus", "target": {"kind": "self"},
                    "status": "attackAnywhere", "duration": 190},
                   {"t": "applyStatus", "target": {"kind": "self"},
                    "status": "critical100", "duration": 190}],
    # 장합 — 피격 시 반격. 사거리 무시, 반격은 반격을 부르지 않는다 (§12 A4)
    "변화무쌍":   [{"t": "applyStatus", "target": {"kind": "self"},
                    "status": "counterattack", "duration": 290}],
    # 허저 — magnitude가 반경. 매 순간 거리를 다시 잰다 (§12 A1)
    "단기도강":   [{"t": "applyStatus", "target": {"kind": "self"},
                    "status": "auraIncomingHalf", "duration": 190, "magnitude": 1}],
    # 여포 — 어디든 1회 이동(charges 1) + 반경 2칸 적 공격력 절반
    "인중여포 마중적토": [
        {"t": "applyStatus", "target": {"kind": "self"}, "status": "freeMove", "charges": 1},
        {"t": "applyStatus", "target": {"kind": "self"},
         "status": "auraOutgoingHalf", "duration": 290, "magnitude": 2}],
    # 장료 — 즉시 전 적군 1회 공격
    "장료지제":   [{"t": "attackAllEnemiesOnce"}],
    # 주유 — 지정 아군이 데미지 절반 + 모든 적 공격을 대신 받는다 (§12 B4)
    "고육지책":   [{"t": "applyStatus", "target": {"kind": "allyOne"},
                    "status": "incomingDamageHalf", "duration": 290},
                   {"t": "applyStatus", "target": {"kind": "allyOne"},
                    "status": "damageRedirect", "duration": 290}],
    # 강유 — 490 동안 공격마다 AT +1, 최대 +9. charges를 상한으로 쓴다 (§12 B5)
    "구벌중원":   [{"t": "applyStatus", "target": {"kind": "self"}, "status": "attackStacking",
                    "duration": 490, "magnitude": 0, "charges": 9}],

    # ── S급 (엔진 훅이 처리하는 것) ──────────────────────────
    # 시전은 표식만 남기고, 실제 개입은 훅이 한다.
    # 관우 — 190 안에 처음 때린 대상은 즉사. King 제외 (§12 A5)
    "온주참화웅": [{"t": "applyStatus", "target": {"kind": "self"},
                    "status": "instantKillNext", "duration": 190}],
    # 유비 — 490 안에 3회 때린 적이 아군이 된다. charges가 필요 타수
    "삼고초려":   [{"t": "applyStatus", "target": {"kind": "self"},
                    "status": "convertOnHit", "duration": 490, "charges": 3}],
    # 조조 — 사망 시 1회 부활 (지속시간 없음: 죽을 때까지 유지)
    "화용도 의석조조": [{"t": "applyStatus", "target": {"kind": "self"}, "status": "revivePending"}],
    # 곽가 — 사망하고 magnitude(=290) 뒤 적 1명 사망
    "유언계책":   [{"t": "applyStatus", "target": {"kind": "self"},
                    "status": "deathCurse", "magnitude": 290}],
    # 태사자 — 대상 쪽 표식은 여기서 건다. 이게 곧 "적 1명을 겨눈다"는 선언이기도 하다.
    # 시전자 쪽 표식(상대를 가리키는)은 DSL로 접히지 않아 duel 스크립트가 맡는다.
    "소패왕전":   [{"t": "applyStatus", "target": {"kind": "enemyOne"}, "status": "mustTarget"}],
}

# 데이터로 접히지 않는 서사형 스킬 → packages/rules/src/scripts.ts의 핸들러 키.
# 여기 이름이 올라오면 엔진 쪽에도 같은 키의 핸들러가 있어야 한다.
SKILL_SCRIPTS: dict[str, str] = {
    "소패왕전": "duel",
    "차동풍":   "restoreAllyUniqueSkills",
}

# ────────────────────────────────────────────────────────────────
# 경제 (GDD §6) — PPT 출처, 엑셀에 없음
# ────────────────────────────────────────────────────────────────

ECONOMY = {
    "goldPacks": [
        {"gold": 10, "krw": 1000},
        {"gold": 60, "krw": 5000},
        {"gold": 120, "krw": 10000},
    ],
    "grainPerGold": 20,
    "materialsPerGold": 1,
    # 상점 가챠 — "계정별 유한 랜덤 어레이" (history/2026-08-21_트랙9_가격정책_초안.md §4).
    # 전투 보상 풀(B·C·D, §5-22 불변식)과 겹치는 건 B 하나뿐 — S·A·E는 전투로 안 나온다.
    # C·D는 전투 보상·리사이클·도시 확장으로 이미 순환하므로 가챠 풀에서 뺐다.
    "gachaGrades": ["S", "A", "B", "E"],
    # 단발/10연 가격(골드). 최소보장(pity) 없음 — 등급별 인원수가 이미 S+A 55.6%로
    # 후하게 나와 10연이 전부 최하위일 확률이 사실상 0이라 불필요하다고 판단했다.
    "gachaPull": {"single": {"gold": 10}, "ten": {"gold": 90, "count": 10}},
    # 장수 1명당 슬롯 수 = 레벨 9까지 드는 카드 누적 수(growth.json 경유, 여기 옮겨
    # 적지 않는다)의 배수. 2배는 레벨업 후 남는 리사이클용 여유분.
    "gachaSlotMultiplier": 2,
    # 고정 확률표가 없다 — 등급별 확률은 그 등급에 속한 장수 수가 정하므로(위 모델),
    # 정적인 rate가 아니라 officers.json의 등급 분포에서 매번 계산해 낸다.
    "recycle": {"cardsIn": 1 * 10, "gradeScore": GRADE_SCORE},
    "respecItemGold": 10,
    "battleRewards": {
        "win": {
            "grain": 1,
            "cards": 1,
            "gradePool": [
                {"condition": "team contains 1 D-grade", "pool": ["C"]},
                {"condition": "team contains 2 D-grade", "pool": ["B"]},
                {"condition": "otherwise", "pool": ["B", "C", "D"]},
            ],
        },
        "lose": {"cards": 1, "gradePool": ["C", "D"]},
    },
}

# ────────────────────────────────────────────────────────────────
# 추출
# ────────────────────────────────────────────────────────────────

problems: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    problems.append(msg)


def note(msg: str) -> None:
    notes.append(msg)


def extract_officers(wb: Workbook) -> list[dict]:
    officers = []
    for r in wb.rows("장수"):
        if len(r) < 8 or not r[0] or r[0] == "이름":
            continue
        name = fix_name(r[0])
        might, intel, lead = int(r[1]), int(r[2]), int(r[3])
        total, best, faction, grade = int(r[4]), int(r[5]), r[6], r[7]

        if total != might + intel + lead:
            fail(f"[장수] {name}: 합계 {total} ≠ {might + intel + lead}")
        if best != max(might, intel, lead):
            fail(f"[장수] {name}: 최고점 {best} ≠ {max(might, intel, lead)}")
        if grade not in GRADE_SCORE:
            fail(f"[장수] {name}: 알 수 없는 등급 {grade!r}")

        officers.append({
            "id": romanize(name),
            "name": name,
            "grade": grade,
            "might": might,
            "intellect": intel,
            "leadership": lead,
            "faction": FACTION_FIXES.get(faction, faction),
            "portrait": f"assets/Chars/{name}.png",
            "wtBase": 190 - lead,          # GDD §3.3
            "uniqueSkill": None,           # 아래에서 연결
        })
    return officers


# CSV 열 접미사 → 클라이언트 `Lang`(`packages/client/src/i18n/index.ts`) 코드.
# CSV는 BCP-47 스타일 하이픈(`pt-BR`·`es-419`·`zh-Hant`)을 쓰고, 클라이언트
# 열 개 언어 코드는 밑줄이다 — 여기서 한 번만 옮긴다.
BIO_LANGS: dict[str, str] = {
    "ko": "ko", "en": "en", "pt-BR": "pt_BR", "pt-PT": "pt_PT", "ja": "ja",
    "zh-Hant": "zh_Hant", "zh-Hans": "zh_Hans", "it": "it", "es-419": "es_419", "mn": "mn",
}


def extract_bios() -> dict[str, dict[str, dict[str, str]]]:
    """
    `assets/Languages/sam_people.csv`의 인물 열전 — G1(작업계획), `OfficerData.story`/
    `courtesyName`의 소스. **열 개 언어를 전부** 연결한다(2026-08-27 — "장수 열전도
    다국어 지원", CSV에 처음부터 `bio_en`·`bio_ja`… 아홉 벌이 다 있었는데 한국어
    한 벌만 쓰던 것을 마저 배선했다. 218명 전원, 열 언어 다 채워져 있다 —
    실측으로 확인).

    처음엔 `roster_kr.md`(사람이 읽는 산문)를 정규식으로 긁었는데, 이 CSV가
    **같은 218명을 이미 `name_ko`/`courtesy_ko`/`bio_ko` 열로 갈라 둔** 훨씬 안전한
    소스라 옮겼다 — 산문에서 "이름 (자)"를 다시 쪼갤 필요가 없다. `docs/*.xlsx`와
    같은 **읽기 전용 원본**이다.

    반환값은 한국어 이름을 키로, `{nameI18n: {lang: 값}, courtesyName: {lang: 값},
    story: {lang: 값}}` — 언어별 값 자체도 **있는 만큼만** 담는다(한 언어라도
    비어 있으면 그 언어 키가 빠진다 — 화면에서 한국어로 물러나는 자리는
    `officerById`를 읽는 클라이언트가 맡는다, `t()`의 "없으면 한국어로" 규약과
    같은 결). `name_ko`는 `nameI18n`에 안 담는다 — `OfficerData.name`이 이미
    그 값이라(id·Map 키로 쓰는 기준 언어), 굳이 맵 안에도 넣으면 두 자리가
    같은 값을 따로 관리하게 된다.
    """
    if not BIO_CSV.exists():
        note(f"[열전] {BIO_CSV} 를 찾을 수 없어 건너뛴다")
        return {}
    with BIO_CSV.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    out: dict[str, dict[str, dict[str, str]]] = {}
    for row in rows:
        name = (row.get("name_ko") or "").strip()
        if not name:
            continue
        name_by_lang: dict[str, str] = {}
        courtesy_by_lang: dict[str, str] = {}
        story_by_lang: dict[str, str] = {}
        for csv_suffix, lang in BIO_LANGS.items():
            if lang != "ko":
                other_name = (row.get(f"name_{csv_suffix}") or "").strip()
                if other_name:
                    name_by_lang[lang] = other_name
            courtesy = (row.get(f"courtesy_{csv_suffix}") or "").strip()
            story = (row.get(f"bio_{csv_suffix}") or "").strip()
            if courtesy:
                courtesy_by_lang[lang] = courtesy
            if story:
                story_by_lang[lang] = story
        if story_by_lang.get("ko"):
            out[name] = {
                "nameI18n": name_by_lang,
                "courtesyName": courtesy_by_lang,
                "story": story_by_lang,
            }
    return out


def attach_bios(officers: list[dict]) -> None:
    """`officers`에 `nameI18n`·`story`·`courtesyName`을 있는 만큼만 채운다
    (언어별 맵으로). 없는 장수는 그 필드 없이 남는다 — `OfficerData.story?`가
    이미 그 물러남을 계약으로 두고 있다(packages/data/src/index.ts)."""
    bios = extract_bios()
    if not bios:
        return
    officer_names = {o["name"] for o in officers}
    for o in officers:
        entry = bios.get(o["name"])
        if entry:
            if entry["nameI18n"]:
                o["nameI18n"] = entry["nameI18n"]
            if entry["courtesyName"]:
                o["courtesyName"] = entry["courtesyName"]
            o["story"] = entry["story"]
    missing = sorted(o["name"] for o in officers if "story" not in o)
    unmatched = sorted(set(bios) - officer_names)
    note(f"[열전] {len(officers) - len(missing)}/{len(officers)}명 연결(열 언어) — "
         f"누락 {len(missing)}명: {', '.join(missing)}")
    if unmatched:
        note(f"[열전] 열전에는 있지만 장수 이름과 안 맞는 {len(unmatched)}건 "
             f"(표기 차이로 보인다 — 확인 필요): {', '.join(unmatched)}")


SKILL_LORE_CSV = LANGUAGES / "sam_skills.csv"


def extract_skill_lore() -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    """
    `assets/Languages/sam_skills.csv`의 고유기술 열전 — `origin_{lang}`은
    `UniqueSkillDef.origin`, `name_{lang}`은 `nameI18n`, `text_{lang}`은
    `textI18n`의 소스다. 장수 열전(`extract_bios`)과 같은 규약이다: **열 개
    언어를 전부** 연결하고, 없는 언어는 그 키가 빠진다. `docs/*.xlsx`와 같은
    **읽기 전용 원본**이다. `origin`은 S급 30종 + E급 1종(고사가 있는 것)만
    채워져 있다 — 정형 효과뿐인 A/B급 9종은 고사가 없다. `name`/`text`는
    **40종 전부** 채워져 있다(스킬명·효과 서술은 등급과 무관하게 화면에 뜬다).

    스킬명(한글, `name_ko`)이 아니라 `id`(로마자 슬러그) 열로 스킬을 식별한다 —
    표시명은 재설계·오탈자 정정으로 바뀔 수 있어도 슬러그는 안정적이기 때문이다.

    반환값은 `(origin, name, text)` 세 쌍 — 각각 skill id를 키로, `{lang: 값}`.
    """
    if not SKILL_LORE_CSV.exists():
        note(f"[고유기술 열전] {SKILL_LORE_CSV} 를 찾을 수 없어 건너뛴다")
        return {}, {}, {}
    with SKILL_LORE_CSV.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    def collect(prefix: str, require_ko: bool) -> dict[str, dict[str, str]]:
        out: dict[str, dict[str, str]] = {}
        for row in rows:
            skill_id = (row.get("id") or "").strip()
            if not skill_id:
                continue
            by_lang: dict[str, str] = {}
            for csv_suffix, lang in BIO_LANGS.items():
                value = (row.get(f"{prefix}_{csv_suffix}") or "").strip()
                if value:
                    by_lang[lang] = value
            if by_lang.get("ko") or not require_ko:
                if by_lang:
                    out[skill_id] = by_lang
        return out

    return collect("origin", True), collect("name", True), collect("text", True)


def attach_skill_lore(skills: list[dict]) -> None:
    """`skills`에 `origin`·`nameI18n`·`textI18n`을 있는 만큼만 채운다(언어별
    맵으로). 없는 스킬은 그 필드 없이 남는다 — `UniqueSkillDef`의 세 필드가
    모두 optional인 것이 이미 그 물러남을 계약으로 두고 있다
    (packages/data/src/index.ts)."""
    origin_lore, name_lore, text_lore = extract_skill_lore()
    if not (origin_lore or name_lore or text_lore):
        return
    skill_ids = {s["id"] for s in skills}
    for s in skills:
        origin = origin_lore.get(s["id"])
        if origin:
            s["origin"] = origin
        name_i18n = name_lore.get(s["id"])
        if name_i18n:
            s["nameI18n"] = name_i18n
        text_i18n = text_lore.get(s["id"])
        if text_i18n:
            s["textI18n"] = text_i18n
    have_origin = sum(1 for s in skills if "origin" in s)
    have_name = sum(1 for s in skills if "nameI18n" in s)
    have_text = sum(1 for s in skills if "textI18n" in s)
    unmatched = sorted((set(origin_lore) | set(name_lore) | set(text_lore)) - skill_ids)
    note(f"[고유기술 열전] 유래 {have_origin}/{len(skills)}종(S+E급만 대상, "
         f"{sum(1 for s in skills if s['tier'] in ('S', 'E'))}종 중 {have_origin}종) · "
         f"이름 {have_name}/{len(skills)}종 · 효과 {have_text}/{len(skills)}종 연결(열 언어)")
    if unmatched:
        note(f"[고유기술 열전] 열전에는 있지만 스킬 id와 안 맞는 {len(unmatched)}건 "
             f"(id 변경으로 보인다 — 확인 필요): {', '.join(unmatched)}")


TACTIC_LORE_CSV = LANGUAGES / "sam_tactics.csv"


def attach_tactic_lore(tactics: list[dict]) -> None:
    """
    `assets/Languages/sam_tactics.csv`의 책략 다국어 — `name_{lang}`은
    `TacticData.nameI18n`, `text_{lang}`은 `textI18n`의 소스다. 고유기술 열전
    (`attach_skill_lore`)과 **같은 규약**이다: 열 개 언어를 전부 연결하고,
    없는 언어는 그 키가 빠지며(화면이 한국어로 물러난다), 스킬을 고르는 열은
    표시명이 아니라 **`id`**(로마자 슬러그)다. `docs/*.xlsx`와 같은 읽기 전용
    원본이고, 없으면 조용히 건너뛴다(그때는 화면이 전부 한국어로 물러난다).

    책략에는 유래(`origin`)가 없어 `name`·`text` 두 벌뿐이다 — 그래서
    `extract_skill_lore`처럼 세 벌을 모으는 함수를 따로 두지 않고 여기서 바로
    붙인다. **`ko`는 안 담는다** — `TacticData.name`/`text`가 이미 그 값이라
    (엑셀이 정본), 맵 안에도 넣으면 두 자리가 같은 값을 따로 관리하게 된다.
    대신 CSV의 `ko`가 엑셀과 어긋나면 **그 자리에서 알린다** — CSV를 손보다
    한국어 원문을 건드리면 번역이 다른 문장을 옮긴 것이 되기 때문이다.
    """
    if not TACTIC_LORE_CSV.exists():
        note(f"[책략 다국어] {TACTIC_LORE_CSV} 를 찾을 수 없어 건너뛴다")
        return
    with TACTIC_LORE_CSV.open(encoding="utf-8-sig", newline="") as f:
        rows = {(r.get("id") or "").strip(): r for r in csv.DictReader(f)}
    by_id = {t["id"]: t for t in tactics}
    have_name = have_text = 0
    for tid, row in rows.items():
        t = by_id.get(tid)
        if not t:
            continue
        for field, prefix in (("nameI18n", "name"), ("textI18n", "text")):
            by_lang: dict[str, str] = {}
            for csv_suffix, lang in BIO_LANGS.items():
                value = (row.get(f"{prefix}_{csv_suffix}") or "").strip()
                if lang == "ko":
                    base = t["name"] if prefix == "name" else t["text"]
                    if value and value != base:
                        fail(f"[책략 다국어] '{tid}'의 {prefix}_ko가 엑셀과 다르다 — "
                             f"CSV: {value!r} / 엑셀: {base!r}")
                    continue
                if value:
                    by_lang[lang] = value
            if by_lang:
                t[field] = by_lang
                if field == "nameI18n":
                    have_name += 1
                else:
                    have_text += 1
    unmatched = sorted(set(rows) - set(by_id))
    note(f"[책략 다국어] 이름 {have_name}/{len(tactics)}종 · "
         f"효과 {have_text}/{len(tactics)}종 연결(열 언어)")
    if unmatched:
        note(f"[책략 다국어] CSV에는 있지만 책략 id와 안 맞는 {len(unmatched)}건 "
             f"(id 변경으로 보인다 — 확인 필요): {', '.join(unmatched)}")


def extract_skills(wb: Workbook, by_name: dict[str, dict]) -> list[dict]:
    """
    티어별 스킬 정의를 추출한다.
    A/B급은 여러 장수가 같은 스킬을 공유하므로 스킬 자체는 중복 제거하여 1건으로 만들고,
    보유 장수 목록은 officer.uniqueSkill 쪽에 기록한다.
    """
    seen_rows: dict[str, list[dict]] = defaultdict(list)
    for r in wb.rows("고유 스킬"):
        if len(r) < 3 or r[0] not in SP_COST or not r[1]:
            continue
        seen_rows[fix_name(r[1])].append({
            "tier": r[0],
            "name": (r[2] if len(r) > 2 else "").strip(),
            "hanja": (r[3] if len(r) > 3 else "").strip(),
            "text": (r[4] if len(r) > 4 else "").strip(),
        })

    skills: dict[str, dict] = {}

    for officer_name, rows in sorted(seen_rows.items()):
        officer = by_name.get(officer_name)
        if officer is None:
            fail(f"[스킬] '{officer_name}' 은 장수 시트에 없다")
            continue

        # 중복 행 해소: 장수 시트의 등급과 티어가 일치하는 행만 채택한다.
        matching = [row for row in rows if row["tier"] == officer["grade"]]
        if len(rows) > 1:
            dropped = [f"{r['tier']}/{r['name']}" for r in rows if r not in matching]
            note(f"[스킬] '{officer_name}' 중복 {len(rows)}행 → 등급 {officer['grade']} 기준으로 "
                 f"{len(matching)}행 채택, 제외: {', '.join(dropped)}")
        if len(matching) != 1:
            fail(f"[스킬] '{officer_name}': 등급 {officer['grade']}에 맞는 행이 "
                 f"{len(matching)}개 (기대 1개)")
            continue

        row = matching[0]
        if not row["name"]:
            fail(f"[스킬] '{officer_name}': 스킬 이름이 비어 있다")
            continue

        fixed = SKILL_NAME_FIXES.get(row["name"])
        if fixed:
            new_name, new_hanja = fixed
            if new_hanja:
                note(f"[스킬] '{row['name']}({row['hanja']})' → '{new_name}({new_hanja})' 로 정정")
                row["hanja"] = new_hanja
            else:
                note(f"[스킬] '{row['name']}' → '{new_name}' 로 정정 (한자 {row['hanja']} 기준)")
            row["name"] = new_name

        skill_id = romanize(row["name"])
        existing = skills.get(skill_id)
        if existing is None:
            skills[skill_id] = {
                "id": skill_id,
                "name": row["name"],
                "hanja": row["hanja"],
                "tier": row["tier"],
                "spCost": SP_COST[row["tier"]],
                "text": to_days(row["text"]),      # 엑셀의 "time 190 동안" → "1.9일 동안"
                "effects": SKILL_EFFECTS.get(row["name"], []),
                "scriptId": SKILL_SCRIPTS.get(row["name"]),   # 서사형 S급 전용
                "holders": [],
            }
        elif existing["tier"] != row["tier"]:
            fail(f"[스킬] '{row['name']}' 이 서로 다른 티어로 등장: "
                 f"{existing['tier']} vs {row['tier']}")

        skills[skill_id]["holders"].append(officer["id"])
        officer["uniqueSkill"] = skill_id

    # 키 오타를 조용히 흘려보내지 않는다 — 이름에 공백이 섞인 스킬이 있어 특히 쉽다
    known = {s["name"] for s in skills.values()}
    for orphan in sorted(set(SKILL_EFFECTS) - known):
        fail(f"[스킬] SKILL_EFFECTS의 '{orphan}'에 대응하는 스킬이 없다")
    for orphan in sorted(set(SKILL_SCRIPTS) - known):
        fail(f"[스킬] SKILL_SCRIPTS의 '{orphan}'에 대응하는 스킬이 없다")

    for s in skills.values():
        s["holders"].sort()
    return sorted(skills.values(), key=lambda s: (s["tier"], -len(s["holders"]), s["id"]))


def extract_growth(wb: Workbook) -> dict:
    """
    레벨업 테이블.

    **성공 확률은 뽑지 않는다** — 2026-08-04에 레벨업 실패를 없애고 전 레벨 100%로
    확정했다(GDD §4.3 · §12). 쓰지 않는 값을 생성물에 남기면 "확률이 있는데 왜 안 쓰나"로
    읽혀 더 헷갈린다.

    **J열(성공 확률)은 이제 없어도 된다** (2026-08-12). 원래는 엑셀에 90/70/50/30%가
    남아 있어 여기서 걸러 냈는데, 기획자가 그 열을 지웠다. 둘 다 받아들인다 —
    남아 있으면 무시했다고 알리고, 없으면 조용히 100%로 본다.
    """
    c = wb.cells("게임 환경")
    level_up = []
    dropped = []
    for row in range(22, 30):                      # G22:J29
        raw = c.get(f"J{row}")
        rate = float(raw) if raw not in (None, "") else 1.0
        if rate < 1.0:
            dropped.append(f"Lv{int(c[f'G{row}'])} {rate:.0%}")
        level_up.append({
            "level": int(c[f"G{row}"]),
            "cardsRequired": int(c[f"H{row}"]),
        })
    if [x["level"] for x in level_up] != list(range(2, 10)):
        fail("[성장] 레벨업 테이블이 2~9가 아니다")
    if dropped:
        note(f"[성장] 레벨업 실패는 없앴다 — 엑셀의 성공 확률 {', '.join(dropped)}을 무시한다")
    return {
        "base": {"hp": 10, "mp": 5, "at": 2},          # GDD §4.2 (PPT 출처)
        "statChoices": [{"hp": 5}, {"mp": 2}, {"at": 0.5}],
        "maxLevel": 9,
        "levelUp": level_up,
    }


# 부대 저장 개수 상한 (GDD §5) — 도시 Lv1 10개, 레벨마다 +5 → Lv9 50개.
# 엑셀에 열이 없어 여기서 계산한다. 규칙을 바꾸려면 여기만 고친다.
SQUAD_CAP_BASE = 10
SQUAD_CAP_STEP = 5


def extract_city(wb: Workbook) -> list[dict]:
    """도시 레벨 표. **`squadCap`만 엑셀에 없고 여기서 계산한다** (아래 참조)."""
    c = wb.cells("게임 환경")
    out = []
    for row in range(34, 43):                      # B34:F42
        level = int(c[f"C{row}"])
        out.append({
            "level": level,
            "materialsToUpgrade": int(c[f"B{row}"]) if f"B{row}" in c else None,
            "grainPerHour": int(c[f"D{row}"]),
            "grainCap": int(c[f"E{row}"]),
            "characterPool": int(c[f"F{row}"]),
            # 부대(편성) 저장 개수 상한 — GDD §5 (2026-08-17 기획자 확정, 작업 계획 §5-7).
            # **엑셀에 열이 없다.** Lv1 10개에서 레벨마다 +5, Lv9 = 50개라는 규칙만
            # 확정됐으므로 `base`·`statChoices`처럼 여기서 계산해 데이터로 내보낸다 —
            # 이 파일이 단일 출처이고, `meta/src/city.ts`가 읽기만 한다.
            "squadCap": SQUAD_CAP_BASE + (level - 1) * SQUAD_CAP_STEP,
        })
    if [x["level"] for x in out] != list(range(1, 10)):
        fail("[도시] 레벨 테이블이 1~9가 아니다")
    if out[-1]["squadCap"] != 50:
        fail(f"[도시] Lv9 부대 상한이 50이 아니다 — {out[-1]['squadCap']}")
    return out


def extract_team_scores(wb: Workbook) -> list[dict]:
    c = wb.cells("게임 환경")
    out = []
    for row in range(46, 59):                      # B46:E58
        combos = [x.strip().replace(" ", "") for x in c[f"D{row}"].split("\n") if x.strip()]
        combos = [x.rstrip(",") for x in combos]
        out.append({
            "rank": int(c[f"B{row}"].rstrip("위")),
            "score": int(c[f"C{row}"].rstrip("점")),
            "combos": combos,
            "comboCount": int(c[f"E{row}"].rstrip("개")),
        })
        if len(combos) != out[-1]["comboCount"]:
            fail(f"[팀점수] {out[-1]['rank']}위: 조합 {len(combos)}개 ≠ 표기 {out[-1]['comboCount']}개")
        for combo in combos:
            got = sum(GRADE_SCORE[g] for g in combo.split("+"))
            if got != out[-1]["score"]:
                fail(f"[팀점수] {combo} = {got}점 ≠ 표기 {out[-1]['score']}점")
    return out


def build_pieces() -> list[dict]:
    out = []
    for name, p in PIECES.items():
        computed = threat_range(p["move"], p["attack"])
        if computed != p["threat"]:
            fail(f"[기물] {name}: 위협 범위 계산 {computed} ≠ 기대 {p['threat']}")
        out.append({
            "type": name,
            "moveMask": [{"x": x, "y": y} for x, y in sorted(set(p["move"]))],
            "moveBlocked": p["blocked"],
            "attackMask": [{"x": x, "y": y} for x, y in sorted(set(p["attack"]))],
            "maxTargets": p["targets"],
            "threatRange": computed,
        })
    return out


# ────────────────────────────────────────────────────────────────
# 시각 효과 (visual effect) — `assets/SpecialStatus/` 30장
# ────────────────────────────────────────────────────────────────
#
# 「오라」라고 부르지 말 것 ★
# ---------------------------
# 엔진에는 이미 **오라(aura)**가 있다 — `auraIncomingHalf` / `auraOutgoingHalf` 와
# `state.ts`의 `aurasOn()`. 여포·허저의 **반경 효과**를 가리키는 판정 용어다.
# 여기서 다루는 것은 화면에 겹쳐 그리는 **그림**이라 완전히 다른 것이고,
# 기획자와 `visualEffect`로 부르기로 했다 (2026-08-13). 엑셀 시트 이름만
# 「오라매핑」으로 남아 있다.
#
# 두 갈래 — 파일명이 갈래를 말한다
# --------------------------------
# | 갈래 | 파일 | 성격 |
# |---|---|---|
# | 숫자 `1`~`23` | 258² (`6`·`9`·`23`만 ~312²) | **지속형.** 효과가 남아 있는 동안 캐릭터 뒤에 깔린다 |
# | 알파벳 `A`~`G` | 550² = 2×2 | **일회성.** 좌상→우상→우하→좌하 4프레임 애니메이션 |
#
# 키가 갈래마다 다르다 ★
# ----------------------
# - **지속형은 `status`가 키다.** 「지금 이 유닛에 무엇이 걸려 있나」를 매 프레임 다시 묻는다.
#   기술 단위로 잡으면 「증폭」과 「일당백」이 같은 크리티컬인데 다른 그림이 되어 버린다.
# - **일회성은 `기술·책략 id`가 키다.** 즉시 정산이라 유닛에 흔적이 남지 않고,
#   `multiplyMaxHp`(세한지송백)처럼 **이벤트조차 내지 않는** 것도 있어서 상태로는 잡을 수 없다.
#
# 셋만 데이터로 안 접힌다 (아래 COMBO/EXCLUSIVE/TERRAIN)
STATUS_FX_BY_STATUS = {
    "critical100": "4",
    "incomingDamageHalf": "1",
    "untargetable": "3",
    "illusionImmune": "21",
    "illusionAlways": "8",
    "freeMove": "5",
    "counterattack": "16",
    "zeroMpCost": "20",
    "attackStacking": "15",
    "instantKillNext": "11",
    "outgoingDamageHalf": "9",
    "silence": "22",
    "dot": "2",
    "mustTarget": "18",
    "convertOnHit": "14",        # 유비 자신 — 표식을 쌓는 중
    "convertProgress": "13",     # 맞은 적 — 아직 1~2회
    "revivePending": "7",
    "deathCurse": "7",
    # 오라를 **켠 쪽**의 표식. 영향받는 쪽은 아래 BY_AURA 가 맡는다
    "auraIncomingHalf": "1",
    "auraOutgoingHalf": "10",
}

# 전용 그림이 없는 상태. **비었다고 화면에서 사라지지는 않는다** — 둘 다 같은 스킬의
# 다른 상태가 그림을 띄운다(고육지책 → `1`, 백보천양 → `4`). 나중에 그림이 생기면 위로 옮긴다.
STATUS_FX_NONE = {"damageRedirect", "attackAnywhere"}

# 오라에 **영향받는 쪽**. 이 유닛에는 상태가 없고 `aurasOn()`으로만 알 수 있다 (GDD §12 A1).
# 허저는 반경 안 아군에게 자신과 같은 `1`, 여포는 반경 안 적에게 「공포」와 같은 `9`.
STATUS_FX_BY_AURA = {
    "auraIncomingHalf": "1",
    "auraOutgoingHalf": "9",
}

# 조종 — `unit.control`은 상태 배열이 아니라 별도 필드라 빠뜨리기 딱 좋다.
# 유비 「삼고초려」가 3회를 채워 얻는 영구 조종도 `moveAndAttack`이라 여기로 온다.
STATUS_FX_BY_CONTROL = {"moveOnly": "23", "moveAndAttack": "6"}

# 지형 위에 선 유닛. 손권 「수성지주」가 만든 성지(holy)에 누가 올라서면 켜진다.
# 화계(fire)·수계(water)는 **칸 자체**를 칠할 그림을 기획자가 따로 만들기로 했다 (2026-08-13).
STATUS_FX_BY_TERRAIN = {"holy": "17"}

# `wtModifiers`가 남아 있는 동안 (서황 「병귀신속」 3턴 · B급 「신속」 1턴).
# 책략 「선공」은 `turns`가 없어 즉시 1회라 여기에 걸리지 않는다 — 화면이 「다음 차례를
# 받을 때까지」 따로 물고 있는다 (2026-08-13 기획자 확정, `visualEffect.ts` 참조).
STATUS_FX_WT_MODIFIER = "19"

# 한 장수가 한 스킬로 상태 **둘**을 동시에 얻어 전용 그림이 따로 있는 경우.
# 조운 「간뇌도지」뿐이다 — 반감(1)과 크리티컬(4)이 같이 걸린다.
STATUS_FX_COMBO = [
    {"officer": "조운", "requires": ["incomingDamageHalf", "critical100"], "vfx": "12"},
]

# 둘이 같이 뜨면 안 되고 **차례로** 떠야 하는 경우. 여포뿐이다 —
# 「인중여포 마중적토」는 `freeMove(charges 1)` + `auraOutgoingHalf(반경 2)`라
# 자유 이동을 쓰기 전에는 감녕과 같은 `5`, 쓰고 나면 자기 표식 `10`이다 (2026-08-13 기획자 지정).
STATUS_FX_EXCLUSIVE = [
    {"officer": "여포", "prefer": "5", "over": "10"},
]

# 일회성 — 기술·책략 id 가 키다. 값은 알파벳 파일명.
STATUS_FX_ONESHOT_SKILL = {
    "지곤상증": "A", "한천감우": "A",
    "장료지제": "B",
    "세한지송백": "C",
    "십면매복": "D", "장판하뢰": "D",
    "차동풍": "E",
    "신재조영 심재촉": "F",
    "부저추신": "G",
}
STATUS_FX_ONESHOT_TACTIC = {
    "회복": "A", "대회복": "A",
    "함정": "D", "경직": "D",
}


def build_visual_effects(skills: list[dict], tactics: list[dict],
                         by_name: dict[str, dict]) -> dict:
    """
    시각 효과 매핑을 굳혀 `visualEffects.json`으로 내보낸다.

    이름을 id 로 바꾸는 것이 이 함수의 일이다 — 위 표는 사람이 읽고 고치라고
    한글 이름으로 적혀 있지만, 화면이 쓰는 것은 id 다. 이름이 바뀌면 여기서 걸린다.
    """
    skill_id = {s["name"]: s["id"] for s in skills}
    tactic_id = {t["name"]: t["id"] for t in tactics}

    def ids(table: dict[str, str], lookup: dict[str, str], what: str) -> dict[str, str]:
        out = {}
        for name, vfx in table.items():
            if name not in lookup:
                fail(f"[시각효과] {what} '{name}' 이 데이터에 없다 — 이름이 바뀌었나?")
                continue
            out[lookup[name]] = vfx
        return out

    combo = []
    for entry in STATUS_FX_COMBO:
        officer = by_name.get(entry["officer"])
        if officer is None:
            fail(f"[시각효과] 장수 '{entry['officer']}' 이 없다")
            continue
        combo.append({"officer": officer["id"], "requires": entry["requires"], "vfx": entry["vfx"]})

    exclusive = []
    for entry in STATUS_FX_EXCLUSIVE:
        officer = by_name.get(entry["officer"])
        if officer is None:
            fail(f"[시각효과] 장수 '{entry['officer']}' 이 없다")
            continue
        exclusive.append({"officer": officer["id"], "prefer": entry["prefer"], "over": entry["over"]})

    # 「선공」처럼 **즉시 차례를 당기고 흔적을 남기지 않는** 것들.
    #
    # `modifyWt`에 `turns`가 있으면 `wtModifiers`에 남아 링을 걸 자리가 있지만
    # (병귀신속 3턴 · 신속 1턴), 없으면 그 자리에서 WT만 줄고 끝난다.
    # 효과(「다음 차례가 당겨졌다」)는 그 차례가 올 때까지 유효하므로 화면이
    # 따로 물고 있는다 (2026-08-13 기획자 확정, `visualEffect.ts`의 `PendingRings`).
    #
    # **여기서 뽑는 이유** — 나중에 「선공」에 `turns`가 붙으면 이 목록에서 저절로
    # 빠진다. 화면에 id를 적어 두면 그때 조용히 어긋난다.
    def hastens(item: dict) -> bool:
        return any(e.get("t") == "modifyWt" and e.get("delta", 0) < 0 and "turns" not in e
                   for e in item.get("effects") or [])

    return {
        "persistent": {
            "byStatus": STATUS_FX_BY_STATUS,
            "byAura": STATUS_FX_BY_AURA,
            "byControl": STATUS_FX_BY_CONTROL,
            "byTerrain": STATUS_FX_BY_TERRAIN,
            "wtModifier": STATUS_FX_WT_MODIFIER,
            "noVfx": sorted(STATUS_FX_NONE),
            "combo": combo,
            "exclusive": exclusive,
            "hastenWt": {
                "skills": sorted(s["id"] for s in skills if hastens(s)),
                "tactics": sorted(t["id"] for t in tactics if hastens(t)),
            },
        },
        "oneShot": {
            "bySkill": ids(STATUS_FX_ONESHOT_SKILL, skill_id, "고유기술"),
            "byTactic": ids(STATUS_FX_ONESHOT_TACTIC, tactic_id, "책략"),
        },
    }


def check_status_fx(vfx: dict, skills: list[dict], tactics: list[dict],
                    by_name: dict[str, dict], wb: Workbook) -> None:
    """
    `assets/SpecialStatus/` 30장을 위 표 · 엑셀 「오라매핑」 시트와 대조한다 (2026-08-13 추가).

    세 가지를 본다.

    1. **표가 가리키는 그림이 실제로 있는가** — 없으면 그 상태만 조용히 안 그려진다.
    2. **쓰이지 않는 그림이 있는가** — 처음 대조했을 때 `14.png`가 그랬다.
       기획자가 유비 「삼고초려」의 시전자 표식이라고 알려 주어 메웠다.
    3. **새로 생긴 기술·책략이 시트에서 빠졌는가** — 엑셀에 내용이 늘면 여기서 걸린다.

    시트와 위 표를 **한 값씩 맞대어 보지는 않는다.** 시트는 기술 단위이고 표는 상태
    단위라 1:1이 아니다 — 삼고초려 하나가 `14`→`13`→`6` 세 단계로 흐르고, 여포는
    자기 표식과 반경 안 적의 그림이 다르다. 억지로 맞추면 규칙이 표가 아니라 대조
    코드에 숨게 된다.

    폴더가 없으면(에셋은 리포에 없다) 초상화·연출과 같이 조용히 건너뛴다.
    """
    used = set(vfx["persistent"]["byStatus"].values())
    used |= set(vfx["persistent"]["byAura"].values())
    used |= set(vfx["persistent"]["byControl"].values())
    used |= set(vfx["persistent"]["byTerrain"].values())
    used.add(vfx["persistent"]["wtModifier"])
    used |= {c["vfx"] for c in vfx["persistent"]["combo"]}
    used |= set(vfx["oneShot"]["bySkill"].values())
    used |= set(vfx["oneShot"]["byTactic"].values())

    # ── 시트 대조 — 새 기술·책략이 빠졌는지만 본다 ──────────────────
    if "오라매핑" in wb.sheets:
        listed: set[str] = set()
        for row in wb.rows("오라매핑"):
            if len(row) > 2 and row[2]:
                # 「화계/진화」처럼 한 칸에 둘이 붙어 있다
                listed |= {p.strip() for p in row[2].split("/") if p.strip()}
        squash = lambda s: s.replace(" ", "")                   # noqa: E731
        squashed = {squash(n) for n in listed}
        for s in skills:
            if squash(s["name"]) not in squashed:
                fail(f"[시각효과] 「{s['name']}」 이 엑셀 「오라매핑」 시트에 없다")
        for t in tactics:
            if t["name"] not in listed:
                fail(f"[시각효과] 책략 「{t['name']}」 이 엑셀 「오라매핑」 시트에 없다")
        # 지형계 4종은 칸을 칠하는 쪽이라 유닛 그림이 없다 (2026-08-13 기획자 확정)
        note("[시각효과] 「오라매핑」 시트 대조 — 고유기술 "
             f"{len(skills)}종 · 책략 {len(tactics)}종 전부 등재")
    else:
        note("[시각효과] 엑셀에 「오라매핑」 시트가 없어 대조를 건너뛴다")

    # ── 그림 대조 ────────────────────────────────────────────────
    if not STATUS_FX.is_dir():
        note(f"[시각효과] {STATUS_FX} 를 찾을 수 없어 그림 대조를 건너뛴다")
        return
    have = {unicodedata.normalize("NFC", p.stem) for p in STATUS_FX.glob("*.png")}
    if not have:
        note(f"[시각효과] {STATUS_FX} 가 비어 있어 그림 대조를 건너뛴다")
        return

    for missing in sorted(used - have):
        fail(f"[시각효과] '{missing}.png' 가 없다 — 표가 가리키는 그림이 빠졌다")
    for orphan in sorted(have - used, key=lambda x: (not x.isdigit(), x)):
        fail(f"[시각효과] '{orphan}.png' 를 아무도 쓰지 않는다 — 매핑이 빠졌나?")
    note(f"[시각효과] 그림 {len(have)}장 / 표가 쓰는 것 {len(used)}종 — "
         + ("어긋남 없음" if used == have else "위 안내 참조"))


def build_tactics() -> list[dict]:
    out = []
    for level, school, name, mp, text in TACTICS:
        effects = TACTIC_EFFECTS.get(name)
        if not effects:
            fail(f"[책략] '{name}'의 Effect DSL이 비어 있다")
        out.append({
            "id": romanize(name),
            "name": name,
            "school": school,
            "level": level,
            "mpCost": mp,
            "text": to_days(text),                # PPT 원문의 "time 200 동안" → "2일 동안"
            "requiresResistCheck": school == "illusion",
            "effects": effects or [],
        })
    for orphan in sorted(set(TACTIC_EFFECTS) - {t[2] for t in TACTICS}):
        fail(f"[책략] TACTIC_EFFECTS의 '{orphan}'에 대응하는 책략이 없다")
    return out


# ────────────────────────────────────────────────────────────────
# main
# ────────────────────────────────────────────────────────────────

def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")

    if not XLSX.exists():
        print(f"원본을 찾을 수 없다: {XLSX}", file=sys.stderr)
        return 1

    wb = Workbook(XLSX)

    officers = extract_officers(wb)
    by_name = {o["name"]: o for o in officers}
    attach_bios(officers)

    # id 충돌 검사
    id_counts = Counter(o["id"] for o in officers)
    for oid, n in id_counts.items():
        if n > 1:
            fail(f"[id] 슬러그 충돌 '{oid}' ×{n}: "
                 f"{[o['name'] for o in officers if o['id'] == oid]}")

    skills = extract_skills(wb, by_name)
    attach_skill_lore(skills)
    pieces = build_pieces()
    tactics = build_tactics()
    attach_tactic_lore(tactics)
    growth = extract_growth(wb)
    city = extract_city(wb)
    team_scores = extract_team_scores(wb)

    # ── 이미지 대조 ──────────────────────────────────────────────
    images = {p.stem for p in CHARS.glob("*.png")} if CHARS.is_dir() else set()
    names = set(by_name)
    if not images:
        note(f"[이미지] {CHARS} 를 찾을 수 없어 대조를 건너뛴다")
    else:
        for missing in sorted(names - images):
            fail(f"[이미지] '{missing}' 의 초상화가 없다")
        for orphan in sorted(images - names):
            fail(f"[이미지] '{orphan}.png' 에 대응하는 장수가 없다")

    check_skill_art(skills, by_name)

    visual_effects = build_visual_effects(skills, tactics, by_name)
    check_status_fx(visual_effects, skills, tactics, by_name, wb)

    # ── 스킬 보유 대상 검증 ──────────────────────────────────────
    should_have = {o["name"] for o in officers if o["grade"] in SP_COST}
    does_have = {o["name"] for o in officers if o["uniqueSkill"]}
    for n in sorted(should_have - does_have):
        fail(f"[스킬] '{n}' ({by_name[n]['grade']}급) 에 고유기술이 없다")
    for n in sorted(does_have - should_have):
        fail(f"[스킬] '{n}' ({by_name[n]['grade']}급) 은 고유기술을 가질 수 없다")

    # ── 설명문 시간 표기 검증 ────────────────────────────────────
    # 화면에 나가는 설명에 엔진 단위 `time`이 새면 안 된다. 엑셀에 새 스킬이
    # 추가되면서 `to_days()`가 못 잡는 표기가 들어오는 것을 여기서 막는다.
    converted = 0
    for item in [*skills, *tactics]:
        leftover = _TIME_RE.search(item["text"]) or "waiting time" in item["text"]
        if leftover:
            fail(f"[설명] '{item['name']}' 의 설명에 엔진 표기가 남아 있다: {item['text']}")
        elif re.search(r"\d+(\.\d+)?일", item["text"]):
            converted += 1
    note(f"[설명] 시간·WT 표기를 일(日) 단위로 변환 — {converted}건 (time 100 = WT 100 = 1일)")

    # ── 출력 ────────────────────────────────────────────────────
    OUT.mkdir(parents=True, exist_ok=True)
    grade_dist = Counter(o["grade"] for o in officers)

    report = {
        "generatedFrom": XLSX.name,
        "counts": {
            "officers": len(officers),
            "uniqueSkills": len(skills),
            "pieces": len(pieces),
            "tactics": len(tactics),
            "cityLevels": len(city),
            "portraits": len(images),
        },
        "gradeDistribution": dict(sorted(grade_dist.items())),
        "skillsByTier": dict(sorted(Counter(s["tier"] for s in skills).items())),
        "normalization": {
            "nameFixes": NAME_FIXES,
            "factionFixes": FACTION_FIXES,
        },
        "notes": notes,
        "problems": problems,
        "ok": not problems,
    }

    files = {
        "officers.json": officers,
        "uniqueSkills.json": skills,
        "pieces.json": pieces,
        "tactics.json": tactics,
        "visualEffects.json": visual_effects,
        "growth.json": growth,
        "city.json": city,
        "teamScores.json": team_scores,
        "economy.json": ECONOMY,
        "build-report.json": report,
    }
    for filename, payload in files.items():
        (OUT / filename).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    # ── 요약 ────────────────────────────────────────────────────
    print(f"출력 → {OUT}")
    print(f"  장수 {len(officers)}  고유기술 {len(skills)}  기물 {len(pieces)}  "
          f"책략 {len(tactics)}  도시 {len(city)}레벨")
    print(f"  등급 분포 {dict(sorted(grade_dist.items()))}")
    print(f"  티어별 스킬 {dict(sorted(Counter(s['tier'] for s in skills).items()))}")
    for s in skills:
        if len(s["holders"]) > 1:
            print(f"    [{s['tier']}] {s['name']} ×{len(s['holders'])}")

    if notes:
        print("\n참고:")
        for m in notes:
            print(f"  · {m}")

    if problems:
        print(f"\n검증 실패 {len(problems)}건:", file=sys.stderr)
        for m in problems:
            print(f"  ✗ {m}", file=sys.stderr)
        return 1

    print("\n검증 통과 — 문제 없음")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
