/**
 * Natural-language time recall for meeting memory.
 *
 * Turns phrases such as "last Tuesday at 7 PM", "yesterday", "last 3 weeks" or
 * "Nov 18" into a concrete local-time range, then selects the meetings that
 * actually overlap it. Pure and deterministic (the clock is injected) so it can
 * be unit-tested and so no model ever guesses what "last Tuesday" means.
 */

import type { Meeting } from '../types.js';

export interface TemporalRange {
  from: Date;
  to: Date;
  /** Human-readable description of what was understood, shown to the user */
  label: string;
  /** Minutes after local midnight if the query named a time of day */
  timeOfDayMin: number | null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/** Half-width of the window around a named time that still counts as "that meeting". */
export const TIME_WINDOW_MIN = 45;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 0, 0, 0, 0);
}
/** Monday-based start of week. */
function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -dow);
}

function monthIndex(name: string): number {
  const key = name.slice(0, 3).toLowerCase();
  return MONTHS.findIndex((m) => m.startsWith(key));
}

/** Returns minutes after midnight, or null when the query names no explicit time. */
export function parseTimeOfDay(q: string): number | null {
  const ampm = /\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i.exec(q);
  if (ampm) {
    const h = Number(ampm[1]);
    if (h >= 1 && h <= 12) {
      const pm = ampm[3]!.toLowerCase().startsWith('p');
      return ((h % 12) + (pm ? 12 : 0)) * 60 + Number(ampm[2] ?? 0);
    }
  }
  const h24 = /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/.exec(q);
  if (h24) return Number(h24[1]) * 60 + Number(h24[2]);
  if (/\bnoon\b/i.test(q)) return 12 * 60;
  return null;
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function range(from: Date, to: Date, label: string, timeOfDayMin: number | null): TemporalRange {
  const withTime = timeOfDayMin !== null ? `${label} around ${fmtTime(timeOfDayMin)}` : label;
  return { from, to, label: withTime, timeOfDayMin };
}

/**
 * Understand the time reference in a question. Returns null when the query has
 * no recognisable date/period (a bare time like "at 7pm" is deliberately not
 * enough: it would silently match every day).
 */
export function parseTemporalQuery(query: string, now: Date = new Date()): TemporalRange | null {
  const q = query.toLowerCase();
  const tod = parseTimeOfDay(q);
  const today = startOfDay(now);

  const day = (d: Date, label: string) => range(startOfDay(d), endOfDay(d), label, tod);

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(q);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(d.getTime())) return day(d, fmtDay(d));
  }

  const monthDay =
    new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`).exec(q) ??
    null;
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s*(\\d{4}))?\\b`).exec(q);
  const dm = monthDay
    ? { mon: monthDay[1]!, day: Number(monthDay[2]), year: monthDay[3] }
    : dayMonth
      ? { mon: dayMonth[2]!, day: Number(dayMonth[1]), year: dayMonth[3] }
      : null;
  if (dm && dm.day >= 1 && dm.day <= 31) {
    let year = dm.year ? Number(dm.year) : now.getFullYear();
    let d = new Date(year, monthIndex(dm.mon), dm.day);
    // A year-less date that lands in the future means last year.
    if (!dm.year && d.getTime() > endOfDay(now).getTime()) {
      year -= 1;
      d = new Date(year, monthIndex(dm.mon), dm.day);
    }
    if (d.getDate() === dm.day) return day(d, fmtDay(d));
  }

  const span = /\b(?:last|past)\s+(\d{1,3})\s+(day|week|month)s?\b/.exec(q);
  if (span) {
    const n = Number(span[1]);
    const unit = span[2]!;
    const from =
      unit === 'day'
        ? addDays(today, -n)
        : unit === 'week'
          ? addDays(today, -7 * n)
          : new Date(today.getFullYear(), today.getMonth() - n, today.getDate());
    return range(from, endOfDay(now), `the last ${n} ${unit}${n === 1 ? '' : 's'}`, null);
  }

  if (/\bday before yesterday\b/.test(q)) return day(addDays(today, -2), 'the day before yesterday');
  if (/\byesterday\b/.test(q)) return day(addDays(today, -1), 'yesterday');
  if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b/.test(q)) return day(today, 'today');

  if (/\blast week\b/.test(q)) {
    const from = addDays(startOfWeek(today), -7);
    return range(from, endOfDay(addDays(from, 6)), 'last week', null);
  }
  if (/\bthis week\b/.test(q)) {
    const from = startOfWeek(today);
    return range(from, endOfDay(addDays(from, 6)), 'this week', null);
  }
  if (/\blast month\b/.test(q)) {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return range(from, endOfDay(new Date(today.getFullYear(), today.getMonth(), 0)), 'last month', null);
  }
  if (/\bthis month\b/.test(q)) {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return range(from, endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)), 'this month', null);
  }

  const wd = new RegExp(`\\b(?:(last|this|past)\\s+)?(${WEEKDAYS.join('|')})\\b`).exec(q);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[2]!);
    const qualifier = wd[1];
    let d: Date;
    if (qualifier === 'this') {
      const week = startOfWeek(today);
      d = addDays(week, (target + 6) % 7);
    } else {
      let back = (today.getDay() - target + 7) % 7;
      // "last Tuesday" said on a Tuesday means a week ago, not today.
      if (back === 0 && (qualifier === 'last' || qualifier === 'past')) back = 7;
      d = addDays(today, -back);
    }
    return day(d, `${qualifier ? `${qualifier} ` : ''}${wd[2]} (${fmtDay(d)})`);
  }

  return null;
}

/** Meetings that overlap the range; with a named time, only those running near it, closest first. */
export function filterMeetingsByTemporal(meetings: Meeting[], r: TemporalRange): Meeting[] {
  const interval = (m: Meeting): [number, number] => {
    const s = Date.parse(m.startedAt);
    const e = Date.parse(m.endedAt);
    return [s, Number.isNaN(e) || e < s ? s : e];
  };
  if (r.timeOfDayMin === null) {
    return meetings
      .filter((m) => {
        const [s, e] = interval(m);
        return !Number.isNaN(s) && s <= r.to.getTime() && e >= r.from.getTime();
      })
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  }
  const target = r.from.getTime() + r.timeOfDayMin * 60_000;
  const win = TIME_WINDOW_MIN * 60_000;
  return meetings
    .filter((m) => {
      const [s, e] = interval(m);
      return !Number.isNaN(s) && s <= target + win && e >= target - win;
    })
    .sort((a, b) => Math.abs(Date.parse(a.startedAt) - target) - Math.abs(Date.parse(b.startedAt) - target));
}

