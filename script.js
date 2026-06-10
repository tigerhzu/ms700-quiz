/* Data-driven quiz engine. Knows nothing about any specific quiz —
   everything comes from the quiz data (inline #quiz-data block, or
   questions.json when served over http://).

   Bilingual: each question may carry *_zh fields (question_zh, options_zh,
   explanation_zh) and the quiz a title_zh. The 中 / EN toggle swaps the
   displayed language in place, preserving the current answers and grading. */

(function () {
  "use strict";

  const form = document.getElementById("quiz-form");
  const titleEl = document.getElementById("quiz-title");
  const sourceEl = document.getElementById("quiz-source");
  const progressEl = document.getElementById("quiz-progress");
  const submitBtn = document.getElementById("submit-btn");
  const restartBtn = document.getElementById("restart-btn");
  const resultEl = document.getElementById("result");
  const langBtn = document.getElementById("lang-toggle");

  let quiz = null;     // the loaded { title, source, questions }
  let view = [];       // per-render shuffled questions with shuffled options
  let graded = false;
  let lastScore = null; // { correct, total } from the most recent grade()

  // Language: "en" or "zh". Remembered across reloads.
  let lang = "en";
  try { lang = localStorage.getItem("quizLang") === "zh" ? "zh" : "en"; } catch (e) {}

  // UI strings per language.
  const UI = {
    en: {
      submit: "Submit answers",
      retry: "Shuffle & retry",
      toggle: "中",            // button shows the language you can switch TO
      progress: (n) => `${n} question${n === 1 ? "" : "s"} · answers are shuffled each attempt`,
      correct: "Correct.",
      notQuite: "Not quite.",
      skipped: "Skipped.",
      reviewLine: "Review the explanations below, then hit “Shuffle & retry”.",
      loadFail: "Couldn’t load the quiz",
      empty: "No questions found in this quiz.",
      sourcePrefix: "Source: ",
    },
    zh: {
      submit: "送出答案",
      retry: "重新洗題再試一次",
      toggle: "EN",
      progress: (n) => `共 ${n} 題 · 每次作答選項都會重新洗牌`,
      correct: "答對了。",
      notQuite: "不太對。",
      skipped: "未作答。",
      reviewLine: "請參考下方解說,再按「重新洗題再試一次」。",
      loadFail: "無法載入測驗",
      empty: "這份測驗沒有任何題目。",
      sourcePrefix: "來源:",
    },
  };

  const t = () => UI[lang];

  // Pick the language-appropriate string, falling back to English/base.
  function pick(en, zh) {
    return (lang === "zh" && zh != null && zh !== "") ? zh : en;
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

  function buildView() {
    // Shuffle question order, and shuffle options within each question while
    // remembering which shuffled option is the correct one. Both language
    // variants are carried so we can swap text without reshuffling.
    view = shuffled(quiz.questions).map((q) => {
      const zhOpts = Array.isArray(q.options_zh) ? q.options_zh : [];
      const opts = shuffled(
        q.options.map((text, idx) => ({
          en: text,
          zh: zhOpts[idx] || "",
          correct: idx === q.answer,
        }))
      );
      return {
        stem: { en: q.question, zh: q.question_zh || "" },
        explanation: { en: q.explanation || "", zh: q.explanation_zh || "" },
        options: opts,
      };
    });
  }

  function render() {
    graded = false;
    lastScore = null;
    resultEl.hidden = true;
    resultEl.innerHTML = "";
    restartBtn.hidden = true;
    submitBtn.hidden = false;
    submitBtn.disabled = false;
    form.innerHTML = "";

    if (!view.length) {
      form.innerHTML = `<p class="empty">${t().empty}</p>`;
      submitBtn.hidden = true;
      return;
    }

    progressEl.textContent = t().progress(view.length);

    view.forEach((q, qi) => {
      const card = document.createElement("div");
      card.className = "question";
      card.dataset.q = String(qi);

      const stem = document.createElement("p");
      stem.className = "question-stem";
      stem.innerHTML = `<span class="qnum">Q${qi + 1}.</span>`;
      const stemText = document.createElement("span");
      stemText.className = "stem-text";
      stemText.textContent = pick(q.stem.en, q.stem.zh);
      stem.appendChild(stemText);
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
        span.className = "opt-text";
        span.textContent = pick(opt.en, opt.zh);

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

      // Explanation with a verdict. Stash the verdict kind + texts so the
      // language toggle can re-localise it later.
      const exp = document.createElement("p");
      exp.className = "explanation";
      const ok = chosenIdx === correctIdx;
      const kind = ok ? "correct" : (chosenIdx === -1 ? "skipped" : "notQuite");
      const verdict = document.createElement("span");
      verdict.className = "verdict " + (ok ? "ok" : "no");
      verdict.dataset.kind = kind;
      verdict.textContent = t()[kind];
      exp.appendChild(verdict);
      const expText = document.createElement("span");
      expText.className = "exp-text";
      expText.textContent = pick(q.explanation.en, q.explanation.zh);
      exp.appendChild(expText);
      card.appendChild(exp);
    });

    graded = true;
    lastScore = { correct, total: view.length };
    submitBtn.hidden = true;
    restartBtn.hidden = false;
    renderResult();
    resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderResult() {
    if (!lastScore) return;
    const { correct, total } = lastScore;
    const pct = Math.round((correct / total) * 100);
    resultEl.hidden = false;
    resultEl.innerHTML =
      `<div class="score">${correct} / ${total} &nbsp;(${pct}%)</div>` +
      `<div>${t().reviewLine}</div>`;
  }

  function restart() {
    buildView();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Swap displayed language in place — keeps current answers and grading.
  function applyLang() {
    if (langBtn) langBtn.textContent = t().toggle;
    document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
    if (quiz) titleEl.textContent = pick(quiz.title, quiz.title_zh);
    document.title = titleEl.textContent || "Quiz";
    if (quiz && quiz.source) sourceEl.textContent = t().sourcePrefix + quiz.source;

    if (!view.length) {
      const empty = form.querySelector(".empty");
      if (empty) empty.textContent = t().empty;
    } else {
      progressEl.textContent = t().progress(view.length);
    }

    submitBtn.textContent = t().submit;
    restartBtn.textContent = t().retry;

    // Per-question text.
    view.forEach((q, qi) => {
      const card = form.querySelector(`.question[data-q="${qi}"]`);
      if (!card) return;
      const stemText = card.querySelector(".stem-text");
      if (stemText) stemText.textContent = pick(q.stem.en, q.stem.zh);
      q.options.forEach((opt, oi) => {
        const span = card.querySelector(`.option[data-opt="${oi}"] .opt-text`);
        if (span) span.textContent = pick(opt.en, opt.zh);
      });
      const verdict = card.querySelector(".explanation .verdict");
      if (verdict) verdict.textContent = t()[verdict.dataset.kind] || verdict.textContent;
      const expText = card.querySelector(".explanation .exp-text");
      if (expText) expText.textContent = pick(q.explanation.en, q.explanation.zh);
    });

    if (graded) renderResult();
  }

  function toggleLang() {
    lang = lang === "en" ? "zh" : "en";
    try { localStorage.setItem("quizLang", lang); } catch (e) {}
    applyLang();
  }

  submitBtn.addEventListener("click", grade);
  restartBtn.addEventListener("click", restart);
  if (langBtn) langBtn.addEventListener("click", toggleLang);

  loadData().then((data) => {
    if (!data || !Array.isArray(data.questions)) {
      titleEl.textContent = t().loadFail;
      form.innerHTML =
        '<p class="empty">No quiz data found. Make sure questions.json sits next to this page, ' +
        "or open the page through a local server.</p>";
      submitBtn.hidden = true;
      return;
    }
    quiz = data;
    titleEl.textContent = pick(data.title, data.title_zh);
    if (data.source) { sourceEl.hidden = false; sourceEl.textContent = t().sourcePrefix + data.source; }
    document.title = titleEl.textContent || "Quiz";
    buildView();
    render();
    applyLang(); // ensure button label + any persisted zh state are applied
  });
})();
