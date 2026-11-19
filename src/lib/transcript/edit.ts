/**
 * Human corrections to a transcript.
 *
 * Provider output is never discarded: the first edit stores the original text
 * on the segment so a correction can always be reverted and audited. Because
 * decisions/actions were derived from the old words, an edit marks the summary
 * stale instead of silently leaving it inconsistent.
 */

import type { Meeting, TranscriptSegment } from '../types.js';
import { segmentsToText } from '../transcription/provider.js';

export class TranscriptEditError extends Error {}

function withSegments(meeting: Meeting, transcript: TranscriptSegment[], now: Date): Meeting {
  const hasDerived = Boolean(meeting.summary) || meeting.decisions.length > 0 || meeting.actionItems.length > 0;
  return {
    ...meeting,
    transcript,
    transcriptText: segmentsToText(transcript),
    ...(hasDerived ? { summaryStale: true } : {}),
    updatedAt: now.toISOString(),
  };
}

function find(meeting: Meeting, segmentId: string): number {
  const i = meeting.transcript.findIndex((s) => s.id === segmentId);
  if (i === -1) throw new TranscriptEditError(`Segment ${segmentId} not found.`);
  return i;
}

export function editSegment(meeting: Meeting, segmentId: string, newText: string, now: Date = new Date()): Meeting {
  const text = newText.replace(/\s+/g, ' ').trim();
  if (!text) throw new TranscriptEditError('A transcript segment cannot be empty. Delete the meeting instead, or restore the original.');
  const i = find(meeting, segmentId);
  const seg = meeting.transcript[i]!;
  if (text === seg.text) return meeting;
  const next: TranscriptSegment = { ...seg, text, originalText: seg.originalText ?? seg.text, editedAt: now.toISOString() };
  // Restoring the original text clears the edit markers.
  if (next.originalText === text) {
    const { originalText: _o, editedAt: _e, ...clean } = next;
    return withSegments(meeting, meeting.transcript.map((s, k) => (k === i ? clean : s)), now);
  }
  return withSegments(meeting, meeting.transcript.map((s, k) => (k === i ? next : s)), now);
}

export function revertSegment(meeting: Meeting, segmentId: string, now: Date = new Date()): Meeting {
  const seg = meeting.transcript[find(meeting, segmentId)]!;
  if (seg.originalText === undefined) return meeting;
  return editSegment(meeting, segmentId, seg.originalText, now);
}

/** Rename a speaker label everywhere (e.g. "Speaker 1" → "Priya"). Empty target clears the label. */
export function renameSpeaker(meeting: Meeting, from: string, to: string, now: Date = new Date()): Meeting {
  const target = to.trim();
  const transcript = meeting.transcript.map((s) => (s.speaker === from ? { ...s, speaker: target || null } : s));
  const participants = target
    ? Array.from(new Set(meeting.participants.map((p) => (p === from ? target : p))))
    : meeting.participants.filter((p) => p !== from);
  // Labels only: the words are unchanged, so the summary is not stale.
  return { ...meeting, transcript, transcriptText: segmentsToText(transcript), participants, updatedAt: now.toISOString() };
}

export function editedSegmentCount(meeting: Meeting): number {
  return meeting.transcript.filter((s) => s.originalText !== undefined).length;
}
