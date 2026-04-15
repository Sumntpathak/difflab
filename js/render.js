/* DiffLab renderer
 *
 * Renders a computed diff into a <table> inside the result container.
 * Two modes: 'split' (side-by-side, 4 cols) and 'unified' (3 cols, GitHub-style).
 *
 * Syntax highlighting is applied per-cell after diff coloring is laid down,
 * so token spans live *inside* the line background and never fight with the
 * intra-line word highlights.
 *
 * IMPORTANT: we never use innerHTML with raw text. Diff/word segments are
 * built with createTextNode + element.appendChild; only highlight.js output
 * (which we trust as our vendored lib) goes through innerHTML.
 */

(function (global) {
  "use strict";

  const Render = {};

  Render.render = function (container, diff, opts) {
    opts = opts || {};
    const view = opts.view === "unified" ? "unified" : "split";
    const language = opts.language || "auto";

    container.className = "result";
    container.innerHTML = "";

    if (diff.rows.length === 0) {
      container.classList.add("no-diff");
      container.innerHTML =
        "<strong>Both inputs are empty</strong>Paste code into the panes above and click Compare.";
      return;
    }

    if (diff.hunks.length === 0) {
      container.classList.add("no-diff");
      container.innerHTML =
        "<strong>Files are identical</strong>No differences found.";
      return;
    }

    const table = document.createElement("table");
    table.className = "diff-table " + view;

    if (view === "split") {
      renderSplit(table, diff, language);
    } else {
      renderUnified(table, diff, language);
    }

    container.appendChild(table);

    if (diff.semantic && diff.semantic.moves && diff.semantic.moves.length) {
      const banner = document.createElement("div");
      banner.className = "move-banner";
      banner.textContent = `${diff.semantic.moves.length} moved block${diff.semantic.moves.length === 1 ? "" : "s"} detected`;
      container.insertBefore(banner, table);
    }
  };

  function isCosmetic(diff, hunkIdx) {
    return diff.semantic && diff.semantic.cosmeticHunks && diff.semantic.cosmeticHunks.has(hunkIdx);
  }

  function renameAt(diff, rowIdx) {
    if (!diff.semantic || !diff.semantic.renames) return null;
    return diff.semantic.renames.get(rowIdx) || null;
  }

  function mkCollapseRow(colSpan, changeCount, hunkIdx, expand) {
    const tr = document.createElement("tr");
    tr.className = "cosmetic-collapse";
    tr.dataset.cosmeticHunk = String(hunkIdx);
    const td = document.createElement("td");
    td.colSpan = colSpan;
    const btn = document.createElement("button");
    btn.className = "cosmetic-expand";
    btn.type = "button";
    btn.textContent = `▸ ${changeCount} cosmetic change${changeCount === 1 ? "" : "s"} hidden — click to reveal`;
    btn.addEventListener("click", () => expand(tr));
    td.appendChild(btn);
    tr.appendChild(td);
    return tr;
  }

  function hunkChangeCount(rows, hunk) {
    let n = 0;
    for (let i = hunk.start; i < hunk.end; i++) {
      if (rows[i].type !== "eq") n++;
    }
    return n;
  }

  // ---------- split view ----------

  function renderSplit(table, diff, language) {
    const tbody = document.createElement("tbody");
    for (let hi = 0; hi < diff.hunks.length; hi++) {
      const hunk = diff.hunks[hi];

      const headerTr = document.createElement("tr");
      headerTr.className = "hunk-header";
      const headerTd = document.createElement("td");
      headerTd.colSpan = 4;
      headerTd.textContent = hunk.header;
      headerTr.appendChild(headerTd);
      tbody.appendChild(headerTr);

      if (isCosmetic(diff, hi)) {
        const n = hunkChangeCount(diff.rows, hunk);
        const placeholder = mkCollapseRow(4, n, hi, (el) => {
          const frag = document.createDocumentFragment();
          renderSplitHunkRows(frag, diff, hunk, language);
          el.replaceWith(frag);
        });
        tbody.appendChild(placeholder);
        continue;
      }

      renderSplitHunkRows(tbody, diff, hunk, language);
    }
    table.appendChild(tbody);
  }

  function renderSplitHunkRows(container, diff, hunk, language) {
    for (let i = hunk.start; i < hunk.end; i++) {
      const r = diff.rows[i];
      const tr = document.createElement("tr");
      tr.dataset.rowIndex = String(i);

      const leftClass  = r.type === "del" || r.type === "mod" ? "line-del"
                      : r.type === "add" ? "line-empty" : "";
      const rightClass = r.type === "add" || r.type === "mod" ? "line-add"
                       : r.type === "del" ? "line-empty" : "";

      const rn = renameAt(diff, i);
      const lGutter = mkGutter(r.leftNo);
      const rGutter = mkGutter(r.rightNo);
      let lCode, rCode;
      if (rn) {
        lCode = mkRenamePillCell(r.leftText, rn, "old", language);
        rCode = mkRenamePillCell(r.rightText, rn, "new", language);
        tr.classList.add("row-rename");
      } else {
        lCode = mkCodeCell(r, "left", language);
        rCode = mkCodeCell(r, "right", language);
      }

      if (leftClass)  { lGutter.classList.add(leftClass);  lCode.classList.add(leftClass);  }
      if (rightClass) { rGutter.classList.add(rightClass); rCode.classList.add(rightClass); }

      tr.appendChild(lGutter);
      tr.appendChild(lCode);
      tr.appendChild(rGutter);
      tr.appendChild(rCode);
      container.appendChild(tr);
    }
  }

  // ---------- unified view ----------

  function renderUnified(table, diff, language) {
    const tbody = document.createElement("tbody");
    for (let hi = 0; hi < diff.hunks.length; hi++) {
      const hunk = diff.hunks[hi];

      const headerTr = document.createElement("tr");
      headerTr.className = "hunk-header";
      const headerTd = document.createElement("td");
      headerTd.colSpan = 3;
      headerTd.textContent = hunk.header;
      headerTr.appendChild(headerTd);
      tbody.appendChild(headerTr);

      if (isCosmetic(diff, hi)) {
        const n = hunkChangeCount(diff.rows, hunk);
        const placeholder = mkCollapseRow(3, n, hi, (el) => {
          const frag = document.createDocumentFragment();
          renderUnifiedHunkRows(frag, diff, hunk, language);
          el.replaceWith(frag);
        });
        tbody.appendChild(placeholder);
        continue;
      }

      renderUnifiedHunkRows(tbody, diff, hunk, language);
    }
    table.appendChild(tbody);
  }

  function renderUnifiedHunkRows(container, diff, hunk, language) {
    for (let i = hunk.start; i < hunk.end; i++) {
      const r = diff.rows[i];
      const rn = renameAt(diff, i);

      if (r.type === "eq") {
        container.appendChild(unifiedRow(r.leftNo, r.rightNo, " ", r.leftText, null, "", language, i));
      } else if (r.type === "del") {
        container.appendChild(unifiedRow(r.leftNo, null, "-", r.leftText, null, "line-del", language, i));
      } else if (r.type === "add") {
        container.appendChild(unifiedRow(null, r.rightNo, "+", r.rightText, null, "line-add", language, i));
      } else if (r.type === "mod") {
        if (rn) {
          container.appendChild(unifiedRenameRow(r.leftNo, r.rightNo, r.leftText, r.rightText, rn, language, i));
        } else {
          container.appendChild(unifiedRow(r.leftNo, null, "-", r.leftText, r.leftSegs, "line-del", language, i, "left"));
          container.appendChild(unifiedRow(null, r.rightNo, "+", r.rightText, r.rightSegs, "line-add", language, i, "right"));
        }
      }
    }
  }

  function unifiedRow(leftNo, rightNo, sign, text, segs, lineClass, language, rowIdx, side) {
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = String(rowIdx);

    const lGut = document.createElement("td");
    lGut.className = "gutter gutter-l";
    lGut.textContent = leftNo == null ? "" : String(leftNo);
    if (lineClass) lGut.classList.add(lineClass);

    const rGut = document.createElement("td");
    rGut.className = "gutter gutter-r";
    rGut.textContent = rightNo == null ? "" : String(rightNo);
    if (lineClass) rGut.classList.add(lineClass);

    const code = document.createElement("td");
    code.className = "code-cell";
    if (lineClass) code.classList.add(lineClass);

    // sign + content
    const signSpan = document.createElement("span");
    signSpan.textContent = sign;
    signSpan.style.opacity = "0.5";
    signSpan.style.userSelect = "none";
    signSpan.style.marginRight = "6px";
    code.appendChild(signSpan);

    if (segs) {
      // intra-line word diff present
      appendSegments(code, segs, language);
    } else {
      appendHighlighted(code, text, language);
    }

    tr.appendChild(lGut);
    tr.appendChild(rGut);
    tr.appendChild(code);
    return tr;
  }

  // ---------- shared cell builders ----------

  function mkGutter(num) {
    const td = document.createElement("td");
    td.className = "gutter";
    td.textContent = num == null ? "" : String(num);
    return td;
  }

  function mkCodeCell(row, side, language) {
    const td = document.createElement("td");
    td.className = "code-cell";

    const text = side === "left" ? row.leftText : row.rightText;
    const segs = side === "left" ? row.leftSegs : row.rightSegs;

    if (text == null) {
      // empty placeholder cell (no-op)
      return td;
    }

    if (row.type === "mod" && segs) {
      appendSegments(td, segs, language);
    } else {
      appendHighlighted(td, text, language);
    }
    return td;
  }

  // Append intra-line word-diff segments. Equal segments are syntax-highlighted;
  // add/del segments are wrapped in highlighted spans.
  function appendSegments(parent, segs, language) {
    for (const seg of segs) {
      if (seg.op === "eq") {
        appendHighlighted(parent, seg.text, language);
      } else {
        const span = document.createElement("span");
        span.className = seg.op === "add" ? "word-add" : "word-del";
        appendHighlighted(span, seg.text, language);
        parent.appendChild(span);
      }
    }
  }

  // Run hljs over `text` and append the result to `parent`. Falls back to
  // a plain text node if hljs doesn't know the language (or 'plaintext').
  function appendHighlighted(parent, text, language) {
    if (!text) {
      // preserve empty-line height? we render a zero-width space to keep the row tall
      parent.appendChild(document.createTextNode(""));
      return;
    }
    if (language === "plaintext" || !global.hljs) {
      parent.appendChild(document.createTextNode(text));
      return;
    }

    try {
      let result;
      if (language === "auto") {
        result = global.hljs.highlightAuto(text);
      } else if (global.hljs.getLanguage(language)) {
        result = global.hljs.highlight(text, { language, ignoreIllegals: true });
      } else {
        parent.appendChild(document.createTextNode(text));
        return;
      }
      // hljs output is sanitized by the lib itself; safe to inject.
      const span = document.createElement("span");
      span.className = "hljs";
      span.innerHTML = result.value;
      parent.appendChild(span);
    } catch (e) {
      parent.appendChild(document.createTextNode(text));
    }
  }

  // ---------- semantic cell builders ----------

  function mkRenamePillCell(text, rename, side, language) {
    const td = document.createElement("td");
    td.className = "code-cell code-cell--rename";
    if (text == null) return td;

    const pillTok = side === "old" ? rename.old : rename.new;
    const otherTok = side === "old" ? rename.new : rename.old;
    const idx = indexOfToken(text, pillTok);
    if (idx < 0) {
      appendHighlighted(td, text, language);
      return td;
    }

    if (idx > 0) appendHighlighted(td, text.slice(0, idx), language);

    const pill = document.createElement("span");
    pill.className = side === "old" ? "rename-pill rename-pill--old" : "rename-pill rename-pill--new";
    const current = document.createElement("span");
    current.className = "rename-pill__cur";
    current.textContent = pillTok;
    const arrow = document.createElement("span");
    arrow.className = "rename-pill__arrow";
    arrow.textContent = side === "old" ? " → " : " ← ";
    const other = document.createElement("span");
    other.className = "rename-pill__other";
    other.textContent = otherTok;
    pill.appendChild(current);
    pill.appendChild(arrow);
    pill.appendChild(other);
    td.appendChild(pill);

    const tail = text.slice(idx + pillTok.length);
    if (tail) appendHighlighted(td, tail, language);
    return td;
  }

  function unifiedRenameRow(leftNo, rightNo, leftText, rightText, rename, language, rowIdx) {
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = String(rowIdx);
    tr.classList.add("row-rename");

    const lGut = document.createElement("td");
    lGut.className = "gutter gutter-l";
    lGut.textContent = leftNo == null ? "" : String(leftNo);
    const rGut = document.createElement("td");
    rGut.className = "gutter gutter-r";
    rGut.textContent = rightNo == null ? "" : String(rightNo);

    const code = document.createElement("td");
    code.className = "code-cell code-cell--rename";

    const sign = document.createElement("span");
    sign.textContent = "~";
    sign.style.opacity = "0.5";
    sign.style.userSelect = "none";
    sign.style.marginRight = "6px";
    code.appendChild(sign);

    const idx = indexOfToken(rightText, rename.new);
    if (idx < 0) {
      appendHighlighted(code, rightText, language);
    } else {
      if (idx > 0) appendHighlighted(code, rightText.slice(0, idx), language);
      const pill = document.createElement("span");
      pill.className = "rename-pill rename-pill--mod";
      const a = document.createElement("span");
      a.className = "rename-pill__old";
      a.textContent = rename.old;
      const arrow = document.createElement("span");
      arrow.className = "rename-pill__arrow";
      arrow.textContent = " → ";
      const b = document.createElement("span");
      b.className = "rename-pill__new";
      b.textContent = rename.new;
      pill.appendChild(a);
      pill.appendChild(arrow);
      pill.appendChild(b);
      code.appendChild(pill);
      const tail = rightText.slice(idx + rename.new.length);
      if (tail) appendHighlighted(code, tail, language);
    }

    tr.appendChild(lGut);
    tr.appendChild(rGut);
    tr.appendChild(code);
    return tr;
  }

  function indexOfToken(text, tok) {
    if (!text || !tok) return -1;
    const re = new RegExp(`\\b${escapeReg(tok)}\\b`);
    const m = re.exec(text);
    return m ? m.index : text.indexOf(tok);
  }

  function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  global.DiffLabRender = Render;
})(window);
