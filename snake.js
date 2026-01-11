(() => {
"use strict";
const SNAKE_ROOT = document.getElementById("snakeView") || document;
const snakeQuery = (selector) => SNAKE_ROOT.querySelector(selector);

const UI = {
  field: snakeQuery("#playfield"),
  targetWord: snakeQuery("#targetWord"),
  message: snakeQuery("#messageText"),
  dayValue: snakeQuery("#dayValue"),
  wordValue: snakeQuery("#wordValue"),
  wordTotal: snakeQuery("#wordTotal"),
  levelValue: snakeQuery("#levelValue"),
  starBar: snakeQuery("#starBar"),
  coinValue: snakeQuery("#coinValue"),
  freezeBtn: snakeQuery("#freezeBtn"),
  speedBtn: snakeQuery("#speedBtn"),
  aimBtn: snakeQuery("#aimBtn"),
  backBtn: snakeQuery("#backBtn"),
  effectStatus: snakeQuery("#effectStatus"),
};

const CONFIG = {
  bubbleCount: 36,
  bubbleSize: 40,
  headSize: 46,
  segmentSize: 36,
  segmentSpacing: 24,
  bubbleSpeedMin: 20,
  bubbleSpeedMax: 70,
  headBaseSpeed: 80,
  headSpeedPerLevel: 1.8,
  headSpeedPerWord: 12,
  freezeMs: 10000,
  speedMs: 50000,
  snipeMs: 2000,
  speedMultiplier: 3,
  snipeMultiplier: 4,
  wordCoinReward: 10,
  freezeCost: 20,
  speedCost: 30,
  aimCost: 50,
};

const state = {
  day: 1,
  words: [],
  wordIndex: 0,
  sequence: [],
  progress: 0,
  safeProgress: 0,
  currentWordLetters: 0,
  level: 1,
  wordSpeedBoost: 0,
  errors: 0,
  initialized: false,
  eventsBound: false,
  head: { x: 0, y: 0, targetX: 0, targetY: 0 },
  segments: [],
  tailBadge: null,
  bubbles: [],
  dragging: false,
  completed: false,
  coins: 0,
  freezeUntil: 0,
  speedUntil: 0,
  snipeUntil: 0,
  snipeTargetId: null,
  lastTime: 0,
};

const STORAGE_KEYS = {
  coins: "wg-td-coins",
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
  async speak(text) {
    if (!("speechSynthesis" in window)) {
      return;
    }
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 0.9;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  },
  async playGreat() {
    try {
      await this.speak("Great");
      return;
    } catch (err) {
      // fall through
    }
    this.ensure();
    if (!this.context) {
      return;
    }
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = 680;
    gainNode.gain.setValueAtTime(0.14, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.2);
  },
  playCorrect() {
    this.playTone({ frequency: 720, duration: 0.08, type: "sine", gain: 0.12 });
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
  const freezeActive = isFreezeActive();
  const speedActive = isSpeedActive();
  const snipeActive = isSnipeActive();
  toggleDisabled(UI.freezeBtn, state.coins < CONFIG.freezeCost || freezeActive);
  toggleDisabled(UI.speedBtn, state.coins < CONFIG.speedCost || speedActive);
  toggleDisabled(UI.aimBtn, state.coins < CONFIG.aimCost || snipeActive);
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
  button.classList.toggle("disabled", disabled);
  button.disabled = disabled;
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

function addCoins(amount) {
  state.coins += amount;
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

function isFreezeActive(now = performance.now()) {
  return now < state.freezeUntil;
}

function isSpeedActive(now = performance.now()) {
  return now < state.speedUntil;
}

function isSnipeActive(now = performance.now()) {
  return now < state.snipeUntil;
}

function updateEffectStatus(now) {
  if (!UI.effectStatus) {
    return;
  }
  let needUpdate = false;
  if (state.freezeUntil && now >= state.freezeUntil) {
    state.freezeUntil = 0;
    needUpdate = true;
  }
  if (state.speedUntil && now >= state.speedUntil) {
    state.speedUntil = 0;
    needUpdate = true;
  }
  if (state.snipeUntil && now >= state.snipeUntil) {
    state.snipeUntil = 0;
    state.snipeTargetId = null;
    needUpdate = true;
  }
  const parts = [];
  if (isFreezeActive(now)) {
    parts.push(`冻结 ${Math.ceil((state.freezeUntil - now) / 1000)}s`);
  }
  if (isSpeedActive(now)) {
    parts.push(`加速 ${Math.ceil((state.speedUntil - now) / 1000)}s`);
  }
  if (isSnipeActive(now)) {
    parts.push(`自动 ${Math.ceil((state.snipeUntil - now) / 1000)}s`);
  }
  UI.effectStatus.textContent = parts.join(" · ");
  UI.effectStatus.style.display = parts.length ? "block" : "none";
  if (needUpdate) {
    updateCoinUI();
  }
}

async function loadWords(day) {
  const response = await fetch("words.json");
  if (!response.ok) {
    throw new Error("词库加载失败");
  }
  const data = await response.json();
  return data.filter((item) => item.day === day && item.en);
}

function setWordSequence(word) {
  state.sequence = Array.from(word);
  state.progress = 0;
  state.safeProgress = 0;
  state.currentWordLetters = 0;
  updateWordDisplay();
}

function currentWord() {
  return state.words[state.wordIndex]?.en || "";
}

function normalizeChar(char) {
  if (char === undefined || char === null) {
    return "";
  }
  if (/[a-z]/i.test(char)) {
    return char.toLowerCase();
  }
  return char;
}

function getNeededChars() {
  return state.sequence.map(normalizeChar).filter((char) => char !== "");
}

function isDelimiter(char) {
  return char === " " || char === "-" || char === "/";
}

function updateWordDisplay() {
  const item = state.words[state.wordIndex];
  if (!item) {
    return;
  }
  const parts = state.sequence.map((char, index) => {
    const status = index < state.progress ? "done" : "pending";
    if (char === " ") {
      return `<span class="word-char ${status} space">&nbsp;</span>`;
    }
    return `<span class="word-char ${status}">${escapeChar(char)}</span>`;
  });
  const zh = item.zh ? `<div class="word-zh">${item.zh}</div>` : "";
  UI.targetWord.innerHTML = `${zh}<div class="word-en">${parts.join("")}</div>`;
  UI.wordValue.textContent = String(state.wordIndex + 1);
  UI.wordTotal.textContent = String(state.words.length);
  UI.levelValue.textContent = String(state.level);
}

function escapeChar(char) {
  if (char === " ") {
    return "&nbsp;";
  }
  if (char === "<") {
    return "&lt;";
  }
  if (char === ">") {
    return "&gt;";
  }
  if (char === "&") {
    return "&amp;";
  }
  return char;
}

function createHead() {
  const head = document.createElement("div");
  head.className = "snake-head";
  UI.field.appendChild(head);
  state.head.el = head;
}

function createTailBadge() {
  const badge = document.createElement("div");
  badge.className = "tail-badge";
  badge.textContent = String(state.level);
  UI.field.appendChild(badge);
  state.tailBadge = badge;
}

function createSegment(char, type = "letter") {
  const seg = document.createElement("div");
  seg.className = "snake-seg";
  if (type === "separator") {
    seg.classList.add("separator");
  } else {
    seg.textContent = char;
  }
  UI.field.appendChild(seg);
  return { x: state.head.x, y: state.head.y, char, type, el: seg };
}

function updateTailBadge() {
  state.segments.forEach((segment) => {
    segment.el.classList.remove("tail");
  });
  const tail = state.segments[state.segments.length - 1];
  if (tail) {
    tail.el.classList.add("tail");
  }
  updateTailBadgePosition();
}

function updateTailBadgePosition() {
  if (!state.tailBadge) {
    return;
  }
  const tail = state.segments[state.segments.length - 1];
  if (!tail) {
    state.tailBadge.style.display = "none";
    return;
  }
  const prev = state.segments[state.segments.length - 2];
  const dx = prev ? tail.x - prev.x : 1;
  const dy = prev ? tail.y - prev.y : 0;
  const dist = Math.hypot(dx, dy) || 1;
  const offset = CONFIG.segmentSpacing * 0.6;
  const x = tail.x + (dx / dist) * offset;
  const y = tail.y + (dy / dist) * offset;
  state.tailBadge.style.display = "flex";
  state.tailBadge.textContent = String(state.level);
  state.tailBadge.style.left = `${x - 11}px`;
  state.tailBadge.style.top = `${y - 11}px`;
}

function addLetterSegment(char) {
  const segment = createSegment(char);
  state.segments.unshift(segment);
  state.currentWordLetters += 1;
  updateTailBadge();
}

function addSeparatorSegment() {
  const segment = createSegment("", "separator");
  state.segments.unshift(segment);
  updateTailBadge();
}

function removeLastLetterSegment() {
  if (state.currentWordLetters <= 0) {
    return;
  }
  const segment = state.segments.shift();
  if (segment) {
    segment.el.remove();
  }
  state.currentWordLetters -= 1;
  updateTailBadge();
}

function buildBubble(char) {
  const bubbleChar = normalizeChar(char);
  const el = document.createElement("div");
  el.className = "letter-bubble";
  if (bubbleChar === " ") {
    el.classList.add("space");
  } else {
    el.textContent = bubbleChar;
  }
  const color =
    bubbleChar === " "
      ? "rgba(255, 255, 255, 0.75)"
      : `hsl(${Math.random() * 360}, 80%, 75%)`;
  el.style.background = color;
  const fieldRect = UI.field.getBoundingClientRect();
  const x = Math.random() * (fieldRect.width - CONFIG.bubbleSize) + CONFIG.bubbleSize / 2;
  const y = Math.random() * (fieldRect.height - CONFIG.bubbleSize) + CONFIG.bubbleSize / 2;
  const speed = CONFIG.bubbleSpeedMin + Math.random() * (CONFIG.bubbleSpeedMax - CONFIG.bubbleSpeedMin);
  const angle = Math.random() * Math.PI * 2;
  const bubble = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    char: bubbleChar,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    el,
  };
  UI.field.appendChild(el);
  state.bubbles.push(bubble);
  renderBubble(bubble);
}

function renderBubble(bubble) {
  bubble.el.style.left = `${bubble.x - CONFIG.bubbleSize / 2}px`;
  bubble.el.style.top = `${bubble.y - CONFIG.bubbleSize / 2}px`;
}

function removeBubble(bubble) {
  if (!bubble) {
    return;
  }
  bubble.el.remove();
  state.bubbles = state.bubbles.filter((item) => item.id !== bubble.id);
}

function fillRandomBubbles() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  while (state.bubbles.length < CONFIG.bubbleCount) {
    const char = alphabet[Math.floor(Math.random() * alphabet.length)];
    buildBubble(char);
  }
}

function ensureNeededBubbles(minCount = 3) {
  const neededChars = Array.from(new Set(getNeededChars()));
  if (!neededChars.length) {
    fillRandomBubbles();
    return;
  }
  const expected = normalizeChar(state.sequence[state.progress]);
  neededChars.sort((a, b) => {
    if (a === expected) {
      return -1;
    }
    if (b === expected) {
      return 1;
    }
    return 0;
  });
  const neededSet = new Set(neededChars);
  neededChars.forEach((char) => {
    let count = state.bubbles.filter((bubble) => bubble.char === char).length;
    while (count < minCount) {
      if (state.bubbles.length >= CONFIG.bubbleCount) {
        const idx = state.bubbles.findIndex((bubble) => !neededSet.has(bubble.char));
        if (idx === -1) {
          if (char !== expected) {
            break;
          }
        } else {
          removeBubble(state.bubbles[idx]);
        }
      }
      buildBubble(char);
      count += 1;
    }
  });
  fillRandomBubbles();
}

function findTargetBubble() {
  const expected = normalizeChar(state.sequence[state.progress]);
  if (!expected) {
    return null;
  }
  const candidates = state.bubbles.filter((bubble) => bubble.char === expected);
  if (!candidates.length) {
    return null;
  }
  return candidates.reduce((closest, bubble) => {
    if (!closest) {
      return bubble;
    }
    const d1 = Math.hypot(bubble.x - state.head.x, bubble.y - state.head.y);
    const d2 = Math.hypot(closest.x - state.head.x, closest.y - state.head.y);
    return d1 < d2 ? bubble : closest;
  }, null);
}

function startFreeze() {
  if (isFreezeActive()) {
    showMessage("冻结中");
    return;
  }
  if (!spendCoins(CONFIG.freezeCost)) {
    return;
  }
  state.freezeUntil = performance.now() + CONFIG.freezeMs;
  updateCoinUI();
  showMessage("已冻结 10 秒");
}

function startSpeedBoost() {
  if (isSpeedActive()) {
    showMessage("加速中");
    return;
  }
  if (!spendCoins(CONFIG.speedCost)) {
    return;
  }
  state.speedUntil = performance.now() + CONFIG.speedMs;
  updateCoinUI();
  showMessage("速度提升");
}

function startSnipe() {
  if (isSnipeActive()) {
    showMessage("自动锁定中");
    return;
  }
  let target = findTargetBubble();
  if (!target) {
    ensureNeededBubbles(3);
    target = findTargetBubble();
  }
  if (!target) {
    showMessage("没有找到目标字母");
    return;
  }
  if (!spendCoins(CONFIG.aimCost)) {
    return;
  }
  state.snipeUntil = performance.now() + CONFIG.snipeMs;
  state.snipeTargetId = target.id;
  state.head.targetX = target.x;
  state.head.targetY = target.y;
  state.dragging = false;
  updateCoinUI();
  showMessage("自动抓取中");
}

function ensureExpectedBubble() {
  if (state.progress >= state.sequence.length) {
    return;
  }
  const expected = normalizeChar(state.sequence[state.progress]);
  if (expected === undefined) {
    return;
  }
  const exists = state.bubbles.some((bubble) => bubble.char === expected);
  if (!exists) {
    buildBubble(expected);
  }
}

function initBubbles() {
  state.bubbles.forEach((bubble) => bubble.el.remove());
  state.bubbles = [];
  ensureNeededBubbles(3);
}

function moveHead(delta) {
  const speed = getHeadSpeed();
  const dx = state.head.targetX - state.head.x;
  const dy = state.head.targetY - state.head.y;
  const dist = Math.hypot(dx, dy) || 1;
  const step = speed * delta;
  if (dist <= step) {
    state.head.x = state.head.targetX;
    state.head.y = state.head.targetY;
  } else {
    state.head.x += (dx / dist) * step;
    state.head.y += (dy / dist) * step;
  }
  const fieldRect = UI.field.getBoundingClientRect();
  const half = CONFIG.headSize / 2;
  state.head.x = Math.max(half, Math.min(fieldRect.width - half, state.head.x));
  state.head.y = Math.max(half, Math.min(fieldRect.height - half, state.head.y));
  state.head.el.style.left = `${state.head.x - half}px`;
  state.head.el.style.top = `${state.head.y - half}px`;
}

function getHeadSpeed() {
  const base = CONFIG.headBaseSpeed + state.level * CONFIG.headSpeedPerLevel + state.wordSpeedBoost;
  const now = performance.now();
  let multiplier = isSpeedActive(now) ? CONFIG.speedMultiplier : 1;
  if (isSnipeActive(now)) {
    multiplier = Math.max(multiplier, CONFIG.snipeMultiplier);
  }
  return base * multiplier;
}

function moveSegments() {
  let prevX = state.head.x;
  let prevY = state.head.y;
  state.segments.forEach((segment) => {
    const dx = prevX - segment.x;
    const dy = prevY - segment.y;
    const dist = Math.hypot(dx, dy) || 1;
    const target = CONFIG.segmentSpacing;
    if (dist > target) {
      segment.x = prevX - (dx / dist) * target;
      segment.y = prevY - (dy / dist) * target;
    }
    segment.el.style.left = `${segment.x - CONFIG.segmentSize / 2}px`;
    segment.el.style.top = `${segment.y - CONFIG.segmentSize / 2}px`;
    prevX = segment.x;
    prevY = segment.y;
  });
  updateTailBadgePosition();
}

function updateBubbles(delta) {
  if (isFreezeActive()) {
    return;
  }
  const fieldRect = UI.field.getBoundingClientRect();
  const half = CONFIG.bubbleSize / 2;
  state.bubbles.forEach((bubble) => {
    bubble.x += bubble.vx * delta;
    bubble.y += bubble.vy * delta;
    if (bubble.x <= half || bubble.x >= fieldRect.width - half) {
      bubble.vx *= -1;
      bubble.x = Math.max(half, Math.min(fieldRect.width - half, bubble.x));
    }
    if (bubble.y <= half || bubble.y >= fieldRect.height - half) {
      bubble.vy *= -1;
      bubble.y = Math.max(half, Math.min(fieldRect.height - half, bubble.y));
    }
    renderBubble(bubble);
  });
}

function updateSnipeTarget(now) {
  if (!isSnipeActive(now)) {
    state.snipeTargetId = null;
    return;
  }
  let target = state.bubbles.find((bubble) => bubble.id === state.snipeTargetId);
  if (!target) {
    target = findTargetBubble();
    if (target) {
      state.snipeTargetId = target.id;
    }
  }
  if (!target) {
    state.snipeUntil = 0;
    state.snipeTargetId = null;
    return;
  }
  let offsetX = 0;
  let offsetY = 0;
  const avoidRadius = 52;
  state.bubbles.forEach((bubble) => {
    if (bubble.id === target.id) {
      return;
    }
    const dx = bubble.x - state.head.x;
    const dy = bubble.y - state.head.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < avoidRadius) {
      const weight = (avoidRadius - dist) / avoidRadius;
      offsetX -= (dx / dist) * weight * 30;
      offsetY -= (dy / dist) * weight * 30;
    }
  });
  state.head.targetX = target.x + offsetX;
  state.head.targetY = target.y + offsetY;
}

function expectedChar() {
  return state.sequence[state.progress];
}

function matchesExpected(char, expected) {
  if (expected === undefined) {
    return false;
  }
  return char === normalizeChar(expected);
}

function handleEat(bubble) {
  if (state.completed) {
    return;
  }
  const expected = expectedChar();
  if (matchesExpected(bubble.char, expected)) {
    addLetterSegment(bubble.char);
    state.progress += 1;
    updateWordDisplay();
    AudioFX.playCorrect();
    vibrate(30);
    if (isDelimiter(expected)) {
      state.safeProgress = state.progress;
    }
    if (isSnipeActive()) {
      state.snipeUntil = 0;
      state.snipeTargetId = null;
      updateCoinUI();
    }
    if (state.progress >= state.sequence.length) {
      completeWord();
      return;
    }
  } else {
    state.errors += 1;
    updateStarUI();
    AudioFX.playWrong();
    vibrate([0, 80]);
    if (state.progress > state.safeProgress && state.currentWordLetters > 0) {
      state.progress -= 1;
      removeLastLetterSegment();
      updateWordDisplay();
      showMessage("吃错啦，退回一个字母");
    } else {
      showMessage("吃错啦");
    }
  }
  replaceBubble(bubble);
}

function replaceBubble(bubble) {
  removeBubble(bubble);
  ensureNeededBubbles(3);
}

function checkCollisions() {
  const threshold = CONFIG.headSize * 0.45 + CONFIG.bubbleSize * 0.45;
  const snipeActive = isSnipeActive();
  const targetId = state.snipeTargetId;
  const bubbles = [...state.bubbles];
  for (const bubble of bubbles) {
    if (snipeActive && bubble.id !== targetId) {
      continue;
    }
    const dx = bubble.x - state.head.x;
    const dy = bubble.y - state.head.y;
    if (Math.hypot(dx, dy) <= threshold) {
      handleEat(bubble);
      break;
    }
  }
}

function completeWord() {
  const finishedWord = currentWord();
  if (finishedWord) {
    AudioFX.speak(finishedWord, "en-US").then(() => AudioFX.playGreat());
  } else {
    AudioFX.playGreat();
  }
  addSeparatorSegment();
  state.currentWordLetters = 0;
  state.safeProgress = 0;
  addCoins(CONFIG.wordCoinReward);
  state.wordIndex += 1;
  state.wordSpeedBoost += CONFIG.headSpeedPerWord;
  state.level += 1;
  updateWordDisplay();
  updateTailBadge();
  if (state.wordIndex >= state.words.length) {
    finishAll();
    return;
  }
  setWordSequence(currentWord());
  initBubbles();
  showMessage("Great! 继续下一词！");
}

function finishAll() {
  state.completed = true;
  state.bubbles.forEach((bubble) => bubble.el.remove());
  state.bubbles = [];
  showMessage("全部完成！");
  layoutFinalSnake();
}

function layoutFinalSnake() {
  const fieldRect = UI.field.getBoundingClientRect();
  const ordered = [...state.segments].reverse();
  if (!ordered.length) {
    return;
  }
  const startX = 40;
  const endX = fieldRect.width - 40;
  const span = Math.max(1, endX - startX);
  const spacing = Math.max(16, Math.min(28, span / (ordered.length + 1)));
  const baseY = fieldRect.height * 0.55;
  const amp = Math.min(80, fieldRect.height * 0.2);
  ordered.forEach((segment, index) => {
    const x = startX + spacing * (index + 1);
    const y = baseY + Math.sin((index / Math.max(1, ordered.length - 1)) * Math.PI * 2) * amp;
    segment.x = x;
    segment.y = y;
    segment.el.style.left = `${x - CONFIG.segmentSize / 2}px`;
    segment.el.style.top = `${y - CONFIG.segmentSize / 2}px`;
  });
  const last = ordered[ordered.length - 1];
  state.head.x = last.x + CONFIG.segmentSpacing;
  state.head.y = last.y;
  state.head.el.style.left = `${state.head.x - CONFIG.headSize / 2}px`;
  state.head.el.style.top = `${state.head.y - CONFIG.headSize / 2}px`;
  updateTailBadgePosition();
}

function gameLoop(timestamp) {
  if (!state.lastTime) {
    state.lastTime = timestamp;
  }
  const delta = (timestamp - state.lastTime) / 1000;
  state.lastTime = timestamp;
  if (!state.completed) {
    updateSnipeTarget(timestamp);
    moveHead(delta);
    moveSegments();
    updateBubbles(delta);
    checkCollisions();
  }
  updateEffectStatus(timestamp);
  requestAnimationFrame(gameLoop);
}

function setTarget(event) {
  if (isSnipeActive()) {
    return;
  }
  const rect = UI.field.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  state.head.targetX = x;
  state.head.targetY = y;
}

function bindEvents() {
  if (state.eventsBound) {
    return;
  }
  state.eventsBound = true;
  UI.backBtn.addEventListener("click", () => {
    if (window.AppNav && typeof window.AppNav.show === "function") {
      window.AppNav.show("home");
    } else {
      window.location.href = "index.html";
    }
  });
  UI.freezeBtn?.addEventListener("click", () => {
    startFreeze();
  });
  UI.speedBtn?.addEventListener("click", () => {
    startSpeedBoost();
  });
  UI.aimBtn?.addEventListener("click", () => {
    startSnipe();
  });
  UI.field.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    AudioFX.unlock();
    setTarget(event);
  });
  window.addEventListener("pointermove", (event) => {
    if (!state.dragging) {
      return;
    }
    setTarget(event);
  });
  window.addEventListener("pointerup", () => {
    state.dragging = false;
  });
}

