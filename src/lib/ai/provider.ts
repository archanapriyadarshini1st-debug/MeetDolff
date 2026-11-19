/**
 * Extensible AI provider layer.
 * Supports OpenAI-compatible chat completions (OpenAI, Groq, Together,
 * local Ollama/LM Studio, etc.), Anthropic Messages, and Gemini.
 * BYOK only — keys stay in chrome.storage.local, never logged.
 */

import type { ProviderSettings } from '../types.js';

export interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  text: string;
  model: string;
  provider: string;
}

export interface AiProvider {
  readonly name: string;
  chat(messages: ChatMessageInput[], opts?: { model?: string; temperature?: number }): Promise<ChatResult>;
}

function requireKey(settings: ProviderSettings): void {
  if (!settings.apiKey) {
    throw new Error('No API key configured. Add your key in Settings → AI Provider.');
  }
}

export class OpenAICompatibleProvider implements AiProvider {
  readonly name = 'openai-compatible';
  constructor(private settings: ProviderSettings) {}

  async chat(messages: ChatMessageInput[], opts?: { model?: string; temperature?: number }): Promise<ChatResult> {
    requireKey(this.settings);
    const model = opts?.model ?? this.settings.chatModel;
    const base = this.settings.baseUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts?.temperature ?? 0.3,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI request failed (${res.status}): ${body.slice(0, 800)}`);
    }
    const json = (await res.json()) as any;
    const text = json.choices?.[0]?.message?.content ?? '';
    if (!text) throw new Error('AI returned an empty response.');
    return { text, model, provider: this.name };
  }
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  constructor(private settings: ProviderSettings) {}

  async chat(messages: ChatMessageInput[], opts?: { model?: string; temperature?: number }): Promise<ChatResult> {
    requireKey(this.settings);
    const model = opts?.model ?? 'claude-3-5-sonnet-latest';
    const base = (this.settings.anthropicBaseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, '');
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const userMsgs = messages.filter((m) => m.role !== 'system');
    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.settings.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: opts?.temperature ?? 0.3,
        system: system || undefined,
        messages: userMsgs,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic request failed (${res.status}): ${body.slice(0, 800)}`);
    }
    const json = (await res.json()) as any;
    const text = (json.content ?? []).map((b: any) => b.text ?? '').join('').trim();
    if (!text) throw new Error('Anthropic returned an empty response.');
    return { text, model, provider: this.name };
  }
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  constructor(private settings: ProviderSettings) {}

  async chat(messages: ChatMessageInput[], opts?: { model?: string; temperature?: number }): Promise<ChatResult> {
    requireKey(this.settings);
    const model = opts?.model ?? 'gemini-1.5-flash';
    const base = (this.settings.geminiBaseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const systemInstruction = messages.find((m) => m.role === 'system')?.content;
    const res = await fetch(`${base}/models/${model}:generateContent?key=${encodeURIComponent(this.settings.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        generationConfig: { temperature: opts?.temperature ?? 0.3 },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini request failed (${res.status}): ${body.slice(0, 800)}`);
    }
    const json = (await res.json()) as any;
    const text = json.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('').trim() ?? '';
    if (!text) throw new Error('Gemini returned an empty response.');
    return { text, model, provider: this.name };
  }
}

export function createProvider(settings: ProviderSettings, kind: 'openai' | 'anthropic' | 'gemini' = 'openai'): AiProvider {
  if (kind === 'anthropic') return new AnthropicProvider(settings);
  if (kind === 'gemini') return new GeminiProvider(settings);
  return new OpenAICompatibleProvider(settings);
}
