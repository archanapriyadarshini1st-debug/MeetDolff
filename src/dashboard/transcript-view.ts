/**
 * Dashboard transcript: click a timestamp to hear that moment, open the
 * screenshot captured near it, and correct text/speakers inline. Edits keep the
 * provider's original text and never touch the saved audio.
 */

import { deleteSegment, editSegmentText, setSegmentSpeaker } from '../lib/transcript-edit.js';
import { formatOffset, nearestSnapshot } from '../lib/snapshots.js';
import type { Meeting, MeetingSnapshot, TranscriptSegment } from '../lib/types.js';

export interface TranscriptViewCtx {
  meeting: Meeting;
  snapshots: MeetingSnapshot[];
  audio: HTMLAudioElement | null;
  /** Persist the updated meeting. Throwing keeps the editor open. */
  onSave: (m: Meeting) => Promise<void>;
  onError: (msg: string | null) => void;
}

const SNAPSHOT_LINK_GAP_SEC = 20;
const urls = new Map<string, string>();

function urlFor(s: MeetingSnapshot): string {
  let u = urls.get(s.id);
  if (!u) {
    u = URL.createObjectURL(s.blob);
    urls.set(s.id, u);
  }
  return u;
}

/** Release object URLs from the previously displayed meeting. */
export function disposeSnapshotUrls(): void {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderTranscriptView(container: HTMLElement, initial: TranscriptViewCtx): void {
  const ctx = { ...initial };
  const preview = el('figure', 'snap-preview');
  preview.hidden = true;
  const previewImg = el('img');
  const previewCap = el('figcaption', 'muted small');
  preview.append(previewImg, previewCap);

  function showSnapshot(s: MeetingSnapshot, caption: string): void {
    previewImg.src = urlFor(s);
    previewImg.alt = `Screenshot of the shared tab at ${formatOffset(s.offsetSec)}`;
    previewCap.textContent = `${caption}${s.tabTitle ? ` · ${s.tabTitle}` : ''}${s.tabHost ? ` (${s.tabHost})` : ''}`;
    preview.hidden = false;
    preview.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function renderEditor(row: HTMLElement, seg: TranscriptSegment): void {
    row.replaceChildren();
    row.classList.add('editing');
    const text = el('textarea');
    text.value = seg.text;
    text.rows = 3;
    text.setAttribute('aria-label', `Transcript text at ${formatOffset(seg.start)}`);
    const speaker = el('input');
    speaker.type = 'text';
    speaker.value = seg.speaker ?? '';
    speaker.placeholder = 'Speaker (optional)';
    speaker.setAttribute('aria-label', 'Speaker label');
    const save = el('button', 'btn btn-sm btn-primary', 'Save');
    const cancel = el('button', 'btn btn-sm', 'Cancel');
    const del = el('button', 'btn btn-sm btn-danger', 'Delete segment');
    const actions = el('div', 'seg-actions');
    actions.append(save, cancel, del);
    row.append(text, speaker, actions);
    text.focus();
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') draw();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save.click();
    });
    cancel.addEventListener('click', draw);
    save.addEventListener('click', async () => {
      try {
        ctx.onError(null);
        let next = editSegmentText(ctx.meeting, seg.id, text.value);
        next = setSegmentSpeaker(next, seg.id, speaker.value);
        await ctx.onSave(next);
        ctx.meeting = next;
        draw();
      } catch (e) {
        ctx.onError(e instanceof Error ? e.message : 'Could not save the correction.');
      }
    });
    del.addEventListener('click', async () => {
      if (!confirm('Delete this transcript segment? The saved audio is not changed.')) return;
      try {
        const next = deleteSegment(ctx.meeting, seg.id);
        await ctx.onSave(next);
        ctx.meeting = next;
        draw();
      } catch (e) {
        ctx.onError(e instanceof Error ? e.message : 'Could not delete the segment.');
      }
    });
  }

  function draw(): void {
    container.replaceChildren(preview);
    if (ctx.meeting.transcript.length === 0) {
      container.appendChild(el('div', 'empty', 'No transcript yet. Use the side panel → Transcribe latest, or record with the microphone for a live transcript.'));
      return;
    }
    for (const seg of ctx.meeting.transcript) {
      const row = el('div', 'seg');
      const time = el('button', 't t-btn', `[${formatOffset(seg.start)}]`);
      time.type = 'button';
      time.disabled = !ctx.audio;
      time.title = ctx.audio ? 'Play the recording from here' : 'No saved audio';
      time.addEventListener('click', () => {
        if (!ctx.audio) return;
        ctx.audio.currentTime = seg.start;
        void ctx.audio.play().catch(() => undefined);
      });
      const body = el('span', 'seg-body');
      if (seg.speaker) body.appendChild(el('span', 'spk', `${seg.speaker}: `));
      body.appendChild(document.createTextNode(seg.text));
      row.append(time, body);
      if (seg.edited) {
        const tag = el('span', 'tag', 'edited');
        tag.title = seg.originalText ? `Original: ${seg.originalText}` : 'Speaker label corrected';
        row.appendChild(tag);
      }
      const snap = nearestSnapshot(ctx.snapshots, seg.start, SNAPSHOT_LINK_GAP_SEC);
      if (snap) {
        const b = el('button', 'btn btn-sm btn-ghost', 'Screen');
        b.type = 'button';
        b.title = `Screenshot captured at ${formatOffset(snap.offsetSec)}`;
        b.addEventListener('click', () => showSnapshot(snap, `Screen at ${formatOffset(snap.offsetSec)} (transcript ${formatOffset(seg.start)})`));
        row.appendChild(b);
      }
      const edit = el('button', 'btn btn-sm btn-ghost', 'Edit');
      edit.type = 'button';
      edit.setAttribute('aria-label', `Edit transcript at ${formatOffset(seg.start)}`);
      edit.addEventListener('click', () => renderEditor(row, seg));
      row.appendChild(edit);
      container.appendChild(row);
    }
  }

  draw();
}

/** Thumbnail strip of all captured moments. */
export function renderSnapshotGallery(
  container: HTMLElement,
  snapshots: MeetingSnapshot[],
  onOpen: (s: MeetingSnapshot) => void,
  onDelete: (s: MeetingSnapshot) => Promise<void>,
): void {
  container.replaceChildren();
  if (snapshots.length === 0) {
    container.appendChild(el('p', 'muted small', 'No captured moments. Press “Capture moment” in the side panel while recording.'));
    return;
  }
  const grid = el('div', 'snap-grid');
  for (const s of snapshots) {
    const cell = el('div', 'snap-cell');
    const open = el('button', 'snap-thumb');
    open.type = 'button';
    open.setAttribute('aria-label', `Open screenshot at ${formatOffset(s.offsetSec)}`);
    const img = el('img');
    img.src = urlFor(s);
    img.alt = '';
    img.loading = 'lazy';
    open.appendChild(img);
    open.addEventListener('click', () => onOpen(s));
    const cap = el('span', 'muted small', formatOffset(s.offsetSec));
    const del = el('button', 'btn btn-sm btn-ghost', 'Delete');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (confirm('Delete this screenshot?')) await onDelete(s);
    });
    cell.append(open, cap, del);
    grid.appendChild(cell);
  }
  container.appendChild(grid);
}
