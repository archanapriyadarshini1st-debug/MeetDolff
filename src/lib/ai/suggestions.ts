/**
 * Real-time question suggestions.
 * Pure, testable pieces: a pacer that decides *when* to ask the model (so it is
 * never chatty or costly), a grounded prompt, and a defensive response parser.
 */

export const SUGGEST_SYSTEM = `You help someone take part in a live meeting. From the transcript excerpt only, suggest short, useful follow-up questions they could ask next. Prefer questions that clarify decisions, owners, deadlines, risks or unstated assumptions. Never state facts that are not in the excerpt.`;

export function suggestionPrompt(recent: string, alreadyShown: string[] = []): string {
  const avoid = alreadyShown.length ? `\nDo not repeat these:\n${alreadyShown.map((q) => `- ${q}`).join('\n')}\n` : '';
  return `Transcript excerpt (most recent speech last):\n"""\n${recent.slice(-3000)}\n"""\n${avoid}\nReturn ONLY a JSON array of 2-4 strings, each a single question under 140 characters. If the excerpt is too thin to justify a question, return [].`;
}

/** Accepts a bare array, a {"questions": [...]} object, or fenced JSON. Never throws. */
export function parseSuggestions(raw: string, alreadyShown: string[] = [], max = 4): string[] {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      data = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(data) ? data : Array.isArray((data as { questions?: unknown })?.questions) ? (data as { questions: unknown[] }).questions : [];
  const seen = new Set(alreadyShown.map((q) => q.trim().toLowerCase()));
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const q = item.replace(/\s+/g, ' ').trim();
    if (q.length < 8 || q.length > 160 || !q.endsWith('?')) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

/** Decides when enough new conversation exists to justify another model call. */
export class SuggestionPacer {
  private buffer = '';
  private pending = 0;
  private lastRun = Number.NEGATIVE_INFINITY;
  private running = false;

  constructor(
    private readonly minNewChars = 280,
    private readonly minIntervalMs = 45_000,
    private readonly windowChars = 2400,
  ) {}

  add(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.buffer = `${this.buffer} ${t}`.trim().slice(-8000);
    this.pending += t.length;
  }

  shouldRun(now: number): boolean {
    return !this.running && this.pending >= this.minNewChars && now - this.lastRun >= this.minIntervalMs;
  }

  /** Marks a run as started and returns the recent window to send. */
  begin(now: number): string {
    this.running = true;
    this.lastRun = now;
    this.pending = 0;
    return this.buffer.slice(-this.windowChars);
  }

  end(): void {
    this.running = false;
  }

  /** Window for an explicit user request ("Suggest now"), ignoring pacing. */
  peek(): string {
    return this.buffer.slice(-this.windowChars);
  }

  reset(): void {
    this.buffer = '';
    this.pending = 0;
    this.lastRun = Number.NEGATIVE_INFINITY;
    this.running = false;
  }
}
