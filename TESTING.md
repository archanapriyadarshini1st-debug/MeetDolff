# MeetDolff — Testing

> Last full run: **2026-11-21**, v0.3.0. Every number below was produced by running the command
> in this workspace, not carried over from an earlier pass.

## Strategy (Armory: TDD + Web App Testing + Systematic Debugging)
- **Unit (Vitest 4):** deterministic, fast — search scoring/snippets, memory markdown, project JSON
  parsing, artifacts, meeting-intelligence parsing, date parsing, evidence retrieval, citation
  verification, transcript editing, suggestions, the encryption vault, and **presentation
  formatters** (durations, plurals, relative dates — the layer that stops raw machine values
  reaching the UI).
- **Browser (Playwright + Chromium):** real unpacked `dist/` extension — loads the MV3 service
  worker, renders every page, saves settings, records with a fake mic, pause/resume, IndexedDB
  persistence + audio playback, transcript correction, grounded Q&A against a local fake
  OpenAI-compatible server, onboarding, selection state, target-scoped AI actions, and a
  bundled-secret scan.
- **Audits:** `audit:a11y` (axe-core WCAG 2.1 A/AA + structural checks) and `audit:shots`
  (deterministic screenshots at each surface's real size).
- **Manual (documented, not automated):** tab capture with real audible media, real provider
  transcription/AI, service-worker kill/recovery, folder permission flows.

## How to run

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run audit:a11y          # axe-core + structure, needs a build
xvfb-run -a npm run test:e2e   # headed Chrome; on a desktop `npm run test:e2e` works directly
MEETDOLFF_HEADLESS=1 npm run test:e2e   # display-less environments (new headless mode)
npm run audit:shots        # screenshots → audit-shots/
npm audit
```

Extension loading needs a real browser. The checked-in test uses headed Chrome by default because
Chromium's old headless *shell* disables extension loading; `MEETDOLFF_HEADLESS=1` selects the new
headless mode for CI without a display server.

## Scenarios

| # | Scenario | Status | Notes |
|---|---|---|---|
| 1 | Load unpacked extension | ✅ Automated | `launchPersistentContext` + `--disable-extensions-except`/`--load-extension`; service-worker URL and root `dist/manifest.json` verified |
| 2 | Open popup + side panel + dashboard + settings | ✅ Automated | Real extension URLs; DOM + page-error assertions |
| 3 | Start a test recording | ✅ Automated for mic; ⚠️ tab manual | Fake mic stream through popup → SW → offscreen; source is now a segmented control, one start button |
| 4 | Capture synthetic tab audio | ⚠️ Manual | Play a tone/video in a Chrome tab and verify the saved `IndexedDB/audio` Blob; `tabCapture` is not reliable in automation |
| 5 | Capture microphone with permission | ✅ Automated smoke | Fake media flags + `--use-fake-ui-for-media-stream`; real microphone remains a manual privacy check |
| 6 | Verify playback still works | ✅ Code + manual | Offscreen routes the tab stream through `AudioContext.destination` |
| 7 | Pause and resume | ✅ Automated | Fake-mic e2e asserts state transitions |
| 8 | Stop and persist recording | ✅ Automated | Dashboard finds the meeting, opens detail, finds the saved `<audio>` |
| 9 | Service-worker suspension/recovery | ✅ Code-tested; ⚠️ manual kill | State in `chrome.storage.session`; `onStartup` marks interrupted sessions as `error` |
| 10 | Transcribe test recording | ⚠️ Manual/provider fixture | Cloud Whisper adapter implemented; a live call needs the user's own key and never runs in CI |
| 11 | Generate and save summary | ✅ Unit + e2e (fake provider) | JSON parsing unit-tested; **and** the side-panel target test proves the *correct* meeting is summarized |
| 12 | Search by date/topic | ✅ Automated unit + e2e | `searchMeetings`, `searchByDate`, `searchByTopic`; e2e asserts the "no match" state names the query and offers a clear action |
| 13 | Cross-meeting Q&A | ✅ e2e against a fake provider | Grounding prompt, date filter, citation verification, "not in memory" short-circuit |
| 14 | Verify source timestamps | ✅ Unit + implemented | Prompt citation format uses `Title @ mm:ss`; fabricated evidence ids are stripped |
| 15 | Export and reopen memory files | ✅ Unit + manual folder | Serialization is deterministic; File System Access permission/reopen is manual |
| 16 | Denied folder/mic permissions | ✅ Code paths; ⚠️ manual UI | Errors surface; download fallback exists |
| 17 | Provider failures / invalid keys | ✅ Code-tested | Non-2xx becomes a bounded user-facing error; keys never appear in error text |
| 18 | No secrets in logs/repository | ✅ Automated | E2e scans all bundled JS/HTML for token-like values |
| 19 | **First run leads somewhere** | ✅ Automated (new) | Checklist visible on empty memory, never "No meetings match"; hidden once a meeting exists |
| 20 | **No raw machine values in the UI** | ✅ Automated (new) | Asserts absence of `2460s`, `1 decisions`, `1 segment`; presence of `41 min`, `1 decision` |
| 21 | **Selection is visible and correct** | ✅ Automated (new) | `aria-current` on the row, detail pane switches, pane is hidden rather than dead space on narrow viewports |
| 22 | **AI acts on the selected meeting** | ✅ Automated (new) | Fake provider receives the *older* meeting's text; the newer meeting's summary is unchanged |
| 23 | **Popup consent is explicit** | ✅ Automated (new) | Names the capture target, exactly one start control, three source options, no developer-doc references |
| 24 | **Accessibility (WCAG 2.1 A/AA)** | ✅ Automated | axe-core: 0 violations on 7 audited surfaces — popup / side panel / dashboard / dashboard-detail / **dashboard-empty** / **dashboard-search-miss** / settings; 0 structural issues (duplicate ids, unnamed controls, heading order, landmarks) |
| 25 | **Notes survive a live recording** | ✅ Automated (new) | Start a fake-mic recording → type in the side panel → stop. The saved meeting carries the exact notes; the draft slot is consumed; the panel switches to editing the saved meeting |
| 26 | **Notes merge uses both sources** | ✅ Automated (new) | Fake provider receives the user's notes *and* the transcript; merged output renders; raw notes are preserved; editing the notes afterwards flags the merge stale |
| 27 | **A plan is readable before approval** | ✅ Automated (new) | Objectives/tasks/milestones/dependencies/risks are all reachable before Approve; the approval persists |

## Actual verification run — 2026-11-21

Environment: Node 20.20.2, Chromium 159.0.8154.6 via Playwright 1.65.1, new headless mode
(`MEETDOLFF_HEADLESS=1`), unpacked `dist/`.

- `npm run typecheck` — **clean**.
- `npm run lint` — **clean** (ESLint flat config, 0 errors, 0 warnings).
- `npm test` — **12 files, 102 tests passed** (63 → 78 → 102).
- `npm run test:e2e` — **16 Playwright scenarios passed** against a real Chromium with the unpacked MV3 build (7 → 12 → 15 → 16).
- `npm run build` — **passed**; Vite produced a packaged MV3 extension with root `manifest.json`,
  `background.js`, and all five pages.
- `MEETDOLFF_HEADLESS=1 npm run test:e2e` — **15 passed** (7 → 12 → 15). New in v0.3: notes typed
  during a live recording attach to the meeting that recording produces; notes merge sends both the
  user's notes and the transcript and preserves the originals; a project plan must be readable before
  it can be approved.
- `npm run audit:a11y` — **0 violations, 0 structural issues** on seven audited surfaces (the two
  zero-result dashboard states were added after the cross-version probe caught a defect there).
- `npm audit` — no production dependency was added this pass; `axe-core` is dev-only.

### Defects found *by* these tests, then fixed (v0.3)
4. The stale-merge warning was hidden while the "Show as written" toggle was active, so editing notes
   could leave a stale merged view with no warning. The banner now renders in both views.
5. The dashboard hero printed raw Markdown (`##`, `**`) for merged notes — it was still using
   `textContent`. Now rendered through the safe Markdown path with a fade-out clamp.
6. `.notes-body--bare` lost the cascade to `.notes-body` (equal specificity, earlier in source), so
   the hero kept a stray left border. Fixed with a compound selector.
7. Found by the **cross-version behaviour probe** (not by our own suite, because no audit ran against
   a *zero-result* dashboard): `#meetingList` kept `role="list"` while rendering a plain empty-state
   message, which axe-core flags as `aria-required-children` (critical) — a screen reader is told a
   list exists with no items. The role is now toggled only while real rows exist, `dashboard-empty`
   and `dashboard-search-miss` are audited surfaces, and an e2e test asserts the toggle.
8. Also from the probe: the follow-up calendar printed the design-token name as the colour of an
   event ("Accent", "Ink", "Paper", "Muted"). Users pick a colour, not a token, so both the row meta
   and the picker now say Dark / Grey / Light / White. Covered by an e2e test.

### Defects found *by* these tests, then fixed (v0.2)
1. `[hidden]` had no effect on `.hero` (`display: grid` beat the UA rule) — regions that were
   supposed to be hidden rendered. Fixed globally with `[hidden] { display: none !important; }`.
2. `formatDuration(3599)` returned `"60 min"` — minutes were rounded independently of hours.
   Fixed by deriving hours from a rounded total-minutes value.
3. Heading order skipped `h2 → h4` on the dashboard. Fixed by promoting the hero aside heading.

## Known limitations (honest)

- Playwright does not prove real `tabCapture` on every meeting platform; that needs an audible tab
  and a real user gesture.
- Fake media proves the pipeline wiring, not microphone acoustics or echo behaviour.
- AI/transcription calls in CI use a local fake server; live vendor behaviour (including model
  citation quality) remains provider-dependent and is never exercised with the user's key.
- Real Chrome permission dialogs, folder persistence after a browser restart, and service-worker
  kill recovery remain manual acceptance checks.
- axe-core proves machine-checkable WCAG conformance, not usability. It does not test screen-reader
  announcement order or the quality of the copy a screen reader reads.
