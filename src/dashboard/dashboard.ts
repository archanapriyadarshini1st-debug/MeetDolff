/**
 * Dashboard: search, meeting detail, calendar, projects, export.
 */

import '../styles/design-system.css';
import { getAudio, listMeetings, putMeeting, listCalendarEvents, putCalendarEvent, deleteCalendarEvent, listProjectsForMeeting } from '../lib/db.js';
import { searchMeetings } from '../lib/search.js';
import { createEvent, formatTime } from '../lib/calendar/calendar.js';
import { downloadMeeting, exportMeetingToFolder, getStoredFolder, pickMemoryFolder, isFileSystemAccessSupported } from '../lib/memory-files.js';
import { formatDateTime } from '../lib/utils/id.js';
import { renderTranscript } from './transcript-editor.js';
import type { Meeting } from '../lib/types.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const searchInput = $('searchInput') as HTMLInputElement;
const meetingList = $('meetingList');
const detailBox = $('detailBox');
const errorBox = $('errorBox');
const calendarList = $('calendarList');
const projectList = $('projectList');

let allMeetings: Meeting[] = [];

function showError(msg: string | null): void {
  errorBox.replaceChildren();
  if (!msg) return;
  const box = document.createElement('div');
  box.className = 'error';
  box.setAttribute('role', 'alert');
  box.textContent = msg;
  errorBox.appendChild(box);
}

function showSuccess(msg: string): void {
  errorBox.replaceChildren();
  const box = document.createElement('div');
  box.className = 'ok-box';
  box.textContent = msg;
  errorBox.appendChild(box);
}

async function refreshMeetings(): Promise<void> {
  allMeetings = await listMeetings(100);
  renderMeetings(searchInput.value);
}

function renderMeetings(query: string): void {
  const results = query.trim() ? searchMeetings(allMeetings, query) : allMeetings.map((m) => ({ meeting: m, snippet: '', score: 0 }));
  if (results.length === 0) {
    meetingList.innerHTML = '<div class="empty">No meetings match.</div>';
    return;
  }
  meetingList.innerHTML = '';
  for (const r of results) {
    const m = r.meeting;
    const row = document.createElement('div');
    row.className = 'row';
    row.style.cursor = 'pointer';
    row.innerHTML = `<div class="row-main"><p class="row-title"></p><p class="row-meta"></p>${r.snippet ? '<p class="small muted"></p>' : ''}</div>`;
    row.querySelector('.row-title')!.textContent = m.title;
    row.querySelector('.row-meta')!.textContent = `${formatDateTime(m.startedAt)} · ${m.durationSec}s · ${m.decisions.length} decisions · ${m.actionItems.length} actions`;
    if (r.snippet) {
      const snip = row.querySelector('p.small')!;
      snip.innerHTML = r.snippet;
    }
    row.addEventListener('click', () => void showDetail(m.id));
    meetingList.appendChild(row);
  }
}

