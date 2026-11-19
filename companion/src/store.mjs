// Reads the memory folder written by the extension: <dir>/meetings/<id>.json
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export function isMeetingRecord(v) {
  return !!v && typeof v === 'object' && typeof v.id === 'string' && typeof v.title === 'string' &&
    typeof v.startedAt === 'string' && typeof v.endedAt === 'string' && Array.isArray(v.transcript) &&
    Array.isArray(v.decisions) && Array.isArray(v.actionItems) && typeof v.memoryVersion === 'number';
}

export class MemoryStore {
  /** @param {string} dir memory folder root */
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.cache = new Map(); // file -> { mtimeMs, meeting }
  }

  async meetings() {
    const meetingsDir = path.join(this.dir, 'meetings');
    let names;
    try {
      names = (await readdir(meetingsDir)).filter((n) => n.endsWith('.json'));
    } catch {
      return [];
    }
    const out = [];
    const live = new Set();
    for (const name of names) {
      const file = path.join(meetingsDir, name);
      live.add(file);
      try {
        const { mtimeMs } = await stat(file);
        const hit = this.cache.get(file);
        if (hit && hit.mtimeMs === mtimeMs) {
          if (hit.meeting) out.push(hit.meeting);
          continue;
        }
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        const meeting = isMeetingRecord(parsed) ? parsed : null;
        this.cache.set(file, { mtimeMs, meeting });
        if (meeting) out.push(meeting);
      } catch {
        // Malformed or unrelated JSON: skip, never crash the server.
      }
    }
    for (const k of this.cache.keys()) if (!live.has(k)) this.cache.delete(k);
    return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async get(id) {
    return (await this.meetings()).find((m) => m.id === id) ?? null;
  }
}
