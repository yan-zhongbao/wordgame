const UI = {
  dayList: document.getElementById("dayList"),
  coinValue: document.getElementById("coinValue"),
  updateBtn: document.getElementById("updateBtn"),
  listHint: document.getElementById("listHint"),
  versionTag: document.getElementById("versionTag"),
};

const STORAGE_KEYS = {
  coins: "wg-td-coins",
  review: "wg-review",
  dayStats: "wg-day-stats",
};

let swRegistration = null;

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

async function loadWords() {
  const response = await fetch("words.json");
  if (!response.ok) {
    throw new Error("词库加载失败");
  }
  return response.json();
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
    const response = await fetch("sw.js", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const text = await response.text();
    const match = text.match(/CACHE_NAME\s*=\s*"(wordgame-v\d+)"/);
    if (match) {
      UI.versionTag.textContent = match[1];
    }
  } catch (err) {
    // ignore version errors
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
    setHint("更新失败，请稍后再试");
  }
}

UI.updateBtn.addEventListener("click", () => {
  updateAppCache();
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
  updateCoinUI();
  loadVersionTag();
  try {
    if ("serviceWorker" in navigator) {
      swRegistration = await navigator.serviceWorker.register("sw.js");
    }
    const words = await loadWords();
    const reviewRecords = loadReviewRecords();
    const dayStats = loadDayStats();
    renderDayList(words, reviewRecords, dayStats);
    setHint("");
  } catch (err) {
    setHint(err.message || "加载失败，请刷新重试");
  }
}

document.addEventListener("DOMContentLoaded", init);
