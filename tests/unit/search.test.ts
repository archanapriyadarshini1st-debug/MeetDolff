import { describe, it, expect } from 'vitest';
import { searchMeetings, searchByDate, searchByTopic } from '../../src/lib/search.js';
import type { Meeting } from '../../src/lib/types.js';

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meet_1',
    title: 'Frontend sync',
    startedAt: '2026-11-18T19:00:00.000Z',
    endedAt: '2026-11-18T19:30:00.000Z',
    durationSec: 1800,
    participants: ['A', 'B'],
    transcript: [],
    transcriptText: 'We decided to use Vite for the frontend. Database performance is a concern.',
    summary: 'Discussed frontend stack.',
    topics: ['frontend'],
    decisions: [{ text: 'Use Vite', evidence: [] }],
    actionItems: [{ text: 'Ship prototype', owner: null, deadline: null, evidence: [] }],
    openQuestions: [],
    commitments: [],
    project: null,
    audioSource: 'tab',
    audioMime: 'audio/webm',
    hasAudio: true,
    memoryVersion: 1,
    createdAt: '2026-11-18T19:00:00.000Z',
    updatedAt: '2026-11-18T19:00:00.000Z',
    ...over,
  };
}

describe('searchMeetings', () => {
  it('finds meetings by transcript term', () => {
    const res = searchMeetings([meeting()], 'Vite');
    expect(res).toHaveLength(1);
    expect(res[0]!.snippet).toContain('<mark>');
  });

  it('returns empty for empty query', () => {
    expect(searchMeetings([meeting()], '  ')).toEqual([]);
  });

  it('ranks title matches higher', () => {
    const a = meeting({ id: 'a', title: 'Other', transcriptText: 'frontend frontend' });
    const b = meeting({ id: 'b', title: 'Frontend review', transcriptText: 'hello' });
    const res = searchMeetings([a, b], 'frontend');
    expect(res[0]!.meeting.id).toBe('b');
  });
});

describe('searchByDate / searchByTopic', () => {
  it('filters by date range', () => {
    const m = meeting();
    expect(searchByDate([m], '2026-11-18T00:00:00Z', '2026-11-19T00:00:00Z')).toHaveLength(1);
    expect(searchByDate([m], '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z')).toHaveLength(0);
  });

  it('filters by topic', () => {
    expect(searchByTopic([meeting()], 'frontend')).toHaveLength(1);
    expect(searchByTopic([meeting()], 'backend')).toHaveLength(0);
  });
});
