/**
 * Evidence retrieval + citation verification for grounded answers.
 *
 * Flow: parse date intent -> narrow meetings -> rank passages by term overlap
 * -> give the model numbered passages [E1..En] -> verify every citation the
 * model returns maps to a real retrieved passage. Nothing is ever cited that
 * was not retrieved, and an empty retrieval short-circuits the LLM call.
 */

import type { Meeting } from '../types.js';
import { meetingsInRange, parseDateQuery, type DateQuery } from './dates.js';

export interface EvidencePassage {
  id: string;
  meetingId: string;
  title: string;
  startedAt: string;
  /** Seconds from recording start; null for meeting-level facts (summary etc.) */
  startSec: number | null;
  kind: 'transcript' | 'summary' | 'decision' | 'action' | 'question';
  text: string;
}

export interface Retrieval {
  passages: EvidencePassage[];
  dateFilter: DateQuery | null;
  /** Meetings that matched the date filter (before text ranking) */
  datedMeetingCount: number;
  terms: string[];
}

const STOP = new Set(
  'what whats did do does we our us the a an and or of to in on at for from with about was were is are be been that this these those it its who whom which when where why how any all every find show tell me i you they them there their meeting meetings discuss discussed discussion talk talked say said decide decided decision happen happened last next ago during over between changed change'.split(' '),
);

export function extractTerms(question: string, dateMatched: string[] = []): string[] {
  let q = question.toLowerCase();
  for (const m of dateMatched) q = q.replace(m.toLowerCase(), ' ');
  return q
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
export { clock as formatClock };

type Draft = Omit<EvidencePassage, 'id'>;

function draftsFor(m: Meeting): Draft[] {
  const base = { meetingId: m.id, title: m.title, startedAt: m.startedAt };
  const out: Draft[] = [];
  if (m.summary) out.push({ ...base, startSec: null, kind: 'summary', text: `Summary: ${m.summary}` });
  for (const d of m.decisions) out.push({ ...base, startSec: null, kind: 'decision', text: `Decision: ${d.text}` });
  for (const a of m.actionItems) {
    out.push({ ...base, startSec: null, kind: 'action', text: `Action item: ${a.text}${a.owner ? ` (owner: ${a.owner})` : ''}${a.deadline ? ` (deadline: ${a.deadline})` : ''}` });
  }
  for (const q of m.openQuestions) out.push({ ...base, startSec: null, kind: 'question', text: `Open question: ${q}` });
  // Transcript windows of ~450 chars keep citations timestamp-precise.
  let buf: string[] = [];
  let startSec = 0;
  let len = 0;
  const flush = () => {
    if (buf.length) out.push({ ...base, startSec, kind: 'transcript', text: buf.join(' ') });
    buf = [];
    len = 0;
  };
  for (const seg of m.transcript) {
    if (buf.length === 0) startSec = seg.start;
    buf.push(`${seg.speaker ? `${seg.speaker}: ` : ''}${seg.text}`);
    len += seg.text.length;
    if (len > 450) flush();
  }
  flush();
  if (m.transcript.length === 0 && m.transcriptText) out.push({ ...base, startSec: null, kind: 'transcript', text: m.transcriptText.slice(0, 1500) });
  return out;
}

const score = (text: string, terms: string[]) => {
  const t = text.toLowerCase();
  let s = 0;
  for (const term of terms) if (t.includes(term)) s += 1 + Math.min(2, t.split(term).length - 2) * 0.25;
  return s;
};

export function retrieveEvidence(meetings: Meeting[], question: string, now: Date = new Date(), maxPassages = 14): Retrieval {
  const dateFilter = parseDateQuery(question, now);
  const pool = dateFilter ? meetingsInRange(meetings, dateFilter) : meetings;
  const terms = extractTerms(question, dateFilter?.matched);
  let chosen: Draft[] = [];

  if (terms.length === 0) {
    // Pure date/overview question: only answer if we actually found meetings in range.
    if (dateFilter) {
      for (const m of pool.slice(0, 4)) {
        const d = draftsFor(m);
        chosen.push(...d.filter((x) => x.kind !== 'transcript'), ...d.filter((x) => x.kind === 'transcript').slice(0, 4));
      }
    }
  } else {
    const scored = pool.flatMap((m) => draftsFor(m).map((d) => ({ d, s: score(d.text, terms) + (score(m.title, terms) > 0 ? 0.5 : 0) })));
    chosen = scored.filter((x) => x.s >= 1).sort((a, b) => b.s - a.s).slice(0, maxPassages).map((x) => x.d);
    // Date named a meeting but the topic words matched nothing: give the overview, not silence.
    if (chosen.length === 0 && dateFilter && pool.length) {
      for (const m of pool.slice(0, 3)) chosen.push(...draftsFor(m).filter((x) => x.kind !== 'transcript'));
    }
  }

  chosen = chosen.slice(0, maxPassages + 6).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || (a.startSec ?? -1) - (b.startSec ?? -1));
  let chars = 0;
  const passages: EvidencePassage[] = [];
  for (const d of chosen) {
    chars += d.text.length;
    if (chars > 20000) break;
    passages.push({ ...d, id: `E${passages.length + 1}` });
  }
  return { passages, dateFilter, datedMeetingCount: pool.length, terms };
}

