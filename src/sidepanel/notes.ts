/**
 * Notes-first capture for the side panel.
 *
 * The loop this implements — and why it is the product's core rather than a side feature:
 *   1. during a call the user types rough notes (they are the artifact they care about);
 *   2. the notes are held against the *recording session*, because the meeting record does
 *      not exist until recording stops;
 *   3. after the call, "Merge with transcript" rewrites THEIR notes using the transcript as
 *      evidence — completing fragments, fixing names and numbers, and appending what they
 *      missed, without restructuring or inventing.
 *
 * Autosave is debounced and flushed on every mode change, so switching target mid-sentence
 * cannot lose or mis-file text.
 */

import { putMeeting } from '../lib/db.js';
import {
  applyNotes,
  applyNotesMerge,
  canMergeNotes,
  readLiveNotes,
  writeLiveNotes,
} from '../lib/notes/live.js';
import { NOTES_MERGE_SYSTEM, notesMergePrompt } from '../lib/ai/prompts.js';
import { createProvider } from '../lib/ai/provider.js';
import { loadProviderSettings as loadSettings } from '../lib/settings-store.js';
import { formatWhen, pluralize } from '../lib/utils/format.js';
import { renderNotesMarkdown } from '../lib/utils/markdown.js';
import type { Meeting, RecordingSession } from '../lib/types.js';

const SAVE_DEBOUNCE_MS = 500;

export interface NotesHooks {
  /** The meeting every action in the panel currently points at. */
  getTarget(): Meeting | null;
  /** The active recording session, if any. */
  getSession(): RecordingSession | null;
  /** Keep the panel's in-memory meeting list in sync after a write. */
  onMeetingUpdated(meeting: Meeting): void;
  showError(message: string | null): void;
  /** Confirmation surface shared with the artifact box. */
  showNotice(message: string): void;
}

