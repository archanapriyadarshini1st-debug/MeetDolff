import { describe, it, expect } from 'vitest';
import { carryOverQuestions, normalizeQuestion, parseSuggestions, splitSentences, suggestQuestions, suggestQuestionsWithLlm } from '../../src/lib/ai/suggestions.js';
import type { Meeting } from '../../src/lib/types.js';

const kinds = (t: string, o = {}) => suggestQuestions(t, o).map((s) => s.kind);

describe('heuristic question suggestions', () => {
  it('asks for an owner when an action has none, but not when one is named', () => {
    expect(kinds('We should migrate the database before launch.')).toContain('owner');
    expect(kinds('Priya will migrate the database before launch.')).not.toContain('owner');
    expect(kinds("I'll migrate the database before launch.")).not.toContain('owner');
  });

  it('asks for a concrete deadline only when timing is vague', () => {
    expect(kinds('We need to be done with the API soon.')).toContain('deadline');
    expect(kinds('We need to be done with the API by Friday.')).not.toContain('deadline');
    expect(kinds('We should finish this later, on 2026-12-01.')).not.toContain('deadline');
  });

  it('asks for rationale after decisions, mitigation after risks, assumptions after numbers, resolution after uncertainty', () => {
    expect(kinds('So we decided to go with Postgres.')).toContain('rationale');
    expect(kinds('The vendor delay is a real blocker for us.')).toContain('risk');
    expect(kinds('The estimate is 40 hours for the whole thing.')).toContain('assumption');
    expect(kinds("Honestly I'm not sure how the billing works.")).toContain('clarify');
  });

  it('quotes the triggering words as evidence and never invents', () => {
    const s = suggestQuestions('We decided to go with Postgres. Everything else is fine.')[0]!;
    expect(s.evidence).toContain('We decided to go with Postgres');
    expect(suggestQuestions('Thanks everyone, see you soon, have a lovely afternoon.')).toEqual([]);
  });

  it('prefers the most recent sentences, caps the count, and returns one per kind', () => {
    const text = 'We should fix login. We should fix billing. We decided to ship Monday. The risk is the vendor. The estimate is $5k. I am not sure about legal.';
    const out = suggestQuestions(text, { max: 3 });
    expect(out).toHaveLength(3);
    expect(new Set(out.map((s) => s.kind)).size).toBe(3);
    expect(out[0]!.evidence).toMatch(/not sure about legal/);
  });

  it('does not repeat questions that were already asked or dismissed', () => {
    const first = suggestQuestions('The vendor delay is a real blocker for us.');
    const again = suggestQuestions('The vendor delay is a real blocker for us.', { asked: [first[0]!.question.toUpperCase()] });
    expect(again).toEqual([]);
  });

  it('chunks long unpunctuated speech (Web Speech output)', () => {
    const long = Array.from({ length: 70 }, (_, i) => `word${i}`).join(' ');
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.split(' ').length <= 40)).toBe(true);
    expect(normalizeQuestion('  Who OWNS this?! ')).toBe('who owns this');
  });
});

const past = (over: Partial<Meeting>): Meeting => ({
  id: 'p', title: 'Planning', startedAt: '2026-11-10T10:00:00Z', endedAt: '2026-11-10T11:00:00Z', durationSec: 3600, participants: [],
  transcript: [], transcriptText: '', summary: null, topics: [], decisions: [], actionItems: [], openQuestions: [], commitments: [],
  project: null, audioSource: 'tab', audioMime: null, hasAudio: false, memoryVersion: 1, createdAt: '', updatedAt: '', ...over,
});

describe('carry-over follow-ups from memory', () => {
  it('surfaces open questions and undated actions from earlier meetings, newest first, with source titles', () => {
    const older = past({ id: 'a', title: 'Kickoff', startedAt: '2026-11-01T10:00:00Z', openQuestions: ['Who pays for hosting?'] });
    const newer = past({ id: 'b', title: 'Sprint 3', startedAt: '2026-11-15T10:00:00Z', actionItems: [
      { text: 'Write migration guide', owner: null, deadline: null, evidence: [] },
      { text: 'Rotate keys', owner: 'Sam', deadline: '2026-11-30', evidence: [] },
    ] });
    const out = carryOverQuestions([older, newer], { max: 5 });
    expect(out.map((s) => s.source)).toEqual(['memory', 'memory']);
    expect(out[0]!.question).toContain('Write migration guide');
    expect(out[0]!.evidence).toContain('Sprint 3');
    expect(out[1]!.question).toContain('Who pays for hosting?');
    expect(out.some((s) => s.question.includes('Rotate keys'))).toBe(false);
  });

  it('can exclude the meeting being recorded', () => {
    const m = past({ id: 'live', openQuestions: ['x y z?'] });
    expect(carryOverQuestions([m], { excludeMeetingId: 'live' })).toEqual([]);
  });
});

describe('LLM suggestions', () => {
  const text = 'We should ship the new onboarding flow. Nobody has looked at the legal text yet.';
  const provider = (reply: string | Error) => ({
    name: 'fake',
    async chat() { if (reply instanceof Error) throw reply; return { text: reply, model: 'm', provider: 'fake' }; },
  });

  it('accepts grounded suggestions and rejects ones whose evidence is not in the excerpt', () => {
    const raw = JSON.stringify({ suggestions: [
      { question: 'Who is reviewing the legal text?', reason: 'Unowned.', evidence: 'Nobody has looked at the legal text yet' },
      { question: 'What about the budget?', reason: 'Made up.', evidence: 'the budget is $9M' },
    ] });
    const out = parseSuggestions(raw, text);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('llm');
    expect(parseSuggestions('not json', text)).toEqual([]);
  });

  it('uses the model when it returns grounded output', async () => {
    const raw = JSON.stringify({ suggestions: [{ question: 'Who reviews the legal text?', reason: 'r', evidence: 'looked at the legal text' }] });
    const out = await suggestQuestionsWithLlm(provider(raw), text);
    expect(out[0]!.source).toBe('llm');
  });

  it('falls back to heuristics on provider failure or ungrounded output', async () => {
    const a = await suggestQuestionsWithLlm(provider(new Error('401 invalid key')), text);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((s) => s.source === 'heuristic')).toBe(true);
    const b = await suggestQuestionsWithLlm(provider('{"suggestions":[{"question":"q","evidence":"nope"}]}'), text);
    expect(b.every((s) => s.source === 'heuristic')).toBe(true);
  });
});
