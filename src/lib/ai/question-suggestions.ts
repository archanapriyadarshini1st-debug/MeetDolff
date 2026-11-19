/**
 * Real-Time Question Suggestions.
 *
 * Deterministic gap detection over the most recent transcript window: it finds
 * commitments with no owner or deadline, voiced uncertainty, risks, and
 * questions that nobody answered. Every suggestion points at the segment that
 * triggered it, so nothing is invented. Runs locally, needs no API key and
 * costs no tokens, which keeps it fast and non-intrusive during a meeting.
 */

import type { TranscriptSegment } from '../types.js';

export type QuestionKind = 'owner' | 'deadline' | 'uncertainty' | 'risk' | 'unanswered';

export interface QuestionSuggestion {
  id: string;
  kind: QuestionKind;
  question: string;
  /** Why this was suggested, shown beside the question */
  reason: string;
  segmentId: string;
  /** Seconds from recording start */
  at: number;
}

export interface SuggestOptions {
  /** Only look at this many seconds before the latest segment (default 240) */
  windowSec?: number;
  /** Maximum suggestions returned (default 4) */
  max?: number;
}

const COMMITMENT = /\b(?:we|someone|somebody|the team|they)\s+(?:should|need to|needs to|have to|has to|must|ought to|will need to)\b|\blet'?s\b|\bneeds? to be (?:done|fixed|built|written|reviewed|decided|shipped)\b/i;
const NAMED_OWNER = /\b(?:i'?ll|i will|i can take|i'?m going to|[A-Z][a-z]+ (?:will|can|is going to|takes|owns|is taking))\b/;
const DEADLINE = /\b(?:by|before|until|due|deadline)\b[^.?!]*\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|today|next|end of|eod|eow|q[1-4]|\d)/i;
const UNCERTAIN = /\b(?:maybe|probably|i think|not sure|we'?ll see|tbd|to be determined|haven'?t decided|undecided|up in the air|might)\b/i;
const RISK = /\b(?:blockers?|blocked|risks?|risky|concerned?|worried|worry|depends on|dependency|bottleneck|can'?t proceed)\b/i;
const ANSWER_START = /^(?:yes|no|yeah|yep|nope|sure|correct|right|exactly|absolutely|definitely)\b/i;
const STOP = new Set(['what', 'when', 'where', 'which', 'would', 'could', 'should', 'there', 'their', 'about', 'have', 'does', 'this', 'that', 'with', 'from', 'will', 'were', 'been', 'your', 'they', 'them', 'then', 'than', 'into', 'just']);

function sentences(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
}

function snippet(s: string, max = 90): string {
  const clean = s.replace(/\s+/g, ' ').replace(/[.?!]+$/, '').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function keywords(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? []);
}

function answered(question: string, following: TranscriptSegment[]): boolean {
  const qk = keywords(question);
  return following.slice(0, 3).some((seg) => {
    if (ANSWER_START.test(seg.text.trim())) return true;
    const sk = keywords(seg.text);
    for (const w of qk) if (sk.has(w)) return true;
    return false;
  });
}

export function suggestQuestions(segments: TranscriptSegment[], opts: SuggestOptions = {}): QuestionSuggestion[] {
  const windowSec = opts.windowSec ?? 240;
  const max = opts.max ?? 4;
  if (segments.length === 0) return [];
  const latest = Math.max(...segments.map((s) => s.end));
  const found: QuestionSuggestion[] = [];

  segments.forEach((seg, idx) => {
    if (seg.end < latest - windowSec) return;
    const add = (kind: QuestionKind, question: string, reason: string) =>
      found.push({ id: `${seg.id}:${kind}:${found.length}`, kind, question, reason, segmentId: seg.id, at: seg.start });

    for (const sentence of sentences(seg.text)) {
      const isQuestion = sentence.endsWith('?');
      if (isQuestion) {
        if (idx < segments.length - 1 && !answered(sentence, segments.slice(idx + 1))) {
          add('unanswered', `Did anyone answer: “${snippet(sentence)}”?`, 'Asked, but the next few lines do not respond to it.');
        }
        continue;
      }
      if (COMMITMENT.test(sentence)) {
        if (!NAMED_OWNER.test(sentence)) add('owner', `Who will own “${snippet(sentence)}”?`, 'A commitment was stated without a named owner.');
        if (!DEADLINE.test(sentence)) add('deadline', `When does “${snippet(sentence)}” need to be done?`, 'A commitment was stated without a deadline.');
      } else if (NAMED_OWNER.test(sentence) && /\b(?:will|going to|can take)\b/i.test(sentence) && !DEADLINE.test(sentence)) {
        add('deadline', `When will this be done: “${snippet(sentence)}”?`, 'Someone took this on, but no date was given.');
      }
      if (UNCERTAIN.test(sentence)) add('uncertainty', `What would settle “${snippet(sentence)}”?`, 'Uncertainty was voiced here.');
      if (RISK.test(sentence)) add('risk', `What is the plan for “${snippet(sentence)}”?`, 'A risk or blocker was raised.');
    }
  });

  // Most recent first, one per question, at most two per kind so the list stays varied.
  const seen = new Set<string>();
  const perKind: Record<string, number> = {};
  const out: QuestionSuggestion[] = [];
  for (const s of found.sort((a, b) => b.at - a.at)) {
    const key = s.question.toLowerCase();
    if (seen.has(key) || (perKind[s.kind] ?? 0) >= 2) continue;
    seen.add(key);
    perKind[s.kind] = (perKind[s.kind] ?? 0) + 1;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
