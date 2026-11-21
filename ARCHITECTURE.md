# MeetDolff — Architecture

## 1. System overview

```
┌──────────────┐   tabCapture.getMediaStreamId   ┌──────────────────┐
│ Service      │ ──────────────────────────────▶ │ Offscreen        │
│ Worker       │                                 │ document         │
│ (background) │ ◀── RECORDING_STOPPED (audio) ── │ (MediaRecorder)  │
└──────┬───────┘                                 └──────────────────┘
       │ chrome.storage.session (session state)
       │ chrome.runtime messages
┌──────▼───────────────────────────────────────────────────────────┐
│ UI: Popup (quick controls) · Side Panel (chat/artifacts)         │
│     Dashboard (history/calendar/projects) · Settings (BYOK)      │
└──────┬───────────────────────────────────────────────────────────┘
       │ IndexedDB (meetdolff): meetings, audio, calendar, projects, kv
       │ chrome.storage.local: providerSettings (non-secret) · IndexedDB vault: encrypted API keys
       │ File System Access API: portable memory exports
┌──────▼───────────────────────────────────────────────────────────┐
│ AI layer: OpenAI-compatible / Anthropic / Gemini adapters        │
│ Transcription: Web Speech (live) / Cloud Whisper (blobs)         │
│ Search: deterministic FTS (no vector DB)                         │
└──────────────────────────────────────────────────────────────────┘
```

**Principles:** local-first, provider-independent, grounded answers, portable memory, transparent recording, no remote code.

## 2. Extension structure (Manifest V3)

- `manifest.json` — MV3, `minimum_chrome_version: 116`, permissions: `tabCapture`, `offscreen`, `storage`, `sidePanel`, `activeTab`. No `host_permissions` (tabCapture needs none; gesture on action is consent).
- `src/background/service-worker.ts` — session state machine, offscreen lifecycle, audio persistence. **Never** relies on in-memory globals for recording state; `chrome.storage.session` survives SW suspension/restart.
- `src/offscreen/` — owns `MediaRecorder` + streams. Redeems `streamId` via `getUserMedia({ chromeMediaSource: 'tab' })`. Routes tab audio to `AudioContext.destination` so playback is preserved. 1s chunks for crash resilience.
- `src/popup/` — quick controls, timer, badge state.
- `src/sidepanel/` — grounded chat, summarize, project conversion, artifacts.
- `src/dashboard/` — search, detail, calendar, projects, export.
- `src/settings/` — BYOK, folder picker, wipe.
- `src/lib/` — domain logic, no UI: `db`, `search`, `memory-files`, `audio`, `transcription`, `ai`, `calendar`, `projects`, `artifacts`, `mcp`.
- `src/lib/utils/format.ts` — the presentation boundary: durations, pluralization, relative dates and
  time ranges. UI code must not format machine values itself; `2460s` and `1 decisions` reaching a
  screen is a bug, and `tests/unit/format.test.ts` plus the e2e formatter test both guard it.

### Notes flow (v0.3)
```
Side panel (recording)                service worker                     IndexedDB
  type ──▶ liveNotes{sessionId,text} ──▶ handleRecordingStopped
            (chrome.storage.local,        ├─ notesForSession(live, sessionId)
             debounced 500ms)             ├─ meeting.notes = text (if it matches)
                                          ├─ clearLiveNotes()
                                          └─ putMeeting(...)  ──────────▶ meetings
Side panel (saved meeting)
  edit ──▶ applyNotes()      ──▶ putMeeting (sets notesStale if a merge exists)
  merge ─▶ notesMergePrompt(notes, transcriptText, summary)
          ──▶ provider.chat(NOTES_MERGE_SYSTEM, …)
          ──▶ applyNotesMerge() ──▶ putMeeting (notesEnhanced, notesMergedAt)
```
`notes` (the user's own words) and `notesEnhanced` (the model's rewrite) are separate fields and are
never collapsed. A merge is advisory: it can be stale-flagged, toggled off, or ignored.

### Interaction contract (v0.2)
- Every AI action is **targeted**: the side panel keeps an explicit `Acting on <meetingId>` and
  disables an action (with a reason) when the target lacks a transcript or audio. There is no
  implicit "latest" path in the UI layer.
