// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderNotesMarkdown } from '../../src/lib/utils/markdown.js';

/** Runs in happy-dom (see the environment pragma above) because the renderer builds real DOM. */
function render(md: string): string {
  const frag = renderNotesMarkdown(md);
  const div = document.createElement('div');
  div.appendChild(frag);
  return div.innerHTML;
}

describe('renderNotesMarkdown', () => {
  it('renders headings as styled paragraphs, never as real heading elements', () => {
    const html = render('## Northline\n### From the transcript');
    expect(html).toContain('class="notes-h"');
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it('groups consecutive bullets into one list', () => {
    const html = render('- one\n- two\n- three');
    expect(html.match(/<ul/g)).toHaveLength(1);
    expect(html.match(/<li>/g)).toHaveLength(3);
  });

  it('closes a list before a following paragraph', () => {
    const html = render('- bullet\ntrailing words');
    expect(html).toMatch(/<\/ul><p class="notes-p">trailing words<\/p>/);
  });

  it('renders bold runs and leaves stray asterisks alone', () => {
    const html = render('**11 months** runway, 2 * 3');
    expect(html).toContain('<strong>11 months</strong>');
    expect(html).toContain('2 * 3');
  });

  it('never produces executable markup from model output', () => {
    const html = render('<img src=x onerror="alert(1)">\n<script>alert(2)</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
  });

  it('escapes HTML inside bold runs too', () => {
    const html = render('**<b>x</b>**');
    expect(html).not.toContain('<b>');
    expect(html).toContain('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  });

  it('ignores blank lines and normalises CRLF', () => {
    const html = render('a\r\n\r\n\r\nb');
    expect(html).toBe('<p class="notes-p">a</p><p class="notes-p">b</p>');
  });

  it('returns an empty fragment for empty input', () => {
    expect(render('')).toBe('');
  });
});
