const UI = {
  grid: document.getElementById("grid"),
  wordList: document.getElementById("wordList"),
  message: document.getElementById("messageText"),
  dayValue: document.getElementById("dayValue"),
  foundValue: document.getElementById("foundValue"),
  totalValue: document.getElementById("totalValue"),
  starBar: document.getElementById("starBar"),
  coinValue: document.getElementById("coinValue"),
  flashBtn: document.getElementById("flashBtn"),
  speakerBtn: document.getElementById("speakerBtn"),
  xrayBtn: document.getElementById("xrayBtn"),
  handBtn: document.getElementById("handBtn"),
  bombBtn: document.getElementById("bombBtn"),
  radarBtn: document.getElementById("radarBtn"),
  backBtn: document.getElementById("backBtn"),
};

const CONFIG = {
  size: 12,
  reward: 10,
  penalty: 5,
  flashCost: 10,
  speakerCost: 10,
  xrayCost: 50,
  handCost: 10,
  bombCost: 10,
  radarCost: 5,
  xrayMs: 10000,
  handMs: 6000,
  speakerMs: 5000,
  flashTimes: 3,
};

const DIRECTIONS = [
  { dx: 1, dy: 0, key: "-" },
  { dx: 0, dy: 1, key: "|" },
  { dx: 1, dy: 1, key: "\\" },
  { dx: 1, dy: -1, key: "/" },
];

const STORAGE_KEYS = {
  coins: "wg-td-coins",
};

const state = {
  day: 1,
  grid: [],
  words: [],
  selecting: false,
  start: null,
  selection: [],
  lastSelection: [],
  coins: 0,
  errors: 0,
  xrayActive: false,
  speakerActive: false,
  speakerLetter: "",
};

const AudioFX = {
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
      return;
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
  },
  async speak(text, lang = "en-US") {
    if (!("speechSynthesis" in window)) {
      return;
    }
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.9;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  },
  async playGoodJob() {
    try {
      await this.speak("Good job");
      return;
    } catch (err) {
      // fall through
    }
    this.playTone({ frequency: 760, duration: 0.12, type: "sine", gain: 0.12 });
  },
  playWrong() {
    this.playTone({ frequency: 240, duration: 0.16, type: "triangle", gain: 0.14 });
  },
};

function showMessage(text) {
  if (UI.message) {
    UI.message.textContent = text;
  }
}

function vibrate(pattern) {
  if (navigator && navigator.vibrate) {
    navigator.vibrate(pattern);
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
    localStorage.setItem(STORAGE_KEYS.coins, String(state.coins));
  } catch (err) {
    // ignore
  }
}

function updateCoinUI() {
  if (UI.coinValue) {
    UI.coinValue.textContent = String(state.coins);
  }
  toggleDisabled(UI.flashBtn, state.coins < CONFIG.flashCost);
  toggleDisabled(UI.speakerBtn, state.coins < CONFIG.speakerCost || state.speakerActive);
  toggleDisabled(UI.xrayBtn, state.coins < CONFIG.xrayCost || state.xrayActive);
  toggleDisabled(UI.handBtn, state.coins < CONFIG.handCost);
  toggleDisabled(UI.bombBtn, state.coins < CONFIG.bombCost);
  toggleDisabled(UI.radarBtn, state.coins < CONFIG.radarCost);
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
  const count = getStarCount(state.errors);
  const stars = Array.from(UI.starBar.querySelectorAll(".star"));
  if (!stars.length) {
    return;
  }
  stars.forEach((star, index) => {
    star.classList.toggle("dim", index >= count);
  });
}

function toggleDisabled(button, disabled) {
  if (!button) {
    return;
  }
  button.disabled = disabled;
  button.classList.toggle("disabled", disabled);
}

function addCoins(amount) {
  state.coins += amount;
  updateCoinUI();
}

function spendCoins(amount) {
  if (state.coins < amount) {
    showMessage("金币不足");
    return false;
  }
  state.coins -= amount;
  updateCoinUI();
  return true;
}

function applyPenalty() {
  if (state.coins <= 0) {
    return;
  }
  state.coins = Math.max(0, state.coins - CONFIG.penalty);
  updateCoinUI();
}

function getDayFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get("day"));
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(21, Math.max(1, value));
}

async function loadWords(day) {
  const response = await fetch("words.json");
  if (!response.ok) {
    throw new Error("词库加载失败");
  }
  const data = await response.json();
  return data
    .filter((item) => item.day === day && item.en && /^[a-zA-Z]+$/.test(item.en))
    .map((item) => ({
      en: item.en.toLowerCase(),
      zh: item.zh || "",
    }));
}

