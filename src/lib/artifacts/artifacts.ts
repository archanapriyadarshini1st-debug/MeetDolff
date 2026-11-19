/**
 * Generated artifacts from meeting memory.
 * Deterministic templates (no fake AI) + AI-assisted generation hooks.
 * Types: report (markdown), quiz, flashcards, mindmap (mermaid), infographic (svg text).
 */

import type { Meeting } from '../types.js';
import { meetingToMarkdown } from '../memory-files.js';

export function generateReport(m: Meeting): string {
  return [
    `# Meeting Report — ${m.title}`,
    '',
    `**Date:** ${m.startedAt}  `,
    `**Duration:** ${m.durationSec}s  `,
    `**Participants:** ${m.participants.join(', ') || '—'}`,
    '',
    '## Executive summary',
    '',
    m.summary ?? 'No summary generated yet. Run “Summarize” in the side panel.',
    '',
    '## Decisions',
    '',
    ...(m.decisions.length ? m.decisions.map((d) => `- ${d.text}`) : ['- None recorded.']),
    '',
    '## Action items',
    '',
    ...(m.actionItems.length
      ? m.actionItems.map((a) => `- [ ] ${a.text}${a.owner ? ` (@${a.owner})` : ''}${a.deadline ? ` — due ${a.deadline}` : ''}`)
      : ['- None recorded.']),
    '',
    '## Open questions',
    '',
    ...(m.openQuestions.length ? m.openQuestions.map((q) => `- ${q}`) : ['- None.']),
    '',
    '---',
    '',
    '## Full memory',
    '',
    meetingToMarkdown(m),
  ].join('\n');
}

export function generateFlashcards(m: Meeting): { front: string; back: string }[] {
  const cards: { front: string; back: string }[] = [];
  for (const d of m.decisions) {
    cards.push({ front: 'What was decided?', back: d.text });
  }
  for (const a of m.actionItems) {
    cards.push({ front: 'What is the next action?', back: a.text });
  }
  for (const q of m.openQuestions) {
    cards.push({ front: 'What remains unresolved?', back: q });
  }
  if (m.summary) cards.push({ front: 'Summarize this meeting in one line.', back: m.summary });
  return cards;
}

export function generateQuiz(m: Meeting): { q: string; a: string }[] {
  const items: { q: string; a: string }[] = [];
  m.decisions.forEach((d, i) => items.push({ q: `Decision ${i + 1}: what was decided?`, a: d.text }));
  m.actionItems.forEach((a, i) => items.push({ q: `Action ${i + 1}: what must happen?`, a: a.text }));
  m.openQuestions.forEach((q, i) => items.push({ q: `Open question ${i + 1}`, a: q }));
  return items;
}

export function generateMindmap(m: Meeting): string {
  const lines = ['```mermaid', 'mindmap', `  root((${m.title}))`];
  for (const t of m.topics) lines.push(`    ${t}`);
  for (const d of m.decisions) lines.push(`    Decision:: ${d.text.slice(0, 60)}`);
  for (const a of m.actionItems) lines.push(`    Action:: ${a.text.slice(0, 60)}`);
  lines.push('```');
  return lines.join('\n');
}

export function generateInfographicText(m: Meeting): string {
  return [
    `MEETDOLFF INFOGRAPHIC — ${m.title}`,
    `Date: ${m.startedAt} · Duration: ${m.durationSec}s`,
    '',
    `Topics (${m.topics.length}): ${m.topics.join(', ') || '—'}`,
    `Decisions (${m.decisions.length}):`,
    ...m.decisions.map((d) => `  • ${d.text}`),
    `Actions (${m.actionItems.length}):`,
    ...m.actionItems.map((a) => `  • ${a.text}`),
    `Open questions (${m.openQuestions.length}):`,
    ...m.openQuestions.map((q) => `  • ${q}`),
  ].join('\n');
}
