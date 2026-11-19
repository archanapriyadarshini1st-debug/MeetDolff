import { describe, it, expect } from 'vitest';
import { meetingToMarkdown, fmtTime } from '../../src/lib/memory-files.js';
import type { Meeting } from '../../src/lib/types.js';

function meeting(): Meeting {
  return {
    id: 'meet_x',
    title: 'Planning',
    startedAt: '2026-11-19T10:00:00.000Z',
    endedAt: '2026-11-19T10:20:00.000Z',
    durationSec: 1200,
    participants: ['Sam'],
    transcript: [{ id: 's1', start: 65, end: 70, speaker: null, text: 'Hello world' }],
    transcriptText: 'Hello world',
    summary: 'Planned launch.',
    topics: ['launch'],
    decisions: [{ text: 'Ship Friday', evidence: [] }],
    actionItems: [{ text: 'Write docs', owner: 'Sam', deadline: '2026-11-21', evidence: [] }],
    openQuestions: ['Budget?'],
    commitments: [],
    project: null,
    audioSource: 'tab',
    audioMime: 'audio/webm',
    hasAudio: true,
    memoryVersion: 1,
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:00.000Z',
  };
}

describe('meetingToMarkdown', () => {
  it('includes title, decisions, actions, transcript with timestamps', () => {
    const md = meetingToMarkdown(meeting());
    expect(md).toContain('# Planning');
    expect(md).toContain('Ship Friday');
    expect(md).toContain('Write docs');
    expect(md).toContain('[01:05] Hello world');
  });
});

describe('fmtTime', () => {
  it('formats seconds as MM:SS', () => {
    expect(fmtTime(0)).toBe('00:00');
    expect(fmtTime(65)).toBe('01:05');
    expect(fmtTime(3600)).toBe('60:00');
  });
});
