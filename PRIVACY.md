# MeetDolff — Privacy & Data Handling

## What MeetDolff collects
- **Meeting audio** (only when you click Record): tab audio and/or mic, as you choose.
- **Transcripts, summaries, decisions, actions** derived from that audio.
- **Calendar events** you create.
- **Settings** (provider base URL, model names, API keys).

## Where it lives
- **IndexedDB (`meetdolff`)** on your device: meetings, audio blobs, calendar, projects, folder handle.
- **`chrome.storage.local`**: provider settings + API keys. **Never** `chrome.storage.sync`.
- **Your chosen folder** (optional): portable `.md`/`.json` exports. You control the location.
- **Nowhere else** — no analytics, no tracking, no remote code, no third-party SDKs.

## When data leaves your device
Only when **you** configure it:
1. **AI provider** (your base URL + key): transcript/summary prompts sent for summarization/Q&A. No other data sent.
2. **Cloud transcription** (if enabled): recorded audio blob sent to your Whisper endpoint. Cloud + chat BYOK can trigger post-stop processing; otherwise use the explicit Transcribe/Summarize buttons.
3. **Web search** (if enabled): query sent to Tavily/Brave. Labeled “external” in UI, never mixed with memory; URLs are displayed.
4. **Export**: files written only to the folder you pick, or downloaded by you.

MeetDolff never sends data to MeetDolff servers (there are none).

## Recording consent
- Recording starts **only** on your click (popup/action). No background recording, no auto-start.
- Visible indicator: red `REC` badge + popup timer + offscreen document.
- You can pause/stop anytime. Interrupted sessions surface an `error` state — no silent capture.

## API keys
- Stored in `chrome.storage.local` only.
- Never logged, never in URLs, never exposed to page/content scripts.
- Sent only to the provider base URL you configured (HTTPS).
- Revoke/rotate keys at the provider; delete locally via Settings → Wipe.

## Deletion & retention
- **Per meeting:** Dashboard → Delete (removes metadata + audio).
- **All data:** Settings → Delete all local data (IndexedDB + settings).
- **Folder exports:** delete the folder yourself; MeetDolff cannot retract exported files.
- No retention policy to enforce — data lives until you delete it.

## Permissions (minimal)
| Permission | Why |
|---|---|
| `tabCapture` | Capture active-tab audio on your click |
| `offscreen` | Host `MediaRecorder` (SW cannot) |
| `storage` | Session state + local settings |
| `sidePanel` | Persistent side-panel UI |
| `activeTab` | Know which tab to capture |

No required `host_permissions`, no `history`, no `cookies`, no `webRequest`, no remote code. Provider/search origins are declared optional and requested only when the user configures those services.

## Chrome Web Store disclosures (prepared)
- **Single purpose:** AI meeting memory (record/transcribe/summarize/search).
- **Data use:** audio/transcripts processed locally; sent only to user-configured AI/transcription endpoints.
- **Data retention:** user-controlled; no server retention.
- **Remote code:** none. All code bundled locally.

## External agent access (MCP)
- Default: **no external access**.
- If you run the local companion, it uses a revocable token, scoped read-only tools, and rate limits. Writes require your explicit approval in the extension.
