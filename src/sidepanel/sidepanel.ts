/**
 * Side panel: grounded chat (primary), plus processing the meeting the user
 * explicitly selected.
 *
 * Fix over v0.1: every destructive/expensive action used to run silently
 * against "whatever happens to be newest". There is now a visible target
 * selector, and the panel refuses to act when nothing is targeted.
 */

import '../styles/design-system.css';
import { getAudio, listMeetings, putProject, putMeeting } from '../lib/db.js';
import {
  formatClock,
  GROUNDED_SYSTEM,
  groundedPrompt,
  notInMemoryMessage,
  retrieveEvidence,
  verifyCitations,
} from '../lib/retrieval/evidence.js';
import { searchWeb, type WebSearchResult } from '../lib/search/web.js';
import { createProvider } from '../lib/ai/provider.js';
import { SUMMARY_SYSTEM, summaryPrompt, projectPrompt } from '../lib/ai/prompts.js';
import { generateReport, generateFlashcards, generateQuiz, generateMindmap } from '../lib/artifacts/artifacts.js';
import { parseProjectPlan } from '../lib/projects/converter.js';
import { applyMeetingSummary, parseMeetingSummary } from '../lib/ai/meeting-intelligence.js';
import { countIfAny, formatDuration, formatWhen, joinMeta, pluralize } from '../lib/utils/format.js';
import type { Meeting, ProviderSettings } from '../lib/types.js';
import { loadProviderSettings } from '../lib/settings-store.js';
import { parseSuggestions, SUGGEST_SYSTEM, suggestionPrompt, SuggestionPacer } from '../lib/ai/suggestions.js';
import { createTranscriptionProvider } from '../lib/transcription/factory.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const chatLog = $('chatLog');
const chatInput = $('chatInput') as HTMLInputElement;
const errorBox = $('errorBox');
const artifactBox = $('artifactBox');
const recentList = $('recentList');
const targetSelect = $('targetMeeting') as HTMLSelectElement;
const targetMeta = $('targetMeta');

let meetings: Meeting[] = [];
let targetId: string | null = null;

/* ------------------------------------------------------------------ notices */

function showError(msg: string | null): void {
  errorBox.replaceChildren();
  if (!msg) return;
  const box = document.createElement('p');
  box.className = 'error';
  box.setAttribute('role', 'alert');
  box.textContent = msg;
  errorBox.appendChild(box);
}

function showSuccess(msg: string): void {
  artifactBox.replaceChildren();
  const box = document.createElement('p');
  box.className = 'ok-box';
  box.textContent = msg;
  artifactBox.appendChild(box);
}

const loadSettings = (): Promise<ProviderSettings> => loadProviderSettings();

