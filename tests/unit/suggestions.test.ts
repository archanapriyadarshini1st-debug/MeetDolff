import { describe, expect, it } from 'vitest';
import { parseSuggestions, suggestionPrompt, SuggestionPacer } from '../../src/lib/ai/suggestions.js';

describe('parseSuggestions', () => {
  it('parses a bare array and fenced JSON', () => {
    expect(parseSuggestions('["Who owns the migration plan?","What is the deadline for the beta?"]')).toHaveLength(2);
    expect(parseSuggestions('```json\n{"questions":["Who owns the rollout checklist?"]}\n```')).toEqual(['Who owns the rollout checklist?']);
  });
  it('recovers an array embedded in prose and survives garbage', () => {
    expect(parseSuggestions('Sure! ["What is the budget for Q1?"] hope that helps')).toEqual(['What is the budget for Q1?']);
    expect(parseSuggestions('not json at all')).toEqual([]);
    expect(parseSuggestions('[1, null, {"a":1}]')).toEqual([]);
  });
  it('drops statements, duplicates, repeats of earlier suggestions and over-long items; caps count', () => {
    const shown = ['Who owns the migration plan?'];
    const raw = JSON.stringify(['Who owns the migration plan?', 'Ship it now.', 'What is the deadline?', 'what is the deadline?', 'x?', 'a'.repeat(200) + '?', 'Q one is here?', 'Q two is here?', 'Q three is here?']);
    const out = parseSuggestions(raw, shown);
    expect(out).toEqual(['What is the deadline?', 'Q one is here?', 'Q two is here?', 'Q three is here?']);
  });
});

describe('SuggestionPacer', () => {
  it('waits for enough new text and the minimum interval', () => {
    const p = new SuggestionPacer(100, 10_000);
    p.add('short');
    expect(p.shouldRun(0)).toBe(false);
    p.add('x'.repeat(120));
    expect(p.shouldRun(0)).toBe(true);
    const window = p.begin(0);
    expect(window).toContain('short');
    p.end();
    p.add('y'.repeat(150));
    expect(p.shouldRun(5_000)).toBe(false); // too soon
    expect(p.shouldRun(10_000)).toBe(true);
  });
  it('never runs concurrently and resets cleanly', () => {
    const p = new SuggestionPacer(10, 0);
    p.add('z'.repeat(50));
    p.begin(1);
    p.add('z'.repeat(50));
    expect(p.shouldRun(2)).toBe(false);
    p.end();
    expect(p.shouldRun(2)).toBe(true);
    p.reset();
    expect(p.peek()).toBe('');
  });
  it('prompt includes excerpt and previously shown questions', () => {
    const s = suggestionPrompt('we need to ship by friday', ['Who tests it?']);
    expect(s).toContain('ship by friday');
    expect(s).toContain('Who tests it?');
  });
});
