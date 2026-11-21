/**
 * Live notes.
 *
 * The reason this exists: a meeting record is only created when recording stops, but the
 * user starts typing the moment the call begins. Notes therefore live in a single slot,
 * tagged with the recording session id, and the service worker adopts them when it builds
 * the meeting. Matching on session id is what stops yesterday's abandoned draft from being
 * silently attached to today's recording.
 *
 * Storage is injected so this module stays unit-testable without chrome.*.
 */

import type { Meeting } from '../types.js';

export interface LiveNotes {
  /** Recording session these notes belong to. */
  sessionId: string;
  /** Whatever the user has typed so far. */
  text: string;
  /** ISO timestamp of the last write. */
  updatedAt: string;
}

export const LIVE_NOTES_KEY = 'liveNotes';

export interface NotesBackend {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export const chromeNotesBackend: NotesBackend = {
  get: (k) => chrome.storage.local.get(k) as Promise<Record<string, unknown>>,
  set: (i) => chrome.storage.local.set(i),
  remove: (k) => chrome.storage.local.remove(k),
};

function isLiveNotes(value: unknown): value is LiveNotes {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<LiveNotes>;
  return typeof v.sessionId === 'string' && typeof v.text === 'string' && typeof v.updatedAt === 'string';
}

/** Read the live-notes slot. Returns null when empty, malformed, or stale. */
export async function readLiveNotes(backend: NotesBackend = chromeNotesBackend): Promise<LiveNotes | null> {
  const res = await backend.get(LIVE_NOTES_KEY);
  const raw = res[LIVE_NOTES_KEY];
  if (!isLiveNotes(raw)) return null;
  if (!raw.text.trim()) return null;
  return raw;
}

/**
 * Write notes for a session. Writing empty text clears the slot instead of storing a blank
 * draft, so "user deleted everything" and "user never typed" behave the same way.
 */
export async function writeLiveNotes(
  sessionId: string,
  text: string,
  backend: NotesBackend = chromeNotesBackend,
  now: Date = new Date(),
): Promise<void> {
  if (!sessionId) throw new Error('Live notes need a recording session id.');
  if (!text.trim()) {
    await backend.remove(LIVE_NOTES_KEY);
    return;
  }
  await backend.set({ [LIVE_NOTES_KEY]: { sessionId, text, updatedAt: now.toISOString() } satisfies LiveNotes });
}

export async function clearLiveNotes(backend: NotesBackend = chromeNotesBackend): Promise<void> {
  await backend.remove(LIVE_NOTES_KEY);
}

/**
 * The notes that belong to the recording being saved, or '' if the slot belongs to a
 * different session. Trims, and never returns whitespace.
 */
export function notesForSession(live: LiveNotes | null, sessionId: string): string {
  if (!live || !sessionId) return '';
  if (live.sessionId !== sessionId) return '';
  return live.text.trim();
}

/* ------------------------------------------------------------------ on a saved meeting */

/** Merge notes text into a meeting without disturbing anything else. */
export function applyNotes(meeting: Meeting, text: string, now: Date = new Date()): Meeting {
  const notes = text;
  const changed = (meeting.notes ?? '') !== notes;
  return {
    ...meeting,
    notes,
    // Editing the notes invalidates an enhanced version derived from the old ones.
    notesStale: meeting.notesEnhanced ? changed : false,
    updatedAt: changed ? now.toISOString() : meeting.updatedAt,
  };
}

/** Attach the enhanced notes produced by the model. */
export function applyNotesMerge(meeting: Meeting, markdown: string, now: Date = new Date()): Meeting {
  const clean = markdown.trim();
  if (!clean) throw new Error('The model returned no notes to save.');
  return {
    ...meeting,
    notesEnhanced: clean,
    notesMergedAt: now.toISOString(),
    notesStale: false,
    updatedAt: now.toISOString(),
  };
}

/** A merge needs something to merge: the user's own words and a transcript to check them against. */
export function canMergeNotes(meeting: Meeting | null): { ok: boolean; reason?: string } {
  if (!meeting) return { ok: false, reason: 'Select a meeting first.' };
  if (!(meeting.notes ?? '').trim()) {
    return { ok: false, reason: 'Write a few rough notes first — the merge improves your notes, it does not replace them.' };
  }
  if (!meeting.transcriptText.trim()) {
    return { ok: false, reason: 'This meeting has no transcript yet, so there is nothing to check your notes against.' };
  }
  return { ok: true };
}
