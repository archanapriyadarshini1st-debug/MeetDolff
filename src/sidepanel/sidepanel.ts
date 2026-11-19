/**
 * Side panel: meeting chat (grounded), summaries, artifacts, recent list.
 */

import '../styles/design-system.css';
import { getAudio, listMeetings } from '../lib/db.js';
import { formatClock, GROUNDED_SYSTEM, groundedPrompt, notInMemoryMessage, retrieveEvidence, verifyCitations } from '../lib/retrieval/evidence.js';
import { searchWeb, type WebSearchResult } from '../lib/search/web.js';
import { createProvider } from '../lib/ai/provider.js';
import { SUMMARY_SYSTEM, summaryPrompt, projectPrompt } from '../lib/ai/prompts.js';
import { generateReport, generateFlashcards, generateQuiz, generateMindmap } from '../lib/artifacts/artifacts.js';
import { parseProjectPlan } from '../lib/projects/converter.js';
import { applyMeetingSummary, parseMeetingSummary } from '../lib/ai/meeting-intelligence.js';
import { putProject, putMeeting } from '../lib/db.js';
import { formatDateTime } from '../lib/utils/id.js';
import type { Meeting, ProviderSettings } from '../lib/types.js';
import { loadProviderSettings } from '../lib/settings-store.js';
import { createTranscriptionProvider } from '../lib/transcription/factory.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const chatLog = $('chatLog');
const chatInput = $('chatInput') as HTMLInputElement;
const errorBox = $('errorBox');
const artifactBox = $('artifactBox');
const recentList = $('recentList');

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
  artifactBox.replaceChildren();
  const box = document.createElement('div');
  box.className = 'ok-box';
  box.textContent = msg;
  artifactBox.appendChild(box);
}

async function loadSettings(): Promise<ProviderSettings> {
  return loadProviderSettings();
}

