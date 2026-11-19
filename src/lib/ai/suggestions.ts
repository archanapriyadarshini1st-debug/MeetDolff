/**
 * Real-time question suggestions.
 *
 * Design goals (from the product brief): useful, context-aware, non-intrusive,
 * and never invented. Every suggestion carries `evidence` — the exact words from
 * the conversation (or the earlier meeting) that triggered it.
 *
 * Two engines:
 *  1. `suggestQuestions`  — deterministic, offline, zero-cost. Detects gaps that
 *     are commonly left open in meetings: ownerless actions, vague deadlines,
 *     unexplained decisions, unmitigated risks, unstated assumptions.
 *  2. `suggestQuestionsWithLlm` — optional, uses the user's own provider, and is
 *     only called when the user opts in (transcript text leaves the device).
 *     Falls back to engine 1 on any failure so the feature never goes dark.
 *
 * Plus `carryOverQuestions`: follow-ups drawn from *previous* meetings' open
 * questions and undated action items.
 */

import type { Meeting } from '../types.js';
import type { AiProvider } from './provider.js';

export type SuggestionKind =
  | 'owner'
  | 'deadline'
  | 'rationale'
  | 'risk'
  | 'assumption'
  | 'clarify'
  | 'followup'
  | 'llm';

export interface QuestionSuggestion {
  question: string;
  /** Why this question is being suggested (one short sentence). */
  reason: string;
  /** Exact words from the conversation / earlier meeting that triggered it. */
  evidence: string;
  kind: SuggestionKind;
  source: 'heuristic' | 'llm' | 'memory';
}

export interface SuggestOptions {
  /** Questions already asked or dismissed (compared after normalization). */
  asked?: string[];
  max?: number;
}

