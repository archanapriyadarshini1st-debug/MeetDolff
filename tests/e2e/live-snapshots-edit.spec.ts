/**
 * E2E for: transcript editing, snapshot ↔ transcript linking, live question
 * suggestions, and the Capture moment flow. Runs the real built extension in
 * Chromium's new headless mode (supports extensions; no Xvfb needed).
 * Requires `npm run build` first.
 */

import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');

async function launch(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
}

async function extId(ctx: BrowserContext): Promise<string> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15_000 }));
  const m = sw.url().match(/^chrome-extension:\/\/([^/]+)\//);
  if (!m?.[1]) throw new Error(`No extension id in ${sw.url()}`);
  return m[1];
}

const MEETING = {
  id: 'meet_e2e_1',
  title: 'Roadmap sync',
  startedAt: '2026-03-03T19:00:00.000Z',
  endedAt: '2026-03-03T19:10:00.000Z',
  durationSec: 600,
  participants: [],
  transcript: [
    { id: 'a', start: 60, end: 66, speaker: null, text: 'we will ship the roadmap on frieday' },
    { id: 'b', start: 120, end: 126, speaker: null, text: 'agreed on the budget' },
  ],
  transcriptText: 'we will ship the roadmap on frieday agreed on the budget',
  summary: null, topics: [], decisions: [], actionItems: [], openQuestions: [], commitments: [], project: null,
  audioSource: 'mic', audioMime: null, hasAudio: false, memoryVersion: 1,
  createdAt: '2026-03-03T19:10:00.000Z', updatedAt: '2026-03-03T19:10:00.000Z',
};

