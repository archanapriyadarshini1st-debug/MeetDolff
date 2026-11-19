#!/usr/bin/env node
// MeetDolff companion CLI: serve (HTTP), stdio, token, proposals.
import readline from 'node:readline';
import { ProposalStore, SCOPES, TokenStore } from '../src/auth.mjs';
import { assertLoopback, createServer } from '../src/http.mjs';
import { handleBody } from '../src/rpc.mjs';
import { MemoryStore } from '../src/store.mjs';

const [cmd, sub, ...rest] = process.argv.slice(2);
const flag = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? def : process.argv[i + 1]; };
const log = (s) => process.stderr.write(`[meetdolff-companion] ${s}\n`); // stdout is reserved for MCP on stdio

const help = `MeetDolff companion — local, read-only MCP access to your exported memory folder

  serve  --dir <memory-folder> [--port 8787] [--host 127.0.0.1]   HTTP MCP at POST /mcp (bearer token)
  stdio  --dir <memory-folder> [--scopes read[,propose]]          MCP over stdin/stdout (for local clients)
  token create --label <name> [--scopes read[,propose]]           print a new token ONCE
  token list | token revoke <id>
  proposals list | proposals approve <id> | proposals reject <id>`;

async function main() {
  const tokens = new TokenStore(), proposals = new ProposalStore();
  if (cmd === 'token') {
    if (sub === 'create') {
      const scopes = String(flag('scopes', 'read')).split(',').map((s) => s.trim()).filter(Boolean);
      const { token, record } = await tokens.create(flag('label', 'unnamed'), scopes);
      console.log(`Token id: ${record.id}  scopes: ${record.scopes.join(',')}\nToken (shown once, store it securely):\n${token}`);
    } else if (sub === 'list') {
      for (const t of await tokens.list()) console.log(`${t.id}\t${t.label}\t${t.scopes.join(',')}\t${t.revokedAt ? `revoked ${t.revokedAt}` : 'active'}`);
    } else if (sub === 'revoke') {
      console.log((await tokens.revoke(rest[0] ?? '')) ? 'Revoked.' : 'No such token id.');
    } else console.log(help);
  } else if (cmd === 'proposals') {
    if (sub === 'list') for (const p of await proposals.list()) console.log(`${p.id}\t${p.status}\t${p.meetingTitle}\t${p.text}${p.owner ? ` (owner: ${p.owner})` : ''}${p.deadline ? ` (due: ${p.deadline})` : ''}`);
    else if (sub === 'approve' || sub === 'reject') {
      const r = await proposals.decide(rest[0] ?? '', sub === 'approve' ? 'approved' : 'rejected');
      console.log(r ? `${r.id} ${r.status}.` : 'No pending proposal with that id.');
    } else console.log(help);
  } else if (cmd === 'serve') {
    const dir = flag('dir'); if (!dir) throw new Error('--dir <memory-folder> is required');
    const host = flag('host', '127.0.0.1'); assertLoopback(host);
    const port = Number(flag('port', '8787'));
    const server = createServer({ store: new MemoryStore(dir), tokens, proposals, log });
    server.listen(port, host, () => log(`listening on http://${host}:${port}/mcp (create a token with: token create)`));
  } else if (cmd === 'stdio') {
    const dir = flag('dir'); if (!dir) throw new Error('--dir <memory-folder> is required');
    const scopes = String(flag('scopes', 'read')).split(',').filter((s) => SCOPES.includes(s));
    const ctx = { store: new MemoryStore(dir), proposals, scopes, token: null };
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', async (line) => {
      if (!line.trim()) return;
      let body;
      try { body = JSON.parse(line); } catch { return process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`); }
      const out = await handleBody(body, ctx);
      if (out !== null) process.stdout.write(`${JSON.stringify(out)}\n`);
    });
  } else console.log(help);
}
main().catch((e) => { log(e.message); process.exitCode = 1; });
