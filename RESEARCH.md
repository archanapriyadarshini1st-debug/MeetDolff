# MeetDolff — Research

> Updated 2026-11-21. Sections 1 and 3–4 are the original v0.1 research. Section 2 now carries
> the 2026 market evidence that drove the v0.2 product changes; see `PRODUCT-REVIEW.md` for what
> was changed as a result.

## 1. Vibe Coding Armory audit

Reference: `https://github.com/archanapriyadarshini1st-debug/vibe-coding-armory` (re-audited 2026-11-21, `main`).

### Files read
- `README.md` — toolbox philosophy: smallest coherent set, no checklist-stacking.
- `toolkit.md` — design/motion/UI/research/ideation/writing catalog.
- `DESIGN-RESOURCE-VAULT.md` — Taste, UI/UX Pro Max, Impeccable, Vercel Guidelines, Claude Frontend Design, etc.
- `skills/` — 40+ skill pointers. Key ones inspected in full:

| Skill | Verdict for MeetDolff | v0.2 application |
|---|---|---|
| `frontend-design.md` → Anthropic `frontend-design` | **Adopted.** Deliberate hierarchy/typography, no templated defaults. | Type scale + spacing scale; serif/mono/sans roles; editorial direction kept and sharpened rather than replaced. |
| `design-skills.md` → Impeccable (pbakaus, Apache-2.0), Taste Skill (Leonxlnx, MIT), Emil Kowalski skills | **Adopted as guidance layers.** Anti-slop, interaction craft. No library installed — principles only. | Every interactive surface got hover/focus-visible/active/disabled states; no decorative motion added. |
| `web-design-guidelines.md` → Vercel Labs agent-skills | **Adopted as audit layer.** A11y, semantics, keyboard/focus, responsive, states. | Now enforced by `npm run audit:a11y` (axe-core WCAG 2.1 A/AA + structural checks). |
| `webapp-testing.md` + `agent-browser.md` | **Adopted.** Playwright real-browser flows, console/network checks, evidence on failure. | e2e grew 7 → 12 scenarios; a visual harness (`audit:shots`) captures every surface at its real size. |
| `webwright.md` (microsoft/Webwright) | **Not used.** Terminal-driven browser agent for open-ended exploration; this work needed deterministic, repeatable assertions against a local MV3 extension, which Playwright already covers. | — |
| `tdd.md`, `systematic-debugging.md` | **Adopted.** Failing-test-first for search/memory/parsing; reproduce → isolate → fix → verify. | The `[hidden]` CSS defect and the `formatDuration(3599) → "60 min"` defect were both found by tests written before the fix. |
| `codebase-architecture.md` | **Adopted.** Clear boundaries (UI/audio/storage/AI/domain), small modules, no speculative abstraction. | New `src/lib/utils/format.ts` — pure presentation helpers, no DOM, unit-tested. |
| `mcp-builder.md` | **Adopted.** Narrow tools, clear schemas, side-effect docs, read-only default. | Unchanged this pass. |
| `image2code.md`, `vision.md`, `screen-use.md`, `open-computer-use.md` | **Not needed.** No image→UI task; the direction is already specified. | — |
| `gsap-skill.md` → greensock/gsap-skills (MIT) | **Not installed.** Extension needs no scroll-driven motion; CSS transitions + reduced-motion only. | Confirmed: no motion beyond a REC pulse and 130ms state transitions. |

### Upstream checks (not installed, principles only)
- **Impeccable** (`github.com/pbakaus/impeccable`, Apache-2.0): production UI audit + detectors. Used as review checklist.
- **Taste Skill** (`github.com/Leonxlnx/taste-skill`, MIT): anti-slop layout/typography/motion.
- **Vercel agent-skills** (`github.com/vercel-labs/agent-skills`): Web Design Guidelines + React best practices.
- **Anthropic frontend-design**: purpose/audience/differentiation before code.

**Selection rule applied:** design direction first (black-and-white, typography-led), then the
smallest tech set (Vite + TS + `idb`). No component library, no GSAP, no 3D — they would fight the
calm, premium brief. v0.2 added **no dependencies**; `axe-core` is a dev-only test tool.

## 2. Competitor research (2026 market evidence)

### What the spend and switching data shows
- Granola moved from a ~$250M to a **$1.5B valuation** in under a year; revenue grew 250% in a
  single quarter, with **near-zero churn** and asymmetric switching: teams drop Otter, Fathom and
  Fireflies *after* adopting Granola, and the reverse is rare (YipitData Signals panel, 900+
  mid-market companies, Apr–Jun 2026).
- **Bot-free won 2026.** Google Meet began flagging third-party notetaker bots as a "potential
  risk" and denying them by default in March 2026. The category's decisive split is now
  *does your tool join the call, or does it stay invisible?*
- **Free-tier generosity wins the long tail.** Fathom's edge is that the free tier is genuinely
  useful — "the real competition isn't other notetakers, it's the user doing nothing."
- **The artifact is your notes, not the transcript.** Granola captures device audio and *enhances
  the notes the user typed*. Users describe a wall of transcript as the thing they don't want.

### Granola
- **Strengths:** invisible capture, notes-first artifact, calendar integration, fast UX, excellent retention.
- **Weaknesses:** opaque storage, provider lock-in, no portable memory, limited agent access, 30-day history cap on the free tier.
- **MeetDolff edge:** portable `.md`/`.json` memory you own + BYOK (including local Ollama) + MCP-ready + no history cap.