export const GROUNDED_SYSTEM = `You are MeetDolff, a meeting-memory assistant. Answer ONLY from the numbered evidence passages provided. Never invent decisions, deadlines, participants, or commitments. If the evidence does not answer the question, say so plainly.`;

export function groundedPrompt(question: string, r: Retrieval, externalContext = ''): string {
  const evidence = r.passages
    .map((p) => `[${p.id}] ${p.title} (${p.startedAt.slice(0, 16).replace('T', ' ')}${p.startSec !== null ? `, at ${clock(p.startSec)}` : ''}) — ${p.text}`)
    .join('\n');
  return `Evidence from the user's meeting memory:\n"""\n${evidence || '(none)'}\n"""\n${r.dateFilter ? `\nDate filter applied: ${r.dateFilter.label}.\n` : ''}${externalContext ? `\nExternal web research (NOT meeting memory; cite the URL if used):\n"""\n${externalContext.slice(0, 8000)}\n"""\n` : ''}\nQuestion: ${question}\n\nRules:\n- After every factual claim taken from meeting memory, cite the passage id like [E3] (or [E1, E4]).\n- Use only ids that appear above. Do not cite anything else.\n- If the evidence does not contain the answer, say "That isn't in your meeting memory." and stop.\n- Keep external facts clearly separate, with their URL.`;
}

export interface VerifiedCitation {
  id: string;
  meetingId: string;
  title: string;
  timestampSec: number | null;
}

export interface VerifiedAnswer {
  text: string;
  citations: VerifiedCitation[];
  /** Ids the model cited that were NOT in the evidence — removed from the text */
  invalid: string[];
  /** True when the answer cites real evidence OR honestly says memory lacks it */
  grounded: boolean;
}

const HONEST_NO = /\b(isn'?t|is not|not|no)\b[^.]{0,40}\b(in (your )?(meeting )?memory|mentioned|discussed|recorded|found|covered|contain)/i;

export function verifyCitations(answer: string, passages: EvidencePassage[]): VerifiedAnswer {
  const byId = new Map(passages.map((p) => [p.id.toUpperCase(), p]));
  const citations = new Map<string, VerifiedCitation>();
  const invalid: string[] = [];
  const text = answer
    .replace(/\[\s*(E\d+(?:\s*[,;]\s*E\d+)*)\s*\]/gi, (_m, group: string) => {
      const labels: string[] = [];
      for (const raw of group.split(/\s*[,;]\s*/)) {
        const id = raw.toUpperCase();
        const p = byId.get(id);
        if (!p) {
          invalid.push(id);
          continue;
        }
        citations.set(id, { id, meetingId: p.meetingId, title: p.title, timestampSec: p.startSec });
        labels.push(`${p.title}${p.startSec !== null ? ` @ ${clock(p.startSec)}` : ''}`);
      }
      return labels.length ? `[${labels.join('; ')}]` : '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text, citations: [...citations.values()], invalid, grounded: citations.size > 0 || HONEST_NO.test(answer) };
}

export function notInMemoryMessage(r: Retrieval): string {
  if (r.dateFilter && r.datedMeetingCount === 0) return `I couldn't find any meeting recorded for ${r.dateFilter.label}.`;
  return "That isn't in your meeting memory.";
}
