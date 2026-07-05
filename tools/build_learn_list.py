#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""根据「小学词汇通」导出的标记，生成"需要记的词表"（words.json 格式）。

工作流：
  1. 孩子在网页「小学词汇通」里斩词，点右上角「导出标记」，得到
     vocab_counts_YYYY-MM-DD.json（里面是每个词的掌握计数）。
  2. 家长本地运行本脚本，把该标记文件 + wordlist.txt 合成下一步的词库。

判定：计数 >= master-goal（默认 5）的词视为"已掌握/简单词"，剔除；
其余（含从未答对的）就是"需要记的词"，按每 per-day 个切成 day 分组，
输出成现有游戏用的 words.json 结构：{day, en, zh, pos, kind}。

用法示例：
  python tools/build_learn_list.py vocab_counts_2026-07-05.json
  python tools/build_learn_list.py marks.json --wordlist wordlist.txt \
      --per-day 15 --master-goal 5 --output words.learn.json
  # 反向导出已掌握的简单词：
  python tools/build_learn_list.py marks.json --keep mastered -o words.simple.json
"""

import argparse
import json
import os
import sys


def parse_wordlist(path):
    """解析 wordlist.txt（每行 en|zh），返回有序去重的 [(en, zh)]。"""
    words = []
    seen = set()
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            raw = line.strip()
            if not raw or raw.startswith("#") or "|" not in raw:
                continue
            en, zh = raw.split("|", 1)
            en, zh = en.strip(), zh.strip()
            if not en or not zh:
                continue
            key = en.lower()
            if key in seen:
                continue
            seen.add(key)
            words.append((en, zh))
    return words


def load_counts(path):
    """读取导出的标记文件，返回 {en_lower: count}。兼容两种结构：
    1) 网页导出的 {version, counts: {...}, ...}
    2) 直接就是 {en: count} 的扁平字典。
    """
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    counts = data.get("counts", data) if isinstance(data, dict) else {}
    return {str(k).lower().strip(): int(v or 0) for k, v in counts.items()}


def to_item(en, zh, day):
    return {
        "day": day,
        "en": en,
        "zh": zh,
        "pos": "",  # wordlist.txt 无词性数据
        "kind": "phrase" if " " in en.strip() else "word",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="从斩词标记生成需记词表（words.json 格式）"
    )
    parser.add_argument("counts", help="网页导出的标记 JSON 文件")
    parser.add_argument(
        "--wordlist", default="wordlist.txt", help="词源（默认 wordlist.txt）"
    )
    parser.add_argument(
        "--output", "-o", default="words.learn.json", help="输出文件"
    )
    parser.add_argument(
        "--master-goal",
        type=int,
        default=5,
        help="计数 >= 该值视为已掌握（默认 5）",
    )
    parser.add_argument(
        "--per-day", type=int, default=15, help="每个 day 分组的单词数（默认 15）"
    )
    parser.add_argument(
        "--keep",
        choices=["learn", "mastered"],
        default="learn",
        help="learn=保留需记的词（默认）；mastered=保留已掌握的简单词",
    )
    args = parser.parse_args(argv)

    for path in (args.wordlist, args.counts):
        if not os.path.exists(path):
            parser.error(f"找不到文件：{path}")

    words = parse_wordlist(args.wordlist)
    counts = load_counts(args.counts)

    if args.keep == "mastered":
        picked = [
            (en, zh)
            for en, zh in words
            if counts.get(en.lower(), 0) >= args.master_goal
        ]
    else:
        picked = [
            (en, zh)
            for en, zh in words
            if counts.get(en.lower(), 0) < args.master_goal
        ]

    items = []
    for i, (en, zh) in enumerate(picked):
        day = i // max(1, args.per_day) + 1
        items.append(to_item(en, zh, day))

    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(items, fh, ensure_ascii=False, indent=2)

    total = len(words)
    kept = len(items)
    days = (kept + args.per_day - 1) // args.per_day if kept else 0
    label = "需记" if args.keep == "learn" else "已掌握"
    print(f"词源共 {total} 词，标记文件覆盖 {len(counts)} 词。")
    print(
        f"按 keep={args.keep} 筛出「{label}」{kept} 词，"
        f"分成 {days} 个 day（每组 {args.per_day}）。"
    )
    print(f"已写出：{args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
