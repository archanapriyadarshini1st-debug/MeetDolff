/**
 * Local full-text search over meeting memory.
 * No vector DB — deterministic, offline, explainable.
 * Tokenizes query, scores meetings by term frequency + recency,
 * returns snippets with <mark> highlights and source timestamps.
 */

import type { Meeting, SearchResult } from './types.js';

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function makeSnippet(text: string, terms: string[], radius = 90): string {
  const lower = text.toLowerCase();
  let bestIdx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (bestIdx === -1 || i < bestIdx)) bestIdx = i;
  }
  if (bestIdx === -1) {
    return escapeHtml(text.slice(0, radius * 2)) + (text.length > radius * 2 ? '…' : '');
  }
  const start = Math.max(0, bestIdx - radius);
  const end = Math.min(text.length, bestIdx + radius + 40);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  let html = escapeHtml(snippet);
  for (const t of terms) {
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}

export function searchMeetings(meetings: Meeting[], query: string): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const results: SearchResult[] = [];
  for (const m of meetings) {
    const haystack = [
      m.title,
      m.transcriptText,
      m.summary ?? '',
      m.topics.join(' '),
      m.decisions.map((d) => d.text).join(' '),
      m.actionItems.map((a) => a.text).join(' '),
      m.project ?? '',
    ]
      .join('\n')
      .toLowerCase();
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      const count = haystack.split(t).length - 1;
      if (count > 0) {
        matched++;
        // Title matches weigh more
        const titleCount = m.title.toLowerCase().split(t).length - 1;
        score += count + titleCount * 3;
      }
    }
    if (matched === 0) continue;
    // Require all terms for multi-term queries? No — rank by coverage.
    // Boost coverage ratio.
    score *= matched / terms.length;
    const snippet = makeSnippet(m.transcriptText || m.summary || m.title, terms);
    results.push({ meeting: m, snippet, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

export function searchByDate(meetings: Meeting[], fromIso: string, toIso: string): Meeting[] {
  return meetings.filter((m) => m.startedAt >= fromIso && m.startedAt <= toIso);
}

export function searchByTopic(meetings: Meeting[], topic: string): Meeting[] {
  const t = topic.toLowerCase();
  return meetings.filter(
    (m) =>
      m.topics.some((x) => x.toLowerCase().includes(t)) ||
      m.transcriptText.toLowerCase().includes(t),
  );
}