async function seed(page: Page): Promise<void> {
  await page.evaluate(async (meeting) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#223355';
    c.fillRect(0, 0, 320, 180);
    c.fillStyle = '#ffffff';
    c.fillText('Q3 roadmap slide', 20, 90);
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.8));
    let db: IDBDatabase | null = null;
    for (let i = 0; i < 40 && !db; i++) {
      const opened: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('meetdolff');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      if (opened.objectStoreNames.contains('snapshots')) db = opened;
      else {
        opened.close();
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!db) throw new Error('snapshots store missing — DB upgrade to v3 did not run');
    const tx = db.transaction(['meetings', 'snapshots'], 'readwrite');
    tx.objectStore('meetings').put(meeting);
    tx.objectStore('snapshots').put({
      id: 'snap_1', meetingId: meeting.id, offsetSec: 63, capturedAt: '2026-03-03T19:01:03.000Z',
      mime: 'image/jpeg', blob, tabTitle: 'Roadmap deck', tabHost: 'slides.example.com',
    });
    await new Promise((res, rej) => {
      tx.oncomplete = () => res(null);
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, MEETING);
}

test.describe('transcript editing + snapshots (dashboard)', () => {
  test('links a snapshot to the nearby segment, edits text, keeps the original, persists across reload', async () => {
    const ctx = await launch();
    try {
      const id = await extId(ctx);
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`chrome-extension://${id}/dashboard.html`);
      await expect(page.locator('body')).toContainText('Meeting memory');
      await seed(page);
      await page.reload();
      await page.getByText('Roadmap sync').first().click();

      const segs = page.locator('.transcript .seg');
      await expect(segs).toHaveCount(2);
      // Snapshot at 01:03 is within 20 s of segment 01:00 only.
      await expect(page.getByRole('button', { name: 'Screen', exact: true })).toHaveCount(1);
      await expect(page.locator('.snap-grid .snap-cell')).toHaveCount(1);
      await page.getByRole('button', { name: 'Screen', exact: true }).click();
      await expect(page.locator('.snap-preview')).toBeVisible();
      await expect(page.locator('.snap-preview figcaption')).toContainText('Roadmap deck');
      // The image really decoded from the stored blob.
      const natural = await page.locator('.snap-preview img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth);
      expect(natural).toBe(320);

      await page.getByRole('button', { name: 'Edit transcript at 01:00' }).click();
      await page.getByLabel('Transcript text at 01:00').fill('we will ship the roadmap on Friday');
      await page.getByLabel('Speaker label').fill('Priya');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(segs.first()).toContainText('Priya: we will ship the roadmap on Friday');
      await expect(segs.first().locator('.tag')).toHaveText('edited');
      await expect(segs.first().locator('.tag')).toHaveAttribute('title', /Original: we will ship the roadmap on frieday/);
      await expect(page.locator('.edit-note')).toContainText('1 corrected segment');

      // Persisted to IndexedDB, and searchable text rebuilt.
      await page.reload();
      await page.getByText('Roadmap sync').first().click();
      await expect(page.locator('.transcript .seg').first()).toContainText('on Friday');
      await expect(page.locator('.transcript .seg').first().locator('.tag')).toHaveText('edited');
      await page.getByPlaceholder(/search/i).first().fill('Friday');
      await expect(page.getByText('Roadmap sync').first()).toBeVisible();

      // Empty text is rejected and surfaced, not silently dropped.
      await page.getByRole('button', { name: 'Edit transcript at 02:00' }).click();
      await page.getByLabel('Transcript text at 02:00').fill('   ');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('cannot be empty');
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('live question suggestions (side panel)', () => {
  test('shows rule-based questions for live segments, dismisses, and keeps AI opt-in off by default', async () => {
    const ctx = await launch();
    try {
      const id = await extId(ctx);
      const panel = await ctx.newPage();
      const errors: string[] = [];
      panel.on('pageerror', (e) => errors.push(e.message));
      await panel.goto(`chrome-extension://${id}/sidepanel.html`);
      await expect(panel.locator('#liveHeading')).toBeVisible();
      await expect(panel.locator('#useAiSuggestions')).not.toBeChecked();
      await expect(panel.locator('#liveQuestions')).toContainText('Suggestions appear while you record');

      const sender = await ctx.newPage();
      await sender.goto(`chrome-extension://${id}/popup.html`);
      await sender.evaluate(async () => {
        const send = (segment: object) => chrome.runtime.sendMessage({ type: 'LIVE_SEGMENT', sessionId: 'sess_e2e', segment });
        await send({ id: 'ws_0', start: 0, end: 5, text: 'Hello everyone, thanks for joining today.' });
        await send({ id: 'ws_1', start: 5, end: 12, text: 'The new onboarding flow needs to launch soon.' });
        await send({ id: 'ws_2', start: 12, end: 20, text: 'Someone should talk to design about the mockups.' });
      });
      const items = panel.locator('.live-q');
      await expect(items).toHaveCount(2);
      await expect(panel.locator('#liveQuestions')).toContainText('what is the exact date');
      await expect(panel.locator('#liveQuestions')).toContainText('who specifically owns this');
      await expect(panel.locator('#liveStatus')).toContainText('3 live segments');

      await items.first().getByRole('button', { name: 'Dismiss' }).click();
      await expect(items).toHaveCount(1);

      // Toggle persists in chrome.storage.local.
      await panel.locator('#useAiSuggestions').check();
      await expect(panel.locator('#liveStatus')).toContainText('recent transcript text is sent');
      await panel.reload();
      await expect(panel.locator('#useAiSuggestions')).toBeChecked();
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('Capture moment', () => {
  test('refuses when idle, and during a fake-mic recording either stores a linked snapshot or explains the activeTab limit', async () => {
    const ctx = await launch();
    try {
      const id = await extId(ctx);
      const panel = await ctx.newPage();
      await panel.goto(`chrome-extension://${id}/sidepanel.html`);
      await panel.locator('#btnSnapshot').click();
      await expect(panel.locator('#snapshotStatus')).toContainText('Start a recording');

      const popup = await ctx.newPage();
      await popup.goto(`chrome-extension://${id}/popup.html`);
      await popup.locator('#btnStartMic').click();
      await expect(popup.locator('#statusText')).toHaveText('Recording', { timeout: 10_000 });
      await popup.waitForTimeout(1_200);

      await panel.bringToFront();
      await panel.locator('#btnSnapshot').click();
      const status = panel.locator('#snapshotStatus');
      await expect(status).toContainText(/Captured screen at|toolbar icon on the meeting tab|Cannot access|No active tab/, { timeout: 10_000 });
      const text = (await status.textContent()) ?? '';
      console.log(`[capture-moment] outcome: ${text}`);

      await popup.bringToFront();
      await popup.locator('#btnStop').click();
      await expect(popup.locator('#statusText')).toHaveText('Saved', { timeout: 10_000 });
      if (/Captured screen at/.test(text)) {
        // Snapshots were re-keyed from the recording session to the saved meeting.
        const dash = await ctx.newPage();
        await dash.goto(`chrome-extension://${id}/dashboard.html`);
        await dash.locator('#meetingList .row').first().click();
        await expect(dash.locator('.snap-grid .snap-cell')).toHaveCount(1, { timeout: 10_000 });
      }
    } finally {
      await ctx.close();
    }
  });
});
