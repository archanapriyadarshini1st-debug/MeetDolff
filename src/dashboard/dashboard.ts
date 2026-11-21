/**
 * Dashboard: latest recap, search + master/detail, calendar, projects, export.
 *
 * Design rules enforced here (see PRODUCT-REVIEW.md):
 *  - No raw machine values in the UI — durations, plurals and dates go through lib/utils/format.
 *  - Selecting a meeting must be visibly obvious (aria-current on the row, detail pane updates).
 *  - Every empty state says what to do next, not just that there is nothing.
 */

import '../styles/design-system.css';
import {
  getAudio,
  putMeeting,
  listMeetings,
  listCalendarEvents,
  putCalendarEvent,
  deleteCalendarEvent,
  listProjectsForMeeting,
} from '../lib/db.js';
import { searchMeetings } from '../lib/search.js';
import { createEvent } from '../lib/calendar/calendar.js';
import {
  downloadMeeting,
  exportMeetingToFolder,
  getStoredFolder,
  pickMemoryFolder,
  isFileSystemAccessSupported,
} from '../lib/memory-files.js';
import {
  countIfAny,
  formatDay,
  formatDuration,
  formatTimeRange,
  formatTotalDuration,
  formatWhen,
  joinMeta,
  pluralize,
} from '../lib/utils/format.js';
import type { CalendarEvent, Meeting } from '../lib/types.js';
import { mountTranscript } from './transcript-editor.js';
import { loadProviderSettings } from '../lib/settings-store.js';
import { createProvider } from '../lib/ai/provider.js';
import { SUMMARY_SYSTEM, summaryPrompt } from '../lib/ai/prompts.js';
import { applyMeetingSummary, parseMeetingSummary } from '../lib/ai/meeting-intelligence.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const searchInput = $('searchInput') as HTMLInputElement;
const searchClear = $('searchClear') as HTMLButtonElement;
const meetingList = $('meetingList');
const detailBox = $('detailBox');
const errorBox = $('errorBox');
const calendarList = $('calendarList');
const projectList = $('projectList');
const hero = $('hero');
const onboarding = $('onboarding');
const meetingCount = $('meetingCount');
const memoryStat = $('memoryStat');
const folderNote = $('folderNote');

let allMeetings: Meeting[] = [];
let selectedId: string | null = null;

/* ------------------------------------------------------------------ notices */

function showError(msg: string | null): void {
  errorBox.replaceChildren();
  if (!msg) return;
  const box = document.createElement('p');
  box.className = 'error';
  box.setAttribute('role', 'alert');
  box.style.marginBottom = 'var(--s4)';
  box.textContent = msg;
  errorBox.appendChild(box);
}

function showSuccess(msg: string): void {
  errorBox.replaceChildren();
  const box = document.createElement('p');
  box.className = 'ok-box';
  box.style.marginBottom = 'var(--s4)';
  box.textContent = msg;
  errorBox.appendChild(box);
}

/* ------------------------------------------------------------------ helpers */

function meetingMeta(m: Meeting): string[] {
  return [
    formatWhen(m.startedAt),
    formatDuration(m.durationSec),
    countIfAny(m.decisions.length, 'decision'),
    countIfAny(m.actionItems.length, 'action item'),
  ].filter(Boolean);
}

function metaEl(parts: string[]): HTMLElement {
  const p = document.createElement('p');
  p.className = 'row-meta';
  for (const part of parts) {
    const span = document.createElement('span');
    span.textContent = part;
    p.appendChild(span);
  }
  return p;
}

/* ------------------------------------------------------------------ onboarding */

interface OnboardingState {
  hasKey: boolean;
  hasMeeting: boolean;
  hasTranscript: boolean;
}

function renderOnboarding(state: OnboardingState, visible: boolean): void {
  onboarding.hidden = !visible;
  if (!visible) return;
  const done: Record<string, boolean> = {
    key: state.hasKey,
    record: state.hasMeeting,
    transcript: state.hasTranscript,
  };
  for (const li of Array.from($('checklist').querySelectorAll('li'))) {
    const step = li.getAttribute('data-step') ?? '';
    li.dataset['done'] = String(done[step] === true);
    const mark = li.querySelector('.checklist__mark');
    if (mark) mark.textContent = done[step] ? '✓' : String(Number(li.getAttribute('data-step') === 'key' ? 1 : li.getAttribute('data-step') === 'record' ? 2 : 3));
  }
}

