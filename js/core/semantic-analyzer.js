/* DiffLab — semantic analyzer (heuristic path)
 *
 * Layered on top of the text engine's diff result, this module augments it
 * with three semantic signals:
 *
 *   - cosmeticHunks:  hunk indices whose every change is whitespace-only
 *                     or comment-only and can therefore be collapsed
 *   - renames:        map<rowIdx, {old, new}> — "mod" rows where exactly
 *                     one identifier differs between left and right
 *   - moves:          pairs of hunks where a deleted run and an inserted
 *                     run have identical non-whitespace content
 *
 * This is the heuristic path and runs synchronously on the main thread
 * (fast enough for diffs up to ~10k rows). A future tree-sitter path
 * (see lib/tree-sitter/README.md) will upgrade these signals using
 * real ASTs — when it lands, it replaces this module's output via the
 * same return shape.
 */

(function (global) {
  "use strict";

  const LINE_COMMENTS = {
    javascript: ["//"], typescript: ["//"], java: ["//"], cpp: ["//"], c: ["//"],
    csharp: ["//"], go: ["//"], rust: ["//"], swift: ["//"], kotlin: ["//"], php: ["//", "#"],
    python: ["#"], ruby: ["#"], bash: ["#"], yaml: ["#"], dockerfile: ["#"],
    sql: ["--"], lua: ["--"]
  };

  const BLOCK_COMMENTS = {
    javascript: [["/*", "*/"]], typescript: [["/*", "*/"]],
    java: [["/*", "*/"]], cpp: [["/*", "*/"]], c: [["/*", "*/"]],
    csharp: [["/*", "*/"]], go: [["/*", "*/"]], rust: [["/*", "*/"]],
    swift: [["/*", "*/"]], kotlin: [["/*", "*/"]], php: [["/*", "*/"]],
    css: [["/*", "*/"]], xml: [["<!--", "-->"]]
  };

  const IDENT_TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/;
  const TOKEN_SPLIT = /([A-Za-z_$][A-Za-z0-9_$]*|[0-9]+(?:\.[0-9]+)?|\s+|\S)/g;

  function analyze(diff, leftText, rightText, language) {
    const result = {
      cosmeticHunks: new Set(),
      renames: new Map(),
      moves: []
    };

    if (!diff || !diff.rows || !diff.hunks) return result;

    const lang = normalizeLang(language, leftText + "\n" + rightText);

    for (let h = 0; h < diff.hunks.length; h++) {
      const hunk = diff.hunks[h];
      const isCosmetic = hunkIsCosmetic(diff.rows, hunk, lang);
      if (isCosmetic) result.cosmeticHunks.add(h);
    }

    for (let i = 0; i < diff.rows.length; i++) {
      const r = diff.rows[i];
      if (r.type !== "mod") continue;
      const rn = detectRename(r.leftText, r.rightText);
      if (rn) result.renames.set(i, rn);
    }

    result.moves = detectMoves(diff.rows);

    return result;
  }

  // ---------- cosmetic detection ----------

  function hunkIsCosmetic(rows, hunk, lang) {
    let hasChange = false;
    for (let i = hunk.start; i < hunk.end; i++) {
      const r = rows[i];
      if (r.type === "eq") continue;
      hasChange = true;
      if (!rowIsCosmetic(r, lang)) return false;
    }
    return hasChange;
  }

  function rowIsCosmetic(r, lang) {
    const l = r.leftText || "";
    const rt = r.rightText || "";

    if (r.type === "add") return isBlankOrComment(rt, lang);
    if (r.type === "del") return isBlankOrComment(l, lang);
    if (r.type === "mod") {
      if (normalizeWs(l) === normalizeWs(rt)) return true;
      const lStrip = stripComments(l, lang).trim();
      const rStrip = stripComments(rt, lang).trim();
      if (lStrip === rStrip) return true;
      return false;
    }
    return false;
  }

  function isBlankOrComment(line, lang) {
    const trimmed = line.trim();
    if (trimmed === "") return true;
    const lineStarters = LINE_COMMENTS[lang] || [];
    for (const s of lineStarters) {
      if (trimmed.startsWith(s)) return true;
    }
    const blocks = BLOCK_COMMENTS[lang] || [];
    for (const [open, close] of blocks) {
      if (trimmed.startsWith(open) && trimmed.endsWith(close)) return true;
      if (trimmed.startsWith(open) || trimmed.endsWith(close)) return true;
      if (trimmed === "*") return true;
      if (trimmed.startsWith("*") && !trimmed.startsWith("*/")) return true;
    }
    return false;
  }

  function stripComments(line, lang) {
    let out = line;
    for (const s of LINE_COMMENTS[lang] || []) {
      const idx = out.indexOf(s);
      if (idx >= 0) out = out.slice(0, idx);
    }
    for (const [open, close] of BLOCK_COMMENTS[lang] || []) {
      const o = out.indexOf(open);
      if (o >= 0) {
        const c = out.indexOf(close, o + open.length);
        if (c >= 0) out = out.slice(0, o) + out.slice(c + close.length);
      }
    }
    return out;
  }

  function normalizeWs(s) { return (s || "").replace(/\s+/g, " ").trim(); }

  // ---------- rename detection ----------

  function detectRename(leftLine, rightLine) {
    if (leftLine == null || rightLine == null) return null;
    if (leftLine === rightLine) return null;

    const lt = tokenize(leftLine);
    const rt = tokenize(rightLine);
    if (lt.length !== rt.length) return null;

    let diffIdx = -1;
    for (let i = 0; i < lt.length; i++) {
      if (lt[i] !== rt[i]) {
        if (diffIdx !== -1) return null;
        diffIdx = i;
      }
    }
    if (diffIdx === -1) return null;

    const a = lt[diffIdx];
    const b = rt[diffIdx];
    if (!IDENT_TOKEN.test(a) || !IDENT_TOKEN.test(b)) return null;
    if (a === b) return null;
    return { old: a, new: b, position: diffIdx };
  }

  function tokenize(line) {
    const out = [];
    let m;
    TOKEN_SPLIT.lastIndex = 0;
    while ((m = TOKEN_SPLIT.exec(line)) !== null) {
      const t = m[0];
      if (/^\s+$/.test(t)) out.push(" ");
      else out.push(t);
    }
    return out;
  }

  // ---------- move detection ----------

  function detectMoves(rows) {
    const dels = collectRuns(rows, "del");
    const adds = collectRuns(rows, "add");
    const out = [];

    const addsByHash = new Map();
    for (const a of adds) {
      const key = hashRun(a.text);
      if (!key) continue;
      if (!addsByHash.has(key)) addsByHash.set(key, []);
      addsByHash.get(key).push(a);
    }
    for (const d of dels) {
      const key = hashRun(d.text);
      if (!key) continue;
      const matches = addsByHash.get(key);
      if (!matches || matches.length === 0) continue;
      const m = matches.shift();
      out.push({ fromStart: d.start, fromEnd: d.end, toStart: m.start, toEnd: m.end });
    }
    return out;
  }

  function collectRuns(rows, type) {
    const out = [];
    let i = 0;
    while (i < rows.length) {
      if (rows[i].type !== type) { i++; continue; }
      let j = i;
      const texts = [];
      while (j < rows.length && rows[j].type === type) {
        texts.push(type === "del" ? rows[j].leftText : rows[j].rightText);
        j++;
      }
      if (texts.length >= 2) out.push({ start: i, end: j, text: texts.join("\n") });
      i = j;
    }
    return out;
  }

  function hashRun(text) {
    const stripped = (text || "").replace(/\s+/g, " ").trim();
    if (stripped.length < 10) return null;
    return stripped;
  }

  // ---------- language fallback ----------

  function normalizeLang(lang, sample) {
    if (lang && lang !== "auto") return lang;
    const s = (sample || "").slice(0, 2000);
    if (/^\s*#!\/.*python/m.test(s) || /\bdef\s+\w+\(/.test(s)) return "python";
    if (/\bpackage\s+main\b/.test(s) || /\bfunc\s+\w+\(/.test(s)) return "go";
    if (/\bfn\s+\w+\(/.test(s) && /::/.test(s)) return "rust";
    if (/\bpublic\s+(class|interface)\b/.test(s)) return "java";
    if (/\binterface\s+\w+\s*\{/.test(s) && /:\s*\w/.test(s)) return "typescript";
    if (/\b(const|let|function|=>)\b/.test(s)) return "javascript";
    return "javascript";
  }

  global.DiffLab = global.DiffLab || {};
  global.DiffLab.semantic = { analyze };
})(window);
