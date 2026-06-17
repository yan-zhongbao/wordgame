# -*- coding: utf-8 -*-
"""Build words.4b.json (四年级下册) from the textbook word list.

Each numbered lesson (e.g. 1-1) becomes a "day" containing its words.
Each unit's key phrases are distributed round-robin across that unit's
lesson-days so every day still has plain words (needed by word-search).
"""
import json
from pathlib import Path

# (pos, en, zh) for each lesson, grouped by unit.
UNITS = [
    {
        "lessons": [
            [("n.", "doctor", "医生"), ("n.", "fireman", "消防员"), ("n.", "farmer", "农民"),
             ("n.", "cook", "厨师"), ("n.", "police", "警察"), ("n.", "fire", "火")],
            [("n.", "field", "田野，田地"), ("v.", "use", "使用"), ("n.", "brush", "刷子"),
             ("n.", "writer", "作家"), ("n.", "worker", "工人"), ("n.", "aunt", "阿姨")],
            [("n.", "uncle", "叔叔"), ("n.", "night", "夜晚"), ("n.", "driver", "司机"),
             ("n.", "taxi", "出租车"), ("adj.", "safe", "安全的"), ("n.", "nurse", "护士")],
            [("v.", "bake", "烘，烤"), ("n.", "postman", "邮递员"), ("adj.", "poor", "贫穷的"),
             ("v.", "bring", "带来，拿来"), ("n.", "letter", "信"), ("v.", "brighten", "使更明亮")],
        ],
        "phrases": [
            ("police station", "警察局"), ("fire station", "消防站"), ("work in", "在……工作"),
            ("night owl", "夜猫子，喜欢熬夜的人"), ("work at night", "在夜间工作"),
            ("keep safe", "保障安全"), ("take people home", "送人们回家"),
            ("cook food", "烹饪食物"), ("police officer", "警察"),
        ],
    },
    {
        "lessons": [
            [("v.", "laugh", "大笑"), ("adj.", "sad", "伤心的"), ("v.", "cry", "哭"),
             ("adj.", "angry", "生气的"), ("v.", "frown", "皱眉"), ("adj.", "scared", "恐惧的，害怕的")],
            [("v.", "shake", "发抖"), ("adj.", "excited", "兴奋的"), ("adj.", "next", "接下来的，下一个的"),
             ("v.", "cough", "咳"), ("adj.", "better", "好转的"), ("n.", "gift", "礼物")],
            [("adj.", "surprised", "吃惊的"), ("v.", "practice", "练习"), ("v.", "should", "应该（情态动词）"),
             ("v.", "break", "使…破裂"), ("adj.", "huge", "巨大的")],
            [("adj.", "worried", "担心的，焦虑的"), ("v.", "worry", "担心，担忧"), ("n.", "street", "街道"),
             ("v.", "hit", "撞击"), ("v.", "feel", "感觉，感到"), ("n.", "opera", "戏剧")],
        ],
        "phrases": [
            ("take part in", "参加"), ("next time", "下一次"), ("make a ship", "制作船"),
            ("ship model", "船模"), ("shout at", "对…大喊大叫"), ("walk on the street", "在街上走"),
        ],
    },
    {
        "lessons": [
            [("n.", "talent", "天资，天赋"), ("v.", "act", "扮演，演出"), ("n.", "magic", "魔术，戏法"),
             ("v.", "shine", "表现突出，出众"), ("n.", "puzzle", "拼图游戏"), ("n.", "dancer", "舞蹈演员")],
            [("v.", "win", "获胜，赢"), ("adv.", "just", "就，只是"), ("n.", "duck", "鸭子"),
             ("n.", "boy", "男孩，儿子"), ("pron.", "anything", "任何事情，无论何事"),
             ("adj.", "enough", "足够的"), ("adv.", "slowly", "缓慢地，慢慢地")],
        ],
        "phrases": [
            ("do puzzles", "玩拼图"), ("play the piano", "弹钢琴"), ("be good at", "擅长……"),
            ("take photos", "拍照"), ("do magic", "变魔术"), ("dance show", "舞蹈表演"),
            ("win the show", "赢得比赛"), ("teach sb to do sth", "教某人做某事"),
            ("make sb shine", "让某人脱颖而出"), ("wear beautiful clothes", "穿漂亮的衣服"),
            ("fly well", "飞得好"), ("run fast", "跑得快"), ("swim well", "游得好"),
            ("sing loudly", "大声唱歌"),
        ],
    },
    {
        "lessons": [
            [("n.", "life", "一生，生活"), ("n.", "seed", "种子，粒"), ("n.", "earth", "泥土，土壤"),
             ("n.", "root", "根"), ("n.", "stem", "植物的茎、梗、柄"), ("adj.", "thin", "细的")],
            [("n.", "leaf", "叶，叶子"), ("v.", "dig", "挖、掘"), ("n.", "sunflower", "向日葵"),
             ("n.", "wheat", "小麦"), ("n.", "cotton", "棉花，棉株"), ("v.", "sleep", "睡，睡觉")],
            [("n.", "mouse", "老鼠"), ("n.", "grain", "谷粒"), ("v.", "miss", "想念，思念"),
             ("v.", "will", "将，会，要"), ("n.", "everything", "每件事，所有事物"),
             ("n.", "cabbage", "卷心菜，洋白菜，甘蓝"), ("n.", "paper", "纸")],
        ],
        "phrases": [
            ("plant life", "植物生命"), ("parts of a plant", "植物的组成部分"), ("plant seeds", "种种子"),
            ("dig the earth", "挖泥土"), ("water the plants", "给植物浇水"), ("grow up", "长大；生长"),
            ("in the fields", "在田地里"), ("grow rice", "种水稻"), ("grow vegetables", "种蔬菜"),
            ("pick cotton", "摘棉花"), ("look after plants", "照顾植物"),
            ("a sunflower seed", "向日葵种子"), ("wheat plants", "小麦植株"),
            ("plant roots", "植物的根"), ("green leaves", "绿叶"), ("come true", "实现（梦想）"),
        ],
    },
    {
        "lessons": [
            [("n.", "activity", "活动"), ("n.", "drama", "戏剧"), ("n.", "trip", "旅行，出行"),
             ("n.", "fair", "集市，户外游艺会"), ("adj.", "field", "野外的，实地的")],
            [("n.", "festival", "节庆，汇演"), ("n.", "horn", "角"), ("n.", "dot", "点，小圆点"),
             ("n.", "raindrop", "雨点，雨滴"), ("adj.", "more", "更多的")],
            [("adj.", "special", "特殊的，特别的"), ("n.", "keeper", "看守人"), ("n.", "forest", "森林"),
             ("adj.", "lovely", "美好的，令人愉快的"), ("n.", "student", "学生")],
            [("n.", "culture", "文化"), ("n.", "hour", "小时"), ("n.", "note", "笔记，记录"),
             ("n.", "vote", "选票"), ("v.", "design", "设计"), ("n.", "hometown", "家乡")],
        ],
        "phrases": [
            ("Science Day", "科学日"), ("Book Week", "读书周"), ("Drama Night", "戏剧之夜"),
            ("Picnic Day", "野餐日"), ("Music Week", "音乐周"), ("Field Trip", "野外研学"),
            ("the School Fair", "校园集市"), ("Sports Day", "运动会"),
            ("school activities", "校园活动"), ("Art Festival", "艺术节"),
            ("Chinese words", "汉字"), ("Chinese writing", "书法"), ("call for help", "求助"),
            ("forest keeper", "森林管理员"), ("go back home", "回家"), ("culture fair", "文化集市"),
            ("take notes", "做笔记"), ("give the vote", "投票"),
        ],
    },
    {
        "lessons": [
            [("n.", "T-shirt", "T恤衫"), ("n.", "skirt", "半身裙，裙子"), ("n.", "shorts", "短裤"),
             ("n.", "shirt", "衬衫"), ("n.", "trousers", "裤子"), ("n.", "scarf", "围巾"),
             ("n.", "sweater", "毛线衣，针织衫，羊毛衫")],
            [("n.", "dress", "连衣裙"), ("n.", "party", "聚会，宴会"), ("adj.", "favourite", "最喜欢的"),
             ("n.", "dressmaker", "裁缝"), ("adj.", "wrong", "不正确的，错误的"), ("adj.", "clever", "聪明的")],
            [("n.", "whale", "鲸"), ("n.", "Mr", "先生"), ("n.", "uniform", "制服"),
             ("n.", "robe", "长袍"), ("adj.", "safe", "安全的")],
        ],
        "phrases": [
            ("look outside", "看外面"), ("pick your clothes", "挑选衣服"), ("It's time to go", "该出发了"),
            ("look for", "寻找"), ("cut up", "裁剪"), ("have an idea", "有一个主意"),
            ("Don't worry", "别担心"), ("make clothes", "做衣服"), ("every day", "每天"),
            ("birthday gift", "生日礼物"), ("come along and have a look", "过来看看"),
            ("keep safe and cool", "保持安全和凉爽"),
        ],
    },
]


def build():
    items = []
    day = 0
    for unit in UNITS:
        lessons = unit["lessons"]
        # assign each lesson a day number
        lesson_days = []
        for _ in lessons:
            day += 1
            lesson_days.append(day)
        # words
        for di, lesson in zip(lesson_days, lessons):
            for pos, en, zh in lesson:
                items.append({"day": di, "en": en, "zh": zh, "pos": pos, "kind": "word"})
        # distribute phrases round-robin across this unit's lesson-days
        n = len(lesson_days)
        for idx, (en, zh) in enumerate(unit["phrases"]):
            di = lesson_days[idx % n]
            items.append({"day": di, "en": en, "zh": zh, "pos": "", "kind": "phrase"})
    # stable sort by day so each day's items are contiguous (words then phrases)
    items.sort(key=lambda x: x["day"])
    return items, day


def main():
    items, max_day = build()
    out = Path("words.4b.json")
    out.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    words = sum(1 for i in items if i["kind"] == "word")
    phrases = sum(1 for i in items if i["kind"] == "phrase")
    print(f"Wrote {out}: {len(items)} items ({words} words, {phrases} phrases), {max_day} days")


if __name__ == "__main__":
    main()
