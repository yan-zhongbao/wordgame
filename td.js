(() => {
"use strict";

const TD_ROOT = document.getElementById("tdView") || document;
const tdQuery = (selector) => TD_ROOT.querySelector(selector);
const tdQueryAll = (selector) => Array.from(TD_ROOT.querySelectorAll(selector));

const UI = {
  dayValue: tdQuery("#dayValue"),
  bagValue: tdQuery("#bagValue"),
  coinValue: tdQuery("#coinValue"),
  bossValue: tdQuery("#bossValue"),
  starBar: tdQuery("#starBar"),
  seedTray: tdQuery("#seedTray"),
  restartBtn: tdQuery("#restartBtn"),
  backBtn: tdQuery("#backBtn"),
  hoeBtn: tdQuery("#hoeBtn"),
  keyBtn: tdQuery("#keyBtn"),
  hornBtn: tdQuery("#hornBtn"),
  batonBtn: tdQuery("#batonBtn"),
  field: tdQuery("#field"),
  bagArea: tdQuery("#bagArea"),
  enemyArea: tdQuery("#enemyArea"),
  plantSlots: tdQueryAll(".plant-slot"),
  enemyLayer: tdQuery("#enemyLayer"),
  bulletLayer: tdQuery("#bulletLayer"),
  impactLayer: tdQuery("#impactLayer"),
  letterQueue: tdQuery("#letterQueue"),
  messageText: tdQuery("#messageText"),
  overlay: tdQuery("#overlay"),
  overlayTitle: tdQuery("#overlayTitle"),
  overlayBody: tdQuery("#overlayBody"),
  overlayRestart: tdQuery("#overlayRestart"),
  overlayBack: tdQuery("#overlayBack"),
};

const CONFIG = {
  bagLimit: 30,
  maxBoss: 8,
  maxTurrets: 6,
  letterSlots: 18,
  letterDropMs: 1800,
  spawnMs: 4200,
  spawnIntervalMs: 5000,
  shotIntervalMs: 1000,
  bossIntervalMs: 60000,
  maxHpPerMinute: 200,
  flashDurationMs: 1200,
  wrongRevealMs: 1000,
  slipDurationMs: 3000,
  slowDurationMs: 5000,
  slowFactor: 0.7,
  appleSplashRatio: 1 / 3,
  appleSplashRadius: 90,
  coconutPierceRatio: 0.1,
  hoeCost: 20,
  keyCost: 50,
  hornCost: 50,
  batonCost: 500,
  coinFlightMs: 4200,
  coinFadeMs: 700,
  bulletSpeed: 260,
  enemySpeed: 8,
  bossSpeed: 5,
  midSpeed: 6,
};

const FRUITS = [
  { name: "pear", label: "pear" },
  { name: "apple", label: "apple" },
  { name: "banana", label: "banana" },
  { name: "coconut", label: "coconut" },
  { name: "cucumber", label: "cucumber" },
  { name: "blueberry", label: "blueberry" },
];

const FIRE_INTERVALS = {
  pear: 500,
  apple: 1000,
  banana: 1500,
  coconut: 1000,
  cucumber: 1000,
  blueberry: 5000,
};

const TEXT = {
  brandSubtitle: "单词大战作业",
  dayLabel: "Day",
  bagLabel: "书包负担",
  coinLabel: "金币",
  bossLabel: "Boss",
  restart: "重新开始",
  back: "返回主页面",
  bagZone: "书包终点",
  bagText: "书包",
  plantZone: "种植区",
  attackZone: "攻击区",
  attackGuide: "拼写正确才会发射，错误会自损。",
  enemyZone: "敌人轨道",
  seedTitle: "种子库",
  seedHint: "拖拽种子到种植区。",
  hintTitle: "提示",
  ammoTitle: "弹药区",
  ammoHint: "拖拽字母到炮台填空。",
  restartOverlay: "再来一次",
  backOverlay: "返回主页面",
  battlefield: "战斗场景",
  startMessage: "准备开始！",
  startHint: "拖拽种子开始战斗！",
  plantBusy: "这里已经有种子或炮台了。",
  plantOk: "种子已种下，等待发芽。",
  noTurret: "请先选中一个炮台。",
  noLetters: "这里没有可用字母。",
  turretMissing: "没有炮台可以填字母。",
  turretFull: "这个炮台不缺字母。",
  toolNeedTurret: "请先选中一个炮台。",
  toolNoSlot: "这里没有炮台可移除。",
  toolNoGap: "这个炮台没有空格。",
  toolBusy: "炮台正在忙。",
  toolRemoved: "已移除炮台。",
  toolKeyUsed: "已使用钥匙填字母。",
  toolNoCoin: "金币不足。",
  toolBossLimit: "当前没有可召唤的Boss。",
  toolBossAlive: "Boss已经在场上了。",
  toolHornUsed: "号角召唤了Boss！",
  toolBatonUsed: "指挥棒启动自动填字。",
  toolNoTurret: "没有可填字的炮台。",
  correctShot: "拼写正确，发射！",
  wrongShot: "拼写错误，炮台耐久-1。",
  turretExplode: "炮台爆炸了，重新种植吧。",
  flashHint: "先记住拼写。",
  coinGain: "你打败了作业获得了金币。",
  noEnemy: "没有敌人出现。",
  bagged: "进了书包！",
  winTitle: "胜利！",
  winBody: "恭喜你通过挑战，今天作业全免了。",
  loseTitle: "失败！",
  loseBody: "书包被塞满了，继续努力再来一次。",
  loadFail: "词库加载失败，请检查words.json。",
  voiceFail: "你该去做作业了。",
  voiceBag1: "快把{NAME}做完！",
  voiceBag2: "这个作业你还没写！",
  voiceBag3: "作业堆起来啦！",
};

const STORAGE_KEYS = {
  coins: "wg-td-coins",
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
    await this.playTone({ frequency: 260, duration: 0.2, type: "triangle", gain: 0.16 });
  },

  async playCoin() {
    await this.unlock();
    await this.playTone({ frequency: 880, duration: 0.08, type: "sine", gain: 0.12 });
    await this.playTone({ frequency: 1175, duration: 0.1, type: "sine", gain: 0.1 });
  },

  async playExplosion() {
    await this.unlock();
    await this.playTone({ frequency: 220, duration: 0.16, type: "triangle", gain: 0.12 });
    await this.playTone({ frequency: 160, duration: 0.14, type: "triangle", gain: 0.1 });
  },

  async playFirework() {
    await this.unlock();
    await this.playTone({ frequency: 520, duration: 0.12, type: "sine", gain: 0.1 });
    await this.playTone({ frequency: 780, duration: 0.1, type: "sine", gain: 0.09 });
  },

  async playFruitShot(fruit) {
    await this.unlock();
    const profiles = {
      pear: [520, 640],
      apple: [620, 760],
      banana: [440, 520],
      coconut: [360, 420],
      cucumber: [560, 680],
      blueberry: [700, 840],
    };
    const tones = profiles[fruit] || [520, 640];
    for (const freq of tones) {
      await this.playTone({ frequency: freq, duration: 0.08, type: "sine", gain: 0.1 });
    }
  },
};

const AudioBank = {
  unlocked: false,
  pool: {},
  entries: {
    shot: { src: "audio/td/shot.wav", volume: 0.5, rate: 0.95, fallback: () => SoundFX.playSuccess() },
    error: { src: "audio/td/error.wav", volume: 0.5, rate: 0.95, fallback: () => SoundFX.playError() },
    coin: { src: "audio/td/coin.wav", volume: 0.6, fallback: () => SoundFX.playCoin() },
    hit1: { src: "audio/td/hit1.wav", volume: 0.45, rate: 0.96, fallback: () => SoundFX.playTone({ frequency: 320, duration: 0.06, gain: 0.1 }) },
    hit2: { src: "audio/td/hit2.wav", volume: 0.5, rate: 0.96, fallback: () => SoundFX.playTone({ frequency: 360, duration: 0.06, gain: 0.1 }) },
    hit3: { src: "audio/td/hit3.wav", volume: 0.55, rate: 0.96, fallback: () => SoundFX.playTone({ frequency: 420, duration: 0.06, gain: 0.1 }) },
    explode: { src: "audio/td/explode.wav", volume: 0.55, rate: 0.9, fallback: () => SoundFX.playExplosion() },
    firework: { src: "audio/td/firework.wav", volume: 0.6, rate: 1.05, fallback: () => SoundFX.playFirework() },
    voice_fail: { src: "audio/td/voice_fail.mp3", text: TEXT.voiceFail },
    voice_bag_1: { src: "", text: TEXT.voiceBag1 },
    voice_bag_2: { src: "audio/td/voice_bag_2.mp3", text: TEXT.voiceBag2 },
    voice_bag_3: { src: "audio/td/voice_bag_3.mp3", text: TEXT.voiceBag3 },
  },
  canSpeak() {
    return "speechSynthesis" in window;
  },
  async unlock() {
    if (this.unlocked) {
      return;
    }
    try {
      const audio = new Audio("audio/td/shot.wav");
      audio.volume = 0;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      this.unlocked = true;
    } catch (err) {
      this.unlocked = true;
    }
  },
  getAudio(key) {
    const entry = this.entries[key];
    if (!entry || !entry.src) {
      return null;
    }
    if (!this.pool[key]) {
      this.pool[key] = [];
    }
    let audio = this.pool[key].find((item) => item.paused || item.ended);
    if (!audio) {
      audio = new Audio(entry.src);
      audio.preload = "auto";
      this.pool[key].push(audio);
    }
    return audio;
  },
  getAudioFromSrc(cacheKey, src) {
    if (!src) {
      return null;
    }
    if (!this.pool[cacheKey]) {
      this.pool[cacheKey] = [];
    }
    let audio = this.pool[cacheKey].find((item) => item.paused || item.ended);
    if (!audio) {
      audio = new Audio(src);
      audio.preload = "auto";
      this.pool[cacheKey].push(audio);
    }
    return audio;
  },
  speak(text, lang = "zh-CN") {
    if (!this.canSpeak()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.9;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  },
  speakEn(text) {
    return this.speak(text, "en-US");
  },
  async play(key, textOverride) {
    const entry = this.entries[key];
    if (!entry) {
      return;
    }
    let played = false;
    let audio = null;
    if (key === "voice_bag_1" && textOverride) {
      const name = extractBagName(textOverride);
      const src = name ? VOICE_BAG_SRC[name] : "";
      if (src) {
        audio = this.getAudioFromSrc(`voice_bag_1:${name}`, src);
      }
    }
    if (!audio) {
      audio = this.getAudio(key);
    }
  if (audio) {
    if (typeof entry.volume === "number") {
      audio.volume = Math.max(0, Math.min(1, entry.volume));
    }
    if (typeof entry.rate === "number") {
      audio.playbackRate = Math.max(0.5, Math.min(1.5, entry.rate));
    }
    audio.currentTime = 0;
    try {
      const playPromise = audio.play();
      if (!playPromise) {
        played = true;
        return;
      }
      let resolveDone = null;
      const done = new Promise((resolve) => {
        resolveDone = resolve;
      });
      const handleDone = () => {
        audio.removeEventListener("ended", handleDone);
        audio.removeEventListener("error", handleDone);
        resolveDone();
      };
      audio.addEventListener("ended", handleDone);
      audio.addEventListener("error", handleDone);
      const timeoutId = window.setTimeout(handleDone, 1500);
      await playPromise;
      played = true;
      await done;
      clearTimeout(timeoutId);
    } catch (err) {
      played = false;
    }
  }
    if (played) {
      return;
    }
    const speakText = textOverride || entry.text;
    if (speakText) {
      await this.speak(speakText, "zh-CN");
    }
    if (!speakText && entry.fallback) {
      await entry.fallback();
    }
  },
};

const DragState = {
  active: null,
  targetSlot: null,
  targetBag: false,
};

function preventTouchScroll(event) {
  if (DragState.active) {
    event.preventDefault();
  }
}

const TD = {
  day: 1,
  wordPool: [],
  initialized: false,
  uiBound: false,
  reviewWeights: {},
  enemyQueue: [],
  enemies: [],
  bullets: [],
  letterQueue: [],
  slots: [],
  activeSlot: null,
  bagLoad: 0,
  coins: 0,
  bossDefeated: 0,
  bossSpawned: 0,
  bossAlive: false,
  bossTimer: 0,
  speedBoostWave: 0,
  smallHpBudget: 0,
  emptySince: 0,
  winPending: false,
  victoryActive: false,
  victoryOverlayShown: false,
  victoryTurretsLeft: 0,
  running: true,
  errors: 0,
  lastTime: 0,
  spawnTimer: 0,
  removeLeftNext: true,
};

const TASKS = [
  { name: "英语听写卷", hp: 1 },
  { name: "数学口算卷", hp: 1 },
  { name: "语文生字卷", hp: 1 },
  { name: "词语积累", hp: 1 },
  { name: "数学每日一练", hp: 1 },
  { name: "数学错题本整理", hp: 3 },
  { name: "古诗三首背诵", hp: 3 },
  { name: "语文日记", hp: 3 },
  { name: "语文手抄报", hp: 4 },
  { name: "英语手抄报", hp: 4 },
  { name: "语文周末小练笔", hp: 5 },
  { name: "英语小作文", hp: 6 },
  { name: "语文周记", hp: 6 },
  { name: "语文阅读理解专项训练", hp: 6 },
  { name: "英语单元复习卷", hp: 6 },
  { name: "数学单元复习卷", hp: 8 },
  { name: "语文单元复习卷", hp: 8 },
  { name: "英语阳光课堂", hp: 6 },
];

const BOSSES = [
  { name: "英语半期模拟测试", hp: 18 },
  { name: "数学半期模拟测试", hp: 20 },
  { name: "语文半期模拟测试", hp: 22 },
  { name: "英语期末测试", hp: 24 },
  { name: "数学期末测试", hp: 26 },
  { name: "语文期末测试", hp: 28 },
  { name: "寒假园地", hp: 30 },
  { name: "暑假园地", hp: 60 },
];

const VOICE_BAG_NAMES = [...TASKS.map((task) => task.name), ...BOSSES.map((boss) => boss.name)];
const VOICE_BAG_SRC = VOICE_BAG_NAMES.reduce((map, name, index) => {
  const fileIndex = String(index + 1).padStart(2, "0");
  map[name] = `audio/td/voice_bag_1_${fileIndex}.mp3`;
  return map;
}, {});

function extractBagName(text) {
  if (!text) {
    return "";
  }
  const match = text.match(/快把(.+?)做完/);
  return match ? match[1] : "";
}

function applyI18n() {
  TD_ROOT.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    if (TEXT[key]) {
      node.textContent = TEXT[key];
    }
  });
  TD_ROOT.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    const key = node.dataset.i18nAria;
    if (TEXT[key]) {
      node.setAttribute("aria-label", TEXT[key]);
    }
  });
}