async function showDetail(id: string): Promise<void> {
  const m = allMeetings.find((x) => x.id === id);
  if (!m) return;
  detailBox.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h3 style="margin:0 0 4px"></h3>
    <p class="muted small"></p>
    <div class="toolbar">
      <button class="btn btn-sm" data-act="export">Export to folder</button>
      <button class="btn btn-sm" data-act="download">Download .md/.json</button>
      <button class="btn btn-sm" data-act="delete">Delete</button>
    </div>
    <div class="audio-wrap"></div>
    <h4>Summary</h4><p class="summary"></p>
    <h4>Decisions</h4><ul class="decisions"></ul>
    <h4>Action items</h4><ul class="actions"></ul>
    <h4>Transcript</h4><div class="transcript"></div>
  `;
  wrap.querySelector('h3')!.textContent = m.title;
  wrap.querySelector('.muted')!.textContent = `${formatDateTime(m.startedAt)} → ${formatDateTime(m.endedAt)} · ${m.audioSource} · ${m.transcript.length} segments`;
  wrap.querySelector('.summary')!.textContent = m.summary ?? 'No summary yet. Use the side panel → Summarize latest.';
  const dec = wrap.querySelector('.decisions')!;
  dec.innerHTML = m.decisions.length ? '' : '<li class="muted">None recorded.</li>';
  for (const d of m.decisions) {
    const li = document.createElement('li');
    li.textContent = d.text;
    dec.appendChild(li);
  }
  const act = wrap.querySelector('.actions')!;
  act.innerHTML = m.actionItems.length ? '' : '<li class="muted">None recorded.</li>';
  for (const a of m.actionItems) {
    const li = document.createElement('li');
    li.textContent = `${a.text}${a.owner ? ` (@${a.owner})` : ''}${a.deadline ? ` — due ${a.deadline}` : ''}`;
    act.appendChild(li);
  }
  const audioRec = await getAudio(m.id);
  if (audioRec?.blob.size) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = URL.createObjectURL(audioRec.blob);
    audio.setAttribute('aria-label', `Audio recording for ${m.title}`);
    const label = document.createElement('p');
    label.className = 'small muted';
    label.textContent = 'Saved recording';
    wrap.querySelector('.audio-wrap')!.append(label, audio);
  }
  const tr = wrap.querySelector('.transcript')!;
  renderTranscript(tr as HTMLElement, m, async (updated) => {
    await putMeeting(updated);
    await refreshMeetings();
    await showDetail(updated.id);
  });
  wrap.querySelector('[data-act="download"]')!.addEventListener('click', () => downloadMeeting(m));
  wrap.querySelector('[data-act="export"]')!.addEventListener('click', async () => {
    showError(null);
    try {
      let folder = await getStoredFolder();
      if (!folder) {
        if (!isFileSystemAccessSupported()) throw new Error('Folder access unsupported. Use Download instead.');
        folder = await pickMemoryFolder();
      }
      await exportMeetingToFolder(folder, m);
      showSuccess('Exported to memory folder.');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Export failed.');
    }
  });
  wrap.querySelector('[data-act="delete"]')!.addEventListener('click', async () => {
    if (!confirm(`Delete “${m.title}” and its audio? This cannot be undone.`)) return;
    const { deleteMeeting } = await import('../lib/db.js');
    await deleteMeeting(m.id);
    await refreshMeetings();
    detailBox.innerHTML = '<div class="empty">Meeting deleted.</div>';
  });
  detailBox.appendChild(wrap);
  await refreshProjectsFor(m.id);
}

async function refreshCalendar(): Promise<void> {
  const events = await listCalendarEvents();
  if (events.length === 0) {
    calendarList.innerHTML = '<div class="empty">No events. Add one above.</div>';
    return;
  }
  calendarList.innerHTML = '';
  for (const ev of events) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<div class="row-main"><p class="row-title"></p><p class="row-meta"></p></div>`;
    row.querySelector('.row-title')!.textContent = ev.title;
    row.querySelector('.row-meta')!.textContent = `${ev.startsAt.slice(0, 10)} · ${formatTime(ev.startsAt)}–${formatTime(ev.endsAt)} · ${ev.color}`;
    const del = document.createElement('button');
    del.className = 'btn btn-sm btn-ghost';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      await deleteCalendarEvent(ev.id);
      await refreshCalendar();
    });
    row.appendChild(del);
    calendarList.appendChild(row);
  }
}

async function refreshProjectsFor(meetingId: string): Promise<void> {
  const plans = await listProjectsForMeeting(meetingId);
  if (plans.length === 0) {
    projectList.innerHTML = '<div class="empty">No project plans for this meeting. Use side panel → Convert to project.</div>';
    return;
  }
  projectList.innerHTML = '';
  for (const p of plans) {
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = `<div class="row-main"><p class="row-title"></p><p class="row-meta"></p></div>`;
    div.querySelector('.row-title')!.textContent = p.title + (p.approved ? ' ✓ approved' : ' (pending approval)');
    div.querySelector('.row-meta')!.textContent = `${p.tasks.length} tasks · ${p.milestones.length} milestones · ${p.risks.length} risks`;
    const approve = document.createElement('button');
    approve.className = 'btn btn-sm';
    approve.textContent = p.approved ? 'Approved' : 'Approve';
    approve.disabled = p.approved;
    approve.addEventListener('click', async () => {
      const { putProject } = await import('../lib/db.js');
      await putProject({ ...p, approved: true });
      await refreshProjectsFor(meetingId);
    });
    div.appendChild(approve);
    projectList.appendChild(div);
  }
}

searchInput.addEventListener('input', () => renderMeetings(searchInput.value));

$('btnAddEvent').addEventListener('click', async () => {
  const title = ($('calTitle') as HTMLInputElement).value.trim();
  const date = ($('calDate') as HTMLInputElement).value;
  if (!title || !date) { showError('Title and date are required.'); return; }
  const startsAt = new Date(`${date}T09:00:00`).toISOString();
  const endsAt = new Date(`${date}T10:00:00`).toISOString();
  await putCalendarEvent(createEvent({ title, startsAt, endsAt }));
  ($('calTitle') as HTMLInputElement).value = '';
  await refreshCalendar();
});

$('btnExportAll').addEventListener('click', async () => {
  showError(null);
  try {
    if (!isFileSystemAccessSupported()) throw new Error('Folder access unsupported in this browser. Use Download.');
    const folder = await pickMemoryFolder();
    for (const m of allMeetings) await exportMeetingToFolder(folder, m);
    showSuccess(`Exported ${allMeetings.length} meetings to “${folder.name}”.`);
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Export failed.');
  }
});

$('btnDownload').addEventListener('click', () => {
  const m = allMeetings[0];
  if (!m) { showError('No meetings to download.'); return; }
  downloadMeeting(m);
});

void (async () => {
  await refreshMeetings();
  await refreshCalendar();
  projectList.innerHTML = '<div class="empty">Select a meeting to see its project plans.</div>';
  // Expose for tests
  (window as any).__meetdolff = { getMeetings: () => allMeetings };
})();
