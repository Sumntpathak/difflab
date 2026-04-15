# tree-sitter vendor slot

DiffLab v2.2 ships the semantic layer with a **heuristic analyzer** that
runs without any extra dependencies. It handles cosmetic-change collapse,
rename pills, and move detection via regex-grade tokenization. That's
what's active by default, and it works out of the box.

The `semantic-analyzer.js` module is designed so that a second
**AST-backed path** can take over silently when tree-sitter binaries
are present in this folder. When the upgrade lands (planned Tier 2.1),
the analyzer will prefer the tree-sitter implementation for the 8 core
languages:

- JavaScript, TypeScript, Python, Java, Go, Rust, C++, C#

To enable the AST path, drop these files into `lib/tree-sitter/`:

```
lib/tree-sitter/
├── tree-sitter.wasm                  the runtime (~200 KB)
├── tree-sitter.js                    JS bindings
├── tree-sitter-javascript.wasm       per-language parser
├── tree-sitter-typescript.wasm
├── tree-sitter-python.wasm
├── tree-sitter-java.wasm
├── tree-sitter-go.wasm
├── tree-sitter-rust.wasm
├── tree-sitter-cpp.wasm
└── tree-sitter-c-sharp.wasm
```

All files can be obtained from the upstream tree-sitter releases
(`github.com/tree-sitter/tree-sitter` + per-language repos). Per-language
parsers are loaded **lazily** — only the language you're diffing gets
fetched from this local folder.

Total footprint when all 8 languages are vendored: roughly 3–4 MB,
depending on build flavor. DiffLab enforces a 2 MB budget for the
baseline extension, so tree-sitter stays opt-in.

## Why not bundle by default?

1. **Size.** The extension ships under 2 MB. Adding 3–4 MB of wasm for a
   feature some users won't need pushes us well over.
2. **Licensing.** tree-sitter itself is MIT; per-language parsers vary.
   Opt-in vendoring lets you pick exactly which parsers (and therefore
   which licenses) ship in your build.
3. **Privacy.** We never fetch remotely. Keeping tree-sitter opt-in
   preserves the "100% local, no downloads, no phone-home" guarantee
   without forcing a large up-front payload.

## Check status

Open DevTools on the DiffLab tab and run:

```js
DiffLab.semantic.treeSitterStatus?.()
```

This will return `{ available: true, languages: [...] }` once the AST
path lands. Today it returns `undefined` and the heuristic analyzer is
the only path.
