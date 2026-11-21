# MeetDolff — Product Review, Market Research & v0.2 Changes

Date: 2026-11-21 · Reviewer: agent pass (research → audit → build → verify)
Scope: the v0.1.0 extension as merged on 2026-11-19 (`8f88cc0`), plus the v0.2.0 changes in this branch.

This document answers one question: **why would this not go to waste?**
Feature breadth was never the risk. The risk is a first-run user who records one meeting, gets
nothing useful back, and never returns. Everything below is ordered by that risk.

---

## 1. What the market actually rewards (2026 research)

| Finding | Source |
|---|---|
| Granola went from a $250M to a $1.5B valuation in under a year; revenue grew 250% in a quarter, with **near-zero churn** and asymmetric switching (people drop Otter/Fathom/Fireflies *for* Granola, not the reverse). | YipitData spend panel, Apr–Jun 2026 |
| The category split that decides winners is **bot vs. no-bot**. Google Meet began flagging and denying third-party notetaker bots by default in March 2026. | Grey Journal, Jun 2026 |
| Fathom wins the long tail because its free tier is genuinely useful — "it understood that the real competition isn't other notetakers, it's the user doing nothing." | Luminix category report, May 2026 |
| Granola's mechanism is not a better transcript. It is **"your notes, enhanced"** — the transcript is an input, the user's own thinking is the artifact. Users consistently say a wall of transcript is the thing they don't want. | Reddit/G2 synthesis, May 2026 |
| Churn concentrates in: accuracy failures on group calls, privacy discomfort, and **lock-in with no bulk export**. | Luminix, May 2026 |

### What that means for MeetDolff

MeetDolff is already on the right side of the biggest axis: **no bot, local-first, user-owned
files.** Tab capture is structurally the same bet Granola made, and the market just rewarded it.
Three of its differentiators are genuine and defensible:

1. **Bot-free capture** — no one joins the call; nothing to explain to a client.
2. **Portable memory** — `index.json` + `meetings/*.md|json` you can `grep` without us.
3. **Provider independence** — BYOK, including a local Ollama; the model is a setting, not a lock-in.

But v0.1 lost on the axis that actually drives retention:

- **It produced transcripts, not answers.** The dashboard's primary surface was a list of
  recordings. Granola's lesson is that people want the 5 things that matter, attached to the
  meeting they just had — not a 10,000-word artifact.
- **It had no first run.** An empty dashboard said *"No meetings match."* — a search result for a
  search nobody ran. No key configured, no guidance, no path to a first answer.
- **It made silent decisions for the user.** Every AI action in the side panel operated on
  `listMeetings(1)[0]` — "whatever is newest" — while showing no indication of which meeting that
  was. In a product whose whole promise is *grounded, attributable* output, acting on an
  unstated target is the worst possible failure mode.

---

## 2. What was broken (found by reading the code and driving the real extension)

Priority: **P0** = loses the user or breaks trust, **P1** = degrades the core loop, **P2** = polish.

| # | Issue | Sev | Where |
|---|---|---|---|
| 1 | Settings told the user their API key "stays in `chrome.storage.local`". It does not — it is AES-GCM encrypted in a separate IndexedDB vault. The one page a user checks to decide whether to trust the product contained a false privacy claim. | **P0** | `src/settings/settings.html` |
| 2 | Every side-panel action silently targeted the newest meeting, with no visible target and no way to choose. Wrong-meeting summaries, wrong-meeting project plans. | **P0** | `src/sidepanel/sidepanel.ts` |
| 3 | First run showed "No meetings match." with no setup path. A new user who has not added a key gets an empty transcript and no explanation why. | **P0** | `src/dashboard/dashboard.ts` |
| 4 | Raw machine values in the UI: `2460s` instead of `41 min`; `1 decisions`, `1 actions`; calendar rows printed the internal colour token (`paper`, `muted`) and an ISO date slice. | **P1** | dashboard, side panel |
| 5 | Clicking a meeting on a narrow window updated a detail pane that was *below the fold* — the click looked like a no-op. No selected state on the row. | **P1** | `src/dashboard/dashboard.ts` |
| 6 | Popup had three controls for one decision: "Record tab", "Record mic", and an "Audio source" select. "Record tab" actually honoured the select, so the two buttons could disagree. | **P1** | `src/popup/popup.ts` |
| 7 | The popup never said **which tab** would be captured — the single most important consent fact in a meeting recorder. | **P1** | `src/popup/popup.html` |
| 8 | A user-facing string pointed at `ARCHITECTURE.md`. | **P2** | `src/popup/popup.html` |
| 9 | `formatDuration()` existed in `src/lib/utils/id.ts` and was **imported by nothing**; three call sites hand-rolled `${durationSec}s` instead. | **P2** | `src/lib/utils/id.ts` |
| 10 | `.hero { display: grid }` overrode the UA `[hidden]` rule, so hidden regions still rendered. Caught by a test, not by eye. | **P1** | `design-system.css` |
| 11 | `formatDuration(3599)` returned `"60 min"`. Caught by a unit test. | **P2** | new `format.ts` |
| 12 | Calendar event deletion had no accessible name, and no confirmation. | **P2** | dashboard |
| 13 | No navigation between dashboard and settings; each page was an island. | **P2** | both |
| 14 | Contrast: `--faint: #737373` on `#0a0a0a` is ~4.2:1 — under AA for the 12px meta text it was used for. | **P2** | `design-system.css` |

---

## 3. What changed in v0.2.0

### Product