function normalizeWord(word) {
  return word.toLowerCase().replace(/[^a-z]/g, "");
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildWordWeights() {
  const raw = localStorage.getItem("wg-review");
  let records = {};
  try {
    records = raw ? JSON.parse(raw) : {};
  } catch (err) {
    records = {};
  }
  const weights = {};
  Object.values(records).forEach((record) => {
    if (!record || !record.en) {
      return;
    }
    const key = record.en.toLowerCase();
    weights[key] = Math.min(4, 1 + (record.wrongCount || 0));
  });
  TD.reviewWeights = weights;
}

function pickWeightedWord(exclude, minLen = 0, bannedSet = null) {
  const pool = TD.wordPool;
  if (!pool.length) {
    return null;
  }
  let candidates =
    minLen > 0
      ? pool.filter((item) => normalizeWord(item.en).length >= minLen)
      : pool;
  if (bannedSet && bannedSet.size) {
    const filtered = candidates.filter((item) => !bannedSet.has(item.en.toLowerCase()));
    if (filtered.length) {
      candidates = filtered;
    }
  }
  const source = candidates.length ? candidates : pool;
  const weights = source.map((item) => {
    const key = item.en.toLowerCase();
    const base = TD.reviewWeights[key] || 1;
    return item.en === exclude ? Math.max(0.2, base * 0.2) : base;
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  let pick = Math.random() * total;
  for (let i = 0; i < source.length; i += 1) {
    pick -= weights[i];
    if (pick <= 0) {
      return source[i];
    }
  }
  return source[source.length - 1];
}

function collectActiveWords(exceptTurret) {
  const used = new Set();
  TD.slots.forEach((slot) => {
    const turret = slot.turret;
    if (!turret || turret === exceptTurret || !turret.wordItem?.en) {
      return;
    }
    used.add(turret.wordItem.en.toLowerCase());
  });
  return used;
}

function applyTemplate(template, letters) {
  let index = 0;
  return template.replace(/[a-z]/gi, () => letters[index++] || "");
}

function buildMissingTemplate(word, missingCount) {
  const template = word.toLowerCase();
  const target = normalizeWord(word);
  const letters = target.split("");
  let missingTotal = Math.min(missingCount, letters.length);
  if (letters.length > 1) {
    missingTotal = Math.min(missingTotal, letters.length - 1);
  }
  const missingIndices = [];
  while (missingIndices.length < missingTotal && missingIndices.length < letters.length) {
    const idx = Math.floor(Math.random() * letters.length);
    if (!missingIndices.includes(idx)) {
      missingIndices.push(idx);
    }
  }
  missingIndices.sort((a, b) => a - b);
  const displayLetters = letters.map((letter, index) =>
    missingIndices.includes(index) ? "_" : letter
  );
  const display = applyTemplate(template, displayLetters.join("")).split("");
  const templateIndices = [];
  for (let i = 0; i < template.length; i += 1) {
    if (/[a-z]/i.test(template[i])) {
      templateIndices.push(i);
    }
  }
  const missingTemplateIndices = missingIndices.map((index) => templateIndices[index]);
  const missingLetters = missingIndices.map((index) => letters[index]);
  return {
    template,
    target,
    display,
    displayBase: [...display],
    missingTemplateIndices,
    missingLetters,
  };
}

function buildEnemyQueue(day) {
  const queue = [];
  const normalBase = Math.max(6, Math.min(14, day * 2));
  const midBase = Math.max(2, Math.min(5, Math.floor(day / 3)));
  const normalCount = Math.max(1, Math.ceil(normalBase / 15));
  const midCount = Math.max(1, Math.ceil(midBase / 15));
  for (let i = 0; i < BOSSES.length; i += 1) {
    for (let n = 0; n < normalCount; n += 1) {
      const task = randomItem(TASKS);
      queue.push({
        name: task.name,
        hp: task.hp,
        tier: "normal",
      });
    }
    for (let m = 0; m < midCount; m += 1) {
      const base = randomItem(TASKS);
      queue.push({
        name: base.name,
        hp: Math.max(9, base.hp + 6 + Math.floor(Math.random() * 4)),
        tier: "mid",
      });
    }
    queue.push({ ...BOSSES[i], tier: "boss" });
  }
  return queue;
}

function pickSmallTask(maxHp) {
  const pool = TASKS.filter((task) => task.hp <= maxHp);
  if (pool.length) {
    return randomItem(pool);
  }
  const minHp = Math.min(...TASKS.map((task) => task.hp));
  return TASKS.find((task) => task.hp === minHp) || TASKS[0];
}

function getSmallHpRate() {
  const baseRate = Math.min(4, 1 + 0.5 * TD.bossDefeated);
  const bossIndex = Math.min(TD.bossSpawned, BOSSES.length - 1);
  const bossHp = BOSSES[bossIndex]?.hp || 0;
  const capRate = Math.max(0, (CONFIG.maxHpPerMinute - bossHp) / 60);
  return Math.min(baseRate, capRate);
}

function initSlots() {
  TD.slots = UI.plantSlots.map((el, index) => ({
    id: index,
    el,
    state: "empty",
    seed: null,
    turret: null,
  }));
  UI.plantSlots.forEach((slot) => {
    slot.addEventListener("click", () => {
      const id = Number(slot.dataset.slot);
      selectSlot(id);
    });
  });
}

function selectSlot(id) {
  TD.activeSlot = id;
  TD.slots.forEach((slot) => {
    slot.el.classList.toggle("active", slot.id === id);
  });
}

function getActiveSlot() {
  if (TD.activeSlot === null || TD.activeSlot === undefined) {
    return null;
  }
  return TD.slots.find((slot) => slot.id === TD.activeSlot) || null;
}

function showMessage(text) {
  if (UI.messageText) {
    UI.messageText.textContent = text;
  }
}

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
    localStorage.setItem(STORAGE_KEYS.coins, String(TD.coins));
  } catch (err) {
    // ignore storage errors
  }
}

function updateCoinUI() {
  if (UI.coinValue) {
    UI.coinValue.textContent = String(TD.coins);
  }
  if (UI.hoeBtn) {
    UI.hoeBtn.classList.toggle("disabled", TD.coins < CONFIG.hoeCost);
  }
  if (UI.keyBtn) {
    UI.keyBtn.classList.toggle("disabled", TD.coins < CONFIG.keyCost);
  }
  if (UI.hornBtn) {
    UI.hornBtn.classList.toggle("disabled", TD.coins < CONFIG.hornCost);
  }
  if (UI.batonBtn) {
    UI.batonBtn.classList.toggle("disabled", TD.coins < CONFIG.batonCost);
  }
  saveCoins();
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

function updateStarUI() {
  if (!UI.starBar) {
    return;
  }
  const count = getStarCount(TD.errors);
  const stars = Array.from(UI.starBar.querySelectorAll(".star"));
  if (!stars.length) {
    return;
  }
  stars.forEach((star, index) => {
    star.classList.toggle("dim", index >= count);
  });
}

function spendCoins(amount) {
  if (TD.coins < amount) {
    showMessage(TEXT.toolNoCoin);
    return false;
  }
  TD.coins -= amount;
  updateCoinUI();
  return true;
}

function plantSeedAt(slot, fruit) {
  if (!slot || slot.state !== "empty") {
    showMessage(TEXT.plantBusy);
    return;
  }
  const seed = {
    level: 1,
    start: performance.now(),
    duration: 1000,
    fruit: fruit || "",
  };
  slot.state = "growing";
  slot.seed = seed;
  slot.turret = null;
  slot.el.innerHTML = `
    <div class="seed ${seed.fruit ? `fruit-${seed.fruit}` : ""}"></div>
    <div class="grow-bar"><div class="grow-fill"></div></div>
  `;
  showMessage(TEXT.plantOk);
}

function renderSeedTray() {
  if (!UI.seedTray) {
    return;
  }
  UI.seedTray.innerHTML = "";
  FRUITS.forEach((fruit) => {
    const seed = document.createElement("div");
    seed.className = "seed-token";
    seed.dataset.fruit = fruit.name;
    seed.innerHTML = `
      <div class="seed-icon fruit-${fruit.name}"></div>
      <div class="seed-label">${fruit.label}</div>
    `;
    seed.addEventListener("pointerdown", (event) => {
      startDrag("seed", { fruit: fruit.name }, seed, event);
    });
    UI.seedTray.appendChild(seed);
  });
}

function createTurret(slot, fruit) {
  const turret = {
    slotId: slot.id,
    level: 1,
    maxLevel: 6,
    hp: 3,
    maxHp: 3,
    fruit: fruit || "",
    shotIntervalMs: FIRE_INTERVALS[fruit] || 1000,
    baseShotIntervalMs: FIRE_INTERVALS[fruit] || 1000,
    wordItem: null,
    missingTemplateIndices: [],
    missingLetters: [],
    missingFillIndex: 0,
    display: [],
    displayBase: [],
    fireSequence: null,
    wrongStreak: 0,
    flashMode: false,
    lockTimer: null,
    revealTimer: null,
    wrongIndices: new Set(),
  };
  assignNewWord(turret, true);
  slot.el.innerHTML = `
    <div class="turret">
      <div class="turret-header">
        <div class="turret-icon ${turret.fruit ? `fruit-${turret.fruit}` : ""}">
          <span class="turret-level"></span>
        </div>
        <div class="turret-zh"></div>
      </div>
      <div class="turret-word"></div>
      <div class="turret-hp">
        <div class="hp-bar"><div class="hp-fill"></div></div>
      </div>
    </div>
  `;
  slot.turret = turret;
  slot.state = "turret";
  updateTurretUI(slot);
}

function assignNewWord(turret, forceNew = false) {
  const prev = turret.wordItem ? turret.wordItem.en : "";
  const minLen = Math.max(2, turret.level + 1);
  let item = turret.wordItem;
  if (forceNew || !item || normalizeWord(item.en).length < minLen) {
    const banned = collectActiveWords(turret);
    item = pickWeightedWord(prev, minLen, banned);
  }
  if (!item) {
    return;
  }
  const missing = buildMissingTemplate(item.en, turret.level);
  turret.wordItem = item;
  turret.missingTemplateIndices = missing.missingTemplateIndices;
  turret.missingLetters = missing.missingLetters;
  turret.missingFillIndex = 0;
  turret.display = [...missing.display];
  turret.displayBase = [...missing.displayBase];
  turret.wrongIndices = new Set();
}

function updateTurretUI(slot) {
  if (!slot.turret) {
    return;
  }
  const wordEl = slot.el.querySelector(".turret-word");
  const zhEl = slot.el.querySelector(".turret-zh");
  const levelEl = slot.el.querySelector(".turret-level");
  const hpFill = slot.el.querySelector(".turret-hp .hp-fill");
  if (!wordEl || !hpFill) {
    return;
  }
  if (zhEl) {
    zhEl.textContent = slot.turret.wordItem?.zh || "";
  }
  if (levelEl) {
    levelEl.textContent = String(slot.turret.level);
  }
  const rawDisplay = slot.turret.display.join("");
  wordEl.innerHTML = renderDisplayHtml(rawDisplay, slot.turret.wrongIndices);
  const ratio = slot.turret.maxHp ? slot.turret.hp / slot.turret.maxHp : 0;
  hpFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function computeBreakRule(display) {
  const normalized = display.replace(/[^a-z_]/g, "");
  if (normalized.length <= 12) {
    return null;
  }
  const mid = Math.floor(display.length / 2);
  const spaceIndex = display.indexOf(" ", mid);
  if (spaceIndex > 0 && spaceIndex < display.length - 2) {
    return { index: spaceIndex, dropChar: true };
  }
  return { index: mid, dropChar: false };
}

function renderDisplayHtml(display, wrongIndices) {
  const rule = computeBreakRule(display);
  let html = "";
  for (let i = 0; i < display.length; i += 1) {
    if (rule && i === rule.index) {
      html += "<br>";
      if (rule.dropChar) {
        continue;
      }
    }
    const char = display[i];
    const safeChar = char === " " ? "&nbsp;" : char;
    if (wrongIndices && wrongIndices.has(i)) {
      html += `<span class="letter-wrong">${safeChar}</span>`;
    } else {
      html += safeChar;
    }
  }
  return html;
}

function resetTurretDisplay(turret) {
  turret.display = [...turret.displayBase];
  turret.missingFillIndex = 0;
  turret.wrongIndices = new Set();
}

function lockTurret(turret, ms, onUnlock) {
  if (!turret) {
    return;
  }
  if (turret.lockTimer) {
    clearTimeout(turret.lockTimer);
  }
  turret.locked = true;
  turret.lockTimer = window.setTimeout(() => {
    turret.locked = false;
    turret.lockTimer = null;
    if (onUnlock) {
      onUnlock();
    }
  }, ms);
}

function computeShotInterval(turret) {
  const base = turret?.shotIntervalMs || CONFIG.shotIntervalMs;
  const jitter = (Math.random() * 2 - 1) * 500;
  return Math.max(200, base + jitter);
}

function revealFullWord(slot, duration, resumeDisplay, resumeFillIndex, delayMs = 0) {
  const turret = slot.turret;
  if (!turret || !turret.wordItem) {
    return;
  }
  if (turret.revealTimer) {
    clearTimeout(turret.revealTimer);
  }
  lockTurret(turret, duration + delayMs, () => {
    if (!slot.turret || slot.turret !== turret) {
      return;
    }
    turret.display = resumeDisplay;
    turret.missingFillIndex = resumeFillIndex;
    updateTurretUI(slot);
  });
  turret.revealTimer = window.setTimeout(() => {
    if (!slot.turret || slot.turret !== turret) {
      return;
    }
    turret.display = turret.wordItem.en.toLowerCase().split("");
    turret.wrongIndices = new Set();
    updateTurretUI(slot);
    triggerWordExplode(slot);
  }, delayMs);
}

function triggerFlash(slot) {
  const turret = slot.turret;
  if (!turret || !turret.wordItem) {
    return;
  }
  const resumeDisplay = [...turret.display];
  const resumeFillIndex = turret.missingFillIndex;
  showMessage(TEXT.flashHint);
  revealFullWord(slot, CONFIG.flashDurationMs, resumeDisplay, resumeFillIndex);
}

function triggerWordExplode(slot) {
  const wordEl = slot.el.querySelector(".turret-word");
  if (!wordEl) {
    return;
  }
  wordEl.classList.remove("explode");
  void wordEl.offsetWidth;
  wordEl.classList.add("explode");
}

function clearTurretFire(turret) {
  if (!turret || !turret.fireSequence) {
    return;
  }
  if (turret.fireSequence.timer) {
    clearTimeout(turret.fireSequence.timer);
  }
  turret.fireSequence = null;
}

function clearTurretTimers(turret) {
  if (!turret) {
    return;
  }
  if (turret.lockTimer) {
    clearTimeout(turret.lockTimer);
    turret.lockTimer = null;
  }
  if (turret.revealTimer) {
    clearTimeout(turret.revealTimer);
    turret.revealTimer = null;
  }
  turret.locked = false;
}

function startFiringSequence(slot, shots, onFinish) {
  const turret = slot.turret;
  if (!turret || turret.fireSequence) {
    return;
  }
  const sequence = {
    remaining: Math.max(1, shots || 1),
    timer: null,
    lastShotAt: 0,
    nextAt: 0,
    fireOnce: null,
  };
  turret.fireSequence = sequence;
  turret.locked = true;
  const fireOnce = () => {
    if (!TD.running || !slot.turret || slot.turret !== turret) {
      clearTurretFire(turret);
      return;
    }
    sequence.lastShotAt = performance.now();
    fireBullet(slot);
    sequence.remaining -= 1;
    if (sequence.remaining <= 0) {
      clearTurretFire(turret);
      turret.locked = false;
      if (onFinish) {
        onFinish();
      }
      return;
    }
    const intervalMs = computeShotInterval(turret);
    sequence.nextAt = sequence.lastShotAt + intervalMs;
    sequence.timer = window.setTimeout(fireOnce, intervalMs);
  };
  sequence.fireOnce = fireOnce;
  fireOnce();
}

function adjustNextShot(turret) {
  const seq = turret?.fireSequence;
  if (!seq || !seq.timer || !seq.fireOnce) {
    return;
  }
  const now = performance.now();
  const lastShotAt = seq.lastShotAt || now;
  const intervalMs = computeShotInterval(turret);
  const desiredNextAt = lastShotAt + intervalMs;
  clearTimeout(seq.timer);
  if (desiredNextAt <= now) {
    seq.timer = null;
    seq.fireOnce();
    return;
  }
  seq.nextAt = desiredNextAt;
  seq.timer = window.setTimeout(seq.fireOnce, desiredNextAt - now);
}

async function handleCorrectShot(slot) {
  const turret = slot.turret;
  if (!turret || !turret.wordItem) {
    return;
  }
  showMessage(TEXT.correctShot);
  AudioBank.speakEn(turret.wordItem.en);
  updateTurretUI(slot);
  turret.shotIntervalMs = turret.baseShotIntervalMs;
  const shots = turret.fruit === "pear" ? turret.level * 6 : turret.level * 3;
  SoundFX.playFruitShot(turret.fruit);
  turret.wrongStreak = 0;
  turret.flashMode = false;
  startFiringSequence(slot, shots, () => {
    if (!slot.turret || slot.turret !== turret) {
      return;
    }
    if (turret.level >= turret.maxLevel) {
      explodeTurret(slot);
      return;
    }
    turret.level += 1;
    assignNewWord(turret, false);
    updateTurretUI(slot);
  });
}

async function handleWrongShot(slot, wrongIndex) {
  const turret = slot.turret;
  if (!turret || !turret.wordItem) {
    return;
  }
  TD.errors += 1;
  updateStarUI();
  const correctCount = turret.missingFillIndex;
  const resumeDisplay = [...turret.displayBase];
  for (let i = 0; i < correctCount; i += 1) {
    const idx = turret.missingTemplateIndices[i];
    resumeDisplay[idx] = turret.missingLetters[i];
  }
  showMessage(TEXT.wrongShot);
  turret.wrongIndices = new Set([wrongIndex]);
  updateTurretUI(slot);
  triggerWordExplode(slot);
  turret.locked = true;
  AudioBank.play("error");
  AudioBank.speakEn(turret.wordItem.en);
  turret.hp -= 1;
  updateTurretUI(slot);
  if (turret.hp <= 0) {
    explodeTurret(slot);
    return;
  }
  let revealDuration = CONFIG.wrongRevealMs;
  if (turret.flashMode) {
    revealDuration = CONFIG.flashDurationMs;
  } else {
    turret.wrongStreak += 1;
    if (turret.wrongStreak >= 3) {
      turret.flashMode = true;
      revealDuration = CONFIG.flashDurationMs;
      showMessage(TEXT.flashHint);
    }
  }
  revealFullWord(slot, revealDuration, resumeDisplay, correctCount, 250);
}

function explodeTurret(slot) {
  if (slot.turret) {
    clearTurretFire(slot.turret);
    clearTurretTimers(slot.turret);
  }
  slot.el.innerHTML = "";
  slot.state = "empty";
  slot.turret = null;
  if (TD.activeSlot === slot.id) {
    TD.activeSlot = null;
    slot.el.classList.remove("active");
  }
  showMessage(TEXT.turretExplode);
  AudioBank.play("explode");
}

function removeTurret(slot) {
  if (!slot) {
    return;
  }
  if (slot.turret) {
    clearTurretFire(slot.turret);
    clearTurretTimers(slot.turret);
  }
  slot.el.innerHTML = "";
  slot.state = "empty";
  slot.seed = null;
  slot.turret = null;
  if (TD.activeSlot === slot.id) {
    TD.activeSlot = null;
    slot.el.classList.remove("active");
  }
}

function renderLetterQueue() {
  if (!UI.letterQueue) {
    return;
  }
  UI.letterQueue.innerHTML = "";
  TD.letterQueue.forEach((entry) => {
    const bubble = document.createElement("div");
    bubble.className = "letter-bubble";
    bubble.textContent = entry.letter;
    bubble.dataset.id = entry.id;
    bubble.addEventListener("pointerdown", (event) => {
      startDrag("letter", { id: entry.id }, bubble, event);
    });
    UI.letterQueue.appendChild(bubble);
    entry.el = bubble;
  });
}

function consumeLetterById(id) {
  const entry = TD.letterQueue.find((item) => item.id === id);
  if (entry) {
    renderLetterQueue();
  }
}

function fillLetterForSlot(slot, letter) {
  if (!slot || !slot.turret) {
    showMessage(TEXT.turretMissing);
    return false;
  }
  const turret = slot.turret;
  if (turret.locked) {
    return false;
  }
  const fillIndex = turret.missingTemplateIndices[turret.missingFillIndex];
  if (fillIndex === undefined) {
    showMessage(TEXT.turretFull);
    return false;
  }
  const expected = turret.missingLetters[turret.missingFillIndex];
  turret.display[fillIndex] = letter;
  if (letter.toLowerCase() !== expected) {
    handleWrongShot(slot, fillIndex);
    return true;
  }
  turret.missingFillIndex += 1;
  updateTurretUI(slot);
  if (turret.missingFillIndex < turret.missingLetters.length) {
    return true;
  }
  handleCorrectShot(slot);
  return true;
}

function handleHoeOnSlot(slot) {
  if (!slot || (!slot.turret && !slot.seed)) {
    showMessage(TEXT.toolNoSlot);
    return false;
  }
  if (!spendCoins(CONFIG.hoeCost)) {
    return false;
  }
  removeTurret(slot);
  showMessage(TEXT.toolRemoved);
  return true;
}

function handleKeyOnSlot(slot) {
  if (!slot || !slot.turret) {
    showMessage(TEXT.toolNeedTurret);
    return false;
  }
  const turret = slot.turret;
  if (turret.locked) {
    showMessage(TEXT.toolBusy);
    return false;
  }
  const fillIndex = turret.missingTemplateIndices[turret.missingFillIndex];
  if (fillIndex === undefined) {
    showMessage(TEXT.toolNoGap);
    return false;
  }
  if (!spendCoins(CONFIG.keyCost)) {
    return false;
  }
  const expected = turret.missingLetters[turret.missingFillIndex];
  fillLetterForSlot(slot, expected);
  showMessage(TEXT.toolKeyUsed);
  return true;
}

function handleHornAction() {
  if (TD.winPending || TD.victoryActive) {
    return false;
  }
  if (TD.bossAlive) {
    showMessage(TEXT.toolBossAlive);
    return false;
  }
  if (TD.bossSpawned >= CONFIG.maxBoss) {
    showMessage(TEXT.toolBossLimit);
    return false;
  }
  if (!spendCoins(CONFIG.hornCost)) {
    return false;
  }
  spawnBoss();
  for (let i = 0; i < 5; i += 1) {
    const task = randomItem(TASKS);
    spawnEnemy({ name: task.name, hp: task.hp, tier: "normal" }, getSpawnPoint());
  }
  showMessage(TEXT.toolHornUsed);
  return true;
}

function autoFillTurret(slot) {
  const turret = slot.turret;
  if (!turret || turret.locked || turret.fireSequence) {
    return false;
  }
  if (turret.missingFillIndex >= turret.missingLetters.length) {
    return false;
  }
  for (let i = turret.missingFillIndex; i < turret.missingLetters.length; i += 1) {
    const idx = turret.missingTemplateIndices[i];
    turret.display[idx] = turret.missingLetters[i];
  }
  turret.missingFillIndex = turret.missingLetters.length;
  updateTurretUI(slot);
  handleCorrectShot(slot);
  return true;
}

function handleBatonAction() {
  if (TD.winPending || TD.victoryActive) {
    return false;
  }
  const targets = TD.slots.filter((slot) => slot.turret);
  if (!targets.length) {
    showMessage(TEXT.toolNoTurret);
    return false;
  }
  if (!spendCoins(CONFIG.batonCost)) {
    return false;
  }
  let used = false;
  targets.forEach((slot) => {
    if (autoFillTurret(slot)) {
      used = true;
    }
  });
  if (used) {
    showMessage(TEXT.toolBatonUsed);
  } else {
    showMessage(TEXT.toolNoTurret);
  }
  return used;
}

function clearDropTarget() {
  if (DragState.targetSlot) {
    DragState.targetSlot.el.classList.remove("drop-target");
  }
  DragState.targetSlot = null;
  if (DragState.targetBag && UI.bagArea) {
    UI.bagArea.classList.remove("drop-bag");
  }
  DragState.targetBag = false;
}

function setDropTarget(slot) {
  clearDropTarget();
  if (slot) {
    slot.el.classList.add("drop-target");
    DragState.targetSlot = slot;
  }
}

function setBagTarget(active) {
  clearDropTarget();
  if (active && UI.bagArea) {
    UI.bagArea.classList.add("drop-bag");
    DragState.targetBag = true;
  }
}

function canHoeSlot(slot) {
  return !!slot && (slot.turret || slot.seed);
}

function canKeySlot(slot) {
  if (!slot || !slot.turret) {
    return false;
  }
  const turret = slot.turret;
  if (turret.locked) {
    return false;
  }
  const fillIndex = turret.missingTemplateIndices[turret.missingFillIndex];
  return fillIndex !== undefined;
}

function isOverBag(element) {
  return !!(UI.bagArea && element && UI.bagArea.contains(element));
}

function getSlotFromElement(element) {
  if (!element) {
    return null;
  }
  const slotEl = element.closest(".plant-slot");
  if (!slotEl) {
    return null;
  }
  const id = Number(slotEl.dataset.slot);
  return TD.slots.find((slot) => slot.id === id) || null;
}

function updateDragTarget(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  const target = getSlotFromElement(element);
  if (!target) {
    if (
      DragState.active?.type === "tool" &&
      (DragState.active.payload?.tool === "horn" || DragState.active.payload?.tool === "baton")
    ) {
      setBagTarget(isOverBag(element));
      return;
    }
    setDropTarget(null);
    return;
  }
  if (DragState.active?.type === "seed") {
    setDropTarget(target.state === "empty" ? target : null);
    return;
  }
  if (DragState.active?.type === "letter") {
    setDropTarget(target.turret ? target : null);
    return;
  }
  if (DragState.active?.type === "tool") {
    if (DragState.active.payload?.tool === "hoe") {
      setDropTarget(canHoeSlot(target) ? target : null);
    } else if (DragState.active.payload?.tool === "key") {
      setDropTarget(canKeySlot(target) ? target : null);
    } else if (
      DragState.active.payload?.tool === "horn" ||
      DragState.active.payload?.tool === "baton"
    ) {
      setBagTarget(isOverBag(element));
    } else {
      setDropTarget(null);
    }
  }
}

function startDrag(type, payload, sourceEl, event) {
  event.preventDefault();
  const rect = sourceEl.getBoundingClientRect();
  const ghost = sourceEl.cloneNode(true);
  ghost.classList.add("drag-ghost");
  document.body.appendChild(ghost);
  if (type === "letter" && payload?.id) {
    const entry = TD.letterQueue.find((item) => item.id === payload.id);
    if (entry) {
      entry.falling = false;
    }
  }
  DragState.active = {
    type,
    payload,
    ghost,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  };
  moveGhost(event.clientX, event.clientY);
  updateDragTarget(event);
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  window.addEventListener("touchmove", preventTouchScroll, { passive: false });
}

function moveGhost(x, y) {
  const ghost = DragState.active?.ghost;
  if (!ghost) {
    return;
  }
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
}

function onDragMove(event) {
  moveGhost(event.clientX, event.clientY);
  updateDragTarget(event);
}

function onDragEnd(event) {
  const active = DragState.active;
  if (!active) {
    return;
  }
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
  window.removeEventListener("touchmove", preventTouchScroll);
  active.ghost.remove();
  const dropSlot = DragState.targetSlot;
  if (active.type === "seed" && dropSlot) {
    plantSeedAt(dropSlot, active.payload.fruit);
  } else if (active.type === "letter" && dropSlot) {
    const entry = TD.letterQueue.find((item) => item.id === active.payload.id);
    if (entry) {
      const used = fillLetterForSlot(dropSlot, entry.letter);
      if (used) {
        consumeLetterById(entry.id);
      }
    }
  } else if (active.type === "tool") {
    if (active.payload?.tool === "hoe") {
      if (dropSlot) {
        handleHoeOnSlot(dropSlot);
      }
    } else if (active.payload?.tool === "key") {
      if (dropSlot) {
        handleKeyOnSlot(dropSlot);
      }
    } else if (active.payload?.tool === "horn") {
      if (DragState.targetBag) {
        handleHornAction();
      }
    } else if (active.payload?.tool === "baton") {
      if (DragState.targetBag) {
        handleBatonAction();
      }
    }
  }
  DragState.active = null;
  clearDropTarget();
}

function collectNeededLetters() {
  const letters = [];
  TD.slots.forEach((slot) => {
    if (!slot.turret) {
      return;
    }
    const turret = slot.turret;
    for (let i = turret.missingFillIndex; i < turret.missingLetters.length; i += 1) {
      letters.push(turret.missingLetters[i]);
    }
  });
  return letters;
}

function dropLetter() {
  if (!TD.running) {
    return;
  }
  const needed = collectNeededLetters();
  const currentLetters = new Set(TD.letterQueue.map((entry) => entry.letter));
  const missingNeeded = needed.filter((letter) => !currentLetters.has(letter));
  const needPool = missingNeeded.length ? missingNeeded : needed;
  const needRatio = missingNeeded.length ? 2 / 3 : 1 / 2;
  let letter = "";
  if (needPool.length && Math.random() < needRatio) {
    letter = randomItem(needPool);
  } else {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    letter = alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    letter,
    falling: true,
    el: null,
  };
  const mid = Math.floor(TD.letterQueue.length / 2);
  TD.letterQueue.splice(mid, 0, entry);
  if (TD.letterQueue.length > CONFIG.letterSlots) {
    if (TD.removeLeftNext) {
      TD.letterQueue.shift();
    } else {
      TD.letterQueue.pop();
    }
    TD.removeLeftNext = !TD.removeLeftNext;
  }
  renderLetterQueue();
}

function initLetterQueue() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  TD.letterQueue = alphabet.split("").map((letter, index) => ({
    id: `letter-${letter}-${index}`,
    letter,
    el: null,
  }));
  renderLetterQueue();
}

function spawnEnemy(entry, spawnPoint) {
  if (!TD.running) {
    return;
  }
  if (!entry) {
    return;
  }
  const fieldRect = UI.field.getBoundingClientRect();
  const spawnX = spawnPoint?.x ?? fieldRect.width - 20;
  const spawnY = spawnPoint?.y ?? fieldRect.height / 2 + 10;
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const speedBoost = Math.pow(1.2, TD.speedBoostWave);
  const enemy = {
    id,
    name: entry.name,
    hp: entry.hp,
    maxHp: entry.hp,
    tier: entry.tier,
    x: spawnX,
    y: spawnY,
    speed:
      entry.tier === "boss"
        ? CONFIG.bossSpeed
        : entry.tier === "mid"
          ? CONFIG.midSpeed * speedBoost
          : CONFIG.enemySpeed * speedBoost,
    jumpingUntil: 0,
    nextJumpAt: performance.now() + 1000,
    alive: true,
    falling: false,
    fallSpeed: 0,
    hitCount: 0,
    slowUntil: 0,
    slipUntil: 0,
  };
  TD.enemies.push(enemy);
  renderEnemy(enemy);
}

function spawnBoss() {
  if (TD.bossSpawned >= CONFIG.maxBoss) {
    return;
  }
  const entry = BOSSES[TD.bossSpawned];
  if (!entry) {
    return;
  }
  TD.bossSpawned += 1;
  TD.bossAlive = true;
  spawnEnemy({ ...entry, tier: "boss" }, getSpawnPoint());
}

function isSpawnAreaClear(spawnX, spawnY) {
  return !TD.enemies.some((enemy) => {
    if (!enemy.alive || enemy.falling) {
      return false;
    }
    const dist = Math.hypot(enemy.x - spawnX, enemy.y - spawnY);
    return dist < 90;
  });
}

function getSpawnPoint() {
  const fieldRect = UI.field.getBoundingClientRect();
  const enemyRect = UI.enemyArea
    ? UI.enemyArea.getBoundingClientRect()
    : fieldRect;
  const top = enemyRect.top - fieldRect.top;
  const bottom = enemyRect.bottom - fieldRect.top;
  const left = enemyRect.left - fieldRect.left;
  const right = enemyRect.right - fieldRect.left;
  const minY = Math.min(top + 30, bottom - 30);
  const maxY = Math.max(top + 30, bottom - 30);
  const spawnY = minY + Math.random() * Math.max(20, maxY - minY);
  const spawnX = Math.max(left + 30, right - 20 - Math.random() * 20);
  return { x: spawnX, y: spawnY };
}

function updateSpawns(delta) {
  if (TD.winPending || TD.victoryActive) {
    return;
  }
  TD.bossTimer += delta * 1000;
  if (!TD.bossAlive && TD.bossSpawned < CONFIG.maxBoss && TD.bossTimer >= CONFIG.bossIntervalMs) {
    TD.bossTimer = 0;
    spawnBoss();
  }
  const rate = getSmallHpRate();
  TD.smallHpBudget += rate * delta;
  const aliveCount = TD.enemies.filter((enemy) => enemy.alive && !enemy.falling).length;
  const now = performance.now();
  if (aliveCount === 0) {
    if (!TD.emptySince) {
      TD.emptySince = now;
    }
  } else {
    TD.emptySince = 0;
  }
  const spawnInterval =
    TD.emptySince && now - TD.emptySince <= 20000 ? 2000 : CONFIG.spawnIntervalMs;
  TD.spawnTimer += delta * 1000;
  if (TD.spawnTimer < spawnInterval) {
    return;
  }
  const spawnPoint = getSpawnPoint();
  if (!isSpawnAreaClear(spawnPoint.x, spawnPoint.y)) {
    TD.spawnTimer = spawnInterval * 0.6;
    return;
  }
  if (TD.smallHpBudget < 1) {
    TD.spawnTimer = spawnInterval;
    return;
  }
  const maxHp = Math.floor(TD.smallHpBudget);
  const task = pickSmallTask(maxHp);
  if (!task || task.hp > TD.smallHpBudget) {
    TD.spawnTimer = spawnInterval;
    return;
  }
  TD.smallHpBudget -= task.hp;
  spawnEnemy({ name: task.name, hp: task.hp, tier: "normal" }, spawnPoint);
  TD.spawnTimer -= spawnInterval;
}

function renderEnemy(enemy) {
  const el = document.createElement("div");
  el.className = `enemy ${enemy.tier === "boss" ? "boss" : enemy.tier === "mid" ? "mid" : "normal"}`;
  el.dataset.id = enemy.id;
  el.innerHTML = `
    <div class="enemy-img"><span class="enemy-tag"></span></div>
    <div class="enemy-title"></div>
    <div class="hp-bar"><div class="hp-fill"></div></div>
  `;
  UI.enemyLayer.appendChild(el);
  enemy.el = el;
  updateEnemyPosition(enemy);
}

function updateEnemyPosition(enemy) {
  if (!enemy.el) {
    return;
  }
  const now = performance.now();
  enemy.el.style.left = `${enemy.x}px`;
  enemy.el.style.top = `${enemy.y}px`;
  enemy.el.classList.toggle("jump", enemy.jumpingUntil > performance.now());
  enemy.el.classList.toggle("falling", enemy.falling);
  enemy.el.classList.toggle("slowed", enemy.slowUntil > now);
  enemy.el.classList.toggle("slip", enemy.slipUntil > now);
  const title = enemy.el.querySelector(".enemy-title");
  const fill = enemy.el.querySelector(".hp-fill");
  const tag = enemy.el.querySelector(".enemy-tag");
  if (title) {
    title.textContent = enemy.name;
  }
  if (tag) {
    tag.textContent = getSubjectTag(enemy.name);
    tag.style.display = tag.textContent ? "inline-flex" : "none";
  }
  if (fill) {
    const ratio = enemy.maxHp ? enemy.hp / enemy.maxHp : 0;
    fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }
}

function removeEnemy(enemy) {
  if (enemy.el) {
    enemy.el.remove();
  }
  TD.enemies = TD.enemies.filter((entry) => entry.id !== enemy.id);
}

function formatDamageText(damage) {
  if (Number.isInteger(damage)) {
    return `${damage}`;
  }
  return damage.toFixed(1);
}

function spawnDamageText(x, y, damage) {
  if (!UI.impactLayer) {
    return;
  }
  const text = document.createElement("div");
  text.className = "damage-text";
  text.textContent = `-${formatDamageText(damage)}`;
  text.style.left = `${x}px`;
  text.style.top = `${y}px`;
  UI.impactLayer.appendChild(text);
  text.addEventListener(
    "animationend",
    () => {
      text.remove();
    },
    { once: true }
  );
}

function spawnCoinFly(x, y) {
  if (!UI.impactLayer) {
    return;
  }
  const fieldRect = UI.field.getBoundingClientRect();
  const bagLabel = UI.bagArea.querySelector(".bag-text");
  const bagRect = (bagLabel || UI.bagArea).getBoundingClientRect();
  const targetX = bagRect.left - fieldRect.left + bagRect.width / 2;
  const targetY = bagRect.top - fieldRect.top + bagRect.height / 2;
  const coin = document.createElement("div");
  coin.className = "coin-fly";
  coin.style.left = `${x}px`;
  coin.style.top = `${y}px`;
  UI.impactLayer.appendChild(coin);
  const travelMs = CONFIG.coinFlightMs;
  const fadeMs = CONFIG.coinFadeMs;
  coin.style.transition = `transform ${travelMs}ms ease-out, opacity ${fadeMs}ms ease-out ${Math.max(
    0,
    travelMs - fadeMs
  )}ms`;
  requestAnimationFrame(() => {
    coin.style.transform = `translate(calc(-50% + ${targetX - x}px), calc(-50% + ${targetY - y}px)) scale(0.6)`;
  });
  window.setTimeout(() => {
    coin.style.opacity = "0";
  }, Math.max(0, travelMs - fadeMs));
  coin.addEventListener(
    "transitionend",
    () => {
      coin.remove();
    },
    { once: true }
  );
}

function awardCoins(amount, x, y) {
  TD.coins += amount;
  updateCoinUI();
  spawnCoinFly(x, y);
  AudioBank.play("coin");
  showMessage(TEXT.coinGain);
}

function spawnBubble(x, y) {
  if (!UI.impactLayer) {
    return;
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const fieldRect = UI.field.getBoundingClientRect();
  const minX = 20;
  const maxX = Math.max(40, fieldRect.width - 20);
  const targetX = minX + Math.random() * (maxX - minX);
  const dx = Math.round(Math.max(-fieldRect.width, Math.min(fieldRect.width, targetX - x)));
  const dy = Math.round(-200 - Math.random() * 200);
  const dyHalf = Math.round(dy * 0.55);
  const colors = [
    "rgba(255, 99, 132, 0.75)",
    "rgba(54, 162, 235, 0.75)",
    "rgba(255, 206, 86, 0.75)",
    "rgba(75, 192, 192, 0.75)",
    "rgba(153, 102, 255, 0.75)",
    "rgba(255, 159, 64, 0.75)",
  ];
  const color = colors[Math.floor(Math.random() * colors.length)];
  bubble.style.left = `${x}px`;
  bubble.style.top = `${y}px`;
  bubble.style.setProperty("--dx", `${dx}px`);
  bubble.style.setProperty("--dy", `${dy}px`);
  bubble.style.setProperty("--dy-half", `${dyHalf}px`);
  bubble.style.setProperty("--bubble-color", color);
  UI.impactLayer.appendChild(bubble);
  bubble.addEventListener(
    "animationend",
    () => {
      bubble.remove();
    },
    { once: true }
  );
}

function spawnFirework(x, y, color) {
  if (!UI.impactLayer) {
    return;
  }
  const firework = document.createElement("div");
  firework.className = "firework";
  firework.style.left = `${x}px`;
  firework.style.top = `${y}px`;
  firework.style.setProperty("--fw-color", color);
  UI.impactLayer.appendChild(firework);
  firework.addEventListener(
    "animationend",
    () => {
      firework.remove();
    },
    { once: true }
  );
}

function spawnImpact(x, y, fruit) {
  if (!UI.impactLayer) {
    return;
  }
  const impact = document.createElement("div");
  impact.className = `impact ${fruit ? `fruit-${fruit}` : ""}`;
  impact.style.left = `${x}px`;
  impact.style.top = `${y}px`;
  UI.impactLayer.appendChild(impact);
  impact.addEventListener(
    "animationend",
    () => {
      impact.remove();
    },
    { once: true }
  );
}

function getSubjectTag(name) {
  if (!name) {
    return "";
  }
  if (name.includes("英语")) {
    return "English";
  }
  if (name.includes("语文")) {
    return "语文";
  }
  if (name.includes("数学")) {
    return "数学";
  }
  return "";
}

function flashEnemy(enemy, className = "burn-flash", duration = 400) {
  if (!enemy?.el) {
    return;
  }
  enemy.el.classList.remove(className);
  void enemy.el.offsetWidth;
  enemy.el.classList.add(className);
  window.setTimeout(() => {
    enemy.el && enemy.el.classList.remove(className);
  }, duration);
}

function findFrontEnemy() {
  const alive = TD.enemies.filter((enemy) => enemy.alive);
  if (!alive.length) {
    return null;
  }
  return alive.reduce((closest, enemy) => {
    if (!closest) {
      return enemy;
    }
    return enemy.x < closest.x ? enemy : closest;
  }, null);
}

function findFrontEnemyBy(filterFn) {
  const alive = TD.enemies.filter((enemy) => enemy.alive && filterFn(enemy));
  if (!alive.length) {
    return null;
  }
  return alive.reduce((closest, enemy) => {
    if (!closest) {
      return enemy;
    }
    return enemy.x < closest.x ? enemy : closest;
  }, null);
}

function findNextAppleTarget(origin, hitIds) {
  const excluded = new Set(hitIds || []);
  const alive = TD.enemies.filter((enemy) => enemy.alive && !excluded.has(enemy.id));
  if (!alive.length) {
    return null;
  }
  return alive.reduce((closest, enemy) => {
    if (!closest) {
      return enemy;
    }
    const currentDist = Math.hypot(enemy.x - origin.x, enemy.y - origin.y);
    const closestDist = Math.hypot(closest.x - origin.x, closest.y - origin.y);
    return currentDist < closestDist ? enemy : closest;
  }, null);
}

function getBulletDamage(turret) {
  if (!turret) {
    return 1;
  }
  if (turret.fruit === "pear") {
    return 1 + (turret.level - 1) * 0.5;
  }
  if (turret.fruit === "apple") {
    return 1 + (turret.level - 1) * 0.5;
  }
  return turret.level;
}

function findHighestHpEnemy() {
  const alive = TD.enemies.filter((enemy) => enemy.alive);
  if (!alive.length) {
    return null;
  }
  return alive.reduce((highest, enemy) => {
    if (!highest) {
      return enemy;
    }
    return enemy.hp > highest.hp ? enemy : highest;
  }, null);
}

function findEnemyById(id) {
  if (!id) {
    return null;
  }
  return TD.enemies.find((enemy) => enemy.id === id && enemy.alive) || null;
}

function findTurretBySlotId(id) {
  if (id === null || id === undefined) {
    return null;
  }
  const slot = TD.slots.find((entry) => entry.id === id);
  return slot?.turret || null;
}

function applyEnemyDamage(enemy, damage, fruit) {
  if (!enemy.alive) {
    return;
  }
  const now = performance.now();
  if (enemy.tier === "boss") {
    enemy.hitCount = (enemy.hitCount || 0) + 1;
    if (enemy.hitCount % 5 === 0) {
      enemy.jumpingUntil = now + 900;
      enemy.nextJumpAt = now + 2000;
      updateEnemyPosition(enemy);
      return;
    }
  }
  const actualDamage = Math.max(0.5, Math.round(damage * 2) / 2);
  const hit = Math.max(1, Math.round(actualDamage));
  enemy.hp -= actualDamage;
  spawnDamageText(enemy.x, enemy.y, actualDamage);
  if (enemy.el) {
    enemy.el.classList.remove("shake");
    void enemy.el.offsetWidth;
    enemy.el.classList.add("shake");
  }
  if (hit >= 3) {
    AudioBank.play("hit3");
  } else if (hit === 2) {
    AudioBank.play("hit2");
  } else {
    AudioBank.play("hit1");
  }
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemy.alive = false;
    enemy.falling = true;
    enemy.fallSpeed = 140 + Math.random() * 40;
    if (enemy.el) {
      enemy.el.classList.add("polluted");
      if (fruit) {
        enemy.el.dataset.stain = fruit;
      }
    }
    spawnImpact(enemy.x, enemy.y, fruit);
    AudioBank.play("explode");
    awardCoins(enemy.maxHp, enemy.x, enemy.y);
    if (enemy.tier === "boss") {
      TD.bossDefeated += 1;
      TD.bossAlive = false;
      TD.speedBoostWave = TD.bossDefeated;
      UI.bossValue.textContent = TD.bossDefeated;
      if (TD.bossDefeated >= CONFIG.maxBoss) {
        winGame();
      }
    }
  } else {
    spawnImpact(enemy.x, enemy.y, fruit);
    updateEnemyPosition(enemy);
  }
}

function updateBossJump(enemy, now) {
  if (enemy.tier !== "boss" || !enemy.alive) {
    return;
  }
  if (enemy.jumpingUntil && now < enemy.jumpingUntil) {
    return;
  }
  if (now >= enemy.nextJumpAt) {
    enemy.jumpingUntil = now + 900;
    const interval = Math.max(2, Math.round(10 - 2 * Math.log(Math.max(1, enemy.hp))));
    enemy.nextJumpAt = now + interval * 1000;
  }
}

function updateEnemies(delta, now) {
  const bagRect = UI.bagArea.getBoundingClientRect();
  const fieldRect = UI.field.getBoundingClientRect();
  const bagCenterX = bagRect.left - fieldRect.left + bagRect.width / 2;
  const bagCenterY = bagRect.top - fieldRect.top + bagRect.height / 2;
  const bagRadius = Math.min(bagRect.width, bagRect.height) * 0.45;
  TD.enemies.forEach((enemy) => {
    if (enemy.falling) {
      enemy.y += enemy.fallSpeed * delta;
      updateEnemyPosition(enemy);
      return;
    }
    updateBossJump(enemy, now);
    if (enemy.slipUntil > now) {
      updateEnemyPosition(enemy);
      return;
    }
    const slowFactor = enemy.slowUntil > now ? CONFIG.slowFactor : 1;
    const dx = bagCenterX - enemy.x;
    const dy = bagCenterY - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;
    const step = enemy.speed * slowFactor * delta;
    enemy.x += (dx / dist) * step;
    enemy.y += (dy / dist) * step;
    updateEnemyPosition(enemy);
  });
  TD.enemies
    .filter(
      (enemy) =>
        enemy.alive && Math.hypot(enemy.x - bagCenterX, enemy.y - bagCenterY) <= bagRadius
    )
    .forEach((enemy) => {
      const loadGain = Math.max(1, Math.round(enemy.hp));
      TD.bagLoad += loadGain;
      UI.bagValue.textContent = String(TD.bagLoad);
      showMessage(`${enemy.name}${TEXT.bagged}`);
      playBagVoice(enemy.name);
      if (enemy.tier === "boss") {
        TD.bossAlive = false;
      }
      removeEnemy(enemy);
      if (TD.bagLoad >= CONFIG.bagLimit) {
        loseGame();
      }
    });
  TD.enemies
    .filter((enemy) => enemy.falling)
    .forEach((enemy) => {
      if (enemy.y > fieldRect.height + 120) {
        removeEnemy(enemy);
      }
    });
}

function spawnSingleBullet(originX, originY, damage, fruit, targetId, sourceId, options = {}) {
  const bullet = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    x: originX,
    y: originY,
    damage,
    speed: CONFIG.bulletSpeed,
    fruit,
    targetId,
    sourceId,
    pierceDamage: options.pierceDamage || 0,
    hitIds: options.hitIds || [],
    pierced: new Set(),
    vx: 0,
    vy: 0,
  };
  const target = findEnemyById(targetId);
  if (target) {
    const dx = target.x - originX;
    const dy = target.y - originY;
    const dist = Math.hypot(dx, dy) || 1;
    bullet.vx = (dx / dist) * bullet.speed;
    bullet.vy = (dy / dist) * bullet.speed;
  } else {
    bullet.vx = bullet.speed;
    bullet.vy = 0;
  }
  const el = document.createElement("div");
  el.className = `bullet ${fruit ? `fruit-${fruit}` : ""}`;
  el.dataset.id = bullet.id;
  UI.bulletLayer.appendChild(el);
  bullet.el = el;
  TD.bullets.push(bullet);
  updateBulletPosition(bullet);
}

function fireBullet(slot) {
  const turret = slot.turret;
  if (!turret) {
    return;
  }
  const fieldRect = UI.field.getBoundingClientRect();
  const slotRect = slot.el.getBoundingClientRect();
  const originX = slotRect.left - fieldRect.left + slotRect.width * 0.8;
  const originY = slotRect.top - fieldRect.top + slotRect.height * 0.5;
  const baseDamage = getBulletDamage(turret);
  if (turret.fruit === "blueberry") {
    const alive = TD.enemies.filter((enemy) => enemy.alive);
    if (!alive.length) {
      showMessage(TEXT.noEnemy);
      return;
    }
    const base = Math.floor(baseDamage / alive.length);
    const remainder = baseDamage - base * alive.length;
    alive.forEach((enemy, index) => {
      const rawDamage = base + (index < remainder ? 1 : 0);
      const perDamage = Math.max(1, rawDamage);
      spawnSingleBullet(originX, originY, perDamage, turret.fruit, enemy.id, turret.slotId);
    });
    SoundFX.playFruitShot(turret.fruit);
    return;
  }
  const now = performance.now();
  let target = null;
  if (turret.fruit === "coconut") {
    target = findHighestHpEnemy();
  } else if (turret.fruit === "banana") {
    target =
      findFrontEnemyBy((enemy) => enemy.slipUntil <= now) || findFrontEnemy();
  } else if (turret.fruit === "cucumber") {
    target =
      findFrontEnemyBy((enemy) => enemy.slowUntil <= now) || findFrontEnemy();
  } else {
    target = findFrontEnemy();
  }
  if (!target) {
    showMessage(TEXT.noEnemy);
    return;
  }
  const options = {};
  if (turret.fruit === "coconut") {
    options.pierceDamage = Math.max(1, Math.round(baseDamage * CONFIG.coconutPierceRatio));
  }
  spawnSingleBullet(originX, originY, baseDamage, turret.fruit, target.id, turret.slotId, options);
  SoundFX.playFruitShot(turret.fruit);
}

function updateBulletPosition(bullet) {
  if (!bullet.el) {
    return;
  }
  bullet.el.style.left = `${bullet.x}px`;
  bullet.el.style.top = `${bullet.y}px`;
}

function resolveBulletTarget(bullet) {
  let target = findEnemyById(bullet.targetId);
  if (!target) {
    if (bullet.fruit === "coconut") {
      target = findHighestHpEnemy();
    } else if (bullet.fruit === "apple" && bullet.hitIds?.length) {
      target = findFrontEnemyBy((enemy) => !bullet.hitIds.includes(enemy.id));
    } else {
      target = findFrontEnemy();
    }
    if (target) {
      bullet.targetId = target.id;
    }
  }
  return target;
}

function applyBulletHit(bullet, target, now) {
  if (!target) {
    return;
  }
  const turret = findTurretBySlotId(bullet.sourceId);
  if (bullet.fruit === "apple") {
    applyEnemyDamage(target, bullet.damage, bullet.fruit);
    flashEnemy(target, "burn-flash");
    const nextDamage = bullet.damage * 0.5;
    if (Math.floor(nextDamage) >= 1) {
      const hitIds = [...(bullet.hitIds || []), target.id];
      const nextTarget = findNextAppleTarget(target, hitIds);
      if (nextTarget) {
        spawnSingleBullet(
          target.x,
          target.y,
          nextDamage,
          bullet.fruit,
          nextTarget.id,
          bullet.sourceId,
          { hitIds }
        );
      }
    }
    return;
  }
  if (bullet.fruit === "banana") {
    applyEnemyDamage(target, bullet.damage, bullet.fruit);
    if (target.alive) {
      target.slipUntil = now + CONFIG.slipDurationMs;
      updateEnemyPosition(target);
    }
    return;
  }
  if (bullet.fruit === "cucumber") {
    applyEnemyDamage(target, bullet.damage, bullet.fruit);
    if (target.alive) {
      target.slowUntil = now + CONFIG.slowDurationMs;
      updateEnemyPosition(target);
    }
    if (turret) {
      turret.shotIntervalMs = Math.min(turret.shotIntervalMs + 500, 5000);
      adjustNextShot(turret);
    }
    return;
  }
  if (bullet.fruit === "blueberry") {
    applyEnemyDamage(target, bullet.damage, bullet.fruit);
    if (turret) {
      turret.shotIntervalMs = Math.max(turret.shotIntervalMs - 1000, 1000);
      adjustNextShot(turret);
    }
    return;
  }
  applyEnemyDamage(target, bullet.damage, bullet.fruit);
}

function removeBullet(bullet) {
  if (bullet.el) {
    bullet.el.remove();
  }
  TD.bullets = TD.bullets.filter((entry) => entry.id !== bullet.id);
}

function updateBullets(delta, now) {
  TD.bullets.forEach((bullet) => {
    const target = resolveBulletTarget(bullet);
    if (bullet.fruit === "coconut" && bullet.pierceDamage > 0) {
      TD.enemies.forEach((enemy) => {
        if (!enemy.alive || enemy.tier !== "normal" || bullet.pierced.has(enemy.id)) {
          return;
        }
        const dist = Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y);
        if (dist <= 18) {
          bullet.pierced.add(enemy.id);
          applyEnemyDamage(enemy, bullet.pierceDamage, bullet.fruit);
        }
      });
    }
    if (target) {
      const dx = target.x - bullet.x;
      const dy = target.y - bullet.y;
      const dist = Math.hypot(dx, dy) || 1;
      const step = bullet.speed * delta;
      bullet.vx = (dx / dist) * bullet.speed;
      bullet.vy = (dy / dist) * bullet.speed;
      if (dist <= step + 4) {
        if (target.jumpingUntil > now) {
          removeBullet(bullet);
          return;
        }
        applyBulletHit(bullet, target, now);
        removeBullet(bullet);
        return;
      }
      bullet.x += (dx / dist) * step;
      bullet.y += (dy / dist) * step;
    } else {
      if (!Number.isFinite(bullet.vx)) {
        bullet.vx = bullet.speed;
        bullet.vy = 0;
      }
      bullet.x += bullet.vx * delta;
      bullet.y += bullet.vy * delta;
    }
    updateBulletPosition(bullet);
    const fieldRect = UI.field.getBoundingClientRect();
    if (
      bullet.x < -60 ||
      bullet.y < -60 ||
      bullet.x > fieldRect.width + 60 ||
      bullet.y > fieldRect.height + 60
    ) {
      removeBullet(bullet);
    }
  });
}

