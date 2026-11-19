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

## Verification run — v0.2 additions (live questions, Capture moment, transcript editing)

Run in a sandbox with **no display and no root**: Playwright's full Chromium in new headless mode (`PW_HEADLESS=1`, supports extensions) with the missing system libraries unpacked into a user directory and exposed via `LD_LIBRARY_PATH`.

- `npm run typecheck` — passed. `npm run lint` — passed.
- `npm test` — **7 files, 34 tests passed** (19 new: transcript editing, suggestion rules/AI parsing/throttling, snapshot timing helpers).
- `npm run build` — passed (DB schema v3 adds a `snapshots` store; no new permissions).
- `PW_HEADLESS=1 npx playwright test` — **8 passed** (5 pre-existing + 3 new, real unpacked extension):
  1. Seeds IndexedDB, opens the dashboard, links a screenshot to the nearby segment only, decodes the stored blob, edits text + speaker, verifies the *edited* tag and preserved original, reloads and verifies persistence, and verifies that empty text is rejected visibly.
  2. Sends live-segment messages to the side panel; verifies rule-based questions, dismissal, the AI opt-in default (off) and its persistence.
  3. Capture moment: refuses when idle; during a fake-mic recording it hit Chrome's `activeTab` restriction and showed the guidance message. **A successful real capture was NOT verified here** — it needs the toolbar icon clicked on a real meeting tab (manual check).
- Bug found by these tests and fixed: the service worker never answered `LIVE_SEGMENT`, leaving the sender's channel open (now acknowledged).

Headed-Chrome runs (`xvfb-run -a npm run test:e2e`) behave as before; `PW_HEADLESS=1` is opt-in.

## Known limitations (honest)

- Capture moment: real screenshot success depends on `activeTab` (user clicked the MeetDolff icon on that tab). Not verified in automation.
- Live suggestions are verified on synthetic segments; real Web Speech recognition quality is not automatable and was not tested.
- Rule-based suggestions are English-only keyword heuristics, not understanding.

- Playwright does not prove real `tabCapture` on every meeting platform; that needs an audible tab and a real user gesture.
- Fake media proves the pipeline wiring, not microphone acoustics or echo behavior.
- AI/transcription calls require a real BYOK key; tests never use the user's key.
- Real Chrome permissions, folder persistence after a browser restart, and service-worker kill recovery remain manual acceptance checks.
