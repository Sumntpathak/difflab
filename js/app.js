/* DiffLab — orchestration
 *
 * Wires the UI to the active format adapter. Adapter-agnostic:
 *   - runCompare() builds richer input objects (text + optional File) and
 *     dispatches via DiffLab.adapters.compare(id, ...).
 *   - Format change rebuilds the format-options panel from the adapter's
 *     buildOptions() hook and toggles pane styles for file-only adapters.
 *   - Hunk navigation looks for [data-hunk-idx] first (new adapters) then
 *     falls back to v1's [data-row-index] on text renderer rows.
 */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const left = $("#left");
  const right = $("#right");
  const leftPane = left.closest(".pane");
  const rightPane = right.closest(".pane");
  const formatSelect = $("#format");
  const formatOptionsPanel = $("#format-options");
  const langSelect = $("#language");
  const ignoreWs = $("#ignore-ws");
  const semanticToggle = $("#semantic");
  const compareBtn = $("#compare");
  const result = $("#result");
  const stats = $("#stats");
  const resultActions = $("#result-actions");
  const addCount = $("#add-count");
  const delCount = $("#del-count");
  const hunkCount = $("#hunk-count");
  const themeToggle = $("#theme-toggle");
  const swapBtn = $("#swap");
  const prevBtn = $("#prev-hunk");
  const nextBtn = $("#next-hunk");
  const copyBtn = $("#copy-patch");

  let currentView = "split";
  let lastDiff = null;
  let currentHunkIdx = -1;

  const paneInputs = {
    left:  { file: null, name: null },
    right: { file: null, name: null }
  };

  const STORAGE_KEY = "difflab.state.v1";

  async function loadState() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const s = data[STORAGE_KEY];
      if (!s) return;
      if (typeof s.left === "string") left.value = s.left;
      if (typeof s.right === "string") right.value = s.right;
      if (typeof s.format === "string" && DiffLab.adapters.get(s.format)) {
        formatSelect.value = s.format;
      }
      if (typeof s.language === "string") langSelect.value = s.language;
      if (typeof s.ignoreWs === "boolean") ignoreWs.checked = s.ignoreWs;
      if (typeof s.semantic === "boolean") semanticToggle.checked = s.semantic;
      if (s.view === "unified") setView("unified");
      if (s.theme === "dark") setTheme("dark");
    } catch (e) {
      // Storage may not be available in some contexts.
    }
  }

  let saveTimer = null;
  function saveStateDebounced() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        chrome.storage.local.set({
          [STORAGE_KEY]: {
            left: left.value,
            right: right.value,
            format: formatSelect.value,
            language: langSelect.value,
            ignoreWs: ignoreWs.checked,
            semantic: semanticToggle.checked,
            view: currentView,
            theme: document.body.dataset.theme
          }
        });
      } catch (e) {}
    }, 400);
  }

  // ---------- format switching ----------

  function onFormatChanged() {
    const adapter = DiffLab.adapters.get(formatSelect.value);
    if (!adapter) return;

    applyPaneMode(adapter);

    formatOptionsPanel.innerHTML = "";
    DiffLab.adapters.buildOptions(
      adapter.id,
      formatOptionsPanel,
      () => { if (lastDiff) runCompare(); saveStateDebounced(); }
    );
    formatOptionsPanel.hidden = formatOptionsPanel.childElementCount === 0;
  }

  function applyPaneMode(adapter) {
    const binary = adapter.inputMode === "file";
    [leftPane, rightPane].forEach(p => p.classList.toggle("binary", binary));
    const ph = binary ? "Drop a file here, or use the File button…" : "Paste text or drop a file…";
    [left, right].forEach(ta => { ta.readOnly = binary; ta.placeholder = ph; });
  }

  // ---------- diff computation ----------

  async function runCompare() {
    const formatId = formatSelect.value;
    const opts = {
      ignoreWhitespace: ignoreWs.checked,
      semantic: semanticToggle.checked,
      language: langSelect.value,
      view: currentView
    };

    const leftInput  = { text: left.value,  file: paneInputs.left.file,  name: paneInputs.left.name };
    const rightInput = { text: right.value, file: paneInputs.right.file, name: paneInputs.right.name };

    let diff;
    try {
      diff = await DiffLab.adapters.compare(formatId, leftInput, rightInput, opts);
    } catch (e) {
      result.className = "result";
      result.innerHTML = `<div class="pdf-notice"><strong>Diff failed:</strong> ${escapeHTML(e.message || String(e))}</div>`;
      stats.hidden = true;
      resultActions.hidden = true;
      return;
    }
    lastDiff = diff;
    currentHunkIdx = -1;

    DiffLab.adapters.render(formatId, diff, result, opts);

    const s = diff.stats || { additions: 0, deletions: 0, hunkCount: 0 };
    addCount.textContent = String(s.additions);
    delCount.textContent = String(s.deletions);
    hunkCount.textContent = String(s.hunkCount);
    stats.hidden = false;
    resultActions.hidden = !diff.hunks || diff.hunks.length === 0;

    saveStateDebounced();
  }

  compareBtn.addEventListener("click", runCompare);

  formatSelect.addEventListener("change", () => {
    onFormatChanged();
    if (lastDiff) runCompare();
    saveStateDebounced();
  });
  langSelect.addEventListener("change", () => {
    if (lastDiff) runCompare();
    saveStateDebounced();
  });
  ignoreWs.addEventListener("change", () => {
    if (lastDiff) runCompare();
    saveStateDebounced();
  });
  semanticToggle.addEventListener("change", () => {
    if (lastDiff) runCompare();
    saveStateDebounced();
  });

  // ---------- view mode ----------

  function setView(mode) {
    currentView = mode;
    $$(".seg").forEach(b => {
      const active = b.dataset.view === mode;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (lastDiff) {
      DiffLab.adapters.render(formatSelect.value, lastDiff, result, {
        view: currentView,
        language: langSelect.value
      });
      currentHunkIdx = -1;
    }
    saveStateDebounced();
  }
  $$(".seg").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));

  // ---------- theme ----------

  function setTheme(theme) {
    document.body.dataset.theme = theme;
    const link = $("#hljs-theme");
    link.href = theme === "dark" ? "lib/hljs-dark.css" : "lib/hljs-light.css";
    saveStateDebounced();
  }
  themeToggle.addEventListener("click", () => {
    setTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
  });
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    setTheme("dark");
  }

  // ---------- swap & clear ----------

  swapBtn.addEventListener("click", () => {
    const tmp = left.value;
    left.value = right.value;
    right.value = tmp;

    const tmpIn = paneInputs.left;
    paneInputs.left = paneInputs.right;
    paneInputs.right = tmpIn;

    if (lastDiff) runCompare();
    else saveStateDebounced();
  });

  $$("[data-clear]").forEach(b => {
    b.addEventListener("click", () => {
      const target = b.dataset.clear;
      (target === "left" ? left : right).value = "";
      paneInputs[target].file = null;
      paneInputs[target].name = null;
      saveStateDebounced();
    });
  });

  // ---------- file loading ----------

  function handleFileFor(side, file) {
    if (!file) return;
    const adapter = DiffLab.adapters.get(formatSelect.value);
    if (adapter && adapter.inputMode === "file") {
      paneInputs[side].file = file;
      paneInputs[side].name = file.name;
      const ta = side === "left" ? left : right;
      ta.value = `[file: ${file.name} — ${formatBytes(file.size)}]`;
      saveStateDebounced();
      return;
    }
    file.text().then((text) => {
      (side === "left" ? left : right).value = text;
      paneInputs[side].file = null;
      paneInputs[side].name = file.name;
      const autoFormat = guessFormatFromName(file.name);
      if (autoFormat && autoFormat !== formatSelect.value) {
        formatSelect.value = autoFormat;
        onFormatChanged();
      }
      const lang = guessLanguageFromName(file.name);
      if (lang) langSelect.value = lang;
      saveStateDebounced();
    }).catch(() => {});
  }

  $$(".file-input").forEach(input => {
    input.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      handleFileFor(input.dataset.target, file);
      input.value = "";
    });
  });

  $$(".pane").forEach((pane, idx) => {
    const side = idx === 0 ? "left" : "right";
    pane.addEventListener("dragover", (e) => {
      e.preventDefault();
      pane.classList.add("dragover");
    });
    pane.addEventListener("dragleave", () => pane.classList.remove("dragover"));
    pane.addEventListener("drop", (e) => {
      e.preventDefault();
      pane.classList.remove("dragover");
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      handleFileFor(side, file);
    });
  });

  function guessLanguageFromName(name) {
    const ext = (name.match(/\.([^.]+)$/) || [])[1];
    if (!ext) return null;
    const map = {
      js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
      ts: "typescript", tsx: "typescript",
      py: "python", pyw: "python",
      java: "java",
      cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", h: "cpp",
      c: "c",
      cs: "csharp",
      go: "go",
      rs: "rust",
      rb: "ruby",
      php: "php",
      kt: "kotlin", kts: "kotlin",
      swift: "swift",
      sql: "sql",
      json: "json",
      yml: "yaml", yaml: "yaml",
      xml: "xml", html: "xml", htm: "xml", svg: "xml",
      css: "css", scss: "css", less: "css",
      sh: "bash", bash: "bash", zsh: "bash",
      md: "markdown", markdown: "markdown",
      dockerfile: "dockerfile"
    };
    return map[ext.toLowerCase()] || null;
  }

  function guessFormatFromName(name) {
    const ext = ((name.match(/\.([^.]+)$/) || [])[1] || "").toLowerCase();
    if (!ext) return null;
    if (["json", "jsonc", "geojson"].includes(ext)) return "json";
    if (["xml", "html", "htm", "svg", "xhtml"].includes(ext)) return "xml";
    if (["csv", "tsv"].includes(ext)) return "csv";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext)) return "image";
    if (ext === "pdf") return "pdf";
    return "text";
  }

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- hunk navigation ----------

  function navigateHunk(delta) {
    if (!lastDiff || !lastDiff.hunks || lastDiff.hunks.length === 0) return;
    currentHunkIdx = (currentHunkIdx + delta + lastDiff.hunks.length) % lastDiff.hunks.length;

    let el = result.querySelector(`[data-hunk-idx="${currentHunkIdx}"]`);
    if (!el) {
      const hunk = lastDiff.hunks[currentHunkIdx];
      if (hunk && hunk.start != null) {
        el = result.querySelector(`tr[data-row-index="${hunk.start}"]`);
      }
    }
    if (el) {
      result.querySelectorAll(".hunk-focus").forEach(r => r.classList.remove("hunk-focus"));
      el.classList.add("hunk-focus");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  prevBtn.addEventListener("click", () => navigateHunk(-1));
  nextBtn.addEventListener("click", () => navigateHunk(+1));

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
    if (e.key === "n") { e.preventDefault(); navigateHunk(+1); }
    else if (e.key === "p") { e.preventDefault(); navigateHunk(-1); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); runCompare();
    }
  });

  [left, right].forEach(ta => {
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        runCompare();
      }
    });
    ta.addEventListener("input", saveStateDebounced);
  });

  // ---------- copy as patch ----------

  copyBtn.addEventListener("click", async () => {
    if (!lastDiff) return;
    const patch = DiffLab.adapters.toPatch(formatSelect.value, lastDiff, {
      leftName: "original",
      rightName: "modified"
    });
    if (patch == null) {
      copyBtn.textContent = "No patch for this format";
      setTimeout(() => { copyBtn.textContent = "Copy patch"; }, 1500);
      return;
    }
    try {
      await navigator.clipboard.writeText(patch);
      copyBtn.textContent = "Copied ✓";
      setTimeout(() => { copyBtn.textContent = "Copy patch"; }, 1500);
    } catch (e) {
      copyBtn.textContent = "Copy failed";
      setTimeout(() => { copyBtn.textContent = "Copy patch"; }, 1500);
    }
  });

  // ---------- boot ----------

  (async function boot() {
    await loadState();
    onFormatChanged();
  })();
})();
