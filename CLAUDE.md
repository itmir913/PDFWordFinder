# GLOBAL RULES

## ARCHITECTURE
- Components must NOT touch Tauri at all — no `@tauri-apps/*` import, no
  `window.__TAURI__`. Use store actions only.
- All Tauri IPC calls live in `src/stores/app.js` (this includes window events
  like `onDragDropEvent`, not just `invoke()`)
- File I/O (read/write) handled by Rust commands in `src-tauri/src/lib.rs`
- Heavy processing (PDF parsing, Excel parsing) runs in `src/workers/processor.worker.js`

## TECH STACK
- Frontend: Vue 3 (Composition API) + Tailwind CSS v4 + Pinia
- Desktop: Tauri 2
- PDF: pdfjs-dist (Web Worker)
- Excel: SheetJS/xlsx (Web Worker)
- Icons: @lucide/vue
- Font: Pretendard

## CSS / STYLING
- **Tailwind CSS utility classes only** — no `style="..."` inline attributes
- No `<style>` blocks with hardcoded values (scoped Tailwind @apply is acceptable)
- Custom theme tokens defined in `src/assets/main.css` under `@theme`

## COMPONENT STRUCTURE
```
src/
  assets/main.css          # Tailwind v4 entry + @theme tokens
  stores/app.js            # Single Pinia store (state + all actions)
  lib/
    csv.js                 # Keyword CSV decoding + parsing (pure)
    paths.js               # File name / extension / output_ path (pure)
  workers/
    processor.worker.js    # PDF + Excel orchestration (Web Worker)
    lib/
      keywords.js          # Keyword matching (pure)
      excel.js             # Sheet -> result rows (pure)
      pdf-highlight.js     # Highlight + outline geometry (pure)
  components/
    TitleBar.vue
    CsvSection.vue
    ActionBar.vue
    tabs/
      GuideTab.vue
      FileTab.vue
      LogTab.vue
      DownloadTab.vue
  App.vue                  # Root layout only
  main.js
scripts/
  check-architecture.mjs   # Enforces the rules in this file
tests/
  check-architecture.spec.js # The checker's own tests — it must catch evasions
  csv.spec.js
  excel.spec.js
  keyword-lists.spec.js    # default.csv <-> embedded list must not drift
  keywords.spec.js
  paths.spec.js
  pdf-highlight.spec.js
  pdf-pipeline.spec.js     # Build PDF -> highlight -> render -> check pixels
```

`src/lib/*` and `src/workers/lib/*` hold side-effect-free logic so they can be
tested without a Worker or a Tauri window. Anything touching `self.postMessage`,
`invoke()`, pdfjs, or ExcelJS stays in `processor.worker.js` / `stores/app.js`.

Keyword CSV bytes are decoded in **one** place (`src/lib/csv.js`): Korean
Windows Excel writes CP949, so Rust hands over raw bytes and the frontend tries
UTF-8 (`fatal: true`) then EUC-KR.

## CI GATE
- `npm run ci` = architecture check -> vitest -> vite build. **This one script is
  the gate's definition.** Add a check here, not to the workflow files —
  `.github/workflows/ci.yml` (push/PR) and `publish.yml` (release) both just
  call `npm run ci`.
- Rust is gated separately in `ci.yml`: `cargo fmt --check`,
  `cargo clippy -- -D warnings` and `cargo test`, on windows-latest.
  `publish.yml` runs the same Rust gate — it can be dispatched from any branch,
  so it cannot rely on `ci.yml` having run.
- Bug fixes in `src/workers/lib/` need a regression test. Verify the test
  actually catches it: re-introduce the bug and watch it fail.
- Loosening `scripts/check-architecture.mjs` needs a reason. It once caught only
  5 of 26 evasions; `tests/check-architecture.spec.js` now pins what it must catch.
- A `catch` that genuinely must swallow needs `의도적 무시: <이유>` in its body,
  otherwise the gate fails.
- Editing `default.csv`? Copy it over `src-tauri/src/resources/embedded_keywords.csv`
  too. The macOS dmg ships no `default.csv`, so those users fall back to the
  embedded list — it drifted 57 words once before anyone noticed.
  `tests/keyword-lists.spec.js` now fails if the two diverge.
- Releases are manual (`publish.yml`, workflow_dispatch) and tagged from
  `src-tauri/tauri.conf.json`'s `version`.

## CONVENTIONS
- Rust commands: snake_case
- Vue components: PascalCase
- Store actions: camelCase
- Files: kebab-case
- Commit messages: Korean or English, concise

## GIT / COMMIT RULES
- **Co-Authored-By / Co-Worked / Cowork 문구 삽입 금지**: 커밋 메시지에 Claude 관련 문구 일절 포함하지 않는다.
- 커밋 메시지: 한국어 또는 영어, 간결하게 작성

## PROHIBITED
- Inline CSS (`style="..."`)
- Business logic in Vue components
- Any `@tauri-apps/*` import outside `src/stores/app.js`
- Silent error handling