function addMsg(role: 'user' | 'assistant', content: string, sources?: string): void {
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.textContent = content;
  if (sources) {
    const s = document.createElement('div');
    s.className = 'src';
    s.textContent = sources;
    div.appendChild(s);
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function refreshRecent(): Promise<void> {
  const meetings = await listMeetings(8);
  if (meetings.length === 0) {
    recentList.innerHTML = '<div class="empty">No meetings yet. Record one from the popup.</div>';
    return;
  }
  recentList.innerHTML = '';
  for (const m of meetings) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<div class="row-main"><p class="row-title"></p><p class="row-meta"></p></div>`;
    row.querySelector('.row-title')!.textContent = m.title;
    row.querySelector('.row-meta')!.textContent = `${formatDateTime(m.startedAt)} · ${m.durationSec}s · ${m.transcript.length} segments`;
    recentList.appendChild(row);
  }
}

async function ask(): Promise<void> {
  const q = chatInput.value.trim();
  if (!q) return;
  showError(null);
  addMsg('user', q);
  chatInput.value = '';
  try {
    const settings = await loadSettings();
    const meetings = await listMeetings(500);
    if (meetings.length === 0) {
      addMsg('assistant', 'No meetings in memory yet. Record a meeting first, then ask.');
      return;
    }
    const scope = (document.querySelector('input[name="scope"]:checked') as HTMLInputElement)?.value ?? 'all';
    const pool = scope === 'latest' ? meetings.slice(0, 1) : meetings;
    // Deterministic retrieval first: date intent + topic ranking, numbered passages.
    const retrieval = retrieveEvidence(pool, q);
    let external: WebSearchResult[] = [];
    if (settings.searchProvider !== 'none') external = await searchWeb(settings, q);
    if (retrieval.passages.length === 0 && external.length === 0) {
      // Nothing retrieved: do not ask a model to guess.
      addMsg('assistant', notInMemoryMessage(retrieval));
      return;
    }
    const externalContext = external.map((r) => `${r.title} | ${r.url}\n${r.snippet}`).join('\n\n');
    const provider = createProvider(settings, settings.aiProvider);
    const res = await provider.chat([
      { role: 'system', content: GROUNDED_SYSTEM },
      { role: 'user', content: groundedPrompt(q, retrieval, externalContext) },
    ]);
    const verified = verifyCitations(res.text, retrieval.passages);
    const cited = verified.citations.map((c) => `${c.title}${c.timestampSec !== null ? ` @ ${formatClock(c.timestampSec)}` : ''}`);
    const parts = [
      cited.length ? `Memory sources: ${cited.join(' · ')}` : 'No meeting sources cited',
      retrieval.dateFilter ? `Date filter: ${retrieval.dateFilter.label}` : '',
      external.length ? `External (not from your meetings): ${external.map((r) => r.url).join(', ')}` : '',
      verified.invalid.length ? `Removed ${verified.invalid.length} citation(s) that did not match retrieved evidence` : '',
      !verified.grounded && external.length === 0 ? '⚠ This answer cites no meeting evidence — treat it as unverified.' : '',
    ].filter(Boolean);
    addMsg('assistant', verified.text, parts.join(' | '));
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Failed to answer.');
  }
}

async function latestMeeting(): Promise<Meeting | null> {
  const all = await listMeetings(1);
  return all[0] ?? null;
}

async function transcribeLatest(): Promise<void> {
  showError(null);
  const m = await latestMeeting();
  if (!m) { showError('No meeting to transcribe.'); return; }
  const audio = await getAudio(m.id);
  if (!audio?.blob.size) { showError('This meeting has no saved audio.'); return; }
  try {
    const settings = await loadSettings();
    if (settings.transcriptionProvider !== 'cloud') {
      throw new Error('Recorded audio transcription needs Cloud Whisper. Choose “Cloud Whisper” in Settings, save a key, then retry. Web Speech is live-only.');
    }
    const provider = createTranscriptionProvider(settings);
    const result = await provider.transcribe(audio.blob);
    const updated: Meeting = {
      ...m,
      transcript: result.segments,
      transcriptText: result.text,
      updatedAt: new Date().toISOString(),
    };
    await putMeeting(updated);
    showSuccess(`Transcribed “${updated.title}” with ${result.segments.length} timestamped segments. Speakers are not labeled by this provider.`);
    await refreshRecent();
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Transcription failed.');
  }
}

async function summarizeLatest(): Promise<void> {
  showError(null);
  const m = await latestMeeting();
  if (!m) { showError('No meeting to summarize.'); return; }
  if (!m.transcriptText.trim()) { showError('This meeting has no transcript. Transcribe the saved audio first.'); return; }
  try {
    const settings = await loadSettings();
    const provider = createProvider(settings, settings.aiProvider);
    const res = await provider.chat([
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: summaryPrompt(m.transcriptText) },
    ]);
    const updated = applyMeetingSummary(m, parseMeetingSummary(res.text));
    await putMeeting(updated);
    showSuccess(`Summary saved for “${updated.title}”.`);
    await refreshRecent();
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Summarization failed.');
  }
}

async function convertToProject(): Promise<void> {
  showError(null);
  const m = await latestMeeting();
  if (!m) { showError('No meeting to convert.'); return; }
  if (!m.transcriptText.trim()) { showError('This meeting has no transcript. Transcribe the saved audio first.'); return; }
  try {
    const settings = await loadSettings();
    const provider = createProvider(settings, settings.aiProvider);
    const res = await provider.chat([
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: projectPrompt(m.transcriptText, m.summary ?? '') },
    ]);
    const plan = parseProjectPlan(res.text, m.id);
    await putProject(plan);
    showSuccess(`Project plan “${plan.title}” created (pending approval). Tasks: ${plan.tasks.length}, Milestones: ${plan.milestones.length}. Review in Dashboard → Projects.`);
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Project conversion failed.');
  }
}

function showArtifact(title: string, body: string): void {
  artifactBox.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const h = document.createElement('h3');
  h.textContent = title;
  h.style.margin = '0 0 8px';
  const pre = document.createElement('pre');
  pre.textContent = body;
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.fontFamily = 'var(--font-mono)';
  pre.style.fontSize = '12.5px';
  const dl = document.createElement('button');
  dl.className = 'btn btn-sm';
  dl.textContent = 'Download .md';
  dl.addEventListener('click', () => {
    const blob = new Blob([body], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\w]+/g, '-').toLowerCase()}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  panel.append(h, pre, dl);
  artifactBox.appendChild(panel);
}

$('btnTranscribe').addEventListener('click', () => void transcribeLatest());
$('btnAsk').addEventListener('click', () => void ask());
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void ask();
});
$('btnSummarize').addEventListener('click', () => void summarizeLatest());
$('btnProject').addEventListener('click', () => void convertToProject());
$('btnReport').addEventListener('click', async () => {
  const m = await latestMeeting();
  if (!m) { showError('No meeting found.'); return; }
  showArtifact(`Report — ${m.title}`, generateReport(m));
});
$('btnFlash').addEventListener('click', async () => {
  const m = await latestMeeting();
  if (!m) { showError('No meeting found.'); return; }
  const cards = generateFlashcards(m);
  showArtifact(`Flashcards — ${m.title}`, cards.map((c, i) => `${i + 1}. Q: ${c.front}\n   A: ${c.back}`).join('\n\n') || 'No cards — summarize first.');
});
$('btnQuiz').addEventListener('click', async () => {
  const m = await latestMeeting();
  if (!m) { showError('No meeting found.'); return; }
  const quiz = generateQuiz(m);
  showArtifact(`Quiz — ${m.title}`, quiz.map((x, i) => `${i + 1}. ${x.q}\n   → ${x.a}`).join('\n\n') || 'No quiz items — summarize first.');
});
$('btnMindmap').addEventListener('click', async () => {
  const m = await latestMeeting();
  if (!m) { showError('No meeting found.'); return; }
  showArtifact(`Mind map — ${m.title}`, generateMindmap(m));
});

chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg?.type === 'MEETING_SAVED' || msg?.type === 'MEETING_PROCESSED') void refreshRecent();
  if (msg?.type === 'PROCESSING_ERROR') showError(String(msg.error ?? 'Post-recording processing failed.'));
});

void refreshRecent();
