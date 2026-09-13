# -*- coding: utf-8 -*-
"""Build words.5a.json from 5上单词单.txt.

The source file uses lesson headings such as "### 1-1" and phrase sections
headed by "#### 重点短语：". Word lesson levels keep their lesson labels
("1-1", "1-2", ...). Key phrases become separate unit levels
("1-短语", "2-短语", ...).
"""
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "5上单词单.txt"
OUTPUT = ROOT / "words.5a.json"

LESSON_RE = re.compile(r"^#{2,6}\s*([0-9]+)-([0-9]+)\s*$")
PHRASE_HEADING_RE = re.compile(r"^#{2,6}\s*.*短语")
WORD_WITH_PARENS_RE = re.compile(
    r"^([A-Za-z][A-Za-z0-9 .,'’!?/-]*?)\s*\(([^)]*)\)\s*(.*)$"
)
EN_ZH_RE = re.compile(r"^([A-Za-z][A-Za-z0-9 .,'’!?/-]*?)\s+([\u3400-\u9fff].*)$")
POS_RE = re.compile(r"^([a-z]+\.|prep\.|pron\.|conj\.|adv\.|adj\.|v\.|n\.)\s*(.+)$", re.I)


def normalize_text(text):
    return (
        text.replace("\u3000", " ")
        .replace("（", "(")
        .replace("）", ")")
        .replace("，", ",")
        .strip()
    )


def parse_word_line(line, kind):
    line = normalize_text(line)
    match = WORD_WITH_PARENS_RE.match(line)
    if match:
        en = re.sub(r"\s+", " ", match.group(1)).strip()
        inner = match.group(2).strip()
        trailing = match.group(3).strip()
        pos_match = POS_RE.match(inner)
        if pos_match:
            pos = pos_match.group(1)
            zh = pos_match.group(2).strip()
            if trailing:
                zh = f"{zh} {trailing}"
        else:
            pos = ""
            zh = trailing if trailing else inner
            if trailing and inner:
                zh = f"{zh}（{inner}）"
        return {"en": en, "zh": zh, "pos": pos, "kind": kind}

    match = EN_ZH_RE.match(line)
    if match:
        en = re.sub(r"\s+", " ", match.group(1)).strip()
        zh = match.group(2).strip()
        return {"en": en, "zh": zh, "pos": "", "kind": kind}

    return None


def parse():
    if not SOURCE.exists():
        raise SystemExit("Missing source file: 5a word list txt.")
    text = normalize_text(SOURCE.read_text(encoding="utf-8-sig"))
    if not text:
        raise SystemExit("Source file is empty; paste the five-grade-a word list first.")

    levels = []
    phrase_levels = {}
    current_level = None
    current_unit = None
    in_phrase_section = False

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line == "---":
            continue

        lesson_match = LESSON_RE.match(line)
        if lesson_match:
            unit, lesson = lesson_match.groups()
            current_unit = unit
            current_level = {"label": f"{unit}-{lesson}", "items": []}
            levels.append(current_level)
            in_phrase_section = False
            continue

        if PHRASE_HEADING_RE.match(line):
            if not current_unit:
                continue
            current_level = phrase_levels.setdefault(
                current_unit,
                {"label": f"{current_unit}-短语", "items": []},
            )
            in_phrase_section = True
            continue

        if line.startswith("#"):
            continue

        if current_level is None:
            continue

        entry = parse_word_line(line, "phrase" if in_phrase_section else "word")
        if entry:
            current_level["items"].append(entry)

    ordered_levels = []
    phrase_by_unit = phrase_levels
    for level in levels:
        ordered_levels.append(level)
        unit = level["label"].split("-", 1)[0]
        is_last_lesson_in_unit = not any(
            other["label"].startswith(f"{unit}-")
            for other in levels[levels.index(level) + 1 :]
        )
        if is_last_lesson_in_unit and unit in phrase_by_unit:
            ordered_levels.append(phrase_by_unit[unit])

    items = []
    labels = []
    for day, level in enumerate(ordered_levels, start=1):
        if not level["items"]:
            continue
        labels.append(level["label"])
        for entry in level["items"]:
            items.append({"day": len(labels), **entry})

    if not items:
        raise SystemExit("No word entries parsed; check the source format.")
    return items, labels


def main():
    items, labels = parse()
    OUTPUT.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    words = sum(1 for item in items if item["kind"] == "word")
    phrases = sum(1 for item in items if item["kind"] == "phrase")
    print(f"Wrote {OUTPUT.name}: {len(items)} items ({words} words, {phrases} phrases)")
    print("dayLabels =", json.dumps(labels, ensure_ascii=False))


if __name__ == "__main__":
    main()
