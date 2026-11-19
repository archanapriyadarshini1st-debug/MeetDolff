/**
 * Natural-language date retrieval ("last Tuesday at 7pm", "last month").
 * Deterministic and offline — no LLM involved. All math is in local time
 * because users talk about meetings in their own timezone.
 *
 * Conventions (documented in TECHNICAL_DECISIONS):
 *  - "last <weekday>"  = most recent such weekday strictly before today.
 *  - "<weekday>" / "this <weekday>" = most recent such weekday, today included.
 *  - "last week" = previous Monday–Sunday. "this week" = Monday → now.
 *  - A time ("7pm", "19:30") narrows a single-day query to ±90 minutes.
 */

import type { Meeting } from '../types.js';

export interface DateQuery {
  from: Date;
  to: Date;
  /** Human label used when telling the user what filter was applied */
  label: string;
  /** True when a time of day narrowed the window */
  hasTime: boolean;
  /** The substrings that were recognized (so term extraction can drop them) */
  matched: string[];
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WINDOW_MIN = 90;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });

function parseTime(s: string): { h: number; m: number; text: string } | null {
  const ampm = s.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3] === 'pm') h += 12;
    if (Number(ampm[1]) >= 1 && Number(ampm[1]) <= 12) return { h, m: Number(ampm[2] ?? 0), text: ampm[0] };
  }
  const colon = s.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (colon) return { h: Number(colon[1]), m: Number(colon[2]), text: colon[0] };
  return null;
}

export function parseDateQuery(query: string, now: Date = new Date()): DateQuery | null {
  const s = query.toLowerCase();
  const today = startOfDay(now);
  let day: Date | null = null;
  let range: { from: Date; to: Date } | null = null;
  let label = '';
  const matched: string[] = [];

  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const ago = s.match(/\b(\d{1,3})\s+days?\s+ago\b/);
  const lastN = s.match(/\b(?:last|past)\s+(\d{1,3})\s+days\b/);
  const weekday = s.match(new RegExp(`\\b(last|this|on)?\\s*(${WEEKDAYS.join('|')})\\b`));

  if (iso) {
    day = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    matched.push(iso[0]);
  } else if (/\byesterday\b/.test(s)) {
    day = addDays(today, -1);
    matched.push('yesterday');
  } else if (/\btoday\b/.test(s)) {
    day = today;
    matched.push('today');
  } else if (ago) {
    day = addDays(today, -Number(ago[1]));
    matched.push(ago[0]);
  } else if (lastN) {
    range = { from: addDays(today, -Number(lastN[1])), to: endOfDay(today) };
    label = `the last ${lastN[1]} days`;
    matched.push(lastN[0]);
  } else if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2] as string);
    let diff = (today.getDay() - target + 7) % 7;
    if (weekday[1] === 'last' && diff === 0) diff = 7;
    day = addDays(today, -diff);
    matched.push(weekday[0].trim());
  } else if (/\blast week\b/.test(s)) {
    const mondayThis = addDays(today, -((today.getDay() + 6) % 7));
    range = { from: addDays(mondayThis, -7), to: endOfDay(addDays(mondayThis, -1)) };
    label = 'last week';
    matched.push('last week');
  } else if (/\bthis week\b/.test(s)) {
    const mondayThis = addDays(today, -((today.getDay() + 6) % 7));
    range = { from: mondayThis, to: endOfDay(today) };
    label = 'this week';
    matched.push('this week');
  } else if (/\blast month\b/.test(s)) {
    range = { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)) };
    label = 'last month';
    matched.push('last month');
  } else if (/\bthis month\b/.test(s)) {
    range = { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(today) };
    label = 'this month';
    matched.push('this month');
  } else {
    return null;
  }

  if (day) {
    const t = parseTime(s);
    if (t) {
      const centre = new Date(day.getFullYear(), day.getMonth(), day.getDate(), t.h, t.m);
      matched.push(t.text.trim());
      return {
        from: new Date(centre.getTime() - WINDOW_MIN * 60_000),
        to: new Date(centre.getTime() + WINDOW_MIN * 60_000),
        label: `${fmtDay(day)} around ${centre.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
        hasTime: true,
        matched,
      };
    }
    return { from: day, to: endOfDay(day), label: fmtDay(day), hasTime: false, matched };
  }
  const r = range as { from: Date; to: Date };
  return { from: r.from, to: r.to, label, hasTime: false, matched };
}

/** Meetings whose [startedAt, endedAt] interval overlaps the query window. */
export function meetingsInRange(meetings: Meeting[], dq: Pick<DateQuery, 'from' | 'to'>): Meeting[] {
  const from = dq.from.getTime();
  const to = dq.to.getTime();
  return meetings.filter((m) => {
    const start = new Date(m.startedAt).getTime();
    const end = Math.max(start, new Date(m.endedAt).getTime());
    return start <= to && end >= from;
  });
}
