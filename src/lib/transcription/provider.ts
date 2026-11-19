/**
 * Provider-independent transcription interface.
 * Implementations: Web Speech API (local, no key), Cloud Whisper
 * (OpenAI-compatible /audio/transcriptions), future Faster-Whisper.
 * Diarization is a separate capability — basic STT does NOT claim speakers.
 */

import type { TranscriptSegment } from '../types.js';

export interface TranscriptionResult {
  segments: TranscriptSegment[];
  text: string;
  /** Provider name for provenance */
  provider: string;
  /** Whether speaker labels are real diarization (false for basic STT) */
  hasDiarization: boolean;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(audioBlob: Blob, opts?: { language?: string }): Promise<TranscriptionResult>;
  /** Live partial transcription if supported */
  startLive?(onPartial: (text: string) => void, onFinal?: (segment: { text: string; at: number }) => void): void;
  stopLive?(): void;
}

export function segmentsToText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
}

export function makeSegment(id: string, start: number, end: number, text: string, speaker: string | null = null): TranscriptSegment {
  return { id, start, end, speaker, text };
}
