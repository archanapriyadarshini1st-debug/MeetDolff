/**
 * Playwright e2e: real Chrome for Testing + unpacked MV3 extension.
 * Requires `npm run build` first (dist/ must exist).
 * Recording capture is intentionally covered by a manual checklist in TESTING.md:
 * tabCapture requires a real user gesture and an audible tab.
 */

import { test, expect, chromium } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');

async function extensionContext() {
  return chromium.launchPersistentContext('', {
    // Chromium disables extension loading in its headless shell; run via xvfb for real Chrome.
    headless: false,
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
      const stored = await page.evaluate(async () => chrome.storage.local.get('providerSettings'));
      expect(stored.providerSettings.baseUrl).toBe('http://localhost:11434/v1');
      expect(stored.providerSettings.chatModel).toBe('llama3.2');
      expect(stored.providerSettings.apiKey).toBe('test-only-key-not-a-real-secret');
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