function initGrid() {
  state.grid = Array.from({ length: CONFIG.size }, (_, row) =>
    Array.from({ length: CONFIG.size }, (_, col) => ({
      row,
      col,
      char: "",
      isWord: false,
      el: null,
    }))
  );
  UI.grid.innerHTML = "";
  state.grid.forEach((row) => {
    row.forEach((cell) => {
      const el = document.createElement("div");
      el.className = "grid-cell";
      el.dataset.row = String(cell.row);
      el.dataset.col = String(cell.col);
      UI.grid.appendChild(el);
      cell.el = el;
    });
  });
}

function canPlace(word, row, col, dir) {
  const endRow = row + dir.dy * (word.length - 1);
  const endCol = col + dir.dx * (word.length - 1);
  if (
    endRow < 0 ||
    endRow >= CONFIG.size ||
    endCol < 0 ||
    endCol >= CONFIG.size
  ) {
    return false;
  }
  for (let i = 0; i < word.length; i += 1) {
    const r = row + dir.dy * i;
    const c = col + dir.dx * i;
    const cell = state.grid[r][c];
    if (cell.char && cell.char !== word[i]) {
      return false;
    }
  }
  return true;
}

function placeWord(entry) {
  const word = entry.en;
  const attempts = 200;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const dir = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    const row = Math.floor(Math.random() * CONFIG.size);
    const col = Math.floor(Math.random() * CONFIG.size);
    if (!canPlace(word, row, col, dir)) {
      continue;
    }
    const positions = [];
    for (let i = 0; i < word.length; i += 1) {
      const r = row + dir.dy * i;
      const c = col + dir.dx * i;
      const cell = state.grid[r][c];
      cell.char = word[i];
      cell.isWord = true;
      positions.push({ row: r, col: c });
    }
    entry.positions = positions;
    entry.dir = dir.key;
    return true;
  }
  return false;
}

function finalizeGrid() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  state.grid.forEach((row) => {
    row.forEach((cell) => {
      if (!cell.char) {
        cell.char = alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      cell.el.textContent = cell.char;
    });
  });
}

function buildWordList() {
  UI.wordList.innerHTML = "";
  state.words = state.words.filter((entry) => entry.positions && entry.positions.length);
  state.words.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "word-item";
    item.dataset.index = String(index);
    item.textContent = entry.zh || entry.en;
    item.addEventListener("click", () => {
      AudioFX.unlock();
      AudioFX.speak(entry.en, "en-US");
    });
    UI.wordList.appendChild(item);
    entry.el = item;
  });
  UI.totalValue.textContent = String(state.words.length);
  UI.foundValue.textContent = "0";
}

function updateFoundUI() {
  const found = state.words.filter((entry) => entry.found).length;
  UI.foundValue.textContent = String(found);
}

function clearSelection() {
  state.lastSelection.forEach((cell) => {
    cell.el.classList.remove("selecting");
  });
  state.lastSelection = [];
}

function markSelection(cells) {
  clearSelection();
  cells.forEach((cell) => {
    cell.el.classList.add("selecting");
  });
  state.lastSelection = cells;
}

function getCellFromPoint(x, y) {
  const element = document.elementFromPoint(x, y);
  if (!element || !element.classList.contains("grid-cell")) {
    return null;
  }
  const row = Number(element.dataset.row);
  const col = Number(element.dataset.col);
  if (!Number.isFinite(row) || !Number.isFinite(col)) {
    return null;
  }
  return state.grid[row][col];
}

function computeSelection(start, end) {
  const dx = end.col - start.col;
  const dy = end.row - start.row;
  if (dx === 0 && dy === 0) {
    return [start];
  }
  let stepX = 0;
  let stepY = 0;
  if (dx === 0 && dy > 0) {
    stepY = 1;
  } else if (dy === 0 && dx > 0) {
    stepX = 1;
  } else if (dx > 0 && dy > 0 && Math.abs(dx) === Math.abs(dy)) {
    stepX = 1;
    stepY = 1;
  } else if (dx > 0 && dy < 0 && Math.abs(dx) === Math.abs(dy)) {
    stepX = 1;
    stepY = -1;
  } else {
    return null;
  }
  const length = Math.max(Math.abs(dx), Math.abs(dy));
  const cells = [];
  for (let i = 0; i <= length; i += 1) {
    const r = start.row + stepY * i;
    const c = start.col + stepX * i;
    cells.push(state.grid[r][c]);
  }
  return cells;
}

