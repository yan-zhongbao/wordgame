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
  const LS_KEY = "wg-vocab-progress"; // 本地镜像键（当前用户）
  const OLD_KEY = "wg-vocab-counts"; // 旧版键，弃用
  const USER_KEY = "wg-vocab-user"; // 当前用户 { id, name }
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
  let categories = {}; // { 分类label: [en...] }（单词雨用）
  const SESSION_LIMIT_MS = 10 * 60 * 1000; // 游戏单次 10 分钟上限
  const CHECKIN_KEY = "wg-vocab-checkin"; // 每日打卡状态
  const DAILY_TARGET = 100; // 每天收藏单词上限（超出不计入打卡）
  // 连续打卡里程碑：streak → { coins, cards, label }
  const STREAK_REWARDS = {
    2: { coins: 50,  cards: 0, label: "连续2天 额外+50金币" },
    3: { coins: 0,   cards: 1, label: "连续3天 额外🎴×1" },
    4: { coins: 200, cards: 0, label: "连续4天 额外+200金币" },
    5: { coins: 0,   cards: 2, label: "连续5天 额外🎴×2" },
    6: { coins: 400, cards: 0, label: "连续6天 额外+400金币" },
    7: { coins: 0,   cards: 4, label: "连续7天 额外🎴×4" },
  };
  let screen = "hub"; // hub | mark | match
  let serverOk = false; // PHP 是否可用
  let user = null; // 当前用户 { id, name }；null=未设置（首次进入需取名）

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
  function fmtClock(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
  function speakThen(text, cb) {
    if (!("speechSynthesis" in window)) {
      cb();
      return;
    }
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.onend = cb;
      u.onerror = cb;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (err) {
      cb();
    }
  }
  // 播放单词，播完（或兜底超时）后回调，用于打地鼠"读完再继续"。
  function playWordThen(en, cb) {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cb();
    };
    const safety = setTimeout(finish, 2600);
    const finClear = () => {
      clearTimeout(safety);
      finish();
    };
    const isPhrase = /\s/.test(en.trim());
    const src = `audio/${isPhrase ? "phrase" : "en"}/${slugify(en)}.mp3`;
    try {
      if (currentAudio) currentAudio.pause();
      const a = new Audio(src);
      currentAudio = a;
      a.addEventListener("ended", finClear);
      a.addEventListener("error", () => speakThen(en, finClear));
      const p = a.play();
      if (p && p.catch) p.catch(() => speakThen(en, finClear));
    } catch (err) {
      speakThen(en, finClear);
    }
  }
  function addGlobalCoins(amount) {
    setCoins(getCoins() + amount);
    syncSoon(); // 金币变化也同步到云
  }

  // 音效：复用 TD 的音频。coin=得分、fail=爆炸/失败。
  const SFX = {
    files: { coin: "audio/td/coin.wav", fail: "audio/td/explode.wav" },
    preload() {
      for (const k in this.files) {
        try {
          const a = new Audio(this.files[k]);
          a.preload = "auto";
          a.load();
        } catch (err) {
          /* ignore */
        }
      }
    },
    play(name) {
      const src = this.files[name];
      if (!src) return;
      try {
        const a = new Audio(src);
        a.volume = 0.6;
        a.play().catch(() => {});
      } catch (err) {
        /* ignore */
      }
    },
  };

  // 在屏幕坐标处冒出一段文字（如 +1 / -2金币），向上飘并淡出。
  function floatText(x, y, text, kind) {
    try {
      const t = document.createElement("div");
      t.className = "vocab-float " + (kind === "plus" ? "plus" : "minus");
      t.textContent = text;
      t.style.left = `${x}px`;
      t.style.top = `${y}px`;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 1000);
    } catch (err) {
      /* ignore */
    }
  }

  // ---- 用户（多人云同步） ----
  // 名字 → 安全 id（同名 = 同一份云数据，可跨设备）。
  function slugId(name) {
    const base = String(name || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_一-龥-]/g, "");
    // 含中文时按需保留：用 encodeURIComponent 交给服务器过滤（服务器只留 a-z0-9_-），
    // 所以这里把非 ascii 转成拼音式不现实，改为对整串做一个稳定 hash 兜底。
    const ascii = base.replace(/[^a-z0-9_-]/g, "");
    if (ascii.length >= 2) return ascii.slice(0, 40);
    // 纯中文名等 → 用 hash 生成稳定 id。
    let h = 0;
    for (let i = 0; i < base.length; i += 1) {
      h = (h * 31 + base.charCodeAt(i)) >>> 0;
    }
    return "u" + h.toString(36);
  }
  function loadUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;
      const u = JSON.parse(raw);
      if (u && u.id && u.name) return { id: String(u.id), name: String(u.name) };
    } catch (err) {
      /* ignore */
    }
    return null;
  }
  function setUser(name) {
    const nm = String(name || "").trim();
    if (!nm) return null;
    user = { id: slugId(nm), name: nm };
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (err) {
      /* ignore */
    }
    return user;
  }
  function apiUrl() {
    return user && user.id
      ? API_URL + "?user=" + encodeURIComponent(user.id)
      : API_URL;
  }
  // 金币读写（复用全局 wg-td-coins，其它游戏也读这个键）。
  const COINS_LS = "wg-td-coins";
  function getCoins() {
    return parseInt(localStorage.getItem(COINS_LS) || "0", 10) || 0;
  }
  function setCoins(n) {
    try {
      localStorage.setItem(COINS_LS, String(Math.max(0, parseInt(n, 10) || 0)));
      if (typeof window.refreshCoins === "function") window.refreshCoins();
    } catch (err) {
      /* ignore */
    }
  }

  // ---- 轻量弹窗（取名 / 同步菜单），自带遮罩，风格照抄 exam ----
  function vocabModal(opts) {
    const overlay = el("div", "vocab-modal-overlay");
    const box = el("div", "vocab-modal");
    if (opts.title) box.appendChild(el("h3", "vocab-modal-title", opts.title));
    if (opts.desc) box.appendChild(el("p", "vocab-modal-desc", opts.desc));
    if (opts.body) box.appendChild(opts.body);
    const actions = el("div", "vocab-modal-actions");
    const close = () => overlay.remove();
    (opts.actions || []).forEach((a) => {
      const btn = el("button", "vocab-modal-btn" + (a.primary ? " primary" : ""), a.text);
      btn.type = "button";
      btn.addEventListener("click", () => {
        if (a.onClick) a.onClick(close);
        else close();
      });
      actions.appendChild(btn);
    });
    box.appendChild(actions);
    overlay.appendChild(box);
    if (opts.dismissable !== false) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
      });
    }
    (ROOT === document ? document.body : ROOT).appendChild(overlay);
    if (opts.onOpen) opts.onOpen(box, close);
    return close;
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
  // 返回 { words, coins, name } 或 null。
  async function serverLoad() {
    try {
      const res = await fetch(apiUrl(), { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      serverOk = true;
      return {
        words: normalizeWords(data.words),
        coins: Math.max(0, parseInt(data.coins, 10) || 0),
        name: data.name || "",
        checkin: data.checkin || null,
      };
    } catch (err) {
      serverOk = false;
      return null;
    }
  }
  let saveTimer = null;
  async function serverSave() {
    if (!serverOk) return;
    try {
      await fetch(apiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          v: 2,
          goal: GOAL,
          name: user ? user.name : "",
          coins: getCoins(),
          words: prog,
          checkin: Checkin.toJSON(),
        }),
        cache: "no-store",
      });
    } catch (err) {
      serverOk = false;
    }
  }
  // 去抖触发一次服务器保存（金币变化也会调用）。
  function syncSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(serverSave, 600);
  }
  // 保存：本地立即写，服务器去抖后台写。
  function save() {
    writeLocal();
    syncSoon();
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

  async function loadCategories() {
    try {
      const res = await fetch("vocab_categories.json", { cache: "no-cache" });
      if (res.ok) {
        const d = await res.json();
        categories = d.categories || {};
      }
    } catch (err) {
      categories = {};
    }
  }

  // 读取旧版单文件 vocab_progress.json（不带 user 参数）。
  // 用于新用户首次登录时，自动迁移旧数据，避免进度丢失。
  async function serverLoadLegacy() {
    try {
      const res = await fetch(API_URL, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      const words = normalizeWords(data.words || {});
      if (!Object.keys(words).length) return null;
      return {
        words,
        coins: Math.max(0, parseInt(data.coins, 10) || 0),
      };
    } catch (err) {
      return null;
    }
  }

  // 加载进度：服务器用户文件 → 旧版单文件迁移（词数更多时优先）→ 本地 → seed。
  // useSeed=false 时（如新建/切换用户）不落回 seed，新用户从空白开始。
  async function loadProgress(useSeed) {
    const remote = await serverLoad();
    if (remote && Object.keys(remote.words).length) {
      // 云端有该用户的数据 → 以云端为准（进度 + 金币 + 打卡）。
      prog = remote.words;
      setCoins(remote.coins);
      Checkin.load(remote.checkin);
      writeLocal();
      return;
    }
    const local = readLocal();
    const localCount = local ? Object.keys(local).length : 0;
    // 用户文件为空时，尝试从旧版单文件迁移（词数多的胜出，避免 seed 数据覆盖真实进度）。
    if (user && serverOk) {
      const legacy = await serverLoadLegacy();
      const legacyCount = legacy ? Object.keys(legacy.words).length : 0;
      if (legacyCount > localCount) {
        prog = legacy.words;
        setCoins(Math.max(getCoins(), legacy.coins));
        Checkin.load(null);
        save(); // 写入用户文件 + 本地，完成一次性迁移
        return;
      }
    }
    if (localCount) {
      prog = local;
      Checkin.load(null);
      if (serverOk) syncSoon();
      return;
    }
    if (useSeed === false) {
      prog = {};
      if (serverOk) syncSoon();
      return;
    }
    try {
      const res = await fetch(SEED_URL, { cache: "no-cache" });
      if (res.ok) {
        const data = await res.json();
        prog = normalizeWords(data.words);
        save();
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

  // 挑 n 个形近的英文词（编辑距离小，如 cat→cut/cap/cot），用于听音选词/形近词辨析。
  function pickSimilarWords(word, n) {
    const targetEn = keyOf(word.en);
    const used = new Set([targetEn]);
    const scored = [];
    for (const w of allWords) {
      const k = keyOf(w.en);
      if (used.has(k)) continue;
      scored.push({ en: w.en, d: levenshtein(targetEn, k) });
    }
    const close = scored.filter((s) => s.d > 0);
    shuffle(close);
    close.sort((a, b) => a.d - b.d); // 越形近越优先
    const out = [];
    for (const s of close) {
      if (out.length >= n) break;
      const k = keyOf(s.en);
      if (used.has(k)) continue;
      used.add(k);
      out.push(s.en);
    }
    return out.slice(0, n);
  }

  // 选词模式的 3 个英文干扰项：similar=全形近；mixed=2形近+1随机。
  function chooseDistractors(word, strategy) {
    const sim = pickSimilarWords(word, strategy === "mixed" ? 2 : 3);
    const out = sim.slice();
    if (strategy === "mixed") {
      const used = new Set([keyOf(word.en), ...out.map(keyOf)]);
      for (const w of shuffle(allWords.slice())) {
        if (out.length >= 3) break;
        const k = keyOf(w.en);
        if (used.has(k)) continue;
        used.add(k);
        out.push(w.en);
      }
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
  //  每日打卡 & 连续签到奖励
  // =======================================================================
  const Checkin = {
    _st: null, // { today, words:Set, checked, streak, lastCheckin, cards, weekWords:Set, weekStart }

    _today() { return new Date().toISOString().slice(0, 10); },
    _yesterday() {
      const d = new Date(); d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    },
    // 返回本周一的日期（YYYY-MM-DD），用于周重置判断。
    _thisMonday() {
      const d = new Date();
      const diff = d.getDay() === 0 ? 6 : d.getDay() - 1;
      d.setDate(d.getDate() - diff);
      return d.toISOString().slice(0, 10);
    },

    // 从 localStorage 初始化（可选 remote 用于合并云端数据）。
    load(remote) {
      const monday = this._thisMonday();
      let st = { today: this._today(), words: new Set(), checked: false, streak: 0, lastCheckin: "", cards: 0, weekWords: new Set(), weekStart: monday };
      try {
        const raw = localStorage.getItem(CHECKIN_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          const sameWeek = s.weekStart === monday;
          st = {
            today: s.today || this._today(),
            words: new Set(Array.isArray(s.words) ? s.words : []),
            checked: !!s.checked,
            streak: Math.max(0, parseInt(s.streak, 10) || 0),
            lastCheckin: s.lastCheckin || "",
            cards: Math.max(0, parseInt(s.cards, 10) || 0),
            weekWords: new Set(sameWeek && Array.isArray(s.weekWords) ? s.weekWords : []),
            weekStart: monday,
          };
        }
      } catch (e) { /* ignore */ }
      this._st = st;
      if (remote) this._mergeRemote(remote);
      this._checkDay();
    },

    // 日期切换时重置今日词集；新的一周（周一）时重置周词集。
    _checkDay() {
      if (!this._st) return;
      const monday = this._thisMonday();
      if (this._st.weekStart !== monday) {
        this._st.weekStart = monday;
        this._st.weekWords = new Set();
      }
      if (this._st.today !== this._today()) {
        this._st.words = new Set();
        this._st.checked = false;
        this._st.today = this._today();
      }
    },

    // 将云端数据合并到本地（取大原则，防止回滚）。
    _mergeRemote(data) {
      if (!data || !this._st) return;
      const s = this._st;
      s.streak = Math.max(s.streak, parseInt(data.streak, 10) || 0);
      s.cards = Math.max(s.cards, parseInt(data.cards, 10) || 0);
      if ((data.lastCheckin || "") > (s.lastCheckin || "")) s.lastCheckin = data.lastCheckin;
      if (data.today === this._today() && Array.isArray(data.words)) {
        data.words.forEach(w => s.words.add(keyOf(w)));
        if (data.checked) s.checked = true;
      }
      // 合并本周词集（取并集，防止多设备回滚）
      if (data.weekStart === this._thisMonday() && Array.isArray(data.weekWords)) {
        data.weekWords.forEach(w => s.weekWords.add(keyOf(w)));
      }
      this._write();
    },

    _st_get() {
      if (!this._st) this.load(null);
      this._checkDay();
      return this._st;
    },

    _write() {
      if (!this._st) return;
      try {
        localStorage.setItem(CHECKIN_KEY, JSON.stringify({
          today: this._st.today,
          words: [...this._st.words],
          checked: this._st.checked,
          streak: this._st.streak,
          lastCheckin: this._st.lastCheckin,
          cards: this._st.cards,
          weekWords: [...this._st.weekWords],
          weekStart: this._st.weekStart,
        }));
      } catch (e) { /* ignore */ }
      syncSoon(); // 打卡状态也纳入云同步
    },

    count() { return this._st_get().words.size; },
    isReady() { const s = this._st_get(); return s.words.size >= DAILY_TARGET && !s.checked; },
    isCheckedToday() { return this._st_get().checked; },
    getCards() { return this._st_get().cards; },
    getStreak() { return this._st_get().streak; },
    getWeekWords() { return this._st_get().weekWords; },

    // 每次答对调用，返回 true=当天新增。超过 100/已收录/本周已见则忽略。
    markWord(en) {
      const s = this._st_get();
      if (s.words.size >= DAILY_TARGET) return false;
      const k = keyOf(en);
      if (s.words.has(k) || s.weekWords.has(k)) return false; // 今天或本周已计入
      s.words.add(k);
      s.weekWords.add(k);
      this._write();
      if (s.words.size === DAILY_TARGET) setTimeout(() => this._notify100(), 80);
      return true;
    },

    // 达到 100 个单词时弹出提示。
    _notify100() {
      const toast = document.createElement("div");
      toast.className = "vocab-checkin-toast";
      toast.innerHTML =
        '<div class="vocab-checkin-toast-inner">' +
          '<div class="vocab-checkin-toast-big">🎉</div>' +
          '<div class="vocab-checkin-toast-title">今天收藏了 100 个单词！</div>' +
          '<div class="vocab-checkin-toast-sub">去主页打卡，领取奖励吧！</div>' +
          '<button class="vocab-checkin-toast-btn" type="button">去打卡 →</button>' +
        '</div>';
      toast.querySelector(".vocab-checkin-toast-btn").addEventListener("click", () => {
        toast.remove();
        setScreen("hub");
      });
      document.body.appendChild(toast);
      const tid = setTimeout(() => { try { toast.remove(); } catch(e) {} }, 8000);
      toast.querySelector(".vocab-checkin-toast-btn").addEventListener("click", () => clearTimeout(tid));
    },

    // 按下打卡按钮：计算并兑现奖励，返回 {coinsEarned, cardsEarned, bonuses, streak, totalCards} 或 null。
    doCheckin() {
      const s = this._st_get();
      if (s.words.size < DAILY_TARGET || s.checked) return null;
      const isConsec = s.lastCheckin === this._yesterday();
      // 每周一重置：周一打卡永远从第 1 天重新开始，形成 Mon-Sun 的完整周挑战。
      const isMonday = new Date().getDay() === 1;
      const newStreak = (isMonday || !isConsec) ? 1 : s.streak + 1;
      let coinsEarned = 100, cardsEarned = 0;
      const bonuses = [];
      const mil = STREAK_REWARDS[newStreak];
      if (mil) {
        coinsEarned += mil.coins;
        cardsEarned += mil.cards;
        bonuses.push(mil.label);
      }
      s.streak = newStreak;
      s.lastCheckin = this._today();
      s.checked = true;
      s.cards += cardsEarned;
      this._write();
      addGlobalCoins(coinsEarned);
      return { coinsEarned, cardsEarned, bonuses, streak: newStreak, totalCards: s.cards };
    },

    // 家长帮孩子兑换一张游戏卡（15 分钟游戏时间）。
    redeemCard() {
      const s = this._st_get();
      if (s.cards <= 0) return false;
      s.cards -= 1;
      this._write();
      return true;
    },

    // 云同步序列化。
    toJSON() {
      const s = this._st_get();
      return { today: s.today, words: [...s.words], checked: s.checked, streak: s.streak, lastCheckin: s.lastCheckin, cards: s.cards, weekWords: [...s.weekWords], weekStart: s.weekStart };
    },

    // 切换用户时清空。
    reset() {
      this._st = null;
      try { localStorage.removeItem(CHECKIN_KEY); } catch (e) { /* ignore */ }
    },
  };

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
    return getCoins();
  }
  function spendCoins(n) {
    const c = coinBalance();
    if (c < n) return false;
    setCoins(c - n);
    syncSoon(); // 花费也同步到云
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
    } else if (next === "listen") {
      UI.name.textContent = "🔊 听音选词";
      Listen.enter();
    } else if (next === "similar") {
      UI.name.textContent = "🔤 形近词辨析";
      Similar.enter();
    } else if (next === "zh2en") {
      UI.name.textContent = "📖 中文选词";
      Zh2en.enter();
    } else if (next === "rain") {
      UI.name.textContent = "🌧️ 单词雨";
      Rain.enter();
    } else if (next === "mole") {
      UI.name.textContent = "🔨 打地鼠";
      Mole.enter();
    }
  }

  function renderHub() {
    const total = allWords.length;
    const coins = coinBalance();
    // 头部：云同步按钮（显示当前用户名）。
    UI.headerExtra.innerHTML = "";
    const syncBtn = el("button", "vocab-sync-btn", "☁️ " + (user ? user.name : "同步"));
    syncBtn.type = "button";
    syncBtn.title = "数据同步 / 切换用户";
    syncBtn.addEventListener("click", openSyncMenu);
    UI.headerExtra.appendChild(syncBtn);

    const box = el("div", "vocab-hub");

    if (user && user.name) {
      const greeting = el("div", "vocab-hub-greeting", "👋 你好，" + user.name + "！");
      box.appendChild(greeting);
    }

    const summary = el("div", "vocab-hub-summary");
    summary.appendChild(hubStat("总词", total));
    summary.appendChild(hubStat("已认识", knownCount()));
    summary.appendChild(hubStat("需记", needCount()));
    summary.appendChild(hubStat("待分词", untouchedCount()));
    summary.appendChild(hubStat("💰 金币", coins));
    box.appendChild(summary);

    // 每日打卡面板
    renderCheckin(box);

    const cards = el("div", "vocab-hub-cards");
    // 所有词都分过（没有待分词的词）后，隐藏"快速分词"入口。
    if (untouchedCount() > 0) {
      cards.appendChild(hubCard("⚡", "快速分词", () => setScreen("sort")));
    }
    cards.appendChild(hubCard("✅", "认识词标记", () => setScreen("confirm")));
    cards.appendChild(hubCard("🔗", "单词连连看", () => setScreen("match")));
    cards.appendChild(hubCard("🔊", "听音选词", () => setScreen("listen")));
    cards.appendChild(hubCard("🔤", "形近词辨析", () => setScreen("similar")));
    cards.appendChild(hubCard("📖", "中文选词", () => setScreen("zh2en")));
    cards.appendChild(hubCard("🌧️", "单词雨", () => setScreen("rain")));
    cards.appendChild(hubCard("🔨", "打地鼠", () => setScreen("mole")));
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
  function hubCard(icon, title, onClick) {
    const card = el("button", "vocab-hub-card");
    card.innerHTML =
      `<div class="vocab-hub-icon">${icon}</div>` +
      `<div class="vocab-hub-card-title">${title}</div>`;
    card.addEventListener("click", onClick);
    return card;
  }

  // 每日打卡面板（嵌入 hub）。
  function renderCheckin(box) {
    const count = Checkin.count();
    const streak = Checkin.getStreak();
    const cards = Checkin.getCards();
    const ready = Checkin.isReady();
    const checked = Checkin.isCheckedToday();

    const panel = el("div", "vocab-checkin-panel");

    // 标题行
    const hdr = el("div", "vocab-checkin-hdr");
    const title = el("span", "vocab-checkin-title", "📅 每日打卡");
    hdr.appendChild(title);
    if (streak > 0) {
      hdr.appendChild(el("span", "vocab-checkin-streak-badge", "🔥 连续 " + streak + " 天"));
    }
    if (cards > 0) {
      hdr.appendChild(el("span", "vocab-checkin-cards-badge", "🎴 " + cards + " 张"));
    }
    panel.appendChild(hdr);

    // 进度条
    const pct = Math.min(100, Math.round(count / DAILY_TARGET * 100));
    const progRow = el("div", "vocab-checkin-prog-row");
    const bar = el("div", "vocab-checkin-bar");
    const fill = el("div", "vocab-checkin-bar-fill");
    fill.style.width = pct + "%";
    bar.appendChild(fill);
    progRow.appendChild(bar);
    const lbl = el("span", "vocab-checkin-prog-label", checked ? "✅ 今日已打卡" : count + " / " + DAILY_TARGET + " 个单词");
    progRow.appendChild(lbl);
    panel.appendChild(progRow);

    // 打卡按钮
    if (ready) {
      const btn = el("button", "vocab-checkin-btn", "🏆 打卡领奖 +100金币");
      btn.type = "button";
      btn.addEventListener("click", () => {
        const result = Checkin.doCheckin();
        if (!result) return;
        setScreen("hub"); // 刷新 hub
        showCheckinResult(result);
      });
      panel.appendChild(btn);
    }

    // 游戏卡兑换
    if (cards > 0) {
      const cardRow = el("div", "vocab-checkin-card-row");
      cardRow.innerHTML =
        `🎴 你有 <b>${cards}</b> 张游戏卡，每张换 15 分钟平板游戏时间 ` +
        `<button class="vocab-checkin-redeem-btn" type="button">向家长兑换</button>`;
      cardRow.querySelector(".vocab-checkin-redeem-btn").addEventListener("click", () => {
        if (Checkin.redeemCard()) setScreen("hub");
      });
      panel.appendChild(cardRow);
    }

    // 里程碑奖励一览（始终显示，让孩子有目标感）
    const milWrap = el("div", "vocab-checkin-milestones");
    milWrap.appendChild(el("div", "vocab-checkin-mil-title", "打卡奖励（每周一重置）："));
    // 基础行：每天必得
    const baseChip = el("div", "vocab-checkin-mil-chip base" + (streak >= 1 ? " done" : ""));
    baseChip.appendChild(el("b", null, "每天"));
    baseChip.appendChild(el("span", null, "100💰"));
    const milRow = el("div", "vocab-checkin-mil-row");
    milRow.appendChild(baseChip);
    // 连续天数额外奖励
    [
      [2, "额外+50💰"],
      [3, "额外🎴×1"],
      [4, "额外+200💰"],
      [5, "额外🎴×2"],
      [6, "额外+400💰"],
      [7, "额外🎴×4"],
    ].forEach(([day, reward]) => {
      const chip = el("div", "vocab-checkin-mil-chip" + (streak >= day ? " done" : ""));
      chip.appendChild(el("b", null, day + "天"));
      chip.appendChild(el("span", null, reward));
      milRow.appendChild(chip);
    });
    milWrap.appendChild(milRow);
    panel.appendChild(milWrap);

    box.appendChild(panel);
  }

  // 打卡结果弹窗。
  function showCheckinResult(result) {
    const body = el("div", "vocab-checkin-result");
    body.appendChild(el("div", "vocab-checkin-result-streak",
      "🔥 连续打卡第 " + result.streak + " 天！"));
    body.appendChild(el("div", "vocab-checkin-result-line",
      "🏆 基础奖励：+100 金币"));
    result.bonuses.forEach(b => body.appendChild(el("div", "vocab-checkin-result-line bonus", b)));
    const total = el("div", "vocab-checkin-result-total");
    total.innerHTML = "💰 本次共获得 <b>+" + result.coinsEarned + "</b> 金币";
    body.appendChild(total);
    if (result.cardsEarned > 0) {
      const c = el("div", "vocab-checkin-result-cards");
      c.innerHTML = "🎴 新增 <b>" + result.cardsEarned + "</b> 张游戏卡！共 <b>" + result.totalCards + "</b> 张";
      body.appendChild(c);
      body.appendChild(el("div", "vocab-checkin-result-hint",
        "（每张游戏卡可向家长兑换 15 分钟平板游戏时间）"));
    }
    vocabModal({
      title: "🎉 打卡成功！",
      body,
      actions: [{ text: "太棒了！", primary: true }],
    });
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
      const list = el("div", "vocab-list");
      this.page.forEach((entry) => list.appendChild(this.renderRow(entry)));
      UI.main.appendChild(list);

      const footer = el("div", "vocab-footer");
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
        Checkin.markWord(word.en);
      } else {
        setProg(word.en, { f: true });
      }
      buttons.forEach((btn) => {
        btn.disabled = true;
        if (btn.textContent === word.zh) btn.classList.add("right");
        else if (btn === chosenBtn) btn.classList.add("wrong");
      });
      unknownBtn.disabled = true;
      if (isCorrect) {
        playWord(word.en); // 对 → 读单词
      } else if (chosenBtn) {
        SFX.play("fail"); // 选错了 → 失败音效
      } else {
        unknownBtn.classList.add("picked"); // 点了"不认识"
        playWord(word.en); // 读一遍帮助认读
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
      UI.main.appendChild(el("div", "vocab-round-head", "点英文，再点对应中文"));

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
        Checkin.markWord(word.en);
        playWord(word.en); // 对 → 读单词
        this.drawLine(left.node, node);
        this.selectedLeft = null;
        this.matched += 1;
        if (this.matched >= this.batch.length && this._nextBtn) {
          this._nextBtn.disabled = false;
          this._nextBtn.textContent = this.pool.length > this.batch.length ? "下一组" : "完成";
        }
      } else {
        // 连错：闪红 + 失败音效
        SFX.play("fail");
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
  //  选词引擎：listen=听音选英文、similar=中文选形近英文（候选都用形近词）
  // =======================================================================
  function makeChoose(opts) {
    const isAudio = opts.prompt === "audio";
    return {
      pool: [],
      ptr: 0,
      current: null,
      correct: 0,
      streak: 0,
      answered: false,
      timer: null,

      enter() {
        this.correct = 0;
        this.streak = 0;
        this.ptr = 0;
        this.next();
      },

      // 练习池：还没真正认识的词，需记优先、进度低优先。
      buildPool() {
        const cand = allWords.filter((w) => progOf(w.en).lv < GOAL);
        cand.sort((a, b) => {
          const pa = progOf(a.en);
          const pb = progOf(b.en);
          const fa = pa.f ? 0 : 1;
          const fb = pb.f ? 0 : 1;
          if (fa !== fb) return fa - fb;
          if (pa.lv !== pb.lv) return pa.lv - pb.lv;
          return difficulty(a) - difficulty(b);
        });
        this.pool = cand;
      },

      clearTimer() {
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      },

      next() {
        this.clearTimer();
        this.buildPool();
        if (!this.pool.length) {
          this.renderEmpty();
          return;
        }
        if (this.ptr >= this.pool.length) this.ptr = 0;
        this.current = this.pool[this.ptr];
        this.ptr += 1;
        this.render();
      },

      renderHeaderStats() {
        UI.headerExtra.innerHTML = "";
        const stats = el("div", "vocab-stats");
        stats.innerHTML =
          `<span>✅ 答对 <b>${this.correct}</b></span>` +
          `<span>🔥 连击 <b>${this.streak}</b></span>` +
          `<span>💰 金币 <b>${coinBalance()}</b></span>` +
          `<span>🎯 可练 <b>${this.pool.length}</b></span>`;
        UI.headerExtra.appendChild(stats);
      },

      render() {
        this.answered = false;
        const w = this.current;
        this.renderHeaderStats();

        UI.main.innerHTML = "";
        const box = el("div", "vocab-quiz");

        const prompt = el("div", "vocab-quiz-prompt");
        if (isAudio) {
          const play = el("button", "vocab-quiz-audio", "🔊 点我听");
          play.addEventListener("click", () => playWord(w.en));
          prompt.appendChild(play);
          prompt.appendChild(el("div", "vocab-quiz-hint", "听发音，选出正确的单词"));
        } else {
          prompt.appendChild(el("div", "vocab-quiz-zh", w.zh));
          prompt.appendChild(el("div", "vocab-quiz-hint", "选出对应的英文单词"));
        }
        box.appendChild(prompt);

        const opts = el("div", "vocab-quiz-opts");
        const options = shuffle([w.en, ...chooseDistractors(w, opts.distractors)]);
        const buttons = [];
        options.forEach((en) => {
          const btn = el("button", "vocab-quiz-opt", en);
          btn.addEventListener("click", () => this.answer(w, en, btn, buttons));
          buttons.push(btn);
          opts.appendChild(btn);
        });
        box.appendChild(opts);

        const feedback = el("div", "vocab-quiz-feedback");
        box.appendChild(feedback);
        this._feedback = feedback;

        const footer = el("div", "vocab-footer");
        const nextBtn = el("button", "vocab-next", "下一题");
        nextBtn.disabled = true;
        nextBtn.addEventListener("click", () => this.next());
        footer.appendChild(nextBtn);
        const hubBtn = el("button", "vocab-done-btn", "返回词汇通");
        hubBtn.addEventListener("click", () => setScreen("hub"));
        footer.appendChild(hubBtn);
        box.appendChild(footer);
        this._nextBtn = nextBtn;

        UI.main.appendChild(box);
        if (isAudio) playWord(w.en); // 自动播一次
      },

      answer(w, chosenEn, btn, buttons) {
        if (this.answered) return;
        this.answered = true;
        const isCorrect = keyOf(chosenEn) === keyOf(w.en);
        buttons.forEach((b) => {
          b.disabled = true;
          if (keyOf(b.textContent) === keyOf(w.en)) b.classList.add("right");
          else if (b === btn) b.classList.add("wrong");
        });
        if (isCorrect) {
          this.correct += 1;
          this.streak += 1;
          addGlobalCoins(1); // 答对 1 词 = 1 金币
          Checkin.markWord(w.en);
          const p = progOf(w.en);
          setProg(w.en, { mc: p.mc + 1 }); // 熟练度信号，影响排序
        } else {
          this.streak = 0;
        }
        if (isCorrect) playWord(w.en); // 对 → 读单词
        else SFX.play("fail"); // 错 → 失败音效
        if (this._feedback) this._feedback.textContent = `${w.en} = ${w.zh}`;
        this.renderHeaderStats();
        if (this._nextBtn) this._nextBtn.disabled = false;
        if (isCorrect) {
          this.timer = setTimeout(() => this.next(), 900); // 答对自动下一题
        }
      },

      renderEmpty() {
        UI.headerExtra.innerHTML = "";
        UI.main.innerHTML = "";
        const box = el("div", "vocab-done");
        box.appendChild(el("div", "vocab-done-title", "🎉 没有需要练的词了！"));
        box.appendChild(el("div", "vocab-done-tip", "所有词都已确认认识。"));
        const acts = el("div", "vocab-done-actions");
        const hub = el("button", "vocab-done-btn primary", "返回词汇通");
        hub.addEventListener("click", () => setScreen("hub"));
        acts.appendChild(hub);
        box.appendChild(acts);
        UI.main.appendChild(box);
      },
    };
  }
  const Listen = makeChoose({ prompt: "audio", distractors: "similar" });
  const Similar = makeChoose({ prompt: "zh", distractors: "similar" });
  const Zh2en = makeChoose({ prompt: "zh", distractors: "mixed" });

  // =======================================================================
  //  单词雨（掉落 + 找出英文单词，10 分钟倒计时）
  // =======================================================================
  const RAIN_BG = [
    "linear-gradient(180deg,#fff0f0 0%,#ffd6d6 100%)",
    "linear-gradient(180deg,#fff0f8 0%,#ffd6ef 100%)",
    "linear-gradient(180deg,#f0f4ff 0%,#d6e4ff 100%)",
    "linear-gradient(180deg,#f0fff4 0%,#c8f5d8 100%)",
    "linear-gradient(180deg,#fffde7 0%,#fff0a0 100%)",
    "linear-gradient(180deg,#fff3e0 0%,#ffd6a0 100%)",
    "linear-gradient(180deg,#e0f7fa 0%,#b2ecf4 100%)",
  ];
  const Rain = {
    running: false,
    area: null,
    spawnT: null,
    tickT: null,
    raf: null,
    lastTs: 0,
    balls: [],
    endAt: 0,
    score: 0,
    streak: 0,
    target: null,
    pool: [],
    ptr: 0,
    bgIdx: 0,

    enter() {
      this.buildPool();
      if (!this.pool.length) {
        UI.main.innerHTML = "";
        const box = el("div", "vocab-done");
        box.appendChild(el("div", "vocab-done-title", "词表未加载"));
        const hub = el("button", "vocab-done-btn primary", "返回词汇通");
        hub.addEventListener("click", () => setScreen("hub"));
        const acts = el("div", "vocab-done-actions");
        acts.appendChild(hub);
        box.appendChild(acts);
        UI.main.appendChild(box);
        return;
      }
      this.ptr = 0;
      this.score = 0;
      this.streak = 0;
      this.balls = [];
      this.bgIdx = Math.floor(Math.random() * RAIN_BG.length);
      this.endAt = Date.now() + SESSION_LIMIT_MS;
      this.running = true;
      this.render();
      this.nextTarget();
      this.spawnT = setInterval(() => this.spawn(), 700);
      this.tickT = setInterval(() => this.onTick(), 500);
      this.lastTs = performance.now();
      this.raf = requestAnimationFrame((t) => this.loop(t));
    },

    buildPool() {
      if (!allWords || !allWords.length) return;
      const weekSeen = Checkin.getWeekWords();
      const unseen = [], seen = [];
      for (const w of allWords) {
        (weekSeen.has(keyOf(w.en)) ? seen : unseen).push(w);
      }
      shuffle(unseen);
      shuffle(seen);
      this.pool = [...unseen, ...seen];
    },

    nextTarget() {
      for (const b of [...this.balls]) this.removeBall(b);
      this.balls = [];
      if (this.area) this.area.innerHTML = "";
      if (!this.pool.length) return;
      const word = this.pool[this.ptr];
      this.ptr += 1;
      if (this.ptr >= this.pool.length) {
        this.ptr = 0;
        this.buildPool();
      }
      this.target = word;
      if (this._taskEl) {
        this._taskEl.innerHTML =
          `<span class="rain-find-hint">找出</span><span class="rain-find-zh">${word.zh}</span>`;
      }
      // Cycle background color
      this.bgIdx = (this.bgIdx + 1) % RAIN_BG.length;
      if (this.area) {
        this.area.style.background = RAIN_BG[this.bgIdx];
        // Splash: Chinese word blooms from center and fades
        const splash = el("div", "rain-splash", word.zh);
        this.area.appendChild(splash);
        setTimeout(() => splash.remove(), 900);
      }
      this.spawn();
    },

    _spawnBall(en) {
      const key = keyOf(en);
      const item = el("button", "vocab-rain-ball", en);
      const isPhrase = /\s/.test(en.trim());
      try {
        item._audio = new Audio(
          `audio/${isPhrase ? "phrase" : "en"}/${slugify(en)}.mp3`
        );
        item._audio.preload = "auto";
      } catch (err) {
        /* ignore */
      }
      this.area.appendChild(item);
      const areaW = this.area.clientWidth || 320;
      const areaH = this.area.clientHeight || 420;
      const w = item.offsetWidth || 72;
      const h = item.offsetHeight || 36;
      const x = Math.random() * Math.max(0, areaW - w);
      const vy = areaH / (5 + Math.random() * 3);
      const isTarget = key === keyOf(this.target ? this.target.en : "");
      const ball = { el: item, key, x, y: -h, vy, w, h, isTarget };
      item.addEventListener("click", () => this.hit(ball));
      item.style.transform = `translate(${x}px, ${-h}px)`;
      this.balls.push(ball);
      return ball;
    },

    spawn() {
      if (!this.running || !this.area || !this.target) return;
      if (this.balls.length >= 8) return;
      const targetKey = keyOf(this.target.en);
      const onScreenKeys = new Set(this.balls.map((b) => b.key));
      if (!onScreenKeys.has(targetKey)) {
        this._spawnBall(this.target.en);
        return;
      }
      const total = allWords.length;
      for (let tries = 0; tries < total; tries += 1) {
        const w = allWords[Math.floor(Math.random() * total)];
        const k = keyOf(w.en);
        if (k === targetKey || onScreenKeys.has(k)) continue;
        this._spawnBall(w.en);
        return;
      }
    },

    loop(ts) {
      if (!this.running) return;
      const dt = Math.min(0.05, (ts - this.lastTs) / 1000 || 0);
      this.lastTs = ts;
      const areaH = this.area ? this.area.clientHeight || 420 : 420;
      const areaW = this.area ? this.area.clientWidth || 320 : 320;
      for (const b of this.balls) b.y += b.vy * dt;
      for (let i = 0; i < this.balls.length; i += 1) {
        for (let j = i + 1; j < this.balls.length; j += 1) {
          const a = this.balls[i];
          const c = this.balls[j];
          if (
            Math.abs((a.x + a.w / 2) - (c.x + c.w / 2)) * 2 < a.w + c.w &&
            Math.abs((a.y + a.h / 2) - (c.y + c.h / 2)) * 2 < a.h + c.h
          ) {
            const avg = (a.vy + c.vy) / 2;
            a.vy = avg;
            c.vy = avg;
          }
        }
      }
      for (const b of [...this.balls]) {
        if (b.y > areaH) {
          if (b.isTarget && !b._done) {
            b.y = -b.h;
            b.x = Math.random() * Math.max(0, areaW - b.w);
            b.el.style.transform = `translate(${b.x}px, ${b.y}px)`;
          } else {
            this.removeBall(b);
          }
          continue;
        }
        b.el.style.transform = `translate(${b.x}px, ${b.y}px)`;
      }
      this.raf = requestAnimationFrame((t) => this.loop(t));
    },

    removeBall(ball) {
      if (ball._removed) return;
      ball._removed = true;
      const i = this.balls.indexOf(ball);
      if (i >= 0) this.balls.splice(i, 1);
      if (ball.el) ball.el.remove();
    },

    hit(ball) {
      if (!this.running || ball._done || !this.target) return;
      ball._done = true;
      const correct = ball.key === keyOf(this.target.en);
      const r = ball.el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top;
      if (correct) {
        this.score += 1;
        this.streak += 1;
        addGlobalCoins(1);
        Checkin.markWord(ball.key);
        this.readBall(ball);
        SFX.play("coin");
        floatText(cx, cy, "+1", "plus");
        ball.el.classList.add("hit-right");
        ball.vy = 0;
        setTimeout(() => {
          this.removeBall(ball);
          if (this.running) this.nextTarget();
        }, 400);
      } else {
        this.streak = 0;
        addGlobalCoins(-2);
        SFX.play("fail");
        floatText(cx, cy, "-2金币", "minus");
        ball.el.classList.add("hit-wrong");
        setTimeout(() => this.removeBall(ball), 200);
      }
      this.renderStats();
    },

    readBall(ball) {
      const en = ball.el.textContent;
      try {
        if (ball.el._audio) {
          ball.el._audio.currentTime = 0;
          ball.el._audio.play().catch(() => speak(en));
        } else {
          speak(en);
        }
      } catch (err) {
        speak(en);
      }
    },

    render() {
      UI.main.innerHTML = "";
      const task = el("div", "vocab-rain-task");
      task.innerHTML = `<span class="rain-find-hint">准备中…</span>`;
      this._taskEl = task;
      UI.main.appendChild(task);
      const area = el("div", "vocab-rain-area");
      this.area = area;
      UI.main.appendChild(area);
      const footer = el("div", "vocab-footer");
      const hub = el("button", "vocab-done-btn", "返回词汇通");
      hub.addEventListener("click", () => {
        this.stop();
        setScreen("hub");
      });
      footer.appendChild(hub);
      UI.main.appendChild(footer);
      this.renderStats();
    },

    renderStats() {
      UI.headerExtra.innerHTML = "";
      const stats = el("div", "vocab-stats");
      stats.innerHTML =
        `<span>⭐ 得分 <b>${this.score}</b></span>` +
        `<span>🔥 连击 <b>${this.streak}</b></span>` +
        `<span>💰 金币 <b>${coinBalance()}</b></span>` +
        `<span>⏳ 剩余 <b>${fmtClock(this.endAt - Date.now())}</b></span>`;
      UI.headerExtra.appendChild(stats);
    },

    onTick() {
      if (Date.now() >= this.endAt) {
        this.end();
        return;
      }
      this.renderStats();
    },

    end() {
      this.stop();
      UI.main.innerHTML = "";
      const box = el("div", "vocab-done");
      box.appendChild(el("div", "vocab-done-title", "⏰ 时间到！"));
      box.appendChild(
        el("div", "vocab-done-tip", `本次得分 ${this.score}，玩了 10 分钟，休息一下～`)
      );
      const hub = el("button", "vocab-done-btn primary", "返回词汇通");
      hub.addEventListener("click", () => setScreen("hub"));
      const acts = el("div", "vocab-done-actions");
      acts.appendChild(hub);
      box.appendChild(acts);
      UI.main.appendChild(box);
    },

    stop() {
      this.running = false;
      clearInterval(this.spawnT);
      clearInterval(this.tickT);
      if (this.raf) cancelAnimationFrame(this.raf);
      this.spawnT = this.tickT = this.raf = null;
      this.balls = [];
      if (this.area) this.area.innerHTML = "";
    },
  };

  // =======================================================================
  //  打地鼠（显示中文，打帽子上是正确单词的地鼠；形近词干扰，10 分钟）
  // =======================================================================
  const HOLE_COUNT = 6;
  const Mole = {
    running: false,
    holes: [],
    target: null,
    pool: [],
    ptr: 0,
    endAt: 0,
    score: 0,
    streak: 0,
    tickT: null,

    enter() {
      this.buildPool();
      if (!this.pool.length) {
        this.pool = allWords.slice();
      }
      shuffle(this.pool);
      this.ptr = 0;
      this.score = 0;
      this.streak = 0;
      this.frozen = false;
      this.endAt = Date.now() + SESSION_LIMIT_MS;
      this.running = true;
      this.render();
      this.newRound();
      this.tickT = setInterval(() => {
        if (Date.now() >= this.endAt) {
          this.end();
          return;
        }
        this.renderStats();
      }, 500);
    },

    buildPool() {
      const weekSeen = Checkin.getWeekWords(); // 本周已在打卡中出现过的词
      const cand = allWords.filter((w) => progOf(w.en).lv < GOAL);
      cand.sort((a, b) => {
        // 本周未见过的词优先（排前面）
        const seenA = weekSeen.has(keyOf(a.en)) ? 1 : 0;
        const seenB = weekSeen.has(keyOf(b.en)) ? 1 : 0;
        if (seenA !== seenB) return seenA - seenB;
        const pa = progOf(a.en);
        const pb = progOf(b.en);
        const fa = pa.f ? 0 : 1;
        const fb = pb.f ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return pa.lv - pb.lv;
      });
      this.pool = cand;
    },

    options(target, count) {
      const out = [target.en];
      const used = new Set([keyOf(target.en)]);
      for (const en of pickSimilarWords(target, count - 1)) {
        const k = keyOf(en);
        if (used.has(k)) continue;
        used.add(k);
        out.push(en);
      }
      for (const w of shuffle(allWords.slice())) {
        if (out.length >= count) break;
        const k = keyOf(w.en);
        if (used.has(k)) continue;
        used.add(k);
        out.push(w.en);
      }
      return shuffle(out).slice(0, count);
    },

    render() {
      UI.main.innerHTML = "";
      const zh = el("div", "vocab-mole-target", "…");
      this._zhEl = zh;
      UI.main.appendChild(zh);
      const grid = el("div", "vocab-mole-grid");
      this.holes = [];
      for (let i = 0; i < HOLE_COUNT; i += 1) {
        const hole = el("div", "vocab-mole-hole");
        const mole = el("button", "vocab-mole");
        // 帽子（显示单词）
        const hat = el("div", "mole-hat");
        const label = el("span", "vocab-mole-label");
        hat.appendChild(label);
        mole.appendChild(hat);
        // 脸（眼睛 + 鼻子 + 耳朵）
        const face = el("div", "mole-face");
        face.appendChild(el("div", "mole-ear mole-ear-l"));
        face.appendChild(el("div", "mole-ear mole-ear-r"));
        const eyes = el("div", "mole-eyes");
        eyes.appendChild(el("span", "mole-eye"));
        eyes.appendChild(el("span", "mole-eye"));
        face.appendChild(eyes);
        face.appendChild(el("div", "mole-nose"));
        mole.appendChild(face);
        hole.appendChild(mole);
        grid.appendChild(hole);
        const h = { el: mole, labelEl: label, word: "", up: false, tUp: null, tDown: null };
        mole.addEventListener("click", () => this.hitHole(h));
        this.holes.push(h);
        this.startHole(h);
      }
      UI.main.appendChild(grid);
      const footer = el("div", "vocab-footer");
      const hub = el("button", "vocab-done-btn", "返回词汇通");
      hub.addEventListener("click", () => {
        this.stop();
        setScreen("hub");
      });
      footer.appendChild(hub);
      UI.main.appendChild(footer);
      this.renderStats();
    },

    renderStats() {
      UI.headerExtra.innerHTML = "";
      const stats = el("div", "vocab-stats");
      stats.innerHTML =
        `<span>⭐ 得分 <b>${this.score}</b></span>` +
        `<span>🔥 连击 <b>${this.streak}</b></span>` +
        `<span>💰 金币 <b>${coinBalance()}</b></span>` +
        `<span>⏳ 剩余 <b>${fmtClock(this.endAt - Date.now())}</b></span>`;
      UI.headerExtra.appendChild(stats);
    },

    newRound() {
      if (this.ptr >= this.pool.length) this.ptr = 0;
      this.target = this.pool[this.ptr];
      this.ptr += 1;
      const opts = this.options(this.target, HOLE_COUNT);
      this.holes.forEach((h, i) => {
        h.word = opts[i % opts.length];
        if (h.up) h.labelEl.textContent = h.word;
      });
      if (this._zhEl) this._zhEl.textContent = this.target.zh;
    },

    startHole(h) {
      const cycle = () => {
        if (!this.running) return;
        if (this.frozen) {
          // 冻结中（读单词）：地鼠先不冒头，稍后再试。
          h.tDown = setTimeout(cycle, 300);
          return;
        }
        h.up = true;
        h.el.classList.add("up");
        h.labelEl.textContent = h.word;
        h.tUp = setTimeout(() => {
          h.up = false;
          h.el.classList.remove("up");
          h.tDown = setTimeout(cycle, 700 + Math.random() * 1200);
        }, 1500 + Math.random() * 1600);
      };
      h.tDown = setTimeout(cycle, 300 + Math.random() * 1500);
    },

    hitHole(h) {
      if (!this.running || this.frozen || !h.up || !this.target) return;
      if (keyOf(h.word) === keyOf(this.target.en)) {
        this.score += 1;
        this.streak += 1;
        addGlobalCoins(1); // 打对 1 词 = 1 金币
        Checkin.markWord(this.target.en);
        const p = progOf(this.target.en);
        setProg(this.target.en, { mc: p.mc + 1 });
        SFX.play("coin");
        const rr = h.el.getBoundingClientRect();
        floatText(rr.left + rr.width / 2, rr.top, "+1", "plus");
        h.el.classList.add("bonk-right");
        this.renderStats();
        // 冻结：正确的这只地鼠留在屏幕上，其它收回；读完整个单词后再进入下一题。
        this.frozen = true;
        this.holes.forEach((hh) => {
          if (hh === h) return; // 打中的这只保持冒头
          hh.up = false;
          hh.el.classList.remove("up");
        });
        // 停掉这只自己的起落定时器，避免读音期间它自动缩回。
        clearTimeout(h.tUp);
        clearTimeout(h.tDown);
        playWordThen(this.target.en, () => {
          if (!this.running) return;
          h.el.classList.remove("bonk-right");
          h.up = false;
          h.el.classList.remove("up"); // 读完后收回
          this.frozen = false;
          this.newRound();
          this.startHole(h); // 恢复这只地鼠的起落循环
        });
      } else {
        this.streak = 0;
        addGlobalCoins(-2); // 打错扣 2 金币
        SFX.play("fail");
        const rw = h.el.getBoundingClientRect();
        floatText(rw.left + rw.width / 2, rw.top, "-2金币", "minus");
        h.el.classList.add("bonk-wrong");
        setTimeout(() => h.el.classList.remove("bonk-wrong"), 300);
        this.renderStats();
      }
    },

    end() {
      this.stop();
      UI.main.innerHTML = "";
      const box = el("div", "vocab-done");
      box.appendChild(el("div", "vocab-done-title", "⏰ 时间到！"));
      box.appendChild(el("div", "vocab-done-tip", `本次得分 ${this.score}，玩了 10 分钟，休息一下～`));
      const hub = el("button", "vocab-done-btn primary", "返回词汇通");
      hub.addEventListener("click", () => setScreen("hub"));
      const acts = el("div", "vocab-done-actions");
      acts.appendChild(hub);
      box.appendChild(acts);
      UI.main.appendChild(box);
    },

    stop() {
      this.running = false;
      clearInterval(this.tickT);
      this.tickT = null;
      this.holes.forEach((h) => {
        clearTimeout(h.tUp);
        clearTimeout(h.tDown);
      });
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

  // ---- 用户 / 云同步 UI ----
  // 取名弹窗。opts: { title, desc, initial, okText, allowCancel, onDone(name) }
  function askName(opts) {
    opts = opts || {};
    const body = el("div", "vocab-name-body");
    const input = el("input", "vocab-name-input");
    input.type = "text";
    input.placeholder = "输入名字，如：小明";
    input.maxLength = 20;
    if (opts.initial) input.value = opts.initial;
    const submit = (close) => {
      const nm = input.value.trim();
      if (!nm) {
        input.focus();
        return;
      }
      close();
      if (opts.onDone) opts.onDone(nm);
    };
    body.appendChild(input);
    const actions = [];
    if (opts.allowCancel) actions.push({ text: "取消" });
    actions.push({ text: opts.okText || "开始", primary: true, onClick: submit });
    vocabModal({
      title: opts.title || "欢迎！请输入名字",
      desc: opts.desc || "用名字保存进度与金币，换设备输入同样的名字即可继续。",
      body,
      actions,
      dismissable: !!opts.allowCancel,
      onOpen: (box, close) => {
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") submit(close);
        });
        setTimeout(() => input.focus(), 50);
      },
    });
  }

  // 手动上传：用本地数据强制覆盖云端。
  async function pushToCloud() {
    try {
      const res = await fetch(apiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          v: 2,
          goal: GOAL,
          name: user ? user.name : "",
          coins: getCoins(),
          words: prog,
          checkin: Checkin.toJSON(),
        }),
        cache: "no-store",
      });
      if (!res.ok) return false;
      serverOk = true;
      return true;
    } catch (err) {
      serverOk = false;
      return false;
    }
  }
  // 手动下载：用云端数据覆盖本地。返回 'ok' | 'empty' | 'error'。
  async function pullFromCloud() {
    const remote = await serverLoad();
    if (!remote) return "error";
    if (!Object.keys(remote.words).length) return "empty";
    prog = remote.words;
    setCoins(remote.coins);
    writeLocal();
    return "ok";
  }
  // 切换/新建用户：先把当前用户刷到云，再以新名字重载。
  async function switchUser(nm) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await serverSave(); // 保存上一个用户
    setUser(nm);
    UI.main.innerHTML = '<div class="vocab-loading">正在切换用户…</div>';
    try {
      localStorage.removeItem(LS_KEY); // 清掉上个用户的本地镜像
    } catch (err) {
      /* ignore */
    }
    Checkin.reset(); // 清掉上个用户的打卡状态
    prog = {};
    setCoins(0);
    await loadProgress(false); // 新用户不落 seed
    setScreen("hub");
  }

  function openSyncMenu() {
    const body = el("div", "vocab-sync-body");
    const who = el("div", "vocab-sync-who");
    who.textContent = "👤 " + (user ? user.name : "未登录") + (serverOk ? "  ☁️已连接" : "  离线");
    body.appendChild(who);
    const status = el("div", "vocab-sync-status");
    const setStatus = (t, ok) => {
      status.textContent = t;
      status.className = "vocab-sync-status " + (ok === true ? "ok" : ok === false ? "err" : "");
    };
    const row = (label, cb) => {
      const b = el("button", "vocab-sync-row", label);
      b.type = "button";
      b.addEventListener("click", cb);
      body.appendChild(b);
    };
    row("⬆️  上传到云（本地覆盖云端）", async () => {
      setStatus("上传中…");
      const ok = await pushToCloud();
      setStatus(ok ? "✅ 已上传到云端" : "❌ 上传失败（检查网络 / PHP）", ok);
    });
    row("⬇️  从云下载（云端覆盖本地）", async () => {
      setStatus("下载中…");
      const r = await pullFromCloud();
      if (r === "ok") {
        setStatus("✅ 已从云端下载", true);
        setScreen("hub");
      } else if (r === "empty") {
        setStatus("云端暂无该用户的数据", false);
      } else {
        setStatus("❌ 下载失败（检查网络 / PHP）", false);
      }
    });
    body.appendChild(status);
    const close = vocabModal({
      title: "☁️ 数据同步",
      body,
      actions: [
        {
          text: "🔄 切换 / 改名",
          onClick: (c) => {
            c();
            askName({
              title: "切换用户",
              desc: "输入名字以切换到该用户的进度（换设备输入同名即可继续）。",
              initial: user ? user.name : "",
              okText: "切换",
              allowCancel: true,
              onDone: (nm) => switchUser(nm),
            });
          },
        },
        { text: "关闭", primary: true },
      ],
    });
    return close;
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
    await Promise.all([loadCurriculum(), loadCategories()]);
    SFX.preload();
    user = loadUser();
    if (!user) {
      // 首次进入：先让孩子取名，再按名字加载/同步进度。
      askName({
        onDone: async (nm) => {
          setUser(nm);
          UI.main.innerHTML = '<div class="vocab-loading">正在加载进度…</div>';
          await loadProgress(true); // 首个用户：无数据时可用 seed 兜底
          setScreen("hub");
        },
      });
      return;
    }
    await loadProgress(true);
    setScreen("hub");
  }

  function pause() {
    try {
      if (currentAudio) currentAudio.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch (err) {
      /* ignore */
    }
    Listen.clearTimer();
    Similar.clearTimer();
    Zh2en.clearTimer();
    Rain.stop();
    Mole.stop();
    // 离开前把待保存的进度立即刷到服务器。
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      serverSave();
    }
  }

  if (UI.back) {
    UI.back.addEventListener("click", async () => {
      const ok =
        typeof window.AppConfirm === "function"
          ? await window.AppConfirm("确定要返回吗？", { okText: "返回", cancelText: "继续" })
          : true;
      if (!ok) return;
      pause();
      if (screen === "hub") goHome();
      else setScreen("hub");
    });
  }
  if (UI.export) {
    UI.export.addEventListener("click", exportProgress);
  }

  // 页面加载时静默初始化：读取用户名 + 拉取服务器进度，让 practice/exam
  // 中的正确答案也能即时同步到服务器（不需要先打开词汇通界面）。
  async function initSync() {
    if (!user) user = loadUser();
    if (!user) return; // 还没取名，无法同步
    Checkin.load(null); // 从 localStorage 恢复打卡状态
    const remote = await serverLoad(); // 同时设置 serverOk
    if (remote && Object.keys(remote.words).length) {
      prog = remote.words;
      // 金币：本地与云端取最大（两端都可能有新增）
      const remoteCoins = remote.coins;
      const localCoins = getCoins();
      if (remoteCoins > localCoins) setCoins(remoteCoins);
      Checkin._mergeRemote(remote.checkin);
      writeLocal();
    }
  }

  window.VocabApp = { start, pause };
  window.VocabCheckin = Checkin; // 供 app.js / exam.js 计入每日打卡
  window.VocabSync = { init: initSync }; // 供 index.js 页面加载时调用
})();
