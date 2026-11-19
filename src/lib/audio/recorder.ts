/**
 * Offscreen recorder: tab audio (via tabCapture stream id) and/or mic.
 * Preserves tab playback by routing captured stream to destination.
 * Persists chunks incrementally so a crash loses little.
 */

export interface RecorderEvents {
  onChunk?: (chunk: Blob, index: number) => void;
  onError?: (err: Error) => void;
  onStop?: (blob: Blob) => void;
}

export class OffscreenRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private streams: MediaStream[] = [];
  private audioCtx: AudioContext | null = null;
  private chunkIndex = 0;
  private events: RecorderEvents = {};
  private paused = false;

  setEvents(e: RecorderEvents): void {
    this.events = e;
  }

  async startTab(streamId: string, includeMic = false): Promise<void> {
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } as any,
      } as any,
    });
    this.streams.push(tabStream);
    // Preserve playback: route tab audio to speakers.
    try {
      this.audioCtx = new AudioContext();
      this.audioCtx.createMediaStreamSource(tabStream).connect(this.audioCtx.destination);
    } catch {
      /* playback routing is best-effort */
    }
    let combined = tabStream;
    if (includeMic) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.streams.push(mic);
      combined = new MediaStream([...tabStream.getAudioTracks(), ...mic.getAudioTracks()]);
    }
    this.beginRecord(combined);
  }

  async startMic(): Promise<void> {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.streams.push(mic);
    this.beginRecord(mic);
  }

  private beginRecord(stream: MediaStream): void {
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    this.recorder = new MediaRecorder(stream, { mimeType: mime });
    this.chunks = [];
    this.chunkIndex = 0;
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
        this.events.onChunk?.(e.data, this.chunkIndex++);
      }
    };
    this.recorder.onerror = (e) => {
      this.events.onError?.(new Error(`Recorder error: ${(e as any).error?.name ?? 'unknown'}`));
    };
    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: mime });
      this.events.onStop?.(blob);
    };
    // 1s chunks: reliable persistence + recovery.
    this.recorder.start(1000);
  }

  pause(): void {
    if (this.recorder?.state === 'recording') {
      this.recorder.pause();
      this.paused = true;
    }
  }

  resume(): void {
    if (this.recorder?.state === 'paused') {
      this.recorder.resume();
      this.paused = false;
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  stop(): void {
    try {
      this.recorder?.stop();
    } catch {
      /* ignore */
    }
    for (const s of this.streams) {
      for (const t of s.getTracks()) t.stop();
    }
    this.streams = [];
    this.recorder = null;
    this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
  }
}
