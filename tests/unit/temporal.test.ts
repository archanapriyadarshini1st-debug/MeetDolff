import { describe, it, expect } from 'vitest';
import { filterMeetingsByTemporal, parseTemporalQuery, parseTimeOfDay } from '../../src/lib/search/temporal.js';
import { selectMeetingsForQuestion } from '../../src/lib/search/recall.js';
import { meeting } from './_fixtures.js';

// Thursday 19 Nov 2026, 12:00 local. Tests build dates with local constructors so they pass in any TZ.
const NOW = new Date(2026, 10, 19, 12, 0);
const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-');

describe('parseTimeOfDay', () => {
  it.each([
    ['at 7 PM', 19 * 60],
    ['7pm', 19 * 60],
    ['7:30 p.m.', 19 * 60 + 30],
    ['12 am', 0],
    ['12pm', 12 * 60],
    ['at 19:15', 19 * 60 + 15],
    ['around noon', 720],
  ])('%s', (q, expected) => expect(parseTimeOfDay(q)).toBe(expected));

  it('does not mistake plain numbers for times', () => {
    expect(parseTimeOfDay('the 3 biggest problems')).toBeNull();
    expect(parseTimeOfDay('13 pm')).toBeNull();
  });
});

describe('parseTemporalQuery', () => {
  it('resolves "last Tuesday at 7 PM" to the previous Tuesday evening', () => {
    const r = parseTemporalQuery('What happened in our meeting last Tuesday at 7 PM?', NOW)!;
    expect(ymd(r.from)).toBe('2026-11-17');
    expect(r.timeOfDayMin).toBe(19 * 60);
    expect(r.label).toContain('7:00 PM');
  });

  it('"last Thursday" said on a Thursday means a week ago', () => {
    expect(ymd(parseTemporalQuery('last thursday', NOW)!.from)).toBe('2026-11-12');
  });

  it('bare weekday means the most recent occurrence, including today', () => {
    expect(ymd(parseTemporalQuery('what did we decide thursday', NOW)!.from)).toBe('2026-11-19');
    expect(ymd(parseTemporalQuery('on monday', NOW)!.from)).toBe('2026-11-16');
  });

  it('handles yesterday, today and the day before yesterday', () => {
    expect(ymd(parseTemporalQuery('yesterday', NOW)!.from)).toBe('2026-11-18');
    expect(ymd(parseTemporalQuery('today', NOW)!.from)).toBe('2026-11-19');
    expect(ymd(parseTemporalQuery('the day before yesterday', NOW)!.from)).toBe('2026-11-17');
  });

  it('handles weeks and months (Monday-based weeks)', () => {
    const lw = parseTemporalQuery('last week', NOW)!;
    expect([ymd(lw.from), ymd(lw.to)]).toEqual(['2026-11-9', '2026-11-15']);
    const tw = parseTemporalQuery('this week', NOW)!;
    expect(ymd(tw.from)).toBe('2026-11-16');
    const lm = parseTemporalQuery('last month', NOW)!;
    expect([ymd(lm.from), ymd(lm.to)]).toEqual(['2026-10-1', '2026-10-31']);
  });

  it('handles "last N days/weeks/months"', () => {
    const r = parseTemporalQuery('every meeting in the last 3 days', NOW)!;
    expect(ymd(r.from)).toBe('2026-11-16');
    expect(ymd(r.to)).toBe('2026-11-19');
    expect(ymd(parseTemporalQuery('past 2 weeks', NOW)!.from)).toBe('2026-11-5');
    expect(ymd(parseTemporalQuery('last 1 month', NOW)!.from)).toBe('2026-10-19');
  });

  it('handles explicit dates', () => {
    expect(ymd(parseTemporalQuery('meeting on 2026-11-02', NOW)!.from)).toBe('2026-11-2');
    expect(ymd(parseTemporalQuery('Nov 18th', NOW)!.from)).toBe('2026-11-18');
    expect(ymd(parseTemporalQuery('18 november', NOW)!.from)).toBe('2026-11-18');
    expect(ymd(parseTemporalQuery('March 3, 2025', NOW)!.from)).toBe('2025-3-3');
  });

  it('treats a year-less future date as last year', () => {
    expect(ymd(parseTemporalQuery('Dec 25', NOW)!.from)).toBe('2025-12-25');
  });

  it('returns null without a date reference', () => {
    expect(parseTemporalQuery('what did we decide about the database?', NOW)).toBeNull();
    expect(parseTemporalQuery('at 7pm', NOW)).toBeNull();
  });
});

