# CLAUDE.md — DiffLab Pro v2

> Single source of truth for a fresh Claude Code session. Read top-to-bottom.
> Every tier PR **must** update this file in the same commit. If this file
> disagrees with git, git wins and this file is stale — fix it immediately.

---

## 1. What this is

Free, local-first Chrome (MV3) extension for git-grade diffing. v1 shipped
text/code diffs with split + unified views, intra-line highlights, hljs,
hunk nav, and unified-patch export. **v2** evolves it into a multi-format,
semantic-aware, folder/3-way-capable tool positioned against Diffchecker,
SemanticDiff, Beyond Compare, and Kaleidoscope — while staying free,
offline, and under 2 MB.

**Current version:** `v2.2.0` (Tier 2 complete — semantic layer with heuristic analyzer; tree-sitter AST path wired as an opt-in upgrade slot).

**Next action:** Smoke-test semantic mode on real code samples. Then start Tier 3 (folder & multi-file diff). See §7.

---

## 2. Run locally

1. `chrome://extensions` in any Chromium browser.
2. Enable **Developer mode**.
3. **Load unpacked** → select this folder (`difflab/`).
4. Click the toolbar icon → opens `diff.html` in a new tab.

No build step. Edit files → reload extension on `chrome://extensions`.

---

## 3. Stack & hard constraints

- Vanilla JS. No React/Vue/Svelte. Preact-signals standalone (~5 KB) is
  the only reactivity escape hatch — discuss before adding.
- **All deps vendored** in `lib/`. No CDN. No remote scripts.
- CSP is frozen at `script-src 'self'; object-src 'self'`.
- Web Workers for any work >50 ms.
- Unpacked size must stay **< 2 MB** after all 8 tiers.
- **Zero telemetry.** Zero analytics. Zero phone-home. Ever.
- Host permissions are `optional_host_permissions`, per-domain, opt-in.
- Secrets → `chrome.storage.local` only, never `sync`. Encrypt at rest
  with a non-extractable `CryptoKey` (pattern: Shanti Care's
  `sessionKeyManager.js`).
- AI calls require explicit per-session user confirmation before first send.

---

## 4. Repo map

```
difflab/
├── manifest.json         MV3, storage-only perms, strict CSP
├── diff.html             full-tab workspace
├── CLAUDE.md             ← this file
├── README.md             user-facing install + usage
├── CHANGELOG.md          per-tier release notes
├── css/
│   └── app.css           427 lines — split in Tier 8
├── js/
│   ├── core/
│   │   ├── adapter-registry.js   FormatAdapter contract + registry (ADR-001)
│   │   └── semantic-analyzer.js  heuristic semantic pass (ADR-002)
│   ├── adapters/
│   │   ├── text.js               v1 engine wrapped as "text" adapter
│   │   ├── json.js               deep key-path diff + tree renderer
│   │   ├── xml.js                DOMParser tree diff (XML + HTML)
│   │   ├── csv.js                RFC-4180 parser + row/cell diff table
│   │   ├── image.js              canvas pixel diff + onion-skin
│   │   └── pdf.js                pdf.js text extract → text engine (opt-in vendor)
│   ├── background.js     SW: icon click → open/focus tab
│   ├── diff-engine.js    v1 line-Myers engine (consumed by text + pdf adapters)
│   ├── render.js         v1 split/unified renderer (consumed by text + pdf adapters)
│   └── app.js            orchestration — adapter dispatch, format panel, hunk nav
├── lib/
│   ├── diff_match_patch.js
│   ├── highlight.min.js
│   ├── hljs-light.css
│   └── hljs-dark.css
└── icons/                16/32/48/128
```

**Tier 1 done.** `js/core/` + `js/adapters/` hold the registry + 6 adapters;
`js/workers/` will land with Tier 2's semantic adapter. See ADR-001.

---

## 5. Conventions

- Filenames: `kebab-case.js` / `kebab-case.css`.
- JS identifiers: `camelCase`. Constants: `SCREAMING_SNAKE` only for true
  compile-time constants.
- CSS: BEM-ish (`block__element--modifier`).
- Functions over classes unless state justifies a class.
- One file = one responsibility. **Split at 400 lines.**
- Comments explain **why**, never **what**. Default to none.
- No ternaries when `if/else` reads clearer. Don't reformat unrelated code.
- One tier = one PR. Each PR: code + README diff + screenshots in
  `docs/screenshots/v2.x/` + demo GIF + `CHANGELOG.md` entry + this file
  updated.

---

## 6. Architectural decisions (ADR-lite, append-only)

### ADR-001 — Pluggable format adapters (Option A)

**Status:** Accepted 2026-04-16. Implemented in Tier 1.

**Decision.** Every input format (text, json, xml, csv, image, pdf,
semantic-code in Tier 2) implements a common `FormatAdapter` contract:

```js
{
  id: string,                    // "text" | "json" | "xml" | ...
  label: string,                 // human label in the selector
  accepts: (mime, ext) => bool,  // auto-detect hint
  parse: (raw, opts) => parsed,  // runs in worker if >50ms
  diff:  (a, b, opts) => result, // runs in worker
  render: (result, el, mode) => void, // mode: "split" | "unified"
}
```

v1's text engine becomes `js/adapters/text.js`. The format `<select>`
picks an adapter. Core orchestration (worker pool, file IO, keyboard,
theme, persistence) lives in `js/core/`. Later tiers compose adapters:
Tier 2's `semantic-code` wraps `text`; Tier 3's folder mode dispatches
per file extension; Tier 4's 3-way runs the active adapter's `diff` twice.

