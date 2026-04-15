/* DiffLab — XML / HTML adapter
 *
 * Parses both sides with DOMParser, walks the DOM trees in lockstep,
 * and renders a merged tree with add/del/mod annotations. Children are
 * matched in tag+index order — structural reordering shows up as
 * replace, which is the tradeoff we accept for a small adapter.
 */

(function (global) {
  "use strict";

  const opts = { parseAs: "xml", ignoreWs: true };

  function toText(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.text === "string") return input.text;
    return "";
  }

  const xmlAdapter = {
    id: "xml",
    label: "XML / HTML",
    inputMode: "text",

    accepts(mime, ext) {
      if (mime && /^(application|text)\/(xml|html|svg\+xml)/.test(mime)) return true;
      if (ext && ["xml", "html", "htm", "svg", "xhtml"].includes(String(ext).toLowerCase())) return true;
      return false;
    },

    buildOptions(container, onChange) {
      container.innerHTML = "";
      const parseAs = document.createElement("label");
      parseAs.innerHTML = `Parse as
        <select>
          <option value="xml" ${opts.parseAs === "xml" ? "selected" : ""}>XML</option>
          <option value="html" ${opts.parseAs === "html" ? "selected" : ""}>HTML</option>
        </select>`;
      parseAs.querySelector("select").addEventListener("change", (e) => {
        opts.parseAs = e.target.value;
        onChange();
      });

      const ws = document.createElement("label");
      ws.innerHTML = `<input type="checkbox" ${opts.ignoreWs ? "checked" : ""} /> Ignore whitespace nodes`;
      ws.querySelector("input").addEventListener("change", (e) => {
        opts.ignoreWs = e.target.checked;
        onChange();
      });

      container.appendChild(parseAs);
      container.appendChild(ws);
    },

    parse(input) {
      const raw = toText(input);
      if (raw.trim() === "") return { ok: true, root: null, empty: true };
      const mime = opts.parseAs === "html" ? "text/html" : "application/xml";
      const doc = new DOMParser().parseFromString(raw, mime);
      const err = doc.querySelector("parsererror");
      if (err) return { ok: false, error: err.textContent };
      const root = opts.parseAs === "html"
        ? (doc.body || doc.documentElement)
        : doc.documentElement;
      return { ok: true, root };
    },

    diff(left, right) {
      if (!left.ok || !right.ok) {
        return { kind: "parse-error", left, right, stats: emptyStats(), hunks: [] };
      }
      const tree = diffElem(left.root, right.root);
      const stats = computeStats(tree);
      const hunks = collectHunks(tree);
      return { kind: "tree", tree, stats, hunks };
    },

    render(result, container) {
      container.className = "result";
      container.innerHTML = "";

      if (result.kind === "parse-error") {
        const div = document.createElement("div");
        div.className = "json-parse-error";
        const msgs = [];
        if (!result.left.ok) msgs.push(`Left side: ${result.left.error}`);
        if (!result.right.ok) msgs.push(`Right side: ${result.right.error}`);
        div.textContent = "Parse error:\n" + msgs.join("\n");
        container.appendChild(div);
        return;
      }

      const root = document.createElement("div");
      root.className = "xml-tree";
      if (result.stats.hunkCount === 0) {
        root.innerHTML = "<strong>Documents are structurally identical.</strong>";
        container.appendChild(root);
        return;
      }
      const ul = document.createElement("ul");
      const ctx = { hunkIdx: 0 };
      renderNode(ul, result.tree, ctx);
      root.appendChild(ul);
      container.appendChild(root);
    }
  };

  // ---------- diff ----------

  function diffElem(a, b) {
    if (!a && !b) return null;
    if (!a) return { status: "add", kind: "elem", node: cloneMeta(b) };
    if (!b) return { status: "del", kind: "elem", node: cloneMeta(a) };

    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) {
      return { status: "mod", kind: "elem", oldNode: cloneMeta(a), newNode: cloneMeta(b) };
    }

    if (a.nodeType === 3) {
      const av = a.nodeValue, bv = b.nodeValue;
      if (opts.ignoreWs && av.trim() === "" && bv.trim() === "") {
        return { status: "eq", kind: "text", value: av };
      }
      if (av === bv) return { status: "eq", kind: "text", value: av };
      return { status: "mod", kind: "text", oldValue: av, newValue: bv };
    }

    if (a.nodeType !== 1) {
      return { status: "eq", kind: "other", node: cloneMeta(a) };
    }

    const attrDiff = diffAttrs(a, b);
    const childDiff = diffChildren(a, b);

    const hasChange = attrDiff.some(x => x.status !== "eq") || childDiff.some(x => x && x.status !== "eq" && x.status !== "container");
    return {
      status: hasChange ? "container" : "eq",
      kind: "elem",
      tag: a.nodeName,
      attrs: attrDiff,
      children: childDiff
    };
  }

  function diffAttrs(a, b) {
    const out = [];
    const aa = attrMap(a);
    const bb = attrMap(b);
    const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
    for (const k of keys) {
      if (!(k in aa)) out.push({ status: "add", name: k, newValue: bb[k] });
      else if (!(k in bb)) out.push({ status: "del", name: k, oldValue: aa[k] });
      else if (aa[k] !== bb[k]) out.push({ status: "mod", name: k, oldValue: aa[k], newValue: bb[k] });
      else out.push({ status: "eq", name: k, value: aa[k] });
    }
    return out;
  }

  function diffChildren(a, b) {
    const ac = filterChildren(a);
    const bc = filterChildren(b);
    const len = Math.max(ac.length, bc.length);
    const out = [];
    for (let i = 0; i < len; i++) {
      out.push(diffElem(ac[i], bc[i]));
    }
    return out;
  }

  function filterChildren(node) {
    const arr = Array.from(node.childNodes);
    if (!opts.ignoreWs) return arr;
    return arr.filter(n => !(n.nodeType === 3 && n.nodeValue.trim() === ""));
  }

  function attrMap(node) {
    const out = {};
    if (!node.attributes) return out;
    for (const a of node.attributes) out[a.name] = a.value;
    return out;
  }

  function cloneMeta(node) {
    if (!node) return null;
    if (node.nodeType === 3) return { type: 3, value: node.nodeValue };
    if (node.nodeType === 1) return { type: 1, tag: node.nodeName, attrs: attrMap(node), text: node.textContent };
    return { type: node.nodeType, value: node.nodeValue };
  }

  // ---------- render ----------

  function renderNode(ul, node, ctx) {
    if (!node) return;

    if (node.kind === "text") {
      if (node.status === "eq") return;
      const li = document.createElement("li");
      applyStatusClass(li, node.status);
      li.dataset.hunkIdx = String(ctx.hunkIdx++);
      if (node.status === "mod") {
        const oldSpan = document.createElement("span");
        oldSpan.className = "xml-val json-old";
        oldSpan.textContent = JSON.stringify(node.oldValue);
        const newSpan = document.createElement("span");
        newSpan.className = "xml-val json-new";
        newSpan.textContent = JSON.stringify(node.newValue);
        li.appendChild(document.createTextNode("text: "));
        li.appendChild(oldSpan);
        li.appendChild(document.createTextNode(" → "));
        li.appendChild(newSpan);
      }
      ul.appendChild(li);
      return;
    }

    if (node.kind !== "elem") return;

    const li = document.createElement("li");
    applyStatusClass(li, node.status);
    if (node.status !== "eq" && node.status !== "container") {
      li.dataset.hunkIdx = String(ctx.hunkIdx++);
    }

    if (node.status === "add" || node.status === "del") {
      const meta = node.node;
      li.appendChild(tagSpan(meta.tag));
      if (meta.attrs) {
        for (const [k, v] of Object.entries(meta.attrs)) li.appendChild(attrSpan(k, v));
      }
      ul.appendChild(li);
      return;
    }

    if (node.status === "mod") {
      li.appendChild(document.createTextNode(`<${node.oldNode ? node.oldNode.tag : "?"}> → <${node.newNode ? node.newNode.tag : "?"}>`));
      ul.appendChild(li);
      return;
    }

    li.appendChild(tagSpan(node.tag));
    for (const a of node.attrs) {
      li.appendChild(renderAttrDiff(a, ctx));
    }
    ul.appendChild(li);

    const changedChildren = node.children.filter(c => c && c.status !== "eq");
    if (changedChildren.length) {
      const child = document.createElement("ul");
      for (const c of node.children) {
        if (!c) continue;
        if (c.status === "eq") continue;
        renderNode(child, c, ctx);
      }
      ul.appendChild(child);
    }
  }

  function tagSpan(name) {
    const s = document.createElement("span");
    s.className = "xml-tag";
    s.textContent = String(name).toLowerCase();
    return s;
  }

  function attrSpan(name, value) {
    const wrap = document.createElement("span");
    wrap.appendChild(document.createTextNode(" "));
    const n = document.createElement("span");
    n.className = "xml-attr";
    n.textContent = name;
    wrap.appendChild(n);
    wrap.appendChild(document.createTextNode("="));
    const v = document.createElement("span");
    v.className = "xml-val";
    v.textContent = JSON.stringify(value);
    wrap.appendChild(v);
    return wrap;
  }

  function renderAttrDiff(attr, ctx) {
    if (attr.status === "eq") return attrSpan(attr.name, attr.value);
    const wrap = document.createElement("span");
    wrap.appendChild(document.createTextNode(" "));
    const n = document.createElement("span");
    n.className = "xml-attr";
    n.textContent = attr.name;
    wrap.appendChild(n);
    wrap.appendChild(document.createTextNode("="));
    if (attr.status === "add") {
      const v = document.createElement("span");
      v.className = "xml-val json-new";
      v.textContent = JSON.stringify(attr.newValue);
      wrap.appendChild(v);
    } else if (attr.status === "del") {
      const v = document.createElement("span");
      v.className = "xml-val json-old";
      v.textContent = JSON.stringify(attr.oldValue);
      wrap.appendChild(v);
    } else if (attr.status === "mod") {
      const o = document.createElement("span");
      o.className = "xml-val json-old";
      o.textContent = JSON.stringify(attr.oldValue);
      const ne = document.createElement("span");
      ne.className = "xml-val json-new";
      ne.textContent = JSON.stringify(attr.newValue);
      wrap.appendChild(o);
      wrap.appendChild(document.createTextNode(" → "));
      wrap.appendChild(ne);
    }
    wrap.dataset.hunkIdx = String(ctx.hunkIdx++);
    return wrap;
  }

  function applyStatusClass(el, status) {
    if (status === "add") el.classList.add("xml-row-add");
    else if (status === "del") el.classList.add("xml-row-del");
    else if (status === "mod") el.classList.add("xml-row-mod");
  }

  // ---------- stats + hunks ----------

  function computeStats(tree) {
    let additions = 0, deletions = 0, mods = 0;
    walk(tree, (n) => {
      if (!n) return;
      if (n.status === "add") additions++;
      else if (n.status === "del") deletions++;
      else if (n.status === "mod") mods++;
      if (n.attrs) for (const a of n.attrs) {
        if (a.status === "add") additions++;
        else if (a.status === "del") deletions++;
        else if (a.status === "mod") mods++;
      }
    });
    return { additions: additions + mods, deletions: deletions + mods, hunkCount: additions + deletions + mods };
  }

  function collectHunks(tree) {
    const out = [];
    walk(tree, (n) => {
      if (!n) return;
      if (n.status === "add" || n.status === "del" || n.status === "mod") out.push({});
      if (n.attrs) for (const a of n.attrs) {
        if (a.status && a.status !== "eq") out.push({});
      }
    });
    return out;
  }

  function walk(node, visit) {
    if (!node) return;
    visit(node);
    if (node.children) for (const c of node.children) walk(c, visit);
  }

  function emptyStats() { return { additions: 0, deletions: 0, hunkCount: 0 }; }

  global.DiffLab.adapters.register(xmlAdapter);
})(window);