async function handleSelection(cells) {
  const match = state.words.find(
    (entry) =>
      !entry.found &&
      entry.positions.length === cells.length &&
      entry.positions.every(
        (pos, index) => pos.row === cells[index].row && pos.col === cells[index].col
      )
  );
  if (!match) {
    state.errors += 1;
    updateStarUI();
    applyPenalty();
    AudioFX.playWrong();
    vibrate([0, 80]);
    showMessage("没找到这个单词");
    clearSelection();
    return;
  }
  match.found = true;
  match.el.classList.add("found");
  match.el.textContent = match.zh ? `${match.en} · ${match.zh}` : match.en;
  match.positions.forEach((pos) => {
    const cell = state.grid[pos.row][pos.col];
    const hue = (match.colorIndex * 55) % 360;
    cell.el.style.setProperty("--found-bg", `hsl(${hue}, 80%, 90%)`);
    cell.el.style.setProperty("--found-ink", `hsl(${hue}, 55%, 35%)`);
    cell.el.classList.add("found");
  });
  updateFoundUI();
  addCoins(CONFIG.reward);
  showMessage("Good job!");
  await AudioFX.playGoodJob();
  AudioFX.speak(match.en, "en-US");
  clearSelection();
}

function startSelection(cell) {
  state.selecting = true;
  state.start = cell;
  state.selection = [cell];
  markSelection(state.selection);
}

function updateSelection(cell) {
  if (!state.selecting || !state.start) {
    return;
  }
  const selection = computeSelection(state.start, cell);
  if (!selection) {
    return;
  }
  state.selection = selection;
  markSelection(selection);
}

function endSelection() {
  if (!state.selecting) {
    return;
  }
  state.selecting = false;
  if (!state.selection.length) {
    clearSelection();
    return;
  }
  handleSelection(state.selection);
}

function flashCell(cell) {
  if (!cell || !cell.el) {
    return;
  }
  cell.el.classList.remove("flash");
  void cell.el.offsetWidth;
  cell.el.classList.add("flash");
}

function useFlashlight() {
  if (!spendCoins(CONFIG.flashCost)) {
    return;
  }
  const remaining = state.words.filter((entry) => !entry.found);
  if (!remaining.length) {
    showMessage("没有剩余单词");
    return;
  }
  const target = remaining[Math.floor(Math.random() * remaining.length)];
  const cell = state.grid[target.positions[0].row][target.positions[0].col];
  let count = 0;
  const timer = window.setInterval(() => {
    flashCell(cell);
    count += 1;
    if (count >= CONFIG.flashTimes) {
      clearInterval(timer);
    }
  }, 300);
}

function useSpeaker() {
  if (state.speakerActive) {
    return;
  }
  if (!spendCoins(CONFIG.speakerCost)) {
    return;
  }
  state.speakerActive = true;
  state.speakerLetter = "";
  updateCoinUI();
  showMessage("点选一个字母");
}

function highlightLetter(letter) {
  if (!letter) {
    return;
  }
  if (!/[a-z]/i.test(letter)) {
    showMessage("请选择字母");
    state.speakerActive = false;
    state.speakerLetter = "";
    updateCoinUI();
    return;
  }
  const target = letter.toLowerCase();
  state.grid.flat().forEach((cell) => {
    if (cell.char === target && !cell.el.classList.contains("found")) {
      cell.el.classList.add("announce");
    }
  });
  state.speakerLetter = target;
  window.setTimeout(() => {
    state.grid.flat().forEach((cell) => cell.el.classList.remove("announce"));
    state.speakerActive = false;
    state.speakerLetter = "";
    updateCoinUI();
  }, CONFIG.speakerMs);
}

function collectWordCells() {
  const cells = new Set();
  state.words.forEach((entry) => {
    entry.positions.forEach((pos) => {
      cells.add(`${pos.row}-${pos.col}`);
    });
  });
  return cells;
}

function useXray() {
  if (state.xrayActive) {
    return;
  }
  if (!spendCoins(CONFIG.xrayCost)) {
    return;
  }
  if (state.speakerActive) {
    state.speakerActive = false;
    state.speakerLetter = "";
  }
  const wordCells = collectWordCells();
  const totalLetters = wordCells.size;
  const decoyCount = Math.ceil(totalLetters * 0.5);
  const decoys = [];
  const neighbors = [];
  wordCells.forEach((key) => {
    const [row, col] = key.split("-").map(Number);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const r = row + dy;
        const c = col + dx;
        if (r < 0 || r >= CONFIG.size || c < 0 || c >= CONFIG.size) {
          continue;
        }
        const nKey = `${r}-${c}`;
        if (!wordCells.has(nKey)) {
          neighbors.push(nKey);
        }
      }
    }
  });
  while (decoys.length < decoyCount && neighbors.length) {
    const idx = Math.floor(Math.random() * neighbors.length);
    const key = neighbors.splice(idx, 1)[0];
    if (!decoys.includes(key)) {
      decoys.push(key);
    }
  }
  const allCells = [];
  wordCells.forEach((key) => allCells.push(key));
  while (decoys.length < decoyCount) {
    const r = Math.floor(Math.random() * CONFIG.size);
    const c = Math.floor(Math.random() * CONFIG.size);
    const key = `${r}-${c}`;
    if (!wordCells.has(key) && !decoys.includes(key)) {
      decoys.push(key);
    }
  }
  UI.grid.classList.add("xray");
  state.xrayActive = true;
  updateCoinUI();
  [...wordCells, ...decoys].forEach((key) => {
    const [row, col] = key.split("-").map(Number);
    state.grid[row][col].el.classList.add("xray-cell");
  });
  window.setTimeout(() => {
    UI.grid.classList.remove("xray");
    state.xrayActive = false;
    state.grid.flat().forEach((cell) => cell.el.classList.remove("xray-cell"));
    updateCoinUI();
  }, CONFIG.xrayMs);
}

