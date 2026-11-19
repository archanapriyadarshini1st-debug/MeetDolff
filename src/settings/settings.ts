/**
 * Settings: BYOK provider config, memory folder, data controls.
 * API keys: chrome.storage.local only. Never logged.
 */

import '../styles/design-system.css';
import { DEFAULT_PROVIDER_SETTINGS, type ProviderSettings } from '../lib/types.js';
import { createProvider } from '../lib/ai/provider.js';
import { getStoredFolder, pickMemoryFolder, isFileSystemAccessSupported } from '../lib/memory-files.js';
import { kvDelete } from '../lib/db.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const errorBox = $('errorBox');

function showError(msg: string | null): void {
  errorBox.innerHTML = msg ? `<div class="error" role="alert">${msg}</div>` : '';
}

async function load(): Promise<void> {
  const res = (await chrome.storage.local.get('providerSettings')) as any;
  const s: ProviderSettings = { ...DEFAULT_PROVIDER_SETTINGS, ...(res?.providerSettings ?? {}) };
  ($('aiProvider') as HTMLSelectElement).value = s.aiProvider;
  ($('baseUrl') as HTMLInputElement).value = s.baseUrl;
  ($('chatModel') as HTMLInputElement).value = s.chatModel;
  ($('transcriptionModel') as HTMLInputElement).value = s.transcriptionModel;
  ($('transcriptionProvider') as HTMLSelectElement).value = s.transcriptionProvider;
  ($('searchProvider') as HTMLSelectElement).value = s.searchProvider;
  // Never prefill key value into DOM beyond placeholder; show saved state only.
  ($('apiKey') as HTMLInputElement).placeholder = s.apiKey ? '•••••••• (saved)' : 'sk-…';
  ($('searchApiKey') as HTMLInputElement).placeholder = s.searchApiKey ? '•••••••• (saved)' : 'Optional';
  await refreshFolderStatus();
}

async function refreshFolderStatus(): Promise<void> {
  const folder = await getStoredFolder();
  $('folderStatus').textContent = folder
    ? `Connected: ${folder.name}`
    : isFileSystemAccessSupported()
      ? 'No folder connected.'
      : 'Folder access unsupported — use Download fallback.';
}

$('btnSave').addEventListener('click', async () => {
  showError(null);
  const prev = (await chrome.storage.local.get('providerSettings')) as any;
  const prevSettings: ProviderSettings = { ...DEFAULT_PROVIDER_SETTINGS, ...(prev?.providerSettings ?? {}) };
  const newKey = ($('apiKey') as HTMLInputElement).value.trim();
  const newSearchKey = ($('searchApiKey') as HTMLInputElement).value.trim();
  const settings: ProviderSettings = {
    aiProvider: ($('aiProvider') as HTMLSelectElement).value as ProviderSettings['aiProvider'],
    baseUrl: ($('baseUrl') as HTMLInputElement).value.trim() || DEFAULT_PROVIDER_SETTINGS.baseUrl,
    chatModel: ($('chatModel') as HTMLInputElement).value.trim() || DEFAULT_PROVIDER_SETTINGS.chatModel,
    transcriptionModel: ($('transcriptionModel') as HTMLInputElement).value.trim() || DEFAULT_PROVIDER_SETTINGS.transcriptionModel,
    apiKey: newKey || prevSettings.apiKey,
    transcriptionProvider: ($('transcriptionProvider') as HTMLSelectElement).value as ProviderSettings['transcriptionProvider'],
    searchProvider: ($('searchProvider') as HTMLSelectElement).value as ProviderSettings['searchProvider'],
    searchApiKey: newSearchKey || prevSettings.searchApiKey,
  };
  await chrome.storage.local.set({ providerSettings: settings });
  if (chrome.permissions?.request) {
    const origins: string[] = [];
    if (settings.aiProvider === 'anthropic') origins.push('https://api.anthropic.com/*');
    else if (settings.aiProvider === 'gemini') origins.push('https://generativelanguage.googleapis.com/*');
    else {
      try {
        const origin = new URL(settings.baseUrl).origin;
        origins.push(`${origin}/*`);
      } catch {
        /* validation is handled by the provider request */
      }
    }
    if (settings.searchProvider === 'tavily') origins.push('https://api.tavily.com/*');
    if (settings.searchProvider === 'brave') origins.push('https://api.search.brave.com/*');
    // Permission prompts are browser UI; do not hold the settings save on them.
    if (origins.length) void chrome.permissions.request({ origins }).catch(() => undefined);
  }
  ($('apiKey') as HTMLInputElement).value = '';
  ($('searchApiKey') as HTMLInputElement).value = '';
  errorBox.innerHTML = '<div class="ok-box">Settings saved locally.</div>';
  await load();
});

$('btnTest').addEventListener('click', async () => {
  const out = $('testResult');
  out.textContent = 'Testing…';
  try {
    const res = (await chrome.storage.local.get('providerSettings')) as any;
    const s: ProviderSettings = { ...DEFAULT_PROVIDER_SETTINGS, ...(res?.providerSettings ?? {}) };
    if (!s.apiKey) throw new Error('No API key saved. Save a key first.');
    const provider = createProvider(s, s.aiProvider);
    await provider.chat([{ role: 'user', content: 'Reply with the single word: ok' }]);
    out.textContent = 'Connection OK.';
  } catch (e) {
    out.textContent = e instanceof Error ? e.message : 'Test failed.';
  }
});

$('btnPickFolder').addEventListener('click', async () => {
  showError(null);
  try {
    if (!isFileSystemAccessSupported()) throw new Error('Folder access unsupported. Use Download fallback.');
    await pickMemoryFolder();
    await refreshFolderStatus();
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Folder selection failed.');
  }
});

$('btnClearFolder').addEventListener('click', async () => {
  await kvDelete('memoryDirHandle');
  await refreshFolderStatus();
});

$('btnWipe').addEventListener('click', async () => {
  if (!confirm('Delete ALL local MeetDolff data (meetings, audio, calendar, projects)? This cannot be undone.')) return;
  // IndexedDB wipe + settings clear (keep folder handle? remove too)
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('meetdolff');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  await chrome.storage.local.remove(['providerSettings']);
  errorBox.innerHTML = '<div class="ok-box">All local data deleted.</div>';
  await load();
});

void load();
