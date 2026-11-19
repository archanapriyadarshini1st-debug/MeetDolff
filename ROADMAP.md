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
- ✅ Inline transcript editing (edit / revert / delete segment, assign or rename speaker names), original text preserved, summary flagged stale + *Re-summarize* — verified in real Chromium.
- 🔜 Planned: Faster-Whisper/Whisper.cpp local adapter, diarization provider (user-assigned speaker names are not diarization), multilingual tuning.

## Milestone 5 — Memory engine ✅ COMPLETE
- Structured meetings, IndexedDB, portable `.md`/`.json` + `index.json`, FTS search, date/topic filters, history, export + JSON import, permission recovery, download fallback.

## Milestone 6 — AI intelligence ✅ COMPLETE (core)
- Summaries, decisions/actions extraction, meeting chat, cross-meeting chat, evidence citations, “not in memory” honesty.
- 🔜 Planned: per-operation models (separate summary/QA models), streaming responses.

## Milestone 7 — Advanced integrations ◐ PARTIAL
- ✅ BYOK (OpenAI-compatible/Anthropic/Gemini selectable), opt-in Tavily/Brave web search (labeled external + URLs), calendar + dashboard, project converter + approval, artifacts (report/flashcards/quiz/mindmap/infographic).
- ✅ Real-time question suggestions: on-device heuristics (ownerless actions, vague deadlines, unexplained decisions, risks, assumptions, uncertainty) + follow-ups carried over from earlier meetings + opt-in LLM mode whose output is dropped unless its evidence is a verbatim quote. Live input is Web Speech (mic) partials or pasted text; tab-audio live STT is not available yet.
- ✅ Local MCP companion (`companion/`): read-only, stdio, 7 tools over the exported memory folder — see `companion/README.md`.
- 🔜 Planned: HTTP transport with token auth + scopes for the companion, approval-gated write tools, audio summaries (TTS), slides/video overview, native companion for desktop apps.

## Next up (priority order)
1. ~~Inline transcript editing + re-summarize.~~ done
2. ~~Local MCP companion (Node) reading exported memory.~~ done (stdio, read-only)
3. Diarization adapter (Pyannote / cloud).
4. Per-operation model selection + streaming chat.
5. Native companion spike (system audio).
