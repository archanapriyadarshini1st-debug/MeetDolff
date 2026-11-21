import { describe, expect, it } from 'vitest';
import {
  applyNotes,
  applyNotesMerge,
  canMergeNotes,
  LIVE_NOTES_KEY,
  notesForSession,
  readLiveNotes,
  writeLiveNotes,
  type NotesBackend,
} from '../../src/lib/notes/live.js';
import { NOTES_MERGE_SYSTEM, notesMergePrompt } from '../../src/lib/ai/prompts.js';
import type { Meeting } from '../../src/lib/types.js';

function memoryBackend(seed: Record<string, unknown> = {}): NotesBackend & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = { ...seed };
  return {
    store,
    get: async (k) => (k in store ? { [k]: store[k] } : {}),
    set: async (items) => {
      Object.assign(store, items);
    },
    remove: async (k) => {
      delete store[k];
    },
  };
}

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    title: 'Weekly product review',
    startedAt: '2026-11-19T14:00:00.000Z',
    endedAt: '2026-11-19T14:30:00.000Z',
    durationSec: 1800,
    participants: [],
    transcript: [{ id: 's1', start: 4, end: 9, speaker: null, text: 'we ship skippable calendar next Tuesday' }],
    transcriptText: 'we ship skippable calendar next Tuesday',
    summary: 'Calendar connect becomes skippable.',
    topics: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
    commitments: [],
    project: null,
    audioSource: 'tab',
    audioMime: null,
    hasAudio: false,
    memoryVersion: 1,
    notes: '',
    notesEnhanced: null,
    notesMergedAt: null,
    createdAt: '2026-11-19T14:30:00.000Z',
    updatedAt: '2026-11-19T14:30:00.000Z',
    ...over,
  };
}

describe('live notes slot', () => {
  it('is empty until something is typed', async () => {
    expect(await readLiveNotes(memoryBackend())).toBeNull();
  });

  it('round-trips text for a session', async () => {
    const backend = memoryBackend();
    await writeLiveNotes('sess-1', 'drop-off is 40% at step three', backend, new Date('2026-11-19T14:05:00Z'));
    const live = await readLiveNotes(backend);
    expect(live).toEqual({
      sessionId: 'sess-1',
      text: 'drop-off is 40% at step three',
      updatedAt: '2026-11-19T14:05:00.000Z',
    });
  });

  it('clears instead of storing a blank draft', async () => {
    const backend = memoryBackend();
    await writeLiveNotes('sess-1', 'something', backend);
    await writeLiveNotes('sess-1', '   \n  ', backend);
    expect(backend.store[LIVE_NOTES_KEY]).toBeUndefined();
    expect(await readLiveNotes(backend)).toBeNull();
  });

  it('ignores malformed or blank stored values', async () => {
    expect(await readLiveNotes(memoryBackend({ [LIVE_NOTES_KEY]: 'nope' }))).toBeNull();
    expect(
      await readLiveNotes(memoryBackend({ [LIVE_NOTES_KEY]: { sessionId: 's', text: '   ', updatedAt: 'x' } })),
    ).toBeNull();
  });

  it('refuses to write without a session id', async () => {
    await expect(writeLiveNotes('', 'text', memoryBackend())).rejects.toThrow(/session id/i);
  });
});

describe('notesForSession', () => {
  const live = { sessionId: 'sess-1', text: '  hold hiring  ', updatedAt: '2026-11-19T14:05:00Z' };

  it('adopts the founder draft for the matching session, trimmed', () => {
    expect(notesForSession(live, 'sess-1')).toBe('hold hiring');
  });

  it('never attaches another session\'s draft to this recording', () => {
    expect(notesForSession(live, 'sess-2')).toBe('');
    expect(notesForSession(null, 'sess-1')).toBe('');
    expect(notesForSession(live, '')).toBe('');
  });
});

describe('applyNotes', () => {
  it('stores the notes and bumps updatedAt only on a real change', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const changed = applyNotes(meeting(), 'hold hiring at two', now);
    expect(changed.notes).toBe('hold hiring at two');
    expect(changed.updatedAt).toBe(now.toISOString());

    const unchanged = applyNotes(changed, 'hold hiring at two', new Date('2026-11-21T10:00:00Z'));
    expect(unchanged.updatedAt).toBe(changed.updatedAt);
  });

  it('flags a merged version as stale once the raw notes change', () => {
    const merged = meeting({ notes: 'old', notesEnhanced: '# merged', notesStale: false });
    expect(applyNotes(merged, 'old').notesStale).toBe(false);
    expect(applyNotes(merged, 'new').notesStale).toBe(true);
  });

  it('does not invent a stale flag when nothing was ever merged', () => {
    expect(applyNotes(meeting({ notes: 'a' }), 'b').notesStale).toBe(false);
  });
});

describe('applyNotesMerge', () => {
  it('records the merged markdown and clears the stale flag', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const out = applyNotesMerge(meeting({ notes: 'a', notesStale: true }), '  # Review\n- calendar  ', now);
    expect(out.notesEnhanced).toBe('# Review\n- calendar');
    expect(out.notesMergedAt).toBe(now.toISOString());
    expect(out.notesStale).toBe(false);
    expect(out.notes).toBe('a'); // the original survives
  });

  it('refuses to save an empty merge', () => {
    expect(() => applyNotesMerge(meeting({ notes: 'a' }), '   ')).toThrow(/no notes/i);
  });
});

describe('canMergeNotes', () => {
  it('needs a target, the user\'s own words, and a transcript', () => {
    expect(canMergeNotes(null).ok).toBe(false);
    expect(canMergeNotes(meeting({ notes: '' })).reason).toMatch(/rough notes/i);
    expect(canMergeNotes(meeting({ notes: 'a', transcriptText: '  ' })).reason).toMatch(/no transcript/i);
    expect(canMergeNotes(meeting({ notes: 'a' }))).toEqual({ ok: true });
  });
});

describe('notes merge prompt', () => {
  it('puts the user\'s notes and the transcript in front of the model', () => {
    const prompt = notesMergePrompt('drop-off 40% at step 3', 'we ship skippable calendar');
    expect(prompt).toContain('drop-off 40% at step 3');
    expect(prompt).toContain('we ship skippable calendar');
  });

  it('bounds what it sends', () => {
    const prompt = notesMergePrompt('n'.repeat(20_000), 't'.repeat(40_000));
    expect(prompt.length).toBeLessThan(40_000);
  });

  it('instructs the model to keep the user\'s structure and not invent', () => {
    expect(NOTES_MERGE_SYSTEM).toMatch(/skeleton/i);
    expect(NOTES_MERGE_SYSTEM).toMatch(/never invent/i);
    expect(NOTES_MERGE_SYSTEM).toMatch(/Markdown only/i);
  });
});
