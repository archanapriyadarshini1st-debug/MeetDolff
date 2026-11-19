/**
 * Pure transcript-correction helpers. Corrections never destroy the original
 * recognizer output (kept in `originalText`) and always mark an existing
 * summary as stale so the user is told the derived memory is out of date.
 */

import type { Meeting, TranscriptSegment } from '../types.js';

export class TranscriptEditError extends Error {}

/** Same joining rule used when a transcript is first created. */
export function rebuildTranscriptText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(' ').trim();
}

function mapSegment(meeting: Meeting, segmentId: string, fn: (s: TranscriptSegment) => TranscriptSegment, now: Date): Meeting {
  if (!meeting.transcript.some((s) => s.id === segmentId)) throw new TranscriptEditError(`Segment ${segmentId} not found.`);
  const transcript = meeting.transcript.map((s) => (s.id === segmentId ? fn(s) : s));
  const iso = now.toISOString();
  return {
    ...meeting,
    transcript,
    transcriptText: rebuildTranscriptText(transcript),
    summaryStale: meeting.summary ? true : (meeting.summaryStale ?? false),
    transcriptEditedAt: iso,
    updatedAt: iso,
  };
}

export function editSegmentText(meeting: Meeting, segmentId: string, text: string, now: Date = new Date()): Meeting {
  const next = text.replace(/\s+/g, ' ').trim();
  if (!next) throw new TranscriptEditError('A transcript segment cannot be empty.');
  return mapSegment(
    meeting,
    segmentId,
    (s) => {
      if (s.text === next) return s;
      const original = s.originalText ?? s.text;
      // Reverting to the original clears the edited flag instead of leaving a phantom edit.
      if (next === original) {
        const { originalText: _o, edited: _e, ...rest } = s;
        void _o;
        void _e;
        return { ...rest, text: next };
      }
      return { ...s, text: next, edited: true, originalText: original };
    },
    now,
  );
}

/** Label (or clear) the speaker of one segment. Manual labels are not diarization. */
export function setSegmentSpeaker(meeting: Meeting, segmentId: string, speaker: string | null, now: Date = new Date()): Meeting {
  const label = speaker?.trim() || null;
  return mapSegment(meeting, segmentId, (s) => ({ ...s, speaker: label }), now);
}

/** Rename every occurrence of a speaker label (e.g. "Speaker 1" -> "Priya"). */
export function renameSpeaker(meeting: Meeting, from: string, to: string, now: Date = new Date()): Meeting {
  const label = to.trim();
  if (!label) throw new TranscriptEditError('Speaker name cannot be empty.');
  if (!meeting.transcript.some((s) => s.speaker === from)) return meeting;
  const iso = now.toISOString();
  const transcript = meeting.transcript.map((s) => (s.speaker === from ? { ...s, speaker: label } : s));
  const participants = Array.from(new Set([...meeting.participants.filter((p) => p !== from), label]));
  return { ...meeting, transcript, participants, summaryStale: meeting.summary ? true : (meeting.summaryStale ?? false), transcriptEditedAt: iso, updatedAt: iso };
}
