/**
 * MeetDolff service worker.
 * Survives suspension: session state persisted in chrome.storage.session.
 * Responsibilities: tabCapture stream id, offscreen lifecycle, recording
 * session state, audio persistence to IndexedDB, meeting creation.
 */

import { deleteAudioChunks, getDb, listSnapshots, putAudio, putAudioChunk, putMeeting, putSnapshot, reassignSnapshots } from '../lib/db.js';
import { hostOf, MAX_SNAPSHOTS_PER_RECORDING, snapshotOffsetSec } from '../lib/snapshots.js';
import { newId } from '../lib/utils/id.js';
import { createProvider } from '../lib/ai/provider.js';
import { SUMMARY_SYSTEM, summaryPrompt } from '../lib/ai/prompts.js';
import { parseMeetingSummary, applyMeetingSummary } from '../lib/ai/meeting-intelligence.js';
import { createTranscriptionProvider } from '../lib/transcription/factory.js';
import { DEFAULT_PROVIDER_SETTINGS, MEMORY_FORMAT_VERSION, type Meeting, type ProviderSettings, type RecordingSession } from '../lib/types.js';

const SESSION_KEY = 'recordingSession';

const idleSession = (): RecordingSession => ({
  id: newId('sess'),
  state: 'idle',
  tabId: null,
  audioSource: 'tab',
  startedAt: null,
  elapsedSec: 0,
  error: null,
  chunkCount: 0,
});

async function getSession(): Promise<RecordingSession> {
  const res = (await chrome.storage.session.get(SESSION_KEY)) as any;
  return (res?.[SESSION_KEY] as RecordingSession) ?? idleSession();
}

async function setSession(s: RecordingSession): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: s });
  chrome.runtime.sendMessage({ type: 'SESSION_UPDATED', session: s }).catch(() => undefined);
  await updateBadge(s);
}

async function updateBadge(s: RecordingSession): Promise<void> {
  if (s.state === 'recording') {
    await chrome.action.setBadgeText({ text: 'REC' });
    await chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
  } else if (s.state === 'paused') {
    await chrome.action.setBadgeText({ text: '❚❚' });
    await chrome.action.setBadgeBackgroundColor({ color: '#737373' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Recording meeting audio (tab/mic) at user request for transcription and memory.',
  });
}

async function liveTranscriptionRequested(audioSource: 'tab' | 'mic' | 'tab+mic'): Promise<boolean> {
  if (audioSource === 'tab') return false;
  const stored = (await chrome.storage.local.get('providerSettings')) as any;
  return (stored?.providerSettings?.transcriptionProvider ?? 'web-speech') === 'web-speech';
}

async function startRecording(audioSource: 'tab' | 'mic' | 'tab+mic'): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (session.state === 'recording' || session.state === 'paused') {
    return { ok: false, error: 'Already recording.' };
  }
  try {
    await ensureOffscreen();
    const now = Date.now();
    const sessionId = newId('sess');
    const liveTranscription = await liveTranscriptionRequested(audioSource);
    if (audioSource === 'mic') {
      const res = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'START_MIC', sessionId, liveTranscription })) as any;
      if (!res?.ok) throw new Error(res?.error ?? 'Mic capture failed.');
      await setSession({
        ...idleSession(),
        id: sessionId,
        state: 'recording',
        tabId: null,
        audioSource,
        startedAt: now,
        elapsedSec: 0,
        error: null,
        chunkCount: 0,
      });
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found. Click the extension on the meeting tab first.');
      const streamId = await (chrome.tabCapture.getMediaStreamId as any)({ targetTabId: tab.id });
      const res = (await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'START_TAB',
        streamId,
        sessionId,
        liveTranscription,
        includeMic: audioSource === 'tab+mic',
      })) as any;
      if (!res?.ok) throw new Error(res?.error ?? 'Tab capture failed.');
      await setSession({
        ...idleSession(),
        id: sessionId,
        state: 'recording',
        tabId: tab.id,
        audioSource,
        startedAt: now,
        elapsedSec: 0,
        error: null,
        chunkCount: 0,
      });
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to start recording.';
    await setSession({ ...(await getSession()), state: 'error', error: msg });
    return { ok: false, error: msg };
  }
}

/**
 * User-triggered screenshot of the visible tab, linked to transcript time.
 * Uses activeTab (granted when the user clicks the MeetDolff toolbar icon on
 * the meeting tab) — no broad host permission, no background polling.
 */
