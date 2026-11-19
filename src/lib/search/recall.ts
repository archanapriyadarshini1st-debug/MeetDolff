/**
 * Choose which meetings are put in front of the model for a question.
 * Time references ("last Tuesday at 7 PM") narrow the pool deterministically;
 * otherwise meetings are ranked by full-text relevance.
 */

import type { Meeting } from '../types.js';
import { searchMeetings } from '../search.js';
import { filterMeetingsByTemporal, parseTemporalQuery, type TemporalRange } from './temporal.js';

export interface RecallSelection {
  chosen: Meeting[];
  temporal: TemporalRange | null;
  /** True when a time was named but memory holds no meeting for it: do not call a model. */
  noMatch: boolean;
  /** Plain-language explanation shown to the user */
  note: string | null;
}

function clock(m: Meeting): string {
  return new Date(m.startedAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function selectMeetingsForQuestion(
  meetings: Meeting[],
  scope: 'all' | 'latest',
  query: string,
  now: Date = new Date(),
  max = 5,
): RecallSelection {
  const pool = scope === 'latest' && meetings.length ? [meetings[0]!] : meetings;
  const temporal = parseTemporalQuery(query, now);

  if (temporal) {
    const matched = filterMeetingsByTemporal(pool, temporal);
    if (matched.length === 0) {
      const sameDay = filterMeetingsByTemporal(pool, { ...temporal, timeOfDayMin: null });
      const near = sameDay.length ? ` Meetings on that day: ${sameDay.map((m) => `“${m.title}” (${clock(m)})`).join('; ')}.` : '';
      return { chosen: [], temporal, noMatch: true, note: `No meeting in memory matches ${temporal.label}.${near}` };
    }
    const chosen = matched.length > max ? rankWithin(matched, query).slice(0, max) : matched;
    return { chosen, temporal, noMatch: false, note: `Meetings matching ${temporal.label}` };
  }

  const ranked = query ? searchMeetings(pool, query) : [];
  const chosen = ranked.length ? ranked.slice(0, max).map((r) => r.meeting) : pool.slice(0, max);
  return { chosen, temporal: null, noMatch: false, note: null };
}

function rankWithin(matched: Meeting[], query: string): Meeting[] {
  const ranked = searchMeetings(matched, query).map((r) => r.meeting);
  const rest = matched.filter((m) => !ranked.includes(m));
  return [...ranked, ...rest];
}
