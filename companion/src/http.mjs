// Loopback-only Streamable-HTTP-style MCP endpoint (POST /mcp) with bearer auth, origin checks and rate limits.
import http from 'node:http';
import { RateLimiter } from './auth.mjs';
import { handleBody } from './rpc.mjs';

const MAX_BODY = 256 * 1024;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function createServer({ store, tokens, proposals, limiter = new RateLimiter(), log = () => {} }) {
  const send = (res, status, body, headers = {}) => {
    const payload = body === null ? '' : JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(payload);
  };
  return http.createServer(async (req, res) => {
    try {
      // DNS-rebinding defence (MCP transport spec): validate Host and Origin.
      const host = String(req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (!LOOPBACK.has(host)) return send(res, 403, { error: 'forbidden_host' });
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try { ok = LOOPBACK.has(new URL(origin).hostname.replace(/^\[|\]$/g, '')); } catch { /* invalid origin */ }
        if (!ok) return send(res, 403, { error: 'forbidden_origin' });
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/health') return send(res, 200, { ok: true });
      if (url.pathname !== '/mcp') return send(res, 404, { error: 'not_found' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' });

      const m = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''));
      const token = m ? await tokens.verify(m[1]) : null;
      if (!token) return send(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer realm="meetdolff"' });
      const rl = limiter.check(token.id);
      if (!rl.ok) return send(res, 429, { error: 'rate_limited' }, { 'retry-after': String(rl.retryAfterSec) });

      let size = 0;
      const chunks = [];
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) return send(res, 413, { error: 'payload_too_large' });
        chunks.push(c);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
      const out = await handleBody(body, { store, proposals, scopes: token.scopes, token });
      log(`${token.id} ${Array.isArray(body) ? 'batch' : body?.method}${body?.params?.name ? `:${body.params.name}` : ''}`);
      return out === null ? send(res, 202, null) : send(res, 200, out);
    } catch {
      return send(res, 500, { error: 'internal_error' });
    }
  });
}

export function assertLoopback(host) {
  if (!LOOPBACK.has(host)) throw new Error(`Refusing to bind to non-loopback host '${host}'. The companion only listens on this machine.`);
}