async function captureSnapshot(): Promise<{ ok: boolean; error?: string; offsetSec?: number; count?: number }> {
  const session = await getSession();
  if ((session.state !== 'recording' && session.state !== 'paused') || !session.startedAt) {
    return { ok: false, error: 'Start a recording before capturing a moment.' };
  }
  const existing = await listSnapshots(session.id);
  if (existing.length >= MAX_SNAPSHOTS_PER_RECORDING) {
    return { ok: false, error: `Snapshot limit reached (${MAX_SNAPSHOTS_PER_RECORDING} per recording).` };
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error('No active tab to capture.');
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
    const blob = await (await fetch(dataUrl)).blob();
    const offsetSec = snapshotOffsetSec(session.startedAt, Date.now());
    await putSnapshot({
      id: newId('snap'),
      meetingId: session.id,
      offsetSec,
      capturedAt: new Date().toISOString(),
      mime: 'image/jpeg',
      blob,
      tabTitle: tab.title ?? null,
      tabHost: hostOf(tab.url),
    });
    return { ok: true, offsetSec, count: existing.length + 1 };
  } catch (e) {
    const raw = e instanceof Error ? e.message : 'Snapshot failed.';
    const permission = /activeTab|cannot access|permission/i.test(raw);
    return {
      ok: false,
      error: permission
        ? 'Chrome only allows a snapshot of the tab where you last opened MeetDolff. Click the MeetDolff toolbar icon on the meeting tab, then press Capture moment again.'
        : raw,
    };
  }
}

async function stopRecording(): Promise<{ ok: boolean; error?: string; meetingId?: string }> {
  const session = await getSession();
  if (session.state !== 'recording' && session.state !== 'paused') {
    return { ok: false, error: 'Not recording.' };
  }
  try {
    await setSession({ ...session, state: 'stopping' });
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP' });
    // RECORDING_STOPPED handler persists audio + creates meeting.
    // Wait briefly for it, then return.
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to stop.' };
  }
}

async function autoProcessMeeting(meeting: Meeting, audio: Blob): Promise<Meeting> {
  const stored = (await chrome.storage.local.get('providerSettings')) as any;
  const settings: ProviderSettings = { ...DEFAULT_PROVIDER_SETTINGS, ...(stored?.providerSettings ?? {}) };
  let updated = meeting;

  // Recorded blobs need a blob-capable adapter. Web Speech is deliberately
  // not called here because it only works as a live microphone recognizer.
  if (settings.transcriptionProvider === 'cloud' && audio.size > 0) {
    const transcription = await createTranscriptionProvider(settings).transcribe(audio);
    updated = {
      ...updated,
      transcript: transcription.segments,
      transcriptText: transcription.text,
      updatedAt: new Date().toISOString(),
    };
    await putMeeting(updated);
  }

  if (updated.transcriptText && settings.apiKey) {
    const ai = createProvider(settings, settings.aiProvider);
    const result = await ai.chat([
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: summaryPrompt(updated.transcriptText) },
    ]);
    updated = applyMeetingSummary(updated, parseMeetingSummary(result.text));
    await putMeeting(updated);
  }
  return updated;
}

