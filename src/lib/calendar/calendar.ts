/**
 * Calendar: user-owned events, color-coded, linked to meetings.
 * Restrained palette only (ink/paper/accent/muted) — no rainbow.
 */

import { newId } from '../utils/id.js';
import type { CalendarEvent } from '../types.js';

export type CalendarColor = CalendarEvent['color'];

export function createEvent(input: {
  title: string;
  startsAt: string;
  endsAt: string;
  color?: CalendarColor;
  notes?: string;
  meetingId?: string | null;
}): CalendarEvent {
  const now = new Date().toISOString();
  return {
    id: newId('ev'),
    title: input.title,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    color: input.color ?? 'ink',
    notes: input.notes ?? '',
    meetingId: input.meetingId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function eventsOnDay(events: CalendarEvent[], dayIso: string): CalendarEvent[] {
  const day = dayIso.slice(0, 10);
  return events.filter((e) => e.startsAt.slice(0, 10) === day);
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}
