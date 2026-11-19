/**
 * Encrypted secret vault for BYOK API keys.
 *
 * - AES-GCM 256 key generated with `extractable: false` and kept as a
 *   CryptoKey object in its own IndexedDB database (never exportable as bytes).
 * - Ciphertext lives in the same database; plaintext never touches
 *   chrome.storage.local/sync or any log.
 *
 * Threat model (be honest): this keeps keys out of plain-text storage, sync,
 * profile backups and casual disk inspection. It does NOT defend against
 * malware running as the same OS user or a compromised extension page.
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'meetdolff-vault';
const DB_VERSION = 1;
const MASTER_KEY_ID = 'master';

interface VaultSchema {
  keys: { key: string; value: CryptoKey };
  secrets: { key: string; value: { iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer } };
}

let dbPromise: Promise<IDBPDatabase<VaultSchema>> | null = null;

function db(): Promise<IDBPDatabase<VaultSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<VaultSchema>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('keys');
        d.createObjectStore('secrets');
      },
    });
  }
  return dbPromise;
}

/** Test helper: drop the cached connection. */
export async function _closeVaultForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

async function masterKey(): Promise<CryptoKey> {
  const d = await db();
  const existing = await d.get('keys', MASTER_KEY_ID);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  // Guard against two contexts racing to create the key: keep the first one written.
  const tx = d.transaction('keys', 'readwrite');
  const raced = await tx.store.get(MASTER_KEY_ID);
  if (!raced) await tx.store.put(key, MASTER_KEY_ID);
  await tx.done;
  return raced ?? key;
}

export async function setSecret(name: string, value: string): Promise<void> {
  if (!value) {
    await deleteSecret(name);
    return;
  }
  const key = await masterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(name) }, key, new TextEncoder().encode(value));
  await (await db()).put('secrets', { iv, ct }, name);
}

/** Returns null when absent or undecryptable (e.g. vault key was wiped). */
export async function getSecret(name: string): Promise<string | null> {
  const rec = await (await db()).get('secrets', name);
  if (!rec) return null;
  try {
    const key = await masterKey();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv, additionalData: new TextEncoder().encode(name) }, key, rec.ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export async function hasSecret(name: string): Promise<boolean> {
  return (await (await db()).count('secrets', name)) > 0;
}

export async function deleteSecret(name: string): Promise<void> {
  await (await db()).delete('secrets', name);
}

/** Irreversibly delete every secret and the master key. */
export async function wipeVault(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['keys', 'secrets'], 'readwrite');
  await tx.objectStore('keys').clear();
  await tx.objectStore('secrets').clear();
  await tx.done;
}
