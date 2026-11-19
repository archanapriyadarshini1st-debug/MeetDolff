import { describe, it, expect } from 'vitest';
import {
  excerptFromSegments, heuristicQuestions, mergeSuggestions, parseAiSuggestions, shouldRefresh, suggestionPrompt,
} from '../../src/lib/ai/suggestions.js';
import type { TranscriptSegment } from '../../src/lib/types.js';

const seg = (id: string, start: number, text: string): TranscriptSegment => ({ id, start, end: start + 3, speaker: null, text });

describe('heuristic question suggestions', () => {
  const segs = [
    seg('s1', 0, 'Okay so the new onboarding flow needs to launch soon.'),
    seg('s2', 8, 'Someone should talk to design about the mockups.'),
    seg('s3', 15, 'I think the budget is around $40k but not sure.'),
    seg('s4', 20, 'ok'),
  ];
  it('quotes the exact words it reacted to and links the segment', () => {
    const out = heuristicQuestions(segs);
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const q of out) {
      expect(q.source).toBe('heuristic');
      expect(q.quote).toBeTruthy();
      const seg = segs.find((s) => s.id === q.segmentId)!;
      expect(seg.text).toContain(q.quote!.replace(/…$/, '').slice(0, 20));
      expect(q.question).toContain(q.quote!);
    }
    expect(out.some((q) => q.kind === 'deadline')).toBe(true);
    expect(out.some((q) => q.kind === 'ownership')).toBe(true);
  });
  it('returns nothing for small talk and ignores very short segments', () => {
    expect(heuristicQuestions([seg('a', 0, 'Hi everyone, good morning to all of you.'), seg('b', 3, 'soon')])).toEqual([]);
  });
  it('respects the limit and never repeats an already-asked question', () => {
    const first = heuristicQuestions(segs, { limit: 1 });
    expect(first).toHaveLength(1);
    const again = heuristicQuestions(segs, { alreadyAsked: first.map((q) => q.question) });
    expect(again.map((q) => q.question)).not.toContain(first[0]!.question);
  });
  it('produces only one question per kind', () => {
    const kinds = heuristicQuestions([seg('x', 0, 'We are blocked on the API and there is a risk of delay.'), seg('y', 5, 'There is another problem with the vendor contract.')]).map((q) => q.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe('AI suggestion parsing', () => {
  it('parses fenced JSON arrays and drops malformed or duplicate items', () => {
    const raw = '```json\n[{"question":"Who owns the rollout plan?","reason":"No owner named."},{"question":"Who owns the rollout plan?"},{"question":"no question mark here"},42]\n```';
    const out = parseAiSuggestions(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'ai', kind: 'ai', reason: 'No owner named.' });
  });
  it('accepts {questions:[…]} and plain strings, caps at limit', () => {
    const out = parseAiSuggestions('{"questions":["What is the deadline for launch?","Who signs off on budget?","Is QA included?","Extra one here?"]}', 3);
    expect(out).toHaveLength(3);
  });
  it('returns [] for unusable output instead of throwing', () => {
    expect(parseAiSuggestions('Sorry, I cannot help.')).toEqual([]);
    expect(parseAiSuggestions('[not json')).toEqual([]);
  });
});

describe('helpers', () => {
  it('builds a timestamped excerpt that respects the character budget', () => {
    const many = Array.from({ length: 100 }, (_, i) => seg(`s${i}`, i * 5, `line number ${i} with some words`));
    const ex = excerptFromSegments(many, 200);
    expect(ex.length).toBeLessThanOrEqual(200);
    expect(ex.endsWith('line number 99 with some words')).toBe(true);
    expect(ex.startsWith('[')).toBe(true);
  });
  it('prompt carries the avoid-list and demands JSON', () => {
    const p = suggestionPrompt('[00:01] hello', ['Who owns X?']);
    expect(p).toContain('Who owns X?');
    expect(p).toContain('JSON array only');
  });
  it('merges newest-first without duplicates and enforces the cap', () => {
    const a = heuristicQuestions([seg('1', 0, 'We should ship on friday for sure.')]);
    const merged = mergeSuggestions(a, [...a, ...parseAiSuggestions('["What is the rollback plan?"]')], 5);
    expect(merged).toHaveLength(a.length + 1);
  });
  it('throttles refreshes by interval and by new segment count', () => {
    const st = { lastRunAt: 1000, lastSegmentCount: 4 };
    expect(shouldRefresh(st, 5000, 8)).toBe(false);
    expect(shouldRefresh(st, 30000, 5)).toBe(false);
    expect(shouldRefresh(st, 30000, 6)).toBe(true);
  });
});
