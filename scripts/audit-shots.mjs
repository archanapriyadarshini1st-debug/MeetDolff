/**
 * Visual audit harness: loads the unpacked extension, seeds realistic memory,
 * and screenshots every surface at real extension viewport sizes.
 * Run: node scripts/audit-shots.mjs [outdir]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');
const OUT = resolve(process.argv[2] || 'audit-shots');
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const min = 60_000;
const day = 24 * 60 * min;

function seg(i, start, speaker, text, dur = 6) {
  return { id: `s${i}`, start, end: start + dur, speaker, text };
}

const meetings = [
  {
    id: 'mk1',
    title: 'Series A investor call — Northline Ventures',
    startedAt: iso(2 * day),
    endedAt: iso(2 * day - 41 * min),
    durationSec: 41 * 60,
    participants: ['Archana', 'Dev Raman', 'Priya Nair'],
    transcript: [
      seg(1, 4, 'Dev Raman', 'We are looking at a 1.8 million seed extension, and the question is runway.'),
      seg(2, 32, 'Archana', 'Right now we have eleven months of runway at current burn.'),
      seg(3, 71, 'Priya Nair', 'Can you get that to eighteen months without a second close?'),
      seg(4, 103, 'Archana', 'Yes, if we hold hiring at two engineers instead of five.'),
      seg(5, 140, 'Dev Raman', 'Then the decision is we move to term sheet by Friday.'),
    ],
    transcriptText:
      'We are looking at a 1.8 million seed extension, and the question is runway. Right now we have eleven months of runway at current burn. Can you get that to eighteen months without a second close? Yes, if we hold hiring at two engineers instead of five. Then the decision is we move to term sheet by Friday.',
    summary:
      'Northline is prepared to lead a $1.8M seed extension. The binding constraint is runway: the company has 11 months at current burn. Holding engineering hiring to two instead of five extends runway to 18 months, which Northline treats as the condition for a Friday term sheet.',
    topics: ['fundraising', 'runway', 'hiring'],
    decisions: [{ text: 'Move to term sheet by Friday', evidence: ['s5'] }],
    actionItems: [
      { text: 'Send updated runway model with 2-engineer hiring plan', owner: 'Archana', deadline: 'Thursday', evidence: ['s4'] },
      { text: 'Draft term sheet', owner: 'Dev Raman', deadline: 'Friday', evidence: ['s5'] },
    ],
    openQuestions: ['Does a second close change the valuation?'],
    commitments: ['Hiring capped at two engineers through Q1'],
    project: null,
    audioSource: 'tab',
    audioMime: null,
    hasAudio: false,
    memoryVersion: 1,
    createdAt: iso(2 * day),
    updatedAt: iso(2 * day),
  },
  {
    id: 'mk2',
    title: 'Weekly product review',
    startedAt: iso(4 * day),
    endedAt: iso(4 * day - 28 * min),
    durationSec: 28 * 60,
    participants: ['Archana', 'Meera', 'Tomás'],
    transcript: [
      seg(1, 3, 'Meera', 'The onboarding drop-off is still forty percent at step three.'),
      seg(2, 44, 'Tomás', 'Step three is the calendar connect. We can make it skippable.'),
      seg(3, 88, 'Archana', 'Let us ship skippable calendar and measure for two weeks.'),
    ],
    transcriptText:
      'The onboarding drop-off is still forty percent at step three. Step three is the calendar connect. We can make it skippable. Let us ship skippable calendar and measure for two weeks.',
    summary:
      'Onboarding loses 40% of users at step three, the calendar connect. The team agreed to make calendar connection skippable and measure the effect over two weeks.',
    topics: ['onboarding', 'product'],
    decisions: [{ text: 'Make calendar connect skippable', evidence: ['s2', 's3'] }],
    actionItems: [{ text: 'Ship skippable calendar step', owner: 'Meera', deadline: 'next Tuesday', evidence: ['s3'] }],
    openQuestions: [],
    commitments: [],
    project: null,
    audioSource: 'tab+mic',
    audioMime: null,
    hasAudio: false,
    memoryVersion: 1,
    createdAt: iso(4 * day),
    updatedAt: iso(4 * day),
  },
  {
    id: 'mk3',
    title: '1:1 with Meera',
    startedAt: iso(9 * day),
    endedAt: iso(9 * day - 22 * min),
    durationSec: 22 * 60,
    participants: ['Archana', 'Meera'],
    transcript: [
      seg(1, 5, 'Archana', 'You said the design system felt like scaffolding. What would good look like?'),
      seg(2, 60, 'Meera', 'Fewer components, more rules. Two typefaces and one accent maximum.'),
    ],
    transcriptText:
      'You said the design system felt like scaffolding. What would good look like? Fewer components, more rules. Two typefaces and one accent maximum.',
    summary: 'Meera wants the design system reduced to fewer components with clearer rules and a tighter type/colour budget.',
    topics: ['design', '1:1'],
    decisions: [],
    actionItems: [{ text: 'Cut component count, publish type scale', owner: 'Archana', deadline: null, evidence: ['s2'] }],
    openQuestions: ['Do we keep the mono face?'],
    commitments: [],
    project: null,
    audioSource: 'mic',
    audioMime: null,
    hasAudio: false,
    memoryVersion: 1,
    createdAt: iso(9 * day),
    updatedAt: iso(9 * day),
  },
];

const calendar = [
  { id: 'c1', title: 'Northline follow-up', startsAt: iso(-1 * day), endsAt: iso(-1 * day - 30 * min), color: 'accent', notes: '', meetingId: 'mk1', createdAt: iso(day * 2), updatedAt: iso(day * 2) },
  { id: 'c2', title: 'Product review', startsAt: iso(-3 * day), endsAt: iso(-3 * day - 30 * min), color: 'paper', notes: '', meetingId: 'mk2', createdAt: iso(day * 4), updatedAt: iso(day * 4) },
  { id: 'c3', title: 'Design sync', startsAt: iso(-6 * day), endsAt: iso(-6 * day - 45 * min), color: 'muted', notes: '', meetingId: null, createdAt: iso(day * 9), updatedAt: iso(day * 9) },
];

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
console.log('extension id', id);

const seed = await browser.newPage();
await seed.goto(`chrome-extension://${id}/dashboard.html`);
await seed.evaluate(async ({ meetings, calendar }) => {
  const req = indexedDB.open('meetdolff');
  await new Promise((res) => (req.onsuccess = res));
  const db = req.result;
  const tx = db.transaction(['meetings', 'calendar'], 'readwrite');
  for (const m of meetings) tx.objectStore('meetings').put(m);
  for (const c of calendar) tx.objectStore('calendar').put(c);
  await new Promise((res) => (tx.oncomplete = res));
}, { meetings, calendar });
await seed.close();

const shots = [
  { path: 'popup.html', file: 'popup', w: 380, h: 560 },
  { path: 'sidepanel.html', file: 'sidepanel', w: 400, h: 1200 },
  { path: 'dashboard.html', file: 'dashboard', w: 1180, h: 1400 },
  { path: 'dashboard.html', file: 'dashboard-narrow', w: 620, h: 1400 },
  { path: 'settings.html', file: 'settings', w: 900, h: 1400 },
];

const consoleIssues = [];
for (const s of shots) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: s.w, height: s.h });
  page.on('console', (m) => { if (m.type() === 'error') consoleIssues.push(`${s.file}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleIssues.push(`${s.file}: PAGEERROR ${e.message}`));
  await page.goto(`chrome-extension://${id}/${s.path}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${s.file}.png`, fullPage: true });
  console.log('shot', s.file);
  await page.close();
}

// Empty-memory state for honest empty/error review.
const empty = await browser.newPage();
await empty.setViewportSize({ width: 1100, height: 900 });
await empty.goto(`chrome-extension://${id}/dashboard.html`);
await empty.evaluate(async () => {
  const req = indexedDB.open('meetdolff');
  await new Promise((res) => (req.onsuccess = res));
  const db = req.result;
  const tx = db.transaction(['meetings', 'calendar'], 'readwrite');
  tx.objectStore('meetings').clear();
  tx.objectStore('calendar').clear();
  await new Promise((res) => (tx.oncomplete = res));
});
await empty.reload();
await empty.waitForTimeout(700);
await empty.screenshot({ path: `${OUT}/dashboard-empty.png`, fullPage: true });
await empty.close();

console.log('\n--- console/page errors ---');
console.log(consoleIssues.length ? consoleIssues.join('\n') : '(none)');

await browser.close();