type Mode = 'none' | 'live' | 'meeting';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function mountNotes(hooks: NotesHooks) {
  const input = $('notesInput') as HTMLTextAreaElement;
  const stateTag = $('notesState');
  const hint = $('notesHint');
  const mergeBtn = $('btnMergeNotes') as HTMLButtonElement;
  const showRawBtn = $('btnShowRaw') as HTMLButtonElement;
  const out = $('notesOut');

  let mode: Mode = 'none';
  let liveSessionId: string | null = null;
  let meetingId: string | null = null;
  let timer: number | null = null;
  let pending = '';
  let showingRaw = false;
  let busy = false;

  function setTag(text: string, kind: 'ok' | 'warn' | 'plain' = 'plain'): void {
    stateTag.textContent = text;
    stateTag.className = kind === 'plain' ? 'tag' : `tag ${kind}`;
  }

  function resolveMode(): void {
    const session = hooks.getSession();
    if (session && (session.state === 'recording' || session.state === 'paused')) {
      mode = 'live';
      liveSessionId = session.id;
      meetingId = null;
      return;
    }
    liveSessionId = null;
    const target = hooks.getTarget();
    meetingId = target?.id ?? null;
    mode = target ? 'meeting' : 'none';
  }

  async function flush(): Promise<void> {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
    await persist(pending);
  }

  async function persist(text: string): Promise<void> {
    try {
      if (mode === 'live' && liveSessionId) {
        await writeLiveNotes(liveSessionId, text);
        return;
      }
      if (mode === 'meeting' && meetingId) {
        const current = hooks.getTarget();
        if (!current || current.id !== meetingId) return;
        if ((current.notes ?? '') === text) return;
        const updated = applyNotes(current, text);
        await putMeeting(updated);
        hooks.onMeetingUpdated(updated);
        renderOutput(updated);
        renderState(updated);
      }
    } catch (e) {
      hooks.showError(e instanceof Error ? `Could not save notes: ${e.message}` : 'Could not save notes.');
    }
  }

  function scheduleSave(): void {
    if (mode === 'none') return;
    pending = input.value;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void persist(pending);
    }, SAVE_DEBOUNCE_MS);
    hint.textContent = 'Saving…';
  }

  function renderState(meeting: Meeting | null): void {
    if (mode === 'live') {
      setTag('Recording', 'warn');
      hint.textContent = 'Attaches to this recording when you stop it.';
      input.disabled = false;
      mergeBtn.disabled = true;
      mergeBtn.title = 'Stop the recording first — merging needs a transcript.';
      return;
    }
    if (mode === 'meeting' && meeting) {
      setTag(formatWhen(meeting.startedAt));
      input.disabled = false;
      const verdict = canMergeNotes(meeting);
      mergeBtn.disabled = !verdict.ok || busy;
      mergeBtn.title = verdict.reason ?? 'Rewrite your notes against the transcript';
      const words = (input.value.trim().match(/\S+/g) ?? []).length;
      hint.textContent = meeting.notesStale
        ? 'Your notes changed since the last merge.'
        : meeting.notesEnhanced
          ? `Merged ${meeting.notesMergedAt ? formatWhen(meeting.notesMergedAt) : 'earlier'}.`
          : words > 0
            ? pluralize(words, 'word')
            : 'Nothing here yet — start with what you would tell a colleague.';
      return;
    }
    setTag('No meeting', 'warn');
    hint.textContent = 'Record a meeting — or select one above — to keep notes against it.';
    input.disabled = true;
    mergeBtn.disabled = true;
  }

  function renderOutput(meeting: Meeting | null): void {
    const enhanced = meeting?.notesEnhanced ?? '';
    const raw = meeting?.notes ?? '';
    if (!enhanced) {
      out.hidden = true;
      out.replaceChildren();
      showRawBtn.hidden = true;
      showingRaw = false;
      return;
    }
    out.hidden = false;
    showRawBtn.hidden = false;
    showRawBtn.textContent = showingRaw ? 'Show merged notes' : 'Show as written';
    out.replaceChildren();

    const head = document.createElement('div');
    head.className = 'section-head';
    head.style.marginBottom = 'var(--s2)';
    const title = document.createElement('h3');
    title.className = 'section-title';
    title.style.fontSize = 'var(--t-meta)';
    title.textContent = showingRaw ? 'Your notes, as written' : 'Your notes, merged with the transcript';
    const actions = document.createElement('div');
    actions.className = 'section-actions';
    const dl = document.createElement('button');
    dl.className = 'btn btn-sm btn-ghost';
    dl.textContent = 'Download .md';
    dl.addEventListener('click', () => {
      const body = showingRaw ? raw : enhanced;
      const blob = new Blob([body], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(meeting?.title ?? 'notes').replace(/[^\w]+/g, '-').toLowerCase()}-notes.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
    actions.appendChild(dl);
    head.append(title, actions);

    if (meeting?.notesStale) {
      const warn = document.createElement('p');
      warn.className = 'warn-box';
      warn.textContent = 'You edited your notes after this merge, so the merged version may be out of date.';
      out.appendChild(warn);
    }

    if (showingRaw) {
      // "As written" must be literal: no list or bold interpretation of the user's own typing.
      const pre = document.createElement('pre');
      pre.className = 'notes-pre';
      pre.textContent = raw || 'No notes yet.';
      out.append(head, pre);
    } else {
      const body = document.createElement('div');
      body.className = 'notes-body';
      body.appendChild(renderNotesMarkdown(enhanced));
      out.append(head, body);
    }
  }

  function render(): void {
    resolveMode();
    const target = hooks.getTarget();
    if (mode === 'live' && liveSessionId) {
      // Load any draft already typed for this session (e.g. the panel was closed and reopened).
      void readLiveNotes().then((live) => {
        if (mode !== 'live' || liveSessionId === null) return;
        const text = live && live.sessionId === liveSessionId ? live.text : '';
        if (document.activeElement !== input) input.value = text;
        renderState(null);
        renderOutput(null);
      });
      renderState(null);
      renderOutput(null);
      return;
    }
    if (mode === 'meeting' && target) {
      if (document.activeElement !== input) input.value = target.notes ?? '';
      renderState(target);
      renderOutput(target);
      return;
    }
    input.value = '';
    renderState(null);
    renderOutput(null);
  }

  async function merge(): Promise<void> {
    const meeting = hooks.getTarget();
    const verdict = canMergeNotes(meeting);
    if (!verdict.ok || !meeting) {
      hooks.showError(verdict.reason ?? 'Nothing to merge.');
      return;
    }
    hooks.showError(null);
    await flush();
    busy = true;
    mergeBtn.disabled = true;
    mergeBtn.textContent = 'Merging…';
    try {
      const settings = await loadSettings();
      const provider = createProvider(settings, settings.aiProvider);
      const res = await provider.chat([
        { role: 'system', content: NOTES_MERGE_SYSTEM },
        { role: 'user', content: notesMergePrompt(meeting.notes ?? '', meeting.transcriptText, meeting.summary ?? '') },
      ]);
      const updated = applyNotesMerge(meeting, res.text);
      await putMeeting(updated);
      hooks.onMeetingUpdated(updated);
      showingRaw = false;
      renderOutput(updated);
      renderState(updated);
      hooks.showNotice('Notes merged. Your original words are still there — use “Show as written”.');
    } catch (e) {
      hooks.showError(e instanceof Error ? e.message : 'Notes merge failed.');
    } finally {
      busy = false;
      mergeBtn.textContent = 'Merge with transcript';
      const current = hooks.getTarget();
      if (current) renderState(current);
    }
  }

  input.addEventListener('input', scheduleSave);
  input.addEventListener('blur', () => void flush());
  mergeBtn.addEventListener('click', () => void merge());
  showRawBtn.addEventListener('click', () => {
    showingRaw = !showingRaw;
    renderOutput(hooks.getTarget());
  });

  return { render, flush };
}
