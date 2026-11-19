import { describe, it, expect } from 'vitest';
import { applyMeetingSummary, parseMeetingSummary } from '../../src/lib/ai/meeting-intelligence.js';
import type { Meeting } from '../../src/lib/types.js';

const base: Meeting = {
  id: 'm1', title: 'Test', startedAt: '2026-11-19T00:00:00Z', endedAt: '2026-11-19T00:01:00Z', durationSec: 60,
  participants: [], transcript: [], transcriptText: 'hello', summary: null, topics: [], decisions: [], actionItems: [],
  openQuestions: [], commitments: [], project: null, audioSource: 'mic', audioMime: 'audio/webm', hasAudio: false,
  memoryVersion: 1, createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z',
};

describe('meeting intelligence parsing', () => {
  it('accepts fenced JSON and preserves evidence', () => {
    const parsed = parseMeetingSummary('```json\n{"summary":"S","topics":["api"],"decisions":[{"text":"Ship","evidence":"[00:12]"}],"actionItems":[{"text":"Test","owner":null,"deadline":null}],"openQuestions":[],"commitments":[]}\n```');
    expect(parsed.summary).toBe('S');
    expect(parsed.decisions[0]!.evidence).toEqual(['[00:12]']);
    expect(parsed.actionItems[0]!.owner).toBeNull();
  });

  it('rejects malformed model output', () => {
    expect(() => parseMeetingSummary('not json')).toThrow();
  });

  it('applies normalized output to a meeting', () => {
    const updated = applyMeetingSummary(base, parseMeetingSummary('{"summary":"Done","topics":["x"],"decisions":[],"actionItems":[],"openQuestions":[],"commitments":[]}'));
    expect(updated.summary).toBe('Done');
    expect(updated.topics).toEqual(['x']);
    expect(updated.updatedAt).not.toBe(base.updatedAt);
  });
});
