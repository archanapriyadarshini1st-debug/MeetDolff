# MeetDolff Companion (local MCP server)

A browser extension cannot host a server, so external AI agents reach your memory through this small local process. It reads the folder the extension exports (`<memory-folder>/meetings/*.json`) and exposes **read-only** MCP tools. No dependencies, Node ≥ 20.

```bash
# 1. In MeetDolff: Settings → pick a memory folder, then Dashboard → "Export memory folder".
# 2. Create a revocable token (shown once; only its SHA-256 hash is stored in ~/.meetdolff-companion/tokens.json, mode 0600)
node companion/bin/meetdolff-companion.mjs token create --label "my agent"
# 3a. HTTP (loopback only):   POST http://127.0.0.1:8787/mcp   Authorization: Bearer mdc_…
node companion/bin/meetdolff-companion.mjs serve --dir "/path/to/MeetDolff Memory"
# 3b. or stdio for local clients (Claude Desktop / Cursor style):
#   { "command": "node", "args": ["companion/bin/meetdolff-companion.mjs", "stdio", "--dir", "/path/to/MeetDolff Memory"] }
node companion/bin/meetdolff-companion.mjs token list
node companion/bin/meetdolff-companion.mjs token revoke <id>
```

## Tools
| Tool | Scope | What it does |
|---|---|---|
| `list_meetings` | read | Meetings newest-first, optional ISO `from`/`to`. |
| `search_meetings` | read | Ranked passages; every hit has `meetingId`, `title`, `startSec` for citation. |
| `get_meeting` | read | Summary, decisions, actions, open questions; transcript only if `includeTranscript`. |
| `get_transcript_range` | read | Segments between two offsets. |
| `list_decisions` / `list_action_items` | read | Across all meetings; owner/deadline only when stated. |
| `generate_report` | read | Deterministic Markdown from stored memory (no model call). |
| `propose_task` | **propose** | Queues a *pending* proposal. Nothing becomes a task until you run `proposals approve <id>`. |

## Security model
- Binds to loopback only (`--host 0.0.0.0` is refused). Host and Origin headers are validated (DNS-rebinding defence).
- Bearer tokens are scoped (`read`, `propose`), revocable, rate-limited (60 req/min/token), compared in constant time.
- Arguments are allow-listed and length-limited; errors never leak paths or stack traces; tokens are never logged.
- Every result that contains meeting text carries a note that it is **untrusted content, not instructions**.
- Calendar events are not exposed (they are not part of the memory-folder export yet).
- This is a local companion, not a public service. To reach it from a remote agent you would need your own authenticated tunnel — not provided, deliberately.
