/* Data-driven quiz engine. Knows nothing about any specific quiz —
   everything comes from the quiz data (inline #quiz-data block, or
   questions.json when served over http://).

   - Each attempt draws a RANDOM SAMPLE of questions from the full bank (size
     chosen via the count selector), shuffling options within each.
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
  const countSel = document.getElementById("count-select");

  const WRONG_KEY = "ms700_wrong_ids";

  let quiz = null;     // the loaded { title, source, questions }
  let view = [];       // per-render sampled questions with shuffled options
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

  // How many questions to draw this attempt.
  function sampleSize() {
    const total = quiz.questions.length;
    const v = countSel ? countSel.value : "25";
    if (v === "all") return total;
    const n = parseInt(v, 10);
    return isNaN(n) ? total : Math.min(n, total);
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
      `${view.length} of ${total} question${total === 1 ? "" : "s"} · drawn at random · options shuffled each attempt`;

    view.forEach((q, qi) => {
      const card = document.createElement("div");
      card.className = "question";
      card.dataset.q = String(qi);

      const stem = document.createElement("p");
      stem.className = "question-stem";
      // Red flag for questions previously answered wrong.
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

      form.appendChild(card);
    });
  }

  function grade() {
    if (graded) return;
    let correct = 0;

    view.forEach((q, qi) => {
      const card = form.querySelector(`.question[data-q="${qi}"]`);
      const correctIdxs = q.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
      const chosen = [...card.querySelectorAll(`input[name="q${qi}"]:checked`)].map((c) => Number(c.value));
      const isRight =
        chosen.length === correctIdxs.length && correctIdxs.every((i) => chosen.includes(i));
      if (isRight) correct++;

      // Lock inputs and paint states.
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

      // Update the wrong-memory and the red flag on this stem.
      const stem = card.querySelector(".question-stem");
      if (isRight) {
        wrong.delete(q.id);
        if (stem) stem.classList.remove("previously-wrong");
      } else {
        wrong.add(q.id);
        if (stem) stem.classList.add("previously-wrong");
      }

      // Verdict + explanation.
      const exp = document.createElement("p");
      exp.className = "explanation";
      const verdict = document.createElement("span");
      verdict.className = "verdict " + (isRight ? "ok" : "no");
      verdict.textContent = isRight ? "Correct." : (chosen.length === 0 ? "Skipped." : "Not quite.");
      exp.appendChild(verdict);
      if (q.explanation) exp.appendChild(document.createTextNode(q.explanation));
      else exp.appendChild(document.createTextNode("Correct answer(s) highlighted above."));
      card.appendChild(exp);
    });

    saveWrong();

    graded = true;
    submitBtn.hidden = true;
    restartBtn.hidden = false;

    const pct = Math.round((correct / view.length) * 100);
    resultEl.hidden = false;
    resultEl.innerHTML =
      `<div class="score">${correct} / ${view.length} &nbsp;(${pct}%)</div>` +
      `<div>Review the answers below, then hit “New random set”. ` +
      `Questions you miss turn red when they come back.</div>`;
    resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function restart() {
    buildView();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  submitBtn.addEventListener("click", grade);
  restartBtn.addEventListener("click", restart);
  if (countSel) countSel.addEventListener("change", restart);

  loadData().then((data) => {
    if (!data || !Array.isArray(data.questions)) {
      titleEl.textContent = "Couldn’t load the quiz";
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
    buildView();
    render();
  });
})();
