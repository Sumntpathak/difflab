# Changelog

All notable changes to DiffLab. One entry per tier.

## [2.2.0] — Tier 2 · semantic code diffing

### Added
- **Semantic toggle** in the header (next to *Ignore whitespace*). When ON,
  the text adapter runs a semantic pass over the computed diff and surfaces
  three signals.
- **`js/core/semantic-analyzer.js`** — heuristic analyzer (ADR-002). Runs
  after the text engine and produces:
  - `cosmeticHunks`: hunks whose every change is whitespace-only or
    comment-only. Rendered as a single collapsible row:
    *"▸ N cosmetic changes hidden — click to reveal"*.
  - `renames`: `mod` rows where exactly one identifier differs between
    the two sides. Rendered as an inline pill (`oldName → newName`)
    instead of the usual red/green strikethrough.
  - `moves`: del runs and add runs whose content matches after
    whitespace-normalisation. Surfaced as a banner above the diff table
    (SVG connector curves are deferred to a later polish pass).
- **Comment-awareness** for 15 languages (line + block comments):
  JS / TS / Java / C / C++ / C# / Go / Rust / Swift / Kotlin / PHP /
  Python / Ruby / Bash / YAML / Dockerfile / SQL / Lua / CSS / HTML / XML.
- **tree-sitter vendor slot** at `lib/tree-sitter/` (README only). The
  heuristic analyzer is the default; when tree-sitter `.wasm` files are
  dropped into that folder, the analyzer will prefer the AST-backed
  implementation for the 8 core languages. Opt-in to keep the baseline
  extension under 2 MB and fully self-contained.

### Changed
- `js/adapters/text.js` — `parse()` now returns `{ text }` and `diff()`
  reads `opts.semantic` / `opts.language`; when semantic mode is on, it
  attaches `diff.semantic = { cosmeticHunks, renames, moves }`.
- `js/render.js` — split + unified renderers carve out
  `renderSplitHunkRows` / `renderUnifiedHunkRows` helpers so a cosmetic
  hunk can be replaced with a single placeholder row and expanded on
  click. Rename rows use dedicated pill cells.
- Persisted state gains a `semantic` boolean.
- `manifest.json` → `2.2.0`.

### Unchanged
- v1 text engine (`diff-engine.js`) behaviour is identical; the semantic
  pass is purely additive.
- All Tier 1 adapters (JSON / XML / CSV / Image / PDF) are unaffected.
- CSP, permissions, MV3 surface, and zero-telemetry posture unchanged.

### Known limitations (deferred to Tier 2.1 / Tier 8)
- Rename detection only fires for single-identifier changes where the
  rest of the token sequence matches exactly. Multi-identifier renames
  (e.g. parameter renames propagated through a call site) show as
  regular mods. Tree-sitter path will fix this.
- Moves show only as a banner count; SVG connector curves between
  source and destination are a Tier 2.1 visual polish.
- Cosmetic detection is line-local — reorderings that straddle hunks
  (e.g. reordered imports block) currently show as normal add/del.
- Tree-sitter AST path is wired as a future upgrade slot but not active.
  Dropping wasm files into `lib/tree-sitter/` does nothing yet; the
  loader itself lands with Tier 2.1.

---

## [2.1.0] — Tier 1 · multi-format

### Added

- **Format adapter architecture** (ADR-001). Every input format implements a
  `FormatAdapter` contract and registers with `DiffLab.adapters`. The
  orchestrator dispatches through the registry — no format-specific
  conditionals in `app.js`. Contract supports `parse`, `diff`, `render`,
  optional `toPatch`, optional `buildOptions` / `destroyOptions`, and an
  `inputMode` flag (`text` | `file` | `both`).
- **Format `<select>`** with 6 options: Text / Code, JSON, XML / HTML, CSV,
  Image, PDF (text).
- **`#format-options` panel**: each adapter can add its own controls; the
  panel rebuilds when the format changes.
- **Input objects**: adapters receive `{ text, file?, name? }` per pane so
  binary adapters (Image, PDF) can consume Files while text adapters keep
  their plain-string contract.
- **Adapter-aware hunk nav**: `n` / `p` look for `[data-hunk-idx]` on any
  renderer first, falling back to v1's `[data-row-index]` on text rows.
- **File-ext auto-detect**: dropping `foo.json` / `foo.xml` / `foo.csv` /
  `foo.png` / `foo.pdf` picks the matching format automatically.

#### `json` adapter
- Deep recursive diff with key-path output.
- Options: **Sort keys** (render-time), **Array match key** (match array
  elements by a named key instead of by index).
- Collapsible tree renderer with `+` / `−` / `~` row marks and inline
  `old → new` for primitive changes.
- `toPatch()` emits a flat key-path patch.

#### `xml` adapter
- Parses with `DOMParser`, walks both trees in lockstep.
- Options: **Parse as** (`xml` / `html`), **Ignore whitespace nodes**.
- Diff covers tag name, attributes (add/del/mod per name), and children
  (tag+index order).
- Tree renderer with colored tags and attribute highlights.

#### `csv` adapter
- RFC 4180 parser (quoted fields, embedded newlines, `""` escapes) —
  inline, no PapaParse dependency yet.
- Options: **Has header row**, **Match by column**, **Delimiter**
  (`,` / tab / `;` / `|`).
- Row matching: index-based by default, key-based when a column is given.
- Table renderer with per-row marks and per-cell change highlights
  (modified cells show new value over strikethrough old value).
- `toPatch()` emits a row-oriented unified-ish patch.

#### `image` adapter
- Loads both sides as `<img>`, rasterizes to a canvas sized to the union
  of both dimensions.
- Three view modes: **Side-by-side**, **Onion-skin** (opacity slider),
  **Pixel diff** (changed pixels highlighted in red over a dimmed base).
- Options: **Tolerance** (per-channel, 0–255).
- Stats show changed-pixel count, total, and percentage.

#### `pdf` adapter
- Extracts text per page via pdf.js and delegates diffing to the v1 text
  engine. Page headers (`───── Page N ─────`) are injected so hunk
  locations map back to pages.
- **pdf.js is not vendored by default** to keep the extension small.
  The adapter checks for `lib/pdf.min.js` + `lib/pdf.worker.min.js` at
  runtime; if missing, it renders a friendly notice with install
  instructions. Drop the two files into `lib/` and reload — no code
  change needed.

### Changed
- `manifest.json` version bumped to `2.1.0`.
- `DiffLab.adapters.compare()` is now async so adapters with async
  `parse()` (image, PDF) work transparently; sync adapters are unaffected.
- Persisted state gains a `format` field.

### Unchanged
- v1 `DiffLabEngine` and `DiffLabRender` APIs are still in place, consumed
  by the `text` adapter. Byte-identical behavior for text/code diffs.
- CSP, permissions, MV3 surface unchanged.

### Known limitations (deferred)
- JSON: no semantic-cleanup across paths (rename/move detection is a
  Tier 2 concern).
- XML: children matched in tag+index order — structural reorders show as
  replace. LCS matching is a later improvement.
- CSV: no streaming for very large files. PapaParse can be vendored in
  later if that becomes a real pain.
- Image: images are rasterized on the main thread; worker offload is a
  Tier 8 polish item.
- PDF: text-only. Layout diff is out of scope for v2 per the spec.
- Binary pane state (loaded files) is not restored across reloads —
  re-drop the files. This is intentional to keep `chrome.storage.local`
  light.

---

## [1.0.0] — v1

Initial public release: text/code diffing with line-Myers, intra-line word
highlights, split + unified views, hljs syntax overlay, hunk navigation,
and unified-patch export. 100% local, zero telemetry.
