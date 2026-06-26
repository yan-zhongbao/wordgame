(() => {
  "use strict";

  const ROOT = document.getElementById("examView") || document;
  const q = (sel) => ROOT.querySelector(sel);

  const UI = {
    main: q("#examMain"),
    total: q("#examTotal"),
    done: q("#examDone"),
    score: q("#examScore"),
    progressFill: q("#examProgressFill"),
    back: q("#examBack"),
    overlay: q("#examOverlay"),
    resultTitle: q("#examResultTitle"),
    resultBody: q("#examResultBody"),
    resultActions: q("#examResultActions"),
    coinRain: q("#examCoinRain"),
  };

  const TOTAL_TARGET = 100;
  // [type, number of words]; choice types weigh more, spelling least.
  const PLAN = [
    ["listenMeaning", 18],
    ["listenWord", 18],
    ["meaningWord", 18],
    ["complete", 12],
    ["correct", 12],
    ["spell", 10],
    ["match", 12], // 12 words -> 2 rounds of 6
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

  function sampleDistinct(pool, n, excludeKeys, mapFn, valueKey) {
    // pick n distinct mapped values not in excludeKeys/seen
    const seen = new Set();
    const out = [];
    const order = shuffle([...pool]);
    for (const item of order) {
      if (out.length >= n) break;
      const k = keyOf(item);
      if (excludeKeys.has(k)) continue;
      const value = mapFn(item);
      const vk = valueKey ? valueKey(value) : value;
      if (seen.has(vk)) continue;
      seen.add(vk);
      out.push(value);
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
      /^[a-zA-Z]+$/.test(it.en) && it.en.length >= 3 && it.en.length <= 12;

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

    const buckets = {};
    // spellable-dependent first
    buckets.spell = take(10, isSpellable);
    buckets.complete = take(12, isSpellable);
    buckets.correct = take(12, isSpellable);
    buckets.listenMeaning = take(18);
    buckets.listenWord = take(18);
    buckets.meaningWord = take(18);
    buckets.match = take(12);

    const questions = [];
    buckets.listenMeaning.forEach((it) =>
      questions.push({ type: "listenMeaning", item: it })
    );
    buckets.listenWord.forEach((it) =>
      questions.push({ type: "listenWord", item: it })
    );
    buckets.meaningWord.forEach((it) =>
      questions.push({ type: "meaningWord", item: it })
    );
    buckets.complete.forEach((it) =>
      questions.push({ type: "complete", item: it })
    );
    buckets.correct.forEach((it) =>
      questions.push({ type: "correct", item: it })
    );
    buckets.spell.forEach((it) => questions.push({ type: "spell", item: it }));
    for (let i = 0; i + 1 < buckets.match.length; i += 6) {
      questions.push({ type: "match", items: buckets.match.slice(i, i + 6) });
    }

    shuffle(questions);
    const total = questions.reduce(
      (sum, qn) => sum + (qn.type === "match" ? qn.items.length : 1),
      0
    );
    return { questions, total, pool: valid };
  }

  // ---- top bar ----
  function updateTopBar() {
    if (UI.total) UI.total.textContent = String(state.total);
    if (UI.done) UI.done.textContent = String(state.done);
    if (UI.score) UI.score.textContent = String(state.score);
    if (UI.progressFill) {
      const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
      UI.progressFill.style.width = `${pct}%`;
    }
  }

  // Called when a question is fully resolved.
  function resolveQuestion(gained, count, wrongItems) {
    state.score += gained;
    state.done += count;
    if (wrongItems && wrongItems.length) {
      wrongItems.forEach((it) => state.wrong.push(it));
    }
    updateTopBar();
  }

  function nextButton() {
    const btn = el("button", "exam-next", "下一题");
    btn.addEventListener("click", () => {
      state.index += 1;
      renderCurrent();
    });
    return btn;
  }

  // ---- question renderers ----
  function renderChoice(qn) {
    const item = qn.item;
    const isListen = qn.type === "listenMeaning" || qn.type === "listenWord";
    // 听选单词 / 词义选单词 -> 答案是英文；听选词义 -> 答案是中文。
    const answerIsEnglish =
      qn.type === "listenWord" || qn.type === "meaningWord";

    const wrap = el("div", "exam-q");
    if (isListen) {
      const audioBtn = el("button", "exam-audio-btn", "🔊 播放发音");
      audioBtn.addEventListener("click", () => playItem(item));
      wrap.appendChild(el("div", "exam-q-tip", "听发音，选择正确答案"));
      wrap.appendChild(audioBtn);
      setTimeout(() => playItem(item), 250);
    } else {
      wrap.appendChild(el("div", "exam-q-tip", "选择正确的单词"));
      wrap.appendChild(el("div", "exam-q-prompt", item.zh));
    }

    const correctValue = answerIsEnglish ? item.en : item.zh;
    const distractors = sampleDistinct(
      state.pool,
      3,
      new Set([keyOf(item)]),
      (it) => (answerIsEnglish ? it.en : it.zh),
      (v) => v
    ).filter((v) => v !== correctValue);
    const options = shuffle([correctValue, ...distractors.slice(0, 3)]);

    const optBox = el("div", "exam-options");
    let answered = false;
    options.forEach((opt) => {
      const b = el("button", "exam-option", opt);
      b.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const correct = opt === correctValue;
        Array.from(optBox.children).forEach((c) => {
          c.disabled = true;
          if (c.textContent === correctValue) c.classList.add("right");
        });
        if (!correct) b.classList.add("wrong");
        resolveQuestion(correct ? 1 : 0, 1, correct ? [] : [item]);
        wrap.appendChild(nextButton());
      });
      optBox.appendChild(b);
    });
    wrap.appendChild(optBox);
    return wrap;
  }

  function renderComplete(qn) {
    const item = qn.item;
    const word = item.en;
    const wrap = el("div", "exam-q");
    wrap.appendChild(el("div", "exam-q-tip", "补全单词（填入缺少的字母）"));
    wrap.appendChild(el("div", "exam-q-prompt", item.zh));

    const blanks = Math.max(1, Math.round(word.length * 0.4));
    const positions = shuffle(
      Array.from({ length: word.length }, (_, i) => i)
    ).slice(0, blanks);
    const blankSet = new Set(positions);

    const row = el("div", "exam-letters");
    const inputs = [];
    for (let i = 0; i < word.length; i += 1) {
      if (blankSet.has(i)) {
        const inp = el("input", "exam-letter-input");
        inp.maxLength = 1;
        inp.dataset.idx = String(i);
        inp.addEventListener("input", () => {
          inp.value = inp.value.replace(/[^a-zA-Z]/g, "").toLowerCase();
          const idx = inputs.indexOf(inp);
          if (inp.value && idx >= 0 && idx + 1 < inputs.length) {
            inputs[idx + 1].focus();
          }
        });
        inputs.push(inp);
        row.appendChild(inp);
      } else {
        row.appendChild(el("span", "exam-letter-fixed", word[i]));
      }
    }
    wrap.appendChild(row);

    const submit = el("button", "exam-submit", "确定");
    submit.addEventListener("click", () => {
      submit.disabled = true;
      let allRight = true;
      inputs.forEach((inp) => {
        const idx = Number(inp.dataset.idx);
        const expected = word[idx].toLowerCase();
        inp.disabled = true;
        if ((inp.value || "").toLowerCase() === expected) {
          inp.classList.add("right");
        } else {
          inp.classList.add("wrong");
          inp.value = expected;
          allRight = false;
        }
      });
      if (!allRight) {
        wrap.appendChild(el("div", "exam-answer", `正确答案：${word}`));
      }
      resolveQuestion(allRight ? 1 : 0, 1, allRight ? [] : [item]);
      wrap.appendChild(nextButton());
    });
    wrap.appendChild(submit);
    return wrap;
  }

  function renderCorrect(qn) {
    const item = qn.item;
    const word = item.en.toLowerCase();
    const wrap = el("div", "exam-q");
    wrap.appendChild(el("div", "exam-q-tip", "找出拼错的字母（点击它）"));
    wrap.appendChild(el("div", "exam-q-prompt", item.zh));

    // change one letter
    const pos = Math.floor(Math.random() * word.length);
    const orig = word[pos];
    let repl = orig;
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    while (repl === orig) {
      repl = alphabet[Math.floor(Math.random() * 26)];
    }
    const shown = word.slice(0, pos) + repl + word.slice(pos + 1);

    const row = el("div", "exam-letters");
    let answered = false;
    for (let i = 0; i < shown.length; i += 1) {
      const tile = el("button", "exam-letter-tile", shown[i]);
      tile.dataset.idx = String(i);
      tile.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const correct = i === pos;
        Array.from(row.children).forEach((c) => {
          c.disabled = true;
        });
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
        resolveQuestion(correct ? 1 : 0, 1, correct ? [] : [item]);
        wrap.appendChild(nextButton());
      });
      row.appendChild(tile);
    }
    wrap.appendChild(row);
    return wrap;
  }

  function renderSpell(qn) {
    const item = qn.item;
    const wrap = el("div", "exam-q");
    wrap.appendChild(el("div", "exam-q-tip", "根据中文和发音，拼写单词"));
    const audioBtn = el("button", "exam-audio-btn", "🔊 播放发音");
    audioBtn.addEventListener("click", () => playItem(item));
    wrap.appendChild(audioBtn);
    wrap.appendChild(el("div", "exam-q-prompt", item.zh));

    const input = el("input", "exam-spell-input");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off");
    input.placeholder = "在此输入英文";
    wrap.appendChild(input);

    const submit = el("button", "exam-submit", "确定");
    submit.addEventListener("click", () => {
      submit.disabled = true;
      input.disabled = true;
      const answer = (input.value || "").trim().toLowerCase();
      const correct = answer === item.en.toLowerCase();
      input.classList.add(correct ? "right" : "wrong");
      if (!correct) {
        wrap.appendChild(el("div", "exam-answer", `正确答案：${item.en}`));
      }
      resolveQuestion(correct ? 1 : 0, 1, correct ? [] : [item]);
      wrap.appendChild(nextButton());
    });
    wrap.appendChild(submit);
    setTimeout(() => input.focus(), 100);
    return wrap;
  }

  function renderMatch(qn) {
    const items = qn.items;
    const n = items.length;
    const wrap = el("div", "exam-q exam-match");
    wrap.appendChild(
      el("div", "exam-q-tip", "连线：先点左边单词，再点右边意思")
    );

    const board = el("div", "exam-match-board");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("exam-match-svg");
    board.appendChild(svg);

    const leftCol = el("div", "exam-match-col exam-match-left");
    const rightCol = el("div", "exam-match-col exam-match-right");
    board.appendChild(leftCol);
    board.appendChild(rightCol);
    wrap.appendChild(board);

    const leftOrder = shuffle([...items]);
    const rightOrder = shuffle([...items]);
    const leftNodes = new Map(); // key -> node
    const rightNodes = new Map();

    leftOrder.forEach((it) => {
      const node = el("button", "exam-match-item", it.en);
      node.dataset.key = keyOf(it);
      leftCol.appendChild(node);
      leftNodes.set(keyOf(it), node);
    });
    rightOrder.forEach((it) => {
      const node = el("button", "exam-match-item", it.zh);
      node.dataset.key = keyOf(it);
      rightCol.appendChild(node);
      rightNodes.set(keyOf(it), node);
    });

    const links = new Map(); // leftKey -> rightKey
    let selectedLeft = null;
    let judged = false;

    function centerOf(node) {
      const br = node.getBoundingClientRect();
      const bb = board.getBoundingClientRect();
      return {
        x: br.left - bb.left + br.width / 2,
        y: br.top - bb.top + br.height / 2,
      };
    }

    function drawLines() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const bb = board.getBoundingClientRect();
      svg.setAttribute("width", String(bb.width));
      svg.setAttribute("height", String(bb.height));
      links.forEach((rKey, lKey) => {
        const lNode = leftNodes.get(lKey);
        const rNode = rightNodes.get(rKey);
        if (!lNode || !rNode) return;
        const a = centerOf(lNode);
        const b = centerOf(rNode);
        const line = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "line"
        );
        line.setAttribute("x1", a.x);
        line.setAttribute("y1", a.y);
        line.setAttribute("x2", b.x);
        line.setAttribute("y2", b.y);
        const correct = lKey === rKey;
        line.setAttribute("class", judged && !correct ? "" : "line-user");
        if (judged) {
          line.setAttribute("stroke", correct ? "#1f9d55" : "#111");
        }
        svg.appendChild(line);
      });
      // corrections (red) for wrong links
      if (judged) {
        links.forEach((rKey, lKey) => {
          if (lKey === rKey) return;
          const lNode = leftNodes.get(lKey);
          const rNode = rightNodes.get(lKey); // correct right is same key
          if (!lNode || !rNode) return;
          const a = centerOf(lNode);
          const b = centerOf(rNode);
          const line = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line"
          );
          line.setAttribute("x1", a.x);
          line.setAttribute("y1", a.y);
          line.setAttribute("x2", b.x);
          line.setAttribute("y2", b.y);
          line.setAttribute("class", "line-correct");
          svg.appendChild(line);
        });
      }
    }

    function clearSelection() {
      if (selectedLeft) {
        const node = leftNodes.get(selectedLeft);
        if (node) node.classList.remove("selected");
      }
      selectedLeft = null;
    }

    leftNodes.forEach((node, key) => {
      node.addEventListener("click", () => {
        if (judged) return;
        clearSelection();
        selectedLeft = key;
        node.classList.add("selected");
      });
    });
    rightNodes.forEach((node, rKey) => {
      node.addEventListener("click", () => {
        if (judged || !selectedLeft) return;
        // remove any existing link to this right
        links.forEach((v, k) => {
          if (v === rKey) links.delete(k);
        });
        links.set(selectedLeft, rKey);
        clearSelection();
        drawLines();
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
      submit.disabled = true;
      let correctCount = 0;
      const wrongItems = [];
      links.forEach((rKey, lKey) => {
        if (lKey === rKey) {
          correctCount += 1;
          const ln = leftNodes.get(lKey);
          const rn = rightNodes.get(rKey);
          if (ln) ln.classList.add("right");
          if (rn) rn.classList.add("right");
        } else {
          const ln = leftNodes.get(lKey);
          if (ln) ln.classList.add("wrong");
          const wrongItem = items.find((it) => keyOf(it) === lKey);
          if (wrongItem) wrongItems.push(wrongItem);
        }
      });
      drawLines();
      wrap.appendChild(
        el("div", "exam-answer", `连对 ${correctCount}/${n} 组`)
      );
      resolveQuestion(correctCount, n, wrongItems);
      wrap.appendChild(nextButton());
    });
    wrap.appendChild(submit);

    setTimeout(drawLines, 50);
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
    else if (qn.type === "complete") node = renderComplete(qn);
    else if (qn.type === "correct") node = renderCorrect(qn);
    else if (qn.type === "spell") node = renderSpell(qn);
    else node = renderChoice(qn);
    UI.main.appendChild(node);
  }

  // ---- coin rain effect ----
  function coinRain() {
    if (!UI.coinRain) return;
    UI.coinRain.innerHTML = "";
    UI.coinRain.classList.remove("hidden");
    const count = 28;
    for (let i = 0; i < count; i += 1) {
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
    const maxDay =
      window.WG && typeof window.WG.maxDay === "function" ? window.WG.maxDay() : 21;
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
      el("div", "exam-result-score", `得分 ${state.score} / ${state.total}（${grade} 分）`)
    );
    if (coin > 0) {
      UI.resultBody.appendChild(
        el("div", "exam-result-reward", `恭喜！奖励 ${coin} 金币 🎉`)
      );
    }
    if (gameChoice) {
      UI.resultBody.appendChild(
        el("div", "exam-result-reward", "你获得了一次玩游戏的机会！")
      );
    } else {
      UI.resultBody.appendChild(
        el("div", "exam-result-tip", "达到 80 分以上可获得玩游戏机会。")
      );
    }

    UI.resultActions.innerHTML = "";
    if (gameChoice) {
      [
        ["单词大战", "td"],
        ["贪吃蛇", "snake"],
        ["单词寻宝", "wordsearch"],
      ].forEach(([label, view]) => {
        UI.resultActions.appendChild(
          (() => {
            const b = el("button", "exam-result-btn primary", label);
            b.addEventListener("click", () => {
              UI.overlay.classList.add("hidden");
              launchRewardGame(view);
            });
            return b;
          })()
        );
      });
    }
    // #11 改错送游戏入口会在后续接入（state.wrong 已收集错题）。
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
      UI.main.appendChild(el("div", "exam-loading", "词库加载失败，请返回重试。"));
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
    };
    updateTopBar();
    renderCurrent();
  }

  function pause() {
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
