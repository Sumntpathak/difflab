# DiffLab — Code Comparison Chrome Extension

Git-grade code diffing in your browser. Side-by-side & unified views,
intra-line word-level diffs, syntax highlighting for 20+ languages,
light/dark themes. **100% local** — no network calls, no telemetry,
no remote scripts.

## Install (unpacked, dev mode)

1. Open `chrome://extensions` in Chrome / Edge / Brave / Arc.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select the `difflab/` folder.
5. Pin the extension icon to your toolbar.
6. Click the icon → DiffLab opens in a new tab.

## Usage

- Paste original code into the left pane, modified code into the right.
- Pick a language (or leave on **Auto-detect**).
- Click **Compare** (or press <kbd>Ctrl/Cmd + Enter</kbd> from any pane).
- Toggle **Split** ↔ **Unified** views.
- Press <kbd>n</kbd> / <kbd>p</kbd> to jump between hunks.
- Drag a file onto either pane to load it.
- **Copy patch** exports a standard unified-diff (`git apply`-compatible).

## Architecture

```
difflab/
├── manifest.json           MV3 manifest, storage permission only, strict CSP
├── diff.html               full-tab workspace
├── css/app.css             theme + layout (light + dark, GitHub-style palette)
├── js/
│   ├── background.js       service worker — opens / refocuses tab on icon click
│   ├── diff-engine.js      line-mode diff → row pairing → hunk grouping → patch export
│   ├── render.js           split / unified table renderers + hljs syntax overlay
│   └── app.js              wiring: file IO, persistence, keyboard, theme
├── lib/
│   ├── diff_match_patch.js Google's diff-match-patch (Apache 2.0)
│   ├── highlight.min.js    highlight.js 11.11.1 (BSD-3)
│   ├── hljs-light.css      GitHub light theme
│   └── hljs-dark.css       GitHub dark theme
└── icons/                  16 / 32 / 48 / 128 px brand marks
```

### Diff algorithm

Same approach as `git diff` and GitHub's PR view:

1. **Line-mode Myers diff** via diff-match-patch (each unique line is
   replaced with a surrogate char before diffing — keeps line-level
   complexity O(n) instead of O(line_length × n)).
2. **Pair adjacent DELETE + INSERT runs** into "modified" rows.
3. **Char-level diff inside each pair** so we can highlight the exact
   words that changed (red on the left, green on the right).
4. **Group rows into hunks** with 3 lines of context, sticky headers
   in `@@ -L,n +L,n @@` format.

## Privacy

- `permissions`: only `storage` (for persisting your last comparison).
- No `host_permissions`, no content scripts, no network requests.
- Strict CSP: `script-src 'self'; object-src 'self'`.
- All libraries are vendored and loaded locally.

## License

MIT for the DiffLab code. Vendored libraries retain their own licenses
(see `lib/`).
