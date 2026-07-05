/* 小学词汇通 —— 独立的认读斩词页面。
 *
 * 玩法：从 wordlist.txt 加载全部小学单词，每页 10 行，每行给出英文单词 +
 * 4 个中文意思按钮（1 对 3 错）+「不认识」。答对该词计数 +1，答错或点
 * 「不认识」则清零。计数累计到 5 视为真正掌握（斩），不再出现。反复循环，
 * 直到全部单词计数都到 5。
 *
 * 计数持久化在 localStorage（静态网页无法写回 wordlist.txt），键为
 * wg-vocab-counts，形如 { "cat": 3, ... }。
 */
(() => {
  "use strict";

  const ROOT = document.getElementById("vocabView") || document;
  const q = (sel) => ROOT.querySelector(sel);

  const UI = {
    main: q("#vocabMain"),
    total: q("#vocabTotal"),
    mastered: q("#vocabMastered"),
    remaining: q("#vocabRemaining"),
    pageInfo: q("#vocabPageInfo"),
    progressFill: q("#vocabProgressFill"),
    back: q("#vocabBack"),
    export: q("#vocabExport"),
  };

  const PAGE_SIZE = 10; // 每页 10 个单词
  const MASTER_GOAL = 5; // 计数到 5 视为真正掌握
  const COUNTS_KEY = "wg-vocab-counts";
  const WORDLIST_URL = "wordlist.txt";

  let allWords = null; // [{en, zh}]  加载一次后缓存
  let counts = null; // { enLower: number }
  let queue = []; // 待掌握单词的循环队列（allWords 索引）
  let page = []; // 当前页 [{word, answered}]
  let answered = 0; // 当前页已作答数

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

  function keyOf(en) {
    return String(en).toLowerCase().trim();
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

  // 发音：优先本地 mp3，失败回退到浏览器语音合成。
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
  function playWord(en) {
    if (!en) return;
    const isPhrase = /\s/.test(en.trim());
    const src = `audio/${isPhrase ? "phrase" : "en"}/${slugify(en)}.mp3`;
    try {
      if (currentAudio) currentAudio.pause();
      currentAudio = new Audio(src);
      currentAudio.play().catch(() => speak(en));
    } catch (err) {
      speak(en);
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

  // ---- 计数存储 ----
  function loadCounts() {
    try {
      const raw = localStorage.getItem(COUNTS_KEY);
      counts = raw ? JSON.parse(raw) : {};
      if (!counts || typeof counts !== "object") counts = {};
    } catch (err) {
      counts = {};
    }
  }
  function saveCounts() {
    try {
      localStorage.setItem(COUNTS_KEY, JSON.stringify(counts));
    } catch (err) {
      /* ignore */
    }
  }
  function countOf(en) {
    return counts[keyOf(en)] || 0;
  }
  function setCount(en, value) {
    counts[keyOf(en)] = Math.max(0, value);
    saveCounts();
  }

  // ---- 加载词表 ----
  async function loadWords() {
    if (allWords) return allWords;
    const res = await fetch(WORDLIST_URL, { cache: "no-cache" });
    const text = await res.text();
    const seen = new Set();
    const list = [];
    text.split(/\r?\n/).forEach((line) => {
      const raw = line.trim();
      if (!raw || raw.startsWith("#")) return;
      const idx = raw.indexOf("|");
      if (idx < 0) return;
      const en = raw.slice(0, idx).trim();
      const zh = raw.slice(idx + 1).trim();
      if (!en || !zh) return;
      const k = keyOf(en);
      if (seen.has(k)) return;
      seen.add(k);
      list.push({ en, zh });
    });
    allWords = list;
    return allWords;
  }

  // ---- 干扰项：形近词优先 ----
  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j += 1) dp[j] = j;
    for (let i = 1; i <= m; i += 1) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j += 1) {
        const tmp = dp[j];
        dp[j] =
          a[i - 1] === b[j - 1]
            ? prev
            : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[n];
  }

  // 为一个单词挑 3 个中文干扰项：优先形近词（编辑距离小），再随机补足。
  function pickDistractors(word) {
    const targetEn = keyOf(word.en);
    const used = new Set([word.zh]);
    const out = [];

    const scored = [];
    for (const w of allWords) {
      if (w === word) continue;
      if (used.has(w.zh)) continue;
      const d = levenshtein(targetEn, keyOf(w.en));
      scored.push({ w, d });
    }

    // 形近阈值：短词更严，长词放宽；同时要求首字母相同或距离很小。
    const limit = Math.min(3, Math.max(1, targetEn.length - 2));
    const similar = scored
      .filter((s) => s.d > 0 && s.d <= limit)
      .sort((a, b) => a.d - b.d);
    // 同距离内打乱，避免每次都同一批。
    shuffle(similar);
    similar.sort((a, b) => a.d - b.d);

    for (const s of similar) {
      if (out.length >= 2) break;
      if (used.has(s.w.zh)) continue;
      used.add(s.w.zh);
      out.push(s.w.zh);
    }

    // 随机补足到 3 个。
    const rest = shuffle(scored.slice());
    for (const s of rest) {
      if (out.length >= 3) break;
      if (used.has(s.w.zh)) continue;
      used.add(s.w.zh);
      out.push(s.w.zh);
    }
    return out.slice(0, 3);
  }

  // ---- 队列 / 分页 ----
  function rebuildQueue() {
    queue = [];
    allWords.forEach((w, i) => {
      if (countOf(w.en) < MASTER_GOAL) queue.push(i);
    });
  }

  function masteredCount() {
    let n = 0;
    allWords.forEach((w) => {
      if (countOf(w.en) >= MASTER_GOAL) n += 1;
    });
    return n;
  }

  function updateStats() {
    const total = allWords.length;
    const mastered = masteredCount();
    if (UI.total) UI.total.textContent = String(total);
    if (UI.mastered) UI.mastered.textContent = String(mastered);
    if (UI.remaining) UI.remaining.textContent = String(total - mastered);
    if (UI.pageInfo) UI.pageInfo.textContent = `${answered}/${page.length}`;
    if (UI.progressFill) {
      const pct = total ? Math.round((mastered / total) * 100) : 0;
      UI.progressFill.style.width = `${pct}%`;
    }
  }

  // ---- 渲染一页 ----
  function renderPage() {
    // 从队列前端取最多 10 个未掌握的词。
    page = [];
    while (page.length < PAGE_SIZE && queue.length) {
      const idx = queue.shift();
      const w = allWords[idx];
      if (countOf(w.en) >= MASTER_GOAL) continue; // 可能已掌握
      page.push({ idx, word: w, answered: false, correct: false });
    }
    answered = 0;

    if (!page.length) {
      renderDone();
      updateStats();
      return;
    }

    UI.main.innerHTML = "";
    const list = el("div", "vocab-list");

    page.forEach((entry) => {
      list.appendChild(renderRow(entry));
    });
    UI.main.appendChild(list);

    // 底部：进度提示 + 下一页
    const footer = el("div", "vocab-footer");
    footer.appendChild(
      el("div", "vocab-footer-tip", "点英文可听发音 · 全部作答后进入下一页")
    );
    const nextBtn = el("button", "vocab-next", "下一页");
    nextBtn.disabled = true;
    nextBtn.addEventListener("click", () => {
      requeuePage();
      renderPage();
      UI.main.scrollTop = 0;
    });
    footer.appendChild(nextBtn);
    UI.main.appendChild(footer);
    page._nextBtn = nextBtn;

    updateStats();
  }

  function renderRow(entry) {
    const word = entry.word;
    const row = el("div", "vocab-row");

    // 左侧：单词 + 掌握进度点
    const wrap = el("div", "vocab-word-wrap");
    const wordBtn = el("button", "vocab-word");
    wordBtn.innerHTML = `${word.en}<span class="spk">🔊</span>`;
    wordBtn.addEventListener("click", () => playWord(word.en));
    wrap.appendChild(wordBtn);

    const meta = el("div", "vocab-word-meta");
    const pips = el("span", "vocab-pips");
    renderPips(pips, countOf(word.en));
    meta.appendChild(pips);
    entry._pips = pips;
    wrap.appendChild(meta);
    row.appendChild(wrap);

    // 选项
    const opts = el("div", "vocab-opts");
    const distractors = pickDistractors(word);
    const options = shuffle([word.zh, ...distractors]);
    const buttons = [];
    options.forEach((zh) => {
      const btn = el("button", "vocab-opt", zh);
      btn.addEventListener("click", () =>
        answer(entry, row, buttons, unknownBtn, zh === word.zh, btn)
      );
      buttons.push(btn);
      opts.appendChild(btn);
    });
    row.appendChild(opts);

    // 不认识
    const unknownBtn = el("button", "vocab-unknown", "不认识");
    unknownBtn.addEventListener("click", () =>
      answer(entry, row, buttons, unknownBtn, false, null)
    );
    row.appendChild(unknownBtn);

    return row;
  }

  function renderPips(pipsEl, count) {
    pipsEl.innerHTML = "";
    for (let i = 0; i < MASTER_GOAL; i += 1) {
      const pip = el("span", "vocab-pip" + (i < count ? " on" : ""));
      pipsEl.appendChild(pip);
    }
    if (count >= MASTER_GOAL) {
      pipsEl.appendChild(el("span", "vocab-mastered-tag", " ✓已掌握"));
    }
  }

  function answer(entry, row, buttons, unknownBtn, isCorrect, chosenBtn) {
    if (entry.answered) return;
    entry.answered = true;
    entry.correct = isCorrect;

    const word = entry.word;
    if (isCorrect) {
      const next = countOf(word.en) + 1;
      setCount(word.en, next);
      if (next >= MASTER_GOAL) addGlobalCoins(1); // 斩词奖励
    } else {
      setCount(word.en, 0); // 答错 / 不认识 → 清零
    }

    // 视觉反馈：正确项标绿，选错标红。
    buttons.forEach((btn) => {
      btn.disabled = true;
      if (btn.textContent === word.zh) btn.classList.add("right");
      else if (btn === chosenBtn) btn.classList.add("wrong");
    });
    unknownBtn.disabled = true;
    if (!isCorrect) {
      unknownBtn.classList.add("picked");
      playWord(word.en); // 不会/答错时读一遍，帮助认读
    }
    row.classList.add("done");
    renderPips(entry._pips, countOf(word.en));

    answered += 1;
    if (page._nextBtn && answered >= page.length) {
      page._nextBtn.disabled = false;
      page._nextBtn.textContent =
        queue.length || anyUnmastered() ? "下一页" : "完成";
    }
    updateStats();
  }

  function anyUnmastered() {
    return allWords.some((w) => countOf(w.en) < MASTER_GOAL);
  }

  // 当前页作答完后，把仍未掌握的词放回队列末尾以循环练习。
  function requeuePage() {
    page.forEach((entry) => {
      if (countOf(entry.word.en) < MASTER_GOAL) {
        queue.push(entry.idx);
      }
    });
    if (!queue.length) rebuildQueue(); // 一轮扫完，重建仍未掌握的
  }

  function renderDone() {
    UI.main.innerHTML = "";
    const box = el("div", "vocab-done");
    box.appendChild(el("div", "vocab-done-title", "🏆 全部单词都掌握啦！"));
    box.appendChild(
      el(
        "div",
        "vocab-done-tip",
        `${allWords.length} 个单词全部连续答对 ${MASTER_GOAL} 次，真正认识了。`
      )
    );
    const actions = el("div", "vocab-done-actions");
    const again = el("button", "vocab-done-btn primary", "再练一轮");
    again.addEventListener("click", () => {
      // 重置计数，重新开始。
      counts = {};
      saveCounts();
      rebuildQueue();
      renderPage();
    });
    const home = el("button", "vocab-done-btn", "返回主页");
    home.addEventListener("click", goHome);
    actions.appendChild(again);
    actions.appendChild(home);
    box.appendChild(actions);
    UI.main.appendChild(box);
  }

  function goHome() {
    if (window.AppNav && typeof window.AppNav.show === "function") {
      window.AppNav.show("home");
    }
  }

  // 导出标记：把本地计数下载成 JSON，交给 Python 脚本生成需记词表。
  function exportCounts() {
    loadCounts();
    const total = allWords ? allWords.length : 0;
    const mastered = allWords ? masteredCount() : 0;
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      masterGoal: MASTER_GOAL,
      total,
      mastered,
      remaining: total - mastered,
      counts,
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vocab_counts_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      /* ignore */
    }
  }

  // ---- 公开接口 ----
  async function start() {
    if (UI.main) {
      UI.main.innerHTML = '<div class="vocab-loading">正在加载词库…</div>';
    }
    loadCounts();
    try {
      await loadWords();
    } catch (err) {
      if (UI.main) {
        UI.main.innerHTML =
          '<div class="vocab-loading">词库加载失败，请检查 wordlist.txt。</div>';
      }
      return;
    }
    rebuildQueue();
    renderPage();
  }

  function pause() {
    try {
      if (currentAudio) currentAudio.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch (err) {
      /* ignore */
    }
  }

  if (UI.back) {
    UI.back.addEventListener("click", () => {
      pause();
      goHome();
    });
  }

  if (UI.export) {
    UI.export.addEventListener("click", exportCounts);
  }

  window.VocabApp = { start, pause };
})();
