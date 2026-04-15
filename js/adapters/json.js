/* DiffLab — JSON adapter
 *
 * Deep structural diff with key-path output. Renders a merged tree where
 * every differing node carries a status marker (+/−/~) and — for primitive
 * changes — the old and new value shown inline.
 *
 * Options:
 *   - sortKeys:     render-time alphabetical ordering of object keys
 *   - arrayKey:     when both sides are arrays of objects, match elements by
 *                   this key's value instead of by index
 */

(function (global) {
  "use strict";

  const opts = { sortKeys: false, arrayKey: "" };

  function toText(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.text === "string") return input.text;
    return "";
  }

  const jsonAdapter = {
    id: "json",
    label: "JSON",
    inputMode: "text",

    accepts(mime, ext) {
      if (mime === "application/json") return true;
      if (ext && ["json", "jsonc", "geojson"].includes(String(ext).toLowerCase())) return true;
      return false;
    },

    buildOptions(container, onChange) {
      container.innerHTML = "";
      const sort = document.createElement("label");
      sort.innerHTML = `<input type="checkbox" ${opts.sortKeys ? "checked" : ""} /> Sort keys`;
      sort.querySelector("input").addEventListener("change", (e) => {
        opts.sortKeys = e.target.checked;
        onChange();
      });

      const keyWrap = document.createElement("label");
      keyWrap.innerHTML = `Array match key <input type="text" value="${escapeAttr(opts.arrayKey)}" placeholder="(index)" size="10" />`;
      keyWrap.querySelector("input").addEventListener("change", (e) => {
        opts.arrayKey = e.target.value.trim();
        onChange();
      });

      container.appendChild(sort);
      container.appendChild(keyWrap);
    },

    parse(input) {
      const raw = toText(input);
      if (raw.trim() === "") return { ok: true, value: null, empty: true };
      try {
        return { ok: true, value: JSON.parse(raw) };
      } catch (e) {
        return { ok: false, error: e.message, raw };
      }
    },

    diff(left, right) {
      if (!left.ok || !right.ok) {
        return { kind: "parse-error", left, right, stats: emptyStats(), hunks: [] };
      }
      const tree = diffNode([], left.value, right.value);
      const stats = computeStats(tree);
      const hunks = collectHunks(tree);
      return { kind: "tree", tree, stats, hunks };
    },

    render(result, container) {
      container.className = "result";
      container.innerHTML = "";

      if (result.kind === "parse-error") {
        container.appendChild(renderParseError(result));
        return;
      }

      const root = document.createElement("div");
      root.className = "json-tree";
      if (result.stats.hunkCount === 0) {
        root.innerHTML = "<strong>JSON values are identical.</strong>";
        container.appendChild(root);
        return;
      }
      const ul = document.createElement("ul");
      renderTree(ul, result.tree, 0);
      root.appendChild(ul);
      container.appendChild(root);
    },

    toPatch(result) {
      if (result.kind !== "tree") return null;
      const lines = ["--- original.json", "+++ modified.json"];
      walkFlat(result.tree, (node) => {
        if (node.status === "eq" || node.status === "container") return;
        const p = formatPath(node.path);
        if (node.status === "add") lines.push(`+ ${p} = ${stringify(node.newValue)}`);
        else if (node.status === "del") lines.push(`- ${p} = ${stringify(node.oldValue)}`);
        else if (node.status === "mod") {
          lines.push(`- ${p} = ${stringify(node.oldValue)}`);
          lines.push(`+ ${p} = ${stringify(node.newValue)}`);
        }
      });
      return lines.join("\n") + "\n";
    }
  };

  // ---------- diff ----------

  function diffNode(path, a, b) {
    if (a === undefined && b !== undefined) {
      return { path, status: "add", kind: kindOf(b), newValue: b };
    }
    if (b === undefined && a !== undefined) {
      return { path, status: "del", kind: kindOf(a), oldValue: a };
    }
    const ka = kindOf(a);
    const kb = kindOf(b);
    if (ka !== kb) {
      return { path, status: "mod", kind: "primitive", oldValue: a, newValue: b };
    }
    if (ka === "object") {
      const keys = unionKeys(a, b);
      const children = keys.map(k => diffNode(path.concat(k), a[k], b[k]));
      const childHasChange = children.some(c => c.status !== "eq" && c.status !== "container");
      return {
        path,
        status: childHasChange ? "container" : "eq",
        kind: "object",
        children
      };
    }
    if (ka === "array") {
      const children = diffArray(path, a, b);
      const childHasChange = children.some(c => c.status !== "eq" && c.status !== "container");
      return {
        path,
        status: childHasChange ? "container" : "eq",
        kind: "array",
        children
      };
    }
    if (deepEqualPrim(a, b)) {
      return { path, status: "eq", kind: "primitive", oldValue: a, newValue: b };
    }
    return { path, status: "mod", kind: "primitive", oldValue: a, newValue: b };
  }

  function diffArray(path, a, b) {
    const key = opts.arrayKey;
    if (key && a.every(isObj) && b.every(isObj)) {
      const byKeyA = new Map();
      const byKeyB = new Map();
      for (const item of a) byKeyA.set(item[key], item);
      for (const item of b) byKeyB.set(item[key], item);
      const keys = [];
      const seen = new Set();
      for (const item of a) {
        if (!seen.has(item[key])) { keys.push(item[key]); seen.add(item[key]); }
      }
      for (const item of b) {
        if (!seen.has(item[key])) { keys.push(item[key]); seen.add(item[key]); }
      }
      return keys.map(k => diffNode(path.concat(`[${key}=${formatScalar(k)}]`), byKeyA.get(k), byKeyB.get(k)));
    }
    const len = Math.max(a.length, b.length);
    const out = [];
    for (let i = 0; i < len; i++) {
      out.push(diffNode(path.concat(i), a[i], b[i]));
    }
    return out;
  }

  // ---------- render ----------

  function renderTree(parentUl, node, hunkCounter) {
    const ctx = { hunkIdx: 0 };
    renderNode(parentUl, node, ctx, true);
  }

  function renderNode(parentUl, node, ctx, isRoot) {
    if (node.kind === "object" || node.kind === "array") {
      const keys = node.children.map(c => lastSegment(c.path));
      const bracketOpen = node.kind === "array" ? "[" : "{";
      const bracketClose = node.kind === "array" ? "]" : "}";

      if (!isRoot) {
        const li = document.createElement("li");
        applyStatusClass(li, node.status);
        const keyText = lastSegment(node.path);
        appendKeyLabel(li, keyText);
        li.appendChild(textNode(bracketOpen));
        parentUl.appendChild(li);
      }

      const ul = document.createElement("ul");
      const ordered = node.kind === "object" && opts.sortKeys
        ? [...node.children].sort((x, y) => String(lastSegment(x.path)).localeCompare(String(lastSegment(y.path))))
        : node.children;

      for (const c of ordered) {
        if (c.kind === "object" || c.kind === "array") {
          renderNode(ul, c, ctx, false);
        } else {
          renderLeaf(ul, c, ctx);
        }
      }

      if (!isRoot) {
        parentUl.appendChild(ul);
        const closeLi = document.createElement("li");
        closeLi.className = "json-punct";
        closeLi.textContent = bracketClose;
        parentUl.appendChild(closeLi);
      } else {
        parentUl.appendChild(ul);
      }
      return;
    }

    renderLeaf(parentUl, node, ctx);
  }

  function renderLeaf(parentUl, node, ctx) {
    const li = document.createElement("li");
    applyStatusClass(li, node.status);
    if (node.status !== "eq") {
      li.dataset.hunkIdx = String(ctx.hunkIdx++);
    }
    const keyText = lastSegment(node.path);
    if (keyText !== "" && keyText !== undefined && keyText !== null) {
      appendKeyLabel(li, keyText);
    }
    if (node.status === "mod") {
      appendValueSpan(li, node.oldValue, "json-old");
      li.appendChild(textNode(" → "));
      appendValueSpan(li, node.newValue, "json-new");
    } else if (node.status === "add") {
      appendValueSpan(li, node.newValue, null);
    } else if (node.status === "del") {
      appendValueSpan(li, node.oldValue, null);
    } else {
      appendValueSpan(li, node.newValue != null ? node.newValue : node.oldValue, null);
    }
    parentUl.appendChild(li);
  }

  function appendKeyLabel(parent, keyText) {
    const k = document.createElement("span");
    k.className = "json-key";
    k.textContent = String(keyText);
    parent.appendChild(k);
    parent.appendChild(textNode(": "));
  }

  function appendValueSpan(parent, value, extraClass) {
    const span = document.createElement("span");
    span.className = valueClass(value) + (extraClass ? " " + extraClass : "");
    span.textContent = formatScalar(value);
    parent.appendChild(span);
  }

  function valueClass(v) {
    if (v === null) return "json-null";
    const t = typeof v;
    if (t === "string") return "json-str";
    if (t === "number") return "json-num";
    if (t === "boolean") return "json-bool";
    return "json-punct";
  }

  function applyStatusClass(el, status) {
    if (status === "add") el.classList.add("json-row-add");
    else if (status === "del") el.classList.add("json-row-del");
    else if (status === "mod") el.classList.add("json-row-mod");
    else if (status === "container") el.classList.add("json-row-container");
  }

  function renderParseError(result) {
    const div = document.createElement("div");
    div.className = "json-parse-error";
    const msgs = [];
    if (!result.left.ok) msgs.push(`Left side: ${result.left.error}`);
    if (!result.right.ok) msgs.push(`Right side: ${result.right.error}`);
    div.textContent = "JSON parse error:\n" + msgs.join("\n");
    return div;
  }

  // ---------- stats + hunks ----------

  function computeStats(tree) {
    let additions = 0, deletions = 0, mods = 0;
    walkFlat(tree, (n) => {
      if (n.kind === "object" || n.kind === "array") return;
      if (n.status === "add") additions++;
      else if (n.status === "del") deletions++;
      else if (n.status === "mod") mods++;
    });
    return {
      additions: additions + mods,
      deletions: deletions + mods,
      hunkCount: additions + deletions + mods
    };
  }

  function collectHunks(tree) {
    const hunks = [];
    walkFlat(tree, (n) => {
      if (n.status === "add" || n.status === "del" || n.status === "mod") {
        hunks.push({ path: n.path });
      }
    });
    return hunks;
  }

  function walkFlat(node, visit) {
    if (!node) return;
    visit(node);
    if (node.children) for (const c of node.children) walkFlat(c, visit);
  }

  // ---------- helpers ----------

  function emptyStats() { return { additions: 0, deletions: 0, hunkCount: 0 }; }
  function kindOf(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    if (typeof v === "object") return "object";
    return "primitive";
  }
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function deepEqualPrim(a, b) { return a === b || (Number.isNaN(a) && Number.isNaN(b)); }
  function unionKeys(a, b) {
    const set = new Set();
    for (const k of Object.keys(a)) set.add(k);
    for (const k of Object.keys(b)) set.add(k);
    return Array.from(set);
  }
  function lastSegment(path) {
    return path.length === 0 ? "" : path[path.length - 1];
  }
  function formatScalar(v) {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (typeof v === "string") return JSON.stringify(v);
    return String(v);
  }
  function stringify(v) {
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }
  function formatPath(path) {
    if (path.length === 0) return "$";
    return "$" + path.map(seg => {
      if (typeof seg === "number") return `[${seg}]`;
      if (typeof seg === "string" && seg.startsWith("[")) return seg;
      return `.${seg}`;
    }).join("");
  }
  function textNode(s) { return document.createTextNode(s); }
  function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }

  global.DiffLab.adapters.register(jsonAdapter);
})(window);
