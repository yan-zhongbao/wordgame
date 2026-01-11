const UI = {
  dayList: document.getElementById("dayList"),
  coinValue: document.getElementById("coinValue"),
  updateBtn: document.getElementById("updateBtn"),
  listHint: document.getElementById("listHint"),
  versionTag: document.getElementById("versionTag"),
  debugPanel: document.getElementById("debugPanel"),
  debugBody: document.getElementById("debugBody"),
  debugToggle: document.getElementById("debugToggle"),
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

const STORAGE_KEYS = {
  coins: "wg-td-coins",
  review: "wg-review",
  dayStats: "wg-day-stats",
  wordsCache: "wg-words-cache",
};

const SESSION_KEYS = {
  nextDay: "wg-next-day",
};

let swRegistration = null;
let initInFlight = false;

function loadCoins() {
  const raw = localStorage.getItem(STORAGE_KEYS.coins);
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function updateCoinUI() {
  if (UI.coinValue) {
    UI.coinValue.textContent = String(loadCoins());
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
    const cached = await caches.match("words.json", { ignoreSearch: true });
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
    Debug.log("info", "fetch words.json start", { url: "words.json", cache: "no-store" });
    const response = await fetch("words.json", { cache: "no-store" });
    Debug.log("info", "fetch words.json response", { status: response.status });
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

function createGameLink({ href, title, iconClass }) {
  const link = document.createElement("a");
  link.className = "game-link";
  link.href = href;
  link.title = title;
  link.setAttribute("aria-label", title);
  const icon = document.createElement("span");
  icon.className = `game-icon ${iconClass}`;
  link.appendChild(icon);
  return link;
}

function renderDayList(words, reviewRecords, dayStats) {
  UI.dayList.innerHTML = "";
  const wordCounts = countWordsByDay(words);
  const wrongCounts = countWrongByDay(reviewRecords);
  const totalDays = 21;

  for (let day = 1; day <= totalDays; day += 1) {
    const key = String(day);
    const wordCount = wordCounts[key] || 0;
    const wrongCount = wrongCounts[key] || 0;
    const stats = dayStats[key];
    const quality = formatQuality(stats);

    const row = document.createElement("div");
    row.className = "day-row";

    const title = document.createElement("div");
    title.className = "day-title";
    title.textContent = `Day ${day}`;

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
          href: `td.html?day=${day}`,
          title: "单词大战作业",
          iconClass: "td-icon",
        })
      );
      gameLinks.appendChild(
        createGameLink({
          href: `snake.html?day=${day}`,
          title: "贪吃蛇记忆",
          iconClass: "snake-icon",
        })
      );
      gameLinks.appendChild(
        createGameLink({
          href: `wordsearch.html?day=${day}`,
          title: "单词寻宝",
          iconClass: "search-icon",
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
      window.location.href = `practice.html?day=${day}`;
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

UI.updateBtn.addEventListener("click", () => {
  updateAppCache();
});

Debug.init();
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

async function init() {
  if (initInFlight) {
    return;
  }
  initInFlight = true;
  Debug.log("info", "init start");
  updateCoinUI();
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
    const reviewRecords = loadReviewRecords();
    const dayStats = loadDayStats();
    renderDayList(words, reviewRecords, dayStats);
    setHint("");
    Debug.log("info", "init ready", { days: 21, words: words.length });
  } catch (err) {
    Debug.log("error", "init failed", { error: err.message || err });
    setHint(err.message || "加载失败，请刷新重试");
  } finally {
    initInFlight = false;
  }
}

document.addEventListener("DOMContentLoaded", init);
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