const ACTION_RE =
  /\b(?:someone|somebody|we\s+(?:should|need\s+to|have\s+to|must|ought\s+to)|let'?s|(?:needs?|has|have)\s+to\s+be|(?:should|needs?\s+to)\s+(?:be\s+)?(?:done|built|fixed|written|reviewed|sent|shipped|tested|updated|finished|sorted))\b/i;
const NAMED_OWNER_RE = /\b[A-Z][a-z]{1,}\s+(?:will|can|is\s+going\s+to|'ll|to\s+(?:take|handle|own|do))\b|\bI(?:'ll|\s+will|\s+can)\b/;
const VAGUE_TIME_RE =
  /\b(?:soon|asap|later|eventually|at\s+some\s+point|sometime|in\s+a\s+bit|when\s+we\s+(?:can|get\s+a\s+chance)|next\s+(?:week|month|quarter)|this\s+(?:week|month)|by\s+end\s+of)\b/i;
const CONCRETE_DATE_RE =
  /\b(?:\d{1,2}[/-]\d{1,2}|\d{4}-\d{2}-\d{2}|(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}|\d{1,2}(?:st|nd|rd|th)\b)/i;
const DECISION_RE =
  /\b(?:we(?:'ve|\s+have)?\s+decided|decided\s+to|let'?s\s+go\s+with|we(?:'ll|\s+will)\s+go\s+with|we\s+agreed|agreed\s+(?:to|on)|final\s+decision|settled\s+on)\b/i;
const RISK_RE =
  /\b(?:blocker|blocked|risk(?:y)?|concern(?:ed)?|worried|worry|problem|delay(?:ed|s)?|depends\s+on|dependency|dependencies|bottleneck|not\s+going\s+to\s+(?:work|make\s+it))\b/i;
const ASSUMPTION_RE = /\b(?:budget|estimate[ds]?|forecast|cost[s]?|pricing|\$\s?\d[\d,.]*|\d+\s?(?:k|hours|days|weeks|users|%))\b/i;
const UNCERTAIN_RE = /\b(?:not\s+sure|unclear|i\s+guess|i\s+think\s+maybe|don'?t\s+know|we'?ll\s+see|tbd|to\s+be\s+determined|no\s+idea)\b/i;

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Split live text into sentence-like chunks. Web Speech often emits no punctuation, so also chunk by length. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)) {
    const words = raw.split(' ').filter(Boolean);
    if (words.length <= 40) {
      if (words.length >= 3) out.push(words.join(' '));
      continue;
    }
    for (let i = 0; i < words.length; i += 30) out.push(words.slice(i, i + 30).join(' '));
  }
  return out;
}

function clip(s: string, n = 140): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/** Short noun-ish handle for the topic of a sentence, used inside the question text. */
function handle(sentence: string): string {
  const cleaned = sentence.replace(/^(?:so|and|but|okay|ok|well|yeah|right)[, ]+/i, '').replace(/[.!?]+$/, '');
  return clip(cleaned, 70);
}

function suggestionsForSentence(sentence: string): QuestionSuggestion[] {
  const found: QuestionSuggestion[] = [];
  const evidence = clip(sentence);
  const isAction = ACTION_RE.test(sentence);
  if (isAction && !NAMED_OWNER_RE.test(sentence)) {
    found.push({
      kind: 'owner',
      source: 'heuristic',
      question: `Who owns this: “${handle(sentence)}”?`,
      reason: 'An action was mentioned without a named owner.',
      evidence,
    });
  }
  if ((isAction || DECISION_RE.test(sentence)) && VAGUE_TIME_RE.test(sentence) && !CONCRETE_DATE_RE.test(sentence)) {
    found.push({
      kind: 'deadline',
      source: 'heuristic',
      question: `What is the concrete deadline for “${handle(sentence)}”?`,
      reason: 'Timing was left vague.',
      evidence,
    });
  }
  if (DECISION_RE.test(sentence)) {
    found.push({
      kind: 'rationale',
      source: 'heuristic',
      question: 'What was the reasoning behind this decision, and which alternatives were rejected?',
      reason: 'A decision was stated; the reasoning is easy to lose.',
      evidence,
    });
  }
  if (RISK_RE.test(sentence)) {
    found.push({
      kind: 'risk',
      source: 'heuristic',
      question: `What is the mitigation or fallback for: “${handle(sentence)}”?`,
      reason: 'A risk or blocker was raised.',
      evidence,
    });
  }
  if (ASSUMPTION_RE.test(sentence)) {
    found.push({
      kind: 'assumption',
      source: 'heuristic',
      question: 'What assumptions is this number based on, and how confident are we in it?',
      reason: 'A figure or estimate was mentioned.',
      evidence,
    });
  }
  if (UNCERTAIN_RE.test(sentence)) {
    found.push({
      kind: 'clarify',
      source: 'heuristic',
      question: `What would resolve this uncertainty, and who can find out: “${handle(sentence)}”?`,
      reason: 'Someone expressed uncertainty.',
      evidence,
    });
  }
  return found;
}

/**
 * Offline suggestions for the most recent part of the conversation.
 * Most recent sentences win; at most one suggestion per kind so the list stays varied.
 */
export function suggestQuestions(recentText: string, opts: SuggestOptions = {}): QuestionSuggestion[] {
  const max = opts.max ?? 3;
  const asked = new Set((opts.asked ?? []).map(normalizeQuestion));
  const sentences = splitSentences(recentText);
  const out: QuestionSuggestion[] = [];
  const usedKinds = new Set<SuggestionKind>();
  for (let i = sentences.length - 1; i >= 0 && out.length < max; i--) {
    for (const s of suggestionsForSentence(sentences[i]!)) {
      if (out.length >= max) break;
      if (usedKinds.has(s.kind) || asked.has(normalizeQuestion(s.question))) continue;
      usedKinds.add(s.kind);
      out.push(s);
    }
  }
  return out;
}

/**
 * Follow-ups from earlier meetings: unresolved questions and action items that
 * still have no deadline. Newest meetings first. Pure function over saved memory.
 */
export function carryOverQuestions(meetings: Meeting[], opts: SuggestOptions & { excludeMeetingId?: string } = {}): QuestionSuggestion[] {
  const max = opts.max ?? 3;
  const asked = new Set((opts.asked ?? []).map(normalizeQuestion));
  const sorted = meetings
    .filter((m) => m.id !== opts.excludeMeetingId)
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const out: QuestionSuggestion[] = [];
  const push = (s: QuestionSuggestion): void => {
    if (out.length < max && !asked.has(normalizeQuestion(s.question))) out.push(s);
  };
  for (const m of sorted) {
    for (const q of m.openQuestions) {
      push({
        kind: 'followup',
        source: 'memory',
        question: `Any update on this open question from “${m.title}”: ${clip(q, 110)}`,
        reason: 'It was left unresolved in an earlier meeting.',
        evidence: `${m.title} — open question: ${clip(q)}`,
      });
    }
    for (const a of m.actionItems) {
      if (a.deadline) continue;
      push({
        kind: 'followup',
        source: 'memory',
        question: `Is “${clip(a.text, 90)}” (from “${m.title}”) done, and what is its deadline?`,
        reason: 'This action item has no recorded deadline.',
        evidence: `${m.title} — action item: ${clip(a.text)}`,
      });
    }
    if (out.length >= max) break;
  }
  return out;
}

export const SUGGESTION_SYSTEM = `You help a meeting participant think of useful questions to ask. Use ONLY the conversation excerpt provided. Never invent facts, names, dates or numbers. Suggest short, specific, polite questions that surface missing owners, deadlines, reasoning, risks or assumptions. If nothing useful can be asked, return an empty list.`;

export function suggestionsPrompt(recentText: string, max: number): string {
  return `Conversation excerpt (most recent last):
"""
${recentText.slice(-3500)}
"""

Return JSON only: {"suggestions":[{"question":"...","reason":"one short sentence","evidence":"exact words quoted from the excerpt"}]}
Rules: at most ${max} suggestions; "evidence" MUST be a verbatim substring of the excerpt; questions under 25 words.`;
}

/** Parse + validate model output. Drops any suggestion whose evidence is not actually in the excerpt. */
export function parseSuggestions(raw: string, recentText: string, max = 3): QuestionSuggestion[] {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  const list = (parsed as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return [];
  const haystack = recentText.replace(/\s+/g, ' ').toLowerCase();
  const out: QuestionSuggestion[] = [];
  for (const item of list) {
    const q = String((item as any)?.question ?? '').trim();
    const evidence = String((item as any)?.evidence ?? '').replace(/\s+/g, ' ').trim();
    if (!q || !evidence || !haystack.includes(evidence.toLowerCase())) continue;
    out.push({
      kind: 'llm',
      source: 'llm',
      question: clip(q, 200),
      reason: clip(String((item as any)?.reason ?? 'Suggested from the conversation.'), 160),
      evidence: clip(evidence),
    });
    if (out.length >= max) break;
  }
  return out;
}

export async function suggestQuestionsWithLlm(
  provider: AiProvider,
  recentText: string,
  opts: SuggestOptions = {},
): Promise<QuestionSuggestion[]> {
  const max = opts.max ?? 3;
  const asked = new Set((opts.asked ?? []).map(normalizeQuestion));
  try {
    const res = await provider.chat(
      [
        { role: 'system', content: SUGGESTION_SYSTEM },
        { role: 'user', content: suggestionsPrompt(recentText, max) },
      ],
      { temperature: 0.2 },
    );
    const fromModel = parseSuggestions(res.text, recentText, max).filter((s) => !asked.has(normalizeQuestion(s.question)));
    if (fromModel.length) return fromModel;
  } catch {
    // Provider failure must not break the live experience; fall through.
  }
  return suggestQuestions(recentText, opts);
}
