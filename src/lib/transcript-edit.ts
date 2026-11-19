/**
 * Pure helpers for correcting a saved transcript. Every function returns a
 * new Meeting and never mutates its input. The first correction of a segment
 * preserves the provider's original text so nothing is silently lost.
 */

import type { Meeting, TranscriptSegment } from './types.js';

export function rebuildTranscriptText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
}

function withSegments(m: Meeting, segments: TranscriptSegment[], now: Date): Meeting {
  return { ...m, transcript: segments, transcriptText: rebuildTranscriptText(segments), updatedAt: now.toISOString() };
}

function requireSegment(m: Meeting, id: string): TranscriptSegment {
  const seg = m.transcript.find((s) => s.id === id);
  if (!seg) throw new Error(`Transcript segment “${id}” was not found.`);
  return seg;
}

export function editSegmentText(m: Meeting, segmentId: string, text: string, now = new Date()): Meeting {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Segment text cannot be empty. Delete the segment instead.');
  const seg = requireSegment(m, segmentId);
  const original = seg.originalText ?? seg.text;
  const next: TranscriptSegment = { ...seg, text: clean };
  if (clean === original) {
    delete next.originalText;
    next.edited = seg.speaker !== null && seg.edited === true && seg.originalText === undefined ? true : false;
    if (!next.edited) delete next.edited;
  } else {
    next.originalText = original;
    next.edited = true;
  }
  return withSegments(m, m.transcript.map((s) => (s.id === segmentId ? next : s)), now);
}

export function setSegmentSpeaker(m: Meeting, segmentId: string, speaker: string | null, now = new Date()): Meeting {
  const seg = requireSegment(m, segmentId);
  const label = speaker?.trim() ? speaker.trim() : null;
  if (label === seg.speaker) return m;
  return withSegments(m, m.transcript.map((s) => (s.id === segmentId ? { ...s, speaker: label, edited: true } : s)), now);
}

/** Rename a speaker label everywhere, e.g. “Speaker 1” → “Priya”. */
export function renameSpeaker(m: Meeting, from: string, to: string, now = new Date()): Meeting {
  const target = to.trim();
  if (!target) throw new Error('Speaker name cannot be empty.');
  let changed = false;
  const segments = m.transcript.map((s) => {
    if (s.speaker !== from) return s;
    changed = true;
    return { ...s, speaker: target, edited: true };
  });
  if (!changed) return m;
  const participants = m.participants.includes(from)
    ? Array.from(new Set(m.participants.map((p) => (p === from ? target : p))))
    : m.participants;
  return { ...withSegments(m, segments, now), participants };
}

export function deleteSegment(m: Meeting, segmentId: string, now = new Date()): Meeting {
  requireSegment(m, segmentId);
  return withSegments(m, m.transcript.filter((s) => s.id !== segmentId), now);
}

export function countEdited(m: Meeting): number {
  return m.transcript.filter((s) => s.edited).length;
}
