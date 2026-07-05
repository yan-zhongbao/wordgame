/* 小学词汇通 —— 独立的认读斩词页面（5 轮漏斗式确认）。
 *
 * 玩法：从 wordlist.txt 加载全部小学单词，每页 10 行，每行 = 英文单词 +
 * 4 个中文意思按钮（1 对 3 错）+「不认识」。
 *
 * 漏斗规则（用户拍板）：
 *  - 第 1 轮测所有词；答对（选对正确意思）→ 进入下一轮，答错/不认识 → 掉出
 *    成为「需记」的词，本流程不再测它。
 *  - 第 2 轮只测第 1 轮答对的词，第 3 轮只测第 2 轮答对的词…… 连续 5 轮都答对
 *    才算「真正认识」（斩，排除）。
 *  - 每轮全部测完才进入下一轮。
 *
 * 断点续做：每个词只记两样——lv(已连续答对几轮 0..5) 与 f(是否掉队/需记)，
 * 全部存 localStorage。当前轮次、当前位置都由这些状态推导，任何时候关闭/刷新，
 * 重新打开都会从原进度继续，直到 5 轮走完。只有手动「重新开始」才清零。
 *
 * 存储键：wg-vocab-progress = { v:2, goal:5, words:{ "cat":{lv,f}, ... } }
 */
