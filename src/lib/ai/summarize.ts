/**
 * Summarize (or re-summarize) one meeting through the user's configured
 * provider. Shared by the side panel and dashboard so both behave identically.
 * The provider is injectable so the flow is unit-testable without a network.
 */

import type { Meeting, ProviderSettings } from '../types.js';
import { createProvider, type AiProvider } from './provider.js';
import { SUMMARY_SYSTEM, summaryPrompt } from './prompts.js';
import { applyMeetingSummary, parseMeetingSummary } from './meeting-intelligence.js';

export async function summarizeMeeting(
  meeting: Meeting,
  settings: ProviderSettings,
  provider: AiProvider = createProvider(settings, settings.aiProvider),
): Promise<Meeting> {
  if (!meeting.transcriptText.trim()) {
    throw new Error('This meeting has no transcript to summarize.');
  }
  const res = await provider.chat([
    { role: 'system', content: SUMMARY_SYSTEM },
    { role: 'user', content: summaryPrompt(meeting.transcriptText) },
  ]);
  return applyMeetingSummary(meeting, parseMeetingSummary(res.text));
}
