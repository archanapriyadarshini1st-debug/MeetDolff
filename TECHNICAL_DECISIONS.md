# MeetDolff — Technical Decisions

## Stack

| Decision | Choice | Why | Alternative rejected |
|---|---|---|---|
| Extension framework | **Vanilla TS + Vite** (multi-page) | Small bundle, no React runtime, easy Playwright testing, transparent MV3 output | React/Next (overkill), WXT/Plasmo (extra magic), CRXJS (plugin opacity) |
| Language | **TypeScript strict** | Correctness, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | Plain JS (no safety) |
| DB wrapper | **`idb` (v8)** | Tiny, typed, well-maintained IndexedDB wrapper | Raw IDB (boilerplate), Dexie (heavier) |
| Tests | **Vitest + Playwright** | Fast unit + real-Chrome e2e (as requested) | Jest/Cypress (slower, less extension-friendly) |
| Icons | **Generated PNG (PIL)** | No remote assets, MV3-compliant | SVG-only (Chrome prefers PNG for action icons) |

## Audio

- **tabCapture + offscreen + MediaRecorder (1s chunks).** Why: official MV3 path, preserves playback via `AudioContext`, and writes recovery chunks to IndexedDB while active. Rejected: `getDisplayMedia` (picker friction), content-script injection (invasive, fragile).
- **Tab+mic mixing via combined MediaStream.** Honest about echo risk; tab-only recommended for meetings.
- **Session in `chrome.storage.session`.** Survives SW suspension/restart. Rejected: in-memory globals (lost on suspend).

## Transcription

- **Web Speech (live) + Cloud Whisper (blobs).** Why: local/no-key path + recorded-audio path. Diarization **not** claimed (honest `hasDiarization: false`). Rejected: bundling Whisper.cpp/WASM now (large, slow in extension; roadmap as adapter).
- **Provider interface** (`TranscriptionProvider`) allows Faster-Whisper/local servers later without UI changes.

## Memory & search

- **IndexedDB = source of truth; files = portable exports.** Why: queryable + recoverable; files alone are unreliable. Rejected: files-only.
- **Deterministic FTS, no vector DB.** Why: offline, explainable, zero embedding cost, sufficient for hundreds of meetings. Revisit if scale/ semantic needs demand it (with benchmarks).
- **Directory handle in IndexedDB.** Why: structured clone; `chrome.storage` is JSON-only. Permission re-grant on click (browser requirement).
- **Versioned schema** (`MEMORY_FORMAT_VERSION = 1`, `index.json` manifest). Why: safe migrations + import/export.

## AI

- **OpenAI-compatible first + Anthropic + Gemini adapters, selectable in Settings.** Why: BYOK + model independence (core differentiation). Rejected: single-provider lock-in.
- **Keys in `chrome.storage.local` only.** Why: never sync, never logs, never content scripts. Rejected: sync storage, URL params, env in bundle.
- **Grounded prompts with citations + “not in memory” honesty.** Why: trust; no invented decisions/deadlines.
- **Opt-in Tavily/Brave web search.** Why: explicit external research capability without contaminating meeting memory. External URLs remain visible and separately labeled.

## Design

- **Black-and-white editorial, typography-led.** Why: premium/calm/distinctive per brief + Armory anti-slop guidance. Rejected: purple gradients, glassmorphism, bento grids, component-library look.
- **No motion library.** Why: extension needs no scroll animation; CSS transitions + reduced-motion suffice.

## MCP

- **Schemas now, companion later.** Why: extension cannot host public server. Local companion (localhost MCP, token auth) is the reliable path. Read-only default; writes need approval.

## Licensing

- Dependencies checked: `idb` (ISC), Vite/TS/Vitest/Playwright (MIT/Apache). No GPL. No remote code. Chrome Web Store privacy-ready.
