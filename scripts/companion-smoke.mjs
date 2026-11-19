/* global console */
// End-to-end smoke test: spawn the BUILT companion over real stdio and speak MCP to it.
// Run: npm run build:companion && npm run test:companion
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const bin = resolve('dist-companion/meetdolff-mcp.mjs');
const dir = await mkdtemp(join(tmpdir(), 'meetdolff-smoke-'));
await mkdir(join(dir, 'meetings'));
const meeting = {
  id: 'meeting-001', title: 'Smoke test sync', startedAt: '2026-11-17T19:00:00.000Z', endedAt: '2026-11-17T19:10:00.000Z', durationSec: 600,
  participants: [], transcript: [{ id: 's1', start: 3, end: 8, speaker: null, text: 'We decided to use SQLite full text search.' }],
  transcriptText: 'We decided to use SQLite full text search.', summary: 'Chose SQLite FTS.', topics: ['search'],
  decisions: [{ text: 'Use SQLite FTS', evidence: ['[00:03]'] }], actionItems: [], openQuestions: [], commitments: [], project: null,
  audioSource: 'mic', audioMime: null, hasAudio: false, memoryVersion: 1, createdAt: '', updatedAt: '',
};
await writeFile(join(dir, 'meetings', 'meeting-001.json'), JSON.stringify(meeting));
const filesBefore = (await readdir(join(dir, 'meetings'))).sort();

const child = spawn(process.execPath, [bin, '--memory-dir', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
const waiting = new Map();
createInterface({ input: child.stdout }).on('line', (l) => {
  const msg = JSON.parse(l); // throws if anything but JSON reaches stdout
  waiting.get(msg.id)?.(msg);
});
let nextId = 1;
const rpc = (method, params) => new Promise((res, rej) => {
  const id = nextId++;
  const t = setTimeout(() => rej(new Error(`timeout waiting for ${method}`)), 5000);
  waiting.set(id, (m) => { clearTimeout(t); res(m); });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
});

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'meetdolff-memory');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const list = await rpc('tools/list');
  assert.ok(list.result.tools.length >= 6 && list.result.tools.every((t) => t.annotations.readOnlyHint));
  const search = await rpc('tools/call', { name: 'search_meetings', arguments: { query: 'sqlite' } });
  assert.equal(search.result.structuredContent.results[0].meetingId, 'meeting-001');
  const got = await rpc('tools/call', { name: 'get_meeting', arguments: { meetingId: 'meeting-001' } });
  assert.equal(got.result.structuredContent.transcript[0].at, '00:03');
  const bad = await rpc('tools/call', { name: 'get_meeting', arguments: { meetingId: '../x' } });
  assert.equal(bad.result.isError, true);
  assert.deepEqual((await readdir(join(dir, 'meetings'))).sort(), filesBefore, 'server must not write to memory');
  assert.ok(!/ak_|sk-/.test(stderr), 'no key-like strings in stderr');
  console.log('companion smoke test: PASS (initialize, tools/list, search, get_meeting, bad id, read-only)');
} finally {
  child.kill();
  await rm(dir, { recursive: true, force: true });
}