- Full-page surfaces share an app bar with `aria-current`; the dashboard is master/detail, with
  `aria-current` on the selected row and a sticky detail pane that becomes a stacked pane and
  auto-hides while idle below the split breakpoint.
- First run is a state, not a special case: with zero meetings the dashboard renders a setup
  checklist derived from real provider + meeting state.

Build: Vite multi-page (popup/sidepanel/dashboard/settings/offscreen HTML + `background.js`). TypeScript strict. No framework — vanilla TS keeps the bundle small and testable.

## 3. Audio pipeline

### Sources
- **Tab audio:** `chrome.tabCapture.getMediaStreamId({ targetTabId })` from SW (requires user gesture on action/popup) → offscreen `getUserMedia` with `chromeMediaSource: 'tab'`. Chromium-only.
- **Mic:** `getUserMedia({ audio: true })` in offscreen.
- **Tab+mic:** combined `MediaStream` (tab tracks + mic tracks). Echo/duplication is a known risk; we preserve tab playback via `AudioContext` routing and document the limitation.

### Recording states
`idle → recording ⇄ paused → stopping → idle | error`. Persisted in `chrome.storage.session`. Badge: `REC` (red) / `❚❚` (gray). Timer in popup. `onStartup` recovery marks interrupted sessions as `error` with a clear message (no silent loss).

### Persistence
Chunks stream via `ondataavailable` (1s). Each chunk is sent to the service worker and written to `IndexedDB/audioChunks` while recording. On stop, offscreen sends the complete `ArrayBuffer` to SW → `IndexedDB/audio` (Blob) + `IndexedDB/meetings` (metadata). Recovery chunks are removed only after both final records commit. Audio MIME: `audio/webm;codecs=opus` preferred.

### Limitations (honest)
- Chrome extensions **cannot** capture native desktop apps. Roadmap: optional native companion (system audio via OS APIs) — not in v0.1.
- `tabCapture` requires the tab to be audible; muted tabs yield silence.
- Mic+tab mixing can echo. Mitigation: prefer tab-only for meetings; mic for in-person.
- Screenshot-at-timestamp is not part of v0.1: `captureVisibleTab` only sees the visible browser tab/window, not a background tab or native desktop app. It is a planned optional snapshot path, not silently claimed as implemented.

## 4. Transcription

Provider-independent interface (`TranscriptionProvider.transcribe(blob) → { segments, text, provider, hasDiarization }`).

- **Web Speech API** (`webkitSpeechRecognition`): live mic, interim+final, no key, offline-capable in Chrome. `transcribe(blob)` throws with guidance (it cannot process blobs). No diarization.
- **Cloud Whisper** (OpenAI-compatible `POST /audio/transcriptions`, `verbose_json`): processes recorded blobs, returns timestamped segments. No diarization (Whisper basic). Future: Faster-Whisper / Whisper.cpp local, diarization providers (Pyannote, etc.) as separate adapters.
- **Workflow:** Side Panel → **Transcribe audio** (on the selected meeting) sends the saved Blob through the configured Cloud adapter. If Cloud transcription + a chat key are configured, the service worker also attempts post-stop transcription and structured extraction; a failure never deletes the saved meeting. Web Speech remains a live-only adapter.
- **Editing:** transcript segments are visible with timestamps; inline edit UI is planned (data model already supports it).

## 5. Memory engine

### Schema (`src/lib/types.ts`, `MEMORY_FORMAT_VERSION = 1`)
`Meeting { id, title, startedAt, endedAt, durationSec, participants, transcript[], transcriptText, summary, topics[], decisions[], actionItems[], openQuestions[], commitments[], project, audioSource, audioMime, hasAudio, memoryVersion, createdAt, updatedAt }`.

