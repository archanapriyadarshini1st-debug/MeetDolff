# MeetDolff — Roadmap

## Milestone 1 — Research & architecture ✅ COMPLETE
- Armory audit (`RESEARCH.md`), competitor + technical research, architecture (`ARCHITECTURE.md`), data models (`src/lib/types.ts`), GitHub repo `archanapriyadarshini1st-debug/MeetDolff` (private).

## Milestone 2 — Extension foundation ✅ COMPLETE
- MV3 manifest, popup, side panel, dashboard, settings, recording controls. Loadable unpacked from `dist/`. Verified via Playwright (load + render).

## Milestone 3 — Audio pipeline ✅ COMPLETE (core)
- Tab audio via `tabCapture` + offscreen, mic, tab+mic, REC badge/timer, pause/resume/stop, chunk persistence, SW-restart recovery (`error` state, no silent loss).
- ⚠️ **Limitation:** Chrome-only tab capture. Native desktop apps need a companion (planned, not built).
- ✅ **Capture moment** (side panel): user-triggered screenshot of the visible tab via `activeTab` (no broad host permission, no background polling), stored locally in IndexedDB and linked to transcript time. Dashboard shows a gallery, a **Screen** button on transcript segments within 20 s of a capture, and click-a-timestamp-to-hear-that-moment. Snapshots are re-keyed from the recording session to the saved meeting on stop.
- ⚠️ Limits: `captureVisibleTab` only works for the tab where the user last invoked MeetDolff (activeTab) and never for native desktop windows. Real capture success is a manual check (headless automation exercises the guided-error path). Snapshots are not yet included in portable memory-file exports and are never sent to an AI provider.

## Milestone 4 — Transcription ✅ COMPLETE (core)
- Provider abstraction, Web Speech live, Cloud Whisper blobs, timestamps, honest diarization (`false`), transcript view.
- ✅ Inline transcript editing (text, speaker label, delete segment) with original text preserved, edited marker, rebuilt search text, and a **Re-summarize** action in the dashboard. Pure logic in `src/lib/transcript-edit.ts` (unit-tested), UI in `src/dashboard/transcript-view.ts` (browser-tested).
- 🔜 Planned: bulk speaker rename UI (logic exists: `renameSpeaker`), Faster-Whisper/Whisper.cpp local adapter, diarization provider, multilingual tuning.

## Milestone 5 — Memory engine ✅ COMPLETE
- Structured meetings, IndexedDB, portable `.md`/`.json` + `index.json`, FTS search, date/topic filters, history, export + JSON import, permission recovery, download fallback.

## Milestone 6 — AI intelligence ✅ COMPLETE (core)
- Summaries, decisions/actions extraction, meeting chat, cross-meeting chat, evidence citations, “not in memory” honesty.
- 🔜 Planned: per-operation models (separate summary/QA models), streaming responses.

## Milestone 7 — Advanced integrations ◐ PARTIAL
- ✅ BYOK (OpenAI-compatible/Anthropic/Gemini selectable), opt-in Tavily/Brave web search (labeled external + URLs), calendar + dashboard, project converter + approval, artifacts (report/flashcards/quiz/mindmap/infographic).
- ✅ **Real-time question suggestions** (side panel, during mic/tab+mic recording with Web Speech): rule-based, offline suggestions that quote the exact transcript words they reacted to, plus an opt-in AI mode (off by default; sends recent transcript text to the user's own provider; falls back to rules on any failure). Tab-only audio has no live transcript yet.
- 🔜 Planned: local MCP companion (localhost server + token auth), audio summaries (TTS), slides/video overview, native companion for desktop apps.

## Next up (priority order)
1. ~~Inline transcript editing + re-summarize.~~ Done (v0.2).
2. Local MCP companion (Node) reading exported memory.
3. Diarization adapter (Pyannote / cloud).
4. Per-operation model selection + streaming chat.
5. Native companion spike (system audio).
