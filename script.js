/* Data-driven quiz engine. Knows nothing about any specific quiz —
   everything comes from the quiz data (inline #quiz-data block, or
   questions.json when served over http://).

   Three play modes, chosen from an image grid on the landing screen:
     - Pussy  (10 questions) — answer everything, then grade at the end.
     - Human  (20 questions) — same, grade at the end.
     - Tiger  (25 questions) — SUDDEN DEATH. One question at a time, graded
       the moment you confirm. A single wrong answer ends the run.

   - Each attempt draws a RANDOM SAMPLE of questions from the full bank (size
     fixed by the chosen mode), shuffling options within each.
   - Questions may be single-answer (radio) or multi-answer (checkbox). A
     multi-answer question carries "multi": true and "answers": [indices]; it
     is correct only when exactly the right set is selected.
   - Questions answered WRONG are remembered (localStorage). When such a
     question reappears in a later attempt its text shows in red; answering it
     correctly again clears the red. */

(function () {
  "use strict";

  const form = document.getElementById("quiz-form");
  const titleEl = document.getElementById("quiz-title");
  const sourceEl = document.getElementById("quiz-source");
  const progressEl = document.getElementById("quiz-progress");
  const submitBtn = document.getElementById("submit-btn");
  const restartBtn = document.getElementById("restart-btn");
  const resultEl = document.getElementById("result");
  const modeSelectEl = document.getElementById("mode-select");
  const quizScreenEl = document.getElementById("quiz-screen");
  const backBtn = document.getElementById("back-btn");
  const modeBadgeEl = document.getElementById("mode-badge");

  const WRONG_KEY = "ms700_wrong_ids";

  // Each mode = how many questions, and whether it's sudden death.
  const MODES = {
    pussy: { name: "Pussy", count: 10, suddenDeath: false },
    human: { name: "Human", count: 20, suddenDeath: false },
    tiger: { name: "Tiger", count: 25, suddenDeath: true },
  };

  let quiz = null;     // the loaded { title, source, questions }
  let view = [];       // per-render sampled questions with shuffled options
  let mode = null;     // key into MODES for the current run
  let tigerIdx = 0;    // current question index in a sudden-death run
  let graded = false;
  let wrong = loadWrong(); // Set of question ids answered wrong in the past

  function loadWrong() {
    try {
      const raw = localStorage.getItem(WRONG_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) { return new Set(); }
  }
  function saveWrong() {
    try { localStorage.setItem(WRONG_KEY, JSON.stringify([...wrong])); } catch (e) {}
  }

  // Fisher–Yates, non-mutating.
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function loadData() {
    // Primary: inline JSON block (works on file:// — no server needed).
    const inline = document.getElementById("quiz-data");
    const raw = inline ? inline.textContent.trim() : "";
    if (raw && raw !== "__QUIZ_DATA__") {
      try { return JSON.parse(raw); } catch (e) { /* fall through to fetch */ }
    }
    // Fallback: fetch questions.json (works when served over http://).
    try {
      const res = await fetch("questions.json", { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch (e) { /* ignore */ }
    return null;
  }

  // How many questions to draw this attempt (capped at what the bank holds).
  function sampleSize() {
    const total = quiz.questions.length;
    const want = mode ? MODES[mode].count : total;
    return Math.min(want, total);
  }

  // Indices of correct options for a raw question (single or multi).
  function correctIndexes(q) {
    if (q.multi && Array.isArray(q.answers)) return q.answers.slice();
    if (Array.isArray(q.answers)) return q.answers.slice();
    return [q.answer];
  }

  function buildView() {
    const pool = shuffled(quiz.questions).slice(0, sampleSize());
    view = pool.map((q) => {
      const correct = new Set(correctIndexes(q));
      const opts = shuffled(q.options.map((text, idx) => ({ text, correct: correct.has(idx) })));
      return {
        id: q.id,
        stem: q.question,
        explanation: q.explanation || "",
        options: opts,
        multi: !!q.multi,
        pick: correct.size,
        image: !!q.image,
      };
    });
  }

  // Build one question card. `qi` indexes into `view`; inputs are named q{qi}.
  function buildCard(q, qi) {
    const card = document.createElement("div");
    card.className = "question";
    card.dataset.q = String(qi);

    const stem = document.createElement("p");
    stem.className = "question-stem";
    if (wrong.has(q.id)) stem.classList.add("previously-wrong");
    stem.innerHTML = `<span class="qnum">Q${qi + 1}.</span>`;
    stem.appendChild(document.createTextNode(q.stem));
    if (q.multi) {
      const tag = document.createElement("span");
      tag.className = "multi-tag";
      tag.textContent = ` (多選題:需選 ${q.pick} 項)`;
      stem.appendChild(tag);
    }
    if (q.image) {
      const note = document.createElement("span");
      note.className = "image-note";
      note.textContent = " (原題含圖片,此處未含)";
      stem.appendChild(note);
    }
    card.appendChild(stem);

    q.options.forEach((opt, oi) => {
      const label = document.createElement("label");
      label.className = "option";
      label.dataset.opt = String(oi);

      const input = document.createElement("input");
      input.type = q.multi ? "checkbox" : "radio";
      input.name = `q${qi}`;
      input.value = String(oi);

      const span = document.createElement("span");
      span.textContent = opt.text;

      label.appendChild(input);
      label.appendChild(span);
      card.appendChild(label);
    });

    return card;
  }

  // Lock a graded card, paint correct/wrong options, update wrong-memory, and
  // append the verdict + explanation. Returns whether the answer was right.
  function markCard(card, q, qi) {
    const correctIdxs = q.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
    const chosen = [...card.querySelectorAll(`input[name="q${qi}"]:checked`)].map((c) => Number(c.value));
    const isRight =
      chosen.length === correctIdxs.length && correctIdxs.every((i) => chosen.includes(i));

    card.querySelectorAll("input").forEach((i) => (i.disabled = true));
    correctIdxs.forEach((ci) => {
      const lbl = card.querySelector(`.option[data-opt="${ci}"]`);
      if (lbl) lbl.classList.add("correct");
    });
    chosen.forEach((ch) => {
      if (!correctIdxs.includes(ch)) {
        const lbl = card.querySelector(`.option[data-opt="${ch}"]`);
        if (lbl) lbl.classList.add("wrong");
      }
    });

    const stem = card.querySelector(".question-stem");
    if (isRight) {
      wrong.delete(q.id);
      if (stem) stem.classList.remove("previously-wrong");
    } else {
      wrong.add(q.id);
      if (stem) stem.classList.add("previously-wrong");
    }

    const exp = document.createElement("p");
    exp.className = "explanation";
    const verdict = document.createElement("span");
    verdict.className = "verdict " + (isRight ? "ok" : "no");
    verdict.textContent = isRight ? "答對。" : (chosen.length === 0 ? "未作答。" : "答錯。");
    exp.appendChild(verdict);
    if (q.explanation) exp.appendChild(document.createTextNode(q.explanation));
    else exp.appendChild(document.createTextNode("正確答案已標示於上方。"));
    card.appendChild(exp);

    return isRight;
  }

  /* ---------- Normal modes (Pussy / Human): grade all at once ---------- */

  function render() {
    graded = false;
    resultEl.hidden = true;
    resultEl.innerHTML = "";
    restartBtn.hidden = true;
    submitBtn.hidden = false;
    submitBtn.disabled = false;
    form.innerHTML = "";

    if (!view.length) {
      form.innerHTML = '<p class="empty">No questions found in this quiz.</p>';
      submitBtn.hidden = true;
      return;
    }

    const total = quiz.questions.length;
    progressEl.textContent =
      `${view.length} / ${total} 題 · 隨機抽題 · 每次選項順序都會打亂`;

    view.forEach((q, qi) => form.appendChild(buildCard(q, qi)));
  }

  function grade() {
    if (graded) return;
    let correct = 0;
    view.forEach((q, qi) => {
      const card = form.querySelector(`.question[data-q="${qi}"]`);
      if (markCard(card, q, qi)) correct++;
    });
    saveWrong();

    graded = true;
    submitBtn.hidden = true;
    restartBtn.hidden = false;

    const pct = Math.round((correct / view.length) * 100);
    resultEl.hidden = false;
    resultEl.innerHTML =
      `<div class="score">${correct} / ${view.length} &nbsp;(${pct}%)</div>` +
      `<div>對一對下面的答案,然後按「再抽一組」。答錯的題目下次出現時會變紅色。</div>`;
    resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------- Tiger mode: sudden death, one question at a time ---------- */

  function renderTiger() {
    graded = false;
    resultEl.hidden = true;
    resultEl.innerHTML = "";
    restartBtn.hidden = true;
    submitBtn.hidden = true;
    form.innerHTML = "";

    const q = view[tigerIdx];
    // Deliberately give NO hint that this is sudden death — surprise them.
    progressEl.textContent = `第 ${tigerIdx + 1} / ${view.length} 題`;

    // Reuse the shared card, but inputs named q0 (one question on screen).
    form.appendChild(buildCard(q, 0));

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn btn-primary";
    confirmBtn.textContent = "確認作答";
    confirmBtn.addEventListener("click", () => gradeTiger());
    form.appendChild(confirmBtn);
  }

  function gradeTiger() {
    if (graded) return;
    const q = view[tigerIdx];
    const card = form.querySelector('.question[data-q="0"]');
    const chosen = card.querySelectorAll('input[name="q0"]:checked');
    if (chosen.length === 0) {
      progressEl.textContent = `第 ${tigerIdx + 1} / ${view.length} 題 · 請先選一個答案再確認`;
      return;
    }
    graded = true;

    const isRight = markCard(card, q, 0);
    saveWrong();

    // Drop the confirm button.
    const cb = form.querySelector(".btn-primary");
    if (cb) cb.remove();

    if (!isRight) { tigerDeath(); return; }

    if (tigerIdx >= view.length - 1) { tigerWin(); return; }

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "btn btn-primary";
    nextBtn.textContent = "下一題 →";
    nextBtn.addEventListener("click", () => { tigerIdx++; renderTiger(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    form.appendChild(nextBtn);
  }

  function tigerDeath() {
    resultEl.hidden = false;
    resultEl.classList.add("death");
    resultEl.innerHTML =
      `<div class="score">💀 挑戰失敗</div>` +
      `<div>你撐過了 <strong>${tigerIdx}</strong> 題,在第 <strong>${tigerIdx + 1}</strong> 題倒下。` +
      `老虎不留情。看一下上面的正確答案,再戰一次?</div>` +
      `<div class="end-actions">` +
      `<button type="button" class="btn btn-primary" id="tiger-retry">↺ 重新挑戰 Tiger</button>` +
      `<button type="button" class="btn btn-secondary" id="tiger-back">← 模式選擇</button>` +
      `</div>`;
    wireEndActions();
    resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function tigerWin() {
    resultEl.hidden = false;
    resultEl.classList.remove("death");
    resultEl.innerHTML =
      `<div class="score">🐯 完美通關!</div>` +
      `<div>你連續答對全部 <strong>${view.length}</strong> 題,撐過了 Tiger 模式。猛!</div>` +
      `<div class="end-actions">` +
      `<button type="button" class="btn btn-primary" id="tiger-retry">↺ 再來一輪</button>` +
      `<button type="button" class="btn btn-secondary" id="tiger-back">← 模式選擇</button>` +
      `</div>`;
    wireEndActions();
    resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function wireEndActions() {
    const retry = document.getElementById("tiger-retry");
    const back = document.getElementById("tiger-back");
    if (retry) retry.addEventListener("click", () => startMode("tiger"));
    if (back) back.addEventListener("click", showModeSelect);
  }

  /* ---------- Screen / mode switching ---------- */

  function startMode(key) {
    if (!MODES[key]) return;
    mode = key;
    resultEl.classList.remove("death");
    modeBadgeEl.textContent = `${MODES[key].name} · ${MODES[key].count} 題`;
    modeSelectEl.hidden = true;
    quizScreenEl.hidden = false;
    buildView();
    if (MODES[key].suddenDeath) {
      tigerIdx = 0;
      renderTiger();
    } else {
      render();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showModeSelect() {
    mode = null;
    form.innerHTML = "";
    resultEl.hidden = true;
    resultEl.classList.remove("death");
    progressEl.textContent = "";
    quizScreenEl.hidden = true;
    modeSelectEl.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Normal-mode "再抽一組": new random sample, same mode.
  function restart() {
    buildView();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  submitBtn.addEventListener("click", grade);
  restartBtn.addEventListener("click", restart);
  backBtn.addEventListener("click", showModeSelect);
  document.querySelectorAll(".mode-card").forEach((btn) => {
    btn.addEventListener("click", () => startMode(btn.dataset.mode));
  });

  loadData().then((data) => {
    if (!data || !Array.isArray(data.questions)) {
      titleEl.textContent = "Couldn’t load the quiz";
      modeSelectEl.hidden = true;
      quizScreenEl.hidden = false;
      form.innerHTML =
        '<p class="empty">No quiz data found. Make sure questions.json sits next to this page, ' +
        "or open the page through a local server.</p>";
      submitBtn.hidden = true;
      return;
    }
    quiz = data;
    titleEl.textContent = data.title || "Quiz";
    if (data.source) { sourceEl.hidden = false; sourceEl.textContent = "Source: " + data.source; }
    document.title = data.title || "Quiz";
    // Start on the mode-select screen; nothing renders until a mode is chosen.
  });
})();
