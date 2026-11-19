import type { ProviderSettings } from '../types.js';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Explicit, opt-in web search. Results are kept separate from meeting memory
 * so the UI and prompts can label external facts and URLs.
 */
export async function searchWeb(settings: ProviderSettings, query: string): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (!q || settings.searchProvider === 'none') return [];
  if (!settings.searchApiKey) throw new Error('Web search is enabled but no search API key is saved.');

  if (settings.searchProvider === 'tavily') {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: settings.searchApiKey, query: q, search_depth: 'basic', max_results: 5, include_answer: false }),
    });
    if (!res.ok) throw new Error(`Tavily search failed (${res.status}).`);
    const json = (await res.json()) as any;
    return ((json.results ?? []) as any[]).slice(0, 5).map((r) => ({
      title: String(r.title ?? 'Untitled result'),
      url: String(r.url ?? ''),
      snippet: String(r.content ?? '').slice(0, 500),
    }));
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', q);
  url.searchParams.set('count', '5');
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': settings.searchApiKey,
    },
  });
  if (!res.ok) throw new Error(`Brave search failed (${res.status}).`);
  const json = (await res.json()) as any;
  return ((json.web?.results ?? []) as any[]).slice(0, 5).map((r) => ({
    title: String(r.title ?? 'Untitled result'),
    url: String(r.url ?? ''),
    snippet: String(r.description ?? '').slice(0, 500),
  }));
}