(() => {
  "use strict";

  const ROOT = document.getElementById("vocabView") || document;
  const q = (sel) => ROOT.querySelector(sel);

  const UI = {
    main: q("#vocabMain"),
    total: q("#vocabTotal"),
    round: q("#vocabRound"),
    known: q("#vocabKnown"),
    need: q("#vocabNeed"),
    roundLeft: q("#vocabRoundLeft"),
    progressFill: q("#vocabProgressFill"),
    back: q("#vocabBack"),
    export: q("#vocabExport"),
  };

  const PAGE_SIZE = 10; // 每页 10 个单词
  const GOAL = 5; // 连续答对 5 轮 = 真正认识
  const PROG_KEY = "wg-vocab-progress";
  const OLD_COUNTS_KEY = "wg-vocab-counts"; // 旧版本键，弃用并清除
  const WORDLIST_URL = "wordlist.txt";

  let allWords = null; // [{en, zh}]  加载一次后缓存
  let prog = null; // { enLower: {lv, f} }
  let round = null; // 当前轮次 1..5，null=全部完成
  let queue = []; // 当前轮待测单词队列（allWords 索引）
  let page = []; // 当前页 [{idx, word, answered}]
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

  // ---- 进度存储 ----
  function loadProg() {
    prog = {};
    try {
      const raw = localStorage.getItem(PROG_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        const words = data && data.words ? data.words : {};
        Object.keys(words).forEach((k) => {
          const rec = words[k] || {};
          const lv = Math.max(0, Math.min(GOAL, parseInt(rec.lv, 10) || 0));
          prog[k] = { lv, f: !!rec.f };
        });
      }
    } catch (err) {
      prog = {};
    }
    // 清除旧版本遗留的计数键，避免混淆污染。
    try {
      localStorage.removeItem(OLD_COUNTS_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  function saveProg() {
    try {
      localStorage.setItem(
        PROG_KEY,
        JSON.stringify({ v: 2, goal: GOAL, words: prog })
      );
    } catch (err) {
      /* ignore */
    }
  }

  function progOf(en) {
    return prog[keyOf(en)] || { lv: 0, f: false };
  }
  function setProg(en, lv, failed) {
    prog[keyOf(en)] = { lv: Math.max(0, Math.min(GOAL, lv)), f: !!failed };
    saveProg();
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
          a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
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

    // 形近阈值：短词更严，长词放宽。
    const limit = Math.min(3, Math.max(1, targetEn.length - 2));
    const similar = scored.filter((s) => s.d > 0 && s.d <= limit);
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

  // ---- 轮次 / 队列（全部由持久化状态推导，保证可续做） ----
  // 当前应处理的轮次 = 仍活跃(未掉队、未满 5)的词里最小 lv + 1。
  function computeRound() {
    let min = Infinity;
    for (const w of allWords) {
      const p = progOf(w.en);
      if (p.f || p.lv >= GOAL) continue;
      if (p.lv < min) min = p.lv;
    }
    return min === Infinity ? null : min + 1;
  }

  // 装载当前轮的待测词（lv == round-1 且未掉队）。
  function refillQueue() {
    round = computeRound();
    queue = [];
    if (round == null) return;
    const lvl = round - 1;
    allWords.forEach((w, i) => {
      const p = progOf(w.en);
      if (!p.f && p.lv === lvl) queue.push(i);
    });
    shuffle(queue);
  }

  function knownCount() {
    let n = 0;
    allWords.forEach((w) => {
      if (progOf(w.en).lv >= GOAL) n += 1;
    });
    return n;
  }
  function needCount() {
    let n = 0;
    allWords.forEach((w) => {
      if (progOf(w.en).f) n += 1;
    });
    return n;
  }
  // 本轮仍待测（未作答）的词数。
  function roundRemaining() {
    if (round == null) return 0;
    const lvl = round - 1;
    let n = 0;
    allWords.forEach((w) => {
      const p = progOf(w.en);
      if (!p.f && p.lv === lvl) n += 1;
    });
    return n;
  }
  // 本轮参与总数（待测 + 已答对进阶 + 本轮掉队）。
  function roundTotal() {
    if (round == null) return 0;
    const lvl = round - 1;
    let n = 0;
    allWords.forEach((w) => {
      const p = progOf(w.en);
      if (!p.f && (p.lv === lvl || p.lv === round)) n += 1; // 待测 or 本轮已进阶
      else if (p.f && p.lv === lvl) n += 1; // 本轮掉队
    });
    return n;
  }

  function updateStats() {
    const total = allWords.length;
    if (UI.total) UI.total.textContent = String(total);
    if (UI.round) UI.round.textContent = round == null ? "完成" : `${round}/${GOAL}`;
    if (UI.known) UI.known.textContent = String(knownCount());
    if (UI.need) UI.need.textContent = String(needCount());
    if (UI.roundLeft) UI.roundLeft.textContent = String(roundRemaining());
    if (UI.progressFill) {
      const rt = roundTotal();
      const pct = rt ? Math.round(((rt - roundRemaining()) / rt) * 100) : 0;
      UI.progressFill.style.width = `${pct}%`;
    }
  }

  // ---- 渲染一页 ----
  function renderPage() {
    if (!queue.length) refillQueue(); // 轮空 → 计算/进入下一轮
    if (round == null) {
      renderDone();
      updateStats();
      return;
    }

    // 只从当前轮队列取，最多 10 个；不跨轮混页。
    page = [];
    while (page.length < PAGE_SIZE && queue.length) {
      const idx = queue.shift();
      const w = allWords[idx];
      const p = progOf(w.en);
      if (p.f || p.lv !== round - 1) continue; // 防御：跳过已变动的
      page.push({ idx, word: w, answered: false });
    }
    answered = 0;

    if (!page.length) {
      // 当前轮已无待测，尝试进入下一轮。
      refillQueue();
      if (round == null) {
        renderDone();
        updateStats();
        return;
      }
      renderPage();
      return;
    }

    UI.main.innerHTML = "";
    UI.main.appendChild(
      el(
        "div",
        "vocab-round-head",
        `第 ${round} 轮 / 共 ${GOAL} 轮 · 本轮还剩 ${roundRemaining()} 词`
      )
    );

    const list = el("div", "vocab-list");
    page.forEach((entry) => list.appendChild(renderRow(entry)));
    UI.main.appendChild(list);

    const footer = el("div", "vocab-footer");
    footer.appendChild(
      el("div", "vocab-footer-tip", "点英文可听发音 · 本页作答完继续；随时可关闭，下次自动续做")
    );
    const nextBtn = el("button", "vocab-next", "下一页");
    nextBtn.disabled = true;
    nextBtn.addEventListener("click", () => {
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

    // 左侧：单词 + 已连过轮次进度点
    const wrap = el("div", "vocab-word-wrap");
    const wordBtn = el("button", "vocab-word");
    wordBtn.innerHTML = `${word.en}<span class="spk">🔊</span>`;
    wordBtn.addEventListener("click", () => playWord(word.en));
    wrap.appendChild(wordBtn);

    const meta = el("div", "vocab-word-meta");
    const pips = el("span", "vocab-pips");
    const p = progOf(word.en);
    renderPips(pips, p.lv, p.f);
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

  function renderPips(pipsEl, lv, failed) {
    pipsEl.innerHTML = "";
    if (failed) {
      pipsEl.appendChild(el("span", "vocab-need-tag", "📝 需记"));
      return;
    }
    for (let i = 0; i < GOAL; i += 1) {
      pipsEl.appendChild(el("span", "vocab-pip" + (i < lv ? " on" : "")));
    }
    if (lv >= GOAL) {
      pipsEl.appendChild(el("span", "vocab-mastered-tag", " ✓已认识"));
    }
  }

  function answer(entry, row, buttons, unknownBtn, isCorrect, chosenBtn) {
    if (entry.answered) return;
    entry.answered = true;

    const word = entry.word;
    const p = progOf(word.en);
    if (isCorrect) {
      const nlv = Math.min(GOAL, p.lv + 1);
      setProg(word.en, nlv, false); // 答对：进阶到下一轮
      if (nlv >= GOAL) addGlobalCoins(1); // 连过 5 轮，斩词奖励
    } else {
      setProg(word.en, p.lv, true); // 答错/不认识：掉出为「需记」
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
    const np = progOf(word.en);
    renderPips(entry._pips, np.lv, np.f);

    answered += 1;
    if (page._nextBtn && answered >= page.length) {
      page._nextBtn.disabled = false;
      page._nextBtn.textContent = nextLabel();
    }
    updateStats();
  }

  // 本页作答完后，下一步按钮的文案。
  function nextLabel() {
    if (queue.length) return "下一页";
    const r = computeRound();
    if (r == null) return "完成";
    if (r !== round) return `进入第 ${r} 轮`;
    return "下一页";
  }

  function renderDone() {
    UI.main.innerHTML = "";
    const known = knownCount();
    const need = needCount();
    const box = el("div", "vocab-done");
    box.appendChild(el("div", "vocab-done-title", "🏆 5 轮确认全部完成！"));
    box.appendChild(
      el(
        "div",
        "vocab-done-tip",
        `真正认识（连过 ${GOAL} 轮）${known} 词 · 需要记 ${need} 词。` +
          `点「导出标记」把结果交给 Python 生成需记词表。`
      )
    );
    const actions = el("div", "vocab-done-actions");

    const exportBtn = el("button", "vocab-done-btn primary", "导出标记");
    exportBtn.addEventListener("click", exportProgress);
    actions.appendChild(exportBtn);

    const again = el("button", "vocab-done-btn", "全部重新开始");
    again.addEventListener("click", resetProgress);
    actions.appendChild(again);

    const home = el("button", "vocab-done-btn", "返回主页");
    home.addEventListener("click", goHome);
    actions.appendChild(home);

    box.appendChild(actions);
    UI.main.appendChild(box);
  }

  async function resetProgress() {
    const ok =
      typeof window.AppConfirm === "function"
        ? await window.AppConfirm("确定要清空所有进度、从第 1 轮重新开始吗？", {
            title: "重新开始",
            okText: "清空重来",
            cancelText: "取消",
          })
        : window.confirm("确定要清空所有进度、从第 1 轮重新开始吗？");
    if (!ok) return;
    prog = {};
    saveProg();
    refillQueue();
    renderPage();
  }

  function goHome() {
    if (window.AppNav && typeof window.AppNav.show === "function") {
      window.AppNav.show("home");
    }
  }

  // 导出标记：把每个词的等级(lv)下载成 JSON，交给 Python 生成需记词表。
  // counts[en] = lv；Python 端 lv>=5 视为已认识(排除)，其余为需记。
  function exportProgress() {
    const counts = {};
    let touched = 0;
    (allWords || []).forEach((w) => {
      const p = progOf(w.en);
      if (p.lv > 0 || p.f) {
        counts[keyOf(w.en)] = p.lv;
        touched += 1;
      }
    });
    const total = allWords ? allWords.length : 0;
    const done = computeRound() == null;
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      masterGoal: GOAL,
      completed: done, // 是否已走完 5 轮（未完成时导出仅供参考）
      total,
      known: knownCount(),
      need: needCount(),
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
    loadProg();
    try {
      await loadWords();
    } catch (err) {
      if (UI.main) {
        UI.main.innerHTML =
          '<div class="vocab-loading">词库加载失败，请检查 wordlist.txt。</div>';
      }
      return;
    }
    refillQueue(); // 由持久化状态推导当前轮次与位置 → 续做
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
    UI.export.addEventListener("click", exportProgress);
  }

  window.VocabApp = { start, pause };
})();
