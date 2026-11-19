import { describe, it, expect } from 'vitest';
import { generateReport, generateFlashcards, generateQuiz, generateMindmap } from '../../src/lib/artifacts/artifacts.js';
import { parseProjectPlan } from '../../src/lib/projects/converter.js';
import type { Meeting } from '../../src/lib/types.js';

function meeting(): Meeting {
  return {
    id: 'meet_1',
    title: 'Sync',
    startedAt: '2026-11-19T10:00:00.000Z',
    endedAt: '2026-11-19T10:20:00.000Z',
    durationSec: 1200,
    participants: [],
    transcript: [],
    transcriptText: 'hello',
    summary: 'Short summary.',
    topics: ['api'],
    decisions: [{ text: 'Use REST', evidence: [] }],
    actionItems: [{ text: 'Build endpoint', owner: null, deadline: null, evidence: [] }],
    openQuestions: ['Auth?'],
    commitments: [],
    project: null,
    audioSource: 'tab',
    audioMime: null,
    hasAudio: false,
    memoryVersion: 1,
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:00.000Z',
  };
}

describe('artifacts', () => {
  it('generates report with decisions', () => {
    const r = generateReport(meeting());
    expect(r).toContain('Use REST');
    expect(r).toContain('Short summary.');
  });

  it('generates flashcards from decisions/actions', () => {
    const cards = generateFlashcards(meeting());
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards[0]!.back).toBe('Use REST');
  });

  it('generates quiz and mindmap', () => {
    expect(generateQuiz(meeting()).length).toBeGreaterThanOrEqual(3);
    expect(generateMindmap(meeting())).toContain('```mermaid');
  });
});

describe('parseProjectPlan', () => {
  it('parses valid JSON', () => {
    const plan = parseProjectPlan(
      JSON.stringify({ title: 'Launch', objectives: ['Ship'], tasks: [{ text: 'Code', owner: null, deadline: null }], milestones: [], dependencies: [], risks: [] }),
      'meet_1',
    );
    expect(plan.title).toBe('Launch');
    expect(plan.approved).toBe(false);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseProjectPlan('not json', 'meet_1')).toThrow();
  });
});
