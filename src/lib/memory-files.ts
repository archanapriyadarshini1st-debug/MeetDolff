/**
 * Portable memory files via File System Access API.
 * Layout:
 *   MeetDolff Memory/
 *     index.json
 *     meetings/
 *       <id>.md
 *       <id>.json
 *
 * Directory handle is stored in IndexedDB (structured clone),
 * never in chrome.storage. Permission must be re-granted after
 * restart (queryPermission / requestPermission).
 */

import { kvGet, kvSet, putMeeting } from './db.js';
import { MEMORY_FORMAT_VERSION, type Meeting } from './types.js';

const HANDLE_KEY = 'memoryDirHandle';
const INDEX_NAME = 'index.json';
const MEETINGS_DIR = 'meetings';

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickMemoryFolder(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API is not supported in this browser. Use Export (download) fallback.');
  }
  const handle = await (window as any).showDirectoryPicker({
    id: 'meetdolff-memory',
    mode: 'readwrite',
  });
  await kvSet(HANDLE_KEY, handle);
  return handle as FileSystemDirectoryHandle;
}

export async function getStoredFolder(): Promise<FileSystemDirectoryHandle | null> {
  const h = await kvGet<FileSystemDirectoryHandle>(HANDLE_KEY);
  return h ?? null;
}

export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' } as const;
  if ((await (handle as any).queryPermission(opts)) === 'granted') return true;
  if ((await (handle as any).requestPermission(opts)) === 'granted') return true;
  return false;
}

export function meetingToMarkdown(m: Meeting): string {
  const lines: string[] = [];
  lines.push(`# ${m.title}`);
  lines.push('');
  lines.push(`- **ID:** ${m.id}`);
  lines.push(`- **Started:** ${m.startedAt}`);
  lines.push(`- **Ended:** ${m.endedAt}`);
  lines.push(`- **Duration:** ${m.durationSec}s`);
  lines.push(`- **Participants:** ${m.participants.join(', ') || '—'}`);
  lines.push(`- **Project:** ${m.project ?? '—'}`);
  lines.push(`- **Audio source:** ${m.audioSource}`);
  lines.push(`- **Memory version:** ${m.memoryVersion}`);
  lines.push('');
  if (m.summary) {
    lines.push('## Summary');
    lines.push('');
    lines.push(m.summary);
    lines.push('');
  }
  if (m.topics.length) {
    lines.push('## Topics');
    lines.push('');
    for (const t of m.topics) lines.push(`- ${t}`);
    lines.push('');
  }
  if (m.decisions.length) {
    lines.push('## Decisions');
    lines.push('');
    for (const d of m.decisions) lines.push(`- ${d.text}`);
    lines.push('');
  }
  if (m.actionItems.length) {
    lines.push('## Action items');
    lines.push('');
    for (const a of m.actionItems) {
      const owner = a.owner ? ` (@${a.owner})` : '';
      const due = a.deadline ? ` — due ${a.deadline}` : '';
      lines.push(`- [ ] ${a.text}${owner}${due}`);
    }
    lines.push('');
  }
  if (m.openQuestions.length) {
    lines.push('## Open questions');
    lines.push('');
    for (const q of m.openQuestions) lines.push(`- ${q}`);
    lines.push('');
  }
  lines.push('## Transcript');
  lines.push('');
  for (const seg of m.transcript) {
    const who = seg.speaker ? `**${seg.speaker}:** ` : '';
    lines.push(`[${fmtTime(seg.start)}] ${who}${seg.text}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function writeTextFile(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await (fileHandle as any).createWritable();
  await writable.write(text);
  await writable.close();
}

async function ensureMeetingsDir(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  return (await root.getDirectoryHandle(MEETINGS_DIR, { create: true })) as FileSystemDirectoryHandle;
}

export async function exportMeetingToFolder(root: FileSystemDirectoryHandle, m: Meeting): Promise<void> {
  if (!(await ensurePermission(root))) {
    throw new Error('Folder permission denied. Re-select the memory folder in Settings.');
  }
  const dir = await ensureMeetingsDir(root);
  await writeTextFile(dir, `${m.id}.md`, meetingToMarkdown(m));
  await writeTextFile(dir, `${m.id}.json`, JSON.stringify(m, null, 2));
  await updateIndex(root);
}

export async function importMeetingsFromFolder(root: FileSystemDirectoryHandle): Promise<number> {
  if (!(await ensurePermission(root))) {
    throw new Error('Folder permission denied. Re-select the memory folder in Settings.');
  }
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await root.getDirectoryHandle(MEETINGS_DIR, { create: false });
  } catch {
    return 0;
  }
  let imported = 0;
  for await (const entry of (dir as any).values()) {
    if (entry.kind !== 'file' || !String(entry.name).endsWith('.json')) continue;
    try {
      const file = await (entry as FileSystemFileHandle).getFile();
      const value = JSON.parse(await file.text()) as Meeting;
      if (!isMeetingRecord(value)) continue;
      await putMeeting(value);
      imported += 1;
    } catch {
      // Skip malformed/unrelated JSON files; never partially write a record.
    }
  }
  return imported;
}

function isMeetingRecord(value: unknown): value is Meeting {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<Meeting>;
  return typeof m.id === 'string'
    && typeof m.title === 'string'
    && typeof m.startedAt === 'string'
    && typeof m.endedAt === 'string'
    && Array.isArray(m.transcript)
    && Array.isArray(m.decisions)
    && Array.isArray(m.actionItems)
    && typeof m.memoryVersion === 'number';
}

export async function updateIndex(root: FileSystemDirectoryHandle): Promise<void> {
  // Index is rebuilt from meetings dir listing (filenames only). 
  // Full meeting list lives in IndexedDB; index.json is a portable manifest.
  const dir = await ensureMeetingsDir(root);
  const ids: string[] = [];
  for await (const entry of (dir as any).values()) {
    const name: string = entry.name;
    if (name.endsWith('.json')) ids.push(name.replace(/\.json$/, ''));
  }
  ids.sort();
  const index = {
    formatVersion: MEMORY_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    meetingIds: ids,
  };
  await writeTextFile(root, INDEX_NAME, JSON.stringify(index, null, 2));
}

/** Download fallback when folder access is unavailable. */
export function downloadTextFile(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadMeeting(m: Meeting): void {
  downloadTextFile(`${m.id}.md`, meetingToMarkdown(m), 'text/markdown');
  downloadTextFile(`${m.id}.json`, JSON.stringify(m, null, 2), 'application/json');
}
