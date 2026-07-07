/* 小学词汇通 —— 主界面(hub) 三个入口 + 金币/游戏解锁，进度服务器(PHP)同步。
 *
 *   1) 快速分词(sort)：第1轮，把全部词快速分成「认识/需记」。答对 lv0→1、答错/不
 *      认识→需记(f)。按难度排序（四年级课本词优先、三年级词靠前、短词靠前），已标
 *      记的 300 词自动跳过。
 *   2) 认识词标记(confirm)：第2–5轮，确认「认识」的词不是蒙对的。lv1→…→5，连过
 *      5 轮 = 真正认识；任一轮答错→需记。
 *   3) 单词连连看(match)：左英文右中文连线，优先未认识/需记的词；连对累加 mc，只
 *      影响 sort/confirm 的难度排序。
 *
 * 金币：sort/confirm 每答对 1 词 +1、连线每连对 1 词 +1（只奖对的）。金币≥300 点亮
 * hub 的游戏按钮，进一个游戏扣 300，每个游戏每天只能进一次。
 *
 * 每词状态：{ lv(0..5), f(需记), mc(连线连对次数) }
 * 持久化：优先 PHP(vocab_data.php) 服务器同步，localStorage 作离线镜像/回退。
 * 单独入口：index.html#vocab。
 */