function updateGrowth(now) {
  TD.slots.forEach((slot) => {
    if (slot.state !== "growing" || !slot.seed) {
      return;
    }
    const progress = Math.min(1, (now - slot.seed.start) / slot.seed.duration);
    const fill = slot.el.querySelector(".grow-fill");
    if (fill) {
      fill.style.width = `${Math.round(progress * 100)}%`;
    }
    if (progress >= 1) {
      createTurret(slot, slot.seed.fruit);
      slot.seed = null;
    }
  });
}

function gameLoop(timestamp) {
  if (!TD.lastTime) {
    TD.lastTime = timestamp;
  }
  const delta = (timestamp - TD.lastTime) / 1000;
  TD.lastTime = timestamp;
  if (!TD.running) {
    return;
  }
  updateGrowth(timestamp);
  updateEnemies(delta, timestamp);
  updateBullets(delta, timestamp);
  updateSpawns(delta);
  if (TD.winPending && !TD.victoryActive && TD.enemies.length === 0) {
    startVictorySequence();
  }
  if (TD.victoryActive && !TD.victoryOverlayShown && TD.victoryTurretsLeft <= 0) {
    finishVictory();
  }
  requestAnimationFrame(gameLoop);
}

function showOverlay(title, body) {
  UI.overlayTitle.textContent = title;
  UI.overlayBody.textContent = body;
  UI.overlay.classList.remove("hidden");
}

