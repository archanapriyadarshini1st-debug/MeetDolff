/**
 * Editable transcript view for the dashboard.
 * Pure DOM, text set via textContent (transcripts are untrusted input).
 * All mutations go through the pure helpers in lib/transcript-edit.ts and are
 * persisted by the caller via `onChange`, so UI and domain logic stay separate.
 */

import { editSegmentText, listSpeakers, removeSegment, renameSpeaker, revertSegment } from '../lib/transcript-edit.js';
import type { Meeting, TranscriptSegment } from '../lib/types.js';

export interface EditorHooks {
  /** Persist the updated meeting. Must reject on failure so the UI can show it. */
  onChange(updated: Meeting): Promise<void>;
  onError(message: string): void;
}

const stamp = (sec: number): string =>
  `[${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}]`;

export function renderTranscriptEditor(host: HTMLElement, initial: Meeting, hooks: EditorHooks): void {
  let meeting = initial;
  let editingId: string | null = null;

  async function apply(next: Meeting): Promise<void> {
    if (next === meeting) { editingId = null; render(); return; }
    try {
      await hooks.onChange(next);
      meeting = next;
      editingId = null;
      render();
    } catch (e) {
      hooks.onError(e instanceof Error ? e.message : 'Could not save the transcript change.');
    }
  }

  function button(label: string, cls: string, handler: () => void, aria?: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', handler);
    return b;
  }

  function speakerBar(): HTMLElement {
    const bar = document.createElement('form');
    bar.className = 'speaker-bar';
    const speakers = listSpeakers(meeting);
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Speaker label to rename');
    for (const s of speakers) {
      const o = document.createElement('option');
      o.value = s ?? '';
      o.textContent = s ?? 'Unlabeled segments';
      sel.appendChild(o);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Name to assign';
    input.setAttribute('aria-label', 'New speaker name');
    input.maxLength = 60;
    const go = document.createElement('button');
    go.type = 'submit';
    go.className = 'btn btn-sm';
    go.textContent = 'Apply name';
    bar.append(sel, input, go);
    bar.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = input.value.trim();
      if (!name) { hooks.onError('Enter a speaker name first.'); return; }
      void apply(renameSpeaker(meeting, sel.value === '' ? null : sel.value, name));
    });
    return bar;
  }

  function segmentRow(seg: TranscriptSegment): HTMLElement {
    const row = document.createElement('div');
    row.className = seg.edited ? 'seg seg-edited' : 'seg';
    row.dataset.segmentId = seg.id;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = stamp(seg.start);
    const body = document.createElement('div');
    body.className = 'seg-body';

    if (editingId === seg.id) {
      const ta = document.createElement('textarea');
      ta.className = 'seg-input';
      ta.value = seg.text;
      ta.rows = Math.min(8, Math.max(2, Math.ceil(seg.text.length / 70)));
      ta.setAttribute('aria-label', `Edit transcript text at ${stamp(seg.start)}`);
      const actions = document.createElement('div');
      actions.className = 'seg-actions';
      actions.append(
        button('Save', 'btn btn-sm btn-primary', () => void apply(safeEdit(seg.id, ta.value))),
        button('Cancel', 'btn btn-sm btn-ghost', () => { editingId = null; render(); }),
      );
      ta.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void apply(safeEdit(seg.id, ta.value)); }
        if (e.key === 'Escape') { editingId = null; render(); }
      });
      body.append(ta, actions);
      queueMicrotask(() => ta.focus());
    } else {
      const text = document.createElement('span');
      if (seg.speaker) {
        const spk = document.createElement('span');
        spk.className = 'spk';
        spk.textContent = `${seg.speaker}: `;
        text.appendChild(spk);
      }
      text.appendChild(document.createTextNode(seg.text));
      body.appendChild(text);
      const actions = document.createElement('span');
      actions.className = 'seg-actions';
      actions.append(button('Edit', 'btn btn-sm btn-ghost', () => { editingId = seg.id; render(); }, `Edit transcript text at ${stamp(seg.start)}`));
      if (seg.edited) {
        actions.append(button('Revert', 'btn btn-sm btn-ghost', () => void apply(revertSegment(meeting, seg.id)), `Revert edit at ${stamp(seg.start)}`));
      }
      actions.append(button('Delete', 'btn btn-sm btn-ghost', () => {
        if (confirm('Remove this segment from the transcript? Original audio is not affected.')) void apply(removeSegment(meeting, seg.id));
      }, `Delete segment at ${stamp(seg.start)}`));
      body.appendChild(actions);
      if (seg.edited && seg.originalText) {
        const was = document.createElement('div');
        was.className = 'seg-original small muted';
        was.textContent = `Originally: ${seg.originalText}`;
        body.appendChild(was);
      }
    }
    row.append(t, body);
    return row;
  }

  function safeEdit(id: string, text: string): Meeting {
    try {
      return editSegmentText(meeting, id, text);
    } catch (e) {
      hooks.onError(e instanceof Error ? e.message : 'Invalid edit.');
      return meeting;
    }
  }

  function render(): void {
    host.replaceChildren();
    if (meeting.transcript.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No transcript yet. Use the side panel → Transcribe latest.';
      host.appendChild(empty);
      return;
    }
    host.appendChild(speakerBar());
    for (const seg of meeting.transcript) host.appendChild(segmentRow(seg));
  }

  render();
}
