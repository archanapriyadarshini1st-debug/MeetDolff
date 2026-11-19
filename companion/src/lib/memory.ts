/**
 * Memory queries behind both the owner UI and the MCP tools.
 * Everything returned carries the meeting id/title and a transcript timestamp
 * so an agent can cite its source. Nothing here invents content.
 */
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { meetings } from "@/db/schema";

export interface Segment { id: string; start: number; end: number; speaker: string | null; text: string }
export interface MeetingRecord {
  id: string; title: string; startedAt: string; endedAt: string; durationSec: number;
  participants: string[]; transcript: Segment[]; transcriptText: string; summary: string | null;
  topics: string[]; decisions: { text: string; evidence: string[] }[];
  actionItems: { text: string; owner: string | null; deadline: string | null; evidence: string[] }[];
  openQuestions: string[]; commitments: string[]; project: string | null;
  [k: string]: unknown;
}

const MAX_TRANSCRIPT_CHARS = 2_000_000;
const str = (v: unknown, max = 5000) => (typeof v === "string" ? v.slice(0, max) : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 2000)) : []);

export class ValidationError extends Error {}

/** Validate an exported meeting without trusting its shape. Unknown fields are preserved in `data`. */
export function parseMeeting(raw: unknown): MeetingRecord {
  if (!raw || typeof raw !== "object") throw new ValidationError("Meeting must be an object.");
  const m = raw as Record<string, unknown>;
  const id = str(m.id, 200);
  if (!/^[\w.:-]{1,200}$/.test(id)) throw new ValidationError("Meeting id is missing or has unsupported characters.");
  const startedAt = new Date(str(m.startedAt, 64));
  const endedAt = new Date(str(m.endedAt, 64));
  if (Number.isNaN(startedAt.getTime())) throw new ValidationError(`Meeting ${id}: startedAt is not a valid date.`);
  const transcript: Segment[] = (Array.isArray(m.transcript) ? m.transcript : []).slice(0, 50_000).flatMap((s: unknown, i: number) => {
    if (!s || typeof s !== "object") return [];
    const seg = s as Record<string, unknown>;
    const text = str(seg.text, 10_000);
    return text ? [{ id: str(seg.id, 100) || `seg_${i}`, start: Number(seg.start) || 0, end: Number(seg.end) || 0, speaker: typeof seg.speaker === "string" ? seg.speaker : null, text }] : [];
  });
  const transcriptText = (str(m.transcriptText, MAX_TRANSCRIPT_CHARS) || transcript.map((s) => s.text).join(" ")).trim();
  return {
    ...m,
    id,
    title: str(m.title, 300) || "Untitled meeting",
    startedAt: startedAt.toISOString(),
    endedAt: (Number.isNaN(endedAt.getTime()) ? startedAt : endedAt).toISOString(),
    durationSec: Math.max(0, Math.round(Number(m.durationSec) || 0)),
    participants: strs(m.participants),
    transcript,
    transcriptText,
    summary: typeof m.summary === "string" ? m.summary.slice(0, 20_000) : null,
    topics: strs(m.topics),
    decisions: (Array.isArray(m.decisions) ? m.decisions : []).flatMap((d: unknown) => {
      const o = d as Record<string, unknown> | null;
      return o && typeof o.text === "string" ? [{ text: o.text.slice(0, 2000), evidence: strs(o.evidence) }] : [];
    }),
    actionItems: (Array.isArray(m.actionItems) ? m.actionItems : []).flatMap((a: unknown) => {
      const o = a as Record<string, unknown> | null;
      return o && typeof o.text === "string"
        ? [{ text: o.text.slice(0, 2000), owner: typeof o.owner === "string" ? o.owner : null, deadline: typeof o.deadline === "string" ? o.deadline : null, evidence: strs(o.evidence) }]
        : [];
    }),
    openQuestions: strs(m.openQuestions),
    commitments: strs(m.commitments),
    project: typeof m.project === "string" ? m.project : null,
  };
}

export async function upsertMeetings(records: MeetingRecord[]): Promise<number> {
  for (const m of records) {
    const values = {
      id: m.id, title: m.title, startedAt: new Date(m.startedAt), endedAt: new Date(m.endedAt),
      durationSec: m.durationSec, summary: m.summary, transcriptText: m.transcriptText, data: m, syncedAt: new Date(),
    };
    await db.insert(meetings).values(values).onConflictDoUpdate({ target: meetings.id, set: values });
  }
  return records.length;
}

export const stamp = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

interface Range { from?: string | undefined; to?: string | undefined }
function rangeWhere(r: Range): SQL | undefined {
  const parts: SQL[] = [];
  if (r.from) {
    const d = new Date(r.from);
    if (Number.isNaN(d.getTime())) throw new ValidationError("`from` must be an ISO 8601 date.");
    parts.push(gte(meetings.endedAt, d));
  }
  if (r.to) {
    const d = new Date(r.to);
    if (Number.isNaN(d.getTime())) throw new ValidationError("`to` must be an ISO 8601 date.");
    parts.push(lte(meetings.startedAt, d));
  }
  return parts.length ? and(...parts) : undefined;
}

