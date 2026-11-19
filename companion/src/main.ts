/**
 * MeetDolff memory companion — stdio MCP server entry point.
 *
 *   node meetdolff-mcp.mjs --memory-dir "/path/to/MeetDolff Memory"
 *
 * stdout carries ONLY newline-delimited JSON-RPC. All diagnostics go to stderr.
 */

import { createInterface } from 'node:readline';
import { handleMessage } from './protocol.js';
import { loadMemory } from './store.js';

function memoryDirFromArgs(argv: string[]): string | undefined {
  const i = argv.indexOf('--memory-dir');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return process.env.MEETDOLFF_MEMORY_DIR || undefined;
}

const dir = memoryDirFromArgs(process.argv.slice(2));
if (!dir) {
  process.stderr.write('meetdolff-mcp: pass --memory-dir <folder> or set MEETDOLFF_MEMORY_DIR.\n');
  process.exit(2);
}

const memory = () => loadMemory(dir);
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Set<Promise<void>>();

rl.on('line', (raw) => {
  const text = raw.trim();
  if (!text) return;
  const job = (async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    const reply = await handleMessage(parsed, memory);
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
  })().finally(() => pending.delete(job));
  pending.add(job);
});

rl.on('close', () => {
  void Promise.allSettled([...pending]).then(() => process.exit(0));
});
process.stderr.write(`meetdolff-mcp: read-only server ready (memory: ${dir})\n`);
