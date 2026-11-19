# MeetDolff — Roadmap

## Milestone 1 — Research & architecture ✅ COMPLETE
- Armory audit (`RESEARCH.md`), competitor + technical research, architecture (`ARCHITECTURE.md`), data models (`src/lib/types.ts`), GitHub repo `archanapriyadarshini1st-debug/MeetDolff` (private).

## Milestone 2 — Extension foundation ✅ COMPLETE
- MV3 manifest, popup, side panel, dashboard, settings, recording controls. Loadable unpacked from `dist/`. Verified via Playwright (load + render).

## Milestone 3 — Audio pipeline ✅ COMPLETE (core)
- Tab audio via `tabCapture` + offscreen, mic, tab+mic, REC badge/timer, pause/resume/stop, chunk persistence, SW-restart recovery (`error` state, no silent loss).
- ⚠️ **Limitation:** Chrome-only tab capture. Native desktop apps need a companion (planned, not built).
- 🔜 Planned: optional active-tab screenshot snapshots linked to transcript timestamps. `captureVisibleTab` cannot reliably capture a non-visible tab or native desktop window, so this remains separate from the current audio path.

## Milestone 4 — Transcription ✅ COMPLETE (core)
- Provider abstraction, Web Speech live, Cloud Whisper blobs, timestamps, honest diarization (`false`), transcript view.
- 🔜 Planned: inline transcript editing UI, Faster-Whisper/Whisper.cpp local adapter, diarization provider, multilingual tuning.

## Milestone 5 — Memory engine ✅ COMPLETE
- Structured meetings, IndexedDB, portable `.md`/`.json` + `index.json`, FTS search, date/topic filters, history, export + JSON import, permission recovery, download fallback.

## Milestone 6 — AI intelligence ✅ COMPLETE (core)
- Summaries, decisions/actions extraction, meeting chat, cross-meeting chat, evidence citations, “not in memory” honesty.
- 🔜 Planned: per-operation models (separate summary/QA models), streaming responses.

## Milestone 7 — Advanced integrations ◐ PARTIAL
- ✅ BYOK (OpenAI-compatible/Anthropic/Gemini selectable), opt-in Tavily/Brave web search (labeled external + URLs), calendar + dashboard, project converter + approval, artifacts (report/flashcards/quiz/mindmap/infographic).
- 🔜 Planned: local MCP companion (localhost server + token auth), real-time question suggestions, audio summaries (TTS), slides/video overview, native companion for desktop apps.

## Delivered 2026-11-19 (lead agent — each item has unit and/or browser tests)
- ✅ Encrypted BYOK key vault + automatic migration of legacy plaintext keys.
- ✅ Date-aware retrieval ("last Tuesday at 7pm"), numbered evidence passages, verified citations (`Title @ mm:ss`), empty-memory short-circuit, coverage guard.
- ✅ Inline transcript correction (text + speaker), originals preserved, stale-summary banner + re-summarize, click-timestamp-to-seek audio.
- ✅ Opt-in real-time question suggestions (side panel; paced; parser rejects non-questions/duplicates). Requires Web Speech live captions (mic / tab+mic).
- ✅ Local MCP companion (`companion/`): stdio + loopback HTTP, scoped revocable tokens, rate limits, propose-only writes.

## Next up (priority order, updated)
1. Diarization adapter (Pyannote / cloud) — transcript editor already supports manual speaker labels.
2. Per-operation model selection + streaming chat.
3. Faster-Whisper / whisper.cpp local transcription adapter (the OpenAI-compatible adapter already works against a local server; needs UI preset + docs).
4. Companion: write `index.json` freshness check, calendar export, auto-export of every meeting to the memory folder.
5. Audio summaries (TTS), slides export, native companion spike (system audio).

## Previous queue (kept for history)
1. Inline transcript editing + re-summarize.
2. Local MCP companion (Node) reading exported memory.
3. Diarization adapter (Pyannote / cloud).
4. Per-operation model selection + streaming chat.
5. Native companion spike (system audio).
