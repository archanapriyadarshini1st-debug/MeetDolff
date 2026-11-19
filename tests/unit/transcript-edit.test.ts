import { describe, it, expect } from 'vitest';
import { editSegmentText, removeSegment, renameSpeaker, revertSegment, listSpeakers, countEdited } from '../../src/lib/transcript-edit.js';
import { applyMeetingSummary, parseMeetingSummary } from '../../src/lib/ai/meeting-intelligence.js';
import { summarizeMeeting } from '../../src/lib/ai/summarize.js';
import { DEFAULT_PROVIDER_SETTINGS, type Meeting } from '../../src/lib/types.js';

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1', title: 'Sync', startedAt: '2026-11-19T00:00:00Z', endedAt: '2026-11-19T00:01:00Z', durationSec: 60,
    participants: [], transcript: [
      { id: 's1', start: 0, end: 4, speaker: null, text: 'We should ship the front end', confidence: 0.6 },
      { id: 's2', start: 4, end: 9, speaker: 'Speaker 1', text: 'Priya will review the pull request' },
    ],
    transcriptText: 'We should ship the front end Priya will review the pull request',
    summary: null, topics: [], decisions: [], actionItems: [], openQuestions: [], commitments: [], project: null,
    audioSource: 'mic', audioMime: 'audio/webm', hasAudio: false, memoryVersion: 1,
    createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z', ...over,
  };
}

describe('transcript editing', () => {
  it('edits one segment, keeps the original, rebuilds transcriptText, never mutates input', () => {
    const m = meeting();
    const snapshot = JSON.stringify(m);
    const next = editSegmentText(m, 's1', '  We should ship the frontend  ');
    expect(JSON.stringify(m)).toBe(snapshot);
    expect(next.transcript[0]).toMatchObject({ text: 'We should ship the frontend', edited: true, originalText: 'We should ship the front end' });
    expect(next.transcript[0]!.confidence).toBeUndefined();
    expect(next.transcriptText).toBe('We should ship the frontend Priya will review the pull request');
    expect(countEdited(next)).toBe(1);
  });

  it('preserves the FIRST original across repeated edits and can revert', () => {
    const a = editSegmentText(meeting(), 's1', 'one');
    const b = editSegmentText(a, 's1', 'two');
    expect(b.transcript[0]!.originalText).toBe('We should ship the front end');
    const r = revertSegment(b, 's1');
    expect(r.transcript[0]!.text).toBe('We should ship the front end');
    expect(r.transcript[0]!.edited).toBeUndefined();
    expect(r.transcript[0]!.originalText).toBeUndefined();
  });

  it('returns the same object for unchanged text and throws for empty or unknown segments', () => {
    const m = meeting();
    expect(editSegmentText(m, 's1', m.transcript[0]!.text)).toBe(m);
    expect(() => editSegmentText(m, 's1', '   ')).toThrow(/empty/i);
    expect(() => editSegmentText(m, 'nope', 'x')).toThrow(/not found/i);
  });

  it('marks summary stale only when there is derived content to go stale', () => {
    expect(editSegmentText(meeting(), 's1', 'x y z').summaryStale).toBe(false);
    expect(editSegmentText(meeting({ summary: 'A summary' }), 's1', 'x y z').summaryStale).toBe(true);
    expect(removeSegment(meeting({ decisions: [{ text: 'd', evidence: [] }] }), 's2').summaryStale).toBe(true);
  });

  it('removes a segment', () => {
    const next = removeSegment(meeting(), 's1');
    expect(next.transcript.map((s) => s.id)).toEqual(['s2']);
    expect(next.transcriptText).toBe('Priya will review the pull request');
  });

  it('renames/assigns speakers and keeps participants consistent', () => {
    const assigned = renameSpeaker(meeting(), null, 'Dana');
    expect(assigned.transcript[0]!.speaker).toBe('Dana');
    expect(assigned.participants).toEqual(['Dana']);
    const renamed = renameSpeaker(assigned, 'Speaker 1', 'Priya');
    expect(listSpeakers(renamed)).toEqual(['Dana', 'Priya']);
    expect(renamed.participants.sort()).toEqual(['Dana', 'Priya']);
    expect(renameSpeaker(renamed, 'Nobody', 'X')).toBe(renamed);
  });
});

describe('re-summarize', () => {
  it('summarizeMeeting uses the edited transcript and clears summaryStale', async () => {
    const edited = editSegmentText(meeting({ summary: 'old' }), 's1', 'We must ship the frontend by Friday');
    expect(edited.summaryStale).toBe(true);
    let sentPrompt = '';
    const provider = {
      name: 'fake',
      async chat(messages: { content: string }[]) {
        sentPrompt = messages.map((x) => x.content).join('\n');
        return { text: '{"summary":"Ship by Friday","topics":["release"],"decisions":[],"actionItems":[],"openQuestions":[],"commitments":[]}', model: 'f', provider: 'fake' };
      },
    };
    const out = await summarizeMeeting(edited, DEFAULT_PROVIDER_SETTINGS, provider);
    expect(sentPrompt).toContain('by Friday');
    expect(out.summary).toBe('Ship by Friday');
    expect(out.summaryStale).toBe(false);
  });

  it('refuses an empty transcript and surfaces provider failures', async () => {
    await expect(summarizeMeeting(meeting({ transcriptText: ' ' }), DEFAULT_PROVIDER_SETTINGS, { name: 'f', chat: async () => ({ text: '', model: '', provider: '' }) })).rejects.toThrow(/no transcript/i);
    await expect(summarizeMeeting(meeting(), DEFAULT_PROVIDER_SETTINGS, { name: 'f', chat: async () => { throw new Error('401 invalid key'); } })).rejects.toThrow(/401/);
  });

  it('applyMeetingSummary clears the stale flag', () => {
    const out = applyMeetingSummary(meeting({ summaryStale: true }), parseMeetingSummary('{"summary":"s","topics":[],"decisions":[],"actionItems":[],"openQuestions":[],"commitments":[]}'));
    expect(out.summaryStale).toBe(false);
  });
});