/* ------------------------------------------------------------------ hero */

function renderHero(): void {
  const latest = allMeetings[0];
  if (!latest) {
    hero.hidden = true;
    hero.replaceChildren();
    return;
  }
  hero.hidden = false;
  hero.replaceChildren();

  const main = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'hero__eyebrow';
  eyebrow.textContent = `Latest · ${formatWhen(latest.startedAt)}`;

  const title = document.createElement('h2');
  title.className = 'hero__title';
  title.id = 'heroTitle';
  title.textContent = latest.title;

  const summary = document.createElement('p');
  summary.className = 'hero__summary';
  summary.textContent =
    latest.summary?.trim() ||
    (latest.transcriptText.trim()
      ? 'No summary yet — open the side panel and choose “Summarize” to turn this transcript into decisions and action items.'
      : 'No transcript yet — open the side panel and transcribe this recording, then summarize it.');

  // One compact fact line beats a grid of half-filled number cells.
  const meta = document.createElement('p');
  meta.className = 'hero__meta';
  for (const part of [
    formatDuration(latest.durationSec),
    pluralize(latest.transcript.length, 'segment'),
    countIfAny(latest.decisions.length, 'decision'),
    countIfAny(latest.openQuestions.length, 'open question'),
  ].filter(Boolean)) {
    const span = document.createElement('span');
    span.textContent = part;
    meta.appendChild(span);
  }

  const actions = document.createElement('div');
  actions.className = 'toolbar';
  actions.style.margin = 'var(--s4) 0 0';
  const open = document.createElement('button');
  open.className = 'btn btn-sm btn-primary';
  open.textContent = 'Open full notes';
  open.addEventListener('click', () => void selectMeeting(latest.id, true));
  actions.appendChild(open);

  main.append(eyebrow, title, meta, summary, actions);

  // Aside: what the user owes people, at a glance.
  const aside = document.createElement('div');
  aside.className = 'hero__aside';
  const actionsHeading = document.createElement('h3');
  actionsHeading.textContent = latest.actionItems.length
    ? `Action items · ${latest.actionItems.length}`
    : 'Action items';
  aside.appendChild(actionsHeading);
  if (latest.actionItems.length === 0) {
    const p = document.createElement('p');
    p.className = 'small muted';
    p.style.margin = '0';
    p.textContent = 'None captured. Summarizing the meeting fills this in.';
    aside.appendChild(p);
  } else {
    const ul = document.createElement('ul');
    ul.style.cssText = 'margin:0; padding-left:18px;';
    for (const a of latest.actionItems.slice(0, 4)) {
      const li = document.createElement('li');
      li.className = 'small';
      li.style.marginBottom = '6px';
      li.textContent = a.text;
      if (a.owner) {
        const owner = document.createElement('span');
        owner.className = 'faint';
        owner.textContent = ` — ${a.owner}`;
        li.appendChild(owner);
      }
      ul.appendChild(li);
    }
    aside.appendChild(ul);
    if (latest.actionItems.length > 4) {
      const more = document.createElement('p');
      more.className = 'small faint';
      more.style.margin = '6px 0 0';
      more.textContent = `+${latest.actionItems.length - 4} more`;
      aside.appendChild(more);
    }
  }

  hero.append(main, aside);
}

/* ------------------------------------------------------------------ list */

