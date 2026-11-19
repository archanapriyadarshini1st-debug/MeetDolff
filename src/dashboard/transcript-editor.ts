/**
 * Inline transcript viewer/editor for the dashboard.
 * Click a timestamp to seek the saved audio; Edit to correct text or speaker.
 * Esc cancels, Ctrl/Cmd+Enter saves. Originals are preserved (see lib/transcript/edit).
 */

import { editSegmentText, setSegmentSpeaker } from '../lib/transcript/edit.js';
import type { Meeting, TranscriptSegment } from '../lib/types.js';

export interface TranscriptHooks {
  /** Persist the updated meeting; resolves when saved */
  onSave(updated: Meeting): Promise<void>;
  onError(message: string): void;
  seek(sec: number): void;
}

const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function mountTranscript(container: HTMLElement, initial: Meeting, hooks: TranscriptHooks): void {
  let meeting = initial;

  const render = (): void => {
    container.replaceChildren();
    if (meeting.transcript.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'No transcript segments yet.';
      container.appendChild(p);
      return;
    }
    for (const seg of meeting.transcript) container.appendChild(row(seg));
  };

  const row = (seg: TranscriptSegment): HTMLElement => {
    const div = document.createElement('div');
    div.className = 'seg';
    div.dataset.segId = seg.id;

    const t = document.createElement('button');
    t.type = 'button';
    t.className = 't seg-time';
    t.textContent = `[${clock(seg.start)}]`;
    t.title = 'Jump to this moment in the recording';
    t.addEventListener('click', () => hooks.seek(seg.start));

    const body = document.createElement('span');
    body.className = 'seg-body';
    if (seg.speaker) {
      const spk = document.createElement('span');
      spk.className = 'spk';
      spk.textContent = `${seg.speaker}: `;
      body.appendChild(spk);
    }
    body.appendChild(document.createTextNode(seg.text));
    if (seg.edited) {
      const badge = document.createElement('span');
      badge.className = 'badge-edited';
      badge.textContent = 'edited';
      badge.title = `Original: ${seg.originalText ?? ''}`;
      body.append(' ', badge);
    }

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-sm seg-edit';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit transcript at ${clock(seg.start)}`);
    edit.addEventListener('click', () => div.replaceWith(editor(seg)));

    div.append(t, body, edit);
    return div;
  };

  const editor = (seg: TranscriptSegment): HTMLElement => {
    const form = document.createElement('div');
    form.className = 'seg seg-editing';

    const speaker = document.createElement('input');
    speaker.type = 'text';
    speaker.value = seg.speaker ?? '';
    speaker.placeholder = 'Speaker (optional)';
    speaker.setAttribute('aria-label', 'Speaker label');

    const text = document.createElement('textarea');
    text.value = seg.text;
    text.rows = 3;
    text.setAttribute('aria-label', 'Transcript text');

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn-sm btn-primary';
    save.textContent = 'Save';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-sm';
    cancel.textContent = 'Cancel';

    const commit = async (): Promise<void> => {
      try {
        save.disabled = true;
        let next = editSegmentText(meeting, seg.id, text.value);
        if ((speaker.value.trim() || null) !== seg.speaker) next = setSegmentSpeaker(next, seg.id, speaker.value);
        await hooks.onSave(next);
        meeting = next;
        render();
      } catch (e) {
        save.disabled = false;
        hooks.onError(e instanceof Error ? e.message : 'Could not save the correction.');
      }
    };
    save.addEventListener('click', () => void commit());
    cancel.addEventListener('click', render);
    form.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') render();
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) void commit();
    });

    const actions = document.createElement('div');
    actions.className = 'seg-actions';
    actions.append(save, cancel);
    form.append(speaker, text, actions);
    queueMicrotask(() => text.focus());
    return form;
  };

  render();
}
