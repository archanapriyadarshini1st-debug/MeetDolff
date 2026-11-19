# MeetDolff

**AI meeting companion Chrome extension — record, transcribe, remember.**

MeetDolff listens to meetings **only with explicit permission**, transcribes them, and builds a **persistent, searchable memory** you own. Ask questions like *“What happened last Tuesday at 7 PM?”* and get grounded answers with meeting + timestamp citations.

> Local-first. Provider-independent AI. Portable memory files. No remote code.

---

## What it does (v0.1.0 — verified)

- **Explicit recording** — tab audio (Chrome `tabCapture`), microphone, or both. Visible REC badge, timer, pause/resume/stop, recovery states.
- **Transcription** — Web Speech API (local, live mic, no key) + Cloud Whisper adapter (OpenAI-compatible `/audio/transcriptions`) for recorded audio. Timestamps included. Diarization is **not** faked — basic STT returns `speaker: null`. The recorded-audio flow is **Transcribe latest** in the side panel; Cloud + BYOK can also auto-process after stop.
- **Memory engine** — structured meetings in IndexedDB + portable exports (`MeetDolff Memory/index.json`, `meetings/*.md|*.json`) via File System Access API, with download fallback.
- **Search** — offline full-text search across transcripts, summaries, decisions, actions. Date/topic filters.
- **AI intelligence (BYOK)** — OpenAI-compatible chat (OpenAI/Groq/Together/local Ollama…), Anthropic, or Gemini adapter selectable in Settings. Summaries, decisions, action items, cross-meeting Q&A — all grounded, with “not in memory” honesty.
- **Opt-in web search** — Tavily or Brave Search can be configured separately; external results and URLs are kept distinct from meeting memory.
- **Dashboard** — meeting history, detail view (transcript with timestamps), calendar (color-coded, linked to meetings), project plans with approval.
- **Meeting → Project** — converts a meeting into objectives/tasks/milestones/risks (JSON, reviewable, requires approval).
- **Artifacts** — reports, flashcards, quizzes, mind maps (Mermaid), infographic text — deterministic templates from memory.
- **MCP-ready** — narrow, read-only-by-default tool schemas for external agents (see `ARCHITECTURE.md`). Writes require explicit approval.

## What it does NOT do (yet)

- Capture native desktop apps (Zoom desktop, etc.) — Chrome-only tab capture. A native companion is on the roadmap.
- Real speaker diarization — needs a dedicated diarization provider (roadmap).
- Vector search — deliberately not used; deterministic FTS is faster, offline, and explainable for this scale.
- Host a public MCP server from the extension — impossible by design; use the local-companion architecture in `ARCHITECTURE.md`.

See `ROADMAP.md` for completed vs. planned, and `TECHNICAL_DECISIONS.md` for why.

---

## Load the unpacked extension

1. Build:
   ```bash
   npm install
   npm run build
   ```
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** → select the `dist/` folder.
4. Pin **MeetDolff**, open a meeting tab (Google Meet / Zoom web / any tab with audio), click the extension → **Record tab**.

> `dist/` contains `manifest.json`, `background.js`, `popup.html`, `sidepanel.html`, `dashboard.html`, `settings.html`, `offscreen.html`, `icons/`.

## Quick start

1. **Settings** → paste your AI API key (OpenAI-compatible), pick chat + transcription models, Save.
2. **Record** from the popup. Stop → meeting is durably saved to memory (IndexedDB) with audio. One-second recovery chunks are written while recording.
3. **Side panel** → *Transcribe latest* (Cloud Whisper for recorded audio) → *Summarize latest* → *Ask* (“What did we decide about the frontend?”). If Cloud transcription + a BYOK chat provider are configured, post-stop transcription/summarization runs automatically.
4. **Dashboard** → search, listen to the saved recording, view timestamped transcript, add calendar events, approve project plans.
5. **Settings → Memory folder** → choose a folder to export portable `.md`/`.json` memory files.

## Configuration

All settings live in `chrome.storage.local` (never sync). Keys are never logged.

| Setting | Default | Notes |
|---|---|---|
| Chat adapter | OpenAI-compatible | OpenAI/Groq/Together/Ollama, Anthropic, or Gemini |
| Base URL | `https://api.openai.com/v1` | OpenAI-compatible chat + cloud transcription endpoint |
| Chat model | `gpt-4o-mini` | Per-operation models on roadmap |
| Transcription | Web Speech (local) | Cloud Whisper for recorded blobs; required for post-stop transcription |
| Search | Off | Tavily/Brave, explicitly labeled external |

## Development

```bash
npm run typecheck   # strict TS
npm run lint        # ESLint flat config
npm test            # Vitest unit tests
xvfb-run -a npm run test:e2e  # Playwright + headed Chrome (Linux CI; desktop can run npm run test:e2e)
npm run build       # production build → dist/
```

See `TESTING.md` for scenarios + honest limitations.

## Privacy

Local-first. No analytics, no remote code, minimal permissions (`tabCapture`, `offscreen`, `storage`, `sidePanel`, `activeTab`). Full disclosure in `PRIVACY.md`.

## Docs

- `ARCHITECTURE.md` — system design, audio pipeline, memory, MCP
- `RESEARCH.md` — Armory audit, competitors, technical research
- `TECHNICAL_DECISIONS.md` — choices + trade-offs
- `ROADMAP.md` — milestones, completed vs. planned
- `TESTING.md` — test plan + results
- `PRIVACY.md` — data handling, Chrome Web Store alignment

## License

Private repository. All rights reserved until a license is chosen.