function hideOverlay() {
  UI.overlay.classList.add("hidden");
}

function prepareVictory() {
  if (TD.winPending || TD.victoryActive) {
    return;
  }
  TD.winPending = true;
}

function launchFireworks() {
  const fieldRect = UI.field.getBoundingClientRect();
  const left = 40;
  const right = fieldRect.width - 40;
  const top = 40;
  const bottom = fieldRect.height - 40;
  const colors = ["#ff3b3b", "#ffb700", "#39d98a", "#3b82f6", "#a855f7", "#ff6ad5"];
  let count = 0;
  const timer = window.setInterval(() => {
    const x = left + Math.random() * Math.max(20, right - left);
    const y = top + Math.random() * Math.max(20, bottom - top);
    spawnFirework(x, y, colors[count % colors.length]);
    if (count % 3 === 0) {
      AudioBank.play("firework");
    }
    count += 1;
    if (count >= 24) {
      clearInterval(timer);
    }
  }, 180);
}

function celebrateTurret(slot) {
  if (!slot || !slot.turret) {
    TD.victoryTurretsLeft -= 1;
    return;
  }
  const turret = slot.turret;
  clearTurretFire(turret);
  clearTurretTimers(turret);
  turret.locked = true;
  let fired = 0;
  const fieldRect = UI.field.getBoundingClientRect();
  const slotRect = slot.el.getBoundingClientRect();
  const originX = slotRect.left - fieldRect.left + slotRect.width * 0.6;
  const originY = slotRect.top - fieldRect.top + slotRect.height * 0.4;
  const fireBubble = () => {
    if (!slot.turret) {
      TD.victoryTurretsLeft -= 1;
      return;
    }
    spawnBubble(originX + (Math.random() * 24 - 12), originY + (Math.random() * 20 - 10));
    fired += 1;
    if (fired >= 10) {
      removeTurret(slot);
      TD.victoryTurretsLeft -= 1;
      return;
    }
    window.setTimeout(fireBubble, 1000);
  };
  fireBubble();
}

