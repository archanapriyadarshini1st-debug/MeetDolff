/**
 * Web Speech API transcription (SpeechRecognition).
 * Local, no API key, works in Chrome. Interim + final results.
 * No diarization — speaker is always null (honest).
 */

import type { TranscriptionProvider, TranscriptionResult } from './provider.js';
import { makeSegment, segmentsToText } from './provider.js';

type SpeechRecognitionCtor = new () => any;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class WebSpeechProvider implements TranscriptionProvider {
  readonly name = 'web-speech';
  private rec: any | null = null;
  private segments: any[] = [];
  private startTime = 0;

  static isSupported(): boolean {
    return getCtor() !== null;
  }

  async transcribe(_audioBlob: Blob): Promise<TranscriptionResult> {
    // Web Speech works live from mic, not from a recorded blob.
    // For blob transcription, caller should use live capture or cloud provider.
    throw new Error(
      'Web Speech API transcribes live microphone input, not recorded blobs. Use live mode or configure a cloud transcription provider.',
    );
  }

  startLive(onPartial: (text: string) => void, onFinal?: (segment: { id: string; start: number; end: number; text: string }) => void): void {
    const Ctor = getCtor();
    if (!Ctor) throw new Error('SpeechRecognition is not supported in this browser.');
    this.stopLive();
    this.segments = [];
    this.startTime = Date.now();
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          const text = r[0]?.transcript?.trim() ?? '';
          if (text) {
            const now = (Date.now() - this.startTime) / 1000;
            const start = this.segments.length ? this.segments[this.segments.length - 1].at : 0;
            this.segments.push({ text, at: now });
            onFinal?.({ id: `ws_${this.segments.length - 1}`, start, end: now, text });
          }
        } else {
          interim += r[0]?.transcript ?? '';
        }
      }
      onPartial(interim);
    };
    rec.onerror = (e: any) => {
      console.error('[MeetDolff] SpeechRecognition error', e);
    };
    rec.start();
    this.rec = rec;
  }

  stopLive(): void {
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
    this.rec = null;
  }

  /** Convert captured live segments to TranscriptionResult */
  toResult(): TranscriptionResult {
    const segs = this.segments.map((s, i) => {
      const start = i === 0 ? 0 : this.segments[i - 1].at;
      return makeSegment(`ws_${i}`, start, s.at, s.text, null);
    });
    return {
      segments: segs,
      text: segmentsToText(segs),
      provider: this.name,
      hasDiarization: false,
    };
  }
}
