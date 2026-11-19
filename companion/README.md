# MeetDolff memory companion (MCP, read-only)

A small local process that lets an MCP-capable AI agent (Claude Desktop, Cursor, Claude Code, any MCP host) **search and read your exported MeetDolff memory**. A browser extension cannot host a server, so this runs on your machine, reads the `MeetDolff Memory/` folder the extension exports, and talks to the agent over **stdio**.

**Status: implemented and tested (v0.1).** Read-only by construction.

## Run

```bash
npm install
npm run build:companion            # -> dist-companion/meetdolff-mcp.mjs (single file, no runtime deps)
node dist-companion/meetdolff-mcp.mjs --memory-dir "/path/to/MeetDolff Memory"
# or: MEETDOLFF_MEMORY_DIR="/path/to/MeetDolff Memory" node dist-companion/meetdolff-mcp.mjs
```

First export meetings from the extension (Dashboard → *Export to folder* / *Export all*). The server re-reads the folder on every call, so a fresh export is visible immediately. `--memory-dir` may point at the memory root or directly at `meetings/`.

### MCP host configuration (example)

```json
{
  "mcpServers": {
    "meetdolff": {
      "command": "node",
      "args": ["/absolute/path/to/MeetDolff/dist-companion/meetdolff-mcp.mjs", "--memory-dir", "/absolute/path/to/MeetDolff Memory"]
    }
  }
}
```

## Tools (all `readOnlyHint: true`, strict schemas)

| Tool | Purpose |
|---|---|
| `list_meetings` | Meetings newest-first, optional inclusive ISO date range (`from`, `to`) — "what met last Tuesday?" |
| `search_meetings` | Full-text search (same ranking as the extension) with `**bold**` snippets |
| `get_meeting` | Summary, decisions, action items, open questions, timestamped transcript with segment ids |
| `get_transcript_range` | Transcript lines between two offsets, for exact `[mm:ss]` citations |
| `list_decisions` | Decisions across meetings, optional topic filter |
| `list_action_items` | Action items across meetings; owner/deadline are `null` unless explicitly stated |
| `generate_report` | Deterministic Markdown report (no AI call) |

**Not offered (on purpose):** `list_calendar` and `create_task` from `src/lib/mcp/server.ts`. Calendar events and project plans live in the extension's IndexedDB and are not exported, and any write must go through explicit user approval in the extension UI — a stdio process cannot show that prompt.

## Security model

- **Read-only**: no tool writes, deletes, sends or executes anything; verified by tests that snapshot the folder before/after.
- **stdio only**: no listening socket, so nothing is reachable from the network and there is no token to leak. The MCP host that spawns the process owns the pipe. (A future HTTP transport would need bearer-token auth, origin checks, scopes and rate limits — not built.)
- **Untrusted content**: transcripts are speech from other people. Results carry a `notice` telling agents to treat them as data, never instructions. This reduces — it does not eliminate — prompt-injection risk; hosts should still require confirmation for any tool that acts.
- **Input validation**: meeting ids must match `^[A-Za-z0-9._-]{1,128}$` (no path traversal); files over 20 MB are skipped; malformed records are reported as `warnings`, never trusted.
- **No secrets**: the companion never reads extension settings or API keys; stdout carries only JSON-RPC, diagnostics go to stderr.

## Tests

- `tests/unit/companion.test.ts` — protocol, store, every tool, bad input, traversal ids, read-only guarantee.
- `npm run test:companion` — spawns the **built** binary and speaks MCP over real stdio.
