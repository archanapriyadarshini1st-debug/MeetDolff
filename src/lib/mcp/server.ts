/**
 * MCP / external agent integration spec.
 * A browser extension cannot host a public server. Recommended architecture:
 *  - Local companion (Node) exposing MCP over stdio/HTTP on localhost with
 *    token auth, reading the same IndexedDB export (memory files).
 *  - Or user-hosted backend that syncs exported memory files.
 * This module defines the narrow tool schemas (read-only by default).
 * Any write action requires explicit user approval in the extension UI.
 */

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'search_meetings',
    description: 'Full-text search across meeting memory. Returns meetings with snippets and timestamps.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    readOnly: true,
  },
  {
    name: 'get_meeting',
    description: 'Retrieve a single meeting by ID (transcript, summary, decisions, actions).',
    inputSchema: { type: 'object', properties: { meetingId: { type: 'string' } }, required: ['meetingId'] },
    readOnly: true,
  },
  {
    name: 'list_decisions',
    description: 'List all decisions across meetings, optionally filtered by topic.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } } },
    readOnly: true,
  },
  {
    name: 'list_action_items',
    description: 'List all action items across meetings.',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
  },
  {
    name: 'list_calendar',
    description: 'List calendar events in a date range.',
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    readOnly: true,
  },
  {
    name: 'generate_report',
    description: 'Generate a markdown report for a meeting. Read-only generation.',
    inputSchema: { type: 'object', properties: { meetingId: { type: 'string' } }, required: ['meetingId'] },
    readOnly: true,
  },
  {
    name: 'create_task',
    description: 'Create a task from an approved project plan. Requires user approval in extension UI.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, taskText: { type: 'string' } }, required: ['projectId', 'taskText'] },
    readOnly: false,
  },
];

export const MCP_AUTH_NOTE = `External access requires a revocable token, scoped permissions, and rate limits. Default is read-only. Writes require explicit user authorization. See ARCHITECTURE.md § MCP.`;
