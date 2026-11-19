// Revocable, scoped bearer tokens. Only SHA-256 hashes are stored; the raw token is shown once.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const SCOPES = ['read', 'propose'];
export const companionHome = () => process.env.MEETDOLFF_COMPANION_HOME || path.join(os.homedir(), '.meetdolff-companion');
const sha = (s) => createHash('sha256').update(s).digest();

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJsonPrivate(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, file); // atomic: no half-written token file
  await chmod(file, 0o600).catch(() => undefined);
}

export class TokenStore {
  constructor(home = companionHome()) { this.file = path.join(home, 'tokens.json'); }

  async list() { return (await readJson(this.file, { tokens: [] })).tokens; }

  async create(label, scopes = ['read']) {
    const bad = scopes.filter((s) => !SCOPES.includes(s));
    if (bad.length || !scopes.length) throw new Error(`Invalid scopes: ${bad.join(', ') || '(none)'}. Allowed: ${SCOPES.join(', ')}`);
    const token = `mdc_${randomBytes(32).toString('base64url')}`;
    const record = { id: randomUUID().slice(0, 8), label: String(label || 'unnamed').slice(0, 60), scopes, hash: sha(token).toString('hex'), createdAt: new Date().toISOString(), revokedAt: null };
    const tokens = await this.list();
    await writeJsonPrivate(this.file, { tokens: [...tokens, record] });
    return { token, record: { ...record, hash: undefined } };
  }

  async revoke(id) {
    const tokens = await this.list();
    const t = tokens.find((x) => x.id === id);
    if (!t) return false;
    t.revokedAt ??= new Date().toISOString();
    await writeJsonPrivate(this.file, { tokens });
    return true;
  }

  /** Returns the token record (without hash) or null. Constant-time hash comparison; revoked tokens fail. */
  async verify(raw) {
    if (typeof raw !== 'string' || !raw.startsWith('mdc_') || raw.length > 200) return null;
    const probe = sha(raw);
    let found = null;
    for (const t of await this.list()) {
      const ok = timingSafeEqual(probe, Buffer.from(t.hash, 'hex'));
      if (ok && !t.revokedAt) found = t;
    }
    return found ? { id: found.id, label: found.label, scopes: found.scopes } : null;
  }
}

/** Fixed-window limiter, per key. */
export class RateLimiter {
  constructor(limit = 60, windowMs = 60_000, now = () => Date.now()) { this.limit = limit; this.windowMs = windowMs; this.now = now; this.hits = new Map(); }
  check(key) {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || t - h.start >= this.windowMs) { this.hits.set(key, { start: t, count: 1 }); return { ok: true }; }
    if (h.count >= this.limit) return { ok: false, retryAfterSec: Math.ceil((h.start + this.windowMs - t) / 1000) };
    h.count += 1;
    return { ok: true };
  }
}

export class ProposalStore {
  constructor(home = companionHome()) { this.file = path.join(home, 'proposals.json'); }
  async list() { return (await readJson(this.file, { proposals: [] })).proposals; }
  async add(p) {
    const proposals = await this.list();
    const rec = { id: randomUUID().slice(0, 8), createdAt: new Date().toISOString(), status: 'pending', ...p };
    await writeJsonPrivate(this.file, { proposals: [...proposals, rec] });
    return rec;
  }
  async decide(id, status) {
    const proposals = await this.list();
    const p = proposals.find((x) => x.id === id);
    if (!p || p.status !== 'pending') return null;
    p.status = status;
    p.decidedAt = new Date().toISOString();
    await writeJsonPrivate(this.file, { proposals });
    return p;
  }
}