function startVictorySequence() {
  if (TD.victoryActive) {
    return;
  }
  TD.victoryActive = true;
  TD.winPending = false;
  showMessage(TEXT.winBody);
  launchFireworks();
  const turrets = TD.slots.filter((slot) => slot.turret);
  TD.victoryTurretsLeft = turrets.length;
  if (!turrets.length) {
    finishVictory();
    return;
  }
  turrets.forEach((slot) => celebrateTurret(slot));
}

function finishVictory() {
  if (TD.victoryOverlayShown) {
    return;
  }
  TD.victoryOverlayShown = true;
  TD.running = false;
  showOverlay(TEXT.winTitle, TEXT.winBody);
}

function winGame() {
  prepareVictory();
}

function loseGame() {
  if (!TD.running) {
    return;
  }
  TD.running = false;
  AudioBank.play("voice_fail");
  showOverlay(TEXT.loseTitle, TEXT.loseBody);
}

function resetGame() {
  const wasRunning = TD.running;
  TD.enemies.forEach((enemy) => enemy.el && enemy.el.remove());
  TD.bullets.forEach((bullet) => bullet.el && bullet.el.remove());
  TD.enemies = [];
  TD.bullets = [];
  TD.bagLoad = 0;
  TD.bossDefeated = 0;
  TD.bossSpawned = 0;
  TD.bossAlive = false;
  TD.bossTimer = 0;
  TD.speedBoostWave = 0;
  TD.smallHpBudget = 0;
  TD.emptySince = 0;
  TD.winPending = false;
  TD.victoryActive = false;
  TD.victoryOverlayShown = false;
  TD.victoryTurretsLeft = 0;
  TD.running = true;
  TD.errors = 0;
  TD.spawnTimer = 0;
  TD.lastTime = 0;
  TD.spawnTick = 0;
  TD.removeLeftNext = true;
  TD.enemyQueue = [];
  TD.slots.forEach((slot) => {
    if (slot.turret) {
      clearTurretFire(slot.turret);
      clearTurretTimers(slot.turret);
    }
    slot.state = "empty";
    slot.seed = null;
    slot.turret = null;
    slot.el.innerHTML = "";
    slot.el.classList.remove("active");
  });
  TD.activeSlot = null;
  UI.bagValue.textContent = "0";
  updateCoinUI();
  updateStarUI();
  UI.bossValue.textContent = "0";
  initLetterQueue();
  hideOverlay();
  showMessage(TEXT.startHint);
  if (!wasRunning) {
    requestAnimationFrame(gameLoop);
  }
}

