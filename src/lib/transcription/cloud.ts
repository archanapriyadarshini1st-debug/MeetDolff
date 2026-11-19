/**
 * Cloud transcription via OpenAI-compatible /audio/transcriptions.
 * Works with OpenAI Whisper, Groq, Together, local Whisper servers, etc.
 * Sends recorded audio blob; parses verbose_json segments if available.
 */

import type { TranscriptionProvider, TranscriptionResult } from './provider.js';
import { makeSegment, segmentsToText } from './provider.js';

export interface CloudTranscriptionOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class CloudTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'cloud-whisper';
  constructor(private opts: CloudTranscriptionOptions) {}

  async transcribe(audioBlob: Blob, opts?: { language?: string }): Promise<TranscriptionResult> {
    if (!this.opts.apiKey) throw new Error('Cloud transcription requires an API key. Configure it in Settings.');
    const form = new FormData();
    const ext = audioBlob.type.includes('webm') ? 'webm' : audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
    form.append('file', audioBlob, `meeting.${ext}`);
    form.append('model', this.opts.model);
    form.append('response_format', 'verbose_json');
    if (opts?.language) form.append('language', opts.language);

    const base = this.opts.baseUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Transcription failed (${res.status}): ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as any;
    const rawSegments: any[] = json.segments ?? [];
    const segments = rawSegments.map((s: any, i: number) =>
      makeSegment(
        `cloud_${i}`,
        Number(s.start ?? 0),
        Number(s.end ?? 0),
        String(s.text ?? '').trim(),
        null, // Whisper basic has no diarization
      ),
    );
    const text = String(json.text ?? segmentsToText(segments)).trim();
    if (segments.length === 0 && text) {
      segments.push(makeSegment('cloud_0', 0, 0, text, null));
    }
    return { segments, text, provider: this.name, hasDiarization: false };
  }
}
