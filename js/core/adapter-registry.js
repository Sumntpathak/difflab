/* DiffLab — FormatAdapter registry (ADR-001)
 *
 * Every input format registers an adapter:
 *   {
 *     id, label,
 *     inputMode: 'text' | 'file' | 'both',   // how the pane takes input
 *     accepts(mime, ext),                    // for detect()
 *     parse?(input, opts),                   // input = { text, file?, name? }
 *     diff(parsedA, parsedB, opts),
 *     render(result, container, opts),
 *     toPatch?(result, meta),
 *     buildOptions?(container, onChange),    // populates #format-options
 *     destroyOptions?()                      // teardown hook
 *   }
 *
 * The orchestrator (app.js) never talks to format-specific code directly —
 * it calls DiffLab.adapters.compare(id, ...) / .render(id, ...) and the
 * registry dispatches. New formats slot in by calling register().
 */

(function (global) {
  "use strict";

  const adapters = new Map();

  function register(adapter) {
    if (!adapter || !adapter.id) {
      throw new Error("DiffLab.adapters: adapter.id required");
    }
    if (typeof adapter.diff !== "function") {
      throw new Error(`DiffLab.adapters[${adapter.id}]: diff() required`);
    }
    if (typeof adapter.render !== "function") {
      throw new Error(`DiffLab.adapters[${adapter.id}]: render() required`);
    }
    adapters.set(adapter.id, adapter);
  }

  function get(id) {
    return adapters.get(id) || null;
  }

  function list() {
    return Array.from(adapters.values());
  }

  function detect(mime, ext) {
    for (const a of adapters.values()) {
      if (typeof a.accepts === "function" && a.accepts(mime, ext)) return a;
    }
    return null;
  }

  async function compare(id, leftRaw, rightRaw, opts) {
    const a = get(id);
    if (!a) throw new Error(`DiffLab.adapters: unknown adapter "${id}"`);
    const parse = typeof a.parse === "function" ? a.parse : identity;
    const [left, right] = await Promise.all([
      Promise.resolve(parse(leftRaw, opts)),
      Promise.resolve(parse(rightRaw, opts))
    ]);
    return a.diff(left, right, opts);
  }

  function render(id, result, container, opts) {
    const a = get(id);
    if (!a) throw new Error(`DiffLab.adapters: unknown adapter "${id}"`);
    return a.render(result, container, opts);
  }

  function toPatch(id, result, meta) {
    const a = get(id);
    if (!a || typeof a.toPatch !== "function") return null;
    return a.toPatch(result, meta);
  }

  function buildOptions(id, container, onChange) {
    const a = get(id);
    if (!a || typeof a.buildOptions !== "function") return;
    a.buildOptions(container, onChange || (() => {}));
  }

  function destroyOptions(id) {
    const a = get(id);
    if (!a || typeof a.destroyOptions !== "function") return;
    a.destroyOptions();
  }

  function identity(x) { return x; }

  global.DiffLab = global.DiffLab || {};
  global.DiffLab.adapters = {
    register, get, list, detect, compare, render, toPatch,
    buildOptions, destroyOptions
  };
})(window);