function useHand() {
  if (!spendCoins(CONFIG.handCost)) {
    return;
  }
  const remaining = state.words.filter((entry) => !entry.found);
  if (!remaining.length) {
    showMessage("没有剩余单词");
    return;
  }
  const targets = remaining.sort(() => Math.random() - 0.5).slice(0, 3);
  targets.forEach((entry) => {
    const pos = entry.positions[Math.floor(Math.random() * entry.positions.length)];
    const cell = state.grid[pos.row][pos.col];
    cell.el.classList.add("hand");
  });
  window.setTimeout(() => {
    state.grid.flat().forEach((cell) => cell.el.classList.remove("hand"));
  }, CONFIG.handMs);
}

function useBomb() {
  if (!spendCoins(CONFIG.bombCost)) {
    return;
  }
  const candidates = state.grid.flat().filter((cell) => !cell.isWord && cell.char);
  if (!candidates.length) {
    showMessage("没有可炸的字母");
    return;
  }
  const count = Math.min(5, candidates.length);
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor(Math.random() * candidates.length);
    const cell = candidates.splice(idx, 1)[0];
    cell.char = "";
    cell.el.textContent = "";
    cell.el.classList.add("empty");
  }
}

function useRadar() {
  if (!spendCoins(CONFIG.radarCost)) {
    return;
  }
  const counts = { "-": 0, "|": 0, "\\": 0, "/": 0 };
  state.words.filter((entry) => !entry.found).forEach((entry) => {
    counts[entry.dir] = (counts[entry.dir] || 0) + 1;
  });
  showMessage(`-${counts["-"]} |${counts["|"]} \\${counts["\\"]} /${counts["/"]}`);
}

function bindEvents() {
  UI.backBtn.addEventListener("click", () => {
    window.location.href = "index.html";
  });
  UI.flashBtn.addEventListener("click", () => {
    useFlashlight();
  });
  UI.speakerBtn.addEventListener("click", () => {
    useSpeaker();
  });
  UI.xrayBtn.addEventListener("click", () => {
    useXray();
  });
  UI.handBtn.addEventListener("click", () => {
    useHand();
  });
  UI.bombBtn.addEventListener("click", () => {
    useBomb();
  });
  UI.radarBtn.addEventListener("click", () => {
    useRadar();
  });
  UI.grid.addEventListener("pointerdown", (event) => {
    AudioFX.unlock();
    const cell = getCellFromPoint(event.clientX, event.clientY);
    if (!cell) {
      return;
    }
    if (state.speakerActive) {
      highlightLetter(cell.char);
      return;
    }
    startSelection(cell);
  });
  window.addEventListener("pointermove", (event) => {
    if (!state.selecting) {
      return;
    }
    const cell = getCellFromPoint(event.clientX, event.clientY);
    if (!cell) {
      return;
    }
    updateSelection(cell);
  });
  window.addEventListener("pointerup", () => {
    endSelection();
  });
}

async function init() {
  state.day = getDayFromQuery();
  UI.dayValue.textContent = String(state.day);
  state.coins = loadCoins();
  state.errors = 0;
  updateCoinUI();
  updateStarUI();
  bindEvents();
  initGrid();
  try {
    const words = await loadWords(state.day);
    const sorted = [...words].sort((a, b) => b.en.length - a.en.length);
    const placed = [];
    sorted.forEach((entry) => {
    const item = { ...entry, positions: [], found: false, dir: "-", colorIndex: placed.length };
      if (placeWord(item)) {
        placed.push(item);
      }
    });
    state.words = placed;
    finalizeGrid();
    buildWordList();
    showMessage("拖动连线找出单词");
  } catch (err) {
    showMessage("词库加载失败");
  }
}

document.addEventListener("DOMContentLoaded", init);

