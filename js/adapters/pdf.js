/* DiffLab — PDF (text) adapter
 *
 * Extracts text from both PDFs using pdf.js, then hands the text off to
 * the v1 text engine for line-level diffing. Page-by-page headers are
 * inserted into the flat text stream so hunk headers locate the page.
 *
 * pdf.js is not vendored by default (it's ~2 MB) to keep the extension
 * under the stated size budget. The adapter will load it from
 * `lib/pdf.min.js` + `lib/pdf.worker.min.js` if present — drop the files
 * in and everything works, no code change required. If not present, the
 * adapter renders a friendly notice explaining how to install it.
 */

(function (global) {
  "use strict";

  const LIB_MAIN = "lib/pdf.min.js";
  const LIB_WORKER = "lib/pdf.worker.min.js";

  let pdfjsState = null;

  function getFile(input) {
    if (input && input.file) return input.file;
    return null;
  }

  const pdfAdapter = {
    id: "pdf",
    label: "PDF (text)",
    inputMode: "file",

    accepts(mime, ext) {
      if (mime === "application/pdf") return true;
      if (ext && String(ext).toLowerCase() === "pdf") return true;
      return false;
    },

    async parse(input) {
      const file = getFile(input);
      if (!file) return { ok: true, empty: true, text: "" };

      const pdfjs = await ensurePdfJs();
      if (!pdfjs) return { ok: false, noLib: true };

      try {
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        const chunks = [];
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const content = await page.getTextContent();
          chunks.push(`\n───── Page ${p} ─────\n`);
          chunks.push(content.items.map(it => it.str).join("\n"));
        }
        return { ok: true, text: chunks.join("\n") };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    },

    diff(left, right, optsIn) {
      if ((left && left.noLib) || (right && right.noLib)) {
        return { kind: "no-lib", stats: emptyStats(), hunks: [] };
      }
      if (left && left.empty && right && right.empty) {
        return { kind: "empty", stats: emptyStats(), hunks: [] };
      }
      if (!left.ok || !right.ok) {
        return { kind: "parse-error", left, right, stats: emptyStats(), hunks: [] };
      }
      const inner = global.DiffLabEngine.computeDiff(left.text || "", right.text || "", optsIn || {});
      return { kind: "text", inner, stats: inner.stats, hunks: inner.hunks };
    },

    render(result, container, optsIn) {
      container.className = "result";
      container.innerHTML = "";

      if (result.kind === "no-lib") {
        container.appendChild(renderNoLibNotice());
        return;
      }
      if (result.kind === "empty") {
        const d = document.createElement("div");
        d.className = "pdf-notice";
        d.textContent = "Drop PDF files onto each pane to compare their text content.";
        container.appendChild(d);
        return;
      }
      if (result.kind === "parse-error") {
        const d = document.createElement("div");
        d.className = "pdf-notice";
        const msg = [result.left && result.left.error, result.right && result.right.error].filter(Boolean).join("\n");
        d.textContent = "PDF parse error:\n" + msg;
        container.appendChild(d);
        return;
      }
      global.DiffLabRender.render(container, result.inner, optsIn || {});
    }
  };

  function renderNoLibNotice() {
    const d = document.createElement("div");
    d.className = "pdf-notice";
    d.innerHTML = `
      <strong>PDF support is opt-in.</strong><br><br>
      To enable PDF text diffing, drop these two files into <code>lib/</code>:
      <ul>
        <li><code>pdf.min.js</code></li>
        <li><code>pdf.worker.min.js</code></li>
      </ul>
      You can get them from the pdf.js release page. pdf.js is not bundled by
      default so the extension stays small and 100% local — no remote scripts
      are ever fetched. Reload the extension after dropping the files in.
    `;
    return d;
  }

  // ---------- pdf.js loader ----------

  function ensurePdfJs() {
    if (pdfjsState === "missing") return Promise.resolve(null);
    if (global.pdfjsLib) {
      configureWorker();
      return Promise.resolve(global.pdfjsLib);
    }
    return fetch(LIB_MAIN, { method: "HEAD" }).then(r => {
      if (!r.ok) { pdfjsState = "missing"; return null; }
      return injectScript(LIB_MAIN).then(() => {
        if (!global.pdfjsLib) { pdfjsState = "missing"; return null; }
        configureWorker();
        return global.pdfjsLib;
      });
    }).catch(() => { pdfjsState = "missing"; return null; });
  }

  function configureWorker() {
    if (global.pdfjsLib && global.pdfjsLib.GlobalWorkerOptions) {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = LIB_WORKER;
    }
  }

  function injectScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-pdfjs="1"]`);
      if (existing) { resolve(); return; }
      const s = document.createElement("script");
      s.src = src;
      s.dataset.pdfjs = "1";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("pdf.js failed to load"));
      document.head.appendChild(s);
    });
  }

  function emptyStats() { return { additions: 0, deletions: 0, hunkCount: 0 }; }

  global.DiffLab.adapters.register(pdfAdapter);
})(window);
