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
OUT = ROOT / "packages" / "data" / "generated"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

# ────────────────────────────────────────────────────────────────
# 정규화 규칙 (GDD §9) — 표준은 Chars/ 폴더 파일명
# ────────────────────────────────────────────────────────────────

NAME_FIXES = {
    "관훙": "관흥",
    "이각": "이곽",
    "장노": "장로",
    # 張遼의 바른 독음은 '장료'다. 엑셀 장수 시트와 초상화가 '장요'였는데
    # 2026-08-04에 **장료로 통일**하기로 확정했다 (초상화 파일명도 함께 바꿨다).
    # 스킬 시트는 원래부터 '장료'라 이제 양쪽이 같다 — 스킬명 「장료지제」와도 맞는다.
    "장요": "장료",
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
    (6, "support",  "화계",   2, "1×1 영역에 time 100마다 HP 1씩 감소하는 지형 생성"),
    (6, "support",  "진화",   1, "화계 지형 제거"),
    (7, "support",  "수계",   3, "1×1 영역에 유닛이 위치할 수 없는 지형 생성"),
    (7, "support",  "매립",   1, "수계 지형 제거"),
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
#   · 화계는 유닛이 선 칸에도 깔 수 있고, 수계는 빈 칸에만 깐다 (갇힘 방지)
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
    "화계":   [{"t": "createTerrain", "target": {"kind": "tile"}, "terrain": "fire"}],
    "진화":   [{"t": "removeTerrain", "target": {"kind": "tile"}, "terrain": "fire"}],
    "수계":   [{"t": "createTerrain", "target": {"kind": "tile", "filter": "empty"}, "terrain": "water"}],
    "매립":   [{"t": "removeTerrain", "target": {"kind": "tile"}, "terrain": "water"}],
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
    "십면매복": [{"t": "modifyWt", "target": {"kind": "enemyOne", "anywhere": True}, "delta": 50}],
    "일격필살": [{"t": "applyStatus", "target": {"kind": "self"},
                  "status": "critical100", "duration": 90}],
    "신속":     [{"t": "modifyWt", "target": {"kind": "self"}, "delta": -30, "turns": 1}],

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
    "장판하뢰":   [{"t": "modifyWt", "target": {"kind": "allEnemies"}, "delta": 110}],
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
                    "magnitude": 1, "period": 200, "cleansable": False}],

    # 지형
    "수성지주":   [{"t": "createTerrain", "target": {"kind": "tile"}, "terrain": "holy"}],

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
    "단치도강":   [{"t": "applyStatus", "target": {"kind": "self"},
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
    "cardPacks": [
        {"gold": 10, "cards": 1},
        {"gold": 20, "cards": 3},
        {"gold": 30, "cards": 5},
    ],
    "gachaGrades": ["S", "A", "B", "C"],
    "gachaRates": None,   # TODO: 확률형 아이템 공시 의무 대상 — 확정 필요
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
                "text": row["text"],
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
    c = wb.cells("게임 환경")
    level_up = []
    for row in range(22, 30):                      # G22:J29
        level_up.append({
            "level": int(c[f"G{row}"]),
            "cardsRequired": int(c[f"H{row}"]),
            "successRate": float(c[f"J{row}"]),
        })
    if [x["level"] for x in level_up] != list(range(2, 10)):
        fail("[성장] 레벨업 테이블이 2~9가 아니다")
    return {
        "base": {"hp": 10, "mp": 5, "at": 2},          # GDD §4.2 (PPT 출처)
        "statChoices": [{"hp": 5}, {"mp": 2}, {"at": 1}],
        "maxLevel": 9,
        "levelUp": level_up,
    }


def extract_city(wb: Workbook) -> list[dict]:
    c = wb.cells("게임 환경")
    out = []
    for row in range(34, 43):                      # B34:F42
        out.append({
            "level": int(c[f"C{row}"]),
            "materialsToUpgrade": int(c[f"B{row}"]) if f"B{row}" in c else None,
            "grainPerHour": int(c[f"D{row}"]),
            "grainCap": int(c[f"E{row}"]),
            "characterPool": int(c[f"F{row}"]),
        })
    if [x["level"] for x in out] != list(range(1, 10)):
        fail("[도시] 레벨 테이블이 1~9가 아니다")
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
            "text": text,
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

    # id 충돌 검사
    id_counts = Counter(o["id"] for o in officers)
    for oid, n in id_counts.items():
        if n > 1:
            fail(f"[id] 슬러그 충돌 '{oid}' ×{n}: "
                 f"{[o['name'] for o in officers if o['id'] == oid]}")

    skills = extract_skills(wb, by_name)
    pieces = build_pieces()
    tactics = build_tactics()
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

    # ── 스킬 보유 대상 검증 ──────────────────────────────────────
    should_have = {o["name"] for o in officers if o["grade"] in SP_COST}
    does_have = {o["name"] for o in officers if o["uniqueSkill"]}
    for n in sorted(should_have - does_have):
        fail(f"[스킬] '{n}' ({by_name[n]['grade']}급) 에 고유기술이 없다")
    for n in sorted(does_have - should_have):
        fail(f"[스킬] '{n}' ({by_name[n]['grade']}급) 은 고유기술을 가질 수 없다")

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