function renderMeetings(query: string): void {
  const q = query.trim();
  const results = q
    ? searchMeetings(allMeetings, q)
    : allMeetings.map((m) => ({ meeting: m, snippet: '', score: 0 }));

  searchClear.hidden = q === '';
  meetingCount.textContent = q
    ? `${results.length} of ${allMeetings.length}`
    : allMeetings.length
      ? String(allMeetings.length)
      : '';

  if (allMeetings.length === 0) {
    meetingList.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.margin = '0 var(--s4) var(--s4)';
    empty.innerHTML =
      '<p class="empty__title" style="font-size:14px">Nothing recorded yet</p>' +
      '<p class="empty__body">Meetings appear here the moment you stop a recording.</p>';
    meetingList.appendChild(empty);
    return;
  }

  if (results.length === 0) {
    meetingList.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.margin = '0 var(--s4) var(--s4)';
    const title = document.createElement('p');
    title.className = 'empty__title';
    title.style.fontSize = '14px';
    title.textContent = `No meeting matches “${q}”`;
    const body = document.createElement('p');
    body.className = 'empty__body';
    body.textContent = 'Search covers transcripts, summaries, decisions and action items.';
    const clear = document.createElement('button');
    clear.className = 'btn btn-sm';
    clear.textContent = 'Clear search';
    clear.addEventListener('click', () => {
      searchInput.value = '';
      renderMeetings('');
    });
    empty.append(title, body, clear);
    meetingList.appendChild(empty);
    return;
  }

  meetingList.replaceChildren();
  for (const r of results) {
    const m = r.meeting;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row row--button';
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-current', String(m.id === selectedId));

    const main = document.createElement('div');
    main.className = 'row-main';
    const title = document.createElement('p');
    title.className = 'row-title';
    title.textContent = m.title;
    main.append(title, metaEl(meetingMeta(m)));

    if (r.snippet) {
      const snip = document.createElement('p');
      snip.className = 'small faint';
      snip.style.cssText = 'margin:4px 0 0; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;';
      snip.innerHTML = r.snippet;
      main.appendChild(snip);
    }

    const chevron = document.createElement('span');
    chevron.className = 'faint';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';

    row.append(main, chevron);
    row.addEventListener('click', () => void selectMeeting(m.id, false));
    meetingList.appendChild(row);
  }
}

