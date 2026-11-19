/**
 * Playwright e2e: real Chrome for Testing + unpacked MV3 extension.
 * Requires `npm run build` first (dist/ must exist).
 * Recording capture is intentionally covered by a manual checklist in TESTING.md:
 * tabCapture requires a real user gesture and an audible tab.
 */

import { test, expect, chromium } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';

const DIST = resolve(process.cwd(), 'dist');

// Chromium's old headless shell cannot load extensions. Locally run headed (default) or under xvfb;
// in display-less environments set MEETDOLFF_HEADLESS=1 to use Chromium's new headless mode.
const HEADLESS = process.env['MEETDOLFF_HEADLESS'] === '1';

async function extensionContext() {
  return chromium.launchPersistentContext('', {
    headless: HEADLESS,
    ...(HEADLESS ? { channel: 'chromium' } : {}),
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--disable-gpu',
      '--no-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
}

async function extensionId(context: Awaited<ReturnType<typeof extensionContext>>): Promise<string> {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const match = sw.url().match(/^chrome-extension:\/\/([^/]+)\//);
  if (!match?.[1]) throw new Error(`Could not determine extension id from ${sw.url()}`);
  return match[1];
}

test.describe('MeetDolff extension', () => {
  test('dist build exists', () => {
    expect(existsSync(resolve(DIST, 'manifest.json'))).toBe(true);
    expect(existsSync(resolve(DIST, 'background.js'))).toBe(true);
    expect(existsSync(resolve(DIST, 'popup.html'))).toBe(true);
    expect(existsSync(resolve(DIST, 'sidepanel.html'))).toBe(true);
  });

  test('popup, sidepanel, dashboard, settings render in loaded extension', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const pages = [
        { path: 'popup.html', expectText: 'Record & remember' },
        { path: 'sidepanel.html', expectText: 'Ask your meetings' },
        { path: 'dashboard.html', expectText: 'Meeting memory' },
        { path: 'settings.html', expectText: 'Providers & memory' },
      ];
      for (const p of pages) {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));
        await page.goto(`chrome-extension://${id}/${p.path}`);
        await expect(page.locator('body')).toContainText(p.expectText);
        expect(errors, `${p.path} page errors`).toEqual([]);
        await page.close();
      }
    } finally {
      await context.close();
    }
  });

  test('microphone recording survives pause/resume and persists a meeting', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/popup.html`);
      await page.locator('#btnStartMic').click();
      await expect(page.locator('#statusText')).toHaveText('Recording', { timeout: 10_000 });
      await page.waitForTimeout(1_200);
      await page.locator('#btnPause').click();
      await expect(page.locator('#statusText')).toHaveText('Paused');
      await page.locator('#btnPause').click();
      await expect(page.locator('#statusText')).toHaveText('Recording');
      await page.locator('#btnStop').click();
      await expect(page.locator('#statusText')).toHaveText('Saved');
      await page.waitForTimeout(1_500);
      const dashboard = await context.newPage();
      await dashboard.goto(`chrome-extension://${id}/dashboard.html`);
      await expect(dashboard.locator('#meetingList .row')).toHaveCount(1, { timeout: 10_000 });
      await expect(dashboard.locator('#meetingList')).toContainText('Meeting');
      await dashboard.locator('#meetingList .row').first().click();
      await expect(dashboard.locator('#detailBox audio')).toHaveCount(1, { timeout: 10_000 });
      await dashboard.close();
      await page.close();
    } finally {
      await context.close();
    }
  });

  test('settings persists non-secret configuration without exposing key in DOM', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/settings.html`);
      await page.locator('#baseUrl').fill('http://localhost:11434/v1');
      await page.locator('#chatModel').fill('llama3.2');
      await page.locator('#apiKey').fill('test-only-key-not-a-real-secret');
      await page.locator('#btnSave').click();
      await expect(page.locator('#errorBox')).toContainText('Settings saved locally');
      expect(await page.locator('#apiKey').inputValue()).toBe('');
      const stored = await page.evaluate(async () => chrome.storage.local.get(null));
      expect(stored['providerSettings'].baseUrl).toBe('http://localhost:11434/v1');
      expect(stored['providerSettings'].chatModel).toBe('llama3.2');
      // The key must NOT be in chrome.storage in any form...
      expect(JSON.stringify(stored)).not.toContain('test-only-key-not-a-real-secret');
      // ...it lives only as AES-GCM ciphertext in the vault database.
      const vault = await page.evaluate(
        () =>
          new Promise<{ hasCipher: boolean; plaintextFound: boolean }>((resolveVault, reject) => {
            const open = indexedDB.open('meetdolff-vault');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const q = open.result.transaction('secrets').objectStore('secrets').get('provider.apiKey');
              q.onsuccess = () => {
                const rec = q.result as { ct: ArrayBuffer } | undefined;
                const raw = rec ? new TextDecoder('latin1').decode(rec.ct) : '';
                resolveVault({ hasCipher: !!rec && rec.ct.byteLength > 16, plaintextFound: raw.includes('test-only-key') });
              };
            };
          }),
      );
      expect(vault).toEqual({ hasCipher: true, plaintextFound: false });
      // The settings page still reports that a key is saved after reload.
      await page.reload();
      await expect(page.locator('#apiKey')).toHaveAttribute('placeholder', /saved/);
      await page.close();
    } finally {
      await context.close();
    }
  });

  test('transcript correction persists, keeps the original and flags the summary stale', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/dashboard.html`);
      await page.evaluate(
        () =>
          new Promise<void>((resolveSeed, reject) => {
            const open = indexedDB.open('meetdolff');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const tx = open.result.transaction('meetings', 'readwrite');
              tx.objectStore('meetings').put({
                id: 'e2e-1', title: 'E2E seeded meeting', startedAt: '2026-11-17T19:00:00.000Z', endedAt: '2026-11-17T19:10:00.000Z', durationSec: 600,
                participants: [], transcriptText: 'we use post gress', summary: 'Old summary', topics: [], decisions: [], actionItems: [], openQuestions: [],
                commitments: [], project: null, audioSource: 'mic', audioMime: null, hasAudio: false, memoryVersion: 1, createdAt: '', updatedAt: '',
                transcript: [{ id: 'seg-1', start: 3, end: 6, speaker: null, text: 'we use post gress' }],
              });
              tx.oncomplete = () => resolveSeed();
              tx.onerror = () => reject(tx.error);
            };
          }),
      );
      await page.reload();
      await page.getByText('E2E seeded meeting').click();
      await page.getByRole('button', { name: /Edit transcript at 00:03/ }).click();
      await page.getByLabel('Transcript text').fill('we use Postgres');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.locator('.seg-body')).toContainText('we use Postgres');
      await expect(page.locator('.badge-edited')).toBeVisible();
      await expect(page.getByText(/transcript was edited after this summary/i)).toBeVisible();
      const saved = await page.evaluate(
        () =>
          new Promise<{ text: string; originalText: string; stale: boolean; full: string }>((resolveRead, reject) => {
            const open = indexedDB.open('meetdolff');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const q = open.result.transaction('meetings').objectStore('meetings').get('e2e-1');
              q.onsuccess = () => resolveRead({ text: q.result.transcript[0].text, originalText: q.result.transcript[0].originalText, stale: q.result.summaryStale, full: q.result.transcriptText });
            };
          }),
      );
      expect(saved).toEqual({ text: 'we use Postgres', originalText: 'we use post gress', stale: true, full: 'we use Postgres' });
      await page.close();
    } finally {
      await context.close();
    }
  });

  test('grounded Q&A: date retrieval, verified citations, and no model call without evidence', async () => {
    const prompts: string[] = [];
    const fake: Server = createServer((req, res) => {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', '*');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        prompts.push(body);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: 'The team chose Postgres [E1]. They also shipped it already [E99].' } }] }));
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    const port = (fake.address() as { port: number }).port;
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const settings = await context.newPage();
      await settings.goto(`chrome-extension://${id}/settings.html`);
      await settings.locator('#baseUrl').fill(`http://127.0.0.1:${port}/v1`);
      await settings.locator('#apiKey').fill('test-only-key-not-a-real-secret');
      await settings.locator('#btnSave').click();
      await expect(settings.locator('#errorBox')).toContainText('Settings saved locally');
      await settings.close();

      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/sidepanel.html`);
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
      yesterday.setHours(14, 0, 0, 0);
      const seed = (mid: string, title: string, start: string, text: string) => ({
        id: mid, title, startedAt: start, endedAt: new Date(new Date(start).getTime() + 1800_000).toISOString(), durationSec: 1800, participants: [],
        transcriptText: text, summary: null, topics: [], decisions: [], actionItems: [], openQuestions: [], commitments: [], project: null,
        audioSource: 'mic', audioMime: null, hasAudio: false, memoryVersion: 1, createdAt: start, updatedAt: start,
        transcript: [{ id: `${mid}-1`, start: 0, end: 5, speaker: null, text }],
      });
      const rows = [
        seed('q1', 'Frontend sync', yesterday.toISOString(), 'We decided to use Postgres for the dashboard.'),
        seed('q2', 'Old budget review', new Date(2026, 0, 5, 10).toISOString(), 'Unrelated zebra budget secret.'),
      ];
      await page.evaluate(
        (items) =>
          new Promise<void>((resolveSeed, reject) => {
            const open = indexedDB.open('meetdolff');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const tx = open.result.transaction('meetings', 'readwrite');
              for (const m of items) tx.objectStore('meetings').put(m);
              tx.oncomplete = () => resolveSeed();
              tx.onerror = () => reject(tx.error);
            };
          }),
        rows,
      );
      await page.reload();
      await page.locator('#chatInput').fill('What did we decide about the dashboard yesterday?');
      await page.locator('#btnAsk').click();
      const answer = page.locator('.chat-msg.assistant').first();
      await expect(answer).toContainText('[Frontend sync @ 00:00]');
      await expect(answer).not.toContainText('E99');
      await expect(answer.locator('.src')).toContainText('Removed 1 citation');
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain('Postgres');
      expect(prompts[0]).not.toContain('zebra'); // other-date meeting never reaches the model

      await page.locator('#chatInput').fill('kubernetes autoscaling budget');
      await page.locator('#btnAsk').click();
      await expect(page.locator('.chat-msg.assistant').nth(1)).toContainText("isn't in your meeting memory");
      expect(prompts).toHaveLength(1); // no extra model call for an empty retrieval
      await page.close();
    } finally {
      await context.close();
      fake.close();
    }
  });

  test('no real-looking secrets bundled in dist', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.js') || full.endsWith('.html')) files.push(full);
      }
    };
    walk(DIST);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
      expect(content).not.toMatch(/ak_[A-Za-z0-9_-]{10,}/);
    }
  });
});
