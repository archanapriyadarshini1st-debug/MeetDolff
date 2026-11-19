/**
 * Side-panel "Questions to consider".
 *
 * Non-intrusive by design: nothing pops up, suggestions refresh at most every
 * few seconds, each can be dismissed, and the AI engine is OFF by default
 * (live transcript text only leaves the device if the user opts in).
 * Inputs: live Web Speech partials (mic), or text the user pastes (tab audio
 * has no live STT yet), plus follow-ups carried over from saved meetings.
 */

import { createProvider } from '../lib/ai/provider.js';
import {
  carryOverQuestions,
  suggestQuestions,
  suggestQuestionsWithLlm,
  type QuestionSuggestion,
} from '../lib/ai/suggestions.js';
import type { Meeting, ProviderSettings } from '../lib/types.js';

const PREF_KEY = 'suggestionPrefs';
const WINDOW_CHARS = 2400; // roughly the last two minutes of speech
const REFRESH_MS = 6000;

export interface SuggestionsDeps {
  loadSettings(): Promise<ProviderSettings>;
  listMeetings(limit: number): Promise<Meeting[]>;
}

export function initSuggestionsPanel(deps: SuggestionsDeps): void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const list = $('sugList');
  const status = $('sugStatus');
  const manual = $('sugManual') as HTMLTextAreaElement;
  const useAi = $('sugUseAi') as HTMLInputElement;

  const asked = new Set<string>();
  let buffer = '';
  let interim = '';
  let live: QuestionSuggestion[] = [];
  let memory: QuestionSuggestion[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;

  void chrome.storage.local.get(PREF_KEY).then((r) => {
    useAi.checked = Boolean((r as any)?.[PREF_KEY]?.useAi);
  });
  useAi.addEventListener('change', () => {
    void chrome.storage.local.set({ [PREF_KEY]: { useAi: useAi.checked } });
    schedule(0);
  });

  function render(): void {
    list.replaceChildren();
    const items = [...live, ...memory];
    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Nothing worth asking yet. Suggestions appear when owners, deadlines, reasoning or risks are left open.';
      list.appendChild(empty);
      return;
    }
    for (const s of items) {
      const li = document.createElement('li');
      li.className = 'sug';
      const q = document.createElement('p');
      q.className = 'sug-q';
      q.textContent = s.question;
      const why = document.createElement('p');
      why.className = 'small muted';
      why.textContent = `${s.reason} ${s.source === 'llm' ? '(AI)' : s.source === 'memory' ? '(from memory)' : ''}`.trim();
      const ev = document.createElement('blockquote');
      ev.className = 'sug-ev small';
      ev.textContent = s.evidence;
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'btn btn-sm btn-ghost';
      dismiss.textContent = 'Dismiss';
      dismiss.setAttribute('aria-label', `Dismiss suggestion: ${s.question}`);
      dismiss.addEventListener('click', () => {
        asked.add(s.question);
        live = live.filter((x) => x !== s);
        memory = memory.filter((x) => x !== s);
        render();
      });
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn btn-sm btn-ghost';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => void navigator.clipboard?.writeText(s.question));
      const row = document.createElement('div');
      row.className = 'seg-actions-row';
      row.append(copy, dismiss);
      li.append(q, why, ev, row);
      list.appendChild(li);
    }
  }

  async function compute(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const text = `${buffer} ${interim}`.trim().slice(-WINDOW_CHARS);
      const opts = { asked: [...asked], max: 3 };
      if (!text) {
        live = [];
      } else if (useAi.checked) {
        status.textContent = 'Asking your AI provider…';
        const settings = await deps.loadSettings();
        live = await suggestQuestionsWithLlm(createProvider(settings, settings.aiProvider), text, opts);
      } else {
        live = suggestQuestions(text, opts);
      }
      status.textContent = text
        ? `Based on the last ${Math.min(text.length, WINDOW_CHARS)} characters of conversation${useAi.checked ? ' · AI on' : ' · on-device'}.`
        : 'Waiting for conversation. Start a mic recording with live transcription, or paste text below.';
      render();
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : 'Could not compute suggestions.';
    } finally {
      busy = false;
    }
  }

  function schedule(delay = REFRESH_MS): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void compute(), delay);
  }

  async function loadMemory(): Promise<void> {
    memory = carryOverQuestions(await deps.listMeetings(30), { asked: [...asked], max: 3 });
    render();
  }

  $('sugRun').addEventListener('click', () => {
    buffer = manual.value;
    interim = '';
    void compute();
  });
  $('sugClear').addEventListener('click', () => {
    buffer = '';
    interim = '';
    manual.value = '';
    void compute();
  });

  // Live partials from the offscreen recorder (relayed by the service worker).
  // Only interim text is relayed: when it resets/restarts, commit what we had.
  chrome.runtime.onMessage.addListener((msg: any) => {
    if (msg?.type !== 'TRANSCRIPTION_PARTIAL') return;
    const text = String(msg.text ?? '').trim();
    if (!text) {
      if (interim) { buffer = `${buffer} ${interim}`.slice(-WINDOW_CHARS * 2); interim = ''; }
    } else {
      if (interim && !text.startsWith(interim.slice(0, 12))) buffer = `${buffer} ${interim}`.slice(-WINDOW_CHARS * 2);
      interim = text;
    }
    schedule();
  });
  chrome.runtime.onMessage.addListener((msg: any) => {
    if (msg?.type === 'MEETING_SAVED' || msg?.type === 'MEETING_PROCESSED') void loadMemory();
  });

  render();
  void compute();
  void loadMemory();
}
