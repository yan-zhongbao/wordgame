const UI = {
  dayLabel: document.getElementById("dayLabel"),
  progressFill: document.getElementById("progressFill"),
  starPreview: document.getElementById("starPreview"),
  scoreValue: document.getElementById("scoreValue"),
  coinValue: document.getElementById("coinValue"),
  stageLabel: document.getElementById("stageLabel"),
  prompt: document.getElementById("prompt"),
  hint: document.getElementById("hint"),
  audioBtn: document.getElementById("audioBtn"),
  updateBtn: document.getElementById("updateBtn"),
  backBtn: document.getElementById("backBtn"),
  options: document.getElementById("options"),
  statusText: document.getElementById("statusText"),
  primaryBtn: document.getElementById("primaryBtn"),
  overlay: document.getElementById("overlay"),
  panelTitle: document.getElementById("panelTitle"),
  panelBody: document.getElementById("panelBody"),
  panelActions: document.getElementById("panelActions"),
};

const STORAGE_KEYS = {
  review: "wg-review",
  spell: "wg-spell-stats",
  lastDay: "wg-last-day",
  dayStats: "wg-day-stats",
  coins: "wg-td-coins",
};

const Stage = {
  REVIEW: 0,
  NEW: 1,
  SPELL: 2,
  MEANING: 3,
};

const StageMeta = {
  [Stage.REVIEW]: { label: "Stage 0 · 复活区", status: "复活区" },
  [Stage.NEW]: { label: "Stage 1 · 新词学习", status: "新词学习" },
  [Stage.SPELL]: { label: "Stage 2 · 拼写训练", status: "拼写训练" },
  [Stage.MEANING]: { label: "Stage 3 · 中文意思", status: "中文意思" },
};

const Data = {
  words: [],
  byDay: new Map(),

  async load(options = {}) {
    const { noCache = false } = options;
    const response = await fetch("words.json", { cache: noCache ? "no-store" : "default" });
    if (!response.ok) {
      throw new Error("词库加载失败，请检查 words.json。");
    }
    this.words = await response.json();
    this.byDay = this.groupByDay(this.words);
  },

  groupByDay(words) {
    const map = new Map();
    for (const item of words) {
      if (!map.has(item.day)) {
        map.set(item.day, []);
      }
      map.get(item.day).push(item);
    }
    return map;
  },

  getDay(day) {
    if (this.byDay.has(day)) {
      return this.byDay.get(day);
    }
    const numDay = Number(day);
    if (Number.isFinite(numDay) && this.byDay.has(numDay)) {
      return this.byDay.get(numDay);
    }
    const strDay = String(day);
    if (this.byDay.has(strDay)) {
      return this.byDay.get(strDay);
    }
    return [];
  },
};

