/**
 * Grounded prompts for meeting intelligence.
 * Every extraction prompt demands evidence (timestamps) and forbids invention.
 */

export const SUMMARY_SYSTEM = `You are MeetDolff, a meeting memory assistant. You summarize meetings faithfully from transcripts only. Never invent decisions, deadlines, participants, or commitments. If something is not in the transcript, say it is not mentioned.`;

export function summaryPrompt(transcript: string): string {
  return `Summarize this meeting transcript. Return JSON with keys:
{
  "summary": "2-4 sentence faithful summary",
  "topics": ["topic1", "topic2"],
  "decisions": [{"text": "...", "evidence": "short quote or timestamp"}],
  "actionItems": [{"text": "...", "owner": null or "name", "deadline": null or "date"}],
  "openQuestions": ["..."],
  "commitments": ["..."]
}
Rules: Only include items explicitly stated. Owners/deadlines only if explicitly stated, otherwise null. Keep quotes short.

Transcript:
"""
${transcript.slice(0, 24000)}
"""`;
}

export function qaPrompt(question: string, context: string, externalContext = ''): string {
  return `Answer the question using the meeting memory below. Treat the meeting memory as the source of truth for what happened in meetings. Cite the meeting title and timestamp for meeting claims. If the meeting memory does not contain an answer, say so explicitly. Do not invent details.

Meeting memory:
"""
${context.slice(0, 24000)}
"""
${externalContext ? `\nExternal web research (not meeting memory; cite the URL when used):\n"""\n${externalContext.slice(0, 8000)}\n"""\n` : ''}
Question: ${question}

Answer concisely. Meeting citations use [Meeting Title, 12:34]. External facts must include their source URL.`;
}

export function projectPrompt(transcript: string, summary: string): string {
  return `Convert this meeting into a project plan. Return JSON:
{
  "title": "...",
  "objectives": ["..."],
  "tasks": [{"text": "...", "owner": null, "deadline": null}],
  "milestones": [{"text": "...", "date": null}],
  "dependencies": ["..."],
  "risks": ["..."]
}
Only include owners/deadlines if explicitly stated, otherwise null. Do not invent.

Summary: ${summary}

Transcript:
"""
${transcript.slice(0, 20000)}
"""`;
}
