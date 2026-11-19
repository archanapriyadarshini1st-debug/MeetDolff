# MeetDolff — Testing

## Strategy (Armory: TDD + Web App Testing + Systematic Debugging)
- **Unit (Vitest 4):** deterministic, fast — search scoring/snippets, memory markdown, project JSON parsing, artifacts, meeting-intelligence parsing.
- **Browser (Playwright + Chrome for Testing):** real headed Chrome under Xvfb, unpacked `dist/` extension — load the MV3 service worker, render every page, save settings, fake-mic recording, pause/resume, IndexedDB persistence/audio playback, and no-secret checks.
- **Manual (documented, not automated):** tab capture with real audible media, real provider transcription/AI, service-worker kill/recovery, folder permission flows. Synthetic fixtures are used where possible.

## How to run

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
xvfb-run -a npm run test:e2e   # extension loading needs headed Chrome; Xvfb supplies a display on Linux
npm audit
```

On a desktop with a display, `npm run test:e2e` also works after changing the test context to headed mode; the checked-in test intentionally uses headed Chrome because Chromium's headless shell disables extension loading.

## Scenarios (from the master directive §12)

| # | Scenario | Status | Notes |
|---|---|---|---|
| 1 | Load unpacked extension | ✅ Automated | Playwright `chromium.launchPersistentContext` + `--disable-extensions-except`/`--load-extension`; service worker URL and root `dist/manifest.json` verified |
| 2 | Open popup + side panel | ✅ Automated | Real extension URLs; DOM + page-error assertions |
| 3 | Start test recording | ✅ Automated for mic; ⚠️ tab manual | Fake mic stream starts through popup → SW → offscreen; real tab audio needs an audible tab + user gesture |
| 4 | Capture synthetic tab audio | ⚠️ Manual | Play a tone/video in a Chrome tab and verify the saved `IndexedDB/audio` Blob; `tabCapture` is not reliable in headless automation |
| 5 | Capture microphone with permission | ✅ Automated smoke | Playwright fake media flags + `--use-fake-ui-for-media-stream`; real microphone remains a manual privacy check |
| 6 | Verify playback still works | ✅ Code + manual | Offscreen routes tab stream through `AudioContext.destination`; manual audible check still required |
| 7 | Pause and resume | ✅ Automated | Fake-mic e2e clicks Pause/Resume and asserts state transitions |
| 8 | Stop and persist recording | ✅ Automated | E2e opens Dashboard, finds the meeting, opens detail, and finds the saved audio `<audio>` element |
| 9 | Service-worker suspension/recovery | ✅ Code-tested; ⚠️ manual kill | Recording state uses `chrome.storage.session`; `onStartup` marks interrupted sessions as `error`; actual kill/restart should be checked in installed Chrome |
| 10 | Transcribe test recording | ⚠️ Manual/provider fixture | Cloud Whisper adapter is implemented; a live provider call needs the user's own key and is never run in CI |
| 11 | Generate and save summary | ✅ Unit + implemented auto/manual paths | JSON response parsing is unit-tested; automatic post-stop path runs only when Cloud transcription + BYOK are configured |
| 12 | Search by date/topic | ✅ Automated unit | `searchMeetings`, `searchByDate`, `searchByTopic` |
| 13 | Cross-meeting Q&A | ⚠️ Manual/provider fixture | Grounding prompt and source list are implemented; live Q&A needs a configured model |
| 14 | Verify source timestamps | ✅ Unit + implemented | Transcript segments, snippets, and prompt citation format use timestamps; live model citation quality remains provider-dependent |
| 15 | Export and reopen memory files | ✅ Unit + manual folder | Markdown/JSON serialization is deterministic; File System Access permission/reopen is manual in installed Chrome |
| 16 | Denied folder/mic permissions | ✅ Code paths; ⚠️ manual UI | Permission errors surface and download fallback exists; browser permission dialogs need manual validation |
| 17 | Provider failures / invalid keys | ✅ Code-tested | Non-2xx responses become bounded user-facing errors; keys are not included in error text by the adapters |
| 18 | No secrets in logs/repository | ✅ Automated | E2e scans all bundled JS/HTML for token-like values; `npm audit` also runs |

## Actual verification run

**2026-11-19 (local workspace):**

- `npm run typecheck` — passed.
- `npm run lint` — passed (ESLint flat config, zero errors/warnings).
- `npm test -- --run` — **4 files, 15 tests passed**.
- `npm run build` — passed; Vite 8.3.8 produced a packaged MV3 extension with root `manifest.json`, `background.js`, popup/sidepanel/dashboard/settings/offscreen pages, assets, and icons.
- `xvfb-run -a npm run test:e2e` — **5 tests passed**: page rendering, fake-mic pause/resume + persistence/audio playback, settings persistence, and bundled-secret scan.
- `npm audit` — **0 vulnerabilities** (production and development trees at the time of this run).

## Known limitations (honest)

- Playwright does not prove real `tabCapture` on every meeting platform; that needs an audible tab and a real user gesture.
- Fake media proves the pipeline wiring, not microphone acoustics or echo behavior.
- AI/transcription calls require a real BYOK key; tests never use the user's key.
- Real Chrome permissions, folder persistence after a browser restart, and service-worker kill recovery remain manual acceptance checks.

## Results — transcript editing, question suggestions, MCP companion

Run on 2026-11-19, Node 22, Playwright 1.5x with full Chromium (`channel: 'chromium'`, new headless). Numbers below are from actual runs of the commands shown.

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (0 errors, 0 warnings) |
| `npm test` | **51 / 51 passed** (7 files) |
| `npm run build` | pass |
| `npm run build:companion && npm run test:companion` | pass — real stdio session against the built binary |
| `npx playwright test` | **11 / 11 passed** (5 existing + 6 new) |
| `npm audit --omit=dev` | 0 vulnerabilities |

### Headless extension testing (no Xvfb needed)

Chromium's *headless shell* cannot load extensions, but the full Chromium build in **new headless** mode can. `extensionContext()` now uses `channel: 'chromium', headless: true` by default; set `PW_HEADED=1` to run headed (e.g. `xvfb-run -a`). On a minimal Linux image you may need Chromium's shared libraries (`npx playwright install-deps chromium`, needs root).

### New browser scenarios (`tests/e2e/editing-suggestions.spec.ts`)

Fixtures are seeded directly into the extension's IndexedDB; provider traffic is intercepted by Playwright routes (no network, no real keys).

- Edit a segment → persisted with `edited` + `originalText`, `transcriptText` rebuilt, summary flagged stale, survives reload, revert restores the original.
- Empty edit rejected with a visible error; nothing written.
- Assign a speaker name → all segments + `participants` updated and persisted.
- Re-summarize → the provider receives the **edited** text (not the original), stale flag cleared, user edits survive.
- Provider failure (HTTP 401) → error shown, button re-enabled, meeting untouched.
- Suggestions: AI opt-in unchecked by default; follow-ups from memory shown; pasted text yields owner / deadline / rationale questions with verbatim evidence; dismiss works; clear works; no page errors.

### Not covered by automation (honest gaps)

- **Real tab audio** (`tabCapture`) and real microphone speech: need a user gesture / audible media. The fake-device mic path is covered; live Web Speech partials feeding the suggestions panel are exercised only through the pasted-text path and unit tests, not an end-to-end live recognizer.
- **Real LLM quality** for suggestions/summaries: only fakes and routed fixtures are used. The LLM suggestion path is protected by a deterministic grounding filter (tested), but output quality with real models is unmeasured.
- **Service-worker suspension/recovery**, **folder-permission denial flows** and the **File System Access picker** cannot be driven in headless Chromium.
- **MCP host interop**: the companion is verified against its own stdio client, not yet against Claude Desktop / Cursor.

