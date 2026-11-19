/**
 * Real-time question suggestions.
 *
 * Two sources, always labeled in the UI:
 *  - heuristic: deterministic, offline, rule-based. Quotes the exact words it
 *    reacted to, so it can never invent facts.
 *  - ai: the user's own provider, only when they opt in (transcript text is
 *    sent to that provider), and only when it returns well-formed output.
 */

import type { TranscriptSegment } from '../types.js';

export type SuggestionKind = 'deadline' | 'ownership' | 'decision' | 'uncertainty' | 'risk' | 'numbers';

export interface SuggestedQuestion {
  id: string;
  question: string;
  /** Why this was suggested (shown to the user). */
  reason: string;
  kind: SuggestionKind | 'ai';
  /** Words from the transcript that triggered it. */
  quote: string | null;
  segmentId: string | null;
  source: 'heuristic' | 'ai';
}

interface Rule {
  kind: SuggestionKind;
  test: RegExp;
  reason: string;
  build: (quote: string) => string;
}

const RULES: Rule[] = [
  {
    kind: 'deadline',
    test: /\b(asap|soon|next week|next month|end of (the )?(week|month|quarter|sprint)|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)|deadline|due)\b/i,
    reason: 'A timing was mentioned.',
    build: (q) => `You mentioned “${q}” — what is the exact date, and what happens if it slips?`,
  },
  {
    kind: 'ownership',
    test: /\b(someone|somebody|we (need|should|have) to|somebody should|someone should|it needs to (get )?(done|handled))\b/i,
    reason: 'Work was mentioned without a named owner.',
    build: (q) => `On “${q}” — who specifically owns this?`,
  },
  {
    kind: 'decision',
    test: /\b(we should|let'?s (go|use|do|pick|choose)|we('ll| will) go with|we decided|we agreed|sounds good|the plan is)\b/i,
    reason: 'This sounds like a decision.',
    build: (q) => `Is “${q}” final? What alternatives were considered, and why were they set aside?`,
  },
  {
    kind: 'uncertainty',
    test: /\b(maybe|might|not sure|i guess|probably|unclear|it depends|no idea|i think)\b/i,
    reason: 'Someone sounded unsure.',
    build: (q) => `You said “${q}” — what information would settle this?`,
  },
  {
    kind: 'risk',
    test: /\b(blocked|blocker|risk|risky|problem|issue|concern(ed)?|delay(ed)?|bottleneck|can'?t proceed)\b/i,
    reason: 'A risk or blocker came up.',
    build: (q) => `About “${q}” — what is the impact if it isn't resolved, and who can unblock it?`,
  },
  {
    kind: 'numbers',
    test: /(\$\s?\d|\b\d+(\.\d+)?\s?%|\bbudget\b|\bcosts?\b|\bprice\b|\brevenue\b)/i,
    reason: 'A figure or cost was mentioned.',
    build: (q) => `What assumption is behind “${q}”?`,
  },
];

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Sentence of `text` containing `idx`, trimmed to ~90 chars on a word boundary. */
function quoteAround(text: string, idx: number): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  let offset = 0;
  let chosen = text;
  for (const s of sentences) {
    if (idx < offset + s.length + 1) {
      chosen = s;
      break;
    }
    offset += s.length + 1;
  }
  chosen = chosen.replace(/[.!?]+$/, '').trim();
  if (chosen.length <= 90) return chosen;
  const cut = chosen.slice(0, 90);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}…`;
}

export interface HeuristicOptions {
  limit?: number;
  /** Segments considered, counted from the newest. */
  windowSize?: number;
  /** Questions already shown or dismissed — never repeated. */
  alreadyAsked?: string[];
}

export function heuristicQuestions(segments: TranscriptSegment[], opts: HeuristicOptions = {}): SuggestedQuestion[] {
  const limit = opts.limit ?? 3;
  const windowSize = opts.windowSize ?? 10;
  const seen = new Set((opts.alreadyAsked ?? []).map(normalizeQuestion));
  const usedKinds = new Set<SuggestionKind>();
  const out: SuggestedQuestion[] = [];
  const recent = segments.slice(-windowSize).reverse();
  for (const seg of recent) {
    if (wordCount(seg.text) < 4) continue;
    for (const rule of RULES) {
      if (out.length >= limit) return out;
      if (usedKinds.has(rule.kind)) continue;
      const match = rule.test.exec(seg.text);
      if (!match) continue;
      const quote = quoteAround(seg.text, match.index);
      const question = rule.build(quote);
      if (seen.has(normalizeQuestion(question))) continue;
      seen.add(normalizeQuestion(question));
      usedKinds.add(rule.kind);
      out.push({
        id: `h_${rule.kind}_${seg.id}`,
        question,
        reason: rule.reason,
        kind: rule.kind,
        quote,
        segmentId: seg.id,
        source: 'heuristic',
      });
      break; // one question per segment keeps suggestions varied across topics
    }
  }
  return out;
}

function stamp(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Recent transcript as timestamped lines, newest content preferred. */
export function excerptFromSegments(segments: TranscriptSegment[], maxChars = 2400): string {
  const lines: string[] = [];
  let used = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    const line = `[${stamp(seg.start)}] ${seg.speaker ? `${seg.speaker}: ` : ''}${seg.text}`;
    if (used + line.length > maxChars) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

export const SUGGESTION_SYSTEM =
  'You help someone in a live meeting decide what to ask next. Use ONLY the transcript excerpt provided. ' +
  'Never invent names, numbers, dates or decisions. Output JSON only.';

export function suggestionPrompt(excerpt: string, alreadyAsked: string[]): string {
  const avoid = alreadyAsked.length ? `\nDo not repeat or rephrase these:\n${alreadyAsked.slice(-8).map((q) => `- ${q}`).join('\n')}` : '';
  return (
    `Transcript excerpt (latest at the bottom):\n${excerpt}\n${avoid}\n\n` +
    'Suggest up to 3 short, specific, non-intrusive questions a participant could ask next, ' +
    'focused on unclear commitments, missing owners or dates, unstated assumptions, and unresolved decisions.\n' +
    'Respond with a JSON array only: [{"question":"…?","reason":"one short sentence"}]'
  );
}

function extractJsonArray(raw: string): unknown {
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  const a = text.indexOf('[');
  const b = text.lastIndexOf(']');
  if (a !== -1 && b > a) {
    try {
      return JSON.parse(text.slice(a, b + 1));
    } catch {
      /* fall through to object form */
    }
  }
  const o = text.indexOf('{');
  const p = text.lastIndexOf('}');
  if (o !== -1 && p > o) {
    try {
      const obj = JSON.parse(text.slice(o, p + 1)) as { questions?: unknown };
      return obj.questions;
    } catch {
      return null;
    }
  }
  return null;
}

/** Tolerant parser: returns [] (never throws) when the output is unusable. */
export function parseAiSuggestions(raw: string, limit = 3): SuggestedQuestion[] {
  const arr = extractJsonArray(raw);
  if (!Array.isArray(arr)) return [];
  const out: SuggestedQuestion[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const question = typeof item === 'string' ? item : typeof (item as any)?.question === 'string' ? (item as any).question : '';
    const reason = typeof (item as any)?.reason === 'string' ? (item as any).reason : 'Suggested from the recent conversation.';
    const q = question.replace(/\s+/g, ' ').trim().slice(0, 220);
    const key = normalizeQuestion(q);
    if (q.length < 8 || !q.includes('?') || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `ai_${key.replace(/\s/g, '').slice(0, 24)}`,
      question: q,
      reason: reason.replace(/\s+/g, ' ').trim().slice(0, 160),
      kind: 'ai',
      quote: null,
      segmentId: null,
      source: 'ai',
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function mergeSuggestions(existing: SuggestedQuestion[], incoming: SuggestedQuestion[], limit = 5): SuggestedQuestion[] {
  const seen = new Set<string>();
  const out: SuggestedQuestion[] = [];
  for (const s of [...incoming, ...existing]) {
    const key = normalizeQuestion(s.question);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export interface RefreshState {
  lastRunAt: number;
  lastSegmentCount: number;
}

/** Throttle: enough time passed AND enough new final segments arrived. */
export function shouldRefresh(state: RefreshState, now: number, segmentCount: number, minIntervalMs = 20_000, minNewSegments = 2): boolean {
  return now - state.lastRunAt >= minIntervalMs && segmentCount - state.lastSegmentCount >= minNewSegments;
}
