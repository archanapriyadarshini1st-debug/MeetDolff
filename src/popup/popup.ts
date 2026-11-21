/**
 * Popup: one decision (source), one action (start), plus honest status.
 * All heavy work lives in the service worker + offscreen document.
 *
 * v0.2 changes:
 *  - "Record tab" + "Record mic" + an Audio-source select collapsed into a
 *    single segmented control and one start button (they contradicted each other).
 *  - Shows which tab will be captured, so consent is explicit.
 *  - After a save, shows the recap of that meeting instead of a bare "Saved".
 */

import '../styles/design-system.css';
import { formatDuration, formatWhen } from '../lib/utils/format.js';
import type { Meeting, RecordingSession } from '../lib/types.js';
import { listMeetings } from '../lib/db.js';

type Source = 'tab' | 'mic' | 'tab+mic';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusBadge = $('statusBadge');
const statusText = $('statusText');
const timerEl = $('timer');
const btnStart = $('btnStart') as HTMLButtonElement;
const btnPause = $('btnPause') as HTMLButtonElement;
const btnStop = $('btnStop') as HTMLButtonElement;
const errorBox = $('errorBox');
const sourceGroup = $('sourceGroup');
const sourceHint = $('sourceHint');
const tabLabel = $('tabLabel');
const recap = $('recap');
const recapTitle = $('recapTitle');
const recapMeta = $('recapMeta');

const SOURCE_KEY = 'preferredAudioSource';

const HINTS: Record<Source, string> = {
  tab: "Records the meeting tab's audio only — the other participants.",
  mic: 'Records your microphone only — your side of the call.',
  'tab+mic': 'Records both sides. Best for full transcripts; watch for echo on speakers.',
};

let timerId: number | null = null;
let startedAt: number | null = null;
let savedNoticeUntil = 0;
let source: Source = 'tab';

function setSource(next: Source, persist = true): void {
  source = next;
  for (const btn of Array.from(sourceGroup.querySelectorAll<HTMLButtonElement>('button'))) {
    btn.setAttribute('aria-pressed', String(btn.dataset['source'] === next));
  }
  sourceHint.textContent = HINTS[next];
  if (persist) void chrome.storage.local.set({ [SOURCE_KEY]: next });
}

sourceGroup.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-source]');
  if (!btn) return;
  setSource(btn.dataset['source'] as Source);
});

function setStatus(state: string, elapsedSec: number): void {
  statusText.textContent = state;
  statusBadge.className =
    'badge' + (state === 'Recording' ? ' rec' : state === 'Saved' ? ' ok' : state === 'Error' ? ' warn' : '');
  const m = Math.floor(elapsedSec / 60);
  const s = Math.floor(elapsedSec % 60);
  timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const active = state === 'Recording' || state === 'Paused';
  btnStart.disabled = active;
  btnPause.disabled = !active;
  btnStop.disabled = !active;
  btnPause.textContent = state === 'Paused' ? 'Resume' : 'Pause';
  for (const btn of Array.from(sourceGroup.querySelectorAll<HTMLButtonElement>('button'))) {
    btn.disabled = active;
  }
}

function showError(msg: string | null): void {
  errorBox.replaceChildren();
  if (!msg) return;
  const box = document.createElement('p');
  box.className = 'error';
  box.setAttribute('role', 'alert');
  box.textContent = msg;
  errorBox.appendChild(box);
}

function startTicker(): void {
  if (timerId) window.clearInterval(timerId);
  timerId = window.setInterval(() => {
    if (startedAt) setStatus(statusText.textContent ?? 'Recording', (Date.now() - startedAt) / 1000);
  }, 500);
}

/** Show which tab this popup would capture. Uses activeTab (granted by opening the popup). */
async function describeActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      tabLabel.textContent = 'Unknown — no active tab';
      return;
    }
    const title = tab.title?.trim();
    const url = tab.url ?? '';
    const isMeeting = /(^|\.)meet\.google\.com|zoom\.us\/(j|wc|s)\/|teams\.(microsoft|live)\.com/.test(url);
    tabLabel.textContent = title ? `${isMeeting ? 'Meeting · ' : ''}${title}` : 'Active tab';
    tabLabel.title = title ?? '';
  } catch {
    tabLabel.textContent = 'Active tab';
  }
}

async function showRecap(meeting: Meeting | undefined): Promise<void> {
  if (!meeting) return;
  recap.hidden = false;
  recapTitle.textContent = meeting.title;
  recapMeta.textContent = `${formatWhen(meeting.startedAt)} · ${formatDuration(meeting.durationSec)}${
    meeting.hasAudio ? ' · audio saved' : ''
  }`;
  ($('btnOpenNotes') as HTMLButtonElement).dataset['meetingId'] = meeting.id;
}

async function refresh(): Promise<void> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'GET_SESSION' })) as { session?: RecordingSession } | undefined;
    if (Date.now() < savedNoticeUntil) {
      setStatus('Saved', 0);
      return;
    }
    const s = res?.session;
    if (!s) return;
    startedAt = s.startedAt ?? null;
    setStatus(
      s.state === 'recording' ? 'Recording' : s.state === 'paused' ? 'Paused' : s.state === 'error' ? 'Error' : 'Idle',
      s.elapsedSec ?? 0,
    );
    if (s.audioSource) setSource(s.audioSource, false);
    if (s.error) showError(s.error);
    if (s.state === 'recording' || s.state === 'paused') {
      recap.hidden = true;
      startTicker();
    }
  } catch {
    /* service worker may be waking */
  }
}

btnStart.addEventListener('click', async () => {
  showError(null);
  recap.hidden = true;
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      audioSource: source,
    })) as { ok?: boolean; error?: string } | undefined;
    if (!res?.ok) throw new Error(res?.error ?? 'Recording could not start.');
    startedAt = Date.now();
    setStatus('Recording', 0);
    startTicker();
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Recording could not start.');
  }
});

btnPause.addEventListener('click', async () => {
  const isPaused = statusText.textContent === 'Paused';
  await chrome.runtime.sendMessage({ type: isPaused ? 'RESUME_RECORDING' : 'PAUSE_RECORDING' });
  await refresh();
});

btnStop.addEventListener('click', async () => {
  showError(null);
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })) as
      | { ok?: boolean; error?: string; meetingId?: string }
      | undefined;
    if (timerId) window.clearInterval(timerId);
    if (!res?.ok) throw new Error(res?.error ?? 'Recording could not be saved.');
    setStatus('Saved', 0);
    const latest = (await listMeetings(1))[0];
    await showRecap(latest);
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Recording could not be saved.');
  }
});

$('btnOpenNotes').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
$('btnOpenSide').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
  window.close();
});
$('btnOpenDash').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
$('btnOpenSettings').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
});

chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === 'SESSION_UPDATED') void refresh();
  if (msg?.type === 'MEETING_SAVED') {
    if (timerId) window.clearInterval(timerId);
    startedAt = null;
    savedNoticeUntil = Date.now() + 3500;
    setStatus('Saved', 0);
    window.setTimeout(() => void refresh(), 3500);
  }
});

void (async () => {
  const stored = await chrome.storage.local.get(SOURCE_KEY);
  const saved = stored[SOURCE_KEY] as Source | undefined;
  setSource(saved && saved in HINTS ? saved : 'tab', false);
  await describeActiveTab();
  await refresh();
})();
