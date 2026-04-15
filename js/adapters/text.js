/* DiffLab — text/code adapter
 *
 * Wraps the v1 line-Myers engine (js/diff-engine.js) and its table renderer
 * (js/render.js) as a FormatAdapter. Behavior is identical to v1 — this
 * file just exposes the engine through the ADR-001 contract so other
 * format adapters can sit alongside it without conditionals in app.js.
 */

(function (global) {
  "use strict";

  const TEXT_EXT = new Set([
    "txt", "md", "markdown", "rst",
    "js", "mjs", "cjs", "jsx", "ts", "tsx",
    "py", "pyw", "rb", "php", "go", "rs", "java", "kt", "kts",
    "c", "h", "cpp", "cc", "cxx", "hpp", "cs", "swift",
    "sql", "yaml", "yml", "toml", "ini", "conf",
    "css", "scss", "less", "sh", "bash", "zsh", "dockerfile"
  ]);

  function toText(input) {
    if (input == null) return "";
    if (typeof input === "string") return input;
    if (typeof input.text === "string") return input.text;
    return "";
  }

  const textAdapter = {
    id: "text",
    label: "Text / Code",
    inputMode: "text",

    accepts(mime, ext) {
      if (mime && /^text\//.test(mime)) return true;
      if (ext && TEXT_EXT.has(String(ext).toLowerCase())) return true;
      return false;
    },

    parse(input) {
      return { text: toText(input) };
    },

    diff(leftParsed, rightParsed, opts) {
      const o = opts || {};
      const leftText = leftParsed.text;
      const rightText = rightParsed.text;
      const diff = global.DiffLabEngine.computeDiff(leftText, rightText, o);

      if (o.semantic && global.DiffLab.semantic) {
        diff.semantic = global.DiffLab.semantic.analyze(diff, leftText, rightText, o.language);
        if (diff.semantic.moves && diff.semantic.moves.length) {
          diff.stats.movesDetected = diff.semantic.moves.length;
        }
      }
      return diff;
    },

    render(result, container, opts) {
      return global.DiffLabRender.render(container, result, opts || {});
    },

    toPatch(result, meta) {
      const m = meta || {};
      return global.DiffLabEngine.toUnifiedPatch(result, m.leftName, m.rightName);
    }
  };

  global.DiffLab.adapters.register(textAdapter);
})(window);
