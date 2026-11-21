/**
 * A deliberately tiny Markdown renderer for merged notes.
 *
 * Scope is exactly what the notes-merge prompt is instructed to produce, and nothing more:
 *   - `#`/`##`/`###` lines      → paragraph with a heading class
 *   - `- ` / `* ` lines         → bulleted list
 *   - `**bold**`                → <strong>
 *   - everything else           → literal text
 *
 * Two properties matter more than coverage:
 *  1. **No innerHTML.** Text is only ever inserted with textContent, so a model that emits
 *     `<img onerror=…>` produces visible characters, not executable markup.
 *  2. **No real heading elements.** Notes live inside pages that already have an h1/h2/h3
 *     hierarchy; emitting h2s from model output would break the document outline and show up
 *     in the accessibility audit. Styled paragraphs keep the outline intact.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;

/** Split a line into text and bold runs without ever trusting HTML. */
function appendInline(target: HTMLElement, text: string): void {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) {
      const strong = document.createElement('strong');
      strong.textContent = bold[1] as string;
      target.appendChild(strong);
    } else {
      target.appendChild(document.createTextNode(part));
    }
  }
}

export function renderNotesMarkdown(markdown: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let list: HTMLUListElement | null = null;

  const closeList = () => {
    if (list) {
      frag.appendChild(list);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      closeList();
      const p = document.createElement('p');
      p.className = 'notes-h';
      const level = (heading[1] as string).length;
      p.dataset['level'] = String(Math.min(level, 3));
      appendInline(p, heading[2] as string);
      frag.appendChild(p);
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      if (!list) list = document.createElement('ul');
      list.className = 'notes-list';
      const li = document.createElement('li');
      appendInline(li, bullet[1] as string);
      list.appendChild(li);
      continue;
    }

    closeList();
    const p = document.createElement('p');
    p.className = 'notes-p';
    appendInline(p, line);
    frag.appendChild(p);
  }
  closeList();
  return frag;
}
