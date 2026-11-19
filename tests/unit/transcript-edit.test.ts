import { describe, expect, it } from 'vitest';
import { editSegmentText, renameSpeaker, setSegmentSpeaker, TranscriptEditError } from '../../src/lib/transcript/edit.js';
import type { Meeting } from '../../src/lib/types.js';

const base = (): Meeting => ({
  id: 'm', title: 'T', startedAt: '2026-11-17T19:00:00.000Z', endedAt: '2026-11-17T19:30:00.000Z', durationSec: 1800,
  participants: [], summary: 'Old summary', topics: [], decisions: [], actionItems: [], openQuestions: [], commitments: [],
  project: null, audioSource: 'mic', audioMime: null, hasAudio: false, memoryVersion: 1, createdAt: '', updatedAt: '',
  transcriptText: 'we use post gress now',
  transcript: [
    { id: 'a', start: 0, end: 3, speaker: 'Speaker 1', text: 'we use post gress' },
    { id: 'b', start: 3, end: 5, speaker: 'Speaker 2', text: 'now' },
  ],
});

describe('transcript editing', () => {
  it('corrects text, keeps the original, rebuilds searchable text and marks summary stale', () => {
    const m = editSegmentText(base(), 'a', '  we use Postgres ');
    expect(m.transcript[0]).toMatchObject({ text: 'we use Postgres', edited: true, originalText: 'we use post gress' });
    expect(m.transcriptText).toBe('we use Postgres now');
    expect(m.summaryStale).toBe(true);
    expect(m.transcriptEditedAt).toBeTruthy();
  });
  it('keeps the very first original across repeated edits and clears the flag on revert', () => {
    const once = editSegmentText(base(), 'a', 'we use Postgres');
    const twice = editSegmentText(once, 'a', 'we use PostgreSQL');
    expect(twice.transcript[0]?.originalText).toBe('we use post gress');
    const reverted = editSegmentText(twice, 'a', 'we use post gress');
    expect(reverted.transcript[0]?.edited).toBeUndefined();
    expect(reverted.transcript[0]?.originalText).toBeUndefined();
  });
  it('does not mark a summary stale when there is no summary', () => {
    const m = base();
    m.summary = null;
    expect(editSegmentText(m, 'a', 'changed').summaryStale).toBe(false);
  });
  it('rejects empty text and unknown segments', () => {
    expect(() => editSegmentText(base(), 'a', '   ')).toThrow(TranscriptEditError);
    expect(() => editSegmentText(base(), 'zzz', 'x')).toThrow(/not found/);
  });
  it('does not mutate its input', () => {
    const m = base();
    editSegmentText(m, 'a', 'x y z');
    expect(m.transcript[0]?.text).toBe('we use post gress');
  });
  it('labels and renames speakers', () => {
    expect(setSegmentSpeaker(base(), 'b', '  Priya ').transcript[1]?.speaker).toBe('Priya');
    const r = renameSpeaker(base(), 'Speaker 1', 'Sam');
    expect(r.transcript[0]?.speaker).toBe('Sam');
    expect(r.participants).toEqual(['Sam']);
    expect(renameSpeaker(base(), 'Nobody', 'X')).toEqual(base());
  });
});
