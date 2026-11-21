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
      // One control for the source, one action to start it.
      await page.locator('#sourceGroup button[data-source="mic"]').click();
      await expect(page.locator('#sourceGroup button[data-source="mic"]')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('#btnStart').click();
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
      await page.locator('#meetingList .row', { hasText: 'E2E seeded meeting' }).click();
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

  /* ------------------------------------------------------------------ v0.2 regression suite */

  /** Seeds meetings into the extension's IndexedDB and reloads the page. */
  async function seedMeetings(page: import('@playwright/test').Page, rows: unknown[]): Promise<void> {
    await page.evaluate(
      (items) =>
        new Promise<void>((resolveSeed, reject) => {
          const open = indexedDB.open('meetdolff');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(['meetings', 'calendar'], 'readwrite');
            tx.objectStore('meetings').clear();
            tx.objectStore('calendar').clear();
            for (const m of items as object[]) tx.objectStore('meetings').put(m);
            tx.oncomplete = () => resolveSeed();
            tx.onerror = () => reject(tx.error);
          };
        }),
      rows,
    );
    await page.reload();
  }

  const meeting = (over: Record<string, unknown>) => ({
    id: 'm1',
    title: 'Untitled meeting',
    startedAt: '2026-11-19T14:00:00.000Z',
    endedAt: '2026-11-19T14:41:00.000Z',
    durationSec: 2460,
    participants: [],
    transcript: [{ id: 's1', start: 4, end: 9, speaker: null, text: 'we hold hiring at two engineers' }],
    transcriptText: 'we hold hiring at two engineers',
    summary: 'Runway extends to 18 months if hiring stays at two engineers.',
    topics: [],
    decisions: [{ text: 'Hold hiring at two engineers', evidence: ['s1'] }],
    actionItems: [{ text: 'Send runway model', owner: 'Archana', deadline: 'Thursday', evidence: ['s1'] }],
    openQuestions: [],
    commitments: [],
    project: null,
    audioSource: 'tab',
    audioMime: null,
    hasAudio: false,
    memoryVersion: 1,
    createdAt: '2026-11-19T14:41:00.000Z',
    updatedAt: '2026-11-19T14:41:00.000Z',
    ...over,
  });

  test('first run shows a setup checklist instead of "no meetings match"', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/dashboard.html`);
      await seedMeetings(page, []);

      const onboarding = page.locator('#onboarding');
      await expect(onboarding).toBeVisible();
      await expect(onboarding).toContainText('Get to your first answer');
      // Steps are individually marked, so progress is legible.
      await expect(page.locator('#checklist li[data-step="key"]')).toHaveAttribute('data-done', 'false');
      await expect(page.locator('#checklist li[data-step="record"]')).toHaveAttribute('data-done', 'false');
      await expect(page.locator('#meetingList')).not.toContainText('No meetings match');
      await expect(page.locator('#hero')).toBeHidden();
      // An empty state is a message, not a list — role="list" with no list items fails WCAG.
      await expect(page.locator('#meetingList')).not.toHaveAttribute('role', 'list');

      await seedMeetings(page, [meeting({ id: 'first', title: 'First recorded meeting' })]);
      await expect(page.locator('#meetingList')).toHaveAttribute('role', 'list');
      await expect(page.locator('#onboarding')).toBeHidden();
      await expect(page.locator('#hero')).toBeVisible();
      await expect(page.locator('#hero')).toContainText('First recorded meeting');
      await page.close();
    } finally {
      await context.close();
    }
  });

  test('calendar follow-ups name their colour the way a user sees it, not the design token', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/dashboard.html`);
      await seedMeetings(page, [meeting({ id: 'cal-1', title: 'Northline follow-up' })]);
      await page.evaluate(
        () =>
          new Promise<void>((resolveSeed, reject) => {
            const open = indexedDB.open('meetdolff');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const tx = open.result.transaction(['calendar'], 'readwrite');
              tx.objectStore('calendar').clear();
              tx.objectStore('calendar').put({
                id: 'e1',
                title: 'Northline follow-up',
                startsAt: '2026-11-24T09:30:00.000Z',
                endsAt: '2026-11-24T10:00:00.000Z',
                color: 'accent',
                notes: '',
                meetingId: 'cal-1',
                createdAt: '2026-11-21T09:00:00.000Z',
                updatedAt: '2026-11-21T09:00:00.000Z',
              });
              tx.oncomplete = () => resolveSeed();
              tx.onerror = () => reject(tx.error);
            };
          }),
      );
      await page.reload();
      const meta = page.locator('#calendarList .row-meta');
      await expect(meta).toContainText('White');
      // The colour picker must not leak token names either.
      await expect(page.locator('#calColor option[value="accent"]')).toHaveText('White');
      for (const token of ['Accent', 'Ink', 'Paper', 'Muted']) {
        await expect(meta).not.toContainText(token);
      }
      await page.close();
    } finally {
      await context.close();
    }
  });

  test('durations and plurals are humanized — no raw seconds, no "1 decisions"', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/dashboard.html`);
      await seedMeetings(page, [meeting({ id: 'fmt', title: 'Formatting check' })]);

      const row = page.locator('#meetingList .row').first();
      await expect(row).toContainText('41 min');
      await expect(row).toContainText('1 decision');
      await expect(row).toContainText('1 action item');
      await expect(row).not.toContainText('2460s');
      await expect(row).not.toContainText('1 decisions');
      await expect(row).not.toContainText('1 segment'); // segment counts are not user-facing
      // Header stats are pluralized too.
      await expect(page.locator('#memoryStat')).toContainText('1 meeting');
      await page.close();
    } finally {
      await context.close();
    }
  });

  test('selecting a meeting is visible, switches the detail pane, and reveals it on narrow screens', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/dashboard.html`);
      await seedMeetings(page, [
        meeting({ id: 'a', title: 'Alpha review' }),
        meeting({ id: 'b', title: 'Beta review', startedAt: '2026-11-18T14:00:00.000Z' }),
      ]);

      const rows = page.locator('#meetingList .row');
      await expect(rows).toHaveCount(2);
      await rows.first().click();
      await expect(rows.first()).toHaveAttribute('aria-current', 'true');
      await expect(rows.nth(1)).toHaveAttribute('aria-current', 'false');
      await expect(page.locator('#detailBox .detail__title')).toHaveText('Alpha review');
      await expect(page.locator('#detailBox')).toContainText('Hold hiring at two engineers');
      await expect(page.locator('#detailPanel')).toHaveAttribute('data-idle', 'false');

      await rows.nth(1).click();
      await expect(page.locator('#detailBox .detail__title')).toHaveText('Beta review');
      await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
      await expect(rows.first()).toHaveAttribute('aria-current', 'false');

      // Below the split breakpoint the detail pane must not sit hidden below an empty slot.
      await page.setViewportSize({ width: 600, height: 900 });
      await page.locator('#detailBox button[aria-label="Close meeting detail"]').click();
      await expect(page.locator('#detailPanel')).toBeHidden();
      await page.close();
    } finally {
      await context.close();
    }
  });

  test('side panel acts on the selected meeting, not silently on the newest one', async () => {
    const prompts: string[] = [];
    const fake: Server = createServer((req, res) => {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', '*');
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        prompts.push(body);
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: 'Summarized from the targeted meeting.',
                    topics: ['targeting'],
                    decisions: [],
                    actionItems: [],
                    openQuestions: [],
                    commitments: [],
                  }),
                },
              },
            ],
          }),
        );
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
      await seedMeetings(page, [
        meeting({ id: 'newer', title: 'Newer meeting', summary: null, transcriptText: 'we discussed the newer topic' }),
        meeting({
          id: 'older',
          title: 'Older meeting',
          summary: null,
          startedAt: '2026-11-10T14:00:00.000Z',
          transcriptText: 'we discussed the older topic',
        }),
      ]);

      const target = page.locator('#targetMeeting');
      await expect(target).toHaveValue('newer'); // defaults to newest, visibly
      await expect(target.locator('option')).toHaveCount(2);

      // Explicitly target the OLDER meeting and summarize.
      await target.selectOption('older');
      await expect(page.locator('#targetMeta')).toContainText('not summarized');
      await page.locator('#btnSummarize').click();
      await expect(page.locator('#artifactBox')).toContainText('Older meeting');

      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain('older topic');
      expect(prompts[0]).not.toContain('newer topic');

      // ...and only the targeted meeting changed.
      const stored = await page.evaluate(
        () =>
          new Promise<Record<string, string | null>>((resolveRead, reject) => {
            const open = indexedDB.open('meetdolff');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const q = open.result.transaction('meetings').objectStore('meetings').getAll();
              q.onsuccess = () =>
                resolveRead(
                  Object.fromEntries((q.result as { id: string; summary: string | null }[]).map((m) => [m.id, m.summary])),
                );
            };
          }),
      );
      expect(stored['older']).toBe('Summarized from the targeted meeting.');
      expect(stored['newer']).toBeNull();
      await page.close();
    } finally {
      await context.close();
      fake.close();
    }
  });

  test('popup names the tab it will capture and asks for one decision only', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/popup.html`);
      // Consent is explicit: the popup resolves the active tab instead of leaving "Checking…".
      await expect(page.locator('#tabLabel')).not.toHaveText('Checking the active tab…', { timeout: 10_000 });
      // One start control; the source is a segmented preference, not a second button.
      await expect(page.locator('#btnStart')).toHaveCount(1);
      await expect(page.locator('#btnStartMic')).toHaveCount(0);
      await expect(page.locator('#sourceGroup button')).toHaveCount(3);
      await expect(page.locator('#sourceHint')).toContainText('meeting tab');
      // Developer-facing doc references must not leak into the recorder UI.
      await expect(page.locator('body')).not.toContainText('ARCHITECTURE.md');
      await page.close();
    } finally {
      await context.close();
    }
  });

  /* ------------------------------------------------------- v0.3 notes-first capture */

  test('notes typed during a recording are attached to the meeting that recording produces', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup.html`);
      await popup.locator('#sourceGroup button[data-source="mic"]').click();
      await popup.locator('#btnStart').click();
      await expect(popup.locator('#statusText')).toHaveText('Recording', { timeout: 10_000 });

      // The panel is opened mid-call and immediately enters live-notes mode.
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${id}/sidepanel.html`);
      await expect(panel.locator('#notesState')).toHaveText('Recording', { timeout: 10_000 });
      await expect(panel.locator('#notesInput')).toBeEnabled();
      await panel.locator('#notesInput').fill('drop-off 40% at step 3\nMeera ships skippable calendar');
      await panel.waitForTimeout(900); // past the autosave debounce

      const live = await panel.evaluate(
        () =>
          new Promise<{ sessionId: string; text: string } | null>((r) => {
            chrome.storage.local.get('liveNotes').then((v) => r((v['liveNotes'] as never) ?? null));
          }),
      );
      expect(live?.text).toContain('drop-off 40%');

      await popup.waitForTimeout(1_200);
      await popup.locator('#btnStop').click();
      await expect(popup.locator('#statusText')).toHaveText('Saved', { timeout: 15_000 });
      await popup.waitForTimeout(2_000);

      const saved = await panel.evaluate(
        () =>
          new Promise<{ notes: string; id: string }[]>((resolveRead, reject) => {
            const open = indexedDB.open('meetdolff');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const q = open.result.transaction('meetings').objectStore('meetings').getAll();
              q.onsuccess = () => resolveRead(q.result as { notes: string; id: string }[]);
            };
          }),
      );
      expect(saved).toHaveLength(1);
      expect(saved[0]!.notes).toBe('drop-off 40% at step 3\nMeera ships skippable calendar');

      // The draft slot is consumed, so the next recording starts clean.
      const leftover = await panel.evaluate(
        () => new Promise((r) => chrome.storage.local.get('liveNotes').then((v) => r(v['liveNotes'] ?? null))),
      );
      expect(leftover).toBeNull();

      // ...and the panel now edits the saved meeting instead of a draft.
      await expect(panel.locator('#notesInput')).toHaveValue(/drop-off 40%/);
      await expect(panel.locator('#notesState')).not.toHaveText('Recording');
      await panel.close();
      await popup.close();
    } finally {
      await context.close();
    }
  });

  test('merging notes rewrites them against the transcript and keeps the originals', async () => {
    const prompts: string[] = [];
    const merged = '## Onboarding\n- Drop-off is 40% at step three\n- Meera ships skippable calendar next Tuesday\n\n### From the transcript\n- Measured over two weeks\n';
    const fake: Server = createServer((req, res) => {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', '*');
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        prompts.push(body);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: merged } }] }));
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
      await seedMeetings(page, [
        meeting({
          id: 'onboard',
          title: 'Weekly product review',
          summary: null,
          transcriptText: 'the drop-off is still forty percent at step three and we ship skippable calendar next tuesday, measured over two weeks',
          notes: 'drop-off 40% at step 3\nmeera ships skippable cal',
        }),
      ]);

      await expect(page.locator('#notesInput')).toHaveValue(/drop-off 40%/);
      const merge = page.locator('#btnMergeNotes');
      await expect(merge).toBeEnabled();
      await merge.click();

      await expect(page.locator('#notesOut')).toContainText('From the transcript');
      await expect(page.locator('#notesOut')).toContainText('Drop-off is 40% at step three');
      await expect(page.locator('#notesOut')).toContainText('merged with the transcript');
      // The user's own words are never lost.
      await page.locator('#btnShowRaw').click();
      await expect(page.locator('#notesOut')).toContainText('meera ships skippable cal');

      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain('meera ships skippable cal'); // notes go in
      expect(prompts[0]).toContain('forty percent at step three'); // so does the transcript

      const stored = await page.evaluate(
        () =>
          new Promise<{ notes: string; notesEnhanced: string; notesStale: boolean }>((resolveRead, reject) => {
            const open = indexedDB.open('meetdolff');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const q = open.result.transaction('meetings').objectStore('meetings').get('onboard');
              q.onsuccess = () => resolveRead(q.result);
            };
          }),
      );
      expect(stored.notesEnhanced).toContain('From the transcript');
      expect(stored.notes).toBe('drop-off 40% at step 3\nmeera ships skippable cal');
      expect(stored.notesStale).toBe(false);

      // Editing the notes afterwards marks the merge as out of date rather than silently stale.
      await page.locator('#notesInput').fill('drop-off 35% at step 3');
      await page.waitForTimeout(900);
      await expect(page.locator('#notesOut')).toContainText('out of date');
      await page.close();
    } finally {
      await context.close();
      fake.close();
    }
  });

  test('a project plan must be readable before it can be approved', async () => {
    const context = await extensionContext();
    try {
      const id = await extensionId(context);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/dashboard.html`);
      await seedMeetings(page, [meeting({ id: 'plan-1', title: 'Kickoff' })]);
      await page.evaluate(
        () =>
          new Promise<void>((resolveSeed, reject) => {
            const open = indexedDB.open('meetdolff');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const tx = open.result.transaction('projects', 'readwrite');
              tx.objectStore('projects').put({
                id: 'proj-1',
                meetingId: 'plan-1',
                title: 'Skippable onboarding calendar',
                objectives: ['Cut step-three drop-off'],
                tasks: [{ text: 'Make calendar skippable', owner: 'Meera', deadline: 'next Tuesday' }],
                milestones: [{ text: 'Ship to 50%', date: '2026-11-25' }],
                dependencies: ['Analytics events'],
                risks: ['Users never connect a calendar'],
                approved: false,
                createdAt: '2026-11-19T14:00:00.000Z',
              });
              tx.oncomplete = () => resolveSeed();
              tx.onerror = () => reject(tx.error);
            };
          }),
      );
      await page.reload();
      await page.locator('#meetingList .row').first().click();

      const plan = page.locator('#projectList details').first();
      await expect(plan).toContainText('Skippable onboarding calendar');
      await expect(plan).toContainText('Pending approval');
      // Collapsed by default, but the content exists and is reachable.
      await plan.locator('summary').click();
      await expect(plan).toContainText('Cut step-three drop-off');
      await expect(plan).toContainText('Make calendar skippable');
      await expect(plan).toContainText('Meera');
      await expect(plan).toContainText('Users never connect a calendar');

      await plan.getByRole('button', { name: 'Approve this plan' }).click();
      await expect(page.locator('#projectList details').first()).toContainText('Approved');
      const approved = await page.evaluate(
        () =>
          new Promise<boolean>((resolveRead, reject) => {
            const open = indexedDB.open('meetdolff');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const q = open.result.transaction('projects').objectStore('projects').get('proj-1');
              q.onsuccess = () => resolveRead(Boolean(q.result?.approved));
            };
          }),
      );
      expect(approved).toBe(true);
      await page.close();
    } finally {
      await context.close();
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