function resetScene() {
  state.wordIndex = 0;
  state.sequence = [];
  state.progress = 0;
  state.safeProgress = 0;
  state.currentWordLetters = 0;
  state.level = 1;
  state.wordSpeedBoost = 0;
  state.errors = 0;
  state.segments = [];
  state.tailBadge = null;
  state.bubbles = [];
  state.dragging = false;
  state.completed = false;
  state.freezeUntil = 0;
  state.speedUntil = 0;
  state.snipeUntil = 0;
  state.snipeTargetId = null;
  state.lastTime = 0;
  if (UI.field) {
    UI.field
      .querySelectorAll(".snake-head, .snake-seg, .tail-badge, .letter-bubble")
      .forEach((node) => node.remove());
  }
}

async function startDay(dayOverride) {
  if (!state.initialized) {
    bindEvents();
    requestAnimationFrame(gameLoop);
    state.initialized = true;
  }
  const day = Number.isFinite(dayOverride) ? dayOverride : getDayFromQuery();
  state.day = day;
  if (UI.dayValue) {
    UI.dayValue.textContent = String(state.day);
  }
  state.coins = loadCoins();
  updateCoinUI();
  updateStarUI();
  resetScene();
  try {
    state.words = await loadWords(state.day);
  } catch (err) {
    showMessage("词库加载失败");
    return;
  }
  if (!state.words.length) {
    showMessage("当前关卡没有可用单词");
    return;
  }
  const fieldRect = UI.field.getBoundingClientRect();
  state.head.x = fieldRect.width / 2;
  state.head.y = fieldRect.height / 2;
  state.head.targetX = state.head.x;
  state.head.targetY = state.head.y;
  createHead();
  createTailBadge();
  setWordSequence(currentWord());
  initBubbles();
  showMessage("拖动蛇头吃字母");
}

window.SnakeApp = { startDay };

if (!document.getElementById("homeView")) {
  document.addEventListener("DOMContentLoaded", () => {
    startDay(getDayFromQuery());
  });
}

})();
