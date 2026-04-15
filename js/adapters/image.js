/* DiffLab — Image adapter
 *
 * Loads both panes as <img>, then offers three visualisations:
 *   - side-by-side   (raw canvases)
 *   - onion-skin     (overlay with opacity slider)
 *   - pixel diff     (red overlay on every pixel that changed beyond the threshold)
 *
 * Images of different sizes are anchored top-left onto a canvas sized to the
 * max of the two. Unmatched regions count as "changed".
 */

(function (global) {
  "use strict";

  const opts = { tolerance: 8 };

  function getFile(input) {
    if (input && input.file) return input.file;
    if (input && input.text) return null;
    return null;
  }

  const imageAdapter = {
    id: "image",
    label: "Image",
    inputMode: "file",

    accepts(mime, ext) {
      if (mime && /^image\//.test(mime)) return true;
      if (ext && ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(String(ext).toLowerCase())) return true;
      return false;
    },

    buildOptions(container, onChange) {
      container.innerHTML = "";
      const tol = document.createElement("label");
      tol.innerHTML = `Tolerance <input type="number" min="0" max="255" value="${opts.tolerance}" size="3" /> (per channel)`;
      tol.querySelector("input").addEventListener("change", (e) => {
        opts.tolerance = Math.max(0, Math.min(255, parseInt(e.target.value, 10) || 0));
        onChange();
      });
      container.appendChild(tol);
    },

    parse(input) {
      const file = getFile(input);
      if (!file) return Promise.resolve({ ok: false, empty: true });
      return loadImage(file).then(img => ({ ok: true, img, name: file.name }))
        .catch(e => ({ ok: false, error: e.message || String(e) }));
    },

    diff(left, right) {
      if (!left.ok && !right.ok) {
        return { kind: "empty", stats: emptyStats(), hunks: [] };
      }
      if (!left.ok || !right.ok) {
        return { kind: "partial", left, right, stats: emptyStats(), hunks: [] };
      }

      const w = Math.max(left.img.naturalWidth, right.img.naturalWidth);
      const h = Math.max(left.img.naturalHeight, right.img.naturalHeight);

      const leftData = rasterize(left.img, w, h);
      const rightData = rasterize(right.img, w, h);
      const { diffImage, changedPixels } = pixelDiff(leftData, rightData, opts.tolerance);

      const total = w * h;
      const pct = total === 0 ? 0 : (changedPixels / total) * 100;

      return {
        kind: "image",
        width: w, height: h,
        leftData, rightData, diffImage,
        stats: {
          additions: changedPixels,
          deletions: 0,
          hunkCount: changedPixels > 0 ? 1 : 0
        },
        hunks: changedPixels > 0 ? [{ pct }] : [],
        summary: { changedPixels, total, pct }
      };
    },

    render(result, container) {
      container.className = "result";
      container.innerHTML = "";

      if (result.kind === "empty") {
        const d = document.createElement("div");
        d.className = "pdf-notice";
        d.textContent = "Drop image files onto each pane to compare.";
        container.appendChild(d);
        return;
      }
      if (result.kind === "partial") {
        const d = document.createElement("div");
        d.className = "pdf-notice";
        d.textContent = "Load an image into each pane to compare.";
        container.appendChild(d);
        return;
      }

      const wrap = document.createElement("div");
      wrap.className = "image-compare";

      const toolbar = document.createElement("div");
      toolbar.className = "image-compare__toolbar";
      const modes = document.createElement("div");
      modes.className = "image-compare__modes";

      const views = ["side", "onion", "diff"];
      const labels = { side: "Side-by-side", onion: "Onion-skin", diff: "Pixel diff" };
      let activeView = "diff";

      for (const v of views) {
        const b = document.createElement("button");
        b.textContent = labels[v];
        b.dataset.view = v;
        if (v === activeView) b.classList.add("active");
        b.addEventListener("click", () => {
          activeView = v;
          modes.querySelectorAll("button").forEach(x => x.classList.toggle("active", x.dataset.view === v));
          paint();
        });
        modes.appendChild(b);
      }
      toolbar.appendChild(modes);

      const opacityLabel = document.createElement("label");
      opacityLabel.innerHTML = `Opacity <input type="range" min="0" max="100" value="50" id="onion-opacity" />`;
      opacityLabel.style.display = "none";
      toolbar.appendChild(opacityLabel);

      wrap.appendChild(toolbar);

      const stats = document.createElement("div");
      stats.className = "image-compare__stats";
      const { changedPixels, total, pct } = result.summary;
      stats.innerHTML = `<strong>${changedPixels.toLocaleString()}</strong> / ${total.toLocaleString()} pixels changed (${pct.toFixed(2)}%) &middot; ${result.width}×${result.height}`;
      wrap.appendChild(stats);

      const stage = document.createElement("div");
      stage.className = "image-compare__stage";
      wrap.appendChild(stage);

      container.appendChild(wrap);

      function paint() {
        stage.innerHTML = "";
        stage.style.position = "relative";
        if (activeView === "side") {
          opacityLabel.style.display = "none";
          const grid = document.createElement("div");
          grid.className = "image-compare__panels";
          grid.appendChild(canvasFor(result.leftData));
          grid.appendChild(canvasFor(result.rightData));
          stage.appendChild(grid);
          return;
        }
        if (activeView === "onion") {
          opacityLabel.style.display = "";
          const base = canvasFor(result.leftData);
          const over = canvasFor(result.rightData);
          base.style.position = "absolute";
          base.style.inset = "0";
          over.style.position = "absolute";
          over.style.inset = "0";
          over.style.opacity = "0.5";
          stage.appendChild(base);
          stage.appendChild(over);
          stage.style.height = result.height + "px";
          const input = opacityLabel.querySelector("input");
          input.oninput = () => { over.style.opacity = String(Number(input.value) / 100); };
          return;
        }
        opacityLabel.style.display = "none";
        stage.appendChild(canvasFor(result.diffImage));
      }

      paint();
    }
  };

  // ---------- image helpers ----------

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
      img.src = url;
    });
  }

  function rasterize(img, w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  }

  function pixelDiff(a, b, tolerance) {
    const w = a.width, h = a.height;
    const len = a.data.length;
    const out = new ImageData(w, h);
    let changed = 0;
    for (let i = 0; i < len; i += 4) {
      const dr = Math.abs(a.data[i] - b.data[i]);
      const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
      const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
      const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
      const maxCh = Math.max(dr, dg, db, da);
      if (maxCh > tolerance) {
        changed++;
        out.data[i] = 255;
        out.data[i + 1] = 40;
        out.data[i + 2] = 80;
        out.data[i + 3] = 220;
      } else {
        const avg = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3;
        const grey = Math.round(avg * 0.7 + 80);
        out.data[i] = grey;
        out.data[i + 1] = grey;
        out.data[i + 2] = grey;
        out.data[i + 3] = 150;
      }
    }
    return { diffImage: out, changedPixels: changed };
  }

  function canvasFor(imageData) {
    const c = document.createElement("canvas");
    c.width = imageData.width;
    c.height = imageData.height;
    c.getContext("2d").putImageData(imageData, 0, 0);
    return c;
  }

  function emptyStats() { return { additions: 0, deletions: 0, hunkCount: 0 }; }

  global.DiffLab.adapters.register(imageAdapter);
})(window);
