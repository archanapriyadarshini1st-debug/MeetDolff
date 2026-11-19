import { describe, it, expect } from 'vitest';
import { deleteSegment, editSegmentText, renameSpeaker, setSegmentSpeaker, countEdited } from '../../src/lib/transcript-edit.js';
import type { Meeting } from '../../src/lib/types.js';

function meeting(): Meeting {
  return {
    id: 'm1', title: 'T', startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:10:00.000Z', durationSec: 600,
    participants: ['Speaker 1'],
    transcript: [
      { id: 'a', start: 0, end: 4, speaker: 'Speaker 1', text: 'we will ship on frieday' },
      { id: 'b', start: 4, end: 9, speaker: 'Speaker 2', text: 'agreed' },
    ],
    transcriptText: 'we will ship on frieday agreed', summary: null, topics: [], decisions: [], actionItems: [],
    openQuestions: [], commitments: [], project: null, audioSource: 'mic', audioMime: null, hasAudio: false,
    memoryVersion: 1, createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-01T10:00:00.000Z',
  };
}
const NOW = new Date('2026-02-02T00:00:00.000Z');

describe('transcript editing', () => {
  it('corrects text, keeps the original, rebuilds searchable text, never mutates input', () => {
    const m = meeting();
    const u = editSegmentText(m, 'a', '  we will ship on Friday ', NOW);
    expect(u.transcript[0]).toMatchObject({ text: 'we will ship on Friday', edited: true, originalText: 'we will ship on frieday' });
    expect(u.transcriptText).toBe('we will ship on Friday agreed');
    expect(u.updatedAt).toBe(NOW.toISOString());
    expect(m.transcript[0]!.text).toBe('we will ship on frieday');
  });
  it('keeps the very first original across repeated edits and clears the flag on revert', () => {
    const once = editSegmentText(meeting(), 'a', 'ship Friday', NOW);
    const twice = editSegmentText(once, 'a', 'ship on Friday', NOW);
    expect(twice.transcript[0]!.originalText).toBe('we will ship on frieday');
    const reverted = editSegmentText(twice, 'a', 'we will ship on frieday', NOW);
    expect(reverted.transcript[0]!.edited).toBeUndefined();
    expect(reverted.transcript[0]!.originalText).toBeUndefined();
  });
  it('rejects empty text and unknown segments', () => {
    expect(() => editSegmentText(meeting(), 'a', '   ')).toThrow(/empty/);
    expect(() => editSegmentText(meeting(), 'zzz', 'x')).toThrow(/not found/);
  });
  it('sets and renames speakers (including participants)', () => {
    const s = setSegmentSpeaker(meeting(), 'b', ' Priya ', NOW);
    expect(s.transcript[1]!.speaker).toBe('Priya');
    const r = renameSpeaker(meeting(), 'Speaker 1', 'Sam', NOW);
    expect(r.transcript[0]!.speaker).toBe('Sam');
    expect(r.participants).toEqual(['Sam']);
    expect(renameSpeaker(meeting(), 'Nobody', 'X', NOW).transcript).toEqual(meeting().transcript);
  });
  it('deletes a segment and counts edits', () => {
    const d = deleteSegment(meeting(), 'b', NOW);
    expect(d.transcript).toHaveLength(1);
    expect(d.transcriptText).toBe('we will ship on frieday');
    expect(countEdited(editSegmentText(meeting(), 'a', 'ok then', NOW))).toBe(1);
  });
});
