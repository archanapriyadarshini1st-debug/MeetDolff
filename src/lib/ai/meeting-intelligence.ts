import type { Meeting } from '../types.js';

export interface ParsedMeetingSummary {
  summary: string;
  topics: string[];
  decisions: { text: string; evidence: string[] }[];
  actionItems: { text: string; owner: string | null; deadline: string | null; evidence: string[] }[];
  openQuestions: string[];
  commitments: string[];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((x) => x.trim()).filter(Boolean) : [];
}

/** Parse a provider response without trusting arbitrary shapes or inventing fields. */
export function parseMeetingSummary(text: string): ParsedMeetingSummary {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned) as any;
  const decisions = Array.isArray(parsed.decisions)
    ? parsed.decisions.map((d: any) => ({
        text: String(d?.text ?? '').trim(),
        evidence: d?.evidence ? [String(d.evidence)] : [],
      })).filter((d: { text: string }) => d.text)
    : [];
  const actionItems = Array.isArray(parsed.actionItems)
    ? parsed.actionItems.map((a: any) => ({
        text: String(a?.text ?? '').trim(),
        owner: a?.owner ? String(a.owner).trim() : null,
        deadline: a?.deadline ? String(a.deadline).trim() : null,
        evidence: a?.evidence ? [String(a.evidence)] : [],
      })).filter((a: { text: string }) => a.text)
    : [];
  return {
    summary: String(parsed.summary ?? '').trim(),
    topics: stringList(parsed.topics),
    decisions,
    actionItems,
    openQuestions: stringList(parsed.openQuestions),
    commitments: stringList(parsed.commitments),
  };
}

export function applyMeetingSummary(meeting: Meeting, summary: ParsedMeetingSummary): Meeting {
  return {
    ...meeting,
    summary: summary.summary || meeting.summary,
    summaryStale: false,
    topics: summary.topics,
    decisions: summary.decisions,
    actionItems: summary.actionItems,
    openQuestions: summary.openQuestions,
    commitments: summary.commitments,
    updatedAt: new Date().toISOString(),
  };
}
