/**
 * Meeting-to-Project Converter.
 * Parses AI JSON output into a reviewable ProjectPlan.
 * Plans require explicit user approval before being treated as authoritative.
 */

import { newId } from '../utils/id.js';
import type { ProjectPlan } from '../types.js';

export function parseProjectPlan(jsonText: string, meetingId: string): ProjectPlan {
  let parsed: any;
  try {
    // Strip markdown fences if present
    const cleaned = jsonText.replace(/```json/gi, '').replace(/```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('AI did not return valid JSON for the project plan. Try again.');
  }
  const now = new Date().toISOString();
  return {
    id: newId('proj'),
    meetingId,
    title: String(parsed.title ?? 'Untitled project'),
    objectives: (parsed.objectives ?? []).map(String),
    tasks: (parsed.tasks ?? []).map((t: any) => ({
      text: String(t.text ?? ''),
      owner: t.owner ? String(t.owner) : null,
      deadline: t.deadline ? String(t.deadline) : null,
    })),
    milestones: (parsed.milestones ?? []).map((m: any) => ({
      text: String(m.text ?? ''),
      date: m.date ? String(m.date) : null,
    })),
    dependencies: (parsed.dependencies ?? []).map(String),
    risks: (parsed.risks ?? []).map(String),
    approved: false,
    createdAt: now,
  };
}
