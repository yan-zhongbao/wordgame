(() => {
  "use strict";

  const ROOT = document.getElementById("examView") || document;
  const q = (sel) => ROOT.querySelector(sel);

  const UI = {
    main: q("#examMain"),
    total: q("#examTotal"),
    done: q("#examDone"),
    score: q("#examScore"),
    elapsed: q("#examElapsed"),
    eta: q("#examEta"),
    progressFill: q("#examProgressFill"),
    back: q("#examBack"),
    overlay: q("#examOverlay"),
    resultTitle: q("#examResultTitle"),
    resultBody: q("#examResultBody"),
    resultActions: q("#examResultActions"),
    coinRain: q("#examCoinRain"),
  };

  // [type, word count]; choice types weigh more, spelling least.
  const PLAN = [
    ["listenMeaning", 18],
    ["listenWord", 18],
    ["meaningWord", 18],
    ["complete", 12],
    ["correctFind", 6],
    ["correctReplace", 6],
    ["spell", 10],
    ["match", 12], // 2 rounds of 6
  ];

  let state = null;

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

  const VOWELS = "aeiou";
  const CONSONANTS = "bcdfghjklmnpqrstvwxyz";
  // Pad candidate letters to at least 4 with same-class "sand" distractors
  // (vowels get vowels, consonants get consonants) so a single blank isn't
  // trivially the only choice.
  function padToFour(letters) {
    const out = letters.slice();
    let guard = 0;
    while (out.length < 4 && guard < 60) {
      guard += 1;
      const base = letters[Math.floor(Math.random() * letters.length)] || "a";
      const poolStr = VOWELS.includes(base) ? VOWELS : CONSONANTS;
      const c = poolStr[Math.floor(Math.random() * poolStr.length)];
      if (!out.includes(c)) out.push(c);
    }
    return out;
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

  function keyOf(item) {
    return `${item.day}::${String(item.en).toLowerCase()}`;
  }

  function dedupeWrong(list) {
    const seen = new Set();
    const out = [];
    (list || []).forEach((it) => {
      if (!it || !it.en) return;
      const k = keyOf(it);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(it);
    });
    return out;
  }

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
  function playItem(item) {
    if (!item || !item.en) return;
    const folder = item.kind === "phrase" ? "phrase" : "en";
    const src = `audio/${folder}/${slugify(item.en)}.mp3`;
    try {
      if (currentAudio) currentAudio.pause();
      currentAudio = new Audio(src);
      currentAudio.play().catch(() => speak(item.en));
    } catch (err) {
      speak(item.en);
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

  function sampleValues(pool, n, excludeKey, mapFn) {
    const seen = new Set();
    const out = [];
    for (const item of shuffle([...pool])) {
      if (out.length >= n) break;
      if (keyOf(item) === excludeKey) continue;
      const v = mapFn(item);
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  // ---- exam construction ----
  function buildExam(words) {
    const valid = words.filter((w) => w && w.en && w.zh);
    const byKey = new Map();
    valid.forEach((w) => {
      const k = keyOf(w);
      if (!byKey.has(k)) byKey.set(k, w);
    });
    const allKeys = shuffle([...byKey.keys()]);
    const used = new Set();
    const isSpellable = (it) =>
      /^[a-zA-Z]+$/.test(it.en) && it.en.length >= 3 && it.en.length <= 11;

    function take(n, predicate) {
      const out = [];
      for (const k of allKeys) {
        if (out.length >= n) break;
        if (used.has(k)) continue;
        const it = byKey.get(k);
        if (predicate && !predicate(it)) continue;
        used.add(k);
        out.push(it);
      }
      return out;
    }

    const b = {};
    b.spell = take(6, isSpellable);
    b.complete = take(10, isSpellable);
    b.correctFind = take(6, isSpellable);
    b.correctReplace = take(6, isSpellable);
    b.listenMeaning = take(16);
    b.listenWord = take(16);
    b.meaningWord = take(16);
    b.match = take(24); // 4 rounds of 6

    // single-word questions, shuffled
    const single = [];
    const push = (type, list) =>
      list.forEach((it) => single.push({ type, item: it }));
    push("listenMeaning", b.listenMeaning);
    push("listenWord", b.listenWord);
    push("meaningWord", b.meaningWord);
    push("complete", b.complete);
    push("correctFind", b.correctFind);
    push("correctReplace", b.correctReplace);
    push("spell", b.spell);
    shuffle(single);

    // matching rounds, spread evenly through the exam so they appear regularly
    const matchQs = [];
    for (let i = 0; i + 1 < b.match.length; i += 6) {
      matchQs.push({ type: "match", items: b.match.slice(i, i + 6) });
    }
    const questions = [...single];
    matchQs.forEach((mq, k) => {
      const base = Math.round((single.length / (matchQs.length + 1)) * (k + 1));
      const idx = Math.min(questions.length, base + k);
      questions.splice(idx, 0, mq);
    });

    const total = questions.reduce(
      (s, qn) => s + (qn.type === "match" ? qn.items.length : 1),
      0
    );
    return { questions, total, pool: valid };
  }

  // ---- top bar / timer ----
  function fmtTime(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  function updateTimer() {
    if (!state) return;
    const elapsed = Date.now() - state.startTime;
    if (UI.elapsed) UI.elapsed.textContent = fmtTime(elapsed);
    if (UI.eta) {
      if (state.done <= 0) {
        UI.eta.textContent = "--";
      } else if (state.done >= state.total) {
        UI.eta.textContent = "0:00";
      } else {
        const remaining = (elapsed / state.done) * (state.total - state.done);
        UI.eta.textContent = fmtTime(remaining);
      }
    }
  }

  function updateTopBar() {
    if (UI.total) UI.total.textContent = String(state.total);
    if (UI.done) UI.done.textContent = String(state.done);
    if (UI.score) UI.score.textContent = String(state.score);
    if (UI.progressFill) {
      const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
      UI.progressFill.style.width = `${pct}%`;
    }
    updateTimer();
  }

  function advance() {
    state.index += 1;
    renderCurrent();
  }

  // Hand-drawn red check drawn over the answered element (targetEl), with
  // exaggerated, randomized size / position / stroke each time so it looks like
  // a teacher casually marking by hand.
  function showCorrectCheck(targetEl) {
    const svgns = "http://www.w3.org/2000/svg";
    const r = (n, d) => n + (Math.random() * 2 - 1) * d;
    const mainRect = UI.main.getBoundingClientRect();
    let cx;
    let cy;
    let span;
    if (targetEl && targetEl.getBoundingClientRect) {
      const tr = targetEl.getBoundingClientRect();
      cx = tr.left - mainRect.left + tr.width / 2;
      cy = tr.top - mainRect.top + tr.height / 2;
      span = Math.max(tr.width, tr.height);
    } else {
      cx = mainRect.width / 2;
      cy = mainRect.height / 2;
      span = 130;
    }
    const size = Math.max(64, Math.min(220, span * (1.0 + Math.random() * 0.9)));
    // casual offset from the element centre
    const offX = (Math.random() * 2 - 1) * size * 0.45;
    const offY = (Math.random() * 2 - 1) * size * 0.4;
    const rot = (Math.random() * 2 - 1) * 34;
    const stroke = 5 + Math.random() * 9; // 5 - 14

    const svg = document.createElementNS(svgns, "svg");
    svg.setAttribute("class", "exam-check");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.style.left = `${cx + offX - size / 2}px`;
    svg.style.top = `${cy + offY - size / 2}px`;
    svg.style.width = `${size}px`;
    svg.style.height = `${size}px`;
    svg.style.transform = `rotate(${rot}deg)`;

    // randomize the tick shape: short leg + long leg, varied lengths/angles
    const x1 = r(14, 8);
    const y1 = r(52, 10);
    const ex = r(40, 8); // elbow
    const ey = r(82, 8);
    const cxp = r(26, 8); // control toward elbow
    const cyp = r(74, 10);
    const x3 = r(92, 8); // long-leg tip
    const y3 = r(12, 12);
    const cx2 = r(64, 10); // control toward tip
    const cy2 = r(34, 12);
    const d = `M ${x1} ${y1} Q ${cxp} ${cyp} ${ex} ${ey} Q ${cx2} ${cy2} ${x3} ${y3}`;
    const path = document.createElementNS(svgns, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "exam-check-path");
    path.setAttribute("stroke-width", String(stroke.toFixed(1)));
    path.setAttribute("stroke-dasharray", "320");
    path.setAttribute("stroke-dashoffset", "320");
    svg.appendChild(path);
    UI.main.appendChild(svg);
  }

  // Resolve a question. allCorrect -> auto-advance after a beat; else show 下一题.
  function conclude(wrap, allCorrect, gained, count, wrongItems, targetEl) {
    state.score += gained;
    state.done += count;
    if (wrongItems && wrongItems.length) {
      wrongItems.forEach((it) => state.wrong.push(it));
    }
    updateTopBar();
    if (allCorrect) {
      showCorrectCheck(targetEl);
      setTimeout(advance, 1100);
    } else {
      const btn = el("button", "exam-next", "下一题");
      btn.addEventListener("click", advance);
      wrap.appendChild(btn);
    }
  }

  // ---- choice ----
  function renderChoice(qn) {
    const item = qn.item;
    const isListen = qn.type === "listenMeaning" || qn.type === "listenWord";
    const answerIsEnglish =
      qn.type === "listenWord" || qn.type === "meaningWord";

    const wrap = el("div", "exam-q");
    if (isListen) {
      wrap.appendChild(el("div", "exam-q-tip", "听发音，选择正确答案"));
      const audioBtn = el("button", "exam-audio-btn", "🔊 播放发音");
      audioBtn.addEventListener("click", () => playItem(item));
      wrap.appendChild(audioBtn);
      setTimeout(() => playItem(item), 250);
    } else {
      wrap.appendChild(el("div", "exam-q-tip", "选择正确的单词"));
      wrap.appendChild(el("div", "exam-q-prompt", item.zh));
    }

    const correctValue = answerIsEnglish ? item.en : item.zh;
    const distractors = sampleValues(state.pool, 3, keyOf(item), (it) =>
      answerIsEnglish ? it.en : it.zh
    ).filter((v) => v !== correctValue);
    const options = shuffle([correctValue, ...distractors.slice(0, 3)]);

    const optBox = el("div", "exam-options");
    let answered = false;
    options.forEach((opt) => {
      const bt = el("button", "exam-option", opt);
      bt.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const correct = opt === correctValue;
        Array.from(optBox.children).forEach((c) => {
          c.disabled = true;
          if (c.textContent === correctValue) c.classList.add("right");
        });
        if (!correct) bt.classList.add("wrong");
        const target = Array.from(optBox.children).find((c) =>
          c.classList.contains("right")
        );
        conclude(wrap, correct, correct ? 1 : 0, 1, correct ? [] : [item], target);
      });
      optBox.appendChild(bt);
    });
    wrap.appendChild(optBox);
    return wrap;
  }

  // ---- tile-fill (spelling / completion): tap letters into slots ----
  function renderTileFill(qn, missingOnly) {
    const item = qn.item;
    const word = item.en.toLowerCase();
    const wrap = el("div", "exam-q");
    wrap.appendChild(
      el(
        "div",
        "exam-q-tip",
        missingOnly ? "补全单词：点下方字母填入空格" : "拼写单词：点下方字母按顺序拼出"
      )
    );
    if (missingOnly) {
      const audioBtn = el("button", "exam-audio-btn small", "🔊");
      audioBtn.addEventListener("click", () => playItem(item));
      wrap.appendChild(audioBtn);
    } else {
      const audioBtn = el("button", "exam-audio-btn small", "🔊");
      audioBtn.addEventListener("click", () => playItem(item));
      wrap.appendChild(audioBtn);
    }
    wrap.appendChild(el("div", "exam-q-prompt", item.zh));

    // which positions are blanks
    let blankPos;
    if (missingOnly) {
      const count = Math.max(1, Math.round(word.length * 0.4));
      blankPos = shuffle(word.split("").map((_, i) => i)).slice(0, count);
    } else {
      blankPos = word.split("").map((_, i) => i);
    }
    blankPos.sort((a, b) => a - b);
    const blankSet = new Set(blankPos);

    // slots row
    const row = el("div", "exam-slots");
    const slotEls = new Map(); // position -> slot element
    for (let i = 0; i < word.length; i += 1) {
      if (blankSet.has(i)) {
        const slot = el("button", "exam-slot empty");
        slot.dataset.pos = String(i);
        row.appendChild(slot);
        slotEls.set(i, slot);
      } else {
        row.appendChild(el("span", "exam-slot fixed", word[i]));
      }
    }
    wrap.appendChild(row);

    // candidate letters = letters of the blanks (+ same-class distractors so
    // there are always at least 4 choices), shuffled
    const candLetters = shuffle(padToFour(blankPos.map((i) => word[i])));
    const tray = el("div", "exam-tray");
    const placed = new Map(); // position -> {letter, tileBtn}
    let resolved = false;

    function checkFull() {
      if (placed.size !== blankPos.length || resolved) return;
      resolved = true;
      let allRight = true;
      blankPos.forEach((pos) => {
        const slot = slotEls.get(pos);
        const got = placed.get(pos).letter;
        if (got === word[pos]) {
          slot.classList.add("right");
        } else {
          slot.classList.add("wrong");
          allRight = false;
        }
      });
      tray.querySelectorAll("button").forEach((b) => (b.disabled = true));
      if (!allRight) {
        wrap.appendChild(el("div", "exam-answer", `正确答案：${word}`));
      }
      conclude(wrap, allRight, allRight ? 1 : 0, 1, allRight ? [] : [item], row);
    }

    function placeLetter(letter, tileBtn) {
      if (resolved) return;
      const pos = blankPos.find((p) => !placed.has(p));
      if (pos === undefined) return;
      placed.set(pos, { letter, tileBtn });
      const slot = slotEls.get(pos);
      slot.textContent = letter;
      slot.classList.remove("empty");
      slot.classList.add("filled");
      tileBtn.classList.add("used");
      tileBtn.disabled = true;
      checkFull();
    }

    function removeAt(pos) {
      if (resolved || !placed.has(pos)) return;
      const { tileBtn } = placed.get(pos);
      placed.delete(pos);
      const slot = slotEls.get(pos);
      slot.textContent = "";
      slot.classList.remove("filled");
      slot.classList.add("empty");
      tileBtn.classList.remove("used");
      tileBtn.disabled = false;
    }

    slotEls.forEach((slot, pos) => {
      slot.addEventListener("click", () => removeAt(pos));
    });
    candLetters.forEach((letter) => {
      const tileBtn = el("button", "exam-tile", letter);
      tileBtn.addEventListener("click", () => placeLetter(letter, tileBtn));
      tray.appendChild(tileBtn);
    });
    wrap.appendChild(tray);
    return wrap;
  }

  // ---- find the wrong letter (click it) ----
  function renderCorrectFind(qn) {
    const item = qn.item;
    const word = item.en.toLowerCase();
    const wrap = el("div", "exam-q");
    wrap.appendChild(el("div", "exam-q-tip", "找出拼错的字母（点击它）"));
    wrap.appendChild(el("div", "exam-q-prompt", item.zh));

    const pos = Math.floor(Math.random() * word.length);
    const orig = word[pos];
    let repl = orig;
    const alpha = "abcdefghijklmnopqrstuvwxyz";
    while (repl === orig) repl = alpha[Math.floor(Math.random() * 26)];
    const shown = word.slice(0, pos) + repl + word.slice(pos + 1);

    const row = el("div", "exam-letters");
    let answered = false;
    for (let i = 0; i < shown.length; i += 1) {
      const tile = el("button", "exam-letter-tile", shown[i]);
      tile.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const correct = i === pos;
        Array.from(row.children).forEach((c) => (c.disabled = true));
        const correctTile = row.children[pos];
        if (correct) {
          tile.classList.add("right");
          tile.textContent = orig;
        } else {
          tile.classList.add("wrong");
          if (correctTile) {
            correctTile.classList.add("right");
            correctTile.textContent = orig;
          }
        }
        wrap.appendChild(el("div", "exam-answer", `正确单词：${word}`));
        conclude(wrap, correct, correct ? 1 : 0, 1, correct ? [] : [item], tile);
      });
      row.appendChild(tile);
    }
    wrap.appendChild(row);
    return wrap;
  }

  // ---- correction: click the wrong letter, then pick the correct letter.
  // Validates immediately once both are chosen (no button).
  function renderCorrectReplace(qn) {
    const item = qn.item;
    const word = item.en.toLowerCase();
    const wrap = el("div", "exam-q");
    wrap.appendChild(
      el("div", "exam-q-tip", "先点错误的字母，再从下方选择正确的字母")
    );
    wrap.appendChild(el("div", "exam-q-prompt", item.zh));

    const pos = Math.floor(Math.random() * word.length);
    const orig = word[pos];
    const alpha = "abcdefghijklmnopqrstuvwxyz";
    let repl = orig;
    while (repl === orig) repl = alpha[Math.floor(Math.random() * 26)];
    const shown = word.slice(0, pos) + repl + word.slice(pos + 1);

    const tiles = [];
    const choiceBtns = [];
    let pickedPos = -1;
    let pickedLetter = "";
    let resolved = false;

    function validate() {
      if (resolved || pickedPos < 0 || !pickedLetter) return;
      resolved = true;
      tiles.forEach((t) => (t.disabled = true));
      choiceBtns.forEach((b) => (b.disabled = true));
      const correct = pickedPos === pos && pickedLetter === orig;
      // reveal the correct letter at the real wrong position
      tiles[pos].classList.remove("selected");
      tiles[pos].textContent = orig;
      tiles[pos].classList.add("right");
      if (!correct && tiles[pickedPos]) {
        tiles[pickedPos].classList.add("wrong");
      }
      if (!correct) {
        wrap.appendChild(el("div", "exam-answer", `正确单词：${word}`));
      }
      conclude(wrap, correct, correct ? 1 : 0, 1, correct ? [] : [item], tiles[pos]);
    }

    const row = el("div", "exam-letters");
    for (let i = 0; i < shown.length; i += 1) {
      const tile = el("button", "exam-letter-tile", shown[i]);
      tile.addEventListener("click", () => {
        if (resolved) return;
        pickedPos = i;
        tiles.forEach((t) => t.classList.remove("selected"));
        tile.classList.add("selected");
        validate();
      });
      tiles.push(tile);
      row.appendChild(tile);
    }
    wrap.appendChild(row);

    // replacement letter choices: correct letter + a few distractors
    const choiceLetters = new Set([orig]);
    while (choiceLetters.size < 5) {
      choiceLetters.add(alpha[Math.floor(Math.random() * 26)]);
    }
    const tray = el("div", "exam-tray");
    shuffle([...choiceLetters]).forEach((letter) => {
      const bt = el("button", "exam-tile", letter);
      bt.addEventListener("click", () => {
        if (resolved) return;
        pickedLetter = letter;
        choiceBtns.forEach((b) => b.classList.remove("selected"));
        bt.classList.add("selected");
        validate();
      });
      choiceBtns.push(bt);
      tray.appendChild(bt);
    });
    wrap.appendChild(tray);
    return wrap;
  }

  // ---- matching (connect with lines; edge anchors) ----
  function renderMatch(qn) {
    const items = qn.items;
    const n = items.length;
    const wrap = el("div", "exam-q exam-match");
    wrap.appendChild(el("div", "exam-q-tip", "连线：先点左边单词，再点右边意思"));

    const board = el("div", "exam-match-board");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("exam-match-svg");
    board.appendChild(svg);
    const leftCol = el("div", "exam-match-col exam-match-left");
    const rightCol = el("div", "exam-match-col exam-match-right");
    board.appendChild(leftCol);
    board.appendChild(rightCol);
    wrap.appendChild(board);

    const leftNodes = new Map();
    const rightNodes = new Map();
    shuffle([...items]).forEach((it) => {
      const node = el("button", "exam-match-item", it.en);
      leftCol.appendChild(node);
      leftNodes.set(keyOf(it), node);
    });
    shuffle([...items]).forEach((it) => {
      const node = el("button", "exam-match-item", it.zh);
      rightCol.appendChild(node);
      rightNodes.set(keyOf(it), node);
    });

    // each pair gets its own colour so crossing lines stay distinguishable;
    // red is reserved for showing the correct connection.
    const PALETTE = ["#111111", "#7a7a7a", "#16357f", "#3aa3e3", "#1f7a44", "#5fc27e"];
    const colorByKey = new Map();
    items.forEach((it, i) => colorByKey.set(keyOf(it), PALETTE[i % PALETTE.length]));

    const links = new Map();
    let selectedLeft = null;
    let judged = false;

    // anchor on the inner edge: left -> right edge center, right -> left edge center
    function anchor(node, side) {
      const br = node.getBoundingClientRect();
      const bb = board.getBoundingClientRect();
      const x = side === "right" ? br.right - bb.left : br.left - bb.left;
      const y = br.top - bb.top + br.height / 2;
      return { x, y };
    }

    function line(a, b, cls, stroke) {
      const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
      ln.setAttribute("x1", a.x);
      ln.setAttribute("y1", a.y);
      ln.setAttribute("x2", b.x);
      ln.setAttribute("y2", b.y);
      if (cls) ln.setAttribute("class", cls);
      // inline style (not the `stroke` attribute) so it beats the CSS rule
      if (stroke) ln.style.stroke = stroke;
      return ln;
    }

    function draw() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const bb = board.getBoundingClientRect();
      svg.setAttribute("width", String(bb.width));
      svg.setAttribute("height", String(bb.height));
      links.forEach((rKey, lKey) => {
        const ln = leftNodes.get(lKey);
        const rn = rightNodes.get(rKey);
        if (!ln || !rn) return;
        svg.appendChild(
          line(anchor(ln, "right"), anchor(rn, "left"), "line-user", colorByKey.get(lKey))
        );
      });
      if (judged) {
        links.forEach((rKey, lKey) => {
          if (lKey === rKey) return;
          const ln = leftNodes.get(lKey);
          const rn = rightNodes.get(lKey); // correct partner
          if (!ln || !rn) return;
          svg.appendChild(
            line(anchor(ln, "right"), anchor(rn, "left"), "line-correct")
          );
        });
      }
    }

    function clearSel() {
      if (selectedLeft) {
        const node = leftNodes.get(selectedLeft);
        if (node) node.classList.remove("selected");
      }
      selectedLeft = null;
    }

    leftNodes.forEach((node, key) => {
      node.addEventListener("click", () => {
        if (judged) return;
        clearSel();
        selectedLeft = key;
        node.classList.add("selected");
      });
    });
    rightNodes.forEach((node, rKey) => {
      node.addEventListener("click", () => {
        if (judged || !selectedLeft) return;
        links.forEach((v, k) => {
          if (v === rKey) links.delete(k);
        });
        links.set(selectedLeft, rKey);
        clearSel();
        draw();
      });
    });

    const submit = el("button", "exam-submit", "提交连线");
    submit.addEventListener("click", () => {
      if (links.size < n) {
        submit.textContent = `还有 ${n - links.size} 组未连`;
        setTimeout(() => (submit.textContent = "提交连线"), 1200);
        return;
      }
      judged = true;
      submit.remove();
      let correctCount = 0;
      const wrongItems = [];
      links.forEach((rKey, lKey) => {
        if (lKey === rKey) {
          correctCount += 1;
          leftNodes.get(lKey)?.classList.add("right");
          rightNodes.get(rKey)?.classList.add("right");
        } else {
          leftNodes.get(lKey)?.classList.add("wrong");
          const it = items.find((x) => keyOf(x) === lKey);
          if (it) wrongItems.push(it);
        }
      });
      draw();
      wrap.appendChild(el("div", "exam-answer", `连对 ${correctCount}/${n} 组`));
      conclude(wrap, correctCount === n, correctCount, n, wrongItems, board);
    });
    wrap.appendChild(submit);
    setTimeout(draw, 60);
    return wrap;
  }

  function renderCurrent() {
    if (!state) return;
    if (state.index >= state.questions.length) {
      finish();
      return;
    }
    const qn = state.questions[state.index];
    UI.main.innerHTML = "";
    UI.main.scrollTop = 0;
    let node;
    if (qn.type === "match") node = renderMatch(qn);
    else if (qn.type === "complete") node = renderTileFill(qn, true);
    else if (qn.type === "spell") node = renderTileFill(qn, false);
    else if (qn.type === "correctFind") node = renderCorrectFind(qn);
    else if (qn.type === "correctReplace") node = renderCorrectReplace(qn);
    else node = renderChoice(qn);
    UI.main.appendChild(node);
  }

  // ---- coin rain ----
  function coinRain() {
    if (!UI.coinRain) return;
    UI.coinRain.innerHTML = "";
    UI.coinRain.classList.remove("hidden");
    for (let i = 0; i < 28; i += 1) {
      const coin = el("div", "coin-drop");
      coin.style.left = `${Math.random() * 100}%`;
      coin.style.animationDelay = `${Math.random() * 0.8}s`;
      coin.style.animationDuration = `${1.4 + Math.random() * 1.2}s`;
      UI.coinRain.appendChild(coin);
    }
    setTimeout(() => {
      if (UI.coinRain) {
        UI.coinRain.classList.add("hidden");
        UI.coinRain.innerHTML = "";
      }
    }, 3200);
  }

  // ---- result / rewards ----
  function launchRewardGame(view) {
    if (view === "shoot") {
      window.location.href = "shoot.html";
      return;
    }
    const maxDay =
      window.WG && typeof window.WG.maxDay === "function"
        ? window.WG.maxDay()
        : 21;
    const day = 1 + Math.floor(Math.random() * Math.max(1, maxDay));
    if (window.AppNav && typeof window.AppNav.show === "function") {
      window.AppNav.show(view, { day });
    }
  }

  function goHome() {
    if (window.AppNav && typeof window.AppNav.show === "function") {
      window.AppNav.show("home");
    }
  }

  function finish() {
    stopTimer();
    const grade = state.total
      ? Math.round((state.score / state.total) * 100)
      : 0;
    let coin = 0;
    if (grade === 100) coin = 1200;
    else if (grade > 95) coin = 600;
    else if (grade > 90) coin = 300;
    const gameChoice = grade > 80;
    if (coin > 0) addGlobalCoins(coin);

    UI.resultTitle.textContent = "考试完成";
    UI.resultBody.innerHTML = "";
    UI.resultBody.appendChild(
      el(
        "div",
        "exam-result-score",
        `得分 ${state.score} / ${state.total}（${grade} 分）`
      )
    );
    UI.resultBody.appendChild(
      el("div", "exam-result-tip", `用时 ${fmtTime(Date.now() - state.startTime)}`)
    );
    if (coin > 0) {
      UI.resultBody.appendChild(
        el("div", "exam-result-reward", `恭喜！奖励 ${coin} 金币 🎉`)
      );
    }
    UI.resultBody.appendChild(
      el(
        "div",
        gameChoice ? "exam-result-reward" : "exam-result-tip",
        gameChoice ? "你获得了一次玩游戏的机会！" : "达到 80 分以上可获得玩游戏机会。"
      )
    );

    UI.resultActions.innerHTML = "";
    if (gameChoice) {
      [
        ["单词大战", "td"],
        ["贪吃蛇", "snake"],
        ["单词寻宝", "wordsearch"],
        ["射击单词", "shoot"],
      ].forEach(([label, view]) => {
        const bt = el("button", "exam-result-btn primary", label);
        bt.addEventListener("click", () => {
          UI.overlay.classList.add("hidden");
          launchRewardGame(view);
        });
        UI.resultActions.appendChild(bt);
      });
    }
    // 改正错题换游戏：把本次错题组成强化关卡，全部答对后换游戏（不发金币）。
    const wrongItems = dedupeWrong(state.wrong);
    if (wrongItems.length) {
      const fixBtn = el(
        "button",
        "exam-result-btn primary",
        `改正错题换游戏（${wrongItems.length} 个）`
      );
      fixBtn.addEventListener("click", () => {
        UI.overlay.classList.add("hidden");
        if (window.AppNav && typeof window.AppNav.show === "function") {
          window.AppNav.show("practice", {
            customItems: wrongItems,
            customLabel: "改错闯关",
            examFix: true,
          });
        }
      });
      UI.resultActions.appendChild(fixBtn);
    }

    const home = el("button", "exam-result-btn", "返回主页");
    home.addEventListener("click", () => {
      UI.overlay.classList.add("hidden");
      goHome();
    });
    UI.resultActions.appendChild(home);

    UI.overlay.classList.remove("hidden");
    if (coin > 0) coinRain();
  }

  // ---- public API ----
  async function start() {
    state = null;
    UI.overlay.classList.add("hidden");
    UI.main.innerHTML = "";
    UI.main.appendChild(el("div", "exam-loading", "正在出题…"));
    let words = [];
    try {
      const file =
        window.WG && typeof window.WG.wordsFile === "function"
          ? window.WG.wordsFile()
          : "words.json";
      const res = await fetch(file);
      words = await res.json();
    } catch (err) {
      UI.main.innerHTML = "";
      UI.main.appendChild(
        el("div", "exam-loading", "词库加载失败，请返回重试。")
      );
      return;
    }
    const built = buildExam(words);
    state = {
      questions: built.questions,
      total: built.total,
      pool: built.pool,
      index: 0,
      score: 0,
      done: 0,
      wrong: [],
      startTime: Date.now(),
    };
    stopTimer();
    examTimer = setInterval(updateTimer, 1000);
    updateTopBar();
    renderCurrent();
  }

  let examTimer = null;
  function stopTimer() {
    if (examTimer) {
      clearInterval(examTimer);
      examTimer = null;
    }
  }

  function pause() {
    stopTimer();
    if (currentAudio) {
      try {
        currentAudio.pause();
      } catch (err) {
        /* ignore */
      }
    }
    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (err) {
        /* ignore */
      }
    }
  }

  if (UI.back) {
    UI.back.addEventListener("click", () => {
      pause();
      goHome();
    });
  }

  window.ExamApp = { start, pause };
})();
