/* DiffLab — CSV adapter
 *
 * Parses CSV (RFC 4180, with quoted fields, embedded newlines, and "" escapes)
 * using a small inline parser — PapaParse would be the next step if users ask
 * for streaming or delimiter auto-detection. Row matching is either:
 *   - index-based (default), or
 *   - key-based (user names a column; rows are matched by the value of that column)
 *
 * Renders a table with per-row add/del/mod marks and per-cell change highlights.
 */

(function (global) {
  "use strict";

  const opts = { hasHeader: true, keyColumn: "", delimiter: "," };

  function toText(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.text === "string") return input.text;
    return "";
  }

  const csvAdapter = {
    id: "csv",
    label: "CSV",
    inputMode: "text",

    accepts(mime, ext) {
      if (mime === "text/csv") return true;
      if (ext && ["csv", "tsv"].includes(String(ext).toLowerCase())) return true;
      return false;
    },

    buildOptions(container, onChange) {
      container.innerHTML = "";
      const head = document.createElement("label");
      head.innerHTML = `<input type="checkbox" ${opts.hasHeader ? "checked" : ""} /> Has header row`;
      head.querySelector("input").addEventListener("change", (e) => {
        opts.hasHeader = e.target.checked;
        onChange();
      });
      const key = document.createElement("label");
      key.innerHTML = `Match by column <input type="text" value="${escapeAttr(opts.keyColumn)}" placeholder="(by row index)" size="10" />`;
      key.querySelector("input").addEventListener("change", (e) => {
        opts.keyColumn = e.target.value.trim();
        onChange();
      });
      const delim = document.createElement("label");
      delim.innerHTML = `Delimiter
        <select>
          <option value="," ${opts.delimiter === "," ? "selected" : ""}>,</option>
          <option value="\t" ${opts.delimiter === "\t" ? "selected" : ""}>tab</option>
          <option value=";" ${opts.delimiter === ";" ? "selected" : ""}>;</option>
          <option value="|" ${opts.delimiter === "|" ? "selected" : ""}>|</option>
        </select>`;
      delim.querySelector("select").addEventListener("change", (e) => {
        opts.delimiter = e.target.value;
        onChange();
      });
      container.appendChild(head);
      container.appendChild(key);
      container.appendChild(delim);
    },

    parse(input) {
      const raw = toText(input);
      return parseCSV(raw, opts.delimiter);
    },

    diff(leftRows, rightRows) {
      const header = resolveHeader(leftRows, rightRows);
      const lBody = opts.hasHeader ? leftRows.slice(1) : leftRows;
      const rBody = opts.hasHeader ? rightRows.slice(1) : rightRows;

      const keyIdx = opts.hasHeader && opts.keyColumn
        ? header.indexOf(opts.keyColumn)
        : -1;

      const rows = keyIdx >= 0
        ? diffByKey(lBody, rBody, keyIdx)
        : diffByIndex(lBody, rBody);

      let additions = 0, deletions = 0, mods = 0;
      for (const r of rows) {
        if (r.status === "add") additions++;
        else if (r.status === "del") deletions++;
        else if (r.status === "mod") mods++;
      }

      return {
        header,
        rows,
        stats: {
          additions: additions + mods,
          deletions: deletions + mods,
          hunkCount: additions + deletions + mods
        },
        hunks: rows.filter(r => r.status !== "eq").map(() => ({}))
      };
    },

    render(result, container) {
      container.className = "result";
      container.innerHTML = "";

      if (result.stats.hunkCount === 0) {
        const msg = document.createElement("div");
        msg.className = "json-tree";
        msg.innerHTML = "<strong>CSV rows are identical.</strong>";
        container.appendChild(msg);
        return;
      }

      const wrap = document.createElement("div");
      wrap.className = "csv-diff-wrap";
      const table = document.createElement("table");
      table.className = "csv-diff-table";

      const thead = document.createElement("thead");
      const headTr = document.createElement("tr");
      const markTh = document.createElement("th");
      markTh.textContent = "";
      headTr.appendChild(markTh);
      for (const h of result.header) {
        const th = document.createElement("th");
        th.textContent = h;
        headTr.appendChild(th);
      }
      thead.appendChild(headTr);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      let hunkIdx = 0;
      for (const row of result.rows) {
        const tr = document.createElement("tr");
        const markTd = document.createElement("td");
        if (row.status === "add") { tr.classList.add("csv-row-add"); markTd.textContent = "+"; }
        else if (row.status === "del") { tr.classList.add("csv-row-del"); markTd.textContent = "−"; }
        else if (row.status === "mod") { tr.classList.add("csv-row-mod"); markTd.textContent = "~"; }
        else markTd.textContent = " ";
        tr.appendChild(markTd);

        const cells = row.status === "del" ? row.oldCells : row.newCells;
        const width = Math.max(result.header.length, cells ? cells.length : 0);
        for (let c = 0; c < width; c++) {
          const td = document.createElement("td");
          const newVal = row.newCells ? (row.newCells[c] != null ? row.newCells[c] : "") : "";
          const oldVal = row.oldCells ? (row.oldCells[c] != null ? row.oldCells[c] : "") : "";
          if (row.status === "mod" && newVal !== oldVal) {
            const newSpan = document.createElement("span");
            newSpan.className = "csv-cell-changed";
            newSpan.textContent = newVal;
            const oldSpan = document.createElement("span");
            oldSpan.className = "csv-cell-old";
            oldSpan.textContent = oldVal;
            td.appendChild(newSpan);
            td.appendChild(oldSpan);
          } else if (row.status === "add") {
            td.textContent = newVal;
          } else if (row.status === "del") {
            td.textContent = oldVal;
          } else {
            td.textContent = newVal || oldVal;
          }
          tr.appendChild(td);
        }

        if (row.status !== "eq") tr.dataset.hunkIdx = String(hunkIdx++);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
    },

    toPatch(result) {
      const lines = ["--- original.csv", "+++ modified.csv"];
      if (opts.hasHeader) lines.push(`  ${result.header.join(opts.delimiter)}`);
      for (const r of result.rows) {
        if (r.status === "eq") continue;
        if (r.status === "add") lines.push(`+ ${(r.newCells || []).join(opts.delimiter)}`);
        else if (r.status === "del") lines.push(`- ${(r.oldCells || []).join(opts.delimiter)}`);
        else if (r.status === "mod") {
          lines.push(`- ${(r.oldCells || []).join(opts.delimiter)}`);
          lines.push(`+ ${(r.newCells || []).join(opts.delimiter)}`);
        }
      }
      return lines.join("\n") + "\n";
    }
  };

  // ---------- diff strategies ----------

  function diffByIndex(a, b) {
    const len = Math.max(a.length, b.length);
    const out = [];
    for (let i = 0; i < len; i++) {
      const ao = a[i];
      const bo = b[i];
      if (ao && !bo) out.push({ status: "del", oldCells: ao });
      else if (!ao && bo) out.push({ status: "add", newCells: bo });
      else if (rowsEqual(ao, bo)) out.push({ status: "eq", newCells: bo, oldCells: ao });
      else out.push({ status: "mod", oldCells: ao, newCells: bo });
    }
    return out;
  }

  function diffByKey(a, b, keyIdx) {
    const byKeyA = new Map();
    const byKeyB = new Map();
    for (const r of a) byKeyA.set(r[keyIdx], r);
    for (const r of b) byKeyB.set(r[keyIdx], r);

    const seen = new Set();
    const keys = [];
    for (const r of a) if (!seen.has(r[keyIdx])) { keys.push(r[keyIdx]); seen.add(r[keyIdx]); }
    for (const r of b) if (!seen.has(r[keyIdx])) { keys.push(r[keyIdx]); seen.add(r[keyIdx]); }

    const out = [];
    for (const k of keys) {
      const ao = byKeyA.get(k);
      const bo = byKeyB.get(k);
      if (ao && !bo) out.push({ status: "del", oldCells: ao });
      else if (!ao && bo) out.push({ status: "add", newCells: bo });
      else if (rowsEqual(ao, bo)) out.push({ status: "eq", newCells: bo, oldCells: ao });
      else out.push({ status: "mod", oldCells: ao, newCells: bo });
    }
    return out;
  }

  function rowsEqual(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function resolveHeader(leftRows, rightRows) {
    if (opts.hasHeader) {
      const l = leftRows[0] || [];
      const r = rightRows[0] || [];
      const maxLen = Math.max(l.length, r.length);
      const out = [];
      for (let i = 0; i < maxLen; i++) out.push(r[i] || l[i] || `col${i + 1}`);
      return out;
    }
    const maxLen = Math.max(
      leftRows.reduce((m, r) => Math.max(m, r.length), 0),
      rightRows.reduce((m, r) => Math.max(m, r.length), 0)
    );
    const out = [];
    for (let i = 0; i < maxLen; i++) out.push(`col${i + 1}`);
    return out;
  }

  // ---------- RFC 4180 CSV parser ----------

  function parseCSV(text, delimiter) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    let i = 0;
    const len = text.length;

    while (i < len) {
      const c = text[i];

      if (inQuotes) {
        if (c === "\"") {
          if (text[i + 1] === "\"") { field += "\""; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }

      if (c === "\"") { inQuotes = true; i++; continue; }
      if (c === delimiter) { row.push(field); field = ""; i++; continue; }
      if (c === "\r") {
        row.push(field); field = "";
        if (text[i + 1] === "\n") i += 2; else i++;
        rows.push(row); row = [];
        continue;
      }
      if (c === "\n") {
        row.push(field); field = "";
        rows.push(row); row = [];
        i++; continue;
      }
      field += c; i++;
    }

    if (field !== "" || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }

  global.DiffLab.adapters.register(csvAdapter);
})(window);
