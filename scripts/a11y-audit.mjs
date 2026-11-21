/**
 * Accessibility + structural audit of every extension surface.
 * Loads the unpacked build, seeds memory, and runs axe-core (WCAG 2.1 A/AA)
 * plus our own structural checks (duplicate ids, unnamed controls, heading order).
 *
 * Run: node scripts/a11y-audit.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');
const AXE = readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
const OUT = resolve('audit-shots');
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const iso = (ago) => new Date(now - ago).toISOString();
const min = 60_000;

const meeting = (id, title, ago, over = {}) => ({
  id,
  title,
  startedAt: iso(ago),
  endedAt: iso(ago - 30 * min),
  durationSec: 1860,
  participants: [],
  transcript: [{ id: `${id}s1`, start: 4, end: 9, speaker: null, text: 'we agreed to hold hiring' }],
  transcriptText: 'we agreed to hold hiring',
  summary: 'The team agreed to hold hiring at two engineers so runway reaches 18 months.',
  topics: ['hiring'],
  decisions: [{ text: 'Hold hiring at two engineers', evidence: [`${id}s1`] }],
  actionItems: [{ text: 'Send the runway model', owner: 'Archana', deadline: 'Thursday', evidence: [`${id}s1`] }],
  openQuestions: ['Do we revisit in Q2?'],
  commitments: [],
  project: null,
  audioSource: 'tab',
  audioMime: null,
  hasAudio: false,
  memoryVersion: 1,
  createdAt: iso(ago),
  updatedAt: iso(ago),
  ...over,
});

const browser = await chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--disable-gpu',
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
});
let sw = browser.serviceWorkers()[0];
if (!sw) sw = await browser.waitForEvent('serviceworker', { timeout: 15000 });
const id = sw.url().match(/^chrome-extension:\/\/([^/]+)\//)[1];

async function seed(page, rows) {
  await page.evaluate(
    (items) =>
      new Promise((res, rej) => {
        const open = indexedDB.open('meetdolff');
        open.onerror = () => rej(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(['meetings', 'calendar'], 'readwrite');
          tx.objectStore('meetings').clear();
          tx.objectStore('calendar').clear();
          for (const m of items) tx.objectStore('meetings').put(m);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        };
      }),
    rows,
  );
}

const seeder = await browser.newPage();
await seeder.goto(`chrome-extension://${id}/dashboard.html`);
await seed(seeder, [
  meeting('a', 'Series A investor call — Northline Ventures', 2 * 24 * 60 * min),
  meeting('b', 'Weekly product review', 4 * 24 * 60 * min),
]);
await seeder.close();

const structural = `
(() => {
  const issues = [];
  const ids = {};
  for (const el of document.querySelectorAll('[id]')) {
    ids[el.id] = (ids[el.id] || 0) + 1;
  }
  for (const [k, v] of Object.entries(ids)) if (v > 1) issues.push('DUPLICATE ID: ' + k + ' x' + v);

  const nameOf = (el) => (
    el.getAttribute('aria-label') ||
    (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent) ||
    el.textContent ||
    el.getAttribute('title') ||
    el.getAttribute('alt') ||
    ''
  ).trim();

  for (const el of document.querySelectorAll('button, a[href], input, select, textarea')) {
    if (el.closest('[hidden]')) continue;
    if (el.offsetParent === null && el.tagName !== 'INPUT') continue;
    if (el.tagName === 'INPUT' && ['hidden'].includes(el.type)) continue;
    const named = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA'
      ? (el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('placeholder'))
      : nameOf(el);
    if (!named) issues.push('UNNAMED ' + el.tagName + (el.id ? '#' + el.id : '') + ' .' + el.className);
  }

  const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.offsetParent !== null).map((h) => Number(h.tagName[1]));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) issues.push('HEADING SKIP: h' + levels[i - 1] + ' -> h' + levels[i]);
  }
  const h1s = levels.filter((l) => l === 1).length;
  if (h1s !== 1) issues.push('H1 COUNT: ' + h1s);

  if (!document.documentElement.lang) issues.push('MISSING html[lang]');
  if (!document.querySelector('main, [role=main]') && document.querySelector('.md-wrap')) issues.push('NO MAIN LANDMARK');
  return issues;
})()
`;

const pages = [
  { path: 'popup.html', name: 'popup', w: 380, h: 600 },
  { path: 'sidepanel.html', name: 'sidepanel', w: 400, h: 1100 },
  { path: 'dashboard.html', name: 'dashboard', w: 1180, h: 1200 },
  { path: 'dashboard.html', name: 'dashboard-detail', w: 1180, h: 1200, click: '#meetingList .row' },
  { path: 'settings.html', name: 'settings', w: 900, h: 1200 },
];

let total = 0;
for (const p of pages) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: p.w, height: p.h });
  await page.goto(`chrome-extension://${id}/${p.path}`);
  if (p.click) await page.locator(p.click).first().click();
  await page.waitForTimeout(600);

  const structuralIssues = await page.evaluate(structural);

  // The extension's CSP is `script-src 'self'`, so addScriptTag is (correctly) blocked.
  // Runtime.evaluate goes through the debugger protocol instead of the document's CSP.
  await page.evaluate(AXE);
  const results = await page.evaluate(async () => {
    // @ts-expect-error injected global
    return await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
  });

  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    sample: v.nodes.slice(0, 2).map((n) => n.target.join(' ')),
  }));

  total += violations.length + structuralIssues.length;
  console.log(`\n=== ${p.name} ===`);
  if (violations.length === 0) console.log('  axe: 0 violations');
  for (const v of violations) console.log(`  axe [${v.impact}] ${v.id}: ${v.help} (${v.nodes}x) ${v.sample.join(' | ')}`);
  if (structuralIssues.length === 0) console.log('  structure: clean');
  for (const si of structuralIssues) console.log('  structure: ' + si);

  await page.screenshot({ path: `${OUT}/a11y-${p.name}.png`, fullPage: true });
  await page.close();
}

console.log(`\nTOTAL ISSUES: ${total}`);
await browser.close();
