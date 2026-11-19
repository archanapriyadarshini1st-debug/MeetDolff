/**
 * MCP (Model Context Protocol) tools over HTTP JSON-RPC.
 * Every tool is read-only. There is deliberately no write tool: changing a
 * user's data needs the owner's explicit approval in the extension UI.
 */
import { ValidationError, generateReport, getMeeting, listActionItems, listDecisions, searchMeetings } from "@/lib/memory";

export const PROTOCOL_VERSION = "2025-06-18";
export const SERVER_INFO = { name: "meetdolff-companion", version: "0.1.0" };

const isoDate = { type: "string", description: "ISO 8601 date or datetime" } as const;

export const TOOLS = [
  {
    name: "search_meetings",
    description: "Full-text search over meeting titles, summaries, decisions, action items and transcripts. Returns ranked hits with the meeting id, start time and the transcript timestamp of the first match so answers can be cited. Use from/to to answer time-based questions such as 'last Tuesday evening' (resolve the date yourself first).",
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 2 }, from: isoDate, to: isoDate, limit: { type: "integer", minimum: 1, maximum: 25, default: 10 } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "get_meeting",
    description: "Fetch one meeting: summary, topics, decisions, action items, open questions and (optionally) the full timestamped transcript.",
    inputSchema: { type: "object", properties: { meetingId: { type: "string" }, includeTranscript: { type: "boolean", default: false } }, required: ["meetingId"], additionalProperties: false },
  },
  {
    name: "list_decisions",
    description: "Decisions recorded across meetings, newest first, optionally filtered by topic text and date range. Each item names its source meeting.",
    inputSchema: { type: "object", properties: { topic: { type: "string" }, from: isoDate, to: isoDate }, additionalProperties: false },
  },
  {
    name: "list_action_items",
    description: "Action items across meetings with the owner and deadline only where the meeting stated them (otherwise null).",
    inputSchema: { type: "object", properties: { from: isoDate, to: isoDate }, additionalProperties: false },
  },
  {
    name: "generate_report",
    description: "Markdown report for one meeting, assembled deterministically from stored memory (no model, nothing invented).",
    inputSchema: { type: "object", properties: { meetingId: { type: "string" } }, required: ["meetingId"], additionalProperties: false },
  },
] as const;

const optStr = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search_meetings":
      return searchMeetings({ query: String(args.query ?? ""), from: optStr(args.from), to: optStr(args.to), limit: typeof args.limit === "number" ? args.limit : undefined });
    case "get_meeting": {
      const m = await getMeeting(String(args.meetingId ?? ""), args.includeTranscript === true);
      if (!m) throw new ValidationError("No meeting with that id is in memory.");
      return m;
    }
    case "list_decisions":
      return listDecisions(optStr(args.topic), { from: optStr(args.from), to: optStr(args.to) });
    case "list_action_items":
      return listActionItems({ from: optStr(args.from), to: optStr(args.to) });
    case "generate_report": {
      const md = await generateReport(String(args.meetingId ?? ""));
      if (!md) throw new ValidationError("No meeting with that id is in memory.");
      return { markdown: md };
    }
    default:
      throw new ValidationError(`Unknown tool: ${name}`);
  }
}
