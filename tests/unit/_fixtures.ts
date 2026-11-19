import type { Meeting, TranscriptSegment } from '../../src/lib/types.js';

export function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meet_1',
    title: 'Frontend sync',
    startedAt: new Date(2026, 10, 17, 19, 0).toISOString(),
    endedAt: new Date(2026, 10, 17, 19, 30).toISOString(),
    durationSec: 1800,
    participants: [],
    transcript: [],
    transcriptText: '',
    summary: null,
    topics: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
    commitments: [],
    project: null,
    audioSource: 'tab',
    audioMime: 'audio/webm',
    hasAudio: true,
    memoryVersion: 1,
    createdAt: new Date(2026, 10, 17, 19, 0).toISOString(),
    updatedAt: new Date(2026, 10, 17, 19, 0).toISOString(),
    ...over,
  };
}

export function seg(id: string, start: number, text: string, speaker: string | null = null): TranscriptSegment {
  return { id, start, end: start + 5, speaker, text };
}
