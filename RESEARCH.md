# MeetDolff — Research

## 1. Vibe Coding Armory audit

Reference: `https://github.com/archanapriyadarshini1st-debug/vibe-coding-armory` (cloned 2026-11-19, `main`).

### Files read
- `README.md` — toolbox philosophy: smallest coherent set, no checklist-stacking.
- `toolkit.md` — design/motion/UI/research/ideation/writing catalog.
- `DESIGN-RESOURCE-VAULT.md` — Taste, UI/UX Pro Max, Impeccable, Vercel Guidelines, Claude Frontend Design, etc.
- `skills/` — 40+ skill pointers. Key ones inspected in full:

| Skill | Verdict for MeetDolff |
|---|---|
| `frontend-design.md` → Anthropic `frontend-design` | **Adopted.** Deliberate hierarchy/typography, no templated defaults. |
| `design-skills.md` → Impeccable (pbakaus, Apache-2.0), Taste Skill (Leonxlnx, MIT), Emil Kowalski skills | **Adopted as guidance layers.** Anti-slop, interaction craft. No library installed — principles only. |
| `web-design-guidelines.md` → Vercel Labs agent-skills | **Adopted as audit layer.** A11y, semantics, keyboard/focus, responsive, states. |
| `vercel-react-best-practices.md`, `vercel-composition-patterns.md` | **Noted, not applied.** Extension uses vanilla TS (no React) for bundle size/testability. Principles (boundaries, composition) still guide `src/lib/` modularity. |
| `webapp-testing.md` + `agent-browser.md` | **Adopted.** Playwright real-browser flows, console/network checks, evidence on failure. |
| `tdd.md`, `systematic-debugging.md` | **Adopted.** Failing-test-first for search/memory/parsing; reproduce → isolate → fix → verify. |
| `codebase-architecture.md` | **Adopted.** Clear boundaries (UI/audio/storage/AI/domain), small modules, no speculative abstraction. |
| `mcp-builder.md` | **Adopted.** Narrow tools, clear schemas, side-effect docs, read-only default. |
| `gsap-skill.md` → greensock/gsap-skills (MIT) | **Not installed.** Extension needs no scroll-driven motion; CSS transitions + reduced-motion only. |

### Upstream checks (not installed, principles only)
- **Impeccable** (`github.com/pbakaus/impeccable`, Apache-2.0): production UI audit + detectors. Used as review checklist.
- **Taste Skill** (`github.com/Leonxlnx/taste-skill`, MIT): anti-slop layout/typography/motion. Used to avoid generic AI patterns.
- **Vercel agent-skills** (`github.com/vercel-labs/agent-skills`): Web Design Guidelines + React best practices. Used as audit layer.
- **Anthropic frontend-design** (`github.com/anthropics/skills/.../frontend-design`): purpose/audience/differentiation before code. Used for the black-and-white editorial direction.

**Selection rule applied:** design direction first (black-and-white, typography-led), then smallest tech set (Vite + TS + `idb`). No component library, no GSAP, no 3D — they would fight the calm, premium brief.

## 2. Competitor research

### Granola
- **Strengths:** invisible capture, excellent notes, calendar integration, fast UX.
- **Weaknesses:** opaque storage, provider lock-in, no portable memory, limited agent access.
- **MeetDolff edge:** portable `.md`/`.json` memory you own + BYOK + MCP-ready.

### Fathom
- **Strengths:** reliable capture, summaries, sharing, CRM integrations.
- **Weaknesses:** cloud-dependent, no local memory files, limited model choice.
- **MeetDolff edge:** local-first IndexedDB + exportable memory, model independence.

### Fireflies.ai
- **Strengths:** bot-based capture, broad integrations, search.
- **Weaknesses:** bot must join (privacy friction), cloud lock-in, no user-owned memory.
- **MeetDolff edge:** no bot, explicit tab capture, local memory.

### Open-source (Whisper.cpp, Faster-Whisper, etc.)
- **Strengths:** local STT, no API cost, multilingual.
- **Weaknesses:** no meeting memory, no UI, diarization separate.
- **MeetDolff edge:** memory + UI + provider abstraction; local STT as one adapter among many.

**Differentiation (defended):** portable, user-owned meeting memory + model independence + external agent access. Not branding or UI copying.

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

## 4. Design research

Black-and-white editorial direction (from brief + Armory): `--bg #0a0a0a`, `--surface #111`, `--text #f5f5f5`, serif display (`Georgia`) + system sans + mono for timestamps. No purple gradients, no glassmorphism, no bento grids, no decorative animation. Purposeful motion only (REC pulse), `prefers-reduced-motion` respected, keyboard focus visible, 36px+ hit targets, clear empty/error states.