### Storage
- **IndexedDB (`meetdolff`, schema v2)** via `idb`: `meetings` (index `startedAt`), `audio` (final Blob), `audioChunks` (one-second recovery Blobs keyed by recording session), `calendar`, `projects`, `kv` (directory handle — structured-cloneable, **never** in `chrome.storage`).
- **Portable files** (File System Access API): `MeetDolff Memory/index.json` + `meetings/<id>.md` + `<id>.json`. Markdown is human-readable; JSON is machine-retrievable. `index.json` is a manifest (IDs + `formatVersion`), not a DB replacement.
- **Fallbacks:** permission loss → re-pick folder; unsupported browser → Download `.md`/`.json`; Settings can import valid `meetings/*.json` records back into IndexedDB (malformed JSON is skipped).

### Retrieval
Deterministic FTS (`src/lib/search.ts`): tokenize, score by term frequency (title ×3) + coverage, snippet with `<mark>`, date/topic filters. **No vector DB** — for hundreds of meetings, FTS is faster, offline, explainable, and has no embedding cost. Revisit if scale demands it (see `TECHNICAL_DECISIONS.md`).

### Grounding
AI context = top-ranked meetings (search + recency). Prompts (`src/lib/ai/prompts.ts`) require citations `[Title, MM:SS]` and explicit “not in memory” when absent. Owners/deadlines only if explicitly stated.

## 6. AI provider system

Adapters (`src/lib/ai/provider.ts`):
- `OpenAICompatibleProvider` — `POST {baseUrl}/chat/completions` (OpenAI, Groq, Together, Ollama, LM Studio).
- `AnthropicProvider` — `POST /messages` (`x-api-key`, `anthropic-version`).
- `GeminiProvider` — `generateContent?key=`.

BYOK: keys are AES-GCM encrypted in `meetdolff-vault` (`src/lib/secrets.ts`, `settings-store.ts`). Never in `chrome.storage`, sync storage, logs, or content scripts. Settings selects the OpenAI-compatible, Anthropic, or Gemini adapter. Per-operation models (transcription vs. summary vs. QA) are a roadmap refinement; v0.1 uses one chat model + one transcription model.

Web search (`src/lib/search/web.ts`): optional Tavily/Brave adapters, requested as optional host permissions, labeled **external** vs. **memory** in UI. Off by default; URLs are passed to the grounded prompt and shown in the source line.

## 7. Meeting intelligence

- **Summarize:** JSON extraction (summary/topics/decisions/actions/questions/commitments) → saved to meeting.
- **Chat:** cross-meeting or latest-only scope, grounded context, source list.
- **Project converter:** JSON plan → `ProjectPlan` (pending approval) → Dashboard approve.
- **Artifacts:** deterministic templates (report/flashcards/quiz/mindmap/infographic) from memory — no fake AI.
- **Calendar:** user events + meeting links, restrained palette (`ink/paper/accent/muted`).
- **Real-time question suggestions:** roadmap (needs live transcript streaming + non-intrusive UI).

## 8. MCP / external agents

A browser extension **cannot** host a public server. Recommended architecture:

1. **Local companion (Node, localhost MCP):** reads exported memory files (or a synced copy), exposes `MCP_TOOLS` (`search_meetings`, `get_meeting`, `list_decisions`, `list_action_items`, `list_calendar`, `generate_report` — all read-only; `create_task` requires approval). Token auth, scoped permissions, rate limits, revocable credentials.
2. **User-hosted backend (optional):** syncs memory files, exposes same tools over HTTPS.

Tool schemas are defined in `src/lib/mcp/server.ts`. Default read-only. Any write (create events/tasks, send data) requires explicit user authorization in the extension UI. See `PRIVACY.md`.

## 9. Security & privacy

- No remote executable code (MV3 requirement + policy).
- Minimal permissions; provider/search network origins are optional host permissions requested only when configured.
- Keys: encrypted vault only, never logged, never sent except to the configured provider/search endpoint.
- Recording: explicit gesture, visible indicator, no background recording.
- Deletion: per-meeting (audio + metadata) and full wipe.
- Chrome Web Store privacy disclosures prepared from day one (`PRIVACY.md`).

## 10. Testing

Vitest (unit: search, memory markdown, project parsing, artifacts) + Playwright (real Chrome, unpacked extension: load, popup/sidepanel render, dashboard search, settings save, no-secrets check). Synthetic audio fixtures; honest limitations in `TESTING.md`.
