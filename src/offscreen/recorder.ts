/**
 * Offscreen document: owns MediaRecorder + streams.
 * Service worker sends streamId; this document redeems it via getUserMedia.
 */

import { OffscreenRecorder } from '../lib/audio/recorder.js';
import { WebSpeechProvider } from '../lib/transcription/web-speech.js';
import type { TranscriptionResult } from '../lib/transcription/provider.js';

const recorder = new OffscreenRecorder();
let chunks: Blob[] = [];
let mime = 'audio/webm';
let sessionId = '';
let liveSpeech: WebSpeechProvider | null = null;
let liveResult: TranscriptionResult | null = null;

recorder.setEvents({
  onChunk: (chunk, index) => {
    chunks.push(chunk);
    // Persist the actual one-second chunk in the service worker's IndexedDB.
    // The final blob is still written on stop; chunks protect against a
    // renderer/offscreen failure while a long meeting is in progress.
    void chunk.arrayBuffer().then((buffer) =>
      chrome.runtime.sendMessage({
        type: 'RECORDING_CHUNK',
        sessionId,
        index,
        mime: chunk.type || mime,
        buffer,
      }).catch(() => undefined),
    );
  },
  onError: (err) => {
    chrome.runtime.sendMessage({ type: 'RECORD_ERROR', error: err.message }).catch(() => undefined);
  },
  onStop: (blob) => {
    mime = blob.type || mime;
    // Send audio to service worker for IndexedDB persistence.
    // ArrayBuffer transfer keeps it structured-cloneable.
    blob.arrayBuffer().then((buf) => {
      chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED', sessionId, mime, buffer: buf, liveResult }).catch(() => undefined);
    });
  },
});

function startLiveSpeech(): void {
  try {
    liveSpeech = new WebSpeechProvider();
    liveSpeech.startLive(
      (text) => {
        chrome.runtime.sendMessage({ type: 'TRANSCRIPTION_PARTIAL', sessionId, text }).catch(() => undefined);
      },
      (segment) => {
        // Finalized segments feed the side panel's live question suggestions.
        chrome.runtime.sendMessage({ type: 'LIVE_SEGMENT', sessionId, segment }).catch(() => undefined);
      },
    );
  } catch {
    // Recording must not fail just because SpeechRecognition is unavailable.
    liveSpeech = null;
  }
}

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.target !== 'offscreen') return;
      if (msg.type === 'START_TAB') {
        chunks = [];
        liveResult = null;
        sessionId = String(msg.sessionId ?? '');
        await recorder.startTab(msg.streamId, msg.includeMic === true);
        if (msg.liveTranscription === true && msg.includeMic === true) startLiveSpeech();
        sendResponse({ ok: true });
      } else if (msg.type === 'START_MIC') {
        chunks = [];
        liveResult = null;
        sessionId = String(msg.sessionId ?? '');
        await recorder.startMic();
        if (msg.liveTranscription === true) startLiveSpeech();
        sendResponse({ ok: true });
      } else if (msg.type === 'PAUSE') {
        recorder.pause();
        sendResponse({ ok: true });
      } else if (msg.type === 'RESUME') {
        recorder.resume();
        sendResponse({ ok: true });
      } else if (msg.type === 'STOP') {
        if (liveSpeech) {
          liveSpeech.stopLive();
          liveResult = liveSpeech.toResult();
          liveSpeech = null;
        }
        recorder.stop();
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : 'Offscreen error' });
    }
  })();
  return true;
});
