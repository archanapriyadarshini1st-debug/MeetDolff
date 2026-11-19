/**
 * Popup: quick recording controls + status.
 * All heavy work lives in service worker + offscreen document.
 */

import '../styles/design-system.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusBadge = $('statusBadge');
const statusText = $('statusText');
const timerEl = $('timer');
const btnStartTab = $('btnStartTab') as HTMLButtonElement;
const btnStartMic = $('btnStartMic') as HTMLButtonElement;
const btnPause = $('btnPause') as HTMLButtonElement;
const btnStop = $('btnStop') as HTMLButtonElement;
const audioSource = $('audioSource') as HTMLSelectElement;
const errorBox = $('errorBox');

let timerId: number | null = null;
let startedAt: number | null = null;
let savedNoticeUntil = 0;

function setStatus(state: string, elapsedSec: number): void {
  statusText.textContent = state;
  statusBadge.className = 'badge' + (state === 'Recording' ? ' rec' : state === 'Saved' ? ' ok' : '');
  const m = Math.floor(elapsedSec / 60);
  const s = Math.floor(elapsedSec % 60);
  timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const active = state === 'Recording' || state === 'Paused';
  btnStartTab.disabled = active;
  btnStartMic.disabled = active;
  btnPause.disabled = !active;
  btnStop.disabled = !active;
  btnPause.textContent = state === 'Paused' ? 'Resume' : 'Pause';
}

function showError(msg: string | null): void {
  errorBox.replaceChildren();
  if (!msg) return;
  const box = document.createElement('div');
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

async function refresh(): Promise<void> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'GET_SESSION' })) as any;
    if (Date.now() < savedNoticeUntil) {
      setStatus('Saved', 0);
      return;
    }
    if (res?.session) {
      const s = res.session;
      startedAt = s.startedAt ?? null;
      setStatus(
        s.state === 'recording' ? 'Recording' : s.state === 'paused' ? 'Paused' : s.state === 'error' ? 'Error' : 'Idle',
        s.elapsedSec ?? 0,
      );
      if (s.error) showError(s.error);
      if (s.state === 'recording' || s.state === 'paused') startTicker();
    }
  } catch {
    /* service worker may be waking */
  }
}

btnStartTab.addEventListener('click', async () => {
  showError(null);
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      audioSource: audioSource.value,
    })) as any;
    if (!res?.ok) throw new Error(res?.error ?? 'Failed to start');
    startedAt = Date.now();
    setStatus('Recording', 0);
    startTicker();
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Failed to start recording.');
  }
});

btnStartMic.addEventListener('click', async () => {
  showError(null);
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      audioSource: 'mic',
    })) as any;
    if (!res?.ok) throw new Error(res?.error ?? 'Failed to start');
    startedAt = Date.now();
    setStatus('Recording', 0);
    startTicker();
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Failed to start recording.');
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
    const res = (await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })) as any;
    if (timerId) window.clearInterval(timerId);
    if (!res?.ok) throw new Error(res?.error ?? 'Failed to stop');
    setStatus('Saved', 0);
    showError(null);
    // Open side panel to review
    await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }).catch(() => undefined);
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Failed to stop recording.');
  }
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

chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg?.type === 'SESSION_UPDATED') void refresh();
  if (msg?.type === 'MEETING_SAVED') {
    if (timerId) window.clearInterval(timerId);
    startedAt = null;
    savedNoticeUntil = Date.now() + 3500;
    setStatus('Saved', 0);
    window.setTimeout(() => void refresh(), 3500);
  }
});

void refresh();
