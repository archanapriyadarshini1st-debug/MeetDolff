/**
 * Provider settings persistence.
 * Non-secret fields -> chrome.storage.local. API keys -> encrypted vault.
 * Legacy plaintext keys written by earlier versions are migrated on first load.
 */

import { DEFAULT_PROVIDER_SETTINGS, type ProviderSettings } from './types.js';
import { deleteSecret, getSecret, setSecret } from './secrets.js';

export const SETTINGS_KEY = 'providerSettings';
export const SECRET_NAMES = { apiKey: 'provider.apiKey', searchApiKey: 'search.apiKey' } as const;

export interface SettingsBackend {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

const chromeBackend: SettingsBackend = {
  get: (k) => chrome.storage.local.get(k) as Promise<Record<string, unknown>>,
  set: (i) => chrome.storage.local.set(i),
  remove: (k) => chrome.storage.local.remove(k),
};

type StoredSettings = Partial<ProviderSettings>;

function stripSecrets(s: StoredSettings): Omit<StoredSettings, 'apiKey' | 'searchApiKey'> {
  const { apiKey: _a, searchApiKey: _s, ...rest } = s;
  void _a;
  void _s;
  return rest;
}

export async function loadProviderSettings(backend: SettingsBackend = chromeBackend): Promise<ProviderSettings> {
  const res = await backend.get(SETTINGS_KEY);
  const stored = (res[SETTINGS_KEY] ?? {}) as StoredSettings;

  // One-time migration of plaintext keys from older builds.
  if (stored.apiKey || stored.searchApiKey) {
    if (stored.apiKey) await setSecret(SECRET_NAMES.apiKey, stored.apiKey);
    if (stored.searchApiKey) await setSecret(SECRET_NAMES.searchApiKey, stored.searchApiKey);
    await backend.set({ [SETTINGS_KEY]: stripSecrets(stored) });
  }

  return {
    ...DEFAULT_PROVIDER_SETTINGS,
    ...stripSecrets(stored),
    apiKey: (await getSecret(SECRET_NAMES.apiKey)) ?? '',
    searchApiKey: (await getSecret(SECRET_NAMES.searchApiKey)) ?? '',
  };
}

export async function saveProviderSettings(settings: ProviderSettings, backend: SettingsBackend = chromeBackend): Promise<void> {
  await setSecret(SECRET_NAMES.apiKey, settings.apiKey);
  await setSecret(SECRET_NAMES.searchApiKey, settings.searchApiKey);
  await backend.set({ [SETTINGS_KEY]: stripSecrets(settings) });
}

export async function clearProviderSettings(backend: SettingsBackend = chromeBackend): Promise<void> {
  await backend.remove(SETTINGS_KEY);
  await deleteSecret(SECRET_NAMES.apiKey);
  await deleteSecret(SECRET_NAMES.searchApiKey);
}
