import { describe, it, expect } from 'vitest';
import { suggestQuestions } from '../../src/lib/ai/question-suggestions.js';
import { seg } from './_fixtures.js';

describe('suggestQuestions', () => {
  it('returns nothing for an empty transcript', () => {
    expect(suggestQuestions([])).toEqual([]);
  });

  it('asks who owns a commitment with no owner, and when', () => {
    const out = suggestQuestions([seg('a', 0, 'We need to migrate the database.')]);
    expect(out.map((s) => s.kind).sort()).toEqual(['deadline', 'owner']);
    expect(out[0]!.question).toContain('migrate the database');
    expect(out.every((s) => s.segmentId === 'a')).toBe(true);
  });

  it('does not ask for an owner or deadline that was stated', () => {
    const out = suggestQuestions([seg('a', 0, "I'll ship the prototype by Friday.")]);
    expect(out).toEqual([]);
  });

  it('asks for a date when someone takes a task without one', () => {
    const out = suggestQuestions([seg('a', 0, 'Maya will review the contract.')]);
    expect(out.map((s) => s.kind)).toEqual(['deadline']);
  });

  it('flags uncertainty and risks', () => {
    const out = suggestQuestions([seg('a', 0, "I'm not sure the vendor API will hold up."), seg('b', 6, 'The main risk is the launch date.')]);
    expect(out.map((s) => s.kind).sort()).toEqual(['risk', 'uncertainty']);
  });

  it('flags a question nobody answered, but not an answered one', () => {
    const unanswered = suggestQuestions([seg('a', 0, 'Who is handling the billing integration?'), seg('b', 6, 'Anyway, lunch is at noon.')]);
    expect(unanswered.map((s) => s.kind)).toEqual(['unanswered']);
    const answeredYes = suggestQuestions([seg('a', 0, 'Is billing integration ready?'), seg('b', 6, 'Yes, it shipped.')]);
    expect(answeredYes).toEqual([]);
    const answeredTopic = suggestQuestions([seg('a', 0, 'Who is handling the billing integration?'), seg('b', 6, 'Dana is handling billing integration. Done Monday.')]);
    expect(answeredTopic).toEqual([]);
  });

  it('does not flag the latest question as unanswered (it is probably being answered right now)', () => {
    expect(suggestQuestions([seg('a', 0, 'Who is handling the billing integration?')])).toEqual([]);
  });

  it('only looks at the recent window, newest first, and respects max', () => {
    const segs = [
      seg('old', 0, 'We should rewrite the parser.'),
      seg('new1', 500, 'We must cut the scope.'),
      seg('new2', 510, "I'm not sure about the budget."),
    ];
    const out = suggestQuestions(segs, { windowSec: 60, max: 2 });
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.segmentId !== 'old')).toBe(true);
    expect(out[0]!.segmentId).toBe('new2');
  });

  it('never repeats a question', () => {
    const out = suggestQuestions([seg('a', 0, 'We should ship.'), seg('b', 6, 'We should ship.')]);
    expect(new Set(out.map((s) => s.question)).size).toBe(out.length);
  });
});