async function handleRecordingStopped(recordingSessionId: string, mime: string, buffer: ArrayBuffer, liveResult?: { segments?: Meeting['transcript']; text?: string }): Promise<void> {
  const session = await getSession();
  const sessionId = recordingSessionId || session.id;
  const now = new Date();
  const started = session.startedAt ? new Date(session.startedAt) : now;
  const durationSec = Math.max(1, Math.round((now.getTime() - started.getTime()) / 1000));
  const meetingId = newId('meet');
  const blob = new Blob([buffer], { type: mime || 'audio/webm' });
  const meeting: Meeting = {
    id: meetingId,
    title: `Meeting ${started.toLocaleDateString()} ${started.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
    startedAt: started.toISOString(),
    endedAt: now.toISOString(),
    durationSec,
    participants: [],
    transcript: liveResult?.segments ?? [],
    transcriptText: liveResult?.text ?? '',
    summary: null,
    topics: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
    commitments: [],
    project: null,
    audioSource: session.audioSource,
    audioMime: mime,
    hasAudio: blob.size > 0,
    memoryVersion: MEMORY_FORMAT_VERSION,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await getDb(); // ensure DB exists
  await putMeeting(meeting);
  await reassignSnapshots(sessionId, meetingId);
  if (blob.size > 0) {
    await putAudio({ meetingId, blob, mime: mime || 'audio/webm', createdAt: now.toISOString() });
  }
  // The final blob is authoritative; recovery chunks are cleaned only after
  // the meeting and audio have both been committed.
  await deleteAudioChunks(sessionId);
  await setSession({ ...idleSession(), state: 'idle' });
  chrome.runtime.sendMessage({ type: 'MEETING_SAVED', meetingId }).catch(() => undefined);

  // Processing is best-effort after the durable save. If no cloud adapter/key
  // is configured, the meeting remains available for the manual side-panel
  // workflow; a provider failure never deletes the recording.
  try {
    const updated = await autoProcessMeeting(meeting, blob);
    if (updated.updatedAt !== meeting.updatedAt || updated.transcript.length > 0) {
      chrome.runtime.sendMessage({ type: 'MEETING_PROCESSED', meetingId }).catch(() => undefined);
    }
  } catch (e) {
    chrome.runtime.sendMessage({
      type: 'PROCESSING_ERROR',
      meetingId,
      error: e instanceof Error ? e.message : 'Post-recording processing failed.',
    }).catch(() => undefined);
  }
}

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'GET_SESSION') {
        const session = await getSession();
        // Recompute elapsed for live display
        if (session.startedAt && (session.state === 'recording' || session.state === 'paused')) {
          session.elapsedSec = Math.floor((Date.now() - session.startedAt) / 1000);
        }
        sendResponse({ ok: true, session });
      } else if (msg?.type === 'START_RECORDING') {
        sendResponse(await startRecording(msg.audioSource ?? 'tab'));
      } else if (msg?.type === 'PAUSE_RECORDING') {
        const s = await getSession();
        await chrome.runtime.sendMessage({ target: 'offscreen', type: 'PAUSE' }).catch(() => undefined);
        await setSession({ ...s, state: 'paused' });
        sendResponse({ ok: true });
      } else if (msg?.type === 'RESUME_RECORDING') {
        const s = await getSession();
        await chrome.runtime.sendMessage({ target: 'offscreen', type: 'RESUME' }).catch(() => undefined);
        await setSession({ ...s, state: 'recording' });
        sendResponse({ ok: true });
      } else if (msg?.type === 'STOP_RECORDING') {
        sendResponse(await stopRecording());
      } else if (msg?.type === 'TRANSCRIPTION_PARTIAL') {
        // Forward live mic preview to open UI surfaces without storing
        // unfinalized text as memory.
        chrome.runtime.sendMessage({ type: 'TRANSCRIPTION_PARTIAL', text: String(msg.text ?? '') }).catch(() => undefined);
        sendResponse({ ok: true });
      } else if (msg?.type === 'RECORDING_CHUNK') {
        const recordingSessionId = String(msg.sessionId ?? '');
        const index = Number(msg.index ?? 0);
        const buffer = msg.buffer as ArrayBuffer;
        if (recordingSessionId && buffer?.byteLength) {
          await putAudioChunk({
            key: `${recordingSessionId}:${index}`,
            sessionId: recordingSessionId,
            index,
            blob: new Blob([buffer], { type: String(msg.mime ?? 'audio/webm') }),
            mime: String(msg.mime ?? 'audio/webm'),
            createdAt: new Date().toISOString(),
          });
          const s = await getSession();
          await setSession({ ...s, chunkCount: Math.max(s.chunkCount, index + 1) });
        }
        sendResponse({ ok: true });
      } else if (msg?.type === 'RECORDING_STOPPED') {
        await handleRecordingStopped(
          String(msg.sessionId ?? ''),
          String(msg.mime ?? 'audio/webm'),
          msg.buffer as ArrayBuffer,
          msg.liveResult as { segments?: Meeting['transcript']; text?: string } | undefined,
        );
        sendResponse({ ok: true });
      } else if (msg?.type === 'CHUNK_SAVED') {
        // Backward-compatible message from older offscreen pages.
        const s = await getSession();
        await setSession({ ...s, chunkCount: Number(msg.count ?? 0) });
        sendResponse({ ok: true });
      } else if (msg?.type === 'RECORD_ERROR') {
        const s = await getSession();
        await setSession({ ...s, state: 'error', error: String(msg.error ?? 'Recording error') });
        sendResponse({ ok: true });
      } else if (msg?.type === 'LIVE_SEGMENT') {
        // Broadcast straight from the offscreen document to open UI surfaces
        // (side panel). Acknowledge so the sender's channel doesn't stay open.
        sendResponse({ ok: true });
      } else if (msg?.type === 'CAPTURE_SNAPSHOT') {
        sendResponse(await captureSnapshot());
      } else if (msg?.type === 'OPEN_SIDE_PANEL') {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) await chrome.sidePanel.open({ windowId: tab.windowId });
        } catch {
          /* sidePanel.open requires user gesture in some Chrome versions; fallback: open dashboard */
          await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
        }
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
    }
  })();
  return true;
});

// Recovery: if service worker restarts mid-recording, keep session (storage.session persists).
// Offscreen document may have died — mark as error so user can retry without data loss confusion.
chrome.runtime.onStartup.addListener(async () => {
  const s = await getSession();
  if (s.state === 'recording' || s.state === 'paused' || s.state === 'stopping') {
    await setSession({ ...s, state: 'error', error: 'Extension restarted during recording. Audio chunks up to the restart were kept; please start a new recording.' });
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