async function selectMeeting(id: string, scroll: boolean): Promise<void> {
  selectedId = id;
  $('detailPanel').dataset['idle'] = 'false';
  await showDetail(id);
  // Re-render the list so aria-current reflects the selection.
  renderMeetings(searchInput.value);
  if (scroll) {
    detailBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (window.innerWidth <= 940) {
    // Narrow layout stacks the panes — bring the detail into view so the click is not a no-op.
    detailBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* ------------------------------------------------------------------ detail */

async function showDetail(id: string): Promise<void> {
  const m = allMeetings.find((x) => x.id === id);
  if (!m) return;
  detailBox.replaceChildren();

  const wrap = document.createElement('div');
  wrap.className = 'detail';

  const head = document.createElement('div');
  head.className = 'detail__head';
  const headMain = document.createElement('div');
  headMain.style.minWidth = '0';
  const h3 = document.createElement('h3');
  h3.className = 'detail__title';
  h3.textContent = m.title;
  const meta = document.createElement('p');
  meta.className = 'detail__meta';
  for (const part of [
    formatWhen(m.startedAt),
    formatDuration(m.durationSec),
    `${m.audioSource === 'tab' ? 'Tab audio' : m.audioSource === 'mic' ? 'Microphone' : 'Tab + mic'}`,
    pluralize(m.transcript.length, 'segment'),
  ]) {
    const span = document.createElement('span');
    span.textContent = part;
    meta.appendChild(span);
  }
  headMain.append(h3, meta);

  const close = document.createElement('button');
  close.className = 'btn btn-sm btn-ghost';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close meeting detail');
  close.addEventListener('click', () => {
    selectedId = null;
    $('detailPanel').dataset['idle'] = 'true';
    detailBox.innerHTML =
      '<div class="empty empty--lg"><p class="empty__title">No meeting selected</p>' +
      '<p class="empty__body">Pick a meeting on the left to read its summary, decisions, action items and transcript.</p></div>';
    renderMeetings(searchInput.value);
  });
  head.append(headMain, close);

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.style.marginTop = '0';
  const mk = (label: string, cls: string, act: string) => {
    const b = document.createElement('button');
    b.className = `btn btn-sm ${cls}`;
    b.textContent = label;
    b.dataset['act'] = act;
    return b;
  };
  const btnExport = mk('Export to folder', '', 'export');
  const btnDownload = mk('Download .md/.json', '', 'download');
  const btnDelete = mk('Delete', 'btn-danger', 'delete');
  toolbar.append(btnExport, btnDownload, btnDelete);

  const audioWrap = document.createElement('div');
  audioWrap.className = 'audio-wrap';

  const summaryHeading = document.createElement('h4');
  summaryHeading.textContent = 'Summary';
  const staleBox = document.createElement('div');
  staleBox.className = 'stale-box';
  const summary = document.createElement('p');
  summary.className = 'summary';
  if (m.summary) {
    summary.textContent = m.summary;
  } else {
    summary.className = 'summary muted';
    summary.textContent = m.transcriptText.trim()
      ? 'No summary yet. Open the side panel, keep this meeting selected, and choose Summarize.'
      : 'No transcript yet. Transcribe the saved audio in the side panel first.';
  }

  const decHeading = document.createElement('h4');
  decHeading.textContent = 'Decisions';
  const dec = document.createElement('ul');
  if (m.decisions.length === 0) dec.innerHTML = '<li class="muted">None captured.</li>';
  for (const d of m.decisions) {
    const li = document.createElement('li');
    li.textContent = d.text;
    dec.appendChild(li);
  }

  const actHeading = document.createElement('h4');
  actHeading.textContent = 'Action items';
  const act = document.createElement('ul');
  if (m.actionItems.length === 0) act.innerHTML = '<li class="muted">None captured.</li>';
  for (const a of m.actionItems) {
    const li = document.createElement('li');
    li.textContent = a.text;
    const bits = joinMeta([a.owner ? a.owner : null, a.deadline ? `due ${a.deadline}` : null]);
    if (bits) {
      const span = document.createElement('span');
      span.className = 'small faint';
      span.textContent = ` — ${bits}`;
      li.appendChild(span);
    }
    act.appendChild(li);
  }

  const questions = m.openQuestions ?? [];
  const qHeading = document.createElement('h4');
  qHeading.textContent = 'Open questions';
  const q = document.createElement('ul');
  if (questions.length === 0) q.innerHTML = '<li class="muted">None captured.</li>';
  for (const item of questions) {
    const li = document.createElement('li');
    li.textContent = item;
    q.appendChild(li);
  }

  const trHeading = document.createElement('h4');
  trHeading.textContent = 'Transcript';
  const transcript = document.createElement('div');
  transcript.className = 'transcript';

  wrap.append(head, toolbar, audioWrap, summaryHeading, staleBox, summary, decHeading, dec);
  if (questions.length) wrap.append(qHeading, q);
  wrap.append(actHeading, act, trHeading, transcript);

  const audioRec = await getAudio(m.id);
  let audioEl: HTMLAudioElement | null = null;
  if (audioRec?.blob.size) {
    audioEl = document.createElement('audio');
    audioEl.controls = true;
    audioEl.preload = 'metadata';
    audioEl.src = URL.createObjectURL(audioRec.blob);
    audioEl.setAttribute('aria-label', `Audio recording for ${m.title}`);
    const label = document.createElement('p');
    label.className = 'small faint';
    label.style.margin = '0 0 var(--s1)';
    label.textContent = 'Saved recording';
    audioWrap.append(label, audioEl);
  }

  mountTranscript(transcript, m, {
    seek: (sec) => {
      if (!audioEl) return showError('No saved audio for this meeting.');
      audioEl.currentTime = sec;
      void audioEl.play().catch(() => undefined);
    },
    onError: (msg) => showError(msg),
    onSave: async (updated) => {
      await putMeeting(updated);
      allMeetings = allMeetings.map((x) => (x.id === updated.id ? updated : x));
      renderStale(updated);
      showSuccess('Correction saved. Re-export to the memory folder to update your files.');
    },
  });

  const renderStale = (cur: Meeting): void => {
    staleBox.replaceChildren();
    if (!cur.summaryStale) return;
    staleBox.innerHTML =
      '<p class="warn-box" style="margin-bottom:var(--s2)">The transcript was edited after this summary was written, so the summary, decisions and actions may be out of date.</p>';
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-primary';
    btn.textContent = 'Re-summarize from edited transcript';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Summarizing…';
      try {
        const latest = allMeetings.find((x) => x.id === cur.id) ?? cur;
        const settings = await loadProviderSettings();
        const result = await createProvider(settings, settings.aiProvider).chat([
          { role: 'system', content: SUMMARY_SYSTEM },
          { role: 'user', content: summaryPrompt(latest.transcriptText) },
        ]);
        await putMeeting({ ...applyMeetingSummary(latest, parseMeetingSummary(result.text)), summaryStale: false });
        await refreshMeetings();
        await showDetail(cur.id);
        showSuccess('Summary regenerated from the corrected transcript.');
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Re-summarize from edited transcript';
        showError(e instanceof Error ? e.message : 'Re-summarize failed.');
      }
    });
    staleBox.appendChild(btn);
  };
  renderStale(m);

  btnDownload.addEventListener('click', () => downloadMeeting(m));
  btnExport.addEventListener('click', async () => {
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
  btnDelete.addEventListener('click', async () => {
    if (!confirm(`Delete “${m.title}” and its audio? This cannot be undone.`)) return;
    const { deleteMeeting } = await import('../lib/db.js');
    await deleteMeeting(m.id);
    selectedId = null;
    $('detailPanel').dataset['idle'] = 'true';
    await refreshMeetings();
    renderHero();
    detailBox.innerHTML =
      '<div class="empty empty--lg"><p class="empty__title">Meeting deleted</p>' +
      '<p class="empty__body">Its audio and transcript were removed from this device.</p></div>';
  });

  detailBox.appendChild(wrap);
  await refreshProjectsFor(m.id);
}

/* ------------------------------------------------------------------ calendar */

const COLOR_LABEL: Record<CalendarEvent['color'], string> = {
  ink: 'Ink',
  paper: 'Paper',
  accent: 'Accent',
  muted: 'Muted',
};

async function refreshCalendar(): Promise<void> {
  const events = await listCalendarEvents();
  if (events.length === 0) {
    calendarList.innerHTML =
      '<div class="empty"><p class="empty__title" style="font-size:14px">No events yet</p>' +
      '<p class="empty__body">Add a follow-up above and it stays on this device with your meetings.</p></div>';
    return;
  }
  calendarList.replaceChildren();
  for (const ev of events) {
    const row = document.createElement('div');
    row.className = 'row';

    const swatch = document.createElement('span');
    swatch.className = `swatch swatch--${ev.color}`;
    swatch.setAttribute('aria-hidden', 'true');

    const main = document.createElement('div');
    main.className = 'row-main';
    const title = document.createElement('p');
    title.className = 'row-title';
    title.textContent = ev.title;
    const meta = document.createElement('p');
    meta.className = 'row-meta';
    for (const part of [
      formatDay(ev.startsAt),
      formatTimeRange(ev.startsAt, ev.endsAt),
      COLOR_LABEL[ev.color] ?? '',
      ev.meetingId ? 'Linked meeting' : '',
    ].filter(Boolean)) {
      const span = document.createElement('span');
      span.textContent = part;
      meta.appendChild(span);
    }
    main.append(title, meta);

    const del = document.createElement('button');
    del.className = 'btn-icon';
    del.innerHTML = '×';
    del.setAttribute('aria-label', `Delete event ${ev.title}`);
    del.title = `Delete ${ev.title}`;
    del.addEventListener('click', async () => {
      await deleteCalendarEvent(ev.id);
      await refreshCalendar();
    });

    row.append(swatch, main, del);
    calendarList.appendChild(row);
  }
}

/* ------------------------------------------------------------------ projects */

async function refreshProjectsFor(meetingId: string): Promise<void> {
  const plans = await listProjectsForMeeting(meetingId);
  if (plans.length === 0) {
    projectList.innerHTML =
      '<div class="empty"><p class="empty__title" style="font-size:14px">No plan for this meeting</p>' +
      '<p class="empty__body">In the side panel, choose <strong>Convert to project</strong> to draft objectives, tasks and risks. Nothing is approved until you approve it.</p></div>';
    return;
  }
  projectList.replaceChildren();
  for (const p of plans) {
    const div = document.createElement('div');
    div.className = 'row';
    const main = document.createElement('div');
    main.className = 'row-main';
    const title = document.createElement('p');
    title.className = 'row-title';
    title.textContent = p.title;
    if (!p.approved) {
      const tag = document.createElement('span');
      tag.className = 'tag warn';
      tag.textContent = 'Pending approval';
      title.append(' ', tag);
    }
    const meta = document.createElement('p');
    meta.className = 'row-meta';
    for (const part of [
      pluralize(p.tasks.length, 'task'),
      pluralize(p.milestones.length, 'milestone'),
      countIfAny(p.risks.length, 'risk'),
    ].filter(Boolean)) {
      const span = document.createElement('span');
      span.textContent = part;
      meta.appendChild(span);
    }
    main.append(title, meta);

    const approve = document.createElement('button');
    approve.className = p.approved ? 'btn btn-sm btn-ghost' : 'btn btn-sm btn-primary';
    approve.textContent = p.approved ? 'Approved' : 'Approve';
    approve.disabled = p.approved;
    approve.addEventListener('click', async () => {
      const { putProject } = await import('../lib/db.js');
      await putProject({ ...p, approved: true });
      await refreshProjectsFor(meetingId);
    });
    div.append(main, approve);
    projectList.appendChild(div);
  }
}

/* ------------------------------------------------------------------ refresh */

async function refreshMeetings(): Promise<void> {
  allMeetings = await listMeetings(200);
  renderMeetings(searchInput.value);
  updateStats();
}

function updateStats(): void {
  const totalSec = allMeetings.reduce((sum, m) => sum + (m.durationSec || 0), 0);
  const decisions = allMeetings.reduce((sum, m) => sum + m.decisions.length, 0);
  memoryStat.textContent = allMeetings.length
    ? joinMeta([
        pluralize(allMeetings.length, 'meeting'),
        formatTotalDuration(totalSec),
        countIfAny(decisions, 'decision'),
      ])
    : 'Empty memory';
}

async function refreshAll(): Promise<void> {
  await refreshMeetings();
  renderHero();

  const settings = await loadProviderSettings();
  const hasTranscript = allMeetings.some((m) => m.transcriptText.trim().length > 0);
  renderOnboarding(
    { hasKey: Boolean(settings.apiKey), hasMeeting: allMeetings.length > 0, hasTranscript },
    allMeetings.length === 0,
  );

  await refreshCalendar();

  if (selectedId && allMeetings.some((m) => m.id === selectedId)) {
    await showDetail(selectedId);
  } else {
    projectList.innerHTML =
      '<div class="empty"><p class="empty__title" style="font-size:14px">No meeting selected</p>' +
      '<p class="empty__body">Select a meeting to see the plan drafted from it.</p></div>';
  }

  if (!isFileSystemAccessSupported()) {
    folderNote.textContent = 'Folder access unsupported in this browser — use Download.';
  } else {
    const folder = await getStoredFolder();
    folderNote.textContent = folder ? `Memory folder: ${folder.name}` : 'No memory folder connected yet.';
  }
}

/* ------------------------------------------------------------------ wiring */

searchInput.addEventListener('input', () => renderMeetings(searchInput.value));
searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.focus();
  renderMeetings('');
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && searchInput.value) {
    searchInput.value = '';
    renderMeetings('');
  }
});