describe('filterMeetingsByTemporal', () => {
  const tue7 = meeting({ id: 'tue7' });
  const tue10 = meeting({
    id: 'tue10',
    startedAt: new Date(2026, 10, 17, 10, 0).toISOString(),
    endedAt: new Date(2026, 10, 17, 10, 45).toISOString(),
  });
  const wed = meeting({
    id: 'wed',
    startedAt: new Date(2026, 10, 18, 19, 0).toISOString(),
    endedAt: new Date(2026, 10, 18, 19, 30).toISOString(),
  });

  it('keeps only the meeting running near the named time', () => {
    const r = parseTemporalQuery('last tuesday at 7pm', NOW)!;
    expect(filterMeetingsByTemporal([tue10, tue7, wed], r).map((m) => m.id)).toEqual(['tue7']);
  });

  it('a meeting that started earlier but is still running at that time matches', () => {
    const long = meeting({
      id: 'long',
      startedAt: new Date(2026, 10, 17, 18, 0).toISOString(),
      endedAt: new Date(2026, 10, 17, 20, 30).toISOString(),
    });
    const r = parseTemporalQuery('tuesday at 7:30 pm', NOW)!;
    expect(filterMeetingsByTemporal([long], r).map((m) => m.id)).toEqual(['long']);
  });

  it('returns the whole day, chronologically, when no time is named', () => {
    const r = parseTemporalQuery('last tuesday', NOW)!;
    expect(filterMeetingsByTemporal([tue7, wed, tue10], r).map((m) => m.id)).toEqual(['tue10', 'tue7']);
  });

  it('excludes meetings outside the range', () => {
    const r = parseTemporalQuery('yesterday', NOW)!;
    expect(filterMeetingsByTemporal([tue7], r)).toEqual([]);
  });
});

describe('selectMeetingsForQuestion', () => {
  const tue7 = meeting({ id: 'tue7', title: 'Frontend sync', transcriptText: 'we picked vite' });
  const other = meeting({
    id: 'other',
    title: 'Database review',
    startedAt: new Date(2026, 10, 12, 9, 0).toISOString(),
    endedAt: new Date(2026, 10, 12, 9, 30).toISOString(),
    transcriptText: 'postgres indexes are slow',
  });

  it('answers the headline question from the right meeting', () => {
    const sel = selectMeetingsForQuestion([other, tue7], 'all', 'What happened last Tuesday at 7 PM?', NOW);
    expect(sel.noMatch).toBe(false);
    expect(sel.chosen.map((m) => m.id)).toEqual(['tue7']);
    expect(sel.note).toContain('Meetings matching');
  });

  it('reports honestly when nothing matches and lists meetings that day', () => {
    const sel = selectMeetingsForQuestion([tue7], 'all', 'what happened last tuesday at 3pm', NOW);
    expect(sel.noMatch).toBe(true);
    expect(sel.chosen).toEqual([]);
    expect(sel.note).toContain('No meeting in memory matches');
    expect(sel.note).toContain('Frontend sync');
  });

  it('falls back to full-text ranking when no time is mentioned', () => {
    const sel = selectMeetingsForQuestion([tue7, other], 'all', 'postgres indexes', NOW);
    expect(sel.temporal).toBeNull();
    expect(sel.chosen[0]!.id).toBe('other');
  });

  it('respects the latest-only scope', () => {
    const sel = selectMeetingsForQuestion([other, tue7], 'latest', 'anything', NOW);
    expect(sel.chosen.map((m) => m.id)).toEqual(['other']);
  });
});