### Fathom
- **Strengths:** reliable capture, generous free tier, summaries, CRM integrations.
- **Weaknesses:** bot joins the call, cloud-dependent, no local memory files, limited model choice, no bulk download of recordings (a lock-in complaint users resent).
- **MeetDolff edge:** bot-free, local-first IndexedDB + exportable memory, model independence, one-click bulk export.

### Fireflies.ai
- **Strengths:** bot-based capture, 100+ languages, broad integrations, cross-meeting search.
- **Weaknesses:** bot must join (privacy/social friction, now blocked by default in Meet), cloud lock-in, no user-owned memory, credit-based billing complaints.
- **MeetDolff edge:** no bot, explicit tab capture, local memory, no credits.

### Open-source (Whisper.cpp, Faster-Whisper, etc.)
- **Strengths:** local STT, no API cost, multilingual.
- **Weaknesses:** no meeting memory, no UI, diarization is a separate problem.
- **MeetDolff edge:** memory + UI + provider abstraction; local STT is one adapter among many.

### Published churn drivers to design against
1. Accuracy failures on group calls (accents, overlapping speech) — mitigated by *correction*, which
   MeetDolff has (inline transcript editing with originals preserved and a stale-summary flag).
2. Privacy discomfort — mitigated by bot-free capture and an explicit consent surface.
3. **Lock-in with no bulk export** — the single cheapest churn cause to eliminate. MeetDolff already
   exports everything; it needs a round-trip test to prove it.

**Differentiation (defended, unchanged):** portable, user-owned meeting memory + model
independence + external agent access + bot-free capture. Not branding or UI copying.

**Differentiation gap identified in the v0.2 pass — closed in v0.3.0:** MeetDolff produced
transcripts where the market reward goes to *notes-first* artifacts. The side panel now opens with a
notes box, notes typed during a call are held against the recording session and adopted when the
meeting is created, and "Merge with transcript" rewrites the user's own notes using the transcript as
evidence (structure preserved, contradictions flagged, originals always retained). The dashboard
opens with merged notes rather than an AI summary. See `PRODUCT-REVIEW.md` §6.

## 3. Technical research (official docs)

- **Manifest V3 + Service Worker:** SW is ephemeral; persist session in `chrome.storage.session`. No persistent globals.
- **tabCapture + Offscreen:** `tabCapture.getMediaStreamId` (SW, user gesture) → offscreen `getUserMedia({ chromeMediaSource: 'tab' })` → `MediaRecorder` (1s chunks). Permissions: `tabCapture`, `offscreen`, `storage`. No `host_permissions` needed. Chromium-only.
- **Side Panel API:** `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`, `chrome.sidePanel.open({ windowId })` (gesture-gated; fallback to tab).
- **MediaRecorder:** `audio/webm;codecs=opus` preferred; `ondataavailable` for incremental persistence.
- **IndexedDB + `idb`:** structured clone stores `FileSystemDirectoryHandle` (chrome.storage cannot). Single origin `chrome-extension://<id>` shared by all pages.
- **File System Access API:** `showDirectoryPicker({ id, mode: 'readwrite' })` (Chromium-only). Permission can lapse after restart → `queryPermission`/`requestPermission` on user click. Brave may disable pickers → Download fallback. OPFS (`navigator.storage.getDirectory`) noted as future audio-chunk store.
- **Web Speech API:** `SpeechRecognition`/`webkitSpeechRecognition`, interim+final, live mic only, no diarization.
- **Whisper (cloud):** OpenAI-compatible `POST /audio/transcriptions` with `verbose_json` segments. Diarization is separate (Pyannote, etc.).
- **LLM APIs:** OpenAI Chat Completions, Anthropic Messages (`x-api-key`), Gemini `generateContent`. All support BYOK + custom base URLs.
- **MCP:** narrow tools, JSON Schema, token auth, read-only default, approval for writes. Extension cannot host public server → local companion recommended.
- **Extension CSP:** `script-src 'self'` genuinely blocks injected inline scripts — confirmed while wiring the axe-core audit (the audit had to use `Runtime.evaluate` instead of `addScriptTag`). Good news: no inline-script surface exists to exploit.
- **`color-scheme: dark`:** required for native `input[type=date]`, `<select>` arrows, radios and scrollbars to follow a dark UI instead of rendering as white blocks.

## 4. Design research

Black-and-white editorial direction (from brief + Armory): `--bg #0a0a0a`, `--surface #111`, serif
display (`Georgia`) + system sans + mono for timestamps/numbers. No purple gradients, no
glassmorphism, no bento grids, no decorative animation.

v0.2 refinement, in the same direction:
- **Roles made explicit.** Serif = voice (page titles, meeting titles, summaries). Mono = facts
  (timestamps, durations, counts, keys, timestamps). Sans = prose and controls.
- **Scales instead of one-offs.** `--s1…--s10` spacing, `--t-label…--t-display` type.
- **One accent.** Paper (`#f5f5f5`) is the only chromatic move; semantic colour is reserved for
  state (danger / ok / warn) and always paired with a left border and a text label, never colour alone.
- **Contrast.** `--faint` raised to `#8c8c8c` (5.4:1 on `--bg`) for 12px meta text.
- **States are mandatory.** Every surface defines hover, focus-visible, active, disabled, empty,
  loading and error. Purposeful motion only (REC pulse, 130ms transitions), `prefers-reduced-motion`
  respected, keyboard focus always visible, 30px+ hit targets.
