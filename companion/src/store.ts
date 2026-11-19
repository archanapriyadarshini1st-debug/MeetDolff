/**
 * Read-only loader for an exported MeetDolff memory folder.
 *
 *   MeetDolff Memory/
 *     index.json
 *     meetings/<meeting-id>.json   <- machine-readable source of truth
 *     meetings/<meeting-id>.md     <- human-readable copy (ignored here)
 *
 * Nothing in this module ever writes. Files are re-read on every call so a
 * fresh export from the extension is visible without restarting the server.
 * Records are validated and normalized; malformed files are reported, never trusted.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Meeting } from '../../src/lib/types.js';

export const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface LoadResult {
  meetings: Meeting[];
  warnings: string[];
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/** Returns a normalized Meeting or null when the record is unusable. */
export function normalizeMeeting(raw: unknown): Meeting | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (typeof r.id !== 'string' || !SAFE_ID.test(r.id)) return null;
  if (typeof r.title !== 'string' || typeof r.startedAt !== 'string' || Number.isNaN(Date.parse(r.startedAt))) return null;
  const transcript = Array.isArray(r.transcript)
    ? r.transcript
        .filter((s: any) => s && typeof s.text === 'string')
        .map((s: any, i: number) => ({
          id: typeof s.id === 'string' ? s.id : `seg-${i}`,
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          speaker: typeof s.speaker === 'string' ? s.speaker : null,
          text: s.text,
        }))
    : [];
  return {
    id: r.id,
    title: r.title,
    startedAt: r.startedAt,
    endedAt: typeof r.endedAt === 'string' ? r.endedAt : r.startedAt,
    durationSec: Number(r.durationSec) || 0,
    participants: strArr(r.participants),
    transcript,
    transcriptText: typeof r.transcriptText === 'string' ? r.transcriptText : transcript.map((s: { text: string }) => s.text).join(' '),
    summary: typeof r.summary === 'string' ? r.summary : null,
    topics: strArr(r.topics),
    decisions: Array.isArray(r.decisions)
      ? r.decisions.filter((d: any) => d && typeof d.text === 'string').map((d: any) => ({ text: d.text, evidence: strArr(d.evidence) }))
      : [],
    actionItems: Array.isArray(r.actionItems)
      ? r.actionItems
          .filter((a: any) => a && typeof a.text === 'string')
          .map((a: any) => ({
            text: a.text,
            owner: typeof a.owner === 'string' ? a.owner : null,
            deadline: typeof a.deadline === 'string' ? a.deadline : null,
            evidence: strArr(a.evidence),
          }))
      : [],
    openQuestions: strArr(r.openQuestions),
    commitments: strArr(r.commitments),
    project: typeof r.project === 'string' ? r.project : null,
    audioSource: r.audioSource === 'tab' || r.audioSource === 'mic' || r.audioSource === 'tab+mic' ? r.audioSource : 'mic',
    audioMime: typeof r.audioMime === 'string' ? r.audioMime : null,
    hasAudio: Boolean(r.hasAudio),
    memoryVersion: Number(r.memoryVersion) || 1,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : r.startedAt,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : r.startedAt,
  };
}

/** Accepts either the memory root or its `meetings/` folder. */
async function resolveMeetingsDir(dir: string): Promise<string> {
  const root = resolve(dir);
  const nested = join(root, 'meetings');
  try {
    if ((await stat(nested)).isDirectory()) return nested;
  } catch {
    /* fall through */
  }
  return root;
}

export async function loadMemory(dir: string): Promise<LoadResult> {
  const meetingsDir = await resolveMeetingsDir(dir);
  let names: string[];
  try {
    names = await readdir(meetingsDir);
  } catch (e) {
    throw new Error(`Cannot read memory folder "${meetingsDir}": ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  const meetings: Meeting[] = [];
  const warnings: string[] = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const file = join(meetingsDir, name);
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      if (info.size > MAX_FILE_BYTES) {
        warnings.push(`${name}: skipped (larger than ${MAX_FILE_BYTES} bytes)`);
        continue;
      }
      const meeting = normalizeMeeting(JSON.parse(await readFile(file, 'utf8')));
      if (meeting) meetings.push(meeting);
      else warnings.push(`${name}: skipped (not a valid MeetDolff meeting record)`);
    } catch (e) {
      warnings.push(`${name}: skipped (${e instanceof Error ? e.message : 'unreadable'})`);
    }
  }
  meetings.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { meetings, warnings };
}