$('calForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = ($('calTitle') as HTMLInputElement).value.trim();
  const date = ($('calDate') as HTMLInputElement).value;
  const color = ($('calColor') as HTMLSelectElement).value as CalendarEvent['color'];
  if (!title || !date) {
    showError('An event needs a title and a date.');
    return;
  }
  showError(null);
  const startsAt = new Date(`${date}T09:00:00`).toISOString();
  const endsAt = new Date(`${date}T10:00:00`).toISOString();
  await putCalendarEvent(createEvent({ title, startsAt, endsAt, color }));
  ($('calTitle') as HTMLInputElement).value = '';
  await refreshCalendar();
});

$('btnExportAll').addEventListener('click', async () => {
  showError(null);
  if (allMeetings.length === 0) {
    showError('Nothing to export yet — record a meeting first.');
    return;
  }
  try {
    if (!isFileSystemAccessSupported()) throw new Error('Folder access unsupported in this browser. Use Download.');
    let folder = await getStoredFolder();
    if (!folder) folder = await pickMemoryFolder();
    for (const m of allMeetings) await exportMeetingToFolder(folder, m);
    showSuccess(`Exported ${pluralize(allMeetings.length, 'meeting')} to “${folder.name}”.`);
    folderNote.textContent = `Memory folder: ${folder.name}`;
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Export failed.');
  }
});

$('btnDownload').addEventListener('click', () => {
  const m = allMeetings[0];
  if (!m) {
    showError('No meetings to download.');
    return;
  }
  downloadMeeting(m);
});

void refreshAll();

// Expose for tests
(window as any).__meetdolff = { getMeetings: () => allMeetings };
