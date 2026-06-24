(() => {
"use strict";
const HOME_ROOT = document.getElementById("homeView") || document;
const homeQuery = (selector) => HOME_ROOT.querySelector(selector);

const UI = {
  dayList: homeQuery("#dayList"),
  coinValue: homeQuery("#coinValue"),
  updateBtn: homeQuery("#updateBtn"),
  listHint: homeQuery("#listHint"),
  semesterSelect: homeQuery("#semesterSelect"),
  customStart: homeQuery("#customStart"),
  customOverlay: document.getElementById("customOverlay"),
  customTitle: document.getElementById("customTitle"),
  customBody: document.getElementById("customBody"),
  customActions: document.getElementById("customActions"),
  versionTag: document.getElementById("versionTag"),
  debugPanel: document.getElementById("debugPanel"),
  debugBody: document.getElementById("debugBody"),
  debugToggle: document.getElementById("debugToggle"),
  directPass: document.getElementById("directPass"),
  jumpOverlay: document.getElementById("jumpOverlay"),
  jumpTd: document.getElementById("jumpTd"),
  jumpSnake: document.getElementById("jumpSnake"),
  jumpSearch: document.getElementById("jumpSearch"),
  jumpCancel: document.getElementById("jumpCancel"),
};

const VIEWS = {
  home: document.getElementById("homeView"),
  practice: document.getElementById("practiceView"),
  td: document.getElementById("tdView"),
  snake: document.getElementById("snakeView"),
  wordsearch: document.getElementById("wordsearchView"),
};

const STYLE_LINKS = {
  practice: document.getElementById("practiceCss"),
  td: document.getElementById("tdCss"),
  snake: document.getElementById("snakeCss"),
  wordsearch: document.getElementById("wordsearchCss"),
};

const Debug = {
  buffer: [],
  max: 200,
  open: false,

  init() {
    if (!UI.debugPanel || !UI.debugBody || !UI.debugToggle) {
      return;
    }
    UI.debugToggle.addEventListener("click", () => {
      this.open = !this.open;
      UI.debugPanel.classList.toggle("open", this.open);
      UI.debugToggle.textContent = this.open ? "关闭调试" : "调试";
    });
  },

  log(level, message, detail = null) {
    const ts = new Date().toISOString().slice(11, 19);
    const extra =
      detail === null
        ? ""
        : ` ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
    const line = `[${ts}] ${level.toUpperCase()} ${message}${extra}`;
    this.buffer.push(line);
    if (this.buffer.length > this.max) {
      this.buffer.shift();
    }
    if (UI.debugBody) {
      UI.debugBody.textContent = this.buffer.join("\n");
      UI.debugBody.scrollTop = UI.debugBody.scrollHeight;
    }
    const logger = console[level] || console.log;
    logger(line);
  },
};

const ConfirmDialog = {
  overlay: document.getElementById("confirmOverlay"),
  title: document.getElementById("confirmTitle"),
  message: document.getElementById("confirmMessage"),
  okBtn: document.getElementById("confirmOk"),
  cancelBtn: document.getElementById("confirmCancel"),
  pending: null,

  init() {
    if (!this.overlay || !this.okBtn || !this.cancelBtn) {
      return;
    }
    const resolve = (value) => {
      if (!this.pending) {
        return;
      }
      const { done } = this.pending;
      this.pending = null;
      this.overlay.classList.add("hidden");
      done(value);
    };
    this.okBtn.addEventListener("click", () => resolve(true));
    this.cancelBtn.addEventListener("click", () => resolve(false));
    this.overlay.addEventListener("click", (event) => {
      if (event.target === this.overlay) {
        resolve(false);
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.pending) {
        resolve(false);
      }
    });
  },

  show(message, { okText = "退出", cancelText = "继续" } = {}) {
    if (!this.overlay || !this.okBtn || !this.cancelBtn) {
      return Promise.resolve(window.confirm(message || "确定退出？"));
    }
    if (this.pending) {
      this.pending.done(false);
    }
    if (this.message) {
      this.message.textContent = message || "确定退出？";
    }
    if (this.okBtn) {
      this.okBtn.textContent = okText;
    }
    if (this.cancelBtn) {
      this.cancelBtn.textContent = cancelText;
    }
    this.overlay.classList.remove("hidden");
    return new Promise((resolve) => {
      this.pending = { done: resolve };
    });
  },
};

const JumpDialog = {
  currentDay: null,

  init() {
    if (!UI.jumpOverlay || !UI.jumpCancel) {
      return;
    }
    UI.jumpCancel.addEventListener("click", () => this.hide());
    UI.jumpOverlay.addEventListener("click", (event) => {
      if (event.target === UI.jumpOverlay) {
        this.hide();
      }
    });
    UI.jumpTd?.addEventListener("click", () => this.choose("td"));
    UI.jumpSnake?.addEventListener("click", () => this.choose("snake"));
    UI.jumpSearch?.addEventListener("click", () => this.choose("wordsearch"));
  },

  open(day) {
    this.currentDay = day;
    if (UI.jumpOverlay) {
      UI.jumpOverlay.classList.remove("hidden");
    }
  },

  hide() {
    this.currentDay = null;
    if (UI.jumpOverlay) {
      UI.jumpOverlay.classList.add("hidden");
    }
  },

  choose(view) {
    if (!this.currentDay) {
      return;
    }
    if (!spendCoins(DIRECT_PASS_COST)) {
      return;
    }
    const day = this.currentDay;
    this.hide();
    AppNav.show(view, { day });
  },
};

const DirectPass = {
  dragging: false,
  pointerId: null,
  ghost: null,
  targetRow: null,
  targetDay: null,

  init() {
    if (!UI.directPass) {
      return;
    }
    UI.directPass.addEventListener("pointerdown", (event) => this.onDown(event));
    window.addEventListener("pointermove", (event) => this.onMove(event));
    window.addEventListener("pointerup", (event) => this.onUp(event));
    window.addEventListener("pointercancel", (event) => this.onUp(event));
  },

  onDown(event) {
    if (!UI.directPass || UI.directPass.classList.contains("disabled")) {
      setHint("金币不足");
      return;
    }
    if (AppNav.current !== "home") {
      return;
    }
    this.dragging = true;
    this.pointerId = event.pointerId;
    UI.directPass.setPointerCapture(event.pointerId);
    const rect = UI.directPass.getBoundingClientRect();
    this.ghost = UI.directPass.cloneNode(true);
    this.ghost.classList.add("direct-ghost");
    this.ghost.style.width = `${rect.width}px`;
    this.ghost.style.height = `${rect.height}px`;
    this.ghost.style.right = "auto";
    this.ghost.style.bottom = "auto";
    document.body.appendChild(this.ghost);
    this.updateGhost(event.clientX, event.clientY);
    event.preventDefault();
  },

  onMove(event) {
    if (!this.dragging || event.pointerId !== this.pointerId) {
      return;
    }
    this.updateGhost(event.clientX, event.clientY);
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const row = element ? element.closest(".day-row") : null;
    if (row !== this.targetRow) {
      if (this.targetRow) {
        this.targetRow.classList.remove("drop-target");
      }
      this.targetRow = row;
      this.targetDay = row ? Number(row.dataset.day) : null;
      if (this.targetRow) {
        this.targetRow.classList.add("drop-target");
      }
    }
    event.preventDefault();
  },

  onUp(event) {
    if (!this.dragging || event.pointerId !== this.pointerId) {
      return;
    }
    this.dragging = false;
    if (UI.directPass && this.pointerId !== null) {
      try {
        UI.directPass.releasePointerCapture(this.pointerId);
      } catch (err) {
        // ignore
      }
    }
    this.pointerId = null;
    if (this.ghost) {
      this.ghost.remove();
      this.ghost = null;
    }
    if (this.targetRow) {
      this.targetRow.classList.remove("drop-target");
    }
    const day = this.targetDay;
    this.targetRow = null;
    this.targetDay = null;
    if (day) {
      JumpDialog.open(day);
    }
    event.preventDefault();
  },

  updateGhost(x, y) {
    if (!this.ghost) {
      return;
    }
    this.ghost.style.left = `${x}px`;
    this.ghost.style.top = `${y}px`;
  },
};

const AppNav = {
  current: "home",

  setStyle(view) {
    Object.entries(STYLE_LINKS).forEach(([key, link]) => {
      if (!link) {
        return;
      }
      link.disabled = key !== view;
    });
  },

  show(view, options = {}) {
    const target = VIEWS[view];
    if (!target) {
      return;
    }
    if (this.current && this.current !== view) {
      const currentApp = getViewApp(this.current);
      if (currentApp && typeof currentApp.pause === "function") {
        currentApp.pause();
      }
    }
    Object.values(VIEWS).forEach((node) => {
      if (!node) {
        return;
      }
      node.classList.toggle("active", node === target);
    });
    this.current = view;
    this.setStyle(view);
    document.body.dataset.view = view;
    if (view === "practice") {
      if (
        options.customItems &&
        window.PracticeApp &&
        typeof window.PracticeApp.startCustom === "function"
      ) {
        window.PracticeApp.startCustom(options.customItems, options.customLabel);
      } else if (window.PracticeApp && typeof window.PracticeApp.startDay === "function") {
        window.PracticeApp.startDay(options.day);
      }
      return;
    }
    if (view === "td" && window.TDApp?.startDay) {
      window.TDApp.startDay(options.day);
      return;
    }
    if (view === "snake" && window.SnakeApp?.startDay) {
      window.SnakeApp.startDay(options.day);
      return;
    }
    if (view === "wordsearch" && window.WordSearchApp?.startDay) {
      window.WordSearchApp.startDay(options.day);
    }
  },
};

window.AppNav = AppNav;
window.AppConfirm = (message, options) => ConfirmDialog.show(message, options);

function getViewApp(view) {
  if (view === "practice") {
    return window.PracticeApp || null;
  }
  if (view === "td") {
    return window.TDApp || null;
  }
  if (view === "snake") {
    return window.SnakeApp || null;
  }
  if (view === "wordsearch") {
    return window.WordSearchApp || null;
  }
  return null;
}

const STORAGE_KEYS = {
  coins: "wg-td-coins",
  review: WG.key("wg-review"),
  dayStats: WG.key("wg-day-stats"),
  wordsCache: WG.key("wg-words-cache"),
};

const SESSION_KEYS = {
  nextDay: "wg-next-day",
};

const DIRECT_PASS_COST = 300;

let swRegistration = null;
let initInFlight = false;
let lastTouchEnd = 0;
let touchMoved = false;

function preventDoubleTapZoom() {
  document.addEventListener(
    "touchstart",
    () => {
      touchMoved = false;
    },
    { passive: true }
  );
  document.addEventListener(
    "touchmove",
    () => {
      touchMoved = true;
    },
    { passive: true }
  );
  document.addEventListener(
    "touchend",
    (event) => {
      const now = Date.now();
      if (!touchMoved && now - lastTouchEnd <= 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );
}

function loadCoins() {
  const raw = localStorage.getItem(STORAGE_KEYS.coins);
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function saveCoins(value) {
  try {
    localStorage.setItem(STORAGE_KEYS.coins, String(value));
  } catch (err) {
    // ignore storage errors
  }
}

function spendCoins(amount) {
  const current = loadCoins();
  if (current < amount) {
    setHint("金币不足");
    return false;
  }
  saveCoins(current - amount);
  updateCoinUI();
  return true;
}

function updateCoinUI() {
  if (UI.coinValue) {
    UI.coinValue.textContent = String(loadCoins());
  }
  if (UI.directPass) {
    const enough = loadCoins() >= DIRECT_PASS_COST;
    UI.directPass.classList.toggle("disabled", !enough);
  }
}

function loadReviewRecords() {
  const raw = localStorage.getItem(STORAGE_KEYS.review);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) || {};
  } catch (err) {
    return {};
  }
}

function loadDayStats() {
  const raw = localStorage.getItem(STORAGE_KEYS.dayStats);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) || {};
  } catch (err) {
    return {};
  }
}

function saveWordsCache(words) {
  if (!Array.isArray(words) || words.length === 0) {
    return;
  }
  try {
    const payload = {
      savedAt: new Date().toISOString(),
      words,
    };
    localStorage.setItem(STORAGE_KEYS.wordsCache, JSON.stringify(payload));
  } catch (err) {
    // ignore storage quota errors
  }
}

function loadWordsCacheFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEYS.wordsCache);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const words = Array.isArray(parsed) ? parsed : parsed.words;
    return Array.isArray(words) && words.length ? words : null;
  } catch (err) {
    return null;
  }
}

async function loadWordsCacheFromCaches() {
  if (!("caches" in window)) {
    return null;
  }
  try {
    const cached = await caches.match(WG.wordsFile(), { ignoreSearch: true });
    if (!cached) {
      return null;
    }
    const words = await cached.json();
    return Array.isArray(words) && words.length ? words : null;
  } catch (err) {
    return null;
  }
}

async function loadWordsFallback() {
  const storageWords = loadWordsCacheFromStorage();
  if (storageWords) {
    return { words: storageWords, source: "localStorage" };
  }
  const cachedWords = await loadWordsCacheFromCaches();
  if (cachedWords) {
    return { words: cachedWords, source: "cache" };
  }
  return null;
}

async function loadWords() {
  try {
    const wordsFile = WG.wordsFile();
    Debug.log("info", "fetch words start", { url: wordsFile, cache: "no-store" });
    const response = await fetch(wordsFile, { cache: "no-store" });
    Debug.log("info", "fetch words response", { status: response.status });
    if (!response.ok) {
      throw new Error("词库加载失败");
    }
    const words = await response.json();
    if (!Array.isArray(words) || words.length === 0) {
      throw new Error("词库为空");
    }
    saveWordsCache(words);
    return words;
  } catch (err) {
    Debug.log("error", "fetch words.json failed", { error: err.message || err });
    const fallback = await loadWordsFallback();
    if (fallback && fallback.words) {
      Debug.log("warn", "use cached words", {
        source: fallback.source,
        count: fallback.words.length,
      });
      return fallback.words;
    }
    throw err;
  }
}

function countWrongByDay(records) {
  const result = {};
  Object.values(records).forEach((record) => {
    if (!record || !record.day || record.wrongCount < 1) {
      return;
    }
    const day = String(record.day);
    result[day] = (result[day] || 0) + 1;
  });
  return result;
}

function countWordsByDay(words) {
  const result = {};
  words.forEach((item) => {
    const day = String(item.day || 0);
    if (!day || day === "0") {
      return;
    }
    result[day] = (result[day] || 0) + 1;
  });
  return result;
}

function formatQuality(stats) {
  if (!stats || !stats.stars) {
    return "未挑战";
  }
  return stats.stars;
}

function isPerfect(stats) {
  if (!stats || stats.errors === undefined) {
    return false;
  }
  return Number(stats.errors) <= 0;
}

function setHint(message) {
  if (UI.listHint) {
    UI.listHint.textContent = message || "";
  }
}


async function loadVersionTag() {
  if (!UI.versionTag) {
    return;
  }
  try {
    Debug.log("info", "fetch sw.js start", { url: "sw.js", cache: "no-store" });
    const response = await fetch("sw.js", { cache: "no-store" });
    Debug.log("info", "fetch sw.js response", { status: response.status });
    if (!response.ok) {
      return;
    }
    const text = await response.text();
    const match = text.match(/CACHE_NAME\s*=\s*"(wordgame-v\d+)"/);
    if (match) {
      UI.versionTag.textContent = match[1];
    }
  } catch (err) {
    Debug.log("warn", "fetch sw.js failed", { error: err.message || err });
  }
}

function createGameLink({ title, iconClass, onClick }) {
  const link = document.createElement("button");
  link.className = "game-link";
  link.type = "button";
  link.title = title;
  link.setAttribute("aria-label", title);
  const icon = document.createElement("span");
  icon.className = `game-icon ${iconClass}`;
  link.appendChild(icon);
  link.addEventListener("click", onClick);
  return link;
}

function renderDayList(words, reviewRecords, dayStats) {
  UI.dayList.innerHTML = "";
  const wordCounts = countWordsByDay(words);
  const wrongCounts = countWrongByDay(reviewRecords);
  const totalDays = WG.maxDay();

  for (let day = 1; day <= totalDays; day += 1) {
    const key = String(day);
    const wordCount = wordCounts[key] || 0;
    const wrongCount = wrongCounts[key] || 0;
    const stats = dayStats[key];
    const quality = formatQuality(stats);

    const row = document.createElement("div");
    row.className = "day-row";
    row.dataset.day = String(day);

    const title = document.createElement("div");
    title.className = "day-title";
    title.textContent = WG.dayLabel(day);

    const meta = document.createElement("div");
    meta.className = "day-meta";
    meta.innerHTML = `单词 ${wordCount} · 错词 ${wrongCount} · 质量 <span class="quality">${quality}</span>`;

    const actions = document.createElement("div");
    actions.className = "day-actions";

    if (isPerfect(stats)) {
      const gameLinks = document.createElement("div");
      gameLinks.className = "game-links";
      gameLinks.appendChild(
        createGameLink({
          title: "单词大战作业",
          iconClass: "td-icon",
          onClick: () => AppNav.show("td", { day }),
        })
      );
      gameLinks.appendChild(
        createGameLink({
          title: "贪吃蛇记忆",
          iconClass: "snake-icon",
          onClick: () => AppNav.show("snake", { day }),
        })
      );
      gameLinks.appendChild(
        createGameLink({
          title: "单词寻宝",
          iconClass: "search-icon",
          onClick: () => AppNav.show("wordsearch", { day }),
        })
      );
      actions.appendChild(gameLinks);
    }

    const start = document.createElement("button");
    start.className = "start-btn";
    start.textContent = "进入";
    start.addEventListener("click", () => {
      Debug.log("info", "enter day", { day });
      try {
        sessionStorage.setItem(SESSION_KEYS.nextDay, String(day));
      } catch (err) {
        // ignore storage errors
      }
      AppNav.show("practice", { day });
    });

    actions.appendChild(start);
    row.appendChild(title);
    row.appendChild(meta);
    row.appendChild(actions);
    UI.dayList.appendChild(row);
  }
}

async function updateAppCache() {
  if (!("serviceWorker" in navigator)) {
    setHint("当前浏览器不支持离线更新");
    return;
  }
  setHint("正在检查更新...");
  try {
    const registration =
      swRegistration || (await navigator.serviceWorker.getRegistration());
    if (!registration) {
      location.reload();
      return;
    }
    await registration.update();
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      setHint("正在应用更新...");
      return;
    }
    if (registration.installing) {
      setHint("正在下载更新...");
      registration.installing.addEventListener("statechange", () => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      });
      return;
    }
    setHint("已是最新版本");
    window.setTimeout(() => setHint(""), 1500);
  } catch (err) {
    setHint("更新失败，请稍后再试");
  }
}

UI.updateBtn?.addEventListener("click", () => {
  updateAppCache();
});

Debug.init();
ConfirmDialog.init();
JumpDialog.init();
DirectPass.init();
window.addEventListener("error", (event) => {
  Debug.log("error", "window error", {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    col: event.colno,
  });
});
window.addEventListener("unhandledrejection", (event) => {
  Debug.log("error", "unhandledrejection", {
    reason: event.reason && event.reason.message ? event.reason.message : String(event.reason),
  });
});

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEYS.coins) {
    updateCoinUI();
  }
  if (event.key === STORAGE_KEYS.review || event.key === STORAGE_KEYS.dayStats) {
    init();
  }
});

let loadedWords = [];
let customPanelReady = false;
let semesterSelectorReady = false;

// Normalize an English word/phrase (case/space/quote-insensitive).
function normalizeEn(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Custom recitation task (pick levels -> pick words -> save & recite) ----

function customTaskStorageKey() {
  return WG.key("wg-custom-task");
}

function loadCustomTask() {
  try {
    const raw = localStorage.getItem(customTaskStorageKey());
    if (!raw) {
      return null;
    }
    const task = JSON.parse(raw);
    if (task && task.name && Array.isArray(task.items) && task.items.length) {
      return task;
    }
  } catch (err) {
    // ignore
  }
  return null;
}

function saveCustomTask(task) {
  try {
    localStorage.setItem(customTaskStorageKey(), JSON.stringify(task));
  } catch (err) {
    // ignore storage errors
  }
}

function customWordKey(item) {
  return `${item.day}::${normalizeEn(item.en)}`;
}

function wordsForDays(days) {
  const set = new Set(days.map(Number));
  return loadedWords.filter(
    (item) => item && item.en && set.has(Number(item.day))
  );
}

function itemsForKeys(keys) {
  const set = new Set(keys);
  return loadedWords.filter(
    (item) => item && item.en && set.has(customWordKey(item))
  );
}

function openCustomModal() {
  if (UI.customOverlay) {
    UI.customOverlay.classList.remove("hidden");
  }
}

function closeCustomModal() {
  if (UI.customOverlay) {
    UI.customOverlay.classList.add("hidden");
  }
}

function setCustomModal(title, bodyNodes, actionNodes) {
  if (UI.customTitle) {
    UI.customTitle.textContent = title;
  }
  if (UI.customBody) {
    UI.customBody.innerHTML = "";
    bodyNodes.forEach((node) => UI.customBody.appendChild(node));
  }
  if (UI.customActions) {
    UI.customActions.innerHTML = "";
    actionNodes.forEach((node) => UI.customActions.appendChild(node));
  }
}

function makeActionButton(text, className, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

// Entry point: show the saved task options, or jump straight to level select.
function openCustom() {
  if (!loadedWords.length) {
    setCustomModal(
      "自定义背诵",
      [textNode("词库正在加载，请稍候后再试。")],
      [makeActionButton("关闭", "primary ghost", closeCustomModal)]
    );
    openCustomModal();
    return;
  }
  const task = loadCustomTask();
  if (task) {
    renderSavedTask(task);
  } else {
    renderLevelSelect([], []);
  }
  openCustomModal();
}

function textNode(text, className) {
  const div = document.createElement("div");
  if (className) {
    div.className = className;
  }
  div.textContent = text;
  return div;
}

function renderSavedTask(task) {
  const info = textNode(
    `已保存的临时关卡：「${task.name}」，共 ${task.items.length} 个单词。`,
    "card-sub"
  );
  const startBtn = makeActionButton("开始背诵", "primary", () => {
    closeCustomModal();
    startCustomTask(task.items, task.name);
  });
  const reselectBtn = makeActionButton("重选单词", "primary ghost", () => {
    const days = Array.from(new Set(task.items.map((it) => Number(it.day))));
    const keys = task.items.map(customWordKey);
    renderLevelSelect(days, keys, task.name);
  });
  const cancelBtn = makeActionButton("取消", "primary ghost", closeCustomModal);
  setCustomModal("自定义背诵", [info], [startBtn, reselectBtn, cancelBtn]);
}

function renderLevelSelect(preDays, presetKeys, presetName) {
  const preSet = new Set((preDays || []).map(Number));
  const counts = countWordsByDay(loadedWords);
  const tip = textNode("选择要背诵的关卡（可多选）。", "card-sub");
  const list = document.createElement("div");
  list.className = "custom-list";
  for (let day = 1; day <= WG.maxDay(); day += 1) {
    const count = counts[String(day)] || 0;
    if (count === 0) {
      continue;
    }
    const row = document.createElement("label");
    row.className = "custom-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.day = String(day);
    cb.checked = preSet.has(day);
    const label = textNode(WG.dayLabel(day), "label");
    const meta = textNode(`${count} 个`, "meta");
    row.appendChild(cb);
    row.appendChild(label);
    row.appendChild(meta);
    list.appendChild(row);
  }
  const nextBtn = makeActionButton("下一步", "primary", () => {
    const days = Array.from(
      UI.customBody.querySelectorAll("input[data-day]:checked")
    ).map((cb) => Number(cb.dataset.day));
    if (days.length === 0) {
      return;
    }
    renderWordSelect(days, presetKeys || [], presetName || "");
  });
  const cancelBtn = makeActionButton("取消", "primary ghost", closeCustomModal);
  setCustomModal("选择关卡", [tip, list], [nextBtn, cancelBtn]);
}

function renderWordSelect(days, presetKeys, presetName) {
  const sortedDays = Array.from(new Set(days.map(Number))).sort((a, b) => a - b);
  const hasPreset = Array.isArray(presetKeys) && presetKeys.length > 0;
  const presetSet = new Set(presetKeys || []);

  const nameWrap = document.createElement("div");
  nameWrap.className = "custom-name-wrap";
  nameWrap.appendChild(textNode("临时关卡名字", "card-sub"));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "custom-name";
  nameInput.id = "customTaskName";
  nameInput.maxLength = 20;
  nameInput.placeholder = "例如：植物短语";
  nameInput.value =
    presetName || `自定义 · ${sortedDays.map((d) => WG.dayLabel(d)).join("/")}`;
  nameWrap.appendChild(nameInput);

  const tip = textNode("勾选要背诵的单词（可多选）。", "card-sub");

  const list = document.createElement("div");
  list.className = "custom-list";
  sortedDays.forEach((day) => {
    const dayWords = wordsForDays([day]);
    if (!dayWords.length) {
      return;
    }
    const groupTitle = document.createElement("label");
    groupTitle.className = "custom-group-title";
    const groupCb = document.createElement("input");
    groupCb.type = "checkbox";
    groupCb.dataset.group = String(day);
    groupTitle.appendChild(groupCb);
    groupTitle.appendChild(textNode(WG.dayLabel(day)));
    list.appendChild(groupTitle);

    dayWords.forEach((item) => {
      const key = customWordKey(item);
      const row = document.createElement("label");
      row.className = "custom-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.key = key;
      cb.dataset.group = String(day);
      cb.checked = hasPreset ? presetSet.has(key) : true;
      const label = textNode(item.en, "label");
      const meta = textNode(item.zh || "", "meta");
      row.appendChild(cb);
      row.appendChild(label);
      row.appendChild(meta);
      list.appendChild(row);
    });

    const syncGroup = () => {
      const boxes = Array.from(
        list.querySelectorAll(`input[data-key][data-group="${day}"]`)
      );
      groupCb.checked = boxes.length > 0 && boxes.every((b) => b.checked);
    };
    groupCb.addEventListener("change", () => {
      list
        .querySelectorAll(`input[data-key][data-group="${day}"]`)
        .forEach((b) => {
          b.checked = groupCb.checked;
        });
    });
    list.addEventListener("change", (event) => {
      if (event.target && event.target.dataset.group === String(day) && event.target.dataset.key) {
        syncGroup();
      }
    });
    syncGroup();
  });

  const startBtn = makeActionButton("开始背诵", "primary", () => {
    const keys = Array.from(
      UI.customBody.querySelectorAll("input[data-key]:checked")
    ).map((cb) => cb.dataset.key);
    if (keys.length === 0) {
      return;
    }
    const items = itemsForKeys(keys);
    const name = (nameInput.value || "").trim() || "自定义背诵";
    saveCustomTask({ name, items });
    Debug.log("info", "start custom task", { name, count: items.length });
    closeCustomModal();
    startCustomTask(items, name);
  });
  const backBtn = makeActionButton("上一步", "primary ghost", () => {
    const keys = Array.from(
      UI.customBody.querySelectorAll("input[data-key]:checked")
    ).map((cb) => cb.dataset.key);
    renderLevelSelect(sortedDays, keys, (nameInput.value || "").trim());
  });
  const cancelBtn = makeActionButton("取消", "primary ghost", closeCustomModal);
  setCustomModal("选择单词", [nameWrap, tip, list], [startBtn, backBtn, cancelBtn]);
}

function startCustomTask(items, name) {
  AppNav.show("practice", { customItems: items, customLabel: name });
}

function setupCustomPanel() {
  if (customPanelReady || !UI.customStart) {
    return;
  }
  customPanelReady = true;
  UI.customStart.addEventListener("click", openCustom);
  if (UI.customOverlay) {
    UI.customOverlay.addEventListener("click", (event) => {
      if (event.target === UI.customOverlay) {
        closeCustomModal();
      }
    });
  }
}

function setupSemesterSelector() {
  const select = UI.semesterSelect;
  if (!select || semesterSelectorReady) {
    return;
  }
  semesterSelectorReady = true;
  const currentId = WG.id();
  select.innerHTML = "";
  WG.SEMESTERS.forEach((semester) => {
    const option = document.createElement("option");
    option.value = semester.id;
    option.textContent = semester.label;
    if (semester.id === currentId) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  select.addEventListener("change", () => {
    const nextId = select.value;
    if (nextId === WG.id()) {
      return;
    }
    if (WG.setId(nextId)) {
      Debug.log("info", "switch semester", { semester: nextId });
      // Reload so every module re-reads the active word set and storage keys.
      location.reload();
    }
  });
}

async function init() {
  if (initInFlight) {
    return;
  }
  initInFlight = true;
  Debug.log("info", "init start");
  AppNav.show("home");
  updateCoinUI();
  setupSemesterSelector();
  setupCustomPanel();
  loadVersionTag();
  try {
    if ("serviceWorker" in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register("sw.js");
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          location.reload();
        });
      } catch (err) {
        // ignore sw registration issues
      }
    }
    const words = await loadWords();
    loadedWords = words;
    const reviewRecords = loadReviewRecords();
    const dayStats = loadDayStats();
    renderDayList(words, reviewRecords, dayStats);
    setHint("");
    Debug.log("info", "init ready", { days: WG.maxDay(), words: words.length });
  } catch (err) {
    Debug.log("error", "init failed", { error: err.message || err });
    setHint(err.message || "加载失败，请刷新重试");
  } finally {
    initInFlight = false;
  }
}

document.addEventListener("DOMContentLoaded", init);
preventDoubleTapZoom();
window.addEventListener("pageshow", (event) => {
  if (event.persisted || (UI.dayList && UI.dayList.children.length === 0)) {
    init();
  }
});
window.addEventListener("focus", () => {
  if (UI.dayList && UI.dayList.children.length === 0) {
    init();
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && UI.dayList && UI.dayList.children.length === 0) {
    init();
  }
});

})();
