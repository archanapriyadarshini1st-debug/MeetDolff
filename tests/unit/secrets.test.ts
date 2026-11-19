import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSecret, hasSecret, setSecret, wipeVault } from '../../src/lib/secrets.js';
import { loadProviderSettings, saveProviderSettings, SETTINGS_KEY, type SettingsBackend } from '../../src/lib/settings-store.js';
import { DEFAULT_PROVIDER_SETTINGS } from '../../src/lib/types.js';

function memoryBackend(): SettingsBackend & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (k) => (k in data ? { [k]: data[k] } : {}),
    set: async (i) => void Object.assign(data, i),
    remove: async (k) => void [k].flat().forEach((x) => delete data[x]),
  };
}

beforeEach(async () => {
  await wipeVault();
});

describe('secret vault', () => {
  it('round-trips a secret', async () => {
    await setSecret('a', 'sk-test-123');
    expect(await hasSecret('a')).toBe(true);
    expect(await getSecret('a')).toBe('sk-test-123');
  });

  it('never stores plaintext in the vault records', async () => {
    await setSecret('b', 'sk-plain-marker-xyz');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('meetdolff-vault');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rec = await new Promise<{ iv: Uint8Array; ct: ArrayBuffer }>((res) => {
      const q = db.transaction('secrets').objectStore('secrets').get('b');
      q.onsuccess = () => res(q.result);
    });
    const raw = new TextDecoder('latin1').decode(rec.ct);
    expect(raw).not.toContain('sk-plain-marker-xyz');
    db.close();
  });

  it('returns null after the vault is wiped (undecryptable data is not leaked)', async () => {
    await setSecret('c', 'value');
    await wipeVault();
    expect(await getSecret('c')).toBeNull();
  });

  it('empty value deletes the secret', async () => {
    await setSecret('d', 'x');
    await setSecret('d', '');
    expect(await hasSecret('d')).toBe(false);
  });
});

describe('settings store', () => {
  it('keeps API keys out of chrome.storage', async () => {
    const backend = memoryBackend();
    await saveProviderSettings({ ...DEFAULT_PROVIDER_SETTINGS, apiKey: 'sk-secret', searchApiKey: 'tvly-secret', chatModel: 'm1' }, backend);
    expect(JSON.stringify(backend.data)).not.toContain('secret');
    const loaded = await loadProviderSettings(backend);
    expect(loaded.apiKey).toBe('sk-secret');
    expect(loaded.searchApiKey).toBe('tvly-secret');
    expect(loaded.chatModel).toBe('m1');
  });

  it('migrates legacy plaintext keys and scrubs them from storage', async () => {
    const backend = memoryBackend();
    backend.data[SETTINGS_KEY] = { ...DEFAULT_PROVIDER_SETTINGS, apiKey: 'sk-legacy', searchApiKey: '' };
    const loaded = await loadProviderSettings(backend);
    expect(loaded.apiKey).toBe('sk-legacy');
    expect(JSON.stringify(backend.data)).not.toContain('sk-legacy');
  });
});
