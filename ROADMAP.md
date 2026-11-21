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

## Delivered 2026-11-21 (v0.2.0 — product pass; see `PRODUCT-REVIEW.md`)
- ✅ **Explicit AI target.** Side panel gained an `Acting on …` selector + fact line + disabled-with-reason
  buttons. Every AI action used to run silently against "whatever is newest". Regression-tested.
- ✅ **First run.** Three-step setup checklist replaces "No meetings match." on empty memory, driven by
  real state and hidden once a meeting exists.
- ✅ **Latest-meeting recap** on the dashboard — summary + open action items + facts, above the fold.
- ✅ **Popup consent.** One segmented source control + one start button (was: two buttons and a select
  that could disagree); names the tab it will capture and flags a detected meeting URL; recap after save.
- ✅ **Honest copy.** Settings no longer claims keys live in `chrome.storage.local` (they are in the
  encrypted IndexedDB vault); adapter-specific fields appear only when they apply.
- ✅ **Presentation layer.** New `src/lib/utils/format.ts` — `2460s` → `41 min`, `1 decisions` →
  `1 decision`, ISO dates → relative labels, internal colour tokens no longer rendered.
- ✅ **Design system v2.** Spacing/type scales, app bar with navigation, selection states,
  master/detail, contrast fix (`--faint` 4.2:1 → 5.4:1), `color-scheme: dark` for native controls,
  empty/loading/error states rewritten as instructions. No new runtime dependencies.
- ✅ **Accessibility gate.** `npm run audit:a11y` — 0 axe-core violations (WCAG 2.1 A/AA) and 0
  structural issues across five surfaces.
- ✅ Visual harness (`npm run audit:shots`) and e2e grown 7 → 12 scenarios, unit 63 → 78.

## Delivered 2026-11-21 (v0.3.0 — notes-first capture)
- ✅ **Live notes.** A notes box in the side panel; text is held against the *recording session* while a
  call is running (the meeting record does not exist yet) and adopted by the service worker when the
  meeting is created. Matching on session id is what prevents a stale draft being attached to a new
  recording. Draft slot is consumed on save.
- ✅ **Notes merge.** "Merge with transcript" rewrites the user's own notes using the transcript as
  evidence — completing fragments, correcting names/numbers, appending a "From the transcript"
  section, flagging contradictions instead of overwriting them. Raw notes are preserved, the merged
  version is flagged stale when the notes are edited afterwards, and "Show as written" is always
  available.
- ✅ **Notes are the headline artifact** — the dashboard hero renders merged notes in place of the AI
  summary, and the detail view shows merged + original.
- ✅ **Project plans are readable before approval** — objectives, tasks, milestones, dependencies and
  risks in an expandable panel, instead of counts plus a blind Approve button.
- ✅ **Safe notes rendering** — `src/lib/utils/markdown.ts`: no `innerHTML`, no heading elements
  emitted from model output (keeps the document outline and the a11y audit intact).
- ✅ 102 unit tests (+24), 15 e2e tests (+3), 0 axe-core violations.

## Next up (priority order, updated 2026-11-21)

**P0 — the remaining product gap**
1. ~~Notes-merge loop~~ — **delivered in v0.3.0** (above).
2. **In-call recording indicator.** The REC badge lives only on the toolbar icon; every competitor
   shows live capture in the call. Needs a content-script overlay and a deliberate decision about
   host permissions — worth doing carefully rather than quickly.

**P1 — capability**
3. Diarization adapter (Pyannote / cloud) — the transcript editor already supports manual speaker labels.
4. Per-operation model selection + streaming chat.
5. Faster-Whisper / whisper.cpp local transcription adapter (the OpenAI-compatible adapter already
   works against a local server; needs a UI preset and docs, not new code).
6. Recurring meeting series — group "the weekly product review" into one thread so "what changed
   since last week" becomes answerable.

**P2 — integrity & polish**
7. Companion: `index.json` freshness check, calendar export, auto-export of every meeting.
8. Bulk export round-trip test — the anti-lock-in claim deserves proof, not a promise.
9. Audio summaries (TTS), slides export, native companion spike (system audio).
10. Notes: per-meeting templates (1:1 / standup / interview) and a "carry open action items into the
    next meeting's notes" preamble — cheap now that notes exist on the record.

### Demoted, with reasons
- **Flashcards / quiz / mind-map artifacts** — deterministic filler that competed with chat for the
  side panel's prime space. Now behind a disclosure; not to be expanded.
- **Webwright / agent-browser harnesses** — Playwright already gives deterministic, repeatable
  assertions against a local MV3 extension; an open-ended browser agent adds variance, not signal.

## Previous queue (kept for history)
1. Inline transcript editing + re-summarize.
2. Local MCP companion (Node) reading exported memory.
3. Diarization adapter (Pyannote / cloud).
4. Per-operation model selection + streaming chat.
5. Native companion spike (system audio).
