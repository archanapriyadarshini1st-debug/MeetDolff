import type { ProviderSettings } from '../types.js';
import type { TranscriptionProvider } from './provider.js';
import { CloudTranscriptionProvider } from './cloud.js';
import { WebSpeechProvider } from './web-speech.js';

/**
 * Selects a transcription adapter from user settings. Web Speech is live-only;
 * Cloud is the recorded-blob path used by the post-recording workflow.
 */
export function createTranscriptionProvider(settings: ProviderSettings): TranscriptionProvider {
  if (settings.transcriptionProvider === 'cloud') {
    return new CloudTranscriptionProvider({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.transcriptionModel,
    });
  }
  return new WebSpeechProvider();
}
