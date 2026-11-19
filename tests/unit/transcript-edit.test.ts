import { describe, it, expect } from 'vitest';
import { editSegment, editedSegmentCount, renameSpeaker, revertSegment, TranscriptEditError } from '../../src/lib/transcript/edit.js';
import { meeting, seg } from './_fixtures.js';

const NOW = new Date(2026, 10, 19, 12, 0);
const base = () =>
  meeting({
    transcript: [seg('s1', 0, 'we picked weed for the build', 'Speaker 1'), seg('s2', 6, 'agreed', 'Speaker 2')],
    transcriptText: 'we picked weed for the build agreed',
    participants: ['Speaker 1', 'Speaker 2'],
  });

describe('editSegment', () => {
  it('corrects the text, keeps the original, and rebuilds the searchable text', () => {
    const out = editSegment(base(), 's1', '  we picked Vite   for the build ', NOW);
    expect(out.transcript[0]!.text).toBe('we picked Vite for the build');
    expect(out.transcript[0]!.originalText).toBe('we picked weed for the build');
    expect(out.transcript[0]!.editedAt).toBe(NOW.toISOString());
    expect(out.transcriptText).toBe('we picked Vite for the build agreed');
    expect(out.updatedAt).toBe(NOW.toISOString());
  });

  it('does not mutate the input', () => {
    const m = base();
    editSegment(m, 's1', 'changed', NOW);
    expect(m.transcript[0]!.text).toBe('we picked weed for the build');
  });

  it('never overwrites the first original on repeated edits', () => {
    const once = editSegment(base(), 's1', 'first fix', NOW);
    const twice = editSegment(once, 's1', 'second fix', NOW);
    expect(twice.transcript[0]!.originalText).toBe('we picked weed for the build');
  });

  it('marks derived data stale only when there is some', () => {
    expect(editSegment(base(), 's1', 'x y', NOW).summaryStale).toBeUndefined();
    const withSummary = { ...base(), summary: 'They chose a bundler.' };
    expect(editSegment(withSummary, 's1', 'x y', NOW).summaryStale).toBe(true);
  });

  it('rejects empty text and unknown segments', () => {
    expect(() => editSegment(base(), 's1', '   ', NOW)).toThrow(TranscriptEditError);
    expect(() => editSegment(base(), 'nope', 'x', NOW)).toThrow(/not found/);
  });

  it('returns the same object when nothing changed', () => {
    const m = base();
    expect(editSegment(m, 's1', 'we picked weed for the build', NOW)).toBe(m);
  });
});

describe('revertSegment', () => {
  it('restores the provider text and clears the edit markers', () => {
    const edited = editSegment(base(), 's1', 'we picked Vite', NOW);
    const back = revertSegment(edited, 's1', NOW);
    expect(back.transcript[0]).toEqual(base().transcript[0]);
    expect(editedSegmentCount(back)).toBe(0);
    expect(back.transcriptText).toBe('we picked weed for the build agreed');
  });

  it('is a no-op for a never-edited segment', () => {
    const m = base();
    expect(revertSegment(m, 's2', NOW)).toBe(m);
  });
});

describe('renameSpeaker', () => {
  it('renames labels and participants without marking the summary stale', () => {
    const m = { ...base(), summary: 'x' };
    const out = renameSpeaker(m, 'Speaker 1', 'Priya', NOW);
    expect(out.transcript.map((s) => s.speaker)).toEqual(['Priya', 'Speaker 2']);
    expect(out.participants).toEqual(['Priya', 'Speaker 2']);
    expect(out.summaryStale).toBeUndefined();
  });

  it('clears the label when the new name is empty', () => {
    const out = renameSpeaker(base(), 'Speaker 1', ' ', NOW);
    expect(out.transcript[0]!.speaker).toBeNull();
    expect(out.participants).toEqual(['Speaker 2']);
  });
});
