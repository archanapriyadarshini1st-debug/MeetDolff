/**
 * Presentation formatters.
 *
 * Pure functions only — no DOM, no chrome APIs — so they are unit-testable and
 * shared by the dashboard, side panel and popup. The rule this file enforces:
 * no raw machine values reach the UI (no `2460s`, no `1 decisions`, no ISO dates).
 */

/**
 * Compact human duration: 45 s · 41 min · 1 h 12 min. Never "2460s".
 * Minutes are derived from a rounded total, so 3599s is "1 h" and never "60 min".
 */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const total = Math.round(sec);
  if (total < 60) return `${total} s`;
  const totalMin = Math.round(total / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m === 0 ? `${h} h` : `${h} h ${m} min`;
  return `${totalMin} min`;
}

/** 00:00 / 1:02:03 — for timers and transcript timestamps. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

/** `1 decision` / `3 decisions`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Count + noun, dropped entirely when zero ("0 decisions" is noise). */
export function countIfAny(count: number, singular: string, plural?: string): string {
  return count > 0 ? pluralize(count, singular, plural) : '';
}

/** Join only the non-empty parts with a middot. */
export function joinMeta(parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(' · ');
}

/** "Today 14:00", "Yesterday 09:30", "Mon 12 Nov, 19:00", "12 Nov 2025, 19:00". */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const dayMs = 86_400_000;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / dayMs);
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays > 1 && diffDays < 7) {
    return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}, ${time}`;
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date}, ${time}`;
}

/** "12 Nov" style day label used by the calendar rows. */
export function formatDay(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays === -1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Time range for an event row: "14:00 – 14:30". */
export function formatTimeRange(startsAt: string, endsAt: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

/** "1 h 12 min of meetings across 3 recordings" style summary line. */
export function formatTotalDuration(seconds: number): string {
  return formatDuration(seconds);
}