/* ------------------------------------------------------------------ chat */

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
  div.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function ask(): Promise<void> {
  const q = chatInput.value.trim();
  if (!q) return;
  showError(null);
  addMsg('user', q);
  chatInput.value = '';
  $('chatExamples').replaceChildren();
  try {
    const settings = await loadSettings();
    meetings = await listMeetings(500);
    if (meetings.length === 0) {
      addMsg('assistant', 'No meetings in memory yet. Record one, then ask again.');
      return;
    }
    const scope = (document.querySelector('input[name="scope"]:checked') as HTMLInputElement)?.value ?? 'all';
    const pool = scope === 'latest' ? meetings.slice(0, 1) : meetings;
    const retrieval = retrieveEvidence(pool, q);
    let external: WebSearchResult[] = [];
    if (settings.searchProvider !== 'none') external = await searchWeb(settings, q);
    if (retrieval.passages.length === 0 && external.length === 0) {
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
    const cited = verified.citations.map(
      (c) => `${c.title}${c.timestampSec !== null ? ` @ ${formatClock(c.timestampSec)}` : ''}`,
    );
    const parts = [
      cited.length ? `Memory sources: ${cited.join(' · ')}` : 'No meeting sources cited',
      retrieval.dateFilter ? `Date filter: ${retrieval.dateFilter.label}` : '',
      external.length ? `External (not from your meetings): ${external.map((r) => r.url).join(', ')}` : '',
      verified.invalid.length
        ? `Removed ${pluralize(verified.invalid.length, 'citation')} that did not match retrieved evidence`
        : '',
      !verified.grounded && external.length === 0
        ? '⚠ This answer cites no meeting evidence — treat it as unverified.'
        : '',
    ].filter(Boolean);
    addMsg('assistant', verified.text, parts.join(' | '));
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Failed to answer.');
  }
}

const EXAMPLES = [
  'What did we decide last week?',
  'What am I on the hook for?',
  'What is still unresolved?',
];

function renderExamples(): void {
  const box = $('chatExamples');
  box.replaceChildren();
  for (const q of EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-ghost';
    b.textContent = q;
    b.addEventListener('click', () => {
      chatInput.value = q;
      chatInput.focus();
    });
    box.appendChild(b);
  }
}

/* ------------------------------------------------------------------ target */

function currentTarget(): Meeting | null {
  if (!targetId) return null;
  return meetings.find((m) => m.id === targetId) ?? null;
}

function renderTarget(): void {
  targetSelect.replaceChildren();
  if (meetings.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'No meetings yet';
    opt.value = '';
    targetSelect.appendChild(opt);
    targetSelect.disabled = true;
    targetMeta.textContent = 'Record a meeting first — these actions need a transcript to work from.';
    for (const id of ['btnTranscribe', 'btnSummarize', 'btnProject', 'btnReport', 'btnFlash', 'btnQuiz', 'btnMindmap']) {
      ($(id) as HTMLButtonElement).disabled = true;
    }
    return;
  }
  targetSelect.disabled = false;
  if (!targetId || !meetings.some((m) => m.id === targetId)) targetId = meetings[0]!.id;
  for (const m of meetings) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.title} — ${formatWhen(m.startedAt)}`;
    opt.selected = m.id === targetId;
    targetSelect.appendChild(opt);
  }
  const m = currentTarget();
  if (m) {
    targetMeta.textContent = joinMeta([
      formatDuration(m.durationSec),
      m.transcriptText.trim() ? pluralize(m.transcript.length, 'segment') : 'no transcript yet',
      countIfAny(m.decisions.length, 'decision'),
      m.summary ? 'summarized' : 'not summarized',
    ]);
  }
  const hasTranscript = Boolean(m?.transcriptText.trim());
  for (const id of ['btnSummarize', 'btnProject', 'btnReport', 'btnFlash', 'btnQuiz', 'btnMindmap']) {
    ($(id) as HTMLButtonElement).disabled = !hasTranscript;
  }
  ($('btnTranscribe') as HTMLButtonElement).disabled = !m?.hasAudio;
  ($('btnTranscribe') as HTMLButtonElement).title = m?.hasAudio
    ? 'Transcribe the saved recording with your cloud transcription provider'
    : 'This meeting has no saved audio';
}

targetSelect.addEventListener('change', () => {
  targetId = targetSelect.value || null;
  renderTarget();
});

/* ------------------------------------------------------------------ processing */

async function transcribeTarget(): Promise<void> {
  showError(null);
  const m = currentTarget();
  if (!m) return showError('Select a meeting first.');
  const audio = await getAudio(m.id);
  if (!audio?.blob.size) return showError('This meeting has no saved audio.');
  try {
    const settings = await loadSettings();
    if (settings.transcriptionProvider !== 'cloud') {
      throw new Error(
        'Recording transcription needs Cloud Whisper. Choose “Cloud Whisper” in Settings, save a key, then retry. Web Speech only works live.',
      );
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
    showSuccess(
      `Transcribed “${updated.title}” into ${pluralize(result.segments.length, 'timestamped segment')}. Speakers are not labelled by this provider.`,
    );
    await refreshRecent();
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Transcription failed.');
  }
}

async function summarizeTarget(): Promise<void> {
  showError(null);
  const m = currentTarget();
  if (!m) return showError('Select a meeting first.');
  if (!m.transcriptText.trim()) return showError('This meeting has no transcript yet. Transcribe the audio first.');
  try {
    const settings = await loadSettings();
    const provider = createProvider(settings, settings.aiProvider);
    const res = await provider.chat([
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: summaryPrompt(m.transcriptText) },
    ]);
    const updated = applyMeetingSummary(m, parseMeetingSummary(res.text));
    await putMeeting(updated);
    showSuccess(`Summary saved for “${updated.title}”. Open the Dashboard to read it with citations.`);
    await refreshRecent();
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Summarization failed.');
  }
}

async function convertTarget(): Promise<void> {
  showError(null);
  const m = currentTarget();
  if (!m) return showError('Select a meeting first.');
  if (!m.transcriptText.trim()) return showError('This meeting has no transcript yet. Transcribe the audio first.');
  try {
    const settings = await loadSettings();
    const provider = createProvider(settings, settings.aiProvider);
    const res = await provider.chat([
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: projectPrompt(m.transcriptText, m.summary ?? '') },
    ]);
    const plan = parseProjectPlan(res.text, m.id);
    await putProject(plan);
    showSuccess(
      `Project plan “${plan.title}” drafted from “${m.title}” — ${pluralize(plan.tasks.length, 'task')}, ${pluralize(plan.milestones.length, 'milestone')}. It stays unapproved until you approve it in the Dashboard.`,
    );
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Project conversion failed.');
  }
}

function showArtifact(title: string, body: string): void {
  artifactBox.replaceChildren();
  const panel = document.createElement('div');
  panel.className = 'panel';
  const h = document.createElement('h3');
  h.textContent = title;
  const pre = document.createElement('pre');
  pre.textContent = body;
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

/* ------------------------------------------------------------------ recent */

async function refreshRecent(): Promise<void> {
  meetings = await listMeetings(50);
  renderTarget();
  if (meetings.length === 0) {
    recentList.innerHTML =
      '<div class="empty"><p class="empty__title" style="font-size:14px">No meetings yet</p>' +
      '<p class="empty__body">Click the MeetDolff icon while a meeting tab is open and record it — it shows up here.</p></div>';
    return;
  }
  recentList.replaceChildren();
  for (const m of meetings.slice(0, 8)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row row--button';
    row.setAttribute('aria-current', String(m.id === targetId));

    const main = document.createElement('div');
    main.className = 'row-main';
    const title = document.createElement('p');
    title.className = 'row-title';
    title.textContent = m.title;
    const meta = document.createElement('p');
    meta.className = 'row-meta';
    for (const part of [
      formatWhen(m.startedAt),
      formatDuration(m.durationSec),
      m.transcriptText.trim() ? countIfAny(m.decisions.length, 'decision') : 'no transcript',
    ]) {
      const span = document.createElement('span');
      span.textContent = part;
      meta.appendChild(span);
    }
    main.append(title, meta);

    row.append(main);
    row.addEventListener('click', () => {
      targetId = m.id;
      targetSelect.value = m.id;
      renderTarget();
      refreshRecent();
      targetSelect.focus();
    });
    recentList.appendChild(row);
  }
}

/* ------------------------------------------------------------------ wiring */

$('btnAsk').addEventListener('click', () => void ask());
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void ask();
});
$('btnTranscribe').addEventListener('click', () => void transcribeTarget());
$('btnSummarize').addEventListener('click', () => void summarizeTarget());
$('btnProject').addEventListener('click', () => void convertTarget());

$('btnReport').addEventListener('click', () => {
  const m = currentTarget();
  if (!m) return showError('Select a meeting first.');
  showArtifact(`Report — ${m.title}`, generateReport(m));
});
$('btnFlash').addEventListener('click', () => {
  const m = currentTarget();
  if (!m) return showError('Select a meeting first.');
  const cards = generateFlashcards(m);
  showArtifact(
    `Flashcards — ${m.title}`,
    cards.map((c, i) => `${i + 1}. Q: ${c.front}\n   A: ${c.back}`).join('\n\n') || 'No cards yet — summarize this meeting first.',
  );
});
$('btnQuiz').addEventListener('click', () => {
  const m = currentTarget();
  if (!m) return showError('Select a meeting first.');
  const quiz = generateQuiz(m);
  showArtifact(
    `Quiz — ${m.title}`,
    quiz.map((x, i) => `${i + 1}. ${x.q}\n   → ${x.a}`).join('\n\n') || 'No quiz items yet — summarize this meeting first.',
  );
});
$('btnMindmap').addEventListener('click', () => {
  const m = currentTarget();
  if (!m) return showError('Select a meeting first.');
  showArtifact(`Mind map — ${m.title}`, generateMindmap(m));
});

/* ---- Live question suggestions (opt-in, paced, never auto-fills the chat) ---- */
const sugEnabled = $('sugEnabled') as HTMLInputElement;
const sugStatus = $('sugStatus');
const sugList = $('sugList');
const pacer = new SuggestionPacer();
const shownQuestions: string[] = [];

async function runSuggestions(excerpt: string): Promise<void> {
  const settings = await loadSettings();
  if (!settings.apiKey) {
    sugStatus.textContent = 'Add an API key in Settings to get suggestions.';
    return;
  }
  sugStatus.textContent = 'Thinking about what to ask…';
  const res = await createProvider(settings, settings.aiProvider).chat(
    [
      { role: 'system', content: SUGGEST_SYSTEM },
      { role: 'user', content: suggestionPrompt(excerpt, shownQuestions) },
    ],
    { temperature: 0.5 },
  );
  const fresh = parseSuggestions(res.text, shownQuestions);
  sugStatus.textContent = fresh.length ? 'Click a question to put it in the box above.' : 'Nothing worth asking yet.';
  for (const q of fresh) {
    shownQuestions.push(q);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm sug-item';
    b.textContent = q;
    b.addEventListener('click', () => {
      chatInput.value = q;
      chatInput.focus();
    });
    sugList.prepend(b);
  }
  while (sugList.children.length > 8) sugList.lastElementChild?.remove();
}

async function maybeSuggest(): Promise<void> {
  if (!sugEnabled.checked || !pacer.shouldRun(Date.now())) return;
  const excerpt = pacer.begin(Date.now());
  try {
    await runSuggestions(excerpt);
  } catch (e) {
    sugStatus.textContent = e instanceof Error ? `Suggestions unavailable: ${e.message}` : 'Suggestions unavailable.';
  } finally {
    pacer.end();
  }
}

sugEnabled.addEventListener('change', async () => {
  await chrome.storage.local.set({ suggestionsEnabled: sugEnabled.checked });
  sugStatus.textContent = sugEnabled.checked
    ? 'Listening… suggestions appear as the conversation develops.'
    : 'Off. Nothing is sent to your AI provider.';
});

$('btnSuggestNow').addEventListener('click', async () => {
  showError(null);
  let excerpt = pacer.peek();
  if (!excerpt) {
    const m = currentTarget();
    excerpt = m?.transcriptText.slice(-2400) ?? '';
  }
  if (!excerpt) {
    sugStatus.textContent = 'No transcript to work from yet.';
    return;
  }
  try {
    await runSuggestions(excerpt);
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Suggestions failed.');
  }
});

void chrome.storage.local.get('suggestionsEnabled').then((r) => {
  sugEnabled.checked = r['suggestionsEnabled'] === true;
  if (sugEnabled.checked) {
    sugStatus.textContent = 'Listening… suggestions appear as the conversation develops.';
    $('sugDetails').setAttribute('open', '');
  }
});

chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg?.type === 'TRANSCRIPTION_FINAL') {
    pacer.add(String(msg.text ?? ''));
    void maybeSuggest();
  }
  if (msg?.type === 'MEETING_SAVED' || msg?.type === 'MEETING_PROCESSED') void refreshRecent();
renderExamples();
  if (msg?.type === 'PROCESSING_ERROR') showError(String(msg.error ?? 'Post-recording processing failed.'));
});

void refreshRecent();
renderExamples();