async function load(range: Range, limit = 500): Promise<MeetingRecord[]> {
  const rows = await db.select().from(meetings).where(rangeWhere(range)).orderBy(desc(meetings.startedAt)).limit(limit);
  return rows.map((r) => r.data as MeetingRecord);
}

export async function listMeetingSummaries() {
  const rows = await db.select({ id: meetings.id, title: meetings.title, startedAt: meetings.startedAt, durationSec: meetings.durationSec, summary: meetings.summary, syncedAt: meetings.syncedAt }).from(meetings).orderBy(desc(meetings.startedAt)).limit(200);
  return rows.map((r) => ({ ...r, summary: r.summary?.slice(0, 200) ?? null }));
}

export async function deleteMeetingRow(id: string): Promise<void> {
  await db.delete(meetings).where(eq(meetings.id, id));
}

const terms = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((t) => t.length >= 2);

export async function searchMeetings(input: { query: string; from?: string | undefined; to?: string | undefined; limit?: number | undefined }) {
  const ts = terms(input.query);
  if (ts.length === 0) throw new ValidationError("`query` needs at least one word of two or more characters.");
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 25);
  const hits = (await load(input, 500)).flatMap((m) => {
    const hay = [m.title, m.summary ?? "", m.topics.join(" "), m.decisions.map((d) => d.text).join(" "), m.actionItems.map((a) => a.text).join(" "), m.transcriptText].join("\n").toLowerCase();
    let score = 0; let matched = 0;
    for (const t of ts) {
      const c = hay.split(t).length - 1;
      if (c > 0) { matched += 1; score += c + (m.title.toLowerCase().includes(t) ? 3 : 0); }
    }
    if (!matched) return [];
    const seg = m.transcript.find((s) => ts.some((t) => s.text.toLowerCase().includes(t)));
    return [{
      meetingId: m.id, title: m.title, startedAt: m.startedAt,
      timestamp: seg ? stamp(seg.start) : null, timestampSec: seg ? seg.start : null,
      snippet: (seg?.text ?? m.summary ?? m.transcriptText).slice(0, 300),
      score: Number((score * (matched / ts.length)).toFixed(2)),
    }];
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function getMeeting(id: string, includeTranscript: boolean) {
  const rows = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  const m = rows[0]?.data as MeetingRecord | undefined;
  if (!m) return null;
  return {
    meetingId: m.id, title: m.title, startedAt: m.startedAt, endedAt: m.endedAt, durationSec: m.durationSec,
    participants: m.participants, summary: m.summary, topics: m.topics, decisions: m.decisions, actionItems: m.actionItems,
    openQuestions: m.openQuestions, commitments: m.commitments, project: m.project,
    transcriptSegments: m.transcript.length,
    ...(includeTranscript ? { transcript: m.transcript.map((s) => ({ timestamp: stamp(s.start), timestampSec: s.start, speaker: s.speaker, text: s.text })) } : {}),
  };
}

export async function listDecisions(topic?: string, range: Range = {}) {
  const t = topic?.trim().toLowerCase();
  return (await load(range)).flatMap((m) =>
    m.decisions
      .filter((d) => !t || d.text.toLowerCase().includes(t) || m.topics.some((x) => x.toLowerCase().includes(t)))
      .map((d) => ({ meetingId: m.id, title: m.title, startedAt: m.startedAt, decision: d.text, evidence: d.evidence })),
  );
}

export async function listActionItems(range: Range = {}) {
  return (await load(range)).flatMap((m) =>
    m.actionItems.map((a) => ({ meetingId: m.id, title: m.title, startedAt: m.startedAt, action: a.text, owner: a.owner, deadline: a.deadline, evidence: a.evidence })),
  );
}

export async function generateReport(id: string): Promise<string | null> {
  const m = await getMeeting(id, false);
  if (!m) return null;
  const list = (items: string[]) => (items.length ? items.map((x) => `- ${x}`).join("\n") : "_None recorded._");
  return [
    `# ${m.title}`,
    `${m.startedAt} · ${Math.round(m.durationSec / 60)} min`,
    `## Summary\n${m.summary ?? "_No summary recorded._"}`,
    `## Decisions\n${list(m.decisions.map((d) => d.text))}`,
    `## Action items\n${list(m.actionItems.map((a) => `${a.text}${a.owner ? ` (owner: ${a.owner})` : ""}${a.deadline ? ` (due ${a.deadline})` : ""}`))}`,
    `## Open questions\n${list(m.openQuestions)}`,
    `_Source: meeting ${m.meetingId}. Generated deterministically from stored memory; nothing added._`,
  ].join("\n\n");
}