(() => {
  "use strict";

  const ROOT = document.getElementById("vocabView") || document;
  const q = (sel) => ROOT.querySelector(sel);

  const UI = {
    name: q("#vocabName"),
    headerExtra: q("#vocabHeaderExtra"),
    main: q("#vocabMain"),
    back: q("#vocabBack"),
    export: q("#vocabExport"),
  };

  const PAGE_SIZE = 10; // 标记模式每页词数
  const MATCH_SIZE = 6; // 连线每屏对数
  const GOAL = 5; // 连续答对 5 轮 = 真正认识
  const LS_KEY = "wg-vocab-progress"; // 本地镜像键
  const OLD_KEY = "wg-vocab-counts"; // 旧版键，弃用
  const API_URL = "vocab_data.php";
  const WORDLIST_URL = "wordlist.txt";
  const SEED_URL = "vocab_seed.json";
  const CURRICULUM_FILES = ["words.json", "words.4b.json"];

  // 三年级常见词（PEP 核心，仅用于难度排序的优先级，不需精确匹配）。
  const GRADE3 = `hello hi bye goodbye ok yes no sorry thanks thank please
    pen pencil pencil-case ruler eraser crayon book bag sharpener school
    teacher student class desk chair blackboard
    red yellow green blue purple white black orange pink brown colour color
    head face nose mouth eye ear arm hand finger leg foot body hair neck
    cat dog monkey panda rabbit duck pig bird bear elephant mouse squirrel
    cow sheep tiger lion fish snake horse chicken
    cake bread egg milk water juice coffee tea rice hamburger hotdog noodles
    icecream candy apple banana orange pear grape watermelon strawberry
    father dad mother mom mum brother sister grandfather grandpa grandmother
    grandma family friend boy girl man woman uncle aunt baby people
    one two three four five six seven eight nine ten eleven twelve
    ball balloon boat car kite doll toy plane robot box cup gift map bike
    sun tree flower star moon sky rain snow wind
    big small long tall short fine great happy cute nice good bad old new
    hot cold warm cool fat thin
    look see come go jump run walk fly swim sing dance draw read write eat
    drink like have has play make open close listen speak stand sit
    this that it my your his her and how many some here there
    on in under near home mother water how old what where who name
    morning afternoon evening night day today
    monday tuesday wednesday thursday friday saturday sunday
    spring summer autumn fall winter
    happy birthday merry christmas`
    .split(/\s+/)
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);

  let allWords = null; // [{en, zh}]
  let prog = {}; // { key:{lv,f,mc} }
  let curriculumSet = new Set(); // 四年级课本词（lower en）
  const grade3Set = new Set(GRADE3);
  let screen = "hub"; // hub | mark | match
  let serverOk = false; // PHP 是否可用

  // ---- helpers ----
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function keyOf(en) {
    return String(en).toLowerCase().trim();
  }
  function slugify(text) {
    return String(text)
      .toLowerCase()
      .trim()
      .replace(/['’]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  // 发音
  let currentAudio = null;
  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (err) {
      /* ignore */
    }
  }
  function playWord(en) {
    if (!en) return;
    const isPhrase = /\s/.test(en.trim());
    const src = `audio/${isPhrase ? "phrase" : "en"}/${slugify(en)}.mp3`;
    try {
      if (currentAudio) currentAudio.pause();
      currentAudio = new Audio(src);
      currentAudio.play().catch(() => speak(en));
    } catch (err) {
      speak(en);
    }
  }
  function addGlobalCoins(amount) {
    try {
      const k = "wg-td-coins";
      const cur = parseInt(localStorage.getItem(k) || "0", 10) || 0;
      localStorage.setItem(k, String(Math.max(0, cur + amount)));
      if (typeof window.refreshCoins === "function") window.refreshCoins();
    } catch (err) {
      /* ignore */
    }
  }

  // ---- 进度存储（PHP 优先，localStorage 镜像） ----
  function normalizeWords(words) {
    const out = {};
    Object.keys(words || {}).forEach((k) => {
      const r = words[k] || {};
      out[keyOf(k)] = {
        lv: Math.max(0, Math.min(GOAL, parseInt(r.lv, 10) || 0)),
        f: !!r.f,
        mc: Math.max(0, parseInt(r.mc, 10) || 0),
      };
    });
    return out;
  }
  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return normalizeWords(data.words);
    } catch (err) {
      return null;
    }
  }
  function writeLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ v: 2, goal: GOAL, words: prog }));
    } catch (err) {
      /* ignore */
    }
    try {
      localStorage.removeItem(OLD_KEY);
    } catch (err) {
      /* ignore */
    }
  }
  async function serverLoad() {
    try {
      const res = await fetch(API_URL, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      serverOk = true;
      return normalizeWords(data.words);
    } catch (err) {
      serverOk = false;
      return null;
    }
  }
  let saveTimer = null;
  async function serverSave() {
    if (!serverOk) return;
    try {
      await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v: 2, goal: GOAL, words: prog }),
        cache: "no-store",
      });
    } catch (err) {
      serverOk = false;
    }
  }
  // 保存：本地立即写，服务器去抖后台写。
  function save() {
    writeLocal();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(serverSave, 600);
  }

  function progOf(en) {
    return prog[keyOf(en)] || { lv: 0, f: false, mc: 0 };
  }
  function setProg(en, patch) {
    const p = progOf(en);
    prog[keyOf(en)] = {
      lv: patch.lv != null ? Math.max(0, Math.min(GOAL, patch.lv)) : p.lv,
      f: patch.f != null ? !!patch.f : p.f,
      mc: patch.mc != null ? Math.max(0, patch.mc) : p.mc,
    };
    save();
  }

  // ---- 数据加载 ----
  async function loadWords() {
    if (allWords) return allWords;
    const res = await fetch(WORDLIST_URL, { cache: "no-cache" });
    const text = await res.text();
    const seen = new Set();
    const list = [];
    text.split(/\r?\n/).forEach((line) => {
      const raw = line.trim();
      if (!raw || raw.startsWith("#")) return;
      const idx = raw.indexOf("|");
      if (idx < 0) return;
      const en = raw.slice(0, idx).trim();
      const zh = raw.slice(idx + 1).trim();
      if (!en || !zh) return;
      const k = keyOf(en);
      if (seen.has(k)) return;
      seen.add(k);
      list.push({ en, zh });
    });
    allWords = list;
    return allWords;
  }

  async function loadCurriculum() {
    curriculumSet = new Set();
    for (const file of CURRICULUM_FILES) {
      try {
        const res = await fetch(file, { cache: "no-cache" });
        if (!res.ok) continue;
        const arr = await res.json();
        arr.forEach((w) => {
          if (w && w.en) curriculumSet.add(keyOf(w.en));
        });
      } catch (err) {
        /* ignore a missing curriculum file */
      }
    }
  }

  // 首次加载进度：服务器 → 本地 → seed 文件。
  async function loadProgress() {
    let words = await serverLoad();
    if (words && Object.keys(words).length) {
      prog = words;
      writeLocal();
      return;
    }
    words = readLocal();
    if (words && Object.keys(words).length) {
      prog = words;
      return;
    }
    try {
      const res = await fetch(SEED_URL, { cache: "no-cache" });
      if (res.ok) {
        const data = await res.json();
        prog = normalizeWords(data.words);
        save(); // 写回本地/服务器
        return;
      }
    } catch (err) {
      /* ignore */
    }
    prog = {};
  }

  // ---- 难度排序（分数越小越靠前） ----
  function letters(en) {
    return String(en).replace(/[^a-z]/gi, "").length;
  }
  function difficulty(word) {
    const k = keyOf(word.en);
    let tier = 2;
    if (curriculumSet.has(k)) tier = 0; // 四年级课本词优先
    else if (grade3Set.has(k)) tier = 1; // 三年级词靠前
    const p = progOf(word.en);
    const mcBonus = Math.min(p.mc, 6) * 0.5; // 连线连对多 → 更可能认识 → 靠前
    return tier * 1000 + letters(word.en) - mcBonus;
  }

  // ---- 干扰项：形近词优先 ----
  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j += 1) dp[j] = j;
    for (let i = 1; i <= m; i += 1) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j += 1) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[n];
  }
  function pickDistractors(word) {
    const targetEn = keyOf(word.en);
    const used = new Set([word.zh]);
    const out = [];
    const scored = [];
    for (const w of allWords) {
      if (w === word || used.has(w.zh)) continue;
      scored.push({ w, d: levenshtein(targetEn, keyOf(w.en)) });
    }
    const limit = Math.min(3, Math.max(1, targetEn.length - 2));
    const similar = scored.filter((s) => s.d > 0 && s.d <= limit);
    shuffle(similar);
    similar.sort((a, b) => a.d - b.d);
    for (const s of similar) {
      if (out.length >= 2) break;
      if (used.has(s.w.zh)) continue;
      used.add(s.w.zh);
      out.push(s.w.zh);
    }
    const rest = shuffle(scored.slice());
    for (const s of rest) {
      if (out.length >= 3) break;
      if (used.has(s.w.zh)) continue;
      used.add(s.w.zh);
      out.push(s.w.zh);
    }
    return out.slice(0, 3);
  }

  // ---- 统计 ----
  function knownCount() {
    let n = 0;
    allWords.forEach((w) => {
      if (progOf(w.en).lv >= GOAL) n += 1;
    });
    return n;
  }
  function needCount() {
    let n = 0;
    allWords.forEach((w) => {
      if (progOf(w.en).f) n += 1;
    });
    return n;
  }
  function untouchedCount() {
    let n = 0;
    allWords.forEach((w) => {
      const p = progOf(w.en);
      if (!p.f && p.lv === 0) n += 1;
    });
    return n;
  }
  // 已通过快速分词、进入确认流程的词（lv>=1 且未掉队，含已认识）。
  function recognizedCount() {
    let n = 0;
    allWords.forEach((w) => {
      const p = progOf(w.en);
      if (!p.f && p.lv >= 1) n += 1;
    });
    return n;
  }
  // 是否全部有结果（都已认识 lv5 或掉队 f）。
  function allSettled() {
    return allWords.every((w) => {
      const p = progOf(w.en);
      return p.f || p.lv >= GOAL;
    });
  }

  // =======================================================================
  //  金币 & 游戏解锁
  // =======================================================================
  const COIN_KEY = "wg-td-coins";
  const GAME_COST = 300; // 进一个游戏扣 300 金币
  const UNLOCK_COINS = 300; // 金币 >= 300 才点亮游戏按钮
  const GAMES = [
    ["单词大战作业", "td", "⚔️"],
    ["贪吃蛇记忆", "snake", "🐍"],
    ["单词寻宝", "wordsearch", "🔍"],
    ["射击单词", "shoot", "🎯"],
  ];

  function coinBalance() {
    return parseInt(localStorage.getItem(COIN_KEY) || "0", 10) || 0;
  }
  function spendCoins(n) {
    const c = coinBalance();
    if (c < n) return false;
    localStorage.setItem(COIN_KEY, String(c - n));
    if (typeof window.refreshCoins === "function") window.refreshCoins();
    return true;
  }
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }
  // 每个游戏每天只能从这里进一次。
  function gamesPlayedToday() {
    try {
      const o = JSON.parse(localStorage.getItem("wg-vocab-games") || "{}");
      return o.date === todayStr() ? o.games || {} : {};
    } catch (err) {
      return {};
    }
  }
  function markGamePlayed(view) {
    const g = gamesPlayedToday();
    g[view] = true;
    try {
      localStorage.setItem("wg-vocab-games", JSON.stringify({ date: todayStr(), games: g }));
    } catch (err) {
      /* ignore */
    }
  }
  function launchGame(view) {
    if (gamesPlayedToday()[view]) return;
    if (!spendCoins(GAME_COST)) return;
    markGamePlayed(view);
    pause();
    if (view === "shoot") {
      window.location.href = "shoot.html";
      return;
    }
    const maxDay =
      window.WG && typeof window.WG.maxDay === "function" ? window.WG.maxDay() : 21;
    const day = 1 + Math.floor(Math.random() * Math.max(1, maxDay));
    if (window.AppNav && typeof window.AppNav.show === "function") {
      window.AppNav.show(view, { day });
    }
  }

  // =======================================================================
  //  屏幕切换
  // =======================================================================
  function setScreen(next) {
    screen = next;
    UI.headerExtra.innerHTML = "";
    UI.main.innerHTML = "";
    if (next === "hub") {
      UI.name.textContent = "📖 小学词汇通";
      renderHub();
    } else if (next === "sort") {
      UI.name.textContent = "⚡ 快速分词";
      Sort.enter();
    } else if (next === "confirm") {
      UI.name.textContent = "✅ 认识词标记";
      Confirm.enter();
    } else if (next === "match") {
      UI.name.textContent = "🔗 单词连连看";
      Match.enter();
    }
  }

  function renderHub() {
    const total = allWords.length;
    const coins = coinBalance();
    const box = el("div", "vocab-hub");

    const summary = el("div", "vocab-hub-summary");
    summary.appendChild(hubStat("总词", total));
    summary.appendChild(hubStat("已认识", knownCount()));
    summary.appendChild(hubStat("需记", needCount()));
    summary.appendChild(hubStat("待分词", untouchedCount()));
    summary.appendChild(hubStat("💰 金币", coins));
    box.appendChild(summary);

    const cards = el("div", "vocab-hub-cards");
    cards.appendChild(
      hubCard("⚡", "快速分词", "第1轮：看词选中文，快速把词分成「认识 / 需记」，答对得金币", () =>
        setScreen("sort")
      )
    );
    cards.appendChild(
      hubCard("✅", "认识词标记", "第2–5轮：确认认识的词不是蒙对的，连过5轮算真正认识", () =>
        setScreen("confirm")
      )
    );
    cards.appendChild(
      hubCard("🔗", "单词连连看", "左词右义连线，优先练不会/需记的词，连对得金币", () =>
        setScreen("match")
      )
    );
    box.appendChild(cards);

    // 游戏解锁区
    const gameWrap = el("div", "vocab-games");
    const unlocked = coins >= UNLOCK_COINS;
    gameWrap.appendChild(
      el(
        "div",
        "vocab-games-head",
        unlocked
          ? `🎮 玩游戏（每个 -${GAME_COST} 金币，每个游戏每天只能玩 1 次）`
          : `🎮 攒够 ${UNLOCK_COINS} 金币点亮游戏（还差 ${UNLOCK_COINS - coins}）`
      )
    );
    const played = gamesPlayedToday();
    const grid = el("div", "vocab-games-grid");
    GAMES.forEach(([label, view, icon]) => {
      const btn = el("button", "vocab-game-btn");
      const done = !!played[view];
      btn.disabled = !unlocked || done;
      btn.innerHTML =
        `<span class="vocab-game-icon">${icon}</span>` +
        `<span class="vocab-game-label">${label}</span>` +
        `<span class="vocab-game-cost">${done ? "今日已玩" : "-" + GAME_COST + " 💰"}</span>`;
      btn.addEventListener("click", () => {
        launchGame(view);
      });
      grid.appendChild(btn);
    });
    gameWrap.appendChild(grid);
    box.appendChild(gameWrap);

    box.appendChild(
      el(
        "div",
        "vocab-hub-tip",
        serverOk
          ? "进度已连接服务器，自动同步、换设备也不丢。"
          : "未连接服务器，进度暂存本机；连上 vocab_data.php 后可跨设备同步。"
      )
    );
    UI.main.appendChild(box);
  }
  function hubStat(label, value) {
    const s = el("div", "vocab-hub-stat");
    s.appendChild(el("b", null, String(value)));
    s.appendChild(el("span", null, label));
    return s;
  }
  function hubCard(icon, title, sub, onClick) {
    const card = el("button", "vocab-hub-card");
    card.innerHTML =
      `<div class="vocab-hub-icon">${icon}</div>` +
      `<div class="vocab-hub-card-title">${title}</div>` +
      `<div class="vocab-hub-card-sub">${sub}</div>`;
    card.addEventListener("click", onClick);
    return card;
  }

  // =======================================================================
  //  分词标记引擎：sort=第1轮(lv0→1)、confirm=第2–5轮(lv1→5)
  // =======================================================================
  function makeMark(mode) {
    const isSort = mode === "sort";
    return {
    round: null,
    queue: [],
    page: [],
    answered: 0,

    enter() {
      this.refill();
      this.render();
    },

    // sort 只处理 lv0；confirm 只处理 lv1..GOAL-1。
    computeRound() {
      let min = Infinity;
      for (const w of allWords) {
        const p = progOf(w.en);
        if (p.f || p.lv >= GOAL) continue;
        if (isSort ? p.lv !== 0 : p.lv < 1) continue;
        if (p.lv < min) min = p.lv;
      }
      return min === Infinity ? null : min + 1;
    },

    refill() {
      this.round = this.computeRound();
      this.queue = [];
      if (this.round == null) return;
      const lvl = this.round - 1;
      const idxs = [];
      allWords.forEach((w, i) => {
        const p = progOf(w.en);
        if (!p.f && p.lv === lvl) idxs.push(i);
      });
      // 按难度排序：简单词/课本词/连线连对多的靠前。
      idxs.sort((a, b) => difficulty(allWords[a]) - difficulty(allWords[b]));
      this.queue = idxs;
    },

    roundRemaining() {
      if (this.round == null) return 0;
      const lvl = this.round - 1;
      let n = 0;
      allWords.forEach((w) => {
        const p = progOf(w.en);
        if (!p.f && p.lv === lvl) n += 1;
      });
      return n;
    },
    roundTotal() {
      if (this.round == null) return 0;
      const lvl = this.round - 1;
      let n = 0;
      allWords.forEach((w) => {
        const p = progOf(w.en);
        if ((!p.f && (p.lv === lvl || p.lv === this.round)) || (p.f && p.lv === lvl)) n += 1;
      });
      return n;
    },

    renderHeader() {
      UI.headerExtra.innerHTML = "";
      const stats = el("div", "vocab-stats");
      if (isSort) {
        stats.innerHTML =
          `<span>📚 总词 <b>${allWords.length}</b></span>` +
          `<span>⚡ 待分词 <b>${untouchedCount()}</b></span>` +
          `<span>👍 认识 <b>${recognizedCount()}</b></span>` +
          `<span>📝 需记 <b>${needCount()}</b></span>` +
          `<span>💰 金币 <b>${coinBalance()}</b></span>`;
      } else {
        stats.innerHTML =
          `<span>🔁 轮次 <b>${this.round == null ? "完成" : this.round + "/" + GOAL}</b></span>` +
          `<span>✅ 已确认 <b>${knownCount()}</b></span>` +
          `<span>📝 需记 <b>${needCount()}</b></span>` +
          `<span>📄 本轮剩 <b>${this.roundRemaining()}</b></span>` +
          `<span>💰 金币 <b>${coinBalance()}</b></span>`;
      }
      UI.headerExtra.appendChild(stats);
      const bar = el("div", "vocab-progress");
      const fill = el("div", "vocab-progress-fill");
      const rt = this.roundTotal();
      const pct = rt ? Math.round(((rt - this.roundRemaining()) / rt) * 100) : 0;
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      UI.headerExtra.appendChild(bar);
    },

    render() {
      if (!this.queue.length) this.refill();
      if (this.round == null) {
        this.renderDone();
        this.renderHeader();
        return;
      }
      this.page = [];
      while (this.page.length < PAGE_SIZE && this.queue.length) {
        const idx = this.queue.shift();
        const w = allWords[idx];
        const p = progOf(w.en);
        if (p.f || p.lv !== this.round - 1) continue;
        this.page.push({ idx, word: w, answered: false });
      }
      this.answered = 0;
      if (!this.page.length) {
        this.refill();
        if (this.round == null) {
          this.renderDone();
          this.renderHeader();
          return;
        }
        this.render();
        return;
      }

      UI.main.innerHTML = "";
      UI.main.appendChild(
        el(
          "div",
          "vocab-round-head",
          isSort
            ? `快速分词 · 还剩 ${this.roundRemaining()} 词（简单词优先，答对得金币）`
            : `第 ${this.round} 轮 / 共 ${GOAL} 轮 · 本轮还剩 ${this.roundRemaining()} 词`
        )
      );
      const list = el("div", "vocab-list");
      this.page.forEach((entry) => list.appendChild(this.renderRow(entry)));
      UI.main.appendChild(list);

      const footer = el("div", "vocab-footer");
      footer.appendChild(
        el("div", "vocab-footer-tip", "点英文听发音 · 本页答完继续；随时可关闭，下次自动续做")
      );
      const nextBtn = el("button", "vocab-next", "下一页");
      nextBtn.disabled = true;
      nextBtn.addEventListener("click", () => {
        this.render();
        UI.main.scrollTop = 0;
      });
      footer.appendChild(nextBtn);
      const hubBtn = el("button", "vocab-done-btn", "返回词汇通");
      hubBtn.addEventListener("click", () => setScreen("hub"));
      footer.appendChild(hubBtn);
      UI.main.appendChild(footer);
      this.page._nextBtn = nextBtn;

      this.renderHeader();
    },

    renderRow(entry) {
      const word = entry.word;
      const row = el("div", "vocab-row");
      const wrap = el("div", "vocab-word-wrap");
      const wordBtn = el("button", "vocab-word");
      wordBtn.innerHTML = `${word.en}<span class="spk">🔊</span>`;
      wordBtn.addEventListener("click", () => playWord(word.en));
      wrap.appendChild(wordBtn);
      const meta = el("div", "vocab-word-meta");
      const pips = el("span", "vocab-pips");
      const p = progOf(word.en);
      this.renderPips(pips, p.lv, p.f);
      meta.appendChild(pips);
      entry._pips = pips;
      wrap.appendChild(meta);
      row.appendChild(wrap);

      const opts = el("div", "vocab-opts");
      const options = shuffle([word.zh, ...pickDistractors(word)]);
      const buttons = [];
      options.forEach((zh) => {
        const btn = el("button", "vocab-opt", zh);
        btn.addEventListener("click", () =>
          this.answer(entry, row, buttons, unknownBtn, zh === word.zh, btn)
        );
        buttons.push(btn);
        opts.appendChild(btn);
      });
      row.appendChild(opts);

      const unknownBtn = el("button", "vocab-unknown", "不认识");
      unknownBtn.addEventListener("click", () =>
        this.answer(entry, row, buttons, unknownBtn, false, null)
      );
      row.appendChild(unknownBtn);
      return row;
    },

    renderPips(pipsEl, lv, failed) {
      pipsEl.innerHTML = "";
      if (failed) {
        pipsEl.appendChild(el("span", "vocab-need-tag", "📝 需记"));
        return;
      }
      for (let i = 0; i < GOAL; i += 1) {
        pipsEl.appendChild(el("span", "vocab-pip" + (i < lv ? " on" : "")));
      }
      if (lv >= GOAL) pipsEl.appendChild(el("span", "vocab-mastered-tag", " ✓已认识"));
    },

    answer(entry, row, buttons, unknownBtn, isCorrect, chosenBtn) {
      if (entry.answered) return;
      entry.answered = true;
      const word = entry.word;
      const p = progOf(word.en);
      if (isCorrect) {
        const nlv = Math.min(GOAL, p.lv + 1);
        setProg(word.en, { lv: nlv, f: false });
        addGlobalCoins(1); // 答对 1 词 = 1 金币
      } else {
        setProg(word.en, { f: true });
      }
      buttons.forEach((btn) => {
        btn.disabled = true;
        if (btn.textContent === word.zh) btn.classList.add("right");
        else if (btn === chosenBtn) btn.classList.add("wrong");
      });
      unknownBtn.disabled = true;
      if (!isCorrect) {
        unknownBtn.classList.add("picked");
        playWord(word.en);
      }
      row.classList.add("done");
      const np = progOf(word.en);
      this.renderPips(entry._pips, np.lv, np.f);
      this.answered += 1;
      if (this.page._nextBtn && this.answered >= this.page.length) {
        this.page._nextBtn.disabled = false;
        this.page._nextBtn.textContent = this.nextLabel();
      }
      this.renderHeader();
    },

    nextLabel() {
      if (this.queue.length) return "下一页";
      const r = this.computeRound();
      if (r == null) return "完成";
      if (r !== this.round) return `进入第 ${r} 轮`;
      return "下一页";
    },

    renderDone() {
      UI.main.innerHTML = "";
      const box = el("div", "vocab-done");
      if (isSort) {
        box.appendChild(el("div", "vocab-done-title", "⚡ 快速分词完成！"));
        box.appendChild(
          el(
            "div",
            "vocab-done-tip",
            `认识 ${recognizedCount()} 词 · 需记 ${needCount()} 词。接着去「认识词标记」确认这些认识的词吧。`
          )
        );
        const actions = el("div", "vocab-done-actions");
        const go = el("button", "vocab-done-btn primary", "去认识词标记");
        go.addEventListener("click", () => setScreen("confirm"));
        const hub = el("button", "vocab-done-btn", "返回词汇通");
        hub.addEventListener("click", () => setScreen("hub"));
        actions.appendChild(go);
        actions.appendChild(hub);
        box.appendChild(actions);
        UI.main.appendChild(box);
        return;
      }
      const hasRecognized = recognizedCount() > 0 || knownCount() > 0;
      box.appendChild(
        el("div", "vocab-done-title", hasRecognized ? "🏆 认识词确认完成！" : "还没有可确认的词")
      );
      box.appendChild(
        el(
          "div",
          "vocab-done-tip",
          hasRecognized
            ? `真正认识 ${knownCount()} 词 · 需记 ${needCount()} 词。可导出交给 Python 生成需记词表。`
            : "先去「快速分词」把认识的词挑出来，再回来确认。"
        )
      );
      const actions = el("div", "vocab-done-actions");
      if (knownCount() > 0) {
        const exportBtn = el("button", "vocab-done-btn primary", "导出标记");
        exportBtn.addEventListener("click", exportProgress);
        actions.appendChild(exportBtn);
      }
      const goSort = el("button", "vocab-done-btn", "去快速分词");
      goSort.addEventListener("click", () => setScreen("sort"));
      const hub = el("button", "vocab-done-btn", "返回词汇通");
      hub.addEventListener("click", () => setScreen("hub"));
      actions.appendChild(goSort);
      actions.appendChild(hub);
      box.appendChild(actions);
      UI.main.appendChild(box);
    },
    };
  }
  const Sort = makeMark("sort");
  const Confirm = makeMark("confirm");

  // =======================================================================
  //  连线配对（左英文右中文，优先未认识/需记的词）
  // =======================================================================
  const Match = {
    pool: [],
    ptr: 0,
    batch: [],
    matched: 0,
    selectedLeft: null,

    enter() {
      this.buildPool();
      this.ptr = 0;
      this.render();
    },

    // 优先未认识/需记的词：f(需记) 最前，其次 lv 低，再按难度。
    buildPool() {
      const cand = allWords.filter((w) => {
        const p = progOf(w.en);
        return p.lv < GOAL; // 还没真正认识的都可练
      });
      cand.sort((a, b) => {
        const pa = progOf(a.en);
        const pb = progOf(b.en);
        const fa = pa.f ? 0 : 1;
        const fb = pb.f ? 0 : 1;
        if (fa !== fb) return fa - fb; // 需记优先
        if (pa.lv !== pb.lv) return pa.lv - pb.lv; // 进度低优先
        return difficulty(a) - difficulty(b);
      });
      this.pool = cand;
    },

    nextBatch() {
      // 取 6 个中文互不相同的词。
      const batch = [];
      const seenZh = new Set();
      let guard = 0;
      while (batch.length < MATCH_SIZE && guard < this.pool.length + MATCH_SIZE) {
        guard += 1;
        if (this.ptr >= this.pool.length) this.ptr = 0;
        const w = this.pool[this.ptr];
        this.ptr += 1;
        if (!w) break;
        if (seenZh.has(w.zh)) continue;
        seenZh.add(w.zh);
        batch.push(w);
        if (batch.length >= this.pool.length) break;
      }
      return batch;
    },

    render() {
      this.buildPool(); // 反映最新进度
      if (!this.pool.length) {
        UI.headerExtra.innerHTML = "";
        UI.main.innerHTML = "";
        const box = el("div", "vocab-done");
        box.appendChild(el("div", "vocab-done-title", "🎉 没有需要练的词了！"));
        box.appendChild(el("div", "vocab-done-tip", "所有词都已确认认识。"));
        const hub = el("button", "vocab-done-btn primary", "返回词汇通");
        hub.addEventListener("click", () => setScreen("hub"));
        const acts = el("div", "vocab-done-actions");
        acts.appendChild(hub);
        box.appendChild(acts);
        UI.main.appendChild(box);
        return;
      }
      this.batch = this.nextBatch();
      this.matched = 0;
      this.selectedLeft = null;

      UI.headerExtra.innerHTML = "";
      const stats = el("div", "vocab-stats");
      stats.innerHTML =
        `<span>🔗 本组 <b>${this.batch.length}</b> 对</span>` +
        `<span>📝 需记池 <b>${this.pool.filter((w) => progOf(w.en).f).length}</b></span>` +
        `<span>🎯 可练 <b>${this.pool.length}</b></span>`;
      UI.headerExtra.appendChild(stats);

      UI.main.innerHTML = "";
      UI.main.appendChild(
        el("div", "vocab-round-head", "把左边的英文和右边的中文连起来（点一个英文，再点对应中文）")
      );

      const board = el("div", "vocab-match-board");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("vocab-match-svg");
      board.appendChild(svg);
      this._svg = svg;
      this._board = board;

      const leftCol = el("div", "vocab-match-col");
      const rightCol = el("div", "vocab-match-col");
      this._leftNodes = new Map();
      this._rightNodes = new Map();

      shuffle(this.batch.slice()).forEach((w) => {
        const node = el("button", "vocab-match-item", w.en);
        node.addEventListener("click", () => this.pickLeft(w, node));
        this._leftNodes.set(keyOf(w.en), node);
        leftCol.appendChild(node);
      });
      shuffle(this.batch.slice()).forEach((w) => {
        const node = el("button", "vocab-match-item", w.zh);
        node.addEventListener("click", () => this.pickRight(w, node));
        this._rightNodes.set(keyOf(w.en), node);
        rightCol.appendChild(node);
      });
      board.appendChild(leftCol);
      board.appendChild(rightCol);
      UI.main.appendChild(board);

      const footer = el("div", "vocab-footer");
      footer.appendChild(el("div", "vocab-footer-tip", "连对全部后可换下一组；随时返回。"));
      const nextBtn = el("button", "vocab-next", "下一组");
      nextBtn.disabled = true;
      nextBtn.addEventListener("click", () => {
        this.render();
        UI.main.scrollTop = 0;
      });
      footer.appendChild(nextBtn);
      const hubBtn = el("button", "vocab-done-btn", "返回词汇通");
      hubBtn.addEventListener("click", () => setScreen("hub"));
      footer.appendChild(hubBtn);
      UI.main.appendChild(footer);
      this._nextBtn = nextBtn;
    },

    pickLeft(word, node) {
      if (node.classList.contains("matched")) return;
      if (this.selectedLeft) this.selectedLeft.node.classList.remove("selected");
      this.selectedLeft = { word, node };
      node.classList.add("selected");
    },

    pickRight(word, node) {
      if (node.classList.contains("matched")) return;
      if (!this.selectedLeft) return;
      const left = this.selectedLeft;
      if (keyOf(left.word.en) === keyOf(word.en)) {
        // 连对：绿色、画线、mc+1
        left.node.classList.remove("selected");
        left.node.classList.add("matched");
        node.classList.add("matched");
        const p = progOf(word.en);
        setProg(word.en, { mc: p.mc + 1 });
        addGlobalCoins(1); // 连对 1 词 = 1 金币
        this.drawLine(left.node, node);
        this.selectedLeft = null;
        this.matched += 1;
        if (this.matched >= this.batch.length && this._nextBtn) {
          this._nextBtn.disabled = false;
          this._nextBtn.textContent = this.pool.length > this.batch.length ? "下一组" : "完成";
        }
      } else {
        // 连错：闪红
        node.classList.add("wrong");
        const bad = node;
        setTimeout(() => bad.classList.remove("wrong"), 400);
        left.node.classList.remove("selected");
        this.selectedLeft = null;
      }
    },

    drawLine(leftNode, rightNode) {
      const svg = this._svg;
      const board = this._board;
      if (!svg || !board) return;
      const br = board.getBoundingClientRect();
      const a = leftNode.getBoundingClientRect();
      const b = rightNode.getBoundingClientRect();
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", a.right - br.left);
      line.setAttribute("y1", a.top + a.height / 2 - br.top);
      line.setAttribute("x2", b.left - br.left);
      line.setAttribute("y2", b.top + b.height / 2 - br.top);
      svg.appendChild(line);
    },
  };

  // =======================================================================
  //  导出
  // =======================================================================
  function exportProgress() {
    const counts = {};
    (allWords || []).forEach((w) => {
      const p = progOf(w.en);
      if (p.lv > 0 || p.f) counts[keyOf(w.en)] = p.lv;
    });
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      masterGoal: GOAL,
      completed: allSettled(),
      total: allWords ? allWords.length : 0,
      known: knownCount(),
      need: needCount(),
      counts,
      words: prog, // 完整状态（含 lv/f/mc）
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const a = el("a");
      a.href = url;
      a.download = `vocab_counts_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      /* ignore */
    }
  }

  function goHome() {
    if (window.AppNav && typeof window.AppNav.show === "function") {
      window.AppNav.show("home");
    }
  }

  // ---- 公开接口 ----
  async function start() {
    UI.main.innerHTML = '<div class="vocab-loading">正在加载词库与进度…</div>';
    UI.headerExtra.innerHTML = "";
    try {
      await loadWords();
    } catch (err) {
      UI.main.innerHTML = '<div class="vocab-loading">词库加载失败，请检查 wordlist.txt。</div>';
      return;
    }
    await Promise.all([loadCurriculum(), loadProgress()]);
    setScreen("hub");
  }

  function pause() {
    try {
      if (currentAudio) currentAudio.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch (err) {
      /* ignore */
    }
    // 离开前把待保存的进度立即刷到服务器。
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      serverSave();
    }
  }

  if (UI.back) {
    UI.back.addEventListener("click", () => {
      pause();
      if (screen === "hub") goHome();
      else setScreen("hub");
    });
  }
  if (UI.export) {
    UI.export.addEventListener("click", exportProgress);
  }

  window.VocabApp = { start, pause };
})();
