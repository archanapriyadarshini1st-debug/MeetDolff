import { describe, expect, it } from 'vitest';
import { meetingsInRange, parseDateQuery } from '../../src/lib/retrieval/dates.js';
import { extractTerms, groundedPrompt, notInMemoryMessage, retrieveEvidence, verifyCitations } from '../../src/lib/retrieval/evidence.js';
import type { Meeting } from '../../src/lib/types.js';

// Wednesday 18 Nov 2026, 12:00 local
const NOW = new Date(2026, 10, 18, 12, 0);
const iso = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

function meeting(id: string, title: string, start: string, durMin: number, over: Partial<Meeting> = {}): Meeting {
  const end = new Date(new Date(start).getTime() + durMin * 60_000).toISOString();
  return {
    id, title, startedAt: start, endedAt: end, durationSec: durMin * 60, participants: [], transcript: [], transcriptText: '',
    summary: null, topics: [], decisions: [], actionItems: [], openQuestions: [], commitments: [], project: null,
    audioSource: 'tab', audioMime: null, hasAudio: false, memoryVersion: 1, createdAt: start, updatedAt: start, ...over,
  };
}

const tuesdayEvening = meeting('m1', 'Frontend sync', iso(2026, 11, 17, 19, 0), 45, {
  summary: 'Team agreed to migrate the dashboard to Postgres.',
  decisions: [{ text: 'Migrate dashboard queries to Postgres by December', evidence: [] }],
  transcript: [
    { id: 's1', start: 0, end: 5, speaker: null, text: 'Database performance is the main blocker for the dashboard.' },
    { id: 's2', start: 65, end: 70, speaker: null, text: 'Priya will complete the frontend by Friday.' },
  ],
});
const lastMonth = meeting('m2', 'Roadmap review', iso(2026, 10, 12, 10, 0), 30, {
  transcript: [{ id: 'x', start: 10, end: 15, speaker: null, text: 'We rejected the GraphQL approach because of caching complexity.' }],
});

describe('parseDateQuery', () => {
  it('resolves "last Tuesday at 7 PM" to a ±90 min window', () => {
    const dq = parseDateQuery('What happened in our meeting last Tuesday at 7 PM?', NOW)!;
    expect(dq.hasTime).toBe(true);
    expect(dq.from.getTime()).toBe(new Date(2026, 10, 17, 17, 30).getTime());
    expect(dq.to.getTime()).toBe(new Date(2026, 10, 17, 20, 30).getTime());
  });
  it('treats "last friday" as strictly before today', () => {
    const dq = parseDateQuery('last friday', NOW)!;
    expect(dq.from.getDate()).toBe(13);
  });
  it('handles last month, yesterday, N days ago and ISO dates', () => {
    expect(parseDateQuery('problems discussed last month', NOW)!.from.getMonth()).toBe(9);
    expect(parseDateQuery('yesterday', NOW)!.from.getDate()).toBe(17);
    expect(parseDateQuery('3 days ago', NOW)!.from.getDate()).toBe(15);
    expect(parseDateQuery('on 2026-11-02', NOW)!.from.getDate()).toBe(2);
  });
  it('returns null when no date intent exists', () => {
    expect(parseDateQuery('database performance', NOW)).toBeNull();
  });
  it('filters meetings by overlap', () => {
    const dq = parseDateQuery('last tuesday at 7pm', NOW)!;
    expect(meetingsInRange([tuesdayEvening, lastMonth], dq).map((m) => m.id)).toEqual(['m1']);
    const wrongTime = parseDateQuery('last tuesday at 9am', NOW)!;
    expect(meetingsInRange([tuesdayEvening], wrongTime)).toEqual([]);
  });
});

describe('retrieveEvidence', () => {
  const all = [tuesdayEvening, lastMonth];
  it('answers a date question from only the matching meeting', () => {
    const r = retrieveEvidence(all, 'What happened in our meeting last Tuesday at 7 PM?', NOW);
    expect(r.passages.length).toBeGreaterThan(0);
    expect(new Set(r.passages.map((p) => p.meetingId))).toEqual(new Set(['m1']));
  });
  it('finds topic matches across meetings with timestamps', () => {
    const r = retrieveEvidence(all, 'Why did we reject GraphQL?', NOW);
    const p = r.passages.find((x) => x.meetingId === 'm2')!;
    expect(p.startSec).toBe(10);
  });
  it('returns nothing (no LLM call needed) when memory has no evidence', () => {
    const r = retrieveEvidence(all, 'kubernetes autoscaling budget', NOW);
    expect(r.passages).toEqual([]);
    expect(notInMemoryMessage(r)).toMatch(/isn't in your meeting memory/);
  });
  it('says no meeting exists for an empty date window', () => {
    const r = retrieveEvidence(all, 'what happened last friday', NOW);
    expect(r.passages).toEqual([]);
    expect(notInMemoryMessage(r)).toMatch(/couldn't find any meeting/);
  });
  it('drops date words and stopwords from search terms', () => {
    expect(extractTerms('what did we decide about the database last tuesday', ['last tuesday'])).toEqual(['database']);
  });
});

describe('verifyCitations', () => {
  const r = retrieveEvidence([tuesdayEvening], 'database performance', NOW);
  const id = r.passages.find((p) => p.startSec === 0)!.id;
  it('rewrites valid ids to title @ timestamp', () => {
    const v = verifyCitations(`Database performance blocks the dashboard [${id}].`, r.passages);
    expect(v.text).toContain('[Frontend sync @ 00:00]');
    expect(v.citations).toHaveLength(1);
    expect(v.grounded).toBe(true);
  });
  it('strips fabricated ids and reports them', () => {
    const v = verifyCitations('They shipped it [E99].', r.passages);
    expect(v.invalid).toEqual(['E99']);
    expect(v.text).not.toContain('E99');
    expect(v.grounded).toBe(false);
  });
  it('accepts an honest "not in memory" answer as grounded', () => {
    expect(verifyCitations("That isn't in your meeting memory.", r.passages).grounded).toBe(true);
  });
  it('builds a prompt that only lists retrieved passages', () => {
    const p = groundedPrompt('q', r);
    expect(p).toContain(`[${id}]`);
    expect(p).not.toContain('GraphQL');
  });
});