**A visible target, everywhere.** The side panel now has an `Acting on …` selector (defaults to
newest, *shown*), a fact line for the selected meeting (`41 min · 5 segments · 1 decision ·
summarized`), and disabled buttons with reasons when the target has no transcript or no audio.
Recent-meeting rows set the target. Regression-tested: summarizing the older meeting must not
touch the newer one (`tests/e2e/extension.spec.ts`).

**A first run that leads somewhere.** With empty memory the dashboard shows a three-step
checklist (connect a provider → record → transcribe), each step marked done from real state, plus
an explanation of what runs where. It disappears the moment a meeting exists.

**A latest-meeting recap.** The dashboard opens with the newest meeting's summary, its open
action items with owners, and a fact line — "what did we just decide" answered before the user
searches for it. Empty sub-states say which action produces the missing piece.

**One decision in the popup.** A segmented source control (Tab / Mic / Tab + mic, remembered) and
one Start button. The popup names the tab it will capture and flags a detected meeting URL. After
saving, it shows a recap of the meeting that was just written rather than a bare "Saved".

**Honest copy.** The settings page states where keys actually live. Conditional fields appear only
for the adapter in use. A "What this can and cannot capture" disclosure lists the real limits —
tabs only, no desktop apps, no diarization — where a user will actually read it.

### Design system (Armory: `frontend-design` + `web-design-guidelines`)

Applied as a review layer, not a library. The editorial black-and-white direction was kept — it is
distinctive and appropriate — and sharpened:

- Spacing scale (`--s1…--s10`) and type scale (`--t-label…--t-display`); serif for voice
  (titles, summaries), mono for facts (timestamps, counts, keys), sans for prose.
- An app bar with real navigation and an `aria-current` state, replacing page islands.
- Every interactive surface has hover / focus-visible / active / disabled states; one focus
  treatment everywhere.
- Contrast fixed (`--faint` → `#8c8c8c`, 5.4:1); `color-scheme: dark` so native date pickers,
  selects, radios and scrollbars stop rendering as white blocks.
- Master/detail with `aria-current` on the selected row, a sticky detail pane on wide viewports
  and an auto-hidden idle pane on narrow ones (no dead pixels, no invisible click target).
- Empty states rewritten to say **what to do next**; error/warn/ok boxes gained a semantic left
  border and consistent type size; skeletons exist for text that is about to arrive.

No component library, no GSAP, no 3D. The Armory's own selection rule ("design direction first,
smallest tech set") was applied and the answer was: CSS only.

---

## 4. Verification (all of it re-run, not asserted)

Environment: Chromium 159 (Playwright 1.65), Node 20, new headless mode, unpacked `dist/`.

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean (0 errors, 0 warnings) |
| Unit | `npm test` | **78 passed** (10 files) — was 63; +15 formatter tests |
| Build | `npm run build` | packaged MV3, 5 root HTML pages |
| Browser e2e | `MEETDOLFF_HEADLESS=1 npm run test:e2e` | **12 passed** — was 7 |
| Accessibility | `npm run audit:a11y` | **0 violations** (axe-core, WCAG 2.1 A/AA) across popup, side panel, dashboard, dashboard-detail, settings; 0 structural issues (duplicate ids, unnamed controls, heading order, landmarks) |
| Visual | `npm run audit:shots` | screenshots at real surface sizes (380 popup, 400 side panel, 1180 and 620 dashboard) |

New regression tests, each covering a defect above:

1. First run shows the setup checklist, never "No meetings match"; it hides once memory is non-empty.
2. Durations and plurals are humanized — asserts the absence of `2460s`, `1 decisions`, `1 segment`.
3. Selecting a meeting sets `aria-current`, switches the detail pane, and reveals it on a narrow viewport.
4. The side panel acts on the **selected** meeting: the fake provider receives the older meeting's
   text and the newer meeting's summary is unchanged afterwards.
5. The popup names its capture target, exposes exactly one start control and three source options,
   and leaks no developer-doc references.

Bug found by the new tests and fixed: `[hidden]` being overridden by component `display` rules.

---

## 5. What is still missing — ranked for the next pass

The market says the biggest remaining gap is the one MeetDolff has not closed: **Granola's core
loop is "your notes, enhanced."** MeetDolff still has no way for a user to type during a meeting
and have the AI merge their rough notes with the transcript. That is a product-shaped hole, not a
polish item, and it is the single highest-value next feature.

Second: **recording is still invisible while you are in the call.** The REC badge lives on the
toolbar icon; there is no in-page indicator and no in-call elapsed time. Every serious competitor
shows the user that capture is live. (An overlay content script would need a new permission and a
deliberate policy decision about host access — worth doing, worth doing carefully.)

Third, in descending value:

1. **Notes-merge loop** (above): a notes box in the side panel, transcript-aware enhancement.
2. **In-call recording indicator** + elapsed timer.
3. **Diarization adapter** (Pyannote or similar) — the transcript editor already supports manual
   speaker labels, so the UI is ready.
4. **Per-operation models + streaming** — one chat model for everything is a cost/quality compromise.
5. **Recurring meeting series** — "the weekly product review" is currently N unrelated meetings;
   grouping them is cheap and high-value for the "what changed since last week" question.
6. **Local Whisper adapter preset** (faster-whisper / whisper.cpp) — the OpenAI-compatible adapter
   already works against a local server; it needs a UI preset and docs, not new code.
7. **Bulk export + import round-trip test** — the anti-lock-in claim deserves a test that proves it.

Deliberately *not* recommended, despite being on the old roadmap: the flashcard/quiz/mind-map
artifact set. It is deterministic filler that competes for the side panel's prime space with the
one thing people actually use (chat). It was demoted behind a disclosure rather than expanded.
