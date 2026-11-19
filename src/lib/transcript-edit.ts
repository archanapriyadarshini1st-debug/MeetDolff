/**
 * Pure transcript-correction helpers (no I/O).
 *
 * Users must be able to fix speech-to-text mistakes. Every helper returns a
 * NEW Meeting and never mutates its input. The first time a segment is edited
 * its provider text is preserved in `originalText`, so a correction is always
 * reversible and nothing is silently lost.
 *
 * Editing the transcript makes any existing summary / decisions / action items
 * potentially wrong, so `summaryStale` is raised (only when there is something
 * to go stale). Re-summarizing clears it.
 */

import type { Meeting, TranscriptSegment } from './types.js';

export function joinTranscript(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text.trim()).filter(Boolean).join(' ');
}

function hasDerivedContent(m: Meeting): boolean {
  return Boolean(m.summary) || m.decisions.length > 0 || m.actionItems.length > 0;
}

function withSegments(m: Meeting, transcript: TranscriptSegment[]): Meeting {
  return {
    ...m,
    transcript,
    transcriptText: joinTranscript(transcript),
    summaryStale: hasDerivedContent(m) ? true : (m.summaryStale ?? false),
    updatedAt: new Date().toISOString(),
  };
}

function findIndex(m: Meeting, segmentId: string): number {
  const i = m.transcript.findIndex((s) => s.id === segmentId);
  if (i < 0) throw new Error(`Transcript segment not found: ${segmentId}`);
  return i;
}

/** Replace the text of one segment. Identical text is a no-op (same object returned). */
export function editSegmentText(m: Meeting, segmentId: string, newText: string): Meeting {
  const i = findIndex(m, segmentId);
  const seg = m.transcript[i]!;
  const text = newText.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Segment text cannot be empty. Delete the segment instead.');
  if (text === seg.text) return m;
  const next: TranscriptSegment = {
    ...seg,
    text,
    edited: true,
    originalText: seg.originalText ?? seg.text,
  };
  // A user correction supersedes the provider's confidence score.
  delete next.confidence;
  const transcript = m.transcript.slice();
  transcript[i] = next;
  return withSegments(m, transcript);
}

/** Restore the provider's original text for an edited segment. */
export function revertSegment(m: Meeting, segmentId: string): Meeting {
  const i = findIndex(m, segmentId);
  const seg = m.transcript[i]!;
  if (!seg.edited || seg.originalText === undefined) return m;
  const { originalText, ...rest } = seg;
  const restored: TranscriptSegment = { ...rest, text: originalText };
  delete restored.edited;
  const transcript = m.transcript.slice();
  transcript[i] = restored;
  return withSegments(m, transcript);
}

/** Remove a segment entirely (e.g. background chatter that should not enter memory). */
export function removeSegment(m: Meeting, segmentId: string): Meeting {
  const i = findIndex(m, segmentId);
  return withSegments(m, m.transcript.filter((_, idx) => idx !== i));
}

/**
 * Assign or rename a speaker label. `from === null` targets unlabeled segments.
 * An empty `to` clears the label. Speaker names are user-asserted, never inferred.
 */
export function renameSpeaker(m: Meeting, from: string | null, to: string): Meeting {
  const label = to.trim() || null;
  let changed = false;
  const transcript = m.transcript.map((s) => {
    if ((s.speaker ?? null) !== from) return s;
    if ((s.speaker ?? null) === label) return s;
    changed = true;
    return { ...s, speaker: label };
  });
  if (!changed) return m;
  const participants = new Set(m.participants);
  if (from) participants.delete(from);
  if (label) participants.add(label);
  return {
    ...m,
    transcript,
    participants: [...participants],
    updatedAt: new Date().toISOString(),
  };
}

/** Distinct speaker labels present in the transcript (null = unlabeled). */
export function listSpeakers(m: Meeting): (string | null)[] {
  const seen = new Set<string | null>();
  for (const s of m.transcript) seen.add(s.speaker ?? null);
  return [...seen];
}

export function countEdited(m: Meeting): number {
  return m.transcript.filter((s) => s.edited).length;
}
