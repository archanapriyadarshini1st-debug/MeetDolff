/**
 * Side panel "During the meeting": real-time question suggestions + Capture moment.
 *
 * Rule-based suggestions run locally on every finalized segment. AI-written
 * suggestions are opt-in (sends the last few minutes of transcript text to the
 * user's own provider) and fall back to rules on any failure.
 */

import { createProvider } from '../lib/ai/provider.js';
import {
  excerptFromSegments,
  heuristicQuestions,
  mergeSuggestions,
  parseAiSuggestions,
  shouldRefresh,
  SUGGESTION_SYSTEM,
  suggestionPrompt,
  type RefreshState,
  type SuggestedQuestion,
} from '../lib/ai/suggestions.js';
import { formatOffset } from '../lib/snapshots.js';
import type { ProviderSettings, TranscriptSegment } from '../lib/types.js';

const AI_OPT_IN_KEY = 'liveSuggestionsUseAi';

interface LiveDeps {
  loadSettings: () => Promise<ProviderSettings>;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function initLive({ loadSettings }: LiveDeps): void {
  const list = $('liveQuestions');
  const status = $('liveStatus');
  const interim = $('liveInterim');
  const aiToggle = $('useAiSuggestions') as HTMLInputElement;
  const snapBtn = $('btnSnapshot') as HTMLButtonElement;
  const snapStatus = $('snapshotStatus');

  let sessionId = '';
  let segments: TranscriptSegment[] = [];
  let suggestions: SuggestedQuestion[] = [];
  const dismissed: string[] = [];
  let refresh: RefreshState = { lastRunAt: 0, lastSegmentCount: 0 };
  let aiInFlight = false;

  function render(): void {
    list.replaceChildren();
    if (suggestions.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'muted small';
      empty.textContent = segments.length
        ? 'Nothing worth asking yet. Suggestions appear when timing, owners, decisions, risks or figures come up.'
        : 'Suggestions appear while you record with the microphone. Tab-only audio has no live transcript in this version.';
      list.appendChild(empty);
      return;
    }
    for (const s of suggestions) {
      const li = document.createElement('li');
      li.className = 'live-q';
      const q = document.createElement('p');
      q.className = 'live-q-text';
      q.textContent = s.question;
      const meta = document.createElement('p');
      meta.className = 'muted small';
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = s.source === 'ai' ? 'AI' : 'Rule';
      meta.append(tag, document.createTextNode(` ${s.reason}`));
      const actions = document.createElement('div');
      actions.className = 'live-q-actions';
      const copy = document.createElement('button');
      copy.className = 'btn btn-sm';
      copy.textContent = 'Copy';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(s.question);
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = 'Copy failed';
        }
        setTimeout(() => (copy.textContent = 'Copy'), 1500);
      });
      const dismiss = document.createElement('button');
      dismiss.className = 'btn btn-sm btn-ghost';
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', () => {
        dismissed.push(s.question);
        suggestions = suggestions.filter((x) => x.id !== s.id);
        render();
      });
      actions.append(copy, dismiss);
      li.append(q, meta, actions);
      list.appendChild(li);
    }
  }

  async function maybeAskAi(): Promise<void> {
    if (!aiToggle.checked || aiInFlight) return;
    if (!shouldRefresh(refresh, Date.now(), segments.length)) return;
    const settings = await loadSettings();
    if (!settings.apiKey) {
      status.textContent = 'AI suggestions need an API key (Settings). Using rule-based suggestions.';
      return;
    }
    aiInFlight = true;
    refresh = { lastRunAt: Date.now(), lastSegmentCount: segments.length };
    try {
      const res = await createProvider(settings, settings.aiProvider).chat(
        [
          { role: 'system', content: SUGGESTION_SYSTEM },
          { role: 'user', content: suggestionPrompt(excerptFromSegments(segments), [...dismissed, ...suggestions.map((s) => s.question)]) },
        ],
        { temperature: 0.4 },
      );
      const parsed = parseAiSuggestions(res.text);
      if (parsed.length === 0) status.textContent = 'AI returned no usable questions. Showing rule-based suggestions.';
      else status.textContent = `AI suggestions via ${res.provider} (${res.model}).`;
      suggestions = mergeSuggestions(suggestions, parsed);
    } catch (e) {
      status.textContent = `AI suggestions unavailable: ${e instanceof Error ? e.message.slice(0, 140) : 'request failed'}. Using rule-based suggestions.`;
    } finally {
      aiInFlight = false;
      render();
    }
  }

  function onSegment(seg: TranscriptSegment): void {
    segments.push(seg);
    status.textContent = `${segments.length} live segment${segments.length === 1 ? '' : 's'} heard.`;
    suggestions = mergeSuggestions(suggestions, heuristicQuestions(segments, { alreadyAsked: [...dismissed, ...suggestions.map((s) => s.question)] }));
    render();
    void maybeAskAi();
  }

  chrome.runtime.onMessage.addListener((msg: any) => {
    if (msg?.type === 'LIVE_SEGMENT' && msg.segment) {
      if (msg.sessionId && msg.sessionId !== sessionId) {
        sessionId = String(msg.sessionId);
        segments = [];
        suggestions = [];
        dismissed.length = 0;
        refresh = { lastRunAt: 0, lastSegmentCount: 0 };
      }
      const s = msg.segment;
      onSegment({ id: String(s.id), start: Number(s.start), end: Number(s.end), speaker: null, text: String(s.text ?? '') });
    } else if (msg?.type === 'TRANSCRIPTION_PARTIAL') {
      interim.textContent = String(msg.text ?? '');
    } else if (msg?.type === 'MEETING_SAVED') {
      status.textContent = 'Recording saved. Suggestions from the meeting are kept below until you close the panel.';
      interim.textContent = '';
    }
  });

  chrome.storage.local.get(AI_OPT_IN_KEY).then((r: any) => {
    aiToggle.checked = r?.[AI_OPT_IN_KEY] === true;
  });
  aiToggle.addEventListener('change', () => {
    void chrome.storage.local.set({ [AI_OPT_IN_KEY]: aiToggle.checked });
    status.textContent = aiToggle.checked
      ? 'AI suggestions on: recent transcript text is sent to your configured provider.'
      : 'AI suggestions off: everything stays on this device.';
  });

  snapBtn.addEventListener('click', async () => {
    snapBtn.disabled = true;
    snapStatus.className = 'muted small';
    snapStatus.textContent = 'Capturing…';
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'CAPTURE_SNAPSHOT' })) as any;
      if (!res?.ok) throw new Error(res?.error ?? 'Snapshot failed.');
      snapStatus.textContent = `Captured screen at ${formatOffset(res.offsetSec ?? 0)} (#${res.count}). Stored on this device and linked to the transcript.`;
    } catch (e) {
      snapStatus.className = 'error';
      snapStatus.textContent = e instanceof Error ? e.message : 'Snapshot failed.';
    } finally {
      snapBtn.disabled = false;
    }
  });

  render();
}
