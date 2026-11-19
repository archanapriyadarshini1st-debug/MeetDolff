/**
 * Real-browser tests for transcript editing, re-summarize and question suggestions.
 * Data is seeded straight into the extension's own IndexedDB (deterministic fixtures,
 * no microphone, no network). Provider traffic is intercepted with Playwright routes.
 */

import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');

async function extensionContext(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    ...(process.env.PW_HEADED ? { headless: false } : { channel: 'chromium' as const, headless: true }),
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--disable-gpu', '--no-sandbox'],
  });
}

async function extensionId(context: BrowserContext): Promise<string> {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const m = sw.url().match(/^chrome-extension:\/\/([^/]+)\//);
  if (!m?.[1]) throw new Error(`no extension id in ${sw.url()}`);
  return m[1];
}

const meeting = (over: Record<string, unknown> = {}) => ({
  id: 'e2e-meeting-1', title: 'Database performance review', startedAt: '2026-11-17T19:00:00.000Z', endedAt: '2026-11-17T19:30:00.000Z',
  durationSec: 1800, participants: [], transcript: [
    { id: 's1', start: 3, end: 9, speaker: null, text: 'We should migrate the postgress database', confidence: 0.55 },
    { id: 's2', start: 75, end: 90, speaker: null, text: 'The vendor delay is a blocker for launch' },
  ],
  transcriptText: 'We should migrate the postgress database The vendor delay is a blocker for launch',
  summary: 'Team discussed migrating the database.', topics: ['database'], decisions: [{ text: 'Migrate to Postgres', evidence: ['[00:03]'] }],
  actionItems: [{ text: 'Write the migration guide', owner: null, deadline: null, evidence: [] }],
  openQuestions: ['Who pays for managed hosting?'], commitments: [], project: null, audioSource: 'mic', audioMime: null, hasAudio: false,
  memoryVersion: 1, createdAt: '2026-11-17T19:30:00.000Z', updatedAt: '2026-11-17T19:30:00.000Z', ...over,
});

async function seed(page: Page, m: unknown): Promise<void> {
  await page.evaluate(
    (rec) =>
      new Promise<void>((res, rej) => {
        const open = indexedDB.open('meetdolff', 2);
        open.onerror = () => rej(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('meetings', 'readwrite');
          tx.objectStore('meetings').put(rec);
          tx.oncomplete = () => { open.result.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
      }),
    m,
  );
}

async function readMeeting(page: Page, id: string): Promise<any> {
  return page.evaluate(
    (key) =>
      new Promise((res, rej) => {
        const open = indexedDB.open('meetdolff', 2);
        open.onerror = () => rej(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('meetings').objectStore('meetings').get(key);
          get.onsuccess = () => { open.result.close(); res(get.result); };
          get.onerror = () => rej(get.error);
        };
      }),
    id,
  );
}

async function openDashboardWithMeeting(context: BrowserContext, id: string, m: unknown): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/dashboard.html`); // creates the DB schema
  await seed(page, m);
  await page.reload();
  await page.locator('#meetingList .row').first().click();
  await expect(page.locator('#detailBox h3')).toContainText('Database performance review');
  return page;
}

test.describe('transcript editing', () => {
  test('edit persists with original kept, flags stale summary, reverts, and survives reload', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await openDashboardWithMeeting(context, id, meeting());
      await expect(page.locator('.stale-banner')).toBeHidden();

      await page.getByRole('button', { name: 'Edit transcript text at [00:03]' }).click();
      const box = page.getByRole('textbox', { name: 'Edit transcript text at [00:03]' });
      await box.fill('We should migrate the Postgres database');
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      await expect(page.locator('.seg-edited')).toContainText('Postgres database');
      await expect(page.locator('.seg-original')).toContainText('Originally: We should migrate the postgress database');
      await expect(page.locator('.stale-banner')).toBeVisible();
      await expect(page.locator('.stale-banner')).toContainText('Re-summarize');

      const saved = await readMeeting(page, 'e2e-meeting-1');
      expect(saved.transcript[0]).toMatchObject({ text: 'We should migrate the Postgres database', edited: true, originalText: 'We should migrate the postgress database' });
      expect(saved.transcriptText).toContain('Postgres database The vendor');
      expect(saved.summaryStale).toBe(true);

      await page.reload();
      await page.locator('#meetingList .row').first().click();
      await expect(page.locator('.seg-edited')).toContainText('Postgres database');
      await expect(page.locator('.stale-banner')).toBeVisible();

      await page.getByRole('button', { name: 'Revert edit at [00:03]' }).click();
      await expect(page.locator('.seg-edited')).toHaveCount(0);
      expect((await readMeeting(page, 'e2e-meeting-1')).transcript[0].text).toBe('We should migrate the postgress database');
    } finally {
      await context.close();
    }
  });

  test('empty edits are rejected with a visible error and nothing is saved', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await openDashboardWithMeeting(context, id, meeting());
      await page.getByRole('button', { name: 'Edit transcript text at [00:03]' }).click();
      await page.getByRole('textbox', { name: 'Edit transcript text at [00:03]' }).fill('   ');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.locator('#errorBox')).toContainText('cannot be empty');
      expect((await readMeeting(page, 'e2e-meeting-1')).transcript[0].edited).toBeUndefined();
    } finally {
      await context.close();
    }
  });

  test('assigning a speaker name updates segments and participants', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await openDashboardWithMeeting(context, id, meeting());
      await page.getByRole('textbox', { name: 'New speaker name' }).fill('Dana');
      await page.getByRole('button', { name: 'Apply name' }).click();
      await expect(page.locator('.spk').first()).toHaveText('Dana:');
      const saved = await readMeeting(page, 'e2e-meeting-1');
      expect(saved.transcript.every((s: any) => s.speaker === 'Dana')).toBe(true);
      expect(saved.participants).toEqual(['Dana']);
    } finally {
      await context.close();
    }
  });

  test('re-summarize sends the EDITED transcript to the provider and clears the stale flag', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      let sentBody = '';
      await context.route('https://fake-provider.test/**', async (route) => {
        sentBody = route.request().postData() ?? '';
        await route.fulfill({
          status: 200,
          headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'fake', choices: [{ message: { content: JSON.stringify({ summary: 'Migrate Postgres after vendor delay clears.', topics: ['database'], decisions: [], actionItems: [], openQuestions: [], commitments: [] }) } }] }),
        });
      });
      const page = await openDashboardWithMeeting(context, id, meeting());
      await page.evaluate(() => chrome.storage.local.set({ providerSettings: { aiProvider: 'openai', baseUrl: 'https://fake-provider.test/v1', apiKey: 'test-only-key', chatModel: 'fake' } }));
      await page.getByRole('button', { name: 'Edit transcript text at [00:03]' }).click();
      await page.getByRole('textbox', { name: 'Edit transcript text at [00:03]' }).fill('We should migrate the Postgres database');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.locator('.stale-banner')).toBeVisible();

      await page.getByRole('button', { name: 'Re-summarize' }).click();
      await expect(page.locator('#errorBox')).toContainText('refreshed', { timeout: 10_000 });
      expect(sentBody).toContain('Postgres database');
      expect(sentBody).not.toContain('postgress');
      await expect(page.locator('.stale-banner')).toBeHidden();
      const saved = await readMeeting(page, 'e2e-meeting-1');
      expect(saved.summary).toBe('Migrate Postgres after vendor delay clears.');
      expect(saved.summaryStale).toBe(false);
      expect(saved.transcript[0].edited).toBe(true); // user edits survive re-summarizing
    } finally {
      await context.close();
    }
  });

  test('provider failure (invalid key) is shown and leaves the meeting untouched', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      await context.route('https://fake-provider.test/**', (route) =>
        route.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"error":{"message":"Incorrect API key"}}' }));
      const page = await openDashboardWithMeeting(context, id, meeting());
      await page.evaluate(() => chrome.storage.local.set({ providerSettings: { aiProvider: 'openai', baseUrl: 'https://fake-provider.test/v1', apiKey: 'bad', chatModel: 'fake' } }));
      await page.getByRole('button', { name: 'Re-summarize' }).click();
      await expect(page.locator('#errorBox .error')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: 'Re-summarize' })).toBeEnabled();
      expect((await readMeeting(page, 'e2e-meeting-1')).summary).toBe('Team discussed migrating the database.');
    } finally {
      await context.close();
    }
  });
});

test.describe('question suggestions', () => {
  test('pasted conversation yields grounded, dismissible questions; memory follow-ups come from saved meetings; AI is opt-in', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const boot = await context.newPage();
      await boot.goto(`chrome-extension://${id}/dashboard.html`);
      await seed(boot, meeting());
      await boot.close();

      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`chrome-extension://${id}/sidepanel.html`);

      await expect(page.locator('#sugUseAi')).not.toBeChecked();
      await expect(page.locator('#sugList')).toContainText('Who pays for managed hosting?'); // carry-over from memory
      await expect(page.locator('#sugList')).toContainText('(from memory)');

      await page.getByText('Paste what was just said').click();
      await page.locator('#sugManual').fill('So we should rewrite the billing service soon. We decided to go with Stripe.');
      await page.locator('#sugRun').click();
      await expect(page.locator('#sugList')).toContainText('Who owns this');
      await expect(page.locator('#sugList')).toContainText('concrete deadline');
      await expect(page.locator('#sugList')).toContainText('reasoning behind this decision');
      await expect(page.locator('.sug-ev', { hasText: 'We decided to go with Stripe' })).toHaveCount(1);

      const before = await page.locator('.sug').count();
      await page.getByRole('button', { name: /^Dismiss suggestion: Who owns this/ }).click();
      await expect(page.locator('.sug')).toHaveCount(before - 1);
      await expect(page.locator('#sugList')).not.toContainText('Who owns this');

      await page.locator('#sugClear').click();
      await expect(page.locator('#sugList')).not.toContainText('reasoning behind this decision');
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
