/**
 * Transcript view with inline correction. Pure DOM + the tested edit helpers in
 * lib/transcript/edit; persistence is delegated to the caller via onChange.
 */

import { editSegment, renameSpeaker, revertSegment, TranscriptEditError } from '../lib/transcript/edit.js';
import type { Meeting, TranscriptSegment } from '../lib/types.js';

const stamp = (sec: number) => `[${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}]`;

export function renderTranscript(container: HTMLElement, meeting: Meeting, onChange: (updated: Meeting) => Promise<void>): void {
  container.replaceChildren();

  if (meeting.summaryStale) {
    const note = document.createElement('div');
    note.className = 'stale-note';
    note.setAttribute('role', 'status');
    note.textContent = 'The transcript was corrected after the summary was written. Re-run “Summarize latest” in the side panel to refresh decisions and action items.';
    container.appendChild(note);
  }

  const apply = async (fn: () => Meeting, errorEl?: HTMLElement) => {
    try {
      await onChange(fn());
    } catch (e) {
      if (errorEl) errorEl.textContent = e instanceof TranscriptEditError || e instanceof Error ? e.message : 'Edit failed.';
    }
  };

  const row = (seg: TranscriptSegment): HTMLElement => {
    const div = document.createElement('div');
    div.className = 'seg';
    div.dataset.segmentId = seg.id;

    const t = document.createElement('span');
    t.className = 't';
    t.textContent = stamp(seg.start);

    const body = document.createElement('span');
    if (seg.speaker) {
      const spk = document.createElement('button');
      spk.type = 'button';
      spk.className = 'spk';
      spk.style.cssText = 'background:none;border:0;padding:0;color:inherit;font:inherit;cursor:pointer;text-decoration:underline dotted';
      spk.title = 'Rename this speaker everywhere';
      spk.textContent = `${seg.speaker}: `;
      const label = seg.speaker;
      spk.addEventListener('click', () => {
        const next = window.prompt(`Rename “${label}” everywhere in this meeting (leave empty to clear):`, label);
        if (next !== null) void apply(() => renameSpeaker(meeting, label, next));
      });
      body.appendChild(spk);
    }
    body.appendChild(document.createTextNode(seg.text));
    if (seg.originalText !== undefined) {
      const tag = document.createElement('span');
      tag.className = 'edited';
      tag.textContent = 'edited';
      tag.title = `Original: ${seg.originalText}`;
      body.appendChild(tag);
    }

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-sm seg-edit';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit transcript at ${stamp(seg.start)}`);
    edit.addEventListener('click', () => openEditor(div, seg));

    div.append(t, body, edit);
    return div;
  };

  const openEditor = (div: HTMLElement, seg: TranscriptSegment) => {
    div.replaceChildren();
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = stamp(seg.start);
    const area = document.createElement('textarea');
    area.value = seg.text;
    area.setAttribute('aria-label', `Correct transcript at ${stamp(seg.start)}`);
    const err = document.createElement('div');
    err.className = 'small';
    err.setAttribute('role', 'alert');
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    const mk = (label: string, click: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.textContent = label;
      b.addEventListener('click', click);
      return b;
    };
    bar.append(
      mk('Save', () => void apply(() => editSegment(meeting, seg.id, area.value), err)),
      mk('Cancel', () => div.replaceWith(row(seg))),
    );
    if (seg.originalText !== undefined) bar.append(mk('Restore original', () => void apply(() => revertSegment(meeting, seg.id), err)));
    div.append(t, area, err, bar);
    area.focus();
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') div.replaceWith(row(seg));
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void apply(() => editSegment(meeting, seg.id, area.value), err);
    });
  };

  if (meeting.transcript.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted small';
    empty.textContent = 'No transcript yet.';
    container.appendChild(empty);
    return;
  }
  for (const seg of meeting.transcript) container.appendChild(row(seg));
}
