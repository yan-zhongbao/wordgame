(() => {
  "use strict";

  const TOTAL_WORDS = 100;
  const COIN_PER_HIT = 3; // 射中一个得 3 金币，约 300/局，配合直通车基本打平
  const DISTRACTORS = 13; // atmosphere balloons besides the target
  const BALLOON_ALPHA = 0.8;
  const BALLOON_COLORS = [
    [255, 107, 107],
    [255, 169, 77],
    [255, 212, 59],
    [105, 219, 124],
    [77, 171, 247],
    [151, 117, 250],
    [247, 131, 172],
    [59, 201, 219],
  ];

  const area = document.getElementById("shootArea");
  const bow = document.getElementById("shootBow");
  const bowTarget = document.getElementById("bowTarget");
  const scoreEl = document.getElementById("shootScore");
  const leftEl = document.getElementById("shootLeft");
  const resultEl = document.getElementById("shootResult");
  const resultBody = document.getElementById("shootResultBody");

  const state = {
    pool: [],
    targetIndex: 0,
    score: 0,
    balloons: [],
    running: false,
    shooting: false,
    lastTs: 0,
    spawnCooldown: 0,
    raf: 0,
  };

  function keyOf(item) {
    return `${item.day}::${String(item.en).toLowerCase()}`;
  }
  // dedupe by the visible English word (same word from different days must not
  // both appear, or the kid could click the "wrong" identical balloon)
  function enKeyOf(item) {
    return String(item.en).toLowerCase().trim();
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function randomColor() {
    const c = BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)];
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${BALLOON_ALPHA})`;
  }
  function confettiColor() {
    const c = BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)];
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  function playExplode() {
    try {
      const a = new Audio("audio/td/explode.wav");
      a.volume = 0.6;
      a.play().catch(() => {});
    } catch (err) {
      /* ignore */
    }
  }
  function addGlobalCoins(n) {
    try {
      const k = "wg-td-coins";
      const cur = parseInt(localStorage.getItem(k) || "0", 10) || 0;
      localStorage.setItem(k, String(Math.max(0, cur + n)));
    } catch (err) {
      /* ignore */
    }
  }

  function areaSize() {
    const r = area.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }
  function balloonCenter(b) {
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  function findSpawnX(w, bw) {
    let best = Math.random() * Math.max(1, w - bw);
    let bestGap = -1;
    for (let i = 0; i < 12; i += 1) {
      const x = Math.random() * Math.max(1, w - bw);
      let gap = Infinity;
      for (const b of state.balloons) gap = Math.min(gap, Math.abs(b.x - x));
      if (gap > bestGap) {
        bestGap = gap;
        best = x;
      }
    }
    return best;
  }

  function currentTarget() {
    return state.pool[state.targetIndex] || null;
  }

  // spawn the next upcoming word (sliding window) that isn't on screen yet, so
  // the next target is usually already floating and can simply be promoted —
  // we never change a balloon's word (which looked jarring).
  function spawnNextWord() {
    const onScreen = new Set(state.balloons.map((b) => enKeyOf(b.item)));
    for (let i = state.targetIndex + 1; i < state.pool.length; i += 1) {
      const word = state.pool[i];
      if (!onScreen.has(enKeyOf(word))) {
        spawnBalloon(word, false);
        return;
      }
    }
  }

  // ---- balloons ----
  // CSS sizes the balloon to its text: single words never break (nowrap),
  // phrases wrap only at spaces, so long words get a bigger balloon.
  function makeBalloonEl(item) {
    const el = document.createElement("button");
    el.className = "balloon" + (/\s/.test(item.en) ? " phrase" : "");
    el.style.background = randomColor();
    el.innerHTML = `<span class="balloon-word">${item.en}</span><span class="balloon-string"></span>`;
    return el;
  }

  // size a balloon as a circle big enough to hold its text (keeps balloon shape;
  // long words just get a bigger circle instead of a stretched oval)
  function sizeBalloon(b) {
    b.el.style.width = "";
    b.el.style.height = "";
    const d = Math.max(96, Math.min(210, Math.max(b.el.offsetWidth, b.el.offsetHeight)));
    b.el.style.width = `${d}px`;
    b.el.style.height = `${d}px`;
    b.w = d;
    b.h = d;
  }

  function spawnBalloon(item, isTarget) {
    const { w, h } = areaSize();
    const el = makeBalloonEl(item);
    el.style.transform = "translate(-2000px, -2000px)"; // off-screen to measure
    area.appendChild(el);
    const balloon = {
      item,
      key: keyOf(item),
      el,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      vx: 0,
      vy: -(18 + Math.random() * 14),
      sway: Math.random() * Math.PI * 2,
      isTarget: !!isTarget,
      dead: false,
    };
    sizeBalloon(balloon);
    const bw = balloon.w;
    const r = Math.random();
    if (r < 0.25) {
      balloon.x = -bw;
      balloon.y = h * 0.2 + Math.random() * h * 0.55;
      balloon.vx = 16 + Math.random() * 18;
    } else if (r < 0.5) {
      balloon.x = w;
      balloon.y = h * 0.2 + Math.random() * h * 0.55;
      balloon.vx = -(16 + Math.random() * 18);
    } else {
      balloon.x = findSpawnX(w, bw);
      balloon.y = h + 6;
      balloon.vx = (Math.random() * 2 - 1) * 16;
    }
    el.addEventListener("click", () => onHit(balloon));
    state.balloons.push(balloon);
    position(balloon);
  }

  function position(b) {
    b.el.style.transform = `translate(${b.x}px, ${b.y}px)`;
  }
  function removeBalloon(b) {
    b.dead = true;
    if (b.el && b.el.parentNode) b.el.parentNode.removeChild(b.el);
    state.balloons = state.balloons.filter((x) => x !== b);
  }

  // ensure the current target word has a balloon and is the only one marked.
  // Never relabels an existing balloon — if the word isn't on screen, a fresh
  // balloon floats in for it.
  function provideTarget() {
    const target = currentTarget();
    if (!target) return;
    bowTarget.textContent = target.zh || target.en;
    let tb = state.balloons.find((b) => enKeyOf(b.item) === enKeyOf(target));
    if (!tb) {
      spawnBalloon(target, true);
      tb = state.balloons[state.balloons.length - 1];
    }
    state.balloons.forEach((b) => {
      b.isTarget = b === tb;
    });
  }

  // ---- shooting ----
  function bowCenter() {
    const br = bow.getBoundingClientRect();
    const ar = area.getBoundingClientRect();
    return { x: br.left - ar.left + br.width / 2, y: br.top - ar.top + 6 };
  }

  function shootArrow(toX, toY, hit, onArrive) {
    const from = bowCenter();
    let endX = toX;
    let endY = toY;
    if (!hit) {
      const { w } = areaSize();
      const side = toX < w / 2 ? -1 : 1;
      endX = toX + side * (w * 0.5 + Math.random() * w * 0.3);
      endY = -120;
    }
    const dx = endX - from.x;
    const dy = endY - from.y;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const arrow = document.createElement("div");
    arrow.className = "arrow";
    arrow.textContent = "➤";
    arrow.style.left = `${from.x}px`;
    arrow.style.top = `${from.y}px`;
    arrow.style.transform = `rotate(${ang}deg)`;
    area.appendChild(arrow);
    const dur = hit ? 260 : 540;
    requestAnimationFrame(() => {
      arrow.style.transition = `transform ${dur}ms linear`;
      arrow.style.transform = `translate(${dx}px, ${dy}px) rotate(${ang}deg)`;
    });
    setTimeout(() => {
      if (arrow.parentNode) arrow.parentNode.removeChild(arrow);
      if (onArrive) onArrive();
    }, dur);
  }

  function explode(cx, cy) {
    playExplode();
    for (let i = 0; i < 16; i += 1) {
      const p = document.createElement("div");
      p.className = "confetti";
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.background = confettiColor();
      const a = Math.random() * Math.PI * 2;
      const d = 50 + Math.random() * 80;
      p.style.setProperty("--dx", `${Math.cos(a) * d}px`);
      p.style.setProperty("--dy", `${Math.sin(a) * d}px`);
      area.appendChild(p);
      setTimeout(() => p.parentNode && p.parentNode.removeChild(p), 760);
    }
  }

  function onHit(balloon) {
    if (!state.running || balloon.dead || state.shooting) return;
    const c = balloonCenter(balloon);
    if (balloon.isTarget) {
      state.shooting = true;
      shootArrow(c.x, c.y, true, () => {
        state.shooting = false;
        if (balloon.dead) return;
        const cc = balloonCenter(balloon);
        explode(cc.x, cc.y);
        removeBalloon(balloon);
        state.score += 1;
        scoreEl.textContent = String(state.score);
        leftEl.textContent = String(state.pool.length - state.score);
        state.targetIndex += 1;
        if (state.targetIndex >= state.pool.length) {
          finish();
        } else {
          provideTarget();
        }
      });
    } else {
      shootArrow(c.x, c.y, false, null);
      bow.classList.remove("shake");
      void bow.offsetWidth;
      bow.classList.add("shake");
    }
  }

  // ---- main loop ----
  function tick(ts) {
    if (!state.running) return;
    const dt = Math.min(0.05, (ts - state.lastTs) / 1000 || 0);
    state.lastTs = ts;
    const { w } = areaSize();

    for (const b of [...state.balloons]) {
      b.sway += dt * 1.4;
      b.x += (b.vx + Math.sin(b.sway) * 8) * dt;
      b.y += b.vy * dt;
      if (b.y < -b.h - 8 || b.x < -b.w - 14 || b.x > w + 14) {
        removeBalloon(b);
        continue;
      }
      position(b);
    }

    provideTarget();
    state.spawnCooldown -= dt * 1000;
    if (state.balloons.length < DISTRACTORS + 1 && state.spawnCooldown <= 0) {
      spawnNextWord();
      state.spawnCooldown = 260;
    }

    state.raf = requestAnimationFrame(tick);
  }

  function finish() {
    state.running = false;
    cancelAnimationFrame(state.raf);
    const coins = state.score * COIN_PER_HIT;
    addGlobalCoins(coins);
    resultBody.innerHTML = `你射中了 <b>${state.score}</b> 个单词<br />获得 <b>${coins}</b> 金币 🪙`;
    resultEl.classList.remove("hidden");
  }

  // ---- boot ----
  async function boot() {
    let words = [];
    try {
      const file =
        window.WG && typeof window.WG.wordsFile === "function"
          ? window.WG.wordsFile()
          : "words.json";
      const res = await fetch(file);
      words = await res.json();
    } catch (err) {
      bowTarget.textContent = "词库加载失败";
      return;
    }
    // distinct English words only (same word from different days must not repeat)
    const valid = words.filter((w) => w && w.en && w.zh);
    const seen = new Set();
    const distinct = [];
    for (const w of shuffle(valid)) {
      const k = enKeyOf(w);
      if (!seen.has(k)) {
        seen.add(k);
        distinct.push(w);
      }
    }
    state.pool = distinct.slice(0, TOTAL_WORDS);
    if (!state.pool.length) {
      bowTarget.textContent = "暂无单词";
      return;
    }
    scoreEl.textContent = "0";
    leftEl.textContent = String(state.pool.length);
    state.running = true;
    state.lastTs = performance.now();
    provideTarget();
    for (let i = 0; i < DISTRACTORS; i += 1) spawnNextWord();
    state.raf = requestAnimationFrame(tick);
  }

  document.getElementById("shootBack").addEventListener("click", () => {
    state.running = false;
    cancelAnimationFrame(state.raf);
    window.location.href = "index.html";
  });
  document.getElementById("shootHome").addEventListener("click", () => {
    window.location.href = "index.html";
  });

  boot();
})();