function playBagVoice(name) {
  const options = [
    { key: "voice_bag_1", text: TEXT.voiceBag1.replace("{NAME}", name) },
    { key: "voice_bag_2", text: TEXT.voiceBag2 },
    { key: "voice_bag_3", text: TEXT.voiceBag3 },
  ];
  const option = options[Math.floor(Math.random() * options.length)];
  AudioBank.play(option.key, option.text);
}

function getDayFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get("day"));
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value < 1) {
    return 1;
  }
  if (value > 21) {
    return 21;
  }
  return value;
}

async function loadWords(day) {
  const response = await fetch("words.json");
  if (!response.ok) {
    throw new Error(TEXT.loadFail);
  }
  const data = await response.json();
  TD.wordPool = data.filter((item) => item.day === day);
}

function bindUI() {
  if (TD.uiBound) {
    return;
  }
  TD.uiBound = true;
  UI.restartBtn?.addEventListener("click", () => resetGame());
  UI.backBtn?.addEventListener("click", () => {
    if (window.AppNav && typeof window.AppNav.show === "function") {
      window.AppNav.show("home");
    } else {
      window.location.href = "index.html";
    }
  });
  UI.hoeBtn?.addEventListener("pointerdown", (event) => {
    if (TD.coins < CONFIG.hoeCost) {
      showMessage(TEXT.toolNoCoin);
      return;
    }
    startDrag("tool", { tool: "hoe" }, UI.hoeBtn, event);
  });
  UI.keyBtn?.addEventListener("pointerdown", (event) => {
    if (TD.coins < CONFIG.keyCost) {
      showMessage(TEXT.toolNoCoin);
      return;
    }
    startDrag("tool", { tool: "key" }, UI.keyBtn, event);
  });
  UI.hornBtn?.addEventListener("pointerdown", (event) => {
    if (TD.coins < CONFIG.hornCost) {
      showMessage(TEXT.toolNoCoin);
      return;
    }
    startDrag("tool", { tool: "horn" }, UI.hornBtn, event);
  });
  UI.batonBtn?.addEventListener("pointerdown", (event) => {
    if (TD.coins < CONFIG.batonCost) {
      showMessage(TEXT.toolNoCoin);
      return;
    }
    startDrag("tool", { tool: "baton" }, UI.batonBtn, event);
  });
  UI.overlayRestart?.addEventListener("click", () => resetGame());
  UI.overlayBack?.addEventListener("click", () => {
    if (window.AppNav && typeof window.AppNav.show === "function") {
      window.AppNav.show("home");
    } else {
      window.location.href = "index.html";
    }
  });
  const unlockAudioOnce = () => {
    SoundFX.unlock();
    AudioBank.unlock();
  };
  window.addEventListener("pointerdown", unlockAudioOnce, { once: true });
  window.addEventListener("touchstart", unlockAudioOnce, { once: true });
}

async function startDay(dayOverride) {
  if (!TD.initialized) {
    applyI18n();
    initSlots();
    renderSeedTray();
    initLetterQueue();
    buildWordWeights();
    bindUI();
    requestAnimationFrame(gameLoop);
    TD.initialized = true;
  }
  const day = Number.isFinite(dayOverride) ? dayOverride : getDayFromQuery() || 1;
  TD.day = day;
  TD.coins = loadCoins();
  TD.errors = 0;
  if (UI.dayValue) {
    UI.dayValue.textContent = String(day);
  }
  updateCoinUI();
  updateStarUI();
  try {
    await loadWords(day);
    TD.enemyQueue = [];
  } catch (err) {
    showMessage(TEXT.loadFail);
  }
  resetGame();
  showMessage(TEXT.startHint);
  updateCoinUI();
}

window.TDApp = { startDay };

if (!document.getElementById("homeView")) {
  document.addEventListener("DOMContentLoaded", () => {
    startDay(getDayFromQuery() || 1);
  });
}

})();
