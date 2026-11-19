/**
 * Real-extension checks for temporal recall, transcript correction and live
 * question suggestions. Runs in Playwright's bundled Chromium (new headless
 * mode supports MV3 extensions), so no display server is needed.
 *
 * The AI endpoint is intercepted at the network layer; every other piece
 * (IndexedDB, extension messaging, DOM) is the real built extension in dist/.
 */

import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');

async function launch(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-sandbox'],
  });
}

async function extId(ctx: BrowserContext): Promise<string> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15_000 }));
  return /^chrome-extension:\/\/([^/]+)\//.exec(sw.url())![1]!;
}

/** The most recent given weekday strictly before today, at the given local time. */
function lastWeekday(weekday: number, hour: number, minute = 0): Date {
  const now = new Date();
  const back = ((now.getDay() - weekday + 7) % 7) || 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hour, minute);
}

function meetingRecord(id: string, title: string, start: Date, text: string) {
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    id, title, startedAt: start.toISOString(), endedAt: end.toISOString(), durationSec: 1800, participants: [],
    transcript: [
      { id: `${id}_1`, start: 0, end: 6, speaker: 'Speaker 1', text },
      { id: `${id}_2`, start: 6, end: 12, speaker: 'Speaker 2', text: 'agreed, ship it' },
    ],
    transcriptText: `${text} agreed, ship it`, summary: 'A short sync.', topics: [], decisions: [], actionItems: [],
    openQuestions: [], commitments: [], project: null, audioSource: 'mic', audioMime: null, hasAudio: false,
    memoryVersion: 1, createdAt: start.toISOString(), updatedAt: start.toISOString(),
  };
}

/** Opens the dashboard once (creating the DB) then writes records straight into IndexedDB. */
async function seed(ctx: BrowserContext, id: string, records: unknown[]): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/dashboard.html`);
  await expect(page.locator('body')).toContainText('Meeting memory');
  await page.evaluate(
    (recs) =>
      new Promise<void>((resolveDb, reject) => {
        const open = indexedDB.open('meetdolff');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('meetings', 'readwrite');
          for (const r of recs as object[]) tx.objectStore('meetings').put(r);
          tx.oncomplete = () => resolveDb();
          tx.onerror = () => reject(tx.error);
        };
      }),
    records,
  );
  await page.reload();
  return page;
}

test.describe('temporal recall, transcript correction, live questions', () => {
  test('dashboard: correct a transcript segment, persist it, restore it', async () => {
    const ctx = await launch();
    try {
      const id = await extId(ctx);
      const page = await seed(ctx, id, [meetingRecord('m1', 'Frontend sync', lastWeekday(2, 19), 'we picked weed for the build')]);
      await page.locator('#meetingList .row').first().click();
      await expect(page.locator('#detailBox .transcript')).toContainText('we picked weed for the build');

      await page.getByRole('button', { name: /Edit transcript at \[00:00\]/ }).click();
      await page.getByLabel(/Correct transcript at \[00:00\]/).fill('we picked Vite for the build');
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      await expect(page.locator('#detailBox .transcript')).toContainText('we picked Vite for the build');
      await expect(page.locator('#detailBox .transcript .edited')).toHaveText('edited');
      await expect(page.locator('#detailBox .stale-note')).toBeVisible();

      // Survives a full reload (it was written to IndexedDB, not just the DOM).
      await page.reload();
      await page.locator('#meetingList .row').first().click();
      await expect(page.locator('#detailBox .transcript')).toContainText('we picked Vite for the build');

      await page.getByRole('button', { name: /Edit transcript at \[00:00\]/ }).click();
      await page.getByRole('button', { name: 'Restore original' }).click();
      await expect(page.locator('#detailBox .transcript')).toContainText('we picked weed for the build');
      await expect(page.locator('#detailBox .transcript .edited')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('side panel: "last Tuesday at 7 PM" sends only that meeting to the model', async () => {
    const ctx = await launch();
    try {
      const id = await extId(ctx);
      let sentPrompt = '';
      let calls = 0;
      await ctx.route('https://api.example.test/**', async (route) => {
        calls += 1;
        sentPrompt = route.request().postData() ?? '';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
          body: JSON.stringify({ choices: [{ message: { content: 'You chose Vite. [Frontend sync, 00:00]' } }] }),
        });
      });
      const dash = await seed(ctx, id, [
        meetingRecord('tue7', 'Frontend sync', lastWeekday(2, 19), 'we picked Vite for the build'),
        meetingRecord('wed10', 'Database review', lastWeekday(3, 10), 'postgres indexes are slow'),
      ]);
      await dash.evaluate(() =>
        chrome.storage.local.set({
          providerSettings: { aiProvider: 'openai', baseUrl: 'https://api.example.test/v1', chatModel: 'test', transcriptionModel: 'w', apiKey: 'test-key-not-real', searchProvider: 'none', searchApiKey: '', transcriptionProvider: 'web-speech' },
        }),
      );

      const panel = await ctx.newPage();
      await panel.goto(`chrome-extension://${id}/sidepanel.html`);
      await panel.locator('#chatInput').fill('What happened last Tuesday at 7 PM?');
      await panel.locator('#btnAsk').click();
      await expect(panel.locator('#chatLog')).toContainText('You chose Vite');
      expect(calls).toBe(1);
      expect(sentPrompt).toContain('Frontend sync');
      expect(sentPrompt).toContain('we picked Vite for the build');
      expect(sentPrompt).not.toContain('postgres indexes are slow');
      await expect(panel.locator('#chatLog .src').last()).toContainText('Time:');

      // A time with no meeting is answered deterministically: the model is never called.
      await panel.locator('#chatInput').fill('what happened last tuesday at 3am?');
      await panel.locator('#btnAsk').click();
      await expect(panel.locator('#chatLog')).toContainText('No meeting in memory matches');
      await expect(panel.locator('#chatLog')).toContainText('Frontend sync');
      expect(calls).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  test('side panel: live finalized speech produces dismissible question suggestions', async () => {
    const ctx = await launch();
    try {
      const id = await extId(ctx);
      const panel = await ctx.newPage();
      await panel.goto(`chrome-extension://${id}/sidepanel.html`);
      await expect(panel.locator('#liveQuestions')).toBeHidden();

      // Another extension page plays the offscreen recorder's role.
      const other = await ctx.newPage();
      await other.goto(`chrome-extension://${id}/settings.html`);
      await other.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'TRANSCRIPTION_FINAL', sessionId: 's1', text: 'We need to migrate the database.', at: 5 }),
      );

      await expect(panel.locator('#liveQuestions')).toBeVisible();
      await expect(panel.locator('#liveQuestionList')).toContainText('Who will own');
      await expect(panel.locator('#liveQuestionList')).toContainText('A commitment was stated without a named owner.');

      await panel.getByRole('button', { name: /Dismiss suggestion: Who will own/ }).click();
      await expect(panel.locator('#liveQuestionList')).not.toContainText('Who will own');
      await expect(panel.locator('#liveQuestionList')).toContainText('need to be done');
    } finally {
      await ctx.close();
    }
  });
});