**Rejected:** Option B (bolt-on `switch(format)`). Tier 2's worker +
AST boundary would force this refactor anyway; paying it upfront keeps
every subsequent tier small.

### ADR-002 — Two-path semantic analyzer (heuristic + tree-sitter)

**Status:** Accepted 2026-04-16. Implemented in Tier 2 (heuristic path).
Tree-sitter path wired as vendor-slot upgrade (Tier 2.1).

**Decision.** The semantic layer exposes a single module
(`js/core/semantic-analyzer.js`) with a stable return shape:

```js
{
  cosmeticHunks: Set<number>,   // hunk indices to collapse
  renames:       Map<rowIdx, { old, new }>,
  moves:         [{ fromStart, fromEnd, toStart, toEnd }]
}
```

Two implementation paths produce that shape:

1. **Heuristic (active).** Regex-grade tokenization + per-language
   comment stripping. No dependencies, runs on the main thread, handles
   single-identifier renames and whole-block moves. Good enough for
   most JS/TS/Python/Go code.

2. **Tree-sitter (opt-in vendor).** When `lib/tree-sitter/*.wasm` is
   present, the analyzer uses real ASTs + a GumTree-lite matcher for
   the 8 core languages. Detects multi-identifier renames, nested
   refactors, and structural moves the heuristic can't see.

**Why two paths, not one:** shipping tree-sitter by default breaks the
2 MB extension budget and drags in per-language licenses. Users who
never diff C++ shouldn't pay for the C++ parser. The heuristic path
keeps the feature alive for every user; the AST path is additive.

**Rejected:** worker-only architecture. The heuristic is ~5 ms for a
1000-line diff — worker overhead would dominate. Tree-sitter path will
use a worker; the facade hides which path ran.

---

## 7. PR tracker

Update the row the moment a PR opens, merges, or changes scope.

| Tier | Version | Branch                 | PR  | Status   | Scope                                                  | Notes |
|------|---------|------------------------|-----|----------|--------------------------------------------------------|-------|
| 1    | v2.1    | `tier/1-multiformat`   | —   | released | Adapter refactor + JSON/XML/CSV/Image/PDF adapters      | All 6 adapters shipped. pdf.js is opt-in vendor (drop into `lib/`). |
| 2    | v2.2    | `tier/2-semantic`      | —   | released | Semantic toggle + heuristic analyzer + tree-sitter vendor slot | Heuristic path active (ADR-002). AST path wired at `lib/tree-sitter/`, activated in Tier 2.1. |
| 3    | v2.3    | `tier/3-folder`        | —   | planned  | Folder compare, FS Access API + `webkitdirectory`      | Gitignore patterns, 5 MB cap. |
| 4    | v2.4    | `tier/4-merge`         | —   | planned  | 3-way merge with conflict UI + marker export           | Reuses active adapter's diff. |
| 5    | v2.5    | `tier/5-git-hosts`     | —   | planned  | GitHub/GitLab URL fetch + "Open in DiffLab" button     | `optional_host_permissions`, PAT in local storage. |
| 6    | v2.6    | `tier/6-ai-explain`    | —   | planned  | BYOK Claude Sonnet 4.6 / gpt-5 / Ollama                | Explicit send-confirmation gate. |
| 7    | v2.7    | `tier/7-ux`            | —   | planned  | Cmd palette, history, share-as-HTML, Focus mode, print | |
| 8    | v2.8    | `tier/8-polish`        | —   | planned  | a11y AA, colorblind palette, virtualization, Playwright e2e | Split `app.css`. |

**Status vocabulary:** `planned` → `in-progress` → `in-review` → `merged` → `released`.

### Program-level DoD

- All 8 tiers merged green, each independently shippable.
- Loads clean in Chrome, Edge, Brave, Arc (stable).
- Chrome Web Store listing live with passing review.
- README comparison table vs Diffchecker / SemanticDiff / Beyond Compare / Kaleidoscope.
- 60-second demo video + screenshots in repo.

---

## 8. Out of scope for v2

No backend. No accounts. No payments. No team sync. No Firefox/Safari.
No mobile. No CLI. No CI/CD bot. All v3 concerns — do not pull them in.

---

## 9. Session log (terse — one line per session end)

- **2026-04-16** — v2 program kicked off. ADR-001 accepted. `CLAUDE.md` created. Next: Tier 1 implementation.
- **2026-04-16** — Tier 1 step 1 landed: `js/core/adapter-registry.js`, `js/adapters/text.js`, format `<select>`, `app.js` rewired through registry, `manifest` → `2.1.0`, `CHANGELOG` created. Zero behavior change for existing text diffs. Next: JSON adapter.
- **2026-04-16** — Tier 1 complete: JSON (deep key-path + tree), XML/HTML (DOMParser tree diff), CSV (RFC-4180 parser + table), Image (canvas pixel diff, onion-skin, side-by-side), PDF (pdf.js text extract — opt-in vendor). Registry `compare()` is now async. `app.js` handles binary-mode panes + file auto-detect. CSS extended with tree/table/canvas styles (645 lines total — split in Tier 8). Next: Tier 2 semantic code diffing.
- **2026-04-16** — Tier 2 complete (heuristic path). ADR-002 accepted: two-path analyzer, heuristic active today, tree-sitter AST path wired as opt-in vendor slot. `semantic-analyzer.js` handles cosmetic-hunk collapse (whitespace + comment-only, 15 languages), single-identifier rename pills, and whole-block move detection. `render.js` split/unified paths carved into row-level helpers so cosmetic hunks become on-click expanders and rename rows get dedicated pill cells. Semantic toggle wired into header + persistence. `manifest` → `2.2.0`. Next: Tier 3 folder & multi-file diff.
