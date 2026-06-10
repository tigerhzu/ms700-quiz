/* Data-driven quiz engine. Knows nothing about any specific quiz —
   everything comes from the quiz data (inline #quiz-data block, or
   questions.json when served over http://).

   Each attempt draws a RANDOM SAMPLE of questions from the full bank (size
   chosen via the count selector), and shuffles the options within each. */

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

  let quiz = null;     // the loaded { title, source, questions }
  let view = [];       // per-render sampled questions with shuffled options
  let graded = false;

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

  function buildView() {
    // Draw a random sample from the full bank, then shuffle options within each
    // (remembering which shuffled option is the correct one).
    const pool = shuffled(quiz.questions).slice(0, sampleSize());
    view = pool.map((q) => {
      const opts = shuffled(q.options.map((text, idx) => ({ text, correct: idx === q.answer })));
      return { stem: q.question, explanation: q.explanation || "", options: opts };
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
      stem.innerHTML = `<span class="qnum">Q${qi + 1}.</span>`;
      stem.appendChild(document.createTextNode(q.stem));
      card.appendChild(stem);

      q.options.forEach((opt, oi) => {
        const label = document.createElement("label");
        label.className = "option";
        label.dataset.opt = String(oi);

        const input = document.createElement("input");
        input.type = "radio";
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
      const chosen = form.querySelector(`input[name="q${qi}"]:checked`);
      const chosenIdx = chosen ? Number(chosen.value) : -1;
      const correctIdx = q.options.findIndex((o) => o.correct);
      if (chosenIdx === correctIdx) correct++;

      // Lock inputs and paint correct / wrong states.
      card.querySelectorAll("input").forEach((i) => (i.disabled = true));
      const correctLabel = card.querySelector(`.option[data-opt="${correctIdx}"]`);
      if (correctLabel) correctLabel.classList.add("correct");
      if (chosenIdx !== -1 && chosenIdx !== correctIdx) {
        const wrongLabel = card.querySelector(`.option[data-opt="${chosenIdx}"]`);
        if (wrongLabel) wrongLabel.classList.add("wrong");
      }

      // Explanation with a verdict (explanation may be empty for this bank).
      const exp = document.createElement("p");
      exp.className = "explanation";
      const ok = chosenIdx === correctIdx;
      const verdict = document.createElement("span");
      verdict.className = "verdict " + (ok ? "ok" : "no");
      verdict.textContent = ok ? "Correct." : (chosenIdx === -1 ? "Skipped." : "Not quite.");
      exp.appendChild(verdict);
      if (q.explanation) exp.appendChild(document.createTextNode(q.explanation));
      else exp.appendChild(document.createTextNode("Correct answer highlighted above."));
      card.appendChild(exp);
    });

    graded = true;
    submitBtn.hidden = true;
    restartBtn.hidden = false;

    const pct = Math.round((correct / view.length) * 100);
    resultEl.hidden = false;
    resultEl.innerHTML =
      `<div class="score">${correct} / ${view.length} &nbsp;(${pct}%)</div>` +
      `<div>Review the answers below, then hit “New random set”.</div>`;
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