const Storage = {
  load(key, fallback) {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    try {
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  },

  save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  remove(key) {
    localStorage.removeItem(key);
  },
};

let hintToken = 0;
let swRegistration = null;
let coinBalance = 0;
let audioUnlockBound = false;
let bootInFlight = false;

const COIN_REWARD = 5;

function loadCoins() {
  const raw = localStorage.getItem(STORAGE_KEYS.coins);
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function saveCoins() {
  try {
    localStorage.setItem(STORAGE_KEYS.coins, String(coinBalance));
  } catch (err) {
    // ignore
  }
}

function updateCoinUI() {
  if (UI.coinValue) {
    UI.coinValue.textContent = String(coinBalance);
  }
  saveCoins();
}

function addCoins(amount) {
  coinBalance += amount;
  updateCoinUI();
}

function speakEnglish(text) {
  if (!("speechSynthesis" in window)) {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function bindAudioUnlock() {
  if (audioUnlockBound) {
    return;
  }
  audioUnlockBound = true;
  const handler = () => {
    AudioPlayer.unlocked = true;
    AudioPlayer.autoBlocked = false;
    if (Engine.state.currentItem) {
      AudioPlayer.playForItem(Engine.state.currentItem);
    }
    window.removeEventListener("pointerdown", handler, true);
    window.removeEventListener("touchstart", handler, true);
  };
  window.addEventListener("pointerdown", handler, true);
  window.addEventListener("touchstart", handler, true);
}

function flashHint(message, duration = 1200) {
  const token = (hintToken += 1);
  const prev = UI.hint.textContent;
  UI.hint.textContent = message;
  setTimeout(() => {
    if (hintToken === token) {
      UI.hint.textContent = prev;
    }
  }, duration);
}

function setPromptText(text) {
  UI.prompt.classList.remove("prompt-split");
  UI.prompt.textContent = text || "";
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatPhraseDisplay(text) {
  let html = "";
  const raw = String(text || "");
  for (const ch of raw) {
    if (ch === " ") {
      html += '<span class="phrase-gap"></span>';
    } else if (ch === "/") {
      html += '<span class="phrase-slash">/</span>';
    } else {
      html += escapeHtml(ch);
    }
  }
  return html;
}

function renderSpellPrompt(zh, display) {
  const zhText = zh || "";
  const displayHtml = formatPhraseDisplay(display || "");
  if (!displayHtml) {
    setPromptText(zhText);
    return;
  }
  UI.prompt.classList.add("prompt-split");
  UI.prompt.innerHTML = `<span class="prompt-zh">${escapeHtml(zhText)}</span><span class="prompt-en">${displayHtml}</span>`;
}

function getLastDay() {
  const stored = Storage.load(STORAGE_KEYS.lastDay, 1);
  const day = Number(stored);
  if (!Number.isInteger(day) || day < 1 || day > 21) {
    return 1;
  }
  return day;
}

function setLastDay(day) {
  const safeDay = Math.min(21, Math.max(1, Number(day) || 1));
  Storage.save(STORAGE_KEYS.lastDay, safeDay);
  return safeDay;
}

function getStarCount(errors) {
  if (errors <= 0) {
    return 3;
  }
  if (errors <= 2) {
    return 2;
  }
  if (errors < 5) {
    return 1;
  }
  return 0;
}

function formatStars(count) {
  if (count <= 0) {
    return "☆☆☆";
  }
  if (count === 1) {
    return "★☆☆";
  }
  if (count === 2) {
    return "★★☆";
  }
  return "★★★";
}

function updateStarPreview(errors) {
  if (!UI.starPreview) {
    return;
  }
  const count = getStarCount(errors);
  const stars = Array.from(UI.starPreview.querySelectorAll(".star"));
  if (!stars.length) {
    UI.starPreview.textContent = formatStars(count);
    return;
  }
  stars.forEach((star, index) => {
    star.classList.toggle("dim", index >= count);
  });
}

function getDayFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get("day"));
  if (!Number.isFinite(value)) {
    return null;
  }
  const day = Math.floor(value);
  if (day < 1 || day > 21) {
    return null;
  }
  return day;
}

function getInitialDay() {
  return getLastDay();
}

const AudioPlayer = {
  audio: null,
  unlocked: false,
  autoBlocked: false,

  ensure() {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = "auto";
    }
  },

  slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/['’]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  },

  srcForItem(item) {
    if (!item || !item.en) {
      return "";
    }
    const slug = this.slugify(item.en);
    if (!slug) {
      return "";
    }
    const folder = item.kind === "phrase" ? "phrase" : "en";
    return `audio/${folder}/${slug}.mp3`;
  },

  updateButton(item) {
    const src = this.srcForItem(item);
    UI.audioBtn.disabled = !src;
    UI.audioBtn.dataset.src = src;
  },

  async playForItem(item, { auto = false } = {}) {
    const src = this.srcForItem(item);
    if (!src) {
      flashHint("暂无音频文件");
      return;
    }
    this.ensure();
    try {
      this.audio.onerror = () => {
        if (!auto) {
          flashHint("音频播放失败");
        }
      };
      if (this.audio.src !== src) {
        this.audio.src = src;
      } else {
        this.audio.currentTime = 0;
      }
      await this.audio.play();
      this.unlocked = true;
      this.autoBlocked = false;
    } catch (err) {
      if (auto && err && err.name === "NotAllowedError") {
        this.autoBlocked = true;
        flashHint("浏览器阻止自动播放，请点击喇叭按钮");
      }
    }
  },

  autoPlayForItem(item) {
    if (this.autoBlocked && !this.unlocked) {
      return;
    }
    this.playForItem(item, { auto: true });
  },
};

const SoundFX = {
  context: null,

  ensure() {
    if (!this.context && (window.AudioContext || window.webkitAudioContext)) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
    }
  },

  async unlock() {
    this.ensure();
    if (!this.context) {
      return;
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  },

  playTone({ frequency, duration, type = "sine", gain = 0.12 }) {
    this.ensure();
    if (!this.context) {
      return Promise.resolve();
    }
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gainNode.gain.setValueAtTime(gain, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
    return new Promise((resolve) => {
      oscillator.onended = () => {
        oscillator.disconnect();
        gainNode.disconnect();
        resolve();
      };
    });
  },

  async playSuccess() {
    await this.unlock();
    await this.playTone({ frequency: 740, duration: 0.12, type: "sine", gain: 0.14 });
    await this.playTone({ frequency: 960, duration: 0.14, type: "sine", gain: 0.12 });
  },

  async playError() {
    await this.unlock();
    await this.playTone({ frequency: 240, duration: 0.2, type: "triangle", gain: 0.16 });
  },
};

const Review = {
  records: {},

  load() {
    this.records = Storage.load(STORAGE_KEYS.review, {});
  },

  save() {
    Storage.save(STORAGE_KEYS.review, this.records);
  },

  makeId(item) {
    return `${item.day}:${item.en.toLowerCase()}`;
  },

  todayKey() {
    return new Date().toISOString().slice(0, 10);
  },

  addDays(key, days) {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  },

  getDueItems() {
    const today = this.todayKey();
    return Object.values(this.records)
      .filter((record) => record.nextReviewAt <= today)
      .map((record) => ({
        day: record.day,
        en: record.en,
        zh: record.zh,
        kind: record.kind,
      }));
  },

  recordWrong(item, type = "Meaning") {
    const id = this.makeId(item);
    const today = this.todayKey();
    const record = this.records[id] || {
      id,
      day: item.day,
      en: item.en,
      zh: item.zh,
      kind: item.kind,
      wrongCount: 0,
      streakCorrect: 0,
      nextReviewAt: today,
      lastWrongType: type,
    };
    record.wrongCount += 1;
    record.streakCorrect = 0;
    record.lastWrongType = type;
    record.nextReviewAt = this.addDays(today, 1);
    this.records[id] = record;
    this.save();
  },

  recordCorrect(item) {
    const id = this.makeId(item);
    const record = this.records[id];
    if (!record) {
      return;
    }
    record.streakCorrect = (record.streakCorrect || 0) + 1;
    let gap = 2;
    if (record.streakCorrect === 2) {
      gap = 4;
    } else if (record.streakCorrect >= 3) {
      gap = 7;
    }
    record.nextReviewAt = this.addDays(this.todayKey(), gap);
    this.records[id] = record;
    this.save();
  },

  getAllWrongItems() {
    return Object.values(this.records)
      .filter((record) => record.wrongCount >= 1)
      .map((record) => ({
        day: record.day,
        en: record.en,
        zh: record.zh,
        kind: record.kind,
      }));
  },

  reset() {
    this.records = {};
    Storage.remove(STORAGE_KEYS.review);
  },
};

const SpellStats = {
  records: {},

  load() {
    this.records = Storage.load(STORAGE_KEYS.spell, {});
  },

  save() {
    Storage.save(STORAGE_KEYS.spell, this.records);
  },

  makeId(item) {
    return `${item.day}:${item.en.toLowerCase()}`;
  },

  ensure(item) {
    const id = this.makeId(item);
    if (!this.records[id]) {
      this.records[id] = {
        id,
        day: item.day,
        en: item.en,
        wrongCount: 0,
        consecutiveWrong: 0,
        consecutiveCorrect: 0,
        lastWrongType: "",
        totalAttempts: 0,
      };
    }
    return this.records[id];
  },

  get(item) {
    return this.ensure(item);
  },

  record(item, isCorrect, modeType) {
    const record = this.ensure(item);
    record.totalAttempts += 1;
    if (isCorrect) {
      record.consecutiveCorrect += 1;
      record.consecutiveWrong = 0;
    } else {
      record.wrongCount += 1;
      record.consecutiveWrong += 1;
      record.consecutiveCorrect = 0;
      record.lastWrongType = modeType;
    }
    this.records[record.id] = record;
    this.save();
    return record;
  },

  reset() {
    this.records = {};
    Storage.remove(STORAGE_KEYS.spell);
  },
};

const DayStats = {
  records: {},

  load() {
    this.records = Storage.load(STORAGE_KEYS.dayStats, {});
  },

  save() {
    Storage.save(STORAGE_KEYS.dayStats, this.records);
  },

  set(day, stats) {
    if (!day) {
      return;
    }
    this.records[String(day)] = stats;
    this.save();
  },

  get(day) {
    return this.records[String(day)];
  },
};

const Question = {
  shuffle(list) {
    const array = [...list];
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  },

  unique(list) {
    const seen = new Set();
    const result = [];
    for (const item of list) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
    return result;
  },

  normalizeWord(word) {
    return word.toLowerCase().replace(/[^a-z]/g, "");
  },

  buildOptions(correct, pool, field, count) {
    const poolValues = this.unique(
      pool
        .map((item) => item[field])
        .filter((value) => value && value !== correct)
    );
    const shuffled = this.shuffle(poolValues);
    return [correct, ...shuffled.slice(0, count)];
  },

  recognition(item, pool, direction) {
    const isEnToZh = direction === "en-zh";
    const prompt = isEnToZh ? item.en : item.zh;
    const correct = isEnToZh ? item.zh : item.en;
    const options = this.shuffle(this.buildOptions(correct, pool, isEnToZh ? "zh" : "en", 3));
    return {
      prompt,
      correct,
      options,
      hint: isEnToZh ? "选出正确中文" : "选出正确英文",
    };
  },

  buildUnits(word) {
    const glue = [
      "eigh",
      "igh",
      "augh",
      "ough",
      "tion",
      "sion",
      "ture",
      "st",
      "er",
      "ai",
      "ay",
      "ea",
      "ee",
      "ie",
      "oa",
      "oe",
      "oo",
      "ou",
      "ow",
      "oi",
      "oy",
      "au",
      "aw",
      "ch",
      "sh",
      "th",
      "ph",
      "wh",
      "ck",
      "ng",
      "qu",
      "gh",
    ];
    const units = [];
    let i = 0;
    while (i < word.length) {
      let matched = "";
      for (const chunk of glue) {
        if (word.startsWith(chunk, i) && chunk.length > matched.length) {
          matched = chunk;
        }
      }
      if (matched) {
        units.push(matched);
        i += matched.length;
      } else {
        units.push(word[i]);
        i += 1;
      }
    }
    return units;
  },

  letterUnits(word) {
    const combos = ["gh", "st", "er", "ph", "th", "ch", "sh", "ck", "ng", "qu", "wh"];
    const units = [];
    let i = 0;
    while (i < word.length) {
      let matched = "";
      for (const combo of combos) {
        if (word.startsWith(combo, i) && combo.length > matched.length) {
          matched = combo;
        }
      }
      if (matched) {
        units.push(matched);
        i += matched.length;
      } else {
        units.push(word[i]);
        i += 1;
      }
    }
    return units;
  },

  splitUnitsByLength(units, parts) {
    const total = units.reduce((sum, unit) => sum + unit.length, 0);
    const chunks = [];
    let idx = 0;
    let acc = 0;
    for (let part = 1; part < parts; part += 1) {
      const target = (total * part) / parts;
      const start = idx;
      while (idx < units.length && acc < target) {
        acc += units[idx].length;
        idx += 1;
      }
      if (idx === start && idx < units.length) {
        idx += 1;
      }
      chunks.push(units.slice(start, idx).join(""));
    }
    chunks.push(units.slice(idx).join(""));
    return chunks.filter(Boolean);
  },

  isVowelUnit(unit) {
    return "aeiouy".includes(unit[0]);
  },

  phonicsChunks(word) {
    const units = this.buildUnits(word);
    if (units.length === 0) {
      return [];
    }
    if (units.length === 1) {
      return [units[0]];
    }
    let i = 0;
    const chunks = [];
    while (i < units.length) {
      const start = i;
      while (i < units.length && !this.isVowelUnit(units[i])) {
        i += 1;
      }
      if (i < units.length) {
        i += 1;
      }
      if (i < units.length && !this.isVowelUnit(units[i])) {
        if (i + 1 < units.length && this.isVowelUnit(units[i + 1])) {
          // leave consonant for next syllable
        } else {
          i += 1;
        }
      }
      chunks.push(units.slice(start, i).join(""));
    }
    if (chunks.length === 1 && word.length >= 5) {
      const head = units.slice(0, -1).join("");
      const tail = units[units.length - 1];
      if (head && tail) {
        return [head, tail];
      }
    }
    return chunks;
  },

  limitChunks(chunks, maxChunks) {
    if (chunks.length <= maxChunks) {
      return chunks;
    }
    const merged = [...chunks];
    while (merged.length > maxChunks) {
      const last = merged.pop();
      merged[merged.length - 1] += last;
    }
    return merged;
  },

  autoChunks(word) {
    const trimmed = word.trim().toLowerCase();
    if (trimmed.includes("-")) {
      return trimmed
        .split("-")
        .filter(Boolean)
        .flatMap((segment) => this.autoChunks(segment));
    }
    const clean = trimmed.replace(/[^a-z]/g, "");
    if (!clean) {
      return [];
    }
    if (clean.length <= 4) {
      return this.letterUnits(clean);
    }
    const units = this.buildUnits(clean);
    let chunks = this.phonicsChunks(clean);
    if (chunks.length === 1) {
      return this.letterUnits(clean);
    }
    return this.limitChunks(chunks, 4);
  },

  mutateChunk(chunk) {
    if (chunk.length < 2) {
      return null;
    }
    const vowels = "aeiou";
    const consonants = "bcdfghjklmnpqrstvwxyz";
    const letters = chunk.split("");
    const index = Math.floor(Math.random() * letters.length);
    const original = letters[index];
    let replacement = original;
    if (vowels.includes(original)) {
      const choices = vowels.replace(original, "");
      replacement = choices[Math.floor(Math.random() * choices.length)];
    } else {
      replacement = consonants[Math.floor(Math.random() * consonants.length)];
    }
    letters[index] = replacement;
    return letters.join("");
  },

  makeDistractors(chunks, count = 3) {
    const base = chunks.filter((chunk) => chunk.length >= 2);
    const existing = new Set(chunks.map((chunk) => chunk.toLowerCase()));
    const result = [];
    let tries = 0;
    while (result.length < count && tries < 40) {
      const pick = base[Math.floor(Math.random() * base.length)] || chunks[0];
      const mutated = pick ? this.mutateChunk(pick) : null;
      tries += 1;
      if (!mutated) {
        continue;
      }
      const key = mutated.toLowerCase();
      if (existing.has(key) || result.includes(mutated)) {
        continue;
      }
      result.push(mutated);
    }
    return result;
  },

  tokenizePhrase(en) {
    const tokens = [];
    let buffer = "";
    const pushWord = () => {
      if (buffer) {
        tokens.push({ type: "word", text: buffer });
        buffer = "";
      }
    };
    for (const ch of String(en || "")) {
      if (/[a-z]/i.test(ch)) {
        buffer += ch;
        continue;
      }
      if (ch === "/") {
        pushWord();
        tokens.push({ type: "slash" });
        continue;
      }
      if (ch === "-" || /\s/.test(ch)) {
        pushWord();
        if (!tokens.length || tokens[tokens.length - 1].type !== "space") {
          tokens.push({ type: "space" });
        }
        continue;
      }
      pushWord();
    }
    pushWord();
    return tokens;
  },

  buildChunkPlan(item) {
    if (Array.isArray(item.chunks) && item.chunks.length) {
      const chunks = item.chunks;
      const slotPlan = chunks.map((_, index) => ({ type: "chunk", index }));
      return { chunks, slotPlan };
    }
    const en = item.en || "";
    if (item.kind === "phrase" || /\s|\//.test(en)) {
      const tokens = this.tokenizePhrase(en);
      const chunks = [];
      const slotPlan = [];
      tokens.forEach((token) => {
        if (token.type === "word") {
          const parts = this.autoChunks(token.text);
          parts.forEach((part) => {
            const index = chunks.length;
            chunks.push(part);
            slotPlan.push({ type: "chunk", index });
          });
          return;
        }
        if (token.type === "space") {
          if (!slotPlan.length || slotPlan[slotPlan.length - 1].type !== "gap") {
            slotPlan.push({ type: "gap" });
          }
          return;
        }
        if (token.type === "slash") {
          slotPlan.push({ type: "slash" });
        }
      });
      if (chunks.length) {
        return { chunks, slotPlan };
      }
    }
    const chunks = this.autoChunks(en);
    const slotPlan = chunks.map((_, index) => ({ type: "chunk", index }));
    return { chunks, slotPlan };
  },

  spelling(item) {
    const { chunks, slotPlan } = this.buildChunkPlan(item);
    const distractors = this.makeDistractors(chunks, Math.min(3, Math.max(1, chunks.length - 1)));
    const tiles = this.shuffle([...chunks, ...distractors]);
    const baseHint = "拖拽字母/音素完成拼写";
    return {
      prompt: item.zh || "请拼写英文",
      target: item.en,
      targetNormalized: this.normalizeWord(item.en),
      chunks,
      tiles,
      hint: item.pos ? `${item.pos} · ${baseHint}` : baseHint,
      slotPlan,
    };
  },

  phonemeSelect(item) {
    return this.spelling(item);
  },

  letterOrder(item) {
    const { chunks, slotPlan } = this.buildChunkPlan(item);
    const targetNormalized = this.normalizeWord(item.en);
    const tiles = this.shuffle([...chunks]);
    return {
      target: item.en,
      targetNormalized,
      chunks,
      tiles,
      slotPlan,
    };
  },

  randomLetter() {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    return alphabet[Math.floor(Math.random() * alphabet.length)];
  },

  applyTemplate(template, letters) {
    let index = 0;
    return template.replace(/[a-z]/gi, () => letters[index++] || "");
  },

  missingLetter(item) {
    const target = this.normalizeWord(item.en);
    const letters = target.split("");
    const missingCount = target.length >= 6 ? 2 : 1;
    const missingIndices = [];
    while (missingIndices.length < missingCount && missingIndices.length < letters.length) {
      const index = Math.floor(Math.random() * letters.length);
      if (!missingIndices.includes(index)) {
        missingIndices.push(index);
      }
    }
    missingIndices.sort((a, b) => a - b);
    const displayLetters = letters.map((letter, index) =>
      missingIndices.includes(index) ? "_" : letter
    );
    const template = item.en ? item.en.toLowerCase() : target;
    const display = this.applyTemplate(template, displayLetters.join("")).split("");
    const templateIndices = [];
    for (let i = 0; i < template.length; i += 1) {
      if (/[a-z]/i.test(template[i])) {
        templateIndices.push(i);
      }
    }
    const missingTemplateIndices = missingIndices.map((index) => templateIndices[index]);
    const options = [...missingIndices.map((index) => letters[index])];
    while (options.length < Math.min(5, letters.length + 2)) {
      options.push(this.randomLetter());
    }
    return {
      target,
      display,
      missingIndices,
      missingTemplateIndices,
      options: this.shuffle(options),
    };
  },

  mutateWord(word) {
    if (word.length < 3) {
      return null;
    }
    const actions = ["swap", "replace", "drop", "insert"];
    const action = actions[Math.floor(Math.random() * actions.length)];
    if (action === "swap" && word.length >= 3) {
      const idx = Math.floor(Math.random() * (word.length - 1));
      const arr = word.split("");
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      return arr.join("");
    }
    if (action === "replace") {
      const idx = Math.floor(Math.random() * word.length);
      const arr = word.split("");
      let letter = this.randomLetter();
      while (letter === arr[idx]) {
        letter = this.randomLetter();
      }
      arr[idx] = letter;
      return arr.join("");
    }
    if (action === "drop" && word.length > 3) {
      const idx = Math.floor(Math.random() * word.length);
      const arr = word.split("");
      arr.splice(idx, 1);
      return arr.join("");
    }
    if (action === "insert") {
      const idx = Math.floor(Math.random() * (word.length + 1));
      const arr = word.split("");
      arr.splice(idx, 0, this.randomLetter());
      return arr.join("");
    }
    return null;
  },

  realVsFake(item) {
    const template = item.en || "";
    const target = this.normalizeWord(item.en);
    const correct = template.toLowerCase();
    const fakes = new Set();
    let tries = 0;
    while (fakes.size < 3 && tries < 40) {
      const fake = this.mutateWord(target);
      if (fake && fake !== target) {
        const display = template
          ? this.applyTemplate(template.toLowerCase(), fake)
          : fake;
        fakes.add(display);
      }
      tries += 1;
    }
    const options = this.shuffle([correct, ...Array.from(fakes)]);
    return {
      correct,
      options,
    };
  },

  fixWrong(item) {
    const target = this.normalizeWord(item.en);
    const letters = target.split("");
    const vowels = "aeiou";
    const indices = letters
      .map((letter, index) => ({ letter, index }))
      .filter((entry) => vowels.includes(entry.letter));
    const pick = indices.length
      ? indices[Math.floor(Math.random() * indices.length)]
      : { index: Math.floor(Math.random() * letters.length), letter: letters[0] };
    let wrongLetter = this.randomLetter();
    while (wrongLetter === letters[pick.index]) {
      wrongLetter = this.randomLetter();
    }
    const wrongLetters = [...letters];
    wrongLetters[pick.index] = wrongLetter;
    const options = [letters[pick.index]];
    while (options.length < 4) {
      const letter = this.randomLetter();
      if (!options.includes(letter)) {
        options.push(letter);
      }
    }
    const wrongWord = item.en
      ? this.applyTemplate(item.en.toLowerCase(), wrongLetters.join(""))
      : wrongLetters.join("");
    return {
      target,
      wrongWord,
      wrongIndex: pick.index,
      correctLetter: letters[pick.index],
      options: this.shuffle(options),
    };
  },

  extractCloze(en) {
    const parts = en.trim().split(/\s+/);
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const raw = parts[i];
      if (!raw || raw.includes("/") || raw.includes(".")) {
        continue;
      }
      const cleaned = raw.replace(/[^a-z-]/gi, "");
      if (cleaned.length < 2) {
        continue;
      }
      const promptParts = [...parts];
      promptParts[i] = raw.replace(cleaned, "___");
      return {
        prompt: promptParts.join(" "),
        answer: cleaned,
      };
    }
    return null;
  },

  meaningLock(item, pool) {
    const cloze = this.extractCloze(item.en);
    if (!cloze) {
      return null;
    }
    const wordPool = pool.filter((entry) => entry.kind === "word");
    const options = this.shuffle(this.buildOptions(cloze.answer, wordPool, "en", 3));
    return {
      prompt: cloze.prompt,
      correct: cloze.answer,
      options,
      hint: item.zh || "选出正确单词",
    };
  },

  canMeaningLock(item) {
    return Boolean(this.extractCloze(item.en));
  },
};

const SPELL_MODE_CYCLE = [
  "missing_letter",
  "phoneme_select",
  "letter_order",
  "real_vs_fake",
  "fix_wrong",
];

const FLASH_MODE = "flash_spelling";

function primarySpellMode(item) {
  return "letter_order";
}

function remedialSpellModes(primaryMode) {
  return SPELL_MODE_CYCLE.filter((modeType) => modeType !== primaryMode);
}

function spellTaskKey(task) {
  if (!task || !task.item) {
    return "";
  }
  return `${task.item.day}:${task.item.en.toLowerCase()}`;
}

function isSameSpellItem(a, b) {
  const key = spellTaskKey(a);
  if (!key) {
    return false;
  }
  return key === spellTaskKey(b);
}

function isSpellingCandidate(item) {
  if (!item || !item.en) {
    return false;
  }
  const clean = item.en.toLowerCase().replace(/[^a-z- ]/g, "");
  if (!clean || !/[a-z]/.test(clean)) {
    return false;
  }
  return Question.normalizeWord(item.en).length >= 3;
}

function isMeaningCandidate(item) {
  if (item.kind !== "phrase") {
    return false;
  }
  return Question.canMeaningLock(item);
}

function makeSpellTask(item, modeType, { primary = false } = {}) {
  return {
    item,
    modeType,
    isPrimary: primary,
    reviewRecorded: false,
    remedialScheduled: false,
  };
}

function makeSpellTasksForItem(item, modes = SPELL_MODE_CYCLE, { primary = false } = {}) {
  return modes.map((modeType) => makeSpellTask(item, modeType, { primary }));
}

function makeFlashTask(item) {
  return {
    item,
    modeType: FLASH_MODE,
    isPrimary: false,
    reviewRecorded: false,
    remedialScheduled: false,
  };
}

function buildSpellTasks(dayItems) {
  return dayItems
    .filter(isSpellingCandidate)
    .map((item) => makeSpellTask(item, primarySpellMode(item), { primary: true }));
}

function stageRequiresCorrect(stage) {
  return true;
}

function wrongTypeForStage(stage) {
  if (stage === Stage.SPELL) {
    return "Spelling";
  }
  if (stage === Stage.MEANING) {
    return "Phrase";
  }
  return "Meaning";
}

function buildStageQueues(day) {
  const dayItems = Data.getDay(day);
  return {
    [Stage.REVIEW]: Review.getDueItems(),
    [Stage.NEW]: dayItems,
    [Stage.SPELL]: buildSpellTasks(dayItems),
    [Stage.MEANING]: dayItems.filter(isMeaningCandidate),
  };
}

function buildStageOrder(queues) {
  const order = [];
  if (queues[Stage.REVIEW].length) {
    order.push(Stage.REVIEW);
  }
  if (queues[Stage.NEW].length) {
    order.push(Stage.NEW);
  }
  if (queues[Stage.SPELL].length) {
    order.push(Stage.SPELL);
  }
  if (queues[Stage.MEANING].length) {
    order.push(Stage.MEANING);
  }
  return order;
}

const Engine = {
  state: {
    day: 1,
    stage: Stage.REVIEW,
    stageOrder: [],
    stageIndex: 0,
    stageQueue: [],
    queues: {},
    spellCycles: new Map(),
    flashToken: 0,
    errors: 0,
    score: 0,
    stageTotal: 0,
    stageCleared: 0,
    stageAnswered: 0,
    currentItem: null,
    currentQuestion: null,
    spelling: null,
    spellMode: null,
    currentTask: null,
    currentModeType: "",
    currentWrongRecorded: false,
  },

  start(day) {
    const safeDay = setLastDay(day);
    const queues = buildStageQueues(safeDay);
    const stageOrder = buildStageOrder(queues);
    if (stageOrder.length === 0) {
      showNotice("当前关卡没有可用单词。");
      return;
    }
    const stage = stageOrder[0];
    this.state = {
      day: safeDay,
      stage,
      stageOrder,
      stageIndex: 0,
      stageQueue: [...queues[stage]],
      queues,
      spellCycles: new Map(),
      flashToken: 0,
      errors: 0,
      score: 0,
      stageTotal: queues[stage].length,
      stageCleared: 0,
      stageAnswered: 0,
      currentItem: null,
      currentQuestion: null,
      spelling: null,
      spellMode: null,
      currentTask: null,
      currentModeType: "",
      currentWrongRecorded: false,
    };
    UI.dayLabel.textContent = String(safeDay);
    UI.primaryBtn.textContent = "重新开始";
    this.updateProgress();
    this.nextTurn();
  },

  startReviewOnly(day) {
    const safeDay = setLastDay(day);
    const reviewItems = Review.getAllWrongItems();
    if (!reviewItems.length) {
      showNotice("今日没有需要复习的单词。");
      return;
    }
    const reviewTasks = buildSpellTasks(reviewItems);
    if (!reviewTasks.length) {
      showNotice("今日没有需要复习的单词。");
      return;
    }
    this.state = {
      day: safeDay,
      stage: Stage.SPELL,
      stageOrder: [Stage.SPELL],
      stageIndex: 0,
      stageQueue: [...reviewTasks],
      queues: { [Stage.SPELL]: reviewTasks },
      spellCycles: new Map(),
      flashToken: 0,
      errors: 0,
      score: 0,
      stageTotal: reviewTasks.length,
      stageCleared: 0,
      stageAnswered: 0,
      currentItem: null,
      currentQuestion: null,
      spelling: null,
      spellMode: null,
      currentTask: null,
      currentModeType: "",
      currentWrongRecorded: false,
    };
    UI.dayLabel.textContent = String(safeDay);
    UI.primaryBtn.textContent = "重新开始";
    this.updateProgress();
    this.nextTurn();
  },

  nextTurn() {
    while (this.state.stageQueue.length === 0) {
      if (this.state.stageIndex >= this.state.stageOrder.length - 1) {
        this.finish();
        return;
      }
      this.state.stageIndex += 1;
      this.state.stage = this.state.stageOrder[this.state.stageIndex];
      this.state.stageQueue = [...this.state.queues[this.state.stage]];
      this.state.stageTotal = this.state.stageQueue.length;
      this.state.stageCleared = 0;
      this.state.stageAnswered = 0;
    }
    const entry = this.state.stageQueue[0];
    this.renderQuestion(entry);
  },

  renderQuestion(entry, { preserveWrong = false } = {}) {
    const stage = this.state.stage;
    const item = stage === Stage.SPELL ? entry.item : entry;
    this.state.currentItem = item;
    this.state.currentQuestion = null;
    this.state.spelling = null;
    UI.prompt.classList.remove("missing-display");
    if (!preserveWrong) {
      this.state.currentWrongRecorded = false;
    }
    this.state.currentTask = entry;
    this.state.currentModeType = stage === Stage.SPELL ? entry.modeType : "";
    AudioPlayer.updateButton(item);

    if (stage === Stage.SPELL) {
      this.renderSpellTask(entry);
      this.updateProgress();
      AudioPlayer.autoPlayForItem(item);
      return;
    }

    if (stage === Stage.MEANING) {
      const question = Question.meaningLock(item, Data.words);
      if (!question) {
        this.state.stageQueue.shift();
        this.nextTurn();
        return;
      }
      this.state.currentQuestion = question;
      setPromptText(item.zh || question.prompt);
      UI.hint.textContent = item.zh ? `补全短语：${question.prompt}` : question.hint;
      this.renderOptions(question.options, question.correct);
      this.updateProgress();
      return;
    }

    const direction =
      stage === Stage.REVIEW
        ? Math.random() < 0.5
          ? "en-zh"
          : "zh-en"
        : Math.random() < 0.25
          ? "zh-en"
          : "en-zh";
    const question = Question.recognition(item, Data.words, direction);
    this.state.currentQuestion = question;
    setPromptText(question.prompt);
    UI.hint.textContent = question.hint;
    this.renderOptions(question.options, question.correct);
    this.updateProgress();
    if (stage === Stage.NEW) {
      AudioPlayer.autoPlayForItem(item);
    }
  },

  renderSpellTask(task) {
    const { modeType, item } = task;
    this.state.spellMode = null;
    this.state.spelling = null;

    if (modeType === "phoneme_select") {
      const question = Question.phonemeSelect(item);
      this.state.currentQuestion = question;
      setPromptText(item.zh || item.en || "");
      UI.hint.textContent = "按顺序选择音素";
      this.renderSpelling(question);
      this.state.spellMode = { modeType, task };
      return;
    }

    if (modeType === "letter_order") {
      const question = Question.letterOrder(item);
      this.state.currentQuestion = question;
      setPromptText(item.zh || item.en || "");
      UI.hint.textContent = "按顺序选择字母";
      this.renderSpelling(question);
      this.state.spellMode = { modeType, task };
      return;
    }

    if (modeType === "missing_letter") {
      const question = Question.missingLetter(item);
      this.state.currentQuestion = question;
      renderSpellPrompt(item.zh || item.en || "", question.display.join(""));
      UI.prompt.classList.add("missing-display");
      UI.hint.textContent = "填空";
      this.renderMissingLetter(question);
      this.state.spellMode = {
        modeType,
        task,
        filled: [...question.display],
        nextIndex: 0,
        promptZh: item.zh || item.en || "",
      };
      return;
    }

    if (modeType === "real_vs_fake") {
      const question = Question.realVsFake(item);
      this.state.currentQuestion = question;
      setPromptText(item.zh || item.en || "");
      UI.hint.textContent = "选出正确拼写";
      this.renderOptions(question.options, question.correct);
      this.state.spellMode = { modeType, task };
      return;
    }

    if (modeType === "fix_wrong") {
      const question = Question.fixWrong(item);
      this.state.currentQuestion = question;
      setPromptText(item.zh || item.en || "");
      UI.hint.textContent = "点选错误字母";
      this.state.spellMode = {
        modeType,
        task,
        selectedIndex: null,
      };
      this.renderFixWrong(question);
      return;
    }

    if (modeType === FLASH_MODE) {
      const question = Question.phonemeSelect(item);
      this.state.currentQuestion = question;
      renderSpellPrompt(item.zh || item.en || "", item.en || "");
      UI.hint.textContent = "先记住";
      UI.options.classList.remove("builder-mode");
      UI.options.innerHTML = "";
      const token = (this.state.flashToken += 1);
      setTimeout(() => {
        if (this.state.flashToken !== token) {
          return;
        }
        setPromptText(item.zh || item.en || "");
        UI.hint.textContent = "开始拼写";
        this.renderSpelling(question);
      }, 1600);
      this.state.spellMode = { modeType, task };
    }
  },

  renderOptions(options, correct, onPick = null) {
    UI.options.classList.remove("builder-mode");
    UI.options.innerHTML = "";
    for (const option of options) {
      const button = document.createElement("button");
      button.className = "option";
      button.textContent = option;
      button.addEventListener("click", () => {
        const handler = onPick || this.handleChoiceAnswer.bind(this);
        handler(button, option === correct, correct);
      });
      UI.options.appendChild(button);
    }
  },

  renderMissingLetter(question) {
    UI.options.classList.remove("builder-mode");
    UI.options.innerHTML = "";
    for (const option of question.options) {
      const button = document.createElement("button");
      button.className = "option";
      button.textContent = option;
      button.addEventListener("click", () => this.handleMissingLetterPick(option));
      UI.options.appendChild(button);
    }
  },

  renderFixWrong(question) {
    UI.options.classList.remove("builder-mode");
    UI.options.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "fix-panel";

    const wordRow = document.createElement("div");
    wordRow.className = "fix-word";
    const letters = question.wrongWord.split("");
    letters.forEach((letter, index) => {
      const isLetter = /[a-z]/i.test(letter);
      const button = document.createElement("button");
      button.className = "fix-letter";
      button.textContent = letter;
      if (!isLetter) {
        button.classList.add("ghost");
        button.disabled = true;
      } else if (this.state.spellMode && this.state.spellMode.selectedIndex === index) {
        button.classList.add("selected");
      }
      if (isLetter) {
        button.addEventListener("click", () => this.handleFixWrongSelect(index));
      }
      wordRow.appendChild(button);
    });

    const optionRow = document.createElement("div");
    optionRow.className = "fix-options";
    question.options.forEach((letter) => {
      const button = document.createElement("button");
      button.className = "option";
      button.textContent = letter;
      button.addEventListener("click", () => this.handleFixWrongReplace(letter));
      optionRow.appendChild(button);
    });

    panel.appendChild(wordRow);
    panel.appendChild(optionRow);
    UI.options.appendChild(panel);
  },

  renderSpelling(question) {
    UI.options.classList.add("builder-mode");
    UI.options.innerHTML = "";
    const builder = document.createElement("div");
    builder.className = "builder";
    const slots = document.createElement("div");
    slots.className = "slots";
    const tiles = document.createElement("div");
    tiles.className = "tiles";
    builder.appendChild(slots);
    builder.appendChild(tiles);
    UI.options.appendChild(builder);

    const tileButtons = new Map();
    question.tiles.forEach((tileText, index) => {
      const button = document.createElement("button");
      button.className = "tile";
      button.textContent = tileText;
      button.addEventListener("click", () => this.pickSpellingTile(index));
      tiles.appendChild(button);
      tileButtons.set(index, button);
    });

    this.state.spelling = {
      targetNormalized: question.targetNormalized,
      chunks: question.chunks,
      tiles: question.tiles,
      selected: new Array(question.chunks.length).fill(undefined),
      tileButtons,
      slotsEl: slots,
      recordedWrong: false,
      slotPlan:
        question.slotPlan || question.chunks.map((_, index) => ({ type: "chunk", index })),
    };
    this.updateSpellingSlots();
  },

  async handleMissingLetterPick(letter) {
    const mode = this.state.spellMode;
    const question = this.state.currentQuestion;
    if (!mode || !question || mode.modeType !== "missing_letter") {
      return;
    }
    const fillIndices = question.missingTemplateIndices || question.missingIndices || [];
    const nextIndex = mode.nextIndex;
    if (nextIndex >= fillIndices.length) {
      return;
    }
    const fillIndex = fillIndices[nextIndex];
    mode.filled[fillIndex] = letter;
    mode.nextIndex += 1;
    renderSpellPrompt(mode.promptZh || "", mode.filled.join(""));
    if (mode.nextIndex >= fillIndices.length) {
      const filledWord = mode.filled.join("");
      const isCorrect = Question.normalizeWord(filledWord) === question.target;
      await this.resolveSpellTask(mode.task, isCorrect);
    }
  },

  handleFixWrongSelect(index) {
    const mode = this.state.spellMode;
    const question = this.state.currentQuestion;
    if (!mode || !question || mode.modeType !== "fix_wrong") {
      return;
    }
    mode.selectedIndex = index;
    this.renderFixWrong(question);
  },

  async handleFixWrongReplace(letter) {
    const mode = this.state.spellMode;
    const question = this.state.currentQuestion;
    if (!mode || !question || mode.modeType !== "fix_wrong") {
      return;
    }
    if (mode.selectedIndex === null) {
      flashHint("先点一个错误字母");
      return;
    }
    const letters = question.wrongWord.split("");
    letters[mode.selectedIndex] = letter;
    const fixed = letters.join("");
    const isCorrect = Question.normalizeWord(fixed) === question.target;
    await this.resolveSpellTask(mode.task, isCorrect);
  },

  pickSpellingTile(tileId) {
    const spelling = this.state.spelling;
    if (!spelling) {
      return;
    }
    if (spelling.selected.includes(tileId)) {
      return;
    }
    const slotIndex = spelling.selected.findIndex((id) => id === undefined);
    if (slotIndex < 0) {
      return;
    }
    spelling.selected[slotIndex] = tileId;
    const button = spelling.tileButtons.get(tileId);
    if (button) {
      button.classList.add("used");
      button.disabled = true;
    }
    this.updateSpellingSlots();
    if (spelling.selected.every((id) => id !== undefined)) {
      this.checkSpelling();
    }
  },

  removeSpellingTile(index) {
    const spelling = this.state.spelling;
    if (!spelling) {
      return;
    }
    const tileId = spelling.selected[index];
    if (tileId === undefined) {
      return;
    }
    spelling.selected[index] = undefined;
    const button = spelling.tileButtons.get(tileId);
    if (button) {
      button.classList.remove("used");
      button.disabled = false;
    }
    this.updateSpellingSlots();
  },

  updateSpellingSlots() {
    const spelling = this.state.spelling;
    if (!spelling) {
      return;
    }
    spelling.slotsEl.innerHTML = "";
    const plan = spelling.slotPlan || spelling.chunks.map((_, index) => ({ type: "chunk", index }));
    plan.forEach((entry) => {
      if (entry.type === "gap") {
        const gap = document.createElement("span");
        gap.className = "slot-gap";
        spelling.slotsEl.appendChild(gap);
        return;
      }
      if (entry.type === "slash") {
        const sep = document.createElement("span");
        sep.className = "slot-sep";
        sep.textContent = "/";
        spelling.slotsEl.appendChild(sep);
        return;
      }
      const index = entry.index;
      const tileId = spelling.selected[index];
      const slot = document.createElement("button");
      slot.className = "slot";
      if (tileId === undefined) {
        slot.textContent = "___";
        slot.classList.add("empty");
        slot.disabled = true;
      } else {
        slot.textContent = spelling.tiles[tileId];
        slot.addEventListener("click", () => this.removeSpellingTile(index));
      }
      spelling.slotsEl.appendChild(slot);
    });
  },

  async checkSpelling() {
    const spelling = this.state.spelling;
    if (!spelling) {
      return;
    }
    if (spelling.selected.some((id) => id === undefined)) {
      return;
    }
    const answer = spelling.selected.map((tileId) => spelling.tiles[tileId]).join("");
    const normalized = Question.normalizeWord(answer);
    const isCorrect = normalized === spelling.targetNormalized;
    await this.resolveSpellTask(this.state.currentTask, isCorrect);
  },

  async handleChoiceAnswer(button, isCorrect, correct) {
    const buttons = Array.from(UI.options.querySelectorAll(".option"));
    for (const btn of buttons) {
      btn.disabled = true;
      if (btn.textContent === correct) {
        btn.classList.add("correct");
      }
    }
    const isSpellStage = this.state.stage === Stage.SPELL;
    if (!isCorrect) {
      button.classList.add("wrong");
      UI.hint.textContent = isSpellStage ? "再试一次" : "再来一次";
    } else {
      UI.hint.textContent = "答对了！";
    }

    await this.advanceChoice(isCorrect);
  },

  async advanceChoice(isCorrect) {
    const item = this.state.currentItem;
    const stage = this.state.stage;
    if (stage === Stage.SPELL) {
      await this.resolveSpellTask(this.state.currentTask, isCorrect);
      return;
    }
    if (isCorrect) {
      this.state.score += 1;
      if (stage === Stage.REVIEW) {
        Review.recordCorrect(item);
      }
      this.state.stageCleared += 1;
      this.updateProgress();
      addCoins(COIN_REWARD);
      await SoundFX.playSuccess();
      this.state.stageQueue.shift();
      this.nextTurn();
      return;
    }
    this.state.score -= 1;
    this.state.errors += 1;
    if (!this.state.currentWrongRecorded) {
      Review.recordWrong(item, wrongTypeForStage(stage));
      this.state.currentWrongRecorded = true;
    }
    this.updateProgress();
    await SoundFX.playError();
    this.renderQuestion(item, { preserveWrong: true });
  },

  enqueueSpellTasks(tasks) {
    if (!tasks.length) {
      return;
    }
    const queue = this.state.stageQueue;
    const shuffled = Question.shuffle(tasks);
    for (const task of shuffled) {
      const positions = [];
      for (let i = 1; i <= queue.length; i += 1) {
        const prev = queue[i - 1];
        const next = queue[i];
        if (isSameSpellItem(prev, task) || isSameSpellItem(next, task)) {
          continue;
        }
        positions.push(i);
      }
      const insertAt = positions.length
        ? positions[Math.floor(Math.random() * positions.length)]
        : queue.length;
      queue.splice(insertAt, 0, task);
      this.state.stageTotal += 1;
    }
  },

  getSpellCycle(id, cycle) {
    const existing = this.state.spellCycles.get(id) || {
      cycle,
      completed: 0,
      wrongs: 0,
      remedialUsed: false,
    };
    if (existing.cycle !== cycle) {
      existing.cycle = cycle;
      existing.completed = 0;
      existing.wrongs = 0;
    }
    this.state.spellCycles.set(id, existing);
    return existing;
  },

  async resolveSpellTask(task, isCorrect) {
    if (!task || !task.item) {
      return;
    }
    SpellStats.record(task.item, isCorrect, task.modeType);
    if (!isCorrect && task.isPrimary && !task.remedialScheduled) {
      task.remedialScheduled = true;
      const extraModes = remedialSpellModes(task.modeType);
      if (extraModes.length) {
        const extraTasks = makeSpellTasksForItem(task.item, extraModes);
        this.enqueueSpellTasks(extraTasks);
      }
    }

    if (isCorrect) {
      this.state.score += 1;
      this.state.stageCleared += 1;
      this.updateProgress();
      addCoins(COIN_REWARD);
      await SoundFX.playSuccess();
      this.state.stageQueue.shift();
      this.nextTurn();
      return;
    }

    this.state.score -= 1;
    this.state.errors += 1;
    if (!task.reviewRecorded) {
      Review.recordWrong(task.item, wrongTypeForStage(Stage.SPELL));
      task.reviewRecorded = true;
    }
    this.updateProgress();
    await SoundFX.playError();
    this.renderQuestion(task, { preserveWrong: true });
  },

  updateProgress() {
    const total = Math.max(this.state.stageTotal, 1);
    const done = stageRequiresCorrect(this.state.stage)
      ? this.state.stageCleared
      : this.state.stageAnswered;
    const percent = Math.min(100, Math.round((done / total) * 100));
    UI.progressFill.style.width = `${percent}%`;
    UI.stageLabel.textContent = StageMeta[this.state.stage].label;
    UI.statusText.textContent = `${StageMeta[this.state.stage].status} ${done}/${total} · 错误 ${this.state.errors} 次`;
    UI.scoreValue.textContent = String(this.state.score);
    updateStarPreview(this.state.errors);
  },

  starsForErrors(errors) {
    return formatStars(getStarCount(errors));
  },

  finish() {
    const stars = this.starsForErrors(this.state.errors);
    DayStats.set(this.state.day, {
      stars,
      score: this.state.score,
      errors: this.state.errors,
      updatedAt: new Date().toISOString(),
    });
    const body = [
      `Day ${this.state.day} 已完成`,
      `星级：${stars}`,
      `分数：${this.state.score}`,
      `错误：${this.state.errors} 次`,
      "错词已加入复习区。",
    ].join("<br />");
    UI.panelTitle.textContent = "闯关完成";
    UI.panelBody.innerHTML = body;
    UI.panelActions.innerHTML = "";

    const restart = document.createElement("button");
    restart.className = "primary";
    restart.textContent = "再来一次";
    restart.addEventListener("click", () => {
      hideOverlay();
      showStartScreen(this.state.day);
    });

    const tdMode = document.createElement("button");
    tdMode.className = "primary ghost";
    tdMode.textContent = "进入单词大战作业";
    tdMode.addEventListener("click", () => {
      window.location.href = `td.html?day=${this.state.day}`;
    });

    const snakeMode = document.createElement("button");
    snakeMode.className = "primary ghost";
    snakeMode.textContent = "进入贪吃蛇记忆";
    snakeMode.addEventListener("click", () => {
      window.location.href = `snake.html?day=${this.state.day}`;
    });

    const searchMode = document.createElement("button");
    searchMode.className = "primary ghost";
    searchMode.textContent = "进入单词寻宝";
    searchMode.addEventListener("click", () => {
      window.location.href = `wordsearch.html?day=${this.state.day}`;
    });

    const close = document.createElement("button");
    close.className = "primary ghost";
    close.textContent = "关闭";
    close.addEventListener("click", () => {
      hideOverlay();
    });

    UI.panelActions.appendChild(restart);
    UI.panelActions.appendChild(tdMode);
    UI.panelActions.appendChild(snakeMode);
    UI.panelActions.appendChild(searchMode);
    UI.panelActions.appendChild(close);
    showOverlay();
    AudioPlayer.updateButton(null);
    speakEnglish("Great, you finished all the words.");
  },
};

function showOverlay() {
  UI.overlay.classList.remove("hidden");
}

function hideOverlay() {
  UI.overlay.classList.add("hidden");
}

function showDayPicker(selectedDay) {
  UI.panelTitle.textContent = "选择关卡";
  UI.panelBody.textContent = "点击关卡编号进行选择。";
  UI.panelActions.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "day-grid";
  for (let day = 1; day <= 21; day += 1) {
    const button = document.createElement("button");
    button.className = "day-button";
    button.textContent = String(day);
    if (day === selectedDay) {
      button.classList.add("correct");
    }
    button.addEventListener("click", () => {
      const nextDay = setLastDay(day);
      showStartScreen(nextDay);
    });
    grid.appendChild(button);
  }
  UI.panelActions.appendChild(grid);

  const back = document.createElement("button");
  back.className = "primary ghost";
  back.textContent = "返回";
  back.addEventListener("click", () => showStartScreen(selectedDay));
  UI.panelActions.appendChild(back);
  showOverlay();
}

function showStartScreen(selectedDay = null) {
  AudioPlayer.updateButton(null);
  const day = selectedDay ? setLastDay(selectedDay) : getLastDay();
  const queues = buildStageQueues(day);
  const dueCount = queues[Stage.REVIEW].length;
  const dayItems = queues[Stage.NEW].length;
  const spellCount = queues[Stage.SPELL].length;
  const meaningCount = queues[Stage.MEANING].length;
  UI.dayLabel.textContent = String(day);
  updateStarPreview(0);
  UI.panelTitle.textContent = `准备开始 · Day ${day}`;
  UI.panelBody.innerHTML = [
    "先复习错词，再学习新词。",
    `复习错词：${dueCount} 个`,
    `新词：${dayItems} 个`,
    `拼写训练：${spellCount} 个`,
    `中文意思：${meaningCount} 个`,
  ].join("<br />");
  UI.panelActions.innerHTML = "";

  const start = document.createElement("button");
  start.className = "primary";
  start.textContent = "开始闯关";
  start.addEventListener("click", () => {
    hideOverlay();
    Engine.start(day);
  });

  const reviewOnly = document.createElement("button");
  reviewOnly.className = "primary ghost";
  reviewOnly.textContent = "复习关卡";
  reviewOnly.addEventListener("click", () => {
    hideOverlay();
    Engine.startReviewOnly(day);
  });

  const reset = document.createElement("button");
  reset.className = "primary ghost";
  reset.textContent = "重置错误计数";
  reset.addEventListener("click", () => {
    Review.reset();
    SpellStats.reset();
    flashHint("已清空错误记录");
    showStartScreen(day);
  });

  UI.panelActions.appendChild(start);
  UI.panelActions.appendChild(reviewOnly);
  UI.panelActions.appendChild(reset);

  const back = document.createElement("button");
  back.className = "primary ghost";
  back.textContent = "返回关卡列表";
  back.addEventListener("click", () => {
    window.location.href = "index.html";
  });
  UI.panelActions.appendChild(back);
  showOverlay();
}

function showError(message) {
  UI.panelTitle.textContent = "加载失败";
  UI.panelBody.textContent = message;
  UI.panelActions.innerHTML = "";
  showOverlay();
}

function showNotice(message) {
  UI.panelTitle.textContent = "提示";
  UI.panelBody.textContent = message;
  UI.panelActions.innerHTML = "";
  const close = document.createElement("button");
  close.className = "primary";
  close.textContent = "知道了";
  close.addEventListener("click", () => {
    hideOverlay();
  });
  UI.panelActions.appendChild(close);
  showOverlay();
}

UI.primaryBtn.addEventListener("click", () => {
  showStartScreen(getInitialDay());
});

UI.audioBtn.addEventListener("click", () => {
  AudioPlayer.unlocked = true;
  AudioPlayer.autoBlocked = false;
  AudioPlayer.playForItem(Engine.state.currentItem);
});

UI.updateBtn?.addEventListener("click", async () => {
  if (!("serviceWorker" in navigator)) {
    flashHint("当前浏览器不支持离线更新");
    return;
  }
  flashHint("正在检查更新...");
  try {
    const registration = swRegistration || (await navigator.serviceWorker.getRegistration());
    if (!registration) {
      location.reload();
      return;
    }
    await registration.update();
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    if (registration.installing) {
      registration.installing.addEventListener("statechange", () => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      });
    }
  } catch (err) {
    flashHint("更新失败，请稍后再试");
  }
});

UI.backBtn?.addEventListener("click", () => {
  window.location.href = "index.html";
});

async function bootApp() {
  if (bootInFlight) {
    return;
  }
  bootInFlight = true;
  try {
    if ("serviceWorker" in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register("sw.js");
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          location.reload();
        });
      } catch (err) {
        // ignore sw registration errors
      }
    }
    await Data.load();
    Review.load();
    SpellStats.load();
    DayStats.load();
    coinBalance = loadCoins();
    updateCoinUI();
    bindAudioUnlock();
    const dayFromQuery = getDayFromQuery();
    if (dayFromQuery && Data.getDay(dayFromQuery).length === 0) {
      await Data.load({ noCache: true });
    }
    if (dayFromQuery) {
      Engine.start(dayFromQuery);
    } else {
      showStartScreen(getInitialDay());
    }
  } catch (err) {
    showError(err.message || "加载失败，请刷新重试。");
  } finally {
    bootInFlight = false;
  }
}

document.addEventListener("DOMContentLoaded", bootApp);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    bootApp();
    return;
  }
  const dayFromQuery = getDayFromQuery();
  if (dayFromQuery && Engine.state.day !== dayFromQuery) {
    bootApp();
  }
});
