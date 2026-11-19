// Deterministic passage search (no vectors). Every hit carries meeting + timestamp.
const STOP = new Set('the a an and or of to in on at for from with about was were is are be been that this it its we our what did do does who how why when'.split(' '));
export const tokenize = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t));

export function passagesOf(m) {
  const base = { meetingId: m.id, title: m.title, startedAt: m.startedAt };
  const out = [];
  if (m.summary) out.push({ ...base, kind: 'summary', startSec: null, text: m.summary });
  for (const d of m.decisions) out.push({ ...base, kind: 'decision', startSec: null, text: d.text });
  for (const a of m.actionItems) out.push({ ...base, kind: 'action_item', startSec: null, text: a.text });
  for (const q of m.openQuestions ?? []) out.push({ ...base, kind: 'open_question', startSec: null, text: q });
  let buf = [], start = 0, len = 0;
  const flush = () => { if (buf.length) out.push({ ...base, kind: 'transcript', startSec: start, text: buf.join(' ') }); buf = []; len = 0; };
  for (const s of m.transcript) {
    if (!buf.length) start = s.start;
    buf.push(`${s.speaker ? `${s.speaker}: ` : ''}${s.text}`);
    len += s.text.length;
    if (len > 450) flush();
  }
  flush();
  return out;
}

function snippet(text, terms, radius = 120) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i !== -1 && (at === -1 || i < at)) at = i; }
  if (at === -1) return text.slice(0, radius * 2);
  const a = Math.max(0, at - radius), b = Math.min(text.length, at + radius);
  return `${a > 0 ? '…' : ''}${text.slice(a, b)}${b < text.length ? '…' : ''}`;
}

export function searchPassages(meetings, query, limit = 10) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const all = meetings.flatMap(passagesOf);
  const df = new Map(terms.map((t) => [t, all.filter((p) => p.text.toLowerCase().includes(t)).length]));
  const scored = [];
  for (const p of all) {
    const lower = p.text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      const tf = lower.split(t).length - 1;
      if (tf) score += (1 + Math.log(1 + tf)) * Math.log(1 + all.length / (1 + (df.get(t) ?? 0)));
    }
    if (score > 0) scored.push({ ...p, score: Math.round(score * 100) / 100, snippet: snippet(p.text, terms) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ text: _t, ...rest }) => rest);
}
