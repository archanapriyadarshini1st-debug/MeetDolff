/**
 * IndexedDB persistence layer (via `idb`).
 * Stores meetings, calendar events, project plans, audio blobs, and
 * FileSystemDirectoryHandle (structured-cloneable, NOT chrome.storage).
 *
 * DB name: meetdolff
 * Stores:
 *  - meetings (keyPath: id, index: startedAt)
 *  - calendar (keyPath: id, index: startsAt)
 *  - projects (keyPath: id, index: meetingId)
 *  - audio (keyPath: meetingId) -> { meetingId, blob, mime, createdAt }
 *  - kv (keyPath: key) -> { key, value } for handles, settings mirror, etc.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { CalendarEvent, Meeting, ProjectPlan } from './types.js';

const DB_NAME = 'meetdolff';
const DB_VERSION = 2;

export interface AudioRecord {
  meetingId: string;
  blob: Blob;
  mime: string;
  createdAt: string;
}

/** A one-second recovery chunk written while a recording is active. */
export interface AudioChunkRecord {
  key: string;
  sessionId: string;
  index: number;
  blob: Blob;
  mime: string;
  createdAt: string;
}

export interface KvRecord {
  key: string;
  value: unknown;
}

export interface MeetDolffDBTypes {
  meetings: {
    key: string;
    value: Meeting;
    indexes: { startedAt: string };
  };
  calendar: {
    key: string;
    value: CalendarEvent;
    indexes: { startsAt: string };
  };
  projects: {
    key: string;
    value: ProjectPlan;
    indexes: { meetingId: string };
  };
  audio: {
    key: string;
    value: AudioRecord;
  };
  audioChunks: {
    key: string;
    value: AudioChunkRecord;
    indexes: { sessionId: string };
  };
  kv: {
    key: string;
    value: KvRecord;
  };
}

export type MeetDolffDB = IDBPDatabase<MeetDolffDBTypes>;

let dbPromise: Promise<MeetDolffDB> | null = null;

export function getDb(): Promise<MeetDolffDB> {
  if (!dbPromise) {
    dbPromise = openDB<MeetDolffDBTypes>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('meetings')) {
          const s = db.createObjectStore('meetings', { keyPath: 'id' });
          s.createIndex('startedAt', 'startedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('calendar')) {
          const s = db.createObjectStore('calendar', { keyPath: 'id' });
          s.createIndex('startsAt', 'startsAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('projects')) {
          const s = db.createObjectStore('projects', { keyPath: 'id' });
          s.createIndex('meetingId', 'meetingId', { unique: false });
        }
        if (!db.objectStoreNames.contains('audio')) {
          db.createObjectStore('audio', { keyPath: 'meetingId' });
        }
        if (!db.objectStoreNames.contains('audioChunks')) {
          const s = db.createObjectStore('audioChunks', { keyPath: 'key' });
          s.createIndex('sessionId', 'sessionId', { unique: false });
        }
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

/** For tests: reset singleton (does not delete DB). */
export function _resetDbForTests(): void {
  dbPromise = null;
}

export async function putMeeting(m: Meeting): Promise<void> {
  const db = await getDb();
  await db.put('meetings', m);
}

export async function getMeeting(id: string): Promise<Meeting | undefined> {
  const db = await getDb();
  return db.get('meetings', id);
}

export async function listMeetings(limit = 100): Promise<Meeting[]> {
  const db = await getDb();
  const all = await db.getAll('meetings');
  all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return all.slice(0, limit);
}

export async function deleteMeeting(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['meetings', 'audio'], 'readwrite');
  await tx.objectStore('meetings').delete(id);
  await tx.objectStore('audio').delete(id);
  await tx.done;
}

export async function putAudio(rec: AudioRecord): Promise<void> {
  const db = await getDb();
  await db.put('audio', rec);
}

export async function getAudio(meetingId: string): Promise<AudioRecord | undefined> {
  const db = await getDb();
  return db.get('audio', meetingId);
}

export async function putAudioChunk(rec: AudioChunkRecord): Promise<void> {
  const db = await getDb();
  await db.put('audioChunks', rec);
}

export async function listAudioChunks(sessionId: string): Promise<AudioChunkRecord[]> {
  const db = await getDb();
  const chunks = await db.getAllFromIndex('audioChunks', 'sessionId', sessionId);
  chunks.sort((a, b) => a.index - b.index);
  return chunks;
}

export async function deleteAudioChunks(sessionId: string): Promise<void> {
  const db = await getDb();
  const chunks = await listAudioChunks(sessionId);
  const tx = db.transaction('audioChunks', 'readwrite');
  for (const chunk of chunks) await tx.store.delete(chunk.key);
  await tx.done;
}

export async function putCalendarEvent(ev: CalendarEvent): Promise<void> {
  const db = await getDb();
  await db.put('calendar', ev);
}

export async function listCalendarEvents(): Promise<CalendarEvent[]> {
  const db = await getDb();
  const all = await db.getAll('calendar');
  all.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return all;
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('calendar', id);
}

export async function putProject(p: ProjectPlan): Promise<void> {
  const db = await getDb();
  await db.put('projects', p);
}

export async function getProject(id: string): Promise<ProjectPlan | undefined> {
  const db = await getDb();
  return db.get('projects', id);
}

export async function listProjectsForMeeting(meetingId: string): Promise<ProjectPlan[]> {
  const db = await getDb();
  return db.getAllFromIndex('projects', 'meetingId', meetingId);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put('kv', { key, value });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  const rec = await db.get('kv', key);
  return rec?.value as T | undefined;
}

export async function kvDelete(key: string): Promise<void> {
  const db = await getDb();
  await db.delete('kv', key);
}
